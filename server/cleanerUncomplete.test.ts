/**
 * Tests for:
 * 1. syncTodayJobs terminal-status guard (completed/cancelled/rescheduled must not be overwritten)
 * 2. cleaner.uncompleteJob — ownership check, status guard, 24h window
 */
import { describe, it, expect } from "vitest";

// ── 1. Terminal status guard logic (extracted for unit testing) ───────────────

function buildSyncData(
  jobData: Record<string, unknown>,
  previousStatus: string | null
): Record<string, unknown> {
  const isTerminalStatus =
    previousStatus === "completed" ||
    previousStatus === "cancelled" ||
    previousStatus === "rescheduled";
  if (isTerminalStatus) {
    // Strip bookingStatus from update — same logic as qualityRouter syncTodayJobs
    const { bookingStatus, ...rest } = jobData as { bookingStatus: string } & Record<string, unknown>;
    void bookingStatus;
    return rest;
  }
  return jobData;
}

describe("syncTodayJobs terminal-status guard", () => {
  const jobData = {
    bookingStatus: "assigned",
    customerName: "Jane Doe",
    jobRevenue: "200.00",
  };

  it("preserves completed status — does not include bookingStatus in update", () => {
    const result = buildSyncData(jobData, "completed");
    expect(result).not.toHaveProperty("bookingStatus");
    expect(result).toHaveProperty("customerName", "Jane Doe");
  });

  it("preserves cancelled status", () => {
    const result = buildSyncData(jobData, "cancelled");
    expect(result).not.toHaveProperty("bookingStatus");
  });

  it("preserves rescheduled status", () => {
    const result = buildSyncData(jobData, "rescheduled");
    expect(result).not.toHaveProperty("bookingStatus");
  });

  it("allows overwrite for assigned status", () => {
    const result = buildSyncData(jobData, "assigned");
    expect(result).toHaveProperty("bookingStatus", "assigned");
  });

  it("allows overwrite for null status (new job)", () => {
    const result = buildSyncData(jobData, null);
    expect(result).toHaveProperty("bookingStatus", "assigned");
  });

  it("allows overwrite for in_progress status", () => {
    const result = buildSyncData(jobData, "in_progress");
    expect(result).toHaveProperty("bookingStatus", "assigned");
  });
});

// ── 2. uncompleteJob validation logic ────────────────────────────────────────

function validateUncomplete(
  job: { bookingStatus: string | null; completedAt: Date | null } | null,
  requestingCleanerId: number,
  jobCleanerId: number
): { ok: boolean; error?: string } {
  if (!job || requestingCleanerId !== jobCleanerId) {
    return { ok: false, error: "Job not found or not yours" };
  }
  if (job.bookingStatus !== "completed") {
    return { ok: false, error: "Job is not marked completed" };
  }
  if (job.completedAt) {
    const hoursAgo = (Date.now() - new Date(job.completedAt).getTime()) / (1000 * 60 * 60);
    if (hoursAgo > 24) {
      return { ok: false, error: "Cannot undo completion after 24 hours" };
    }
  }
  return { ok: true };
}

describe("cleaner.uncompleteJob validation", () => {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);

  it("succeeds for own completed job within 24h", () => {
    const result = validateUncomplete(
      { bookingStatus: "completed", completedAt: twoHoursAgo },
      42, 42
    );
    expect(result.ok).toBe(true);
  });

  it("rejects if cleaner does not own the job", () => {
    const result = validateUncomplete(
      { bookingStatus: "completed", completedAt: twoHoursAgo },
      42, 99
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not yours");
  });

  it("rejects if job is null (not found)", () => {
    const result = validateUncomplete(null, 42, 42);
    expect(result.ok).toBe(false);
  });

  it("rejects if job is not completed", () => {
    const result = validateUncomplete(
      { bookingStatus: "assigned", completedAt: null },
      42, 42
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not marked completed");
  });

  it("rejects if completion was more than 24 hours ago", () => {
    const result = validateUncomplete(
      { bookingStatus: "completed", completedAt: twentyFiveHoursAgo },
      42, 42
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("24 hours");
  });

  it("succeeds if completedAt is null (no timestamp recorded)", () => {
    const result = validateUncomplete(
      { bookingStatus: "completed", completedAt: null },
      42, 42
    );
    expect(result.ok).toBe(true);
  });
});
