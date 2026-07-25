/**
 * ConversationViewport — rendering engine for conversation hover previews.
 *
 * Responsibilities:
 *   - Measures real rendered message heights via refs
 *   - Caches heights by versionKey, firstVisibleIndex, and card height
 *   - Walks newest→oldest to find firstVisibleIndex within 70vh budget
 *   - Animates card height only on first measurement; instant on repeat hovers
 *   - Renders a "─── N earlier messages ───" divider when messages are hidden
 *   - Shows a bottom fade + CTA when the newest message alone exceeds the budget
 *
 * Usage:
 *   <ConversationViewport messages={normalizedMessages} onOpenFull={...} ctaLabel="Open conversation →" />
 *
 * Both SMS and email adapters normalize their data into ConversationMessage[] and pass it here.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// ─── Normalized message type ──────────────────────────────────────────────────

export type ConversationMessageRole = "customer" | "agent" | "system";

export interface ConversationMessage {
  /** Stable unique ID for this message (Gmail msg ID, SMS ts string, etc.) */
  id: string;
  /**
   * Cache invalidation key — changes when content changes.
   * Use: id + updatedAt for email, sessionId + session.updatedAt for SMS.
   */
  versionKey: string;
  author: {
    name: string;
    role: ConversationMessageRole;
  };
  content: string;
  createdAt: Date;
}

// ─── ConversationMessage (single message row) ─────────────────────────────────

interface ConversationMessageRowProps {
  message: ConversationMessage;
  measureRef: (el: HTMLDivElement | null) => void;
}

export function ConversationMessageRow({ message, measureRef }: ConversationMessageRowProps) {
  const roleColor: Record<ConversationMessageRole, string> = {
    agent: "text-orange-500",
    customer: "text-slate-400",
    system: "text-blue-400",
  };

  return (
    <div ref={measureRef} className="px-5 py-3 border-b border-slate-50 last:border-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={cn("text-[11px] font-semibold", roleColor[message.author.role])}>
          {message.author.name}
        </span>
        <span className="text-[11px] text-slate-400">
          {message.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <p
        className="text-sm text-slate-800 leading-[1.55] break-words"
        style={{ maxWidth: 560 }}
      >
        {message.content}
      </p>
    </div>
  );
}

// ─── ConversationViewport ─────────────────────────────────────────────────────

interface ConversationViewportProps {
  /** Normalized messages, oldest first */
  messages: ConversationMessage[];
  /** Loading state while data is being fetched */
  isLoading?: boolean;
  /** Label shown on the CTA when newest message alone exceeds budget */
  ctaLabel: string;
  /** Called when user clicks the CTA */
  onOpenFull: () => void;
  /** Title shown in the header */
  title: string;
}

// Module-level caches — persist across re-renders and re-hovers
// Key: versionKey → measured height in px
const messageHeightCache = new Map<string, number>();
// Key: conversationKey (e.g. "sms:123:updatedAt" or "email:threadId") → { firstVisibleIndex, cardHeight }
const viewportCache = new Map<string, { firstVisibleIndex: number; cardHeight: number }>();

function getConversationKey(messages: ConversationMessage[]): string {
  if (messages.length === 0) return "";
  // Use the versionKey of the last message as the conversation cache key
  return messages[messages.length - 1].versionKey;
}

export function ConversationViewport({
  messages,
  isLoading,
  ctaLabel,
  onOpenFull,
  title,
}: ConversationViewportProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const conversationKey = getConversationKey(messages);
  const cached = conversationKey ? viewportCache.get(conversationKey) : undefined;

  const [firstVisibleIndex, setFirstVisibleIndex] = useState<number>(
    cached?.firstVisibleIndex ?? 0
  );
  const [cardHeight, setCardHeight] = useState<number | null>(cached?.cardHeight ?? null);
  const [measured, setMeasured] = useState(!!cached);
  // Only animate on first measurement
  const [animate, setAnimate] = useState(!cached);
  const [singleMessageOverflow, setSingleMessageOverflow] = useState(false);

  // Reset state when messages change (new conversation hovered)
  useEffect(() => {
    if (!conversationKey) return;
    const c = viewportCache.get(conversationKey);
    if (c) {
      setFirstVisibleIndex(c.firstVisibleIndex);
      setCardHeight(c.cardHeight);
      setMeasured(true);
      setAnimate(false);
      setSingleMessageOverflow(false);
    } else {
      setFirstVisibleIndex(0);
      setCardHeight(null);
      setMeasured(false);
      setAnimate(true);
      setSingleMessageOverflow(false);
    }
  }, [conversationKey]);

  // After messages render, measure heights and compute firstVisibleIndex
  useEffect(() => {
    if (measured || messages.length === 0 || isLoading) return;

    // Wait one frame for DOM to settle
    const raf = requestAnimationFrame(() => {
      const headerHeight = headerRef.current?.offsetHeight ?? 48;
      const containerPadding = containerRef.current
        ? parseFloat(getComputedStyle(containerRef.current).paddingTop) +
          parseFloat(getComputedStyle(containerRef.current).paddingBottom)
        : 0;
      const bottomPadding = 32;
      const budget = window.innerHeight * 0.7 - headerHeight - containerPadding - bottomPadding;

      // Measure and cache each message height
      messages.forEach((msg) => {
        if (!messageHeightCache.has(msg.versionKey)) {
          const el = messageRefs.current.get(msg.id);
          if (el) {
            messageHeightCache.set(msg.versionKey, el.offsetHeight);
          }
        }
      });

      // Walk newest → oldest to find firstVisibleIndex
      let accumulated = 0;
      let firstIdx = messages.length; // start: show nothing, walk back
      const lastMsgHeight = messageHeightCache.get(messages[messages.length - 1].versionKey) ?? 0;

      // Edge case: newest message alone exceeds budget
      if (lastMsgHeight >= budget) {
        setSingleMessageOverflow(true);
        setFirstVisibleIndex(messages.length - 1);
        const h = Math.min(lastMsgHeight + headerHeight + containerPadding + bottomPadding, window.innerHeight * 0.7);
        setCardHeight(h);
        viewportCache.set(conversationKey, { firstVisibleIndex: messages.length - 1, cardHeight: h });
        setMeasured(true);
        return;
      }

      for (let i = messages.length - 1; i >= 0; i--) {
        const h = messageHeightCache.get(messages[i].versionKey) ?? 60;
        if (accumulated + h > budget) break;
        accumulated += h;
        firstIdx = i;
      }

      const computedCardHeight = accumulated + headerHeight + containerPadding + bottomPadding;
      setFirstVisibleIndex(firstIdx);
      setCardHeight(computedCardHeight);
      viewportCache.set(conversationKey, { firstVisibleIndex: firstIdx, cardHeight: computedCardHeight });
      setMeasured(true);
    });

    return () => cancelAnimationFrame(raf);
  }, [messages, isLoading, measured, conversationKey]);

  const visibleMessages = measured ? messages.slice(firstVisibleIndex) : messages;
  const hiddenCount = firstVisibleIndex;

  const setMessageRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) messageRefs.current.set(id, el);
    else messageRefs.current.delete(id);
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col"
      style={{
        height: cardHeight ?? undefined,
        maxHeight: "70vh",
        paddingBottom: 24,
        transition: animate && !measured ? "height 200ms ease" : undefined,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div ref={headerRef} className="px-5 py-3 border-b border-slate-100 flex-shrink-0">
        <span className="text-xs font-semibold text-slate-500">{title}</span>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex items-center justify-center flex-1 py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-400" />
        </div>
      ) : messages.length === 0 ? (
        <div className="px-5 py-5 text-sm text-slate-400">No messages</div>
      ) : (
        <div className="flex-1 relative">
          {/* Hidden count divider */}
          {measured && hiddenCount > 0 && (
            <div className="flex items-center gap-2 px-5 py-2">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-[11px] text-slate-400 whitespace-nowrap">
                {hiddenCount} earlier {hiddenCount === 1 ? "message" : "messages"}
              </span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
          )}

          {/* Messages */}
          {visibleMessages.map((msg) => (
            <ConversationMessageRow
              key={msg.id}
              message={msg}
              measureRef={setMessageRef(msg.id)}
            />
          ))}

          {/* Bottom fade + CTA for single-message overflow */}
          {singleMessageOverflow && (
            <div
              className="absolute bottom-0 left-0 right-0 flex items-end justify-end px-5 pb-3"
              style={{
                height: 64,
                background: "linear-gradient(to bottom, transparent, white)",
              }}
            >
              <button
                onClick={onOpenFull}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
              >
                {ctaLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
