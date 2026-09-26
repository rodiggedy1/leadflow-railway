import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Emails exact-live workspace", () => {
  it("keeps the existing Emails page structure and substitutes only the shared CsInbox2 direct detail", () => {
    const page = read("client/src/pages/EmailsExactLive.tsx");
    expect(page).toContain('import "./emails-detail-review.css"');
    expect(page).toContain('import "./emails-detail-compact-header.css"');
    expect(page).toContain('import "./emails-detail-simplified.css"');
    expect(page).toContain('function DetailSidebar(');
    expect(page).toContain('function DetailContext(');
    expect(page).toContain('className="email-detail-workspace emails-live-detail-workspace"');
    expect(page).toContain('const directDetail = <CsInboxEmailThreadDetail threadId={selectedId} onClose={onClose} />;');
    expect(page).not.toContain("getStoredThread");
    expect(page).not.toContain("getEmailBodyContent");
  });

  it("keeps the live Email Kanban and its direct Gmail context query", () => {
    const page = read("client/src/pages/EmailsExactLive.tsx");
    expect(page).toContain("trpc.opsChat.listEmailInboxThreads.useQuery");
    expect(page).toContain("trpc.gmail.getThread.useQuery");
    expect(page).toContain('className={`emails-review emails-live ${selectedThreadId ? "has-detail" : ""}${detailOnly ? " is-detail-only" : ""}`}');
    expect(page).toContain('className="emails-board"');
    expect(page).toContain('<EmailCard key={thread.threadId}');
  });

  it("keeps the dedicated live route inside the original shared review navigation", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('const EmailsExactLive = lazy(() => import("./pages/EmailsExactLive"));');
    expect(app).toContain("function AdminEmailsExactLiveRoute()");
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/emails"><EmailsExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/emails"} component={AdminEmailsExactLiveRoute} />');
    expect(app).toContain('location === "/admin/sms" || location === "/admin/emails"');
  });
});
