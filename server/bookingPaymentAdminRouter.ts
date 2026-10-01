import Stripe from "stripe";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bookingFunnelRecords,
  bookingPaymentProfiles,
  bookings,
  leadflowJobs,
  customerPortalServiceRequests,
  paymentAuthorizations,
  stripeCustomers,
} from "../drizzle/schema";
import { agentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { getStripeClient } from "./stripeClient";
import {
  bookingPaymentIdempotencyKey,
  bookingPaymentMetadata,
} from "./bookingPaymentService";
import {
  BOOKING_PAYMENT_CONSENT_TEXT,
  BOOKING_PAYMENT_CONSENT_VERSION,
} from "../shared/bookingPayment";
import { sendBookingCompletionNotifications } from "./bookingCompletionNotifications";
import { createCustomerPortalHandoff } from "./customerPortalService";
import { TRPCError } from "@trpc/server";
import { broadcastOpsUpdate } from "./sseBroadcast";

const confirmedBookingInput = z.object({
  bookingId: z.number().int().positive(),
  confirmed: z.literal(true),
});
const confirmedPortalRequestInput = z.object({
  requestId: z.number().int().positive(),
  confirmed: z.literal(true),
});
type PortalRequest = typeof customerPortalServiceRequests.$inferSelect;

async function paymentTargetOrThrow(bookingId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
    });
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking)
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  const [profile] = await db
    .select()
    .from(bookingPaymentProfiles)
    .where(eq(bookingPaymentProfiles.bookingId, bookingId))
    .limit(1);
  if (!profile || !profile.stripeCustomerId || !profile.stripePaymentMethodId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No booking-bound saved card found.",
    });
  }
  return { db, booking, profile };
}

function stripeFailureMessage(error: unknown, fallback: string) {
  return (error as Stripe.StripeRawError)?.message ?? fallback;
}
function affectedRows(result: unknown): number {
  const candidate = result as { affectedRows?: number };
  if (typeof candidate.affectedRows === "number") return candidate.affectedRows;
  if (Array.isArray(result) && typeof result[0]?.affectedRows === "number")
    return result[0].affectedRows;
  return 0;
}

async function portalRequestPaymentTargetOrThrow(requestId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
    });
  const [request] = await db
    .select()
    .from(customerPortalServiceRequests)
    .where(eq(customerPortalServiceRequests.id, requestId))
    .limit(1);
  if (!request)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Service request not found",
    });
  if (!request.stripePaymentMethodId || !request.paymentLast4) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No saved card was selected for this service request.",
    });
  }
  return { db, request };
}

async function portalRequestStripeCardOrThrow(request: PortalRequest) {
  const stripe = getStripeClient();
  const paymentMethod = await stripe.paymentMethods.retrieve(
    request.stripePaymentMethodId!
  );
  if (
    paymentMethod.type !== "card" ||
    !paymentMethod.card ||
    !paymentMethod.customer ||
    paymentMethod.card.last4 !== request.paymentLast4
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "The selected request card is no longer available for charging.",
    });
  }
  return {
    stripe,
    customerId:
      typeof paymentMethod.customer === "string"
        ? paymentMethod.customer
        : paymentMethod.customer.id,
  };
}

async function activePortalRequestHold(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  requestId: number
) {
  const [authorization] = await db
    .select()
    .from(paymentAuthorizations)
    .where(
      and(
        eq(paymentAuthorizations.customerPortalServiceRequestId, requestId),
        eq(paymentAuthorizations.status, "authorized")
      )
    )
    .orderBy(desc(paymentAuthorizations.createdAt))
    .limit(1);
  return authorization ?? null;
}

export const bookingPaymentAdminRouter = router({
  startInternalCardSetup: agentProcedure
    .input(z.object({ bookingId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      const [booking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);
      if (!booking)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      const [funnel] = await db
        .select()
        .from(bookingFunnelRecords)
        .where(eq(bookingFunnelRecords.bookingId, booking.id))
        .limit(1);
      if (!funnel)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This booking is missing its payment funnel.",
        });
      let [profile] = await db
        .select()
        .from(bookingPaymentProfiles)
        .where(eq(bookingPaymentProfiles.bookingId, booking.id))
        .limit(1);
      if (!profile) {
        const now = new Date();
        try {
          await db.insert(bookingPaymentProfiles).values({
            bookingId: booking.id,
            funnelRecordId: funnel.id,
            paymentStatus: "not_started",
            version: 1,
            createdAt: now,
            updatedAt: now,
          });
        } catch (error) {
          const candidate = error as {
            code?: string;
            errno?: number;
            message?: string;
          };
          const duplicate =
            candidate.code === "ER_DUP_ENTRY" ||
            candidate.errno === 1062 ||
            candidate.message?.includes("Duplicate entry") === true;
          if (!duplicate) throw error;
        }
        [profile] = await db
          .select()
          .from(bookingPaymentProfiles)
          .where(eq(bookingPaymentProfiles.bookingId, booking.id))
          .limit(1);
      }
      if (!profile)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This booking is missing its payment profile.",
        });
      if (profile.paymentStatus === "card_on_file") {
        if (profile.cardBrand && profile.cardLast4) {
          await db
            .update(leadflowJobs)
            .set({
              hasStripeCard: 1,
              paymentBrand: profile.cardBrand,
              paymentLast4: profile.cardLast4,
              updatedAt: new Date(),
            })
            .where(eq(leadflowJobs.bookingId, booking.id));
        }
        return {
          alreadyComplete: true as const,
          clientSecret: null,
          setupIntentId: null,
        };
      }
      const stripe = getStripeClient();
      const customer = profile.stripeCustomerId
        ? await stripe.customers.retrieve(profile.stripeCustomerId)
        : await stripe.customers.create({
            name: booking.customerName,
            metadata: bookingPaymentMetadata(booking.id, profile.id),
          });
      if ("deleted" in customer && customer.deleted)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Saved payment profile is unavailable. Please contact support.",
        });
      const stripeCustomerId = customer.id;
      if (profile.stripeSetupIntentId) {
        const existingSetupIntent = await stripe.setupIntents.retrieve(
          profile.stripeSetupIntentId
        );
        if (
          existingSetupIntent.client_secret &&
          existingSetupIntent.status !== "succeeded" &&
          existingSetupIntent.status !== "canceled"
        ) {
          const now = new Date();
          await db
            .update(bookings)
            .set({ paymentStatus: "pending", updatedAt: now })
            .where(eq(bookings.id, booking.id));
          broadcastOpsUpdate("booking_funnel_update");
          return {
            alreadyComplete: false as const,
            clientSecret: existingSetupIntent.client_secret,
            setupIntentId: existingSetupIntent.id,
          };
        }
      }
      const setupIntent = await stripe.setupIntents.create(
        {
          customer: stripeCustomerId,
          usage: "off_session",
          payment_method_types: ["card"],
          metadata: bookingPaymentMetadata(booking.id, profile.id),
        },
        {
          idempotencyKey: bookingPaymentIdempotencyKey(
            booking.id,
            "setup",
            profile.version
          ),
        }
      );
      if (!setupIntent.client_secret)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe could not prepare secure card entry.",
        });
      const now = new Date();
      const profileUpdate = await db
        .update(bookingPaymentProfiles)
        .set({
          paymentStatus: "setup_pending",
          stripeCustomerId,
          stripeSetupIntentId: setupIntent.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(bookingPaymentProfiles.id, profile.id),
            eq(bookingPaymentProfiles.version, profile.version)
          )
        );
      const affected = affectedRows(profileUpdate);
      if (affected !== 1)
        throw new TRPCError({
          code: "CONFLICT",
          message: "The payment method changed. Please try again.",
        });
      await db
        .update(bookings)
        .set({ paymentStatus: "pending", updatedAt: now })
        .where(eq(bookings.id, booking.id));
      broadcastOpsUpdate("booking_funnel_update");
      return {
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
      };
    }),

  confirmInternalCardSetup: agentProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        setupIntentId: z.string().min(1),
        paymentMethodId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      const [booking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);
      if (!booking)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      const [profile] = await db
        .select()
        .from(bookingPaymentProfiles)
        .where(eq(bookingPaymentProfiles.bookingId, booking.id))
        .limit(1);
      if (!profile)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This booking is missing its payment profile.",
        });
      const [funnel] = await db
        .select()
        .from(bookingFunnelRecords)
        .where(eq(bookingFunnelRecords.bookingId, booking.id))
        .limit(1);
      if (!funnel)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This booking is missing its payment funnel.",
        });
      const stripe = getStripeClient();
      const setupIntent = await stripe.setupIntents.retrieve(
        input.setupIntentId
      );
      if (
        setupIntent.status !== "succeeded" ||
        setupIntent.payment_method !== input.paymentMethodId ||
        setupIntent.metadata.bookingId !== String(booking.id) ||
        setupIntent.metadata.bookingPaymentProfileId !== String(profile.id) ||
        setupIntent.customer !== profile.stripeCustomerId
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "Stripe did not verify this card for the current booking.",
        });
      const paymentMethod = await stripe.paymentMethods.retrieve(
        input.paymentMethodId
      );
      if (
        paymentMethod.type !== "card" ||
        !paymentMethod.card ||
        !setupIntent.customer ||
        paymentMethod.customer !== setupIntent.customer
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "Stripe card does not belong to this booking.",
        });
      const now = new Date();
      await db.transaction(async tx => {
        const profileUpdate = await tx
          .update(bookingPaymentProfiles)
          .set({
            paymentStatus: "card_on_file",
            stripePaymentMethodId: input.paymentMethodId,
            cardBrand: paymentMethod.card!.brand,
            cardLast4: paymentMethod.card!.last4,
            cardExpMonth: paymentMethod.card!.exp_month,
            cardExpYear: paymentMethod.card!.exp_year,
            consentVersion: BOOKING_PAYMENT_CONSENT_VERSION,
            consentText: BOOKING_PAYMENT_CONSENT_TEXT,
            consentAcceptedAt: Date.now(),
            version: sql`${bookingPaymentProfiles.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(bookingPaymentProfiles.id, profile.id),
              eq(bookingPaymentProfiles.version, profile.version)
            )
          );
        if (affectedRows(profileUpdate) !== 1)
          throw new TRPCError({
            code: "CONFLICT",
            message: "The payment method changed. Please try again.",
          });
        await tx
          .update(bookings)
          .set({
            status: "needs_attention",
            paymentStatus: "card_on_file",
            updatedAt: now,
          })
          .where(eq(bookings.id, booking.id));
        await tx
          .update(leadflowJobs)
          .set({
            hasStripeCard: 1,
            paymentBrand: paymentMethod.card!.brand,
            paymentLast4: paymentMethod.card!.last4,
            updatedAt: now,
          })
          .where(eq(leadflowJobs.bookingId, booking.id));
        await tx
          .update(bookingFunnelRecords)
          .set({
            stripeCustomerId: profile.stripeCustomerId,
            stripePaymentMethodId: input.paymentMethodId,
            paymentBrand: paymentMethod.card!.brand,
            paymentLast4: paymentMethod.card!.last4,
            updatedAt: now,
          })
          .where(eq(bookingFunnelRecords.id, funnel.id));
        await tx
          .insert(stripeCustomers)
          .values({
            phone: booking.customerPhone,
            name: booking.customerName,
            stripeCustomerId: profile.stripeCustomerId!,
            stripePaymentMethodId: input.paymentMethodId,
            cardBrand: paymentMethod.card!.brand,
            cardLast4: paymentMethod.card!.last4,
            cardExpMonth: paymentMethod.card!.exp_month,
            cardExpYear: paymentMethod.card!.exp_year,
            cardSavedAt: Date.now(),
          })
          .onDuplicateKeyUpdate({
            set: {
              name: booking.customerName,
              stripeCustomerId: profile.stripeCustomerId!,
              stripePaymentMethodId: input.paymentMethodId,
              cardBrand: paymentMethod.card!.brand,
              cardLast4: paymentMethod.card!.last4,
              cardExpMonth: paymentMethod.card!.exp_month,
              cardExpYear: paymentMethod.card!.exp_year,
              cardSavedAt: Date.now(),
            },
          });
      });
      broadcastOpsUpdate("booking_funnel_update");
      void sendBookingCompletionNotifications(booking.id).catch(error =>
        console.error(
          "[BookingPaymentAdminRouter] Booking completion notifications failed:",
          error
        )
      );
      let portalAccessCode: string | null = null;
      try {
        portalAccessCode = await createCustomerPortalHandoff(db, {
          customerName: booking.customerName,
          customerPhone: booking.customerPhone,
          customerEmail: booking.customerEmail,
        });
      } catch (error) {
        console.error(
          "[BookingPaymentAdminRouter] Customer portal handoff creation failed:",
          error
        );
      }
      return {
        cardBrand: paymentMethod.card.brand,
        cardLast4: paymentMethod.card.last4,
        portalAccessCode,
        directPortalSessionReady: false as const,
      };
    }),

  getForBooking: agentProcedure
    .input(z.object({ bookingId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      const [profile] = await db
        .select()
        .from(bookingPaymentProfiles)
        .where(eq(bookingPaymentProfiles.bookingId, input.bookingId))
        .limit(1);
      const authorizations = profile
        ? await db
            .select()
            .from(paymentAuthorizations)
            .where(
              eq(paymentAuthorizations.bookingPaymentProfileId, profile.id)
            )
            .orderBy(desc(paymentAuthorizations.createdAt))
            .limit(10)
        : [];
      return { profile: profile ?? null, authorizations };
    }),

  getForPortalRequest: agentProcedure
    .input(z.object({ requestId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { db, request } = await portalRequestPaymentTargetOrThrow(
        input.requestId
      );
      const activeHold = await activePortalRequestHold(db, request.id);
      return {
        requestId: request.id,
        paymentStatus: request.paymentChargedAt
          ? ("captured" as const)
          : ("card_on_file" as const),
        cardBrand: request.paymentBrand,
        cardLast4: request.paymentLast4,
        paymentChargedAt: request.paymentChargedAt,
        activeHold: activeHold
          ? {
              authorizationId: activeHold.id,
              captureBefore: activeHold.captureBefore,
            }
          : null,
      };
    }),

  placeHold: agentProcedure
    .input(confirmedBookingInput)
    .mutation(async ({ input, ctx }) => {
      const { db, booking, profile } = await paymentTargetOrThrow(
        input.bookingId
      );
      if (profile.paymentStatus !== "card_on_file")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A verified card on file is required before placing a hold.",
        });
      const existing = await db
        .select()
        .from(paymentAuthorizations)
        .where(
          and(
            eq(paymentAuthorizations.bookingPaymentProfileId, profile.id),
            eq(paymentAuthorizations.status, "authorized")
          )
        )
        .limit(1);
      if (existing[0])
        throw new TRPCError({
          code: "CONFLICT",
          message: "An active hold already exists for this booking.",
        });
      const stripe = getStripeClient();
      const agentName = ctx.agent?.agentName ?? "admin";
      let intent: Stripe.PaymentIntent;
      try {
        intent = await stripe.paymentIntents.create(
          {
            amount: booking.firstCleaningTotalCents,
            currency: "usd",
            customer: profile.stripeCustomerId,
            payment_method: profile.stripePaymentMethodId,
            capture_method: "manual",
            confirm: true,
            off_session: true,
            description: `LeadFlow booking ${booking.publicBookingNumber}`,
            metadata: {
              ...bookingPaymentMetadata(booking.id, profile.id),
              operation: "authorization",
              createdBy: agentName,
            },
          },
          {
            idempotencyKey: bookingPaymentIdempotencyKey(
              booking.id,
              "authorization",
              profile.version
            ),
          }
        );
      } catch (error) {
        const message = stripeFailureMessage(error, "Stripe hold failed");
        await db.transaction(async tx => {
          await tx.update(bookingPaymentProfiles).set({ paymentStatus: "failed", failureMessage: message, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
          await tx.update(bookings).set({ paymentStatus: "failed", updatedAt: new Date() }).where(eq(bookings.id, booking.id));
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stripe hold failed: ${message}`,
        });
      }
      if (intent.status !== "requires_capture") {
        await db.transaction(async tx => {
          await tx.update(bookingPaymentProfiles).set({ paymentStatus: "failed", failureMessage: "PaymentIntent did not reach requires_capture", updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
          await tx.update(bookings).set({ paymentStatus: "failed", updatedAt: new Date() }).where(eq(bookings.id, booking.id));
        });
        throw new TRPCError({
          code: "CONFLICT",
          message: "Stripe did not authorize this hold.",
        });
      }
      const now = Date.now();
      const captureBefore =
        typeof intent.payment_method_options?.card?.capture_before === "number"
          ? intent.payment_method_options.card.capture_before * 1000
          : null;
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
      await db
        .update(bookingPaymentProfiles)
        .set({
          paymentStatus: "authorized",
          stripePaymentIntentId: intent.id,
          authorizedAt: now,
          authorizationExpiresAt: captureBefore,
          failureMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(bookingPaymentProfiles.id, profile.id));
      await db
        .update(bookings)
        .set({ paymentStatus: "authorized", updatedAt: new Date() })
        .where(eq(bookings.id, booking.id));
      return {
        authorizationId: Number((result as { insertId?: number }).insertId),
        paymentStatus: "authorized" as const,
        captureBefore,
      };
    }),

  captureHold: agentProcedure
    .input(confirmedBookingInput)
    .mutation(async ({ input, ctx }) => {
      const { db, booking, profile } = await paymentTargetOrThrow(
        input.bookingId
      );
      const [authorization] = await db
        .select()
        .from(paymentAuthorizations)
        .where(
          and(
            eq(paymentAuthorizations.bookingPaymentProfileId, profile.id),
            eq(paymentAuthorizations.status, "authorized")
          )
        )
        .orderBy(desc(paymentAuthorizations.createdAt))
        .limit(1);
      if (!authorization?.stripePaymentIntentId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active booking hold is available to capture.",
        });
      const stripe = getStripeClient();
      const agentName = ctx.agent?.agentName ?? "admin";
      try {
        await stripe.paymentIntents.capture(
          authorization.stripePaymentIntentId,
          { amount_to_capture: authorization.amountCents }
        );
      } catch (error) {
        const message = stripeFailureMessage(error, "Stripe capture failed");
        await db.transaction(async tx => {
          await tx.update(paymentAuthorizations).set({ status: "failed", errorMessage: message, actionBy: agentName }).where(eq(paymentAuthorizations.id, authorization.id));
          await tx.update(bookingPaymentProfiles).set({ paymentStatus: "failed", failureMessage: message, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
          await tx.update(bookings).set({ paymentStatus: "failed", updatedAt: new Date() }).where(eq(bookings.id, booking.id));
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stripe capture failed: ${message}`,
        });
      }
      const now = Date.now();
      await db.transaction(async tx => {
        await tx
          .update(paymentAuthorizations)
          .set({
            status: "captured",
            capturedAt: now,
            actionBy: agentName,
            amountCents: authorization.amountCents,
          })
          .where(eq(paymentAuthorizations.id, authorization.id));
        await tx
          .update(bookingPaymentProfiles)
          .set({
            paymentStatus: "captured",
            capturedAt: now,
            failureMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(bookingPaymentProfiles.id, profile.id));
        await tx
          .update(bookings)
          .set({ paymentStatus: "captured", updatedAt: new Date() })
          .where(eq(bookings.id, booking.id));
      });
      return { success: true, paymentStatus: "captured" as const };
    }),

  cancelHold: agentProcedure
    .input(confirmedBookingInput)
    .mutation(async ({ input, ctx }) => {
      const { db, profile } = await paymentTargetOrThrow(input.bookingId);
      const [authorization] = await db
        .select()
        .from(paymentAuthorizations)
        .where(
          and(
            eq(paymentAuthorizations.bookingPaymentProfileId, profile.id),
            eq(paymentAuthorizations.status, "authorized")
          )
        )
        .orderBy(desc(paymentAuthorizations.createdAt))
        .limit(1);
      if (!authorization?.stripePaymentIntentId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active booking hold is available to cancel.",
        });
      const stripe = getStripeClient();
      const agentName = ctx.agent?.agentName ?? "admin";
      try {
        await stripe.paymentIntents.cancel(authorization.stripePaymentIntentId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stripe cancellation failed: ${stripeFailureMessage(error, "Unknown error")}`,
        });
      }
      const now = Date.now();
      await db.transaction(async tx => {
        await tx
          .update(paymentAuthorizations)
          .set({ status: "cancelled", cancelledAt: now, actionBy: agentName })
          .where(eq(paymentAuthorizations.id, authorization.id));
        await tx
          .update(bookingPaymentProfiles)
          .set({
            paymentStatus: "card_on_file",
            stripePaymentIntentId: null,
            authorizationExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(eq(bookingPaymentProfiles.id, profile.id));
        await tx
          .update(bookings)
          .set({ paymentStatus: "card_on_file", updatedAt: new Date() })
          .where(eq(bookings.id, input.bookingId));
      });
      return { success: true, paymentStatus: "card_on_file" as const };
    }),

  chargeSavedCard: agentProcedure
    .input(confirmedBookingInput)
    .mutation(async ({ input, ctx }) => {
      const { db, booking, profile } = await paymentTargetOrThrow(
        input.bookingId
      );
      if (profile.paymentStatus !== "card_on_file")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A verified card on file is required before charging.",
        });
      const stripe = getStripeClient();
      const agentName = ctx.agent?.agentName ?? "admin";
      let intent: Stripe.PaymentIntent;
      try {
        intent = await stripe.paymentIntents.create(
          {
            amount: booking.firstCleaningTotalCents,
            currency: "usd",
            customer: profile.stripeCustomerId,
            payment_method: profile.stripePaymentMethodId,
            confirm: true,
            off_session: true,
            description: `LeadFlow booking ${booking.publicBookingNumber}`,
            metadata: {
              ...bookingPaymentMetadata(booking.id, profile.id),
              operation: "direct_charge",
              createdBy: agentName,
            },
          },
          {
            idempotencyKey: bookingPaymentIdempotencyKey(
              booking.id,
              "direct_charge",
              profile.version
            ),
          }
        );
      } catch (error) {
        const message = stripeFailureMessage(error, "Stripe charge failed");
        await db.transaction(async tx => {
          await tx.update(bookingPaymentProfiles).set({ paymentStatus: "failed", failureMessage: message, updatedAt: new Date() }).where(eq(bookingPaymentProfiles.id, profile.id));
          await tx.update(bookings).set({ paymentStatus: "failed", updatedAt: new Date() }).where(eq(bookings.id, booking.id));
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stripe charge failed: ${message}`,
        });
      }
      if (intent.status !== "succeeded")
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Stripe requires further action before this card can be charged.",
        });
      const now = Date.now();
      await db.transaction(async tx => {
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
        await tx
          .update(bookingPaymentProfiles)
          .set({
            paymentStatus: "captured",
            stripePaymentIntentId: intent.id,
            capturedAt: now,
            failureMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(bookingPaymentProfiles.id, profile.id));
        await tx
          .update(bookings)
          .set({ paymentStatus: "captured", updatedAt: new Date() })
          .where(eq(bookings.id, booking.id));
      });
      return { success: true, paymentStatus: "captured" as const };
    }),

  placePortalRequestHold: agentProcedure
    .input(confirmedPortalRequestInput)
    .mutation(async ({ input, ctx }) => {
      const { db, request } = await portalRequestPaymentTargetOrThrow(
        input.requestId
      );
      if (request.paymentChargedAt || request.stripePaymentIntentId)
        throw new TRPCError({
          code: "CONFLICT",
          message: "This service request has already been charged.",
        });
      if (await activePortalRequestHold(db, request.id))
        throw new TRPCError({
          code: "CONFLICT",
          message: "An active hold already exists for this service request.",
        });
      const priorAttempts = await db
        .select({ id: paymentAuthorizations.id })
        .from(paymentAuthorizations)
        .where(
          eq(paymentAuthorizations.customerPortalServiceRequestId, request.id)
        );
      const { stripe, customerId } =
        await portalRequestStripeCardOrThrow(request);
      const agentName = ctx.agent?.agentName ?? "admin";
      let intent: Stripe.PaymentIntent;
      try {
        intent = await stripe.paymentIntents.create(
          {
            amount: request.estimatedTotalCents,
            currency: "usd",
            customer: customerId,
            payment_method: request.stripePaymentMethodId,
            capture_method: "manual",
            confirm: true,
            off_session: true,
            description: `LeadFlow service request ${request.publicRequestNumber}`,
            metadata: {
              source: "customer_portal_service_request",
              customerPortalServiceRequestId: String(request.id),
              operation: "authorization",
              createdBy: agentName,
            },
          },
          {
            idempotencyKey: `leadflow:portal-request:${request.id}:authorization:v${priorAttempts.length + 1}`,
          }
        );
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stripe hold failed: ${stripeFailureMessage(error, "Stripe hold failed")}`,
        });
      }
      if (intent.status !== "requires_capture")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Stripe did not authorize this hold.",
        });
      const now = Date.now();
      const captureBefore =
        typeof intent.payment_method_options?.card?.capture_before === "number"
          ? intent.payment_method_options.card.capture_before * 1000
          : null;
      const result = await db.insert(paymentAuthorizations).values({
        cleanerJobId: null,
        bookingPaymentProfileId: null,
        customerPortalServiceRequestId: request.id,
        jobLabel: `Service request ${request.publicRequestNumber}`,
        customerPhone: request.customerPhone,
        customerName: request.customerName,
        stripeCustomerId: customerId,
        stripePaymentMethodId: request.stripePaymentMethodId,
        stripePaymentIntentId: intent.id,
        amountCents: request.estimatedTotalCents,
        currency: "usd",
        operation: "authorization",
        status: "authorized",
        errorMessage: null,
        createdBy: agentName,
        authorizedAt: now,
        captureBefore,
        notes: null,
      });
      return {
        authorizationId: Number((result as { insertId?: number }).insertId),
        paymentStatus: "authorized" as const,
        captureBefore,
      };
    }),

  capturePortalRequestHold: agentProcedure
    .input(confirmedPortalRequestInput)
    .mutation(async ({ input, ctx }) => {
      const { db, request } = await portalRequestPaymentTargetOrThrow(
        input.requestId
      );
      const authorization = await activePortalRequestHold(db, request.id);
      if (!authorization?.stripePaymentIntentId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active service request hold is available to capture.",
        });
      const stripe = getStripeClient();
      const agentName = ctx.agent?.agentName ?? "admin";
      try {
        await stripe.paymentIntents.capture(
          authorization.stripePaymentIntentId,
          { amount_to_capture: request.estimatedTotalCents }
        );
      } catch (error) {
        const message = stripeFailureMessage(error, "Stripe capture failed");
        await db
          .update(paymentAuthorizations)
          .set({ status: "failed", errorMessage: message, actionBy: agentName })
          .where(eq(paymentAuthorizations.id, authorization.id));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stripe capture failed: ${message}`,
        });
      }
      const paymentChargedAt = Date.now();
      await db.transaction(async tx => {
        await tx
          .update(paymentAuthorizations)
          .set({
            status: "captured",
            capturedAt: paymentChargedAt,
            actionBy: agentName,
            amountCents: request.estimatedTotalCents,
          })
          .where(eq(paymentAuthorizations.id, authorization.id));
        await tx
          .update(customerPortalServiceRequests)
          .set({
            stripePaymentIntentId: authorization.stripePaymentIntentId,
            paymentChargedAt,
            updatedAt: new Date(),
          })
          .where(eq(customerPortalServiceRequests.id, request.id));
      });
      return { success: true, paymentStatus: "captured" as const };
    }),

  cancelPortalRequestHold: agentProcedure
    .input(confirmedPortalRequestInput)
    .mutation(async ({ input, ctx }) => {
      const { db, request } = await portalRequestPaymentTargetOrThrow(
        input.requestId
      );
      const authorization = await activePortalRequestHold(db, request.id);
      if (!authorization?.stripePaymentIntentId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active service request hold is available to cancel.",
        });
      const stripe = getStripeClient();
      const agentName = ctx.agent?.agentName ?? "admin";
      try {
        await stripe.paymentIntents.cancel(authorization.stripePaymentIntentId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stripe cancellation failed: ${stripeFailureMessage(error, "Unknown error")}`,
        });
      }
      await db
        .update(paymentAuthorizations)
        .set({
          status: "cancelled",
          cancelledAt: Date.now(),
          actionBy: agentName,
        })
        .where(eq(paymentAuthorizations.id, authorization.id));
      return { success: true, paymentStatus: "card_on_file" as const };
    }),

  chargePortalRequestSavedCard: agentProcedure
    .input(confirmedPortalRequestInput)
    .mutation(async ({ input, ctx }) => {
      const { db, request } = await portalRequestPaymentTargetOrThrow(
        input.requestId
      );
      if (request.paymentChargedAt || request.stripePaymentIntentId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This service request has already been charged.",
        });
      }
      if (await activePortalRequestHold(db, request.id))
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Capture or cancel the active hold before charging this service request.",
        });
      const priorAttempts = await db
        .select({ id: paymentAuthorizations.id })
        .from(paymentAuthorizations)
        .where(
          eq(paymentAuthorizations.customerPortalServiceRequestId, request.id)
        );
      const { stripe, customerId } =
        await portalRequestStripeCardOrThrow(request);
      const agentName = ctx.agent?.agentName ?? "admin";
      let intent: Stripe.PaymentIntent;
      try {
        intent = await stripe.paymentIntents.create(
          {
            amount: request.estimatedTotalCents,
            currency: "usd",
            customer: customerId,
            payment_method: request.stripePaymentMethodId,
            confirm: true,
            off_session: true,
            description: `LeadFlow service request ${request.publicRequestNumber}`,
            metadata: {
              source: "customer_portal_service_request",
              customerPortalServiceRequestId: String(request.id),
              operation: "direct_charge",
              createdBy: agentName,
            },
          },
          {
            idempotencyKey: `leadflow:portal-request:${request.id}:direct_charge:v${priorAttempts.length + 1}`,
          }
        );
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stripe charge failed: ${stripeFailureMessage(error, "Stripe charge failed")}`,
        });
      }
      if (intent.status !== "succeeded") {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Stripe requires further action before this card can be charged.",
        });
      }
      const paymentChargedAt = Date.now();
      await db.transaction(async tx => {
        await tx.insert(paymentAuthorizations).values({
          cleanerJobId: null,
          bookingPaymentProfileId: null,
          customerPortalServiceRequestId: request.id,
          jobLabel: `Service request ${request.publicRequestNumber}`,
          customerPhone: request.customerPhone,
          customerName: request.customerName,
          stripeCustomerId: customerId,
          stripePaymentMethodId: request.stripePaymentMethodId,
          stripePaymentIntentId: intent.id,
          amountCents: request.estimatedTotalCents,
          currency: "usd",
          operation: "direct_charge",
          status: "captured",
          errorMessage: null,
          createdBy: agentName,
          actionBy: agentName,
          authorizedAt: paymentChargedAt,
          capturedAt: paymentChargedAt,
          notes: null,
        });
        await tx
          .update(customerPortalServiceRequests)
          .set({
            stripePaymentIntentId: intent.id,
            paymentChargedAt,
            updatedAt: new Date(),
          })
          .where(eq(customerPortalServiceRequests.id, request.id));
      });
      return {
        success: true,
        paymentStatus: "captured" as const,
        paymentChargedAt,
      };
    }),
});
