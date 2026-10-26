# Jobs

Personal job tracker. Paste job URLs; an OpenAI-compatible LLM extracts structured fields. Filter, sort and search the list, manage your profile, and chat with an advisor about your matches.

## Setup

```sh
bun install
cp .env.example .env   # fill in OPENAI_API_KEY
bun run dev
```

Open http://localhost:3000. The server binds 127.0.0.1 only; there is no auth, so do not expose it publicly.

## Providers

Set `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `LLM_MODEL`:
Optional: `LLM_REASONING_EFFORT` (e.g. `none`, `low`, `medium`, `high`) sets reasoning effort for every call; empty uses the provider default. The header "Reasoning effort" control overrides it at runtime. Accepted values depend on the model; unsupported ones fail with the provider's error.

- OpenAI: `https://api.openai.com/v1`
- OpenRouter: `https://openrouter.ai/api/v1`
- Ollama: `http://localhost:11434/v1` (key can be left unset)
- LM Studio: `http://localhost:1234/v1`

## Usage

- **Jobs**: paste URLs, one per line. Pages are fetched and parsed in the background. For JS-rendered sites (LinkedIn, Workday, ...) fetch fails; use "Paste text" on the failed row.
- **Profile**: edit JSON or YAML directly. Import a CV (PDF/TXT/MD) for an LLM draft profile, review it, then Save. "Copy prompt external agent" gives a prompt you can use with another tool to produce a profile.
- **Chat**: ask about fit and deadlines. The answer uses your profile and the open (not expired) jobs.

## Menu bar app

Optional: a minimal menu bar app that runs the server in the background and can start at login.

```sh
make -C menubar install   # builds server binary + Jobs.app, installs to /Applications, launches
```

Menu: **Open Web UI** (opens http://jobs.localhost:48173/), **Start at Login** (toggle), **Quit** (stops the server).

The server binds `127.0.0.1` only, on port 48173 (`SERVER_PORT` in `menubar/Info.plist.in`). The menu uses the `jobs.localhost` name, which resolves to loopback without any configuration. Port 80 is not used because binding it requires root.

The app spawns the compiled server (`bun build --compile`, embedded in the app bundle) with the repo as its working directory, so it finds `.env` and `data/`. Server output goes to `~/Library/Logs/jobs-menubar/server.log`.

The Safari extension ("Jobs Capture", source in `safari-extension/`) is embedded in `Jobs.app` as `PlugIns/PageSender Extension.appex`. `make` builds it with `xcodebuild` and signs it with the Apple Development identity (team `T592P4FM4E`), because Safari only loads team-signed extensions. To enable it, open Safari > Settings > Extensions and tick "Jobs Capture". Its default server URL is `http://127.0.0.1:48173`.

The app icon is generated from `safari-extension/icon.png` and stored as `menubar/AppIcon.icns`. The menu bar icon stays the briefcase SF Symbol.

## Extending

Add a field to `JobData` in `src/schemas.ts` plus a rule in `JOB_SYSTEM` (`src/prompts.ts`). No migration needed: parsed data is stored as JSON.
