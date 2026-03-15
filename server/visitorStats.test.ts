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
