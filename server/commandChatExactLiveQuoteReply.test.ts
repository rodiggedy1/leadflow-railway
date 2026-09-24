import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/CommandChatExactLive.tsx"),
  "utf8",
);
const styleSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/command-chat-exact-live.css"),
  "utf8",
);

describe("CommandChatExactLive quoted replies", () => {
  it("keeps direct reply distinct from the existing thread action", () => {
    expect(pageSource).toContain("type QuoteReplyTarget");
    expect(pageSource).toContain("const startQuotedReply");
    expect(pageSource).toContain("onReply={startQuotedReply}");
    expect(pageSource).toContain('className="ccc-live-quote-reply-action"');
    expect(pageSource).toContain("onThread={() => onOpenThread(entry.message.id)}");
  });

  it("pre-fills the quoted sender as a mention and exposes a cancellable preview", () => {
    expect(pageSource).toContain("const prefix = `@${replyTarget.author} `;");
    expect(pageSource).toContain('className="ccc-live-reply-preview"');
    expect(pageSource).toContain("Replying to @{replyTarget.author}");
    expect(pageSource).toContain("onClick={cancelReply}");
    expect(styleSource).toContain(".ccc-live .ccc-live-reply-preview");
  });

  it("sends and optimistically renders the existing quote fields", () => {
    expect(pageSource).toContain("const sentReplyTarget = replyTarget;");
    expect(pageSource).toContain("replyToId: sentReplyTarget?.id ?? null");
    expect(pageSource).toContain("replyToBody: sentReplyTarget?.body ?? null");
    expect(pageSource).toContain("replyToAuthor: sentReplyTarget?.author ?? null");
    expect(pageSource).toContain("replyToId: sentReplyTarget?.id,");
    expect(pageSource).toContain("replyToBody: sentReplyTarget?.body.slice(0, 512),");
    expect(pageSource).toContain("replyToAuthor: sentReplyTarget?.author,");
  });

  it("renders the persisted quote below the reply response and any attachments", () => {
    const responseBubble = '<p>{renderMessageBody(message.body, mentionPattern)}</p>';
    const quoteReference = 'className="ccc-live-quoted-reply"';
    const messageTools = 'className="ccc-live-message-tools"';
    expect(pageSource.indexOf(responseBubble)).toBeGreaterThan(-1);
    expect(pageSource.indexOf(quoteReference)).toBeGreaterThan(pageSource.indexOf(responseBubble));
    expect(pageSource.indexOf(messageTools)).toBeGreaterThan(pageSource.indexOf(quoteReference));
  });
});
