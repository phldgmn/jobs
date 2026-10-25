import { fetchPageText, fetchPdfText } from "./fetchPage";
import { LlmError, extractJson } from "./llm";
import {
  clearFailedTask,
  deleteActiveTask,
  evaluating,
  getFailedTask,
  getJob,
  getJobRow,
  getProfile,
  hasProfile,
  insertActiveTask,
  listActiveTasks,
  markTaskRunning,
  pendingIds,
  recordFailedTask,
  resetPending,
  setError,
  setParsed,
  setRawText,
  setSuitability,
  setSuitabilityError,
} from "./db";
import { type ActiveTask, JobData, Suitability, type TaskKind } from "./schemas";
import { EVAL_SYSTEM, JOB_SYSTEM, isSyntheticKey, suitabilityInput } from "./prompts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Sequential on purpose: don't flood LLM API.
let chain: Promise<void> = Promise.resolve();

export const activeTasks = (): ActiveTask[] => listActiveTasks();

// Queued and running calls are rows in active_tasks: they survive restart and resumePending re-queues them.
function schedule(kind: TaskKind, jobId: number, run: () => Promise<void>) {
  const taskId = insertActiveTask(jobId, kind, getJobRow(jobId)?.url ?? "");
  chain = chain
    .then(() => {
      markTaskRunning(taskId);
      return run();
    })
    .catch(e => console.error(e))
    .finally(() => deleteActiveTask(taskId));
}

export function enqueue(id: number) {
  schedule("parse", id, () => processJob(id));
}

// Re-evaluation on demand; runs in the same queue so LLM calls stay sequential.
export function enqueueEvaluate(id: number) {
  evaluating.add(id);
  schedule("evaluate", id, () => evaluateJob(id));
}

async function processJob(id: number) {
  const row = getJobRow(id);
  if (!row) return; // deleted while queued
  clearFailedTask(id, "parse");

  try {
    let text = row.raw_text;
    if (!text) {
      text = row.source === "pdf" ? await fetchPdfText(row.url) : await fetchPageText(row.url);
      setRawText(id, text);
    }
    const data = await extractJson(JobData, JOB_SYSTEM, `${isSyntheticKey(row.url) ? "" : `URL: ${row.url}\n\n`}${text}`);
    setParsed(id, data);
  } catch (err) {
    setError(id, errText(err));
    recordFailedTask(id, "parse", row.url, errText(err), err instanceof LlmError ? err.request : null);
    return;
  }
  // Second step: only when a profile exists to compare against.
  if (hasProfile()) enqueueEvaluate(id);
}

async function evaluateJob(id: number) {
  evaluating.add(id);
  try {
    const job = getJob(id);
    if (!job?.data) return; // parse failed or job deleted
    clearFailedTask(id, "evaluate");
    const s = await extractJson(
      Suitability,
      EVAL_SYSTEM,
      suitabilityInput(getProfile(), job.data, job.url),
    );
    setSuitability(id, s);
  } catch (err) {
    const url = getJobRow(id)?.url ?? "";
    setSuitabilityError(id, errText(err));
    recordFailedTask(id, "evaluate", url, errText(err), err instanceof LlmError ? err.request : null);
  } finally {
    evaluating.delete(id);
  }
}

// Re-runs a failed call. Parse restarts the job; evaluate only re-scores it.
export function retryFailed(taskId: number): "ok" | "not_found" | "no_profile" {
  const t = getFailedTask(taskId);
  if (!t) return "not_found";
  clearFailedTask(t.jobId, t.kind);
  if (t.kind === "parse") {
    resetPending(t.jobId, false);
    enqueue(t.jobId);
    return "ok";
  }
  if (!hasProfile()) return "no_profile";
  enqueueEvaluate(t.jobId);
  return "ok";
}
// Recovers queued and running calls, plus pending jobs, after a restart. Call once at server start.
export function resumePending() {
  const leftover = listActiveTasks();
  for (const t of leftover) {
    deleteActiveTask(t.id);
    if (t.kind === "parse") enqueue(t.jobId);
    else enqueueEvaluate(t.jobId);
  }
  // Pending jobs with no row (e.g. inserted before this table existed) still need parsing.
  pendingIds().forEach(id => {
    if (!leftover.some(t => t.jobId === id && t.kind === "parse")) enqueue(id);
  });
}
