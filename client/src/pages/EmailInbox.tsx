/**
 * EmailInbox — Shared Gmail inbox for all agents
 * Wired to real Gmail data via tRPC gmail.* procedures.
 * Real-time refresh via SSE gmail_new_messages event.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import DOMPurify from "dompurify";
import {
  Mail, Search, Paperclip, Link2, Zap, Send, RefreshCw,
  Loader2, AlertCircle, Archive, MailOpen, MailCheck, Plus,
} from "lucide-react";
import { useOpsStream } from "@/hooks/useOpsStream";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type RouterOutput = inferRouterOutputs<AppRouter>;
type GmailThread = RouterOutput["gmail"]["listThreads"]["threads"][number];
type GmailMessage = GmailThread["messages"][number];

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

function ThreadItem({ thread, active, onClick }: { thread: GmailThread; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3.5 rounded-2xl border transition-all mb-2",
        active ? "border-blue-200 bg-blue-50/60 shadow-sm" : "border-transparent bg-white hover:bg-slate-50",
        thread.isUnread && !active && "border-blue-100"
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className={cn("text-sm leading-snug line-clamp-1", thread.isUnread ? "font-black text-slate-900" : "font-semibold text-slate-700")}>
          {thread.subject}
        </span>
        <span className="text-xs text-slate-400 shrink-0 mt-0.5">{formatDate(thread.date)}</span>
      </div>
      <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
        <span className={cn("text-slate-600", thread.isUnread && "font-semibold")}>{thread.from || thread.fromEmail}</span>
        {thread.snippet ? ` · ${thread.snippet.slice(0, 70)}` : ""}
      </p>
      <div className="flex items-center gap-2 mt-1.5">
        {thread.isUnread && (
          <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-100">UNREAD</span>
        )}
        {thread.messageCount > 1 && (
          <span className="text-[10px] text-slate-400">{thread.messageCount} messages</span>
        )}
      </div>
    </button>
  );
}

function MessageBubble({ msg }: { msg: GmailMessage }) {
  const sanitizedHtml = msg.bodyHtml ? DOMPurify.sanitize(msg.bodyHtml, { USE_PROFILES: { html: true } }) : null;
  return (
    <div className="bg-white border border-slate-200 rounded-[18px] shadow-[0_4px_20px_rgba(22,34,51,0.06)] p-6 max-w-3xl mb-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-black text-sm shrink-0">
          {getInitials(msg.from || msg.fromEmail || "?")}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-800 truncate">{msg.from || msg.fromEmail}</p>
          <p className="text-xs text-slate-400">
            {msg.fromEmail !== msg.from && <span className="mr-1">{msg.fromEmail} ·</span>}
            {formatDate(msg.date)}
          </p>
        </div>
      </div>
      {sanitizedHtml ? (
        <div className="text-[14px] text-slate-700 leading-relaxed prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
      ) : (
        <div className="text-[14px] text-slate-700 leading-relaxed whitespace-pre-wrap">{msg.bodyText || msg.snippet}</div>
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
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-end justify-end p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-[560px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <p className="font-black text-sm text-slate-800">New Email</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <Input placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} className="text-sm" />
          <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="text-sm" />
          <Textarea placeholder="Write your message…" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[200px] text-sm resize-none" />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
          <div className="flex items-center gap-3 text-slate-400">
            <button className="hover:text-slate-600"><Paperclip className="w-4 h-4" /></button>
            <button className="hover:text-slate-600"><Link2 className="w-4 h-4" /></button>
          </div>
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs gap-1.5"
            disabled={composeMutation.isPending || !to || !subject || !body}
            onClick={() => composeMutation.mutate({ to, subject, bodyHtml: body.replace(/\n/g, "<br>") })}>
            {composeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function EmailInbox() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyMode, setReplyMode] = useState<"reply" | "note">("reply");
  const [showCompose, setShowCompose] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utils = trpc.useUtils();

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQuery(searchQuery), 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

  const statusQuery = trpc.gmail.getConnectionStatus.useQuery(undefined, { staleTime: 60_000, retry: false });
  const threadsQuery = trpc.gmail.listThreads.useQuery(
    { maxResults: 30, query: debouncedQuery || undefined },
    { enabled: statusQuery.data?.connected === true, staleTime: 30_000, retry: false }
  );
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
      if (selectedThreadId) { utils.gmail.getThread.invalidate({ threadId: selectedThreadId }); utils.gmail.listThreads.invalidate(); }
    },
    onError: (err) => toast.error(err.message || "Failed to send reply"),
  });

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
    const lastMsg = thread.messages[thread.messages.length - 1];
    replyMutation.mutate({
      threadId: selectedThreadId,
      to: lastMsg?.fromEmail ?? thread.fromEmail,
      subject: thread.subject,
      bodyHtml: replyText.replace(/\n/g, "<br>"),
      inReplyToMessageId: lastMsg?.id,
    });
  }

  const threads = threadsQuery.data?.threads ?? [];
  const selectedThread = threadQuery.data ?? null;

  return (
    <div className="h-screen flex overflow-hidden bg-[#f6f8fb] font-sans">
      {/* Thread sidebar */}
      <aside className="w-[300px] bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden">
        <div className="p-5 pb-3">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="text-lg font-black text-slate-900">Maids Inbox</h1>
              <p className="text-xs text-slate-400">Shared Gmail inbox</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => { utils.gmail.listThreads.invalidate(); utils.gmail.getConnectionStatus.invalidate(); }}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors" title="Refresh">
                <RefreshCw className={cn("w-4 h-4", threadsQuery.isFetching && "animate-spin")} />
              </button>
              <button onClick={() => setShowCompose(true)}
                className="bg-slate-900 text-white text-lg font-bold w-9 h-9 rounded-[14px] flex items-center justify-center hover:bg-slate-800 transition-colors" title="Compose">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Search inbox…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-200 rounded-[14px] text-sm h-10" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {statusQuery.isLoading && <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
          {statusQuery.data?.connected === false && (
            <div className="px-2 py-4 text-center">
              <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-xs text-slate-500">Gmail not connected</p>
            </div>
          )}
          {threadsQuery.isLoading && statusQuery.data?.connected && <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
          {threadsQuery.isError && (
            <div className="px-2 py-4 text-center">
              <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
              <p className="text-xs text-red-500">{threadsQuery.error.message}</p>
            </div>
          )}
          {threads.map((t) => <ThreadItem key={t.id} thread={t} active={t.id === selectedThreadId} onClick={() => selectThread(t.id)} />)}
          {threads.length === 0 && !threadsQuery.isLoading && statusQuery.data?.connected && (
            <div className="text-center py-12 text-slate-400 text-sm">{debouncedQuery ? "No results" : "Inbox is empty"}</div>
          )}
        </div>
      </aside>

      {/* Email viewer */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {statusQuery.data?.connected === false && <NotConnectedBanner />}
        {statusQuery.data?.connected && !selectedThreadId && (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <Mail className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a thread to read</p>
            </div>
          </div>
        )}
        {selectedThreadId && statusQuery.data?.connected && (
          <>
            <div className="h-[72px] bg-white border-b border-slate-200 flex items-center justify-between px-7 shrink-0">
              <h2 className="text-xl font-black text-slate-900 truncate mr-4">{selectedThread?.subject ?? "Loading…"}</h2>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" className="text-xs font-bold gap-1.5"
                  onClick={() => { if (selectedThread?.isUnread) markReadMutation.mutate({ threadId: selectedThreadId }); else markUnreadMutation.mutate({ threadId: selectedThreadId }); }}
                  disabled={markReadMutation.isPending || markUnreadMutation.isPending}>
                  {selectedThread?.isUnread ? <><MailCheck className="w-3.5 h-3.5" /> Mark read</> : <><MailOpen className="w-3.5 h-3.5" /> Mark unread</>}
                </Button>
                <Button variant="outline" size="sm" className="text-xs font-bold gap-1.5"
                  onClick={() => archiveMutation.mutate({ threadId: selectedThreadId })} disabled={archiveMutation.isPending}>
                  {archiveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                  Archive
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-7">
              {threadQuery.isLoading && <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
              {threadQuery.isError && <div className="text-center py-12"><AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" /><p className="text-sm text-red-500">{threadQuery.error.message}</p></div>}
              {selectedThread?.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
              {selectedThread && (
                <div className="bg-white border border-slate-200 rounded-[18px] shadow-[0_4px_20px_rgba(22,34,51,0.06)] max-w-3xl overflow-hidden">
                  <div className="flex border-b border-slate-200">
                    {(["reply", "note"] as const).map((mode) => (
                      <button key={mode} onClick={() => setReplyMode(mode)}
                        className={cn("px-5 py-3.5 text-sm font-black capitalize transition-colors border-b-2",
                          replyMode === mode ? "text-blue-600 border-blue-600" : "text-slate-500 border-transparent hover:text-slate-700")}>
                        {mode === "note" ? "Internal note" : "Reply"}
                      </button>
                    ))}
                  </div>
                  <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)}
                    className="border-0 rounded-none resize-none min-h-[160px] text-[15px] leading-relaxed text-slate-700 focus-visible:ring-0 p-5"
                    placeholder={replyMode === "note" ? "Add an internal note…" : "Write a reply…"}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (replyMode === "reply") sendReply(); } }} />
                  <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
                    <div className="flex items-center gap-3 text-slate-400">
                      <button className="hover:text-slate-600"><Paperclip className="w-4 h-4" /></button>
                      <button className="hover:text-slate-600"><Link2 className="w-4 h-4" /></button>
                      <button className="hover:text-slate-600"><Zap className="w-4 h-4" /></button>
                    </div>
                    {replyMode === "reply" ? (
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs gap-1.5"
                        disabled={replyMutation.isPending || !replyText.trim()} onClick={sendReply}>
                        {replyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        Send ⌘+Enter
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="font-black text-xs gap-1.5" disabled={!replyText.trim()}
                        onClick={() => { toast.info("Internal notes are not yet saved to a backend."); setReplyText(""); }}>
                        Save note
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {showCompose && <ComposeModal onClose={() => setShowCompose(false)} />}
    </div>
  );
}
