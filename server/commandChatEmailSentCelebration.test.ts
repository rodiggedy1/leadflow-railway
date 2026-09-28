import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(root, "client/src/pages/CommandChatEmailDetail.tsx"), "utf8");
const styles = readFileSync(resolve(root, "client/src/pages/command-chat-email-detail.css"), "utf8");

describe("Command Chat email sent celebration", () => {
  it("opens the Command Chat-only confirmation after a successful Gmail reply", () => {
    expect(source).toContain('const [sentCelebrationOpen, setSentCelebrationOpen] = useState(false);');
    expect(source).toContain('const [sentRecipient, setSentRecipient] = useState<EmailIdentity | null>(null);');
    expect(source).toContain("function EmailSentCelebration({ recipientName, recipientEmail, onDone, onViewMessage }");
    expect(source).toContain("setEmailReply(\"\");");
    expect(source).toContain("setSentRecipient(identity);");
    expect(source).toContain("setSentCelebrationOpen(true);");
    expect(source).toContain("{detailOnly && sentCelebrationOpen && sentRecipient && <EmailSentCelebration");
    expect(source).toContain("recipientName={sentRecipient.name}");
    expect(source).toContain("recipientEmail={sentRecipient.email}");
    expect(source).toContain("Your reply is on its way.");
    expect(source).toContain(">Done</button>");
    expect(source).toContain(">View message</button>");
  });

  it("keeps the live thread and body-only scroll contract intact when viewing the sent message", () => {
    expect(source).toContain('const scrollOwner = document.querySelector<HTMLElement>(".ccc-live-email-workspace-modal .em2-msg-body-scroll-owner");');
    expect(source).toContain('scrollOwner.scrollTo({ top: scrollOwner.scrollHeight, behavior: "smooth" })');
    expect(source).toContain('void emailThread.refetch().finally(scrollToLatestMessage);');
    expect(source).toContain('em2-msg-body em2-msg-body-scroll-owner');
    expect(source).toContain('popupThreadMessages.map((message, index)');
    expect(source).toContain('utils.opsChat.listEmailInboxThreads.invalidate();');
    expect(source).toContain('utils.gmail.getThread.invalidate({ threadId: selectedThreadId });');
    expect(styles).toContain('/* The thread viewport is intentionally not a scroll owner. */');
    expect(styles).toContain('.ccc-live-email-workspace-modal .em2-thread{display:flex;min-height:0;flex:1 1 auto;flex-direction:column;gap:10px;overflow:hidden;');
    expect(styles).toContain('.ccc-live-email-workspace-modal .em2-msg-body-scroll-owner{overflow-y:auto}');
  });

  it("scopes the celebration to Command Chat rather than the standalone Emails page", () => {
    expect(styles).toContain('.ccc-live-email-workspace-modal .email-sent-celebration{position:absolute;z-index:60;inset:0;');
    expect(styles).toContain('.ccc-live-email-workspace-modal .email-sent-celebration-card{width:min(390px,100%);');
    expect(source).not.toContain("cleaner" + "Jobs");
    expect(source).not.toContain("cleaner" + "_jobs");
    expect(styles).not.toContain("cleaner" + "Jobs");
    expect(styles).not.toContain("cleaner" + "_jobs");
  });
});
