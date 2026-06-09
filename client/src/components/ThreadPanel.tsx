/**
 * ThreadPanel — Slack-style thread side panel for Command Chat.
 *
 * Shows the parent message at the top, all thread replies below,
 * and a composer at the bottom to send new replies.
 *
 * Usage:
 *   <ThreadPanel
 *     parentId={openThreadId}
 *     callerName={callerName}
 *     senderPhotoMap={senderPhotoMap}
 *     onClose={() => setOpenThreadId(null)}
 *     onSendReply={(body) => sendReply(parentId, body)}
 *   />
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { X, Send, MessageSquare } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { senderHex, senderColorClass } from "@/lib/senderColor";
import { cn } from "@/lib/utils";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function Avatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="w-8 h-8 rounded-full object-cover shrink-0 shadow-sm"
      />
    );
  }
  const color = senderHex(name);
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm"
      style={{ background: color }}
    >
      {initials}
    </div>
  );
}

function HighlightedBody({ body }: { body: string }) {
  // Highlight @mentions
  const parts = body.split(/(@\S+)/g);
  return (
    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        part.startsWith("@") ? (
          <span key={i} className="text-violet-600 font-medium">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </p>
  );
}

// ── ThreadMessage ─────────────────────────────────────────────────────────────

type TMsg = {
  id: number;
  ts: number;
  from: string;
  role: string;
  body: string;
  mediaUrl?: string | null;
};

function ThreadMessage({
  msg,
  senderPhotoMap,
  isParent = false,
}: {
  msg: TMsg;
  senderPhotoMap: Record<string, string | null>;
  isParent?: boolean;
}) {
  const photoUrl = senderPhotoMap[msg.from] ?? null;
  const color = senderHex(msg.from);

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3",
        isParent && "bg-slate-50 border-b border-slate-200"
      )}
    >
      <Avatar name={msg.from} photoUrl={photoUrl} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span
            className="text-xs font-semibold"
            style={{ color }}
          >
            {msg.from}
          </span>
          <span className="text-[10px] text-slate-400">{fmtTime(msg.ts)}</span>
          {isParent && (
            <span className="ml-auto text-[10px] text-slate-400 italic">Original</span>
          )}
        </div>
        <HighlightedBody body={msg.body} />
        {msg.mediaUrl && (() => {
          let urls: string[] = [];
          try { urls = JSON.parse(msg.mediaUrl); } catch { urls = [msg.mediaUrl]; }
          return (
            <div className="mt-2 flex flex-wrap gap-2">
              {urls.map((u, i) => {
                const proxied = u.includes(".r2.dev/") ? `/api/media-proxy?url=${encodeURIComponent(u)}` : u;
                return (
                <img
                  key={i}
                  src={proxied}
                  alt="attachment"
                  className="max-h-40 rounded-lg border border-slate-200 object-cover cursor-pointer"
                  onClick={() => window.open(proxied, "_blank")}
                />
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── ThreadPanel ───────────────────────────────────────────────────────────────

interface ThreadPanelProps {
  parentId: number;
  callerName: string;
  senderPhotoMap: Record<string, string | null>;
  onClose: () => void;
  /** Called when the user sends a reply in this thread */
  onSendReply: (body: string, parentId: number) => void;
  /** Refetch trigger — increment to force a refetch (e.g. after SSE event) */
  refetchTick?: number;
}

export default function ThreadPanel({
  parentId,
  callerName,
  senderPhotoMap,
  onClose,
  onSendReply,
  refetchTick = 0,
}: ThreadPanelProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading, refetch } = trpc.opsChat.getThreadReplies.useQuery(
    { parentId },
    { refetchInterval: 30_000 }
  );
  const markRead = trpc.opsChat.markRead.useMutation();
  const utils = trpc.useUtils();

  // Refetch when SSE fires a new_message for this thread
  useEffect(() => {
    if (refetchTick > 0) refetch();
  }, [refetchTick, refetch]);

  // Mark thread as read whenever replies load or new replies arrive
  useEffect(() => {
    const replies = data?.replies;
    if (!replies || replies.length === 0) return;
    const lastId = replies[replies.length - 1].id;
    markRead.mutate(
      { lastMessageId: lastId, channel: `thread:${parentId}` },
      { onSuccess: () => utils.opsChat.listActiveThreads.invalidate() }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.replies?.length, parentId]);

  // Scroll to bottom when replies load or new reply arrives
  useEffect(() => {
    if (data?.replies?.length) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [data?.replies?.length]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      onSendReply(body, parentId);
      setDraft("");
      setTimeout(() => refetch(), 300);
    } finally {
      setSending(false);
    }
  }, [draft, sending, onSendReply, parentId, refetch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const replyCount = data?.replies?.length ?? 0;

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 min-w-0">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-700">Thread</span>
          {replyCount > 0 && (
            <span className="text-xs text-slate-400">
              {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 transition p-1 rounded hover:bg-slate-100"
          title="Close thread"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-24 text-slate-400 text-sm">
            Loading…
          </div>
        ) : !data?.parent ? (
          <div className="flex items-center justify-center h-24 text-slate-400 text-sm">
            Message not found
          </div>
        ) : (
          <>
            {/* Parent message */}
            <ThreadMessage
              msg={data.parent}
              senderPhotoMap={senderPhotoMap}
              isParent
            />

            {/* Replies */}
            {data.replies.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-400">
                No replies yet. Be the first to reply.
              </div>
            ) : (
              <div>
                <div className="px-4 pt-3 pb-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                    {replyCount} {replyCount === 1 ? "Reply" : "Replies"}
                  </span>
                </div>
                {data.replies.map((r) => (
                  <ThreadMessage
                    key={r.id}
                    msg={r}
                    senderPhotoMap={senderPhotoMap}
                  />
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-slate-200 px-3 py-3 bg-white">
        <div className="flex items-end gap-2 bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 focus-within:border-violet-400 focus-within:ring-1 focus-within:ring-violet-200 transition">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Reply in thread…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none min-h-[28px] max-h-[120px] leading-relaxed"
            style={{ height: "auto" }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            className={cn(
              "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition",
              draft.trim()
                ? "bg-violet-600 text-white hover:bg-violet-700"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            )}
            title="Send reply (Enter)"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5 px-1">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
