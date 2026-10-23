import { describe, expect, test } from "bun:test";
import { htmlToText } from "./fetchPage";

const html = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"WebPage","name":"ignored"},
  {"@type":"JobPosting","title":"Backend Engineer Fixture"}
]}
</script>
</head><body>
<nav>NAVTEXT links</nav>
<script>var secret = 1;</script>
<main><p>Body   content
here about the role.</p></main>
</body></html>`;

describe("htmlToText", () => {
  const out = htmlToText(html);

  test("includes JSON-LD JobPosting from @graph", () => {
    expect(out).toContain("STRUCTURED DATA");
    expect(out).toContain("Backend Engineer Fixture");
  });

  test("keeps collapsed body text", () => {
    expect(out).toContain("Body content here about the role.");
  });

  test("drops script and nav content from page text", () => {
    expect(out).not.toContain("var secret");
    expect(out).not.toContain("NAVTEXT");
  });
});
