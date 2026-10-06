import { and, eq, inArray, ne } from "drizzle-orm";
import {
  madisonCustomerMissionFacts,
  madisonCustomerMissions,
} from "../drizzle/schema";
import {
  calculatePublicBookingPrice,
  PUBLIC_BOOKING_PRICED_EXTRAS,
} from "../shared/publicBookingPricing";
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
  condition?: number | null;
  extras?: Array<{ id: string; quantity: number }> | null;
  extrasConfirmed?: boolean;
};
export type VerifiedQuote = {
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
  condition: number;
  extras: Array<{ id: string; quantity: number }>;
  amountDollars: number;
  pricingVersion: "public-book-v2";
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

export function shouldContinueBookServiceQuote(
  text: string,
  hasActiveMission: boolean,
  hasVerifiedQuote: boolean,
): boolean {
  return hasActiveMission || hasVerifiedQuote || hasBookServiceSignal(text);
}

export async function hasActiveBookServiceMission(
  db: MadisonDb,
  sessionId: number,
): Promise<boolean> {
  const [mission] = await db
    .select({ id: madisonCustomerMissions.id })
    .from(madisonCustomerMissions)
    .where(
      and(
        eq(madisonCustomerMissions.sessionId, sessionId),
        eq(madisonCustomerMissions.type, "BOOK_SERVICE"),
        inArray(madisonCustomerMissions.status, ACTIVE_MISSION_STATUSES),
      ),
    )
    .limit(1);
  return Boolean(mission);
}

export async function getActiveBookServiceQuoteInputs(
  db: MadisonDb,
  sessionId: number,
): Promise<QuoteInputs> {
  const [mission] = await db
    .select({ resolvedContext: madisonCustomerMissions.resolvedContext })
    .from(madisonCustomerMissions)
    .where(
      and(
        eq(madisonCustomerMissions.sessionId, sessionId),
        eq(madisonCustomerMissions.type, "BOOK_SERVICE"),
        inArray(madisonCustomerMissions.status, ACTIVE_MISSION_STATUSES),
      ),
    )
    .limit(1);
  const context = mission?.resolvedContext as { quoteInputs?: QuoteInputs } | null | undefined;
  return context?.quoteInputs ?? {};
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
  if (![1, 2, 3, 4, 5].includes(baths)) return null;
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
  return null;
}

function normalizeCondition(value: number | string | null | undefined): number | null {
  const condition = typeof value === "number" ? value : Number(value);
  return Number.isInteger(condition) && condition >= 1 && condition <= 10
    ? condition
    : null;
}

const EXTRA_ALIASES: Record<string, string[]> = {
  "inside-cabinets": ["inside cabinet", "inside cabinets", "cabinet", "cabinets"],
  "inside-fridge": ["inside fridge", "inside refrigerator", "fridge", "refrigerator"],
  "inside-oven": ["inside oven", "oven"],
  "interior-windows": ["interior window", "interior windows", "inside window", "inside windows"],
  basement: ["basement"],
  "organizing-hour": ["organizing", "organize"],
  "laundry-load": ["laundry", "load of laundry", "loads of laundry"],
  "wipe-walls-room": ["wipe walls", "wiping walls", "walls wiped"],
  "sweep-garage": ["sweep garage", "sweeping garage", "garage"],
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

function quantityForExtra(text: string, aliases: string[]): number {
  const aliasPattern = aliases.map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = text.match(new RegExp(`\\b(\\d+|one|two|three|four|five)\\s+(?:(?:hours?|loads?|rooms?|windows?)\\s+of\\s+)?(?:${aliasPattern})\\b`));
  if (!match) return 1;
  return Math.min(50, Math.max(1, Number(match[1]) || NUMBER_WORDS[match[1]] || 1));
}

function normalizeExtras(
  extras: Array<{ id: string; quantity: number }> | null | undefined,
): Array<{ id: string; quantity: number }> | null {
  if (!extras) return null;
  const normalized = extras
    .filter(extra => PUBLIC_BOOKING_PRICED_EXTRAS[extra.id])
    .map(extra => ({ id: extra.id, quantity: Math.min(50, Math.max(1, Math.round(extra.quantity))) }));
  return normalized.length > 0 ? normalized : [];
}

export function resolveVerifiedQuote(inputs: QuoteInputs): {
  quote: VerifiedQuote | null;
  missing: string[];
} {
  const bedrooms = normalizeBedroomLabel(inputs.bedrooms);
  const bathrooms = normalizeBathroomLabel(inputs.bathrooms);
  const serviceType = normalizeServiceType(inputs.serviceType);
  const condition = normalizeCondition(inputs.condition);
  const extras = normalizeExtras(inputs.extras);
  const missing = [
    bedrooms ? null : "bedrooms",
    bathrooms ? null : "bathrooms",
    serviceType ? null : "serviceType",
    condition ? null : "condition",
    inputs.extrasConfirmed || extras !== null ? null : "extras",
  ].filter((item): item is string => item !== null);
  if (missing.length > 0) return { quote: null, missing };
  return {
    quote: {
      bedrooms,
      bathrooms,
      serviceType,
      condition,
      extras: extras ?? [],
      amountDollars:
        calculatePublicBookingPrice({
          pricingMode: "home",
          serviceId: serviceType.startsWith("Deep")
            ? "deep"
            : serviceType.startsWith("Move")
              ? "moveout"
              : "standard",
          bedrooms: bedrooms.toLowerCase() === "studio" ? 0 : Number(bedrooms.match(/\d+/)?.[0] ?? 0),
          bathrooms: Number(bathrooms.match(/[\d.]+/)?.[0] ?? 0),
          homeType: "House",
          condition,
          maidCount: 1,
          hourCount: 3,
          extras: extras ?? [],
          recurrence: "one-time",
        }).firstCleaningTotalCents / 100,
      pricingVersion: "public-book-v2",
    },
    missing: [],
  };
}

export function extractQuoteInputsFromText(text: string): QuoteInputs {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const bedrooms = normalized.match(/\bstudio\b|\b(\d+)\s*(?:bed|beds|bedroom|bedrooms)\b/)?.[0] ?? null;
  const bathrooms = normalized.match(/\b(\d+(?:\.5)?)\s*(?:bath|baths|bathroom|bathrooms)\b/)?.[0] ?? null;
  const conditionMatch = normalized.match(/\b(?:condition|mess|cleanliness)\s*(?:is|of|at|:)?\s*(10|[1-9])\b|\b(10|[1-9])\s*(?:out of 10|\/\s*10)\b|\bhome\s+is\s+(10|[1-9])\b/);
  const contextualCondition = conditionMatch
    ? Number(conditionMatch[1] ?? conditionMatch[2] ?? conditionMatch[3])
    : /\b(?:no extras|no add-ons|nothing extra|just the cleaning)\b/.test(normalized)
      ? Number(normalized.match(/\b(10|[1-9])\b/)?.[1] ?? NaN)
      : null;
  const condition = Number.isInteger(contextualCondition) ? contextualCondition : null;
  const serviceType = /\bdeep(?:\s+cleaning)?\b/.test(normalized)
    ? "Deep Cleaning"
    : /\b(?:move[- ]?in|move[- ]?out|move[- ]?in\/move[- ]?out)\b/.test(normalized)
      ? "Move-In / Move-Out Cleaning"
      : /\b(?:standard|regular)\s+clean(?:ing)?\b/.test(normalized)
        ? "Standard Cleaning"
        : null;
  const extras = Object.entries(EXTRA_ALIASES)
    .filter(([, aliases]) => aliases.some(alias => normalized.includes(alias)))
    .map(([id, aliases]) => ({ id, quantity: quantityForExtra(normalized, aliases) }));
  const extrasConfirmed = /\b(no|none|nothing|no extras|no add-ons|not right now)\b/.test(normalized)
    ? true
    : extras.length > 0;
  return {
    bedrooms,
    bathrooms,
    serviceType,
    condition,
    extras: extras.length > 0 || extrasConfirmed ? extras : null,
    extrasConfirmed,
  };
}

export function formatMissingQuoteQuestion(missing: string[]): string {
  const prompts: Record<string, string> = {
    serviceType: "what type of cleaning you need (standard, deep, or move-in/move-out)",
    bedrooms: "how many bedrooms are in the home",
    bathrooms: "how many bathrooms are in the home",
    condition: "how you would rate the home’s condition from 1 to 10, where 1 is basically spotless and 10 needs a full reset",
    extras: "whether you want any extras, such as inside the oven or fridge, interior windows, cabinets, the basement, laundry, organizing, wiping walls, or sweeping the garage (or just say no extras)",
  };
  const requested = missing.map(item => prompts[item]).filter(Boolean);
  if (requested.length === 1) return `I can get that quote started — could you tell me ${requested[0]}?`;
  if (requested.length === 2) return `I can get that quote started — could you tell me ${requested[0]} and ${requested[1]}?`;
  if (requested.length === 3)
    return `I can get that quote started — could you tell me ${requested[0]}, ${requested[1]}, and ${requested[2]}?`;
  return "I can get that quote started — what type of cleaning do you need, and how many bedrooms and bathrooms are in the home? Then I’ll ask you to rate the home’s condition from 1 to 10 and whether you want any extras.";
}

export function formatVerifiedQuoteReply(quote: VerifiedQuote): string {
  const extrasText = quote.extras.length > 0
    ? ` That includes ${quote.extras.map(extra => `${PUBLIC_BOOKING_PRICED_EXTRAS[extra.id]?.label ?? extra.id}${extra.quantity > 1 ? ` (${extra.quantity})` : ""}`).join(", ")}.`
    : " There are no extras included."
  return `Thanks — based on a ${quote.bedrooms.toLowerCase()} / ${quote.bathrooms.toLowerCase()} home rated ${quote.condition} out of 10, your ${quote.serviceType.toLowerCase()} would be $${quote.amountDollars} for the first cleaning.${extrasText} What day works best?`;
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
