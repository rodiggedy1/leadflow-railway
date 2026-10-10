import { and, desc, eq } from "drizzle-orm";
import { madisonMessageUnderstanding, madisonSmsDrafts } from "../drizzle/schema";
import { getDb } from "./db";
import { getSmsReplyPolicy, getSupportTaskPolicy } from "./aiActionPolicy";
import { evaluateMadisonDecision, type MadisonDecisionEvaluation } from "./madisonDecisionEvaluator";

type MadisonDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function shadowFacts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((fact): fact is string => typeof fact === "string") : [];
}

async function latestShadowForDraft(db: MadisonDb, draftId: number) {
  const [shadow] = await db.select({
    confidence: madisonMessageUnderstanding.confidence,
    missingFacts: madisonMessageUnderstanding.missingFacts,
    resolvedBookingId: madisonMessageUnderstanding.resolvedBookingId,
  }).from(madisonMessageUnderstanding)
    .where(eq(madisonMessageUnderstanding.draftId, draftId))
    .orderBy(desc(madisonMessageUnderstanding.createdAt))
    .limit(1);
  return shadow;
}

export async function evaluateMadisonReplyForDraft(
  db: MadisonDb,
  draftId: number,
): Promise<MadisonDecisionEvaluation> {
  const [draft] = await db.select({ fromPhone: madisonSmsDrafts.fromPhone }).from(madisonSmsDrafts)
    .where(eq(madisonSmsDrafts.id, draftId)).limit(1);
  const shadow = await latestShadowForDraft(db, draftId);
  const policy = await getSmsReplyPolicy(db);
  const missingFacts = shadowFacts(shadow?.missingFacts);
  return evaluateMadisonDecision({
    actionKey: "send_sms_reply",
    confidence: shadow?.confidence ?? 0,
    confidenceSource: shadow ? "shadow" : "fallback",
    policyMode: policy.mode,
    policyEnabled: policy.enabled,
    targetResolution: shadow?.resolvedBookingId ? "resolved" : draft?.fromPhone ? "partial" : "unresolved",
    requiredFactsPresent: missingFacts.length === 0,
    missingFacts,
    currentStateVerified: true,
  });
}

export async function evaluateMadisonSupportTaskForDraft(
  db: MadisonDb,
  draftId: number,
  fromPhone: string,
): Promise<MadisonDecisionEvaluation> {
  const shadow = await latestShadowForDraft(db, draftId);
  const policy = await getSupportTaskPolicy(db);
  const missingFacts = shadowFacts(shadow?.missingFacts);
  return evaluateMadisonDecision({
    actionKey: "create_support_task",
    confidence: shadow?.confidence ?? 0,
    confidenceSource: shadow ? "shadow" : "fallback",
    policyMode: policy.mode,
    policyEnabled: policy.enabled,
    targetResolution: shadow?.resolvedBookingId ? "resolved" : fromPhone ? "partial" : "unresolved",
    requiredFactsPresent: missingFacts.length === 0,
    missingFacts,
    currentStateVerified: true,
  });
}

export function guardMadisonDraftAgainstUnverifiedBookingChange(input: {
  inboundText: string;
  draft: string;
  senderName?: string | null;
}): string {
  const hasExplicitTime = /\b(?:at\s*)?(?:[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:am|pm)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i.test(input.inboundText);
  const confirmsChange = /\b(?:we(?:'ll| will)|we have|we've|your clean is|you(?:'re| are) all set).{0,40}\b(?:move|moved|reschedul|changed|confirm|booked)\b/i.test(input.draft);
  if (hasExplicitTime || !confirmsChange) return input.draft;
  const name = input.senderName?.trim() ? `, ${input.senderName.trim().split(/\s+/)[0]}` : "";
  return `Got it${name}! I can help with that. What time would work best for you? I’ll check availability before confirming the change.`;
}
