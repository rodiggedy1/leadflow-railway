import type { CanonicalBookingDraft } from "@shared/canonicalBooking";
import type { InternalCheckoutReservation } from "./BookingCheckoutTransport";

export type InternalBookingSubmission = {
  draft: CanonicalBookingDraft;
  idempotencyKey: string;
  paymentMethod: "card" | "cashapp";
};
export interface InternalBookingAdapter {
  isSaving: boolean;
  readonly hasPrepared?: boolean;
  readonly bookingId?: number;
  prepare: (input: InternalBookingSubmission) => Promise<InternalCheckoutReservation>;
  bookWithoutPayment: (input: InternalBookingSubmission) => Promise<InternalCheckoutReservation>;
  finalizeCard: () => Promise<void>;
  onCompleted: () => void;
}
