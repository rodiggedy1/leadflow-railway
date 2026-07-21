/**
 * conciergeTime.test.ts
 *
 * Unit tests for the shared Concierge date-resolution infrastructure.
 * These tests lock down resolveServiceDateRange() since it is foundational
 * infrastructure consumed by multiple Concierge action handlers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTodayET, offsetServiceDate, resolveServiceDateRange } from "./conciergeTime";
import type { TimeScope } from "./conciergeQuery";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScope(type: TimeScope["type"], specificDate?: string): TimeScope {
  return { type, specificDate: specificDate ?? null, originalPhrase: null };
}

// ── offsetServiceDate ─────────────────────────────────────────────────────────

describe("offsetServiceDate", () => {
  it("returns the same date for offset 0", () => {
    expect(offsetServiceDate("2026-07-20", 0)).toBe("2026-07-20");
  });

  it("adds one day correctly", () => {
    expect(offsetServiceDate("2026-07-20", 1)).toBe("2026-07-21");
  });

  it("subtracts one day correctly", () => {
    expect(offsetServiceDate("2026-07-20", -1)).toBe("2026-07-19");
  });

  it("crosses month boundary forward", () => {
    expect(offsetServiceDate("2026-07-31", 1)).toBe("2026-08-01");
  });

  it("crosses month boundary backward", () => {
    expect(offsetServiceDate("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("crosses year boundary forward", () => {
    expect(offsetServiceDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("crosses year boundary backward", () => {
    expect(offsetServiceDate("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("handles leap year Feb 28 → Feb 29", () => {
    expect(offsetServiceDate("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("handles leap year Feb 29 → Mar 01", () => {
    expect(offsetServiceDate("2028-02-29", 1)).toBe("2028-03-01");
  });
});

// ── resolveServiceDateRange ───────────────────────────────────────────────────

describe("resolveServiceDateRange", () => {
  // Pin "today" to a known Monday so week calculations are deterministic
  // 2026-07-20 is a Monday
  const PINNED_TODAY = "2026-07-20";

  beforeEach(() => {
    // Mock getTodayET to return our pinned date
    vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
      this: Date,
      locale?: string,
      options?: Intl.DateTimeFormatOptions
    ) {
      if (options?.timeZone === "America/New_York" && locale === "en-CA") {
        return PINNED_TODAY;
      }
      return this.toISOString().slice(0, 10);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("today → same date", () => {
    const r = resolveServiceDateRange(makeScope("today"));
    expect(r.startDate).toBe(PINNED_TODAY);
    expect(r.endDate).toBe(PINNED_TODAY);
  });

  it("tomorrow → today + 1", () => {
    const r = resolveServiceDateRange(makeScope("tomorrow"));
    expect(r.startDate).toBe("2026-07-21");
    expect(r.endDate).toBe("2026-07-21");
  });

  it("yesterday → today - 1", () => {
    const r = resolveServiceDateRange(makeScope("yesterday"));
    expect(r.startDate).toBe("2026-07-19");
    expect(r.endDate).toBe("2026-07-19");
  });

  it("specific_date → exact date", () => {
    const r = resolveServiceDateRange(makeScope("specific_date", "2026-08-15"));
    expect(r.startDate).toBe("2026-08-15");
    expect(r.endDate).toBe("2026-08-15");
  });

  it("specific_date with no specificDate → falls back to today", () => {
    const r = resolveServiceDateRange(makeScope("specific_date"));
    expect(r.startDate).toBe(PINNED_TODAY);
    expect(r.endDate).toBe(PINNED_TODAY);
  });

  // 2026-07-20 is Monday → this_week = Mon Jul 20 – Sun Jul 26
  it("this_week → Monday to Sunday of current week (pinned to Monday)", () => {
    const r = resolveServiceDateRange(makeScope("this_week"));
    expect(r.startDate).toBe("2026-07-20"); // Monday
    expect(r.endDate).toBe("2026-07-26");   // Sunday
  });

  it("next_week → next Monday to next Sunday", () => {
    const r = resolveServiceDateRange(makeScope("next_week"));
    expect(r.startDate).toBe("2026-07-27"); // next Monday
    expect(r.endDate).toBe("2026-08-02");   // next Sunday
  });

  it("last_week → previous Monday to previous Sunday", () => {
    const r = resolveServiceDateRange(makeScope("last_week"));
    expect(r.startDate).toBe("2026-07-13"); // prev Monday
    expect(r.endDate).toBe("2026-07-19");   // prev Sunday
  });

  it("this_month → first to last day of July 2026", () => {
    const r = resolveServiceDateRange(makeScope("this_month"));
    expect(r.startDate).toBe("2026-07-01");
    expect(r.endDate).toBe("2026-07-31");
  });

  it("last_month → first to last day of June 2026", () => {
    const r = resolveServiceDateRange(makeScope("last_month"));
    expect(r.startDate).toBe("2026-06-01");
    expect(r.endDate).toBe("2026-06-30");
  });

  it("null scope → falls back to today", () => {
    const r = resolveServiceDateRange(makeScope(null));
    expect(r.startDate).toBe(PINNED_TODAY);
    expect(r.endDate).toBe(PINNED_TODAY);
  });

  it("all_time → falls back to today (callers handle all_time separately)", () => {
    const r = resolveServiceDateRange(makeScope("all_time"));
    expect(r.startDate).toBe(PINNED_TODAY);
    expect(r.endDate).toBe(PINNED_TODAY);
  });
});

// ── Week boundary: Sunday anchor ──────────────────────────────────────────────

describe("resolveServiceDateRange — week boundaries from a Sunday anchor", () => {
  // 2026-07-19 is a Sunday
  const PINNED_SUNDAY = "2026-07-19";

  beforeEach(() => {
    vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
      this: Date,
      locale?: string,
      options?: Intl.DateTimeFormatOptions
    ) {
      if (options?.timeZone === "America/New_York" && locale === "en-CA") {
        return PINNED_SUNDAY;
      }
      return this.toISOString().slice(0, 10);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("this_week from Sunday → Mon Jul 13 – Sun Jul 19", () => {
    const r = resolveServiceDateRange(makeScope("this_week"));
    expect(r.startDate).toBe("2026-07-13");
    expect(r.endDate).toBe("2026-07-19");
  });

  it("next_week from Sunday → Mon Jul 20 – Sun Jul 26", () => {
    const r = resolveServiceDateRange(makeScope("next_week"));
    expect(r.startDate).toBe("2026-07-20");
    expect(r.endDate).toBe("2026-07-26");
  });
});
