/**
 * AllThreadsPanel — Slack-style "Threads" browser for Command Chat.
 *
 * Opens from the MessageSquare icon in the Command Chat header.
 * Lists all threads that have at least one reply, sorted by most recent activity.
 * Clicking a thread row calls onOpenThread(parentId) to open the ThreadPanel.
 *
 * Unread indicators:
 *  - Blue dot on each thread row where hasUnread === true
 *  - Unread count badge in the panel header
 */

import { MessageSquare, Loader2, MessageCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { senderHex } from "@/lib/senderColor";

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
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
  );
}

function truncate(text: string, max = 80): string {
  if (!text) return "";
  const plain = text.replace(/\n/g, " ").trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

// ── ThreadRow ─────────────────────────────────────────────────────────────────

type ThreadSummary = {
  parentId: number;
  parentBody: string;
  parentFrom: string;
  parentTs: number;
  replyCount: number;
  lastReplyFrom: string | null;
  lastReplyBody: string | null;
  lastReplyTs: number;
  hasUnread?: boolean;
};

function ThreadRow({
  thread,
  onClick,
}: {
  thread: ThreadSummary;
  onClick: () => void;
}) {
  const fromColor = senderHex(thread.parentFrom);
  const lastColor = thread.lastReplyFrom ? senderHex(thread.lastReplyFrom) : "#94a3b8";
  const hasUnread = thread.hasUnread === true;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-slate-100 hover:bg-violet-50 transition-colors group ${hasUnread ? "bg-violet-50/40" : ""}`}
    >
      {/* Parent message preview */}
      <div className="flex items-start gap-2 mb-2">
        {/* Unread dot */}
        <div className="relative shrink-0 mt-0.5">
          <MessageSquare className="h-3.5 w-3.5 text-violet-400" />
          {hasUnread && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-blue-500 ring-1 ring-white" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold mr-1.5" style={{ color: fromColor }}>
            {thread.parentFrom}
          </span>
          <span className="text-[10px] text-slate-400">{fmtTime(thread.parentTs)}</span>
          <p className={`text-xs mt-0.5 leading-relaxed ${hasUnread ? "text-slate-800 font-medium" : "text-slate-600"}`}>
            {truncate(thread.parentBody, 100)}
          </p>
        </div>
      </div>

      {/* Last reply preview */}
      {thread.lastReplyFrom && (
        <div className="ml-5.5 pl-2 border-l-2 border-violet-200">
          <span className="text-[10px] font-semibold mr-1" style={{ color: lastColor }}>
            {thread.lastReplyFrom}
          </span>
          <span className="text-[10px] text-slate-400">{fmtTime(thread.lastReplyTs)}</span>
          <p className={`text-[11px] mt-0.5 leading-snug ${hasUnread ? "text-slate-700 font-medium" : "text-slate-500"}`}>
            {truncate(thread.lastReplyBody ?? "", 80)}
          </p>
        </div>
      )}

      {/* Reply count */}
      <div className="mt-2 ml-5.5 flex items-center gap-1 text-[10px] text-violet-500 font-medium group-hover:text-violet-700">
        <MessageCircle className="h-3 w-3" />
        {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"} · View thread →
        {hasUnread && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-500 text-white text-[9px] font-bold leading-none">
            NEW
          </span>
        )}
      </div>
    </button>
  );
}

// ── AllThreadsPanel ───────────────────────────────────────────────────────────

interface AllThreadsPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenThread: (parentId: number) => void;
}

export default function AllThreadsPanel({
  open,
  onClose,
  onOpenThread,
}: AllThreadsPanelProps) {
  const { data: threads = [], isLoading } = trpc.opsChat.listActiveThreads.useQuery(undefined, {
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });

  const unreadCount = (threads as ThreadSummary[]).filter(t => t.hasUnread).length;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col overflow-hidden">
        <SheetHeader className="px-4 py-3 border-b border-slate-200 shrink-0">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <MessageSquare className="w-4 h-4 text-violet-500" />
            Threads
            {unreadCount > 0 ? (
              <span className="px-1.5 py-0.5 rounded-full bg-blue-500 text-white text-[10px] font-bold leading-none">
                {unreadCount} unread
              </span>
            ) : threads.length > 0 ? (
              <span className="text-xs text-slate-400 font-normal">
                {threads.length} active
              </span>
            ) : null}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-12 h-12 bg-violet-50 rounded-full flex items-center justify-center mb-3">
                <MessageSquare className="w-6 h-6 text-violet-300" />
              </div>
              <p className="text-sm text-slate-500 font-medium">No threads yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Hover any message and click "Thread" to start one
              </p>
            </div>
          ) : (
            (threads as ThreadSummary[]).map((t) => (
              <ThreadRow
                key={t.parentId}
                thread={t}
                onClick={() => {
                  onOpenThread(t.parentId);
                  onClose();
                }}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
