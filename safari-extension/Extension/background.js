const DEFAULT_ENDPOINT = "http://127.0.0.1:3000";

// Runs in the page: rendered text plus JSON-LD, same shape the server's htmlToText produces.
function capturePage() {
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map(s => s.textContent ?? "")
    .join("\n");
  const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
  return (jsonLd ? "STRUCTURED DATA (JSON-LD):\n" + jsonLd + "\n\n" : "") + "PAGE TEXT:\n" + text;
}

async function alertTab(tabId, message) {
  await browser.scripting.executeScript({
    target: { tabId },
    func: msg => alert(msg),
    args: [message],
  });
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

  const [{ result: page } = {}] = await browser.scripting.executeScript({
    target: { tabId: tab.id },
    func: capturePage,
  });
  if (!page || page.slice(page.indexOf("PAGE TEXT:") + "PAGE TEXT:".length).trim() === "") {
    throw new Error("No readable text on this page.");
  }

  const { endpoint = DEFAULT_ENDPOINT } = await browser.storage.local.get("endpoint");
  let res;
  try {
    res = await fetch(`${endpoint}/api/jobs/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.href, text: page }),
    });
  } catch {
    throw new Error(
      `Cannot reach the Jobs server at ${endpoint}. Make sure it is running (bun run dev) and the server URL in the extension options is correct.`,
    );
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The server returned HTTP ${res.status}.`);
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
