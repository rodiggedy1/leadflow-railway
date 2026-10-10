import { and, eq } from "drizzle-orm";
import { madisonConversationFactEvents, madisonMessageUnderstanding } from "../drizzle/schema";
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
export type MadisonExtractionStatus = "COMPLETE" | "PARTIAL" | "NO_FACTS_PRESENT" | "EXTRACTION_FAILED" | "VALIDATION_FAILED";

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
  factObservations: Array<{ factKey: string; value: string; evidenceExcerpt: string; sourceMessageId?: string }>;
  extractionStatus: MadisonExtractionStatus;
  extractionQualityNote: string | null;
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
  value: unknown,
  metadata?: { model?: string; classifierVersion?: string }
): MadisonShadowPrediction {
  const source = (value ?? {}) as Record<string, unknown>;
  const raw: Record<string, unknown> = {
    ...source,
    primaryCategory: source.primaryCategory ?? source.category,
    missionState: source.missionState ?? source.mission_state,
    nextBestAction: source.nextBestAction ?? source.nextAction ?? (Array.isArray(source.next_actions) ? source.next_actions[0] : source.next_actions),
    factObservations: Array.isArray(source.factObservations)
      ? source.factObservations.map(observation => {
          const item = observation && typeof observation === "object" ? observation as Record<string, unknown> : {};
          return {
            factKey: item.factKey ?? item.key,
            value: Array.isArray(item.value) ? item.value.join(", ") : item.value,
            evidenceExcerpt: item.evidenceExcerpt,
            sourceMessageId: item.sourceMessageId,
          };
        })
      : source.factObservations && typeof source.factObservations === "object"
        ? Object.entries(source.factObservations as Record<string, unknown>).map(([key, observation]) => {
            const item = observation && typeof observation === "object" ? observation as Record<string, unknown> : {};
            return {
              factKey: item.factKey ?? item.key ?? key,
              value: Array.isArray(item.value) ? item.value.join(", ") : item.value,
              evidenceExcerpt: item.evidenceExcerpt,
              sourceMessageId: item.sourceMessageId,
            };
          })
        : [],
  };
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
    factObservations: Array.isArray(raw.factObservations)
      ? raw.factObservations
          .filter((item): item is { factKey: string; value: string; evidenceExcerpt: string; sourceMessageId?: string } =>
            Boolean(item) && typeof item === "object" &&
            typeof (item as Record<string, unknown>).factKey === "string" &&
            typeof (item as Record<string, unknown>).value === "string" &&
            typeof (item as Record<string, unknown>).evidenceExcerpt === "string"
          )
          .map(item => ({
            factKey: item.factKey.trim().slice(0, 96),
            value: item.value.trim().slice(0, 160),
            evidenceExcerpt: item.evidenceExcerpt.trim().slice(0, 500),
            sourceMessageId: typeof item.sourceMessageId === "string" ? item.sourceMessageId.trim().slice(0, 128) : undefined,
          }))
          .filter(item => item.factKey.length > 0 && item.value.length > 0 && item.evidenceExcerpt.length > 0)
          .slice(0, 20)
      : [],
    extractionStatus: enumOr(raw.extractionStatus, ["COMPLETE", "PARTIAL", "NO_FACTS_PRESENT", "EXTRACTION_FAILED", "VALIDATION_FAILED"] as const, "NO_FACTS_PRESENT"),
    extractionQualityNote: typeof raw.extractionQualityNote === "string" ? raw.extractionQualityNote.slice(0, 500) : null,
    model: typeof metadata?.model === "string" && metadata.model.trim() ? metadata.model.trim().slice(0, 64) : "unknown",
    classifierVersion: typeof metadata?.classifierVersion === "string" && metadata.classifierVersion.trim() ? metadata.classifierVersion.trim().slice(0, 64) : "madison-shadow-v1",
  };
}

export function filterCurrentTurnFactObservations(
  facts: MadisonShadowPrediction["factObservations"],
  inboundText: string
) {
  const currentText = inboundText.trim().toLowerCase();
  return facts.filter(fact =>
    currentText.includes(fact.evidenceExcerpt.trim().toLowerCase())
  );
}

export async function classifyMadisonMessageShadow(input: {
  inboundText: string;
  conversationMessages?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<MadisonShadowPrediction> {
  const configuredModel = process.env.MADISON_OPENAI_MODEL?.trim() || "gpt-5.5";
  const responseFormat = configuredModel.startsWith("gpt-5")
    ? { type: "json_object" as const }
    : {
        type: "json_schema" as const,
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
              knownFacts: { type: "array", items: { type: "string" }, maxItems: 20 },
              missingFacts: { type: "array", items: { type: "string" }, maxItems: 20 },
              factObservations: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  properties: {
                    factKey: { type: "string", minLength: 1, maxLength: 96 },
                    value: { type: "string", minLength: 1 },
                    evidenceExcerpt: { type: "string", minLength: 1, maxLength: 500 },
                    sourceMessageId: { type: "string", maxLength: 128 },
                  },
                  required: ["factKey", "value", "evidenceExcerpt"],
                  additionalProperties: false,
                },
              },
              extractionStatus: {
                type: "string",
                enum: ["COMPLETE", "PARTIAL", "NO_FACTS_PRESENT", "EXTRACTION_FAILED", "VALIDATION_FAILED"],
              },
              extractionQualityNote: { type: ["string", "null"], maxLength: 500 },
            },
            required: [
              "primaryCategory", "categories", "mission", "missionState", "nextBestAction",
              "confidence", "knownFacts", "missingFacts", "factObservations", "extractionStatus",
              "extractionQualityNote",
            ],
            additionalProperties: false,
          },
        },
      };
  const response = await invokeLLM({
    model: configuredModel,
    messages: [
      {
        role: "system",
        content: `You are Madison's shadow-only message understanding classifier for a cleaning-service SMS inbox.
Do not execute actions. Classify the customer's current goal in context.
Extract only explicit customer-stated facts from the current inbound message as factObservations. Do not infer, verify, or invent values.
Conversation history is context only: it may resolve continuity or references, but unrelated historical facts must not become current facts.
Every fact observation must include the exact short evidenceExcerpt copied from the current inbound customer message that supports the value. Use sourceMessageId only when the supplied context identifies it.
Use stable snake_case fact keys such as requested_date, requested_time, requested_service, and customer_provided_booking_reference.
Set extractionStatus to COMPLETE when all explicit facts in the supplied conversation are captured, PARTIAL when some are captured but another explicit fact may be missing, and NO_FACTS_PRESENT only when the supplied customer messages contain no actionable facts.
Use only the supplied enum values. The quote agent is disabled, so QUOTE_REQUEST may be predicted but must not cause quote calculation or link creation.
Return JSON only. Prefer AMBIGUOUS, UNRESOLVED, and HOLD_FOR_HUMAN when context is insufficient.
Categories: ${MESSAGE_CATEGORIES.join(", ")}
Missions: ${CUSTOMER_MISSIONS.join(", ")}
Mission states: ${MISSION_STATES.join(", ")}
Next actions: ${NEXT_BEST_ACTIONS.join(", ")}`,
      },
      ...(input.conversationMessages ?? []).filter(message => message.content.trim().length > 0).slice(-8),
      { role: "user", content: input.inboundText },
    ],
    response_format: responseFormat,
  });
  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Shadow classifier returned no content");
  const prediction = normalizeShadowPrediction(
    typeof content === "string" ? JSON.parse(content) : content,
    { model: response.model, classifierVersion: "madison-shadow-v1" }
  );
  return prediction;
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
    const supportedFacts = filterCurrentTurnFactObservations(
      prediction.factObservations,
      input.inboundText
    );
    const rejectedFactCount = prediction.factObservations.length - supportedFacts.length;
    const extractionStatus = rejectedFactCount > 0 ? "VALIDATION_FAILED" : prediction.extractionStatus;
    const extractionQualityNote = rejectedFactCount > 0
      ? `${rejectedFactCount} historical or unsupported fact observation(s) were not added to the current fact ledger because the evidence excerpt was not found in the current inbound message.`
      : prediction.extractionQualityNote;
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
        extractionStatus,
        extractionQualityNote,
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
    for (const [index, fact] of supportedFacts.entries()) {
      const eventId = `${input.sourceMessageId}:${prediction.classifierVersion}:${index}`;
      await input.db.insert(madisonConversationFactEvents).values({
        eventId,
        sessionId: input.sessionId,
        draftId: input.draftId ?? null,
        factKey: fact.factKey,
        value: fact.value,
        sourceType: "customer_message",
        sourceMessageId: fact.sourceMessageId === input.sourceMessageId ? fact.sourceMessageId : input.sourceMessageId,
        status: "current",
        validationStatus: "validated",
        evidenceExcerpt: fact.evidenceExcerpt,
        normalizationContext: null,
        confidence: prediction.confidence.toFixed(4),
        observedAt: new Date(),
        createdAt: new Date(),
      }).catch((error: any) => {
        if (error?.code !== "ER_DUP_ENTRY" && !String(error?.message ?? "").includes("Duplicate")) throw error;
      });
    }
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
