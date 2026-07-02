/**
 * SuperAlertWatcher
 *
 * Mounted globally in App.tsx (on all admin/agent routes).
 * Shows a fixed overlay + plays a sound when a super-alert (double-tag) is
 * posted in Command Chat — regardless of whether OpsChat is open or which
 * page the agent is on.
 *
 * Design decisions:
 * - Uses trpc.agents.me to detect agent sessions; falls back to trpc.auth.me
 *   for owner (OAuth) sessions. opsChatProcedure accepts both.
 * - Polls getPendingSuperAlerts every 3s (same cadence as CommandChat).
 * - Listens to the SSE onSuperAlert event for instant invalidation.
 * - Plays the notification chime when a new alert appears.
 * - "Reply" acknowledges the alert and opens OpsChat (Command channel) so
 *   the agent can reply — the composer pre-fill stays inside CommandChat.
 * - Renders fixed overlay (z-[9998]) visible on every page.
 * - CommandChat keeps its own overlay for agents already in OpsChat (it
 *   additionally pre-fills the composer). Both can coexist — the CommandChat
 *   overlay is z-[9998] absolute inside OpsChat, while this one is z-[9998]
 *   fixed over the whole page. When OpsChat is open, the CommandChat overlay
 *   takes visual precedence inside its container; when closed, this one fires.
 *
 *   To avoid double-showing when OpsChat is open, we hide this watcher's
 *   overlay when the ops chat window state is "open".
 */
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { Zap, MessageSquare, Loader2 } from "lucide-react";
import { useOpsChatWindow } from "@/hooks/useOpsChatWindow";
import { usePageVisibility } from "@/hooks/usePageVisibility";

export default function SuperAlertWatcher() {
  const utils = trpc.useUtils();
  const { state: opsChatState, open: openOpsChat } = useOpsChatWindow();

  // Detect session type — agent or owner
  const { data: agentMe } = trpc.agents.me.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
  });
  const { data: authMe } = trpc.auth.me.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
  });
  const isEligible = Boolean(agentMe?.id || authMe?.id);

  const isVisible = usePageVisibility();

  // Poll every 3s; pause when tab is hidden (visibility-aware)
  const { data: pendingSuperAlerts = [] } = trpc.opsChat.getPendingSuperAlerts.useQuery(
    undefined,
    {
      enabled: isEligible,
      refetchInterval: isVisible ? 3_000 : false,
      refetchIntervalInBackground: false,
      retry: 2,
      staleTime: 0,
      refetchOnWindowFocus: true,
    }
  );
  const activeSuperAlert = pendingSuperAlerts[0] ?? null;

  // SSE: invalidate immediately when a super_alert event fires
  useOpsStream(
    {
      onSuperAlert: () => {
        utils.opsChat.getPendingSuperAlerts.invalidate();
      },
    },
    { enabled: isEligible }
  );

  // Sound: play chime when a new super alert appears
  const { playSound } = useNotificationSound();
  const prevAlertId = useRef<number | null>(null);
  useEffect(() => {
    if (!activeSuperAlert) {
      prevAlertId.current = null;
      return;
    }
    if (activeSuperAlert.id !== prevAlertId.current) {
      prevAlertId.current = activeSuperAlert.id;
      playSound();
    }
  }, [activeSuperAlert?.id]);

  // Acknowledge mutation
  const acknowledgeMutation = trpc.opsChat.acknowledgeSuperAlert.useMutation({
    onSuccess: () => {
      utils.opsChat.getPendingSuperAlerts.invalidate();
    },
  });

  // Don't show when OpsChat is open — CommandChat's own overlay handles it there
  if (!activeSuperAlert || opsChatState === "open") return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{ background: "rgba(30, 10, 60, 0.88)" }}
    >
      <div
        className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden shadow-2xl"
        style={{
          animation: "pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          border: "3px solid #a855f7",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 bg-purple-600">
          <Zap className="h-5 w-5 text-yellow-300 shrink-0" />
          <span className="text-sm font-bold text-white uppercase tracking-wider">
            ⚡ Super-Alert from {activeSuperAlert.senderName}
          </span>
        </div>
        {/* Body */}
        <div className="px-5 py-4 bg-purple-50">
          <div className="mb-4 rounded-xl bg-white border border-purple-200 px-4 py-3 shadow-sm">
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
              {activeSuperAlert.messageBody}
            </p>
          </div>
          <p className="text-xs text-purple-700 font-medium mb-4">
            You must reply before you can continue.
          </p>
          <button
            disabled={acknowledgeMutation.isPending}
            onClick={() => {
              acknowledgeMutation.mutate({ alertId: activeSuperAlert.id });
              // Open OpsChat so the agent can reply in the Command channel
              openOpsChat();
            }}
            className="w-full rounded-xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-bold py-3 text-sm transition flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {acknowledgeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageSquare className="h-4 w-4" />
            )}
            Reply in Command Chat
          </button>
        </div>
      </div>
    </div>
  );
}
