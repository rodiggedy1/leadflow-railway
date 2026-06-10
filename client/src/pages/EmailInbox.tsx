/**
 * EmailInbox — Shared Gmail inbox for all agents
 * Wired to real Gmail data via tRPC gmail.* procedures.
 * Real-time refresh via SSE gmail_new_messages event.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import DOMPurify from "dompurify";
import {
  Mail, Search, Paperclip, Link2, Send, RefreshCw,
  Loader2, AlertCircle, Archive, MailOpen, MailCheck, Plus, Sparkles, Flag, X, FileText,
} from "lucide-react";
import { useOpsStream } from "@/hooks/useOpsStream";
import { senderColorClass, senderHex } from "@/lib/senderColor";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type RouterOutput = inferRouterOutputs<AppRouter>;
type GmailThread = RouterOutput["gmail"]["listThreads"]["threads"][number];
type GmailMessage = GmailThread["messages"][number] & {
  sentBy?: { name: string; photoUrl: string | null } | null;
};

function getInitials(name: string): string {
  return name.split(/\s+/).map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase();
}

function formatDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function NotConnectedBanner() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-black text-slate-800 mb-2">Gmail not connected</h2>
        <p className="text-sm text-slate-500 mb-6">
          An admin needs to complete the one-time OAuth flow to connect the shared inbox.
        </p>
        <a
          href="/api/gmail/oauth/start"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-colors"
        >
          Connect Gmail Account
        </a>
      </div>
    </div>
  );
}

function ThreadItem({ thread, active, onClick, isIssue, issueSummary }: { thread: GmailThread; active: boolean; onClick: () => void; isIssue?: boolean; issueSummary?: string | null }) {
  const senderName = thread.from || thread.fromEmail || "?";
  const accentColor = isIssue ? "#dc2626" : senderHex(senderName);
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3.5 border-b transition-colors group relative",
        isIssue ? "border-red-100" : "border-slate-100",
        active
          ? isIssue ? "bg-red-50/80" : "bg-blue-50/70"
          : isIssue
          ? "bg-red-50/40 hover:bg-red-50/70"
          : thread.isUnread
          ? "bg-white hover:bg-slate-50/80"
          : "bg-white hover:bg-slate-50/60"
      )}
    >
      {/* Left accent bar */}
      {(active || isIssue) && (
        <span className={cn(
          "absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full",
          isIssue ? "bg-red-500" : "bg-blue-500"
        )} />
      )}
      <div className="flex items-start gap-2.5">
        {/* Sender avatar */}
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5",
            isIssue ? "bg-red-100 text-red-700" : senderColorClass(senderName)
          )}
        >
          {isIssue ? <Flag className="w-3.5 h-3.5" /> : getInitials(senderName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span
              className={cn("text-sm leading-snug truncate font-bold")}
              style={{ color: accentColor }}
            >
              {senderName}
            </span>
            <span className="text-[11px] text-slate-400 shrink-0">{formatDate(thread.date)}</span>
          </div>
          <p className={cn("text-xs leading-snug truncate mb-1", thread.isUnread ? "text-slate-700 font-medium" : "text-slate-500")}>
            {thread.subject}
          </p>
          {isIssue && issueSummary ? (
            <p className="text-[11px] text-red-500 line-clamp-1 leading-relaxed font-medium">
              {issueSummary}
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 line-clamp-1 leading-relaxed">
              {thread.snippet?.slice(0, 80)}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {isIssue && (
              <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
                ISSUE
              </span>
            )}
            {thread.isUnread && (
              <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                UNREAD
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

/** Renders a single attachment — image thumbnail or file download chip */
function AttachmentItem({ messageId, att }: {
  messageId: string;
  att: { filename: string; mimeType: string; attachmentId: string };
}) {
  const isImage = att.mimeType.startsWith("image/");
  const attachmentQuery = trpc.gmail.getAttachment.useQuery(
    { messageId, attachmentId: att.attachmentId, mimeType: att.mimeType },
    { staleTime: Infinity, retry: false }
  );
  if (isImage) {
    return (
      <div className="mt-2">
        {attachmentQuery.isLoading ? (
          <div className="w-48 h-32 rounded-xl bg-slate-100 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : attachmentQuery.data ? (
          <a href={attachmentQuery.data.dataUrl} download={att.filename} target="_blank" rel="noreferrer">
            <img
              src={attachmentQuery.data.dataUrl}
              alt={att.filename}
              className="max-w-sm max-h-64 rounded-xl border border-slate-100 object-contain cursor-pointer hover:opacity-90 transition-opacity"
            />
          </a>
        ) : (
          <div className="flex items-center gap-2 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5" /> Failed to load image
          </div>
        )}
      </div>
    );
  }
  // Non-image: download chip
  return (
    <div className="mt-2">
      {attachmentQuery.data ? (
        <a
          href={attachmentQuery.data.dataUrl}
          download={att.filename}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors"
        >
          <FileText className="w-3.5 h-3.5 text-slate-400" />
          <span className="truncate max-w-[180px]">{att.filename}</span>
        </a>
      ) : attachmentQuery.isLoading ? (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {att.filename}
        </div>
      ) : (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-100 bg-red-50 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5" /> {att.filename}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: GmailMessage }) {
  const sanitizedHtml = msg.bodyHtml ? DOMPurify.sanitize(msg.bodyHtml, { USE_PROFILES: { html: true } }) : null;
  const senderName = msg.from || msg.fromEmail || "?";
  const accentColor = senderHex(senderName);
  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(15,23,42,0.06)] p-6 mb-4">
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100">
        <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0", senderColorClass(senderName))}>
          {getInitials(senderName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-900 truncate" style={{ color: accentColor }}>{senderName}</p>
          <p className="text-xs text-slate-400 truncate">
            {msg.fromEmail !== msg.from && msg.fromEmail ? `${msg.fromEmail} · ` : ""}
            {formatDate(msg.date)}
          </p>
        </div>
      </div>
      {sanitizedHtml ? (
        <div
          className="text-[14px] text-slate-700 leading-relaxed prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      ) : (
        <div className="text-[14px] text-slate-700 leading-relaxed whitespace-pre-wrap">
          {msg.bodyText || msg.snippet}
        </div>
      )}
      {/* Attachments */}
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {msg.attachments.map((att) => (
            <AttachmentItem key={att.attachmentId} messageId={msg.id} att={att} />
          ))}
        </div>
      )}
      {msg.sentBy && (
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
          {msg.sentBy.photoUrl ? (
            <img
              src={msg.sentBy.photoUrl}
              alt={msg.sentBy.name}
              className="w-5 h-5 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className={cn("w-5 h-5 rounded-full flex items-center justify-center font-bold text-[9px] shrink-0", senderColorClass(msg.sentBy.name))}>
              {getInitials(msg.sentBy.name)}
            </div>
          )}
          <span className="text-[11px] text-slate-400">Sent by <span className="font-semibold text-slate-500">{msg.sentBy.name}</span></span>
        </div>
      )}
    </div>
  );
}

function ComposeModal({ onClose }: { onClose: () => void }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const utils = trpc.useUtils();
  const composeMutation = trpc.gmail.composeNew.useMutation({
    onSuccess: () => { toast.success("Email sent!"); utils.gmail.listThreads.invalidate(); onClose(); },
    onError: (err) => toast.error(err.message || "Failed to send email"),
  });
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-6" style={{ paddingRight: "280px" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <p className="font-bold text-sm text-slate-800">New Email</p>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-xs">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <Input placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} className="text-sm" />
          <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="text-sm" />
          <Textarea
            placeholder="Write your message…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[200px] text-sm resize-none"
          />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
          <div className="flex items-center gap-3 text-slate-400">
            <button className="hover:text-slate-600"><Paperclip className="w-4 h-4" /></button>
            <button className="hover:text-slate-600"><Link2 className="w-4 h-4" /></button>
          </div>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs gap-1.5"
            disabled={composeMutation.isPending || !to || !subject || !body}
            onClick={() => composeMutation.mutate({ to, subject, bodyHtml: body.replace(/\n/g, "<br>") })}
          >
            {composeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function CustomerContextPanel({ threadFromEmail, threadFrom }: { threadFromEmail: string | null; threadFrom?: string | null }) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validEmail = threadFromEmail && emailRegex.test(threadFromEmail) ? threadFromEmail : null;

  const contextQuery = trpc.gmail.getCustomerContext.useQuery(
    { email: validEmail! },
    { enabled: Boolean(validEmail), staleTime: 60_000, retry: false }
  );

  const { lead, session, completedJobs: jobs } = contextQuery.data ?? {};

  const stageBadgeColor: Record<string, string> = {
    BOOKED: "bg-green-100 text-green-700",
    DONE: "bg-slate-100 text-slate-600",
    NOT_INTERESTED: "bg-red-100 text-red-600",
    UNHANDLED: "bg-amber-100 text-amber-700",
  };

  const senderName = lead?.name ?? validEmail ?? "?";

  return (
    <aside className="w-[260px] shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {!validEmail ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
              <Mail className="w-5 h-5 text-slate-300" />
            </div>
            <p className="text-xs text-slate-400">Select a thread to see customer context</p>
          </div>
        </div>
      ) : contextQuery.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
        </div>
      ) : (
        <div className="p-4 space-y-5">
          {/* Sender header */}
          <div className="flex items-center gap-3 pt-1">
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0", senderColorClass(senderName))}>
              {getInitials(senderName)}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm text-slate-900 truncate">{lead?.name ?? threadFrom ?? validEmail ?? "Unknown"}</p>
              <p className="text-xs text-slate-400 truncate">{validEmail}</p>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-slate-100" />

          {/* Quote / Lead data */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Cleaning Customer Data</p>
            {lead ? (
              <div className="bg-slate-50 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-600 font-medium">{lead.serviceType ?? "Service"}</span>
                  {session?.stage && (
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", stageBadgeColor[session.stage] ?? "bg-blue-50 text-blue-700")}>
                      {session.stage}
                    </span>
                  )}
                </div>
                {lead.phone && <p className="text-xs text-slate-400">{lead.phone}</p>}
              </div>
            ) : (
              <div className="rounded-xl p-3 border border-dashed border-slate-200 text-center">
                <p className="text-xs text-slate-400 italic">No customer record found</p>
              </div>
            )}
          </div>

          {/* Home profile */}
          {lead && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Home Profile</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Est.", value: session?.quotedPrice ? `$${session.quotedPrice}` : "—" },
                  { label: "Beds/Baths", value: lead.bedrooms && lead.bathrooms ? `${lead.bedrooms}/${lead.bathrooms}` : "—" },
                  { label: "Extras", value: lead.extras ? (() => { try { const e = JSON.parse(lead.extras); return Array.isArray(e) && e.length > 0 ? `${e.length}` : "0"; } catch { return "—"; } })() : "0" },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-slate-50 rounded-xl p-2.5 text-center">
                    <p className="text-sm font-bold text-slate-800">{value}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Job details from session */}
          {session && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Job Details</p>
              <div className="space-y-2">
                {[
                  { label: session.serviceType ?? "Service type", status: session.stage },
                  session.selectedSlot ? { label: session.selectedSlot, status: "slot" } : null,
                  session.address ? { label: session.address, status: "address" } : null,
                ].filter(Boolean).map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn("w-2 h-2 rounded-full shrink-0",
                        item!.status === "BOOKED" ? "bg-green-500" : item!.status === "NOT_INTERESTED" ? "bg-red-400" : "bg-blue-400")} />
                      <span className="text-xs text-slate-700 truncate">{item!.label}</span>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                      {item!.status === "BOOKED" ? "Booked" : item!.status === "slot" ? "Slot" : item!.status === "address" ? "Addr" : "Open"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Booking history */}
          {jobs && jobs.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Booking History</p>
              <div className="space-y-1.5">
                {jobs.map((job) => (
                  <div key={job.id} className="bg-slate-50 rounded-xl p-2.5">
                    <p className="text-xs font-bold text-slate-700">{job.serviceType ?? "Cleaning"}</p>
                    <p className="text-[10px] text-slate-400">{job.jobDate} · {job.frequency ?? "One-time"}{job.lastBookingPrice ? ` · $${job.lastBookingPrice}` : ""}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-slate-100" />

          {/* Automation */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Automation</p>
            <div className="flex flex-col gap-1.5">
              <button
                className="text-left text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                onClick={() => toast.info("Create follow-up — coming soon")}
              >
                Create follow-up
              </button>
              <button
                className="text-left text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                onClick={() => toast.info("Send quote link — coming soon")}
              >
                Send quote link
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export default function EmailInbox() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyMode, setReplyMode] = useState<"reply" | "note">("reply");
  const [showCompose, setShowCompose] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [extraThreads, setExtraThreads] = useState<GmailThread[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<{
    id: string; filename: string; mimeType: string; size: number;
    url?: string; key?: string; preview?: string; uploading: boolean; error?: string;
  }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utils = trpc.useUtils();

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQuery(searchQuery), 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

  const statusQuery = trpc.gmail.getConnectionStatus.useQuery(undefined, { staleTime: 60_000, retry: false });
  const threadsQuery = trpc.gmail.listThreads.useQuery(
    { maxResults: 100, query: debouncedQuery || undefined },
    { enabled: statusQuery.data?.connected === true, staleTime: 30_000, retry: false }
  );

  async function loadMore() {
    const nextToken = threadsQuery.data?.nextPageToken;
    if (!nextToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await utils.gmail.listThreads.fetch({
        maxResults: 100,
        pageToken: nextToken,
        query: debouncedQuery || undefined,
      });
      setExtraThreads((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const newOnes = result.threads.filter((t) => !existingIds.has(t.id));
        return [...prev, ...newOnes];
      });
    } catch {
      toast.error("Failed to load more threads");
    } finally {
      setLoadingMore(false);
    }
  }
  const threadQuery = trpc.gmail.getThread.useQuery(
    { threadId: selectedThreadId! },
    { enabled: Boolean(selectedThreadId) && statusQuery.data?.connected === true, staleTime: 30_000, retry: false }
  );

  const markReadMutation = trpc.gmail.markRead.useMutation({
    onSuccess: () => { utils.gmail.listThreads.invalidate(); if (selectedThreadId) utils.gmail.getThread.invalidate({ threadId: selectedThreadId }); },
  });
  const markUnreadMutation = trpc.gmail.markUnread.useMutation({
    onSuccess: () => { utils.gmail.listThreads.invalidate(); if (selectedThreadId) utils.gmail.getThread.invalidate({ threadId: selectedThreadId }); },
  });
  const archiveMutation = trpc.gmail.archiveThread.useMutation({
    onSuccess: () => { toast.success("Thread archived"); setSelectedThreadId(null); utils.gmail.listThreads.invalidate(); },
    onError: (err) => toast.error(err.message || "Failed to archive"),
  });
  const replyMutation = trpc.gmail.sendReply.useMutation({
    onSuccess: () => {
      toast.success("Reply sent!");
      setReplyText("");
      setPendingAttachments([]);
      if (selectedThreadId) { utils.gmail.getThread.invalidate({ threadId: selectedThreadId }); utils.gmail.listThreads.invalidate(); }
    },
    onError: (err) => toast.error(err.message || "Failed to send reply"),
  });
  const draftMutation = trpc.gmail.draftReply.useMutation({
    onSuccess: ({ draft }) => {
      setReplyText(draft);
      setReplyMode("reply");
      toast.success("AI draft ready — review and send!");
    },
    onError: (err) => toast.error(err.message || "AI draft failed"),
  });
  const uploadAttachmentMutation = trpc.gmail.uploadAttachment.useMutation();

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files);
    for (const file of newFiles) {
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`${file.name} exceeds the 25 MB limit.`);
        continue;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // Generate preview URL for images
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setPendingAttachments((prev) => [
        ...prev,
        { id, filename: file.name, mimeType: file.type, size: file.size, preview, uploading: true },
      ]);
      // Read file as base64 and upload
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = (reader.result as string).split(",")[1];
          const result = await uploadAttachmentMutation.mutateAsync({
            filename: file.name,
            mimeType: file.type,
            base64Data,
          });
          setPendingAttachments((prev) =>
            prev.map((a) => a.id === id
              ? { ...a, url: result.url, key: result.key, uploading: false }
              : a
            )
          );
        } catch (err: any) {
          setPendingAttachments((prev) =>
            prev.map((a) => a.id === id
              ? { ...a, uploading: false, error: err.message || "Upload failed" }
              : a
            )
          );
          toast.error(`Failed to upload ${file.name}`);
        }
      };
      reader.readAsDataURL(file);
    }
  }

  function removeAttachment(id: string) {
    setPendingAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.preview) URL.revokeObjectURL(att.preview);
      return prev.filter((a) => a.id !== id);
    });
  }

  function generateDraft() {
    if (!selectedThreadId || !threadQuery.data) return;
    const thread = threadQuery.data;
    draftMutation.mutate({
      threadId: selectedThreadId,
      customerEmail: thread.fromEmail || undefined,
      messages: thread.messages.map((m) => ({
        from: m.from,
        bodyText: m.bodyText || m.snippet || "",
        date: m.date,
        isOutbound: m.fromEmail?.toLowerCase().includes("maidinblack") ?? false,
      })),
    });
  }

  useOpsStream(
    {
      onGmailNewMessages: useCallback(() => {
        utils.gmail.listThreads.invalidate();
        if (selectedThreadId) utils.gmail.getThread.invalidate({ threadId: selectedThreadId });
      }, [utils, selectedThreadId]),
    },
    { enabled: statusQuery.data?.connected === true }
  );

  function selectThread(threadId: string) {
    setSelectedThreadId(threadId);
    setReplyText("");
    setReplyMode("reply");
    const thread = threadsQuery.data?.threads.find((t) => t.id === threadId);
    if (thread?.isUnread) markReadMutation.mutate({ threadId });
  }

  function sendReply() {
    if (!selectedThreadId || !replyText.trim()) return;
    const thread = threadQuery.data;
    if (!thread) return;
    // Block send if any attachment is still uploading
    const stillUploading = pendingAttachments.some((a) => a.uploading);
    if (stillUploading) { toast.warning("Please wait for attachments to finish uploading."); return; }
    const lastMsg = thread.messages[thread.messages.length - 1];
    const readyAttachments = pendingAttachments
      .filter((a) => a.url && !a.error)
      .map((a) => ({ url: a.url!, filename: a.filename, mimeType: a.mimeType }));
    // Find the correct 'to' address: the last message from someone other than the inbox.
    // This ensures we always reply to the customer, not ourselves.
    const inboxEmail = thread.inboxEmail?.toLowerCase();
    const otherPartyMsg = inboxEmail
      ? [...thread.messages].reverse().find((m) => m.fromEmail.toLowerCase() !== inboxEmail)
      : null;
    const toEmail = otherPartyMsg?.fromEmail ?? thread.fromEmail;
    replyMutation.mutate({
      threadId: selectedThreadId,
      to: toEmail,
      subject: thread.subject,
      bodyHtml: replyText.replace(/\n/g, "<br>"),
      inReplyToMessageId: lastMsg?.id,
      attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
    });
  }

  const baseThreads = threadsQuery.data?.threads ?? [];
  const allThreads = [
    ...baseThreads,
    ...extraThreads.filter((t) => !baseThreads.some((b) => b.id === t.id)),
  ].sort((a, b) => b.date - a.date);

  // Fetch thread meta (issue flags) for all visible threads
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allThreadIds = useMemo(() => allThreads.map((t) => t.id), [allThreads.map((t) => t.id).join(",")]);
  const threadMetaQuery = trpc.gmail.listThreadMeta.useQuery(
    { threadIds: allThreadIds },
    { enabled: allThreadIds.length > 0 && statusQuery.data?.connected === true, staleTime: 30_000 }
  );
  const metaMap = new Map(
    (threadMetaQuery.data?.meta ?? []).map((m) => [m.threadId, m])
  );

  // Flag issue mutation
  const flagIssueMutation = trpc.gmail.flagIssue.useMutation({
    onSuccess: (data, vars) => {
      threadMetaQuery.refetch();
      toast.success(vars.flag ? `Flagged as issue${data.issueSummary ? " — AI summary added" : ""}` : "Issue flag removed");
    },
    onError: (err) => toast.error(err.message || "Failed to update issue flag"),
  });

  function toggleIssue() {
    if (!selectedThreadId || !threadQuery.data) return;
    const currentMeta = metaMap.get(selectedThreadId);
    const isCurrentlyIssue = (currentMeta?.isIssue ?? 0) === 1;
    const thread = threadQuery.data;
    flagIssueMutation.mutate({
      threadId: selectedThreadId,
      flag: !isCurrentlyIssue,
      subject: thread.subject,
      messages: thread.messages.map((m) => ({
        from: m.from,
        bodyText: m.bodyText || m.snippet || "",
        date: m.date,
        isOutbound: m.fromEmail?.toLowerCase().includes("maidinblack") ?? false,
      })),
    });
  }

  // Sort: issues first, then by date
  const sortedThreads = [...allThreads].sort((a, b) => {
    const aIssue = (metaMap.get(a.id)?.isIssue ?? 0) === 1 ? 1 : 0;
    const bIssue = (metaMap.get(b.id)?.isIssue ?? 0) === 1 ? 1 : 0;
    if (bIssue !== aIssue) return bIssue - aIssue;
    return b.date - a.date;
  });
  const threads = unreadOnly ? sortedThreads.filter((t) => t.isUnread) : sortedThreads;
  const selectedThread = threadQuery.data ?? null;
  const unreadCount = allThreads.filter((t) => t.isUnread).length;

  // Auto-select the most recently received thread when inbox loads
  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      selectThread(threads[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.length > 0 && !selectedThreadId]);

  return (
    <div className="h-screen flex overflow-hidden bg-[#f5f5f3] font-sans">
      {/* Thread sidebar */}
      <aside className="w-[280px] bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight">Maids Inbox</h1>
              <p className="text-[11px] text-slate-400">Shared Gmail inbox</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { utils.gmail.listThreads.invalidate(); utils.gmail.getConnectionStatus.invalidate(); }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors"
                title="Refresh"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", threadsQuery.isFetching && "animate-spin")} />
              </button>
              <button
                onClick={() => setShowCompose(true)}
                className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center hover:bg-slate-800 transition-colors"
                title="Compose"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {/* Search */}
          <div className="relative mb-2.5">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              placeholder="Search inbox…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 bg-slate-50 border-slate-200 rounded-lg text-xs h-8"
            />
          </div>
          {/* Filter pills */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setUnreadOnly(false)}
              className={cn(
                "text-[11px] font-semibold px-3 py-1 rounded-full transition-colors",
                !unreadOnly ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
              )}
            >
              All
            </button>
            <button
              onClick={() => setUnreadOnly(true)}
              className={cn(
                "text-[11px] font-semibold px-3 py-1 rounded-full transition-colors",
                unreadOnly ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100"
              )}
            >
              Unread {unreadCount > 0 && `(${unreadCount})`}
            </button>
          </div>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {statusQuery.isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
            </div>
          )}
          {statusQuery.data?.connected === false && (
            <div className="px-4 py-6 text-center">
              <AlertCircle className="w-7 h-7 text-amber-400 mx-auto mb-2" />
              <p className="text-xs text-slate-500">Gmail not connected</p>
            </div>
          )}
          {threadsQuery.isLoading && statusQuery.data?.connected && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
            </div>
          )}
          {threadsQuery.isError && (
            <div className="px-4 py-6 text-center">
              <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
              <p className="text-xs text-red-500">{threadsQuery.error.message}</p>
            </div>
          )}
          {threads.map((t) => {
            const meta = metaMap.get(t.id);
            return (
              <ThreadItem
                key={t.id}
                thread={t}
                active={t.id === selectedThreadId}
                onClick={() => selectThread(t.id)}
                isIssue={(meta?.isIssue ?? 0) === 1}
                issueSummary={meta?.issueSummary ?? null}
              />
            );
          })}
          {threads.length === 0 && !threadsQuery.isLoading && statusQuery.data?.connected && (
            <div className="text-center py-12 text-slate-400 text-xs">
              {debouncedQuery ? "No results" : unreadOnly ? "No unread messages" : "Inbox is empty"}
            </div>
          )}
          {!unreadOnly && threadsQuery.data?.nextPageToken && (
            <div className="px-4 py-3 border-t border-slate-100">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full text-xs font-semibold text-slate-500 hover:text-slate-700 py-2 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Email viewer */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {statusQuery.data?.connected === false && <NotConnectedBanner />}
        {statusQuery.data?.connected && !selectedThreadId && (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <Mail className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm text-slate-400">Select a thread to read</p>
            </div>
          </div>
        )}
        {selectedThreadId && statusQuery.data?.connected && (
          <>
            {/* Thread header */}
            <div className="h-[60px] bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
              <h2 className="text-base font-bold text-slate-900 truncate mr-4">
                {selectedThread?.subject ?? "Loading…"}
              </h2>
              <div className="flex items-center gap-1.5 shrink-0">
                {(() => {
                  const isCurrentIssue = (metaMap.get(selectedThreadId)?.isIssue ?? 0) === 1;
                  return (
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "text-xs font-semibold gap-1.5 h-8 transition-colors",
                        isCurrentIssue
                          ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
                          : "hover:border-red-200 hover:text-red-500"
                      )}
                      onClick={toggleIssue}
                      disabled={flagIssueMutation.isPending}
                      title={isCurrentIssue ? "Remove issue flag" : "Flag as issue"}
                    >
                      {flagIssueMutation.isPending
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Flag className={cn("w-3.5 h-3.5", isCurrentIssue && "fill-red-500")} />}
                      {isCurrentIssue ? "Issue" : "Flag"}
                    </Button>
                  );
                })()}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs font-semibold gap-1.5 h-8"
                  onClick={() => {
                    if (selectedThread?.isUnread) markReadMutation.mutate({ threadId: selectedThreadId });
                    else markUnreadMutation.mutate({ threadId: selectedThreadId });
                  }}
                  disabled={markReadMutation.isPending || markUnreadMutation.isPending}
                >
                  {selectedThread?.isUnread
                    ? <><MailCheck className="w-3.5 h-3.5" /> Mark read</>
                    : <><MailOpen className="w-3.5 h-3.5" /> Mark unread</>}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs font-semibold gap-1.5 h-8"
                  onClick={() => archiveMutation.mutate({ threadId: selectedThreadId })}
                  disabled={archiveMutation.isPending}
                >
                  {archiveMutation.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Archive className="w-3.5 h-3.5" />}
                  Archive
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-[6%] py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="w-full">
                {threadQuery.isLoading && (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
                  </div>
                )}
                {threadQuery.isError && (
                  <div className="text-center py-12">
                    <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                    <p className="text-sm text-red-500">{threadQuery.error.message}</p>
                  </div>
                )}
                {selectedThread?.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}

                {/* Reply box */}
                {selectedThread && (
                  <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(15,23,42,0.06)] overflow-hidden mb-4">
                    <div className="flex border-b border-slate-100">
                      {(["reply", "note"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setReplyMode(mode)}
                          className={cn(
                            "px-5 py-3 text-sm font-semibold capitalize transition-colors border-b-2",
                            replyMode === mode
                              ? "text-blue-600 border-blue-600"
                              : "text-slate-400 border-transparent hover:text-slate-600"
                          )}
                        >
                          {mode === "note" ? "Internal note" : "Reply"}
                        </button>
                      ))}
                    </div>
                    {/* Attachment chips — shown when files are queued */}
                    {pendingAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
                        {pendingAttachments.map((att) => (
                          <div
                            key={att.id}
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg border text-xs font-medium pr-1.5 pl-2 py-1 max-w-[180px]",
                              att.error
                                ? "border-red-200 bg-red-50 text-red-600"
                                : att.uploading
                                ? "border-slate-200 bg-slate-50 text-slate-500"
                                : "border-blue-200 bg-blue-50 text-blue-700"
                            )}
                          >
                            {att.preview ? (
                              <img src={att.preview} alt={att.filename} className="w-5 h-5 rounded object-cover shrink-0" />
                            ) : (
                              <FileText className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span className="truncate max-w-[100px]">{att.filename}</span>
                            {att.uploading && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
                            {!att.uploading && (
                              <button
                                onClick={() => removeAttachment(att.id)}
                                className="ml-0.5 rounded hover:bg-blue-100 p-0.5 shrink-0"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <Textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      className="border-0 rounded-none resize-none min-h-[140px] text-[14px] leading-relaxed text-slate-700 focus-visible:ring-0 p-5"
                      placeholder={replyMode === "note" ? "Add an internal note…" : "Write a reply…"}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          if (replyMode === "reply") sendReply();
                        }
                      }}
                    />
                    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                      <div className="flex items-center gap-3">
                        {/* Hidden file input */}
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
                          className="hidden"
                          onChange={(e) => handleFileSelect(e.target.files)}
                          onClick={(e) => { (e.target as HTMLInputElement).value = ""; }}
                        />
                        <button
                          className="text-slate-400 hover:text-slate-600"
                          title="Attach files"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Paperclip className="w-4 h-4" />
                        </button>
                        <button className="text-slate-400 hover:text-slate-600"><Link2 className="w-4 h-4" /></button>
                        {replyMode === "reply" && (
                          <button
                            onClick={generateDraft}
                            disabled={draftMutation.isPending || !threadQuery.data}
                            className={cn(
                              "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors",
                              draftMutation.isPending
                                ? "text-violet-400 bg-violet-50 cursor-not-allowed"
                                : "text-violet-600 bg-violet-50 hover:bg-violet-100"
                            )}
                          >
                            {draftMutation.isPending
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Sparkles className="w-3.5 h-3.5" />}
                            {draftMutation.isPending ? "Drafting…" : "AI Draft"}
                          </button>
                        )}
                      </div>
                      {replyMode === "reply" ? (
                        <Button
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs gap-1.5"
                          disabled={replyMutation.isPending || !replyText.trim()}
                          onClick={sendReply}
                        >
                          {replyMutation.isPending
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Send className="w-3.5 h-3.5" />}
                          Send ⌘+Enter
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="font-bold text-xs gap-1.5"
                          disabled={!replyText.trim()}
                          onClick={() => { toast.info("Internal notes are not yet saved to a backend."); setReplyText(""); }}
                        >
                          Save note
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Customer context panel */}
      <CustomerContextPanel threadFromEmail={selectedThread?.fromEmail ?? null} threadFrom={selectedThread?.from ?? null} />

      {showCompose && <ComposeModal onClose={() => setShowCompose(false)} />}
    </div>
  );
}
