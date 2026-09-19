import { ChangeEvent, FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CircleDollarSign,
  Clock3,
  FileText,
  Heart,
  ImagePlus,
  Loader2,
  Megaphone,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import { IssueEngineOverlay } from "@/components/IssueEngineOverlay";
import { getCsInboxReplyPhoneNumberIdForSelectedConversation } from "@shared/csInboxPhoneNumberRouting";
import "./command-chat-crm-review.css";
import "./command-chat-left-cohesion.css";
import "./command-chat-lead-queue.css";
import "./command-chat-lead-portraits.css";
import "./command-chat-conversation-list.css";
import "./command-chat-palette-balance.css";
import "./command-chat-group-conversation.css";
import "./command-chat-bubble-composition.css";
import "./command-chat-reference-composition.css";
import "./command-chat-header-composition.css";
import "./command-chat-exact-live.css";

type LeftRailMode = "sms" | "issues" | "threads";
type ModalKind = "issue" | "reminder" | "pin" | "booking" | null;
type ChannelKey = "command" | "urgent" | "dispatch" | "general" | "cleaners";
type ChannelMessage = {
  id: number;
  ts: number;
  from: string;
  role: "office" | "agent" | "system";
  body: string;
  mediaUrl: string | null;
  quickAction: string | null;
  metadata: string | null;
  replyToId: number | null;
  replyToBody: string | null;
  replyToAuthor: string | null;
  threadParentId: number | null;
  threadParentBody: string | null;
  threadParentFrom: string | null;
  replyCount: number;
};

type CommandLead = {
  id: number;
  name: string;
  sourceLabel: string;
  detail: string;
  priceLabel: string | null;
  ts: number;
  queue: "web" | "incoming";
};

type ConfirmationReplyAlert = {
  intent: "cancellation" | "unclear";
  customerName: string;
  serviceDate: string | null;
  replyText: string;
  replyUrl: string | null;
};

type SmsInboxConversation = {
  id: number;
  leadName: string | null;
  leadPhone: string | null;
  lastMessageText: string | null;
  lastMsgTs: number | null;
  lastMessageTs: number | null;
  lastSenderRole: string | null;
  hasUnanswered: boolean;
  aiSummary: string | null;
  personType: "team" | "customer";
  lastInboundPhoneNumberId: string | null;
};

type SmsInboxMessage = {
  role: string;
  content: string;
  ts?: number;
};

type CommandFeedEntry =
  | { kind: "channel"; ts: number; message: ChannelMessage }
  | { kind: "team-sms"; ts: number; conversation: SmsInboxConversation };

const CHANNELS: Array<{ key: ChannelKey; label: string; icon: string; tone: string }> = [
  { key: "command", label: "MIB Command", icon: "✦", tone: "neutral" },
  { key: "urgent", label: "Urgent", icon: "!", tone: "amber" },
  { key: "dispatch", label: "Dispatch / Today", icon: "#", tone: "blue" },
  { key: "general", label: "General", icon: "#", tone: "neutral" },
  { key: "cleaners", label: "Team updates", icon: "#", tone: "teal" },
];

const ISSUE_TYPES = [
  ["internal_task", "Internal task"],
  ["access_problem", "Access problem"],
  ["late_team", "Team late"],
  ["refund_request", "Refund request"],
  ["payment_problem", "Payment problem"],
  ["other", "Other"],
] as const;
const HIDDEN_COMMAND_QUICK_ACTIONS = [
  "new_lead",
  "escalation_nudge",
  "call_summary",
  "call_ended",
  "call_debrief",
  "missed_call",
  "madison_sms_draft",
  "madison_email_draft",
  "madison_call_summary",
  "madison_auto_sent",
] as const;
const CUSTOMER_PORTRAITS = [
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/gUCwvRBUvWDZUkGx.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/ypcLWxzXhQzCCWcC.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/DOtabpUhLIcbLXur.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/CucZtKJOfkDlJvMg.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bCfFsxIPapKjJReA.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bvdqcqtPZSJhgtqq.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/VjRgwvLUkGAKxnVA.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/qRwiNDAHRQQTxPbz.png",
] as const;

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "MI";
}

function formatTime(value: number) {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelative(value: number) {
  const delta = Math.max(0, Date.now() - value);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return dateLabel(value);
}

function dateLabel(value: number) {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function mediaUrls(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [value];
  }
}

function customerPortraitFor(value: string) {
  const total = Array.from(value).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return CUSTOMER_PORTRAITS[Math.abs(total) % CUSTOMER_PORTRAITS.length];
}

function smsInboxTimestamp(conversation: SmsInboxConversation) {
  return conversation.lastMsgTs ?? conversation.lastMessageTs ?? 0;
}

function smsConversationName(conversation: SmsInboxConversation) {
  return conversation.leadName?.trim() || (conversation.personType === "team" ? "Team message" : "Customer conversation");
}

function confirmationReplyFromMessage(message: ChannelMessage): ConfirmationReplyAlert | null {
  if (message.role !== "system" || !message.from.includes("Customer SMS Reply")) return null;
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(message.metadata ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const intent = metadata.intent === "cancellation" ? "cancellation" : metadata.intent === "unclear" ? "unclear" : null;
  if (!intent) return null;
  const titleLine = message.body.split("\n").find((line) => /\*\*(?:Cancellation Request|Unclear SMS Reply)\*\*/i.test(line));
  const subject = titleLine?.match(/\*\*(?:Cancellation Request|Unclear SMS Reply)\*\*\s*—\s*(.*)$/i)?.[1]?.trim() || "Customer";
  const dateMatch = subject.match(/\s+\((\d{4}-\d{2}-\d{2})\)\s*$/);
  const customerName = (dateMatch ? subject.slice(0, dateMatch.index) : subject).trim() || "Customer";
  const replyText = message.body.split("\n").find((line) => line.trim().startsWith(">"))?.replace(/^\s*>\s*/, "").replace(/^"|"$/g, "").trim() || "No reply text recorded.";
  return { intent, customerName, serviceDate: dateMatch?.[1] ?? null, replyText, replyUrl: /^https?:\/\/\S+$/i.test(replyText) ? replyText : null };
}

function leadFromCommandMessage(message: ChannelMessage): CommandLead | null {
  if (message.quickAction !== "new_lead") return null;
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(message.metadata ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch {
    // Retain the source message as a safe, generic incoming lead when legacy metadata is malformed.
  }
  const getText = (key: string) => typeof metadata[key] === "string" ? metadata[key] : "";
  const source = getText("source") || getText("utmSource");
  const sourceKey = source.trim().toLowerCase();
  const isWebOrQuoteForm = !sourceKey || ["widget", "widget-popup", "webform", "quoteform", "quote_form"].includes(sourceKey);
  const isIncoming = !isWebOrQuoteForm;
  const sourceLabel = isIncoming
    ? (source.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || message.from.replace(/^[^A-Za-z0-9]+/, "") || "Incoming lead")
    : (sourceKey === "widget" || sourceKey === "widget-popup" ? "Web form" : "Quote form");
  const name = getText("leadName") || "New lead";
  const rawPrice = metadata.price === undefined || metadata.price === null || metadata.price === "" ? "" : String(metadata.price);
  const priceLabel = rawPrice ? (rawPrice.startsWith("$") ? rawPrice : `$${rawPrice}`) : null;
  const detail = [getText("serviceType"), getText("size")].filter(Boolean).join(" · ") || "New inquiry";
  return { id: message.id, name, sourceLabel, detail, priceLabel, ts: message.ts, queue: isIncoming ? "incoming" : "web" };
}

function isHiddenCommandNotification(message: ChannelMessage) {
  if (HIDDEN_COMMAND_QUICK_ACTIONS.includes(message.quickAction as (typeof HIDDEN_COMMAND_QUICK_ACTIONS)[number])) return true;
  if (message.quickAction === "sync_watchdog") return true;
  if (message.role === "system" && /\bSync Alert\b/i.test(message.body)) return true;
  return message.quickAction === "unanswered_alarm" && /new .*lead/i.test(message.body);
}

function Avatar({ name, photoUrl, className = "" }: { name: string; photoUrl?: string | null; className?: string }) {
  return photoUrl ? <img className={className} src={photoUrl} alt={`${name} profile`} /> : <span className={className}>{initials(name)}</span>;
}

function LeadQueue({ title, description, leads }: { title: string; description: string; leads: CommandLead[] }) {
  const orderedLeads = [...leads].sort((a, b) => b.ts - a.ts);
  const [primaryLead, ...remainingLeads] = orderedLeads;
  return (
    <article className={`ccc-context-card ccc-live-lead-queue ${primaryLead ? "has-leads" : ""}`}>
      <header><span><Users />{title}</span><b>{leads.length}</b></header>
      <p className="ccc-live-lead-queue-description">{description}</p>
      {primaryLead ? <div className="ccc-live-lead-list">
        <a href="/admin/leads" className="ccc-live-lead-primary">
          <img src={customerPortraitFor(primaryLead.name)} alt={`Client portrait illustration for ${primaryLead.name}`} />
          <span className="ccc-live-lead-primary-copy"><strong>{primaryLead.name}</strong><small>{primaryLead.queue === "web" ? `Quote requested · ${primaryLead.sourceLabel}` : `${primaryLead.sourceLabel} · ${primaryLead.detail}`}</small><em><i />New inquiry · {formatRelative(primaryLead.ts)}</em></span>
          {primaryLead.priceLabel && <b>{primaryLead.priceLabel}</b>}
          <footer><span>View lead <ChevronRight /></span></footer>
        </a>
        {remainingLeads.slice(0, 2).map((lead) => <a href="/admin/leads" key={lead.id} className="ccc-live-lead-row"><img src={customerPortraitFor(lead.name)} alt={`Client portrait illustration for ${lead.name}`} /><span><strong>{lead.name}</strong><small>{lead.queue === "web" ? `Quote requested · ${lead.sourceLabel}` : `${lead.sourceLabel} · ${lead.detail}`}</small></span>{lead.priceLabel && <b>{lead.priceLabel}</b>}<ChevronRight /></a>)}
      </div> : <p className="ccc-live-card-empty">No leads in this queue.</p>}
    </article>
  );
}

function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/agents/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setError(result.error || "Login failed. Please try again.");
        return;
      }
      onSuccess();
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="ccc-app ccc-live-login">
      <form className="ccc-static-modal" onSubmit={submit}>
        <header><div><MessageSquare /><span><strong>MIB Command</strong><small>Sign in to access the command channel</small></span></div></header>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="ccc-live-login-error">{error}</p>}
        <footer><button type="submit" disabled={pending || !email || !password}>{pending ? <Loader2 className="animate-spin" /> : <Send />}Sign in</button></footer>
      </form>
    </main>
  );
}

export default function CommandChatExactLive() {
  const utils = trpc.useUtils();
  const { data: agentMe, isLoading: agentLoading, isError: agentError, refetch: refetchAgent } = trpc.agents.me.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const isAuthenticated = Boolean(agentMe);
  const callerName = agentMe?.name || "MIB Team";
  const channel: ChannelKey = "command";
  const [leftRailMode, setLeftRailMode] = useState<LeftRailMode>("sms");
  const [issueEngineOpen, setIssueEngineOpen] = useState(false);
  const [issueEngineInitialId, setIssueEngineInitialId] = useState<number | null>(null);
  const [unreadMentionIds, setUnreadMentionIds] = useState<number[]>([]);
  const [draft, setDraft] = useState("");
  const [modal, setModal] = useState<ModalKind>(null);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [threadDraft, setThreadDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueNotes, setIssueNotes] = useState("");
  const [issueType, setIssueType] = useState<(typeof ISSUE_TYPES)[number][0]>("internal_task");
  const [reminderBody, setReminderBody] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState(15);
  const [pinBody, setPinBody] = useState("");
  const [bookingPerson, setBookingPerson] = useState("");
  const [bookingAmount, setBookingAmount] = useState("");
  const [bookingNote, setBookingNote] = useState("");
  const [selectedSmsConversation, setSelectedSmsConversation] = useState<SmsInboxConversation | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: profile } = trpc.opsChat.getMyProfile.useQuery(undefined, { enabled: isAuthenticated, retry: false, staleTime: 5 * 60 * 1000 });
  const { data: photosData } = trpc.opsChat.getAllAgentPhotoMap.useQuery(undefined, { enabled: isAuthenticated, retry: false, staleTime: 5 * 60 * 1000 });
  const { data: channelMessages = [], isLoading: messagesLoading } = trpc.opsChat.listChannelMessages.useQuery(
    { channel },
    { enabled: isAuthenticated, refetchInterval: 30_000, refetchIntervalInBackground: false },
  );
  const { data: activeThreads = [] } = trpc.opsChat.listActiveThreads.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 30_000 });
  const { data: openIssues = [] } = trpc.opsChat.listIssues.useQuery({ status: "open", limit: 12 }, { enabled: isAuthenticated, refetchInterval: 30_000 });
  const { data: activePin } = trpc.opsChat.getChannelPin.useQuery({ channel }, { enabled: isAuthenticated, refetchInterval: 30_000 });
  const { data: agents = { agents: [] } } = trpc.opsChat.getAgentStatusList.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 60_000 });
  const { data: threadDetail } = trpc.opsChat.getThreadReplies.useQuery({ parentId: threadId ?? 0 }, { enabled: isAuthenticated && threadId !== null });
  const { data: smsInboxRows = [], isLoading: smsInboxLoading } = trpc.leads.listCsInbox.useQuery(
    { showResolved: false },
    { enabled: isAuthenticated, staleTime: 30_000, refetchOnWindowFocus: false, refetchInterval: 15_000 },
  );

  const messageIds = useMemo(() => (channelMessages as ChannelMessage[]).map((message) => message.id).filter((id) => id > 0).slice(-500), [channelMessages]);
  const reactionsMutation = trpc.opsChat.getReactions.useMutation();
  const [reactionRows, setReactionRows] = useState<Array<{ messageId: number; callerId: string; callerName: string; emoji: string }>>([]);
  useEffect(() => {
    if (!isAuthenticated || !messageIds.length) {
      setReactionRows([]);
      return;
    }
    let active = true;
    void reactionsMutation.mutateAsync({ messageIds }).then((result) => {
      if (active) setReactionRows(result.reactions);
    }).catch(() => {
      if (active) setReactionRows([]);
    });
    return () => { active = false; };
  // message IDs determine the request; mutation identity is stable from tRPC.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, messageIds.join(",")]);

  const sendMessage = trpc.opsChat.sendMessage.useMutation({
    onSuccess: () => {
      setDraft("");
      setAttachmentUrls([]);
      void utils.opsChat.listChannelMessages.invalidate({ channel });
      void utils.opsChat.getChannelCounts.invalidate();
    },
    onError: () => showNotice("Message could not be sent. Please try again."),
  });
  const uploadPhoto = trpc.opsChat.uploadOpsPhoto.useMutation({ onError: () => showNotice("Photo upload failed. Please try again.") });
  const transcribeVoice = trpc.opsChat.transcribeVoiceNote.useMutation({
    onSuccess: (result) => setDraft((value) => [value, result.text].filter(Boolean).join(value ? "\n" : "")),
    onError: () => showNotice("Voice note could not be transcribed."),
  });
  const toggleReaction = trpc.opsChat.toggleReaction.useMutation({
    onSuccess: () => {
      void utils.opsChat.listChannelMessages.invalidate({ channel });
      if (messageIds.length) void reactionsMutation.mutateAsync({ messageIds }).then((result) => setReactionRows(result.reactions));
    },
  });
  const createIssue = trpc.opsChat.createIssue.useMutation({
    onSuccess: () => {
      setModal(null);
      setIssueTitle("");
      setIssueNotes("");
      void utils.opsChat.listIssues.invalidate({ status: "open", limit: 12 });
      void utils.opsChat.listChannelMessages.invalidate({ channel: "command" });
    },
    onError: () => showNotice("Issue could not be created. Please try again."),
  });
  const setReminder = trpc.opsChat.setReminder.useMutation({ onSuccess: () => { setModal(null); setReminderBody(""); showNotice("Reminder scheduled."); } });
  const pinNote = trpc.opsChat.pinNote.useMutation({ onSuccess: () => { setModal(null); setPinBody(""); void utils.opsChat.getChannelPin.invalidate({ channel }); } });
  const announceBooking = trpc.opsChat.announceBooking.useMutation({ onSuccess: () => { setModal(null); setBookingPerson(""); setBookingAmount(""); setBookingNote(""); void utils.opsChat.listChannelMessages.invalidate({ channel: "command" }); } });

  const photoMap = useMemo(() => photosData?.photos ?? {}, [photosData?.photos]);
  const rootMessages = useMemo(() => (channelMessages as ChannelMessage[]).filter((message) => !message.threadParentId), [channelMessages]);
  const commandLeads = useMemo(() => rootMessages.map(leadFromCommandMessage).filter((lead): lead is CommandLead => lead !== null), [rootMessages]);
  const webAndQuoteLeads = useMemo(() => commandLeads.filter((lead) => lead.queue === "web"), [commandLeads]);
  const incomingLeads = useMemo(() => commandLeads.filter((lead) => lead.queue === "incoming"), [commandLeads]);
  const smsInbox = useMemo(() => (smsInboxRows as unknown as SmsInboxConversation[])
    .filter((conversation) => Boolean(conversation.leadPhone))
    .sort((left, right) => smsInboxTimestamp(right) - smsInboxTimestamp(left)), [smsInboxRows]);
  const visibleRootMessages = useMemo(
    () => rootMessages.filter((message) => !isHiddenCommandNotification(message)),
    [rootMessages],
  );
  const teamInboxMessages = useMemo(
    () => smsInbox.filter((conversation) => conversation.personType === "team"),
    [smsInbox],
  );
  const commandFeed = useMemo<CommandFeedEntry[]>(
    () => [
      ...visibleRootMessages.map((message) => ({ kind: "channel" as const, ts: message.ts, message })),
      ...teamInboxMessages.map((conversation) => ({ kind: "team-sms" as const, ts: smsInboxTimestamp(conversation), conversation })),
    ].sort((left, right) => right.ts - left.ts),
    [teamInboxMessages, visibleRootMessages],
  );
  const effectiveMentionNames = useMemo(() => new Set([callerName, profile?.name].filter((name): name is string => Boolean(name))), [callerName, profile?.name]);
  const mentionPattern = useMemo(() => {
    if (!effectiveMentionNames.size) return null;
    const names = Array.from(effectiveMentionNames).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    return new RegExp(`@(${names})(?:\\b|\\s|$)`, "i");
  }, [effectiveMentionNames]);
  const mentionStorageKey = useMemo(() => `cmd_lastSeenMsgId_${callerName}`, [callerName]);
  const mentionMessages = useMemo(
    () => mentionPattern ? visibleRootMessages.filter((message) => !effectiveMentionNames.has(message.from) && mentionPattern.test(message.body)) : [],
    [effectiveMentionNames, mentionPattern, visibleRootMessages],
  );
  const reactionsByMessage = useMemo(() => {
    const grouped: Record<number, Record<string, { count: number; names: string[] }>> = {};
    for (const item of reactionRows) {
      const byEmoji = grouped[item.messageId] ?? (grouped[item.messageId] = {});
      const entry = byEmoji[item.emoji] ?? (byEmoji[item.emoji] = { count: 0, names: [] });
      entry.count += 1;
      entry.names.push(item.callerName);
    }
    return grouped;
  }, [reactionRows]);
  const metrics = useMemo(() => {
    const participants = new Set(visibleRootMessages.slice(-80).map((message) => message.from)).size;
    return { mentions: unreadMentionIds.length, participants };
  }, [unreadMentionIds.length, visibleRootMessages]);

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3000);
  }

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    let lastSeenId = 0;
    try { lastSeenId = Number.parseInt(localStorage.getItem(mentionStorageKey) ?? "0", 10) || 0; } catch { /* browser storage is optional */ }
    setUnreadMentionIds(mentionMessages.filter((message) => message.id > lastSeenId).map((message) => message.id));
  }, [mentionMessages, mentionStorageKey]);

  useOpsStream({
    onNewMessage: (updatedChannel) => {
      if (!updatedChannel || updatedChannel === channel) void utils.opsChat.listChannelMessages.invalidate({ channel });
      void utils.opsChat.listActiveThreads.invalidate();
      void utils.opsChat.getChannelCounts.invalidate();
    },
    onLeadUpdate: () => {
      void utils.leads.listCsInbox.invalidate({ showResolved: false });
      if (selectedSmsConversation) void utils.leads.getCsConversation.invalidate({ sessionId: selectedSmsConversation.id });
    },
    onReactionUpdate: () => {
      if (messageIds.length) void reactionsMutation.mutateAsync({ messageIds }).then((result) => setReactionRows(result.reactions));
    },
    onReminderUpdate: () => void utils.opsChat.listChannelMessages.invalidate({ channel }),
  }, { enabled: isAuthenticated, label: "CommandChatExactLive" });

  const submitMessage = () => {
    const body = draft.trim();
    if (!body && !attachmentUrls.length) return;
    sendMessage.mutate({
      channel,
      body: body || "Photo",
      authorName: profile?.name || callerName,
      authorRole: "office",
      mediaUrl: attachmentUrls.length ? JSON.stringify(attachmentUrls) : undefined,
    });
  };

  const submitThreadReply = () => {
    const parent = threadDetail?.parent;
    if (!parent || !threadDraft.trim()) return;
    sendMessage.mutate({
      channel,
      body: threadDraft.trim(),
      authorName: profile?.name || callerName,
      authorRole: "office",
      threadParentId: parent.id,
    }, {
      onSuccess: () => {
        setThreadDraft("");
        void utils.opsChat.getThreadReplies.invalidate({ parentId: parent.id });
        void utils.opsChat.listChannelMessages.invalidate({ channel });
      },
    });
  };

  const openIssueEngine = (issueId: number | null = null) => {
    setIssueEngineInitialId(issueId);
    setIssueEngineOpen(true);
  };

  const focusNextMention = () => {
    const [nextId, ...remainingIds] = unreadMentionIds;
    if (!nextId) return;
    document.getElementById(`ccc-command-message-${nextId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (remainingIds.length) {
      try { localStorage.setItem(mentionStorageKey, String(nextId)); } catch { /* browser storage is optional */ }
      setUnreadMentionIds(remainingIds);
      return;
    }
    const newestMessageId = visibleRootMessages.reduce((highestId, message) => Math.max(highestId, message.id), nextId);
    try { localStorage.setItem(mentionStorageKey, String(newestMessageId)); } catch { /* browser storage is optional */ }
    setUnreadMentionIds([]);
  };

  const stageImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const image = event.target.files?.[0];
    event.target.value = "";
    if (!image) return;
    if (!image.type.startsWith("image/")) {
      showNotice("Command Chat supports image attachments only.");
      return;
    }
    try {
      const dataBase64 = await fileToBase64(image);
      const result = await uploadPhoto.mutateAsync({ filename: image.name, mimeType: image.type, dataBase64 });
      setAttachmentUrls((urls) => [...urls, result.url]);
    } catch {
      // The mutation reports the error to the user.
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showNotice("Voice recording is unavailable in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderChunks.current = [];
      streamRef.current = stream;
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size) recorderChunks.current.push(event.data); });
      recorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
        const blob = new Blob(recorderChunks.current, { type: recorder.mimeType || "audio/webm" });
        void blobToBase64(blob).then((dataBase64) => transcribeVoice.mutate({ dataBase64, mimeType: blob.type || "audio/webm" }));
      });
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      showNotice("Microphone access was not granted.");
    }
  };

  if (agentLoading) return <main className="ccc-app ccc-live-loading"><Loader2 className="animate-spin" /></main>;
  if (agentError || !agentMe) return <LoginGate onSuccess={() => void refetchAgent()} />;

  return (
    <main className="ccc-app ccc-widget-app ccc-live" aria-label="MIB Command workspace">
      <section className="ccc-workspace">
        <div className="ccc-command-grid">
          <aside className="ccc-command-panel ccc-left-panel">
            <div className="ccc-command-navigation">
              <div className="ccc-command-brand"><div><Sparkles /><span><strong>MIB Command</strong><small>Operate. Serve. Grow.</small></span></div><button type="button" aria-label="Start a new command message" onClick={() => document.querySelector<HTMLTextAreaElement>(".ccc-live .ccc-composer textarea")?.focus()}><Plus /></button></div>
              <nav aria-label="MIB Command live destinations">
                <a href="/admin/sms"><MessageSquare />SMS</a><a href="/admin/bookings"><CalendarClock />Bookings CRM</a><a href="/admin/leads"><Users />Leads CRM</a><a href="/admin/schedule"><CalendarClock />Schedule</a><a href="/admin/ai-calls"><Phone />AI Calls</a><a href="/admin/payroll-summary"><Activity />Payroll Summary</a><a href="/admin/settings"><MoreHorizontal />Settings</a>
              </nav>
            </div>
            <div className="ccc-left-section ccc-conversations-section ccc-live-left-rail">
              <div className="ccc-panel-tabs ccc-live-left-rail-tabs" aria-label="Command activity views">
                <button type="button" className={leftRailMode === "sms" ? "active" : ""} onClick={() => setLeftRailMode("sms")}>SMS <b>{smsInbox.length}</b></button>
                <button type="button" className={leftRailMode === "issues" ? "active" : ""} onClick={() => setLeftRailMode("issues")}>Issues <b>{openIssues.length}</b></button>
                <button type="button" className={leftRailMode === "threads" ? "active" : ""} onClick={() => setLeftRailMode("threads")}>Threads <b>{activeThreads.length}</b></button>
              </div>
              <div className="ccc-live-left-rail-content">
                {leftRailMode === "sms" ? <div className="ccc-conversation-list ccc-inbox-list ccc-live-sms-list" aria-label="Text message conversations">
                  {smsInbox.map((conversation) => <SmsInboxRow conversation={conversation} key={conversation.id} onOpen={() => setSelectedSmsConversation(conversation)} />)}
                  {!smsInbox.length && <p className="ccc-live-card-empty">{smsInboxLoading ? "Loading text conversations…" : "No active text conversations."}</p>}
                </div> : leftRailMode === "issues" ? <LeftRailIssues issues={openIssues} onOpen={openIssueEngine} /> : <LeftRailThreads threads={activeThreads} onOpen={(id) => { setThreadDraft(""); setThreadId(id); }} />}
              </div>
            </div>
          </aside>

          <section className="ccc-command-panel ccc-center-panel">
            <div className="ccc-reference-chat-header"><div className="ccc-reference-chat-top"><div className="ccc-reference-chat-identity"><span className="ccc-command-glyph"><MessageSquare /></span><div className="ccc-reference-command-info"><strong>{CHANNELS.find((item) => item.key === channel)?.label || "MIB Command"}</strong><div className="ccc-reference-header-metrics" aria-label="Live command workspace metrics"><span><Users /><b>{metrics.participants}</b> Contributors</span><button type="button" className="ccc-header-metric-control ccc-header-metric-money" onClick={() => openIssueEngine()}><CircleDollarSign /><b>{openIssues.length}</b> Open issues</button><button type="button" className="ccc-header-metric-control ccc-header-metric-mentions" disabled={!metrics.mentions} aria-label="Open next unread mention" onClick={focusNextMention}><Bell /><b>{metrics.mentions}</b> Mentions</button></div></div></div><div className="ccc-reference-chat-actions"><div className="ccc-presence" aria-label="Active command participants">{agents.agents.slice(0, 5).map((agent) => <Avatar key={agent.id} name={agent.name} photoUrl={agent.photoUrl} className="ccc-presence-portrait" />)}{agents.agents.length > 5 && <span>+{agents.agents.length - 5}</span>}</div></div></div></div>
            <>
              {activePin && <div className="ccc-pin"><Pin /><div><strong>Pinned by {activePin.authorName}</strong><span>{activePin.body}</span></div><button type="button" aria-label="Dismiss pinned note locally" onClick={() => showNotice("Pins are managed from channel actions.")}><X /></button></div>}
              <div className="ccc-day-divider"><span>Live channel · {dateLabel(Date.now())}</span></div>
              <div className="ccc-message-stream">
                {messagesLoading ? <div className="ccc-live-empty"><Loader2 className="animate-spin" />Loading channel…</div> : commandFeed.length === 0 ? <div className="ccc-live-empty"><MessageSquare />No messages match this view.</div> : commandFeed.map((entry) => entry.kind === "channel" ? <LiveMessage key={`channel-${entry.message.id}`} message={entry.message} callerName={callerName} photoUrl={photoMap[entry.message.from] ?? null} mentionPattern={mentionPattern} reactions={reactionsByMessage[entry.message.id] ?? {}} onThread={() => setThreadId(entry.message.id)} onReaction={(emoji) => toggleReaction.mutate({ messageId: entry.message.id, emoji })} /> : <TeamSmsFeedMessage key={`team-sms-${entry.conversation.id}`} conversation={entry.conversation} onOpen={() => setSelectedSmsConversation(entry.conversation)} />)}
              </div>
              <div className="ccc-quick-actions"><button type="button" onClick={() => setModal("issue")}><AlertTriangle />Open issue</button><button type="button" onClick={() => setModal("reminder")}><CalendarClock />Set reminder</button><button type="button" onClick={() => setModal("pin")}><Pin />Pin a note</button><button type="button" onClick={() => setModal("booking")}><Sparkles />Announce booking</button><button type="button" onClick={() => showNotice("Use the dedicated SMS workspace for customer broadcasts.")}><Megaphone />Broadcast</button></div>
              <div className="ccc-composer"><div>{attachmentUrls.length > 0 && <div className="ccc-live-attachments">{attachmentUrls.map((url) => <span key={url}><img src={url} alt="Pending command attachment" /><button type="button" onClick={() => setAttachmentUrls((urls) => urls.filter((item) => item !== url))}><X /></button></span>)}</div>}<textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitMessage(); } }} placeholder={recording ? "Recording voice note…" : "Message the command channel…"} /><div className="ccc-composer-tools"><span><button type="button" aria-label="Attach image" disabled={uploadPhoto.isPending} onClick={() => fileInputRef.current?.click()}>{uploadPhoto.isPending ? <Loader2 className="animate-spin" /> : <Paperclip />}</button><button type="button" aria-label={recording ? "Stop voice recording" : "Record voice note"} disabled={transcribeVoice.isPending} onClick={() => void toggleRecording()}>{recording ? <span className="ccc-live-recording" /> : transcribeVoice.isPending ? <Loader2 className="animate-spin" /> : <Mic />}</button><button type="button" aria-label="Add check mark" onClick={() => setDraft((value) => `${value}${value ? " " : ""}✅`)}><Check /></button></span><button type="button" className="ccc-send" disabled={sendMessage.isPending || (!draft.trim() && !attachmentUrls.length)} onClick={submitMessage}>{sendMessage.isPending ? <Loader2 className="animate-spin" /> : <Send />}Send</button></div></div></div>
              <input ref={fileInputRef} type="file" accept="image/*" className="ccc-live-file-input" onChange={(event) => void stageImage(event)} />
            </>
          </section>

          <aside className={`ccc-command-panel ccc-right-panel ${threadId !== null ? "ccc-right-panel-thread-open" : ""}`}>
            {threadId !== null ? <ThreadPanel thread={threadDetail} callerName={callerName} draft={threadDraft} pending={sendMessage.isPending} photoMap={photoMap} onDraft={setThreadDraft} onSend={submitThreadReply} onClose={() => { setThreadId(null); setThreadDraft(""); }} /> : <><div className="ccc-lead-context-topline"><strong>Leads</strong><a href="/admin/leads">Open CRM <ChevronRight /></a></div><LeadQueue title="Web & Quote Form" description="Direct form submissions" leads={webAndQuoteLeads} /><LeadQueue title="Other Incoming Leads" description="Marketplace and partner inquiries" leads={incomingLeads} /></>}
          </aside>
        </div>
      </section>
      {selectedSmsConversation && <SmsConversationDrawer conversation={selectedSmsConversation} conversations={smsInbox} onClose={() => setSelectedSmsConversation(null)} />}
      {modal && <ActionModal kind={modal} onClose={() => setModal(null)} issueTitle={issueTitle} issueNotes={issueNotes} issueType={issueType} reminderBody={reminderBody} reminderMinutes={reminderMinutes} pinBody={pinBody} bookingPerson={bookingPerson} bookingAmount={bookingAmount} bookingNote={bookingNote} onIssueTitle={setIssueTitle} onIssueNotes={setIssueNotes} onIssueType={setIssueType} onReminderBody={setReminderBody} onReminderMinutes={setReminderMinutes} onPinBody={setPinBody} onBookingPerson={setBookingPerson} onBookingAmount={setBookingAmount} onBookingNote={setBookingNote} pending={createIssue.isPending || setReminder.isPending || pinNote.isPending || announceBooking.isPending} onSubmit={() => {
        if (modal === "issue") createIssue.mutate({ title: issueTitle.trim(), issueType, severity: "medium", notes: issueNotes.trim() || undefined, createdByName: profile?.name || callerName });
        if (modal === "reminder") setReminder.mutate({ channel, body: reminderBody.trim(), authorName: profile?.name || callerName, triggerAt: Date.now() + reminderMinutes * 60_000 });
        if (modal === "pin") pinNote.mutate({ channel, body: pinBody.trim(), authorName: profile?.name || callerName });
        if (modal === "booking") announceBooking.mutate({ channel: "command", personName: bookingPerson.trim(), amount: bookingAmount.trim() || undefined, note: bookingNote.trim() || undefined, authorName: profile?.name || callerName });
      }} />}
      <IssueEngineOverlay open={issueEngineOpen} onClose={() => { setIssueEngineOpen(false); setIssueEngineInitialId(null); }} callerName={callerName} agentPhotoMap={photoMap} agentList={agents.agents.map((agent) => ({ id: agent.id, name: agent.name, photoUrl: agent.photoUrl ?? null }))} initialIssueId={issueEngineInitialId} />
      {notice && <div className="ccc-notice" role="status"><CircleDot />{notice}</div>}
    </main>
  );
}

function LiveMessage({ message, callerName, photoUrl, mentionPattern, reactions, onThread, onReaction }: { message: ChannelMessage; callerName: string; photoUrl: string | null; mentionPattern: RegExp | null; reactions: Record<string, { count: number; names: string[] }>; onThread: () => void; onReaction: (emoji: string) => void }) {
  const mine = message.from === callerName;
  const team = message.role === "agent" && !mine;
  const system = message.role === "system";
  const media = mediaUrls(message.mediaUrl);
  const confirmationReply = confirmationReplyFromMessage(message);
  if (confirmationReply) return <ConfirmationReplyCard alert={confirmationReply} timestamp={message.ts} />;
  if (system) return <div className="ccc-message ccc-message-system"><span><Activity />{message.body}<time>{formatTime(message.ts)}</time></span></div>;
  return <article id={`ccc-command-message-${message.id}`} className={`ccc-group-message ccc-group-message-${team ? "team" : "customer"} ccc-group-message-${mine ? "right" : "left"}`}><Avatar name={message.from} photoUrl={photoUrl} className={`ccc-group-avatar ${team ? "ccc-group-avatar-team" : "ccc-group-avatar-dispatch"}`} /><div><div className="ccc-message-meta"><strong>{message.from}</strong><em>{team ? "Team" : mine ? "You" : "Office"}</em><time>{formatTime(message.ts)}</time></div>{message.replyToBody && <button type="button" className="ccc-live-quoted-reply" onClick={onThread}>Replying to {message.replyToAuthor}: {message.replyToBody}</button>}<p>{renderMentionBody(message.body, mentionPattern)}</p>{media.length > 0 && <div className="ccc-live-message-media">{media.map((url) => <a href={url} target="_blank" rel="noreferrer" key={url}><img src={url} alt="Command attachment" /></a>)}</div>}<div className="ccc-live-message-tools">{Object.entries(reactions).map(([emoji, value]) => <button type="button" key={emoji} onClick={() => onReaction(emoji)} title={value.names.join(", ")}>{emoji} {value.count}</button>)}<button type="button" onClick={() => onReaction("👍")}>👍</button><button type="button" onClick={onThread}>Thread {message.replyCount > 0 && <b>{message.replyCount}</b>}</button></div></div></article>;
}

function renderMentionBody(body: string, mentionPattern: RegExp | null): ReactNode {
  if (!mentionPattern) return body;
  const matches = Array.from(body.matchAll(new RegExp(mentionPattern.source, "gi")));
  if (!matches.length) return body;
  const content: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    if (start > cursor) content.push(body.slice(cursor, start));
    content.push(<mark className="ccc-live-mention" key={`${start}-${index}`}>{match[0]}</mark>);
    cursor = start + match[0].length;
  });
  if (cursor < body.length) content.push(body.slice(cursor));
  return content;
}

function ConfirmationReplyCard({ alert, timestamp }: { alert: ConfirmationReplyAlert; timestamp: number }) {
  const isCancellation = alert.intent === "cancellation";
  const attachmentHost = alert.replyUrl ? (() => {
    try { return new URL(alert.replyUrl).hostname.replace(/^www\./, ""); } catch { return "external attachment"; }
  })() : null;
  return <article className={`ccc-live-confirmation-reply ${isCancellation ? "is-cancellation" : "is-unclear"}`}>
    <header><span><Phone />Confirmation reply</span><time>{formatTime(timestamp)}</time></header>
    <div><span className="ccc-live-confirmation-reply-status">{isCancellation ? "Cancellation request" : "Needs clarification"}</span><strong>{alert.customerName}</strong>{alert.serviceDate && <small>Service date · {alert.serviceDate}</small>}
      {alert.replyUrl ? <a className="ccc-live-confirmation-reply-link" href={alert.replyUrl} target="_blank" rel="noreferrer"><Paperclip />Media link received · {attachmentHost}</a> : <blockquote>“{alert.replyText}”</blockquote>}
      <a className="ccc-live-confirmation-reply-action" href="/admin/confirmation-calls">Open Confirmation Calls <ChevronRight /></a>
    </div>
  </article>;
}

function LeftRailIssues({ issues, onOpen }: { issues: Array<{ id: number; title: string; issueType: string; severity: string; notes: string | null; ownerName: string | null }>; onOpen: (id: number) => void }) {
  return <div className="ccc-live-left-rail-list ccc-live-issues-list" aria-label="Active command issues">{issues.length ? issues.map((issue) => <button type="button" className={`ccc-live-left-issue ${issue.severity === "critical" || issue.severity === "high" ? "is-urgent" : ""}`} key={issue.id} onClick={() => onOpen(issue.id)}><AlertTriangle /><span><strong>{issue.title}</strong><small>{issue.ownerName ? `Owner · ${issue.ownerName}` : issue.issueType.replaceAll("_", " ")}</small></span></button>) : <div className="ccc-live-empty"><ShieldAlert />The issue queue is clear.</div>}</div>;
}

function LeftRailThreads({ threads, onOpen }: { threads: Array<{ parentId: number; parentFrom: string; parentBody: string; replyCount: number; lastReplyBody: string | null; lastReplyTs: number; hasUnread: boolean }>; onOpen: (id: number) => void }) {
  return <div className="ccc-live-left-rail-list ccc-live-threads-list" aria-label="Active command threads">{threads.length ? threads.map((thread) => <button type="button" className="ccc-live-left-thread" key={thread.parentId} onClick={() => onOpen(thread.parentId)}><span className="ccc-channel-thread-icon"><MessageSquare /></span><span><strong>{thread.parentFrom}</strong><small>{thread.lastReplyBody || thread.parentBody}</small></span><b className={thread.hasUnread ? "is-unread" : ""}>{thread.replyCount}</b></button>) : <div className="ccc-live-empty"><MessageSquare />Start a thread from any command message.</div>}</div>;
}

function ThreadPanel({ thread, callerName, draft, pending, photoMap, onDraft, onSend, onClose }: { thread: { parent: { id: number; ts: number; from: string; role: string; body: string; mediaUrl: string | null; quickAction: string | null; threadParentId: number | null } | null; replies: Array<{ id: number; ts: number; from: string; role: string; body: string; mediaUrl: string | null; quickAction: string | null; threadParentId: number | null }> } | undefined; callerName: string; draft: string; pending: boolean; photoMap: Record<string, string | null>; onDraft: (value: string) => void; onSend: () => void; onClose: () => void }) {
  return <section className="ccc-live-thread-panel" aria-label="Command thread"><header><div><MessageSquare /><span><strong>Thread</strong><small>Command discussion</small></span></div><button type="button" aria-label="Close command thread" onClick={onClose}><X /></button></header><div className="ccc-live-thread-messages">{!thread?.parent ? <div className="ccc-live-empty"><Loader2 className="animate-spin" />Loading thread…</div> : <><LiveThreadEntry entry={thread.parent} mine={thread.parent.from === callerName} photo={photoMap[thread.parent.from] ?? null} root />{thread.replies.map((entry) => <LiveThreadEntry entry={entry} key={entry.id} mine={entry.from === callerName} photo={photoMap[entry.from] ?? null} />)}</>}</div><footer><textarea value={draft} onChange={(event) => onDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} placeholder="Reply in thread…" /><button type="button" disabled={!draft.trim() || pending} onClick={onSend}>{pending ? <Loader2 className="animate-spin" /> : <Send />}</button></footer></section>;
}

function SmsInboxRow({ conversation, onOpen }: { conversation: SmsInboxConversation; onOpen: () => void }) {
  const name = smsConversationName(conversation);
  const timestamp = smsInboxTimestamp(conversation);
  const preview = conversation.aiSummary?.trim() || conversation.lastMessageText?.trim() || "No message preview available.";
  const time = timestamp && Date.now() - timestamp < 86_400_000 ? formatTime(timestamp) : timestamp ? dateLabel(timestamp) : "";
  return <button type="button" className="ccc-live-sms-row" onClick={onOpen}>
    {conversation.personType === "team" ? <span className="ccc-live-sms-team-avatar"><Users /></span> : <img src={customerPortraitFor(name)} alt={`Client portrait illustration for ${name}`} />}
    <span className="ccc-live-sms-row-copy"><strong>{name}</strong><small>{preview}</small></span>
    <span className="ccc-live-sms-row-meta"><time>{time}</time><i className={conversation.hasUnanswered ? "is-unread" : ""} /></span>
  </button>;
}

function TeamSmsFeedMessage({ conversation, onOpen }: { conversation: SmsInboxConversation; onOpen: () => void }) {
  const name = smsConversationName(conversation);
  const timestamp = smsInboxTimestamp(conversation);
  const body = conversation.aiSummary?.trim() || conversation.lastMessageText?.trim() || "No message preview available.";
  return <article className="ccc-group-message ccc-group-message-team ccc-group-message-left ccc-live-team-sms-message"><span className="ccc-group-avatar ccc-group-avatar-team"><Users /></span><div><div className="ccc-message-meta"><strong>{name}</strong><time>{formatTime(timestamp)}</time></div><button type="button" className="ccc-live-team-sms-card" onClick={onOpen} aria-label={`Open and reply to ${name}`}><p>{body}</p><span className="ccc-live-team-reply-hint"><MessageSquare />Reply</span></button><div className="ccc-live-team-sms-reactions" aria-label="Team message reactions"><span><Heart fill="currentColor" /> <b>3</b></span><span><Users /></span></div></div></article>;
}

function SmsConversationDrawer({ conversation, conversations, onClose }: { conversation: SmsInboxConversation; conversations: SmsInboxConversation[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState("");
  const { data: detail } = trpc.leads.getCsConversation.useQuery(
    { sessionId: conversation.id },
    { staleTime: 0, refetchOnWindowFocus: false, refetchInterval: 30_000 },
  );
  const messages = useMemo(() => {
    let parsed: SmsInboxMessage[] = [];
    try { parsed = JSON.parse(detail?.messageHistory ?? "[]") as SmsInboxMessage[]; } catch { parsed = []; }
    return parsed.filter((message) => Boolean(message.content?.trim()));
  }, [detail?.messageHistory]);
  const sendReply = trpc.leads.sendMessage.useMutation({
    onSuccess: () => {
      setDraft("");
      void utils.leads.listCsInbox.invalidate({ showResolved: false });
      void utils.leads.getCsConversation.invalidate({ sessionId: conversation.id });
    },
  });
  const submit = () => {
    const message = draft.trim();
    if (!message) return;
    sendReply.mutate({
      sessionId: conversation.id,
      message,
      fromNumberId: getCsInboxReplyPhoneNumberIdForSelectedConversation(conversation, conversations),
      source: "cs_inbox",
    });
  };
  const name = smsConversationName(conversation);
  return <div className="ccc-live-sms-backdrop" onMouseDown={onClose}><aside className="ccc-live-sms-drawer" onMouseDown={(event) => event.stopPropagation()}>
    <header><div>{conversation.personType === "team" ? <span className="ccc-live-sms-drawer-team"><Users /></span> : <img src={customerPortraitFor(name)} alt={`Client portrait illustration for ${name}`} />}<span><strong>{name}</strong><small>{conversation.personType === "team" ? "Team text conversation" : conversation.leadPhone || "Text conversation"}</small></span></div><button type="button" aria-label="Close text conversation" onClick={onClose}><X /></button></header>
    {conversation.aiSummary?.trim() && <div className="ccc-live-sms-summary"><Sparkles /><span><b>AI summary</b><small>{conversation.aiSummary}</small></span></div>}
    <div className="ccc-live-sms-messages">{!detail ? <div className="ccc-live-empty"><Loader2 className="animate-spin" />Loading text history…</div> : messages.map((message, index) => <article className={`ccc-live-sms-message ${message.role === "user" ? "" : "is-outgoing"}`} key={`${message.ts ?? index}-${message.content}`}><small>{message.role === "user" ? conversation.personType === "team" ? name : "Customer" : "MIB Team"}{message.ts ? ` · ${formatTime(message.ts)}` : ""}</small><p>{message.content}</p></article>)}</div>
    <footer><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="Write a text reply…" /><button type="button" disabled={!draft.trim() || sendReply.isPending} aria-label="Send text reply" onClick={submit}>{sendReply.isPending ? <Loader2 className="animate-spin" /> : <Send />}</button></footer>
  </aside></div>;
}

function LiveThreadEntry({ entry, mine, photo, root = false }: { entry: { from: string; body: string; ts: number }; mine: boolean; photo: string | null; root?: boolean }) {
  return <article className={`ccc-live-thread-entry ${mine ? "is-mine" : ""} ${root ? "is-root" : ""}`}><Avatar name={entry.from} photoUrl={photo} className="ccc-group-avatar" /><div><div><strong>{entry.from}</strong><time>{formatTime(entry.ts)}</time></div><p>{entry.body}</p></div></article>;
}

function ActionModal({ kind, onClose, issueTitle, issueNotes, issueType, reminderBody, reminderMinutes, pinBody, bookingPerson, bookingAmount, bookingNote, onIssueTitle, onIssueNotes, onIssueType, onReminderBody, onReminderMinutes, onPinBody, onBookingPerson, onBookingAmount, onBookingNote, pending, onSubmit }: { kind: Exclude<ModalKind, null>; onClose: () => void; issueTitle: string; issueNotes: string; issueType: (typeof ISSUE_TYPES)[number][0]; reminderBody: string; reminderMinutes: number; pinBody: string; bookingPerson: string; bookingAmount: string; bookingNote: string; onIssueTitle: (value: string) => void; onIssueNotes: (value: string) => void; onIssueType: (value: (typeof ISSUE_TYPES)[number][0]) => void; onReminderBody: (value: string) => void; onReminderMinutes: (value: number) => void; onPinBody: (value: string) => void; onBookingPerson: (value: string) => void; onBookingAmount: (value: string) => void; onBookingNote: (value: string) => void; pending: boolean; onSubmit: () => void }) {
  const config = { issue: ["Open issue", "Post issue"], reminder: ["Set reminder", "Schedule reminder"], pin: ["Pin a note", "Pin note"], booking: ["Announce booking", "Announce"] } as const;
  const [title, action] = config[kind];
  const valid = kind === "issue" ? issueTitle.trim() : kind === "reminder" ? reminderBody.trim() : kind === "pin" ? pinBody.trim() : bookingPerson.trim();
  return <div className="ccc-modal-backdrop" onMouseDown={onClose}><section className="ccc-static-modal ccc-live-action-modal" onMouseDown={(event) => event.stopPropagation()}><header><div>{kind === "issue" ? <AlertTriangle /> : kind === "reminder" ? <CalendarClock /> : kind === "pin" ? <Pin /> : <Sparkles />}<span><strong>{title}</strong><small>Command channel action</small></span></div><button type="button" onClick={onClose}><X /></button></header>{kind === "issue" && <><label>Issue title<input value={issueTitle} onChange={(event) => onIssueTitle(event.target.value)} placeholder="What needs attention?" autoFocus /></label><label>Type<select value={issueType} onChange={(event) => onIssueType(event.target.value as (typeof ISSUE_TYPES)[number][0])}>{ISSUE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Notes<textarea value={issueNotes} onChange={(event) => onIssueNotes(event.target.value)} placeholder="Add relevant context…" /></label></>}{kind === "reminder" && <><label>Reminder<textarea value={reminderBody} onChange={(event) => onReminderBody(event.target.value)} placeholder="What should the team remember?" autoFocus /></label><div className="ccc-live-minute-pills">{[5, 15, 30, 60].map((minutes) => <button type="button" className={reminderMinutes === minutes ? "active" : ""} key={minutes} onClick={() => onReminderMinutes(minutes)}>{minutes < 60 ? `${minutes} min` : "1 hour"}</button>)}</div></>}{kind === "pin" && <label>Note<textarea value={pinBody} onChange={(event) => onPinBody(event.target.value)} placeholder="Keep this at the top of the channel…" autoFocus /></label>}{kind === "booking" && <><label>Customer name<input value={bookingPerson} onChange={(event) => onBookingPerson(event.target.value)} placeholder="Customer name" autoFocus /></label><label>Amount <input value={bookingAmount} onChange={(event) => onBookingAmount(event.target.value)} placeholder="Optional, e.g. $320 recurring" /></label><label>Note<textarea value={bookingNote} onChange={(event) => onBookingNote(event.target.value)} placeholder="Optional context for the team" /></label></>}<footer><button type="button" onClick={onClose}>Cancel</button><button type="button" disabled={!valid || pending} onClick={onSubmit}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{action}</button></footer></section></div>;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
