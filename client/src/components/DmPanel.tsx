/**
 * DmPanel — floating 1-on-1 DM overlay panel.
 *
 * Usage:
 *   <DmPanel
 *     myName="Rohan G"
 *     recipientName="Ianique"
 *     recipientPhotoUrl={null}
 *     onClose={() => setOpenDm(null)}
 *   />
 *
 * The panel floats anchored to the bottom-right of the viewport,
 * above the status sidebar. Multiple panels stack left.
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { X, Send, MessageCircle } from "lucide-react";

interface DmPanelProps {
  myName: string;
  recipientName: string;
  recipientPhotoUrl?: string | null;
  /** Horizontal slot index (0 = rightmost, 1 = next left, etc.) */
  slotIndex?: number;
  onClose: () => void;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

export default function DmPanel({
  myName,
  recipientName,
  recipientPhotoUrl,
  slotIndex = 0,
  onClose,
}: DmPanelProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.opsChat.listDmMessages.useQuery(
    { participantA: myName, participantB: recipientName },
    { refetchInterval: 3000 }
  );

  const sendDm = trpc.opsChat.sendDm.useMutation({
    onSuccess: () => {
      utils.opsChat.listDmMessages.invalidate({ participantA: myName, participantB: recipientName });
      utils.opsChat.getDmUnreadCounts.invalidate();
    },
  });

  const markRead = trpc.opsChat.markDmRead.useMutation();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data?.messages?.length]);

  // Mark as read when panel is open and messages arrive
  useEffect(() => {
    if (!data?.messages?.length || !data.dmThread) return;
    const lastId = data.messages[data.messages.length - 1]?.id;
    if (lastId) {
      markRead.mutate({ myName, dmThread: data.dmThread, lastMessageId: lastId });
    }
  }, [data?.messages?.length, data?.dmThread]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    try {
      await sendDm.mutateAsync({ senderName: myName, recipientName, body });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Position: bottom-right, stacked left by slotIndex
  const rightOffset = 16 + slotIndex * 320;

  return (
    <div
      className="fixed z-[9999] flex flex-col shadow-2xl rounded-xl overflow-hidden border border-border bg-background"
      style={{
        bottom: 16,
        right: rightOffset,
        width: 300,
        height: 420,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground shrink-0">
        {recipientPhotoUrl ? (
          <img
            src={recipientPhotoUrl}
            alt={recipientName}
            className="w-7 h-7 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-primary-foreground/20 flex items-center justify-center text-xs font-bold shrink-0">
            {getInitials(recipientName)}
          </div>
        )}
        <span className="font-semibold text-sm flex-1 truncate">{recipientName}</span>
        <button
          onClick={onClose}
          className="hover:bg-primary-foreground/20 rounded p-0.5 transition-colors"
          aria-label="Close DM"
        >
          <X size={14} />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2 bg-muted/30"
      >
        {isLoading && (
          <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
        )}
        {!isLoading && (!data?.messages?.length) && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <MessageCircle size={28} className="opacity-30" />
            <p className="text-xs">No messages yet. Say hi!</p>
          </div>
        )}
        {data?.messages?.map((msg) => {
          const isMine = msg.authorName === myName;
          return (
            <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm leading-snug ${
                  isMine
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-card text-card-foreground border border-border rounded-bl-sm"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                <p className={`text-[10px] mt-0.5 ${isMine ? "text-primary-foreground/60" : "text-muted-foreground"} text-right`}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 px-2 py-2 border-t border-border bg-background shrink-0">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${recipientName}…`}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-input bg-muted/40 px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary max-h-24 overflow-y-auto"
          style={{ minHeight: 36 }}
          disabled={sending}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          className="shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors"
          aria-label="Send"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
