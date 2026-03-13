/**
 * SourceBreakdownChart — donut chart showing lead count by traffic source.
 * Used in the admin dashboard analytics section.
 */
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

type SourceRow = { source: string; count: number };

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
  // Fallback palette for unknown sources
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

  const total = data.reduce((s, r) => s + r.count, 0);

  // Sort descending by count
  const sorted = [...data].sort((a, b) => b.count - a.count);

  return (
    <div className="flex flex-col gap-4">
      {/* Donut chart */}
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={sorted}
            dataKey="count"
            nameKey="source"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={90}
            paddingAngle={2}
            label={false}
          >
            {sorted.map((entry, index) => (
              <Cell
                key={entry.source}
                fill={getColor(entry.source, index)}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, name: string) => [
              `${value} lead${value !== 1 ? "s" : ""} (${Math.round((value / total) * 100)}%)`,
              capitalise(name),
            ]}
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--card))",
              color: "hsl(var(--card-foreground))",
              fontSize: "13px",
            }}
          />
          <Legend
            formatter={(value) => (
              <span style={{ fontSize: 13, color: "hsl(var(--foreground))" }}>
                {capitalise(value)}
              </span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Summary table below the chart */}
      <div className="grid grid-cols-1 gap-1.5">
        {sorted.map((row, index) => (
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
            <div className="flex items-center gap-3 text-muted-foreground">
              <span>{row.count} lead{row.count !== 1 ? "s" : ""}</span>
              <span className="w-10 text-right font-semibold text-foreground">
                {Math.round((row.count / total) * 100)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
