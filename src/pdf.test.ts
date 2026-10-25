import { describe, expect, test } from "bun:test";
import { pdfToText } from "./fetchPage";

describe("pdfToText", () => {
  test("rejects bodies without the %PDF- magic bytes", async () => {
    await expect(pdfToText(new TextEncoder().encode("<html>nope</html>"))).rejects.toThrow(
      "Downloaded file is not a PDF.",
    );
  });
});
