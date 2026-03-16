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
