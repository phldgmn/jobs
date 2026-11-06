# AGENTS.md

<!-- agents-md-generator: v1; doc-type: single_repo -->

## 1. Overview

A personal, local-only job tracker. A Bun and Hono server stores postings in SQLite, uses an OpenAI-compatible LLM to extract and score them, and serves a React web UI.

## 2. Ownership Map

### Stable Ownership Boundaries

- **Job intake and queue**: Start in `src/api.ts` for new routes and in `src/jobs.ts` for work after intake. `jobs.ts` owns the sequential LLM queue (`schedule`), the `parse` and `evaluate` steps, and `resumePending` at startup. Every queued or running call is an `active_tasks` row, so it survives a restart. Failed calls stay in `failed_tasks` until retried or the job is deleted. Check the job routes in `src/api.test.ts`.
- **Page and file extraction**: Start in `src/fetchPage.ts`. It owns `htmlToText` (JSON-LD `JobPosting` plus page text), `fetchPageText` (throws below 300 characters unless JSON-LD is present), and `pdfToText` (magic-byte check, no OCR). Stored text is capped at 60,000 characters. Check `src/fetchPage.test.ts` and `src/pdf.test.ts`.
- **LLM call boundary**: Start in `src/llm.ts` (`extractJson`, `chatStream`). `extractJson` embeds the zod-derived JSON Schema in the system prompt, requests `json_object`, and retries once with the validation error. A second failure throws `LlmError` carrying the exact request, which becomes the retry payload. Prompts live in `src/prompts.ts`.
- **Data contract**: Start in `src/schemas.ts`. It defines `JobData`, `Suitability`, `Profile` and `Job`, and server and web both import it. A new field needs a matching rule in `JOB_SYSTEM` (`src/prompts.ts`). Parsed data is stored as JSON, so no migration is needed. Check `src/schemas.test.ts`.
- **Persistence**: Start in `src/db.ts`, which owns the single SQLite file at `DB_PATH`. Schema changes are additive `ALTER TABLE` blocks guarded by `PRAGMA table_info`, run at import. Model and reasoning-effort overrides live in `settings`; env values are the defaults.
- **Web UI state**: Start in `src/web/App.tsx` for hash-based tabs and `src/web/useJobs.ts` for loading and 2-second polling while any job is pending or evaluating. Filter and sort state is in `src/web/filterStorage.ts`, one key per scope, validated with zod. Check `src/web/filter.test.ts`.
- **Desktop shell**: `menubar/main.swift` starts the compiled `jobs-server` with the repo as working directory, so `.env` and `data/` resolve. `menubar/Makefile` and `install-app.sh` build and install it. The Safari extension in `safari-extension/` posts page text to `/api/jobs/content` and URLs to `/api/jobs/pdf`.

### Active Change Routes

- **Applied and rejected state**: Within **Persistence**, start in `setApplied` and `setRejected` in `src/db.ts`. Un-applying clears `rejected_at`, and the API refuses `rejected: true` on jobs that are not applied. Check the Applied tab's Ongoing/Rejected toggle.

## 3. Core Behaviors & Patterns

- **Intake and deduplication**: Every intake path calls `insertJob`, which uses `INSERT OR IGNORE` on the unique `url`. Pasted text and files without a source URL use a synthetic `text:<sha256>` or `file:<sha256>` key. Duplicates are reported as `skipped` or `duplicate`, not as errors.
- **Stored text and reparse**: If `raw_text` exists, `processJob` skips fetching. `POST /api/jobs/:id/reparse` clears stored text only when `refetch` is true and the source is `server` or `pdf`. Extension, text and file jobs keep their text because they have no URL to refetch.
- **Failure paths**: A parse failure sets `status = 'error'` and records a `failed_tasks` row. `request` is set only when an LLM call was made. `retryFailed` restarts a parse with `resetPending`. Retrying an evaluate only re-scores, and it needs a saved profile.
- **Evaluation**: After a successful parse, `evaluate` is queued only if a profile exists. Scores go to `suitability` and `suitability_error`, separate from `data`, so manual edits to `data` do not erase them. The `evaluating` set is in memory and resets on restart.
- **Applied lifecycle**: `setApplied` keeps the original `applied_at` when a job is re-marked. Applied jobs are hidden from the default list. The Applied tab (`JobsPage applied`) has its own filter key.
- **Materials**: Files are stored as BLOBs in `materials` and never parsed. They are served with `Content-Security-Policy: sandbox`. Only PDF and common image types are inline; everything else downloads.
- **Local-only trust model**: The server binds `127.0.0.1` with no auth. The capture endpoints accept an `Origin` header only when it starts with `safari-web-extension://`.

## 4. Conventions

- **Validation at boundaries**: Request bodies are parsed with zod `safeParse`. Errors return `{ error: string }` with 400, 404, 409 or 502. Messages name the expected body, for example `Body must be { applied: boolean }`.
- **Route ids**: Handlers read `:id` with `Number(c.req.param("id"))`, then check `getJobRow` and return 404 `{ error: "Not found" }` before acting.
- **Database access**: Use `db.query<Row, Params>(...)` with `?` placeholders and a typed row alias such as `JobRow`. Timestamps use `datetime('now')`. Add columns with an `ALTER TABLE` guarded by `PRAGMA table_info`, following the blocks in `src/db.ts`.
- **Shared types**: Client code uses `import type` from `src/schemas.ts`, so zod and server modules stay out of the browser bundle. Types come from `z.output<typeof ...>`.
- **Comments**: Known limits use `shortcut: <limit>, <when to upgrade>` (see `src/fetchPage.ts`). Comments explain why a rule exists, not what the code does.
- **Naming**: Server files are camelCase (`fetchPage.ts`). React components are PascalCase in `src/web/`. Tests are co-located as `*.test.ts`. Database columns and API job fields are snake_case (`applied_at`). Task payloads are camelCase (`jobId`, `failedAt`).

## 5. Working Agreements

- Respond in the user's preferred language. If none is specified, infer it from the codebase. Keep technical terms in English and never translate code blocks.
- Ask the user before introducing tests, lint, or formatter setups. Add them only on explicit request.
- Before editing, review related usages, flows, patterns, and likely impact.
- Fix the underlying cause, not only the visible symptom. Apply the narrowest complete change that resolves the root issue.
- Check side effects across callers, shared abstractions, and behavior/API boundaries. Report relevant impact and compatibility risks.
- Ask the user when decisions are needed for scope, behavior, or tradeoffs.
- Do not silently expand scope for theoretical robustness. Before adding complexity for a speculative race or security edge case, explain the failure mode, likelihood, and cost, and get the user's agreement.
- Do not add parameters, configuration options, feature flags, or compatibility layers that no current caller or consumer needs.
- Add external dependencies only when necessary, and explain why each one is needed.
- After code changes, run `bun run typecheck` (`tsc --noEmit`) to verify type safety.
- Apply the code-shape rules below to code you add and to existing code the task requires you to change. Do not rewrite other code to fit them unless asked. If a documented or tool-enforced repository convention differs, follow it unless it weakens type checking.
- Extract a function only when more than one place calls it, it hides a genuinely complex boundary, or its name makes the caller clearer. Otherwise keep logic inline. Reuse an existing function that does the same job.
- Inline a local variable used only once, unless its name explains the expression or inlining would change when or how often it runs.
- Use at most one level of conditional expression. For more branches, use `if` statements, early returns, or a lookup table.
- Do not add an interface or base class with one implementation, or a factory with one caller, unless a framework, public contract, or current test requires it.
- Access values through their owner, as in `order.total`, unless unpacking is needed or idiomatic.
- Do not revalidate values a schema or internal type already guarantees. Check outside data (requests, files, environment variables, deserialized data) where it enters the system.
- Let errors propagate unless the current code can handle them or an established boundary converts them. Keep the error type or cause callers check. Do not hide a failure behind a default the contract does not define.
- Remove imports and non-public code your change leaves unused, plus debug output you added. Leave unrelated dead code alone.
- Do not weaken type checking. Avoid escape-hatch types, unchecked casts, and suppressions; fix the type instead. If one is unavoidable, keep it at the narrowest point and comment why.
- Rely on type inference. Write explicit types only where the language requires them, an exported API needs them, or they clarify the code.
- Comment non-obvious constraints and their reasons. Do not comment obvious code or describe change history.
