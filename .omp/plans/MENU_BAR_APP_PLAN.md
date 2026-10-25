# Jobs Menu Bar App (macOS, personal use)

Minimal NSStatusItem app: lives in the menu bar, starts at login (optional toggle), runs the bundled server (`bun build --compile` output) as a child process, and offers: **Open Web UI**, **Start at Login** (toggle), **Quit**. No distribution, no notarization — build locally with `swiftc` + `bun`, no Xcode project.

Facts driving the design:

- Server entry `src/server.ts` binds `127.0.0.1:3000` (env `PORT`), serves the web UI inlined from `import index from "./web/index.html"`. A `bun build --compile` binary therefore contains everything — no `node_modules`, no `bun` on PATH at runtime.
- `src/db.ts`: `DB_PATH` defaults to `data/jobs.db` **relative to cwd**; Bun auto-loads `.env` from cwd. So the server process must run with `currentDirectoryPath = <repo root>` to find `data/` and `.env` (LLM keys).
- Toolchain: `bun` 1.4.2 (mise), `swiftc` Swift 6.4, macOS 27 → `SMAppService.mainApp` (macOS 13+) is the login-item mechanism. Ad-hoc signing is enough for local use.

## Layout

```
menubar/
  main.swift          # the whole app (~140 lines, single file)
  Info.plist          # template; REPO_PATH injected at build
  Makefile            # server / app / install / run / clean
  dist/Jobs.app       # built bundle (gitignored)
bin/jobs-server       # bun build --compile output (gitignored)
```

App bundle (assembled by Makefile, no Xcode):

```
Jobs.app/
  Contents/
    Info.plist                    # LSUIElement=true, CFBundleIdentifier=eu.dgmn.jobsmenubar, REPO_PATH=<repo root>
    MacOS/jobs-menubar            # swiftc -O output
    Resources/jobs-server         # copy of bin/jobs-server
```

`make install` copies the bundle to `/Applications` and launches from there (login item registers the path the app is running from, so install before first toggle).

## Step 1: Spike — verify compiled server

`bun build --compile src/server.ts --outfile bin/jobs-server`, run it, `curl -s localhost:3000 | head` and hit one API route. Confirm the web UI is embedded (HTML import compiles into the binary). If the HTML import is not embedded, fallback: serve `web/` from disk next to the binary — check before writing Swift.

## Step 2: `menubar/main.swift`

`import AppKit`, `import ServiceManagement`. `NSApplication`, `setActivationPolicy(.accessory)` (menu bar only, no Dock icon).

- **Icon**: `NSImage(systemSymbolName: "briefcase", accessibilityDescription: "Jobs")` — no asset files.
- **Menu** (rebuilt each open so the checkmark stays fresh):
  - `Open Web UI` → poll `127.0.0.1:PORT` connect for up to ~3 s; then `NSWorkspace.shared.open(URL(string: "http://127.0.0.1:PORT")!)`. On timeout: `NSAlert` "server not running". PORT from `Info.plist` `SERVER_PORT` default 3000.
  - `Start at Login` → state from `SMAppService.mainApp.status == .enabled`; click toggles `register()` / `unregister()` (both `try?` with `NSAlert` on failure).
  - `Quit` → terminate server child, `NSApp.terminate(nil)`.
- **Server child process** (`NSApplicationDelegate.applicationDidFinishLaunching`):
  - `Process` with `executableURL = Bundle.main.url(forResource: "jobs-server", withExtension: nil)`.
  - `currentDirectoryPath` = `Bundle.main.infoDictionary?["REPO_PATH"] as! String` (injected at build; finds `.env` + `data/`).
  - `environment`: `HOME`, `PATH=/usr/bin:/bin`, `NODE_ENV=production`, `PORT`.
  - stdout+stderr → file at `~/Library/Logs/jobs-menubar/server.log` (FileManager append, one `FileHandle` on both pipes) — only diagnostics path, keep.
  - No watchdog/auto-restart (out of scope, one line below).
- **Single instance**: before creating the status item, `NSRunningApplication.runningApplications(withBundleIdentifier:).count > 1` → exit.
- `applicationShouldTerminate` → `serverProcess.terminate()`, return `.terminateNow`.

~140 lines total. No SwiftUI, no storyboards, no asset catalog, no package manifest.

## Step 3: `menubar/Info.plist` + `Makefile`

`Info.plist`: `CFBundleIdentifier eu.dgmn.jobsmenubar`, `CFBundleName Jobs`, `CFBundleExecutable jobs-menubar`, `CFBundlePackageType APPL`, `LSUIElement true`, `LSMinimumSystemVersion 13.0`, `REPO_PATH $(PWD)` (Makefile `sed`/`cat` substitution from a `Info.plist.in` if templating is cleaner).

`Makefile` targets (recipe lines, no logic):

- `server`: `bun build --compile src/server.ts --outfile bin/jobs-server`
- `app`: mkdir `dist/Jobs.app/Contents/{MacOS,Resources}`; `swiftc -O menubar/main.swift -o .../MacOS/jobs-menubar`; copy `Info.plist` (with REPO_PATH) + `bin/jobs-server` → Resources; `codesign --force --sign - .../Jobs.app` (ad-hoc)
- `install`: `rm -rf /Applications/Jobs.app && cp -R dist/Jobs.app /Applications/ && open /Applications/Jobs.app`
- `clean`: remove `dist/`, `bin/jobs-server`

`.gitignore`: add `menubar/dist`, `bin/`.

## Step 4: Verify

1. `make app && open menubar/dist/Jobs.app` → menu bar icon appears, Dock icon absent.
2. Click → 3 items. "Start at Login" registers (verify: System Settings → General → Login Items shows Jobs, and `SMAppService` checkmark persists across relaunch).
3. "Open Web UI" → default browser opens `http://127.0.0.1:3000`, UI loads.
4. `ps aux | grep jobs-server` → child running; `lsof -ti :3000` owned by it.
5. Quit from menu → child dies (port 3000 free).
6. Toggle login on, `pkill` the app, re-launch → same behavior. (Full reboot untested; SMAppService registration is the standard mechanism.)

## Risks / fallbacks

- **Ad-hoc signed app + `SMAppService`**: generally works on modern macOS; if `register()` throws, fallback is writing a user LaunchAgent (`~/Library/LaunchAgents/eu.dgmn.jobsmenubar.plist`, `Program = /usr/bin/open -a .../Jobs.app`) managed with `launchctl bootstrap/bootout gui/$(id -u)` — same menu item, ~15 lines swap.
- **Port 3000 already in use** (e.g. `bun run dev` running): server child exits on bind error; the "Open Web UI" timeout + log file make this diagnosable. No auto-pick-port (not asked).
- **`bun build --compile` not embedding the HTML import**: verified in Step 1 spike; fallback is disk-served `web/` (plan Step 1).

## Out of scope (named, not built)

Server watchdog/auto-restart, tray icon server-state indicator, server port configuration UI, app auto-update, notarization/signing for distribution.
