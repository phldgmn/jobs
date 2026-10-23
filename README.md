# Jobs

Personal job tracker. Paste job URLs; an OpenAI-compatible LLM extracts structured fields. Filter, sort and search the list, manage your profile, and chat with an advisor about your matches.

## Setup

```sh
bun install
cp .env.example .env   # fill in OPENAI_API_KEY
bun run dev
```

Open http://localhost:3000. The server binds to 127.0.0.1 only; there is no auth, so do not expose it publicly.

## Providers

Set `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `LLM_MODEL`:

- OpenAI: `https://api.openai.com/v1`
- OpenRouter: `https://openrouter.ai/api/v1`
- Ollama: `http://localhost:11434/v1` (key can be left unset)
- LM Studio: `http://localhost:1234/v1`

## Usage

- **Jobs**: paste URLs, one per line. Pages are fetched and parsed in the background. For JS-rendered sites (LinkedIn, Workday, ...) the fetch fails; use "Paste text" on the failed row.
- **Profile**: edit JSON or YAML directly. Import a CV (PDF/TXT/MD) to have the LLM draft a profile, review it, then Save. "Copy prompt for external agent" gives a prompt you can use with another tool to produce the profile.
- **Chat**: ask about fit and deadlines. The answer uses your profile and the open (not expired) jobs.

## Extending

Add a field to `JobData` in `src/schemas.ts` plus a rule in `JOB_SYSTEM` (`src/prompts.ts`). No migration needed: parsed data is stored as JSON.
