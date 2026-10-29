import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookingCashAppPayments,
  bookingFunnelRecords,
  bookingPaymentProfiles,
  bookings,
} from "../drizzle/schema";
import { syncNativeBookingPaymentState } from "./bookingLifecycleService";
import { bookingPaymentIdempotencyKey, bookingPaymentMetadata } from "./bookingPaymentService";
import { getStripeClient } from "./stripeClient";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { sendBookingCompletionNotifications } from "./bookingCompletionNotifications";

type Db = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
type Profile = typeof bookingPaymentProfiles.$inferSelect;

const CASH_APP_OPERATION = "cash_app_first_cleaning" as const;

function affectedRows(result: unknown): number {
  const direct = result as { affectedRows?: number };
  const nested = result as Array<{ affectedRows?: number }> | undefined;
  return Number(direct?.affectedRows ?? nested?.[0]?.affectedRows ?? 0);
}

function asStripeErrorMessage(error: unknown, fallback: string): string {
  return (error as Stripe.StripeRawError)?.message ?? fallback;
}

function paymentIntentMetadata(bookingId: number, profileId: number) {
  return {
    ...bookingPaymentMetadata(bookingId, profileId),
    operation: CASH_APP_OPERATION,
    paymentMethod: "cashapp",
  };
}

function assertCashAppTarget(profile: Profile): void {
  if (profile.paymentStatus === "captured") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This booking has already been paid.",
    });
  }
  if (profile.paymentStatus === "card_on_file" || profile.stripeSetupIntentId) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "A card is already being saved for this booking. Please finish card setup instead.",
    });
  }
  if (profile.paymentStatus === "setup_pending") {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Secure card entry is already in progress. Please finish card setup instead.",
    });
  }
}

export async function createOrReuseCashAppPaymentIntent(
  db: Db,
  input: {
    bookingId: number;
    funnelId: number;
    profile: Profile;
    amountCents: number;
    publicBookingNumber: string;
  }
) {
  assertCashAppTarget(input.profile);
  const existing = await db
    .select()
    .from(bookingCashAppPayments)
    .where(
      and(
        eq(bookingCashAppPayments.bookingPaymentProfileId, input.profile.id),
        eq(bookingCashAppPayments.status, "pending")
      )
    )
    .limit(1);
  if (existing[0]) {
    const intent = await getStripeClient().paymentIntents.retrieve(
      existing[0].stripePaymentIntentId
    );
    if (
      !intent.client_secret ||
      intent.amount !== input.amountCents ||
      intent.currency !== "usd"
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Your Cash App payment needs to be started again.",
      });
    }
    return {
      bookingId: input.bookingId,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      returnToken: existing[0].returnToken,
      totalCents: input.amountCents,
    };
  }

  const stripe = getStripeClient();
  const returnToken = randomUUID();
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: "usd",
        payment_method_types: ["cashapp"],
        description: `Maids in Black first cleaning ${input.publicBookingNumber}`,
        metadata: paymentIntentMetadata(input.bookingId, input.profile.id),
      },
      {
        idempotencyKey: bookingPaymentIdempotencyKey(
          input.bookingId,
          CASH_APP_OPERATION,
          input.profile.version
        ),
      }
    );
  } catch (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: asStripeErrorMessage(
        error,
        "Cash App could not be prepared. Please try again."
      ),
    });
  }
  if (!intent.client_secret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Cash App could not be prepared. Please try again.",
    });
  }

  try {
    await db.transaction(async tx => {
      const now = new Date();
      const result = await tx
        .update(bookingPaymentProfiles)
        .set({
          paymentStatus: "charge_pending",
          stripePaymentIntentId: intent.id,
          failureCode: null,
          failureMessage: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(bookingPaymentProfiles.id, input.profile.id),
            eq(bookingPaymentProfiles.version, input.profile.version)
          )
        );
      if (affectedRows(result) !== 1) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "The payment method changed. Please try again.",
        });
      }
      await tx.insert(bookingCashAppPayments).values({
        bookingId: input.bookingId,
        bookingPaymentProfileId: input.profile.id,
        attempt: input.profile.version,
        stripePaymentIntentId: intent.id,
        idempotencyKey: bookingPaymentIdempotencyKey(
          input.bookingId,
          CASH_APP_OPERATION,
          input.profile.version
        ),
        returnToken,
        amountCents: input.amountCents,
        currency: "usd",
        status: "pending",
        cardBrand: null,
        cardLast4: null,
        paidAt: null,
        failureCode: null,
        failureMessage: null,
        createdAt: now,
        updatedAt: now,
      });
      await tx
        .update(bookings)
        .set({
          status: "pending_payment",
          paymentMethod: "cashapp",
          paymentStatus: "charge_pending",
          updatedAt: now,
        })
        .where(eq(bookings.id, input.bookingId));
      await syncNativeBookingPaymentState(tx, {
        bookingId: input.bookingId,
        paymentStatus: "charge_pending",
      });
    });
  } catch (error) {
    const existingAfterRace = await db
      .select()
      .from(bookingCashAppPayments)
      .where(eq(bookingCashAppPayments.stripePaymentIntentId, intent.id))
      .limit(1);
    if (existingAfterRace[0]) {
      return {
        bookingId: input.bookingId,
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        returnToken: existingAfterRace[0].returnToken,
        totalCents: input.amountCents,
      };
    }
    throw error;
  }
  broadcastOpsUpdate("booking_funnel_update");
  return {
    bookingId: input.bookingId,
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    returnToken,
    totalCents: input.amountCents,
  };
}

async function assertSucceededCashAppIntent(
  intent: Stripe.PaymentIntent,
  payment: typeof bookingCashAppPayments.$inferSelect
) {
  if (
    intent.status !== "succeeded" ||
    intent.amount !== payment.amountCents ||
    intent.currency !== payment.currency ||
    intent.metadata.operation !== CASH_APP_OPERATION ||
    intent.metadata.paymentMethod !== "cashapp" ||
    intent.metadata.bookingId !== String(payment.bookingId) ||
    intent.metadata.bookingPaymentProfileId !==
      String(payment.bookingPaymentProfileId)
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Cash App payment verification failed. Please contact support.",
    });
  }
  const paymentMethodId =
    typeof intent.payment_method === "string"
      ? intent.payment_method
      : intent.payment_method?.id;
  if (!paymentMethodId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Cash App payment verification failed. Please contact support.",
    });
  }
  const paymentMethod = await getStripeClient().paymentMethods.retrieve(
    paymentMethodId
  );
  if (paymentMethod.type !== "cashapp") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "The confirmed payment was not Cash App.",
    });
  }
  return paymentMethod;
}

/**
 * Idempotently marks an already-succeeded Stripe Cash App PaymentIntent paid,
 * finalizes the canonical booking, and triggers the existing notification ledger.
 */
export async function settleSucceededCashAppPayment(
  db: Db,
  intent: Stripe.PaymentIntent
) {
  const [payment] = await db
    .select()
    .from(bookingCashAppPayments)
    .where(eq(bookingCashAppPayments.stripePaymentIntentId, intent.id))
    .limit(1);
  if (!payment) return null;
  const paymentMethod = await assertSucceededCashAppIntent(intent, payment);
  let completedNow = false;
  await db.transaction(async tx => {
    const [profile] = await tx
      .select()
      .from(bookingPaymentProfiles)
      .where(
        and(
          eq(bookingPaymentProfiles.id, payment.bookingPaymentProfileId),
          eq(bookingPaymentProfiles.bookingId, payment.bookingId)
        )
      )
      .limit(1);
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, payment.bookingId))
      .limit(1);
    const [funnel] = await tx
      .select()
      .from(bookingFunnelRecords)
      .where(eq(bookingFunnelRecords.bookingId, payment.bookingId))
      .limit(1);
    if (!profile || !booking || !funnel) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This booking payment no longer has a complete booking record.",
      });
    }
    if (payment.status === "paid" && funnel.stage === "booked") return;
    if (
      profile.stripePaymentIntentId !== intent.id ||
      booking.firstCleaningTotalCents !== payment.amountCents
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Cash App payment verification failed. Please contact support.",
      });
    }
    const now = new Date();
    const paymentUpdate = await tx
      .update(bookingCashAppPayments)
      .set({
        status: "paid",
        cardBrand: null,
        cardLast4: null,
        paidAt: Date.now(),
        failureCode: null,
        failureMessage: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(bookingCashAppPayments.id, payment.id),
          eq(bookingCashAppPayments.status, "pending")
        )
      );
    if (affectedRows(paymentUpdate) !== 1) return;
    await tx
      .update(bookingPaymentProfiles)
      .set({
        paymentStatus: "captured",
        stripePaymentIntentId: intent.id,
        capturedAt: Date.now(),
        failureCode: null,
        failureMessage: null,
        updatedAt: now,
      })
      .where(eq(bookingPaymentProfiles.id, profile.id));
    await tx
      .update(bookings)
      .set({
        status: "needs_attention",
        paymentMethod: "cashapp",
        paymentStatus: "captured",
        updatedAt: now,
      })
      .where(eq(bookings.id, booking.id));
    await tx
      .update(bookingFunnelRecords)
      .set({ stage: "booked", updatedAt: now })
      .where(eq(bookingFunnelRecords.id, funnel.id));
    await syncNativeBookingPaymentState(tx, {
      bookingId: booking.id,
      paymentStatus: "captured",
      stripePaymentIntentId: intent.id,
    });
    completedNow = true;
  });
  if (completedNow) {
    broadcastOpsUpdate("booking_funnel_update");
    void sendBookingCompletionNotifications(payment.bookingId).catch(error =>
      console.error(
        "[BookingCashApp] Booking completion notifications failed:",
        error
      )
    );
  }
  return {
    bookingId: payment.bookingId,
    totalCents: payment.amountCents,
    completedNow,
  };
}

export async function markCashAppPaymentUnavailable(
  db: Db,
  intent: Stripe.PaymentIntent,
  status: "failed" | "cancelled"
) {
  const [payment] = await db
    .select()
    .from(bookingCashAppPayments)
    .where(eq(bookingCashAppPayments.stripePaymentIntentId, intent.id))
    .limit(1);
  if (!payment || payment.status !== "pending") return null;
  const now = new Date();
  await db.transaction(async tx => {
    await tx
      .update(bookingCashAppPayments)
      .set({
        status,
        failureCode:
          status === "failed"
            ? intent.last_payment_error?.code ?? "payment_failed"
            : "payment_cancelled",
        failureMessage:
          status === "failed"
            ? intent.last_payment_error?.message ?? null
            : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(bookingCashAppPayments.id, payment.id),
          eq(bookingCashAppPayments.status, "pending")
        )
      );
    await tx
      .update(bookingPaymentProfiles)
      .set({
        paymentStatus: "not_started",
        stripePaymentIntentId: null,
        version: sql`${bookingPaymentProfiles.version} + 1`,
        failureCode:
          status === "failed"
            ? intent.last_payment_error?.code ?? "payment_failed"
            : "payment_cancelled",
        failureMessage:
          status === "failed"
            ? intent.last_payment_error?.message ?? null
            : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(bookingPaymentProfiles.id, payment.bookingPaymentProfileId),
          eq(bookingPaymentProfiles.stripePaymentIntentId, intent.id)
        )
      );
    await tx
      .update(bookings)
      .set({
        paymentMethod: "card",
        paymentStatus: "not_started",
        updatedAt: now,
      })
      .where(eq(bookings.id, payment.bookingId));
    await syncNativeBookingPaymentState(tx, {
      bookingId: payment.bookingId,
      paymentStatus: "not_started",
    });
  });
  broadcastOpsUpdate("booking_funnel_update");
  return { bookingId: payment.bookingId, status };
}

export async function abandonCashAppPayment(
  db: Db,
  input: { bookingId: number; paymentIntentId: string }
) {
  const [payment] = await db
    .select()
    .from(bookingCashAppPayments)
    .where(
      and(
        eq(bookingCashAppPayments.bookingId, input.bookingId),
        eq(bookingCashAppPayments.stripePaymentIntentId, input.paymentIntentId),
        eq(bookingCashAppPayments.status, "pending")
      )
    )
    .limit(1);
  if (!payment) return { abandoned: false as const };
  const stripe = getStripeClient();
  const intent = await stripe.paymentIntents.retrieve(input.paymentIntentId);
  if (intent.status === "succeeded") {
    return { abandoned: false as const, alreadySucceeded: true as const };
  }
  const cancelled =
    intent.status === "canceled"
      ? intent
      : await stripe.paymentIntents.cancel(input.paymentIntentId);
  await markCashAppPaymentUnavailable(db, cancelled, "cancelled");
  return { abandoned: true as const, alreadySucceeded: false as const };
}
