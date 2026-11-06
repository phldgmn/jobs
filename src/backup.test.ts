import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as BackupModule from "./backup";
import type * as DbModule from "./db";

let backup: typeof BackupModule;
let db: typeof DbModule;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "backup-test-"));
  process.env.DB_PATH = join(dir, "test.db");
  // db.ts opens DB_PATH at import time, so these must load after DB_PATH is set.
  db = await import("./db");
  backup = await import("./backup");
});

test("restore brings back jobs from a backup", () => {
  const id = db.insertJob("https://example.com/a");
  const bytes = backup.backupDatabase();
  db.deleteJob(id!);
  expect(db.listJobs()).toHaveLength(0);

  const file = join(dir, "restore.db");
  writeFileSync(file, bytes);
  backup.restoreDatabase(file);

  expect(db.listJobs().map(j => j.url)).toEqual(["https://example.com/a"]);
});

test("restore rejects a file that is not a database and leaves data untouched", () => {
  db.insertJob("https://example.com/b");
  const file = join(dir, "garbage.db");
  writeFileSync(file, "not sqlite");

  expect(() => backup.restoreDatabase(file)).toThrow();
  expect(db.listJobs().map(j => j.url)).toContain("https://example.com/b");
});
