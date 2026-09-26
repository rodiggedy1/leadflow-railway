import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Emails exact-live workspace", () => {
  it("keeps the approved review shell and substitutes only the CsInbox2 central email treatment", () => {
    const page = read("client/src/pages/EmailsExactLive.tsx");
    const styles = read("client/src/pages/emails-exact-live.css");
    expect(page).toContain('import "./emails-review.css"');
    expect(page).toContain('import "./emails-detail-review.css"');
    expect(page).toContain('className={`emails-review emails-live ${selectedThreadId ? "has-detail" : ""}${detailOnly ? " is-detail-only" : ""}`}');
    expect(page).toContain('className="email-detail-workspace emails-live-detail-workspace"');
    expect(page).toContain('className="email-detail-main em2-main emails-csinbox2-detail-main"');
    expect(page).toContain('className="em2-html-email-body"');
    expect(styles).toContain('.emails-live .em2-main{');
  });

  it("uses the same direct Gmail detail source as CsInbox2 while preserving draft, send, and resolution contracts", () => {
    const page = read("client/src/pages/EmailsExactLive.tsx");
    expect(page).toContain("trpc.opsChat.listEmailInboxThreads.useQuery");
    expect(page).toContain("trpc.gmail.getThread.useQuery");
    expect(page).toContain("const emailThread = trpc.gmail.getThread.useQuery(");
    expect(page).toContain("{ threadId: selectedThreadId! },");
    expect(page).toContain("enabled: !!selectedThreadId");
    expect(page).toContain("const detail = emailThread.data as LiveEmailDetail | undefined;");
    expect(page).not.toContain("trpc.gmail.getStoredThread.useQuery");
    expect(page).not.toContain("storedEmailThread");
    expect(page).toContain("trpc.opsChat.getEmailDraftByThreadId.useQuery");
    expect(page).toContain("trpc.gmail.sendReply.useMutation");
    expect(page).toContain("trpc.gmail.completeThread.useMutation");
    expect(page).toContain("trpc.opsChat.dismissEmailDraft.useMutation");
    expect(page).toContain('threadId: selectedThreadId, to: identity.email, subject, bodyHtml: emailReply.split');
    expect(page).toContain('dismissedBy: "agent"');
  });

  it("uses CsInbox2 body rendering in this UI while retaining the dedicated route", () => {
    const page = read("client/src/pages/EmailsExactLive.tsx");
    const app = read("client/src/App.tsx");
    expect(page).toContain('import DOMPurify from "dompurify";');
    expect(page).toContain('DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } })');
    expect(page).toContain('message.bodyText || message.snippet || "(no content)"');
    expect(page).not.toContain('getEmailBodyContent(message)');
    expect(app).toContain('<Route path={"/admin/emails"} component={AdminEmailsExactLiveRoute} />');
  });
});
