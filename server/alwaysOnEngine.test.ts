/**
 * alwaysOnEngine.test.ts
 *
 * Tests for the Always-On Campaign eligibility engine.
 * Covers computeEligibleGroup, getFrequencyWindowDays, isRecurringFrequency.
 */

import { describe, it, expect } from "vitest";
import {
  computeEligibleGroup,
  getFrequencyWindowDays,
  isRecurringFrequency,
} from "./alwaysOnEngine";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a date string N days ago from `nowMs` */
function daysAgo(n: number, nowMs: number): string {
  const d = new Date(nowMs - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const NOW = new Date("2026-03-16T12:00:00Z").getTime();

// ─── getFrequencyWindowDays ───────────────────────────────────────────────────

describe("getFrequencyWindowDays", () => {
  it("returns 7 for weekly", () => {
    expect(getFrequencyWindowDays("Weekly")).toBe(7);
    expect(getFrequencyWindowDays("weekly")).toBe(7);
  });

  it("returns 14 for biweekly", () => {
    expect(getFrequencyWindowDays("Biweekly")).toBe(14);
    expect(getFrequencyWindowDays("bi-weekly")).toBe(14);
    expect(getFrequencyWindowDays("Every other week")).toBe(14);
    expect(getFrequencyWindowDays("Every 2 weeks")).toBe(14);
  });

  it("returns 21 for every 3 weeks", () => {
    expect(getFrequencyWindowDays("Every 3 weeks")).toBe(21);
    expect(getFrequencyWindowDays("3 week")).toBe(21);
  });

  it("returns 30 for monthly", () => {
    expect(getFrequencyWindowDays("Monthly")).toBe(30);
    expect(getFrequencyWindowDays("monthly")).toBe(30);
  });

  it("returns 56 for bimonthly / every 6 weeks", () => {
    expect(getFrequencyWindowDays("Bimonthly")).toBe(56);
    expect(getFrequencyWindowDays("Every 6 weeks")).toBe(56);
    expect(getFrequencyWindowDays("Every 8 weeks")).toBe(56);
  });

  it("returns null for one-time", () => {
    expect(getFrequencyWindowDays("One-time")).toBeNull();
    expect(getFrequencyWindowDays("one time")).toBeNull();
    expect(getFrequencyWindowDays(null)).toBeNull();
    expect(getFrequencyWindowDays(undefined)).toBeNull();
    expect(getFrequencyWindowDays("")).toBeNull();
  });
});

// ─── isRecurringFrequency ─────────────────────────────────────────────────────

describe("isRecurringFrequency", () => {
  it("returns true for recurring types", () => {
    expect(isRecurringFrequency("Monthly")).toBe(true);
    expect(isRecurringFrequency("Biweekly")).toBe(true);
    expect(isRecurringFrequency("Weekly")).toBe(true);
    expect(isRecurringFrequency("Every 3 weeks")).toBe(true);
  });

  it("returns false for one-time and unknown", () => {
    expect(isRecurringFrequency("One-time")).toBe(false);
    expect(isRecurringFrequency("one time")).toBe(false);
    expect(isRecurringFrequency(null)).toBe(false);
    expect(isRecurringFrequency(undefined)).toBe(false);
    expect(isRecurringFrequency("")).toBe(false);
  });
});

// ─── computeEligibleGroup ─────────────────────────────────────────────────────

describe("computeEligibleGroup", () => {
  // ── Active recurring customers — NEVER enroll ──────────────────────────────
  it("skips active monthly customer (25 days ago, within 30+7=37 day window)", () => {
    const result = computeEligibleGroup(daysAgo(25, NOW), "Monthly", NOW);
    expect(result.eligible).toBe(false);
    expect((result as any).reason).toMatch(/active recurring/);
  });

  it("skips active biweekly customer (10 days ago, within 14+7=21 day window)", () => {
    const result = computeEligibleGroup(daysAgo(10, NOW), "Biweekly", NOW);
    expect(result.eligible).toBe(false);
  });

  it("skips active weekly customer (5 days ago, within 7+7=14 day window)", () => {
    const result = computeEligibleGroup(daysAgo(5, NOW), "Weekly", NOW);
    expect(result.eligible).toBe(false);
  });

  // ── Group 4: Dormant (180+ days) ───────────────────────────────────────────
  it("assigns dormant for one-time customer 200 days ago", () => {
    const result = computeEligibleGroup(daysAgo(200, NOW), "One-time", NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("dormant");
  });

  it("assigns dormant for monthly customer 200 days ago (lapsed far beyond schedule)", () => {
    const result = computeEligibleGroup(daysAgo(200, NOW), "Monthly", NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("dormant");
  });

  it("assigns dormant for unknown frequency 365 days ago", () => {
    const result = computeEligibleGroup(daysAgo(365, NOW), null, NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("dormant");
  });

  // ── Group 3: Lapsed Recurring ──────────────────────────────────────────────
  it("assigns lapsed-recurring for monthly customer 40 days ago (past 30+7=37)", () => {
    const result = computeEligibleGroup(daysAgo(40, NOW), "Monthly", NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("lapsed-recurring");
  });

  it("assigns lapsed-recurring for biweekly customer 25 days ago (past 14+7=21)", () => {
    const result = computeEligibleGroup(daysAgo(25, NOW), "Biweekly", NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("lapsed-recurring");
  });

  it("assigns lapsed-recurring for weekly customer 16 days ago (past 7+7=14)", () => {
    const result = computeEligibleGroup(daysAgo(16, NOW), "Weekly", NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("lapsed-recurring");
  });

  // ── Group 2: Lapsed One-Time (21+ days) ───────────────────────────────────
  it("assigns lapsed-one-time for one-time customer 30 days ago", () => {
    const result = computeEligibleGroup(daysAgo(30, NOW), "One-time", NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("lapsed-one-time");
  });

  it("assigns lapsed-one-time for unknown frequency 50 days ago", () => {
    const result = computeEligibleGroup(daysAgo(50, NOW), null, NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("lapsed-one-time");
  });

  it("assigns lapsed-one-time for one-time customer exactly 21 days ago", () => {
    const result = computeEligibleGroup(daysAgo(21, NOW), "One-time", NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("lapsed-one-time");
  });

  // ── Group 1: New One-Time (3–20 days) ─────────────────────────────────────
  it("assigns new-one-time for one-time customer 5 days ago", () => {
    const result = computeEligibleGroup(daysAgo(5, NOW), "One-time", NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("new-one-time");
  });

  it("assigns new-one-time for unknown frequency 3 days ago", () => {
    const result = computeEligibleGroup(daysAgo(3, NOW), null, NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("new-one-time");
  });

  it("assigns new-one-time for one-time customer exactly 20 days ago", () => {
    const result = computeEligibleGroup(daysAgo(20, NOW), "One-time", NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("new-one-time");
  });

  // ── Too recent — not eligible yet ─────────────────────────────────────────
  it("returns ineligible for one-time customer 1 day ago (< 3 day threshold)", () => {
    const result = computeEligibleGroup(daysAgo(1, NOW), "One-time", NOW);
    expect(result.eligible).toBe(false);
    expect((result as any).reason).toMatch(/too recent/);
  });

  it("returns ineligible for one-time customer 2 days ago", () => {
    const result = computeEligibleGroup(daysAgo(2, NOW), "One-time", NOW);
    expect(result.eligible).toBe(false);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────
  it("returns ineligible for null job date", () => {
    const result = computeEligibleGroup(null, "Monthly", NOW);
    expect(result.eligible).toBe(false);
    expect((result as any).reason).toBe("no job date");
  });

  it("returns ineligible for invalid job date", () => {
    const result = computeEligibleGroup("not-a-date", "Monthly", NOW);
    expect(result.eligible).toBe(false);
    expect((result as any).reason).toBe("invalid job date");
  });

  // ── Dormant takes priority over lapsed-one-time ───────────────────────────
  it("dormant takes priority over lapsed-one-time for 200-day-old one-time job", () => {
    const result = computeEligibleGroup(daysAgo(200, NOW), "One-time", NOW);
    expect(result.eligible).toBe(true);
    expect((result as any).groupType).toBe("dormant"); // NOT lapsed-one-time
  });
});
