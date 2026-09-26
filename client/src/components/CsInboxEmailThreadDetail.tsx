import { useState } from "react";
import DOMPurify from "dompurify";
import { Check, Loader2, Send, Sparkles, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./cs-inbox-email-thread-detail.css";

type CsInboxEmailThreadDetailProps = {
  threadId: string;
  onClose: () => void;
};

/**
 * The direct Gmail thread treatment used by CsInbox2, extracted so Email and
 * Command Chat render the same live message body and reply flow.
 */
export default function CsInboxEmailThreadDetail({ threadId, onClose }: CsInboxEmailThreadDetailProps) {
  const utils = trpc.useUtils();
  const emailInbox = trpc.opsChat.listEmailInboxThreads.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const emailThread = trpc.gmail.getThread.useQuery(
    { threadId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const [reply, setReply] = useState("");
  const [dismissedDraft, setDismissedDraft] = useState(false);
  const emailAiDraft = trpc.opsChat.getEmailDraftByThreadId.useQuery(
    { threadId },
    { staleTime: 20_000, refetchInterval: 15_000, refetchOnWindowFocus: true },
  );
  const dismissEmailDraft = trpc.opsChat.dismissEmailDraft.useMutation();
  const sendEmailReply = trpc.gmail.sendReply.useMutation({
    onSuccess: () => {
      setReply("");
      utils.opsChat.listEmailInboxThreads.invalidate();
      utils.gmail.getThread.invalidate({ threadId });
    },
  });
  const resolveEmailThread = trpc.gmail.completeThread.useMutation({
    onSuccess: () => {
      if (emailAiDraft.data?.id) dismissEmailDraft.mutate({ draftId: emailAiDraft.data.id, dismissedBy: "agent" });
      utils.opsChat.listEmailInboxThreads.invalidate();
      onClose();
    },
  });

  const thread = emailThread.data;
  const inboxEmail = (emailInbox.data?.inboxEmail ?? thread?.inboxEmail ?? "").toLowerCase();
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
  const sendReply = () => {
    if (!reply.trim() || !senderEmail) return;
    sendEmailReply.mutate({ threadId, to: senderEmail, subject, bodyHtml: reply.split("\n").join("<br>") });
  };

  return <section className="cs-email-detail cs-email-detail--dark" aria-label="Email thread detail">
    <header className="cs-email-detail__header">
      <div className="cs-email-detail__title-row">
        <div className="cs-email-detail__title-copy">
          <h1>{subject}</h1>
          <span className="cs-email-detail__status">{status}</span>
        </div>
        <div className="cs-email-detail__actions">
          <button type="button" onClick={() => resolveEmailThread.mutate({ threadId })} disabled={resolveEmailThread.isPending}>
            {resolveEmailThread.isPending ? <Loader2 className="animate-spin" /> : <Check />} {resolveEmailThread.isPending ? "Resolving…" : "Resolve"}
          </button>
          <button type="button" className="cs-email-detail__close" onClick={onClose} aria-label="Close email"><X /></button>
        </div>
      </div>
      <div className="cs-email-detail__sender-row">
        <div className="cs-email-detail__sender">
          <span className="cs-email-detail__avatar">{initials}</span>
          <p><strong>{senderName} {senderEmail ? <i>&lt;{senderEmail}&gt;</i> : null}</strong><small>to: {inboxEmail || "inbox"}</small></p>
        </div>
        <time>{ago(lastMessage?.date)}</time>
      </div>
    </header>

    <main className="cs-email-detail__thread">
      {emailThread.isLoading && <div className="cs-email-detail__state"><Loader2 className="animate-spin" /> Loading thread…</div>}
      {emailThread.isError && <div className="cs-email-detail__state cs-email-detail__state--error"><p>{emailThread.error.message || "Unable to load this Gmail thread."}</p><button type="button" onClick={() => emailThread.refetch()}>Retry</button></div>}
      {!emailThread.isLoading && !emailThread.isError && messages.map(message => {
        const outbound = Boolean(inboxEmail) && message.fromEmail?.toLowerCase() === inboxEmail;
        const messageInitials = (message.from ?? message.fromEmail ?? "?").replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((word: string) => word[0]?.toUpperCase()).join("") || "?";
        const sanitizedHtml = message.bodyHtml ? DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } }) : null;
        return <article key={message.id} className={`cs-email-detail__message${outbound ? " is-outgoing" : ""}`}>
          <header><div className="cs-email-detail__message-sender"><span>{outbound ? "Y" : messageInitials}</span><p><strong>{outbound ? "You" : (message.from || senderName)}</strong><small>{message.fromEmail ? `<${message.fromEmail}>` : ""}</small></p></div><time>{ago(message.date)}</time></header>
          <div className="cs-email-detail__body">
            {sanitizedHtml ? <div className="cs-email-detail__html" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} /> : <div className="cs-email-detail__text">{message.bodyText || message.snippet || "(no content)"}</div>}
          </div>
        </article>;
      })}
      {!emailThread.isLoading && !emailThread.isError && messages.length === 0 && <div className="cs-email-detail__state">No messages in this thread.</div>}
    </main>

    <footer className="cs-email-detail__composer">
      {emailAiDraft.data && !dismissedDraft && <section className="cs-email-detail__draft">
        <header><span><Sparkles /> Madison drafted a reply</span><div><button type="button" onClick={() => { if (emailAiDraft.data?.generatedDraft) { setReply(emailAiDraft.data.generatedDraft); setDismissedDraft(true); } }}>Insert Draft</button><button type="button" aria-label="Dismiss draft" onClick={() => setDismissedDraft(true)}><X /></button></div></header>
        {emailAiDraft.data.intentSummary && <small>{emailAiDraft.data.intentSummary}</small>}
        <p>{emailAiDraft.data.generatedDraft ?? ""}</p>
      </section>}
      <div className="cs-email-detail__compose-box">
        <nav><span className="is-active">Reply</span><span>Internal Note</span></nav>
        <textarea placeholder="Type your reply…" value={reply} onChange={event => setReply(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && reply.trim()) { event.preventDefault(); sendReply(); } }} />
        <div className="cs-email-detail__compose-actions"><span><b>B</b><i>I</i><span>☷</span><span>⌁</span></span><button type="button" disabled={!reply.trim() || sendEmailReply.isPending || !senderEmail} onClick={sendReply}>{sendEmailReply.isPending ? <Loader2 className="animate-spin" /> : <Send />}{sendEmailReply.isPending ? "Sending…" : "Send Reply"}</button></div>
      </div>
    </footer>
  </section>;
}
