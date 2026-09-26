import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("shared CsInbox2 email detail", () => {
  it("uses the direct Gmail thread treatment without a stored-email fallback", () => {
    const detail = read("client/src/components/CsInboxEmailThreadDetail.tsx");
    const emails = read("client/src/pages/EmailsExactLive.tsx");
    const commandChat = read("client/src/pages/CommandChatExactLive.tsx");
    expect(detail).toContain('trpc.gmail.getThread.useQuery');
    expect(detail).toContain('DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } })');
    expect(detail).not.toContain('getStoredThread');
    expect(emails).toContain('import CsInboxEmailThreadDetail from "@/components/CsInboxEmailThreadDetail";');
    expect(emails).toContain('const directDetail = <CsInboxEmailThreadDetail threadId={selectedId} onClose={onClose} />;');
    expect(commandChat).toContain('import CsInboxEmailThreadDetail from "@/components/CsInboxEmailThreadDetail";');
    expect(commandChat).toContain('<CsInboxEmailThreadDetail threadId={threadId} onClose={onClose} />');
  });

  it("uses the CsInbox2 direct message-body pattern in a dark sidebar-free detail surface", () => {
    const detail = read("client/src/components/CsInboxEmailThreadDetail.tsx");
    const styles = read("client/src/components/cs-inbox-email-thread-detail.css");
    expect(detail).toContain('message.bodyText || message.snippet || "(no content)"');
    expect(detail).toContain('cs-email-detail__html');
    expect(styles).toContain('.cs-email-detail--dark');
    expect(styles).toContain('.cs-email-detail__thread');
    expect(styles).not.toContain('cs-email-detail__sidebar');
  });
});
