/**
 * Tests for leads.sourceBreakdown — merges visitor counts (page_views) and
 * lead counts (conversation_sessions) by utmSource, labels null as "direct".
 */
import { describe, it, expect } from "vitest";

// ─── Helpers mirroring the server aggregation logic ───────────────────────────

type RawLeadRow    = { utmSource: string | null; count: number };
type RawVisitorRow = { utmSource: string | null; count: number };

function aggregateSourceBreakdown(
  leadRows: RawLeadRow[],
  visitorRows: RawVisitorRow[]
) {
  const map = new Map<string, { visitors: number; leads: number }>();

  for (const r of visitorRows) {
    const src = r.utmSource ?? "direct";
    map.set(src, { visitors: Number(r.count), leads: 0 });
  }
  for (const r of leadRows) {
    const src = r.utmSource ?? "direct";
    const existing = map.get(src) ?? { visitors: 0, leads: 0 };
    map.set(src, { ...existing, leads: Number(r.count) });
  }

  return Array.from(map.entries()).map(([source, { visitors, leads }]) => ({
    source,
    visitors,
    leads,
    count: leads, // backwards-compat
  }));
}

// ─── Aggregation tests ────────────────────────────────────────────────────────

describe("leads.sourceBreakdown aggregation (visitors + leads)", () => {
  it("labels null utmSource as 'direct' for both visitors and leads", () => {
    const result = aggregateSourceBreakdown(
      [{ utmSource: null, count: 5 }],
      [{ utmSource: null, count: 20 }]
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: "direct", visitors: 20, leads: 5, count: 5 });
  });

  it("merges visitor and lead rows for the same source", () => {
    const result = aggregateSourceBreakdown(
      [{ utmSource: "google", count: 10 }],
      [{ utmSource: "google", count: 100 }]
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: "google", visitors: 100, leads: 10 });
  });

  it("includes sources that have visitors but no leads yet", () => {
    const result = aggregateSourceBreakdown(
      [],
      [{ utmSource: "bing", count: 15 }]
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: "bing", visitors: 15, leads: 0 });
  });

  it("includes sources that have leads but no recorded visitors", () => {
    const result = aggregateSourceBreakdown(
      [{ utmSource: "email", count: 3 }],
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: "email", visitors: 0, leads: 3 });
  });

  it("handles multiple sources correctly", () => {
    const result = aggregateSourceBreakdown(
      [
        { utmSource: "google", count: 10 },
        { utmSource: "meta",   count: 4 },
        { utmSource: null,     count: 2 },
      ],
      [
        { utmSource: "google", count: 80 },
        { utmSource: "meta",   count: 30 },
        { utmSource: null,     count: 50 },
      ]
    );
    expect(result).toHaveLength(3);
    expect(result.find((r) => r.source === "google")).toMatchObject({ visitors: 80, leads: 10 });
    expect(result.find((r) => r.source === "meta")).toMatchObject({ visitors: 30, leads: 4 });
    expect(result.find((r) => r.source === "direct")).toMatchObject({ visitors: 50, leads: 2 });
  });

  it("returns empty array when both inputs are empty", () => {
    expect(aggregateSourceBreakdown([], [])).toEqual([]);
  });

  it("coerces string counts to numbers", () => {
    const result = aggregateSourceBreakdown(
      [{ utmSource: "instagram", count: "12" as unknown as number }],
      [{ utmSource: "instagram", count: "45" as unknown as number }]
    );
    expect(typeof result[0].visitors).toBe("number");
    expect(typeof result[0].leads).toBe("number");
    expect(result[0].visitors).toBe(45);
    expect(result[0].leads).toBe(12);
  });

  it("count field is an alias for leads (backwards compat)", () => {
    const result = aggregateSourceBreakdown(
      [{ utmSource: "sms", count: 7 }],
      [{ utmSource: "sms", count: 50 }]
    );
    expect(result[0].count).toBe(result[0].leads);
  });
});

// ─── Conversion-rate helper ───────────────────────────────────────────────────

function convRate(leads: number, visitors: number) {
  return visitors > 0 ? Math.round((leads / visitors) * 100) : 0;
}

describe("conversion rate calculation", () => {
  it("calculates correct conversion rate", () => {
    expect(convRate(10, 100)).toBe(10);
    expect(convRate(5, 50)).toBe(10);
  });

  it("returns 0 when visitors is 0 (no division by zero)", () => {
    expect(convRate(0, 0)).toBe(0);
    expect(convRate(5, 0)).toBe(0);
  });

  it("rounds to nearest integer", () => {
    // 1/3 ≈ 33.33 → 33
    expect(convRate(1, 3)).toBe(33);
    // 2/3 ≈ 66.67 → 67
    expect(convRate(2, 3)).toBe(67);
  });

  it("handles 100% conversion", () => {
    expect(convRate(50, 50)).toBe(100);
  });
});

// ─── Percentage helper (for table display) ───────────────────────────────────

function calcPercent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

describe("source percentage calculation", () => {
  it("calculates correct percentages for a typical breakdown", () => {
    const data = [
      { source: "google",  visitors: 60 },
      { source: "meta",    visitors: 30 },
      { source: "direct",  visitors: 10 },
    ];
    const total = data.reduce((s, r) => s + r.visitors, 0);
    expect(calcPercent(60, total)).toBe(60);
    expect(calcPercent(30, total)).toBe(30);
    expect(calcPercent(10, total)).toBe(10);
  });

  it("returns 0 when total is 0 (no division by zero)", () => {
    expect(calcPercent(0, 0)).toBe(0);
  });

  it("rounds to nearest integer", () => {
    expect(calcPercent(1, 3)).toBe(33);
    expect(calcPercent(2, 3)).toBe(67);
  });
});
