import OpenAI from "openai";
import { z } from "zod";
import { getModelOverride } from "./db";
import type { LlmRequest } from "./schemas";

const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY ?? "not-set", // keyless local Ollama works; errors surface per job
});

export const ENV_MODEL = process.env.LLM_MODEL ?? "gpt-4.1-mini";

// UI override (persisted) wins over the LLM_MODEL env default; read per call so changes apply immediately.
export function currentModel(): string {
  return getModelOverride() ?? ENV_MODEL;
}

export async function listModels(): Promise<string[]> {
  const page = await client.models.list();
  return page.data.map(m => m.id).sort();
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

function parseContent<S extends z.ZodType>(schema: S, content: string): z.output<S> {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return schema.parse(JSON.parse(stripped));
}

// Carries the prompt that failed so the AI tasks page can show and retry it.
export class LlmError extends Error {
  constructor(
    message: string,
    readonly request: LlmRequest,
  ) {
    super(message);
  }
}

export async function extractJson<S extends z.ZodType>(
  schema: S,
  system: string,
  user: string,
): Promise<z.output<S>> {
  const messages: Msg[] = [
    {
      role: "system",
      content:
        system +
        "\n\nReturn ONLY a JSON object matching this JSON Schema:\n" +
        JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })),
    },
    { role: "user", content: user },
  ];
  const model = currentModel();
  const request: LlmRequest = { model, system: messages[0].content, user };

  const complete = async (msgs: Msg[]) => {
    try {
      const res = await client.chat.completions.create({
        model,
        messages: msgs,
        temperature: 0,
        response_format: { type: "json_object" }, // json_object, not json_schema: broadest compatibility
      });
      return res.choices[0]?.message.content ?? "";
    } catch (e) {
      throw new LlmError(e instanceof Error ? e.message : String(e), request);
    }
  };

  const first = await complete(messages);
  try {
    return parseContent(schema, first);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
    const retry = await complete([
      ...messages,
      { role: "assistant", content: first },
      {
        role: "user",
        content: `Your output was invalid: ${msg}. Return the corrected JSON object only.`,
      },
    ]);
    try {
      return parseContent(schema, retry);
    } catch (e2) {
      throw new LlmError(
        "LLM returned invalid JSON: " + (e2 instanceof Error ? e2.message : String(e2)),
        request,
      );
    }
  }
}

export type ChatDelta = { type: "thinking" | "content"; text: string };

// Reasoning text arrives under different keys per provider (DeepSeek, Ollama, OpenRouter).
function reasoningOf(delta: object): string {
  if ("reasoning_content" in delta && typeof delta.reasoning_content === "string") return delta.reasoning_content;
  if ("reasoning" in delta && typeof delta.reasoning === "string") return delta.reasoning;
  return "";
}

export async function* chatStream(messages: Msg[]): AsyncGenerator<ChatDelta> {
  const stream = await client.chat.completions.create({
    model: currentModel(),
    messages,
    temperature: 0.3,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    const thinking = reasoningOf(delta);
    if (thinking) yield { type: "thinking", text: thinking };
    if (delta.content) yield { type: "content", text: delta.content };
  }
}
