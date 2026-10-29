import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";

// db.ts opens DB_PATH at import time, so the API must load after DB_PATH is set; static import would run first.
let dir: string;
let api: Hono;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-test-"));
  process.env.DB_PATH = join(dir, "test.db");
  ({ api } = await import("./api"));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const postJson = (path: string, body: unknown) =>
  api.fetch(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/jobs/text", () => {
  test("rejects blank text without creating a job", async () => {
    const res = await postJson("/api/jobs/text", { text: "   " });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/jobs/file", () => {
  test("rejects files that are neither PDF nor HTML", async () => {
    const form = new FormData();
    form.append("file", new File(["\x89PNG"], "photo.png", { type: "image/png" }));
    const res = await api.fetch(new Request("http://x/api/jobs/file", { method: "POST", body: form }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unsupported file: upload a PDF or HTML" });
  });
});

describe("applied and materials", () => {
  const addJob = async () => {
    const res = await postJson("/api/jobs/text", { text: `job ${Math.random()}` });
    return (await res.json()).added[0] as number;
  };
  const listJob = async (id: number) =>
    (await (await api.fetch(new Request("http://x/api/jobs"))).json()).find((j: { id: number }) => j.id === id);

  test("applied toggle sets and clears applied_at", async () => {
    const id = await addJob();
    await postJson(`/api/jobs/${id}/applied`, { applied: true });
    expect((await listJob(id)).applied_at).not.toBeNull();
    await postJson(`/api/jobs/${id}/applied`, { applied: false });
    expect((await listJob(id)).applied_at).toBeNull();
  });

  test("uploads several files and serves each with a sandbox CSP", async () => {
    const id = await addJob();
    const form = new FormData();
    form.append("file", new File(["cv bytes"], "cv.pdf", { type: "application/pdf" }));
    form.append("file", new File(["<script>x</script>"], "letter.html", { type: "text/html" }));
    const up = await api.fetch(new Request(`http://x/api/jobs/${id}/materials`, { method: "POST", body: form }));
    expect(up.status).toBe(200);
    expect((await up.json()).added).toBe(2);

    const job = await listJob(id);
    expect(job.materials.map((m: { name: string }) => m.name)).toEqual(["cv.pdf", "letter.html"]);

    const html = await api.fetch(new Request(`http://x/api/materials/${job.materials[1].id}`));
    expect(html.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(html.headers.get("Content-Disposition")).toMatch(/^attachment/);
    const pdf = await api.fetch(new Request(`http://x/api/materials/${job.materials[0].id}`));
    expect(pdf.headers.get("Content-Disposition")).toMatch(/^inline/);
  });
});
