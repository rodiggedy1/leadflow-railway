import { and, eq } from "drizzle-orm";
import { madisonMessageUnderstanding } from "../drizzle/schema";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";

export const MESSAGE_CATEGORIES = [
  "NEW_BOOKING",
  "QUOTE_REQUEST",
  "AVAILABILITY_REQUEST",
  "RESCHEDULE_REQUEST",
  "CANCELLATION_REQUEST",
  "SERVICE_ISSUE",
  "REFUND_CREDIT_REQUEST",
  "PAYMENT_QUESTION",
  "PAYMENT_ISSUE",
  "ETA_REQUEST",
  "EXISTING_BOOKING_QUESTION",
  "SERVICE_FAQ",
  "CHANGE_BOOKING_DETAILS",
  "CUSTOMER_INFO_INSTRUCTION",
  "CONFIRMATION",
  "OPTOUT",
  "CASUAL_ACKNOWLEDGMENT",
  "AMBIGUOUS",
] as const;

export const CUSTOMER_MISSIONS = [
  "BOOK_SERVICE",
  "MODIFY_BOOKING",
  "CANCEL_BOOKING",
  "RESOLVE_SERVICE_ISSUE",
  "RESOLVE_PAYMENT_ISSUE",
  "ANSWER_BOOKING_QUESTION",
  "ANSWER_SERVICE_QUESTION",
  "PROVIDE_TEAM_STATUS",
  "CUSTOMER_CARE",
  "NO_ACTION",
  "UNRESOLVED",
] as const;

export const MISSION_STATES = [
  "NEW",
  "PARTIALLY_RESOLVED",
  "READY_FOR_REVIEW",
  "WAITING_CUSTOMER",
  "COMPLETED",
  "UNRESOLVED",
] as const;

export const NEXT_BEST_ACTIONS = [
  "ASK_CUSTOMER",
  "RESOLVE_CUSTOMER",
  "RESOLVE_BOOKING",
  "CHECK_AVAILABILITY",
  "LOOK_UP_ETA",
  "LOOK_UP_PAYMENT",
  "CREATE_REVIEW_TASK",
  "DRAFT_REPLY",
  "NO_REPLY_NEEDED",
  "CLARIFY",
  "HOLD_FOR_HUMAN",
] as const;

type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];
type CustomerMission = (typeof CUSTOMER_MISSIONS)[number];
type MissionState = (typeof MISSION_STATES)[number];
type NextBestAction = (typeof NEXT_BEST_ACTIONS)[number];

type MadisonDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type MadisonShadowPrediction = {
  primaryCategory: MessageCategory;
  categories: MessageCategory[];
  mission: CustomerMission;
  missionState: MissionState;
  nextBestAction: NextBestAction;
  confidence: number;
  knownFacts: string[];
  missingFacts: string[];
  model: string;
  classifierVersion: string;
};

export type MadisonShadowPersistenceResult =
  | { ok: true; stage: "persisted"; prediction: MadisonShadowPrediction }
  | {
      ok: false;
      stage: "classifier" | "persistence";
      errorCode: string;
      errorMessage: string;
    };

const enumOr = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

const enumArray = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T[] => {
  if (!Array.isArray(value)) return [fallback];
  const values = value.filter(
    (item): item is T =>
      typeof item === "string" && (allowed as readonly string[]).includes(item)
  );
  return values.length > 0 ? [...new Set(values)] : [fallback];
};

const boundedConfidence = (value: unknown): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0;
};

export function normalizeShadowPrediction(
  value: unknown
): MadisonShadowPrediction {
  const raw = (value ?? {}) as Record<string, unknown>;
  const primaryCategory = enumOr(
    raw.primaryCategory,
    MESSAGE_CATEGORIES,
    "AMBIGUOUS"
  );
  const categories = enumArray(
    raw.categories,
    MESSAGE_CATEGORIES,
    primaryCategory
  );
  if (!categories.includes(primaryCategory))
    categories.unshift(primaryCategory);
  return {
    primaryCategory,
    categories,
    mission: enumOr(raw.mission, CUSTOMER_MISSIONS, "UNRESOLVED"),
    missionState: enumOr(raw.missionState, MISSION_STATES, "UNRESOLVED"),
    nextBestAction: enumOr(
      raw.nextBestAction,
      NEXT_BEST_ACTIONS,
      "HOLD_FOR_HUMAN"
    ),
    confidence: boundedConfidence(raw.confidence),
    knownFacts: Array.isArray(raw.knownFacts)
      ? raw.knownFacts
          .filter((item): item is string => typeof item === "string")
          .slice(0, 20)
      : [],
    missingFacts: Array.isArray(raw.missingFacts)
      ? raw.missingFacts
          .filter((item): item is string => typeof item === "string")
          .slice(0, 20)
      : [],
    model: "gpt-5-mini",
    classifierVersion: "madison-shadow-v1",
  };
}

export async function classifyMadisonMessageShadow(input: {
  inboundText: string;
  conversationMessages?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<MadisonShadowPrediction> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are Madison's shadow-only message understanding classifier for a cleaning-service SMS inbox.
Do not execute actions. Classify the customer's current goal in context.
Use only the supplied enum values. The quote agent is disabled, so QUOTE_REQUEST may be predicted but must not cause quote calculation or link creation.
Return JSON only. Prefer AMBIGUOUS, UNRESOLVED, and HOLD_FOR_HUMAN when context is insufficient.
Categories: ${MESSAGE_CATEGORIES.join(", ")}
Missions: ${CUSTOMER_MISSIONS.join(", ")}
Mission states: ${MISSION_STATES.join(", ")}
Next actions: ${NEXT_BEST_ACTIONS.join(", ")}`,
      },
      ...(input.conversationMessages ?? []).slice(-8),
      { role: "user", content: input.inboundText },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "madison_shadow_prediction",
        strict: true,
        schema: {
          type: "object",
          properties: {
            primaryCategory: { type: "string", enum: [...MESSAGE_CATEGORIES] },
            categories: {
              type: "array",
              items: { type: "string", enum: [...MESSAGE_CATEGORIES] },
              maxItems: 3,
            },
            mission: { type: "string", enum: [...CUSTOMER_MISSIONS] },
            missionState: { type: "string", enum: [...MISSION_STATES] },
            nextBestAction: { type: "string", enum: [...NEXT_BEST_ACTIONS] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            knownFacts: {
              type: "array",
              items: { type: "string" },
              maxItems: 20,
            },
            missingFacts: {
              type: "array",
              items: { type: "string" },
              maxItems: 20,
            },
          },
          required: [
            "primaryCategory",
            "categories",
            "mission",
            "missionState",
            "nextBestAction",
            "confidence",
            "knownFacts",
            "missingFacts",
          ],
          additionalProperties: false,
        },
      },
    },
  });
  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Shadow classifier returned no content");
  return normalizeShadowPrediction(
    typeof content === "string" ? JSON.parse(content) : content
  );
}

export async function persistMadisonMessageShadow(input: {
  db: MadisonDb;
  sourceMessageId: string;
  draftId?: number;
  sessionId: number;
  inboundText: string;
  conversationMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  resolvedCustomerId?: string | null;
  resolvedBookingId?: number | null;
}): Promise<MadisonShadowPersistenceResult> {
  console.info(
    `[MadisonShadow] start source=${input.sourceMessageId} draft=${input.draftId ?? "none"}`
  );

  let prediction: MadisonShadowPrediction;
  try {
    prediction = await classifyMadisonMessageShadow(input);
  } catch (error: any) {
    const errorCode = String(error?.code ?? "SHADOW_CLASSIFIER_ERROR");
    const errorMessage = String(error?.message ?? error);
    console.error(
      `[MadisonShadow] classifier failed source=${input.sourceMessageId} draft=${input.draftId ?? "none"}:`,
      error
    );
    return { ok: false, stage: "classifier", errorCode, errorMessage };
  }

  console.info(
    `[MadisonShadow] classified source=${input.sourceMessageId} category=${prediction.primaryCategory} mission=${prediction.mission}`
  );

  try {
    await input.db
      .insert(madisonMessageUnderstanding)
      .values({
        sourceMessageId: input.sourceMessageId,
        draftId: input.draftId ?? null,
        sessionId: input.sessionId,
        inboundText: input.inboundText,
        primaryCategory: prediction.primaryCategory,
        categories: prediction.categories,
        mission: prediction.mission,
        missionState: prediction.missionState,
        nextBestAction: prediction.nextBestAction,
        confidence: prediction.confidence.toFixed(4),
        knownFacts: prediction.knownFacts,
        missingFacts: prediction.missingFacts,
        resolvedCustomerId: input.resolvedCustomerId ?? null,
        resolvedBookingId: input.resolvedBookingId ?? null,
        model: prediction.model,
        classifierVersion: prediction.classifierVersion,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .catch(async (error: any) => {
        if (
          error?.code !== "ER_DUP_ENTRY" &&
          !String(error?.message ?? "").includes("Duplicate")
        )
          throw error;
        await input.db
          .update(madisonMessageUnderstanding)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(
                madisonMessageUnderstanding.sourceMessageId,
                input.sourceMessageId
              ),
              eq(
                madisonMessageUnderstanding.classifierVersion,
                prediction.classifierVersion
              )
            )
          );
      });
    console.info(
      `[MadisonShadow] persisted source=${input.sourceMessageId} draft=${input.draftId ?? "none"}`
    );
    return { ok: true, stage: "persisted", prediction };
  } catch (error: any) {
    const errorCode = String(error?.code ?? "SHADOW_PERSISTENCE_ERROR");
    const errorMessage = String(error?.message ?? error);
    console.error(
      `[MadisonShadow] persistence failed source=${input.sourceMessageId} draft=${input.draftId ?? "none"}:`,
      error
    );
    return { ok: false, stage: "persistence", errorCode, errorMessage };
  }
}
