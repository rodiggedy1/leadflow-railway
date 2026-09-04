import Stripe from "stripe";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { bookingPaymentProfiles, bookings, customerPortalServiceRequests, paymentAuthorizations } from "../drizzle/schema";
import { agentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { getStripeClient } from "./stripeClient";
import { bookingPaymentIdempotencyKey, bookingPaymentMetadata } from "./bookingPaymentService";
import { TRPCError } from "@trpc/server";

const confirmedBookingInput = z.object({ bookingId: z.number().int().positive(), confirmed: z.literal(true) });
const confirmedPortalRequestInput = z.object({ requestId: z.number().int().positive(), confirmed: z.literal(true) });

async function paymentTargetOrThrow(bookingId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  const [profile] = await db.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, bookingId)).limit(1);
  if (!profile || !profile.stripeCustomerId || !profile.stripePaymentMethodId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No booking-bound saved card found." });
  }
  return { db, booking, profile };
}

function stripeFailureMessage(error: unknown, fallback: string) {
  return (error as Stripe.StripeRawError)?.message ?? fallback;
}

async function portalRequestPaymentTargetOrThrow(requestId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [request] = await db.select().from(customerPortalServiceRequests).where(eq(customerPortalServiceRequests.id, requestId)).limit(1);
  if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Service request not found" });
  if (!request.stripePaymentMethodId || !request.paymentLast4) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No saved card was selected for this service request." });
  }
  return { db, request };
}

export const bookingPaymentAdminRouter = router({
  getForBooking: agentProcedure
    .input(z.object({ bookingId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [profile] = await db.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, input.bookingId)).limit(1);
      const authorizations = profile
        ? await db.select().from(paymentAuthorizations).where(eq(paymentAuthorizations.bookingPaymentProfileId, profile.id)).orderBy(desc(paymentAuthorizations.createdAt)).limit(10)
        : [];
      return { profile: profile ?? null, authorizations };
    }),

  getForPortalRequest: agentProcedure
    .input(z.object({ requestId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { request } = await portalRequestPaymentTargetOrThrow(input.requestId);
      return {
        requestId: request.id,
        paymentStatus: request.paymentChargedAt ? "captured" as const : "card_on_file" as const,
        cardBrand: request.paymentBrand,
        cardLast4: request.paymentLast4,
        paymentChargedAt: request.paymentChargedAt,
      };
    }),

  placeHold: agentProcedure
    .input(confirmedBookingInput)
    .mutation(async ({ input, ctx }) => {
      const { db, booking, profile } = await paymentTargetOrThrow(input.bookingId);
      if (profile.paymentStatus !== "card_on_file") throw new TRPCError({ code: "BAD_REQUEST", message: "A verified card on file is required before placing a hold." });
      const existing = await db.select().from(paymentAuthorizations).where(and(eq(paymentAuthorizations.bookingPaymentProfileId, profile.id), eq(paymentAuthorizations.status, "authorized"))).limit(1);
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "An active hold already exists for this booking." });
      const stripe = getStripeClient();
      const agentName = ctx.agent?.agentName ?? "admin";
      let intent: Stripe.PaymentIntent;
      try {
        intent = await stripe.paymentIntents.create({
          amount: booking.firstCleaningTotalCents,
          currency: "usd",
          customer: profile.stripeCustomerId,
          payment_method: profile.stripePaymentMethodId,
          capture_method: "manual",
          confirm: true,
          off_session: true,
          description: `LeadFlow booking ${booking.publicBookingNumber}`,
          metadata: { ...bookingPaymentMetadata(booking.id, profile.id), operation: "authorization", createdBy: agentName },
        }, { idempotencyKey: bookingPaymentIdempotencyKey(booking.id, "authorization", profile.version) });
      } catch (error) {
        const message = stripeFailureMessage(error, "Stripe hold failed");
        await db.update(bookingPaymentProfiles).set({ paymentStatus: "failed", failureMessage: message, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Stripe hold failed: ${message}` });
      }
      if (intent.status !== "requires_capture") {
        await db.update(bookingPaymentProfiles).set({ paymentStatus: "failed", failureMessage: "PaymentIntent did not reach requires_capture", updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
        throw new TRPCError({ code: "CONFLICT", message: "Stripe did not authorize this hold." });
      }
      const now = Date.now();
      const captureBefore = typeof intent.payment_method_options?.card?.capture_before === "number" ? intent.payment_method_options.card.capture_before * 1000 : null;
      const result = await db.insert(paymentAuthorizations).values({
        bookingPaymentProfileId: profile.id,
        cleanerJobId: null,
        jobLabel: `Booking ${booking.publicBookingNumber}`,
        customerPhone: booking.customerPhone,
        customerName: booking.customerName,
        stripeCustomerId: profile.stripeCustomerId,
        stripePaymentMethodId: profile.stripePaymentMethodId,
        stripePaymentIntentId: intent.id,
        amountCents: booking.firstCleaningTotalCents,
        currency: "usd",
        operation: "authorization",
        status: "authorized",
        errorMessage: null,
        createdBy: agentName,
        authorizedAt: now,
        captureBefore,
        notes: null,
      });
      await db.update(bookingPaymentProfiles).set({ paymentStatus: "authorized", stripePaymentIntentId: intent.id, authorizedAt: now, authorizationExpiresAt: captureBefore, failureMessage: null, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
      return { authorizationId: Number((result as { insertId?: number }).insertId), paymentStatus: "authorized" as const, captureBefore };
    }),

  captureHold: agentProcedure
    .input(confirmedBookingInput)
    .mutation(async ({ input, ctx }) => {
      const { db, booking, profile } = await paymentTargetOrThrow(input.bookingId);
      const [authorization] = await db.select().from(paymentAuthorizations).where(and(eq(paymentAuthorizations.bookingPaymentProfileId, profile.id), eq(paymentAuthorizations.status, "authorized"))).orderBy(desc(paymentAuthorizations.createdAt)).limit(1);
      if (!authorization?.stripePaymentIntentId) throw new TRPCError({ code: "BAD_REQUEST", message: "No active booking hold is available to capture." });
      const stripe = getStripeClient();
      const agentName = ctx.agent?.agentName ?? "admin";
      try {
        await stripe.paymentIntents.capture(authorization.stripePaymentIntentId, { amount_to_capture: booking.firstCleaningTotalCents });
      } catch (error) {
        const message = stripeFailureMessage(error, "Stripe capture failed");
        await db.update(paymentAuthorizations).set({ status: "failed", errorMessage: message, actionBy: agentName }).where(eq(paymentAuthorizations.id, authorization.id));
        await db.update(bookingPaymentProfiles).set({ paymentStatus: "failed", failureMessage: message, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Stripe capture failed: ${message}` });
      }
      const now = Date.now();
      await db.transaction(async (tx) => {
        await tx.update(paymentAuthorizations).set({ status: "captured", capturedAt: now, actionBy: agentName, amountCents: booking.firstCleaningTotalCents }).where(eq(paymentAuthorizations.id, authorization.id));
        await tx.update(bookingPaymentProfiles).set({ paymentStatus: "captured", capturedAt: now, failureMessage: null, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
      });
      return { success: true, paymentStatus: "captured" as const };
    }),

  cancelHold: agentProcedure
    .input(confirmedBookingInput)
    .mutation(async ({ input, ctx }) => {
      const { db, profile } = await paymentTargetOrThrow(input.bookingId);
      const [authorization] = await db.select().from(paymentAuthorizations).where(and(eq(paymentAuthorizations.bookingPaymentProfileId, profile.id), eq(paymentAuthorizations.status, "authorized"))).orderBy(desc(paymentAuthorizations.createdAt)).limit(1);
      if (!authorization?.stripePaymentIntentId) throw new TRPCError({ code: "BAD_REQUEST", message: "No active booking hold is available to cancel." });
      const stripe = getStripeClient();
      const agentName = ctx.agent?.agentName ?? "admin";
      try {
        await stripe.paymentIntents.cancel(authorization.stripePaymentIntentId);
      } catch (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Stripe cancellation failed: ${stripeFailureMessage(error, "Unknown error")}` });
      }
      const now = Date.now();
      await db.transaction(async (tx) => {
        await tx.update(paymentAuthorizations).set({ status: "cancelled", cancelledAt: now, actionBy: agentName }).where(eq(paymentAuthorizations.id, authorization.id));
        await tx.update(bookingPaymentProfiles).set({ paymentStatus: "card_on_file", stripePaymentIntentId: null, authorizationExpiresAt: null, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
      });
      return { success: true, paymentStatus: "card_on_file" as const };
    }),

  chargeSavedCard: agentProcedure
    .input(confirmedBookingInput)
    .mutation(async ({ input, ctx }) => {
      const { db, booking, profile } = await paymentTargetOrThrow(input.bookingId);
      if (profile.paymentStatus !== "card_on_file") throw new TRPCError({ code: "BAD_REQUEST", message: "A verified card on file is required before charging." });
      const stripe = getStripeClient();
      const agentName = ctx.agent?.agentName ?? "admin";
      let intent: Stripe.PaymentIntent;
      try {
        intent = await stripe.paymentIntents.create({
          amount: booking.firstCleaningTotalCents,
          currency: "usd",
          customer: profile.stripeCustomerId,
          payment_method: profile.stripePaymentMethodId,
          confirm: true,
          off_session: true,
          description: `LeadFlow booking ${booking.publicBookingNumber}`,
          metadata: { ...bookingPaymentMetadata(booking.id, profile.id), operation: "direct_charge", createdBy: agentName },
        }, { idempotencyKey: bookingPaymentIdempotencyKey(booking.id, "direct_charge", profile.version) });
      } catch (error) {
        const message = stripeFailureMessage(error, "Stripe charge failed");
        await db.update(bookingPaymentProfiles).set({ paymentStatus: "failed", failureMessage: message, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Stripe charge failed: ${message}` });
      }
      if (intent.status !== "succeeded") throw new TRPCError({ code: "CONFLICT", message: "Stripe requires further action before this card can be charged." });
      const now = Date.now();
      await db.transaction(async (tx) => {
        await tx.insert(paymentAuthorizations).values({
          bookingPaymentProfileId: profile.id,
          cleanerJobId: null,
          jobLabel: `Booking ${booking.publicBookingNumber}`,
          customerPhone: booking.customerPhone,
          customerName: booking.customerName,
          stripeCustomerId: profile.stripeCustomerId,
          stripePaymentMethodId: profile.stripePaymentMethodId,
          stripePaymentIntentId: intent.id,
          amountCents: booking.firstCleaningTotalCents,
          currency: "usd",
          operation: "direct_charge",
          status: "captured",
          errorMessage: null,
          createdBy: agentName,
          actionBy: agentName,
          authorizedAt: now,
          capturedAt: now,
          notes: null,
        });
        await tx.update(bookingPaymentProfiles).set({ paymentStatus: "captured", stripePaymentIntentId: intent.id, capturedAt: now, failureMessage: null, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
      });
      return { success: true, paymentStatus: "captured" as const };
    }),

  chargePortalRequestSavedCard: agentProcedure
    .input(confirmedPortalRequestInput)
    .mutation(async ({ input, ctx }) => {
      const { db, request } = await portalRequestPaymentTargetOrThrow(input.requestId);
      if (request.paymentChargedAt || request.stripePaymentIntentId) {
        throw new TRPCError({ code: "CONFLICT", message: "This service request has already been charged." });
      }
      const stripe = getStripeClient();
      const paymentMethod = await stripe.paymentMethods.retrieve(request.stripePaymentMethodId!);
      if (paymentMethod.type !== "card" || !paymentMethod.card || !paymentMethod.customer || paymentMethod.card.last4 !== request.paymentLast4) {
        throw new TRPCError({ code: "CONFLICT", message: "The selected request card is no longer available for charging." });
      }
      const customerId = typeof paymentMethod.customer === "string" ? paymentMethod.customer : paymentMethod.customer.id;
      const agentName = ctx.agent?.agentName ?? "admin";
      let intent: Stripe.PaymentIntent;
      try {
        intent = await stripe.paymentIntents.create({
          amount: request.estimatedTotalCents,
          currency: "usd",
          customer: customerId,
          payment_method: request.stripePaymentMethodId,
          confirm: true,
          off_session: true,
          description: `LeadFlow service request ${request.publicRequestNumber}`,
          metadata: { source: "customer_portal_service_request", customerPortalServiceRequestId: String(request.id), operation: "direct_charge", createdBy: agentName },
        }, { idempotencyKey: `leadflow:portal-request:${request.id}:direct_charge` });
      } catch (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Stripe charge failed: ${stripeFailureMessage(error, "Stripe charge failed")}` });
      }
      if (intent.status !== "succeeded") {
        throw new TRPCError({ code: "CONFLICT", message: "Stripe requires further action before this card can be charged." });
      }
      const paymentChargedAt = Date.now();
      await db.update(customerPortalServiceRequests).set({ stripePaymentIntentId: intent.id, paymentChargedAt, updatedAt: new Date() }).where(eq(customerPortalServiceRequests.id, request.id));
      return { success: true, paymentStatus: "captured" as const, paymentChargedAt };
    }),
});
