import type { TeamLeaderboardPublication, TeamScoreMetric } from "./teamLeaderboard";

export type TeamLeaderboardDetails = Record<string, {
  complaintCases: number;
  refundRequests: number;
  confirmedRecoveryCases: number;
  metricDisplay: Record<TeamScoreMetric, { value: string; unit: string; note: string }>;
  metricNotes: Record<TeamScoreMetric, string>;
}>;

export type TeamLeaderboardPeriod = {
  weekStart: string;
  weekEnd: string;
  weekConvention: string;
  coverageStart: string;
  coverageEnd: string;
};

export type TeamLeaderboardPublishedResponse = {
  publication: TeamLeaderboardPublication;
  details: TeamLeaderboardDetails;
  ownTeamId: string;
  cleanerProfileId: number;
  period?: TeamLeaderboardPeriod;
};
