const DEFAULT_ENDPOINT = "http://127.0.0.1:48173";

// Runs in every frame: rendered text plus JSON-LD, combined in sendPage.
function capturePage() {
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map(s => s.textContent ?? "")
    .join("\n");
  const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
  return { jsonLd, text, url: location.href };
}

async function alertTab(tabId, message) {
  await browser.scripting.executeScript({
    target: { tabId },
    func: msg => alert(msg),
    args: [message],
  });
}

// Safari's PDF viewer exposes no page text, so PDFs are detected by URL or document type.
async function isPdfTab(tab, url) {
  if (url.pathname.toLowerCase().endsWith(".pdf")) return true;
  const [{ result } = {}] = await browser.scripting
    .executeScript({ target: { tabId: tab.id }, func: () => document.contentType })
    .catch(() => []);
  return result === "application/pdf";
}

async function postToServer(endpoint, path, payload) {
  let res;
  try {
    res = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(
      `Cannot reach the Jobs server at ${endpoint}. Make sure it is running (bun run dev) and the server URL in the extension options is correct.`,
    );
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The server returned HTTP ${res.status}.`);
}
// Throws with a user-facing message on any failure. Returns silently on success.
async function sendPage(tab) {
  // URL is the dedup key and the "Original" link on the server, so it must be a real web page.
  let url;
  try {
    url = new URL(tab.url ?? "");
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("This page has no http(s) address to save.");
  }

  const { endpoint = DEFAULT_ENDPOINT } = await browser.storage.local.get("endpoint");

  if (await isPdfTab(tab, url)) {
    // Only the URL leaves the browser; the server downloads and extracts the PDF itself.
    await postToServer(endpoint, "/api/jobs/pdf", { url: url.href });
    return;
  }

  // allFrames: iframes often hold the actual content (job boards, embedded postings).
  const results = await browser.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: capturePage,
  });
  const frames = results
    .filter(r => r.result)
    .map(r => ({ frameId: r.frameId, ...r.result }))
    .sort((a, b) => a.frameId - b.frameId); // top frame (frameId 0) first

  const jsonLd = frames.map(f => f.jsonLd).filter(Boolean).join("\n");
  const text = frames
    .filter(f => f.text)
    .map(f => (f.frameId === 0 ? f.text : `FRAME (${f.url}):\n${f.text}`))
    .join("\n\n");
  if (text === "") {
    throw new Error("No readable text on this page.");
  }
  const page = (jsonLd ? "STRUCTURED DATA (JSON-LD):\n" + jsonLd + "\n\n" : "") + "PAGE TEXT:\n" + text;

  await postToServer(endpoint, "/api/jobs/content", { url: url.href, text: page });
}

browser.action.onClicked.addListener(async tab => {
  try {
    await sendPage(tab);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await alertTab(tab.id, `Jobs Capture could not add this page.\n\n${message}`).catch(() =>
      console.error("Jobs Capture:", message),
    );
  }
});
