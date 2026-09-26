import { useMemo, useState } from "react";
import { Bell, Check, ChevronDown, ChevronLeft, Mail, MoreHorizontal, Search, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import CsInboxEmailThreadDetail from "@/components/CsInboxEmailThreadDetail";
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

function LaneBadge({ lane }: { lane: Lane }) {
  return <span className="email-detail-badge" style={{ color: LANE_COLORS[lane], borderColor: `${LANE_COLORS[lane]}66`, background: `${LANE_COLORS[lane]}16` }}>{lane}</span>;
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

function DetailContext({ threadId, identity, subject, lane, messages, lastMessageAt, close, onResolve, isResolving }: { threadId: string; identity: EmailIdentity; subject: string; lane: Lane; messages: LiveEmailMessage[]; lastMessageAt?: number | null; close: () => void; onResolve: () => void; isResolving: boolean }) {
  return (
    <aside className="email-detail-context" aria-label="Email thread context">
      <section className="email-detail-profile"><div className="email-detail-profile-identity"><CustomerPortrait identity={identity} className="email-detail-portrait-profile" /><div><b>{identity.name}</b><small>{identity.email || "No email address available"}</small></div></div><div className="email-detail-profile-tags"><span>Customer</span><span>Email</span></div></section>
      <section className="email-detail-context-section email-detail-thread-details"><h3>Thread Details <ChevronDown size={14} /></h3><p><span>Thread ID</span><b>{threadId}</b></p><p><span>Subject</span><b>{subject}</b></p><p><span>Last Message</span><b>{relativeTime(lastMessageAt)}</b></p><p><span>Messages</span><b>{messages.length}</b></p><p><span>Status</span><b className={`email-detail-status status-${lane.toLowerCase().replaceAll(" ", "-")}`}>{lane}</b></p></section>
      <section className="email-detail-context-section email-detail-context-actions"><h3>Actions <ChevronDown size={14} /></h3><div><button type="button" onClick={onResolve} disabled={isResolving}><Check size={14} />{isResolving ? "Resolving…" : "Resolve Thread"}</button><button type="button" onClick={close}><ChevronLeft size={14} />Back to Inbox</button><button type="button" className="emails-live-disabled-control" title="Additional actions remain in the existing Inbox route"><MoreHorizontal size={14} />More actions</button></div></section>
    </aside>
  );
}

function EmailDetailWorkspace({ groups, selectedId, detail, detailOnly = false, onPick, onClose, onResolve, isResolving }: {
  groups: Array<{ lane: Lane; threads: LiveEmailThread[] }>;
  selectedId: string;
  detail: LiveEmailDetail | undefined;
  detailOnly?: boolean;
  onPick: (threadId: string) => void;
  onClose: () => void;
  onResolve: () => void;
  isResolving: boolean;
}) {
  const listThread = groups.flatMap(group => group.threads).find(thread => thread.threadId === selectedId);
  const identity = resolveIdentity(detail?.from ?? listThread?.senderName, detail?.fromEmail ?? listThread?.senderEmail);
  const messages = detail?.messages ?? [];
  const lastMessage = messages.at(-1);
  const lane = listThread ? groups.find(group => group.threads.some(thread => thread.threadId === selectedId))?.lane ?? "Needs Response" : "Needs Response";
  const subject = (detail?.subject ?? listThread?.subject ?? "Email Thread").replace(/^\[From:[^\]]*\s*/i, "").trim() || "Email Thread";
  const directDetail = <CsInboxEmailThreadDetail threadId={selectedId} onClose={onClose} />;
  if (detailOnly) return <section className="email-detail-main-only" aria-label="Live email detail page">{directDetail}</section>;
  return <section className="email-detail-workspace emails-live-detail-workspace" aria-label="Live email detail page"><DetailSidebar groups={groups} selectedId={selectedId} onPick={onPick} close={onClose} />{directDetail}<DetailContext threadId={selectedId} identity={identity} subject={subject} lane={lane} messages={messages} lastMessageAt={lastMessage?.date} close={onClose} onResolve={onResolve} isResolving={isResolving} /></section>;
}

type EmailsExactLiveProps = {
  initialThreadId?: string | null;
  onCloseDetail?: () => void;
  detailOnly?: boolean;
};

export default function EmailsExactLive({ initialThreadId = null, onCloseDetail, detailOnly = false }: EmailsExactLiveProps = {}) {
  const [query, setQuery] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId);
  const utils = trpc.useUtils();
  const emailInbox = trpc.opsChat.listEmailInboxThreads.useQuery(undefined, { staleTime: 30_000, refetchOnWindowFocus: true });
  // This direct Gmail query is used only for the existing right context rail.
  // The centered detail itself is the exact CsInbox2 direct renderer above.
  const { data: emailThread } = trpc.gmail.getThread.useQuery({ threadId: selectedThreadId ?? "" }, { enabled: Boolean(selectedThreadId), staleTime: 60_000, refetchOnWindowFocus: false });
  const emailAiDraft = trpc.opsChat.getEmailDraftByThreadId.useQuery({ threadId: selectedThreadId ?? "" }, { enabled: Boolean(selectedThreadId), staleTime: 20_000, refetchInterval: selectedThreadId ? 15_000 : false, refetchOnWindowFocus: true });
  const dismissEmailDraft = trpc.opsChat.dismissEmailDraft.useMutation();
  const resolveEmailThread = trpc.gmail.completeThread.useMutation({
    onSuccess: () => {
      if (emailAiDraft.data?.id) dismissEmailDraft.mutate({ draftId: emailAiDraft.data.id, dismissedBy: "agent" });
      if (onCloseDetail) onCloseDetail();
      else setSelectedThreadId(null);
      utils.opsChat.listEmailInboxThreads.invalidate();
    },
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

  const openThread = (threadId: string) => setSelectedThreadId(threadId);
  const closeThread = () => { if (onCloseDetail) onCloseDetail(); else setSelectedThreadId(null); };
  const resolveThread = () => { if (selectedThreadId) resolveEmailThread.mutate({ threadId: selectedThreadId }); };

  return <main className={`emails-review emails-live ${selectedThreadId ? "has-detail" : ""}${detailOnly ? " is-detail-only" : ""}`}>
    {!selectedThreadId && <header className="emails-utility"><label><Search size={17} /><input aria-label="Search email threads" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search emails…" /><kbd>⌘ K</kbd></label><div><button type="button" className="emails-live-disabled-control" aria-label="Email notifications"><Bell size={18} /></button><span>MIB</span></div></header>}
    {selectedThreadId ? <EmailDetailWorkspace groups={groups} selectedId={selectedThreadId} detail={emailThread as LiveEmailDetail | undefined} detailOnly={detailOnly} onPick={openThread} onClose={closeThread} onResolve={resolveThread} isResolving={resolveEmailThread.isPending} /> : <div className="emails-content">
      <section className="emails-head"><div><span>Customer communication · Live workspace</span><h1><Mail size={27} />Emails</h1><p>Review the live email queue, open thread context, and prepare replies without leaving the customer communication workspace.</p></div><p><Sparkles size={14} />Live threads are grouped by the existing queue rules.</p></section>
      <section className="emails-board-shell"><header><div><span>Inbox board</span><h2>Email Kanban <b>{visibleThreads.length}</b></h2></div><div><button type="button" className="emails-live-disabled-control" title="The live queue keeps its current automatic grouping">Live queue <ChevronDown size={14} /></button><button type="button" className="emails-live-disabled-control" title="Filtering is available through search">Filters</button></div></header><div className="emails-board">
        {emailInbox.isLoading && <div className="emails-live-board-state">Loading emails…</div>}
        {!emailInbox.isLoading && allThreads.length === 0 && <div className="emails-live-board-state">No email conversations yet.</div>}
        {!emailInbox.isLoading && groups.map(group => <section className="emails-lane" key={group.lane}><header><span style={{ background: LANE_COLORS[group.lane] }} /><b>{group.lane}</b><small>{group.threads.length}</small><ChevronDown size={13} /></header><div>{group.threads.map(thread => <EmailCard key={thread.threadId} thread={thread} lane={group.lane} selected={false} onPick={() => openThread(thread.threadId)} />)}{group.threads.length === 0 && <p className="emails-lane-empty">No conversations</p>}</div></section>)}
      </div></section>
    </div>}
  </main>;
}
