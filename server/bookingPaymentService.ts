import type { BookingPaymentOperation, BookingPaymentStatus } from "../shared/bookingPayment";

export class BookingPaymentStateError extends Error {}

const PAYMENT_TRANSITIONS: Record<BookingPaymentStatus, readonly BookingPaymentStatus[]> = {
  not_started: ["setup_pending"],
  setup_pending: ["card_on_file", "failed", "action_required"],
  card_on_file: ["authorization_pending", "charge_pending"],
  authorization_pending: ["authorized", "failed", "action_required"],
  authorized: ["capture_pending", "cancelled", "expired"],
  capture_pending: ["captured", "failed", "action_required"],
  charge_pending: ["captured", "failed", "action_required"],
  captured: [],
  failed: ["setup_pending", "authorization_pending", "charge_pending"],
  action_required: ["setup_pending", "authorization_pending", "capture_pending", "charge_pending"],
  cancelled: ["authorization_pending", "charge_pending"],
  expired: ["authorization_pending", "charge_pending"],
};

export function assertBookingPaymentTransition(from: BookingPaymentStatus, to: BookingPaymentStatus): void {
  if (!PAYMENT_TRANSITIONS[from].includes(to)) {
    throw new BookingPaymentStateError(`Cannot transition booking payment from '${from}' to '${to}'.`);
  }
}

export function bookingPaymentIdempotencyKey(
  bookingId: number,
  operation: "setup" | BookingPaymentOperation,
  version: number,
): string {
  if (!Number.isInteger(bookingId) || bookingId < 1) throw new BookingPaymentStateError("Invalid booking payment identity.");
  if (!Number.isInteger(version) || version < 1) throw new BookingPaymentStateError("Invalid booking payment version.");
  return `leadflow:booking:${bookingId}:${operation}:v${version}`;
}

/** Booking checkout must never use phone matching as a payment identity. */
export function bookingPaymentMetadata(bookingId: number, profileId: number): Record<string, string> {
  if (!Number.isInteger(bookingId) || bookingId < 1 || !Number.isInteger(profileId) || profileId < 1) {
    throw new BookingPaymentStateError("Invalid booking payment metadata identity.");
  }
  return { source: "leadflow_booking", bookingId: String(bookingId), bookingPaymentProfileId: String(profileId) };
}
