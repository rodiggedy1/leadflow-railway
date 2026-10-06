import { and, eq, ne } from "drizzle-orm";
import {
  madisonCustomerMissionFacts,
  madisonCustomerMissions,
} from "../drizzle/schema";
import { calculatePrice } from "./engine/pricing";
import type { ResolvedContext } from "./madisonSmsAgent";

type MadisonDb = NonNullable<Awaited<ReturnType<import("./db").getDb>>>;

type MissionStep =
  | "DISCOVERY"
  | "QUOTE_READY"
  | "AVAILABILITY_READY"
  | "OPENINGS_PRESENTED"
  | "OPENING_SELECTED"
  | "BOOKING_READY";
type NextBestAction =
  | "ASK_CUSTOMER"
  | "CALCULATE_QUOTE"
  | "CHECK_AVAILABILITY"
  | "PREPARE_BOOKING";

type FactSource = "customer_sms" | "leadflow_context";

type MissionFact = {
  factKey: string;
  value: unknown;
  source: FactSource;
  sourceRecordId?: string | null;
  sourceMessageId?: string | null;
  confidence: "verified" | "customer_stated";
  observedAt: Date;
  verifiedAt?: Date | null;
  expiresAt?: Date | null;
};
export type QuoteInputs = {
  bedrooms?: string | null;
  bathrooms?: string | null;
  serviceType?: string | null;
};
export type VerifiedQuote = {
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
  amountDollars: number;
  pricingVersion: "engine/pricing-v1";
};

const ACTIVE_MISSION_STATUSES = [
  "ACTIVE",
  "WAITING_CUSTOMER",
  "WAITING_APPROVAL",
  "WAITING_SYSTEM",
] as const;

export function hasBookServiceSignal(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(book|booking|schedule|scheduled|availability|available|opening|appointment|quote|price|pricing|cost|how much|do you have anything)\b/.test(
      normalized
    ) ||
    (/\b(clean|cleaning)\b/.test(normalized) &&
      /\b(when|what day|what time|thursday|friday|saturday|sunday|monday|tuesday|wednesday|tomorrow|next week)\b/.test(
        normalized
      ))
  );
}

export function deriveBookServiceState(text: string): {
  currentStep: MissionStep;
  nextBestAction: NextBestAction;
  objective: string;
} {
  const normalized = text.toLowerCase();
  if (
    /\b(available|availability|opening|what day|what time|when can|thursday|friday|saturday|sunday|monday|tuesday|wednesday|tomorrow|next week)\b/.test(
      normalized
    )
  ) {
    return {
      currentStep: "AVAILABILITY_READY",
      nextBestAction: "CHECK_AVAILABILITY",
      objective: "Book the customer for a verified cleaning opening.",
    };
  }
  if (/\b(quote|price|pricing|cost|how much)\b/.test(normalized)) {
    return {
      currentStep: "DISCOVERY",
      nextBestAction: "ASK_CUSTOMER",
      objective:
        "Book the customer by first resolving the minimum information needed for a verified quote.",
    };
  }
  return {
    currentStep: "DISCOVERY",
    nextBestAction: "ASK_CUSTOMER",
    objective:
      "Book the customer by resolving the minimum information needed for the next useful step.",
  };
}

function normalizeBedroomLabel(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  const exact = [
    "studio",
    "1 bedroom",
    "2 bedrooms",
    "3 bedrooms",
    "4 bedrooms",
    "5 bedrooms",
    "6 bedrooms",
    "7 bedrooms",
    "7+ bedrooms",
  ];
  const match = exact.find(label => label === normalized);
  if (match)
    return match.replace(/\b\w/g, character => character.toUpperCase());
  const numeric = normalized.match(/^(\d+)\s*(?:bed|beds|bedroom|bedrooms)$/);
  if (!numeric) return null;
  const bedrooms = Number(numeric[1]);
  if (bedrooms < 1 || bedrooms > 7) return null;
  return bedrooms === 1 ? "1 Bedroom" : `${bedrooms} Bedrooms`;
}

function normalizeBathroomLabel(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  const numeric = normalized.match(
    /^(\d+(?:\.5)?)\s*(?:bath|baths|bathroom|bathrooms)$/
  );
  if (!numeric) return null;
  const baths = Number(numeric[1]);
  if (![1, 1.5, 2, 2.5, 3, 3.5, 4].includes(baths)) return null;
  return `${baths} ${baths === 1 ? "Bathroom" : "Bathrooms"}`;
}

function normalizeServiceType(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "standard" || normalized === "standard cleaning")
    return "Standard Cleaning";
  if (normalized === "deep" || normalized === "deep cleaning")
    return "Deep Cleaning";
  if (
    normalized === "move-in/move-out" ||
    normalized === "move-in / move-out cleaning" ||
    normalized === "move out"
  )
    return "Move-In / Move-Out Cleaning";
  if (
    normalized === "post-construction" ||
    normalized === "post-construction cleaning"
  )
    return "Post-Construction Cleaning";
  return null;
}

export function resolveVerifiedQuote(inputs: QuoteInputs): {
  quote: VerifiedQuote | null;
  missing: string[];
} {
  const bedrooms = normalizeBedroomLabel(inputs.bedrooms);
  const bathrooms = normalizeBathroomLabel(inputs.bathrooms);
  const serviceType = normalizeServiceType(inputs.serviceType);
  const missing = [
    bedrooms ? null : "bedrooms",
    bathrooms ? null : "bathrooms",
    serviceType ? null : "serviceType",
  ].filter((item): item is string => item !== null);
  if (missing.length > 0) return { quote: null, missing };
  return {
    quote: {
      bedrooms,
      bathrooms,
      serviceType,
      amountDollars: calculatePrice(bedrooms, bathrooms, serviceType),
      pricingVersion: "engine/pricing-v1",
    },
    missing: [],
  };
}

export function formatVerifiedQuoteReply(quote: VerifiedQuote): string {
  return `Thanks — based on a ${quote.bedrooms.toLowerCase()} / ${quote.bathrooms.toLowerCase()} home, your ${quote.serviceType.toLowerCase()} would be $${quote.amountDollars} for the first cleaning. What day works best?`;
}

function contextFacts(context: ResolvedContext): MissionFact[] {
  const now = new Date();
  const facts: MissionFact[] = [];
  if (context.customerId != null)
    facts.push({
      factKey: "customer_id",
      value: context.customerId,
      source: "leadflow_context",
      sourceRecordId: String(context.customerId),
      confidence: "verified",
      observedAt: now,
      verifiedAt: now,
    });
  if (context.customerName)
    facts.push({
      factKey: "customer_name",
      value: context.customerName,
      source: "leadflow_context",
      sourceRecordId:
        context.customerId == null ? null : String(context.customerId),
      confidence: "verified",
      observedAt: now,
      verifiedAt: now,
    });
  if (context.bookingId != null)
    facts.push({
      factKey: "booking_id",
      value: context.bookingId,
      source: "leadflow_context",
      sourceRecordId: String(context.bookingId),
      confidence: "verified",
      observedAt: now,
      verifiedAt: now,
    });
  if (context.leadflowJobId != null)
    facts.push({
      factKey: "leadflow_job_id",
      value: context.leadflowJobId,
      source: "leadflow_context",
      sourceRecordId: String(context.leadflowJobId),
      confidence: "verified",
      observedAt: now,
      verifiedAt: now,
    });
  if (context.serviceDateTime)
    facts.push({
      factKey: "service_date_time",
      value: context.serviceDateTime,
      source: "leadflow_context",
      sourceRecordId:
        context.leadflowJobId == null ? null : String(context.leadflowJobId),
      confidence: "verified",
      observedAt: now,
      verifiedAt: now,
    });
  return facts;
}

async function upsertFact(
  db: MadisonDb,
  missionId: number,
  fact: MissionFact
): Promise<void> {
  await db
    .insert(madisonCustomerMissionFacts)
    .values({
      missionId,
      factKey: fact.factKey,
      value: fact.value,
      source: fact.source,
      sourceRecordId: fact.sourceRecordId ?? null,
      sourceMessageId: fact.sourceMessageId ?? null,
      confidence: fact.confidence,
      observedAt: fact.observedAt,
      verifiedAt: fact.verifiedAt ?? null,
      expiresAt: fact.expiresAt ?? null,
      createdAt: fact.observedAt,
      updatedAt: fact.observedAt,
    } as any)
    .onDuplicateKeyUpdate({
      set: {
        value: fact.value,
        source: fact.source,
        sourceRecordId: fact.sourceRecordId ?? null,
        sourceMessageId: fact.sourceMessageId ?? null,
        confidence: fact.confidence,
        observedAt: fact.observedAt,
        verifiedAt: fact.verifiedAt ?? null,
        expiresAt: fact.expiresAt ?? null,
        updatedAt: fact.observedAt,
      },
    });
}

export async function upsertBookServiceMission(
  db: MadisonDb,
  input: {
    sessionId: number;
    sourceMessageId: string;
    inboundText: string;
    context: ResolvedContext;
    quoteInputs?: QuoteInputs;
  }
): Promise<{
  missionId: number;
  created: boolean;
  quote: VerifiedQuote | null;
} | null> {
  const missionKey = `${input.sessionId}:BOOK_SERVICE`;
  const [existing] = await db
    .select()
    .from(madisonCustomerMissions)
    .where(
      and(
        eq(madisonCustomerMissions.missionKey, missionKey),
        ne(madisonCustomerMissions.status, "COMPLETED")
      )
    )
    .limit(1);

  if (!existing && !hasBookServiceSignal(input.inboundText)) return null;
  if (
    existing &&
    !ACTIVE_MISSION_STATUSES.includes(
      existing.status as (typeof ACTIVE_MISSION_STATUSES)[number]
    )
  )
    return null;

  const now = new Date();
  const state = deriveBookServiceState(input.inboundText);
  const verifiedQuote = resolveVerifiedQuote(input.quoteInputs ?? {});
  const quoteState = verifiedQuote.quote
    ? {
        currentStep: "QUOTE_READY" as const,
        nextBestAction: "CHECK_AVAILABILITY" as const,
        objective: "Book the customer for a verified cleaning opening.",
      }
    : state;
  const resolvedContext = {
    customerId: input.context.customerId ?? null,
    customerName:
      input.context.customerName ?? input.context.senderName ?? null,
    bookingId: input.context.bookingId ?? null,
    leadflowJobId: input.context.leadflowJobId ?? null,
    serviceDateTime: input.context.serviceDateTime ?? null,
    quoteInputs: input.quoteInputs ?? null,
  };
  const missingContext = verifiedQuote.missing;

  let missionId: number;
  let created = false;
  if (existing) {
    missionId = Number(existing.id);
    await db
      .update(madisonCustomerMissions)
      .set({
        currentStep: quoteState.currentStep,
        nextBestAction: quoteState.nextBestAction,
        objective: quoteState.objective,
        resolvedContext,
        missingContext,
        updatedAt: now,
      })
      .where(eq(madisonCustomerMissions.id, missionId));
  } else {
    const result = await db.insert(madisonCustomerMissions).values({
      missionKey,
      sessionId: input.sessionId,
      customerId:
        input.context.customerId == null
          ? null
          : String(input.context.customerId),
      leadId: null,
      bookingId:
        input.context.bookingId == null
          ? null
          : String(input.context.bookingId),
      type: "BOOK_SERVICE",
      status: "ACTIVE",
      objective: quoteState.objective,
      currentStep: quoteState.currentStep,
      nextBestAction: quoteState.nextBestAction,
      resolvedContext,
      missingContext,
      createdAt: now,
      updatedAt: now,
    } as any);
    missionId = Number((result as any)[0]?.insertId);
    if (!missionId)
      throw new Error("BOOK_SERVICE mission insert returned no id");
    created = true;
  }

  await upsertFact(db, missionId, {
    factKey: "latest_customer_message",
    value: input.inboundText,
    source: "customer_sms",
    sourceMessageId: input.sourceMessageId,
    confidence: "customer_stated",
    observedAt: now,
  });
  for (const fact of contextFacts(input.context))
    await upsertFact(db, missionId, fact);
  if (verifiedQuote.quote) {
    await upsertFact(db, missionId, {
      factKey: "verified_quote",
      value: verifiedQuote.quote,
      source: "leadflow_context",
      sourceRecordId: String(input.sessionId),
      sourceMessageId: input.sourceMessageId,
      confidence: "verified",
      observedAt: now,
      verifiedAt: now,
    });
    await upsertFact(db, missionId, {
      factKey: "quote_reply_proposal",
      value: {
        text: formatVerifiedQuoteReply(verifiedQuote.quote),
        status: "READY_FOR_HUMAN_REVIEW",
        amountDollars: verifiedQuote.quote.amountDollars,
      },
      source: "leadflow_context",
      sourceRecordId: String(input.sessionId),
      sourceMessageId: input.sourceMessageId,
      confidence: "verified",
      observedAt: now,
      verifiedAt: now,
    });
  }

  return { missionId, created, quote: verifiedQuote.quote };
}
