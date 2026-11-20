import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SelectPort, SqlRow, SqlValue } from "./instinct/readDb";
import type { TeamComplaintMatch, TeamComplaintVisitGroup } from "../shared/teamLeaderboardEvidence";
import type { TeamLeaderboardRow } from "../shared/teamLeaderboard";
import type { TeamLeaderboardSnapshot } from "./teamLeaderboardPublication";
import { calculateTeamScore } from "../shared/teamLeaderboard";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";
import { resolveTeamEvidenceWindow } from "./teamLeaderboardEvidenceWindow";
import { readTeamLeaderboardCounts, buildTeamWeekPublication, aggregateTeamPublications, type TeamWeekCounts, type TeamComplaintDecision } from "./teamLeaderboardHistoryMetrics";

const window = resolveTeamEvidenceWindow({ weekStart: "2026-11-15" }, new Date("2026-11-20T17:00:00Z"));
const clone = <T>(value: T): T => structuredClone(value);
const roster = (id = 1, launch27TeamId: number | null = 900): SqlRow => ({ id, name: `Synthetic team ${id}`, launch27TeamId });
const job = (id = 1, change: Record<string, unknown> = {}): SqlRow => ({ id, origin: "launch27_import", bookingId: null, launch27BookingId: 5000 + id, jobDate: "2026-11-17", bookingStatus: "assigned", teamId: 900, customerRating: null, ...change });
const eta = (id = 1, change: Record<string, unknown> = {}): SqlRow => ({ id, leadflowJobId: id, etaTimestamp: 0, ...change });
const photo = (id = 1, change: Record<string, unknown> = {}): SqlRow => ({ id, leadflowJobId: id, photoUrl: "saved-owned-photo", ...change });
class FakePort implements SelectPort {
  calls: Array<{ sql: string; params: readonly SqlValue[] }> = [];
  teams: SqlRow[] = [roster()]; jobs: SqlRow[] = [job()]; etas: SqlRow[] = [eta()]; photos: SqlRow[] = [photo()];
  fail: "teams" | "jobs" | "etas" | "photos" | null = null;
  failAfterCursor = -1;
  invalidPage: SqlRow[] | null = null;
  async select(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    this.calls.push({ sql, params });
    const kind = sql.includes("FROM `scheduling_teams`") ? "teams" : sql.includes("FROM `cleaner_portal_job_progress`") ? "etas" : sql.includes("FROM `cleaner_portal_job_photos`") ? "photos" : "jobs";
    if (this.fail === kind && Number(params[0]) >= this.failAfterCursor) throw new Error("synthetic unavailable");
    if (this.invalidPage && kind === "jobs") return this.invalidPage;
    const rows = this[kind];
    return rows.filter(row => Number(row.id) > Number(params[0])).slice(0, Number(params[params.length - 1]));
  }
}
function row(jobs = 10, id = "1", ratings = 2, stars = 1): TeamLeaderboardRow {
  return { id, name: `Synthetic team ${id}`, eligibleJobs: jobs, metrics: {
    ratings: { successful: stars, eligible: ratings, complete: true },
    complaints: { successful: 0, eligible: jobs, complete: false }, recovery: { successful: 0, eligible: jobs, complete: false },
    eta: { successful: jobs, eligible: jobs, complete: true }, photos: { successful: jobs, eligible: jobs, complete: true },
  } };
}
function counts(teams = [row()], weekStart = "2026-11-15"): TeamWeekCounts {
  const window = resolveTeamEvidenceWindow({ weekStart }, new Date("2026-12-01T17:00:00Z"));
  return { period: { weekStart, weekEnd: window.weekEnd, weekConvention: "Sunday-start", coverageStart: weekStart, coverageEnd: window.weekEnd }, teams, complete: true, warnings: [] };
}
function match(id = 11, teamId = 1, change: Partial<TeamComplaintMatch> = {}): TeamComplaintMatch {
  return { candidate: { evidenceId: `synthetic-${id}`, evidenceRevision: "a".repeat(64), summary: "Synthetic cleaning report", category: "cleaning_quality", evidenceQuotes: ["synthetic original quote"], references: [] },
    status: "matched", matchBasis: "explicit_visit", visit: { id, bookingId: null, serviceDate: "2026-10-30", serviceStartUtc: null }, team: { id: teamId, name: `Synthetic team ${teamId}`, basis: "stored_visit" },
    reportAtUtc: "2026-11-18T17:00:00Z", affectedWeekStart: "2026-10-25", includedInRequestedWeek: false, reviewReasons: [], limitations: [], verified: false, eligibleForScore: false, ...change };
}
function outcome(matches = [match()]): { matches: TeamComplaintMatch[]; visitGroups: TeamComplaintVisitGroup[] } {
  const grouped = new Map<string, TeamComplaintVisitGroup>();
  for (const m of matches) {
    if (m.status !== "matched" || !m.visit || !m.team) continue;
    const key = `${m.visit.id}:${m.team.id}`;
    const group = grouped.get(key) ?? { visitId: m.visit.id, teamId: m.team.id, serviceDate: m.visit.serviceDate, matches: [], evidenceIds: [], verified: false as const, eligibleForScore: false as const };
    group.matches.push(m); if (!group.evidenceIds.includes(m.candidate.evidenceId)) group.evidenceIds.push(m.candidate.evidenceId); grouped.set(key, group);
  }
  return { matches, visitGroups: Array.from(grouped.values()) };
}
const decision = (change: Partial<TeamComplaintDecision> = {}): TeamComplaintDecision => ({ visitId: 11, teamId: 1, includeComplaint: true, completedRecovery: false, outcomeNote: "", ...change });
const publication = (c = counts(), o = outcome(), d = [decision()]) => buildTeamWeekPublication(c, o, d);
const record = (snapshot: TeamLeaderboardSnapshot, id = "revision-1", publishedAtMs = 100) => ({ snapshot, id, publishedAtMs });
const metadata = (snapshot: TeamLeaderboardSnapshot): { countsComplete: boolean; warnings: string[]; unmatchedWarnings: string[]; incidents: unknown[] } => (snapshot as any).reviewMetadata;

describe("owned leaderboard count reads (synthetic, no network)", () => {
  it("counts assigned/not-completed jobs, non-null ETA including zero, saved nonempty photos and numeric ratings only", async () => {
    const port = new FakePort();
    port.jobs = [job(1, { customerRating: 5 }), job(2, { customerRating: 4 }), job(3, { customerRating: "5" }), job(4, { customerRating: true }), job(5, { customerRating: 5.1 }), job(6, { customerRating: 0 }), job(7, { customerRating: null })];
    port.etas = port.jobs.map((j, i) => eta(Number(j.id), { etaTimestamp: i === 0 ? 0 : null }));
    port.photos = [photo(1), photo(2, { leadflowJobId: 1 }), photo(3, { leadflowJobId: 2, photoUrl: "" }), photo(4, { leadflowJobId: 3, photoUrl: "  " })];
    const c = await readTeamLeaderboardCounts(port, window), team = c.teams[0];
    expect(c.complete).toBe(true); expect(team.eligibleJobs).toBe(7);
    expect(team.metrics.ratings).toEqual({ successful: 1, eligible: 2, complete: true });
    expect(team.metrics.eta).toEqual({ successful: 1, eligible: 7, complete: true });
    expect(team.metrics.photos).toEqual({ successful: 1, eligible: 7, complete: true });
    expect(team.metrics.complaints.complete).toBe(false); expect(team.metrics.recovery.complete).toBe(false);
    for (const call of port.calls) {
      expect(call.sql.startsWith("SELECT ")).toBe(true);
      expect(call.sql).not.toMatch(/completed|customerPhone|customerEmail|provider|UPDATE|INSERT|DELETE/i);
      expect(call.params[call.params.length - 1]).toBe(100);
    }
  });
  it("pages the full roster, jobs, ETA and photo cohort with no total cap and confirms empty exhaustion", async () => {
    const port = new FakePort();
    port.teams = Array.from({ length: 250 }, (_, i) => roster(i + 1, 10000 + i));
    port.jobs = Array.from({ length: 1251 }, (_, i) => job(i + 1, { teamId: 10000 }));
    port.etas = port.jobs.map(j => eta(Number(j.id))); port.photos = port.jobs.map(j => photo(Number(j.id)));
    const c = await readTeamLeaderboardCounts(port, window);
    expect(c.complete).toBe(true); expect(c.teams).toHaveLength(250); expect(c.teams[0].eligibleJobs).toBe(1251);
    expect(c.teams[0].metrics.photos.successful).toBe(1251);
    expect(port.calls.filter(c => c.sql.includes("FROM `scheduling_teams`"))).toHaveLength(4);
    expect(port.calls.filter(c => c.sql.includes("FROM `leadflow_jobs`"))).toHaveLength(14);
    expect(port.calls.some(call => call.params[0] === 1251)).toBe(true);
  });
  it("excludes exactly the approved case-insensitive tombstone statuses, not other non-completed jobs", async () => {
    const port = new FakePort();
    port.jobs = ["canceled", "CANCELLED", "missing_from_launch27", "rescheduled", "assigned", "in_progress", "unknown"].map((status, i) => job(i + 1, { bookingStatus: status }));
    port.etas = port.jobs.map(j => eta(Number(j.id)));
    const c = await readTeamLeaderboardCounts(port, window);
    expect(c.teams[0].eligibleJobs).toBe(3); expect(c.complete).toBe(true);
  });
  it("maps imported assignments only through unique launch27TeamId and native assignments only through roster.id", async () => {
    const port = new FakePort(); port.teams = [roster(1, 900), roster(900, 901)];
    port.jobs = [job(1), job(2, { origin: "native_booking", bookingId: 2000, launch27BookingId: null, teamId: 900 })]; port.etas = [eta(1), eta(2)];
    const c = await readTeamLeaderboardCounts(port, window);
    expect(c.teams.map(t => [t.id, t.eligibleJobs])).toEqual([["1", 1], ["900", 1]]);
  });
  it("keeps imported recurrence jobs and their rating/ETA/photo counts in the Launch27 namespace despite coincident roster IDs", async () => {
    const port = new FakePort(); port.teams = [roster(1, 900), roster(900, 901)];
    port.jobs = [job(1, { origin: "leadflow_recurrence", bookingId: null, launch27BookingId: null, customerRating: 5 })];
    const c = await readTeamLeaderboardCounts(port, window);
    expect(c.complete).toBe(true); expect(c.teams.map(t => [t.id, t.eligibleJobs])).toEqual([["1", 1], ["900", 0]]);
    for (const key of ["ratings", "eta", "photos"] as const) {
      expect(c.teams[0].metrics[key]).toEqual({ successful: 1, eligible: 1, complete: true });
      expect(c.teams[1].metrics[key]).toEqual({ successful: 0, eligible: 0, complete: true });
    }
    const query = port.calls.find(call => call.sql.includes("FROM `leadflow_jobs`"))!.sql;
    expect(query).toContain("`origin`"); expect(query).toContain("`bookingId`");
    const published = buildTeamWeekPublication(c, outcome([]), []);
    const summary = aggregateTeamPublications([record(published)]);
    expect(rankAssessedScores(summary.publication.teams, summary.details).find(t => t.id === "1")?.totalScore).toBe(100);
    expect(rankAssessedScores(summary.publication.teams, summary.details).find(t => t.id === "900")?.totalScore).toBeNull();
  });
  it("maps imported recurrence without a coincident native ID and retains native recurrence's booking-bound namespace", async () => {
    const port = new FakePort();
    port.jobs = [job(1, { origin: "leadflow_recurrence", bookingId: null, launch27BookingId: null })];
    const imported = await readTeamLeaderboardCounts(port, window);
    expect(imported.complete).toBe(true); expect(imported.teams[0].eligibleJobs).toBe(1);
    port.teams = [roster(1, 900), roster(900, 901)];
    port.jobs = [job(1, { origin: "leadflow_recurrence", bookingId: 2000, launch27BookingId: null, customerRating: 5 })];
    const native = await readTeamLeaderboardCounts(port, window);
    expect(native.complete).toBe(true); expect(native.teams.map(t => [t.id, t.eligibleJobs])).toEqual([["1", 0], ["900", 1]]);
    for (const key of ["ratings", "eta", "photos"] as const) expect(native.teams[1].metrics[key]).toEqual({ successful: 1, eligible: 1, complete: true });
  });
  it("uses imported origin even without a source booking ID and refuses ambiguous recurrence aliases rather than native fallback", async () => {
    const port = new FakePort(); port.teams = [roster(1, 900), roster(900, 901)];
    port.jobs = [job(1, { launch27BookingId: null })];
    const imported = await readTeamLeaderboardCounts(port, window);
    expect(imported.complete).toBe(true); expect(imported.teams.map(t => [t.id, t.eligibleJobs])).toEqual([["1", 1], ["900", 0]]);
    port.teams = [roster(1, 900), roster(900, 900)];
    port.jobs = [job(1, { origin: "leadflow_recurrence", bookingId: null, launch27BookingId: null })];
    const ambiguous = await readTeamLeaderboardCounts(port, window);
    expect(ambiguous.complete).toBe(false); expect(ambiguous.teams.every(t => t.eligibleJobs === 0)).toBe(true);
    expect(ambiguous.warnings.join(" ")).toMatch(/launch27TeamId.*ambiguous/);
  });
  it.each(["origin", "bookingId"])("keeps missing projected %s namespace evidence incomplete instead of guessing", async field => {
    const port = new FakePort(); delete port.jobs[0][field];
    const c = await readTeamLeaderboardCounts(port, window);
    expect(c.complete).toBe(false); expect(c.teams.every(t => t.eligibleJobs === 0)).toBe(true);
    expect(c.warnings.join(" ")).toMatch(/MISSING_PROJECTED_FIELD/);
  });
  it("fails closed rather than using coincident numeric IDs or names for ambiguous/unmapped imports", async () => {
    const port = new FakePort(); port.teams = [roster(1, 900), roster(900, 900)];
    const c = await readTeamLeaderboardCounts(port, window);
    expect(c.complete).toBe(false); expect(c.teams.every(t => t.eligibleJobs === 0 && !t.metrics.ratings.complete)).toBe(true);
    expect(c.warnings.join(" ")).toMatch(/ambiguous/);
    port.teams = [roster(900, null)];
    const unmatched = await readTeamLeaderboardCounts(port, window);
    expect(unmatched.teams[0].eligibleJobs).toBe(0); expect(unmatched.complete).toBe(false);
  });
  it("retains partial reads visibly without earning points after a later-page failure", async () => {
    const port = new FakePort(); port.jobs = Array.from({ length: 101 }, (_, i) => job(i + 1, { customerRating: 5 }));
    port.fail = "jobs"; port.failAfterCursor = 100; port.etas = port.jobs.map(j => eta(Number(j.id)));
    const c = await readTeamLeaderboardCounts(port, window);
    expect(c.teams[0].eligibleJobs).toBe(100); expect(c.complete).toBe(false);
    expect(c.teams[0].metrics.ratings.complete).toBe(false);
    expect(calculateTeamScore(c.teams[0]).points.ratings).toBeNull();
    expect(c.warnings.join(" ")).toMatch(/partial, not proven zeros/);
  });
  it.each(["teams", "jobs", "etas", "photos"] as const)("keeps a failed %s read unavailable", async fail => {
    const port = new FakePort(); port.fail = fail;
    const c = await readTeamLeaderboardCounts(port, window);
    expect(c.complete).toBe(false); expect(c.warnings.join(" ")).toMatch(/incomplete SELECT/);
    if (fail === "photos") expect(c.teams[0].metrics.photos).toEqual({ successful: 0, eligible: 1, complete: false });
    if (fail === "etas") expect(c.teams[0].metrics.eta.complete).toBe(false);
  });
  it("distinguishes a missing progress record from a returned null ETA; successful empty photo reads are known zero", async () => {
    const port = new FakePort(); port.etas = []; port.photos = [];
    const missing = await readTeamLeaderboardCounts(port, window);
    expect(missing.complete).toBe(false); expect(missing.teams[0].metrics.eta.complete).toBe(false); expect(missing.teams[0].metrics.photos.complete).toBe(true);
    port.etas = [eta(1, { etaTimestamp: null })];
    const available = await readTeamLeaderboardCounts(port, window);
    expect(available.complete).toBe(true); expect(available.teams[0].metrics.eta).toEqual({ successful: 0, eligible: 1, complete: true });
  });
  it("keeps zero-job teams and no received ratings legitimately N/A without score fabrication", async () => {
    const port = new FakePort(); port.teams.push(roster(2, 901));
    const c = await readTeamLeaderboardCounts(port, window);
    expect(c.teams[0].metrics.ratings.eligible).toBe(0); expect(calculateTeamScore(c.teams[0]).points.ratings).toBeNull();
    expect(c.teams[1].eligibleJobs).toBe(0); expect(calculateTeamScore(c.teams[1]).status).toBe("not-ranked");
  });
  it("rejects malformed or nonadvancing pages and absent fields as incomplete rather than hanging or guessing", async () => {
    const port = new FakePort(); port.invalidPage = [job(), job()];
    const c = await readTeamLeaderboardCounts(port, window);
    expect(c.complete).toBe(false); expect(c.warnings.join(" ")).toMatch(/NONADVANCING_CURSOR/);
    port.invalidPage = null; port.etas = [{ id: 1, leadflowJobId: 1 }];
    expect((await readTeamLeaderboardCounts(port, window)).warnings.join(" ")).toMatch(/MISSING_PROJECTED_FIELD/);
  });
  it("validates the Sunday week and service-date bound without issuing SELECTs", async () => {
    const port = new FakePort();
    await expect(readTeamLeaderboardCounts(port, { ...window, weekStart: "2026-11-16" })).rejects.toThrow(/Sunday/);
    expect(port.calls).toHaveLength(0);
  });
});

describe("explicit human publication builder", () => {
  it("preserves report-week earlier-service semantics and groups repeated reports once without mutating inputs", () => {
    const m = match(), repeated = clone(m); repeated.candidate.evidenceId = "synthetic-repeat";
    const o = outcome([m, repeated]), c = counts(), d = [decision()];
    const before = clone({ c, o, d }), p = publication(c, o, d);
    expect(p.details["1"].complaintCases).toBe(1); expect(p.publication.ownIncidents).toHaveLength(1);
    expect(p.publication.ownIncidents[0].id).toBe("week-11:1"); expect(p.publication.ownIncidents[0].date).toContain("Service 2026-10-30");
    expect(p.publication.teams[0].metrics.complaints).toEqual({ successful: 9, eligible: 10, complete: true });
    expect({ c, o, d }).toEqual(before); expect(p.period?.weekStart).toBe("2026-11-15");
  });
  it("records refund/reclean requests separately and never converts requests into completed recoveries", () => {
    const m = match(); m.candidate.category = "refund_request";
    const p = publication(counts(), outcome([m]));
    expect(p.details["1"].refundRequests).toBe(1); expect(p.details["1"].confirmedRecoveryCases).toBe(0);
    expect(p.publication.teams[0].metrics.recovery.successful).toBe(10);
    expect(p.details["1"].metricNotes.recovery).toMatch(/not provider-wide/);
    expect(p.publication.ownIncidents[0].outcome).toMatch(/requests alone/);
    const reclean = clone(m); reclean.candidate.category = "reclean_request";
    expect(publication(counts(), outcome([reclean])).details["1"].confirmedRecoveryCases).toBe(0);
  });
  it("requires a nonempty admin outcome for recovery and counts one completed recovery per service/team", () => {
    expect(() => publication(counts(), outcome(), [decision({ completedRecovery: true, outcomeNote: " " })])).toThrow(/decision/);
    const p = publication(counts(), outcome(), [decision({ completedRecovery: true, outcomeNote: "Admin recorded completed reclean" })]);
    expect(p.details["1"].confirmedRecoveryCases).toBe(1); expect(p.publication.teams[0].metrics.recovery.successful).toBe(9);
    expect(p.publication.ownIncidents[0].outcome).toMatch(/explicitly recorded/);
  });
  it("does not invent complaints from excluded decisions or unmatched matches; keeps separate review warnings", () => {
    const unknown = match(12, 1, { status: "needs_review", team: null, visit: null, reviewReasons: ["unresolved service"] });
    const p = publication(counts(), outcome([match(), unknown]), [decision({ includeComplaint: false })]);
    expect(p.details["1"].complaintCases).toBe(0); expect(p.publication.ownIncidents).toHaveLength(0);
    expect(metadata(p).unmatchedWarnings.join(" ")).toMatch(/unresolved service/);
  });
  it.each([{ decisions: [] }, { decisions: [decision(), decision()] }, { decisions: [decision({ visitId: 99 })] }])("rejects missing, duplicate or extraneous decisions", ({ decisions }) => {
    expect(() => publication(counts(), outcome(), decisions)).toThrow();
  });
  it("rejects forged or omitted captured matched visit groups", () => {
    const o = outcome(); o.visitGroups[0].matches[0] = { ...match(), reportAtUtc: "2026-11-19T17:00:00Z" };
    expect(() => publication(counts(), o)).toThrow(/exactly match/);
    expect(() => publication(counts(), { ...outcome(), visitGroups: [] }, [])).toThrow(/exactly cover/);
    expect(() => publication(counts([row(10, "2")]))).toThrow(/absent/);
  });
  it("does not turn incomplete read counts into assessed-score full marks or a known-zero recovery", () => {
    const c = counts(); c.complete = false; c.teams[0].metrics.photos.complete = false;
    const p = publication(c);
    expect(p.details["1"]).toBeUndefined(); expect(p.publication.teams[0].metrics.recovery.complete).toBe(false);
    expect(rankAssessedScores(p.publication.teams, p.details)[0].totalScore).toBeNull();
    expect(metadata(p).countsComplete).toBe(false);
  });
  it("keeps report-week cases beyond current job denominator visible and unscored rather than clamping cases", () => {
    const p = publication(counts([row(0, "1", 0, 0)]));
    expect(p.details["1"].complaintCases).toBe(1); expect(p.publication.teams[0].metrics.complaints.complete).toBe(false);
    expect(p.publication.ownIncidents[0].id).toBe("week-11:1");
  });
});

describe("count-based latest-revision Summary", () => {
  it("selects one latest revision per Sunday week, adds denominators instead of averaging scores, and stays immutable", () => {
    const old = publication(counts([row(1, "1", 1, 1)]), outcome([]), []);
    const current = publication(counts([row(9, "1", 3, 1)]), outcome([]), []);
    const later = publication(counts([row(1, "1", 1, 1)], "2026-11-22"), outcome([]), []);
    const input = [record(old, "old", 1), record(current, "new", 2), record(later, "next", 3)], before = clone(input);
    const p = aggregateTeamPublications(input), team = p.publication.teams[0];
    expect(team.eligibleJobs).toBe(10); expect(team.metrics.ratings).toEqual({ successful: 2, eligible: 4, complete: true });
    expect(calculateTeamScore(team).points.ratings).toBe(15); expect(p.publication.publishedLabel).toContain("2 published");
    expect(input).toEqual(before);
  });
  it("uses stable team IDs across renamed teams and never joins teams by display name", () => {
    const a = row(10), b = row(10); b.name = "Synthetic renamed team";
    const p = aggregateTeamPublications([record(publication(counts([a]), outcome([]), [])), record(publication(counts([b, { ...row(2, "2"), name: a.name }], "2026-11-22"), outcome([]), []), "other", 200)]);
    expect(p.publication.teams).toHaveLength(2); expect(p.publication.teams.find(t => t.id === "1")?.eligibleJobs).toBe(20);
    expect(p.publication.teams.find(t => t.id === "1")?.name).toBe("Synthetic renamed team");
  });
  it("globally deduplicates repeated affected-service/team complaints and explicit recoveries across weeks", () => {
    const d = [decision({ completedRecovery: true, outcomeNote: "Admin recorded recovery" })];
    const m = match(); m.candidate.category = "refund_request";
    const a = publication(counts(), outcome([m]), d), b = publication(counts([row()], "2026-11-22"), outcome([m]), d);
    const p = aggregateTeamPublications([record(a), record(b, "other", 200)]);
    expect(p.details["1"].complaintCases).toBe(1); expect(p.details["1"].confirmedRecoveryCases).toBe(1); expect(p.details["1"].refundRequests).toBe(1);
    expect(p.publication.teams[0].metrics.complaints.successful).toBe(19); expect(p.publication.teams[0].metrics.recovery.successful).toBe(19);
    expect(p.publication.ownIncidents).toHaveLength(1);
  });
  it("tracks a later explicit recovery for a repeated incident, without counting the complaint twice", () => {
    const a = publication(), b = publication(counts([row()], "2026-11-22"), outcome(), [decision({ completedRecovery: true, outcomeNote: "Later human-recorded refund" })]);
    const p = aggregateTeamPublications([record(a), record(b, "later", 200)]);
    expect(p.details["1"].complaintCases).toBe(1); expect(p.details["1"].confirmedRecoveryCases).toBe(1);
  });
  it("treats legitimate zero-rating and zero-job weeks as N/A, not invalidations of actual received ratings", () => {
    const a = publication(counts([row(10, "1", 0, 0)]), outcome([]), []);
    const b = publication(counts([row(0, "1", 0, 0)], "2026-11-22"), outcome([]), []);
    const c = publication(counts([row(2, "1", 2, 1)], "2026-11-29"), outcome([]), []);
    const p = aggregateTeamPublications([record(a), record(b, "empty", 200), record(c, "rated", 300)]);
    expect(p.publication.teams[0].metrics.ratings).toEqual({ successful: 1, eligible: 2, complete: true });
    expect(calculateTeamScore(p.publication.teams[0]).points.ratings).toBe(15);
  });
  it("preserves approved legacy no-received-rating and zero-job semantics without modifying baseline-like snapshots", () => {
    const a = publication(counts([row(10, "1", 0, 0)]), outcome([]), []);
    delete (a as any).reviewMetadata; a.publication.teams[0].metrics.ratings.complete = false;
    const b = publication(counts([row(2, "1", 2, 2)], "2026-11-22"), outcome([]), []);
    const p = aggregateTeamPublications([record(a), record(b, "rated", 200)]);
    expect(p.publication.teams[0].metrics.ratings.complete).toBe(true); expect(p.publication.teams[0].metrics.ratings.eligible).toBe(2);
  });
  it("preserves genuinely incomplete rating, ETA and photo observations", () => {
    const a = publication(counts(), outcome([]), []); a.publication.teams[0].metrics.ratings.complete = false; a.publication.teams[0].metrics.eta.complete = false; a.publication.teams[0].metrics.photos.complete = false;
    const b = publication(counts([row()], "2026-11-22"), outcome([]), []);
    const p = aggregateTeamPublications([record(a), record(b, "other", 200)]);
    expect(p.publication.teams[0].metrics.ratings.complete).toBe(false); expect(p.publication.teams[0].metrics.eta.complete).toBe(false); expect(p.publication.teams[0].metrics.photos.complete).toBe(false);
  });
  it("does not call an unavailable zero-denominator legacy week a legitimate empty observation", () => {
    const unknown = publication(counts([row(0, "1", 0, 0)]), outcome([]), []);
    delete (unknown as any).reviewMetadata;
    delete unknown.details["1"];
    for (const key of ["ratings", "eta", "photos"] as const) unknown.publication.teams[0].metrics[key].complete = false;
    const known = publication(counts([row()], "2026-11-22"), outcome([]), []);
    const p = aggregateTeamPublications([record(unknown), record(known, "known", 200)]);
    for (const key of ["ratings", "eta", "photos", "recovery"] as const) expect(p.publication.teams[0].metrics[key].complete).toBe(false);
    expect(p.details["1"]).toBeUndefined();
  });
  it("rejects misleading received-rating and job-metric denominators as incomplete rather than awarding points", () => {
    const p = publication(counts(), outcome([]), []);
    p.publication.teams[0].metrics.ratings.eligible = 11;
    p.publication.teams[0].metrics.photos.eligible = 100;
    const summary = aggregateTeamPublications([record(p)]);
    expect(summary.publication.teams[0].metrics.ratings.complete).toBe(false);
    expect(summary.publication.teams[0].metrics.photos.complete).toBe(false);
    expect(metadata(summary).warnings.join(" ")).toMatch(/invalid ratings/);
  });
  it("never treats unavailable recovery details as proven zero, even though the immutable helper has a snapshot-only default", () => {
    const a = publication(counts(), outcome([]), []); delete (a.details["1"] as any).confirmedRecoveryCases;
    const b = publication(counts([row()], "2026-11-22"), outcome([]), []);
    const p = aggregateTeamPublications([record(a), record(b, "other", 200)]);
    expect(p.publication.teams[0].metrics.recovery.complete).toBe(false); expect(p.details["1"]).toBeUndefined();
    expect(metadata(p).warnings.join(" ")).toMatch(/not proven zero/); expect(rankAssessedScores(p.publication.teams, p.details)[0].totalScore).toBeNull();
  });
  it("retains legacy complaint counts but refuses invented service identities for cross-week deduplication", () => {
    const a = publication(); delete (a as any).reviewMetadata; a.publication.ownIncidents[0].id = "opaque-approved-incident";
    const b = publication(counts([row()], "2026-11-22"));
    const before = clone(a), p = aggregateTeamPublications([record(a), record(b, "other", 200)]);
    expect(p.publication.teams[0].metrics.complaints.complete).toBe(false); expect(metadata(p).warnings.join(" ")).toMatch(/without invented cross-week/);
    expect(p.publication.ownIncidents.map(i => i.id)).toContain("opaque-approved-incident"); expect(a).toEqual(before);
  });
  it("supports stable six-field legacy complaint incident IDs but not inferred legacy recovery IDs", () => {
    const a = publication(); delete (a as any).reviewMetadata;
    const b = publication(counts([row()], "2026-11-22")); delete (b as any).reviewMetadata;
    const p = aggregateTeamPublications([record(a), record(b, "other", 200)]);
    expect(p.details["1"].complaintCases).toBe(1);
    a.details["1"].confirmedRecoveryCases = 1;
    const unknown = aggregateTeamPublications([record(a), record(b, "other", 200)]);
    expect(unknown.publication.teams[0].metrics.recovery.complete).toBe(false);
  });
  it("handles deterministic same-time revision ordering and empty history without fabricating a week", () => {
    const a = publication(counts([row(2)]), outcome([]), []), b = publication(counts([row(4)]), outcome([]), []);
    expect(aggregateTeamPublications([record(b, "b"), record(a, "a")]).publication.teams[0].eligibleJobs).toBe(4);
    expect(aggregateTeamPublications([])).toMatchObject({ publication: { weekLabel: "Summary", teams: [], ownIncidents: [] }, details: {} });
    expect(aggregateTeamPublications([]).period).toBeUndefined();
  });
  it("rejects missing week/revision and ambiguous team identities rather than grouping by a label", () => {
    const p = publication(); delete p.period;
    expect(() => aggregateTeamPublications([record(p)])).toThrow(/Sunday/);
    const duplicate = publication(); duplicate.publication.teams.push(clone(duplicate.publication.teams[0]));
    expect(() => aggregateTeamPublications([record(duplicate)])).toThrow(/Ambiguous/);
  });
});

describe("local-only source boundaries", () => {
  it("does not import schema, operational routers, providers, or the static snapshot, or reference prohibited legacy storage", () => {
    const source = readFileSync(new URL("./teamLeaderboardHistoryMetrics.ts", import.meta.url), "utf8");
    const prohibited = ["cleaner" + "_jobs", "cleaner" + "Jobs"];
    for (const token of prohibited) expect(source).not.toContain(token);
    expect(source).not.toMatch(/from ["'][^"']*(?:schema|routers|claude|twilio|launch27Api)|teamLeaderboardWeeklySnapshot|createPool|DATABASE_URL/);
    expect(source).toContain("FROM `leadflow_jobs`"); expect(source).toContain("FROM `cleaner_portal_job_photos`");
  });
});
