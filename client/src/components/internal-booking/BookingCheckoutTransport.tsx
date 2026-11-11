import { createContext, useContext, type ReactNode } from "react";

export type PublicCheckoutReservation = {
  publicFunnelNumber: string;
  mutationToken: string;
};
export type InternalCheckoutReservation = {
  kind: "internal";
  bookingId: number;
  publicBookingNumber: string;
};
export type BookingCheckoutReservation = PublicCheckoutReservation | InternalCheckoutReservation;
export type BookingCheckoutCompletion = {
  bookingId: number;
  cardBrand: string;
  cardLast4: string;
  portalAccessCode?: string | null;
  directPortalSessionReady?: boolean;
  finalizationRequired?: boolean;
};
export type BookingCheckoutSetup = {
  bookingId: number;
  alreadyComplete: boolean;
  clientSecret: string | null;
  setupIntentId: string | null;
  portalAccessCode?: string | null;
  directPortalSessionReady?: boolean;
};
export type BookingCashAppPreparation = {
  bookingId: number;
  paymentIntentId: string;
  clientSecret: string;
  returnToken: string;
  totalCents: number;
};

/** Only the authenticated internal wrapper supplies this transport. Public callers retain their existing tRPC requests. */
export interface InternalBookingCheckoutTransport {
  startSetup: (reservation: InternalCheckoutReservation) => Promise<BookingCheckoutSetup>;
  confirmSetup: (input: InternalCheckoutReservation & {
    paymentMethodId: string;
    consentAccepted: true;
    deferConfirmation: true;
    wallet?: "apple_pay" | "google_pay";
  }) => Promise<BookingCheckoutCompletion>;
  prepareCashApp: (reservation: InternalCheckoutReservation) => Promise<BookingCashAppPreparation>;
  settleCashApp: (input: InternalCheckoutReservation & { paymentIntentId: string }) => Promise<unknown>;
  abandonCashApp: (input: InternalCheckoutReservation & { paymentIntentId: string }) => Promise<{
    abandoned?: boolean;
    alreadySucceeded?: boolean;
  }>;
}
const Context = createContext<InternalBookingCheckoutTransport | null>(null);
export function InternalBookingCheckoutProvider({ value, children }: {
  value: InternalBookingCheckoutTransport;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useInternalBookingCheckoutTransport = () => useContext(Context);

export function publicCheckoutReservation(reservation: BookingCheckoutReservation): PublicCheckoutReservation {
  if ("kind" in reservation) throw new Error("The internal checkout connection is unavailable. Please try again.");
  return reservation;
}
export function internalCheckoutReservation(reservation: BookingCheckoutReservation): InternalCheckoutReservation {
  if (!("kind" in reservation) || reservation.kind !== "internal") {
    throw new Error("The internal booking connection is unavailable. Please try again.");
  }
  return reservation;
}
