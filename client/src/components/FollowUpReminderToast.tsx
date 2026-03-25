/**
 * FollowUpReminderToast
 *
 * Slide-in toast stack that appears from the bottom-right when leads have
 * a follow-up scheduled for today. Each card is clickable and opens the
 * conversation drawer for that lead.
 *
 * Used in both AdminDashboard and AgentDashboard.
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

const SESSION_KEY = "followup_dismissed_ids";

function readDismissed(): Set<number> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as number[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<number>) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...ids]));
  } catch {
    // sessionStorage unavailable — degrade silently
  }
}

export function FollowUpReminderToast({
  leads,
  onOpen,
}: {
  leads: FollowUpLead[];
  onOpen: (sessionId: number) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<number>>(() => readDismissed());
  const visible = leads.filter((l) => !dismissed.has(l.id));

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
              onClick={() => {
                const next = new Set(dismissed).add(lead.id);
                writeDismissed(next);
                setDismissed(next);
              }}
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
              onClick={() => {
                onOpen(lead.id);
                const next = new Set(dismissed).add(lead.id);
                writeDismissed(next);
                setDismissed(next);
              }}
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
 * Hook that fetches today's due follow-ups and returns them.
 * Re-polls every 5 minutes.
 */
export function useTodayFollowUps(enabled: boolean) {
  const { data = [] } = trpc.leads.getTodayFollowUps.useQuery(undefined, {
    enabled,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });
  return data;
}
