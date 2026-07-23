/**
 * gate.ts
 *
 * Deterministic readiness-domain gate.
 * No LLM call — pure string matching.
 *
 * Returns true if the message is clearly a readiness question.
 * If false, the message falls through to the legacy concierge.
 */

const READINESS_PATTERNS: RegExp[] = [
  // Explicit readiness vocabulary
  /\breadiness\b/i,
  /\breadiness\s+(check|report|summary)\b/i,
  /\bprepare\s+(for\s+)?tomorrow\b/i,

  // Tomorrow / date + attention / issues / problems
  /\btomorrow[''s]*\s+(jobs?|schedule|briefing|summary|status|issues?|problems?|attention)\b/i,
  /\b(what|show|list|any)\b.*\btomorrow\b.*\b(issues?|problems?|attention|risk|ready|confirm|payment|assign)\b/i,
  /\bneed[s]?\s+attention\b/i,
  /\bat\s+risk\b/i,

  // Specific dimension questions
  /\bwhich\s+jobs?\b.*\b(aren[''']t?\s+confirmed|not\s+confirmed|unconfirmed)\b/i,
  /\bwhich\s+jobs?\b.*\b(no\s+cleaner|unassigned|not\s+assigned)\b/i,
  /\bwhich\s+jobs?\b.*\b(payment|no\s+card|no\s+payment)\b/i,
  /\bwhich\s+jobs?\b.*\b(access|instructions?)\b/i,
  /\bwhich\s+(afternoon|morning|evening)\s+jobs?\b/i,
  /\bshow\s+(me\s+)?(only\s+)?(the\s+)?\d+\s*(am|pm)\s+jobs?\b/i,
  /\bjobs?\s+(at|with)\s+(risk|issues?|problems?)\b/i,

  // Double-booking / schedule conflicts
  /\bdouble.{0,3}book(k?ed|k?ing|k?ings?)?\b/i,
  /\bschedule\s+(conflict|issue|problem)\b/i,
  /\bconflict(s|ing)?\b.*\b(job|cleaner|schedule|tomorrow|today)\b/i,
  /\b(cleaner|team)\b.*\b(double|conflict|overlap)\b/i,

  // Unassigned / no cleaner — standalone (without "which jobs" prefix)
  /\b(unassigned|no\s+cleaner|not\s+assigned)\b.*\b(job|jobs|tomorrow|today)\b/i,
  /\b(job|jobs)\b.*\b(unassigned|no\s+cleaner|not\s+assigned)\b/i,

  // Confirmation / payment / assignment questions
  /\b(confirm|confirmed|confirmation)\s+(status|issues?|problems?)\b/i,
  /\b(payment|card)\s+(issues?|problems?|status)\b/i,
  /\b(assign|assigned|assignment)\s+(issues?|problems?|status)\b/i,

  // "Are we ready" patterns — require tomorrow/today context to avoid false positives
  /\bare\s+(we|they)\s+ready\s+(for\s+)?tomorrow\b/i,
  /\bare\s+there\s+(any\s+)?(issues?|problems?|access\s+issues?)\s+(tomorrow|today|for\s+tomorrow)\b/i,
  /\bare\s+there\s+(any\s+)?(issues?|problems?)\s+(with\s+)?(tomorrow|today)['']s*\s+(jobs?|schedule)\b/i,

  // Action patterns — acknowledge / dismiss / mark handled
  /\b(acknowledge|dismiss|mark)\b.*\b(issue|issues?|problem|flag|item|job)\b/i,
  /\b(acknowledge|dismiss|mark)\b.*\b(that|those|all|these)\b/i,
  /\b(that[''s]*|those)\s+(ok|okay|fine|handled|noted|acknowledged|good)\b/i,
  /\bmark\s+(it|them|those|that)\s+(as\s+)?(ok|okay|fine|handled|noted|acknowledged)\b/i,
];

export function isReadinessDomain(message: string): boolean {
  return READINESS_PATTERNS.some((p) => p.test(message));
}
