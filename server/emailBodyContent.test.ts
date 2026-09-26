import { describe, expect, it } from "vitest";
import { getEmailBodyContent } from "../client/src/lib/emailBodyContent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("shared email body content", () => {
  it("removes a legacy CSS tail from plaintext instead of displaying it", () => {
    const content = getEmailBodyContent({
      bodyText: "Work order update body { width:100%; margin:0; padding:0; font-family:Arial; background-color:#fff; } #kmail { width:585px; }",
    });
    expect(content).toEqual({ html: null, text: "Work order update" });
  });

  it("keeps ordinary plaintext intact", () => {
    const content = getEmailBodyContent({ bodyText: "Hello, your booking is confirmed." });
    expect(content).toEqual({ html: null, text: "Hello, your booking is confirmed." });
  });

  it("uses one shared sanitizer for live and legacy Email workspaces", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/lib/emailBodyContent.ts"), "utf8");
    expect(source).toContain('DOMPurify.sanitize(htmlSource, EMAIL_HTML_PROFILE)');
    expect(source).toContain('ADD_FORBID_CONTENTS: ["style", "head", "title", "script", "noscript"]');
  });
});
