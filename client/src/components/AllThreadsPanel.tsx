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

import { CheckCheck, MessageSquare, Loader2, MessageCircle } from "lucide-react";
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
  lastReplyMsgId: number;
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
      className={`w-full text-left px-4 py-3.5 border-b border-[#343438] hover:bg-[#29292c] transition-colors group ${hasUnread ? "bg-[#252527]" : "bg-[#1b1b1e]"}`}
    >
      {/* Parent message preview */}
      <div className="flex items-start gap-2 mb-2">
        {/* Unread dot */}
        <div className="relative shrink-0 mt-0.5">
          <MessageSquare className="h-3.5 w-3.5 text-[#b8a8ff]" />
          {hasUnread && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#4c9dff] ring-1 ring-[#1b1b1e]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold mr-1.5" style={{ color: fromColor }}>
            {thread.parentFrom}
          </span>
          <span className="text-[10px] text-[#8d8d95]">{fmtTime(thread.parentTs)}</span>
          <p className={`text-xs mt-0.5 leading-relaxed ${hasUnread ? "text-[#f0f0f2] font-medium" : "text-[#c0c0c6]"}`}>
            {truncate(thread.parentBody, 100)}
          </p>
        </div>
      </div>

      {/* Last reply preview */}
      {thread.lastReplyFrom && (
        <div className="ml-5.5 pl-2 border-l-2 border-[#66599c]">
          <span className="text-[10px] font-semibold mr-1" style={{ color: lastColor }}>
            {thread.lastReplyFrom}
          </span>
          <span className="text-[10px] text-[#8d8d95]">{fmtTime(thread.lastReplyTs)}</span>
          <p className={`text-[11px] mt-0.5 leading-snug ${hasUnread ? "text-[#dedee2] font-medium" : "text-[#a8a8ae]"}`}>
            {truncate(thread.lastReplyBody ?? "", 80)}
          </p>
        </div>
      )}

      {/* Reply count */}
      <div className="mt-2 ml-5.5 flex items-center gap-1 text-[10px] text-[#b8a8ff] font-medium group-hover:text-[#d4caff]">
        <MessageCircle className="h-3 w-3" />
        {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"} · View thread →
        {hasUnread && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[#4c9dff] text-white text-[9px] font-bold leading-none">
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
  const utils = trpc.useUtils();
  const markThreadRead = trpc.opsChat.markRead.useMutation({
    onSuccess: () => utils.opsChat.listActiveThreads.invalidate(),
  });
  const markAllThreadsRead = trpc.opsChat.markAllActiveThreadsRead.useMutation({
    onSuccess: () => utils.opsChat.listActiveThreads.invalidate(),
  });

  const unreadCount = (threads as ThreadSummary[]).filter(t => t.hasUnread).length;

  const openThread = (thread: ThreadSummary) => {
    if (thread.hasUnread) {
      markThreadRead.mutate({
        channel: `thread:${thread.parentId}`,
        lastMessageId: thread.lastReplyMsgId,
      });
    }
    onOpenThread(thread.parentId);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 overflow-hidden border-l-[#343438] bg-[#1b1b1e] text-[#eeeeef] [&_[data-slot=sheet-close]]:text-[#c0c0c6] [&_[data-slot=sheet-close]]:hover:bg-[#29292c]">
        <SheetHeader className="flex-row items-center justify-between gap-3 px-4 py-3 border-b border-[#343438] shrink-0">
          <SheetTitle className="flex items-center gap-2 text-sm text-[#eeeeef]">
            <MessageSquare className="w-4 h-4 text-[#b8a8ff]" />
            Threads
            {unreadCount > 0 ? (
              <span className="px-1.5 py-0.5 rounded-full bg-[#4c9dff] text-white text-[10px] font-bold leading-none">
                {unreadCount} unread
              </span>
            ) : threads.length > 0 ? (
              <span className="text-xs text-[#8d8d95] font-normal">
                {threads.length} active
              </span>
            ) : null}
          </SheetTitle>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllThreadsRead.mutate()}
              disabled={markAllThreadsRead.isPending}
              className="mr-7 inline-flex items-center gap-1.5 rounded-md border border-[#414146] bg-[#252527] px-2 py-1 text-[10px] font-semibold text-[#dcdce0] transition-colors hover:border-[#66599c] hover:bg-[#302d38] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {markAllThreadsRead.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3 text-[#b8a8ff]" />}
              Mark all read
            </button>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-[#8d8d95]" />
            </div>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-12 h-12 bg-[#29292c] rounded-full flex items-center justify-center mb-3">
                <MessageSquare className="w-6 h-6 text-[#b8a8ff]" />
              </div>
              <p className="text-sm text-[#c0c0c6] font-medium">No threads yet</p>
              <p className="text-xs text-[#8d8d95] mt-1">
                Hover any message and click "Thread" to start one
              </p>
            </div>
          ) : (
            (threads as ThreadSummary[]).map((t) => (
              <ThreadRow
                key={t.parentId}
                thread={t}
                onClick={() => openThread(t)}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
