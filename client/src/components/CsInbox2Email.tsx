import React, { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { trpc } from "@/lib/trpc";
import "./cs-inbox2-email.css";

type CsInbox2EmailProps = {
  initialThreadId?: string | null;
  detailOnly?: boolean;
  onCloseDetail?: () => void;
};

/**
 * One-way copy of the Email branch in CsInbox2.
 * CsInbox2 itself is intentionally not imported or modified.
 * The Gmail procedures, query inputs/options, mutation callbacks, and Email
 * message markup below are copied from CsInbox2's working Email branch.
 */
export default function CsInbox2Email({ initialThreadId = null, detailOnly = false, onCloseDetail }: CsInbox2EmailProps = {}) {
  // Copied from CsInbox2 Email state and queries.
  const [selectedEmailThreadId, setSelectedEmailThreadId] = useState<string | null>(initialThreadId);
  const emailInbox = trpc.opsChat.listEmailInboxThreads.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const emailUtils = trpc.useUtils();
  const emailThread = trpc.gmail.getThread.useQuery(
    { threadId: selectedEmailThreadId! },
    { enabled: !!selectedEmailThreadId, staleTime: 60_000, refetchOnWindowFocus: false }
  );
  const [emailReply, setEmailReply] = useState("");
  const [dismissedEmailDrafts, setDismissedEmailDrafts] = useState<Set<string>>(new Set());
  const emailAiDraft = trpc.opsChat.getEmailDraftByThreadId.useQuery(
    { threadId: selectedEmailThreadId! },
    { enabled: !!selectedEmailThreadId, staleTime: 20_000, refetchInterval: 15_000, refetchOnWindowFocus: true }
  );
  const sendEmailReply = trpc.gmail.sendReply.useMutation({
    onSuccess: () => {
      setEmailReply("");
      emailUtils.opsChat.listEmailInboxThreads.invalidate();
      emailUtils.gmail.getThread.invalidate({ threadId: selectedEmailThreadId! });
    },
  });
  const dismissEmailDraftMut = trpc.opsChat.dismissEmailDraft.useMutation();
  const closeDetail = () => {
    if (onCloseDetail) onCloseDetail();
    else setSelectedEmailThreadId(null);
  };
  const resolveEmailThread = trpc.gmail.completeThread.useMutation({
    onSuccess: () => {
      if (emailAiDraft.data?.id) {
        dismissEmailDraftMut.mutate({ draftId: emailAiDraft.data.id, dismissedBy: "agent" });
      }
      closeDetail();
      emailUtils.opsChat.listEmailInboxThreads.invalidate();
    },
  });

  const threads = emailInbox.data?.threads ?? [];
  const inboxEmail = (emailInbox.data?.inboxEmail ?? emailThread.data?.inboxEmail ?? "").toLowerCase();
  const now = Date.now();
  const getEmailColumn = (thread: typeof threads[number]) => {
    const isOutbound = inboxEmail && thread.senderEmail?.toLowerCase() === inboxEmail;
    if (isOutbound) return "Waiting on Customer";
    const waitMs = now - (thread.lastMessageAt ?? 0);
    const isAtRisk = waitMs >= 30 * 60 * 1000;
    const isNew = !isAtRisk && waitMs < 24 * 60 * 60 * 1000 && (thread.messageCount ?? 999) <= 2;
    if (isAtRisk) return "At Risk";
    if (isNew) return "New";
    return "Needs Response";
  };
  const emailColumns = useMemo(() => ["New", "Needs Response", "Waiting on Customer", "At Risk"].map(label => ({
    label,
    threads: threads.filter(thread => getEmailColumn(thread) === label).sort((left, right) => (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0)),
  })), [threads, inboxEmail, now]);
  const ago = (timestamp?: number | null) => {
    const age = Date.now() - (timestamp ?? 0);
    if (age < 60_000) return "just now";
    if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
    if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
    return `${Math.floor(age / 86_400_000)}d ago`;
  };

  if (!selectedEmailThreadId) {
    return <main className="em2-copy-page" aria-label="Email inbox">
      <section className="em2-copy-sidebar">
        <header className="em2-copy-sidebar-header"><strong>Email</strong><span>Kanban</span></header>
        {emailInbox.isLoading ? <p className="em2-copy-empty">Loading emails…</p> : emailColumns.map(column => <section className="em2-copy-column" key={column.label}>
          <header><span className={`em2-copy-dot ${column.label.toLowerCase().replaceAll(" ", "-")}`} /> <b>{column.label}</b><small>{column.threads.length}</small></header>
          {column.threads.map(thread => <button type="button" className="em2-copy-thread-card" key={thread.threadId} onClick={() => setSelectedEmailThreadId(thread.threadId)}>
            <div><b>{thread.senderName ?? thread.senderEmail ?? "Unknown"}</b><time>{ago(thread.lastMessageAt)}</time></div>
            <strong>{thread.subject}</strong><p>{thread.snippet}</p>
          </button>)}
          {!column.threads.length && <p className="em2-copy-empty">No conversations</p>}
        </section>)}
      </section>
      <section className="em2-copy-placeholder"><p>Select an email to open its full thread.</p></section>
    </main>;
  }

  // Copied from CsInbox2's Email detail branch.
  const t = emailThread.data;
  const RELAY_DOMAINS = ["launch27mail.com", "maidsinblacksupport.com"];
  const rawFrom = t?.from ?? "";
  const rawFromEmail = t?.fromEmail ?? "";
  const isRelay = RELAY_DOMAINS.some(domain => rawFromEmail.toLowerCase().includes(domain));
  const fromLooksLikeEmail = /\S+@\S+/.test(rawFrom);
  const senderEmail = fromLooksLikeEmail ? rawFrom : (isRelay ? rawFrom : rawFromEmail);
  const senderName = fromLooksLikeEmail ? rawFrom.split("@")[0] : (rawFrom || rawFromEmail.split("@")[0] || "Unknown");
  const initials = senderName.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((word: string) => word[0].toUpperCase()).join("") || "??";
  const rawSubject = t?.subject ?? "Email Thread";
  const subject = rawSubject.replace(/^\[From:[^\]]*\]\s*/i, "").trim() || rawSubject;
  const msgCount = t?.messages?.length ?? 0;
  const lastMessage = t?.messages?.[t.messages.length - 1];
  const columnLabel = (() => {
    if (!lastMessage) return "Needs Response";
    const isOutbound = inboxEmail && lastMessage.fromEmail?.toLowerCase() === inboxEmail;
    if (isOutbound) return "Waiting on Customer";
    const waitMs = Date.now() - (lastMessage.date ?? 0);
    if (waitMs >= 30 * 60 * 1000) return "At Risk";
    if (msgCount <= 2) return "New";
    return "Needs Response";
  })();

  return <main className={`em2-copy-detail${detailOnly ? " em2-copy-detail-only" : ""}`} aria-label="Email thread">
    {!detailOnly && <aside className="em2-copy-rail"><button type="button" onClick={closeDetail}>←</button></aside>}
    {!detailOnly && <aside className="em2-copy-detail-sidebar">
      <header><b>Email Kanban</b><span>{threads.length}</span></header>
      {emailColumns.map(column => <section key={column.label}><h2>{column.label} <small>{column.threads.length}</small></h2>{column.threads.map(thread => <button type="button" key={thread.threadId} className={`em2-copy-thread-card${thread.threadId === selectedEmailThreadId ? " active" : ""}`} onClick={() => setSelectedEmailThreadId(thread.threadId)}><div><b>{thread.senderName ?? thread.senderEmail ?? "Unknown"}</b><time>{ago(thread.lastMessageAt)}</time></div><strong>{thread.subject}</strong><p>{thread.snippet}</p></button>)}</section>)}
    </aside>}
    <section className="em2-copy-main">
      <header className="em2-copy-main-head">
        <button type="button" className="em2-copy-back" onClick={closeDetail}>← Back to list</button>
        <div className="em2-copy-title-row"><div><h1>{subject}</h1><span>{columnLabel}</span></div><button type="button" onClick={() => resolveEmailThread.mutate({ threadId: selectedEmailThreadId })} disabled={resolveEmailThread.isPending}>{resolveEmailThread.isPending ? "Resolving..." : "✓ Resolve"}</button></div>
        <div className="em2-copy-sender"><i>{initials}</i><div><b>{senderName} <small>&lt;{senderEmail}&gt;</small></b><span>to: {inboxEmail || "inbox"}</span></div><time>{ago(lastMessage?.date)}</time></div>
      </header>
      <nav className="em2-copy-tabs"><b>Thread</b><span>Headers</span><span>Notes (0)</span><span>Activity</span></nav>
      <section className="em2-copy-thread">
        {!t && <p className="em2-copy-empty">Loading thread...</p>}
        {t?.messages?.map(message => {
          const isOutbound = inboxEmail && message.fromEmail?.toLowerCase() === inboxEmail;
          const messageInitials = (message.from ?? message.fromEmail ?? "?").replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((word: string) => word[0].toUpperCase()).join("") || "?";
          const sanitizedHtml = message.bodyHtml ? DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } }) : null;
          return <article key={message.id} className={`em2-copy-message${isOutbound ? " outgoing" : ""}`}>
            <header><div><i>{isOutbound ? "Y" : messageInitials}</i><span><b>{isOutbound ? "You" : (message.from || senderName)}</b><small>&lt;{message.fromEmail ?? ""}&gt;</small></span></div><time>{ago(message.date)}</time></header>
            <div className="em2-copy-body">{sanitizedHtml ? <div className="em2-copy-html-body" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} /> : <div style={{ whiteSpace: "pre-wrap" }}>{message.bodyText || message.snippet || "(no content)"}</div>}</div>
          </article>;
        })}
      </section>
      <footer className="em2-copy-composer">
        {emailAiDraft.data && !dismissedEmailDrafts.has(selectedEmailThreadId) && <section className="em2-copy-draft"><header><b>✦ Madison drafted a reply</b><span><button type="button" onClick={() => { setEmailReply(emailAiDraft.data?.generatedDraft ?? ""); setDismissedEmailDrafts(previous => new Set(Array.from(previous).concat(selectedEmailThreadId))); }}>Insert Draft</button><button type="button" onClick={() => setDismissedEmailDrafts(previous => new Set(Array.from(previous).concat(selectedEmailThreadId)))}>×</button></span></header>{emailAiDraft.data.intentSummary && <i>{emailAiDraft.data.intentSummary}</i>}<p>{emailAiDraft.data.generatedDraft ?? ""}</p></section>}
        <textarea placeholder="Type your reply..." value={emailReply} onChange={event => setEmailReply(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && emailReply.trim()) sendEmailReply.mutate({ threadId: selectedEmailThreadId, to: senderEmail, subject, bodyHtml: emailReply.split("\n").join("<br>") }); }} />
        <div><span>B　/　☷　⌁</span><span><button type="button">Templates</button><button type="button" disabled={!emailReply.trim() || sendEmailReply.isPending} onClick={() => { if (emailReply.trim()) sendEmailReply.mutate({ threadId: selectedEmailThreadId, to: senderEmail, subject, bodyHtml: emailReply.split("\n").join("<br>") }); }}>{sendEmailReply.isPending ? "Sending..." : "Send Reply"}</button></span></div>
      </footer>
    </section>
    {!detailOnly && <aside className="em2-copy-right"><header><i>{initials}</i><div><b>{senderName}</b><small>{senderEmail}</small></div></header><span>Customer</span><span>Email</span><section><h2>Thread Details</h2><p>Thread ID <b>{selectedEmailThreadId}</b></p><p>Subject <b>{subject}</b></p><p>Messages <b>{msgCount}</b></p><p>Status <b>{columnLabel}</b></p></section><button type="button" onClick={() => resolveEmailThread.mutate({ threadId: selectedEmailThreadId })}>{resolveEmailThread.isPending ? "Resolving..." : "✓ Resolve Thread"}</button></aside>}
  </main>;
}
