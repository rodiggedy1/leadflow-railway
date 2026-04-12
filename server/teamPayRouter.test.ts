/**
 * teamPayRouter.test.ts
 * Unit tests for the pure helper functions in teamPayRouter.
 * These do not require a DB connection.
 *
 * Verified 2026 Sundays: Apr 5, Apr 12, Apr 19, Apr 26, May 3
 */
import { describe, it, expect } from "vitest";
import { getPayWeekStart } from "./teamPayRouter";

describe("getPayWeekStart", () => {
  it("returns the same Sunday when given a Sunday", () => {
    // Apr 12 2026 is a Sunday
    const sun = new Date(2026, 3, 12, 12, 0, 0);
    const result = getPayWeekStart(sun);
    expect(result.getDay()).toBe(0);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(3); // April (0-indexed)
    expect(result.getDate()).toBe(12);
  });

  it("returns the preceding Sunday when given a Saturday", () => {
    // Apr 11 2026 is a Saturday — week starts Apr 5
    const sat = new Date(2026, 3, 11, 12, 0, 0);
    const result = getPayWeekStart(sat);
    expect(result.getDay()).toBe(0);
    expect(result.getDate()).toBe(5); // Apr 5
  });

  it("returns the preceding Sunday when given a Wednesday", () => {
    // Apr 8 2026 is a Wednesday — week starts Apr 5
    const wed = new Date(2026, 3, 8, 12, 0, 0);
    const result = getPayWeekStart(wed);
    expect(result.getDay()).toBe(0);
    expect(result.getDate()).toBe(5); // Apr 5
  });

  it("returns the preceding Sunday when given a Monday", () => {
    // Apr 13 2026 is a Monday — week starts Apr 12
    const mon = new Date(2026, 3, 13, 12, 0, 0);
    const result = getPayWeekStart(mon);
    expect(result.getDay()).toBe(0);
    expect(result.getDate()).toBe(12); // Apr 12
  });

  it("handles week boundary crossing month boundary", () => {
    // Apr 30 2026 is a Thursday — week starts Apr 26
    const thu = new Date(2026, 3, 30, 12, 0, 0);
    const result = getPayWeekStart(thu);
    expect(result.getDay()).toBe(0);
    expect(result.getMonth()).toBe(3); // April
    expect(result.getDate()).toBe(26);
  });

  it("handles first day of month when week started in prior month", () => {
    // May 1 2026 is a Friday — week starts Apr 26
    const fri = new Date(2026, 4, 1, 12, 0, 0);
    const result = getPayWeekStart(fri);
    expect(result.getDay()).toBe(0);
    expect(result.getMonth()).toBe(3); // April
    expect(result.getDate()).toBe(26);
  });
});
