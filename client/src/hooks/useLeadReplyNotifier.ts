/**
 * useLeadReplyNotifier
 *
 * Global watcher for new inbound customer replies across ALL lead sessions.
 * Fires a chime + browser notification whenever any session's lastCustomerReplyAt
 * advances past what was seen on the previous poll cycle.
 *
 * Works regardless of whether a conversation drawer is open. Place this hook
 * once at the top level of AdminDashboard and AgentDashboard so it runs
 * continuously while the page is mounted.
 *
 * Usage:
 *   useLeadReplyNotifier(sessions);
 *
 * Where `sessions` is the array returned by `trpc.leads.list.useQuery`.
 */

import { useEffect, useRef } from "react";
import { triggerTestChime } from "./useNewReplyNotifier";

type Session = {
  id: number;
  leadName?: string | null;
  leadPhone: string;
  lastCustomerReplyAt?: Date | string | null;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLeadReplyNotifier(sessions: Session[]) {
  /**
   * Map of sessionId → lastCustomerReplyAt timestamp (ms).
   * Null means "we've seen this session but it has no customer reply yet."
   * Undefined means "we haven't seen this session before" (first poll).
   */
  const prevReplyAtMap = useRef<Map<number, number | null>>(new Map());

  // Track whether this is the very first data load — we don't chime on initial
  // hydration, only on subsequent changes.
  const isFirstLoad = useRef(true);

  useEffect(() => {
    if (!sessions || sessions.length === 0) return;

    const prev = prevReplyAtMap.current;
    const newRepliers: Session[] = [];

    for (const s of sessions) {
      const replyTs = s.lastCustomerReplyAt
        ? (s.lastCustomerReplyAt instanceof Date
            ? s.lastCustomerReplyAt.getTime()
            : new Date(s.lastCustomerReplyAt as string).getTime())
        : null;

      const prevTs = prev.get(s.id); // undefined = never seen

      if (!isFirstLoad.current && prevTs !== undefined) {
        // Session was seen before — check if reply timestamp advanced
        if (replyTs !== null && (prevTs === null || replyTs > prevTs)) {
          newRepliers.push(s);
        }
      }

      // Update the map with the latest timestamp
      prev.set(s.id, replyTs);
    }

    isFirstLoad.current = false;

    if (newRepliers.length === 0) return;

    // Fire chime once for all new replies in this poll cycle
    void triggerTestChime();

    // Browser notification
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        const names = newRepliers
          .map((s) => s.leadName ?? s.leadPhone)
          .slice(0, 3);

        const title =
          newRepliers.length === 1
            ? `New reply from ${names[0]}`
            : `${newRepliers.length} new replies`;

        const body =
          newRepliers.length === 1
            ? "Tap to open the conversation"
            : names.join(", ") +
              (newRepliers.length > 3
                ? ` +${newRepliers.length - 3} more`
                : "");

        const n = new Notification(title, {
          body,
          icon: "/favicon.ico",
          tag: "lead-reply-alert",
          silent: true, // audio handled by triggerTestChime
        });
        setTimeout(() => n.close(), 6000);
      } catch {
        // Silently ignore — notification API may be unavailable
      }
    }
  }, [sessions]);
}
