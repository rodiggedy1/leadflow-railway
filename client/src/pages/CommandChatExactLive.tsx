import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
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

type View = "chat" | "issues" | "calls";
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

function Avatar({ name, photoUrl, className = "" }: { name: string; photoUrl?: string | null; className?: string }) {
  return photoUrl ? <img className={className} src={photoUrl} alt={`${name} profile`} /> : <span className={className}>{initials(name)}</span>;
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
  const [channel, setChannel] = useState<ChannelKey>("command");
  const [view, setView] = useState<View>("chat");
  const [search, setSearch] = useState("");
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
  const { data: channelCounts } = trpc.opsChat.getChannelCounts.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 60_000 });
  const { data: activeThreads = [] } = trpc.opsChat.listActiveThreads.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 30_000 });
  const { data: openIssues = [] } = trpc.opsChat.listIssues.useQuery({ status: "open", limit: 12 }, { enabled: isAuthenticated, refetchInterval: 30_000 });
  const { data: activePin } = trpc.opsChat.getChannelPin.useQuery({ channel }, { enabled: isAuthenticated, refetchInterval: 30_000 });
  const { data: agents = { agents: [] } } = trpc.opsChat.getAgentStatusList.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 60_000 });
  const { data: threadDetail } = trpc.opsChat.getThreadReplies.useQuery({ parentId: threadId ?? 0 }, { enabled: isAuthenticated && threadId !== null });

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
  const filteredMessages = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? rootMessages.filter((message) => `${message.from} ${message.body}`.toLowerCase().includes(term)) : rootMessages;
  }, [rootMessages, search]);
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
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const activity = rootMessages.filter((message) => message.ts >= since).length;
    const mentions = rootMessages.filter((message) => message.body.toLowerCase().includes(`@${callerName.split(" ")[0].toLowerCase()}`)).length;
    const participants = new Set(rootMessages.slice(-80).map((message) => message.from)).size;
    return { activity, mentions, participants };
  }, [callerName, rootMessages]);

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3000);
  }

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useOpsStream({
    onNewMessage: (updatedChannel) => {
      if (!updatedChannel || updatedChannel === channel) void utils.opsChat.listChannelMessages.invalidate({ channel });
      void utils.opsChat.listActiveThreads.invalidate();
      void utils.opsChat.getChannelCounts.invalidate();
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
            <div className="ccc-left-section ccc-conversations-section">
              <div className="ccc-panel-heading ccc-conversation-heading"><div><span>COMMAND CHANNELS</span></div><button type="button" aria-label="Search command messages" onClick={() => document.querySelector<HTMLInputElement>(".ccc-live .ccc-conversation-search input")?.focus()}><Search /></button></div>
              <label className="ccc-search ccc-conversation-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search command messages..." /></label>
              <div className="ccc-conversation-filters" aria-label="Command conversation filters"><button className="active">All <b>{rootMessages.length}</b></button><button type="button" onClick={() => setView("issues")}>Issues <b>{openIssues.length}</b></button><button type="button" onClick={() => setThreadId(activeThreads[0]?.parentId ?? null)}>Threads <b>{activeThreads.length}</b></button></div>
              <div className="ccc-conversation-list ccc-inbox-list">
                {CHANNELS.map((item) => {
                  const count = item.key === "command" ? rootMessages.length : (channelCounts?.[item.key] ?? 0);
                  return <button key={item.key} type="button" className={`ccc-conversation ccc-channel-thread ccc-channel-thread-${item.tone} ${channel === item.key ? "active" : ""}`} onClick={() => { setChannel(item.key); setView("chat"); setThreadId(null); }}><span className="ccc-channel-thread-icon">{item.icon}</span><span className="ccc-conv-copy ccc-inbox-copy"><strong>{item.label}</strong><small>{count ? `${count} active messages` : "No messages yet"}</small></span><span className="ccc-conv-meta ccc-inbox-meta"><time>{item.key === channel ? "open" : ""}</time>{count > 0 && <b>{count > 99 ? "99+" : count}</b>}</span></button>;
                })}
              </div>
              <div className="ccc-left-section ccc-live-thread-list"><div className="ccc-section-label"><span>ACTIVE THREADS</span><b>{activeThreads.length}</b></div>{activeThreads.slice(0, 8).map((thread) => <button type="button" key={thread.parentId} className="ccc-live-thread-row" onClick={() => setThreadId(thread.parentId)}><span>{initials(thread.parentFrom)}</span><div><strong>{thread.parentFrom}</strong><small>{thread.lastReplyBody || thread.parentBody}</small></div><b>{thread.replyCount}</b></button>)}</div>
            </div>
          </aside>

          <section className="ccc-command-panel ccc-center-panel">
            <div className="ccc-reference-chat-header"><div className="ccc-reference-chat-top"><div className="ccc-reference-chat-identity"><span className="ccc-command-glyph"><MessageSquare /></span><div className="ccc-reference-command-info"><strong>{CHANNELS.find((item) => item.key === channel)?.label || "MIB Command"}</strong><div className="ccc-reference-header-metrics" aria-label="Live command workspace metrics"><span><Users /><b>{metrics.participants}</b> Contributors</span><span><Activity /><b>{metrics.activity}</b> Today</span><span className="ccc-header-metric-money"><CircleDollarSign /><b>{openIssues.length}</b> Open issues</span><span className="ccc-header-metric-mentions"><Bell /><b>{metrics.mentions}</b> Mentions</span></div></div></div><div className="ccc-reference-chat-actions"><div className="ccc-presence" aria-label="Active command participants">{agents.agents.slice(0, 3).map((agent) => <Avatar key={agent.id} name={agent.name} photoUrl={agent.photoUrl} className="ccc-presence-portrait" />)}{agents.agents.length > 3 && <span>+{agents.agents.length - 3}</span>}</div><i className="ccc-reference-action-divider" aria-hidden="true" /><button type="button" aria-label="View channel threads" onClick={() => setThreadId(activeThreads[0]?.parentId ?? null)}><MessageSquare /></button><button type="button" aria-label="Channel actions" onClick={() => setModal("pin")}><MoreHorizontal /></button></div></div></div>
            <div className="ccc-reference-chat-tabs"><button type="button" className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}>Messages</button><button type="button" className={view === "issues" ? "active" : ""} onClick={() => setView("issues")}>Issues <b>{openIssues.length}</b></button><button type="button" className={view === "calls" ? "active" : ""} onClick={() => setView("calls")}>Threads <b>{activeThreads.length}</b></button></div>
            {view === "issues" ? <IssuesView issues={openIssues} onBack={() => setView("chat")} /> : view === "calls" ? <ThreadsView threads={activeThreads} onOpen={(id) => setThreadId(id)} onBack={() => setView("chat")} /> : <>
              {activePin && <div className="ccc-pin"><Pin /><div><strong>Pinned by {activePin.authorName}</strong><span>{activePin.body}</span></div><button type="button" aria-label="Dismiss pinned note locally" onClick={() => showNotice("Pins are managed from channel actions.")}><X /></button></div>}
              <div className="ccc-day-divider"><span>Live channel · {dateLabel(Date.now())}</span></div>
              <div className="ccc-message-stream">
                {messagesLoading ? <div className="ccc-live-empty"><Loader2 className="animate-spin" />Loading channel…</div> : filteredMessages.length === 0 ? <div className="ccc-live-empty"><MessageSquare />No messages match this view.</div> : filteredMessages.map((message) => <LiveMessage key={message.id} message={message} callerName={callerName} photoUrl={photoMap[message.from] ?? null} reactions={reactionsByMessage[message.id] ?? {}} onThread={() => setThreadId(message.id)} onReaction={(emoji) => toggleReaction.mutate({ messageId: message.id, emoji })} />)}
              </div>
              <div className="ccc-quick-actions"><button type="button" onClick={() => setModal("issue")}><AlertTriangle />Open issue</button><button type="button" onClick={() => setModal("reminder")}><CalendarClock />Set reminder</button><button type="button" onClick={() => setModal("pin")}><Pin />Pin a note</button><button type="button" onClick={() => setModal("booking")}><Sparkles />Announce booking</button><button type="button" onClick={() => showNotice("Use the dedicated SMS workspace for customer broadcasts.")}><Megaphone />Broadcast</button></div>
              <div className="ccc-composer"><div>{attachmentUrls.length > 0 && <div className="ccc-live-attachments">{attachmentUrls.map((url) => <span key={url}><img src={url} alt="Pending command attachment" /><button type="button" onClick={() => setAttachmentUrls((urls) => urls.filter((item) => item !== url))}><X /></button></span>)}</div>}<textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitMessage(); } }} placeholder={recording ? "Recording voice note…" : "Message the command channel…"} /><div className="ccc-composer-tools"><span><button type="button" aria-label="Attach image" disabled={uploadPhoto.isPending} onClick={() => fileInputRef.current?.click()}>{uploadPhoto.isPending ? <Loader2 className="animate-spin" /> : <Paperclip />}</button><button type="button" aria-label={recording ? "Stop voice recording" : "Record voice note"} disabled={transcribeVoice.isPending} onClick={() => void toggleRecording()}>{recording ? <span className="ccc-live-recording" /> : transcribeVoice.isPending ? <Loader2 className="animate-spin" /> : <Mic />}</button><button type="button" aria-label="Add check mark" onClick={() => setDraft((value) => `${value}${value ? " " : ""}✅`)}><Check /></button></span><button type="button" className="ccc-send" disabled={sendMessage.isPending || (!draft.trim() && !attachmentUrls.length)} onClick={submitMessage}>{sendMessage.isPending ? <Loader2 className="animate-spin" /> : <Send />}Send</button></div></div></div>
              <input ref={fileInputRef} type="file" accept="image/*" className="ccc-live-file-input" onChange={(event) => void stageImage(event)} />
            </>}
          </section>

          <aside className="ccc-command-panel ccc-right-panel"><div className="ccc-lead-context-topline"><strong>Command context</strong><button type="button" onClick={() => setModal("booking")}>{callerName}<ChevronDown /></button></div><article className="ccc-context-card ccc-live-profile"><div className="ccc-context-lead-summary"><Avatar name={profile?.name || callerName} photoUrl={profile?.photoUrl} className="ccc-lead-portrait" /><div><strong>{profile?.name || callerName}</strong><span>Command channel participant</span><small><i />Connected</small></div><b>{rootMessages.length}</b></div><div className="ccc-context-actions"><button type="button" className="ccc-context-primary" onClick={() => setModal("booking")}>Announce booking <ChevronRight /></button><button type="button" aria-label="Open command issues" onClick={() => setView("issues")}><ShieldAlert /></button><button type="button" aria-label="Open channel threads" onClick={() => setThreadId(activeThreads[0]?.parentId ?? null)}><MessageSquare /></button><button type="button" aria-label="Pin a note" onClick={() => setModal("pin")}><Pin /></button></div></article><article className="ccc-context-card"><header><span><ShieldAlert />Open issues</span><b>{openIssues.length}</b></header>{openIssues.length ? openIssues.slice(0, 3).map((issue) => <button type="button" key={issue.id} className="ccc-live-issue-link" onClick={() => setView("issues")}><span className={`ccc-op-dot ${issue.severity === "critical" || issue.severity === "high" ? "amber" : "mint"}`} /><div><strong>{issue.title}</strong><small>{issue.ownerName ? `Owner: ${issue.ownerName}` : "Needs owner"}</small></div><ChevronRight /></button>) : <p className="ccc-live-card-empty">No open issues in the command queue.</p>}</article><article className="ccc-context-card ccc-context-moves"><header><span><Sparkles />Command actions</span><b>4</b></header><div className="ccc-context-move-list"><button className="ccc-context-move ccc-context-move-priority" onClick={() => setModal("issue")}><span>Priority</span><strong>Raise an operational issue</strong><em>Open issue <ChevronRight /></em></button><button className="ccc-context-move ccc-context-move-opportunity" onClick={() => setModal("booking")}><span>Win</span><strong>Celebrate a confirmed booking</strong><em>Announce booking <ChevronRight /></em></button><button className="ccc-context-move ccc-context-move-followup" onClick={() => setModal("reminder")}><span>Follow-up</span><strong>Keep a command item on time</strong><em>Set reminder <ChevronRight /></em></button></div></article><article className="ccc-context-card ccc-context-related"><header><span>Live signals</span></header><button type="button" onClick={() => setView("chat")}><MessageSquare /><span>Channel messages</span><b>{rootMessages.length}</b><ChevronRight /></button><button type="button" onClick={() => setThreadId(activeThreads[0]?.parentId ?? null)}><MessageSquare /><span>Active threads</span><b>{activeThreads.length}</b><ChevronRight /></button><button type="button" onClick={() => setView("issues")}><ShieldAlert /><span>Unresolved issues</span><b>{openIssues.length}</b><ChevronRight /></button><button type="button" onClick={() => setModal("pin")}><Pin /><span>Pinned note</span><b>{activePin ? "1" : "0"}</b><ChevronRight /></button></article></aside>
        </div>
      </section>
      {threadId !== null && <ThreadDrawer thread={threadDetail} callerName={callerName} draft={threadDraft} pending={sendMessage.isPending} photoMap={photoMap} onDraft={setThreadDraft} onSend={submitThreadReply} onClose={() => { setThreadId(null); setThreadDraft(""); }} />}
      {modal && <ActionModal kind={modal} onClose={() => setModal(null)} issueTitle={issueTitle} issueNotes={issueNotes} issueType={issueType} reminderBody={reminderBody} reminderMinutes={reminderMinutes} pinBody={pinBody} bookingPerson={bookingPerson} bookingAmount={bookingAmount} bookingNote={bookingNote} onIssueTitle={setIssueTitle} onIssueNotes={setIssueNotes} onIssueType={setIssueType} onReminderBody={setReminderBody} onReminderMinutes={setReminderMinutes} onPinBody={setPinBody} onBookingPerson={setBookingPerson} onBookingAmount={setBookingAmount} onBookingNote={setBookingNote} pending={createIssue.isPending || setReminder.isPending || pinNote.isPending || announceBooking.isPending} onSubmit={() => {
        if (modal === "issue") createIssue.mutate({ title: issueTitle.trim(), issueType, severity: "medium", notes: issueNotes.trim() || undefined, createdByName: profile?.name || callerName });
        if (modal === "reminder") setReminder.mutate({ channel, body: reminderBody.trim(), authorName: profile?.name || callerName, triggerAt: Date.now() + reminderMinutes * 60_000 });
        if (modal === "pin") pinNote.mutate({ channel, body: pinBody.trim(), authorName: profile?.name || callerName });
        if (modal === "booking") announceBooking.mutate({ channel: "command", personName: bookingPerson.trim(), amount: bookingAmount.trim() || undefined, note: bookingNote.trim() || undefined, authorName: profile?.name || callerName });
      }} />}
      {notice && <div className="ccc-notice" role="status"><CircleDot />{notice}</div>}
    </main>
  );
}

function LiveMessage({ message, callerName, photoUrl, reactions, onThread, onReaction }: { message: ChannelMessage; callerName: string; photoUrl: string | null; reactions: Record<string, { count: number; names: string[] }>; onThread: () => void; onReaction: (emoji: string) => void }) {
  const mine = message.from === callerName;
  const team = message.role === "agent" && !mine;
  const system = message.role === "system";
  const media = mediaUrls(message.mediaUrl);
  if (system) return <div className="ccc-message ccc-message-system"><span><Activity />{message.body}<time>{formatTime(message.ts)}</time></span></div>;
  return <article className={`ccc-group-message ccc-group-message-${team ? "team" : "customer"} ccc-group-message-${mine ? "right" : "left"}`}><Avatar name={message.from} photoUrl={photoUrl} className={`ccc-group-avatar ${team ? "ccc-group-avatar-team" : "ccc-group-avatar-dispatch"}`} /><div><div className="ccc-message-meta"><strong>{message.from}</strong><em>{team ? "Team" : mine ? "You" : "Office"}</em><time>{formatTime(message.ts)}</time></div>{message.replyToBody && <button type="button" className="ccc-live-quoted-reply" onClick={onThread}>Replying to {message.replyToAuthor}: {message.replyToBody}</button>}<p>{message.body}</p>{media.length > 0 && <div className="ccc-live-message-media">{media.map((url) => <a href={url} target="_blank" rel="noreferrer" key={url}><img src={url} alt="Command attachment" /></a>)}</div>}<div className="ccc-live-message-tools">{Object.entries(reactions).map(([emoji, value]) => <button type="button" key={emoji} onClick={() => onReaction(emoji)} title={value.names.join(", ")}>{emoji} {value.count}</button>)}<button type="button" onClick={() => onReaction("👍")}>👍</button><button type="button" onClick={onThread}>Thread {message.replyCount > 0 && <b>{message.replyCount}</b>}</button></div></div></article>;
}

function IssuesView({ issues, onBack }: { issues: Array<{ id: number; title: string; issueType: string; severity: string; notes: string | null; ownerName: string | null }>; onBack: () => void }) {
  return <div className="ccc-alt-view"><header><div><span>ACTIVE ISSUES</span><h2>{issues.length ? `${issues.length} items need attention` : "No active issues"}</h2></div><button type="button" onClick={onBack}>Back to chat</button></header>{issues.length ? issues.map((issue) => <article className={`ccc-large-issue ${issue.severity === "critical" || issue.severity === "high" ? "" : "amber"}`} key={issue.id}><span className="ccc-alert-icon"><AlertTriangle /></span><div><span>{issue.severity} · {issue.issueType.replaceAll("_", " ")}</span><h3>{issue.title}</h3><p>{issue.notes || "No additional notes have been added."}</p><footer><b>{issue.ownerName ? `Owner: ${issue.ownerName}` : "No owner assigned"}</b></footer></div></article>) : <div className="ccc-live-empty"><ShieldAlert />The issue queue is clear.</div>}</div>;
}

function ThreadsView({ threads, onOpen, onBack }: { threads: Array<{ parentId: number; parentFrom: string; parentBody: string; replyCount: number; lastReplyBody: string | null; lastReplyTs: number; hasUnread: boolean }>; onOpen: (id: number) => void; onBack: () => void }) {
  return <div className="ccc-alt-view"><header><div><span>COMMAND THREADS</span><h2>{threads.length ? `${threads.length} active discussions` : "No active threads"}</h2></div><button type="button" onClick={onBack}>Back to chat</button></header>{threads.length ? threads.map((thread) => <button type="button" className="ccc-call-row ccc-live-thread-card" key={thread.parentId} onClick={() => onOpen(thread.parentId)}><span><MessageSquare /></span><div><strong>{thread.parentFrom}</strong><small>{thread.lastReplyBody || thread.parentBody}</small></div><b className={thread.hasUnread ? "queued" : ""}>{thread.replyCount} replies</b><ChevronRight /></button>) : <div className="ccc-live-empty"><MessageSquare />Start a thread from any command message.</div>}</div>;
}

function ThreadDrawer({ thread, callerName, draft, pending, photoMap, onDraft, onSend, onClose }: { thread: { parent: { id: number; ts: number; from: string; role: string; body: string; mediaUrl: string | null; quickAction: string | null; threadParentId: number | null } | null; replies: Array<{ id: number; ts: number; from: string; role: string; body: string; mediaUrl: string | null; quickAction: string | null; threadParentId: number | null }> } | undefined; callerName: string; draft: string; pending: boolean; photoMap: Record<string, string | null>; onDraft: (value: string) => void; onSend: () => void; onClose: () => void }) {
  return <div className="ccc-live-thread-backdrop" onMouseDown={onClose}><aside className="ccc-live-thread-drawer" onMouseDown={(event) => event.stopPropagation()}><header><div><MessageSquare /><span><strong>Thread</strong><small>Command discussion</small></span></div><button type="button" onClick={onClose}><X /></button></header><div className="ccc-live-thread-messages">{!thread?.parent ? <div className="ccc-live-empty"><Loader2 className="animate-spin" />Loading thread…</div> : <><LiveThreadEntry entry={thread.parent} mine={thread.parent.from === callerName} photo={photoMap[thread.parent.from] ?? null} root />{thread.replies.map((entry) => <LiveThreadEntry entry={entry} key={entry.id} mine={entry.from === callerName} photo={photoMap[entry.from] ?? null} />)}</>}</div><footer><textarea value={draft} onChange={(event) => onDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} placeholder="Reply in thread…" /><button type="button" disabled={!draft.trim() || pending} onClick={onSend}>{pending ? <Loader2 className="animate-spin" /> : <Send />}</button></footer></aside></div>;
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
