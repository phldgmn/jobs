import { parseHTML } from "linkedom";

const isJobPosting = (o: unknown): boolean => {
  if (typeof o !== "object" || o === null || !("@type" in o)) return false;
  const t = o["@type"];
  return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
};

function flattenJsonLd(value: unknown, out: unknown[]) {
  if (Array.isArray(value)) {
    for (const v of value) flattenJsonLd(v, out);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if ("@graph" in value) flattenJsonLd(value["@graph"], out);
  if (isJobPosting(value)) out.push(value);
}

export function htmlToText(html: string): string {
  const { document } = parseHTML(html);

  const jsonLd: unknown[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      flattenJsonLd(JSON.parse(script.textContent ?? ""), jsonLd);
    } catch {
      // ignore malformed JSON-LD
    }
  }

  for (const el of Array.from(
    document.querySelectorAll("script, style, noscript, svg, nav, footer, header, form, iframe"),
  )) {
    el.remove();
  }

  const text = (document.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  return (
    (jsonLd.length ? "STRUCTURED DATA (JSON-LD):\n" + JSON.stringify(jsonLd) + "\n\n" : "") +
    "PAGE TEXT:\n" +
    text
  );
}

export async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      "Accept-Language": "en,de;q=0.8",
    },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching page`);

  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  const text = contentType.includes("html") ? htmlToText(raw) : raw;

  const pageText = text.slice(text.indexOf("PAGE TEXT:") + "PAGE TEXT:".length).trim();
  const hasJsonLd = text.startsWith("STRUCTURED DATA");
  if (!hasJsonLd && pageText.length < 300) {
    throw new Error(
      "Page returned too little text (likely JS-rendered or blocked). Use 'Paste text' instead.",
    );
  }

  // shortcut: no headless browser; JS-rendered pages need pasted text. Add Playwright if this becomes common.
  return text.slice(0, 60_000);
}
