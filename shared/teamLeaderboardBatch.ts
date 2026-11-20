import type { TeamComplaintCandidate, TeamEvidence } from "./teamLeaderboardEvidence";

/** Private analysis/checkpoint protocol, not a login token or team publication. */
export type TeamBatchSeal<T> = { data: T; mac: string };
export type TeamBatchManifestData = {
  version: 1; snapshotId: string; ownerId: number; policyRevision: string;
  weekStart: string; capturedAtUtc: string; readHash: string;
  sources: Array<{ id: string; revision: string; hash: string }>;
};
export type TeamBatchManifest = TeamBatchSeal<TeamBatchManifestData>;
export type TeamBatchReceiptData = {
  version: 1; snapshotId: string; ownerId: number; policyRevision: string;
  manifestHash: string; evidenceId: string; evidenceRevision: string; sourceHash: string;
  status: "completed" | "failed";
  candidates: TeamComplaintCandidate[];
  code: "CANDIDATE_ANALYSIS_FAILED" | null;
};
export type TeamBatchReceipt = TeamBatchSeal<TeamBatchReceiptData>;
export type TeamBatchSourceInput = {
  mode: "unpublished_candidates"; manifest: TeamBatchManifest; source: TeamEvidence;
  completedReceipt?: TeamBatchReceipt;
};
