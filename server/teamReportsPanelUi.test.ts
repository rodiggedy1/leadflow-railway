// Phase 3 "Send team reports" panel: the real component rendered offline (fake tRPC, no network, nothing sent).
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
(globalThis as any).React = React;

let data: any = null;
vi.mock("@/lib/trpc", () => ({ trpc: { leadflowJobs: { leaderboard: { history: {
  teamReports: { useQuery: () => ({ data, isError: false, refetch: async () => ({}) }) },
  sendTeamReports: { useMutation: () => ({ mutateAsync: async () => ({ outcomes: [] }) }) },
} } } } }));

const at = Date.parse("2026-11-29T15:05:00Z");
const team = (teamId: string, teamName: string, change: Record<string, unknown> = {}) => ({ teamId, teamName, rank: 1, score: 90, completedJobs: 8, complaintCount: 0,
  language: "en", phone: "+13025550111", phoneMasked: "•••• 0111", cleanerProfileId: 11, issue: null, message: `Maids in Black weekly report for ${teamName}`, latest: null, attempts: 0, ...change });

describe("team reports panel", async () => {
  const mod = await import("../client/src/components/TeamReportsPanel");
  const render = () => renderToStaticMarkup(React.createElement(mod.TeamReportsPanel, { agentId: 7, weekStart: "2026-11-22", weekText: "November 22–28, 2026", onClose: () => {} }));
  it("statuses: not sent, pending, may have been sent, sent (with time), failed (with reason), skipped (with the issue)", () => {
    expect(mod.reportStatus(team("1", "A") as any)).toEqual({ tone: "none", text: "Not sent" });
    expect(mod.reportStatus(team("1", "A", { latest: { status: "sent", attempt: 1, atMs: at, sentAtMs: at, error: null, provisional: false } }) as any).text).toBe("Sent Nov 29, 10:05 AM");
    expect(mod.reportStatus(team("1", "A", { latest: { status: "sent", attempt: 2, atMs: at, sentAtMs: at, error: null, provisional: true } }) as any).text).toBe("Sent Nov 29, 10:05 AM (send 2) · preliminary");
    expect(mod.reportStatus(team("1", "A", { latest: { status: "failed", attempt: 1, atMs: at, sentAtMs: null, error: "OpenPhone API returned 500", provisional: false } }) as any))
      .toEqual({ tone: "failed", text: "Failed Nov 29, 10:05 AM · OpenPhone API returned 500" });
    expect(mod.reportStatus(team("1", "A", { latest: { status: "pending", attempt: 1, atMs: at, sentAtMs: null, error: null, provisional: false } }) as any).text).toBe("Pending since Nov 29, 10:05 AM");
    expect(mod.reportStatus(team("1", "A", { latest: { status: "uncertain", attempt: 1, atMs: at, sentAtMs: null, error: null, provisional: false } }) as any).text).toContain("May have been sent");
    expect(mod.reportStatus(team("1", "A", { issue: "The team account has no phone number." }) as any)).toEqual({ tone: "skipped", text: "Will be skipped: The team account has no phone number." });
  });
  it("'Send to all' covers only teams with a valid phone and nothing sent, pending or possibly sent (failed ones are retried)", () => {
    const statuses = [null, "sent", "pending", "uncertain", "failed"].map(s => mod.sendable(team("1", "A", s ? { latest: { status: s, attempt: 1, atMs: at, sentAtMs: null, error: null, provisional: false } } : {}) as any));
    expect(statuses).toEqual([true, false, false, false, true]);
    expect(mod.sendable(team("1", "A", { issue: "x" }) as any)).toBe(false);
  });
  it("renders every team with language, masked phone, status, Preview, Resend only where sent, and the two send buttons", () => {
    data = { agentId: 7, weekStart: "2026-11-22", weekEnd: "2026-11-28", provisional: false, provisionalReason: null, teams: [
      team("1", "Team Alba", { latest: { status: "sent", attempt: 1, atMs: at, sentAtMs: at, error: null, provisional: false } }),
      team("2", "Team Brisa", { language: "es", phoneMasked: "•••• 0112" }),
      team("3", "Team Cielo", { issue: "The team account has no phone number.", phone: null, phoneMasked: null }),
    ] };
    const html = render();
    expect(html).toContain("Team reports · November 22–28, 2026");
    expect(html).toContain("Español · •••• 0112");
    expect(html).toContain("Will be skipped: The team account has no phone number.");
    expect(html.match(/>Resend</g)).toHaveLength(1);
    expect(html.match(/>Preview</g)).toHaveLength(3);
    expect(html).toContain("Send to selected (0)");
    expect(html).toContain("Send to all not yet sent (1)");
    expect(html).not.toContain("Preliminary.");
  });
  it("provisional week is clearly flagged", () => {
    data = { ...data, provisional: true, provisionalReason: "The week's complaint analysis is not complete." };
    expect(render()).toContain("<strong>Preliminary.</strong> The week&#x27;s complaint analysis is not complete.");
  });
  it("send results are summarised per team", () => {
    expect(mod.outcomeSummary([{ teamId: "1", teamName: "Team Alba", result: "sent", detail: null }, { teamId: "3", teamName: "Team Cielo", result: "skipped_no_phone", detail: "x" },
      { teamId: "2", teamName: "Team Brisa", result: "failed", detail: "OpenPhone API returned 500" }] as any))
      .toBe("Team Alba: sent · Team Cielo: skipped (no valid phone) · Team Brisa: failed (OpenPhone API returned 500)");
  });
  it("the leaderboard page only gains the button; its standings layout is unchanged", () => {
    const page = readFileSync("client/src/components/TeamPerformanceAdmin.tsx", "utf8");
    expect(page).toContain('<button type="button" className="tp-btn" onClick={() => setReports(true)}>Send team reports</button>');
    expect(page).toContain('<div className="tp-row tp-row-head" aria-hidden="true"><span>Team</span><span>Jobs</span><span>Complaints</span><span>Score</span><span /></div>');
  });
});
