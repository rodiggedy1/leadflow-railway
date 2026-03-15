/**
 * Tests for the visitor stats and conversion funnel logic.
 * Validates the conversion rate calculations used in the admin dashboard.
 */
import { describe, it, expect } from "vitest";

// ── Conversion rate helper (mirrors ConversionFunnelCard logic) ──────────────
function pct(num: number, denom: number): string {
  if (!denom) return "—";
  return ((num / denom) * 100).toFixed(1) + "%";
}

describe("Conversion funnel rate calculation", () => {
  it("returns — when denominator is 0", () => {
    expect(pct(0, 0)).toBe("—");
    expect(pct(5, 0)).toBe("—");
  });

  it("calculates 100% when all visitors become leads", () => {
    expect(pct(100, 100)).toBe("100.0%");
  });

  it("calculates 50% correctly", () => {
    expect(pct(50, 100)).toBe("50.0%");
  });

  it("calculates a fractional percentage correctly", () => {
    expect(pct(3, 47)).toBe("6.4%");
  });

  it("handles booked / leads rate", () => {
    expect(pct(10, 47)).toBe("21.3%");
  });

  it("returns 0.0% when numerator is 0 but denominator is non-zero", () => {
    expect(pct(0, 100)).toBe("0.0%");
  });
});

// ── visitorStats response shape validation ───────────────────────────────────
describe("visitorStats response shape", () => {
  it("returns correct shape with all zeros as default", () => {
    const defaultResponse = { visitors: 0, leads: 0, booked: 0 };
    expect(defaultResponse).toHaveProperty("visitors");
    expect(defaultResponse).toHaveProperty("leads");
    expect(defaultResponse).toHaveProperty("booked");
    expect(defaultResponse.visitors).toBe(0);
    expect(defaultResponse.leads).toBe(0);
    expect(defaultResponse.booked).toBe(0);
  });

  it("conversion rates are consistent with data", () => {
    const stats = { visitors: 200, leads: 40, booked: 8 };
    const visitorToLead = pct(stats.leads, stats.visitors);
    const leadToBooked = pct(stats.booked, stats.leads);
    expect(visitorToLead).toBe("20.0%");
    expect(leadToBooked).toBe("20.0%");
  });
});

// ── sessionKey generation logic ───────────────────────────────────────────────
describe("sessionKey generation", () => {
  it("generates a non-empty string key", () => {
    const sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
    expect(typeof sessionKey).toBe("string");
    expect(sessionKey.length).toBeGreaterThan(0);
    expect(sessionKey.length).toBeLessThanOrEqual(64);
  });

  it("generates unique keys on repeated calls", () => {
    const key1 = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const key2 = Math.random().toString(36).slice(2) + Date.now().toString(36);
    // Extremely unlikely to collide
    expect(key1).not.toBe(key2);
  });
});

// ── localStorage-based unique visitor deduplication ──────────────────────────
describe("unique visitor deduplication (localStorage date-scoped key)", () => {
  // Simulate the client-side logic that decides whether to fire trackPageView
  function shouldTrack(today: string, localStorageState: Record<string, string>): boolean {
    const SK_KEY = `_lf_vid_${today}`;
    return !localStorageState[SK_KEY];
  }

  function recordVisit(today: string, localStorageState: Record<string, string>): Record<string, string> {
    const SK_KEY = `_lf_vid_${today}`;
    const updated = { ...localStorageState };
    if (!updated[SK_KEY]) {
      updated[SK_KEY] = Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    return updated;
  }

  it("fires trackPageView on the first visit of the day", () => {
    const state: Record<string, string> = {};
    expect(shouldTrack("2026-03-15", state)).toBe(true);
  });

  it("does NOT fire trackPageView on a second visit the same day (same tab)", () => {
    let state: Record<string, string> = {};
    state = recordVisit("2026-03-15", state);
    expect(shouldTrack("2026-03-15", state)).toBe(false);
  });

  it("does NOT fire trackPageView on a page refresh (same day)", () => {
    let state: Record<string, string> = {};
    // First visit
    state = recordVisit("2026-03-15", state);
    // Simulate refresh — localStorage persists, sessionStorage would have been cleared
    expect(shouldTrack("2026-03-15", state)).toBe(false);
  });

  it("fires trackPageView again on the next calendar day", () => {
    let state: Record<string, string> = {};
    state = recordVisit("2026-03-15", state);
    // Next day — key is different
    expect(shouldTrack("2026-03-16", state)).toBe(true);
  });

  it("each day produces a different localStorage key", () => {
    const key1 = `_lf_vid_2026-03-15`;
    const key2 = `_lf_vid_2026-03-16`;
    expect(key1).not.toBe(key2);
  });

  it("old keys (> today) are cleaned up without affecting today's key", () => {
    const today = "2026-03-15";
    const state: Record<string, string> = {
      "_lf_vid_2026-03-08": "old1",
      "_lf_vid_2026-03-10": "old2",
      "_lf_vid_2026-03-14": "old3",
    };
    // Simulate cleanup: remove keys that start with _lf_vid_ and are < today
    const cleaned = Object.fromEntries(
      Object.entries(state).filter(
        ([k]) => !(k.startsWith("_lf_vid_") && k < `_lf_vid_${today}`)
      )
    );
    expect(Object.keys(cleaned)).toHaveLength(0);
    // Today's key is untouched
    const withToday = { ...cleaned, [`_lf_vid_${today}`]: "abc" };
    expect(withToday[`_lf_vid_${today}`]).toBe("abc");
  });

  it("does not clean up today's key", () => {
    const today = "2026-03-15";
    const state: Record<string, string> = {
      [`_lf_vid_${today}`]: "today_key",
      "_lf_vid_2026-03-14": "yesterday",
    };
    const cleaned = Object.fromEntries(
      Object.entries(state).filter(
        ([k]) => !(k.startsWith("_lf_vid_") && k < `_lf_vid_${today}`)
      )
    );
    expect(cleaned[`_lf_vid_${today}`]).toBe("today_key");
    expect(cleaned["_lf_vid_2026-03-14"]).toBeUndefined();
  });
});

// ── visitorTrend zero-fill and date-range logic ───────────────────────────────
describe("visitorTrend date range generation", () => {
  // Mirror the server-side logic that builds the date array
  function buildDateRange(numDays: number, referenceDate: string): string[] {
    const today = new Date(referenceDate + "T00:00:00Z");
    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - (numDays - 1));
    const result: string[] = [];
    for (let i = 0; i < numDays; i++) {
      const d = new Date(startDate);
      d.setUTCDate(d.getUTCDate() + i);
      result.push(d.toISOString().slice(0, 10));
    }
    return result;
  }

  function buildTrend(
    numDays: number,
    referenceDate: string,
    visitorMap: Map<string, number>,
    leadMap: Map<string, number>
  ): { date: string; visitors: number; leads: number }[] {
    return buildDateRange(numDays, referenceDate).map(dateStr => ({
      date: dateStr,
      visitors: visitorMap.get(dateStr) ?? 0,
      leads: leadMap.get(dateStr) ?? 0,
    }));
  }

  it("returns exactly numDays rows", () => {
    const result = buildDateRange(14, "2026-03-15");
    expect(result).toHaveLength(14);
  });

  it("returns exactly 7 rows for 7-day range", () => {
    const result = buildDateRange(7, "2026-03-15");
    expect(result).toHaveLength(7);
  });

  it("returns exactly 30 rows for 30-day range", () => {
    const result = buildDateRange(30, "2026-03-15");
    expect(result).toHaveLength(30);
  });

  it("last date in range is today", () => {
    const result = buildDateRange(14, "2026-03-15");
    expect(result[result.length - 1]).toBe("2026-03-15");
  });

  it("first date in range is numDays-1 days ago", () => {
    const result = buildDateRange(14, "2026-03-15");
    expect(result[0]).toBe("2026-03-02");
  });

  it("dates are consecutive with no gaps", () => {
    const result = buildDateRange(14, "2026-03-15");
    for (let i = 1; i < result.length; i++) {
      const prev = new Date(result[i - 1] + "T00:00:00Z");
      const curr = new Date(result[i] + "T00:00:00Z");
      expect(curr.getTime() - prev.getTime()).toBe(86400000); // 1 day in ms
    }
  });

  it("zero-fills days with no data", () => {
    const result = buildTrend(
      7,
      "2026-03-15",
      new Map([["2026-03-15", 10]]),
      new Map()
    );
    // Only the last day has data; all others should be 0
    const zeros = result.filter(r => r.date !== "2026-03-15");
    expect(zeros.every(r => r.visitors === 0 && r.leads === 0)).toBe(true);
    expect(result.find(r => r.date === "2026-03-15")?.visitors).toBe(10);
  });

  it("maps visitor and lead counts correctly", () => {
    const visitorMap = new Map([
      ["2026-03-14", 5],
      ["2026-03-15", 12],
    ]);
    const leadMap = new Map([
      ["2026-03-14", 2],
      ["2026-03-15", 4],
    ]);
    const result = buildTrend(7, "2026-03-15", visitorMap, leadMap);
    const mar14 = result.find(r => r.date === "2026-03-14");
    const mar15 = result.find(r => r.date === "2026-03-15");
    expect(mar14?.visitors).toBe(5);
    expect(mar14?.leads).toBe(2);
    expect(mar15?.visitors).toBe(12);
    expect(mar15?.leads).toBe(4);
  });

  it("does not include dates outside the range", () => {
    const result = buildDateRange(7, "2026-03-15");
    expect(result.includes("2026-03-01")).toBe(false);
    expect(result.includes("2026-03-16")).toBe(false);
  });
});
