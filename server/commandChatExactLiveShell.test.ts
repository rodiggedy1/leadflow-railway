import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Command Chat exact live shell", () => {
  it("keeps the approved review composition while binding only existing Command Chat data and actions", () => {
    const page = read("client/src/pages/CommandChatExactLive.tsx");
    const styles = read("client/src/pages/command-chat-exact-live.css");
    const headerStyles = read("client/src/pages/command-chat-header-composition.css");
    const app = read("client/src/App.tsx");
    const commandCenter = read("server/commandCenterRouter.ts");
    const allThreadsPanel = read("client/src/components/AllThreadsPanel.tsx");
    const opsChatRouter = read("server/opsChatRouter.ts");

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
      "leads.stats.useQuery",
      "getPendingSuperAlerts.useQuery",
      "getSuperAlertMessageIds.useQuery",
      "acknowledgeSuperAlert.useMutation",
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
    expect(page).toContain('const sentMediaUrl = sentAttachments.length ? JSON.stringify(sentAttachments) : null;');
    expect(page).toContain('mediaUrl: sentMediaUrl ?? undefined');
    expect(page).toContain('import { useNotificationSound } from "@/hooks/useNotificationSound";');
    expect(page).toContain('import { useTabLeader } from "@/hooks/useTabLeader";');
    expect(page).toContain('const { playSound, muted: notifMuted } = useNotificationSound();');
    expect(page).toContain('const { isLeader: isNotifLeader } = useTabLeader();');
    expect(page).toContain('const LEAD_ALERT_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bMcVRxTSaTukZing.wav";');
    expect(page).toContain('const lastSeenCommandMsgIdRef = useRef<number | undefined>(undefined);');
    expect(page).toContain('const [incomingCommandMessage, setIncomingCommandMessage] = useState<{ from: string } | null>(null);');
    expect(page).toContain('const centerFeedNearBottomRef = useRef(true);');
    expect(page).toContain('const realMessages = (channelMessages as ChannelMessage[]).filter((message) => message.id > 0);');
    expect(page).toContain('if (lastSeenCommandMsgIdRef.current === undefined) {');
    expect(page).toContain('message.id > lastSeenCommandMsgIdRef.current! && message.quickAction === "new_lead",');
    expect(page).toContain('if (newLeads.length > 0 && isNotifLeader && !notifMuted) {');
    expect(page).toContain('const newHumanMessages = realMessages.filter((message) => (');
    expect(page).toContain('message.quickAction === null');
    expect(page).toContain('} else if (newHumanMessages.length > 0 && isNotifLeader && !notifMuted) {');
    expect(page).toContain('playSound();');
    expect(page).toContain('if (newHumanMessages.length > 0 && !centerFeedNearBottomRef.current) {');
    expect(page).toContain('showIncomingCommandMessage(newHumanMessages.at(-1)!.from);');
    expect(page).toContain('audio.volume = 0.75;');
    expect((page.match(/opsChat\.listChannelMessages\.useQuery/g) ?? [])).toHaveLength(1);
    expect(page).toContain('import AiConcierge from "@/components/AiConcierge";');
    expect(page).toContain('const [madisonOpen, setMadisonOpen] = useState(false);');
    expect(page).toContain('agentPhotoUrl={profile?.photoUrl ?? undefined}');
    expect(page).toContain('onClose={() => setMadisonOpen(false)}');
    expect(page).toContain('            dark\n');
    expect(page).toContain('background: "#17191f",');
    expect(page).toContain('src="/madison-avatar.jpg"');
    expect(page).toContain('title="Ask Madison"');
    expect(page).toContain('aria-label="Open Madison"');
    expect(page).toContain('width: 380,');
    expect(page).toContain('width: 52,');
    const concierge = read("client/src/components/AiConcierge.tsx");
    expect(concierge).toContain('compact, dark, onSwitchToCSSession');
    expect(concierge).toContain('madison-compact-dark');
    expect(concierge).toContain('background: dark ? "#17191f" : "rgba(255,255,255,0.88)"');
    expect(concierge).toContain('background: dark ? "#20232b" : "#ffffff"');
    expect(concierge).toContain('background: dark ? "#161820" : "#ffffff"');
    expect(concierge).toContain('background: dark ? "#252934" : "#ffffff"');
    expect(concierge).toContain('background: dark ? "#252934" : "linear-gradient(135deg, rgba(250,244,255,0.95), rgba(244,234,250,0.85))"');
    expect(concierge).toContain('dark={dark}');
    expect(concierge).toContain('dark={dark} onPickTeam={handlePickTeam}');
    expect(concierge).toContain('onClose={() => setShowCommands(false)}\n              dark={dark}');
    expect(styles).toContain('.ccc-live .madison-compact-dark .text-gray-500');
    expect(styles).toContain('background:#252934!important');
    expect(styles).toContain('color:#eef0f5!important');
    expect(page).toContain('"madison_sms_draft",');
    expect(page).toContain('"madison_email_draft",');
    expect(page).not.toContain('  "madison_call_summary",');
    expect(page).toContain('"madison_auto_sent",');
    expect(page).toContain('function isHiddenCommandNotification(message: ChannelMessage)');
    expect(page).toContain('if (message.quickAction === "sync_watchdog") return true;');
    expect(page).toContain('if (message.role === "system" && /\\bSync Alert\\b/i.test(message.body)) return true;');
    expect(page).toContain('message.quickAction === "unanswered_alarm" && /new .*lead/i.test(message.body)');
    expect(page).toContain('function isServiceAlert(message: ChannelMessage)');
    expect(page).toContain('message.quickAction === "post_start_overdue"');
    expect(page).toContain('message.quickAction === "possible_noshow"');
    expect(page).toContain('if (message.role !== "system") return false;');
    expect(page).toContain('/\\bno\\s*-?\\s*check-?in\\b/i.test(message.body)');
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
    expect(page).toContain('sessionId: number | null;');
    expect(page).toContain('const rawSessionId = metadata.sessionId;');
    expect(page).toContain('function leadHref(lead: CommandLead)');
    expect(page).toContain('`/admin/leads?leadId=${lead.sessionId}`');
    expect(page).toContain('href={leadHref(primaryLead)}');
    expect(page).toContain('function customerPortraitFor(value: string)');
    expect(page).toContain('className="ccc-live-lead-primary"');
    expect(page).toContain('className="ccc-live-lead-primary-copy"');
    expect(page).toContain('const webAndQuoteLeads = useMemo(');
    expect(page).toContain('const incomingLeads = useMemo(');
    expect(page).toContain('<LeadQueue title="Web & Quote Form" description="Direct form submissions" leads={webAndQuoteLeads} />');
    expect(page).toContain('<LeadQueue title="Other Incoming Leads" description="Marketplace and partner inquiries" leads={incomingLeads} />');
    expect(page).toContain('<ServiceAlertPanel alerts={serviceAlerts} />');
    expect(page.indexOf('<LeadQueue title="Other Incoming Leads"')).toBeLessThan(page.indexOf('<ServiceAlertPanel alerts={serviceAlerts} />'));
    expect(page).toContain('headerAgentPresence.map((agent, index) =>');
    expect(page).toContain('const [smsSearch, setSmsSearch] = useState("");');
    expect(page).toContain('const visibleSmsInbox = useMemo(() => {');
    expect(page).toContain('import { IssueEngineOverlay } from "@/components/IssueEngineOverlay";');
    expect(page).toContain('const [issueEngineOpen, setIssueEngineOpen] = useState(false);');
    expect(page).toContain('import AllThreadsPanel from "@/components/AllThreadsPanel";');
    expect(page).toContain('const [allThreadsOpen, setAllThreadsOpen] = useState(false);');
    expect(page).toContain('const activeThreadCount = activeThreads.length;');
    expect(page).toContain('const unreadThreadCount = activeThreads.filter((thread) => thread.hasUnread).length;');
    expect(page).toContain('const [todayDateStr, setTodayDateStr] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));');
    expect(page).toContain('{ dateFrom: todayDateStr, dateTo: todayDateStr }');
    expect(page).toContain('const todayBookingCount = todayStats?.bookedCount ?? 0;');
    expect(page).toContain('const todayRevenue = todayStats?.bookedRevenue ?? 0;');
    expect(page).toContain('setTodayDateStr((currentDate) => currentDate === nextDate ? currentDate : nextDate);');
    expect(page).toContain('className="ccc-header-metric-bookings"');
    expect(page).toContain('<b>{todayBookingCount}</b> Booked');
    expect(page).toContain('<b>${todayRevenue.toLocaleString()}</b> Today');
    expect(page).not.toContain('<Users /><b>{metrics.participants}</b> Contributors');
    expect(page).toContain('<b>{openIssues.length}</b> Issues');
    expect(page).toContain('<AlertTriangle /><b>{openIssues.length}</b> Issues</button>');
    expect(page).not.toContain('<CircleDollarSign /><b>{openIssues.length}</b> Issues</button>');
    expect(page).toContain('function commandPresenceStatus(agent: { lastSeenAt: number | null; awayStatus: string | null; onCallSince: number | null }, now: number)');
    expect(page).toContain('const headerAgentPresence = useMemo(() => {');
    expect(page).toContain('headerAgentPresence.map((agent, index) =>');
    expect(page).toContain('ccc-live-presence-${agent.presence}');
    expect(page).not.toContain('agents.agents.slice(0, 5)');
    expect(page).toContain('aria-label="Open all unread command threads"');
    expect(page).toContain('<b>{unreadThreadCount}</b> Threads');
    expect(page).not.toContain('<b>{activeThreadCount}</b> Threads');
    expect(page).toContain('<AllThreadsPanel open={allThreadsOpen} onClose={() => setAllThreadsOpen(false)} onOpenThread={(parentId) => { setAllThreadsOpen(false); setThreadId(parentId); }} />');
    expect(allThreadsPanel).toContain('trpc.opsChat.markRead.useMutation');
    expect(allThreadsPanel).toContain('trpc.opsChat.markAllActiveThreadsRead.useMutation');
    expect(allThreadsPanel).toContain('channel: `thread:${thread.parentId}`');
    expect(allThreadsPanel).toContain('lastMessageId: thread.lastReplyMsgId');
    expect(allThreadsPanel).toContain('Mark all read');
    expect(allThreadsPanel).toContain('bg-[#1b1b1e]');
    expect(opsChatRouter).toContain('markAllActiveThreadsRead: opsChatProcedure.mutation');
    expect(opsChatRouter).toContain('eq(opsChatMessages.channel, "command")');
    expect(opsChatRouter).toContain('eq(opsChatReads.callerId, callerId)');
    expect(opsChatRouter).toContain('return { markedThreadCount: latestReplyByParent.size };');
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
    expect(page).toContain('const [mentionQuery, setMentionQuery] = useState<string | null>(null);');
    expect(page).toContain('const mentionSuggestions = useMemo(');
    expect(page).toContain('const candidateNames = new Set([...Object.keys(photoMap), ...agents.agents.map((agent) => agent.name)]);');
    expect(page).toContain('for (const name of Array.from(candidateNames)) {');
    expect(page).toContain('const selectMention = (name: string) => {');
    expect(page).toContain('const updateMentionQuery = (value: string, selectionStart: number) => {');
    expect(page).toContain('mentionQuery !== null && mentionSuggestions.length > 0');
    expect(page).toContain('<div className="ccc-composer">\n                {mentionQuery !== null && mentionSuggestions.length > 0');
    expect(page).toContain('<div className="ccc-live-composer-body">\n                {attachmentUrls.length > 0');
    expect(page).not.toContain('<b>{metrics.mentions}</b> Mentions');
    expect(page).toContain('<Bell /><b>{metrics.mentions}</b></button>');
    expect(page).toContain('onSuperAlert: () => {');
    expect(page).toContain('const superAlertMessageIdSet = useMemo(() => new Set(superAlertMessageIds), [superAlertMessageIds]);');
    expect(page).toContain('const activeSuperAlert = pendingSuperAlerts[0] ?? null;');
    expect(page).toContain('function SuperAlertOverlay({ alert, pending, onReply }');
    expect(page).toContain('setThreadId(activeSuperAlert.messageId);');
    expect(page).toContain('superAlert={superAlertMessageIdSet.has(entry.message.id)}');
    expect(page).toContain('const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);');
    expect(page).toContain('function commandAttachmentUrl(url: string)');
    expect(page).toContain('onOpenPhoto={setLightboxUrl}');
    expect(page).toContain('<PhotoLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />');
    expect(page).toContain('function PhotoLightbox({ url, onClose }');
    expect(page).toContain('onClick={() => onOpenPhoto(url)}');
    expect(page).not.toContain('<a href={url} target="_blank" rel="noreferrer" key={url}>');
    expect(page).toContain('<IssueEngineOverlay open={issueEngineOpen}');
    expect(page).toContain('function SmsInboxRow({ conversation, onOpen }');
    expect(page).toContain('const preview = conversation.aiSummary?.trim() || conversation.lastMessageText?.trim() || "No message preview available.";');
    expect(page).toContain('function SmsConversationDrawer({ conversation, conversations, onClose }');
    expect(page).toContain('getCsInboxReplyPhoneNumberIdForSelectedConversation(conversation, conversations)');
    expect(page).toContain('const [confirmedOutgoing, setConfirmedOutgoing] = useState<SmsInboxMessage[]>([]);');
    expect(page).toContain('const messageListRef = useRef<HTMLDivElement>(null);');
    expect(page).toContain('messageListRef.current.scrollTop = messageListRef.current.scrollHeight;');
    expect(page).toContain('scrollAfterSendRef.current = true;');
    expect(page).toContain('setConfirmedOutgoing((current) => [...current, { role: "assistant", content: variables.message, ts: Date.now() }]);');
    expect(page).toContain('className="ccc-live-sms-messages" ref={messageListRef}');
    expect(page).toContain('trpc.commandCenter.listCommandChatInbox.useQuery');
    expect(page).not.toContain('trpc.leads.listCsInbox.useQuery');
    expect(page).not.toContain('const inboundSmsInbox = useMemo(');
    expect(page).not.toContain('smsInbox.filter((conversation) => conversation.lastSenderRole === "user")');
    expect(page).toContain('if (!query) return smsInbox;');
    expect(page).toContain('<strong>SMS</strong><b>{smsInbox.length}</b>');
    expect(page).toContain('{visibleSmsInbox.map((conversation) => <SmsInboxRow');
    expect(page).toContain('const leftTeamSmsSessionIds = useMemo(');
    expect(page).toContain('() => smsInbox.filter((conversation) => conversation.personType === "team").map((conversation) => conversation.id)');
    expect(page).toContain('trpc.commandCenter.listInboundTeamSmsEvents.useQuery');
    expect(page).toContain('{ sessionIds: leftTeamSmsSessionIds }');
    expect(page).toContain('const commandTimeline = useMemo<CommandTimelineEntry[]>(');
    expect(page).toContain('...visibleRootMessages.map((message) => ({ kind: "internal" as const');
    expect(page).toContain('...(teamSmsEvents as TeamSmsStreamEvent[]).map((event) => ({ kind: "team-sms" as const');
    expect(page).toContain('.sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id))');
    expect(page).toContain('return <>{timeline.map((entry) => entry.kind === "internal"');
    expect(page).not.toContain('const latestInboundTeamMessage = useMemo(');
    expect(page).not.toContain('{latestInboundTeamMessage && <TeamSmsFeedMessage');
    expect(page).toContain('const messageStreamRef = useRef<HTMLDivElement>(null);');
    expect(page).toContain('const centerFeedInitialScrollDone = useRef(false);');
    expect(page).toContain('const [pendingOutgoingMessages, setPendingOutgoingMessages] = useState<ChannelMessage[]>([]);');
    expect(page).toContain('const scrollAfterSendRef = useRef(false);');
    expect(page).toContain('const pendingRootMessages = useMemo(');
    expect(page).toContain('const shouldScroll = scrollAfterSendRef.current || !centerFeedInitialScrollDone.current || nearBottom;');
    expect(page).toContain('const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 250;');
    expect(page).toContain('scrollAfterSendRef.current = true;');
    expect(page).toContain('setPendingOutgoingMessages((current) => [...current, localMessage]);');
    expect(page).toContain('setDraft("");');
    expect(page).toContain('setPendingOutgoingMessages((current) => current.filter((message) => message.id !== localMessage.id));');
    expect(page).toContain('setDraft((current) => current || body);');
    expect(page).toContain('stream.scrollTop = stream.scrollHeight;');
    expect(page).toContain('className="ccc-message-stream" ref={messageStreamRef}');
    expect(page).toContain('onScroll={trackCommandFeedScroll}');
    expect(page).toContain('className="ccc-live-new-command-message" onClick={dismissIncomingCommandMessage}');
    expect(page).toContain('New message from {incomingCommandMessage.from}');
    expect(page).toContain('function TeamSmsFeedMessage({ event, onOpen }');
    expect(page).toContain('const { name, body, ts: timestamp } = event;');
    expect(page).toContain('className="ccc-group-message ccc-group-message-team ccc-group-message-left ccc-live-team-sms-message"');
    expect(page).toContain('<Heart fill="currentColor" /> <b>3</b>');
    expect(page).toContain('className="ccc-live-team-sms-reactions"');
    expect(page).toContain('const CommandTimelineFeed = memo(function CommandTimelineFeed');
    expect(page).toContain('<CommandTimelineFeed messagesLoading={messagesLoading}');
    expect(page).toContain('onReaction={handleReaction}');
    expect(page).toContain('const conversation = teamSmsConversations.get(entry.event.sessionId); if (conversation) onOpenSmsConversation(conversation);');
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
    expect(page).not.toContain('className="ccc-live-thread-backdrop" role="dialog"');
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
    expect(styles).toContain('.ccc-live .ccc-live-team-sms-message');
    expect(styles).toContain('.ccc-live .ccc-live-new-command-message');
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
    expect(styles).toContain(".ccc-live-mention-picker");
    expect(styles).toContain(".ccc-live .ccc-composer{position:relative;overflow:visible}");
    expect(styles).toContain(".ccc-live-super-alert");
    expect(styles).toContain(".ccc-live-super-alert-badge");
    expect(styles).toContain(".ccc-live-photo-lightbox");
    expect(headerStyles).toContain(".ccc-live-header-presence");
    expect(headerStyles).toContain(".ccc-live-presence-agent>i");
    expect(headerStyles).toContain(".ccc-reference-header-metrics>*{display:inline-flex");
    expect(headerStyles).toContain(".ccc-reference-header-metrics{display:flex!important;align-items:center;gap:0;min-width:0;margin:4px 0 0");
    expect(headerStyles).toContain(".ccc-reference-header-metrics>*+*:before");
    expect(headerStyles).toContain(".ccc-reference-header-metrics>* svg{width:17px;height:17px");
    expect(headerStyles).toContain(".ccc-reference-header-metrics>* b{color:#eeeeef;font-size:13px");
    expect(styles).not.toContain(".ccc-header-metric-control:before{width:2px;height:2px");
    expect(styles).not.toContain("ccc-live-thread-drawer");
    expect(styles).not.toContain("ccc-live-thread-panel{position:fixed");
    expect(app).toContain('const CommandChatExactLive = lazy(() => import("./pages/CommandChatExactLive"));');
    expect(app).toContain('function AdminCommandChatExactLiveRoute()');
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/command-chat-crm"><CommandChatExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/command-chat"} component={AdminCommandChatExactLiveRoute} />');
    expect(app).toContain('const isCommandChatWorkspace = location === "/admin/command-chat";');
    expect(app).toContain('function OpsChatRedirect()');
    expect(app).toContain('navigate("/admin/command-chat");');
    expect(app).not.toContain('open();\n    navigate("/admin/leads");');
  });

  it("does not mount the legacy CommandChat or OpsChat page as the new route shell", () => {
    const app = read("client/src/App.tsx");
    expect(app).not.toContain('path={"/admin/command-chat"} component={CommandChatCRMReviewRoute}');
    expect(app).not.toContain('path={"/admin/command-chat"} component={OpsChatRedirect}');
  });
});
