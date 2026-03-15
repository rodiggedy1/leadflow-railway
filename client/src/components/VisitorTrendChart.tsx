/**
 * VisitorTrendChart — area/line chart showing unique visitors and new leads
 * per calendar day over the last 14 days (or custom range).
 * Used in the admin dashboard analytics section.
 */
import { useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { trpc } from "@/lib/trpc";

type TrendRow = {
  date: string;   // YYYY-MM-DD
  visitors: number;
  leads: number;
};

// Format "2026-03-15" → "Mar 15"
function fmtDate(d: string): string {
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const visitors = payload.find(p => p.name === "visitors")?.value ?? 0;
  const leads = payload.find(p => p.name === "leads")?.value ?? 0;
  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid hsl(var(--border))",
        background: "hsl(var(--card))",
        color: "hsl(var(--card-foreground))",
        fontSize: 13,
        padding: "8px 12px",
        minWidth: 140,
      }}
    >
      <p className="font-semibold mb-1.5">{label}</p>
      <p style={{ color: "#6366F1" }}>
        Visitors: <strong>{visitors}</strong>
      </p>
      <p style={{ color: "#F97316" }}>
        Leads: <strong>{leads}</strong>
      </p>
      {visitors > 0 && (
        <p className="text-muted-foreground mt-1 text-xs">
          Conv: {Math.round((leads / visitors) * 100)}%
        </p>
      )}
    </div>
  );
};

const RANGE_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
];

export default function VisitorTrendChart() {
  const [days, setDays] = useState(14);

  const { data, isLoading } = trpc.leads.visitorTrend.useQuery(
    { days },
    { refetchOnWindowFocus: false }
  );

  // Summary totals
  const totalVisitors = data?.reduce((s, r) => s + r.visitors, 0) ?? 0;
  const totalLeads = data?.reduce((s, r) => s + r.leads, 0) ?? 0;
  const peakVisitors = data ? Math.max(...data.map(r => r.visitors), 0) : 0;

  // Format dates for display
  const chartData: (TrendRow & { label: string })[] = (data ?? []).map(r => ({
    ...r,
    label: fmtDate(r.date),
  }));

  return (
    <div className="rounded-xl border bg-card p-5 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Daily Visitor Trend</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Unique visitors and new leads per day
          </p>
        </div>
        {/* Range selector */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.days}
              onClick={() => setDays(opt.days)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                days === opt.days
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary pills */}
      <div className="flex gap-4 mb-4">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500/30 border border-indigo-500 inline-block" />
          <span className="text-muted-foreground">Visitors</span>
          <span className="font-semibold text-foreground">{totalVisitors.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="w-2.5 h-2.5 rounded-full bg-orange-500/30 border border-orange-500 inline-block" />
          <span className="text-muted-foreground">Leads</span>
          <span className="font-semibold text-foreground">{totalLeads.toLocaleString()}</span>
        </div>
        {totalVisitors > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Conv</span>
            <span className="font-semibold text-foreground">
              {Math.round((totalLeads / totalVisitors) * 100)}%
            </span>
          </div>
        )}
        {peakVisitors > 0 && (
          <div className="flex items-center gap-1.5 text-xs ml-auto">
            <span className="text-muted-foreground">Peak</span>
            <span className="font-semibold text-foreground">{peakVisitors} visitors/day</span>
          </div>
        )}
      </div>

      {/* Chart */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Loading…
        </div>
      ) : !chartData.length || totalVisitors === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
          <span className="text-2xl">📈</span>
          <span>No visitor data yet — check back once traffic starts coming in.</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart
            data={chartData}
            margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
          >
            <defs>
              <linearGradient id="visitorGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366F1" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#6366F1" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="leadGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F97316" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#F97316" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              interval={days <= 14 ? 1 : Math.floor(days / 10)}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              formatter={(value) => (
                <span style={{ fontSize: 12, color: "hsl(var(--foreground))" }}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </span>
              )}
            />
            {/* Visitors — filled area */}
            <Area
              type="monotone"
              dataKey="visitors"
              name="visitors"
              stroke="#6366F1"
              strokeWidth={2}
              fill="url(#visitorGrad)"
              dot={false}
              activeDot={{ r: 4, fill: "#6366F1" }}
            />
            {/* Leads — line on top */}
            <Line
              type="monotone"
              dataKey="leads"
              name="leads"
              stroke="#F97316"
              strokeWidth={2}
              dot={{ r: 3, fill: "#F97316", strokeWidth: 0 }}
              activeDot={{ r: 5, fill: "#F97316" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
