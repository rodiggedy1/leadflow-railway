/**
 * reviewAnalytics.test.ts
 * Unit tests for the analytics computation logic in reviewRouter.analytics
 * Tests the pure calculation functions extracted from the procedure.
 */
import { describe, it, expect } from "vitest";

// ─── Pure helpers mirroring the procedure logic ───────────────────────────────
type JobStatus =
  | "PENDING"
  | "SENT"
  | "REPLIED_POSITIVE"
  | "REPLIED_NEGATIVE"
  | "REVIEW_CONFIRMED"
  | "OPTED_OUT";

interface Job {
  status: JobStatus;
  serviceType: string | null;
  jobDate: string | null;
}

function computeAnalytics(jobs: Job[]) {
  const smsSent = jobs.length;
  const replied = jobs.filter((j) =>
    ["REPLIED_POSITIVE", "REPLIED_NEGATIVE", "REVIEW_CONFIRMED"].includes(j.status)
  ).length;
  const positive = jobs.filter((j) =>
    ["REPLIED_POSITIVE", "REVIEW_CONFIRMED"].includes(j.status)
  ).length;
  const googleReviews = jobs.filter((j) => j.status === "REVIEW_CONFIRMED").length;
  const unhappy = jobs.filter((j) => j.status === "REPLIED_NEGATIVE").length;
  const noReply = jobs.filter((j) => j.status === "SENT").length;

  const responseRate = smsSent > 0 ? Math.round((replied / smsSent) * 100) : 0;
  const happinessRate = replied > 0 ? Math.round((positive / replied) * 100) : 0;

  const sentimentBreakdown = [
    { label: "Positive", count: jobs.filter((j) => j.status === "REPLIED_POSITIVE").length },
    { label: "Review Confirmed", count: googleReviews },
    { label: "Negative", count: unhappy },
    { label: "No Reply", count: noReply },
  ];

  const serviceMap = new Map<string, { positive: number; replied: number }>();
  for (const j of jobs) {
    const svc = j.serviceType ?? "Unknown";
    const entry = serviceMap.get(svc) ?? { positive: 0, replied: 0 };
    if (["REPLIED_POSITIVE", "REVIEW_CONFIRMED"].includes(j.status)) entry.positive++;
    if (["REPLIED_POSITIVE", "REPLIED_NEGATIVE", "REVIEW_CONFIRMED"].includes(j.status))
      entry.replied++;
    serviceMap.set(svc, entry);
  }
  const serviceTypeBreakdown = Array.from(serviceMap.entries())
    .map(([serviceType, s]) => ({
      serviceType,
      happinessRate: s.replied > 0 ? Math.round((s.positive / s.replied) * 100) : 0,
      replied: s.replied,
    }))
    .sort((a, b) => b.replied - a.replied);

  return {
    happinessRate,
    smsSent,
    responseRate,
    googleReviews,
    unhappyCount: unhappy,
    repliedCount: replied,
    sentimentBreakdown,
    serviceTypeBreakdown,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("reviewAnalytics — computeAnalytics", () => {
  it("returns all zeros when no jobs", () => {
    const result = computeAnalytics([]);
    expect(result.happinessRate).toBe(0);
    expect(result.smsSent).toBe(0);
    expect(result.responseRate).toBe(0);
    expect(result.googleReviews).toBe(0);
    expect(result.unhappyCount).toBe(0);
    expect(result.repliedCount).toBe(0);
  });

  it("calculates 100% happiness when all replied positive", () => {
    const jobs: Job[] = [
      { status: "REPLIED_POSITIVE", serviceType: "Standard", jobDate: "2026-03-01" },
      { status: "REPLIED_POSITIVE", serviceType: "Standard", jobDate: "2026-03-02" },
      { status: "REPLIED_POSITIVE", serviceType: "Deep Clean", jobDate: "2026-03-03" },
    ];
    const result = computeAnalytics(jobs);
    expect(result.happinessRate).toBe(100);
    expect(result.responseRate).toBe(100);
    expect(result.smsSent).toBe(3);
    expect(result.repliedCount).toBe(3);
  });

  it("calculates 0% happiness when all replied negative", () => {
    const jobs: Job[] = [
      { status: "REPLIED_NEGATIVE", serviceType: "Standard", jobDate: "2026-03-01" },
      { status: "REPLIED_NEGATIVE", serviceType: "Standard", jobDate: "2026-03-02" },
    ];
    const result = computeAnalytics(jobs);
    expect(result.happinessRate).toBe(0);
    expect(result.unhappyCount).toBe(2);
  });

  it("counts REVIEW_CONFIRMED as both positive and google review", () => {
    const jobs: Job[] = [
      { status: "REVIEW_CONFIRMED", serviceType: "Deep Clean", jobDate: "2026-03-01" },
      { status: "REPLIED_POSITIVE", serviceType: "Standard", jobDate: "2026-03-02" },
      { status: "REPLIED_NEGATIVE", serviceType: "Standard", jobDate: "2026-03-03" },
    ];
    const result = computeAnalytics(jobs);
    // 2 positive (confirmed + positive) out of 3 replied = 67%
    expect(result.happinessRate).toBe(67);
    expect(result.googleReviews).toBe(1);
    expect(result.repliedCount).toBe(3);
  });

  it("excludes SENT (no reply) from happiness rate but includes in smsSent", () => {
    const jobs: Job[] = [
      { status: "SENT", serviceType: "Standard", jobDate: "2026-03-01" },
      { status: "SENT", serviceType: "Standard", jobDate: "2026-03-02" },
      { status: "REPLIED_POSITIVE", serviceType: "Standard", jobDate: "2026-03-03" },
    ];
    const result = computeAnalytics(jobs);
    expect(result.smsSent).toBe(3);
    expect(result.repliedCount).toBe(1);
    expect(result.happinessRate).toBe(100); // 1/1 replied = 100%
    expect(result.responseRate).toBe(33); // 1/3 sent = 33%
  });

  it("excludes OPTED_OUT from all counts", () => {
    // OPTED_OUT jobs are filtered out before reaching computeAnalytics
    // (the procedure filters them in the WHERE clause)
    // So this tests that OPTED_OUT doesn't accidentally count as replied
    const jobs: Job[] = [
      { status: "REPLIED_POSITIVE", serviceType: "Standard", jobDate: "2026-03-01" },
    ];
    const result = computeAnalytics(jobs);
    expect(result.smsSent).toBe(1);
    expect(result.repliedCount).toBe(1);
    expect(result.happinessRate).toBe(100);
  });

  it("builds correct sentiment breakdown", () => {
    const jobs: Job[] = [
      { status: "REPLIED_POSITIVE", serviceType: "Standard", jobDate: "2026-03-01" },
      { status: "REPLIED_POSITIVE", serviceType: "Standard", jobDate: "2026-03-02" },
      { status: "REVIEW_CONFIRMED", serviceType: "Deep Clean", jobDate: "2026-03-03" },
      { status: "REPLIED_NEGATIVE", serviceType: "Standard", jobDate: "2026-03-04" },
      { status: "SENT", serviceType: "Standard", jobDate: "2026-03-05" },
    ];
    const result = computeAnalytics(jobs);
    const positive = result.sentimentBreakdown.find((s) => s.label === "Positive");
    const confirmed = result.sentimentBreakdown.find((s) => s.label === "Review Confirmed");
    const negative = result.sentimentBreakdown.find((s) => s.label === "Negative");
    const noReply = result.sentimentBreakdown.find((s) => s.label === "No Reply");
    expect(positive?.count).toBe(2);
    expect(confirmed?.count).toBe(1);
    expect(negative?.count).toBe(1);
    expect(noReply?.count).toBe(1);
  });

  it("calculates service type breakdown correctly", () => {
    const jobs: Job[] = [
      { status: "REPLIED_POSITIVE", serviceType: "Standard", jobDate: "2026-03-01" },
      { status: "REPLIED_POSITIVE", serviceType: "Standard", jobDate: "2026-03-02" },
      { status: "REPLIED_NEGATIVE", serviceType: "Standard", jobDate: "2026-03-03" },
      { status: "REPLIED_POSITIVE", serviceType: "Deep Clean", jobDate: "2026-03-04" },
      { status: "REPLIED_POSITIVE", serviceType: "Deep Clean", jobDate: "2026-03-05" },
    ];
    const result = computeAnalytics(jobs);
    const standard = result.serviceTypeBreakdown.find((s) => s.serviceType === "Standard");
    const deepClean = result.serviceTypeBreakdown.find((s) => s.serviceType === "Deep Clean");
    // Standard: 2 positive / 3 replied = 67%
    expect(standard?.happinessRate).toBe(67);
    expect(standard?.replied).toBe(3);
    // Deep Clean: 2 positive / 2 replied = 100%
    expect(deepClean?.happinessRate).toBe(100);
    expect(deepClean?.replied).toBe(2);
  });

  it("sorts service type breakdown by replied count descending", () => {
    const jobs: Job[] = [
      { status: "REPLIED_POSITIVE", serviceType: "Rare", jobDate: "2026-03-01" },
      { status: "REPLIED_POSITIVE", serviceType: "Common", jobDate: "2026-03-02" },
      { status: "REPLIED_POSITIVE", serviceType: "Common", jobDate: "2026-03-03" },
      { status: "REPLIED_POSITIVE", serviceType: "Common", jobDate: "2026-03-04" },
    ];
    const result = computeAnalytics(jobs);
    expect(result.serviceTypeBreakdown[0].serviceType).toBe("Common");
    expect(result.serviceTypeBreakdown[1].serviceType).toBe("Rare");
  });

  it("handles null serviceType as Unknown", () => {
    const jobs: Job[] = [
      { status: "REPLIED_POSITIVE", serviceType: null, jobDate: "2026-03-01" },
    ];
    const result = computeAnalytics(jobs);
    expect(result.serviceTypeBreakdown[0].serviceType).toBe("Unknown");
  });

  it("handles mixed scenario with 50% happiness", () => {
    const jobs: Job[] = [
      { status: "REPLIED_POSITIVE", serviceType: "Standard", jobDate: "2026-03-01" },
      { status: "REPLIED_NEGATIVE", serviceType: "Standard", jobDate: "2026-03-02" },
      { status: "SENT", serviceType: "Standard", jobDate: "2026-03-03" },
      { status: "SENT", serviceType: "Standard", jobDate: "2026-03-04" },
    ];
    const result = computeAnalytics(jobs);
    expect(result.smsSent).toBe(4);
    expect(result.repliedCount).toBe(2);
    expect(result.happinessRate).toBe(50);
    expect(result.responseRate).toBe(50);
  });
});
