import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Emails exact-live workspace", () => {
  it("copies the approved review styling layers into the live adapter", () => {
    const page = read("client/src/pages/EmailsExactLive.tsx");

    expect(page).toContain('import "./emails-review.css"');
    expect(page).toContain('import "./emails-detail-review.css"');
    expect(page).toContain('import "./emails-detail-compact-header.css"');
    expect(page).toContain('import "./emails-detail-simplified.css"');
    expect(page).toContain('import "./emails-detail-leads-cohesion.css"');
    expect(page).toContain('import "./emails-kanban-cohesion.css"');
    expect(page).toContain('className={`emails-review emails-live ${selectedThreadId ? "has-detail" : ""}`}');
    expect(page).toContain('className="email-detail-workspace emails-live-detail-workspace"');
  });

  it("preserves the current Email Kanban data, thread, reply, draft, and resolution contracts", () => {
    const page = read("client/src/pages/EmailsExactLive.tsx");

    expect(page).toContain("trpc.opsChat.listEmailInboxThreads.useQuery");
    expect(page).toContain("trpc.gmail.getThread.useQuery");
    expect(page).toContain("trpc.opsChat.getEmailDraftByThreadId.useQuery");
    expect(page).toContain("trpc.gmail.sendReply.useMutation");
    expect(page).toContain("trpc.gmail.completeThread.useMutation");
    expect(page).toContain("trpc.opsChat.dismissEmailDraft.useMutation");
    expect(page).toContain("threadId: selectedThreadId, to: identity.email, subject, bodyHtml: emailReply.split");
    expect(page).toContain('dismissedBy: "agent"');
  });

  it("retains dark internal scrolling and customer portrait treatment without the legacy inbox shell", () => {
    const page = read("client/src/pages/EmailsExactLive.tsx");
    const styles = read("client/src/pages/emails-exact-live.css");

    expect(page).toContain("customerPortraitFor");
    expect(page).toContain("emails-live-agent-circle");
    expect(page).not.toContain('lazy(() => import("./pages/EmailInbox"))');
    expect(styles).toContain(".emails-live ::-webkit-scrollbar");
    expect(styles).toContain(".emails-live .email-detail-list,");
  });
});
