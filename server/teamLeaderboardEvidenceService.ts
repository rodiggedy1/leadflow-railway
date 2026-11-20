import type {
  TeamComplaintCandidate, TeamComplaintMatch, TeamComplaintVisitGroup,
  TeamEvidenceRead, TeamEvidenceVisitHistory, TeamEvidenceWeekInput,
} from "../shared/teamLeaderboardEvidence";
import type { SelectPort } from "./instinct/readDb";
import { readTeamEvidenceWeek, readTeamEvidenceVisitHistory } from "./teamLeaderboardEvidenceRead";
import { matchTeamComplaintCandidates, groupTeamComplaintVisits } from "./teamLeaderboardComplaintMatch";
import { createTeamComplaintDetector, isTeamComplaintAnalysisSource, validateTeamComplaintExtraction, type TeamComplaintDetector } from "./teamLeaderboardComplaintDetect";
import { createTeamEvidenceReadPort } from "./teamLeaderboardReadPort";

export type TeamEvidenceAuditRead = {
  status: "unpublished_read"; sources: TeamEvidenceRead; history: TeamEvidenceVisitHistory;
  publication: null; scoreResults: null;
};
export type TeamEvidenceCandidateDraft = TeamEvidenceAuditRead & {
  analysis: {
    status: "unpublished_candidates"; complete: boolean;
    analyzedEvidenceIds: string[]; notAnalyzedEvidenceIds: string[];
    failures: Array<{ evidenceId: string; code: "CANDIDATE_ANALYSIS_FAILED" }>;
  };
  matches: TeamComplaintMatch[]; visitGroups: TeamComplaintVisitGroup[];
  verifiedComplaintCount: null; verifiedRecleanRefundCount: null;
};
export function createTeamEvidenceService(options: {
  port?: SelectPort;
  clock?: () => Date;
  readEvidence?: typeof readTeamEvidenceWeek;
  readHistory?: typeof readTeamEvidenceVisitHistory;
  detect?: TeamComplaintDetector;
} = {}) {
  const port = options.port ?? createTeamEvidenceReadPort();
  const detect = options.detect ?? createTeamComplaintDetector();
  const readWeek = async (input: TeamEvidenceWeekInput): Promise<TeamEvidenceAuditRead> => {
    const now = (options.clock ?? (() => new Date()))();
    const sources = await (options.readEvidence ?? readTeamEvidenceWeek)(port, input, now);
    const history = await (options.readHistory ?? readTeamEvidenceVisitHistory)(port, sources.evidence, sources.window);
    return { status: "unpublished_read", sources, history, publication: null, scoreResults: null };
  };
  return Object.freeze({
    readWeek,
    /** Explicit analysis entrypoint. No invocation from readWeek, webhooks,
     * page rendering, scheduling, messages or existing AI response processing. */
    analyzeWeek: async (input: TeamEvidenceWeekInput): Promise<TeamEvidenceCandidateDraft> => {
      const read = await readWeek(input);
      const candidates: TeamComplaintCandidate[] = [];
      const analyzedEvidenceIds: string[] = [], notAnalyzedEvidenceIds: string[] = [];
      const failures: TeamEvidenceCandidateDraft["analysis"]["failures"] = [];
      for (const evidence of read.sources.evidence) {
        if (!isTeamComplaintAnalysisSource(evidence)) {
          if (evidence.speakerBasis !== "non_customer") notAnalyzedEvidenceIds.push(evidence.id);
          continue;
        }
        try {
          const parsed = validateTeamComplaintExtraction({ candidates: await detect(evidence) }, evidence);
          candidates.push(...parsed);
          analyzedEvidenceIds.push(evidence.id);
        } catch {
          failures.push({ evidenceId: evidence.id, code: "CANDIDATE_ANALYSIS_FAILED" });
        }
      }
      const matches = matchTeamComplaintCandidates(candidates, read.sources.evidence, read.history, read.sources.window);
      return {
        ...read,
        analysis: { status: "unpublished_candidates", complete: read.sources.collectionComplete && read.history.complete
          && !failures.length && !notAnalyzedEvidenceIds.length,
          analyzedEvidenceIds, notAnalyzedEvidenceIds, failures },
        matches, visitGroups: groupTeamComplaintVisits(matches),
        verifiedComplaintCount: null, verifiedRecleanRefundCount: null,
      };
    },
  });
}
export type TeamEvidenceService = ReturnType<typeof createTeamEvidenceService>;
