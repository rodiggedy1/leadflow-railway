import type { InternalBookingSubmission } from "./InternalBookingAdapter";
import type { InternalCheckoutReservation } from "./BookingCheckoutTransport";
import {
  createInternalExactPrepareInput,
  internalBookingErrorMessage,
  type InternalExactBookingApi,
  type NativePreparedBooking,
} from "./InternalExactBookingApi";

/** One mount owns one UUID and one native target. A prepared target is never recreated or repriced. */
export function createInternalExactBookingSession() {
  let prepared: NativePreparedBooking | null = null;
  let pending: Promise<InternalCheckoutReservation> | null = null;
  let pendingWithoutPayment: boolean | null = null;
  const reservation = (booking: NativePreparedBooking): InternalCheckoutReservation => ({
    kind: "internal",
    bookingId: booking.bookingId,
    publicBookingNumber: booking.publicBookingNumber,
  });
  return {
    get prepared() { return prepared; },
    async prepare(api: InternalExactBookingApi, submission: InternalBookingSubmission, withoutPayment: boolean) {
      if (prepared) {
        if (withoutPayment) throw new Error("Payment preparation has started. Retry checkout for this booking instead.");
        return reservation(prepared);
      }
      if (pending) {
        if (pendingWithoutPayment !== withoutPayment) throw new Error("This booking is already being prepared. Please wait.");
        return pending;
      }
      const input = createInternalExactPrepareInput(submission, withoutPayment);
      pendingWithoutPayment = withoutPayment;
      pending = (async () => {
        try {
          const result = await api.prepare(input);
          // Retain the actual persisted target even if a returned completion state is unexpected.
          prepared = result;
          if (withoutPayment && (result.stage !== "booked" || !result.unpaid || result.paymentMethod !== "invoice")) {
            throw new Error("The booking was created, but its unpaid status could not be confirmed. Review it in the bookings CRM.");
          }
          return reservation(result);
        } catch (error) {
          throw new Error(internalBookingErrorMessage(error));
        } finally {
          pending = null;
          pendingWithoutPayment = null;
        }
      })();
      return pending;
    },
    requireTarget(target?: InternalCheckoutReservation) {
      if (!prepared || (target && target.bookingId !== prepared.bookingId)) {
        throw new Error("The internal booking connection could not be verified. Please try again.");
      }
      return prepared.bookingId;
    },
  };
}
