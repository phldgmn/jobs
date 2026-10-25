# Jobs Capture (Safari)

Toolbar button sends current tab's rendered text to local Jobs server (`POST /api/jobs/content`). Only page content sent, never URL, so server does not scrape sites that forbid headless or server-side access. Exception: PDF tabs (URL ends `.pdf` or document is `application/pdf`) send only the URL to `POST /api/jobs/pdf`; the server downloads and extracts the PDF text itself.

## Build the Safari app (needs full Xcode)

```sh
xcrun safari-web-extension-converter safari-extension/Extension --app-name "Jobs Capture" --bundle-identifier local.jobs.capture --project-location safari-extension/build
```

Open the generated project in Xcode, run the app once, then enable the extension in Safari > Settings > Extensions. Grant it access to the sites you use.

## Configure

Toolbar button > extension options: set Jobs server URL (default `http://127.0.0.1:3000`).

## Server

Start the Jobs server with `bun run dev` from repo root. Content from the extension is stored as a job keyed by content hash; the parser reads the stored text instead of fetching.
