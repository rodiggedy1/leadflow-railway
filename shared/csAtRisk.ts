export const AT_RISK_MIN_AGE_MS = 30 * 60 * 1000;
export const AT_RISK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function qualifiesForAtRisk({
  lastSenderRole,
  lastCustomerMessageTs,
  now,
}: {
  lastSenderRole: string | null | undefined;
  lastCustomerMessageTs: number | null | undefined;
  now: number;
}): boolean {
  if (lastSenderRole !== "user" || lastCustomerMessageTs == null) return false;

  return (
    lastCustomerMessageTs <= now - AT_RISK_MIN_AGE_MS &&
    lastCustomerMessageTs >= now - AT_RISK_MAX_AGE_MS
  );
}
