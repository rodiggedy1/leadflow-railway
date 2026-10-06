import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { bookingFunnelRecords, madisonCustomerMissionFacts, madisonCustomerMissions } from "../drizzle/schema";
import { createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICING_VERSION } from "../shared/publicBookingPricing";
import { createBookingFunnelMutationToken, createBookingFunnelNumber } from "./bookingFunnelService";
import { resolveVerifiedQuote, type QuoteInputs } from "./madisonMissionStore";
import { ENV } from "./_core/env";
import type { getDb } from "./db";

type MadisonDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function createMadisonQuoteLink(
  db: MadisonDb,
  input: {
    sessionId: number;
    customerName: string | null | undefined;
    customerPhone: string;
    quoteInputs: QuoteInputs;
    agentId?: number | null;
    agentName?: string | null;
  },
) {
  const verified = resolveVerifiedQuote(input.quoteInputs);
  if (!verified.quote) {
    throw new Error(`Quote is incomplete. Missing: ${verified.missing.join(", ")}.`);
  }
  const bedrooms = verified.quote.bedrooms.toLowerCase() === "studio" ? 0 : Number(verified.quote.bedrooms.match(/\d+/)?.[0] ?? 0);
  const bathrooms = Number(verified.quote.bathrooms.match(/[\d.]+/)?.[0] ?? 0);
  const serviceId = verified.quote.serviceType.startsWith("Deep") ? "deep" : verified.quote.serviceType.startsWith("Move") ? "moveout" : "standard";
  const pricing = {
    pricingMode: "home" as const,
    serviceId: serviceId as "standard" | "deep" | "moveout",
    bedrooms,
    bathrooms,
    homeType: "House" as const,
    condition: verified.quote.condition,
    maidCount: 1,
    hourCount: 3,
    extras: verified.quote.extras,
    recurrence: "one-time" as const,
  };
  const priceSnapshot = createPublicBookingPriceSnapshot(pricing);
  const publicFunnelNumber = createBookingFunnelNumber();
  const idempotencyKey = randomUUID();
  const commandHash = createHash("sha256").update(JSON.stringify({ publicFunnelNumber, idempotencyKey, sessionId: input.sessionId, pricing })).digest("hex");
  const now = new Date();
  await db.insert(bookingFunnelRecords).values({
    publicFunnelNumber,
    idempotencyKey,
    commandHash,
    source: "madison-quote",
    stage: "lead",
    bookedByAgentId: input.agentId ?? null,
    bookedByAgentName: input.agentName ?? "Madison",
    customerName: input.customerName?.trim() || "Customer",
    customerPhone: input.customerPhone,
    customerEmail: null,
    serviceId,
    serviceName: priceSnapshot.serviceName,
    bedrooms,
    bathrooms,
    extras: verified.quote.extras,
    specialRequestNotes: [
      "Created from Madison verified quote",
      `Home condition: ${verified.quote.condition}/10`,
    ],
    address: null,
    requestedLocalDate: null,
    requestedLocalTime: null,
    requestedTimeZone: "America/New_York",
    recurrence: "one-time",
    pricingVersion: PUBLIC_BOOKING_PRICING_VERSION,
    firstCleaningTotalCents: priceSnapshot.breakdown.firstCleaningTotalCents,
    futureVisitTotalCents: priceSnapshot.breakdown.futureVisitTotalCents,
    priceSnapshot,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const [mission] = await db
    .select({ id: madisonCustomerMissions.id })
    .from(madisonCustomerMissions)
    .where(and(eq(madisonCustomerMissions.sessionId, input.sessionId), eq(madisonCustomerMissions.type, "BOOK_SERVICE")))
    .orderBy(desc(madisonCustomerMissions.updatedAt))
    .limit(1);
  if (mission) {
    await db.insert(madisonCustomerMissionFacts).values({
      missionId: mission.id,
      factKey: "quote_link",
      value: { publicFunnelNumber, urlPath: `/book/${publicFunnelNumber}`, status: "CREATED_AND_SENT", amountCents: priceSnapshot.breakdown.firstCleaningTotalCents },
      source: "leadflow_context",
      sourceRecordId: publicFunnelNumber,
      confidence: "verified",
      observedAt: now,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    } as any);
  }
  return {
    token: publicFunnelNumber,
    urlPath: `/book/${publicFunnelNumber}`,
    absoluteUrl: `${ENV.quoteAppUrl}/book/${publicFunnelNumber}`,
    mutationToken: createBookingFunnelMutationToken(ENV.cookieSecret, publicFunnelNumber, idempotencyKey),
    firstCleaningTotalCents: priceSnapshot.breakdown.firstCleaningTotalCents,
  };
}
