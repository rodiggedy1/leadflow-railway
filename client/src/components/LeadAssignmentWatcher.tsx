/**
 * LeadAssignmentWatcher
 *
 * Mounted globally in App.tsx (on all admin/agent routes).
 * Polls for unacknowledged lead assignments and shows a fixed overlay + plays
 * a sound — regardless of whether OpsChat is open or which page the agent is on.
 *
 * Design decisions:
 * - Uses trpc.agents.me (publicProcedure) to detect if the current user is an
 *   agent session. If not an agent, the watcher is a no-op.
 * - Uses trpc.leads.getPendingAssignment (agentProcedure) — same procedure
 *   already used in CommandChat. No new tables or procedures needed.
 * - Listens to the SSE lead_assignment event to invalidate immediately on
 *   assignment, so the overlay appears within milliseconds.
 * - Plays a chime when pendingAssignment transitions from null → non-null.
 * - Renders a fixed overlay (z-[9999]) so it appears on top of every page.
 * - On "Got it", calls acknowledgeAssignment and optionally navigates to /agent
 *   if the current user is an agent (so they land on Lead Ops).
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { Briefcase, ArrowRight, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

export default function LeadAssignmentWatcher() {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();

  // Detect if this browser session is an agent (uses publicProcedure — safe to call always)
  const { data: agentMe } = trpc.agents.me.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
  });
  const isAgent = Boolean(agentMe?.id);

  // Poll for unacknowledged assignment — only when agent is logged in
  const { data: pendingAssignment } = trpc.leads.getPendingAssignment.useQuery(undefined, {
    enabled: isAgent,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });

  // SSE: invalidate immediately when a lead_assignment event fires
  useOpsStream(
    {
      onLeadAssignment: () => {
        utils.leads.getPendingAssignment.invalidate();
      },
    },
    { enabled: isAgent }
  );

  // Sound: play when pendingAssignment transitions from null/undefined → a real row
  const { playSound } = useNotificationSound();
  const prevAssignmentId = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingAssignment) {
      prevAssignmentId.current = null;
      return;
    }
    // Only play if this is a new assignment (id changed or first appearance)
    if (pendingAssignment.id !== prevAssignmentId.current) {
      prevAssignmentId.current = pendingAssignment.id;
      playSound();
    }
  }, [pendingAssignment?.id]);

  // Acknowledge mutation
  const acknowledgeAssignment = trpc.leads.acknowledgeAssignment.useMutation({
    onSuccess: () => {
      utils.leads.getPendingAssignment.invalidate();
      // Navigate agent to their dashboard (Lead Ops tab) so they can follow up
      if (isAgent) {
        navigate("/agent");
      }
    },
  });

  if (!pendingAssignment) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(120, 53, 15, 0.85)" }}
    >
      {/* Pulsing border ring */}
      <div
        className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden shadow-2xl"
        style={{
          animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          border: "3px solid #f97316",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 bg-orange-500">
          <Briefcase className="h-5 w-5 text-white shrink-0" />
          <span className="text-sm font-bold text-white uppercase tracking-wider">
            New Lead Assigned to You
          </span>
        </div>
        {/* Body */}
        <div className="px-5 py-4 bg-amber-50">
          <div className="space-y-1.5 mb-4">
            <p className="text-base font-semibold text-slate-800">
              👤{" "}
              <span className="text-orange-700">
                {pendingAssignment.leadName ?? "Lead"}
              </span>
            </p>
            {pendingAssignment.leadPhone && (
              <p className="text-sm text-slate-600">
                📞 {pendingAssignment.leadPhone}
              </p>
            )}
            <p className="text-sm text-slate-600">
              Assigned by{" "}
              <span className="font-semibold">
                {pendingAssignment.assignedByName}
              </span>
            </p>
            {pendingAssignment.notes && (
              <p className="text-sm text-slate-500 italic border-t border-orange-200 pt-2 mt-2">
                "{pendingAssignment.notes}"
              </p>
            )}
          </div>
          <p className="text-xs text-amber-700 font-medium mb-4">
            ⚡ Head to Lead Ops to follow up immediately.
          </p>
          <button
            disabled={acknowledgeAssignment.isPending}
            onClick={() =>
              acknowledgeAssignment.mutate({
                assignmentId: pendingAssignment.id,
              })
            }
            className="w-full rounded-xl bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold py-3 text-sm transition flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {acknowledgeAssignment.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            Got it — Go to Lead Ops
          </button>
        </div>
      </div>
    </div>
  );
}
