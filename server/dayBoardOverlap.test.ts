import { describe, expect, it } from "vitest";
import { allocateOverlapRows } from "../client/src/pages/DayBoardExactLive";

type TestJob = Parameters<typeof allocateOverlapRows>[0][number];

function job(id: number, serviceDateTime: string): TestJob {
  return {
    id,
    cleanerName: "Team A",
    teamName: null,
    customerName: `Customer ${id}`,
    customerPhone: null,
    cleanerPhone: null,
    jobAddress: null,
    serviceDateTime,
    serviceType: "Standard Cleaning",
    bedrooms: 2,
    bathrooms: null,
    jobStatus: "not_started",
    delayMinutes: null,
    issueNote: null,
    etaTimestamp: null,
    updatedAt: null,
    stepsFired: 0,
    stepsSuccess: 0,
    totalSteps: 0,
    timeline: [],
    bookingStatus: "confirmed",
  };
}

describe("Day Board overlap rows", () => {
  it("keeps jobs with the same or intersecting displayed time span in distinct vertical rows", () => {
    const placed = allocateOverlapRows([
      job(1, "2026-09-20T09:00:00-04:00"),
      job(2, "2026-09-20T09:00:00-04:00"),
      job(3, "2026-09-20T09:30:00-04:00"),
    ]);

    expect(placed.map(({ job: placedJob, overlapRow }) => [placedJob.id, overlapRow])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
  });

  it("reuses a row after a prior displayed job span ends", () => {
    const placed = allocateOverlapRows([
      job(2, "2026-09-20T10:45:00-04:00"),
      job(1, "2026-09-20T09:00:00-04:00"),
    ]);

    expect(placed.map(({ job: placedJob, overlapRow }) => [placedJob.id, overlapRow])).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });
});
