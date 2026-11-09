import { InvoiceError, invoiceDate } from "../shared/payableInvoice";

export type InvoiceOccurrence = { kind: "job"; id: number } | { kind: "booking"; id: number; date: string };
export function invoiceOccurrence(key: string): InvoiceOccurrence {
  const job = /^job:([1-9]\d*)$/.exec(key);
  const booking = /^booking:([1-9]\d*):first:(\d{4}-\d{2}-\d{2})$/.exec(key);
  const id = Number(job?.[1] ?? booking?.[1]);
  if (!Number.isSafeInteger(id) || id <= 0 || (!job && (!booking || !invoiceDate.safeParse(booking[2]).success))) {
    throw new InvoiceError("INVALID_SNAPSHOT", 409, "A stable service occurrence identity is required.");
  }
  return job ? { kind: "job", id } : { kind: "booking", id, date: booking![2] };
}

export const PRIOR_PAYMENT_REVIEW_REASON = "Prior external/manual payments and completion are not verified. Review this current service snapshot and explicitly confirm it remains unpaid before issuing.";
const normalized = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const paid = new Set(["captured", "paid", "succeeded", "charged", "payment_charged"]);
const pending = new Set(["pending", "pending_card", "authorization_pending", "authorized", "capture_pending", "charge_pending", "processing", "requires_capture", "action_required"]);
export type PaymentObservation = { status?: unknown; paymentStatus?: unknown; capturedAt?: unknown; paidAt?: unknown; paymentChargedAt?: unknown; stripePaymentIntentId?: unknown; authorizedAt?: unknown; cancelledAt?: unknown };

/** Only rows bound to the exact native booking/profile may be passed here.
 * A saved card/setup is not payment. Clock expiry alone never releases a hold.
 * Missing observations do not prove unpaid; they require explicit human review.
 */
export function observedCollectionReason(observation: PaymentObservation): string | null {
  const status = normalized(observation.paymentStatus ?? observation.status);
  if (observation.capturedAt != null || observation.paidAt != null || observation.paymentChargedAt != null || paid.has(status)) return "A captured or charged payment is already recorded for this service.";
  if (pending.has(status) || (observation.authorizedAt != null && !["cancelled", "canceled", "expired", "failed"].includes(status))) return "A pending payment or authorized card hold already owns collection for this service.";
  if (observation.stripePaymentIntentId && !["cancelled", "canceled", "expired", "failed"].includes(status)) return "An unresolved payment intent already exists for this service.";
  if (!status) return "An existing payment record has no valid status and needs review.";
  return null;
}

export function validServiceStatus(status: unknown): boolean {
  const value = normalized(status);
  return !!value && !["cancelled", "canceled", "rescheduled", "missing_from_launch27", "void"].includes(value);
}
