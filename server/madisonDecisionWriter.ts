import { eq } from "drizzle-orm";
import {
  madisonActionProposals,
  madisonDecisions,
  madisonIntents,
} from "../drizzle/schema";
import type {
  MadisonContextReference,
  MadisonDisposition,
  MadisonIntentType,
  MadisonModificationOperation,
} from "@shared/madisonOperations";
import {
  MADISON_PROMPT_VERSION,
  MADISON_SCHEMA_VERSION,
  MADISON_VALIDATOR_VERSION,
} from "@shared/madisonOperations";
import { createMadisonActionFingerprint } from "./madisonOperationsValidator";
import type { CapabilityResult, ClassificationResult, ResolvedContext } from "./madisonSmsAgent";
import { hasBookServiceSignal, upsertBookServiceMission, type QuoteInputs } from "./madisonMissionStore";

type MadisonDb = NonNullable<Awaited<ReturnType<import("./db").getDb>>>;

export type PersistMadisonDecisionInput = {
  sourceMessageId: string;
  sessionId: number;
  customerId?: number | null;
  inboundText: string;
  classification: ClassificationResult;
  intent: string | null;
  intentSummary: string;
  draft: string;
  context: ResolvedContext;
  capabilityResult: CapabilityResult | null;
  contextUsed: MadisonContextReference[];
  quoteInputs?: QuoteInputs;
  quoteConversationActive?: boolean;
};

function isDuplicate(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  return candidate.code === "ER_DUP_ENTRY" || candidate.message?.includes("Duplicate") === true;
}

function mapIntent(intent: string | null, classification: ClassificationResult): MadisonIntentType {
  if (intent === "get_eta") return "TEAM_ETA";
  if (intent === "card_status") return "PAYMENT_ISSUE";
  if (classification.type === "QUESTION") return "INFORMATIONAL";
  if (classification.type === "ACTION") return "OTHER_OPERATIONAL";
  return "UNCLEAR";
}

function mapOperation(intent: string | null): MadisonModificationOperation | null {
  return intent === "get_eta" || intent === "card_status" ? "OTHER_MODIFICATION" : null;
}

function mapDisposition(intent: string | null, classification: ClassificationResult): MadisonDisposition {
  if (intent) return "ACTION_REQUIRED";
  if (classification.type === "QUESTION" || classification.type === "ACTION") return "REPLY_ONLY";
  if (classification.type === "CONVERSATION" || classification.type === "INFORMATION") return "NO_ACTION";
  return "ANALYSIS_PENDING";
}

function targetFor(context: ResolvedContext) {
  const targetId = context.bookingId != null ? String(context.bookingId) : null;
  return {
    customerId: context.customerId == null ? null : String(context.customerId),
    bookingId: targetId,
    occurrenceKey: context.serviceDateTime ?? null,
    resolutionStatus: targetId ? "RESOLVED" as const : "UNRESOLVED" as const,
    resolutionNotes: targetId ? [] : ["No unambiguous native booking was resolved from the inbound SMS."],
  };
}

function actionTypeFor(intent: string | null) {
  if (intent === "get_eta") return "OTHER_OPERATION" as const;
  if (intent === "card_status") return "OTHER_OPERATION" as const;
  return null;
}

export function buildMadisonDecision(input: PersistMadisonDecisionInput) {
  const target = targetFor(input.context);
  const operation = mapOperation(input.intent);
  const actionType = actionTypeFor(input.intent);
  const proposalKey = `${input.sourceMessageId}:intent:1:proposal`;
  const parameters = {
    inboundText: input.inboundText,
    capability: input.capabilityResult?.capability ?? null,
  };
  const actionFingerprint = createMadisonActionFingerprint({
    customerId: target.customerId,
    bookingId: target.bookingId,
    occurrenceKey: target.occurrenceKey,
    actionType: actionType ?? "NONE",
    operation,
    parameters,
    sourceMessageId: input.sourceMessageId,
  });

  return {
    decision: {
      sourceMessageId: input.sourceMessageId,
      sessionId: input.sessionId,
      customerId: target.customerId,
      summary: input.intentSummary || input.inboundText,
      disposition: mapDisposition(input.intent, input.classification),
      replyRecommended: input.draft.trim().length > 0 ? 1 : 0,
      replyDraft: input.draft || null,
      uncertainties: target.resolutionNotes,
      contextUsed: input.contextUsed,
      modelProvider: "built-in",
      modelName: "configured-default",
      modelVersion: null,
      promptVersion: MADISON_PROMPT_VERSION,
      schemaVersion: MADISON_SCHEMA_VERSION,
      validatorVersion: MADISON_VALIDATOR_VERSION,
    },
    intent: {
      intentKey: `${input.sourceMessageId}:intent:1`,
      intentType: mapIntent(input.intent, input.classification),
      confidence: input.classification.intentConfidence.toFixed(4),
      evidence: [input.inboundText],
      uncertainties: target.resolutionNotes,
      target,
      request: {
        operation,
        requestedDate: null,
        requestedTime: null,
        requestedOutcome: input.intentSummary || null,
        requestedScope: "UNKNOWN" as const,
      },
    },
    proposal: actionType ? {
      proposalKey,
      actionType,
      operation,
      parameters,
      targetType: target.bookingId ? "booking" : "unresolved",
      targetId: target.bookingId,
      occurrenceKey: target.occurrenceKey,
      riskLevel: 2,
      readiness: target.bookingId ? "READY_FOR_HUMAN_REVIEW" : "TARGET_UNRESOLVED",
      missingParameters: target.bookingId ? [] : ["bookingId"],
      verificationSteps: ["Confirm the customer and booking", "Verify the current operational state", "Approve before taking any action"],
      expectedCurrentState: input.capabilityResult?.result ?? {},
      bookingVersion: null,
      actionFingerprint,
      status: "PROPOSED",
    } : null,
  };
}

export async function persistMadisonDecision(
  db: MadisonDb,
  input: PersistMadisonDecisionInput,
): Promise<{ decisionId: number; created: boolean }> {
  const built = buildMadisonDecision(input);
  const [existing] = await db
    .select({ id: madisonDecisions.id })
    .from(madisonDecisions)
    .where(eq(madisonDecisions.sourceMessageId, input.sourceMessageId))
    .limit(1);
  if (existing) return { decisionId: Number(existing.id), created: false };

  let decisionId: number;
  try {
    const result = await db.insert(madisonDecisions).values(built.decision as any);
    decisionId = Number((result as any)[0]?.insertId);
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    const [duplicate] = await db
      .select({ id: madisonDecisions.id })
      .from(madisonDecisions)
      .where(eq(madisonDecisions.sourceMessageId, input.sourceMessageId))
      .limit(1);
    if (!duplicate) throw error;
    return { decisionId: Number(duplicate.id), created: false };
  }
  if (!decisionId) throw new Error("Madison decision insert returned no id");

  let intentId: number;
  try {
    const result = await db.insert(madisonIntents).values({
      decisionId,
      ...built.intent,
    } as any);
    intentId = Number((result as any)[0]?.insertId);
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    const [existingIntent] = await db
      .select({ id: madisonIntents.id })
      .from(madisonIntents)
      .where(eq(madisonIntents.decisionId, decisionId))
      .limit(1);
    if (!existingIntent) throw error;
    intentId = Number(existingIntent.id);
  }

  if (built.proposal) {
    try {
      await db.insert(madisonActionProposals).values({
        decisionId,
        intentId,
        ...built.proposal,
      } as any);
    } catch (error) {
      if (!isDuplicate(error)) throw error;
    }
  }

  if (hasBookServiceSignal(input.inboundText) || input.quoteConversationActive) {
    await upsertBookServiceMission(db, {
      sessionId: input.sessionId,
      sourceMessageId: input.sourceMessageId,
      inboundText: input.inboundText,
      context: input.context,
      quoteInputs: input.quoteInputs,
    });
  }

  return { decisionId, created: true };
}
