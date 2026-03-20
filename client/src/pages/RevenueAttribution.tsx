/**
 * RevenueAttribution — Revenue Attribution Dashboard
 *
 * Shows the owner exactly what the software is worth:
 * - ROI hero card (total revenue vs software cost)
 * - Revenue by channel (form, widget, reactivation, voice)
 * - Monthly revenue trend bar chart
 * - Voice AI performance stats
 * - Top 5 jobs by revenue
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  TrendingUp,
  DollarSign,
  Briefcase,
  Phone,
  BarChart2,
  ArrowLeft,
  Star,
  Zap,
  Clock,
  Target,
  ChevronDown,
  Award,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WidgetHealthBadge, WebhookHealthBadge, SyncHealthBadge, QualityWidget } from "@/components/AdminHeader";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtDollar(n: number) {
  return "$" + fmt(n);
}

function fmtDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Inline bar chart (pure SVG, no deps) ─────────────────────────────────────

function BarChart({
  data,
  color = "#2563eb",
  height = 80,
}: {
  data: Array<{ label: string; value: number }>;
  color?: string;
  height?: number;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  const barW = 100 / data.length;
  const gap = 0.8;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        {data.map((d, i) => {
          const barH = (d.value / max) * (height - 4);
          const x = i * barW + gap / 2;
          const w = barW - gap;
          const y = height - barH;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={w}
                height={barH}
                rx="1"
                fill={d.value > 0 ? color : "#e5e7eb"}
                opacity={0.9}
              />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between mt-1">
        {data.map((d, i) => (
          <span key={i} className="text-[10px] text-gray-400 text-center flex-1 truncate px-0.5">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Channel color map ─────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<string, string> = {
  form: "#2563eb",
  widget: "#7c3aed",
  reactivation: "#059669",
  voice: "#d97706",
};

const CHANNEL_BG: Record<string, string> = {
  form: "#eff6ff",
  widget: "#f5f3ff",
  reactivation: "#ecfdf5",
  voice: "#fffbeb",
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RevenueAttribution() {
  const [months, setMonths] = useState(6);
  const [softwareCost, setSoftwareCost] = useState(500);

  const { data, isLoading } = trpc.leads.revenueAttribution.useQuery(
    { months, softwareCost },
    { refetchOnWindowFocus: false }
  );

  const summary = data?.summary;
  const byChannel = data?.byChannel ?? [];
  const byMonth = data?.byMonth ?? [];
  const voice = data?.voice;
  const topJobs = data?.topJobs ?? [];

  const roiColor =
    (summary?.roiMultiple ?? 0) >= 5
      ? "#059669"
      : (summary?.roiMultiple ?? 0) >= 2
      ? "#d97706"
      : "#dc2626";

  const roiLabel =
    (summary?.roiMultiple ?? 0) >= 10
      ? "Outstanding"
      : (summary?.roiMultiple ?? 0) >= 5
      ? "Excellent"
      : (summary?.roiMultiple ?? 0) >= 2
      ? "Good"
      : "Getting started";

  return (
    <div className="hj-theme min-h-screen" style={{ backgroundColor: '#F7F7F7' }}>
      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a
              href="/admin"
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </a>
            <span className="text-gray-300">/</span>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <h1 className="text-sm font-semibold text-gray-900">Revenue Attribution</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <WidgetHealthBadge />
            <WebhookHealthBadge />
            <SyncHealthBadge />
            <QualityWidget />
            <Select value={String(months)} onValueChange={v => setMonths(Number(v))}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 1 month</SelectItem>
                <SelectItem value="3">Last 3 months</SelectItem>
                <SelectItem value="6">Last 6 months</SelectItem>
                <SelectItem value="12">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── ROI Hero Card ── */}
        <div
          className="rounded-2xl p-6 text-white relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #1e40af 60%, #2563eb 100%)" }}
        >
          {/* Background decoration */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute -top-8 -right-8 w-48 h-48 rounded-full bg-white" />
            <div className="absolute -bottom-12 -left-8 w-64 h-64 rounded-full bg-white" />
          </div>

          <div className="relative z-10">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-blue-200 text-sm font-medium mb-1">Software ROI — Last {months} Month{months !== 1 ? "s" : ""}</p>
                {isLoading ? (
                  <div className="h-12 w-48 bg-white/20 rounded-lg animate-pulse" />
                ) : (
                  <div className="flex items-baseline gap-3">
                    <span className="text-5xl font-black tracking-tight">
                      {summary?.roiMultiple ?? 0}x
                    </span>
                    <span
                      className="text-sm font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: roiColor + "33", color: "#fff" }}
                    >
                      {roiLabel}
                    </span>
                  </div>
                )}
                <p className="text-blue-200 text-sm mt-2">
                  {isLoading ? "—" : (
                    <>
                      {fmtDollar(summary?.totalRevenue ?? 0)} revenue ÷{" "}
                      {fmtDollar((summary?.softwareCost ?? 500) * months)} software cost
                    </>
                  )}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-white/10 rounded-xl px-4 py-3">
                  <p className="text-blue-200 text-xs mb-1">Total Revenue</p>
                  <p className="text-xl font-bold">
                    {isLoading ? "—" : fmtDollar(summary?.totalRevenue ?? 0)}
                  </p>
                </div>
                <div className="bg-white/10 rounded-xl px-4 py-3">
                  <p className="text-blue-200 text-xs mb-1">Jobs Booked</p>
                  <p className="text-xl font-bold">
                    {isLoading ? "—" : fmt(summary?.totalJobs ?? 0)}
                  </p>
                </div>
                <div className="bg-white/10 rounded-xl px-4 py-3">
                  <p className="text-blue-200 text-xs mb-1">Avg Job Value</p>
                  <p className="text-xl font-bold">
                    {isLoading ? "—" : fmtDollar(summary?.avgJobValue ?? 0)}
                  </p>
                </div>
              </div>
            </div>

            {/* ROI bar */}
            {!isLoading && (summary?.totalRevenue ?? 0) > 0 && (
              <div className="mt-5">
                <div className="flex justify-between text-xs text-blue-200 mb-1">
                  <span>Software cost: {fmtDollar((summary?.softwareCost ?? 500) * months)}</span>
                  <span>Revenue generated: {fmtDollar(summary?.totalRevenue ?? 0)}</span>
                </div>
                <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(100, ((summary?.totalRevenue ?? 0) / Math.max(summary?.totalRevenue ?? 1, (summary?.softwareCost ?? 500) * months)) * 100)}%`,
                      background: "linear-gradient(90deg, #34d399, #10b981)",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Two-column: Monthly Trend + Channel Breakdown ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Monthly Revenue Trend — 2/3 width */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Monthly Revenue</h2>
                <p className="text-xs text-gray-500 mt-0.5">Booked job revenue by month</p>
              </div>
              <BarChart2 className="w-4 h-4 text-gray-400" />
            </div>

            {isLoading ? (
              <div className="h-24 bg-gray-100 rounded-lg animate-pulse" />
            ) : byMonth.length === 0 || byMonth.every(m => m.revenue === 0) ? (
              <div className="h-24 flex items-center justify-center text-sm text-gray-400">
                No booked revenue in this period
              </div>
            ) : (
              <BarChart
                data={byMonth.map(m => ({ label: m.label, value: m.revenue }))}
                color="#2563eb"
                height={100}
              />
            )}

            {/* Monthly table */}
            {!isLoading && byMonth.some(m => m.revenue > 0) && (
              <div className="mt-4 divide-y divide-gray-50">
                {byMonth.filter(m => m.revenue > 0).map(m => (
                  <div key={m.month} className="flex items-center justify-between py-2">
                    <span className="text-sm text-gray-600">{m.label} {m.month.slice(0, 4)}</span>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-500">{m.jobs} job{m.jobs !== 1 ? "s" : ""}</span>
                      <span className="font-semibold text-gray-900">{fmtDollar(m.revenue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Channel Breakdown — 1/3 width */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Revenue by Channel</h2>
                <p className="text-xs text-gray-500 mt-0.5">Where your jobs come from</p>
              </div>
              <Target className="w-4 h-4 text-gray-400" />
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : byChannel.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-sm text-gray-400">
                No booked revenue yet
              </div>
            ) : (
              <div className="space-y-3">
                {byChannel.map(ch => {
                  const color = CHANNEL_COLORS[ch.channel] ?? "#6b7280";
                  const bg = CHANNEL_BG[ch.channel] ?? "#f9fafb";
                  const totalRev = summary?.totalRevenue ?? 1;
                  const pct = totalRev > 0 ? Math.round((ch.revenue / totalRev) * 100) : 0;
                  return (
                    <div
                      key={ch.channel}
                      className="rounded-xl p-3"
                      style={{ background: bg }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold" style={{ color }}>{ch.label}</span>
                        <span className="text-xs text-gray-500">{pct}%</span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-lg font-bold text-gray-900">{fmtDollar(ch.revenue)}</span>
                        <span className="text-xs text-gray-500">{ch.jobs} job{ch.jobs !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="mt-2 h-1.5 bg-white/60 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Voice AI Stats + Top Jobs ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Voice AI Performance */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Voice AI Performance</h2>
                <p className="text-xs text-gray-500 mt-0.5">Madison's call stats for this period</p>
              </div>
              <Phone className="w-4 h-4 text-gray-400" />
            </div>

            {isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-violet-50 p-4">
                  <p className="text-xs text-violet-500 font-medium mb-1">Calls Handled</p>
                  <p className="text-2xl font-bold text-gray-900">{fmt(voice?.totalCalls ?? 0)}</p>
                  <p className="text-xs text-gray-400 mt-1">by Madison AI</p>
                </div>
                <div className="rounded-xl bg-amber-50 p-4">
                  <p className="text-xs text-amber-600 font-medium mb-1">Booked via Call</p>
                  <p className="text-2xl font-bold text-gray-900">{fmt(voice?.bookedViaCalls ?? 0)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {voice?.callConversionRate ?? 0}% conversion
                  </p>
                </div>
                <div className="rounded-xl bg-blue-50 p-4">
                  <p className="text-xs text-blue-500 font-medium mb-1">Avg Call Duration</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {fmtDuration(voice?.avgDurationSeconds ?? 0)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">min:sec</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-4">
                  <p className="text-xs text-emerald-600 font-medium mb-1">Call Conversion</p>
                  <p className="text-2xl font-bold text-gray-900">{voice?.callConversionRate ?? 0}%</p>
                  <p className="text-xs text-gray-400 mt-1">calls → booked</p>
                </div>
              </div>
            )}

            {!isLoading && (voice?.totalCalls ?? 0) === 0 && (
              <p className="text-center text-sm text-gray-400 mt-4">No voice calls in this period</p>
            )}
          </div>

          {/* Top Jobs */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Top Jobs by Revenue</h2>
                <p className="text-xs text-gray-500 mt-0.5">Highest-value bookings this period</p>
              </div>
              <Award className="w-4 h-4 text-gray-400" />
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : topJobs.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-sm text-gray-400">
                No booked jobs in this period
              </div>
            ) : (
              <div className="space-y-2">
                {topJobs.map((job, idx) => (
                  <div
                    key={job.id}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{
                        background: idx === 0 ? "#f59e0b" : idx === 1 ? "#9ca3af" : idx === 2 ? "#d97706" : "#e5e7eb",
                        color: idx < 3 ? "#fff" : "#6b7280",
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{job.name}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {job.channel}
                        {job.bookedAt && (
                          <> · {new Date(job.bookedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</>
                        )}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-gray-900 flex-shrink-0">
                      {fmtDollar(job.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer note ── */}
        <p className="text-xs text-gray-400 text-center pb-4">
          Revenue figures use admin-set amounts where available, otherwise quoted price + extras.
          Software cost set to {fmtDollar(softwareCost)}/month.
        </p>
      </main>
    </div>
  );
}
