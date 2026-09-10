export const CUSTOMER_PORTAL_LATE_RESCHEDULE_FEE_CENTS = 7_000;
export const CUSTOMER_PORTAL_LATE_RESCHEDULE_WINDOW_MS = 24 * 60 * 60 * 1_000;

type RescheduleWindowInput = {
  scheduledAt: string | number | null | undefined;
  scheduledDate: string;
  now?: Date;
};

function businessDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`;
}

/**
 * Uses the authoritative service timestamp whenever available. The date-only
 * fallback preserves the same-day warning if a legacy booking has no timestamp.
 */
export function isCustomerPortalRescheduleWithin24Hours({ scheduledAt, scheduledDate, now = new Date() }: RescheduleWindowInput) {
  const parsed = scheduledAt === null || scheduledAt === undefined || scheduledAt === "" ? Number.NaN : new Date(scheduledAt).getTime();
  if (!Number.isNaN(parsed)) return parsed - now.getTime() <= CUSTOMER_PORTAL_LATE_RESCHEDULE_WINDOW_MS;
  return scheduledDate === businessDateKey(now);
}

export function formatCustomerPortalLateRescheduleFee() {
  return `$${(CUSTOMER_PORTAL_LATE_RESCHEDULE_FEE_CENTS / 100).toFixed(0)}`;
}
