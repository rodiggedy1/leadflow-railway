import { useCallback, useEffect, useRef, useState } from "react";

/** Lifecycle copied from useCallSession: one start, active-only 5s polling,
 * no overlapping polls, terminal/unmount cleanup, and call identity guards.
 * Transport injection keeps the isolated review unable to reach live APIs.
 * The existing useCallSession and its consumers remain unchanged. */
export type AiCallerStart = {
  leadflowJobId: number | null;
  jobDate: string;
  personName: string;
  phone: string;
  scenario: string;
  script: string;
  audience: "customer" | "cleaner";
  language?: "en" | "es";
};
export type AiCallerPoll = {
  status: "queued" | "ringing" | "in_progress" | "completed" | "voicemail" | "no_answer" | "failed";
  summary: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  durationSeconds: number | null;
};
export type AiCallerSession = {
  vapiCallId: string;
  phase: "active" | "terminal";
  status: AiCallerPoll["status"] | "firing";
  customerName: string;
  phone: string;
  scenario: string;
  outcome?: Omit<AiCallerPoll, "status"> & { error?: string };
};
export type AiCallerTransport = {
  startCall: (params: AiCallerStart) => Promise<{ vapiCallId: string | null }>;
  pollCall: (params: { vapiCallId: string }) => Promise<AiCallerPoll>;
};
const terminalStatuses = new Set(["completed", "voicemail", "no_answer", "failed"]);

export function useAiCallerSession(transport: AiCallerTransport) {
  const [session, setSession] = useState<AiCallerSession | null>(null);
  const sessionRef = useRef<AiCallerSession | null>(null);
  const firingRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transportRef = useRef(transport);
  transportRef.current = transport;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearTimer(); };
  }, [clearTimer]);

  const startCall = useCallback(async (params: AiCallerStart) => {
    if (!mountedRef.current || sessionRef.current !== null || firingRef.current) {
      throw new Error("A call session is already active");
    }
    firingRef.current = true;
    const current: AiCallerSession = {
      vapiCallId: "", phase: "active", status: "firing",
      customerName: params.personName, phone: params.phone, scenario: params.scenario,
    };
    sessionRef.current = current;
    setSession(current);
    const api = transportRef.current;
    try {
      const result = await api.startCall(params);
      if (!result.vapiCallId) throw new Error("No call ID returned from Vapi");
      if (!mountedRef.current || sessionRef.current !== current) return;
      const queued = { ...current, vapiCallId: result.vapiCallId, status: "queued" as const };
      sessionRef.current = queued;
      setSession(queued);
      const vapiCallId = result.vapiCallId;
      const isCurrent = () => mountedRef.current && sessionRef.current?.vapiCallId === vapiCallId && sessionRef.current.phase === "active";
      const tick = async () => {
        timerRef.current = null;
        if (!isCurrent()) return;
        try {
          const poll = await api.pollCall({ vapiCallId });
          if (!isCurrent()) return;
          const terminal = terminalStatuses.has(poll.status);
          const next: AiCallerSession = {
            ...sessionRef.current!, status: poll.status,
            phase: terminal ? "terminal" : "active",
            outcome: terminal ? {
              summary: poll.summary, transcript: poll.transcript,
              recordingUrl: poll.recordingUrl, durationSeconds: poll.durationSeconds,
            } : sessionRef.current!.outcome,
          };
          sessionRef.current = next;
          setSession(next);
          if (terminal) return;
        } catch {
          // Match the existing lifecycle: transient polling failures do not refire a call.
        }
        if (isCurrent()) timerRef.current = setTimeout(tick, 5000);
      };
      timerRef.current = setTimeout(tick, 5000);
    } catch (error) {
      if (mountedRef.current && sessionRef.current === current) {
        const message = error instanceof Error && error.message.length < 200 ? error.message : "Failed to connect the call.";
        const failed: AiCallerSession = { ...current, phase: "terminal", status: "failed", outcome: {
          error: message, summary: null, transcript: null, recordingUrl: null, durationSeconds: null,
        } };
        sessionRef.current = failed;
        setSession(failed);
      }
      clearTimer();
      throw error;
    } finally { firingRef.current = false; }
  }, [clearTimer]);

  const dismissSession = useCallback(() => {
    // UI cleanup only, never present this as provider cancellation.
    if (sessionRef.current?.phase === "active") return;
    clearTimer();
    sessionRef.current = null;
    setSession(null);
  }, [clearTimer]);

  return { session, startCall, dismissSession };
}
