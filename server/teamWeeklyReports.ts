/** Phase 3 (2026-11-28): weekly team reports by SMS, sent only when an admin presses Send (no scheduled sending).
 * Owner-approved templates. Send first publishes the week's latest standings (the existing "publish from quality
 * records"), then builds every text from that published result, so the team's page shows exactly the same numbers.
 * If publishing fails, nothing is sent. No AI, no new analysis. Each attempt is one row in team_weekly_reports;
 * (weekStart, teamId, attempt) is unique, so the same report is never sent twice by accident. */
import type { Pool } from "mysql2/promise";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";
import { buildTeamReportMessage, reportLanguage, type ReportLanguage, type TeamReportFacts, type TeamReportStatus } from "../shared/teamWeeklyReport";
import { shiftBookingDate } from "../shared/bookingReschedule";
import type { TeamLeaderboardRow } from "../shared/teamLeaderboard";

/** A "pending" attempt older than this was interrupted: it may or may not have been sent. */
export const PENDING_UNCERTAIN_MS = 2 * 60_000;

/** Standings for a week: the live ones (preview) or the published ones (what is sent). */
export type ReportStandings = {
  weekEnd: string;
  teams: TeamLeaderboardRow[];
  details: Record<string, { complaintCases?: number; confirmedRecoveryCases?: number } | undefined>;
};
export type ReportWeek = ReportStandings & {
  teamAccounts: Record<string, { cleanerProfileId: number | null; reason?: string }>;
  /** null when final; otherwise the reason the week's numbers are provisional. */
  provisionalReason: string | null;
  /** The week's current publication (for the publish step's change check). */
  expectedPublicationId: string | null;
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
  /** Each team account's personal link (the existing 30-day cleaner magic link, opening its team leaderboard). */
  links(profileIds: number[]): Promise<Map<number, string | null>>;
  /** Publishes the week's latest standings (existing "publish from quality records"). Throws if it cannot. */
  publish(weekStart: string, expectedPublicationId: string | null, agentId: number): Promise<void>;
  /** The week's published standings, as the teams see them. */
  readPublished(weekStart: string): Promise<ReportStandings>;
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

type Context = { week: ReportWeek; profiles: Map<number, ReportProfile>; links: Map<number, string | null>; rows: ReportRow[] };
/** Builds every team's report from one set of standings (live for the preview, published for the send). */
function buildReports(deps: ReportDeps, weekStart: string, standings: ReportStandings, ctx: Context): TeamReportsView {
  const ranked = rankAssessedScores(standings.teams, standings.details as never).filter(team => team.eligibleJobs > 0);
  const rankedTeams = ranked.filter(team => team.rank !== null).length;
  const now = deps.now();
  const provisional = ctx.week.provisionalReason !== null;
  const teams = ranked.map((team): TeamReportPreview => {
    const account = ctx.week.teamAccounts[team.id];
    const profile = account?.cleanerProfileId ? ctx.profiles.get(account.cleanerProfileId) : undefined;
    const phone = profile && profile.isActive === 1 ? validPhone(deps, profile.phone) : null;
    const link = profile ? ctx.links.get(profile.id) ?? null : null;
    const issue = !account?.cleanerProfileId ? ISSUES[account?.reason ?? "unmapped_team"] ?? "This team is not linked to a team account."
      : !profile || profile.isActive !== 1 ? "The team account is inactive."
      : !phone ? (profile.phone?.trim() ? "The team account's phone number is not a valid US mobile number." : "The team account has no phone number.")
      : !link ? "The team's personal link could not be prepared." : null;
    const language = reportLanguage(profile?.language);
    const facts: TeamReportFacts = {
      teamName: team.name, weekStart, weekEnd: standings.weekEnd, rank: team.rank, rankedTeams, score: team.totalScore,
      completedJobs: team.eligibleJobs, ratings: team.metrics.ratings, eta: team.metrics.eta, photos: team.metrics.photos,
      complaintCount: standings.details[team.id]?.complaintCases ?? 0, link: link ?? "", provisional,
    };
    const mine = ctx.rows.filter(row => String(row.teamId) === team.id).sort((a, b) => b.attempt - a.attempt);
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
  return { weekStart, weekEnd: standings.weekEnd, provisional, provisionalReason: ctx.week.provisionalReason, teams };
}
async function loadContext(deps: ReportDeps, weekStart: string): Promise<Context> {
  const week = await deps.readWeek(weekStart);
  const withJobs = week.teams.filter(team => team.eligibleJobs > 0);
  const profileIds = Array.from(new Set(withJobs.map(team => week.teamAccounts[team.id]?.cleanerProfileId).filter((id): id is number => typeof id === "number")));
  const profiles = new Map((profileIds.length ? await deps.readProfiles(profileIds) : []).map(profile => [profile.id, profile]));
  const active = Array.from(profiles.values()).filter(profile => profile.isActive === 1).map(profile => profile.id);
  const links = active.length ? await deps.links(active) : new Map<number, string | null>();
  return { week, profiles, links, rows: await deps.store.list(weekStart) };
}

/** Every team with jobs this week: its report exactly as it would be sent now (live standings), contact and status. */
export async function previewTeamReports(deps: ReportDeps, weekStart: string): Promise<TeamReportsView> {
  const ctx = await loadContext(deps, weekStart);
  return buildReports(deps, weekStart, ctx.week, ctx);
}

export type SendOutcome = { teamId: string; teamName: string;
  result: "sent" | "failed" | "skipped_no_phone" | "skipped_already_sent" | "skipped_pending" | "skipped_in_progress" | "skipped_no_jobs"; detail: string | null };
export class ReportPublishError extends Error { constructor() { super("REPORTS_PUBLISH_FAILED"); } }

/** Publishes the week's latest standings, then sends the selected teams' reports built from that publication, one at a
 * time; one team's problem never stops the others. Nothing is published or sent when no selected team can be sent.
 * If publishing fails, nothing is sent (ReportPublishError). Without `resend`, a team already sent is skipped. */
export async function sendTeamReports(deps: ReportDeps, input: { weekStart: string; teamIds: string[]; resend: boolean; seenAttempts?: number }, agentId: number): Promise<SendOutcome[]> {
  const ctx = await loadContext(deps, input.weekStart);
  const view = buildReports(deps, input.weekStart, ctx.week, ctx);
  const outcomes = new Map<string, SendOutcome>(), toSend: string[] = [];
  const ids = Array.from(new Set(input.teamIds));
  for (const teamId of ids) {
    const team = view.teams.find(candidate => candidate.teamId === teamId);
    const skip = (result: SendOutcome["result"], detail: string | null) => outcomes.set(teamId, { teamId, teamName: team?.teamName ?? "", result, detail });
    if (!team) { skip("skipped_no_jobs", "This team has no jobs this week."); continue; }
    if (team.issue || !team.phone || !team.cleanerProfileId) { skip("skipped_no_phone", team.issue); continue; }
    // A resend goes out only if nobody resent this report since the person looked (two clicks or two staff = one text).
    if (input.resend && input.seenAttempts !== undefined && team.attempts !== input.seenAttempts) { skip("skipped_in_progress", "This report was just sent again by someone else. Check its status first."); continue; }
    if (team.latest?.status === "pending") { skip("skipped_in_progress", "A send for this team is in progress."); continue; }
    if (!input.resend && team.latest?.status === "sent") { skip("skipped_already_sent", null); continue; }
    if (!input.resend && team.latest?.status === "uncertain") { skip("skipped_pending", "The last attempt may have been sent. Check with the team, then use Resend."); continue; }
    toSend.push(teamId);
  }
  if (toSend.length) {
    // Publish first; the texts are then built from exactly what the teams will see on their page.
    try { await deps.publish(input.weekStart, ctx.week.expectedPublicationId, agentId); } catch { throw new ReportPublishError(); }
    const published = buildReports(deps, input.weekStart, await deps.readPublished(input.weekStart), ctx);
    for (const teamId of toSend) {
      const team = published.teams.find(candidate => candidate.teamId === teamId);
      if (!team || team.issue || !team.phone || !team.cleanerProfileId) {
        outcomes.set(teamId, { teamId, teamName: team?.teamName ?? "", result: team ? "skipped_no_phone" : "skipped_no_jobs", detail: team?.issue ?? "This team has no jobs in the published results." });
        continue;
      }
      const at = deps.now();
      const reserved = await deps.store.reserve({ weekStart: input.weekStart, teamId: Number(teamId), attempt: team.attempts + 1, teamName: team.teamName,
        cleanerProfileId: team.cleanerProfileId, phone: team.phone, language: team.language, provisional: published.provisional, messageText: team.message,
        status: "pending", error: null, providerMessageId: null, requestedBy: agentId, createdAtMs: at, updatedAtMs: at, sentAtMs: null });
      if (reserved === "duplicate") { outcomes.set(teamId, { teamId, teamName: team.teamName, result: "skipped_in_progress", detail: "Another send for this team just started." }); continue; }
      let sent: { success: boolean; messageId?: string; error?: string };
      try { sent = await deps.sendSms({ to: team.phone, content: team.message }); }
      catch (error) { sent = { success: false, error: error instanceof Error ? error.message : "SMS send failed" }; }
      const error = sent.success ? null : String(sent.error ?? "SMS send failed").slice(0, 250);
      try { await deps.store.finish(reserved, { status: sent.success ? "sent" : "failed", error, providerMessageId: sent.messageId ?? null, atMs: deps.now() }); }
      catch { /* stays "pending": shown as "may have been sent" and never resent without Resend */ }
      outcomes.set(teamId, { teamId, teamName: team.teamName, result: sent.success ? "sent" : "failed", detail: error });
    }
  }
  return ids.map(id => outcomes.get(id)!);
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

/** Reads the week exactly as the leaderboard page does (same live standings and team links). */
export function readReportWeek(live: { snapshot: { period?: { weekEnd?: string } | null }; countsComplete: boolean; expectedPublicationId: string | null },
  restricted: { publication: { teams: TeamLeaderboardRow[] }; details: ReportWeek["details"] }, teamAccounts: ReportWeek["teamAccounts"],
  analysis: { state: string; scope: string | null }, weekStart: string): ReportWeek {
  const final = analysis.state === "complete" && analysis.scope === "week";
  return {
    weekEnd: live.snapshot.period?.weekEnd ?? shiftBookingDate(weekStart, 6), teams: restricted.publication.teams, details: restricted.details, teamAccounts,
    provisionalReason: !final ? "The week's complaint analysis is not complete." : !live.countsComplete ? "Some of the week's job counts are incomplete." : null,
    expectedPublicationId: live.expectedPublicationId,
  };
}
