import { and, eq, ne } from "drizzle-orm";
import {
  madisonCustomerMissionFacts,
  madisonCustomerMissions,
} from "../drizzle/schema";
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
  }
): Promise<{ missionId: number; created: boolean } | null> {
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
  const resolvedContext = {
    customerId: input.context.customerId ?? null,
    customerName:
      input.context.customerName ?? input.context.senderName ?? null,
    bookingId: input.context.bookingId ?? null,
    leadflowJobId: input.context.leadflowJobId ?? null,
    serviceDateTime: input.context.serviceDateTime ?? null,
  };

  let missionId: number;
  let created = false;
  if (existing) {
    missionId = Number(existing.id);
    await db
      .update(madisonCustomerMissions)
      .set({
        currentStep: state.currentStep,
        nextBestAction: state.nextBestAction,
        objective: state.objective,
        resolvedContext,
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
      objective: state.objective,
      currentStep: state.currentStep,
      nextBestAction: state.nextBestAction,
      resolvedContext,
      missingContext: [],
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

  return { missionId, created };
}
