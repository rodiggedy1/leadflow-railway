/** Phase 3 (2026-11-28): weekly team reports by SMS, sent only when an admin presses Send (no scheduled sending).
 * Built from the leaderboard's existing calculated standings and saved quality records: no AI, no new analysis.
 * Each attempt is one row in team_weekly_reports; (weekStart, teamId, attempt) is unique, so the same report is never
 * sent twice by accident. A deliberate resend is a new attempt. A team without a valid phone is skipped on its own. */
import type { Pool } from "mysql2/promise";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";
import { countsAgainstTeam, type IncidentForScoring } from "../shared/teamQualityIncidents";
import { buildTeamReportMessage, complaintAreas, reportLanguage, type ReportLanguage, type TeamReportFacts, type TeamReportStatus } from "../shared/teamWeeklyReport";
import { shiftBookingDate } from "../shared/bookingReschedule";
import type { TeamLeaderboardRow } from "../shared/teamLeaderboard";

/** A "pending" attempt older than this was interrupted: it may or may not have been sent. */
export const PENDING_UNCERTAIN_MS = 2 * 60_000;

export type ReportIncident = IncidentForScoring & { jobDate: string | null; reportedAtMs: number };
export type ReportWeek = {
  weekEnd: string;
  teams: TeamLeaderboardRow[];
  details: Record<string, { complaintCases?: number; confirmedRecoveryCases?: number } | undefined>;
  teamAccounts: Record<string, { cleanerProfileId: number | null; reason?: string }>;
  /** null when final; otherwise the reason the week's numbers are provisional. */
  provisionalReason: string | null;
  incidents: ReportIncident[];
};
export type ReportProfile = { id: number; phone: string | null; language: string | null; isActive: number };
export type ReportRow = {
  id: number; weekStart: string; teamId: number; attempt: number; teamName: string; cleanerProfileId: number; phone: string;
  language: ReportLanguage; provisional: boolean; messageText: string; status: TeamReportStatus; error: string | null;
  providerMessageId: string | null; requestedBy: number; createdAtMs: number; updatedAtMs: number; sentAtMs: number | null;
};
export type ReportStore = {
  list(weekStart: string): Promise<ReportRow[]>;
  /** Inserts the attempt; "duplicate" when that attempt already exists (another click or another staff member). */
  reserve(row: Omit<ReportRow, "id">): Promise<number | "duplicate">;
  finish(id: number, outcome: { status: "sent" | "failed"; error: string | null; providerMessageId: string | null; atMs: number }): Promise<void>;
};
export type ReportDeps = {
  readWeek(weekStart: string): Promise<ReportWeek>;
  readProfiles(ids: number[]): Promise<ReportProfile[]>;
  store: ReportStore;
  sendSms(input: { to: string; content: string }): Promise<{ success: boolean; messageId?: string; error?: string }>;
  normalizePhone(phone: string): string | null;
  now(): number;
};

const ISSUES: Record<string, string> = {
  missing_cleaner_account: "No team account is linked to this team.", ambiguous_cleaner_accounts: "More than one team account is linked to this team.",
  inactive_cleaner_account: "The team account is inactive.", unmapped_team: "This team is not linked to a team account.",
  missing_scheduling_team: "This team is not in the team list.", inactive_scheduling_team: "This team is inactive or archived.",
  ambiguous_team_mapping: "This team is linked to more than one team record.", unavailable_mapping: "The team account link could not be confirmed.",
};
const validPhone = (deps: ReportDeps, phone: string | null) => {
  if (!phone?.trim()) return null;
  try { const normalized = deps.normalizePhone(phone.trim()); return normalized && /^\+1[2-9]\d{9}$/.test(normalized) ? normalized : null; } catch { return null; }
};
export const maskPhone = (phone: string) => `•••• ${phone.replace(/\D/g, "").slice(-4)}`;

export type TeamReportPreview = {
  teamId: string; teamName: string; rank: number | null; score: number | null; completedJobs: number; complaintCount: number;
  language: ReportLanguage; phone: string | null; phoneMasked: string | null; cleanerProfileId: number | null;
  /** Why this team cannot be sent a report (it is skipped; other teams are not affected). */
  issue: string | null; message: string;
  latest: { status: TeamReportStatus | "uncertain"; attempt: number; atMs: number; sentAtMs: number | null; error: string | null; provisional: boolean } | null;
  attempts: number;
};
export type TeamReportsView = { weekStart: string; weekEnd: string; provisional: boolean; provisionalReason: string | null; teams: TeamReportPreview[] };

/** Every team with jobs this week: its report text, contact and latest send status. Read-only. */
export async function previewTeamReports(deps: ReportDeps, weekStart: string): Promise<TeamReportsView> {
  const week = await deps.readWeek(weekStart);
  const ranked = rankAssessedScores(week.teams, week.details as never).filter(team => team.eligibleJobs > 0);
  const rankedTeams = ranked.filter(team => team.rank !== null).length;
  const profileIds = Array.from(new Set(ranked.map(team => week.teamAccounts[team.id]?.cleanerProfileId).filter((id): id is number => typeof id === "number")));
  const profiles = new Map((profileIds.length ? await deps.readProfiles(profileIds) : []).map(profile => [profile.id, profile]));
  const rows = await deps.store.list(weekStart);
  const now = deps.now();
  const provisional = week.provisionalReason !== null;
  const teams = ranked.map((team): TeamReportPreview => {
    const account = week.teamAccounts[team.id];
    const profile = account?.cleanerProfileId ? profiles.get(account.cleanerProfileId) : undefined;
    const phone = profile && profile.isActive === 1 ? validPhone(deps, profile.phone) : null;
    const issue = !account?.cleanerProfileId ? ISSUES[account?.reason ?? "unmapped_team"] ?? "This team is not linked to a team account."
      : !profile || profile.isActive !== 1 ? "The team account is inactive."
      : !phone ? (profile.phone?.trim() ? "The team account's phone number is not a valid US mobile number." : "The team account has no phone number.") : null;
    const language = reportLanguage(profile?.language);
    const counted = week.incidents.filter(incident => String(incident.teamId) === team.id && countsAgainstTeam(incident))
      .sort((a, b) => (a.jobDate ?? "").localeCompare(b.jobDate ?? "") || a.reportedAtMs - b.reportedAtMs);
    const facts: TeamReportFacts = {
      teamName: team.name, weekStart, weekEnd: week.weekEnd, rank: team.rank, rankedTeams, unranked: team.rank === null,
      score: team.totalScore, completedJobs: team.eligibleJobs,
      ratings: team.metrics.ratings, eta: team.metrics.eta, photos: team.metrics.photos,
      complaintCount: week.details[team.id]?.complaintCases ?? counted.length,
      complaints: counted.map(incident => ({ date: incident.jobDate, areas: complaintAreas([incident.evidenceQuote, incident.evidenceText].filter(Boolean).join(" \n ")) })),
      provisional,
    };
    const mine = rows.filter(row => String(row.teamId) === team.id).sort((a, b) => b.attempt - a.attempt);
    const last = mine[0];
    return {
      teamId: team.id, teamName: team.name, rank: team.rank, score: team.totalScore, completedJobs: team.eligibleJobs, complaintCount: facts.complaintCount,
      language, phone, phoneMasked: phone ? maskPhone(phone) : null, cleanerProfileId: account?.cleanerProfileId ?? null, issue,
      message: buildTeamReportMessage(facts, language),
      latest: last ? { status: last.status === "pending" && now - last.updatedAtMs > PENDING_UNCERTAIN_MS ? "uncertain" : last.status, attempt: last.attempt,
        atMs: last.updatedAtMs, sentAtMs: last.sentAtMs, error: last.error, provisional: last.provisional } : null,
      attempts: mine.length,
    };
  });
  return { weekStart, weekEnd: week.weekEnd, provisional, provisionalReason: week.provisionalReason, teams };
}

export type SendOutcome = { teamId: string; teamName: string;
  result: "sent" | "failed" | "skipped_no_phone" | "skipped_already_sent" | "skipped_pending" | "skipped_in_progress" | "skipped_no_jobs"; detail: string | null };

/** Sends the selected teams' reports, one at a time; one team's problem never stops the others.
 * Without `resend`, a team whose report was already sent (or may have been sent) is skipped. */
export async function sendTeamReports(deps: ReportDeps, input: { weekStart: string; teamIds: string[]; resend: boolean; seenAttempts?: number }, agentId: number): Promise<SendOutcome[]> {
  const view = await previewTeamReports(deps, input.weekStart);
  const outcomes: SendOutcome[] = [];
  for (const teamId of Array.from(new Set(input.teamIds))) {
    const team = view.teams.find(candidate => candidate.teamId === teamId);
    if (!team) { outcomes.push({ teamId, teamName: "", result: "skipped_no_jobs", detail: "This team has no jobs this week." }); continue; }
    if (team.issue || !team.phone || !team.cleanerProfileId) { outcomes.push({ teamId, teamName: team.teamName, result: "skipped_no_phone", detail: team.issue }); continue; }
    // A resend goes out only if nobody resent this report since the person looked (two clicks or two staff = one text).
    if (input.resend && input.seenAttempts !== undefined && team.attempts !== input.seenAttempts) {
      outcomes.push({ teamId, teamName: team.teamName, result: "skipped_in_progress", detail: "This report was just sent again by someone else. Check its status first." });
      continue;
    }
    if (team.latest?.status === "pending") { outcomes.push({ teamId, teamName: team.teamName, result: "skipped_in_progress", detail: "A send for this team is in progress." }); continue; }
    if (!input.resend && team.latest?.status === "sent") { outcomes.push({ teamId, teamName: team.teamName, result: "skipped_already_sent", detail: null }); continue; }
    if (!input.resend && team.latest?.status === "uncertain") {
      outcomes.push({ teamId, teamName: team.teamName, result: "skipped_pending", detail: "The last attempt may have been sent. Check with the team, then use Resend." });
      continue;
    }
    const at = deps.now();
    const reserved = await deps.store.reserve({ weekStart: input.weekStart, teamId: Number(teamId), attempt: team.attempts + 1, teamName: team.teamName,
      cleanerProfileId: team.cleanerProfileId, phone: team.phone, language: team.language, provisional: view.provisional, messageText: team.message,
      status: "pending", error: null, providerMessageId: null, requestedBy: agentId, createdAtMs: at, updatedAtMs: at, sentAtMs: null });
    if (reserved === "duplicate") { outcomes.push({ teamId, teamName: team.teamName, result: "skipped_in_progress", detail: "Another send for this team just started." }); continue; }
    let sent: { success: boolean; messageId?: string; error?: string };
    try { sent = await deps.sendSms({ to: team.phone, content: team.message }); }
    catch (error) { sent = { success: false, error: error instanceof Error ? error.message : "SMS send failed" }; }
    const error = sent.success ? null : String(sent.error ?? "SMS send failed").slice(0, 250);
    try { await deps.store.finish(reserved, { status: sent.success ? "sent" : "failed", error, providerMessageId: sent.messageId ?? null, atMs: deps.now() }); }
    catch { /* stays "pending": shown as "may have been sent" and never resent without Resend */ }
    outcomes.push({ teamId, teamName: team.teamName, result: sent.success ? "sent" : "failed", detail: error });
  }
  return outcomes;
}

/** MySQL/TiDB store for team_weekly_reports. */
export function createReportStore(pool: Pool): ReportStore {
  const fromRow = (row: Record<string, unknown>): ReportRow => ({
    id: Number(row.id), weekStart: String(row.weekStart), teamId: Number(row.teamId), attempt: Number(row.attempt), teamName: String(row.teamName),
    cleanerProfileId: Number(row.cleanerProfileId), phone: String(row.phone), language: row.language === "es" ? "es" : "en", provisional: Number(row.provisional) === 1,
    messageText: String(row.messageText), status: String(row.status) as TeamReportStatus, error: row.error == null ? null : String(row.error),
    providerMessageId: row.providerMessageId == null ? null : String(row.providerMessageId), requestedBy: Number(row.requestedBy),
    createdAtMs: Number(row.createdAtMs), updatedAtMs: Number(row.updatedAtMs), sentAtMs: row.sentAtMs == null ? null : Number(row.sentAtMs),
  });
  return {
    async list(weekStart) {
      const [rows] = await pool.query("SELECT * FROM team_weekly_reports WHERE weekStart = ? ORDER BY teamId ASC, attempt ASC LIMIT 2000", [weekStart]);
      return (rows as Array<Record<string, unknown>>).map(fromRow);
    },
    async reserve(row) {
      try {
        const [result] = await pool.query(`INSERT INTO team_weekly_reports (weekStart, teamId, attempt, teamName, cleanerProfileId, phone, language, provisional,
          messageText, status, error, providerMessageId, requestedBy, createdAtMs, updatedAtMs, sentAtMs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.weekStart, row.teamId, row.attempt, row.teamName, row.cleanerProfileId, row.phone, row.language, row.provisional ? 1 : 0, row.messageText,
            row.status, row.error, row.providerMessageId, row.requestedBy, row.createdAtMs, row.updatedAtMs, row.sentAtMs]);
        return Number((result as { insertId: number }).insertId);
      } catch (error) {
        const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
        if (code === "ER_DUP_ENTRY") return "duplicate";
        throw error;
      }
    },
    async finish(id, outcome) {
      await pool.query("UPDATE team_weekly_reports SET status = ?, error = ?, providerMessageId = ?, updatedAtMs = ?, sentAtMs = ? WHERE id = ? AND status = 'pending'",
        [outcome.status, outcome.error, outcome.providerMessageId, outcome.atMs, outcome.status === "sent" ? outcome.atMs : null, id]);
    },
  };
}

/** Reads the week exactly as the leaderboard page does (same live standings, team links and saved quality records). */
export async function readReportWeek(pool: Pool, live: { snapshot: { period?: { weekEnd?: string } | null }; countsComplete: boolean },
  restricted: { publication: { teams: TeamLeaderboardRow[] }; details: ReportWeek["details"] }, teamAccounts: ReportWeek["teamAccounts"],
  analysis: { state: string; scope: string | null }, weekStart: string): Promise<ReportWeek> {
  const { readWeekIncidents } = await import("./teamQualityIncidents");
  const incidents = (await readWeekIncidents(pool, weekStart)) as unknown as ReportIncident[];
  const final = analysis.state === "complete" && analysis.scope === "week";
  return {
    weekEnd: live.snapshot.period?.weekEnd ?? shiftBookingDate(weekStart, 6), teams: restricted.publication.teams, details: restricted.details, teamAccounts,
    provisionalReason: !final ? "The week's complaint analysis is not complete." : !live.countsComplete ? "Some of the week's job counts are incomplete." : null,
    incidents,
  };
}
