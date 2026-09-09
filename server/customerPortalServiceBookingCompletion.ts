import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  bookingPaymentProfiles,
  bookings,
  customerPortalServiceRequests,
} from "../drizzle/schema";
import type { CustomerPortalEstimate } from "../shared/customerPortalPricing";
import type { CustomerPortalService } from "../shared/customerPortalServices";
import { ENV } from "./_core/env";
import { sendBookingCompletionNotifications } from "./bookingCompletionNotifications";
import { getDb } from "./db";
import type { CustomerPortalSavedCard } from "./customerPortalPaymentService";
import { createCustomerPortalRequestNumber } from "./customerPortalService";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";

type CustomerPortalAccountForBooking = {
  id: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
};

type ServiceBookingInput = {
  serviceId: string;
  selections: Record<string, string>;
  address: string;
  requestedLocalDate: string;
  requestedLocalTime: string;
  notes?: string;
};

function insertId(result: unknown, label: string): number {
  const value = Number((result as { insertId?: number }).insertId ?? (result as Array<{ insertId?: number }>)[0]?.insertId);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} insert did not return an ID.`);
  return value;
}

function requestedWindowStart(value: string): string {
  const starts: Record<string, string> = {
    Morning: "08:00",
    Midday: "11:00",
    Afternoon: "14:00",
    Evening: "17:00",
  };
  const label = value.split("(")[0]?.trim();
  const start = label ? starts[label] : undefined;
  if (!start) throw new Error("Choose a valid preferred appointment window.");
  return start;
}

function scopeNotes(service: CustomerPortalService, selections: Record<string, string>, notes?: string): string[] {
  const values = service.fields.map((field) => `${field.label}: ${selections[field.label]}`).filter(Boolean);
  if (notes?.trim()) values.push(`Customer note: ${notes.trim()}`);
  return values;
}

export type CompletedCustomerPortalServiceBooking = {
  publicBookingNumber: string;
  serviceName: string;
  estimatedTotalCents: number;
  estimateRequiresReview: boolean;
  requestedLocalDate: string;
  requestedLocalTime: string;
  paymentBrand: string | null;
  paymentLast4: string;
};

/**
 * Shared full completion for every non-cleaning customer portal service. The service
 * supplies its own approved scope and estimate; this template supplies the booking,
 * card-on-file, and existing booking-notification lifecycle.
 */
export async function completeCustomerPortalServiceBooking(args: {
  account: CustomerPortalAccountForBooking;
  input: ServiceBookingInput;
  service: CustomerPortalService;
  estimate: CustomerPortalEstimate;
  savedCard: CustomerPortalSavedCard;
}): Promise<CompletedCustomerPortalServiceBooking> {
  const db = await getDb();
  if (!db) throw new Error("Customer portal is unavailable.");

  const now = new Date();
  const publicRequestNumber = createCustomerPortalRequestNumber();
  const requestedStartAt = businessLocalDateTimeToUtcMs(
    args.input.requestedLocalDate,
    requestedWindowStart(args.input.requestedLocalTime),
    ENV.businessTimezone,
  );
  if (requestedStartAt <= Date.now()) throw new Error("Choose a future preferred appointment.");

  const customerRequest = args.input.notes?.trim()
    || args.service.fields.map((field) => `${field.label}: ${args.input.selections[field.label]}`).join(" · ");
  const publicBookingNumber = publicRequestNumber.replace(/^MIB-R/, "MIB-S");
  const idempotencyKey = `portal-${publicRequestNumber}`;
  const commandHash = createHash("sha256").update(idempotencyKey).digest("hex");

  const bookingId = await db.transaction(async (tx) => {
    const requestResult = await tx.insert(customerPortalServiceRequests).values({
      publicRequestNumber,
      bookingId: null,
      accountId: args.account.id,
      serviceId: args.service.id,
      serviceName: args.service.name,
      status: "requested",
      customerName: args.account.customerName,
      customerPhone: args.account.customerPhone,
      customerEmail: args.account.customerEmail,
      customerRequest,
      scopeSelections: args.input.selections,
      address: args.input.address,
      requestedLocalDate: args.input.requestedLocalDate,
      requestedLocalTime: args.input.requestedLocalTime,
      estimatedTotalCents: args.estimate.estimatedCents,
      estimateRequiresReview: args.estimate.requiresReview ? 1 : 0,
      paymentBrand: args.savedCard.brand,
      paymentLast4: args.savedCard.last4,
      stripePaymentMethodId: args.savedCard.stripePaymentMethodId,
      createdAt: now,
      updatedAt: now,
    });
    const requestId = insertId(requestResult, "Customer portal service request");

    const bookingResult = await tx.insert(bookings).values({
      publicBookingNumber,
      idempotencyKey,
      commandHash,
      source: "portal-service",
      status: "needs_attention",
      availabilityStatus: "requested",
      assignmentStatus: "unassigned",
      paymentStatus: "card_on_file",
      customerName: args.account.customerName,
      customerPhone: args.account.customerPhone,
      customerEmail: args.account.customerEmail ?? "",
      serviceId: args.service.id,
      serviceName: args.service.name,
      bedrooms: 0,
      bathrooms: 0,
      extras: [],
      specialRequestNotes: scopeNotes(args.service, args.input.selections, args.input.notes),
      address: args.input.address,
      requestedLocalDate: args.input.requestedLocalDate,
      requestedLocalTime: args.input.requestedLocalTime,
      requestedTimeZone: ENV.businessTimezone,
      requestedStartAt,
      recurrence: "one-time",
      recurringIntentStatus: null,
      pricingVersion: "customer-portal-service-v1",
      firstCleaningTotalCents: args.estimate.estimatedCents,
      futureVisitTotalCents: null,
      priceSnapshot: {
        version: "customer-portal-service-v1",
        serviceId: args.service.id,
        serviceName: args.service.name,
        selections: args.input.selections,
        lineItems: args.estimate.lineItems,
        estimateRequiresReview: args.estimate.requiresReview,
        estimatedTotalCents: args.estimate.estimatedCents,
      },
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const nextBookingId = insertId(bookingResult, "Customer portal service booking");

    await tx.insert(bookingPaymentProfiles).values({
      bookingId: nextBookingId,
      funnelRecordId: null,
      serviceRequestId: requestId,
      paymentStatus: "card_on_file",
      version: 1,
      stripeCustomerId: args.savedCard.stripeCustomerId,
      stripePaymentMethodId: args.savedCard.stripePaymentMethodId,
      cardBrand: args.savedCard.brand,
      cardLast4: args.savedCard.last4,
      cardExpMonth: args.savedCard.expMonth,
      cardExpYear: args.savedCard.expYear,
      createdAt: now,
      updatedAt: now,
    });
    await tx.update(customerPortalServiceRequests).set({
      bookingId: nextBookingId,
      status: "booked",
      updatedAt: now,
    }).where(and(eq(customerPortalServiceRequests.id, requestId), isNull(customerPortalServiceRequests.bookingId)));
    return nextBookingId;
  });

  void sendBookingCompletionNotifications(bookingId).catch((error) =>
    console.error("[CustomerPortalServiceBookingCompletion] Booking completion notifications failed:", error),
  );

  return {
    publicBookingNumber,
    serviceName: args.service.name,
    estimatedTotalCents: args.estimate.estimatedCents,
    estimateRequiresReview: args.estimate.requiresReview,
    requestedLocalDate: args.input.requestedLocalDate,
    requestedLocalTime: args.input.requestedLocalTime,
    paymentBrand: args.savedCard.brand,
    paymentLast4: args.savedCard.last4,
  };
}
