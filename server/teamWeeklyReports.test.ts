// Phase 3 team weekly reports: offline, fictional teams, simulated SMS. No AI, no network.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildTeamReportMessage, complaintAreas, reportLanguage, type TeamReportFacts } from "../shared/teamWeeklyReport";
import { previewTeamReports, sendTeamReports, PENDING_UNCERTAIN_MS, type ReportDeps, type ReportRow, type ReportWeek } from "./teamWeeklyReports";
import { TEAM_SCORE_METRICS } from "../shared/teamLeaderboard";
import { normalizePhone } from "./utils/phone";

const m = (successful: number, eligible: number) => ({ successful, eligible, complete: true });
const row = (id: string, name: string, jobs: number, over: Partial<Record<string, ReturnType<typeof m>>> = {}) => ({ id, name, eligibleJobs: jobs,
  metrics: { ...Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, m(jobs, jobs)])), ...over } as never });
const incident = (id: number, teamId: number, text: string, change: Record<string, unknown> = {}) => ({ id, teamId, leadflowJobId: 500 + id, category: "cleaning_quality",
  attribution: "auto", status: "open", recleanStatus: "none", refundStatus: "none", processingStatus: "ok", evidenceQuote: text, evidenceText: null,
  jobDate: "2026-11-24", reportedAtMs: Date.parse("2026-11-24T20:00:00Z"), customerName: "Maya Lane", customerPhone: "+13025550147", ...change });
function week(change: Partial<ReportWeek> = {}): ReportWeek {
  return {
    weekEnd: "2026-11-28",
    teams: [row("1", "Team Alba", 10, { ratings: m(8, 9), eta: m(9, 10) }), row("2", "Team Brisa", 8), row("3", "Team Cielo", 5), row("4", "Team Duna", 2), row("5", "Team Eco", 0)],
    details: { "1": { complaintCases: 2 }, "2": { complaintCases: 0 }, "3": { complaintCases: 0 }, "4": { complaintCases: 0 } },
    teamAccounts: { "1": { cleanerProfileId: 11 }, "2": { cleanerProfileId: 12 }, "3": { cleanerProfileId: 13 }, "4": { cleanerProfileId: null, reason: "missing_cleaner_account" }, "5": { cleanerProfileId: 15 } },
    provisionalReason: null,
    incidents: [incident(1, 1, "The kitchen floor is still sticky"), incident(2, 1, "They missed the upstairs bathroom", { jobDate: "2026-11-26" }),
      incident(3, 1, "The cleaners arrived two hours late"), incident(4, 2, "Bill was wrong", { category: "pricing_billing" })] as never,
    ...change,
  };
}
function deps(change: Partial<ReportDeps> = {}, w = week()) {
  const rows: ReportRow[] = [];
  let clock = Date.parse("2026-11-29T14:00:00Z");
  const sent: Array<{ to: string; content: string }> = [];
  const d: ReportDeps = {
    readWeek: vi.fn(async () => w),
    readProfiles: vi.fn(async () => [
      { id: 11, phone: "(302) 555-0111", language: "en", isActive: 1 }, { id: 12, phone: "+13025550112", language: "es", isActive: 1 },
      { id: 13, phone: "555", language: "en", isActive: 1 }, { id: 15, phone: "+13025550115", language: "en", isActive: 1 }]),
    store: {
      list: async () => rows.map(r => ({ ...r })),
      reserve: async r => { if (rows.some(x => x.weekStart === r.weekStart && x.teamId === r.teamId && x.attempt === r.attempt)) return "duplicate"; rows.push({ ...r, id: rows.length + 1 }); return rows.length; },
      finish: async (id, o) => { const x = rows.find(r => r.id === id)!; if (x.status !== "pending") return; Object.assign(x, { status: o.status, error: o.error, providerMessageId: o.providerMessageId, updatedAtMs: o.atMs, sentAtMs: o.status === "sent" ? o.atMs : null }); },
    },
    sendSms: vi.fn(async (input: { to: string; content: string }) => { sent.push(input); return { success: true, messageId: `SIM-${sent.length}` }; }),
    normalizePhone, now: () => (clock += 1000),
    ...change,
  };
  return { d, rows, sent, advance: (ms: number) => { clock += ms; } };
}

const facts = (change: Partial<TeamReportFacts> = {}): TeamReportFacts => ({ teamName: "Team Alba", weekStart: "2026-11-22", weekEnd: "2026-11-28", rank: 2, rankedTeams: 3, unranked: false,
  score: 87.456, completedJobs: 10, ratings: { successful: 8, eligible: 9 }, eta: { successful: 9, eligible: 10 }, photos: { successful: 10, eligible: 10 },
  complaintCount: 2, complaints: [{ date: "2026-11-24", areas: ["kitchen", "floors"] }, { date: "2026-11-26", areas: ["bathroom", "missed areas"] }], provisional: false, ...change });

describe("report text", () => {
  it("English: ranking, score, jobs, five-star, complaints with a short breakdown, ETA, photos and what to improve", () => {
    const text = buildTeamReportMessage(facts(), "en");
    expect(text).toBe([
      "Maids in Black weekly report for Team Alba (Nov 22–28)",
      "Ranking: #2 of 3", "Overall score: 87.5 / 100", "Completed jobs: 10", "Five-star ratings: 8 of 9 (89%)",
      "Cleaning complaints: 2 (Tue Nov 24: kitchen, floors; Thu Nov 26: bathroom, missed areas)",
      "ETA texts sent: 9 of 10 (90%)", "Photos: 10 of 10 (100%)",
      "To improve: Cleaning quality (kitchen, floors, bathroom): do a final walk-through before leaving. Send the ETA text before every job. Aim for more five-star ratings.",
      "Thank you for your hard work!"].join("\n"));
    expect(text.length).toBeLessThan(700);
  });
  it("Spanish", () => {
    const text = buildTeamReportMessage(facts(), "es");
    expect(text).toContain("Maids in Black: informe semanal de Team Alba (22–28 nov)");
    expect(text).toContain("Posición: #2 de 3");
    expect(text).toContain("Quejas de limpieza: 2 (mar 24 nov: cocina, pisos; jue 26 nov: baño, áreas olvidadas)");
    expect(text).toContain("Envíen el mensaje de llegada (ETA) antes de cada trabajo.");
    expect(text).toContain("¡Gracias por su trabajo!");
  });
  it("provisional reports say so at the top, in both languages", () => {
    expect(buildTeamReportMessage(facts({ provisional: true }), "en").split("\n")[0]).toBe("PRELIMINARY: this week's review isn't finished yet, so these numbers may change.");
    expect(buildTeamReportMessage(facts({ provisional: true }), "es").split("\n")[0]).toContain("PRELIMINAR");
  });
  it("unranked team, no complaints, perfect week", () => {
    const text = buildTeamReportMessage(facts({ rank: null, unranked: true, complaintCount: 0, complaints: [], ratings: { successful: 2, eligible: 2 }, eta: { successful: 2, eligible: 2 },
      photos: { successful: 2, eligible: 2 }, completedJobs: 2 }), "en");
    expect(text).toContain("Ranking: not ranked (fewer than 3 jobs)");
    expect(text).toContain("Cleaning complaints: 0\n");
    expect(text).toContain("Great week, keep it up!");
  });
  it("complaint areas come from words only; the complaint text itself is never used", () => {
    expect(complaintAreas("The kitchen floor is still sticky")).toEqual(["kitchen", "floors"]);
    expect(complaintAreas("No limpiaron el baño")).toEqual(["bathroom", "missed areas"]);
    expect(complaintAreas("Not happy")).toEqual([]);
    expect(reportLanguage("es")).toBe("es"); expect(reportLanguage("pt")).toBe("en"); expect(reportLanguage(null)).toBe("en");
  });
});

describe("preview", () => {
  it("every team with jobs, its message, language, masked phone, and clear issues; no customer data", async () => {
    const { d } = deps();
    const view = await previewTeamReports(d, "2026-11-22");
    expect(view.teams.map(t => t.teamName)).toEqual(["Team Brisa", "Team Cielo", "Team Alba", "Team Duna"]); // ranked order; no-jobs team left out
    const alba = view.teams.find(t => t.teamId === "1")!, brisa = view.teams.find(t => t.teamId === "2")!;
    expect(alba).toMatchObject({ language: "en", phone: "+13025550111", phoneMasked: "•••• 0111", issue: null, complaintCount: 2, latest: null, rank: 3 });
    expect(alba.message).toContain("Cleaning complaints: 2 (Tue Nov 24: kitchen, floors; Thu Nov 26: bathroom, missed areas)"); // late arrival not counted
    expect(brisa.language).toBe("es"); expect(brisa.message).toContain("Quejas de limpieza: 0");
    for (const team of view.teams) expect(team.message).not.toMatch(/Maya|Lane|0147|sticky|upstairs|arrived|Bill/);
    expect(view.teams.find(t => t.teamId === "3")!.issue).toBe("The team account's phone number is not a valid US mobile number.");
    expect(view.teams.find(t => t.teamId === "4")!.issue).toBe("No team account is linked to this team.");
    expect(view.provisional).toBe(false);
  });
  it("provisional week: flagged and the messages say PRELIMINARY", async () => {
    const { d } = deps({}, week({ provisionalReason: "The week's complaint analysis is not complete." }));
    const view = await previewTeamReports(d, "2026-11-22");
    expect(view).toMatchObject({ provisional: true, provisionalReason: "The week's complaint analysis is not complete." });
    expect(view.teams.every(t => t.message.startsWith("PRELIMINARY") || t.message.startsWith("PRELIMINAR"))).toBe(true);
  });
  it("is read-only: nothing is sent or saved", async () => {
    const { d, rows, sent } = deps();
    await previewTeamReports(d, "2026-11-22");
    expect(sent).toEqual([]); expect(rows).toEqual([]);
  });
});

describe("sending", () => {
  it("sends the selected teams once each; teams without a valid phone are skipped without blocking others", async () => {
    const { d, rows, sent } = deps();
    const outcomes = await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["3", "1", "4", "2"], resend: false }, 7);
    expect(outcomes.map(o => [o.teamName, o.result])).toEqual([["Team Cielo", "skipped_no_phone"], ["Team Alba", "sent"], ["Team Duna", "skipped_no_phone"], ["Team Brisa", "sent"]]);
    expect(sent.map(s => s.to)).toEqual(["+13025550111", "+13025550112"]);
    expect(sent[1].content).toContain("informe semanal");
    expect(rows.map(r => [r.teamId, r.attempt, r.status, r.requestedBy, r.sentAtMs !== null])).toEqual([[1, 1, "sent", 7, true], [2, 1, "sent", 7, true]]);
    expect(rows[0].messageText).toBe(sent[0].content);
    const view = await previewTeamReports(d, "2026-11-22");
    expect(view.teams.find(t => t.teamId === "1")!.latest).toMatchObject({ status: "sent", attempt: 1 });
  });
  it("no accidental duplicates: sending again (or two clicks) skips teams already sent", async () => {
    const { d, sent } = deps();
    await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7);
    const again = await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1", "1"], resend: false }, 8);
    expect(again).toEqual([{ teamId: "1", teamName: "Team Alba", result: "skipped_already_sent", detail: null }]);
    expect(sent).toHaveLength(1);
  });
  it("two staff members at the same moment: only one send happens", async () => {
    const { d, sent } = deps();
    const [a, b] = await Promise.all([1, 2].map(agent => sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, agent)));
    expect([a[0].result, b[0].result].sort()).toEqual(["sent", "skipped_in_progress"]);
    expect(sent).toHaveLength(1);
  });
  it("intentional resend is a new attempt", async () => {
    const { d, rows, sent } = deps();
    await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7);
    expect((await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: true, seenAttempts: 1 }, 7))[0].result).toBe("sent");
    expect(rows.map(r => r.attempt)).toEqual([1, 2]); expect(sent).toHaveLength(2);
  });
  it("two Resend clicks (or two staff) for the same report: one text only, even when the first finished before the second started", async () => {
    const { d, rows, sent } = deps();
    await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7);
    const [a, b] = await Promise.all([1, 2].map(agent => sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: true, seenAttempts: 1 }, agent)));
    expect([a[0].result, b[0].result].sort()).toEqual(["sent", "skipped_in_progress"]);
    const later = await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: true, seenAttempts: 1 }, 3); // stale screen
    expect(later[0]).toMatchObject({ result: "skipped_in_progress", detail: "This report was just sent again by someone else. Check its status first." });
    expect(sent).toHaveLength(2); expect(rows.map(r => r.attempt)).toEqual([1, 2]);
  });
  it("a resend must name one team and the attempt that was seen", async () => {
    const { sendTeamReportsInputSchema } = await import("../shared/teamWeeklyReport");
    expect(sendTeamReportsInputSchema.safeParse({ weekStart: "2026-11-22", teamIds: ["1"], resend: true }).success).toBe(false);
    expect(sendTeamReportsInputSchema.safeParse({ weekStart: "2026-11-22", teamIds: ["1", "2"], resend: true, seenAttempts: 1 }).success).toBe(false);
    expect(sendTeamReportsInputSchema.safeParse({ weekStart: "2026-11-22", teamIds: ["1"], resend: true, seenAttempts: 1 }).success).toBe(true);
    expect(sendTeamReportsInputSchema.safeParse({ weekStart: "2026-11-22", teamIds: ["1", "2"], resend: false }).success).toBe(true);
  });
  it("a failed send is recorded with its reason, does not stop the next team, and can simply be sent again", async () => {
    const { d, rows, sent } = deps({ sendSms: vi.fn(async ({ to }) => to.endsWith("0111") ? { success: false, error: "OpenPhone API returned 500" } : { success: true, messageId: "SIM" }) });
    const outcomes = await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1", "2"], resend: false }, 7);
    expect(outcomes.map(o => o.result)).toEqual(["failed", "sent"]);
    expect(rows[0]).toMatchObject({ status: "failed", error: "OpenPhone API returned 500", sentAtMs: null });
    expect((await previewTeamReports(d, "2026-11-22")).teams.find(t => t.teamId === "1")!.latest).toMatchObject({ status: "failed", error: "OpenPhone API returned 500" });
    d.sendSms = vi.fn(async () => ({ success: true, messageId: "SIM-2" }));
    expect((await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7))[0].result).toBe("sent");
    expect(rows.filter(r => r.teamId === 1).map(r => r.status)).toEqual(["failed", "sent"]);
    void sent;
  });
  it("an interrupted send stays pending, then shows 'may have been sent' and is never resent without Resend", async () => {
    const { d, rows, advance } = deps();
    d.store.finish = async () => { throw new Error("database went away"); };
    expect((await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7))[0].result).toBe("sent");
    expect(rows[0].status).toBe("pending");
    expect((await previewTeamReports(d, "2026-11-22")).teams.find(t => t.teamId === "1")!.latest!.status).toBe("pending");
    expect((await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: true, seenAttempts: 1 }, 7))[0].result).toBe("skipped_in_progress"); // still fresh
    advance(PENDING_UNCERTAIN_MS + 1000);
    expect((await previewTeamReports(d, "2026-11-22")).teams.find(t => t.teamId === "1")!.latest!.status).toBe("uncertain");
    expect((await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["1"], resend: false }, 7))[0].result).toBe("skipped_pending");
  });
  it("an SMS error thrown by the sender is a failure, not a crash", async () => {
    const { d, rows } = deps({ sendSms: vi.fn(async () => { throw new Error("network down"); }) });
    expect((await sendTeamReports(d, { weekStart: "2026-11-22", teamIds: ["2"], resend: false }, 7))[0]).toMatchObject({ result: "failed", detail: "network down" });
    expect(rows[0].status).toBe("failed");
  });
});

describe("scope", () => {
  const source = readFileSync("server/teamWeeklyReports.ts", "utf8") + readFileSync("shared/teamWeeklyReport.ts", "utf8");
  it("no AI, no schedule: reports are built from saved standings and quality records and sent only on request", () => {
    expect(source).not.toMatch(/anthropic|claudeAgentClient|runInitialLeadDraft|invokeLLM|cron|setInterval|setTimeout/i);
    const router = readFileSync("server/teamLeaderboardHistoryRouter.ts", "utf8");
    expect(router).toContain("sendTeamReports: admin.input(sendTeamReportsInputSchema).mutation(");
    expect(router).toContain("teamReports: admin.input(teamEvidenceWeekInputSchema).query(");
    expect(readFileSync("server/internalCron.ts", "utf8")).not.toMatch(/teamWeeklyReports|sendTeamReports/);
  });
  it("migration 0084 is appended last with its exact SQL hash; it only creates the new table", async () => {
    const { createHash } = await import("node:crypto");
    const manifest = JSON.parse(readFileSync("server/versioned-migrations/manifest.json", "utf8"));
    const entry = manifest.migrations.at(-1);
    const sql = readFileSync(`server/versioned-migrations/${entry.sqlFile}`, "utf8");
    expect(entry).toMatchObject({ id: "0084_create_team_weekly_reports", mode: "create-table", replayMode: "verified-idempotent", sha256: createHash("sha256").update(sql).digest("hex") });
    expect(sql.replace(/--.*$/gm, "")).toMatch(/^\s*CREATE TABLE IF NOT EXISTS `team_weekly_reports`[^;]*;\s*$/);
    expect(sql).toContain("UNIQUE KEY team_weekly_reports_attempt (weekStart, teamId, attempt)");
  });
  it("scoring formula and complaint rules are untouched (same files as released)", () => {
    expect(source).toContain('import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores"');
    expect(source).toContain("countsAgainstTeam(incident)");
  });
});
