# Jobs Capture (Safari)

Toolbar button that sends the current tab's rendered text to the local Jobs server (`POST /api/jobs/content`). Only page content is sent, never the URL, so the server does not scrape sites that forbid headless or server-side access.

## Build the Safari app (needs full Xcode)

```sh
xcrun safari-web-extension-converter safari-extension/Extension --app-name "Jobs Capture" --bundle-identifier local.jobs.capture --project-location safari-extension/build
```

Open the generated project in Xcode, run the app once, then enable the extension in Safari > Settings > Extensions. Grant it access to the sites you use.

## Configure

Toolbar button > extension options: set Jobs server URL (default `http://127.0.0.1:3000`).

## Server

Start the Jobs server with `bun run dev` from repo root. Content from the extension is stored as a job keyed by content hash; the parser reads the stored text instead of fetching.
