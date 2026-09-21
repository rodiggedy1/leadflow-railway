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
    const commandCenter = read("server/commandCenterRouter.ts");

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
      "getThreadReplies.useQuery",
      "toggleReaction.useMutation",
      "getReactions.useMutation",
      "uploadOpsPhoto.useMutation",
      "transcribeVoiceNote.useMutation",
      "createIssue.useMutation",
      "setReminder.useMutation",
      "pinNote.useMutation",
      "announceBooking.useMutation",
      "listCommandChatInbox.useQuery",
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
    expect(page).not.toContain('  "madison_call_summary",');
    expect(page).toContain('"madison_auto_sent",');
    expect(page).toContain('function isHiddenCommandNotification(message: ChannelMessage)');
    expect(page).toContain('if (message.quickAction === "sync_watchdog") return true;');
    expect(page).toContain('if (message.role === "system" && /\\bSync Alert\\b/i.test(message.body)) return true;');
    expect(page).toContain('message.quickAction === "unanswered_alarm" && /new .*lead/i.test(message.body)');
    expect(page).toContain('function isServiceAlert(message: ChannelMessage)');
    expect(page).toContain('message.quickAction === "post_start_overdue" || message.quickAction === "possible_noshow"');
    expect(page).toContain('const visibleRootMessages = useMemo(');
    expect(page).toContain('!isHiddenCommandNotification(message) && !isServiceAlert(message)');
    expect(page).toContain('const serviceAlerts = useMemo(');
    expect(page).toContain('rootMessages.filter(isServiceAlert).sort((left, right) => right.ts - left.ts)');
    expect(page).toContain('function ServiceAlertPanel({ alerts }: { alerts: ChannelMessage[] })');
    expect(page).toContain('className="ccc-context-card ccc-live-service-alerts"');
    expect(page).toContain('function confirmationReplyFromMessage(message: ChannelMessage): ConfirmationReplyAlert | null');
    expect(page).toContain('function ConfirmationReplyCard({ alert, timestamp }');
    expect(page).toContain('function callHandoffFromMessage(message: ChannelMessage): IncomingCallHandoff | null');
    expect(page).toContain('vapiCallId: string | null;');
    expect(page).toContain('callerPhone: string | null;');
    expect(page).toContain('trpc.voice.listCalls.useQuery');
    expect(page).toContain('{ limit: 50, offset: 0 }');
    expect(page).toContain('const voiceCallIdentityByVapiId = useMemo');
    expect(page).toContain('callerName: call.callerName?.trim() || null');
    expect(page).toContain('voiceCallIdentityByVapiId={voiceCallIdentityByVapiId}');
    expect(page).toContain('voiceCaller?.callerName || callHandoff.callerName');
    expect(page).toContain('typeof metadata.callerPhone === "string" && metadata.callerPhone.trim()');
    expect(page).toContain('AI-handled inbound call{handoff.callerPhone &&');
    expect(page).toContain('function IncomingCallHandoffCard({ handoff, timestamp }');
    expect(page).toContain('if (resolvedCallHandoff) return <IncomingCallHandoffCard handoff={resolvedCallHandoff} timestamp={message.ts} />;');
    expect(page).toContain('AI-handled inbound call');
    expect(page).toContain('className="ccc-voice-handoff"');
    expect(page).toContain('proxyRecordingUrl(handoff.recordingUrl)');
    expect(page).toContain('href="/admin/confirmation-calls"');
    expect(page).toContain('function leadFromCommandMessage(message: ChannelMessage): CommandLead | null');
    expect(page).toContain('function customerPortraitFor(value: string)');
    expect(page).toContain('className="ccc-live-lead-primary"');
    expect(page).toContain('className="ccc-live-lead-primary-copy"');
    expect(page).toContain('const webAndQuoteLeads = useMemo(');
    expect(page).toContain('const incomingLeads = useMemo(');
    expect(page).toContain('<LeadQueue title="Web & Quote Form" description="Direct form submissions" leads={webAndQuoteLeads} />');
    expect(page).toContain('<LeadQueue title="Other Incoming Leads" description="Marketplace and partner inquiries" leads={incomingLeads} />');
    expect(page).toContain('<ServiceAlertPanel alerts={serviceAlerts} />');
    expect(page.indexOf('<LeadQueue title="Other Incoming Leads"')).toBeLessThan(page.indexOf('<ServiceAlertPanel alerts={serviceAlerts} />'));
    expect(page).toContain('agents.agents.slice(0, 5)');
    expect(page).toContain('const [smsSearch, setSmsSearch] = useState("");');
    expect(page).toContain('const visibleSmsInbox = useMemo(() => {');
    expect(page).toContain('import { IssueEngineOverlay } from "@/components/IssueEngineOverlay";');
    expect(page).toContain('const [issueEngineOpen, setIssueEngineOpen] = useState(false);');
    expect(page).toContain('const [unreadMentionIds, setUnreadMentionIds] = useState<number[]>([]);');
    expect(page).toContain('className="ccc-left-section ccc-conversations-section ccc-live-left-rail"');
    expect(page).toContain('className="ccc-live-sms-header"');
    expect(page).toContain('className="ccc-live-sms-title"');
    expect(page).toContain('className="ccc-live-sms-filter-tabs" role="tablist"');
    expect(page).toContain('>All</button><button type="button">Unread</button><button type="button">Needs Reply</button><button type="button">Starred</button>');
    expect(page).toContain('placeholder="Search conversations..."');
    expect(page).toContain('href="/admin/sms" aria-label="Open SMS workspace to compose a new message"');
    expect(page).not.toContain('className="ccc-command-navigation"');
    expect(page).not.toContain('aria-label="MIB Command live destinations"');
    expect(page).not.toContain('LeftRailIssues');
    expect(page).not.toContain('LeftRailThreads');
    expect(page).toContain('const mentionMessages = useMemo(');
    expect(page).toContain('const focusNextMention = () => {');
    expect(page).toContain('setUnreadMentionIds(remainingIds);');
    expect(page).toContain('localStorage.setItem(mentionStorageKey, String(nextId))');
    expect(page).toContain('aria-label="Open next unread mention"');
    expect(page).toContain('onClick={focusNextMention}');
    expect(page).toContain('function renderMentionBody(body: string, mentionPattern: RegExp | null): ReactNode');
    expect(page).toContain('className="ccc-live-mention"');
    expect(page).toContain('<IssueEngineOverlay open={issueEngineOpen}');
    expect(page).toContain('function SmsInboxRow({ conversation, onOpen }');
    expect(page).toContain('const preview = conversation.aiSummary?.trim() || conversation.lastMessageText?.trim() || "No message preview available.";');
    expect(page).toContain('function SmsConversationDrawer({ conversation, conversations, onClose }');
    expect(page).toContain('getCsInboxReplyPhoneNumberIdForSelectedConversation(conversation, conversations)');
    expect(page).toContain('trpc.commandCenter.listCommandChatInbox.useQuery');
    expect(page).not.toContain('trpc.leads.listCsInbox.useQuery');
    expect(page).toContain('const inboundSmsInbox = useMemo(');
    expect(page).toContain('smsInbox.filter((conversation) => conversation.lastSenderRole === "user")');
    expect(page).toContain('<strong>SMS</strong><b>{inboundSmsInbox.length}</b>');
    expect(page).toContain('{visibleSmsInbox.map((conversation) => <SmsInboxRow');
    expect(page).toContain('const leftTeamSmsSessionIds = useMemo(');
    expect(page).toContain('trpc.commandCenter.listInboundTeamSmsEvents.useQuery');
    expect(page).toContain('{ sessionIds: leftTeamSmsSessionIds }');
    expect(page).toContain('const commandTimeline = useMemo<CommandTimelineEntry[]>(');
    expect(page).toContain('...visibleRootMessages.map((message) => ({ kind: "internal" as const');
    expect(page).toContain('...(teamSmsEvents as TeamSmsStreamEvent[]).map((event) => ({ kind: "team-sms" as const');
    expect(page).toContain('.sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id))');
    expect(page).toContain('commandTimeline.map((entry) => entry.kind === "internal"');
    expect(page).not.toContain('const latestInboundTeamMessage = useMemo(');
    expect(page).not.toContain('{latestInboundTeamMessage && <TeamSmsFeedMessage');
    expect(page).toContain('const messageStreamRef = useRef<HTMLDivElement>(null);');
    expect(page).toContain('const centerFeedInitialScrollDone = useRef(false);');
    expect(page).toContain('stream.scrollTop = stream.scrollHeight;');
    expect(page).toContain('className="ccc-message-stream" ref={messageStreamRef}');
    expect(page).toContain('function TeamSmsFeedMessage({ event, onOpen }');
    expect(page).toContain('const { name, body, ts: timestamp } = event;');
    expect(page).toContain('className="ccc-group-message ccc-group-message-team ccc-group-message-left ccc-live-team-sms-message"');
    expect(page).toContain('<Heart fill="currentColor" /> <b>3</b>');
    expect(page).toContain('className="ccc-live-team-sms-reactions"');
    expect(page).toContain('const conversation = teamSmsConversations.get(entry.event.sessionId); if (conversation) setSelectedSmsConversation(conversation);');
    expect(page).toContain('conversation.personType === "team" ? name : "Customer"');
    expect(commandCenter).toContain('listInboundTeamSmsEvents: agentProcedure');
    expect(commandCenter).toContain('listCommandChatInbox: agentProcedure');
    expect(commandCenter).toContain('lastInboundPhoneNumberId: conversationSessions.lastInboundPhoneNumberId');
    expect(commandCenter).toContain('personType: session.csQueue === "Teams" || teamPhoneSet.has(normalizePhone(session.leadPhone ?? ""))');
    expect(commandCenter).toContain('sessionIds: z.array(z.number().int().positive()).max(500)');
    expect(commandCenter).toContain('.where(inArray(conversationSessions.id, sessionIds));');
    expect(commandCenter).toContain('if (message.role !== "user" || !body || !ts) continue;');
    for (const prohibited of ["cleaner" + "Jobs", "cleaner" + "_jobs"]) {
      expect(commandCenter).not.toContain(prohibited);
    }
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
    expect(styles).toContain(".ccc-live .ccc-live-service-alerts");
    expect(styles).toContain(".ccc-live .ccc-live-service-alert-scroll");
    expect(styles).toContain(".ccc-live .ccc-live-confirmation-reply");
    expect(styles).toContain(".ccc-live .ccc-live-left-rail");
    expect(styles).toContain(".ccc-live .ccc-live-sms-header{flex:0 0 auto");
    expect(styles).toContain(".ccc-live .ccc-live-sms-filter-tabs");
    expect(styles).toContain(".ccc-live .ccc-live-sms-search");
    expect(styles).toContain(".ccc-live-sms-drawer");
    expect(styles).toContain(".ccc-live .ccc-live-team-sms-message");
    expect(styles).toContain(".ccc-live .ccc-live-team-sms-card");
    expect(styles).toContain(".ccc-live .ccc-group-message-team .ccc-live-team-sms-card>p");
    expect(styles).toContain("background:transparent!important");
    expect(styles).toContain("border:0!important");
    expect(styles).toContain(".ccc-live .ccc-live-team-reply-hint");
    expect(styles).toContain(".ccc-live .ccc-live-team-sms-reactions");
    expect(styles).toContain(".ccc-live .ccc-live-sms-list{flex:1;min-height:0;overflow-y:auto}");
    expect(styles).not.toContain(".ccc-live .ccc-live-team-sms-card:hover footer");
    expect(styles).toContain(".ccc-live .ccc-right-panel-thread-open");
    expect(styles).toContain(".ccc-live .ccc-reference-header-metrics .ccc-header-metric-control");
    expect(styles).toContain(".ccc-live .ccc-group-message .ccc-live-mention");
    expect(styles).not.toContain("ccc-live-thread-drawer");
    expect(styles).not.toContain("ccc-live-thread-panel{position:fixed");
    expect(app).toContain('const CommandChatExactLive = lazy(() => import("./pages/CommandChatExactLive"));');
    expect(app).toContain("function AdminCommandChatExactLiveRoute()");
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/command-chat-crm"><CommandChatExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/command-chat"} component={AdminCommandChatExactLiveRoute} />');
    expect(app).toContain('const isCommandChatWorkspace = location === "/admin/command-chat";');
  });

  it("does not mount the legacy CommandChat or OpsChat page as the new route shell", () => {
    const app = read("client/src/App.tsx");
    expect(app).not.toContain('path={"/admin/command-chat"} component={CommandChatCRMReviewRoute}');
    expect(app).not.toContain('path={"/admin/command-chat"} component={OpsChatRedirect}');
  });
});
