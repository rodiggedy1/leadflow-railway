import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { bookingPaymentProfiles, bookings, paymentAuthorizations, stripeWebhookEvents } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { getStripeClient } from "./stripeClient";
import { sendBookingCompletionNotifications } from "./bookingCompletionNotifications";

function isDuplicateEntry(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number; message?: string };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062 || candidate.message?.includes("Duplicate entry") === true;
}

async function findBoundProfile(object: Stripe.SetupIntent | Stripe.PaymentIntent) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const profileId = Number(object.metadata.bookingPaymentProfileId);
  const bookingId = Number(object.metadata.bookingId);
  if (!Number.isInteger(profileId) || profileId < 1 || !Number.isInteger(bookingId) || bookingId < 1) return null;
  const [profile] = await db.select().from(bookingPaymentProfiles).where(and(eq(bookingPaymentProfiles.id, profileId), eq(bookingPaymentProfiles.bookingId, bookingId))).limit(1);
  if (!profile) return null;
  const expectedObjectId = "payment_method" in object ? profile.stripeSetupIntentId : profile.stripePaymentIntentId;
  if (expectedObjectId && expectedObjectId !== object.id) return null;
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return null;
  return { db, profile, booking };
}

async function reconcileEvent(event: Stripe.Event, eventRecordId: number) {
  const object = event.data.object;
  if (object.object !== "setup_intent" && object.object !== "payment_intent") return { status: "ignored" as const };
  const bound = await findBoundProfile(object);
  if (!bound) return { status: "ignored" as const };
  const now = new Date();
  if (object.object === "setup_intent" && event.type === "setup_intent.succeeded") {
      await bound.db.transaction(async (tx) => {
        await tx.update(bookingPaymentProfiles).set({ paymentStatus: "card_on_file", stripeSetupIntentId: object.id, updatedAt: now }).where(eq(bookingPaymentProfiles.id, bound.profile.id));
        await tx.update(bookings).set({ status: "needs_attention", paymentStatus: "card_on_file", updatedAt: now }).where(eq(bookings.id, bound.booking.id));
      });
      void sendBookingCompletionNotifications(bound.booking.id).catch((error) =>
        console.error("[StripeWebhookRoute] Booking completion notifications failed:", error)
      );
  } else if (object.object === "setup_intent" && (event.type === "setup_intent.setup_failed" || event.type === "setup_intent.canceled")) {
    await bound.db.update(bookingPaymentProfiles).set({ paymentStatus: "failed", failureCode: object.last_setup_error?.code ?? event.type, failureMessage: object.last_setup_error?.message ?? null, updatedAt: now }).where(eq(bookingPaymentProfiles.id, bound.profile.id));
    await bound.db.update(bookings).set({ paymentStatus: "failed", updatedAt: now }).where(eq(bookings.id, bound.booking.id));
  } else if (object.object === "payment_intent" && event.type === "payment_intent.amount_capturable_updated") {
    await bound.db.transaction(async (tx) => {
      await tx.update(bookingPaymentProfiles).set({ paymentStatus: "authorized", stripePaymentIntentId: object.id, updatedAt: now }).where(eq(bookingPaymentProfiles.id, bound.profile.id));
      await tx.update(paymentAuthorizations).set({ status: "authorized", stripePaymentIntentId: object.id }).where(and(eq(paymentAuthorizations.bookingPaymentProfileId, bound.profile.id), eq(paymentAuthorizations.stripePaymentIntentId, object.id)));
    });
  } else if (object.object === "payment_intent" && event.type === "payment_intent.succeeded") {
    await bound.db.transaction(async (tx) => {
      await tx.update(bookingPaymentProfiles).set({ paymentStatus: "captured", stripePaymentIntentId: object.id, capturedAt: Date.now(), updatedAt: now }).where(eq(bookingPaymentProfiles.id, bound.profile.id));
      await tx.update(paymentAuthorizations).set({ status: "captured", capturedAt: Date.now() }).where(and(eq(paymentAuthorizations.bookingPaymentProfileId, bound.profile.id), eq(paymentAuthorizations.stripePaymentIntentId, object.id)));
    });
  } else if (object.object === "payment_intent" && event.type === "payment_intent.canceled") {
    await bound.db.transaction(async (tx) => {
      await tx.update(bookingPaymentProfiles).set({ paymentStatus: "card_on_file", stripePaymentIntentId: null, authorizationExpiresAt: null, updatedAt: now }).where(eq(bookingPaymentProfiles.id, bound.profile.id));
      await tx.update(paymentAuthorizations).set({ status: "cancelled", cancelledAt: Date.now() }).where(and(eq(paymentAuthorizations.bookingPaymentProfileId, bound.profile.id), eq(paymentAuthorizations.stripePaymentIntentId, object.id)));
    });
  } else if (object.object === "payment_intent" && event.type === "payment_intent.payment_failed") {
    await bound.db.update(bookingPaymentProfiles).set({ paymentStatus: "failed", stripePaymentIntentId: object.id, failureCode: object.last_payment_error?.code ?? event.type, failureMessage: object.last_payment_error?.message ?? null, updatedAt: now }).where(eq(bookingPaymentProfiles.id, bound.profile.id));
  }
  await bound.db.update(stripeWebhookEvents).set({ status: "processed", processedAt: now }).where(eq(stripeWebhookEvents.id, eventRecordId));
  return { status: "processed" as const };
}

export function registerStripeWebhookRoute(app: Express) {
  app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req: Request, res: Response) => {
    if (!ENV.stripeWebhookSecret) return res.status(503).json({ error: "Stripe webhook is not configured" });
    const signature = req.header("stripe-signature");
    if (!signature || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Missing signed Stripe payload" });
    let event: Stripe.Event;
    try {
      event = getStripeClient().webhooks.constructEvent(req.body, signature, ENV.stripeWebhookSecret);
    } catch {
      return res.status(400).json({ error: "Invalid Stripe signature" });
    }
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });
    let eventId: number;
    try {
      const result = await db.insert(stripeWebhookEvents).values({ stripeEventId: event.id, eventType: event.type, objectId: event.data.object.id, bookingPaymentProfileId: null, status: "received", errorMessage: null, receivedAt: new Date(), processedAt: null });
      eventId = Number((result as { insertId?: number }).insertId);
    } catch (error) {
      if (isDuplicateEntry(error)) return res.status(200).json({ received: true, duplicate: true });
      return res.status(500).json({ error: "Could not record Stripe webhook" });
    }
    try {
      const result = await reconcileEvent(event, eventId);
      return res.status(200).json({ received: true, ...result });
    } catch (error) {
      await db.update(stripeWebhookEvents).set({ status: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 1_000) : "Webhook reconciliation failed" }).where(eq(stripeWebhookEvents.id, eventId));
      return res.status(500).json({ error: "Webhook reconciliation failed" });
    }
  });
}
