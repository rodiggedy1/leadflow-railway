/** Read-only consistency check (2026-11-28): for every team with jobs in a week, compares what the admin page shows
 * (live standings from saved quality records), what is published (what team pages show), what the team's own portal
 * actually returns for its login, and the last SMS report sent. No writes, no AI, no texts. */
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";
import { scoreLabel } from "../shared/teamLeaderboard";
import { restrictTeamLeaderboardPublication, type TeamLeaderboardSnapshot } from "./teamLeaderboardPublication";
import type { CleanerPortalTeam } from "./cleanerPortalOwnership";

type Snapshot = TeamLeaderboardSnapshot & { period?: { weekStart: string } | null };
export type TeamFigures = { rank: number | null; score: string; complaints: number; complaintIds: string[] };
export type TeamPortalRow = {
  teamId: string; teamName: string;
  live: TeamFigures;
  published: TeamFigures | null;
  /** What the team sees when it opens its link (null when no team account / not published). */
  portal: (TeamFigures & { ownTeam: boolean; detailed: number; customers: string[] }) | null;
  sms: { rank: number | null; score: string | null; complaints: number | null; sentAtMs: number } | null;
  /** Team-page problems (published results or the team's own page disagree with the admin page). */
  issues: string[];
  /** The last text differs from the published results (texts are never resent automatically). */
  smsNote: string | null;
};
export type TeamPortalCheck = { weekStart: string; publishedAtMs: number | null; upToDate: boolean; teams: TeamPortalRow[] };
export type PortalCheckDeps = {
  live(weekStart: string): Promise<{ snapshot: Snapshot }>;
  /** The week's latest publication, or null when the week has not been published. */
  published(weekStart: string): Promise<{ snapshot: Snapshot; publishedAtMs: number } | null>;
  teamAccounts(teamIds: string[]): Promise<Record<string, { cleanerProfileId: number | null; reason?: string }>>;
  /** The portal's own team lookup for a login (the same lookup the team page uses). */
  portalTeam(cleanerProfileId: number): Promise<CleanerPortalTeam | null>;
  lastSentReports(weekStart: string): Promise<Array<{ teamId: number; messageText: string; sentAtMs: number }>>;
};

function figures(snapshot: Snapshot): Map<string, TeamFigures & { name: string; eligibleJobs: number }> {
  const ranked = rankAssessedScores(snapshot.publication.teams, snapshot.details);
  return new Map(ranked.map(team => [team.id, { name: team.name, eligibleJobs: team.eligibleJobs, rank: team.rank, score: scoreLabel(team.totalScore),
    complaints: snapshot.details[team.id]?.complaintCases ?? 0,
    complaintIds: snapshot.publication.ownIncidents.filter(incident => incident.teamId === team.id).map(incident => incident.id).sort() }]));
}
/** Reads the numbers back out of a sent text (English or Spanish approved template). */
export function smsFigures(text: string): { rank: number | null; score: string | null; complaints: number | null } {
  const rank = text.match(/(?:Your ranking|Tu posición): #(\d+) /);
  const score = text.match(/(?:Overall score|Puntuación general): ([\d.,]+)\/100/);
  const complaints = text.match(/🧹 (?:Cleaning complaints|Quejas sobre la limpieza): (\d+)/);
  return { rank: rank ? Number(rank[1]) : null, score: score ? score[1] : null, complaints: complaints ? Number(complaints[1]) : null };
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

export async function checkTeamPortals(deps: PortalCheckDeps, weekStart: string): Promise<TeamPortalCheck> {
  const live = await deps.live(weekStart);
  const publication = await deps.published(weekStart);
  const liveFigures = figures(live.snapshot);
  const publishedFigures = publication ? figures(publication.snapshot) : null;
  const ids = Array.from(liveFigures.entries()).filter(([, team]) => team.eligibleJobs > 0).map(([id]) => id);
  const accounts = await deps.teamAccounts(ids);
  const sms = new Map<string, { messageText: string; sentAtMs: number }>();
  for (const row of await deps.lastSentReports(weekStart)) sms.set(String(row.teamId), row);
  const teams: TeamPortalRow[] = [];
  for (const id of ids) {
    const live = liveFigures.get(id)!, published = publishedFigures?.get(id) ?? null;
    const issues: string[] = [];
    if (!publication) issues.push("This week has not been published, so the team page has no results for it.");
    else if (!published) issues.push("This team is missing from the published results.");
    else {
      if (published.complaints !== live.complaints || !same(published.complaintIds, live.complaintIds))
        issues.push(`Published complaints (${published.complaints}) differ from the current complaints (${live.complaints}).`);
      if (published.rank !== live.rank || published.score !== live.score)
        issues.push(`Published ranking/score (#${published.rank ?? "—"}, ${published.score}) differ from the current ones (#${live.rank ?? "—"}, ${live.score}).`);
    }
    let portal: TeamPortalRow["portal"] = null;
    const profileId = accounts[id]?.cleanerProfileId ?? null;
    if (!profileId) issues.push(`No team account is linked (${accounts[id]?.reason ?? "unmapped"}), so the team cannot open its page.`);
    else if (publication) {
      const portalTeam = await deps.portalTeam(profileId);
      if (!portalTeam || String(portalTeam.schedulingTeamId) !== id) {
        issues.push(`The team's login opens a different team record (${portalTeam?.schedulingTeamId ?? "none"}), so its page cannot show this team's results.`);
      } else {
        const view = restrictTeamLeaderboardPublication(publication.snapshot, portalTeam, profileId);
        const own = view.publication.ownIncidents;
        const mine = figures({ ...publication.snapshot, publication: { ...publication.snapshot.publication, teams: view.publication.teams, ownIncidents: own } }).get(id);
        portal = { rank: mine?.rank ?? null, score: mine?.score ?? "—", complaints: view.details[id]?.complaintCases ?? 0, complaintIds: own.map(incident => incident.id).sort(),
          ownTeam: view.ownTeamId === id, detailed: own.filter(incident => incident.complaint).length,
          customers: own.map(incident => incident.complaint?.customerName ?? "").filter(Boolean) };
        if (published && (portal.complaints !== published.complaints || !same(portal.complaintIds, published.complaintIds)))
          issues.push(`The team page shows ${portal.complaintIds.length} complaint(s) but the published results count ${published.complaints}.`);
        if (portal.detailed < own.length) issues.push("Some published complaints were published before full complaint details existed; publish again to show them.");
      }
    }
    const sent = sms.get(id);
    const smsRow = sent ? { ...smsFigures(sent.messageText), sentAtMs: sent.sentAtMs } : null;
    const smsNote = smsRow && published && (smsRow.rank !== published.rank || smsRow.score !== published.score || smsRow.complaints !== published.complaints)
      ? (`The last SMS (#${smsRow.rank ?? "—"}, ${smsRow.score ?? "—"}, ${smsRow.complaints ?? "—"} complaints) differs from the published results; the text is not resent automatically.`) : null;
    teams.push({ teamId: id, teamName: live.name, live: { rank: live.rank, score: live.score, complaints: live.complaints, complaintIds: live.complaintIds },
      published: published ? { rank: published.rank, score: published.score, complaints: published.complaints, complaintIds: published.complaintIds } : null, portal, sms: smsRow, issues, smsNote });
  }
  return { weekStart, publishedAtMs: publication?.publishedAtMs ?? null, upToDate: teams.every(team => team.issues.length === 0), teams };
}
