export const AT_RISK_MIN_AGE_MS = 30 * 60 * 1000;
export const AT_RISK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type UnansweredUrgencyWindow = "needs_response" | "at_risk" | "expired" | "not_unanswered";

export function getUnansweredUrgencyWindow({
  lastSenderRole,
  lastCustomerMessageTs,
  now,
}: {
  lastSenderRole: string | null | undefined;
  lastCustomerMessageTs: number | null | undefined;
  now: number;
}): UnansweredUrgencyWindow {
  if (lastSenderRole !== "user") return "not_unanswered";
  if (lastCustomerMessageTs == null) return "needs_response";

  const ageMs = now - lastCustomerMessageTs;

  if (ageMs <= AT_RISK_MIN_AGE_MS) return "needs_response";
  if (ageMs <= AT_RISK_MAX_AGE_MS) return "at_risk";
  return "expired";
}

export function qualifiesForAtRisk(input: {
  lastSenderRole: string | null | undefined;
  lastCustomerMessageTs: number | null | undefined;
  now: number;
}): boolean {
  return getUnansweredUrgencyWindow(input) === "at_risk";
}
