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

  it("uses one full-thread scrollbar and a flat stream with full Email bodies", () => {
    const page = read("client/src/pages/EmailsExactLive.tsx");
    const styles = read("client/src/pages/emails-exact-live.css");

    expect(styles).toContain(".emails-live.has-detail .email-detail-workspace {");
    expect(styles).toContain("grid-template-rows: minmax(0, 1fr);");
    expect(styles).toContain(".emails-live.has-detail .email-detail-main {");
    expect(styles).toContain(".emails-live.has-detail .email-detail-thread {");
    expect(styles).toContain(".emails-live.has-detail .email-detail-thread {\n  min-height: 0;\n  overflow: hidden;\n}");
    expect(styles).toContain("/* One full-thread scrollbar; every received or sent card expands to its complete email body. */");
    expect(styles).toContain(".emails-live.has-detail .email-detail-thread{overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-color:#45454b #18181a;scrollbar-width:thin}");
    expect(styles).toContain(".emails-live.has-detail .email-detail-thread::-webkit-scrollbar{display:block;width:9px}");
    expect(styles).toContain(".emails-live.has-detail .emails-live-message-html{max-block-size:none;overflow:visible;overscroll-behavior:auto;scrollbar-gutter:auto}");
    expect(styles).toContain("/* Flat message stream: no rounded cards, only compact received/sent separators. */");
    expect(styles).toContain(".emails-live.has-detail .email-detail-thread article{margin:0!important;padding:0 0 22px;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;overflow:visible}");
    expect(page).toContain(' : <div className="emails-live-message-html">{message.bodyText || message.snippet || "(no content)"}</div>}');
  });

  it("uses compact received and sent separators only on the new Email page", () => {
    const page = read("client/src/pages/EmailsExactLive.tsx");
    const styles = read("client/src/pages/emails-exact-live.css");

    expect(page).toContain('className={`emails-live-message-direction${outgoing ? " is-sent" : " is-received"}`}');
    expect(page).toContain('outgoing ? "↗ Sent" : "✉ Received"');
    expect(page).toContain('className="emails-live-message-heading"');
    expect(styles).toContain("/* Standalone /admin/emails uses the same directional body treatment as Command Chat. */");
    expect(styles).toContain(".emails-live.has-detail .emails-live-message-direction::after");
    expect(styles).toContain(".emails-live.has-detail .emails-live-message-direction.is-sent span");
    expect(styles).not.toContain("CsInbox2");
  });

  it("keeps the composer compact by collapsing Madison's draft into an editable preview", () => {
    const page = read("client/src/pages/EmailsExactLive.tsx");
    const styles = read("client/src/pages/emails-exact-live.css");

    expect(page).toContain('onClick={onInsertDraft}>Edit draft</button>');
    expect(page).toContain('className="emails-live-draft-summary"');
    expect(page).toContain('className="emails-live-draft-preview"');
    expect(styles).toContain(".emails-live.has-detail .email-detail-composer {");
    expect(styles).toContain("flex: 0 0 auto;");
    expect(styles).toContain(".emails-live.has-detail .emails-live-draft-preview {");
    expect(styles).toContain("-webkit-line-clamp: 2;");
  });

  it("uses the dedicated live route inside the original shared review navigation", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('const EmailsExactLive = lazy(() => import("./pages/EmailsExactLive"));');
    expect(app).toContain('function AdminEmailsExactLiveRoute()');
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/emails"><EmailsExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/emails"} component={AdminEmailsExactLiveRoute} />');
    expect(app).toContain('location === "/admin/sms" || location === "/admin/emails"');
    expect(app).toContain('import ReviewWorkspaceNav from "./components/ReviewWorkspaceNav";');
  });
});
