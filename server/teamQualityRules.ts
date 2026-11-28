// Phase 2: free, deterministic classification for signals that arrive without an AI category (the voice assistant's
// complaint tool text, the Gmail glance summary). No AI call. Claude's own label for the same visit always wins
// (see teamQualityIncidents: a stronger detector's category replaces a rule-based one when they merge).
import type { QualityCategory, QualitySeverity } from "../shared/teamQualityIncidents";

const has = (text: string, patterns: RegExp[]) => patterns.some(pattern => pattern.test(text));
// Order matters: billing/scheduling/office first, so "charged for a cleaning that was dirty" still finds the cleaning issue below.
const CLEANING = [/\b(dirty|filthy|not clean(ed)?|wasn'?t clean(ed)?|didn'?t clean|did not clean|missed|skipped|left (out|undone)|not done|unfinished|sloppy|streak|dust(y)?|hair (left|everywhere)|stain|sticky|grimy|mold|smell(s|y)?|poor (job|quality|cleaning)|bad (job|cleaning)|re-?clean|redo|come back|not satisfied|unhappy with the (clean|service))\b/i, /\b(damag(e|ed)|broke(n)?|scratch(ed)?|ruin(ed)?)\b/i];
const TEAM = [/\b(rude|unprofessional|late|no[- ]?show|didn'?t show|never (showed|came|arrived)|rushed|left early|on (their|her|his) phone|attitude)\b/i];
const BILLING = [/\b(charg(e|ed|es)|overcharg|double[- ]?charg|bill(ed|ing)?|invoice|payment|card|price|pric(ing|ed)|cost|fee|discount|promo)\b/i];
const SCHEDULING = [/\b(reschedul|cancel|book(ing)?|appointment|wrong (day|date|time)|availability)\b/i];
const OFFICE = [/\b(no one (called|answered|responded)|never (called|responded|replied|heard back)|customer service|office|hold|voicemail|call(ed)? back)\b/i];
const SEVERE = [/\b(damag(e|ed)|broke(n)?|ruin(ed)?|stolen|theft|unsafe|injur|no[- ]?show|never (showed|came|arrived)|refund|disgust|terrible|worst)\b/i];

/** Category, severity and whether this is the cleaning team's responsibility, from the signal's own text. */
export function classifyComplaintText(text: string | null | undefined): { category: QualityCategory; severity: QualitySeverity } {
  const value = (text ?? "").trim();
  if (!value) return { category: "unclassified", severity: "low" };
  const severity: QualitySeverity = has(value, SEVERE) ? "high" : "medium";
  if (has(value, CLEANING)) return { category: "cleaning_quality", severity };
  if (has(value, TEAM)) return { category: "team_service", severity };
  if (has(value, BILLING)) return { category: "pricing_billing", severity };
  if (has(value, SCHEDULING)) return { category: "scheduling", severity };
  if (has(value, OFFICE)) return { category: "office_service", severity };
  return { category: "unclassified", severity: "low" };
}
/** A completed reclean visit, from the job record itself (service name or a zero-priced visit noted as a reclean). */
export function isRecleanJob(job: { serviceName?: string | null; customerNotes?: string | null; extras?: string | null; jobTotalCents?: number | null }): boolean {
  const named = /\b(re-?clean|re-?cleaning|touch[- ]?up|redo)\b/i;
  if (named.test(job.serviceName ?? "")) return true;
  return (job.jobTotalCents ?? null) === 0 && (named.test(job.customerNotes ?? "") || named.test(job.extras ?? ""));
}
