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
