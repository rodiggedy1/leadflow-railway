/**
 * SourceBreakdownChart — grouped bar chart showing visitor and lead counts by traffic source.
 * Used in the admin dashboard analytics section.
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";

type SourceRow = {
  source: string;
  /** Total page views from this source */
  visitors?: number;
  /** Form submissions (leads) from this source */
  leads?: number;
  /** Backwards-compat alias for leads */
  count?: number;
};

// Colour palette — ordered by most common sources
const SOURCE_COLORS: Record<string, string> = {
  google: "#4285F4",
  meta: "#1877F2",
  instagram: "#E1306C",
  facebook: "#1877F2",
  bing: "#00809D",
  direct: "#94A3B8",
  referral: "#F59E0B",
  email: "#10B981",
  sms: "#8B5CF6",
};

function getColor(source: string, index: number): string {
  const key = source.toLowerCase();
  if (SOURCE_COLORS[key]) return SOURCE_COLORS[key];
  const fallback = ["#F97316", "#EC4899", "#14B8A6", "#6366F1", "#84CC16"];
  return fallback[index % fallback.length];
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface Props {
  data: SourceRow[];
  isLoading?: boolean;
}

export default function SourceBreakdownChart({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
        <span className="text-2xl">📊</span>
        <span>No source data yet — UTM params will appear here once leads start coming in.</span>
      </div>
    );
  }

  // Normalise rows so every entry has both visitors and leads
  const normalised = data.map((r) => ({
    source: r.source,
    visitors: r.visitors ?? 0,
    leads: r.leads ?? r.count ?? 0,
  }));

  // Sort descending by visitors (primary) then leads
  const sorted = [...normalised].sort(
    (a, b) => b.visitors - a.visitors || b.leads - a.leads
  );

  const totalVisitors = sorted.reduce((s, r) => s + r.visitors, 0);
  const totalLeads = sorted.reduce((s, r) => s + r.leads, 0);

  // Custom tooltip
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
    return (
      <div
        style={{
          borderRadius: 8,
          border: "1px solid hsl(var(--border))",
          background: "hsl(var(--card))",
          color: "hsl(var(--card-foreground))",
          fontSize: 13,
          padding: "8px 12px",
        }}
      >
        <p className="font-semibold mb-1">{capitalise(label ?? "")}</p>
        {payload.map((p) => (
          <p key={p.name} style={{ color: p.color }}>
            {capitalise(p.name)}: <strong>{p.value}</strong>
          </p>
        ))}
        {payload.length === 2 && payload[0].value > 0 && (
          <p className="text-muted-foreground mt-1 text-xs">
            Conversion: {Math.round((payload[1].value / payload[0].value) * 100)}%
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Grouped bar chart */}
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={sorted}
          margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
          barCategoryGap="30%"
          barGap={3}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="source"
            tickFormatter={capitalise}
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
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
                {capitalise(value)}
              </span>
            )}
          />
          <Bar dataKey="visitors" name="visitors" radius={[3, 3, 0, 0]}>
            {sorted.map((entry, index) => (
              <Cell
                key={entry.source}
                fill={getColor(entry.source, index)}
                fillOpacity={0.35}
              />
            ))}
          </Bar>
          <Bar dataKey="leads" name="leads" radius={[3, 3, 0, 0]}>
            {sorted.map((entry, index) => (
              <Cell
                key={entry.source}
                fill={getColor(entry.source, index)}
                fillOpacity={1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Summary table */}
      <div className="grid grid-cols-1 gap-1.5">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <span>Source</span>
          <div className="flex items-center gap-6">
            <span className="w-20 text-right">Visitors</span>
            <span className="w-16 text-right">Leads</span>
            <span className="w-16 text-right">Conv %</span>
          </div>
        </div>
        {sorted.map((row, index) => {
          const convRate =
            row.visitors > 0 ? Math.round((row.leads / row.visitors) * 100) : 0;
          return (
            <div
              key={row.source}
              className="flex items-center justify-between px-3 py-1.5 rounded-md bg-muted/40 text-sm"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: getColor(row.source, index) }}
                />
                <span className="font-medium">{capitalise(row.source)}</span>
              </div>
              <div className="flex items-center gap-6 text-muted-foreground">
                <span className="w-20 text-right">
                  {row.visitors.toLocaleString()}
                  {totalVisitors > 0 && (
                    <span className="text-xs ml-1">
                      ({Math.round((row.visitors / totalVisitors) * 100)}%)
                    </span>
                  )}
                </span>
                <span className="w-16 text-right font-semibold text-foreground">
                  {row.leads.toLocaleString()}
                </span>
                <span className="w-16 text-right text-xs font-medium">
                  {convRate > 0 ? `${convRate}%` : "—"}
                </span>
              </div>
            </div>
          );
        })}
        {/* Totals row */}
        <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-muted/60 text-sm border-t border-border mt-1">
          <span className="font-semibold">Total</span>
          <div className="flex items-center gap-6">
            <span className="w-20 text-right font-semibold">
              {totalVisitors.toLocaleString()}
            </span>
            <span className="w-16 text-right font-semibold">
              {totalLeads.toLocaleString()}
            </span>
            <span className="w-16 text-right text-xs font-semibold">
              {totalVisitors > 0
                ? `${Math.round((totalLeads / totalVisitors) * 100)}%`
                : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
