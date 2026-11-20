import { z } from "zod";

const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const teamEvidenceDaySchema = z.string().refine(validDay, "Use a valid YYYY-MM-DD date");
export const teamEvidenceWeekInputSchema = z.object({
  weekStart: teamEvidenceDaySchema.refine(value => new Date(`${value}T00:00:00Z`).getUTCDay() === 0, "The requested week starts on Sunday"),
}).strict();
export type TeamEvidenceWeekInput = z.infer<typeof teamEvidenceWeekInputSchema>;
export type TeamEvidenceWindow = {
  weekStart: string; weekEnd: string; throughDate: string;
  timeZone: "America/New_York"; startInclusiveUtc: string; endExclusiveUtc: string; capturedAtUtc: string;
};
export type TeamEvidenceKind = "sms" | "email" | "human_call" | "ai_call" | "phone_unverified";
export type TeamEvidence = {
  id: string; revision: string; sourceKind: TeamEvidenceKind; store: string;
  sourceRowId: string; providerId: string | null; sessionId: string | null; threadId: string | null;
  originalText: string | null;
  occurredAtUtc: string | null; observedAtUtc: string | null;
  timeBasis: "original" | "received" | "stored" | "unknown";
  bodyBasis: "original" | "snapshot" | "snippet" | "missing";
  speakerBasis: "customer" | "unverified" | "non_customer";
  customerPhone: string | null; customerEmail: string | null; customerName: string | null;
  businessLine: string | null; mailboxEmail: string | null;
  limitations: string[];
};
export type TeamEvidenceFamilyCoverage = {
  store: string; scannedRows: number; evidenceItems: number; exhausted: boolean;
  status: "read" | "unavailable"; limitations: string[];
};
export type TeamEvidenceRead = {
  window: TeamEvidenceWindow; evidence: TeamEvidence[]; families: TeamEvidenceFamilyCoverage[];
  collectionComplete: boolean; limitations: string[];
};
export type TeamEvidenceTeam = { id: number; name: string; launch27TeamId: number | null };
export type TeamEvidenceAssignment = {
  id: number; bookingId: number; teamId: number | null; teamName: string | null;
  assignedAtUtc: string | null; unassignedAtUtc: string | null; status: string;
};
export type TeamEvidenceVisit = {
  id: number; bookingId: number | null; launch27BookingId: number | null; publicBookingNumber: string | null;
  jobDate: string; serviceStartUtc: string | null;
  bookingStatus: string; progressStatus: string | null;
  customerName: string; customerPhone: string | null; customerEmail: string | null; address: string | null;
  // These DTO team IDs are scheduling-team IDs. The reader maps imported and
  // portal identities once; the matcher never remaps coincident numeric IDs.
  storedTeamId: number | null; storedTeamName: string | null;
  progressTeamId: number | null; signoffTeamId: number | null;
  progressUpdatedAtUtc: string | null; signoffAtUtc: string | null; jobUpdatedAtUtc: string | null;
  customerRating: number | null; etaTimestamp: number | null;
};
export type TeamEvidenceVisitHistory = {
  visits: TeamEvidenceVisit[]; teams: TeamEvidenceTeam[]; assignments: TeamEvidenceAssignment[];
  complete: boolean; limitations: string[];
};
export const complaintReferenceSchema = z.object({
  kind: z.enum(["service_date", "booking", "address", "unresolved"]),
  value: z.string().min(1).nullable(), quote: z.string().min(1),
}).strict();
export const teamComplaintCandidateSchema = z.object({
  evidenceId: z.string().min(1), evidenceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  summary: z.string().trim().min(1),
  category: z.enum(["cleaning_quality", "team_service", "reclean_request", "refund_request"]),
  evidenceQuotes: z.array(z.string().min(1)).min(1),
  references: z.array(complaintReferenceSchema),
}).strict();
export type TeamComplaintCandidate = z.infer<typeof teamComplaintCandidateSchema>;
export const teamComplaintExtractionSchema = z.object({ candidates: z.array(teamComplaintCandidateSchema) }).strict();
export type TeamComplaintMatch = {
  candidate: TeamComplaintCandidate;
  status: "matched" | "needs_review";
  matchBasis: "explicit_visit" | "latest_completed_before_report" | null;
  visit: { id: number; bookingId: number | null; serviceDate: string; serviceStartUtc: string | null } | null;
  team: { id: number; name: string; basis: "signoff" | "progress" | "assignment_at_service" | "stored_visit" } | null;
  reportAtUtc: string | null; affectedWeekStart: string | null;
  includedInRequestedWeek: boolean;
  reviewReasons: string[]; limitations: string[];
  // Assignment matching is never a verification of fault or a score publication.
  verified: false; eligibleForScore: false;
};
export type TeamComplaintVisitGroup = {
  visitId: number; teamId: number; serviceDate: string;
  matches: TeamComplaintMatch[]; evidenceIds: string[];
  verified: false; eligibleForScore: false;
};
