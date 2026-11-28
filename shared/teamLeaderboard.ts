export const TEAM_SCORE_METRICS = [
  // Owner formula (2026-11-28): quality incidents 55, five-star ratings 30, ETA 10, photos 5.
  // "complaints" is the single quality-incident category: a complaint, its reclean and a quality-related refund are one
  // incident, counted once against the completed jobs. Only incidents that are the team's responsibility count.
  { key: "ratings", label: "5-star ratings", weight: 30, color: "#d49b37", rule: "The share of received customer ratings that are five stars." },
  { key: "complaints", label: "Quality incidents", weight: 55, color: "#cb7163", rule: "The share of completed jobs without a quality incident that is the team's responsibility. A complaint, its reclean and a quality refund count as one incident." },
  // Kept only so stored results keep their shape; recleans and refunds are part of the quality incident and score 0 here.
  { key: "recovery", label: "Recleans & refunds", weight: 0, color: "#9a88b5", rule: "Included in quality incidents; not scored separately." },
  { key: "eta", label: "ETA submitted", weight: 10, color: "#648fb0", rule: "The share of jobs requiring an ETA for which the team submitted one." },
  { key: "photos", label: "Job photos", weight: 5, color: "#589b85", rule: "The share of jobs requiring photos with all required photos uploaded." },
] as const;

export type TeamScoreMetric = typeof TEAM_SCORE_METRICS[number]["key"];
export type MetricEvidence = { successful: number; eligible: number; complete: boolean };
export type TeamLeaderboardRow = {
  id: string;
  name: string;
  eligibleJobs: number;
  metrics: Record<TeamScoreMetric, MetricEvidence>;
};
export type TeamScore = { points: Record<TeamScoreMetric, number | null>; total: number | null; status: "scored" | "provisional" | "not-ranked" };
export type RankedTeam = TeamLeaderboardRow & { score: TeamScore; rank: number | null };
export type TeamLeaderboardPublication = {
  weekLabel: string;
  nextWeekLabel: string;
  publishedLabel: string;
  teams: TeamLeaderboardRow[];
  // Restricted to the signed-in team's incidents BEFORE this view receives them.
  ownIncidents: Array<{ id: string; teamId: string; date: string; summary: string; outcome: string; sourceLabel: string }>;
};

export function calculateTeamScore(team: TeamLeaderboardRow): TeamScore {
  const points = {} as Record<TeamScoreMetric, number | null>;
  for (const metric of TEAM_SCORE_METRICS) {
    // A category with no weight is not scored (never a deduction, never makes a score incomplete).
    if (metric.weight === 0) { points[metric.key] = 0; continue; }
    const evidence = team.metrics[metric.key];
    const valid = evidence.complete && Number.isInteger(evidence.eligible) && Number.isInteger(evidence.successful) &&
      evidence.eligible > 0 && evidence.successful >= 0 && evidence.successful <= evidence.eligible;
    points[metric.key] = valid ? metric.weight * evidence.successful / evidence.eligible : null;
  }
  const values = Object.values(points);
  const status = !Number.isInteger(team.eligibleJobs) || team.eligibleJobs <= 0 ? "not-ranked" : values.some(value => value === null) ? "provisional" : "scored";
  return { points, total: status === "scored" ? values.reduce<number>((sum, value) => sum + value!, 0) : null, status };
}

export function rankTeamScores(teams: TeamLeaderboardRow[]): RankedTeam[] {
  const sorted = teams.map(team => ({ ...team, score: calculateTeamScore(team), rank: null as number | null }))
    .sort((a, b) => (b.score.total ?? -1) - (a.score.total ?? -1) || a.name.localeCompare(b.name));
  // Shared numeric rank for equal raw scores; no hidden scheduling tie-break rule.
  let lastTotal: number | null = null;
  let rank = 0;
  return sorted.map((team, index) => {
    if (team.score.total !== null) {
      if (team.score.total !== lastTotal) rank = index + 1;
      lastTotal = team.score.total;
      return { ...team, rank };
    }
    return team;
  });
}

export function scoreLabel(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
