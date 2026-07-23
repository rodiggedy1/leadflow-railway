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
  /\bread(y|iness)\s+(for|check)\b/i,
  /\bget\s+ready\b/i,
  /\bprepare\s+(for|tomorrow)\b/i,
  /\bprepared\b/i,

  // Tomorrow / date + attention / issues / problems
  /\btomorrow[''s]*\s+(jobs?|schedule|briefing|summary|status|issues?|problems?|attention)\b/i,
  /\b(what|show|list|any)\b.*\btomorrow\b.*\b(issues?|problems?|attention|risk|ready|confirm|payment|assign)\b/i,
  /\bneed[s]?\s+attention\b/i,
  /\bat\s+risk\b/i,

  // Specific dimension questions
  /\bwhich\s+jobs?\b.*\b(aren[''t]t?\s+confirmed|not\s+confirmed|unconfirmed)\b/i,
  /\bwhich\s+jobs?\b.*\b(no\s+cleaner|unassigned|not\s+assigned)\b/i,
  /\bwhich\s+jobs?\b.*\b(payment|no\s+card|no\s+payment)\b/i,
  /\bwhich\s+jobs?\b.*\b(access|instructions?)\b/i,
  /\bwhich\s+(afternoon|morning|evening)\s+jobs?\b/i,
  /\bshow\s+(me\s+)?(only\s+)?(the\s+)?\d+\s*(am|pm)\s+jobs?\b/i,
  /\bjobs?\s+(at|with)\s+(risk|issues?|problems?)\b/i,

  // Confirmation / payment / assignment questions
  /\b(confirm|confirmed|confirmation)\s+(status|issues?|problems?)\b/i,
  /\b(payment|card)\s+(issues?|problems?|status)\b/i,
  /\b(assign|assigned|assignment)\s+(issues?|problems?|status)\b/i,

  // "Are we ready" patterns
  /\bare\s+(we|they)\s+ready\b/i,
  /\bare\s+there\s+(any\s+)?(issues?|problems?|access\s+issues?)\b/i,
];

export function isReadinessDomain(message: string): boolean {
  return READINESS_PATTERNS.some((p) => p.test(message));
}
