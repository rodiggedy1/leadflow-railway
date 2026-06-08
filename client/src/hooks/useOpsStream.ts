/**
 * useOpsStream — manages the /api/ops-stream SSE connection.
 *
 * Usage:
 *   useOpsStream({
 *     onNewMessage: () => refetchMessages(),
 *     onJobUpdate:  () => refetchJobs(),
 *     onLeadUpdate: () => refetchCommandData(),
 *     onReactionUpdate: () => refetchReactions(),
 *   }, { enabled: isAuthenticated });
 *
 * The hook:
 *   - Only opens the EventSource when `enabled` is true (default: true)
 *   - Calls the appropriate callback when an ops_update event arrives
 *   - Automatically reconnects with exponential back-off (max 60s) on disconnect
 *   - Closes the connection on unmount or when enabled becomes false
 *   - Falls back gracefully if EventSource is not supported
 */

import { useEffect, useRef } from "react";

export type OpsStreamCallbacks = {
  onNewMessage?: (channel?: string, jobId?: number, threadParentId?: number) => void;
  onJobUpdate?: (jobId?: number) => void;
  onLeadUpdate?: () => void;
  onReactionUpdate?: () => void;
  onReminderUpdate?: () => void;
  /** Called when an agent's on-call status changes */
  onAgentStatus?: () => void;
  /** Called when the SSE connection is established or re-established */
  onConnected?: () => void;
  /** Called when update-lead-phone successfully links a real phone to a lead */
  onPhoneUpdate?: (leadName: string, newPhone: string) => void;
  /** Called when a comment is posted on an issue thread in Command Chat */
  onIssueComment?: (issueKey: string) => void;
  /** Called when a lead is assigned to an agent from Lead Ops */
  onLeadAssignment?: (assignmentId: number, targetAgentId: number) => void;
  /** Called when a super-alert (double-tag) is posted in Command Chat */
  onSuperAlert?: (targetAgentNames: string[]) => void;
};

// Minimum 5s before first reconnect attempt — prevents thundering herd when
// multiple tabs reconnect simultaneously after a deploy or server restart.
const MIN_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

export function useOpsStream(
  callbacks: OpsStreamCallbacks,
  options?: { enabled?: boolean }
) {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks; // always up-to-date without re-running the effect

  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return; // do not connect until authenticated
    if (typeof EventSource === "undefined") return; // SSR / old browser guard

    let es: EventSource | null = null;
    let retryDelay = MIN_RETRY_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      es = new EventSource("/api/ops-stream", { withCredentials: true });

      es.addEventListener("connected", () => {
        retryDelay = MIN_RETRY_MS; // reset back-off on successful connect
        cbRef.current.onConnected?.();
      });

      es.addEventListener("ops_update", (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as {
            type: string;
            channel?: string;
            jobId?: number;
            threadParentId?: number;
            leadName?: string;
            newPhone?: string;
            issueKey?: string;
            assignmentId?: number;
            targetAgentId?: number;
            targetAgentNames?: string[];
          };

          switch (event.type) {
            case "new_message":
              cbRef.current.onNewMessage?.(event.channel, event.jobId, event.threadParentId);
              break;
            case "issue_comment":
              cbRef.current.onIssueComment?.(event.issueKey ?? "");
              break;
            case "job_update":
              cbRef.current.onJobUpdate?.(event.jobId);
              break;
            case "lead_update":
              cbRef.current.onLeadUpdate?.();
              break;
            case "reaction_update":
              cbRef.current.onReactionUpdate?.();
              break;
            case "reminder_update":
              cbRef.current.onReminderUpdate?.();
              break;
            case "agent_status":
              cbRef.current.onAgentStatus?.();
              break;
            case "phone_update":
              cbRef.current.onPhoneUpdate?.(event.leadName ?? "", event.newPhone ?? "");
              break;
            case "lead_assignment":
              cbRef.current.onLeadAssignment?.(event.assignmentId ?? 0, event.targetAgentId ?? 0);
              break;
            case "super_alert":
              cbRef.current.onSuperAlert?.((event as { targetAgentNames?: string[] }).targetAgentNames ?? []);
              break;
            case "ping":
              // keepalive — no action needed
              break;
          }
        } catch {
          // malformed event — ignore
        }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (unmounted) return;

        // Exponential back-off with ±20% jitter — spreads reconnects across
        // multiple tabs so they don't all hit the server simultaneously.
        const jitter = retryDelay * 0.2 * (Math.random() * 2 - 1);
        const delay = Math.round(retryDelay + jitter);
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
          connect();
        }, delay);
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [enabled]); // re-run when enabled flips true after login
}
