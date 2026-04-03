/**
 * Tests for finishing_up / wrapping_up bidirectional auto-link logic.
 *
 * We test the pure business rules without hitting the DB:
 *  - finishing_up on Job A → next job should become wrapping_up
 *  - wrapping_up on Job B → previous job should become finishing_up
 *  - Guards: don't overwrite already-active or completed statuses
 *  - Guards: don't update if previous job is already completed
 *  - Edge: only job on the day → no auto-link fires
 *  - Edge: last job of day taps finishing_up → no next job, no error
 *  - Edge: first job of day taps wrapping_up → no previous job, no error
 */
import { describe, it, expect } from "vitest";

// ── Pure logic extracted from cleanerRouter for unit testing ──────────────────

type JobRow = {
  id: number;
  serviceDateTime: string;
  jobStatus: string | null;
  bookingStatus: string | null;
};

/**
 * Mirrors the server logic: given a list of jobs sorted by serviceDateTime,
 * the current job id, and the tapped status, returns the sibling job that
 * should be auto-updated and the target status — or null if no update needed.
 */
function resolveAutoLink(
  allJobs: JobRow[],
  currentJobId: number,
  tappedStatus: "finishing_up" | "wrapping_up"
): { siblingId: number; newStatus: string } | null {
  const sorted = [...allJobs].sort((a, b) =>
    a.serviceDateTime.localeCompare(b.serviceDateTime)
  );
  const currentIdx = sorted.findIndex((j) => j.id === currentJobId);
  if (currentIdx < 0) return null;

  if (tappedStatus === "finishing_up") {
    const next = sorted[currentIdx + 1];
    if (!next) return null;
    if (
      next.bookingStatus === "completed" ||
      next.bookingStatus === "cancelled" ||
      next.bookingStatus === "rescheduled"
    )
      return null;
    if (
      next.jobStatus === "on_the_way" ||
      next.jobStatus === "arrived" ||
      next.jobStatus === "in_progress" ||
      next.jobStatus === "completed"
    )
      return null;
    return { siblingId: next.id, newStatus: "wrapping_up" };
  } else {
    // wrapping_up
    const prev = sorted[currentIdx - 1];
    if (!prev) return null;
    if (prev.bookingStatus === "completed") return null;
    if (prev.jobStatus === "completed" || prev.jobStatus === "finishing_up")
      return null;
    return { siblingId: prev.id, newStatus: "finishing_up" };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("finishing_up / wrapping_up auto-link", () => {
  const makeJobs = (overrides: Partial<JobRow>[] = []): JobRow[] =>
    [
      { id: 1, serviceDateTime: "2026-04-03 09:00:00", jobStatus: "in_progress", bookingStatus: "assigned" },
      { id: 2, serviceDateTime: "2026-04-03 12:00:00", jobStatus: null, bookingStatus: "assigned" },
      { id: 3, serviceDateTime: "2026-04-03 15:00:00", jobStatus: null, bookingStatus: "assigned" },
    ].map((j, i) => ({ ...j, ...(overrides[i] ?? {}) }));

  it("finishing_up on Job 1 → Job 2 becomes wrapping_up", () => {
    const jobs = makeJobs();
    const result = resolveAutoLink(jobs, 1, "finishing_up");
    expect(result).toEqual({ siblingId: 2, newStatus: "wrapping_up" });
  });

  it("wrapping_up on Job 2 → Job 1 becomes finishing_up", () => {
    const jobs = makeJobs();
    const result = resolveAutoLink(jobs, 2, "wrapping_up");
    expect(result).toEqual({ siblingId: 1, newStatus: "finishing_up" });
  });

  it("wrapping_up on Job 3 → Job 2 becomes finishing_up", () => {
    const jobs = makeJobs();
    const result = resolveAutoLink(jobs, 3, "wrapping_up");
    expect(result).toEqual({ siblingId: 2, newStatus: "finishing_up" });
  });

  it("finishing_up on last job → no auto-link", () => {
    const jobs = makeJobs();
    const result = resolveAutoLink(jobs, 3, "finishing_up");
    expect(result).toBeNull();
  });

  it("wrapping_up on first job → no auto-link", () => {
    const jobs = makeJobs();
    const result = resolveAutoLink(jobs, 1, "wrapping_up");
    expect(result).toBeNull();
  });

  it("only one job on the day → finishing_up returns null", () => {
    const jobs: JobRow[] = [
      { id: 1, serviceDateTime: "2026-04-03 09:00:00", jobStatus: "in_progress", bookingStatus: "assigned" },
    ];
    expect(resolveAutoLink(jobs, 1, "finishing_up")).toBeNull();
  });

  it("does NOT overwrite next job if it is already on_the_way", () => {
    const jobs = makeJobs([
      {},
      { id: 2, serviceDateTime: "2026-04-03 12:00:00", jobStatus: "on_the_way", bookingStatus: "assigned" },
    ]);
    expect(resolveAutoLink(jobs, 1, "finishing_up")).toBeNull();
  });

  it("does NOT overwrite next job if it is already in_progress", () => {
    const jobs = makeJobs([
      {},
      { id: 2, serviceDateTime: "2026-04-03 12:00:00", jobStatus: "in_progress", bookingStatus: "assigned" },
    ]);
    expect(resolveAutoLink(jobs, 1, "finishing_up")).toBeNull();
  });

  it("does NOT overwrite next job if it is already completed", () => {
    const jobs = makeJobs([
      {},
      { id: 2, serviceDateTime: "2026-04-03 12:00:00", jobStatus: "completed", bookingStatus: "assigned" },
    ]);
    expect(resolveAutoLink(jobs, 1, "finishing_up")).toBeNull();
  });

  it("does NOT update prev job if bookingStatus is completed", () => {
    const jobs = makeJobs([
      { id: 1, serviceDateTime: "2026-04-03 09:00:00", jobStatus: "completed", bookingStatus: "completed" },
    ]);
    expect(resolveAutoLink(jobs, 2, "wrapping_up")).toBeNull();
  });

  it("does NOT update prev job if jobStatus is already finishing_up", () => {
    const jobs = makeJobs([
      { id: 1, serviceDateTime: "2026-04-03 09:00:00", jobStatus: "finishing_up", bookingStatus: "assigned" },
    ]);
    expect(resolveAutoLink(jobs, 2, "wrapping_up")).toBeNull();
  });

  it("does NOT update next job if bookingStatus is cancelled", () => {
    const jobs = makeJobs([
      {},
      { id: 2, serviceDateTime: "2026-04-03 12:00:00", jobStatus: null, bookingStatus: "cancelled" },
    ]);
    expect(resolveAutoLink(jobs, 1, "finishing_up")).toBeNull();
  });

  it("handles unsorted input correctly (sorts by serviceDateTime)", () => {
    const jobs: JobRow[] = [
      { id: 3, serviceDateTime: "2026-04-03 15:00:00", jobStatus: null, bookingStatus: "assigned" },
      { id: 1, serviceDateTime: "2026-04-03 09:00:00", jobStatus: "in_progress", bookingStatus: "assigned" },
      { id: 2, serviceDateTime: "2026-04-03 12:00:00", jobStatus: null, bookingStatus: "assigned" },
    ];
    const result = resolveAutoLink(jobs, 1, "finishing_up");
    expect(result).toEqual({ siblingId: 2, newStatus: "wrapping_up" });
  });
});
