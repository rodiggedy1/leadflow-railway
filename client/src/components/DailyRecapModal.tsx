/**
 * DailyRecapModal — "Yesterday's Recap" morning briefing overlay.
 *
 * Shows once per calendar day (keyed in localStorage as recap_shown_YYYY-MM-DD).
 * Closes only on explicit user action (X button or "Let's go" CTA).
 *
 * Design: HeyJade light theme — white card, lime green (#AAFF00) accents,
 * "Yesterday" label large and prominent throughout.
 */

import { useEffect, useRef } from "react";
import { X, TrendingUp, DollarSign, Phone, ChevronRight, Trophy, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocalDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STORAGE_KEY_PREFIX = "recap_shown_";

function hasShownToday(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_PREFIX + getLocalDateKey()) === "1";
  } catch {
    return false;
  }
}

function markShownToday(): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + getLocalDateKey(), "1");
  } catch { /* ignore */ }
}

// ── Stage label map ───────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  QUOTE_SENT: "Quoted",
  FOLLOW_UP: "Follow Up",
  AVAILABILITY: "Availability",
  BOOKED: "Booked",
  NOT_INTERESTED: "Not Interested",
  REACTIVATION: "Reactivation",
};

// ── Funnel step ───────────────────────────────────────────────────────────────

function FunnelStep({
  label,
  count,
  color,
  isLast = false,
}: {
  label: string;
  count: number;
  color: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shadow-sm"
          style={{ backgroundColor: color, color: color === "#AAFF00" ? "#111" : "#fff" }}
        >
          {count}
        </div>
        <span className="text-[11px] text-gray-500 mt-1.5 font-medium text-center leading-tight">{label}</span>
      </div>
      {!isLast && (
        <ChevronRight className="w-4 h-4 text-gray-300 mb-4 flex-shrink-0" />
      )}
    </div>
  );
}

// ── Agent leaderboard row ─────────────────────────────────────────────────────

function AgentRow({
  rank,
  name,
  count,
  revenue,
}: {
  rank: number;
  name: string;
  count: number;
  revenue: number;
}) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["bg-emerald-500", "bg-blue-500", "bg-purple-500", "bg-amber-500", "bg-rose-500"];
  const bg = colors[(rank - 1) % colors.length];

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className="w-6 text-center text-xs font-bold text-gray-400">
        {rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`}
      </span>
      <div className={`w-8 h-8 rounded-full ${bg} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
        {initials}
      </div>
      <span className="flex-1 text-sm font-semibold text-gray-900 truncate">{name}</span>
      <span className="text-xs text-gray-500 mr-1">{count} booked</span>
      <span className="text-sm font-bold text-gray-900">${revenue.toLocaleString()}</span>
    </div>
  );
}

// ── Pending lead row ──────────────────────────────────────────────────────────

function PendingRow({
  lead,
}: {
  lead: { id: number; name: string; phone: string; stage: string; service: string | null; quotedPrice: number | null };
}) {
  const stageColors: Record<string, string> = {
    FOLLOW_UP: "bg-amber-100 text-amber-700",
    AVAILABILITY: "bg-green-100 text-green-700",
    QUOTE_SENT: "bg-blue-100 text-blue-700",
  };
  const stageClass = stageColors[lead.stage] ?? "bg-gray-100 text-gray-600";

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 truncate">{lead.name}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${stageClass}`}>
            {STAGE_LABELS[lead.stage] ?? lead.stage}
          </span>
        </div>
        {lead.service && (
          <span className="text-xs text-gray-400 truncate block mt-0.5">{lead.service}</span>
        )}
      </div>
      {lead.quotedPrice && (
        <span className="text-sm font-bold text-gray-800 mr-1">${lead.quotedPrice.toLocaleString()}</span>
      )}
      <a
        href={`openphone://call?to=${lead.phone}`}
        onClick={e => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full transition-colors flex-shrink-0"
        style={{ backgroundColor: "#AAFF00", color: "#111" }}
      >
        <Phone className="w-3 h-3" />
        Call
      </a>
    </div>
  );
}

// ── Headline generator ────────────────────────────────────────────────────────

function buildHeadline(totalLeads: number, bookedCount: number, bookedRevenue: number): string {
  if (totalLeads === 0) {
    return "No new leads came in. Let's make today count.";
  }
  if (bookedCount === 0) {
    return `${totalLeads} lead${totalLeads === 1 ? "" : "s"} came in. None booked yet — time to follow up.`;
  }
  const rate = Math.round((bookedCount / totalLeads) * 100);
  if (rate >= 60) {
    return `${bookedCount} of ${totalLeads} leads booked — ${rate}% conversion. Outstanding! 🔥`;
  }
  if (rate >= 40) {
    return `${bookedCount} of ${totalLeads} leads booked — $${bookedRevenue.toLocaleString()} in new revenue.`;
  }
  return `${totalLeads} leads came in. ${bookedCount} booked. $${bookedRevenue.toLocaleString()} in new revenue.`;
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface DailyRecapModalProps {
  onClose: () => void;
}

export default function DailyRecapModal({ onClose }: DailyRecapModalProps) {
  const { user } = useAuth();
  const overlayRef = useRef<HTMLDivElement>(null);

  const { data: recap, isLoading } = trpc.leads.yesterdayRecap.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const firstName = user?.name?.split(" ")[0] ?? "there";

  const funnelSteps = recap
    ? [
        { label: "Leads", count: recap.totalLeads, color: "#6366f1" },
        { label: "Quoted", count: recap.stageCounts?.QUOTE_SENT ?? 0, color: "#3b82f6" },
        { label: "Availability", count: recap.stageCounts?.AVAILABILITY ?? 0, color: "#f59e0b" },
        { label: "Booked", count: recap.bookedCount, color: "#AAFF00" },
      ]
    : [];

  const headline = recap
    ? buildHeadline(recap.totalLeads, recap.bookedCount, recap.bookedRevenue)
    : "";

  const dateLabel = recap?.date
    ? new Date(recap.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : "Yesterday";

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)" }}
    >
      {/* Modal card */}
      <div
        className="daily-recap-modal relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
        style={{
          animation: "recapSlideUp 0.35s cubic-bezier(0.34,1.56,0.64,1) both",
          maxHeight: "90vh",
          overflowY: "auto",
          border: "1px solid #e5e7eb",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        } as React.CSSProperties}
      >
        {/* Top accent bar */}
        <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg, #AAFF00 0%, #7dcc00 100%)" }} />

        {/* Header — white with lime green accents */}
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              {/* YESTERDAY label — large and prominent */}
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest mb-3"
                style={{ backgroundColor: "#AAFF00", color: "#111" }}
              >
                <Zap className="w-3 h-3" />
                Yesterday · {dateLabel}
              </div>
              <h2 className="text-2xl font-bold text-gray-900 leading-snug">
                Good morning, {firstName} 👋
              </h2>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
                {isLoading ? "Loading your recap…" : headline}
              </p>
            </div>
            <button
              onClick={onClose}
              className="ml-4 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors flex-shrink-0 mt-1"
              aria-label="Close recap"
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
          </div>

          {/* Key stats row */}
          {recap && (
            <div className="grid grid-cols-4 gap-2 mt-4">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <div className="flex items-center gap-1 mb-1">
                  <TrendingUp className="w-3 h-3 text-gray-400" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Leads</span>
                </div>
                <span className="text-2xl font-bold text-gray-900">{recap.totalLeads}</span>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[10px]">✓</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Booked</span>
                </div>
                <span className="text-2xl font-bold text-gray-900">{recap.bookedCount}</span>
              </div>
              <div
                className="rounded-2xl px-3 py-2.5 col-span-1"
                style={{ backgroundColor: "#AAFF00" }}
              >
                <div className="flex items-center gap-1 mb-1">
                  <DollarSign className="w-3 h-3 text-black/60" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-black/60">Revenue</span>
                </div>
                <span className="text-2xl font-bold text-black">${recap.bookedRevenue.toLocaleString()}</span>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Conv.</span>
                </div>
                <span className="text-2xl font-bold text-gray-900">{recap.conversionRate}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-gray-100 mx-6" />

        {/* Body */}
        <div className="px-6 py-5 space-y-5">

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
            </div>
          )}

          {/* Funnel */}
          {recap && recap.totalLeads > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">
                Yesterday's Funnel
              </h3>
              <div className="flex items-start gap-1 flex-wrap">
                {funnelSteps.map((step, i) => (
                  <FunnelStep
                    key={step.label}
                    label={step.label}
                    count={step.count}
                    color={step.color}
                    isLast={i === funnelSteps.length - 1}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Agent leaderboard */}
          {recap && recap.agentLeaderboard.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1 flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5" />
                Agent Leaderboard — Yesterday
              </h3>
              <div>
                {recap.agentLeaderboard.map((agent, i) => (
                  <AgentRow
                    key={agent.name}
                    rank={i + 1}
                    name={agent.name}
                    count={agent.count}
                    revenue={Math.round(agent.revenue)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Best source */}
          {recap && recap.topSource && (
            <div
              className="rounded-2xl px-4 py-3 flex items-center gap-3"
              style={{ backgroundColor: "#f9fafb", border: "1px solid #e5e7eb" }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                style={{ backgroundColor: "#AAFF00" }}
              >
                🌐
              </div>
              <div>
                <div className="text-xs text-gray-400 font-medium">Top traffic source yesterday</div>
                <div className="text-sm font-bold text-gray-900">{recap.topSource}</div>
              </div>
            </div>
          )}

          {/* Pending follow-ups */}
          {recap && recap.pendingFollowUps.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" />
                Still needs attention ({recap.pendingFollowUps.length})
              </h3>
              <div
                className="rounded-2xl px-4 py-1"
                style={{ backgroundColor: "#f9fafb", border: "1px solid #e5e7eb" }}
              >
                {recap.pendingFollowUps.map(lead => (
                  <PendingRow key={lead.id} lead={lead} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {recap && recap.totalLeads === 0 && (
            <div className="text-center py-6">
              <div className="text-4xl mb-2">😴</div>
              <p className="text-sm text-gray-500">No leads came in yesterday.</p>
              <p className="text-sm font-semibold text-gray-700 mt-1">Let's make today a great one.</p>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-2xl text-sm font-bold transition-opacity hover:opacity-90"
            style={{ backgroundColor: "#111", color: "#fff" }}
          >
            Let's go →
          </button>
        </div>
      </div>

      {/* Slide-up animation */}
      <style>{`
        @keyframes recapSlideUp {
          from { opacity: 0; transform: translateY(32px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── Export helper so AdminDashboard can check if modal should show ─────────────

export { hasShownToday, markShownToday };
