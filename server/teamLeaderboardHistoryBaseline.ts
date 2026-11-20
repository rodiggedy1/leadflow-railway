import { createHash } from "node:crypto";
import type { TeamLeaderboardSnapshot } from "./teamLeaderboardPublication";

// Exact parsed approved November 15–19 snapshot. Aliases were verified against
// accepted Week-Test-Data.json using team/date/summary/outcome, its groupedServices
// and recorded evidence-to-visit mappings, not team/contact/order inference.
// This is identity provenance only, not a new fault or coverage verification.
const APPROVED_SNAPSHOT_SHA256 = "603f32450f6677c6642f4acad3f9746adee21034db5841fe8d15aa8f52c4d899";
const aliases = [
  { opaqueId: "leaderboard-incident-1", stableId: "week-540077:9", teamId: "9", refundRequest: false },
  { opaqueId: "leaderboard-incident-2", stableId: "week-540053:120001", teamId: "120001", refundRequest: false },
  { opaqueId: "leaderboard-incident-3", stableId: "week-360056:2", teamId: "2", refundRequest: false },
  { opaqueId: "leaderboard-incident-4", stableId: "week-540047:120001", teamId: "120001", refundRequest: false },
  { opaqueId: "leaderboard-incident-5", stableId: "week-540169:4", teamId: "4", refundRequest: true },
  { opaqueId: "leaderboard-incident-6", stableId: "week-540175:5", teamId: "5", refundRequest: true },
  { opaqueId: "leaderboard-incident-7", stableId: "week-540155:360001", teamId: "360001", refundRequest: false },
  { opaqueId: "leaderboard-incident-8", stableId: "week-540064:9", teamId: "9", refundRequest: true },
] as const;

/** Summary-only clone. Ordinary baseline reads, public text, job/metric counts,
 * scoring and the static snapshot remain unchanged. No I/O, rematching or writes.
 * Count-coverage completeness is intentionally unspecified, never upgraded.
 */
export function legacyTeamSnapshotForSummary(snapshot: TeamLeaderboardSnapshot): TeamLeaderboardSnapshot {
  if (createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") !== APPROVED_SNAPSHOT_SHA256)
    throw new Error("LEGACY_TEAM_HISTORY_BASELINE_CHANGED");
  const result = structuredClone(snapshot);
  result.publication.ownIncidents = result.publication.ownIncidents.map(incident => {
    const alias = aliases.find(value => value.opaqueId === incident.id && value.teamId === incident.teamId);
    if (!alias) throw new Error("LEGACY_TEAM_HISTORY_BASELINE_CHANGED");
    return { ...incident, id: alias.stableId };
  });
  return Object.assign(result, { reviewMetadata: {
    warnings: ["Legacy accepted identity aliases retain original report-week, attendance, timing, source-conflict and provider-coverage limitations; they do not newly verify fault or completed outcomes."],
    unmatchedWarnings: [],
    incidents: aliases.map(alias => ({ id: alias.stableId, teamId: alias.teamId, includeComplaint: true,
      completedRecovery: false, refundRequest: alias.refundRequest })),
  } });
}
