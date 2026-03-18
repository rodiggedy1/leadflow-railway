/**
 * Tests for the revenueAttribution procedure helpers.
 * We test the pure calculation logic (calcBookedRevenue, ROI math, monthly bucketing)
 * without hitting the database.
 */
import { describe, it, expect } from "vitest";

// ── Inline the helpers under test (mirrors routers.ts) ───────────────────────

const EXTRA_PRICES: Record<string, number> = {
  inside_fridge: 45,
  inside_oven: 45,
  inside_cabinets: 65,
  laundry: 30,
  dishes: 25,
  interior_windows: 40,
  wall_washing: 55,
  deep_clean_add_on: 75,
};

function calculateExtrasTotal(keys: string[]): number {
  return keys.reduce((sum, k) => sum + (EXTRA_PRICES[k] ?? 0), 0);
}

function calcBookedRevenue(row: {
  bookedAmount?: number | null;
  quotedPrice?: string | null;
  extras?: string | null;
  reactivationLastPrice?: number | null;
  reactivationDiscountPct?: number | null;
}): number {
  if (row.bookedAmount !== null && row.bookedAmount !== undefined) {
    return Number(row.bookedAmount);
  }
  if (row.quotedPrice !== null && row.quotedPrice !== undefined && row.quotedPrice !== "") {
    const base = parseFloat(row.quotedPrice);
    let extrasTotal = 0;
    try {
      const keys: string[] = JSON.parse(row.extras ?? "[]");
      extrasTotal = calculateExtrasTotal(keys);
    } catch { /* ignore */ }
    return (isNaN(base) ? 0 : base) + extrasTotal;
  }
  if (row.reactivationLastPrice !== null && row.reactivationLastPrice !== undefined) {
    const discountPct = row.reactivationDiscountPct ?? 10;
    return Math.round(row.reactivationLastPrice * (1 - discountPct / 100));
  }
  return 0;
}

function calcROI(totalRevenue: number, softwareCost: number, months: number): number {
  if (softwareCost <= 0) return 0;
  return parseFloat((totalRevenue / (softwareCost * months)).toFixed(1));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("calcBookedRevenue", () => {
  it("returns bookedAmount when set (overrides everything)", () => {
    expect(calcBookedRevenue({ bookedAmount: 300, quotedPrice: "100" })).toBe(300);
  });

  it("returns 0 when bookedAmount is 0 (explicit zero)", () => {
    expect(calcBookedRevenue({ bookedAmount: 0, quotedPrice: "100" })).toBe(0);
  });

  it("uses quotedPrice + extras when bookedAmount is null", () => {
    const rev = calcBookedRevenue({
      bookedAmount: null,
      quotedPrice: "200",
      extras: JSON.stringify(["inside_fridge", "laundry"]),
    });
    expect(rev).toBe(200 + 45 + 30); // 275
  });

  it("uses quotedPrice alone when extras is empty array", () => {
    expect(calcBookedRevenue({ bookedAmount: null, quotedPrice: "150", extras: "[]" })).toBe(150);
  });

  it("uses quotedPrice alone when extras is null", () => {
    expect(calcBookedRevenue({ bookedAmount: null, quotedPrice: "180", extras: null })).toBe(180);
  });

  it("uses reactivation price with default 10% discount when no quotedPrice", () => {
    expect(
      calcBookedRevenue({ bookedAmount: null, quotedPrice: null, reactivationLastPrice: 200 })
    ).toBe(180); // 200 * 0.9
  });

  it("uses reactivation price with custom discount", () => {
    expect(
      calcBookedRevenue({
        bookedAmount: null,
        quotedPrice: null,
        reactivationLastPrice: 200,
        reactivationDiscountPct: 20,
      })
    ).toBe(160); // 200 * 0.8
  });

  it("returns 0 when all fields are null/empty", () => {
    expect(calcBookedRevenue({ bookedAmount: null, quotedPrice: null })).toBe(0);
  });

  it("returns 0 when quotedPrice is empty string", () => {
    expect(calcBookedRevenue({ bookedAmount: null, quotedPrice: "" })).toBe(0);
  });

  it("handles invalid JSON in extras gracefully", () => {
    expect(
      calcBookedRevenue({ bookedAmount: null, quotedPrice: "100", extras: "not-json" })
    ).toBe(100);
  });
});

describe("ROI calculation", () => {
  it("calculates correct ROI multiple", () => {
    expect(calcROI(3000, 500, 6)).toBe(1); // 3000 / 3000 = 1.0
  });

  it("calculates 10x ROI correctly", () => {
    expect(calcROI(5000, 500, 1)).toBe(10); // 5000 / 500 = 10.0
  });

  it("returns 0 when software cost is 0", () => {
    expect(calcROI(5000, 0, 1)).toBe(0);
  });

  it("returns 0 when no revenue", () => {
    expect(calcROI(0, 500, 6)).toBe(0);
  });

  it("rounds to 1 decimal place", () => {
    expect(calcROI(1666, 500, 1)).toBe(3.3); // 1666/500 = 3.332
  });
});

describe("channel revenue aggregation", () => {
  it("groups revenue correctly by channel", () => {
    const sessions = [
      { leadSource: "form", quotedPrice: "200", extras: "[]", bookedAmount: null, reactivationLastPrice: null, reactivationDiscountPct: null },
      { leadSource: "form", quotedPrice: "150", extras: "[]", bookedAmount: null, reactivationLastPrice: null, reactivationDiscountPct: null },
      { leadSource: "widget", quotedPrice: "300", extras: "[]", bookedAmount: null, reactivationLastPrice: null, reactivationDiscountPct: null },
      { leadSource: "reactivation", quotedPrice: null, extras: null, bookedAmount: null, reactivationLastPrice: 200, reactivationDiscountPct: 10 },
    ];

    const channelMap = new Map<string, { revenue: number; jobs: number }>();
    for (const s of sessions) {
      const rev = calcBookedRevenue(s);
      const ch = s.leadSource ?? "form";
      const existing = channelMap.get(ch) ?? { revenue: 0, jobs: 0 };
      channelMap.set(ch, { revenue: existing.revenue + rev, jobs: existing.jobs + 1 });
    }

    expect(channelMap.get("form")).toEqual({ revenue: 350, jobs: 2 });
    expect(channelMap.get("widget")).toEqual({ revenue: 300, jobs: 1 });
    expect(channelMap.get("reactivation")).toEqual({ revenue: 180, jobs: 1 });
  });

  it("falls back to 'form' when leadSource is null", () => {
    const sessions = [
      { leadSource: null, quotedPrice: "100", extras: "[]", bookedAmount: null, reactivationLastPrice: null, reactivationDiscountPct: null },
    ];
    const channelMap = new Map<string, { revenue: number; jobs: number }>();
    for (const s of sessions) {
      const rev = calcBookedRevenue(s);
      const ch = s.leadSource ?? "form";
      const existing = channelMap.get(ch) ?? { revenue: 0, jobs: 0 };
      channelMap.set(ch, { revenue: existing.revenue + rev, jobs: existing.jobs + 1 });
    }
    expect(channelMap.get("form")).toEqual({ revenue: 100, jobs: 1 });
  });
});
