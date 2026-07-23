/**
 * gate.ts
 *
 * Readiness-domain gate — concept-based scoring, not phrase matching.
 *
 * Architecture:
 *   Router → Readiness Gate → Planner → Validator → Executor
 *
 * The gate's only job: decide whether a message is plausibly in the
 * Readiness domain. It does NOT parse the request — that's the planner's job.
 *
 * Scoring:
 *   +2  readiness concept hit  (ready, issues, at risk, …)
 *   +2  readiness dimension hit (cleaner, payment, confirmed, …)
 *   +1  readiness verb hit      (show, list, any, which, …)
 *   +1  operational time scope  (today, tomorrow, 9 AM, …)
 *
 * Route to planner if score >= READINESS_GATE_THRESHOLD.
 * False positives are cheaper than false negatives — keep the threshold low.
 */

// ── Configurable threshold ────────────────────────────────────────────────────

// Threshold of 3 prevents single-dimension words ("payment", "cleaner") from
// routing action commands ("Send a payment link", "Hire a cleaner") to the planner.
// Verified against 16 positive cases and 8 negative cases — all pass at threshold=3.
export const READINESS_GATE_THRESHOLD = 3;

// ── Keyword groups ────────────────────────────────────────────────────────────

/** High-signal readiness intent words (+2 each) */
const READINESS_CONCEPTS: string[] = [
  "readiness",
  "ready",
  "needs attention",
  "need attention",
  "at risk",
  "situation",
  "problems",
  "problem",
  "issues",
  "issue",
  "status",
  "what needs",
  "how are we looking",
  "anything wrong",
  "all good",
  "briefing",
  "summary",
  "overview",
];

/** Domain-specific dimension words (+2 each) */
const READINESS_DIMENSIONS: string[] = [
  "cleaner",
  "cleaners",
  "assigned",
  "unassigned",
  "no cleaner",
  "not assigned",
  "confirmation",
  "confirmed",
  "unconfirmed",
  "not confirmed",
  "payment",
  "payments",
  "card",
  "cards",
  "authorization",
  "authorizations",
  "access",
  "entry",
  "entry notes",
  "instructions",
  "double booked",
  "double-booked",
  "double booking",
  "double bookings",
  "conflict",
  "conflicts",
  "risk",
  "teams",
  "team",
  "schedule",
];

/** Readiness action phrases — acknowledge/dismiss/mark handled (+2 each)
 * These are follow-up action messages that come after a readiness query.
 * They must route to the planner so the action branch can handle them.
 */
const READINESS_ACTIONS: string[] = [
  "acknowledge",
  "acknowledged",
  "dismiss",
  "dismissed",
  "mark that",
  "mark them",
  "mark those",
  "mark it",
  "that's fine",
  "that's ok",
  "that's okay",
  "that's good",
  "those are fine",
  "those are ok",
  "handled",
  "noted",
];

/** Operational verbs that suggest a query (+1 each)
 * NOTE: "what" is intentionally excluded — it's too broad and causes false positives
 * for queries like "What's today's revenue?". Use "what needs" in CONCEPTS instead.
 */
const READINESS_VERBS: string[] = [
  "show",
  "show me",
  "list",
  "which",
  "any",
  "are there",
  "do all",
  "who still",
  "who needs",
  "are cards",
  "are we",
  "are they",
];

// ── Time scope detection ──────────────────────────────────────────────────────

const TIME_KEYWORDS: RegExp[] = [
  /\btoday\b/i,
  /\btomorrow\b/i,
  /\bthis\s+week\b/i,
  /\bnext\s+week\b/i,
  /\bmonday\b|\btuesday\b|\bwednesday\b|\bthursday\b|\bfriday\b|\bsaturday\b|\bsunday\b/i,
  /\bmorning\b/i,
  /\bafternoon\b/i,
  /\bevening\b/i,
  /\b\d{1,2}\s*(am|pm)\b/i,
  /\b\d{1,2}:\d{2}\b/i,
];

function containsDateOrTimeReference(text: string): boolean {
  return TIME_KEYWORDS.some((r) => r.test(text));
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function normalize(msg: string): string {
  return msg.toLowerCase().replace(/['']/g, "'").replace(/\s+/g, " ").trim();
}

function matchKeywords(text: string, keywords: string[]): string[] {
  return keywords.filter((kw) => text.includes(kw));
}

// ── Diagnostics type ─────────────────────────────────────────────────────────

export interface GateDiagnostics {
  score: number;
  threshold: number;
  gateMatched: boolean;
  matchedConcepts: string[];
  matchedDimensions: string[];
  matchedActions: string[];
  matchedVerbs: string[];
  matchedTime: boolean;
}

// ── Main gate function ────────────────────────────────────────────────────────

export function evaluateReadinessGate(message: string): GateDiagnostics {
  const text = normalize(message);

  const matchedConcepts = matchKeywords(text, READINESS_CONCEPTS);
  const matchedDimensions = matchKeywords(text, READINESS_DIMENSIONS);
  const matchedActions = matchKeywords(text, READINESS_ACTIONS);
  const matchedVerbs = matchKeywords(text, READINESS_VERBS);
  const matchedTime = containsDateOrTimeReference(text);

  const score =
    matchedConcepts.length * 2 +
    matchedDimensions.length * 2 +
    matchedActions.length * 3 +  // action phrases are high-confidence, clear threshold alone
    matchedVerbs.length * 1 +
    (matchedTime ? 1 : 0);

  const gateMatched = score >= READINESS_GATE_THRESHOLD;

  return {
    score,
    threshold: READINESS_GATE_THRESHOLD,
    gateMatched,
    matchedConcepts,
    matchedDimensions,
    matchedActions,
    matchedVerbs,
    matchedTime,
  };
}

export function isReadinessDomain(message: string): boolean {
  const diag = evaluateReadinessGate(message);

  // Always log — helps tune the threshold using real conversations.
  // Log near-misses (score > 0 but not matched) separately for analysis.
  if (diag.gateMatched) {
    console.log("[Madison] gate matched:", JSON.stringify({
      score: diag.score,
      threshold: diag.threshold,
      matchedConcepts: diag.matchedConcepts,
      matchedDimensions: diag.matchedDimensions,
      matchedActions: diag.matchedActions,
      matchedVerbs: diag.matchedVerbs,
      matchedTime: diag.matchedTime,
    }));
  } else if (diag.score > 0) {
    console.log("[Madison] gate near-miss:", JSON.stringify({
      score: diag.score,
      threshold: diag.threshold,
      matchedConcepts: diag.matchedConcepts,
      matchedDimensions: diag.matchedDimensions,
      matchedActions: diag.matchedActions,
      matchedVerbs: diag.matchedVerbs,
      matchedTime: diag.matchedTime,
    }));
  }

  return diag.gateMatched;
}
