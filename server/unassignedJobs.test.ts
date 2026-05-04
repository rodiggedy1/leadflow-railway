/**
 * Unit tests for the unassigned job detection logic used in getCommandChatData.
 * Tests the filter/map/sort logic that produces the unassignedJobs array.
 */

import { describe, it, expect } from "vitest";

// Mirror the logic from opsChatRouter.ts getCommandChatData
function buildUnassignedJobs(
  jobs: Array<{
    id: number;
    teamId: number | null;
    jobStatus: string;
    customerName: string | null;
    jobAddress: string | null;
    serviceType: string | null;
    serviceDateTime: string | null;
  }>,
  now: number
) {
  return jobs
    .filter((j) => j.teamId == null && j.jobStatus !== "completed")
    .map((j) => {
      const jobMs = j.serviceDateTime ? new Date(j.serviceDateTime).getTime() : 0;
      const minutesUntil = jobMs ? Math.round((jobMs - now) / 60_000) : null;
      const startTime = jobMs
        ? new Date(jobMs).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZone: "America/New_York",
          })
        : null;
      return {
        id: j.id,
        customerName: j.customerName ?? "Unknown Client",
        jobAddress: j.jobAddress ?? "",
        serviceType: j.serviceType ?? "",
        startTime,
        startMs: jobMs,
        minutesUntil,
      };
    })
    .sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
}

const NOW = new Date("2026-05-04T14:00:00Z").getTime(); // 10am EST

describe("unassigned job detection", () => {
  it("returns empty array when all jobs are assigned", () => {
    const jobs = [
      { id: 1, teamId: 5, jobStatus: "on_the_way", customerName: "Alice", jobAddress: "123 Main", serviceType: "Deep Clean", serviceDateTime: "2026-05-04T15:00:00Z" },
      { id: 2, teamId: 7, jobStatus: "in_progress", customerName: "Bob", jobAddress: "456 Oak", serviceType: "Standard", serviceDateTime: "2026-05-04T13:00:00Z" },
    ];
    expect(buildUnassignedJobs(jobs, NOW)).toHaveLength(0);
  });

  it("returns unassigned job when teamId is null", () => {
    const jobs = [
      { id: 10, teamId: null, jobStatus: "new", customerName: "Eustace Esotu", jobAddress: "7041 Blade Brooke Rd", serviceType: "Standard", serviceDateTime: "2026-05-04T15:00:00Z" },
    ];
    const result = buildUnassignedJobs(jobs, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].customerName).toBe("Eustace Esotu");
    expect(result[0].jobAddress).toBe("7041 Blade Brooke Rd");
  });

  it("excludes completed jobs even if teamId is null", () => {
    const jobs = [
      { id: 20, teamId: null, jobStatus: "completed", customerName: "Done Client", jobAddress: "789 Elm", serviceType: "Standard", serviceDateTime: "2026-05-04T12:00:00Z" },
    ];
    expect(buildUnassignedJobs(jobs, NOW)).toHaveLength(0);
  });

  it("calculates minutesUntil correctly for future job", () => {
    const futureMs = NOW + 30 * 60_000; // 30 minutes from now
    const jobs = [
      { id: 30, teamId: null, jobStatus: "new", customerName: "Future Client", jobAddress: "1 Future St", serviceType: "Standard", serviceDateTime: new Date(futureMs).toISOString() },
    ];
    const result = buildUnassignedJobs(jobs, NOW);
    expect(result[0].minutesUntil).toBe(30);
  });

  it("calculates negative minutesUntil for past-start job", () => {
    const pastMs = NOW - 10 * 60_000; // 10 minutes ago
    const jobs = [
      { id: 40, teamId: null, jobStatus: "new", customerName: "Late Client", jobAddress: "2 Late Ave", serviceType: "Standard", serviceDateTime: new Date(pastMs).toISOString() },
    ];
    const result = buildUnassignedJobs(jobs, NOW);
    expect(result[0].minutesUntil).toBe(-10);
  });

  it("sorts by start time ascending (earliest first)", () => {
    const jobs = [
      { id: 50, teamId: null, jobStatus: "new", customerName: "Second Client", jobAddress: "B", serviceType: "Standard", serviceDateTime: new Date(NOW + 120 * 60_000).toISOString() },
      { id: 51, teamId: null, jobStatus: "new", customerName: "First Client", jobAddress: "A", serviceType: "Standard", serviceDateTime: new Date(NOW + 30 * 60_000).toISOString() },
    ];
    const result = buildUnassignedJobs(jobs, NOW);
    expect(result[0].customerName).toBe("First Client");
    expect(result[1].customerName).toBe("Second Client");
  });

  it("uses Unknown Client when customerName is null", () => {
    const jobs = [
      { id: 60, teamId: null, jobStatus: "new", customerName: null, jobAddress: "3 Unknown Rd", serviceType: null, serviceDateTime: null },
    ];
    const result = buildUnassignedJobs(jobs, NOW);
    expect(result[0].customerName).toBe("Unknown Client");
    expect(result[0].minutesUntil).toBeNull();
    expect(result[0].startTime).toBeNull();
  });

  it("mixes assigned and unassigned jobs, returns only unassigned", () => {
    const jobs = [
      { id: 70, teamId: 3, jobStatus: "on_the_way", customerName: "Assigned A", jobAddress: "A", serviceType: "Standard", serviceDateTime: new Date(NOW + 60 * 60_000).toISOString() },
      { id: 71, teamId: null, jobStatus: "new", customerName: "Unassigned B", jobAddress: "B", serviceType: "Standard", serviceDateTime: new Date(NOW + 90 * 60_000).toISOString() },
      { id: 72, teamId: 5, jobStatus: "in_progress", customerName: "Assigned C", jobAddress: "C", serviceType: "Standard", serviceDateTime: new Date(NOW + 120 * 60_000).toISOString() },
    ];
    const result = buildUnassignedJobs(jobs, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].customerName).toBe("Unassigned B");
  });
});
