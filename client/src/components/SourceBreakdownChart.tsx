/**
 * SourceBreakdownChart — World-class traffic source breakdown
 *
 * Replaces the old bar chart + table combo with:
 * - A "best converting source" + "most leads" highlight callout row
 * - A unified table with inline progress bars for visitors & leads
 * - Color-coded conversion rate pills (green / amber / gray)
 */
import { Loader2, TrendingUp, Zap } from "lucide-react";

type SourceRow = {
  source: string;
  visitors?: number;
  leads?: number;
  count?: number;
};

interface Props {
  data: SourceRow[];
  isLoading?: boolean;
}

// Consistent color palette per source
const SOURCE_COLORS: Record<string, string> = {
  direct:             "#6366f1",
  "maidsinblack.com": "#ec4899",
  google:             "#3b82f6",
  "manus.im":         "#8b5cf6",
  "chatgpt.com":      "#22c55e",
  meta:               "#1877F2",
  instagram:          "#E1306C",
  facebook:           "#1877F2",
  bing:               "#00809D",
  referral:           "#f59e0b",
  email:              "#10b981",
  sms:                "#8b5cf6",
};

function getColor(source: string, index: number): string {
  const fallbacks = ["#f59e0b", "#14b8a6", "#ef4444", "#a855f7", "#06b6d4"];
  return SOURCE_COLORS[source.toLowerCase()] ?? fallbacks[index % fallbacks.length];
}

function capitalise(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ConvPill({ rate }: { rate: number }) {
  if (rate === 0) return <span className="text-xs text-gray-400">—</span>;
  let cls = "bg-gray-100 text-gray-500";
  if (rate >= 40) cls = "bg-emerald-50 text-emerald-700";
  else if (rate >= 20) cls = "bg-amber-50 text-amber-700";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {rate}%
    </span>
  );
}

export default function SourceBreakdownChart({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <TrendingUp className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-sm">No traffic data for this period</p>
      </div>
    );
  }

  // Normalise rows
  const normalised = data.map((r) => ({
    source: r.source,
    visitors: r.visitors ?? 0,
    leads: r.leads ?? r.count ?? 0,
  }));

  const sorted = [...normalised].sort((a, b) => b.leads - a.leads || b.visitors - a.visitors);
  const totalVisitors = sorted.reduce((s, r) => s + r.visitors, 0);
  const totalLeads = sorted.reduce((s, r) => s + r.leads, 0);
  const maxVisitors = Math.max(...sorted.map((r) => r.visitors), 1);
  const maxLeads = Math.max(...sorted.map((r) => r.leads), 1);

  // Best converting source (min 2 visitors to avoid noise)
  const bestSource = [...sorted]
    .filter((r) => r.visitors >= 2)
    .sort((a, b) => b.leads / b.visitors - a.leads / a.visitors)[0];
  const bestConvRate = bestSource
    ? Math.round((bestSource.leads / bestSource.visitors) * 100)
    : 0;

  // Top lead source
  const topLeadSource = sorted[0];

  return (
    <div className="flex flex-col gap-5">

      {/* ── Highlight callout row ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {bestSource && (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
              <Zap className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Best Converting</p>
              <p className="mt-0.5 truncate text-sm font-bold text-gray-900">{capitalise(bestSource.source)}</p>
              <p className="text-xs font-medium text-emerald-700">{bestConvRate}% visitor → lead</p>
            </div>
          </div>
        )}
        {topLeadSource && (
          <div className="flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-100">
              <TrendingUp className="h-3.5 w-3.5 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">Most Leads</p>
              <p className="mt-0.5 truncate text-sm font-bold text-gray-900">{capitalise(topLeadSource.source)}</p>
              <p className="text-xs font-medium text-indigo-700">{topLeadSource.leads} leads this period</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Unified table ─────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-gray-100">
        {/* Header */}
        <div
          className="grid gap-3 border-b border-gray-100 bg-gray-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
          style={{ gridTemplateColumns: "1fr 2fr 2fr 80px" }}
        >
          <span>Source</span>
          <span>Visitors</span>
          <span>Leads</span>
          <span className="text-right">Conv %</span>
        </div>

        {/* Rows */}
        {sorted.map((row, index) => {
          const convRate = row.visitors > 0 ? Math.round((row.leads / row.visitors) * 100) : 0;
          const visitorPct = (row.visitors / maxVisitors) * 100;
          const leadPct = (row.leads / maxLeads) * 100;
          const color = getColor(row.source, index);
          const shareOfVisitors = totalVisitors > 0 ? Math.round((row.visitors / totalVisitors) * 100) : 0;

          return (
            <div
              key={row.source}
              className="grid gap-3 items-center border-b border-gray-50 px-4 py-3 last:border-0 hover:bg-gray-50/60 transition-colors"
              style={{ gridTemplateColumns: "1fr 2fr 2fr 80px" }}
            >
              {/* Source name */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                <span className="truncate text-sm font-medium text-gray-800">{capitalise(row.source)}</span>
              </div>

              {/* Visitors bar */}
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700">{row.visitors.toLocaleString()}</span>
                  <span className="text-[10px] text-gray-400">{shareOfVisitors}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${visitorPct}%`, background: color, opacity: 0.35 }}
                  />
                </div>
              </div>

              {/* Leads bar */}
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-xs font-semibold text-gray-700">{row.leads.toLocaleString()}</span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${leadPct}%`, background: color }}
                  />
                </div>
              </div>

              {/* Conversion pill */}
              <div className="flex justify-end">
                <ConvPill rate={convRate} />
              </div>
            </div>
          );
        })}

        {/* Totals row */}
        <div
          className="grid gap-3 items-center bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-800 border-t border-gray-100"
          style={{ gridTemplateColumns: "1fr 2fr 2fr 80px" }}
        >
          <span>Total</span>
          <span>{totalVisitors.toLocaleString()}</span>
          <span>{totalLeads.toLocaleString()}</span>
          <div className="flex justify-end">
            <ConvPill rate={totalVisitors > 0 ? Math.round((totalLeads / totalVisitors) * 100) : 0} />
          </div>
        </div>
      </div>
    </div>
  );
}
