import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookingFunnelRecords,
  bookingPaymentProfiles,
} from "../drizzle/schema";
import { NATIVE_BOOKING_PRICING_VERSION, type PrepareBookingInput } from "../shared/booking";
import { BOOKING_TIME_ZONE } from "../shared/easternTime";
import {
  PUBLIC_BOOKING_PRICING_VERSION,
  isPublicBookingPriceSnapshot,
} from "../shared/publicBookingPricing";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { verifyBookingFunnelMutationToken } from "./bookingFunnelService";
import {
  buildPreparedNativeBooking,
  buildPreparedPublicBooking,
  type PreparePublicBookingInput,
} from "./bookingsService";
import { persistCanonicalBooking } from "./canonicalBookingPersistence";

export type PublicBookingFunnelRecord =
  typeof bookingFunnelRecords.$inferSelect;

function asBookingInput(record: PublicBookingFunnelRecord): PrepareBookingInput {
  if (
    !record.customerEmail ||
    !record.serviceId ||
    !record.serviceName ||
    record.bedrooms === null ||
    record.bathrooms === null ||
    !Array.isArray(record.extras) ||
    !record.address ||
    !record.requestedLocalDate ||
    !record.requestedLocalTime ||
    !record.recurrence ||
    !record.pricingVersion ||
    record.firstCleaningTotalCents === null
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Complete the reservation details before adding a card.",
    });
  }
  if (
    !(["standard", "deep", "moveout"] as const).includes(
      record.serviceId as "standard" | "deep" | "moveout"
    )
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unsupported service type.",
    });
  }
  if (
    !(["one-time", "weekly", "biweekly", "monthly"] as const).includes(
      record.recurrence as "one-time" | "weekly" | "biweekly" | "monthly"
    )
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unsupported recurring interval.",
    });
  }
  const extras = record.extras.map(extra => {
    if (
      !extra ||
      typeof extra !== "object" ||
      typeof (extra as { id?: unknown }).id !== "string" ||
      !Number.isInteger((extra as { quantity?: unknown }).quantity)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid reservation extras.",
      });
    }
    return {
      id: (extra as { id: string }).id,
      quantity: (extra as { quantity: number }).quantity,
    };
  });
  return {
    idempotencyKey: record.idempotencyKey,
    surface: record.source === "book-page" ? "full_page" : "popup",
    customer: {
      fullName: record.customerName,
      phone: record.customerPhone,
      email: record.customerEmail,
    },
    service: {
      serviceId: record.serviceId as "standard" | "deep" | "moveout",
      bedrooms: record.bedrooms,
      bathrooms: record.bathrooms,
      extras,
      specialRequestNotes: Array.isArray(record.specialRequestNotes)
        ? record.specialRequestNotes.filter(
            (value): value is string => typeof value === "string"
          )
        : [],
    },
    address: record.address,
    requestedSchedule: {
      localDate: record.requestedLocalDate,
      localTime: record.requestedLocalTime,
    },
    recurrence: record.recurrence as
      | "one-time"
      | "weekly"
      | "biweekly"
      | "monthly",
    acceptedPricing: {
      version: record.pricingVersion as typeof NATIVE_BOOKING_PRICING_VERSION,
      totalCents: record.firstCleaningTotalCents,
    },
  };
}

function asPublicBookingInput(
  record: PublicBookingFunnelRecord
): PreparePublicBookingInput {
  if (
    record.pricingVersion !== PUBLIC_BOOKING_PRICING_VERSION ||
    !isPublicBookingPriceSnapshot(record.priceSnapshot)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The approved booking price is unavailable. Please review your booking.",
    });
  }
  const booking = asBookingInput(record);
  return {
    ...booking,
    acceptedPricing: {
      version: PUBLIC_BOOKING_PRICING_VERSION,
      totalCents: record.firstCleaningTotalCents ?? 0,
    },
    pricing: record.priceSnapshot.input,
  };
}

export function verifyPublicBookingFunnelToken(
  record: PublicBookingFunnelRecord,
  mutationToken: string
): void {
  if (
    !verifyBookingFunnelMutationToken(
      ENV.cookieSecret,
      mutationToken,
      record.publicFunnelNumber,
      record.idempotencyKey
    )
  ) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking record not found.",
    });
  }
}

/**
 * Rebuilds the server-authoritative quote, then creates or reuses the one
 * canonical pending-payment booking bound to the signed public funnel.
 */
export async function ensurePublicBookingPaymentTarget(
  record: PublicBookingFunnelRecord
) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Booking service unavailable.",
    });
  }
  if (record.stage !== "payment_incomplete") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Reserve your appointment before adding a card.",
    });
  }
  const built =
    record.pricingVersion === PUBLIC_BOOKING_PRICING_VERSION
      ? buildPreparedPublicBooking(asPublicBookingInput(record), {
          nowMs: Date.now(),
          timeZone: BOOKING_TIME_ZONE,
        })
      : buildPreparedNativeBooking(asBookingInput(record), {
          nowMs: Date.now(),
          timeZone: BOOKING_TIME_ZONE,
        });
  if (built.type === "price_changed") {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The quoted price changed. Please review the updated quote before continuing.",
    });
  }
  const persisted = await persistCanonicalBooking(db, built.prepared, {
    funnelRecordId: record.id,
    bookingSource:
      record.source === "customer-booking-link" ? "full_page" : undefined,
    initialBookingStatus: "pending_payment",
  });
  const [profile] = await db
    .select()
    .from(bookingPaymentProfiles)
    .where(eq(bookingPaymentProfiles.bookingId, persisted.bookingId))
    .limit(1);
  if (!profile) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Booking payment profile could not be created.",
    });
  }
  return {
    db,
    bookingId: persisted.bookingId,
    profile,
    totalCents: built.prepared.firstCleaningTotalCents,
    customerName: built.prepared.customerName,
  };
}
