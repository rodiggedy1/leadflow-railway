import { useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import type { InternalBookingAdapter } from "./InternalBookingAdapter";
import type { InternalBookingCheckoutTransport } from "./BookingCheckoutTransport";
import {
  internalBookingErrorMessage,
  type InternalExactBookingApi,
} from "./InternalExactBookingApi";
import { createInternalExactBookingSession } from "./InternalExactBookingSession";

/** Authenticated native-only endpoints; there is no public-funnel creation fallback. */
export function useInternalExactBooking() {
  const internalExact = trpc.bookings.internalExact;
  const prepare = internalExact.prepare.useMutation();
  const startSetup = internalExact.startSetup.useMutation();
  const confirmSetup = internalExact.confirmSetup.useMutation();
  const finalize = internalExact.finalize.useMutation();
  const prepareCashApp = internalExact.prepareCashApp.useMutation();
  const settleCashApp = internalExact.settleCashApp.useMutation();
  const abandonCashApp = internalExact.abandonCashApp.useMutation();
  const utils = trpc.useUtils();
  const sessionRef = useRef<ReturnType<typeof createInternalExactBookingSession> | null>(null);
  if (!sessionRef.current) sessionRef.current = createInternalExactBookingSession();
  const session = sessionRef.current;
  const api = useMemo<InternalExactBookingApi>(() => ({
    prepare: prepare.mutateAsync,
    startSetup: startSetup.mutateAsync,
    confirmSetup: confirmSetup.mutateAsync,
    finalize: finalize.mutateAsync,
    prepareCashApp: prepareCashApp.mutateAsync,
    settleCashApp: settleCashApp.mutateAsync,
    abandonCashApp: abandonCashApp.mutateAsync,
  }), [prepare.mutateAsync, startSetup.mutateAsync, confirmSetup.mutateAsync, finalize.mutateAsync, prepareCashApp.mutateAsync, settleCashApp.mutateAsync, abandonCashApp.mutateAsync]);
  const isSaving = prepare.isPending || startSetup.isPending || confirmSetup.isPending || finalize.isPending || prepareCashApp.isPending || settleCashApp.isPending || abandonCashApp.isPending;
  const adapter = useMemo<InternalBookingAdapter>(() => ({
    isSaving,
    get hasPrepared() { return session.prepared !== null; },
    prepare: submission => session.prepare(api, submission, false),
    bookWithoutPayment: submission => session.prepare(api, submission, true),
    finalizeCard: async () => {
      try {
        await api.finalize({ bookingId: session.requireTarget() });
      } catch (error) {
        throw new Error(internalBookingErrorMessage(error));
      }
    },
    onCompleted: () => { void utils.bookings.invalidate(); },
  }), [api, isSaving, session, utils]);
  const checkoutTransport = useMemo<InternalBookingCheckoutTransport>(() => ({
    startSetup: async target => {
      try { return await api.startSetup({ bookingId: session.requireTarget(target) }); }
      catch (error) { throw new Error(internalBookingErrorMessage(error)); }
    },
    confirmSetup: async input => {
      try {
        return await api.confirmSetup({
          bookingId: session.requireTarget(input),
          paymentMethodId: input.paymentMethodId,
          consentAccepted: true,
          deferConfirmation: true,
          ...(input.wallet ? { wallet: input.wallet } : {}),
        });
      } catch (error) { throw new Error(internalBookingErrorMessage(error)); }
    },
    prepareCashApp: async target => {
      try { return await api.prepareCashApp({ bookingId: session.requireTarget(target) }); }
      catch (error) { throw new Error(internalBookingErrorMessage(error)); }
    },
    settleCashApp: async input => {
      try { return await api.settleCashApp({ bookingId: session.requireTarget(input), paymentIntentId: input.paymentIntentId }); }
      catch (error) { throw new Error(internalBookingErrorMessage(error)); }
    },
    abandonCashApp: async input => {
      try { return await api.abandonCashApp({ bookingId: session.requireTarget(input), paymentIntentId: input.paymentIntentId }); }
      catch (error) { throw new Error(internalBookingErrorMessage(error)); }
    },
  }), [api, session]);
  return { adapter, checkoutTransport };
}
