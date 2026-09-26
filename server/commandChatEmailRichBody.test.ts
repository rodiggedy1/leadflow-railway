import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Command Chat rich email body preservation", () => {
  it("uses one shared safe body-content contract in both Email workspaces", () => {
    const emailInbox = read("client/src/pages/EmailsExactLive.tsx");
    const legacyInbox = read("client/src/pages/EmailInbox.tsx");
    const bodyContent = read("client/src/lib/emailBodyContent.ts");

    expect(emailInbox).toContain('import { getEmailBodyContent } from "@/lib/emailBodyContent";');
    expect(legacyInbox).toContain('import { getEmailBodyContent } from "@/lib/emailBodyContent";');
    expect(emailInbox).toContain('const body = getEmailBodyContent(message);');
    expect(legacyInbox).toContain('const body = getEmailBodyContent(msg);');
    expect(emailInbox).toContain('dangerouslySetInnerHTML={{ __html: body.html }}');
    expect(legacyInbox).toContain('dangerouslySetInnerHTML={{ __html: body.html }}');
    expect(bodyContent).toContain('ADD_FORBID_CONTENTS: ["style", "head", "title", "script", "noscript"]');
    expect(bodyContent).toContain('const htmlSource = hasHtmlMarkup(cachedHtml)');
    expect(bodyContent).toContain('text: removeLegacyCssTail(savedText || cachedHtml || snippet?.trim() || "(no content)")');
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
