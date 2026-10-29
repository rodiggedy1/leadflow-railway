import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  bookingCashAppPayments,
  bookingFunnelRecords,
  bookings,
} from "../drizzle/schema";
import { createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICING_VERSION } from "../shared/publicBookingPricing";
import { router, publicProcedure } from "./_core/trpc";
import { getDb } from "./db";
import {
  createOrReuseCashAppPaymentIntent,
  abandonCashAppPayment,
  markCashAppPaymentUnavailable,
  settleSucceededCashAppPayment,
} from "./bookingCashAppEngine";
import {
  ensurePublicBookingPaymentTarget,
  verifyPublicBookingFunnelToken,
} from "./bookingPaymentTargetService";
import { getStripeClient } from "./stripeClient";

const publicFunnelInput = z.object({
  publicFunnelNumber: z.string().trim().min(1).max(40),
  mutationToken: z.string().trim().min(1).max(512),
});

const publicQuoteInput = z.object({
  acceptedPricing: z.object({
    version: z.literal(PUBLIC_BOOKING_PRICING_VERSION),
    totalCents: z.number().int().positive(),
  }),
  pricing: z.object({
    pricingMode: z.enum(["home", "hourly"]),
    serviceId: z.enum(["standard", "deep", "moveout"]),
    bedrooms: z.number().int().min(0).max(7),
    bathrooms: z.number().int().min(1).max(5),
    homeType: z.enum(["House", "Apartment", "Townhome", "Condo"]),
    condition: z.number().int().min(1).max(10),
    maidCount: z.number().int().min(1).max(4),
    hourCount: z.number().int().min(1).max(8),
    extras: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(80),
          quantity: z.number().int().min(1).max(50),
        })
      )
      .max(50),
    recurrence: z.enum(["one-time", "weekly", "biweekly", "monthly"]),
    customPriceCents: z.number().int().min(1).max(1_000_000).optional(),
  }),
});

export const bookingCashAppRouter = router({
  /**
   * Validates the exact public-booking request server-side without persisting a
   * booking. The browser uses this amount only to initialize the native wallet
   * UI; `prepare` rebuilds and enforces the amount again before charging.
  */
  quote: publicProcedure.input(publicQuoteInput).mutation(({ input }) => {
    const snapshot = createPublicBookingPriceSnapshot(input.pricing);
    if (input.acceptedPricing.totalCents !== snapshot.breakdown.firstCleaningTotalCents) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The quoted price changed. Please review the updated quote before continuing.",
      });
    }
    return {
      totalCents: snapshot.breakdown.firstCleaningTotalCents,
      currency: "usd" as const,
    };
  }),
  prepare: publicProcedure
    .input(publicFunnelInput)
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      }
      const [record] = await db
        .select()
        .from(bookingFunnelRecords)
        .where(
          eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)
        )
        .limit(1);
      if (!record) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking record not found.",
        });
      }
      verifyPublicBookingFunnelToken(record, input.mutationToken);
      const target = await ensurePublicBookingPaymentTarget(record);
      const [booking] = await target.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, target.bookingId))
        .limit(1);
      if (!booking) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Booking record not found.",
        });
      }
      return createOrReuseCashAppPaymentIntent(target.db, {
        bookingId: target.bookingId,
        funnelId: record.id,
        profile: target.profile,
        amountCents: target.totalCents,
        publicBookingNumber: booking.publicBookingNumber,
      });
    }),
  settle: publicProcedure
    .input(publicFunnelInput.extend({ paymentIntentId: z.string().trim().min(1).max(255) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      }
      const [record] = await db
        .select()
        .from(bookingFunnelRecords)
        .where(
          eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)
        )
        .limit(1);
      if (!record) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking record not found.",
        });
      }
      verifyPublicBookingFunnelToken(record, input.mutationToken);
      const intent = await getStripeClient().paymentIntents.retrieve(
        input.paymentIntentId
      );
      const settled = await settleSucceededCashAppPayment(db, intent);
      if (!settled) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cash App payment not found for this booking.",
        });
      }
      return { ...settled, paymentMethod: "cashapp" as const };
    }),
  abandon: publicProcedure
    .input(publicFunnelInput.extend({ paymentIntentId: z.string().trim().min(1).max(255) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      }
      const [record] = await db
        .select()
        .from(bookingFunnelRecords)
        .where(
          eq(bookingFunnelRecords.publicFunnelNumber, input.publicFunnelNumber)
        )
        .limit(1);
      if (!record || !record.bookingId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking record not found.",
        });
      }
      verifyPublicBookingFunnelToken(record, input.mutationToken);
      return abandonCashAppPayment(db, {
        bookingId: record.bookingId,
        paymentIntentId: input.paymentIntentId,
      });
    }),
  /**
   * Cash App returns the browser here after provider approval. The server reuses
   * the webhook settlement path, so webhook-first and browser-return-first
   * ordering cannot create duplicate bookings or confirmation notifications.
   */
  returnStatus: publicProcedure
    .input(z.object({ returnToken: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Booking service unavailable.",
        });
      }
      const [payment] = await db
        .select()
        .from(bookingCashAppPayments)
        .where(eq(bookingCashAppPayments.returnToken, input.returnToken))
        .limit(1);
      if (!payment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cash App booking payment not found.",
        });
      }
      const intent = await getStripeClient().paymentIntents.retrieve(
        payment.stripePaymentIntentId
      );
      if (intent.status === "succeeded") {
        await settleSucceededCashAppPayment(db, intent);
      } else if (intent.status === "canceled") {
        await markCashAppPaymentUnavailable(db, intent, "cancelled");
      } else if (intent.status === "requires_payment_method") {
        await markCashAppPaymentUnavailable(db, intent, "failed");
      }
      const [booking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, payment.bookingId))
        .limit(1);
      if (!booking) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Booking record not found.",
        });
      }
      return {
        paymentStatus: booking.paymentStatus,
        paymentMethod: booking.paymentMethod,
        booking:
          booking.paymentStatus === "captured" &&
          booking.paymentMethod === "cashapp"
            ? {
                customerName: booking.customerName,
                serviceName: booking.serviceName,
                bedrooms: booking.bedrooms,
                bathrooms: booking.bathrooms,
                requestedLocalDate: booking.requestedLocalDate,
                requestedLocalTime: booking.requestedLocalTime,
                firstCleaningTotalCents: booking.firstCleaningTotalCents,
                futureVisitTotalCents: booking.futureVisitTotalCents,
                recurrence: booking.recurrence,
              }
            : null,
      };
    }),
});
