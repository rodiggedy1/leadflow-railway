import { z } from "zod";

/** Team-attributable categories: only these can count against a cleaning team. */
export const TEAM_QUALITY_CATEGORIES = ["cleaning_quality", "team_service"] as const;
/** Office, pricing/billing and scheduling issues are tracked but never penalise a team. */
export const NON_TEAM_CATEGORIES = ["office_service", "pricing_billing", "scheduling", "other"] as const;
/** "unclassified" = a supporting signal with no complaint of its own (for example a low rating, already scored in the
 * ratings metric, or an upset-customer email label with no stated cause). It never counts by itself; it is merged
 * automatically into a complaint about the same visit. */
export const QUALITY_CATEGORIES = [...TEAM_QUALITY_CATEGORIES, ...NON_TEAM_CATEGORIES, "unclassified"] as const;
export type QualityCategory = typeof QUALITY_CATEGORIES[number];
export const QUALITY_SEVERITIES = ["low", "medium", "high"] as const;
export type QualitySeverity = typeof QUALITY_SEVERITIES[number];
export const QUALITY_CHANNELS = ["sms", "email", "call", "rating", "signoff", "review", "staff"] as const;
export type QualityChannel = typeof QUALITY_CHANNELS[number];
export const QUALITY_DETECTORS = ["claude_sms", "claude_email", "claude_call", "claude_staff_call", "vapi_complaint_tool", "gmail_glance", "portal_rating", "cleaner_signoff", "weekly_review", "staff"] as const;
/** The AI that already reads the full message/transcript. Its category wins over rule-based signals for the same visit. */
export const STRONG_DETECTORS: readonly string[] = ["claude_sms", "claude_email", "claude_call", "claude_staff_call", "weekly_review", "staff"];
export type QualityDetector = typeof QUALITY_DETECTORS[number];
/** auto = matched automatically; unattributed = no matching visit/team (does not count; retried automatically);
 * staff = an optional staff override. */
export const ATTRIBUTIONS = ["auto", "unattributed", "staff"] as const;
export const INCIDENT_STATUSES = ["open", "resolved", "dismissed"] as const;
export const RECLEAN_STATUSES = ["none", "requested", "completed"] as const;
export const REFUND_STATUSES = ["none", "requested", "issued"] as const;
export const PROCESSING_STATUSES = ["pending", "ok", "failed"] as const;

/** The optional label Claude may add to its existing SMS JSON. Validated on its own; any problem drops only the label. */
export const smsQualityComplaintSchema = z.object({
  category: z.enum(["cleaning_quality", "team_service", "office_service", "pricing_billing", "scheduling", "other"]),
  severity: z.enum(QUALITY_SEVERITIES),
  evidenceQuotes: z.array(z.string().trim().min(1).max(600)).min(1).max(5),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().default(null),
  recleanRequested: z.boolean().optional().default(false),
  refundRequested: z.boolean().optional().default(false),
}).strict();
export type SmsQualityComplaint = z.infer<typeof smsQualityComplaintSchema>;
export type QualityLabelResult = { complaint: SmsQualityComplaint | null; dropped: string | null };

function realDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** Pure, never throws. Missing (undefined/null) is simply "no complaint". Invalid metadata is dropped with a reason
 * code for the log; quotes must be exact text from the CURRENT customer message (the same evidence rule as tasks). */
export function validateSmsQualityComplaint(raw: unknown, incomingMessage: string): QualityLabelResult {
  try {
    if (raw === undefined || raw === null) return { complaint: null, dropped: null };
    const parsed = smsQualityComplaintSchema.safeParse(raw);
    if (!parsed.success) return { complaint: null, dropped: "QUALITY_LABEL_INVALID_SHAPE" };
    const quotes = Array.from(new Set(parsed.data.evidenceQuotes.filter(quote => incomingMessage.includes(quote))));
    if (!quotes.length) return { complaint: null, dropped: "QUALITY_LABEL_EVIDENCE_NOT_CURRENT_INBOUND" };
    const serviceDate = parsed.data.serviceDate && realDate(parsed.data.serviceDate) ? parsed.data.serviceDate : null;
    return { complaint: { ...parsed.data, evidenceQuotes: quotes, serviceDate }, dropped: null };
  } catch {
    return { complaint: null, dropped: "QUALITY_LABEL_VALIDATION_ERROR" };
  }
}

export function isTeamCategory(category: string): boolean {
  return (TEAM_QUALITY_CATEGORIES as readonly string[]).includes(category);
}
/** Category "group" for deciding whether a new message continues an open incident or is a separate complaint. */
export function categoryGroup(category: string): "team" | "other" | "unclassified" {
  return isTeamCategory(category) ? "team" : category === "unclassified" ? "unclassified" : "other";
}

export type IncidentForScoring = {
  id: number; teamId: number | null; leadflowJobId: number | null; category: string; attribution: string;
  status: string; recleanStatus: string; refundStatus: string; processingStatus: string;
};
/** One incident counts once against one team, automatically, when it is about the team's service, matched to a
 * visit and team, processed, and not dismissed by a staff override. Refund requests or upset-customer labels on their
 * own never count: the category must be cleaning_quality or team_service. */
export function countsAgainstTeam(incident: IncidentForScoring): boolean {
  return incident.status !== "dismissed" && incident.processingStatus === "ok" && isTeamCategory(incident.category)
    && incident.attribution !== "unattributed" && incident.teamId !== null && incident.leadflowJobId !== null;
}
/** A completed reclean or issued refund for a counted incident is one recovery event, never two. */
export function isCompletedRecovery(incident: IncidentForScoring): boolean {
  return countsAgainstTeam(incident) && (incident.recleanStatus === "completed" || incident.refundStatus === "issued");
}

/** Optional staff overrides on an incident (primary record). Never required: the workflow is automatic. */
export const qualityIncidentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("attribute"), id: z.number().int().positive(), leadflowJobId: z.number().int().positive(), note: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal("unattribute"), id: z.number().int().positive(), note: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal("classify"), id: z.number().int().positive(), category: z.enum(QUALITY_CATEGORIES), severity: z.enum(QUALITY_SEVERITIES) }).strict(),
  z.object({ action: z.literal("dismiss"), id: z.number().int().positive(), note: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal("restore"), id: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("resolve"), id: z.number().int().positive(), note: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal("recovery"), id: z.number().int().positive(), recleanStatus: z.enum(RECLEAN_STATUSES), refundStatus: z.enum(REFUND_STATUSES) }).strict(),
  z.object({ action: z.literal("separate"), id: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("merge"), id: z.number().int().positive(), intoId: z.number().int().positive() }).strict(),
]);
export type QualityIncidentAction = z.infer<typeof qualityIncidentActionSchema>;
