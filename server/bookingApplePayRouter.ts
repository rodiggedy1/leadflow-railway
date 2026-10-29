import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { bookingFunnelRecords, bookings } from "../drizzle/schema";
import { createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICING_VERSION } from "../shared/publicBookingPricing";
import { router, publicProcedure } from "./_core/trpc";
import { getDb } from "./db";
import {
  createOrReuseApplePayPaymentIntent,
  abandonApplePayPayment,
  settleSucceededApplePayPayment,
} from "./bookingApplePayEngine";
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

export const bookingApplePayRouter = router({
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
      return createOrReuseApplePayPaymentIntent(target.db, {
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
      const settled = await settleSucceededApplePayPayment(db, intent);
      if (!settled) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Apple Pay payment not found for this booking.",
        });
      }
      return { ...settled, paymentMethod: "apple_pay" as const };
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
      return abandonApplePayPayment(db, {
        bookingId: record.bookingId,
        paymentIntentId: input.paymentIntentId,
      });
    }),
});
