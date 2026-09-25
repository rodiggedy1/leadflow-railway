import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Command Chat rich email body preservation", () => {
  it("uses the same safe Gmail HTML rendering contract as the active Email workspace", () => {
    const commandChat = read("client/src/pages/CommandChatExactLive.tsx");
    const emailInbox = read("client/src/pages/EmailsExactLive.tsx");
    const styles = read("client/src/pages/command-chat-exact-live.css");

    const sanitizer = 'DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } })';
    expect(emailInbox).toContain(sanitizer);
    expect(commandChat).toContain(sanitizer);
    expect(commandChat).toContain('dangerouslySetInnerHTML={{ __html: sanitizedHtml }}');
    expect(styles).toContain('.ccc-live-email-html-body img{max-width:100%;height:auto}');
    expect(styles).toContain('.ccc-live-email-html-body table{max-width:100%;border-collapse:collapse}');
  });

  it("captures Gmail HTML with the existing worker and returns it only from the read-only stored-detail fallback", () => {
    const worker = read("server/gmailGlanceWorker.ts");
    const router = read("server/gmailRouter.ts");
    const cache = read("server/gmailMessageHtmlCache.ts");
    const migration = read("server/versioned-migrations/0043_create_gmail_message_html_cache.sql");
    const manifest = read("server/versioned-migrations/manifest.json");

    expect(worker).toContain('const bodyHtml = findHtmlBody(message.payload);');
    expect(worker).toContain('await db.insert(gmailMessageHtmlCache).values(htmlMessages).onDuplicateKeyUpdate');
    expect(worker).toContain('const htmlBackfillRows = await db');
    expect(worker).toContain('.from(madisonEmailDrafts)');
    expect(worker).toContain('.leftJoin(gmailMessageHtmlCache, eq(gmailMessageHtmlCache.messageId, madisonEmailDrafts.inboundMessageId))');
    expect(worker).toContain('enqueueThread(row.threadId, "backfill")');
    expect(router).toContain('from(gmailMessageHtmlCache)');
    expect(router).toContain('bodyHtml: cachedMessage?.bodyHtml ?? null');
    expect(cache).toContain('mediumtext("bodyHtml").notNull()');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS `gmail_message_html_cache`');
    expect(manifest).toContain('"id": "0043_create_gmail_message_html_cache"');
  });
});
