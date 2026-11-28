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
  evidenceQuote?: string | null; evidenceText?: string | null;
};

// Owner rule (2026-11-28): only the quality of the cleaning performed counts (missed areas, incomplete cleaning, poor
// workmanship, damage during cleaning, and the recleans/refunds for those). Arrival and scheduling issues never count:
// late arrivals, arrival windows, "where are my cleaners / is anyone coming", delays, appointment changes, missed
// appointments, and refunds caused by them. Applied when scores are calculated, so saved records are kept unchanged.
const ARRIVAL_OR_SCHEDULING = [
  /\blate\b|\blateness\b|running behind|\bdelay(ed|s)?\b/i,
  /\barriv(e|ed|al|ing)\b|\bon (their|the|her|his) way\b|\beta\b/i,
  /\bwhere (are|is)\b|\b(is|are) (any|some)(one|body) (coming|here|on)\b|\bnobody (came|showed|is here)\b|\bno one (came|showed|is here)\b|\bwaiting (for|on)\b/i,
  /\bno[- ]?show\b|\bdid ?n[o']t (show|come)\b|\bnever (showed|came|arrived)\b|\bmissed (my|the|our|her|his|their)? ?(appointment|visit|cleaning|booking)\b/i,
  /\bwindow\b|\breschedul|\bappointment\b|\bcancel|\bbooking\b|\bscheduling\b|\bwrong (day|date|time)\b/i,
];
// Words about the cleaning itself. "missed appointment/visit" is removed first, so only missed AREAS count.
const CLEANING_QUALITY = /\b(dirty|filthy|not clean(ed)?|was ?n[o']t clean(ed)?|did ?n[o']t clean|did not clean|missed|skipped|left (out|undone)|not done|unfinished|incomplete|sloppy|streak|dust(y)?|hair|stain|sticky|grim(e|y)|mold|smell|poor (job|quality|work)|bad (job|cleaning)|re-?clean|redo|not satisfied|floor|kitchen|bathroom|toilet|shower|tub|sink|counter|oven|stove|fridge|refrigerator|baseboard|window ?sill|mirror|carpet|vacuum|mop|damag(e|ed)|broke(n)?|scratch(ed)?|crack(ed)?)\b/i;
const MISSED_VISIT = /\bmissed (my|the|our|her|his|their)? ?(appointment|visit|cleaning|booking)\b/gi;
/** True when a complaint is about arrival or scheduling and says nothing about the cleaning itself. */
export function isArrivalOrSchedulingOnly(text: string | null | undefined): boolean {
  const value = (text ?? "").trim();
  if (!value || !ARRIVAL_OR_SCHEDULING.some(pattern => pattern.test(value))) return false;
  return !CLEANING_QUALITY.test(value.replace(MISSED_VISIT, " "));
}
/** Why a saved incident does not count against a team (null when it counts). Shown next to the kept record. */
export function qualityExclusionReason(incident: IncidentForScoring): string | null {
  if (incident.status === "dismissed") return "dismissed by staff";
  if (incident.processingStatus !== "ok") return "not processed yet";
  if (incident.attribution === "unattributed" || incident.teamId === null || incident.leadflowJobId === null) return "not matched to a visit";
  if (incident.category === "team_service") return "not about the cleaning (arrival, timing or conduct)";
  if (incident.category !== "cleaning_quality") return "not the cleaning team's responsibility";
  if (isArrivalOrSchedulingOnly([incident.evidenceQuote, incident.evidenceText].filter(Boolean).join(" \n "))) return "arrival or scheduling issue, not cleaning quality";
  return null;
}
/** One incident counts once against one team, automatically, only when it is about the quality of the cleaning,
 * matched to a visit and team, processed, and not dismissed by a staff override. */
export function countsAgainstTeam(incident: IncidentForScoring): boolean {
  return qualityExclusionReason(incident) === null;
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
