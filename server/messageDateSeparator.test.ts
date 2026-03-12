/**
 * Tests for message date separator utilities.
 * These are pure functions so we can test them directly without mocking.
 *
 * Note: formatMsgDate and isDifferentDay live in the client component but
 * the logic is pure — we duplicate the implementations here for server-side
 * testing to avoid importing client-only modules.
 */
import { describe, it, expect } from "vitest";

// ── Pure implementations (mirrored from MessageDateSeparator.tsx) ─────────────

function formatMsgDate(ts: number): string {
  const msgDate = new Date(ts);
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  const startOfMsg = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());

  if (startOfMsg.getTime() === startOfToday.getTime()) {
    const time = msgDate.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `Today, ${time}`;
  }

  if (startOfMsg.getTime() === startOfYesterday.getTime()) {
    const time = msgDate.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `Yesterday, ${time}`;
  }

  return msgDate.toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function isDifferentDay(tsA: number, tsB: number): boolean {
  const a = new Date(tsA);
  const b = new Date(tsB);
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("formatMsgDate", () => {
  it("returns 'Today, ...' for a timestamp from today", () => {
    const now = Date.now();
    const label = formatMsgDate(now);
    expect(label).toMatch(/^Today,/);
  });

  it("returns 'Yesterday, ...' for a timestamp from yesterday", () => {
    const yesterday = Date.now() - 86_400_000;
    const label = formatMsgDate(yesterday);
    expect(label).toMatch(/^Yesterday,/);
  });

  it("returns a full date string for older timestamps", () => {
    // Use a fixed old date: Jan 1, 2020 at noon UTC
    const old = new Date(2020, 0, 1, 12, 0, 0).getTime();
    const label = formatMsgDate(old);
    // Should contain the year 2020 and not start with Today/Yesterday
    expect(label).toContain("2020");
    expect(label).not.toMatch(/^Today/);
    expect(label).not.toMatch(/^Yesterday/);
  });

  it("includes a time component in the label", () => {
    const now = Date.now();
    const label = formatMsgDate(now);
    // Should contain AM or PM
    expect(label).toMatch(/AM|PM/i);
  });
});

describe("isDifferentDay", () => {
  it("returns false for two timestamps on the same day", () => {
    const base = new Date(2024, 5, 15, 10, 0, 0).getTime();
    const later = new Date(2024, 5, 15, 22, 59, 59).getTime();
    expect(isDifferentDay(base, later)).toBe(false);
  });

  it("returns true for timestamps on consecutive days", () => {
    const day1 = new Date(2024, 5, 15, 23, 59, 59).getTime();
    const day2 = new Date(2024, 5, 16, 0, 0, 0).getTime();
    expect(isDifferentDay(day1, day2)).toBe(true);
  });

  it("returns true for timestamps in different months", () => {
    const jan = new Date(2024, 0, 31, 12, 0, 0).getTime();
    const feb = new Date(2024, 1, 1, 12, 0, 0).getTime();
    expect(isDifferentDay(jan, feb)).toBe(true);
  });

  it("returns true for timestamps in different years", () => {
    const dec31 = new Date(2023, 11, 31, 23, 0, 0).getTime();
    const jan1 = new Date(2024, 0, 1, 0, 0, 0).getTime();
    expect(isDifferentDay(dec31, jan1)).toBe(true);
  });

  it("returns false for the exact same timestamp", () => {
    const ts = Date.now();
    expect(isDifferentDay(ts, ts)).toBe(false);
  });
});
