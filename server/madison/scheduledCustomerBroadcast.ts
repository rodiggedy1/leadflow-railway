import { normalizePhone } from "../utils/phone";

export interface ScheduledCustomerJob {
  customerName: string | null;
  customerPhone: string | null;
  bookingStatus: string | null;
}

export interface ScheduledCustomerRecipient {
  cleanerProfileId: number;
  name: string;
  phone: string;
}

export interface ScheduledCustomerSelection {
  recipients: ScheduledCustomerRecipient[];
  excludedCount: number;
  excludedReasons: string[];
}

/**
 * Produces the reviewable, one-message recipient list for a selected service day.
 * It has no database writes and never sends SMS. The caller owns the date query.
 */
export function selectScheduledCustomerRecipients(
  jobs: ScheduledCustomerJob[],
  optedOutPhones: ReadonlySet<string>,
): ScheduledCustomerSelection {
  const recipients: ScheduledCustomerRecipient[] = [];
  const seenPhones = new Set<string>();
  const counts = { cancelled: 0, rescheduled: 0, missingPhone: 0, invalidPhone: 0, optedOut: 0, duplicate: 0 };

  for (const job of jobs) {
    if (job.bookingStatus === "cancelled") { counts.cancelled++; continue; }
    if (job.bookingStatus === "rescheduled") { counts.rescheduled++; continue; }
    if (!job.customerPhone?.trim()) { counts.missingPhone++; continue; }

    const phone = normalizePhone(job.customerPhone);
    if (!phone) { counts.invalidPhone++; continue; }
    if (optedOutPhones.has(phone)) { counts.optedOut++; continue; }
    if (seenPhones.has(phone)) { counts.duplicate++; continue; }

    seenPhones.add(phone);
    recipients.push({ cleanerProfileId: 0, name: job.customerName?.trim() || "Customer", phone });
  }

  const excludedReasons = [
    counts.cancelled > 0 ? `${counts.cancelled} cancelled job${counts.cancelled === 1 ? "" : "s"} excluded` : null,
    counts.rescheduled > 0 ? `${counts.rescheduled} rescheduled job${counts.rescheduled === 1 ? "" : "s"} excluded` : null,
    counts.missingPhone > 0 ? `${counts.missingPhone} customer${counts.missingPhone === 1 ? "" : "s"} excluded — no phone` : null,
    counts.invalidPhone > 0 ? `${counts.invalidPhone} customer${counts.invalidPhone === 1 ? "" : "s"} excluded — invalid phone` : null,
    counts.optedOut > 0 ? `${counts.optedOut} customer${counts.optedOut === 1 ? "" : "s"} excluded — opted out via STOP` : null,
    counts.duplicate > 0 ? `${counts.duplicate} duplicate same-day customer phone${counts.duplicate === 1 ? "" : "s"} excluded` : null,
  ].filter((reason): reason is string => Boolean(reason));

  return {
    recipients,
    excludedCount: Object.values(counts).reduce((total, count) => total + count, 0),
    excludedReasons,
  };
}
