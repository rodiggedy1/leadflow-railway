import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Email body rendering contracts", () => {
  it("uses the CsInbox2 body-rendering path in the live Emails UI", () => {
    const emailInbox = read("client/src/components/CsInbox2EmailWorkspace.tsx");
    const csInbox = read("client/src/components/CsInbox2.tsx");
    expect(emailInbox).toContain('import DOMPurify from "dompurify";');
    expect(emailInbox).toContain('DOMPurify.sanitize(msg.bodyHtml, { USE_PROFILES: { html: true } })');
    expect(emailInbox).toContain('msg.bodyText || msg.snippet || "(no content)"');
    expect(emailInbox).not.toContain('getEmailBodyContent(message)');
    expect(csInbox).toContain('DOMPurify.sanitize(msg.bodyHtml, { USE_PROFILES: { html: true } })');
  });

  it("retains the existing read-only Gmail HTML cache and fallback contracts", () => {
    const worker = read("server/gmailGlanceWorker.ts");
    const router = read("server/gmailRouter.ts");
    const cache = read("server/gmailMessageHtmlCache.ts");
    const migration = read("server/versioned-migrations/0043_create_gmail_message_html_cache.sql");
    expect(worker).toContain('const bodyHtml = findHtmlBody(message.payload);');
    expect(worker).toContain('await db.insert(gmailMessageHtmlCache).values(htmlMessages).onDuplicateKeyUpdate');
    expect(router).toContain('from(gmailMessageHtmlCache)');
    expect(router).toContain('bodyHtml: cachedMessage?.bodyHtml ?? null');
    expect(cache).toContain('mediumtext("bodyHtml").notNull()');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS `gmail_message_html_cache`');
  });
});
