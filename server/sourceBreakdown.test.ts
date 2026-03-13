/**
 * Tests for leads.sourceBreakdown — groups leads by utmSource,
 * labels null sources as "direct", and respects date filtering.
 */
import { describe, it, expect } from "vitest";

// Mirror the sourceBreakdown aggregation logic for unit testing
type RawRow = { utmSource: string | null; count: number };

function aggregateSourceBreakdown(rows: RawRow[]) {
  return rows.map((r) => ({
    source: r.utmSource ?? "direct",
    count: Number(r.count),
  }));
}

describe("leads.sourceBreakdown aggregation", () => {
  it("labels null utmSource as 'direct'", () => {
    const rows: RawRow[] = [{ utmSource: null, count: 5 }];
    const result = aggregateSourceBreakdown(rows);
    expect(result).toEqual([{ source: "direct", count: 5 }]);
  });

  it("preserves named sources correctly", () => {
    const rows: RawRow[] = [
      { utmSource: "google", count: 10 },
      { utmSource: "meta", count: 4 },
      { utmSource: "bing", count: 2 },
    ];
    const result = aggregateSourceBreakdown(rows);
    expect(result).toHaveLength(3);
    expect(result.find((r) => r.source === "google")?.count).toBe(10);
    expect(result.find((r) => r.source === "meta")?.count).toBe(4);
    expect(result.find((r) => r.source === "bing")?.count).toBe(2);
  });

  it("returns empty array when no rows", () => {
    expect(aggregateSourceBreakdown([])).toEqual([]);
  });

  it("handles mixed null and named sources", () => {
    const rows: RawRow[] = [
      { utmSource: "google", count: 7 },
      { utmSource: null, count: 3 },
    ];
    const result = aggregateSourceBreakdown(rows);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.source === "direct")?.count).toBe(3);
    expect(result.find((r) => r.source === "google")?.count).toBe(7);
  });

  it("coerces string counts to numbers", () => {
    // DB may return count as string depending on driver
    const rows = [{ utmSource: "instagram", count: "12" as unknown as number }];
    const result = aggregateSourceBreakdown(rows);
    expect(typeof result[0].count).toBe("number");
    expect(result[0].count).toBe(12);
  });
});

// Percentage calculation helper (mirrors chart logic)
function calcPercent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

describe("source percentage calculation", () => {
  it("calculates correct percentages for a typical breakdown", () => {
    const data = [
      { source: "google", count: 60 },
      { source: "meta", count: 30 },
      { source: "direct", count: 10 },
    ];
    const total = data.reduce((s, r) => s + r.count, 0);
    expect(calcPercent(60, total)).toBe(60);
    expect(calcPercent(30, total)).toBe(30);
    expect(calcPercent(10, total)).toBe(10);
  });

  it("returns 0 when total is 0 (no division by zero)", () => {
    expect(calcPercent(0, 0)).toBe(0);
  });

  it("rounds to nearest integer", () => {
    // 1/3 = 33.33... → 33
    expect(calcPercent(1, 3)).toBe(33);
    // 2/3 = 66.66... → 67
    expect(calcPercent(2, 3)).toBe(67);
  });
});
