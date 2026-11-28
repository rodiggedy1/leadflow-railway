// Local throwaway TiDB only (QUALITY_TEST_DB=mysql://root@127.0.0.1:<port>/<db>); skipped otherwise. Fictional rows.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
import {
  applyQualityIncidentAction, attributionChoices, listQualityIncidents, processQualityIncident, readWeekIncidents, recordQualitySignal, refreshQualityWeek, type QualitySignal,
} from "./teamQualityIncidents";
import { saveQualitySignalInBackground, setQualitySignalPoolForTests } from "./teamQualitySignals";
import { buildTeamWeekPublicationFromIncidents, type TeamWeekCounts } from "./teamLeaderboardHistoryMetrics";
import { countsAgainstTeam } from "../shared/teamQualityIncidents";
import { TEAM_SCORE_METRICS } from "../shared/teamLeaderboard";

const url = process.env.QUALITY_TEST_DB ?? "";
const local = /^mysql:\/\/[^@]+@127\.0\.0\.1:\d+\/\w+$/.test(url);
const AT = Date.parse("2026-11-24T15:00:00Z"); // Tuesday 10:00 Eastern; report week starts Sunday 2026-11-22
const HOUR = 3600_000;
let pool: mysql.Pool;
const sms = (key: string, phone: string, change: Partial<QualitySignal> = {}): QualitySignal => ({ sourceKey: `sms:${key}`, channel: "sms", detector: "claude_sms",
  reportedAtMs: AT, customerPhone: phone, evidenceQuote: "The bathroom was not cleaned", evidenceText: "The bathroom was not cleaned at all.",
  category: "cleaning_quality", severity: "medium", ...change });
const get = async (id: number) => (await pool.query("SELECT * FROM team_quality_incidents WHERE id = ?", [id]) as any)[0][0];

describe.skipIf(!local)("quality records against a local database (fictional rows)", () => {
  beforeAll(async () => {
    pool = mysql.createPool({ uri: url, connectionLimit: 4 });
    await pool.query("INSERT INTO scheduling_teams (id, name, launch27TeamId, isActive) VALUES (1, 'Team Alba (Test)', 101, 1), (2, 'Team Bravo (Test)', 102, 1)");
    await pool.query(`INSERT INTO leadflow_jobs (id, origin, bookingId, launch27BookingId, jobDate, bookingStatus, teamId, customerName, customerPhone, customerEmail) VALUES
      (1001, 'launch27_import', NULL, 9001, '2026-11-23', 'completed', 101, 'Test A', '+12025550111', NULL),
      (1002, 'native_booking', 77, NULL, '2026-11-22', 'assigned', 2, 'Test B', '(202) 555-0122', NULL),
      (1003, 'native_booking', 78, NULL, '2026-11-20', 'assigned', 1, 'Test C', '+12025550133', NULL),
      (1004, 'launch27_import', NULL, 9004, '2026-11-23', 'completed', 102, 'Test C', '+12025550133', NULL),
      (1005, 'native_booking', 79, NULL, '2026-11-24', 'assigned', 1, 'Test D', '+12025550144', NULL),
      (1006, 'native_booking', 80, NULL, '2026-11-21', 'assigned', 1, 'Test E', NULL, 'customer.e@example.invalid'),
      (1007, 'native_booking', 81, NULL, '2026-11-23', 'cancelled', 2, 'Test F', '+12025550166', NULL)`);
  });
  afterAll(async () => { setQualitySignalPoolForTests(null); await pool?.end(); });

  it("saves once per message and matches a Launch27 job to its team", async () => {
    const first = await recordQualitySignal(pool, sms("m1", "+12025550111"), AT);
    expect(first).toMatchObject({ duplicate: false, processed: true });
    expect(await get(first.id)).toMatchObject({ leadflowJobId: 1001, teamId: 1, attribution: "auto", processingStatus: "ok", weekStart: "2026-11-22", primaryId: null });
    const again = await recordQualitySignal(pool, sms("m1", "+12025550111"), AT + 1000);
    expect(again).toEqual({ id: first.id, duplicate: true, processed: false });
    expect((await pool.query("SELECT COUNT(*) AS n FROM team_quality_incidents WHERE sourceKey = 'sms:m1'") as any)[0][0].n).toBe(1);
  });
  it("further messages about the same visit join the open incident; an office issue stays separate", async () => {
    const [primary] = (await pool.query("SELECT id FROM team_quality_incidents WHERE sourceKey = 'sms:m1'") as any)[0];
    const email = await recordQualitySignal(pool, { ...sms("x", "+12025550111"), sourceKey: "review:e1", channel: "review", detector: "weekly_review", reportedAtMs: AT + HOUR, severity: "high", recleanRequested: true }, AT + HOUR);
    const conduct = await recordQualitySignal(pool, sms("m2", "+12025550111", { category: "team_service", reportedAtMs: AT + 2 * HOUR }), AT + 2 * HOUR);
    const office = await recordQualitySignal(pool, sms("m3", "+12025550111", { category: "office_service", reportedAtMs: AT + 3 * HOUR }), AT + 3 * HOUR);
    expect((await get(email.id)).primaryId).toBe(primary.id);
    expect((await get(conduct.id)).primaryId).toBe(primary.id);
    expect((await get(office.id)).primaryId).toBeNull();
    // The incident takes the highest severity and the reclean request, but still counts once.
    expect(await get(primary.id)).toMatchObject({ severity: "high", recleanStatus: "requested" });
  });
  it("a new complaint after the incident is resolved is a separate complaint", async () => {
    const [primary] = (await pool.query("SELECT id FROM team_quality_incidents WHERE sourceKey = 'sms:m1'") as any)[0];
    await applyQualityIncidentAction(pool, { action: "resolve", id: primary.id, note: "Reclean done" }, 9, AT + 4 * HOUR);
    const later = await recordQualitySignal(pool, sms("m4", "+12025550111", { reportedAtMs: AT + 30 * HOUR }), AT + 30 * HOUR);
    expect((await get(later.id)).primaryId).toBeNull();
    expect(await get(later.id)).toMatchObject({ leadflowJobId: 1001, teamId: 1 });
  });
  it("matches a native job by a differently formatted phone, and by email", async () => {
    const native = await recordQualitySignal(pool, sms("m5", "+12025550122"), AT);
    expect(await get(native.id)).toMatchObject({ leadflowJobId: 1002, teamId: 2, attribution: "auto" });
    const byEmail = await recordQualitySignal(pool, { ...sms("m6", ""), customerPhone: null, customerEmail: "Customer.E@example.invalid" }, AT);
    expect(await get(byEmail.id)).toMatchObject({ leadflowJobId: 1006, teamId: 1, attribution: "auto" });
  });
  it("with several recent visits, the most recent completed one is chosen automatically (staff override optional)", async () => {
    const two = await recordQualitySignal(pool, sms("m7", "+12025550133"), AT);
    const row = await get(two.id);
    expect(row).toMatchObject({ leadflowJobId: 1004, teamId: 2, attribution: "auto" });
    expect(row.attributionNote).toBe("Matched the most recent completed visit, 2026-11-23 (of 2 in the last 7 days).");
    // Optional override: staff can move it, and moving it back leaves it as staff-set (never re-matched automatically).
    const choices = await attributionChoices(pool, two.id);
    expect(choices.map(c => [c.leadflowJobId, c.teamId])).toEqual([[1004, 2], [1003, 1]]);
    expect(await applyQualityIncidentAction(pool, { action: "attribute", id: two.id, leadflowJobId: 1003 }, 9, AT + HOUR)).toMatchObject({ leadflowJobId: 1003, teamId: 1, attribution: "staff" });
    expect(await applyQualityIncidentAction(pool, { action: "attribute", id: two.id, leadflowJobId: 1004 }, 9, AT + HOUR)).toMatchObject({ leadflowJobId: 1004, teamId: 2, attribution: "staff", updatedBy: 9 });
    // A named visit date wins over "most recent".
    const named = await recordQualitySignal(pool, sms("m7b", "+12025550133", { serviceDateHint: "2026-11-20", category: "office_service" }), AT);
    expect(await get(named.id)).toMatchObject({ leadflowJobId: 1003, teamId: 1, attribution: "auto" });
    await applyQualityIncidentAction(pool, { action: "dismiss", id: named.id, note: "test cleanup" }, 9);
    // Today's job with no sign-off has not happened yet; a cancelled visit is never the one complained about.
    expect(await get((await recordQualitySignal(pool, sms("m8", "+12025550144"), AT)).id)).toMatchObject({ attribution: "unattributed", leadflowJobId: null });
    expect(await get((await recordQualitySignal(pool, sms("m9", "+12025550166"), AT)).id)).toMatchObject({ attribution: "unattributed", leadflowJobId: null });
  });
  it("staff can dismiss, restore, separate and merge", async () => {
    const [m2] = (await pool.query("SELECT id, primaryId FROM team_quality_incidents WHERE sourceKey = 'sms:m2'") as any)[0];
    const separated = await applyQualityIncidentAction(pool, { action: "separate", id: m2.id }, 9, AT + 5 * HOUR);
    expect(separated.primaryId).toBeNull();
    await expect(applyQualityIncidentAction(pool, { action: "separate", id: m2.id }, 9)).rejects.toThrow("QUALITY_INCIDENT_ALREADY_SEPARATE");
    const merged = await applyQualityIncidentAction(pool, { action: "merge", id: m2.id, intoId: m2.primaryId }, 9, AT + 6 * HOUR);
    expect(merged.primaryId).toBe(m2.primaryId);
    const [m3] = (await pool.query("SELECT id FROM team_quality_incidents WHERE sourceKey = 'sms:m3'") as any)[0];
    expect((await applyQualityIncidentAction(pool, { action: "dismiss", id: m3.id, note: "Not about the team" }, 9)).status).toBe("dismissed");
    expect((await applyQualityIncidentAction(pool, { action: "restore", id: m3.id }, 9)).status).toBe("open");
    await applyQualityIncidentAction(pool, { action: "dismiss", id: m3.id, note: "Not about the team" }, 9);
    await expect(applyQualityIncidentAction(pool, { action: "dismiss", id: merged.id, note: "x" }, 9)).rejects.toThrow("QUALITY_INCIDENT_NOT_PRIMARY");
  });
  it("a processing failure is saved as visible and retrying fixes it without re-sending anything", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await pool.query("RENAME TABLE scheduling_teams TO scheduling_teams_hidden");
    let failed;
    try { failed = await recordQualitySignal(pool, sms("m10", "+12025550111", { reportedAtMs: AT + 40 * HOUR }), AT + 40 * HOUR); }
    finally { await pool.query("RENAME TABLE scheduling_teams_hidden TO scheduling_teams"); }
    expect(failed).toMatchObject({ duplicate: false, processed: false });
    expect(await get(failed!.id)).toMatchObject({ processingStatus: "failed", processingError: "QUALITY_PROCESSING_FAILED", processingAttempts: 1 });
    expect((await listQualityIncidents(pool, "2026-11-22")).unprocessed.map(row => row.id)).toContain(failed!.id);
    const retried = await processQualityIncident(pool, failed!.id, AT + 41 * HOUR);
    expect(retried).toMatchObject({ processingStatus: "ok", processingError: null, processingAttempts: 2, leadflowJobId: 1001 });
    expect((await listQualityIncidents(pool, "2026-11-22")).unprocessed.map(row => row.id)).not.toContain(failed!.id);
  });
  it("the week's scores come from saved records: one count per incident, refund-only and office issues never count", async () => {
    await recordQualitySignal(pool, { sourceKey: "email:thread:t1", channel: "email", detector: "gmail_glance", reportedAtMs: AT, customerPhone: "+12025550122",
      evidenceText: "Customer asks for a refund", category: "unclassified", severity: "medium", refundRequested: true }, AT);
    const incidents = await readWeekIncidents(pool, "2026-11-22");
    const counted = incidents.filter(countsAgainstTeam);
    const team = (id: string, jobs: number) => ({ id, name: `Team ${id}`, eligibleJobs: jobs,
      metrics: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, { successful: jobs, eligible: jobs, complete: true }])) as any });
    const counts: TeamWeekCounts = { period: { weekStart: "2026-11-22", weekEnd: "2026-11-28", weekConvention: "Sunday-start", coverageStart: "2026-11-22", coverageEnd: "2026-11-24" },
      teams: [team("1", 10), team("2", 10)], complete: true, warnings: [] };
    const snapshot = buildTeamWeekPublicationFromIncidents(counts, incidents);
    const cases = (id: string) => snapshot.details[id].complaintCases;
    expect(cases("1")).toBe(counted.filter(i => i.teamId === 1).length);
    expect(cases("2")).toBe(counted.filter(i => i.teamId === 2).length);
    // Alba: the resolved incident (several messages, counted once) + the later separate complaint (the retried message about
    // the same visit joined it while it was open, so it does not count again) + the email-matched visit.
    expect(cases("1")).toBe(3);
    const [m10] = (await pool.query("SELECT primaryId FROM team_quality_incidents WHERE sourceKey = 'sms:m10'") as any)[0];
    const [m4] = (await pool.query("SELECT id FROM team_quality_incidents WHERE sourceKey = 'sms:m4'") as any)[0];
    expect(m10.primaryId).toBe(m4.id);
    // Bravo: the native-job complaint + the staff-attributed visit; the refund-only email is listed for staff only.
    expect(cases("2")).toBe(2);
    expect(snapshot.publication.teams.find(t => t.id === "1")!.metrics.complaints).toEqual({ successful: 7, eligible: 10, complete: true });
    expect((snapshot as any).reviewMetadata.warnings.join(" ")).toMatch(/not counted against a team automatically/);
    expect(new Set(snapshot.publication.ownIncidents.map(i => i.id)).size).toBe(snapshot.publication.ownIncidents.length);
  });
  describe("automatic workflow (week of 2026-11-29, no staff steps)", () => {
    const AT2 = Date.parse("2026-12-01T15:00:00Z"), WEEK = "2026-11-29";
    const signal = (key: string, phone: string | null, change: Partial<QualitySignal> = {}): QualitySignal => ({ ...sms(key, phone ?? ""), customerPhone: phone, reportedAtMs: AT2, ...change });
    beforeAll(async () => {
      await pool.query(`INSERT INTO leadflow_jobs (id, origin, bookingId, launch27BookingId, jobDate, bookingStatus, teamId, customerName, customerPhone, serviceName, jobTotalCents) VALUES
        (2001, 'launch27_import', NULL, 9101, '2026-11-30', 'completed', 101, 'Test G', '+12025550211', 'Standard Cleaning', 18000),
        (2002, 'native_booking', 91, NULL, '2026-11-30', 'assigned', 2, 'Test H', '+12025550222', 'Standard Cleaning', 16000),
        (2003, 'native_booking', 92, NULL, '2026-12-01', 'assigned', 1, 'Test I', '+12025550233', 'Standard Cleaning', 16000),
        (2004, 'native_booking', 93, NULL, '2026-12-03', 'completed', 1, 'Test G', '+12025550211', 'Re-clean', 0),
        (2005, 'native_booking', 94, NULL, '2026-11-30', 'assigned', 2, 'Test J', '+12025550255', 'Standard Cleaning', 16000)`);
    });
    it("the AI's category replaces a rule-based one for the same visit, and they count once", async () => {
      const voice = await recordQualitySignal(pool, signal("v1", "+12025550222", { sourceKey: "call:callback:501", channel: "call", detector: "vapi_complaint_tool", category: "cleaning_quality" }), AT2);
      const ai = await recordQualitySignal(pool, signal("a1", "+12025550222", { category: "pricing_billing", reportedAtMs: AT2 + HOUR }), AT2 + HOUR);
      expect((await get(ai.id)).primaryId).toBe(voice.id);
      expect(await get(voice.id)).toMatchObject({ category: "pricing_billing", leadflowJobId: 2002, teamId: 2 });
    });
    it("a low rating joins the AI complaint about the same visit; a sign-off 'issue' counts on its own", async () => {
      const complaint = await recordQualitySignal(pool, signal("a2", "+12025550211"), AT2);
      const rating = await recordQualitySignal(pool, { sourceKey: "rating:job:2001", channel: "rating", detector: "portal_rating", reportedAtMs: AT2 + HOUR, leadflowJobId: 2001, category: "unclassified", severity: "high", evidenceText: "Customer rated the visit 1 of 5." }, AT2 + HOUR);
      expect((await get(rating.id)).primaryId).toBe(complaint.id);
      expect(await get(complaint.id)).toMatchObject({ category: "cleaning_quality", severity: "high", teamId: 1 });
      const signoff = await recordQualitySignal(pool, { sourceKey: "signoff:job:2005", channel: "signoff", detector: "cleaner_signoff", reportedAtMs: AT2, leadflowJobId: 2005, category: "cleaning_quality", severity: "medium", evidenceText: "Sign-off customer response: issue" }, AT2);
      expect(await get(signoff.id)).toMatchObject({ primaryId: null, leadflowJobId: 2005, teamId: 2, attribution: "auto", category: "cleaning_quality" });
    });
    it("recalculating the week retries failures, re-matches a complaint once its visit is completed, and finds completed recleans", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const early = await recordQualitySignal(pool, signal("a3", "+12025550233"), AT2);
      expect(await get(early.id)).toMatchObject({ attribution: "unattributed", leadflowJobId: null });
      await pool.query("RENAME TABLE scheduling_teams TO scheduling_teams_hidden");
      let failed;
      try { failed = await recordQualitySignal(pool, signal("a4", "+12025550211", { reportedAtMs: AT2 + 2 * HOUR }), AT2 + 2 * HOUR); }
      finally { await pool.query("RENAME TABLE scheduling_teams_hidden TO scheduling_teams"); }
      expect(await get(failed!.id)).toMatchObject({ processingStatus: "failed" });
      // The visit dated today is signed off later that day.
      await pool.query("INSERT INTO cleaner_portal_job_signoffs (leadflowJobId, cleanerProfileId, teamId, customerResponse, customerNotHome, signedOffAt, createdAt, updatedAt) VALUES (2003, 1, 1, 'great', 0, NOW(), NOW(), NOW())");
      const summary = await refreshQualityWeek(pool, WEEK, Date.parse("2026-12-04T15:00:00Z"));
      expect(summary).toMatchObject({ retried: 1, reattributed: 1, recleans: 1 });
      expect(await get(early.id)).toMatchObject({ attribution: "auto", leadflowJobId: 2003, teamId: 1 });
      const [complaint] = (await pool.query("SELECT id FROM team_quality_incidents WHERE sourceKey = 'sms:a2'") as any)[0];
      expect(await get(failed!.id)).toMatchObject({ processingStatus: "ok", primaryId: complaint.id });
      expect(await get(complaint.id)).toMatchObject({ recleanStatus: "completed" });
      expect((await get(complaint.id)).statusNote).toMatch(/Reclean visit detected automatically: job 2004 on 2026-12-03/);
      // Running it again changes nothing.
      expect(await refreshQualityWeek(pool, WEEK, Date.parse("2026-12-04T15:00:00Z"))).toEqual({ retried: 0, reattributed: 0, recleans: 0 });
    });
    it("the week's scores follow automatically from the records", async () => {
      const incidents = await readWeekIncidents(pool, WEEK);
      const team = (id: string, jobs: number) => ({ id, name: `Team ${id}`, eligibleJobs: jobs,
        metrics: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, { successful: jobs, eligible: jobs, complete: true }])) as any });
      const snapshot = buildTeamWeekPublicationFromIncidents({ period: { weekStart: WEEK, weekEnd: "2026-12-05", weekConvention: "Sunday-start", coverageStart: WEEK, coverageEnd: "2026-12-04" },
        teams: [team("1", 5), team("2", 5)], complete: true, warnings: [] }, incidents);
      // Alba: the AI complaint (+ rating + retried message, counted once, reclean completed) and the re-matched one.
      expect(snapshot.details["1"]).toMatchObject({ complaintCases: 2, confirmedRecoveryCases: 1 });
      // Bravo: the sign-off issue; the billing complaint is not the team's responsibility.
      expect(snapshot.details["2"]).toMatchObject({ complaintCases: 1, confirmedRecoveryCases: 0 });
    });
  });
  it("background saving retries a temporary failure and never throws", async () => {
    let calls = 0;
    setQualitySignalPoolForTests(async () => { calls++; if (calls === 1) throw new Error("QUALITY_DB_UNAVAILABLE"); return pool; }, 5);
    await expect(saveQualitySignalInBackground(sms("bg1", "+12025550111"))).resolves.toBe("saved");
    expect(calls).toBe(2);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setQualitySignalPoolForTests(async () => null, 5);
    await expect(saveQualitySignalInBackground(sms("bg2", "+12025550111"))).resolves.toBe("failed");
    expect(error.mock.calls.flat().join(" ")).toMatch(/could not save sms signal sms:bg2 after 3 attempts \(QUALITY_DB_UNAVAILABLE\); customer communication unaffected/);
  });
});
