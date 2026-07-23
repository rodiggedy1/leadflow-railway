/**
 * madison.test.ts
 *
 * Tests for the Madison Readiness Domain planner.
 * Covers the 8 specified natural-language scenarios.
 *
 * Gate tests: deterministic — no mocks needed.
 * Executor tests: mock computeReadinessSummary to return controlled data.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isReadinessDomain } from "./gate";
import { executePlan } from "./executor";
import type { ReadinessPlan } from "./types";

// ── Gate tests ────────────────────────────────────────────────────────────────

describe("isReadinessDomain — gate", () => {
  // The 8 specified scenarios
  it("matches: What needs attention tomorrow?", () => {
    expect(isReadinessDomain("What needs attention tomorrow?")).toBe(true);
  });

  it("matches: Are we ready for tomorrow?", () => {
    expect(isReadinessDomain("Are we ready for tomorrow?")).toBe(true);
  });

  it("matches: Show me tomorrow's problems.", () => {
    expect(isReadinessDomain("Show me tomorrow's problems.")).toBe(true);
  });

  it("matches: Which jobs aren't confirmed?", () => {
    expect(isReadinessDomain("Which jobs aren't confirmed?")).toBe(true);
  });

  it("matches: Which jobs have payment issues?", () => {
    expect(isReadinessDomain("Which jobs have payment issues?")).toBe(true);
  });

  it("matches: Which jobs have no cleaner assigned?", () => {
    expect(isReadinessDomain("Which jobs have no cleaner assigned?")).toBe(true);
  });

  it("matches: Show me only the 9 AM jobs.", () => {
    expect(isReadinessDomain("Show me only the 9 AM jobs.")).toBe(true);
  });

  it("matches: Which afternoon jobs are at risk?", () => {
    expect(isReadinessDomain("Which afternoon jobs are at risk?")).toBe(true);
  });

  it("matches: Are there any access issues tomorrow?", () => {
    expect(isReadinessDomain("Are there any access issues tomorrow?")).toBe(
      true
    );
  });

  // Non-readiness messages should NOT match
  it("does not match: Text Maria about her job", () => {
    expect(isReadinessDomain("Text Maria about her job")).toBe(false);
  });

  it("does not match: What's the ETA for team 3?", () => {
    expect(isReadinessDomain("What's the ETA for team 3?")).toBe(false);
  });

  it("does not match: Send invoice to John Smith", () => {
    expect(isReadinessDomain("Send invoice to John Smith")).toBe(false);
  });

  it("does not match: Call Rohan Gilkes", () => {
    expect(isReadinessDomain("Call Rohan Gilkes")).toBe(false);
  });
});

// ── Executor filter tests ─────────────────────────────────────────────────────

// Minimal mock job data
const mockJob = (overrides: Partial<{
  id: number;
  customerName: string;
  jobTime: string;
  cleanerProfileId: number | null;
  cleanerName: string | null;
  teamName: string | null;
  serviceType: string | null;
  customerNotes: string | null;
}> = {}) => ({
  id: 1,
  customerName: "Test Customer",
  jobTime: "9:00 AM",
  cleanerProfileId: 1,
  cleanerName: "Jane Doe",
  teamName: "Team A",
  serviceType: "Standard",
  customerNotes: null,
  ...overrides,
});

const mockSummary = (jobs: ReturnType<typeof mockJob>[], confirmationStatus: "confirmed" | "pending" = "confirmed") => ({
  jobs,
  dimensions: {
    jobs: {
      total: jobs.length,
      doubleBooked: [],
    },
    confirmations: {
      rows: jobs.map((j) => ({
        customerName: j.customerName,
        jobTime: j.jobTime,
        status: confirmationStatus,
        outcomeLabel: confirmationStatus === "confirmed" ? "Confirmed" : null,
      })),
    },
    payments: {
      rows: jobs.map((j) => ({
        customerName: j.customerName,
        status: j.cleanerProfileId ? "on_hold" : "no_card",
      })),
    },
  },
  overallPct: 80,
  totalIssues: 2,
});

vi.mock("./readinessService", () => ({
  computeReadinessSummary: vi.fn(),
}));

import { computeReadinessSummary } from "./readinessService";

const mockComputeReadinessSummary = vi.mocked(computeReadinessSummary);

const basePlan = (overrides: Partial<ReadinessPlan> = {}): ReadinessPlan => ({
  dateScope: {
    type: "service_date",
    startDate: "2026-07-24",
    endDate: "2026-07-24",
  },
  ...overrides,
});

describe("executePlan — filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all jobs with no filters", async () => {
    const jobs = [
      mockJob({ id: 1, jobTime: "9:00 AM" }),
      mockJob({ id: 2, jobTime: "2:00 PM" }),
    ];
    mockComputeReadinessSummary.mockResolvedValueOnce(mockSummary(jobs) as any);

    const result = await executePlan({} as any, basePlan());
    expect(result.filteredJobs).toBe(2);
    expect(result.appliedFilter).toBeNull();
  });

  it("filters to morning jobs only", async () => {
    const jobs = [
      mockJob({ id: 1, jobTime: "9:00 AM" }),
      mockJob({ id: 2, jobTime: "2:00 PM" }),
      mockJob({ id: 3, jobTime: "11:30 AM" }),
    ];
    mockComputeReadinessSummary.mockResolvedValueOnce(mockSummary(jobs) as any);

    const result = await executePlan(
      {} as any,
      basePlan({ filters: { timeOfDay: "morning" } })
    );
    expect(result.filteredJobs).toBe(2);
    expect(result.appliedFilter).toBe("morning jobs only");
  });

  it("filters to afternoon jobs only", async () => {
    const jobs = [
      mockJob({ id: 1, jobTime: "9:00 AM" }),
      mockJob({ id: 2, jobTime: "2:00 PM" }),
      mockJob({ id: 3, jobTime: "4:30 PM" }),
    ];
    mockComputeReadinessSummary.mockResolvedValueOnce(mockSummary(jobs) as any);

    const result = await executePlan(
      {} as any,
      basePlan({ filters: { timeOfDay: "afternoon" } })
    );
    expect(result.filteredJobs).toBe(2);
    expect(result.appliedFilter).toBe("afternoon jobs only");
  });

  it("filters to specific time window (9 AM jobs)", async () => {
    const jobs = [
      mockJob({ id: 1, jobTime: "9:00 AM" }),
      mockJob({ id: 2, jobTime: "9:30 AM" }),
      mockJob({ id: 3, jobTime: "11:00 AM" }),
    ];
    mockComputeReadinessSummary.mockResolvedValueOnce(mockSummary(jobs) as any);

    const result = await executePlan(
      {} as any,
      basePlan({ filters: { startTime: "09:00", endTime: "09:59" } })
    );
    expect(result.filteredJobs).toBe(2); // 9:00 and 9:30, not 11:00
  });

  it("filters to unassigned jobs (assignment dimension)", async () => {
    const jobs = [
      mockJob({ id: 1, cleanerProfileId: 1 }),
      mockJob({ id: 2, cleanerProfileId: null }),
      mockJob({ id: 3, cleanerProfileId: null }),
    ];
    mockComputeReadinessSummary.mockResolvedValueOnce(mockSummary(jobs) as any);

    const result = await executePlan(
      {} as any,
      basePlan({ filters: { dimension: "assignment" } })
    );
    expect(result.filteredJobs).toBe(2);
    expect(result.appliedFilter).toBe("unassigned jobs");
  });

  it("filters to unconfirmed jobs (confirmation dimension)", async () => {
    const jobs = [
      mockJob({ id: 1 }),
      mockJob({ id: 2 }),
      mockJob({ id: 3 }),
    ];
    mockComputeReadinessSummary.mockResolvedValueOnce(
      mockSummary(jobs, "pending") as any
    );

    const result = await executePlan(
      {} as any,
      basePlan({ filters: { dimension: "confirmation" } })
    );
    expect(result.filteredJobs).toBe(3);
    expect(result.appliedFilter).toBe("unconfirmed jobs");
  });

  it("filters to jobs needing attention (onlyNeedsAttention)", async () => {
    const jobs = [
      mockJob({ id: 1, cleanerProfileId: null }), // unassigned — has flag
      mockJob({ id: 2, cleanerProfileId: 1 }),    // assigned, confirmed, on_hold — no flags
    ];
    mockComputeReadinessSummary.mockResolvedValueOnce(mockSummary(jobs) as any);

    const result = await executePlan(
      {} as any,
      basePlan({ filters: { onlyNeedsAttention: true } })
    );
    expect(result.filteredJobs).toBe(1);
  });

  it("sorts by risk (most flags first)", async () => {
    const jobs = [
      mockJob({ id: 1, cleanerProfileId: 1 }),         // 0 flags
      mockJob({ id: 2, cleanerProfileId: null }),       // 1 flag: unassigned
    ];
    // Make job 2 also unconfirmed for 2 flags
    const summary = {
      ...mockSummary(jobs),
      dimensions: {
        ...mockSummary(jobs).dimensions,
        confirmations: {
          rows: [
            { customerName: "Test Customer", jobTime: "9:00 AM", status: "confirmed", outcomeLabel: "Confirmed" },
            { customerName: "Test Customer", jobTime: "9:00 AM", status: "pending", outcomeLabel: null },
          ],
        },
      },
    };
    mockComputeReadinessSummary.mockResolvedValueOnce(summary as any);

    const result = await executePlan(
      {} as any,
      basePlan({ sort: "risk" })
    );
    // Job with most flags should be first
    expect(result.jobs[0].flags.length).toBeGreaterThanOrEqual(
      result.jobs[result.jobs.length - 1].flags.length
    );
  });

  it("returns correct projection summary counts", async () => {
    const jobs = [
      mockJob({ id: 1, cleanerProfileId: null }),  // unassigned
      mockJob({ id: 2, cleanerProfileId: 1 }),     // assigned
    ];
    mockComputeReadinessSummary.mockResolvedValueOnce(
      mockSummary(jobs, "pending") as any
    );

    const result = await executePlan({} as any, basePlan());
    expect(result.summary.unassigned).toBe(1);
    expect(result.summary.unconfirmed).toBe(2); // both pending
  });
});
