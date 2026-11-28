import { TEAM_SCORE_METRICS } from "../shared/teamLeaderboard";
import type { TeamLeaderboardPublication } from "../shared/teamLeaderboard";
import type { TeamLeaderboardDetails, TeamLeaderboardPeriod, TeamLeaderboardPublishedResponse } from "../shared/teamLeaderboardPublication";
import type { CleanerPortalTeam } from "./cleanerPortalOwnership";
import weeklySnapshot from "./teamLeaderboardWeeklySnapshot.json";

export type TeamLeaderboardSnapshot = {
  publication: TeamLeaderboardPublication;
  details: TeamLeaderboardDetails;
  period?: TeamLeaderboardPeriod;
};

/** Only server code imports the snapshot; customer feedback is filtered before return. */
export function restrictTeamLeaderboardPublication(
  snapshot: TeamLeaderboardSnapshot,
  team: CleanerPortalTeam,
  cleanerProfileId: number,
): TeamLeaderboardPublishedResponse {
  if (!Number.isSafeInteger(cleanerProfileId) || cleanerProfileId <= 0 ||
    team.cleanerProfileId !== cleanerProfileId ||
    !Number.isSafeInteger(team.schedulingTeamId) || (team.schedulingTeamId ?? 0) <= 0) {
    throw new Error("Team publication access unavailable.");
  }
  const ownTeamId = String(team.schedulingTeamId);
  const publication = snapshot.publication;
  // Explicit field copies prevent extra review metadata from crossing this boundary.
  const teams = publication.teams.map(row => ({
    id: row.id, name: row.name, eligibleJobs: row.eligibleJobs,
    metrics: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => {
      const evidence = row.metrics[key];
      return [key, { successful: evidence.successful, eligible: evidence.eligible, complete: evidence.complete }];
    })) as typeof row.metrics,
  }));
  const details: TeamLeaderboardDetails = {};
  for (const row of teams) {
    const detail = snapshot.details[row.id];
    if (!detail) continue;
    details[row.id] = {
      complaintCases: detail.complaintCases,
      refundRequests: detail.refundRequests,
      confirmedRecoveryCases: detail.confirmedRecoveryCases,
      metricDisplay: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => {
        const display = detail.metricDisplay[key];
        return [key, { value: display.value, unit: display.unit, note: display.note }];
      })) as typeof detail.metricDisplay,
      metricNotes: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, detail.metricNotes[key]])) as typeof detail.metricNotes,
    };
  }
  const ownIncidents = teams.some(row => row.id === ownTeamId)
    ? publication.ownIncidents.filter(incident => incident.teamId === ownTeamId)
      // The team's own complaints only, in full (customer name, cleaning date, the customer's words, severity, recovery).
      .map(({ id, teamId, date, summary, outcome, sourceLabel, complaint }) => ({ id, teamId, date, summary, outcome, sourceLabel,
        ...(complaint ? { complaint: { customerName: complaint.customerName, cleaningDate: complaint.cleaningDate, wording: complaint.wording,
          fullMessage: complaint.fullMessage, severity: complaint.severity, reclean: complaint.reclean, refund: complaint.refund } } : {}) }))
    : [];
  const result: TeamLeaderboardPublishedResponse = {
    publication: {
      weekLabel: publication.weekLabel,
      nextWeekLabel: publication.nextWeekLabel,
      publishedLabel: publication.publishedLabel,
      teams,
      ownIncidents,
    },
    details,
    ownTeamId,
    cleanerProfileId,
  };
  if (snapshot.period) {
    const { weekStart, weekEnd, weekConvention, coverageStart, coverageEnd } = snapshot.period;
    result.period = { weekStart, weekEnd, weekConvention, coverageStart, coverageEnd };
  }
  return result;
}

export function readTeamLeaderboardPublication(team: CleanerPortalTeam, cleanerProfileId: number): TeamLeaderboardPublishedResponse {
  return restrictTeamLeaderboardPublication(weeklySnapshot, team, cleanerProfileId);
}

/** Authenticated admins can review every team's incidents, without a fabricated own team. */
export function restrictTeamLeaderboardAdminPublication(snapshot: TeamLeaderboardSnapshot): TeamLeaderboardSnapshot {
  const publication = snapshot.publication;
  const teams = publication.teams.map(row => ({
    id: row.id, name: row.name, eligibleJobs: row.eligibleJobs,
    metrics: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => {
      const evidence = row.metrics[key];
      return [key, { successful: evidence.successful, eligible: evidence.eligible, complete: evidence.complete }];
    })) as typeof row.metrics,
  }));
  const details: TeamLeaderboardDetails = {};
  for (const row of teams) {
    const detail = snapshot.details[row.id];
    if (!detail) continue;
    details[row.id] = {
      complaintCases: detail.complaintCases,
      refundRequests: detail.refundRequests,
      confirmedRecoveryCases: detail.confirmedRecoveryCases,
      metricDisplay: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => {
        const display = detail.metricDisplay[key];
        return [key, { value: display.value, unit: display.unit, note: display.note }];
      })) as typeof detail.metricDisplay,
      metricNotes: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, detail.metricNotes[key]])) as typeof detail.metricNotes,
    };
  }
  const result: TeamLeaderboardSnapshot = {
    publication: {
      weekLabel: publication.weekLabel,
      nextWeekLabel: publication.nextWeekLabel,
      publishedLabel: publication.publishedLabel,
      teams,
      ownIncidents: publication.ownIncidents
        .map(({ id, teamId, date, summary, outcome, sourceLabel }) => ({ id, teamId, date, summary, outcome, sourceLabel })),
    },
    details,
  };
  if (snapshot.period) {
    const { weekStart, weekEnd, weekConvention, coverageStart, coverageEnd } = snapshot.period;
    result.period = { weekStart, weekEnd, weekConvention, coverageStart, coverageEnd };
  }
  return result;
}

export function readTeamLeaderboardAdminPublication(): TeamLeaderboardSnapshot {
  return restrictTeamLeaderboardAdminPublication(weeklySnapshot);
}
