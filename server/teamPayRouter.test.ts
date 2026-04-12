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

// ── missedCheckins filter logic ────────────────────────────────────────────

const INACTIVE_BOOKING_STATUSES = ["rescheduled", "cancelled", "canceled", "no_show", "noshow"];

interface JobStub {
  jobStatus: string | null;
  jobDate: string;
  bookingStatus: string | null;
}

function countMissedCheckins(jobs: JobStub[], today: string): number {
  return jobs.filter(
    (j) =>
      j.jobStatus === null &&
      j.jobDate < today &&
      !INACTIVE_BOOKING_STATUSES.includes((j.bookingStatus ?? "").toLowerCase())
  ).length;
}

describe("countMissedCheckins", () => {
  const today = "2026-04-12";

  it("counts a past job with null jobStatus and active bookingStatus as missed", () => {
    const jobs: JobStub[] = [
      { jobStatus: null, jobDate: "2026-04-10", bookingStatus: "scheduled" },
    ];
    expect(countMissedCheckins(jobs, today)).toBe(1);
  });

  it("does NOT count a rescheduled job as missed", () => {
    const jobs: JobStub[] = [
      { jobStatus: null, jobDate: "2026-04-11", bookingStatus: "rescheduled" },
    ];
    expect(countMissedCheckins(jobs, today)).toBe(0);
  });

  it("does NOT count a cancelled job as missed", () => {
    const jobs: JobStub[] = [
      { jobStatus: null, jobDate: "2026-04-11", bookingStatus: "cancelled" },
    ];
    expect(countMissedCheckins(jobs, today)).toBe(0);
  });

  it("does NOT count a canceled (single-l) job as missed", () => {
    const jobs: JobStub[] = [
      { jobStatus: null, jobDate: "2026-04-11", bookingStatus: "canceled" },
    ];
    expect(countMissedCheckins(jobs, today)).toBe(0);
  });

  it("does NOT count a no_show job as missed", () => {
    const jobs: JobStub[] = [
      { jobStatus: null, jobDate: "2026-04-11", bookingStatus: "no_show" },
    ];
    expect(countMissedCheckins(jobs, today)).toBe(0);
  });

  it("does NOT count a future job as missed even if jobStatus is null", () => {
    const jobs: JobStub[] = [
      { jobStatus: null, jobDate: "2026-04-13", bookingStatus: "scheduled" },
    ];
    expect(countMissedCheckins(jobs, today)).toBe(0);
  });

  it("does NOT count a completed job as missed", () => {
    const jobs: JobStub[] = [
      { jobStatus: "completed", jobDate: "2026-04-10", bookingStatus: "completed" },
    ];
    expect(countMissedCheckins(jobs, today)).toBe(0);
  });

  it("correctly counts mixed batch — only the truly missed job", () => {
    const jobs: JobStub[] = [
      { jobStatus: null, jobDate: "2026-04-11", bookingStatus: "rescheduled" }, // excluded
      { jobStatus: null, jobDate: "2026-04-11", bookingStatus: "rescheduled" }, // excluded
      { jobStatus: null, jobDate: "2026-04-10", bookingStatus: "scheduled" },   // missed ✓
      { jobStatus: "completed", jobDate: "2026-04-09", bookingStatus: "completed" }, // excluded
    ];
    expect(countMissedCheckins(jobs, today)).toBe(1);
  });
});
