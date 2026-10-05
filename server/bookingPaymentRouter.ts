import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bookingFunnelRecords,
  bookingPaymentProfiles,
  bookingSeries,
  bookings,
  leadflowJobs,
  stripeCustomers,
} from "../drizzle/schema";
import {
  BOOKING_PAYMENT_CONSENT_TEXT,
  BOOKING_PAYMENT_CONSENT_VERSION,
} from "../shared/bookingPayment";
import { NATIVE_BOOKING_PRICING_VERSION, type PrepareBookingInput } from "../shared/booking";
import { BOOKING_TIME_ZONE } from "../shared/easternTime";
import {
  PUBLIC_BOOKING_POST_BOOKING_UPSELLS,
  PUBLIC_BOOKING_PRICING_VERSION,
  isPublicBookingPriceSnapshot,
} from "../shared/publicBookingPricing";
import { router, publicProcedure } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { broadcastCleanerPortalJobsChanged } from "./cleanerPortalUpdates";
import { createBookingFunnelMutationToken, verifyBookingFunnelMutationToken } from "./bookingFunnelService";
import { buildPreparedNativeBooking, buildPreparedPublicBooking, NativeBookingInputError, type PreparePublicBookingInput } from "./bookingsService";
import { bookingPaymentIdempotencyKey, bookingPaymentMetadata } from "./bookingPaymentService";
import { verifyCanonicalCardSetup } from "./bookingPaymentVerification";
import { persistCanonicalBooking } from "./canonicalBookingPersistence";
import { applyCanonicalAdditionalServices, BookingUpsellInputError } from "./bookingUpsellEngine";
import { finalizeCanonicalCardOnFile, finalizeCanonicalBooking, reuseCanonicalSavedCard, startCanonicalCardSetup } from "./bookingPaymentEngine";
import { getStripeClient } from "./stripeClient";
import { sendBookingCompletionNotifications } from "./bookingCompletionNotifications";
import { createCanonicalBookingPortalHandoff, ensureCustomerPortalAccount } from "./customerPortalService";
import { getCustomerPortalSavedCard } from "./customerPortalPaymentService";
import { normalizePhone } from "./utils/phone";
import { getCustomerPortalSessionFromRequest, signCustomerPortalSession } from "./_core/customerPortalAuth";
import { getSessionCookieOptions } from "./_core/cookies";
import { CUSTOMER_PORTAL_COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";
import { TRPCError } from "@trpc/server";

function asBookingInput(record: typeof bookingFunnelRecords.$inferSelect): PrepareBookingInput {
  if (
    !record.customerEmail || !record.serviceId || !record.serviceName || record.bedrooms === null || record.bathrooms === null
    || !Array.isArray(record.extras) || !record.address || !record.requestedLocalDate || !record.requestedLocalTime
    || !record.recurrence || !record.pricingVersion || record.firstCleaningTotalCents === null
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Complete the reservation details before adding a card." });
  }
  if (!(["standard", "deep", "moveout"] as const).includes(record.serviceId as "standard" | "deep" | "moveout")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported service type." });
  }
  if (!(["one-time", "weekly", "biweekly", "monthly"] as const).includes(record.recurrence as "one-time" | "weekly" | "biweekly" | "monthly")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported recurring interval." });
  }
  const extras = record.extras.map((extra) => {
    if (!extra || typeof extra !== "object" || typeof (extra as { id?: unknown }).id !== "string" || !Number.isInteger((extra as { quantity?: unknown }).quantity)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid reservation extras." });
    }
    return { id: (extra as { id: string }).id, quantity: (extra as { quantity: number }).quantity };
  });
  return {
    idempotencyKey: record.idempotencyKey,
    surface: record.source === "book-page" ? "full_page" : "popup",
    customer: { fullName: record.customerName, phone: record.customerPhone, email: record.customerEmail },
    service: {
      serviceId: record.serviceId as "standard" | "deep" | "moveout",
      bedrooms: record.bedrooms,
      bathrooms: record.bathrooms,
      extras,
      specialRequestNotes: Array.isArray(record.specialRequestNotes) ? record.specialRequestNotes.filter((value): value is string => typeof value === "string") : [],
    },
    address: record.address,
    requestedSchedule: { localDate: record.requestedLocalDate, localTime: record.requestedLocalTime },
    recurrence: record.recurrence as "one-time" | "weekly" | "biweekly" | "monthly",
    acceptedPricing: { version: record.pricingVersion, totalCents: record.firstCleaningTotalCents },
  };
}

function asPublicBookingInput(record: typeof bookingFunnelRecords.$inferSelect): PreparePublicBookingInput {
  if (record.pricingVersion !== PUBLIC_BOOKING_PRICING_VERSION || !isPublicBookingPriceSnapshot(record.priceSnapshot)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The approved booking price is unavailable. Please review your booking." });
  }
  const booking = asBookingInput(record);
  return { ...booking, acceptedPricing: { version: PUBLIC_BOOKING_PRICING_VERSION, totalCents: record.firstCleaningTotalCents ?? 0 }, pricing: record.priceSnapshot.input };
}

function insertId(result: unknown, label: string): number {
  const value = Number((result as { insertId?: number }).insertId ?? (result as Array<{ insertId?: number }>)[0]?.insertId);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} insert did not return an ID.`);
  return value;
}

function affectedRows(result: unknown): number {
  const direct = result as { affectedRows?: number };
  const nested = (result as Array<{ affectedRows?: number }> | undefined)?.[0];
  return Number(direct?.affectedRows ?? nested?.affectedRows ?? 0);
}

async function ensureBookingPaymentTarget(record: typeof bookingFunnelRecords.$inferSelect) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
  if (record.stage !== "payment_incomplete") {
    throw new TRPCError({ code: "CONFLICT", message: "Reserve your appointment before adding a card." });
  }
  const built = record.pricingVersion === PUBLIC_BOOKING_PRICING_VERSION
    ? buildPreparedPublicBooking(asPublicBookingInput(record), { nowMs: Date.now(), timeZone: BOOKING_TIME_ZONE })
    : buildPreparedNativeBooking(asBookingInput(record), { nowMs: Date.now(), timeZone: BOOKING_TIME_ZONE });
  if (built.type === "price_changed") {
    throw new TRPCError({ code: "CONFLICT", message: "The quoted price changed. Please review the updated quote before continuing." });
  }
  const persisted = await persistCanonicalBooking(db, built.prepared, {
    funnelRecordId: record.id,
    bookingSource: record.source === "customer-booking-link" ? "full_page" : undefined,
    initialBookingStatus: "pending_payment",
  });
  const paymentProfile = await db.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, persisted.bookingId)).limit(1);
  if (!paymentProfile[0]) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking payment profile could not be created." });
  return { bookingId: persisted.bookingId, profile: paymentProfile[0], totalCents: built.prepared.firstCleaningTotalCents, customerName: built.prepared.customerName };
}
function verifiedFunnelTokenOrThrow(record: typeof bookingFunnelRecords.$inferSelect, mutationToken: string): void {
  if (!verifyBookingFunnelMutationToken(ENV.cookieSecret, mutationToken, record.publicFunnelNumber, record.idempotencyKey)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
  }
}

async function establishDirectPortalSession(
  ctx: Pick<TrpcContext, "req" | "res">,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  record: typeof bookingFunnelRecords.$inferSelect,
): Promise<boolean> {
  if (record.source !== "book-page") return false;
  try {
    const account = await ensureCustomerPortalAccount(db, {
      customerName: record.customerName,
      customerPhone: record.customerPhone,
      customerEmail: record.customerEmail,
    });
    const sessionToken = await signCustomerPortalSession({
      accountId: account.id,
      customerName: account.customerName,
      customerPhone: account.customerPhone,
    });
    ctx.res.cookie(CUSTOMER_PORTAL_COOKIE_NAME, sessionToken, {
      ...getSessionCookieOptions(ctx.req),
      maxAge: ONE_YEAR_MS,
    });
    return true;
  } catch (error) {
    console.error("[BookingPaymentRouter] Direct customer portal session creation failed:", error);
    return false;
  }
}

const publicFunnelInput = z.object({
  publicFunnelNumber: z.string().trim().min(1).max(40),
  mutationToken: z.string().trim().min(1).max(512),
});
const deferredConfirmationInput = publicFunnelInput.extend({ deferConfirmation: z.boolean().optional() });
const postBookingUpsellsInput = publicFunnelInput.extend({
  upsells: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    quantity: z.number().int().min(1).max(50),
  })).min(1).max(20),
});

export const bookingPaymentRouter = router({
  startSetup: publicProcedure
    .input(publicFunnelInput)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      const [record] = await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
      verifiedFunnelTokenOrThrow(record, input.mutationToken);
      const target = await ensureBookingPaymentTarget(record);
      const setup = await startCanonicalCardSetup(db, { bookingId: target.bookingId, customerName: target.customerName, profile: target.profile });
      if (setup.alreadyComplete) {
        const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);
        let portalAccessCode: string | null = null;
        if (record.source !== "book-page") {
          try {
            portalAccessCode = await createCanonicalBookingPortalHandoff(db, { customerName: record.customerName, customerPhone: record.customerPhone, customerEmail: record.customerEmail });
          } catch (error) {
            console.error("[BookingPaymentRouter] Customer portal handoff creation failed:", error);
          }
        }
        return { alreadyComplete: true, bookingId: target.bookingId, paymentStatus: "card_on_file" as const, portalAccessCode, directPortalSessionReady };
      }
      return { alreadyComplete: false, bookingId: target.bookingId, paymentStatus: "setup_pending" as const, clientSecret: setup.clientSecret! };
    }),
  reuseSavedCard: publicProcedure
    .input(deferredConfirmationInput)
    .mutation(async ({ input, ctx }) => {
      const session = await getCustomerPortalSessionFromRequest(ctx.req);
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "Open your portal to use a saved card." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      const [record] = await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
      verifiedFunnelTokenOrThrow(record, input.mutationToken);
      if (normalizePhone(record.customerPhone) !== session.customerPhone) throw new TRPCError({ code: "FORBIDDEN", message: "The saved card does not belong to this booking." });
      const target = await ensureBookingPaymentTarget(record);
      if (target.profile.paymentStatus === "card_on_file") {
        const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);
        return { bookingId: target.bookingId, paymentStatus: "card_on_file" as const, cardBrand: target.profile.cardBrand ?? "Card", cardLast4: target.profile.cardLast4 ?? "saved", directPortalSessionReady, finalizationRequired: input.deferConfirmation === true };
      }
      const savedCard = await getCustomerPortalSavedCard(db, session.customerPhone);
      if (!savedCard) throw new TRPCError({ code: "CONFLICT", message: "A saved card is not available. Please add a new card." });
      const reused = await reuseCanonicalSavedCard(db, { bookingId: target.bookingId, profile: target.profile, funnelId: record.id, customerName: record.customerName, customerPhone: record.customerPhone, savedCard, deferConfirmation: input.deferConfirmation });
      const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);
      return { ...reused, directPortalSessionReady };
    }),

  confirmSetup: publicProcedure
    .input(deferredConfirmationInput.extend({ paymentMethodId: z.string().trim().min(1).max(255), consentAccepted: z.literal(true) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      const [record] = await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
      verifiedFunnelTokenOrThrow(record, input.mutationToken);
      if (!record.bookingId) throw new TRPCError({ code: "CONFLICT", message: "Reserve your appointment before confirming a card." });
      const [profile] = await db.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, record.bookingId)).limit(1);
      if (!profile || !profile.stripeCustomerId || !profile.stripeSetupIntentId) throw new TRPCError({ code: "CONFLICT", message: "Start secure card entry before confirming it." });

      const stripe = getStripeClient();
      const paymentMethod = await verifyCanonicalCardSetup(stripe, {
        setupIntentId: profile.stripeSetupIntentId,
        paymentMethodId: input.paymentMethodId,
        bookingId: record.bookingId!,
        bookingPaymentProfileId: profile.id,
        stripeCustomerId: profile.stripeCustomerId!,
      });
      const now = new Date();
      await finalizeCanonicalCardOnFile(db, {
        bookingId: record.bookingId!,
        profileId: profile.id,
        profileVersion: profile.version,
        funnelId: record.id,
        stripeCustomerId: profile.stripeCustomerId,
        customerName: record.customerName,
        customerPhone: record.customerPhone,
        paymentMethod: { id: paymentMethod.id, brand: paymentMethod.card.brand, last4: paymentMethod.card.last4, exp_month: paymentMethod.card.exp_month, exp_year: paymentMethod.card.exp_year },
        deferConfirmation: input.deferConfirmation,
      });
      broadcastOpsUpdate("booking_funnel_update");
      if (!input.deferConfirmation) void sendBookingCompletionNotifications(record.bookingId).catch((error) =>
        console.error("[BookingPaymentRouter] Booking completion notifications failed:", error)
      );
      const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);
      let portalAccessCode: string | null = null;
      if (record.source !== "book-page") try {
        portalAccessCode = await createCanonicalBookingPortalHandoff(db, {
          customerName: record.customerName,
          customerPhone: record.customerPhone,
          customerEmail: record.customerEmail,
        });
      } catch (error) {
        // Portal access is additive. It must never turn a successful verified card save into a customer-facing failure.
        console.error("[BookingPaymentRouter] Customer portal handoff creation failed:", error);
      }
      return {
        bookingId: record.bookingId,
        paymentStatus: "card_on_file" as const,
        cardBrand: paymentMethod.card.brand,
        cardLast4: paymentMethod.card.last4,
        cardExpMonth: paymentMethod.card.exp_month,
        cardExpYear: paymentMethod.card.exp_year,
        portalAccessCode,
        directPortalSessionReady,
        finalizationRequired: input.deferConfirmation === true,
      };
    }),

  finalize: publicProcedure
    .input(publicFunnelInput)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      const [record] = await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
      verifiedFunnelTokenOrThrow(record, input.mutationToken);
      if (!record.bookingId) throw new TRPCError({ code: "CONFLICT", message: "Add a card before confirming your booking." });
      const [profile] = await db.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, record.bookingId)).limit(1);
      if (!profile || profile.paymentStatus !== "card_on_file") throw new TRPCError({ code: "CONFLICT", message: "Add a card before confirming your booking." });
      await finalizeCanonicalBooking(db, { bookingId: record.bookingId!, funnelId: record.id });
      const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);
      return { bookingId: record.bookingId, paymentStatus: "card_on_file" as const, cardBrand: profile.cardBrand ?? "Card", cardLast4: profile.cardLast4 ?? "saved", directPortalSessionReady };
    }),

  addPostBookingUpsells: publicProcedure
    .input(postBookingUpsellsInput)
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      const [record] = await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
      verifiedFunnelTokenOrThrow(record, input.mutationToken);
      if (record.stage !== "booked" || !record.bookingId) throw new TRPCError({ code: "CONFLICT", message: "Confirm your booking before adding services." });
      try {
        return await applyCanonicalAdditionalServices(db, record.bookingId, input.upsells);
      } catch (error) {
        if (error instanceof BookingUpsellInputError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
    }),
});
