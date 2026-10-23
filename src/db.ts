import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type ActiveTask, type FailedTask, type Job, JobData, LlmRequest, Profile, Suitability, type TaskKind } from "./schemas";

const path = process.env.DB_PATH ?? "data/jobs.db";
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

export const db = new Database(path, { create: true });
db.run("PRAGMA journal_mode=WAL");

db.run(`CREATE TABLE IF NOT EXISTS jobs(
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  raw_text TEXT,
  data TEXT, -- parsed fields stored as JSON so schema can grow without migrations
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
// 'server' = URL fetched by server; 'extension' = page text pushed by browser, never fetched.
if (!db.query<{ name: string }, []>("PRAGMA table_info(jobs)").all().some(c => c.name === "source")) {
  db.run("ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'server'");
}
// AI fit against the profile; written by the evaluation step, separate from parsed `data`.
const cols = db.query<{ name: string }, []>("PRAGMA table_info(jobs)").all().map(c => c.name);
if (!cols.includes("suitability")) db.run("ALTER TABLE jobs ADD COLUMN suitability TEXT");
if (!cols.includes("suitability_error")) db.run("ALTER TABLE jobs ADD COLUMN suitability_error TEXT");
db.run(`CREATE TABLE IF NOT EXISTS profile(
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// Failed AI calls; survive restart so the user can retry them.
db.run(`CREATE TABLE IF NOT EXISTS failed_tasks(
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  error TEXT NOT NULL,
  request TEXT,
  failed_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// Queued or running AI calls; survive restart and are re-queued on startup.
db.run(`CREATE TABLE IF NOT EXISTS active_tasks(
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  state TEXT NOT NULL,
  queued_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT
)`);

type JobRow = {
  id: number;
  url: string;
  status: Job["status"];
  error: string | null;
  data: string | null;
  suitability: string | null;
  suitability_error: string | null;
  created_at: string;
};

const JOB_COLS = "id, url, status, error, data, suitability, suitability_error, created_at";

// Job ids with an evaluation queued or running. In-memory, like the queue: resets on restart.
export const evaluating = new Set<number>();

function toJob(r: JobRow): Job {
  return {
    id: r.id,
    url: r.url,
    status: r.status,
    error: r.error,
    data: r.data ? JobData.parse(JSON.parse(r.data)) : null,
    suitability: r.suitability ? Suitability.parse(JSON.parse(r.suitability)) : null,
    suitability_error: r.suitability_error,
    evaluating: evaluating.has(r.id),
    created_at: r.created_at,
  };
}

export function listJobs(): Job[] {
  return db.query<JobRow, []>(`SELECT ${JOB_COLS} FROM jobs ORDER BY id DESC`).all().map(toJob);
}

export function getJob(id: number): Job | null {
  const row = db.query<JobRow, [number]>(`SELECT ${JOB_COLS} FROM jobs WHERE id = ?`).get(id);
  return row ? toJob(row) : null;
}

export function getJobRow(
  id: number,
): { id: number; url: string; raw_text: string | null; source: string } | null {
  return (
    db
      .query<{ id: number; url: string; raw_text: string | null; source: string }, [number]>(
        "SELECT id, url, raw_text, source FROM jobs WHERE id = ?",
      )
      .get(id) ?? null
  );
}

// Returns the new id, or null when the URL already exists.
export function insertJob(url: string, source: "server" | "extension" = "server"): number | null {
  const res = db.run("INSERT OR IGNORE INTO jobs(url, source) VALUES (?, ?)", [url, source]);
  return res.changes === 1 ? Number(res.lastInsertRowid) : null;
}

export function setRawText(id: number, text: string) {
  db.run("UPDATE jobs SET raw_text = ?, updated_at = datetime('now') WHERE id = ?", [text, id]);
}

export function setParsed(id: number, data: JobData) {
  db.run(
    "UPDATE jobs SET status = 'parsed', error = NULL, data = ?, updated_at = datetime('now') WHERE id = ?",
    [JSON.stringify(data), id],
  );
}

export function setSuitability(id: number, s: Suitability) {
  db.run(
    "UPDATE jobs SET suitability = ?, suitability_error = NULL, updated_at = datetime('now') WHERE id = ?",
    [JSON.stringify(s), id],
  );
}

export function setSuitabilityError(id: number, msg: string) {
  db.run("UPDATE jobs SET suitability_error = ?, updated_at = datetime('now') WHERE id = ?", [msg, id]);
}

export function setError(id: number, msg: string) {
  db.run("UPDATE jobs SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?", [
    msg,
    id,
  ]);
}

export function resetPending(id: number, clearRaw: boolean) {
  db.run(
    `UPDATE jobs SET status = 'pending', error = NULL, ${clearRaw ? "raw_text = NULL," : ""} updated_at = datetime('now') WHERE id = ?`,
    [id],
  );
}

export function deleteJob(id: number) {
  db.run("DELETE FROM failed_tasks WHERE job_id = ?", [id]);
  db.run("DELETE FROM active_tasks WHERE job_id = ?", [id]);
  db.run("DELETE FROM jobs WHERE id = ?", [id]);
}

export function insertActiveTask(jobId: number, kind: TaskKind, url: string): number {
  const res = db.run("INSERT INTO active_tasks(job_id, kind, url, state) VALUES (?, ?, ?, 'queued')", [jobId, kind, url]);
  return Number(res.lastInsertRowid);
}

export function markTaskRunning(id: number) {
  db.run("UPDATE active_tasks SET state = 'running', started_at = datetime('now') WHERE id = ?", [id]);
}

export function deleteActiveTask(id: number) {
  db.run("DELETE FROM active_tasks WHERE id = ?", [id]);
}

type ActiveRow = {
  id: number;
  job_id: number;
  kind: TaskKind;
  url: string;
  state: ActiveTask["state"];
  queued_at: string;
  started_at: string | null;
  title: string | null;
};

export function listActiveTasks(): ActiveTask[] {
  return db
    .query<ActiveRow, []>("SELECT t.*, json_extract(j.data, '$.title') AS title FROM active_tasks t LEFT JOIN jobs j ON j.id = t.job_id ORDER BY t.id")
    .all()
    .map(r => ({
      id: r.id,
      jobId: r.job_id,
      kind: r.kind,
      url: r.url,
      state: r.state,
      queuedAt: r.queued_at,
      startedAt: r.started_at,
      title: r.title,
    }));
}

// Replaces any earlier failure for this job+kind: one open failure per job per kind.
export function recordFailedTask(
  jobId: number,
  kind: TaskKind,
  url: string,
  error: string,
  request: LlmRequest | null,
) {
  db.run("DELETE FROM failed_tasks WHERE job_id = ? AND kind = ?", [jobId, kind]);
  db.run(
    "INSERT INTO failed_tasks(job_id, kind, url, error, request) VALUES (?, ?, ?, ?, ?)",
    [jobId, kind, url, error, request === null ? null : JSON.stringify(request)],
  );
}

export function clearFailedTask(jobId: number, kind: TaskKind) {
  db.run("DELETE FROM failed_tasks WHERE job_id = ? AND kind = ?", [jobId, kind]);
}

type FailedRow = {
  id: number;
  job_id: number;
  kind: TaskKind;
  url: string;
  error: string;
  request: string | null;
  failed_at: string;
  title: string | null;
};

export function listFailedTasks(): FailedTask[] {
  return db
    .query<FailedRow, []>("SELECT f.*, json_extract(j.data, '$.title') AS title FROM failed_tasks f LEFT JOIN jobs j ON j.id = f.job_id ORDER BY f.id DESC")
    .all()
    .map(r => ({
      id: r.id,
      jobId: r.job_id,
      kind: r.kind,
      url: r.url,
      error: r.error,
      request: r.request ? LlmRequest.parse(JSON.parse(r.request)) : null,
      failedAt: r.failed_at,
      title: r.title,
    }));
}

export function getFailedTask(id: number): FailedTask | null {
  return listFailedTasks().find(t => t.id === id) ?? null;
}

// Manual override: sets the stored `expired` flag, leaving the deadline untouched.
export function setExpired(id: number, expired: boolean) {
  const row = db.query<{ data: string | null }, [number]>("SELECT data FROM jobs WHERE id = ?").get(id);
  if (!row?.data) return false;
  const data = JobData.parse({ ...JSON.parse(row.data), expired });
  db.run("UPDATE jobs SET data = ?, updated_at = datetime('now') WHERE id = ?", [JSON.stringify(data), id]);
  return true;
}

export function pendingIds(): number[] {
  return db
    .query<{ id: number }, []>("SELECT id FROM jobs WHERE status = 'pending' ORDER BY id")
    .all()
    .map(r => r.id);
}

export function hasProfile(): boolean {
  return db.query("SELECT 1 FROM profile WHERE id = 1").get() !== null;
}

export function getProfile(): Profile {
  const row = db.query<{ data: string }, []>("SELECT data FROM profile WHERE id = 1").get();
  return Profile.parse(row ? JSON.parse(row.data) : {});
}

export function saveProfile(p: Profile) {
  db.run(
    `INSERT INTO profile(id, data) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    [JSON.stringify(p)],
  );
}

// Runtime model override set from the UI; absent means LLM_MODEL env default.
db.run(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

export function getModelOverride(): string | null {
  return db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'model'").get()?.value ?? null;
}

export function setModelOverride(model: string | null) {
  if (model === null) db.run("DELETE FROM settings WHERE key = 'model'");
  else
    db.run(
      `INSERT INTO settings(key, value) VALUES ('model', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [model],
    );
}
