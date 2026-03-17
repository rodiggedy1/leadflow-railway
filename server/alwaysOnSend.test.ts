/**
 * alwaysOnSend.test.ts
 *
 * Tests for:
 *  - getNowInET: correct hour/dayOfWeek in Eastern Time
 *  - isWithinTcpaWindow: TCPA compliance checks
 *  - personalizeMessage: token replacement
 *  - sendAlwaysOnBatch: dry-run batch send behavior
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getNowInET,
  isWithinTcpaWindow,
  personalizeMessage,
  sendAlwaysOnBatch,
} from "./alwaysOnSend";

// ─── getNowInET ───────────────────────────────────────────────────────────────

describe("getNowInET", () => {
  it("returns correct hour and dayOfWeek for a known UTC timestamp", () => {
    // 2024-03-18 (Monday) at 15:00 UTC = 11:00 AM EDT (UTC-4 in March)
    const mondayAt11amET = new Date("2024-03-18T15:00:00Z").getTime();
    const result = getNowInET(mondayAt11amET);
    expect(result.hour).toBe(11);
    expect(result.dayOfWeek).toBe(1); // Monday
  });

  it("returns correct hour for EST (winter) offset", () => {
    // 2024-01-15 (Monday) at 16:00 UTC = 11:00 AM EST (UTC-5 in January)
    const mondayAt11amEST = new Date("2024-01-15T16:00:00Z").getTime();
    const result = getNowInET(mondayAt11amEST);
    expect(result.hour).toBe(11);
    expect(result.dayOfWeek).toBe(1); // Monday
  });

  it("returns dayOfWeek 0 for Sunday", () => {
    // 2024-03-17 (Sunday) at 15:00 UTC = 11:00 AM EDT
    const sundayAt11amET = new Date("2024-03-17T15:00:00Z").getTime();
    const result = getNowInET(sundayAt11amET);
    expect(result.dayOfWeek).toBe(0); // Sunday
  });
});

// ─── isWithinTcpaWindow ───────────────────────────────────────────────────────

describe("isWithinTcpaWindow", () => {
  it("returns true for Monday at 10 AM ET", () => {
    // 2024-03-18 (Monday) at 14:00 UTC = 10:00 AM EDT
    const ts = new Date("2024-03-18T14:00:00Z").getTime();
    expect(isWithinTcpaWindow(ts)).toBe(true);
  });

  it("returns true for Saturday at 10 AM ET", () => {
    // 2024-03-23 (Saturday) at 14:00 UTC = 10:00 AM EDT
    const ts = new Date("2024-03-23T14:00:00Z").getTime();
    expect(isWithinTcpaWindow(ts)).toBe(true);
  });

  it("returns false for Sunday", () => {
    // 2024-03-17 (Sunday) at 14:00 UTC = 10:00 AM EDT
    const ts = new Date("2024-03-17T14:00:00Z").getTime();
    expect(isWithinTcpaWindow(ts)).toBe(false);
  });

  it("returns false before 9 AM ET", () => {
    // 2024-03-18 (Monday) at 12:30 UTC = 8:30 AM EDT
    const ts = new Date("2024-03-18T12:30:00Z").getTime();
    expect(isWithinTcpaWindow(ts)).toBe(false);
  });

  it("returns false at 8 PM ET or later", () => {
    // 2024-03-18 (Monday) at 00:00 UTC next day = 8:00 PM EDT
    const ts = new Date("2024-03-19T00:00:00Z").getTime();
    expect(isWithinTcpaWindow(ts)).toBe(false);
  });

  it("returns true at exactly 9 AM ET", () => {
    // 2024-03-18 (Monday) at 13:00 UTC = 9:00 AM EDT
    const ts = new Date("2024-03-18T13:00:00Z").getTime();
    expect(isWithinTcpaWindow(ts)).toBe(true);
  });

  it("returns true at 7:59 PM ET (hour=19)", () => {
    // 2024-03-18 (Monday) at 23:30 UTC = 7:30 PM EDT
    const ts = new Date("2024-03-18T23:30:00Z").getTime();
    expect(isWithinTcpaWindow(ts)).toBe(true);
  });
});

// ─── personalizeMessage ───────────────────────────────────────────────────────

describe("personalizeMessage", () => {
  it("replaces [Name] with firstName", () => {
    const result = personalizeMessage("Hi [Name], we miss you!", { firstName: "Sarah" });
    expect(result).toBe("Hi Sarah, we miss you!");
  });

  it("uses 'there' when firstName is missing", () => {
    const result = personalizeMessage("Hi [Name]!", { firstName: null });
    expect(result).toBe("Hi there!");
  });

  it("replaces [Price] with formatted price", () => {
    const result = personalizeMessage("Your last clean was [Price].", {
      firstName: "Bob",
      lastBookingPrice: 22900, // stored as cents * 100? No — stored as dollars directly
    });
    // lastBookingPrice=22900 → $229
    expect(result).toContain("$229");
  });

  it("replaces [DiscountedPrice] with 10% off by default", () => {
    const result = personalizeMessage("Book now for [DiscountedPrice].", {
      firstName: "Alice",
      lastBookingPrice: 20000, // $200
    });
    // 10% off $200 = $180
    expect(result).toContain("$180");
  });

  it("replaces [DiscountedPrice] with custom discount", () => {
    const result = personalizeMessage("Book now for [DiscountedPrice].", {
      firstName: "Alice",
      lastBookingPrice: 20000, // $200
      discountPct: 15,
    });
    // 15% off $200 = $170
    expect(result).toContain("$170");
  });

  it("is case-insensitive for token replacement", () => {
    const result = personalizeMessage("Hello [name]!", { firstName: "Tom" });
    expect(result).toBe("Hello Tom!");
  });
});

// ─── sendAlwaysOnBatch ────────────────────────────────────────────────────────

describe("sendAlwaysOnBatch", () => {
  it("returns empty array when outside TCPA window (Sunday)", async () => {
    // Sunday at 10 AM ET
    const sundayTs = new Date("2024-03-17T14:00:00Z").getTime();
    const results = await sendAlwaysOnBatch(sundayTs, true);
    expect(results).toEqual([]);
  });

  it("returns empty array when before 9 AM ET", async () => {
    // Monday at 8 AM ET
    const earlyTs = new Date("2024-03-18T12:00:00Z").getTime();
    const results = await sendAlwaysOnBatch(earlyTs, true);
    expect(results).toEqual([]);
  });
});
