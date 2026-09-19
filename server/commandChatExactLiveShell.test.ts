import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Command Chat exact live shell", () => {
  it("keeps the approved review composition while binding only existing Command Chat data and actions", () => {
    const page = read("client/src/pages/CommandChatExactLive.tsx");
    const styles = read("client/src/pages/command-chat-exact-live.css");
    const app = read("client/src/App.tsx");

    for (const stylesheet of [
      "command-chat-crm-review.css",
      "command-chat-left-cohesion.css",
      "command-chat-conversation-list.css",
      "command-chat-group-conversation.css",
      "command-chat-reference-composition.css",
      "command-chat-header-composition.css",
      "command-chat-exact-live.css",
    ]) {
      expect(page).toContain(`"./${stylesheet}"`);
    }

    for (const marker of [
      'className="ccc-workspace"',
      'className="ccc-command-grid"',
      'className="ccc-command-panel ccc-left-panel"',
      'className="ccc-command-panel ccc-center-panel"',
      'ccc-command-panel ccc-right-panel ${threadId !== null ? "ccc-right-panel-thread-open" : ""}',
      'className="ccc-message-stream"',
      'className="ccc-composer"',
      'className="ccc-live-thread-panel"',
    ]) {
      expect(page).toContain(marker);
    }

    for (const procedure of [
      "listChannelMessages.useQuery",
      "sendMessage.useMutation",
      "getAllAgentPhotoMap.useQuery",
      "getAgentStatusList.useQuery",
      "listActiveThreads.useQuery",
      "getThreadReplies.useQuery",
      "toggleReaction.useMutation",
      "getReactions.useMutation",
      "uploadOpsPhoto.useMutation",
      "transcribeVoiceNote.useMutation",
      "createIssue.useMutation",
      "setReminder.useMutation",
      "pinNote.useMutation",
      "announceBooking.useMutation",
      "listCsInbox.useQuery",
      "getCsConversation.useQuery",
      "leads.sendMessage.useMutation",
    ]) {
      expect(page).toContain(procedure);
    }

    expect(page).toContain('useOpsStream({');
    expect(page).toContain('fetch("/api/agents/login"');
    expect(page).toContain('mediaUrl: attachmentUrls.length ? JSON.stringify(attachmentUrls) : undefined');
    expect(page).toContain('"madison_sms_draft",');
    expect(page).toContain('"madison_email_draft",');
    expect(page).toContain('"madison_call_summary",');
    expect(page).toContain('"madison_auto_sent",');
    expect(page).toContain('function isHiddenCommandNotification(message: ChannelMessage)');
    expect(page).toContain('if (message.quickAction === "sync_watchdog") return true;');
    expect(page).toContain('if (message.role === "system" && /\\bSync Alert\\b/i.test(message.body)) return true;');
    expect(page).toContain('message.quickAction === "unanswered_alarm" && /new .*lead/i.test(message.body)');
    expect(page).toContain('const visibleRootMessages = useMemo(');
    expect(page).toContain('function confirmationReplyFromMessage(message: ChannelMessage): ConfirmationReplyAlert | null');
    expect(page).toContain('function ConfirmationReplyCard({ alert, timestamp }');
    expect(page).toContain('href="/admin/confirmation-calls"');
    expect(page).toContain('function leadFromCommandMessage(message: ChannelMessage): CommandLead | null');
    expect(page).toContain('function customerPortraitFor(value: string)');
    expect(page).toContain('className="ccc-live-lead-primary"');
    expect(page).toContain('className="ccc-live-lead-primary-copy"');
    expect(page).toContain('const webAndQuoteLeads = useMemo(');
    expect(page).toContain('const incomingLeads = useMemo(');
    expect(page).toContain('<LeadQueue title="Web & Quote Form" description="Direct form submissions" leads={webAndQuoteLeads} />');
    expect(page).toContain('<LeadQueue title="Other Incoming Leads" description="Marketplace and partner inquiries" leads={incomingLeads} />');
    expect(page).toContain('agents.agents.slice(0, 5)');
    expect(page).toContain('type LeftRailMode = "sms" | "issues" | "threads";');
    expect(page).toContain('const [leftRailMode, setLeftRailMode] = useState<LeftRailMode>("sms");');
    expect(page).toContain('className="ccc-left-section ccc-conversations-section ccc-live-left-rail"');
    expect(page).toContain('className="ccc-panel-tabs ccc-live-left-rail-tabs"');
    expect(page).toContain('setLeftRailMode("sms")');
    expect(page).toContain('setLeftRailMode("issues")');
    expect(page).toContain('setLeftRailMode("threads")');
    expect(page).toContain('<LeftRailIssues issues={openIssues} />');
    expect(page).toContain('<LeftRailThreads threads={activeThreads} onOpen={(id) => { setThreadDraft(""); setThreadId(id); }} />');
    expect(page).toContain('function SmsInboxRow({ conversation, onOpen }');
    expect(page).toContain('function SmsConversationDrawer({ conversation, conversations, onClose }');
    expect(page).toContain('getCsInboxReplyPhoneNumberIdForSelectedConversation(conversation, conversations)');
    expect(page).toContain('function LeftRailThreads({ threads, onOpen }');
    expect(page).toContain('function ThreadPanel({ thread, callerName, draft, pending, photoMap, onDraft, onSend, onClose }');
    expect(page).toContain('threadId !== null ? <ThreadPanel');
    expect(page).toContain('ccc-right-panel-thread-open');
    expect(page).toContain('aria-label="Close command thread"');
    expect(page).not.toContain('COMMAND CHANNELS');
    expect(page).not.toContain('ccc-reference-chat-tabs');
    expect(page).not.toContain('ccc-live-threads-view');
    expect(page).not.toContain('<div className="ccc-live-thread-backdrop"');
    expect(page).not.toContain('ThreadDrawer');
    expect(page).not.toContain('role="dialog"');
    expect(page).not.toContain('<Activity /><b>{metrics.activity}</b> Today');
    expect(page).not.toContain('aria-label="View channel threads" onClick={() => setThreadId(activeThreads[0]?.parentId ?? null)}><MessageSquare /></button><button type="button" aria-label="Channel actions"');
    expect(page).not.toContain('ccc-reference-action-divider');
    expect(styles).toContain(".ccc-live-thread-panel");
    expect(styles).toContain(".ccc-live-message-media");
    expect(styles).toContain(".ccc-live .ccc-live-lead-queue");
    expect(styles).toContain(".ccc-live .ccc-live-lead-primary");
    expect(styles).toContain(".ccc-live .ccc-live-confirmation-reply");
    expect(styles).toContain(".ccc-live .ccc-live-left-rail");
    expect(styles).toContain(".ccc-live-sms-drawer");
    expect(styles).toContain(".ccc-live .ccc-right-panel-thread-open");
    expect(styles).not.toContain("ccc-live-thread-drawer");
    expect(styles).not.toContain("ccc-live-thread-panel{position:fixed");
    expect(app).toContain('const CommandChatExactLive = lazy(() => import("./pages/CommandChatExactLive"));');
    expect(app).toContain('function AdminCommandChatExactLiveRoute() { return <ReviewWorkspaceFrame hideNavigation><CommandChatExactLive /></ReviewWorkspaceFrame>; }');
    expect(app).toContain('<Route path={"/admin/command-chat"} component={AdminCommandChatExactLiveRoute} />');
    expect(app).toContain('const isCommandChatWorkspace = location === "/admin/command-chat";');
  });

  it("does not mount the legacy CommandChat or OpsChat page as the new route shell", () => {
    const app = read("client/src/App.tsx");
    expect(app).not.toContain('path={"/admin/command-chat"} component={CommandChatCRMReviewRoute}');
    expect(app).not.toContain('path={"/admin/command-chat"} component={OpsChatRedirect}');
  });
});
