# Job Tracker: Bun + Hono + SQLite + React, with LLM parsing, profile, and chat

Personal tool. You paste job URLs. The server fetches each page, and an OpenAI-compatible LLM pulls out structured fields. If the posting is in neither German nor English, the LLM translates it to English. The web UI lists jobs with filter, sort and full-text search. A profile page has a JSON/YAML editor, an in-app CV import (PDF/text parsed by the LLM) and a copyable prompt for an external agent. A chat page answers questions about the collected jobs using your profile.

Working dir: `/Users/philhennel/Code/jobs` (empty, no git yet). Runtime: Bun 1.4.2.

## Approach

### Step 1: Scaffold the project
Create:
- `package.json`: `"name": "jobs"`, `"type": "module"`, `"private": true`. Scripts:
  - `"dev": "bun --hot src/server.ts"`
  - `"start": "NODE_ENV=production bun src/server.ts"`
  - `"test": "bun test"`
  - `"typecheck": "tsc --noEmit"`
- Dependencies, installed with `bun add hono openai zod linkedom unpdf react react-dom @picocss/pico` and `bun add -d typescript @types/bun @types/react @types/react-dom`. Known versions: zod 4.x (we need `z.toJSONSchema` and `z.prettifyError`), openai 7.x, hono 4.x.
- `tsconfig.json`: `strict: true`, `target: "ESNext"`, `module: "Preserve"`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `lib: ["ESNext","DOM"]`, `types: ["bun"]`, `noEmit: true`, `skipLibCheck: true`.
- `.gitignore`: `node_modules`, `data/`, `.env`.
- `.env.example`:
  ```
  OPENAI_BASE_URL=https://api.openai.com/v1   # any OpenAI-compatible endpoint (OpenRouter, Ollama http://localhost:11434/v1, LM Studio)
  OPENAI_API_KEY=sk-...
  LLM_MODEL=gpt-4.1-mini
  PORT=3000
  DB_PATH=data/jobs.db
  ```
  Bun loads `.env` automatically, so no dotenv package.
- Run `git init`.

### Step 2: Schemas (`src/schemas.ts`)
Server and client both import this file. The client uses `import type` only.

```ts
export const Remote = z.enum(["full", "mostly", "partly", "none", "unknown"]);
const str = z.string().nullable().default(null);
const list = z.array(z.string()).default([]);
export const JobData = z.object({
  title: z.string(),
  company: str,
  description: z.string().default(""),          // role, responsibilities, team; condensed but faithful
  company_description: str,
  must_haves: list,
  nice_to_haves: list,
  salary: str,                                   // human-readable as stated, e.g. "65.000–80.000 EUR/year"
  salary_min: z.number().nullable().default(null),
  salary_max: z.number().nullable().default(null),
  salary_currency: str,                          // ISO 4217
  location: str,
  remote: Remote.catch("unknown"),
  language: z.string().default("en"),            // ISO 639-1 of ORIGINAL posting
  translated: z.boolean().default(false),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null).default(null),
});
export type JobData = z.output<typeof JobData>;
export type JobStatus = "pending" | "parsed" | "error";
export type Job = { id: number; url: string; status: JobStatus; error: string | null; data: JobData | null; created_at: string };
```

Profile schema. Every field is optional with a default, so partial imports validate.

```ts
const period = { start: str, end: str };               // "YYYY-MM" or "YYYY"; end null = present
export const Profile = z.object({
  name: str, headline: str, email: str, phone: str, location: str, links: list, summary: str,
  skills: list,
  languages: z.array(z.object({ language: z.string(), level: str })).default([]),
  education: z.array(z.object({ institution: z.string(), degree: str, field: str, ...period, details: str })).default([]),
  experience: z.array(z.object({ company: z.string(), title: z.string(), location: str, ...period, description: str, highlights: list })).default([]),
  certifications: list,
  projects: z.array(z.object({ name: z.string(), description: str, link: str })).default([]),
  preferences: z.object({ desired_roles: list, locations: list, remote: str, salary_expectation: str, notes: str }).default({ desired_roles: [], locations: [], remote: null, salary_expectation: null, notes: null }),
});
export type Profile = z.output<typeof Profile>;
```

### Step 3: DB (`src/db.ts`)
- `const path = process.env.DB_PATH ?? "data/jobs.db"`. When the path is not `":memory:"`, run `mkdirSync(dirname(path), { recursive: true })`. Then `export const db = new Database(path, { create: true })` from `bun:sqlite`, followed by `db.run("PRAGMA journal_mode=WAL")`.
- DDL (`CREATE TABLE IF NOT EXISTS`):
  - `jobs(id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', error TEXT, raw_text TEXT, data TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
  - `profile(id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
- Parsed fields go in `data` as a JSON blob. That way new fields need no migration. Comment in code: `// parsed fields stored as JSON so schema can grow without migrations`.
- Exported functions:
  - `listJobs(): Job[]`. Selects everything except `raw_text`, ordered by `id DESC`, with `data` JSON-parsed.
  - `getJobRow(id): { id, url, raw_text: string | null } | null`
  - `insertJob(url): number | null`. Uses `INSERT OR IGNORE`. Returns `lastInsertRowid` when `changes === 1`, otherwise `null` (duplicate).
  - `setRawText(id, text)`
  - `setParsed(id, data: JobData)`: status `parsed`, error `NULL`.
  - `setError(id, msg)`: status `error`.
  - `resetPending(id, clearRaw: boolean)`: status `pending`, error `NULL`. Sets `raw_text = NULL` when `clearRaw` is true.
  - `deleteJob(id)`
  - `pendingIds(): number[]`
  - `getProfile(): Profile`. Returns `Profile.parse(JSON.parse(row.data))`, or `Profile.parse({})` when no row exists.
  - `saveProfile(p: Profile)`: `INSERT ... ON CONFLICT(id) DO UPDATE`.
- Every update sets `updated_at = datetime('now')`.

### Step 4: Page fetching (`src/fetchPage.ts`)
- Pure function `htmlToText(html: string): string`:
  1. Run `parseHTML(html)` from `linkedom`.
  2. Collect `script[type="application/ld+json"]` contents. JSON-parse each one and ignore parse errors. Flatten arrays and `@graph`. Keep objects whose `@type` is `"JobPosting"` or contains it.
  3. Remove `script, style, noscript, svg, nav, footer, header, form, iframe`.
  4. `text = document.body?.textContent ?? ""`, with whitespace collapsed (`/\s+/g` → `" "`) and trimmed.
  5. Return `(jsonLd.length ? "STRUCTURED DATA (JSON-LD):\n" + JSON.stringify(jsonLd) + "\n\n" : "") + "PAGE TEXT:\n" + text`.
- `export async function fetchPageText(url: string): Promise<string>`:
  1. Call `fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "Accept-Language": "en,de;q=0.8" }, signal: AbortSignal.timeout(20_000), redirect: "follow" })`.
  2. If `!res.ok`, throw `Error(\`HTTP ${res.status} fetching page\`)`.
  3. If the content-type includes `html`, run `htmlToText`. Otherwise use the raw text.
  4. If the result has no JSON-LD and the text after `PAGE TEXT:` is under 300 chars, throw `Error("Page returned too little text (likely JS-rendered or blocked). Use 'Paste text' instead.")`.
  5. Truncate to 60_000 chars. Comment in code: `// shortcut: no headless browser; JS-rendered pages need pasted text. Add Playwright if this becomes common.`

### Step 5: LLM client (`src/llm.ts`)
- `const client = new OpenAI({ baseURL: process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY ?? "not-set" })`. The `"not-set"` fallback lets keyless local Ollama work. Errors surface per job.
- `export const MODEL = process.env.LLM_MODEL ?? "gpt-4.1-mini"`.
- `export async function extractJson<S extends z.ZodType>(schema: S, system: string, user: string): Promise<z.output<S>>`:
  - Messages: `[{role:"system", content: system + "\n\nReturn ONLY a JSON object matching this JSON Schema:\n" + JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }))}, {role:"user", content:user}]`.
  - Call `client.chat.completions.create({ model: MODEL, messages, temperature: 0, response_format: { type: "json_object" } })`. Use `json_object`, not `json_schema`, for the broadest compatibility across OpenAI-compatible servers.
  - Parse step: strip leading/trailing triple-backtick fences, run `JSON.parse`, then `schema.parse`.
  - If parsing fails, retry exactly once. Append the assistant's content and a user message: `"Your output was invalid: <error message, first 2000 chars>. Return the corrected JSON object only."` If the second attempt also fails, throw `Error("LLM returned invalid JSON: " + msg)`.
- `export async function chat(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string>`. Single non-streaming completion with `temperature: 0.3`. Returns `choices[0].message.content ?? ""`.

### Step 6: Prompts (`src/prompts.ts`)
- `JOB_SYSTEM`: "You extract structured data from a job posting. Rules:
  - `description` = responsibilities, tasks, team, and what the role is about. Condense boilerplate, keep every concrete detail.
  - `must_haves` = explicitly required qualifications. `nice_to_haves` = 'plus', 'preferred', 'ideally'. One item per requirement.
  - `remote`: full = fully remote; mostly = remote with occasional office; partly = hybrid with regular office days; none = on-site only; unknown = not stated.
  - `deadline` = application deadline as YYYY-MM-DD, or null.
  - `salary` exactly as stated. Numeric min/max are annual amounts when possible.
  - `language` = ISO 639-1 code of the posting's original language.
  - If the original language is German or English, keep all text in that language and set translated=false. Otherwise translate all text fields into English and set translated=true.
  - Never invent information. Use null or [] when absent."
- `CV_SYSTEM`: "You extract a person's profile from their CV/resume. Keep original wording for descriptions, dates as YYYY-MM or YYYY, end=null if ongoing. Never invent information."
- `export function externalCvPrompt(): string`. Returns `CV_SYSTEM` + `"\n\nRead the attached CV and return ONLY a JSON (or YAML) document matching this JSON Schema:\n"` + pretty `z.toJSONSchema(Profile, { io: "input", unrepresentable: "any" })`.
- `export function chatSystem(profile: Profile, jobs: Job[], today: string): string`:
  - Includes only jobs with `status === "parsed"` and (`deadline === null || deadline >= today`).
  - Each job is serialized compactly as `{ id, title, company, location, remote, deadline, salary, must_haves, nice_to_haves, description: description.slice(0, 1500) }`.
  - Text: "You are a career advisor. Today is {today}. The candidate's profile and their collected open positions are below. Assess fit honestly, based on requirements vs. profile. Refer to jobs as '#<id> <title> @ <company>'. Answer in the user's language.\n\nPROFILE:\n{JSON}\n\nJOBS:\n{JSON array}".
  - Comment in code: `// shortcut: whole job list in context; switch to retrieval/tool-calls when it exceeds model context`.

### Step 7: Background processing (`src/jobs.ts`)
- Run jobs one at a time on a promise chain:
  ```ts
  let chain = Promise.resolve();
  export function enqueue(id: number) {
    chain = chain.then(() => processJob(id)).catch(e => console.error(e));
  }
  ```
- `async function processJob(id)`:
  1. `row = getJobRow(id)`. If missing (deleted), return.
  2. `text = row.raw_text ?? await fetchPageText(row.url)`. If the text was just fetched, call `setRawText(id, text)`.
  3. `data = await extractJson(JobData, JOB_SYSTEM, \`URL: ${row.url}\n\n${text}\`)`, then `setParsed(id, data)`.
  4. Wrap all of this in try/catch. On error, call `setError(id, err.message)`.
- `export function resumePending()`: runs `pendingIds().forEach(enqueue)`. Call it once at server start.

### Step 8: API (`src/api.ts`, Hono app; `export const api = new Hono()`)
All routes are under `/api`. Every handler parses `:id` with `Number(c.req.param("id"))`. Not-found returns 404 `{ error: "Not found" }`. Validation failure returns 400 `{ error: string }`.

- `GET /api/jobs`: returns `listJobs()`.
- `POST /api/jobs`, body `{ urls: string[] }`:
  - Trim, drop empty entries, and keep only entries where `new URL(u)` succeeds with protocol `http:`/`https:`. Dedupe.
  - If none are valid, return 400 `{ error: "No valid http(s) URLs" }`.
  - For each URL, call `insertJob`. A non-null id gets `enqueue`d; a null id is recorded as skipped.
  - Return `{ added: number[], skipped: string[] }` (skipped = invalid or duplicate).
- `POST /api/jobs/:id/text`, body `{ text: string }`. Requires non-empty text. Calls `resetPending(id, false)`, `setRawText(id, text.slice(0, 60_000))`, `enqueue(id)`. Returns `{ ok: true }`.
- `POST /api/jobs/:id/reparse`, body `{ refetch?: boolean }`. Calls `resetPending(id, !!refetch)` and `enqueue(id)`.
- `DELETE /api/jobs/:id`.
- `GET /api/profile`: returns `getProfile()`.
- `PUT /api/profile`, body `{ text: string }` holding JSON or YAML:
  - `let raw; try { raw = JSON.parse(text) } catch { raw = Bun.YAML.parse(text) }`. If YAML also throws, return 400 `{ error: "Not valid JSON or YAML: " + msg }`.
  - `Profile.safeParse(raw)`. On failure, return 400 `{ error: z.prettifyError(result.error) }`.
  - On success, call `saveProfile` and return the profile.
- `POST /api/profile/cv`: multipart with field `file` (`.pdf`, `.txt`, `.md`) or field `text`.
  - PDF (by `file.type === "application/pdf"` or `.pdf` name): `(await extractText(new Uint8Array(await file.arrayBuffer()), { mergePages: true })).text` from `unpdf`. Other files use `await file.text()`.
  - Empty extracted text returns 400 `{ error: "No text found in CV" }`.
  - Otherwise returns `await extractJson(Profile, CV_SYSTEM, cvText)`, NOT saved. The user reviews it, then saves.
  - LLM errors return 502 `{ error: msg }`.
- `GET /api/profile/prompt`: returns `c.text(externalCvPrompt())`.
- `POST /api/chat`, body `{ messages: { role: "user" | "assistant"; content: string }[] }`. Requires a non-empty array. Prepends `{ role: "system", content: chatSystem(getProfile(), listJobs(), new Date().toISOString().slice(0, 10)) }`. Returns `{ reply }`. Errors return 502 `{ error }`.

### Step 9: Server (`src/server.ts`)
```ts
import index from "./web/index.html";
import { api } from "./api";
import { resumePending } from "./jobs";
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: { "/api/*": req => api.fetch(req), "/*": index },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});
resumePending();
console.log(`Jobs UI: ${server.url}`);
```
Bun's HTML import bundles React/TSX/CSS, so there is no Vite.

### Step 10: Web UI (`src/web/`)
- `index.html`: `<div id="root">` plus `<script type="module" src="./main.tsx">`.
- `main.tsx`: `import "@picocss/pico/css/pico.min.css"; import "./styles.css";` then `createRoot(...).render(<App/>)`.
- `styles.css`: about 30 lines max. Wider container, `.chips` for requirement lists, `pre-wrap` for chat messages, deadline-past styling in `var(--pico-muted-color)`.
- `api.ts` (client): small `async function req<T>(method, path, body?)`. Throws `Error(json.error ?? res.statusText)` when `!res.ok`.
- `App.tsx`: nav with three tabs, Jobs | Profile | Chat. The active tab lives in `location.hash` (`#jobs` default, `#profile`, `#chat`) and follows `hashchange`. No router library.
- `filter.ts` (pure, tested):
  ```ts
  export type Filters = { q: string; remote: Remote | "any"; language: string; deadline: "any" | "upcoming" | "past" | "none"; sort: "deadline_asc" | "deadline_desc" | "added_desc" | "company_asc" };
  export const defaultFilters: Filters = { q: "", remote: "any", language: "any", deadline: "any", sort: "deadline_asc" };
  export function applyFilters(jobs: Job[], f: Filters, today: string): Job[]
  ```
  - Input is parsed jobs only.
  - `q`: case-insensitive substring match against `[title, company, description, company_description, location, salary, url, ...must_haves, ...nice_to_haves].join("\n")`.
  - `deadline`: upcoming = `deadline >= today`; past = `deadline < today`; none = `deadline === null`.
  - Sort: deadline asc/desc puts null deadlines last in both directions. `added_desc` sorts by id desc. `company_asc` uses `localeCompare`, with null last.
  - Comment in code: `// shortcut: client-side filtering over all jobs; move to SQL/FTS5 if >~5k jobs`.
- `JobsPage.tsx`:
  - Textarea "Paste job URLs (one per line)" plus an "Add" button that POSTs `/api/jobs`. Shows the added count and lists skipped entries.
  - Load `GET /api/jobs` on mount. While any job is `pending`, poll every 2s with `setInterval`, cleared when none are pending.
  - "Processing / failed" section, unfiltered, holds the pending and error rows. Each row shows the URL, a status spinner (`aria-busy`) or the error text, and for errors: a "Paste text" button (inline textarea that POSTs `/api/jobs/:id/text`), "Retry" (reparse with `refetch: true`), and "Delete".
  - Filter bar: search input, remote select, language select (options = distinct languages present), deadline select, sort select. Filter state is in `useState`, not persisted.
  - Results show "N of M jobs", then a list of `<details>` cards.
    - Summary line: title · company · location · remote badge · salary · deadline. The deadline is dimmed when past, and "Translated from {language}" appears if `translated`.
    - Body: description, company description, must-haves `<ul>`, nice-to-haves `<ul>`, original link (`target="_blank" rel="noreferrer"`), "Reparse", "Delete" (with `confirm()`).
- `ProfilePage.tsx`:
  - Load `GET /api/profile`. Show a `<textarea rows=30>` holding `JSON.stringify(profile, null, 2)`, with the note "JSON or YAML accepted". The "Save" button runs PUT `{ text }`. On success it replaces the textarea with server-normalized JSON. On error it shows the message in `<pre>`.
  - "Import CV" file input (`accept=".pdf,.txt,.md"`) plus an "Or paste CV text" textarea and an "Extract with AI" button (`aria-busy` while running). The button POSTs FormData to `/api/profile/cv`, and the result fills the editor textarea without saving. Message: "Review, then Save."
  - "Copy prompt for external agent" button. Fetches `/api/profile/prompt`, then `navigator.clipboard.writeText`, and also shows it in a collapsible `<details><pre>`.
- `ChatPage.tsx`:
  - The message list stays in `useState`, not persisted. A textarea plus a Send button (Cmd/Ctrl+Enter sends).
  - Sending POSTs `{ messages }` to `/api/chat` and appends the reply. Errors appear inline.
  - Three starter buttons fill the input:
    - "Which jobs give me the highest chance of success, and why?"
    - "What am I missing for my top 3 matches?"
    - "Which deadlines are coming up?"

### Step 11: Tests (bun test, colocated)
- `src/fetchPage.test.ts`: an HTML fixture string has a JSON-LD `@graph` containing a `JobPosting`, plus a `<script>` and a `<nav>`. Assert that `htmlToText` output contains `"STRUCTURED DATA"` and the JobPosting title, contains the body text, and contains neither the script contents nor the nav text.
- `src/schemas.test.ts`: `JobData.parse({ title: "X", remote: "hybrid-ish", deadline: "31.12.2026" })` yields `remote === "unknown"`, `deadline === null`, `must_haves` deep-equals `[]`, `company === null`. `Profile.parse({})` succeeds with `experience` `[]`.
- `src/web/filter.test.ts`: fixture of 4 jobs. Deadlines are past, future-near, future-far and null.
  - `deadline_asc` order: past, near, far, null.
  - `deadline_desc` order: far, near, past, null.
  - `upcoming` returns near and far. `past` returns past. `none` returns null.
  - `q` matches a term that appears only inside one job's `nice_to_haves`, case-insensitively.

### Step 12: README.md
Short sections: Setup (`bun install`, `cp .env.example .env`, `bun run dev`, open http://localhost:3000), provider examples (OpenAI / OpenRouter / Ollama base URLs), usage (add URLs, "Paste text" for JS-rendered sites such as LinkedIn/Workday, profile import paths, chat), and extending (add a field to `JobData` plus the prompt rule; no migration needed).

## Critical files & anchors
- `src/schemas.ts`: `JobData`, `Profile`. Single source for validation, LLM JSON Schema, external prompt and client types.
- `src/llm.ts`: `extractJson`. Every LLM output crosses this trust boundary; the one repair retry lives here.
- `src/jobs.ts`: `enqueue`/`processJob`. Sequential so it doesn't flood the LLM API; `resumePending` recovers after a restart.
- `src/server.ts`: the Bun HTML-import + Hono mount. `"/api/*"` must sit before `"/*"` in `routes`.
- `src/web/filter.ts`: `applyFilters`. All sort/filter semantics (nulls last).

## Verification
Working dir is `/Users/philhennel/Code/jobs`.
1. Run `bun install && bun test`. All 3 test files pass.
2. Run `bun run typecheck`. 0 errors.
3. `cp .env.example .env` and fill in a real `OPENAI_API_KEY` (or point to Ollama). Start `bun run dev`. The log prints `Jobs UI: http://localhost:3000/`.
4. Live URL: `curl -s https://boards-api.greenhouse.io/v1/boards/gitlab/jobs | bun -e 'const j=await Bun.stdin.json();console.log(j.jobs[0].absolute_url)'`. Then `curl -s -XPOST localhost:3000/api/jobs -H 'content-type: application/json' -d '{"urls":["<that url>","not a url"]}'` returns `{"added":[1],"skipped":["not a url"]}`. Within about 30s, `curl -s localhost:3000/api/jobs` shows job 1 with `status:"parsed"`, a non-empty `title`, a non-empty `must_haves` and `language:"en"`.
5. Error, paste and translation path: POST `{"urls":["https://example.com/"]}` returns id 2. It ends up `status:"error"` with "too little text". Then `curl -XPOST localhost:3000/api/jobs/2/text -H 'content-type: application/json' -d '{"text":"Développeur Backend Senior chez Acme SAS, Lyon. Télétravail 2 jours par semaine. Compétences requises : 5 ans de Python, PostgreSQL. Un plus : Kubernetes. Salaire : 55 000 - 65 000 € par an. Candidatures avant le 15/12/2026."}'`. Afterwards job 2 has `language:"fr"`, `translated:true`, an English title (e.g. "Senior Backend Developer"), `remote:"partly"`, `deadline:"2026-12-15"`, and `salary_min:55000`.
6. Duplicate: re-POST the step 4 URL. It shows up in `skipped` and `added:[]`.
7. Profile:
   - `curl -XPUT localhost:3000/api/profile -H 'content-type: application/json' -d '{"text":"name: Test\nskills: [Python, SQL]"}'` (YAML) returns a profile with `name:"Test"`.
   - `-d '{"text":"{\"skills\": 5}"}'` returns 400 with an error mentioning `skills`.
   - `curl -F text='Jane Doe, Software Engineer at Foo GmbH 2020-2024, MSc CS TU Munich 2019' localhost:3000/api/profile/cv` returns JSON with `experience[0].company` "Foo GmbH".
   - `curl localhost:3000/api/profile/prompt` prints text containing `"experience"`.
8. Chat: `curl -XPOST localhost:3000/api/chat -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"Which job fits me best?"}]}'`. The reply references `#1` or `#2`.
9. UI check in browser at http://localhost:3000:
   - Jobs tab lists both jobs. Search "kubernetes" narrows to job 2. Deadline "upcoming" includes job 2. Sort toggles order. The `<details>` cards expand.
   - Profile tab: save round-trips, CV upload fills the editor, copy prompt works.
   - Chat tab: a starter question returns an answer.

## Assumptions & contingencies
- Translation target is English (only when the source is neither German nor English). Change the one rule in `JOB_SYSTEM` if you want German.
- No auth. The app is bound to localhost for personal use; don't expose it publicly. A real `Bun.serve` exposes all interfaces by default, so pass `hostname: "127.0.0.1"` in `src/server.ts` (implementer: include this).
- The original raw page text is stored, not shown. Translated fields replace the original text in `data`.
- Out of scope now (easy later): application status/notes per job, manual field editing, chat history persistence, streaming chat, agent tool-calling, headless-browser fetching.
