import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { z } from "zod";
import { extractText } from "unpdf";
import {
  deleteJob,
  getModelOverride,
  getReasoningOverride,
  getJobRow,
  getProfile,
  hasProfile,
  insertJob,
  listFailedTasks,
  listJobs,
  resetPending,
  saveProfile,
  setRawText,
  setExpired,
  setParsed,
  setModelOverride,
  setReasoningOverride,
} from "./db";
import { chatStream, currentModel, currentReasoning, ENV_MODEL, ENV_REASONING, extractJson, listModels } from "./llm";
import { activeTasks, enqueue, enqueueEvaluate, retryFailed } from "./jobs";
import { CV_SYSTEM, chatSystem, externalCvPrompt } from "./prompts";
import { JobData, Profile } from "./schemas";
import { htmlToText, pdfToText } from "./fetchPage";

// Routes carry the full /api prefix; server mounts this at "/api/*".
export const api = new Hono();

const notFound = () => ({ error: "Not found" }) as const;

function isHttpUrl(u: string): boolean {
  try {
    const { protocol } = new URL(u);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const JobsBody = z.object({ urls: z.array(z.string()) });
const TextBody = z.object({ text: z.string() });
const ReparseBody = z.object({ refetch: z.boolean().optional() });
const ChatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1),
});

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

api.get("/api/jobs", c => c.json(listJobs()));

api.post("/api/jobs", async c => {
  const body = JobsBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Body must be { urls: string[] }" }, 400);

  const unique = [...new Set(body.data.urls.map(u => u.trim()).filter(u => u.length > 0))];
  const valid = unique.filter(isHttpUrl);
  if (valid.length === 0) return c.json({ error: "No valid http(s) URLs" }, 400);

  const added: number[] = [];
  const skipped: string[] = unique.filter(u => !isHttpUrl(u));
  for (const url of valid) {
    const id = insertJob(url);
    if (id === null) {
      skipped.push(url); // duplicate
    } else {
      added.push(id);
      enqueue(id);
    }
  }
  return c.json({ added, skipped });
});

// Browser extension sends the page's URL and rendered text. URL is the dedup key and the
// "Original" link; text is stored as-is and never refetched, so sites that forbid scraping are not hit.
const ContentBody = z.object({ url: z.string(), text: z.string() });
api.use("/api/jobs/content", cors({ origin: o => (o.startsWith("safari-web-extension://") ? o : null) }));
api.post("/api/jobs/content", async c => {
  const origin = c.req.header("Origin");
  if (origin !== undefined && !origin.startsWith("safari-web-extension://")) return c.json({ error: "Forbidden origin" }, 403);
  const body = ContentBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Body must be { url: string, text: string }" }, 400);
  const url = body.data.url.trim();
  if (!isHttpUrl(url)) return c.json({ error: "url must be http(s)" }, 400);
  const text = body.data.text.trim();
  if (text === "") return c.json({ error: "Text required" }, 400);
  const id = insertJob(url, "extension");
  if (id === null) return c.json({ added: [], duplicate: true });
  setRawText(id, text.slice(0, 60_000));
  enqueue(id);
  return c.json({ added: [id], duplicate: false });
});

api.use("/api/jobs/pdf", cors({ origin: o => (o.startsWith("safari-web-extension://") ? o : null) }));
// Safari sends only the URL of a PDF tab; the server downloads and extracts it, so the browser's
// rendering never matters and the text stays exactly what the PDF contains.
const PdfBody = z.object({ url: z.string() });
api.post("/api/jobs/pdf", async c => {
  const origin = c.req.header("Origin");
  if (origin !== undefined && !origin.startsWith("safari-web-extension://")) return c.json({ error: "Forbidden origin" }, 403);
  const body = PdfBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Body must be { url: string }" }, 400);
  const url = body.data.url.trim();
  if (!isHttpUrl(url)) return c.json({ error: "url must be http(s)" }, 400);
  const id = insertJob(url, "pdf");
  if (id === null) return c.json({ added: [], duplicate: true });
  enqueue(id);
  return c.json({ added: [id], duplicate: false });
});

// Pasted text and uploaded files. Optional source URL is stored as the url (dedup key and link).
// Without one, the content hash is the key. Text is stored as raw_text, then the normal queue runs.
async function addRawText(
  kind: "text" | "file",
  content: Uint8Array,
  text: string,
  label: string,
  sourceUrl: string | undefined,
) {
  const url = sourceUrl ?? `${kind}:${new Bun.CryptoHasher("sha256").update(content).digest("hex")}`;
  const id = insertJob(url, kind);
  if (id === null) return { added: [] as number[], skipped: [label] };
  setRawText(id, text.slice(0, 60_000));
  enqueue(id);
  return { added: [id], skipped: [] as string[] };
}

// Optional URL must be http(s) when given; blank means none.
const optionalUrl = (raw: string | undefined): string | undefined | null => {
  const u = raw?.trim();
  if (!u) return undefined;
  return isHttpUrl(u) ? u : null;
};

const TextInputBody = z.object({ text: z.string(), url: z.string().optional() });
api.post("/api/jobs/text", async c => {
  const body = TextInputBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Body must be { text: string, url?: string }" }, 400);
  const text = body.data.text.trim();
  if (text === "") return c.json({ error: "Text required" }, 400);
  const sourceUrl = optionalUrl(body.data.url);
  if (sourceUrl === null) return c.json({ error: "url must be http(s)" }, 400);
  return c.json(await addRawText("text", new TextEncoder().encode(text), text, "pasted text", sourceUrl));
});

const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Multipart upload: field "file", optional text field "url". PDF by magic bytes, HTML by name or MIME type.
api.post("/api/jobs/file", async c => {
  const form = await c.req.parseBody().catch(() => null);
  const file = form?.file;
  if (!(file instanceof File)) return c.json({ error: "Body must be multipart with a 'file' field" }, 400);
  const sourceUrl = optionalUrl(typeof form?.url === "string" ? form.url : undefined);
  if (sourceUrl === null) return c.json({ error: "url must be http(s)" }, 400);
  if (file.size > MAX_FILE_BYTES) return c.json({ error: "File larger than 25 MB" }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
  const isHtml = /\.html?$/i.test(file.name) || file.type === "text/html";
  if (!isPdf && !isHtml) return c.json({ error: "Unsupported file: upload a PDF or HTML" }, 400);
  let text: string;
  try {
    text = isPdf ? await pdfToText(bytes) : htmlToText(new TextDecoder().decode(bytes));
  } catch (e) {
    return c.json({ error: errText(e) }, 400);
  }
  return c.json(await addRawText("file", bytes, text, file.name, sourceUrl));
});

api.post("/api/jobs/:id/text", async c => {
  const id = Number(c.req.param("id"));
  if (!getJobRow(id)) return c.json(notFound(), 404);
  const body = TextBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success || body.data.text.trim() === "") {
    return c.json({ error: "Text required" }, 400);
  }
  resetPending(id, false);
  setRawText(id, body.data.text.slice(0, 60_000));
  enqueue(id);
  return c.json({ ok: true });
});

api.post("/api/jobs/:id/reparse", async c => {
  const id = Number(c.req.param("id"));
  if (!getJobRow(id)) return c.json(notFound(), 404);
  const body = ReparseBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "Invalid body" }, 400);
  // Extension-sourced jobs have no server fetch path: keep stored page text, just reparse it.
  // Only server/pdf jobs have a URL to refetch; extension, text and file content is kept as-is.
  resetPending(id, (body.data.refetch ?? false) && ["server", "pdf"].includes(getJobRow(id)?.source ?? ""));
  enqueue(id);
  return c.json({ ok: true });
});

api.post("/api/jobs/:id/evaluate", c => {
  const id = Number(c.req.param("id"));
  if (!getJobRow(id)) return c.json(notFound(), 404);
  if (!hasProfile()) return c.json({ error: "Save a profile first" }, 409);
  enqueueEvaluate(id);
  return c.json({ ok: true });
});

api.get("/api/tasks/active", c => c.json(activeTasks()));
api.get("/api/tasks/failed", c => c.json(listFailedTasks()));

// Retry one failed call. 409 when evaluate is requested but no profile is saved.
api.post("/api/tasks/failed/:id/retry", c => {
  const r = retryFailed(Number(c.req.param("id")));
  if (r === "not_found") return c.json(notFound(), 404);
  if (r === "no_profile") return c.json({ error: "Save a profile first" }, 409);
  return c.json({ ok: true });
});

// Batch: re-parse or re-evaluate every listed job. Ids come from the client's filtered view.
const BatchBody = z.object({
  ids: z.array(z.number().int()),
  action: z.enum(["reparse", "evaluate"]),
});
api.post("/api/jobs/batch", async c => {
  const body = BatchBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Body must be { ids: number[], action }" }, 400);
  const ids = body.data.ids.filter(id => getJobRow(id) !== null);
  if (body.data.action === "evaluate") {
    if (!hasProfile()) return c.json({ error: "Save a profile first" }, 409);
    ids.forEach(enqueueEvaluate);
  } else {
    ids.forEach(id => {
      resetPending(id, false);
      enqueue(id);
    });
  }
  return c.json({ queued: ids.length });
});

api.delete("/api/jobs/:id", c => {
  const id = Number(c.req.param("id"));
  if (!getJobRow(id)) return c.json(notFound(), 404);
  deleteJob(id);
  return c.json({ ok: true });
});

api.post("/api/jobs/:id/expired", async c => {
  const id = Number(c.req.param("id"));
  if (!getJobRow(id)) return c.json(notFound(), 404);
  const body = z.object({ expired: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Body must be { expired: boolean }" }, 400);
  if (!setExpired(id, body.data.expired)) return c.json({ error: "Job not parsed yet" }, 409);
  return c.json({ ok: true });
});

// Manual edit: full JobData replaces stored parse; schema validates every field.
api.put("/api/jobs/:id/data", async c => {
  const id = Number(c.req.param("id"));
  if (!getJobRow(id)) return c.json(notFound(), 404);
  const body = JobData.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400);
  setParsed(id, body.data);
  return c.json({ ok: true });
});

api.get("/api/profile", c => c.json(getProfile()));

api.put("/api/profile", async c => {
  const body = TextBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Body must be { text: string }" }, 400);

  let raw: unknown;
  try {
    raw = JSON.parse(body.data.text);
  } catch {
    try {
      raw = Bun.YAML.parse(body.data.text);
    } catch (e) {
      return c.json({ error: "Not valid JSON or YAML: " + errText(e) }, 400);
    }
  }

  const result = Profile.safeParse(raw);
  if (!result.success) return c.json({ error: z.prettifyError(result.error) }, 400);
  saveProfile(result.data);
  return c.json(result.data);
});

api.post("/api/profile/cv", async c => {
  const form = await c.req.formData();
  const file = form.get("file");
  const textField = form.get("text");

  let cvText = "";
  if (file instanceof File) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const { text } = await extractText(new Uint8Array(await file.arrayBuffer()), {
        mergePages: true,
      });
      cvText = Array.isArray(text) ? text.join("\n") : text;
    } else {
      cvText = await file.text();
    }
  } else if (typeof textField === "string") {
    cvText = textField;
  }

  cvText = cvText.trim();
  if (!cvText) return c.json({ error: "No text found in CV" }, 400);

  try {
    // Not saved: the user reviews the extracted profile, then saves it.
    return c.json(await extractJson(Profile, CV_SYSTEM, cvText));
  } catch (e) {
    return c.json({ error: errText(e) }, 502);
  }
});

api.get("/api/profile/prompt", c => c.text(externalCvPrompt()));

api.post("/api/chat", async c => {
  const body = ChatBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "messages must be a non-empty array" }, 400);

  const system = chatSystem(getProfile(), listJobs(), new Date().toISOString().slice(0, 10));
  const deltas = chatStream([{ role: "system", content: system }, ...body.data.messages]);
  // Errors after the stream opens go out as a { type: "error" } NDJSON line; the status is already 200.
  return stream(c, async s => {
    try {
      for await (const d of deltas) await s.writeln(JSON.stringify(d));
    } catch (e) {
      await s.writeln(JSON.stringify({ type: "error", text: errText(e) }));
    }
  });
});

api.get("/api/model", c => c.json({ model: currentModel(), env: ENV_MODEL, override: getModelOverride() }));

api.get("/api/models", async c => {
  try {
    return c.json({ models: await listModels() });
  } catch (e) {
    // Not every OpenAI-compatible server implements /models; the UI falls back to manual entry.
    return c.json({ error: errText(e), models: [] }, 502);
  }
});

const ModelBody = z.object({ model: z.string().trim().min(1).nullable() });

api.put("/api/model", async c => {
  const body = ModelBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Body must be { model: string | null }" }, 400);
  setModelOverride(body.data.model);
  return c.json({ model: currentModel(), env: ENV_MODEL, override: getModelOverride() });
});

// Free text on purpose: accepted levels vary per provider/model and are not discoverable via /models.
const ReasoningBody = z.object({ effort: z.string().trim().min(1).nullable() });

api.get("/api/reasoning", c =>
  c.json({ effort: currentReasoning(), env: ENV_REASONING, override: getReasoningOverride() }),
);

api.put("/api/reasoning", async c => {
  const body = ReasoningBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Body must be { effort: string | null }" }, 400);
  setReasoningOverride(body.data.effort);
  return c.json({ effort: currentReasoning(), env: ENV_REASONING, override: getReasoningOverride() });
});
