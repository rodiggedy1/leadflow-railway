/**
 * FollowUpReminderToast
 *
 * Slide-in toast stack from the bottom-right for leads with a follow-up
 * scheduled today. Dismissal writes followUpSent=1 to the database — the
 * server stops returning that lead permanently. No sessionStorage, no
 * client-side singletons. Simple and correct.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { trpc } from "@/lib/trpc";

export type FollowUpLead = {
  id: number;
  leadName: string | null;
  leadPhone: string;
  followUpDate: string | null;
  followUpMessage: string | null;
  stage: string;
};

export function FollowUpReminderToast({
  leads,
  onOpen,
  onDismiss,
}: {
  leads: FollowUpLead[];
  onOpen: (sessionId: number) => void;
  /** Called after a successful server-side dismiss so the parent can refetch */
  onDismiss?: () => void;
}) {
  // Optimistic local hide — so the card vanishes instantly without waiting for
  // the server round-trip. The server write ensures it stays gone on reload.
  const [localDismissed, setLocalDismissed] = useState<Set<number>>(() => new Set());

  const dismiss = trpc.leads.dismissFollowUp.useMutation({
    onSuccess: () => {
      onDismiss?.();
    },
  });

  function handleDismiss(id: number) {
    setLocalDismissed((prev) => new Set(prev).add(id));
    dismiss.mutate({ sessionId: id });
  }

  function handleOpen(id: number) {
    onOpen(id);
    handleDismiss(id);
  }

  const visible = leads.filter((l) => !localDismissed.has(l.id));
  if (visible.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end"
      style={{ maxWidth: 340 }}
    >
      {visible.map((lead, i) => (
        <div
          key={lead.id}
          className="w-full bg-white rounded-2xl shadow-xl border border-orange-100 overflow-hidden"
          style={{
            animation: `slideInRight 0.35s cubic-bezier(0.34,1.56,0.64,1) ${i * 80}ms both`,
          }}
        >
          {/* Accent bar */}
          <div className="h-1 w-full" style={{ backgroundColor: "#F97316" }} />
          <div className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                  style={{ backgroundColor: "#F97316" }}
                >
                  {(lead.leadName ?? lead.leadPhone).charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Follow-up today
                  </p>
                  <p className="text-sm font-semibold text-gray-900 leading-tight">
                    {lead.leadName ?? lead.leadPhone}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleDismiss(lead.id)}
                className="text-gray-300 hover:text-gray-500 transition-colors shrink-0 mt-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {lead.followUpMessage && (
              <p className="mt-2 text-xs text-gray-500 leading-relaxed line-clamp-2 pl-9">
                {lead.followUpMessage}
              </p>
            )}
            <button
              onClick={() => handleOpen(lead.id)}
              className="mt-3 w-full text-xs font-semibold text-white py-2 rounded-xl transition-all hover:opacity-90 active:scale-95"
              style={{ backgroundColor: "#F97316" }}
            >
              Open conversation
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Hook that fetches today's due follow-ups and returns them + a refetch fn.
 * Re-polls every 5 minutes.
 */
export function useTodayFollowUps(enabled: boolean) {
  const { data = [], refetch } = trpc.leads.getTodayFollowUps.useQuery(undefined, {
    enabled,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });
  return { data, refetch };
}
 
