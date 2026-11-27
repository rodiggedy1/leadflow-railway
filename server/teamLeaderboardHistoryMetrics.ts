import { isDeepStrictEqual } from "node:util";
import { TEAM_SCORE_METRICS, type MetricEvidence, type TeamLeaderboardRow, type TeamScoreMetric } from "../shared/teamLeaderboard";
import type { TeamLeaderboardDetails, TeamLeaderboardPeriod } from "../shared/teamLeaderboardPublication";
import type { TeamComplaintMatch, TeamComplaintVisitGroup, TeamEvidenceWindow } from "../shared/teamLeaderboardEvidence";
import { isValidBookingRescheduleDate, shiftBookingDate } from "../shared/bookingReschedule";
import { easternDateIso } from "../shared/easternTime";
import type { SelectPort, SqlRow, SqlValue } from "./instinct/readDb";
import { safeReadDbError } from "./instinct/readDb";
import type { TeamLeaderboardSnapshot } from "./teamLeaderboardPublication";

export type TeamWeekCounts = { period: TeamLeaderboardPeriod; teams: TeamLeaderboardRow[]; complete: boolean; warnings: string[] };
export type TeamComplaintDecision = { visitId: number; teamId: number; includeComplaint: boolean; completedRecovery: boolean; outcomeNote: string };

type IncidentRecord = { id: string; teamId: string; includeComplaint: boolean; completedRecovery: boolean; refundRequest: boolean };
// Server-only adjunct; existing explicit privacy projections deliberately do not copy it.
// Legacy identity-only aliases leave count coverage unspecified; they do not upgrade completeness.
type ReviewMetadata = { countsComplete?: boolean; warnings: string[]; unmatchedWarnings: string[]; incidents: IncidentRecord[] };
type ReviewedSnapshot = TeamLeaderboardSnapshot & { reviewMetadata?: ReviewMetadata };
const BATCH = 100;
const TEAMS_SQL = "SELECT `id`, `name`, `launch27TeamId` FROM `scheduling_teams` WHERE `id` > ? ORDER BY `id` ASC LIMIT ?";
const JOBS_SQL = "SELECT `id`, `origin`, `bookingId`, `launch27BookingId`, `jobDate`, `bookingStatus`, `teamId`, `customerRating` FROM `leadflow_jobs` WHERE `id` > ? AND `jobDate` >= ? AND `jobDate` <= ? ORDER BY `id` ASC LIMIT ?";
const ETA_SQL = "SELECT p.`id`, p.`leadflowJobId`, p.`etaTimestamp` FROM `cleaner_portal_job_progress` p JOIN `leadflow_jobs` j ON j.`id` = p.`leadflowJobId` WHERE p.`id` > ? AND j.`jobDate` >= ? AND j.`jobDate` <= ? ORDER BY p.`id` ASC LIMIT ?";
// Completion evidence for jobs dated today or later: the cleaner's portal sign-off (one per job).
const SIGNOFFS_SQL = "SELECT s.`id`, s.`leadflowJobId` FROM `cleaner_portal_job_signoffs` s JOIN `leadflow_jobs` j ON j.`id` = s.`leadflowJobId` WHERE s.`id` > ? AND j.`jobDate` >= ? AND j.`jobDate` <= ? ORDER BY s.`id` ASC LIMIT ?";
const PHOTOS_SQL = "SELECT p.`id`, p.`leadflowJobId`, p.`photoUrl` FROM `cleaner_portal_job_photos` p JOIN `leadflow_jobs` j ON j.`id` = p.`leadflowJobId` WHERE p.`id` > ? AND j.`jobDate` >= ? AND j.`jobDate` <= ? ORDER BY p.`id` ASC LIMIT ?";
const tombstones = new Set(["canceled", "cancelled", "missing_from_launch27", "rescheduled"]);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const evidence = (successful = 0, eligible = 0, complete = false): MetricEvidence => ({ successful, eligible, complete });
function identity(value: unknown): number {
  if (typeof value !== "number" && !(typeof value === "string" && /^[1-9]\d*$/.test(value))) throw new Error("INVALID_ID");
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("INVALID_ID");
  return result;
}
function requireFields(row: SqlRow, fields: string[]): void {
  if (fields.some(field => !Object.hasOwn(row, field))) throw new Error("MISSING_PROJECTED_FIELD");
}
function periodFor(window: TeamEvidenceWindow): TeamLeaderboardPeriod {
  if (!isValidBookingRescheduleDate(window.weekStart) || new Date(`${window.weekStart}T00:00:00Z`).getUTCDay() !== 0 ||
    window.weekEnd !== shiftBookingDate(window.weekStart, 6) || !isValidBookingRescheduleDate(window.throughDate) ||
    window.throughDate < window.weekStart || window.throughDate > window.weekEnd) throw new Error("Invalid Sunday-start count window");
  return { weekStart: window.weekStart, weekEnd: window.weekEnd, weekConvention: "Sunday-start", coverageStart: window.weekStart, coverageEnd: window.throughDate };
}
async function scan(port: SelectPort, sql: string, params: readonly SqlValue[], consume: (row: SqlRow) => void, label: string, warnings: string[]): Promise<boolean> {
  let cursor = 0;
  try {
    for (;;) {
      const rows = await port.select(sql, [cursor, ...params, BATCH]);
      if (!Array.isArray(rows) || rows.length > BATCH) throw new Error("INVALID_PAGE");
      if (rows.length === 0) return true;
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("INVALID_ROW");
        const next = identity(row.id);
        if (next <= cursor) throw new Error("NONADVANCING_CURSOR");
        cursor = next;
        consume(row);
      }
    }
  } catch (error) {
    const reason = error instanceof Error && /^(INVALID_ID|INVALID_PAGE|INVALID_ROW|NONADVANCING_CURSOR|MISSING_PROJECTED_FIELD|INVALID_TEAM|INVALID_JOB|INVALID_ETA|INVALID_PHOTO)$/.test(error.message) ? error.message : safeReadDbError(error).reason;
    warnings.push(`${label}: incomplete SELECT traversal (${reason}); retained counts are partial, not proven zeros.`);
    return false;
  }
}

/** Entire owned service-date cohort and current roster; no contact filtering or provider calls. */
export async function readTeamLeaderboardCounts(port: SelectPort, window: TeamEvidenceWindow): Promise<TeamWeekCounts> {
  const period = periodFor(window), warnings: string[] = [];
  const roster: Array<{ id: number; name: string; launch27TeamId: number | null }> = [];
  const rosterComplete = await scan(port, TEAMS_SQL, [], row => {
    requireFields(row, ["name", "launch27TeamId"]);
    if (!text(row.name)) throw new Error("INVALID_TEAM");
    roster.push({ id: identity(row.id), name: row.name, launch27TeamId: row.launch27TeamId === null ? null : identity(row.launch27TeamId) });
  }, "Roster", warnings);
  const teams = roster.map(team => ({ id: String(team.id), name: team.name, eligibleJobs: 0,
    metrics: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, evidence()])) as TeamLeaderboardRow["metrics"] }));
  const byId = new Map(teams.map(team => [team.id, team]));
  const jobs = new Map<number, TeamLeaderboardRow>();
  // Unmapped jobs are flagged for staff and never make the week incomplete; every other team is still ranked.
  let unmapped = 0, notYetCompleted = 0;
  const dates = [window.weekStart, window.throughDate];
  // Today in US Eastern at the run's capture instant: jobs dated today or later count only with completion evidence.
  const today = easternDateIso(new Date(window.capturedAtUtc));
  const signedOff = new Set<number>();
  const signoffsComplete = await scan(port, SIGNOFFS_SQL, dates, row => {
    requireFields(row, ["leadflowJobId"]);
    signedOff.add(identity(row.leadflowJobId));
  }, "Owned sign-off records", warnings);
  const jobsComplete = await scan(port, JOBS_SQL, dates, row => {
    requireFields(row, ["origin", "bookingId", "launch27BookingId", "jobDate", "bookingStatus", "teamId", "customerRating"]);
    if (!isValidBookingRescheduleDate(String(row.jobDate)) || String(row.jobDate) < window.weekStart || String(row.jobDate) > window.throughDate || typeof row.bookingStatus !== "string" || typeof row.origin !== "string") throw new Error("INVALID_JOB");
    if (tombstones.has(row.bookingStatus.toLowerCase())) return;
    if (String(row.jobDate) >= today && row.bookingStatus.trim().toLowerCase() !== "completed" && !signedOff.has(identity(row.id))) {
      notYetCompleted++;
      return;
    }
    if (row.launch27BookingId !== null) identity(row.launch27BookingId);
    if (row.bookingId !== null) identity(row.bookingId);
    // Same namespace distinction as the existing evidence reader: imported recurrence retains its Launch27 team ID.
    const imported = row.launch27BookingId !== null || row.origin === "launch27_import" || row.bookingId === null && row.origin === "leadflow_recurrence";
    const rawId = row.teamId === null ? null : identity(row.teamId);
    const matches = roster.filter(team => imported ? team.launch27TeamId === rawId && rawId !== null : team.id === rawId);
    if (!rosterComplete || matches.length !== 1) {
      unmapped++;
      warnings.push(`Unmapped job ${identity(row.id)}: ${imported ? "launch27TeamId" : "roster.id"} assignment ${rawId ?? "unassigned"} has unavailable/missing/ambiguous roster mapping; not attributed to any team (staff review).`);
      return;
    }
    const team = byId.get(String(matches[0].id))!;
    team.eligibleJobs++;
    jobs.set(identity(row.id), team);
    // Deliberately no string/boolean coercion or imputation of unreceived ratings.
    if (typeof row.customerRating === "number" && Number.isInteger(row.customerRating) && row.customerRating >= 1 && row.customerRating <= 5) {
      team.metrics.ratings.eligible++;
      if (row.customerRating === 5) team.metrics.ratings.successful++;
    }
  }, "Owned jobs", warnings);
  const etas = new Map<number, unknown>();
  const etaComplete = await scan(port, ETA_SQL, dates, row => {
    requireFields(row, ["leadflowJobId", "etaTimestamp"]);
    const jobId = identity(row.leadflowJobId);
    if (etas.has(jobId) || row.etaTimestamp === undefined) throw new Error("INVALID_ETA");
    etas.set(jobId, row.etaTimestamp);
  }, "Owned ETA records", warnings);
  const photos = new Set<number>();
  const photoComplete = await scan(port, PHOTOS_SQL, dates, row => {
    requireFields(row, ["leadflowJobId", "photoUrl"]);
    const jobId = identity(row.leadflowJobId);
    if (row.photoUrl !== null && typeof row.photoUrl !== "string") throw new Error("INVALID_PHOTO");
    if (text(row.photoUrl)) photos.add(jobId);
  }, "Owned photo records", warnings);
  const cohortComplete = rosterComplete && jobsComplete && signoffsComplete;
  if (unmapped) warnings.push(`${unmapped} job(s) are not mapped to exactly one team; they are flagged for staff review and every other team is still ranked.`);
  if (notYetCompleted) warnings.push(`${notYetCompleted} job(s) dated today or later have no completion evidence yet (portal sign-off or completed status) and are not counted.`);
  for (const team of teams) {
    team.metrics.ratings.complete = cohortComplete; // denominator 0 is still N/A in the unchanged scorer
    team.metrics.eta = evidence(0, team.eligibleJobs, cohortComplete && etaComplete);
    team.metrics.photos = evidence(0, team.eligibleJobs, cohortComplete && photoComplete);
    team.metrics.complaints = evidence(0, team.eligibleJobs);
    team.metrics.recovery = evidence(0, team.eligibleJobs);
  }
  jobs.forEach((team, jobId) => {
    // A job with no portal progress record counts as a missed ETA; it never blocks the week.
    if (!etas.has(jobId)) warnings.push(`Job ${jobId}: no portal progress record; counted as a missed ETA.`);
    else if (etas.get(jobId) !== null) team.metrics.eta.successful++;
    if (photos.has(jobId)) team.metrics.photos.successful++;
  });
  warnings.push("Current roster and persisted assignments are not proof of historical reassignment; SELECT exhaustion is not provider-wide completeness.");
  return { period, teams, complete: cohortComplete && etaComplete && photoComplete, warnings };
}

function detailsFor(team: TeamLeaderboardRow, cases: number, requests: number, recoveries: number, notes?: Partial<Record<TeamScoreMetric, string>>): TeamLeaderboardDetails[string] {
  const jobs = team.eligibleJobs;
  const metricNotes = {
    ratings: team.metrics.ratings.complete && team.metrics.ratings.eligible === 0 ? "No customer rating received in the returned service records. N/A, not full marks or zero." : "Only actual received numeric customer ratings are used; unavailable counts remain incomplete.",
    complaints: "One count per admin-included affected service/team, in the report week, including earlier service dates; not one per message.",
    recovery: "Explicitly admin-recorded completed recleans/refunds only. No selection means no admin-recorded recovery, not provider-wide outcome completeness. Requests are separate.",
    eta: "Non-null persisted portal ETA; no punctuality or SMS-success test. A job with no portal record counts as a missed ETA.",
    photos: "At least one nonempty saved owned-job photo URL; no quality or minimum-count threshold. Unavailable reads remain unknown.",
    ...notes,
  };
  const display = (value: string, unit: string, key: TeamScoreMetric) => ({ value, unit, note: metricNotes[key] });
  return { complaintCases: cases, refundRequests: requests, confirmedRecoveryCases: recoveries, metricNotes,
    metricDisplay: {
      ratings: display(team.metrics.ratings.complete && team.metrics.ratings.eligible > 0 ? `${team.metrics.ratings.successful} / ${team.metrics.ratings.eligible}` : "Not available", "five-star / received ratings", "ratings"),
      complaints: display(String(cases), "complaint-affected services", "complaints"),
      recovery: display(String(recoveries), "admin-recorded recleans/refunds", "recovery"),
      eta: display(team.metrics.eta.complete ? `${team.metrics.eta.successful} / ${jobs}` : "Not available", "jobs with ETA submitted", "eta"),
      photos: display(team.metrics.photos.complete ? `${team.metrics.photos.successful} / ${jobs}` : "Not available", "jobs with photos submitted", "photos"),
    } };
}
function binding(match: TeamComplaintMatch): string {
  return JSON.stringify([match.candidate, match.status, match.visit, match.team, match.reportAtUtc, match.affectedWeekStart, match.includedInRequestedWeek]);
}

/** A human publication decision, never model verification or an inferred completed recovery. */
export function buildTeamWeekPublication(counts: TeamWeekCounts, outcome: { visitGroups: TeamComplaintVisitGroup[]; matches: TeamComplaintMatch[] }, decisions: TeamComplaintDecision[]): TeamLeaderboardSnapshot {
  const groups = new Map<string, TeamComplaintVisitGroup>();
  const captured = new Map<string, TeamComplaintMatch[]>();
  for (const match of outcome.matches) {
    if (match.status !== "matched" || !match.visit || !match.team) continue;
    const key = `${identity(match.visit.id)}:${identity(match.team.id)}`;
    captured.set(key, [...(captured.get(key) ?? []), match]);
  }
  for (const group of outcome.visitGroups) {
    const key = `${identity(group.visitId)}:${identity(group.teamId)}`, matches = captured.get(key);
    if (groups.has(key) || !matches || !group.matches.length || !isValidBookingRescheduleDate(group.serviceDate) ||
      matches.some(match => match.visit!.serviceDate !== group.serviceDate) ||
      !isDeepStrictEqual(group.matches.map(binding).sort(), matches.map(binding).sort()) ||
      !isDeepStrictEqual(Array.from(new Set(group.evidenceIds)).sort(), Array.from(new Set(matches.map(match => match.candidate.evidenceId))).sort())) throw new Error("Complaint groups do not exactly match captured matched visits/teams");
    groups.set(key, group);
  }
  if (groups.size !== captured.size || decisions.length !== groups.size) throw new Error("Decisions must exactly cover captured matched visit/team groups");
  const selected = new Map<string, TeamComplaintDecision>();
  for (const decision of decisions) {
    const key = `${identity(decision.visitId)}:${identity(decision.teamId)}`;
    if (!groups.has(key) || selected.has(key) || typeof decision.includeComplaint !== "boolean" || typeof decision.completedRecovery !== "boolean" ||
      typeof decision.outcomeNote !== "string" || decision.completedRecovery && !text(decision.outcomeNote)) throw new Error("Invalid or duplicate complaint/recovery decision");
    selected.set(key, decision);
  }
  const teams = structuredClone(counts.teams);
  if (new Set(teams.map(team => team.id)).size !== teams.length) throw new Error("Ambiguous publication team identity");
  const details: TeamLeaderboardDetails = {}, ownIncidents: TeamLeaderboardSnapshot["publication"]["ownIncidents"] = [];
  const stats = new Map(teams.map(team => [team.id, { cases: 0, requests: 0, recoveries: 0 }]));
  const incidentRecords: IncidentRecord[] = [];
  groups.forEach((group, key) => {
    const tid = String(group.teamId), decision = selected.get(key)!, totals = stats.get(tid);
    if (!totals) throw new Error("Matched group team is absent from captured roster counts");
    const refundRequest = group.matches.some(match => match.candidate.category === "refund_request");
    if (decision.includeComplaint) totals.cases++;
    if (decision.includeComplaint && refundRequest) totals.requests++;
    if (decision.completedRecovery) totals.recoveries++;
    const id = `week-${key}`;
    incidentRecords.push({ id, teamId: tid, includeComplaint: decision.includeComplaint, completedRecovery: decision.completedRecovery, refundRequest: decision.includeComplaint && refundRequest });
    if (!decision.includeComplaint && !decision.completedRecovery) return;
    const reports = Array.from(new Set(group.matches.map(match => match.reportAtUtc).filter((at): at is string => at !== null))).sort();
    const categories = Array.from(new Set(group.matches.map(match => match.candidate.summary)));
    ownIncidents.push({ id, teamId: tid, date: `${reports.length ? `Reported ${reports.join(", ")} · ` : "Report-week review · "}Service ${group.serviceDate}`,
      sourceLabel: "Admin-reviewed publication", summary: categories.join(" "),
      outcome: `${decision.outcomeNote.trim() || "Admin included this affected service; no completed recovery selected."}${group.matches.length > 1 ? " Repeated reports count once per affected service/team." : ""}${decision.completedRecovery ? " Completed recovery explicitly recorded by admin." : " No admin-recorded completed recovery; requests alone are not outcomes."}` });
  });
  for (const team of teams) {
    const totals = stats.get(team.id)!;
    team.metrics.complaints = evidence(Math.max(0, team.eligibleJobs - totals.cases), team.eligibleJobs, counts.complete && totals.cases <= team.eligibleJobs);
    team.metrics.recovery = evidence(Math.max(0, team.eligibleJobs - totals.recoveries), team.eligibleJobs, counts.complete && totals.recoveries <= team.eligibleJobs);
    // Missing details keep the existing assessed-score helper from turning an incomplete cohort into full marks.
    if (counts.complete) details[team.id] = detailsFor(team, totals.cases, totals.requests, totals.recoveries);
  }
  const unmatchedWarnings = outcome.matches.filter(match => match.status !== "matched").map(match => `Unmatched ${match.candidate.evidenceId}: ${match.reviewReasons.join("; ") || "service/team needs review"}; no team deduction.`);
  const result: ReviewedSnapshot = { period: { ...counts.period }, publication: {
    weekLabel: `${counts.period.weekStart} – ${counts.period.weekEnd}`, nextWeekLabel: "", publishedLabel: "Admin-reviewed published results", teams, ownIncidents,
  }, details, reviewMetadata: { countsComplete: counts.complete, warnings: [...counts.warnings], unmatchedWarnings, incidents: incidentRecords } };
  return result;
}

type Totals = { team: TeamLeaderboardRow; cases: number; requests: number; recoveries: number; complaintsKnown: boolean; recoveryKnown: boolean; incomplete: Record<TeamScoreMetric, boolean> };
function validEvidence(metric: MetricEvidence): boolean {
  return count(metric?.successful) && count(metric?.eligible) && metric.successful <= metric.eligible;
}
function zeroAvailable(snapshot: ReviewedSnapshot, team: TeamLeaderboardRow, key: TeamScoreMetric): boolean {
  const metric = team.metrics[key];
  if (!validEvidence(metric) || metric.eligible !== 0 || snapshot.reviewMetadata?.countsComplete === false) return false;
  if (key !== "ratings") return team.eligibleJobs === 0 && snapshot.reviewMetadata?.countsComplete === true;
  return snapshot.reviewMetadata?.countsComplete === true || /No customer rating received|No received ratings|0 actual customer rating/i.test(snapshot.details[team.id]?.metricNotes?.ratings ?? "");
}

/** Latest revision per Sunday week; sum observations and stable incidents, never weekly scores. */
export function aggregateTeamPublications(records: Array<{ id: string; publishedAtMs: number; snapshot: TeamLeaderboardSnapshot }>): TeamLeaderboardSnapshot {
  const latest = new Map<string, typeof records[number]>();
  for (const record of records) {
    const period = record.snapshot.period;
    if (!text(record.id) || !count(record.publishedAtMs) || !period || !isValidBookingRescheduleDate(period.weekStart) ||
      new Date(`${period.weekStart}T00:00:00Z`).getUTCDay() !== 0 || period.weekEnd !== shiftBookingDate(period.weekStart, 6)) throw new Error("Published record lacks a valid Sunday-week/revision identity");
    const previous = latest.get(period.weekStart);
    if (!previous || record.publishedAtMs > previous.publishedAtMs || record.publishedAtMs === previous.publishedAtMs && record.id.localeCompare(previous.id) > 0) latest.set(period.weekStart, record);
  }
  const selected = Array.from(latest.values()).sort((a, b) => a.snapshot.period!.weekStart.localeCompare(b.snapshot.period!.weekStart));
  const totals = new Map<string, Totals>(), warnings: string[] = [], incidents = new Map<string, TeamLeaderboardSnapshot["publication"]["ownIncidents"][number]>();
  const seenCases = new Set<string>(), seenRequests = new Set<string>(), seenRecoveries = new Set<string>();
  const recorded = new Map<string, IncidentRecord>();
  for (const record of selected) {
    const snapshot = record.snapshot as ReviewedSnapshot, rowIds = new Set<string>();
    warnings.push(...(snapshot.reviewMetadata?.warnings ?? []), ...(snapshot.reviewMetadata?.unmatchedWarnings ?? []));
    for (const row of snapshot.publication.teams) {
      if (!text(row.id) || rowIds.has(row.id) || !count(row.eligibleJobs)) throw new Error("Ambiguous or invalid published team counts");
      rowIds.add(row.id);
      let sum = totals.get(row.id);
      if (!sum) {
        sum = { team: { id: row.id, name: row.name, eligibleJobs: 0, metrics: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, evidence(0, 0, true)])) as TeamLeaderboardRow["metrics"] }, cases: 0, requests: 0, recoveries: 0,
          complaintsKnown: true, recoveryKnown: true, incomplete: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, false])) as Record<TeamScoreMetric, boolean> };
        totals.set(row.id, sum);
      }
      sum.team.name = row.name; // display name may change; stable ID never does
      sum.team.eligibleJobs += row.eligibleJobs;
      for (const key of ["ratings", "eta", "photos"] as const) {
        const metric = row.metrics[key];
        if (!validEvidence(metric) || (key === "ratings" ? metric.eligible > row.eligibleJobs : metric.eligible !== row.eligibleJobs)) {
          sum.incomplete[key] = true; warnings.push(`Team ${row.id}: invalid ${key} evidence in ${record.id}.`); continue;
        }
        sum.team.metrics[key].successful += metric.successful;
        sum.team.metrics[key].eligible += metric.eligible;
        if (!metric.complete && !zeroAvailable(snapshot, row, key)) sum.incomplete[key] = true;
      }
      const detail = snapshot.details[row.id];
      const metadata = snapshot.reviewMetadata;
      const teamIncidents = snapshot.publication.ownIncidents.filter(incident => incident.teamId === row.id);
      const recordsForTeam = metadata?.incidents.filter(incident => incident.teamId === row.id);
      const complaintRecords = recordsForTeam?.filter(incident => incident.includeComplaint);
      const recoveryRecords = recordsForTeam?.filter(incident => incident.completedRecovery);
      const requestRecords = recordsForTeam?.filter(incident => incident.refundRequest);
      const stable = (id: string): boolean => /^week-[1-9]\d*:[1-9]\d*$/.test(id) && id.split(":")[1] === row.id;
      const addDistinct = (items: Array<{ id: string }>, seen: Set<string>): number => {
        let added = 0;
        for (const item of items) {
          if (!stable(item.id)) continue;
          if (!seen.has(item.id)) { seen.add(item.id); added++; }
        }
        return added;
      };
      if (!detail || !count(detail.complaintCases) || metadata?.countsComplete === false) sum.complaintsKnown = false;
      else if (complaintRecords && complaintRecords.length === detail.complaintCases && complaintRecords.every(item => stable(item.id))) sum.cases += addDistinct(complaintRecords, seenCases);
      else {
        // Legacy six-field incidents lack recovery flags. Complaint count binding must agree exactly.
        const ids = Array.from(new Set(teamIncidents.map(incident => incident.id)));
        const stableIds = ids.filter(stable);
        if (ids.length === detail.complaintCases && stableIds.length === ids.length) sum.cases += addDistinct(stableIds.map(id => ({ id })), seenCases);
        else {
          sum.cases += detail.complaintCases;
          if (detail.complaintCases > 0) {
            warnings.push(`Team ${row.id}: ${record.id} lacks complete stable affected-service complaint identities; its recorded cases are retained without invented cross-week deduplication.`);
            if (selected.length > 1) sum.complaintsKnown = false;
          }
        }
      }
      if (!detail || !count(detail.confirmedRecoveryCases) || metadata?.countsComplete === false) {
        sum.recoveryKnown = false;
        warnings.push(`Team ${row.id}: ${record.id} has unavailable admin-recorded recovery counts; not proven zero.`);
      } else if (recoveryRecords && recoveryRecords.length === detail.confirmedRecoveryCases && recoveryRecords.every(item => stable(item.id))) sum.recoveries += addDistinct(recoveryRecords, seenRecoveries);
      else {
        sum.recoveries += detail.confirmedRecoveryCases;
        if (detail.confirmedRecoveryCases > 0) { sum.recoveryKnown = false; warnings.push(`Team ${row.id}: recovery incident identities unavailable in ${record.id}; cannot prove cross-week deduplication.`); }
      }
      if (detail && count(detail.refundRequests)) {
        if (requestRecords && requestRecords.length === detail.refundRequests && requestRecords.every(item => stable(item.id))) sum.requests += addDistinct(requestRecords, seenRequests);
        else sum.requests += detail.refundRequests;
      }
      for (const incident of teamIncidents) {
        const key = stable(incident.id) ? incident.id : `${record.id}:${incident.id}`;
        incidents.set(key, { id: incident.id, teamId: incident.teamId, date: incident.date, sourceLabel: incident.sourceLabel, summary: incident.summary, outcome: incident.outcome });
      }
      for (const item of recordsForTeam ?? []) {
        if (!stable(item.id)) continue;
        const prior = recorded.get(item.id);
        recorded.set(item.id, { ...item, includeComplaint: Boolean(prior?.includeComplaint || item.includeComplaint), completedRecovery: Boolean(prior?.completedRecovery || item.completedRecovery), refundRequest: Boolean(prior?.refundRequest || item.refundRequest) });
      }
    }
    if (snapshot.publication.ownIncidents.some(incident => !rowIds.has(incident.teamId))) throw new Error("Published incident team has no captured counts");
  }
  const teams: TeamLeaderboardRow[] = [], details: TeamLeaderboardDetails = {};
  totals.forEach(sum => {
    const team = sum.team;
    for (const key of ["ratings", "eta", "photos"] as const) team.metrics[key].complete = !sum.incomplete[key];
    team.metrics.complaints = evidence(Math.max(0, team.eligibleJobs - sum.cases), team.eligibleJobs, sum.complaintsKnown && sum.cases <= team.eligibleJobs);
    team.metrics.recovery = evidence(Math.max(0, team.eligibleJobs - sum.recoveries), team.eligibleJobs, sum.recoveryKnown && sum.recoveries <= team.eligibleJobs);
    if (sum.complaintsKnown && sum.recoveryKnown) details[team.id] = detailsFor(team, sum.cases, sum.requests, sum.recoveries, { complaints: "Recorded affected services summed across latest Sunday-week publications; identical stable service/team IDs count once. Earlier services remain in their report-week counts.", recovery: "Explicitly recorded completed recoveries, deduplicated by stable service/team ID where available; no admin-recorded recovery is not provider-wide completeness." });
    teams.push(team);
  });
  teams.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const result: ReviewedSnapshot = { publication: { weekLabel: "Summary", nextWeekLabel: "", publishedLabel: `${selected.length} published Sunday-start week${selected.length === 1 ? "" : "s"} · latest revisions`, teams, ownIncidents: Array.from(incidents.values()) }, details,
    reviewMetadata: { countsComplete: teams.every(team => TEAM_SCORE_METRICS.every(({ key }) => team.metrics[key].complete)), warnings: Array.from(new Set(warnings)), unmatchedWarnings: [], incidents: Array.from(recorded.values()) } };
  if (selected.length) result.period = { weekStart: selected[0].snapshot.period!.weekStart, weekEnd: selected[selected.length - 1].snapshot.period!.weekEnd, weekConvention: "Sunday-start publications (Summary)", coverageStart: selected[0].snapshot.period!.coverageStart, coverageEnd: selected[selected.length - 1].snapshot.period!.coverageEnd };
  return result;
}
