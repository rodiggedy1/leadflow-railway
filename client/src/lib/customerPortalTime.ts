const CUSTOMER_PORTAL_TIME_ZONE = "America/New_York";

/**
 * Formats confirmed ISO service timestamps in the portal's established business
 * timezone while preserving local appointment-window labels entered by customers.
 */
export function formatCustomerPortalServiceTime(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "Time will be confirmed";

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: CUSTOMER_PORTAL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}
