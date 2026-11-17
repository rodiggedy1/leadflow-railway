import { TRPCError } from "@trpc/server";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { bookingFunnelRecords } from "../drizzle/schema";
import type { CreateCustomerBookingLinkInput } from "../shared/bookingFunnel";
import { createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICING_VERSION } from "../shared/publicBookingPricing";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { normalizePhone } from "./utils/phone";

type Db = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
export type CustomerBookingLinkDb = Pick<Db, "insert">;
export type CustomerBookingLinkAttribution = { agentId: number | null; agentName: string };

/** Transaction callers pass a no-op notify and broadcast only after their commit. */
export async function createCustomerBookingLink(
  db: CustomerBookingLinkDb,
  input: CreateCustomerBookingLinkInput,
  attribution: CustomerBookingLinkAttribution,
  notify: () => void = () => broadcastOpsUpdate("booking_funnel_update"),
) {
  const phone = normalizePhone(input.customerPhone);
  if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid U.S. phone number." });
  const priceSnapshot = createPublicBookingPriceSnapshot(input.pricing);
  const normalizedCustomerName = input.customerName.trim().replace(/\s+/g, " ");
  const nameSlug = normalizedCustomerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "customer";
  const token = `mib-${nameSlug}-${randomBytes(5).toString("hex")}`.slice(0, 40);
  const idempotencyKey = randomUUID();
  const commandHash = createHash("sha256").update(JSON.stringify({ token, idempotencyKey, input })).digest("hex");
  const now = new Date();
  await db.insert(bookingFunnelRecords).values({
    publicFunnelNumber: token,
    idempotencyKey,
    commandHash,
    source: "customer-booking-link",
    stage: "lead",
    bookedByAgentId: attribution.agentId,
    bookedByAgentName: attribution.agentName,
    customerName: normalizedCustomerName,
    customerPhone: phone,
    customerEmail: input.customerEmail?.trim().toLowerCase() || null,
    serviceId: input.pricing.serviceId,
    serviceName: priceSnapshot.serviceName,
    bedrooms: input.pricing.bedrooms,
    bathrooms: input.pricing.bathrooms,
    extras: input.pricing.extras,
    specialRequestNotes: input.notes,
    address: input.address?.trim() || null,
    requestedLocalDate: input.requestedLocalDate,
    requestedLocalTime: input.requestedLocalTime,
    requestedTimeZone: "America/New_York",
    recurrence: input.pricing.recurrence,
    pricingVersion: PUBLIC_BOOKING_PRICING_VERSION,
    firstCleaningTotalCents: priceSnapshot.breakdown.firstCleaningTotalCents,
    futureVisitTotalCents: priceSnapshot.breakdown.futureVisitTotalCents,
    priceSnapshot,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  notify();
  return { token, urlPath: `/book/${token}`, firstCleaningTotalCents: priceSnapshot.breakdown.firstCleaningTotalCents };
}
