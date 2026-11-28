// Local throwaway TiDB only (QUALITY_TEST_DB=mysql://root@127.0.0.1:<port>/<db>); skipped otherwise. Fictional rows.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
import {
  applyQualityIncidentAction, attributionChoices, listQualityIncidents, processQualityIncident, readWeekIncidents, recordQualitySignal, type QualitySignal,
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
  it("uncertain attribution goes to staff, who can choose the visit", async () => {
    const two = await recordQualitySignal(pool, sms("m7", "+12025550133"), AT);
    const row = await get(two.id);
    expect(row).toMatchObject({ leadflowJobId: null, teamId: null, attribution: "needs_review" });
    expect(row.attributionNote).toMatch(/2 possible visits/);
    const choices = await attributionChoices(pool, two.id);
    expect(choices.map(c => [c.leadflowJobId, c.teamId])).toEqual([[1004, 2], [1003, 1]]);
    const fixed = await applyQualityIncidentAction(pool, { action: "attribute", id: two.id, leadflowJobId: 1004 }, 9, AT + HOUR);
    expect(fixed).toMatchObject({ leadflowJobId: 1004, teamId: 2, attribution: "staff", updatedBy: 9 });
    // Today's job with no sign-off has not happened yet; a cancelled visit is never the one complained about.
    expect(await get((await recordQualitySignal(pool, sms("m8", "+12025550144"), AT)).id)).toMatchObject({ attribution: "needs_review", leadflowJobId: null });
    expect(await get((await recordQualitySignal(pool, sms("m9", "+12025550166"), AT)).id)).toMatchObject({ attribution: "needs_review", leadflowJobId: null });
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
    expect((snapshot as any).reviewMetadata.warnings.join(" ")).toMatch(/listed for staff review/);
    expect(new Set(snapshot.publication.ownIncidents.map(i => i.id)).size).toBe(snapshot.publication.ownIncidents.length);
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
