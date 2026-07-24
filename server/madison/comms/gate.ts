/**
 * server/madison/comms/gate.ts
 * Domain gate for the Madison Communications domain.
 * Score >= threshold → domain match.
 * Call-only requests ("call Maria") are blocked — they fall through to legacy.
 */
export interface CommsGateDiagnostics {
  score: number;
  threshold: number;
  gateMatched: boolean;
  matchedKeywords: string[];
  blockedByCallOnly: boolean;
}

const SMS_KEYWORDS = [
  "text",
  "send a text",
  "send text",
  "message",
  "sms",
  "msg",
  "shoot a message",
  "shoot them a message",
  "shoot a text",
  "let them know",
  "tell them",
  "tell the",
  "tell everyone",
  "tell today",
  "tell tomorrow",
  "notify",
  "ping",
  "reach out",
  "drop a message",
  "drop them",
];

const CALL_ONLY_PATTERNS = [
  /^call\b/i,
  /^place a call/i,
  /^make a call/i,
  /^give .+ a call/i,
  /^phone\b/i,
  /^ring\b/i,
];

const THRESHOLD = 1;

export function evaluateCommsGate(message: string): CommsGateDiagnostics {
  const lower = message.toLowerCase().trim();
  const blockedByCallOnly = CALL_ONLY_PATTERNS.some(p => p.test(lower));
  if (blockedByCallOnly) {
    return { score: 0, threshold: THRESHOLD, gateMatched: false, matchedKeywords: [], blockedByCallOnly: true };
  }
  const matchedKeywords: string[] = [];
  for (const kw of SMS_KEYWORDS) {
    if (lower.includes(kw)) matchedKeywords.push(kw);
  }
  const score = matchedKeywords.length;
  return { score, threshold: THRESHOLD, gateMatched: score >= THRESHOLD, matchedKeywords, blockedByCallOnly: false };
}

export function isCommsDomain(message: string): boolean {
  return evaluateCommsGate(message).gateMatched;
}
