import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bookingFunnelRecords,
  bookingPaymentProfiles,
  bookingSeries,
  bookings,
  stripeCustomers,
} from "../drizzle/schema";
import {
  BOOKING_PAYMENT_CONSENT_TEXT,
  BOOKING_PAYMENT_CONSENT_VERSION,
} from "../shared/bookingPayment";
import { NATIVE_BOOKING_PRICING_VERSION, type PrepareBookingInput } from "../shared/booking";
import { router, publicProcedure } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { createBookingFunnelMutationToken, verifyBookingFunnelMutationToken } from "./bookingFunnelService";
import { buildPreparedNativeBooking, NativeBookingInputError } from "./bookingsService";
import { bookingPaymentIdempotencyKey, bookingPaymentMetadata } from "./bookingPaymentService";
import { getStripeClient } from "./stripeClient";
import { sendBookingCompletionNotifications } from "./bookingCompletionNotifications";
import { createCustomerPortalHandoff, ensureCustomerPortalAccount } from "./customerPortalService";
import { getCustomerPortalSavedCard } from "./customerPortalPaymentService";
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

function insertId(result: unknown, label: string): number {
  const value = Number((result as { insertId?: number }).insertId ?? (result as Array<{ insertId?: number }>)[0]?.insertId);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} insert did not return an ID.`);
  return value;
}

async function ensureBookingPaymentTarget(record: typeof bookingFunnelRecords.$inferSelect) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
  if (record.stage !== "payment_incomplete") {
    throw new TRPCError({ code: "CONFLICT", message: "Reserve your appointment before adding a card." });
  }

  const built = buildPreparedNativeBooking(asBookingInput(record), { nowMs: Date.now(), timeZone: ENV.businessTimezone });
  if (built.type === "price_changed") {
    throw new TRPCError({ code: "CONFLICT", message: "The quoted price changed. Please review the updated quote before continuing." });
  }
  const prepared = built.prepared;

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.id, record.id)).limit(1);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
    let bookingId = current.bookingId;
    if (!bookingId) {
      const existing = await tx.select().from(bookings).where(eq(bookings.idempotencyKey, prepared.idempotencyKey)).limit(1);
      if (existing[0]) {
        bookingId = existing[0].id;
      } else {
        const now = new Date();
        const result = await tx.insert(bookings).values({
          publicBookingNumber: prepared.publicBookingNumber,
          idempotencyKey: prepared.idempotencyKey,
          commandHash: prepared.commandHash,
          source: prepared.source,
          status: "pending_payment",
          availabilityStatus: prepared.availabilityStatus,
          assignmentStatus: prepared.assignmentStatus,
          paymentStatus: "not_started",
          customerName: prepared.customerName,
          customerPhone: prepared.customerPhone,
          customerEmail: prepared.customerEmail,
          serviceId: prepared.serviceId,
          serviceName: prepared.serviceName,
          bedrooms: prepared.bedrooms,
          bathrooms: prepared.bathrooms,
          extras: prepared.extras,
          specialRequestNotes: prepared.specialRequestNotes,
          address: prepared.address,
          requestedLocalDate: prepared.requestedLocalDate,
          requestedLocalTime: prepared.requestedLocalTime,
          requestedTimeZone: prepared.requestedTimeZone,
          requestedStartAt: prepared.requestedStartAt,
          recurrence: prepared.recurrence,
          recurringIntentStatus: prepared.recurringIntentStatus,
          pricingVersion: prepared.pricingVersion,
          firstCleaningTotalCents: prepared.firstCleaningTotalCents,
          futureVisitTotalCents: prepared.futureVisitTotalCents,
          priceSnapshot: prepared.priceSnapshot,
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
        });
        bookingId = insertId(result, "Native booking");
        if (prepared.recurrence !== "one-time" && prepared.futureVisitTotalCents !== null) {
          await tx.insert(bookingSeries).values({
            bookingId,
            status: "intent_pending",
            frequency: prepared.recurrence,
            anchorLocalDate: prepared.requestedLocalDate,
            anchorLocalTime: prepared.requestedLocalTime,
            timeZone: prepared.requestedTimeZone,
            firstCleaningTotalCents: prepared.firstCleaningTotalCents,
            futureVisitTotalCents: prepared.futureVisitTotalCents,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      await tx.update(bookingFunnelRecords).set({ bookingId, updatedAt: new Date() }).where(eq(bookingFunnelRecords.id, current.id));
    }

    const profiles = await tx.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, bookingId)).limit(1);
    let profile = profiles[0];
    if (!profile) {
      const now = new Date();
      const result = await tx.insert(bookingPaymentProfiles).values({
        bookingId,
        funnelRecordId: current.id,
        paymentStatus: "not_started",
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      const profileId = insertId(result, "Booking payment profile");
      const created = await tx.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.id, profileId)).limit(1);
      profile = created[0];
    }
    if (!profile) throw new Error("Booking payment profile could not be created.");
    return { bookingId, profile, totalCents: prepared.firstCleaningTotalCents, customerName: prepared.customerName };
  });
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

export const bookingPaymentRouter = router({
  startSetup: publicProcedure
    .input(publicFunnelInput.extend({ consentAccepted: z.literal(true) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      const [record] = await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
      verifiedFunnelTokenOrThrow(record, input.mutationToken);
      const target = await ensureBookingPaymentTarget(record);
      const stripe = getStripeClient();

      if (target.profile.paymentStatus === "card_on_file") {
        const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);
        let portalAccessCode: string | null = null;
        if (record.source !== "book-page") try {
          portalAccessCode = await createCustomerPortalHandoff(db, {
            customerName: record.customerName,
            customerPhone: record.customerPhone,
            customerEmail: record.customerEmail,
          });
        } catch (error) {
          // Portal access is additive. An existing verified card result must remain successful if handoff creation fails.
          console.error("[BookingPaymentRouter] Customer portal handoff creation failed:", error);
        }
        return { alreadyComplete: true, bookingId: target.bookingId, paymentStatus: "card_on_file" as const, portalAccessCode, directPortalSessionReady };
      }
      if (target.profile.stripeSetupIntentId) {
        const existing = await stripe.setupIntents.retrieve(target.profile.stripeSetupIntentId);
        if (existing.client_secret && existing.status !== "succeeded" && existing.status !== "canceled") {
          return { alreadyComplete: false, bookingId: target.bookingId, paymentStatus: "setup_pending" as const, clientSecret: existing.client_secret };
        }
      }

      const customer = target.profile.stripeCustomerId
        ? await stripe.customers.retrieve(target.profile.stripeCustomerId)
        : await stripe.customers.create({
          name: target.customerName,
          metadata: bookingPaymentMetadata(target.bookingId, target.profile.id),
        });
      if ("deleted" in customer && customer.deleted) throw new TRPCError({ code: "CONFLICT", message: "Saved payment profile is unavailable. Please contact support." });
      const setupIntent = await stripe.setupIntents.create({
        customer: customer.id,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: bookingPaymentMetadata(target.bookingId, target.profile.id),
      }, { idempotencyKey: bookingPaymentIdempotencyKey(target.bookingId, "setup", target.profile.version) });
      if (!setupIntent.client_secret) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe could not prepare secure card entry." });

      await db.update(bookingPaymentProfiles).set({
        paymentStatus: "setup_pending",
        stripeCustomerId: customer.id,
        stripeSetupIntentId: setupIntent.id,
        consentVersion: BOOKING_PAYMENT_CONSENT_VERSION,
        consentText: BOOKING_PAYMENT_CONSENT_TEXT,
        consentAcceptedAt: Date.now(),
        updatedAt: new Date(),
      }).where(and(eq(bookingPaymentProfiles.id, target.profile.id), eq(bookingPaymentProfiles.version, target.profile.version)));
      await db.update(bookings).set({ paymentStatus: "pending", updatedAt: new Date() }).where(eq(bookings.id, target.bookingId));
      broadcastOpsUpdate("booking_funnel_update");
      return { alreadyComplete: false, bookingId: target.bookingId, paymentStatus: "setup_pending" as const, clientSecret: setupIntent.client_secret };
    }),

  reuseSavedCard: publicProcedure
    .input(publicFunnelInput)
    .mutation(async ({ input, ctx }) => {
      const session = await getCustomerPortalSessionFromRequest(ctx.req);
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "Open your portal to use a saved card." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
      const [record] = await db.select().from(bookingFunnelRecords).where(eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Booking record not found." });
      verifiedFunnelTokenOrThrow(record, input.mutationToken);
      if (record.customerPhone !== session.customerPhone) throw new TRPCError({ code: "FORBIDDEN", message: "The saved card does not belong to this booking." });
      const target = await ensureBookingPaymentTarget(record);
      if (target.profile.paymentStatus === "card_on_file") {
        const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);
        return { bookingId: target.bookingId, paymentStatus: "card_on_file" as const, cardBrand: target.profile.cardBrand ?? "Card", cardLast4: target.profile.cardLast4 ?? "saved", directPortalSessionReady };
      }
      const savedCard = await getCustomerPortalSavedCard(db, session.customerPhone);
      if (!savedCard) throw new TRPCError({ code: "CONFLICT", message: "A saved card is not available. Please add a new card." });
      const now = new Date();
      await db.transaction(async (tx) => {
        const result = await tx.update(bookingPaymentProfiles).set({ paymentStatus: "card_on_file", stripeCustomerId: savedCard.stripeCustomerId, stripePaymentMethodId: savedCard.stripePaymentMethodId, cardBrand: savedCard.brand, cardLast4: savedCard.last4, cardExpMonth: savedCard.expMonth, cardExpYear: savedCard.expYear, version: sql`${bookingPaymentProfiles.version} + 1`, updatedAt: now }).where(and(eq(bookingPaymentProfiles.id, target.profile.id), eq(bookingPaymentProfiles.version, target.profile.version)));
        if (affectedRows(result) !== 1) throw new TRPCError({ code: "CONFLICT", message: "The payment method changed. Please try again." });
        await tx.update(bookings).set({ status: "needs_attention", paymentStatus: "card_on_file", updatedAt: now }).where(eq(bookings.id, target.bookingId));
        await tx.update(bookingFunnelRecords).set({ stripeCustomerId: savedCard.stripeCustomerId, stripePaymentMethodId: savedCard.stripePaymentMethodId, paymentBrand: savedCard.brand, paymentLast4: savedCard.last4, updatedAt: now }).where(eq(bookingFunnelRecords.id, record.id));
      });
      broadcastOpsUpdate("booking_funnel_update");
      void sendBookingCompletionNotifications(target.bookingId).catch((error) => console.error("[BookingPaymentRouter] Booking completion notifications failed:", error));
      const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);
      return { bookingId: target.bookingId, paymentStatus: "card_on_file" as const, cardBrand: savedCard.brand ?? "Card", cardLast4: savedCard.last4, directPortalSessionReady };
    }),

  confirmSetup: publicProcedure
    .input(publicFunnelInput.extend({ paymentMethodId: z.string().trim().min(1).max(255) }))
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
      const setupIntent = await stripe.setupIntents.retrieve(profile.stripeSetupIntentId);
      if (setupIntent.status !== "succeeded" || setupIntent.payment_method !== input.paymentMethodId || setupIntent.customer !== profile.stripeCustomerId) {
        throw new TRPCError({ code: "CONFLICT", message: "Stripe did not verify this card for the current booking." });
      }
      const metadata = setupIntent.metadata;
      if (metadata.bookingId !== String(record.bookingId) || metadata.bookingPaymentProfileId !== String(profile.id)) {
        throw new TRPCError({ code: "CONFLICT", message: "Stripe card setup does not belong to this booking." });
      }
      const paymentMethod = await stripe.paymentMethods.retrieve(input.paymentMethodId);
      if (paymentMethod.type !== "card" || !paymentMethod.card || paymentMethod.customer !== profile.stripeCustomerId) {
        throw new TRPCError({ code: "CONFLICT", message: "Stripe card does not belong to this booking." });
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.update(bookingPaymentProfiles).set({
          paymentStatus: "card_on_file",
          stripePaymentMethodId: paymentMethod.id,
          cardBrand: paymentMethod.card.brand,
          cardLast4: paymentMethod.card.last4,
          cardExpMonth: paymentMethod.card.exp_month,
          cardExpYear: paymentMethod.card.exp_year,
          version: sql`${bookingPaymentProfiles.version} + 1`,
          updatedAt: now,
        }).where(and(eq(bookingPaymentProfiles.id, profile.id), eq(bookingPaymentProfiles.version, profile.version)));
        await tx.update(bookings).set({ status: "needs_attention", paymentStatus: "card_on_file", updatedAt: now }).where(eq(bookings.id, record.bookingId!));
        await tx.update(bookingFunnelRecords).set({
          stripeCustomerId: profile.stripeCustomerId,
          stripePaymentMethodId: paymentMethod.id,
          paymentBrand: paymentMethod.card.brand,
          paymentLast4: paymentMethod.card.last4,
          updatedAt: now,
        }).where(eq(bookingFunnelRecords.id, record.id));
        await tx.insert(stripeCustomers).values({
          phone: record.customerPhone,
          name: record.customerName,
          stripeCustomerId: profile.stripeCustomerId,
          stripePaymentMethodId: paymentMethod.id,
          cardBrand: paymentMethod.card.brand,
          cardLast4: paymentMethod.card.last4,
          cardExpMonth: paymentMethod.card.exp_month,
          cardExpYear: paymentMethod.card.exp_year,
          cardSavedAt: Date.now(),
        }).onDuplicateKeyUpdate({ set: {
          name: record.customerName,
          stripeCustomerId: profile.stripeCustomerId,
          stripePaymentMethodId: paymentMethod.id,
          cardBrand: paymentMethod.card.brand,
          cardLast4: paymentMethod.card.last4,
          cardExpMonth: paymentMethod.card.exp_month,
          cardExpYear: paymentMethod.card.exp_year,
          cardSavedAt: Date.now(),
        } });
      });
      broadcastOpsUpdate("booking_funnel_update");
      void sendBookingCompletionNotifications(record.bookingId).catch((error) =>
        console.error("[BookingPaymentRouter] Booking completion notifications failed:", error)
      );
      const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);
      let portalAccessCode: string | null = null;
      if (record.source !== "book-page") try {
        portalAccessCode = await createCustomerPortalHandoff(db, {
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
      };
    }),
});
