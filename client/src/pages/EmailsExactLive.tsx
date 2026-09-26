import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { Bell, Check, ChevronDown, ChevronLeft, Mail, MoreHorizontal, Search, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import "./emails-review.css";
import "./emails-detail-review.css";
import "./emails-detail-compact-header.css";
import "./emails-detail-simplified.css";
import "./emails-detail-leads-cohesion.css";
import "./emails-kanban-cohesion.css";
import "./emails-exact-live.css";

type Lane = "New" | "Needs Response" | "Waiting on Customer" | "At Risk";
type LiveEmailThread = {
  threadId: string;
  senderName: string | null;
  senderEmail: string | null;
  subject: string;
  snippet: string;
  lastMessageAt: number;
  messageCount: number;
  isUnread: boolean;
};
type LiveEmailMessage = {
  id: string;
  from?: string | null;
  fromEmail?: string | null;
  bodyHtml?: string | null;
  bodyText?: string | null;
  snippet?: string | null;
  date?: number | null;
};
type LiveEmailDetail = {
  from?: string | null;
  fromEmail?: string | null;
  inboxEmail?: string | null;
  subject?: string | null;
  messages?: LiveEmailMessage[];
};

type EmailIdentity = { name: string; email: string; initials: string };

const LANES: Lane[] = ["New", "Needs Response", "Waiting on Customer", "At Risk"];
const LANE_COLORS: Record<Lane, string> = {
  New: "#73b7f1",
  "Needs Response": "#dfb34d",
  "Waiting on Customer": "#8aa2b4",
  "At Risk": "#dc6b5c",
};
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

function customerPortraitFor(value: string) {
  const hash = Array.from(value).reduce((total, character) => total + character.charCodeAt(0), 0);
  return CUSTOMER_PORTRAITS[Math.abs(hash) % CUSTOMER_PORTRAITS.length];
}

function initialsFor(value: string) {
  return value
    .replace(/[^A-Za-z ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]?.toUpperCase())
    .join("") || "?";
}

function relativeTime(timestamp?: number | null) {
  if (!timestamp) return "—";
  const age = Math.max(0, Date.now() - timestamp);
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return `${Math.floor(age / 86_400_000)}d ago`;
}

function resolveIdentity(from?: string | null, fromEmail?: string | null): EmailIdentity {
  const relayDomains = ["launch27mail.com", "maidsinblacksupport.com"];
  const rawFrom = from ?? "";
  const rawFromEmail = fromEmail ?? "";
  const fromLooksLikeEmail = /\S+@\S+/.test(rawFrom);
  const isRelay = relayDomains.some(domain => rawFromEmail.toLowerCase().includes(domain));
  const email = fromLooksLikeEmail ? rawFrom : (isRelay ? rawFrom : rawFromEmail);
  const name = fromLooksLikeEmail ? rawFrom.split("@")[0] : (rawFrom || rawFromEmail.split("@")[0] || "Unknown");
  return { name, email, initials: initialsFor(name) };
}

function laneFor(thread: LiveEmailThread, inboxEmail: string, now: number): Lane {
  const isOutbound = Boolean(inboxEmail) && thread.senderEmail?.toLowerCase() === inboxEmail;
  if (isOutbound) return "Waiting on Customer";
  const waitMs = now - (thread.lastMessageAt ?? 0);
  const isAtRisk = waitMs >= 30 * 60 * 1000;
  const isNew = !isAtRisk && waitMs < 24 * 60 * 60 * 1000 && (thread.messageCount ?? 999) <= 2;
  if (isAtRisk) return "At Risk";
  if (isNew) return "New";
  return "Needs Response";
}

function CustomerPortrait({ identity, className }: { identity: EmailIdentity; className: string }) {
  return <img className={`email-detail-portrait ${className}`} src={customerPortraitFor(`${identity.name}|${identity.email}`)} alt="" />;
}

function EmailCard({ thread, lane, selected, onPick }: { thread: LiveEmailThread; lane: Lane; selected: boolean; onPick: () => void }) {
  const identity = resolveIdentity(thread.senderName, thread.senderEmail);
  return (
    <button type="button" className={`emails-card emails-live-card ${selected ? "is-selected" : ""}`} onClick={onPick}>
      <div>
        <CustomerPortrait identity={identity} className="emails-live-card-portrait" />
        <strong>{identity.name}</strong>
        {thread.isUnread && <em>Unread</em>}
        <time>{relativeTime(thread.lastMessageAt)}</time>
      </div>
      <b>{thread.subject || "(no subject)"}</b>
      <p>{thread.snippet || "No preview available"}</p>
      <footer>
        <span>{thread.messageCount} msg{thread.messageCount === 1 ? "" : "s"}</span>
        <span className={`emails-live-lane-marker lane-${lane.toLowerCase().replaceAll(" ", "-")}`}>{lane}</span>
        <span className="emails-live-agent-circle" title="Email workspace">M</span>
      </footer>
    </button>
  );
}

function DetailThreadCard({ thread, lane, selected, onPick }: { thread: LiveEmailThread; lane: Lane; selected: boolean; onPick: () => void }) {
  const identity = resolveIdentity(thread.senderName, thread.senderEmail);
  return (
    <button type="button" className={`email-detail-thread-card ${selected ? "is-selected" : ""}`} onClick={onPick}>
      <div>
        <CustomerPortrait identity={identity} className="email-detail-portrait-card" />
        <strong>{identity.name}</strong>
        {thread.isUnread && <i aria-label="Unread email" />}
        <time>{relativeTime(thread.lastMessageAt)}</time>
      </div>
      <b>{thread.subject || "(no subject)"}</b>
      <p>{thread.snippet || "No preview available"}</p>
    </button>
  );
}

function DetailSidebar({ groups, selectedId, onPick, close }: { groups: Array<{ lane: Lane; threads: LiveEmailThread[] }>; selectedId: string; onPick: (threadId: string) => void; close: () => void }) {
  return (
    <aside className="email-detail-list" aria-label="Email detail list">
      <header>
        <div className="email-detail-list-brand">
          <div><button type="button" className="email-detail-inbox-back" onClick={close}><ChevronLeft size={13} />Back</button></div>
          <button type="button" className="emails-live-disabled-control" title="New-email composition remains available in the existing Inbox route">+ New</button>
        </div>
        <nav><button type="button" onClick={close}>Inbox</button><button type="button" className="is-active">Email</button></nav>
      </header>
      <section>
        <h2>Email Kanban <span>{groups.reduce((total, group) => total + group.threads.length, 0)}</span></h2>
        {groups.map(group => <div className="email-detail-lane" key={group.lane}>
          <header><span style={{ background: LANE_COLORS[group.lane] }} /><b>{group.lane}</b><small>{group.threads.length}</small><ChevronDown size={13} /></header>
          <div>{group.threads.map(thread => <DetailThreadCard key={thread.threadId} thread={thread} lane={group.lane} selected={thread.threadId === selectedId} onPick={() => onPick(thread.threadId)} />)}</div>
        </div>)}
      </section>
    </aside>
  );
}

function DetailMain({ detail, detailUnavailable, reply, setReply, draft, draftDismissed, onInsertDraft, onDismissDraft, onSend, onResolve, isSending, isResolving }: {
  detail: LiveEmailDetail | undefined;
  detailUnavailable: boolean;
  reply: string;
  setReply: (value: string) => void;
  draft: { generatedDraft?: string | null; intentSummary?: string | null } | null | undefined;
  draftDismissed: boolean;
  onInsertDraft: () => void;
  onDismissDraft: () => void;
  onSend: () => void;
  onResolve: () => void;
  isSending: boolean;
  isResolving: boolean;
}) {
  // Direct visual/body treatment copied from CsInbox2 Email detail.
  const thread = detail;
  const inboxEmail = (thread?.inboxEmail ?? "").toLowerCase();
  const relayDomains = ["launch27mail.com", "maidsinblacksupport.com"];
  const rawFrom = thread?.from ?? "";
  const rawFromEmail = thread?.fromEmail ?? "";
  const isRelay = relayDomains.some(domain => rawFromEmail.toLowerCase().includes(domain));
  const fromLooksLikeEmail = /\S+@\S+/.test(rawFrom);
  const senderEmail = fromLooksLikeEmail ? rawFrom : (isRelay ? rawFrom : rawFromEmail);
  const senderName = fromLooksLikeEmail ? rawFrom.split("@")[0] : (rawFrom || rawFromEmail.split("@")[0] || "Unknown");
  const initials = senderName.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase()).join("") || "?";
  const subjectRaw = thread?.subject ?? "Email Thread";
  const subject = subjectRaw.replace(/^\[From:[^\]]*\]\s*/i, "").trim() || subjectRaw;
  const messages = thread?.messages ?? [];
  const lastMessage = messages.at(-1);
  const ago = (timestamp?: number | null) => {
    if (!timestamp) return "";
    const age = Date.now() - timestamp;
    if (age < 60_000) return "just now";
    if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
    if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
    return `${Math.floor(age / 86_400_000)}d ago`;
  };
  const status = (() => {
    if (!lastMessage) return "Needs Response";
    const outbound = Boolean(inboxEmail) && lastMessage.fromEmail?.toLowerCase() === inboxEmail;
    if (outbound) return "Waiting on Customer";
    if (Date.now() - (lastMessage.date ?? 0) >= 30 * 60 * 1000) return "At Risk";
    return messages.length <= 2 ? "New" : "Needs Response";
  })();

  return <main className="email-detail-main em2-main emails-csinbox2-detail-main">
    <header className="em2-main-head">
      <div className="em2-title-row">
        <div className="em2-title-wrap"><div className="em2-subject">{subject}</div><span className="em2-badge">{status}</span></div>
        <div className="em2-head-actions"><button type="button" className="em2-btn" onClick={onResolve} disabled={isResolving}>{isResolving ? "Resolving…" : "✓ Resolve"}</button><button type="button" className="em2-btn emails-live-disabled-control" aria-label="More email actions" title="Additional actions remain in the existing Inbox route"><MoreHorizontal size={16} /></button></div>
      </div>
      <div className="em2-sender-row">
        <div className="em2-sender-left"><div className="em2-avatar">{initials}</div><div><div className="em2-sender-name">{senderName} {senderEmail ? <span className="em2-sender-email">&lt;{senderEmail}&gt;</span> : null}</div><div className="em2-to-line">to: {inboxEmail || "inbox"}⌄</div></div></div>
        <div className="em2-message-age">{ago(lastMessage?.date)}</div>
      </div>
    </header>
    <div className="em2-main-tabs"><button type="button" className="em2-main-tab active">Thread</button><button type="button" className="em2-main-tab">Headers</button><button type="button" className="em2-main-tab">Notes (0)</button><button type="button" className="em2-main-tab">Activity</button></div>
    <section className="em2-thread">
      {!detail && <div className="emails-live-thread-state">{detailUnavailable ? "Saved email content is unavailable for this thread." : "Loading thread…"}</div>}
      {messages.map(message => {
        const outbound = Boolean(inboxEmail) && message.fromEmail?.toLowerCase() === inboxEmail;
        const messageInitials = (message.from ?? message.fromEmail ?? "?").replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((word: string) => word[0]?.toUpperCase()).join("") || "?";
        const sanitizedHtml = message.bodyHtml ? DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } }) : null;
        return <article key={message.id} className={`em2-email-message${outbound ? " outgoing" : ""}`}>
          <header className="em2-msg-head"><div className="em2-msg-who"><div className={`em2-small-avatar${outbound ? " out" : ""}`}>{outbound ? "Y" : messageInitials}</div><div><span className="em2-msg-name">{outbound ? "You" : (message.from || senderName)}</span><span className="em2-msg-email">{message.fromEmail ? `<${message.fromEmail}>` : ""}</span></div></div><div className="em2-msg-time">{ago(message.date)}</div></header>
          <div className="em2-msg-body">{sanitizedHtml ? <div className="em2-html-email-body" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} /> : <div className="em2-text-email-body">{message.bodyText || message.snippet || "(no content)"}</div>}</div>
        </article>;
      })}
      {detail && messages.length === 0 && <div className="emails-live-thread-state">No messages in this thread.</div>}
    </section>
    <footer className="em2-composer">
      <div className="em2-compose-box">
        <div className="em2-compose-tabs"><span className="em2-compose-tab active">Reply</span><span className="em2-compose-tab">Internal Note</span></div>
        {draft && !draftDismissed && <div className="em2-ai-draft" onClick={onInsertDraft}><div className="em2-ai-draft-header"><div className="em2-ai-draft-label"><Sparkles size={13} />Madison drafted a reply</div><div className="em2-ai-draft-actions" onClick={event => event.stopPropagation()}><button type="button" className="em2-ai-draft-use" onClick={onInsertDraft}>Insert Draft</button><button type="button" className="em2-ai-draft-dismiss" aria-label="Dismiss draft" onClick={onDismissDraft}>✕</button></div></div>{draft.intentSummary && <div className="em2-ai-draft-intent">{draft.intentSummary}</div>}<div className="em2-ai-draft-preview">{draft.generatedDraft ?? ""}</div></div>}
        <textarea className="em2-compose-textarea" placeholder={`Reply to ${senderName.split(" ")[0]}…`} value={reply} onChange={event => setReply(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && reply.trim()) { event.preventDefault(); onSend(); } }} />
        <div className="em2-compose-actions"><div className="em2-tools"><span><b>B</b></span><span><i>I</i></span><span>☷</span><span>⌁</span></div><div className="em2-send-wrap"><button type="button" className="em2-btn emails-live-disabled-control" title="Templates remain available in the existing Inbox route">Templates</button><button type="button" className="em2-send" disabled={!reply.trim() || isSending || !senderEmail} onClick={onSend}>{isSending ? "Sending…" : "Send Reply"}<Send size={13} /></button></div></div>
      </div>
    </footer>
  </main>;
}

function DetailContext({ threadId, identity, subject, lane, messages, lastMessageAt, close, onResolve, isResolving }: { threadId: string; identity: EmailIdentity; subject: string; lane: Lane; messages: LiveEmailMessage[]; lastMessageAt?: number | null; close: () => void; onResolve: () => void; isResolving: boolean }) {
  return (
    <aside className="email-detail-context" aria-label="Email thread context">
      <section className="email-detail-profile"><div className="email-detail-profile-identity"><CustomerPortrait identity={identity} className="email-detail-portrait-profile" /><div><b>{identity.name}</b><small>{identity.email || "No email address available"}</small></div></div><div className="email-detail-profile-tags"><span>Customer</span><span>Email</span></div></section>
      <section className="email-detail-context-section email-detail-thread-details"><h3>Thread Details <ChevronDown size={14} /></h3><p><span>Thread ID</span><b>{threadId}</b></p><p><span>Subject</span><b>{subject}</b></p><p><span>Last Message</span><b>{relativeTime(lastMessageAt)}</b></p><p><span>Messages</span><b>{messages.length}</b></p><p><span>Status</span><b className={`email-detail-status status-${lane.toLowerCase().replaceAll(" ", "-")}`}>{lane}</b></p></section>
      <section className="email-detail-context-section email-detail-context-actions"><h3>Actions <ChevronDown size={14} /></h3><div><button type="button" onClick={onResolve} disabled={isResolving}><Check size={14} />{isResolving ? "Resolving…" : "Resolve Thread"}</button><button type="button" onClick={close}><ChevronLeft size={14} />Back to Inbox</button><button type="button" className="emails-live-disabled-control" title="Additional actions remain in the existing Inbox route"><MoreHorizontal size={14} />More actions</button></div></section>
    </aside>
  );
}

function EmailDetailWorkspace({ groups, selectedId, detail, detailUnavailable, detailOnly = false, reply, setReply, draft, draftDismissed, onPick, onClose, onInsertDraft, onDismissDraft, onSend, onResolve, isSending, isResolving }: {
  groups: Array<{ lane: Lane; threads: LiveEmailThread[] }>;
  selectedId: string;
  detail: LiveEmailDetail | undefined;
  detailUnavailable: boolean;
  detailOnly?: boolean;
  reply: string;
  setReply: (value: string) => void;
  draft: { generatedDraft?: string | null; intentSummary?: string | null } | null | undefined;
  draftDismissed: boolean;
  onPick: (threadId: string) => void;
  onClose: () => void;
  onInsertDraft: () => void;
  onDismissDraft: () => void;
  onSend: () => void;
  onResolve: () => void;
  isSending: boolean;
  isResolving: boolean;
}) {
  const listThread = groups.flatMap(group => group.threads).find(thread => thread.threadId === selectedId);
  const identity = resolveIdentity(detail?.from ?? listThread?.senderName, detail?.fromEmail ?? listThread?.senderEmail);
  const inboxEmail = (detail?.inboxEmail ?? "").toLowerCase();
  const lastMessage = detail?.messages?.at(-1);
  const lane = listThread ? groups.find(group => group.threads.some(thread => thread.threadId === selectedId))?.lane ?? "Needs Response" : "Needs Response";
  const subject = (detail?.subject ?? listThread?.subject ?? "Email Thread").replace(/^\[From:[^\]]*\]\s*/i, "").trim() || "Email Thread";
  const detailMain = <DetailMain detail={detail} detailUnavailable={detailUnavailable} reply={reply} setReply={setReply} draft={draft} draftDismissed={draftDismissed} onInsertDraft={onInsertDraft} onDismissDraft={onDismissDraft} onSend={onSend} onResolve={onResolve} isSending={isSending} isResolving={isResolving} />;
  if (detailOnly) return <section className="email-detail-main-only" aria-label="Live email detail page">{detailMain}</section>;
  return <section className="email-detail-workspace emails-live-detail-workspace" aria-label="Live email detail page"><DetailSidebar groups={groups} selectedId={selectedId} onPick={onPick} close={onClose} />{detailMain}<DetailContext threadId={selectedId} identity={identity} subject={subject} lane={lane} messages={detail?.messages ?? []} lastMessageAt={lastMessage?.date} close={onClose} onResolve={onResolve} isResolving={isResolving} /></section>;
}

type EmailsExactLiveProps = {
  initialThreadId?: string | null;
  onCloseDetail?: () => void;
  detailOnly?: boolean;
};

export default function EmailsExactLive({ initialThreadId = null, onCloseDetail, detailOnly = false }: EmailsExactLiveProps = {}) {
  const [query, setQuery] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId);
  const [emailReply, setEmailReply] = useState("");
  const [dismissedDrafts, setDismissedDrafts] = useState<Set<string>>(new Set());
  const utils = trpc.useUtils();
  const emailInbox = trpc.opsChat.listEmailInboxThreads.useQuery(undefined, { staleTime: 30_000, refetchOnWindowFocus: true });
  const { data: emailThread, isLoading: emailThreadLoading, isError: emailThreadError } = trpc.gmail.getThread.useQuery({ threadId: selectedThreadId ?? "" }, { enabled: Boolean(selectedThreadId), staleTime: 60_000, refetchOnWindowFocus: false });
  const { data: storedEmailThread, isLoading: storedEmailThreadLoading } = trpc.gmail.getStoredThread.useQuery({ threadId: selectedThreadId ?? "" }, { enabled: Boolean(selectedThreadId) && emailThreadError, staleTime: 30_000, refetchOnWindowFocus: false });
  const detail = (emailThread ?? storedEmailThread) as LiveEmailDetail | undefined;
  const detailUnavailable = emailThreadError && !storedEmailThreadLoading && !storedEmailThread;
  const emailAiDraft = trpc.opsChat.getEmailDraftByThreadId.useQuery({ threadId: selectedThreadId ?? "" }, { enabled: Boolean(selectedThreadId), staleTime: 20_000, refetchInterval: selectedThreadId ? 15_000 : false, refetchOnWindowFocus: true });
  const dismissEmailDraft = trpc.opsChat.dismissEmailDraft.useMutation();
  const sendEmailReply = trpc.gmail.sendReply.useMutation({
    onSuccess: () => {
      setEmailReply("");
      utils.opsChat.listEmailInboxThreads.invalidate();
      if (selectedThreadId) utils.gmail.getThread.invalidate({ threadId: selectedThreadId });
    },
    onError: error => toast.error(error.message || "Failed to send email reply"),
  });
  const resolveEmailThread = trpc.gmail.completeThread.useMutation({
    onSuccess: () => {
      if (emailAiDraft.data?.id) dismissEmailDraft.mutate({ draftId: emailAiDraft.data.id, dismissedBy: "agent" });
      if (onCloseDetail) onCloseDetail();
      else setSelectedThreadId(null);
      utils.opsChat.listEmailInboxThreads.invalidate();
    },
    onError: error => toast.error(error.message || "Failed to resolve thread"),
  });

  const allThreads = (emailInbox.data?.threads ?? []) as LiveEmailThread[];
  const inboxEmail = emailInbox.data?.inboxEmail?.toLowerCase() ?? "";
  const now = Date.now();
  const visibleThreads = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return allThreads;
    return allThreads.filter(thread => [thread.senderName, thread.senderEmail, thread.subject, thread.snippet].filter(Boolean).join(" ").toLowerCase().includes(term));
  }, [allThreads, query]);
  const groups = useMemo(() => LANES.map(lane => ({ lane, threads: visibleThreads.filter(thread => laneFor(thread, inboxEmail, now) === lane).sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)) })), [visibleThreads, inboxEmail, now]);

  const openThread = (threadId: string) => {
    setSelectedThreadId(threadId);
  };
  const closeThread = () => {
    if (onCloseDetail) onCloseDetail();
    else setSelectedThreadId(null);
  };
  const insertDraft = () => {
    const copy = emailAiDraft.data?.generatedDraft;
    if (!copy || !selectedThreadId) return;
    setEmailReply(copy);
    setDismissedDrafts(previous => new Set(Array.from(previous).concat(selectedThreadId)));
  };
  const dismissDraft = () => {
    if (!selectedThreadId) return;
    setDismissedDrafts(previous => new Set(Array.from(previous).concat(selectedThreadId)));
  };
  const sendReply = () => {
    if (!selectedThreadId || !emailReply.trim()) return;
    const currentDetail = detail;
    const identity = resolveIdentity(currentDetail?.from, currentDetail?.fromEmail);
    const subject = (currentDetail?.subject ?? "Email Thread").replace(/^\[From:[^\]]*\]\s*/i, "").trim() || "Email Thread";
    if (!identity.email) {
      toast.error("No reply address is available for this thread");
      return;
    }
    sendEmailReply.mutate({ threadId: selectedThreadId, to: identity.email, subject, bodyHtml: emailReply.split("\n").join("<br>") });
  };
  const resolveThread = () => {
    if (selectedThreadId) resolveEmailThread.mutate({ threadId: selectedThreadId });
  };

  return <main className={`emails-review emails-live ${selectedThreadId ? "has-detail" : ""}${detailOnly ? " is-detail-only" : ""}`}>
    {!selectedThreadId && <header className="emails-utility"><label><Search size={17} /><input aria-label="Search email threads" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search emails…" /><kbd>⌘ K</kbd></label><div><button type="button" className="emails-live-disabled-control" aria-label="Email notifications"><Bell size={18} /></button><span>MIB</span></div></header>}
    {selectedThreadId ? <EmailDetailWorkspace groups={groups} selectedId={selectedThreadId} detail={detail} detailUnavailable={detailUnavailable} detailOnly={detailOnly} reply={emailReply} setReply={setEmailReply} draft={emailAiDraft.data} draftDismissed={dismissedDrafts.has(selectedThreadId)} onPick={openThread} onClose={closeThread} onInsertDraft={insertDraft} onDismissDraft={dismissDraft} onSend={sendReply} onResolve={resolveThread} isSending={sendEmailReply.isPending} isResolving={resolveEmailThread.isPending} /> : <div className="emails-content">
      <section className="emails-head"><div><span>Customer communication · Live workspace</span><h1><Mail size={27} />Emails</h1><p>Review the live email queue, open thread context, and prepare replies without leaving the customer communication workspace.</p></div><p><Sparkles size={14} />Live threads are grouped by the existing queue rules.</p></section>
      <section className="emails-board-shell"><header><div><span>Inbox board</span><h2>Email Kanban <b>{visibleThreads.length}</b></h2></div><div><button type="button" className="emails-live-disabled-control" title="The live queue keeps its current automatic grouping">Live queue <ChevronDown size={14} /></button><button type="button" className="emails-live-disabled-control" title="Filtering is available through search">Filters</button></div></header><div className="emails-board">
        {emailInbox.isLoading && <div className="emails-live-board-state">Loading emails…</div>}
        {!emailInbox.isLoading && allThreads.length === 0 && <div className="emails-live-board-state">No email conversations yet.</div>}
        {!emailInbox.isLoading && groups.map(group => <section className="emails-lane" key={group.lane}><header><span style={{ background: LANE_COLORS[group.lane] }} /><b>{group.lane}</b><small>{group.threads.length}</small><ChevronDown size={13} /></header><div>{group.threads.map(thread => <EmailCard key={thread.threadId} thread={thread} lane={group.lane} selected={false} onPick={() => openThread(thread.threadId)} />)}{group.threads.length === 0 && <p className="emails-lane-empty">No conversations</p>}</div></section>)}
      </div></section>
    </div>}
  </main>;
}
