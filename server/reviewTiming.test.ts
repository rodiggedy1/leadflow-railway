/**
 * Tests for the review SMS timing logic.
 * Verifies that "yesterday in ET" is computed correctly and that the
 * jobDate <= yesterday filter works as expected.
 */
import { describe, it, expect } from "vitest";

// ── Inline the ET-yesterday helper (mirrors reviewRouter.ts) ─────────────────

function getYesterdayET(): string {
  const etNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  etNow.setDate(etNow.getDate() - 1);
  const yyyy = etNow.getFullYear();
  const mm = String(etNow.getMonth() + 1).padStart(2, "0");
  const dd = String(etNow.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Simulate the filter: should this job be sent today? */
function shouldSendReviewSms(jobDate: string, yesterday: string): boolean {
  return jobDate <= yesterday;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getYesterdayET", () => {
  it("returns a valid YYYY-MM-DD string", () => {
    const result = getYesterdayET();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is strictly before today's date string", () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = getYesterdayET();
    expect(yesterday < today).toBe(true);
  });

  it("is no more than 2 days before today (timezone offset guard)", () => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const yesterday = getYesterdayET();
    // Yesterday should be at most 2 days behind today (accounts for ET offset)
    const diff = new Date(todayStr).getTime() - new Date(yesterday).getTime();
    const daysDiff = diff / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeGreaterThanOrEqual(1);
    expect(daysDiff).toBeLessThanOrEqual(2);
  });
});

describe("shouldSendReviewSms", () => {
  const yesterday = "2026-03-17";

  it("sends for a job that was yesterday", () => {
    expect(shouldSendReviewSms("2026-03-17", yesterday)).toBe(true);
  });

  it("sends for a job that was two days ago (backlog catch-up)", () => {
    expect(shouldSendReviewSms("2026-03-15", yesterday)).toBe(true);
  });

  it("sends for a job that was a week ago (old backlog)", () => {
    expect(shouldSendReviewSms("2026-03-10", yesterday)).toBe(true);
  });

  it("does NOT send for a job that is today (service not done yet)", () => {
    expect(shouldSendReviewSms("2026-03-18", yesterday)).toBe(false);
  });

  it("does NOT send for a job that is tomorrow", () => {
    expect(shouldSendReviewSms("2026-03-19", yesterday)).toBe(false);
  });

  it("does NOT send for a job in the future", () => {
    expect(shouldSendReviewSms("2026-04-01", yesterday)).toBe(false);
  });

  it("handles month boundary correctly — last day of month is before first of next", () => {
    expect(shouldSendReviewSms("2026-02-28", "2026-03-01")).toBe(true);
    expect(shouldSendReviewSms("2026-03-01", "2026-02-28")).toBe(false);
  });

  it("handles year boundary correctly", () => {
    expect(shouldSendReviewSms("2025-12-31", "2026-01-01")).toBe(true);
    expect(shouldSendReviewSms("2026-01-01", "2025-12-31")).toBe(false);
  });
});
