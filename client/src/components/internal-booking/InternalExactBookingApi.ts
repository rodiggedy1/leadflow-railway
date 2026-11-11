import type { CanonicalBookingDraft } from "@shared/canonicalBooking";
import { createCanonicalBookingInput, createCanonicalPricingInput } from "@shared/canonicalBooking";
import { calculatePublicBookingPrice, PUBLIC_BOOKING_PRICING_VERSION } from "@shared/publicBookingPricing";
import { bookingArrivalPreferenceSchema } from "@shared/bookingArrival";
import type {
  BookingCheckoutCompletion,
  BookingCheckoutSetup,
  BookingCashAppPreparation,
} from "./BookingCheckoutTransport";
import type { InternalBookingSubmission } from "./InternalBookingAdapter";

export type NativePreparedBooking = {
  bookingId: number;
  publicBookingNumber: string;
  publicFunnelNumber: string;
  stage: "payment_incomplete" | "booked";
  version: number;
  created: boolean;
  totalCents: number;
  firstCleaningTotalCents: number;
  futureVisitTotalCents: number | null;
  paymentMethod: "card" | "cashapp" | "invoice";
  paymentStatus: string;
  unpaid: boolean;
};

export function createInternalExactPrepareInput(input: InternalBookingSubmission, withoutPayment: boolean) {
  const draft: CanonicalBookingDraft = {
    ...input.draft,
    arrivalPreference: bookingArrivalPreferenceSchema.parse(input.draft.arrivalPreference),
    customerName: input.draft.customerName.trim(),
    customerPhone: input.draft.customerPhone.trim(),
    customerEmail: input.draft.customerEmail.trim(),
    address: input.draft.address.trim(),
    specialRequestNotes: input.draft.specialRequestNotes.map(note => note.trim()).filter(Boolean),
  };
  const pricing = createCanonicalPricingInput(draft);
  const { idempotencyKey: _canonicalKey, ...booking } = createCanonicalBookingInput(draft, {
    idempotencyKey: input.idempotencyKey,
    surface: "popup",
    acceptedPricingVersion: PUBLIC_BOOKING_PRICING_VERSION,
    acceptedTotalCents: calculatePublicBookingPrice(pricing).firstCleaningTotalCents,
  });
  return {
    idempotencyKey: input.idempotencyKey,
    paymentMethod: withoutPayment ? "invoice" as const : input.paymentMethod,
    withoutPayment,
    companyNotes: null,
    booking: { ...booking, pricing: { ...pricing, extras: [...pricing.extras], arrivalPreference: draft.arrivalPreference! } },
  };
}
export type InternalExactPrepareInput = ReturnType<typeof createInternalExactPrepareInput>;
export interface InternalExactBookingApi {
  prepare: (input: InternalExactPrepareInput) => Promise<NativePreparedBooking>;
  startSetup: (input: { bookingId: number }) => Promise<BookingCheckoutSetup>;
  confirmSetup: (input: {
    bookingId: number;
    paymentMethodId: string;
    consentAccepted: true;
    deferConfirmation: true;
    wallet?: "apple_pay" | "google_pay";
  }) => Promise<BookingCheckoutCompletion>;
  finalize: (input: { bookingId: number }) => Promise<{
    bookingId: number;
    paymentStatus: "card_on_file";
    cardBrand: string | null;
    cardLast4: string | null;
    directPortalSessionReady: false;
  }>;
  prepareCashApp: (input: { bookingId: number }) => Promise<BookingCashAppPreparation>;
  settleCashApp: (input: { bookingId: number; paymentIntentId: string }) => Promise<unknown>;
  abandonCashApp: (input: { bookingId: number; paymentIntentId: string }) => Promise<{
    abandoned: boolean;
    alreadySucceeded?: boolean;
  }>;
}

export function internalBookingErrorMessage(error: unknown): string {
  const fallback = "We could not complete this booking. Please try again.";
  if (!(error instanceof Error)) return fallback;
  const code = (error as Error & { data?: { code?: string } }).data?.code;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return "Your staff session could not be verified. Please sign in again.";
  if (code === "BAD_REQUEST" || /^[\s]*[\[{]/.test(error.message)) return "Please review the booking details and try again.";
  if (code === "NOT_FOUND") return "The internal booking service is unavailable. Please try again later.";
  return error.message || fallback;
}
