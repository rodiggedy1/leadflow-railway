/**
 * useCallSession
 *
 * Owns the entire AI call lifecycle for a single outbound call:
 *   - session state (CallSession | null)
 *   - polling (self-scheduling setTimeout loop — no overlapping requests)
 *   - startCall() — fires the mutation, creates the session, starts polling
 *   - cancelCall() — stops polling, transitions to terminal/canceled
 *   - dismissSession() — pure UI cleanup, clears session from memory
 *
 * This hook is a closed abstraction. No raw setters are exposed.
 * All state transitions happen through the four public methods above.
 *
 * Consumers: CustomerMentionChip (primary), AICallPanel (future migration)
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CallPhase = "active" | "terminal";

export type CallStatus =
  | "firing"       // startCall mutation in flight
  | "queued"       // Vapi accepted, not yet ringing
  | "ringing"      // phone is ringing
  | "in_progress"  // call connected
  | "completed"    // call ended normally
  | "voicemail"    // went to voicemail
  | "no_answer"    // no answer / silence timeout
  | "failed"       // Vapi/network error
  | "canceled";    // user canceled an active call

export type CallOutcome = {
  summary?: string;
  transcript?: string;
  recordingUrl?: string;
  durationSeconds?: number;
  error?: string;  // populated on failed/canceled with a human-readable message
};

export type CallSession = {
  vapiCallId: string;
  phase: CallPhase;
  status: CallStatus;
  customerName: string;
  phone: string;
  outcome?: CallOutcome;
  startedAt: Date;
  endedAt?: Date;
};

export type StartCallParams = {
  cleanerJobId: number;
  jobDate: string;
  personName: string;
  phone: string;
  scenario: string;
  script: string;
  audience: "customer" | "cleaner";
  /** Call language — "en" (default) or "es" for Spanish AI voice + prompts */
  language?: "en" | "es";
};

const TERMINAL_STATUSES: CallStatus[] = [
  "completed",
  "voicemail",
  "no_answer",
  "failed",
  "canceled",
];

function isTerminal(status: CallStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCallSession() {
  const [session, setSession] = useState<CallSession | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // sessionRef: read current session inside async callbacks without stale closure
  const sessionRef = useRef<CallSession | null>(null);
  // cancelledRef: set to true when polling should stop — checked before every setSession
  const cancelledRef = useRef(false);
  // isFiringRef: prevents double-click / duplicate startCall
  const isFiringRef = useRef(false);
  // pollingActiveRef: controls the self-scheduling poll loop
  const pollingActiveRef = useRef(false);

  const utils = trpc.useUtils();

  // Keep sessionRef in sync with React state
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Cleanup on unmount — stop any running poll loop
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      pollingActiveRef.current = false;
    };
  }, []);

  // ── Internal: stop polling ─────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    cancelledRef.current = true;
    pollingActiveRef.current = false;
    setIsPolling(false);
  }, []);

  // ── Internal: self-scheduling poll loop ───────────────────────────────────
  // Uses recursive setTimeout so polls never overlap — if one poll takes 6s,
  // the next one starts 5s AFTER it completes, not 5s after the previous start.
  const startPolling = useCallback(
    (vapiCallId: string) => {
      if (pollingActiveRef.current) return; // guard: already polling

      cancelledRef.current = false;
      pollingActiveRef.current = true;
      setIsPolling(true);

      const tick = async () => {
        // Check before every poll — may have been cancelled while awaiting
        if (!pollingActiveRef.current || cancelledRef.current) return;

        // Session identity guard — bail if the session has changed or been dismissed
        if (!sessionRef.current || sessionRef.current.vapiCallId !== vapiCallId) {
          stopPolling();
          return;
        }

        try {
          const poll = await utils.callMatrix.pollCall.fetch({ vapiCallId });

          // Check again after the async fetch — state may have changed
          if (!pollingActiveRef.current || cancelledRef.current) return;

          // Session identity guard post-fetch — a new call may have started while we were awaiting
          if (!sessionRef.current || sessionRef.current.vapiCallId !== vapiCallId) {
            stopPolling();
            return;
          }

          const status = poll.status as CallStatus;
          const terminal = isTerminal(status);

          const outcome: CallOutcome | undefined = terminal
            ? {
                summary: poll.summary ?? undefined,
                transcript: poll.transcript ?? undefined,
                recordingUrl: poll.recordingUrl ?? undefined,
                durationSeconds: poll.durationSeconds ?? undefined,
              }
            : undefined;

          setSession((prev) => {
            if (!prev || prev.vapiCallId !== vapiCallId) return prev;
            return {
              ...prev,
              phase: terminal ? "terminal" : "active",
              status,
              outcome: outcome ?? prev.outcome,
              endedAt: terminal ? new Date() : prev.endedAt,
            };
          });

          if (terminal) {
            stopPolling();
            return; // exit the loop
          }
        } catch {
          // Ignore transient poll errors — schedule next tick anyway
        }

        // Schedule next tick only if still active
        if (pollingActiveRef.current && !cancelledRef.current) {
          await delay(5000);
          tick(); // self-schedule (not recursive stack — awaits the delay first)
        }
      };

      // Kick off the first tick after initial delay
      delay(5000).then(() => {
        if (pollingActiveRef.current && !cancelledRef.current) tick();
      });
    },
    [utils.callMatrix.pollCall, stopPolling],
  );

  // ── startCall mutation ─────────────────────────────────────────────────────
  const startCallMutation = trpc.callMatrix.startCall.useMutation();

  // ── Public: startCall ──────────────────────────────────────────────────────
  const startCall = useCallback(
    async (params: StartCallParams): Promise<void> => {
      // Guard: prevent duplicate starts (double-click, rapid re-fire)
      if (sessionRef.current !== null || isFiringRef.current) {
        throw new Error("A call session is already active");
      }

      isFiringRef.current = true;

      // Create the initial session immediately so UI shows "Connecting…"
      const initialSession: CallSession = {
        vapiCallId: "",
        phase: "active",
        status: "firing",
        customerName: params.personName,
        phone: params.phone,
        startedAt: new Date(),
      };
      setSession(initialSession);

      try {
        const result = await startCallMutation.mutateAsync(params);

        if (!result.vapiCallId) {
          throw new Error("No call ID returned from Vapi");
        }

        setSession((prev) =>
          prev ? { ...prev, vapiCallId: result.vapiCallId, status: "queued" } : null,
        );

        startPolling(result.vapiCallId);
      } catch (err: any) {
        // Transition to terminal/failed with a human-readable error message
        const errorMsg =
          typeof err?.message === "string" && err.message.length < 200
            ? err.message
            : "Failed to connect the call. Please try again.";

        setSession((prev) =>
          prev
            ? {
                ...prev,
                phase: "terminal",
                status: "failed",
                endedAt: new Date(),
                outcome: { error: errorMsg },
              }
            : null,
        );
        stopPolling();
        throw err;
      } finally {
        isFiringRef.current = false;
      }
    },
    [startCallMutation, startPolling, stopPolling],
  );

  // ── Public: cancelCall ─────────────────────────────────────────────────────
  const cancelCall = useCallback(async (): Promise<void> => {
    const current = sessionRef.current;
    if (!current || current.phase !== "active") return;

    stopPolling();

    setSession((prev) =>
      prev
        ? {
            ...prev,
            phase: "terminal",
            status: "canceled",
            endedAt: new Date(),
            outcome: { error: "Call was canceled." },
          }
        : null,
    );

    // Future: await vapiCancel(current.vapiCallId);
  }, [stopPolling]);

  // ── Public: dismissSession ─────────────────────────────────────────────────
  const dismissSession = useCallback((): void => {
    // Pure UI cleanup — does not change call state, just clears the session
    stopPolling();
    setSession(null);
  }, [stopPolling]);

  return {
    session,
    isPolling,
    startCall,
    cancelCall,
    dismissSession,
  };
}
