/**
 * ReminderPopup — full-screen modal that fires when a due reminder is detected.
 * Shows the reminder body, snooze options (5 / 15 / 30 min), and a dismiss button.
 * Polls every 30s via getDueReminders; auto-shows the first due reminder.
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Bell, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ReminderPopup() {
  const { data: agentMe } = trpc.agents.me.useQuery(undefined, { retry: false, staleTime: 2 * 60 * 1000 });
  const isAuthenticated = !!agentMe;
  const { data, refetch } = trpc.opsChat.getDueReminders.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const dismissMutation = trpc.opsChat.dismissReminder.useMutation({
    onSuccess: () => refetch(),
  });
  const snoozeMutation = trpc.opsChat.snoozeReminder.useMutation({
    onSuccess: () => refetch(),
  });

  // Show the first due reminder (if any)
  const due = data?.reminders ?? [];
  const current = due[0] ?? null;

  // Play a gentle bell sound when a new reminder appears
  const [lastShownId, setLastShownId] = useState<number | null>(null);
  useEffect(() => {
    if (!current) return;
    if (current.id === lastShownId) return;
    setLastShownId(current.id);
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      // Simple two-tone bell: 880Hz then 660Hz
      const playTone = (freq: number, startTime: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.35, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      playTone(880, ctx.currentTime, 0.6);
      playTone(660, ctx.currentTime + 0.35, 0.6);
    } catch { /* ignore audio errors */ }
  }, [current, lastShownId]);

  if (!current) return null;

  const fmt = (ts: number) =>
    new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Reminder"
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Header strip */}
        <div className="bg-sky-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <Bell className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-sky-200 uppercase tracking-widest">Reminder</p>
              <p className="text-xs text-white/80">{fmt(current.triggerAt)}</p>
            </div>
          </div>
          <button
            onClick={() => dismissMutation.mutate({ reminderId: current.id })}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center text-white transition-colors"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-base font-medium text-slate-900 leading-relaxed">{current.body}</p>
          {current.authorName && (
            <p className="text-xs text-slate-400 mt-1">Set by {current.authorName}</p>
          )}

          {/* Snooze options */}
          <div className="mt-5">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Snooze for</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[5, 15, 30].map((mins) => (
                <button
                  key={mins}
                  onClick={() => snoozeMutation.mutate({ reminderId: current.id, minutes: mins })}
                  disabled={snoozeMutation.isPending}
                  className={cn(
                    "flex-1 rounded-xl border border-sky-200 bg-sky-50 text-sky-700 text-sm font-semibold py-2.5 hover:bg-sky-100 transition disabled:opacity-50"
                  )}
                >
                  {mins} min
                </button>
              ))}
            </div>
          </div>

          {/* Dismiss button */}
          <button
            onClick={() => dismissMutation.mutate({ reminderId: current.id })}
            disabled={dismissMutation.isPending}
            className="mt-3 w-full rounded-xl bg-slate-900 text-white text-sm font-semibold py-3 hover:bg-slate-700 transition disabled:opacity-50"
          >
            {dismissMutation.isPending ? "Dismissing…" : "Got it — Dismiss"}
          </button>

          {/* Remaining count */}
          {due.length > 1 && (
            <p className="text-center text-xs text-slate-400 mt-3">
              +{due.length - 1} more reminder{due.length - 1 !== 1 ? "s" : ""} waiting
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
