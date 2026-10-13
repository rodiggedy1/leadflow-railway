import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { conversationSessions, issueEngineTable, issueEngineTimeline, madisonConversationFactEvents, madisonMessageUnderstanding, madisonSmsDrafts, opsChatMessages } from "../drizzle/schema";
import { getDb } from "./db";
import { opsChatProcedure, router } from "./_core/trpc";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { buildMadisonActionProposal, madisonSmsActionApprovals } from "./madisonActionApprovalStore";
import type { MadisonDecisionEvaluation } from "./madisonDecisionEvaluator";
import { evaluateMadisonReplyForDraft, evaluateMadisonSupportTaskForDraft } from "./madisonReplyDecision";
import type { GoldenDataset } from "./madisonGoldenDataset";
import { madisonGoldenCaseReviews, madisonGoldenReviewRatings } from "./madisonGoldenReviewStore";
import { classifyMadisonMessageShadow } from "./madisonMessageUnderstanding";
import { generateCommandChatReply } from "./commandChatReply";

function loadGoldenDataset(): GoldenDataset {
  return JSON.parse(readFileSync(resolve(process.cwd(), "golden-dataset/candidates.json"), "utf8")) as GoldenDataset;
}

function publicGoldenCase(scenario: GoldenDataset["scenarios"][number], review: typeof madisonGoldenCaseReviews.$inferSelect | undefined) {
  return {
    caseId: scenario.caseId,
    split: scenario.split,
    approvalState: scenario.approvalState,
    currentInboundMessage: scenario.currentInboundMessage,
    priorConversationContext: scenario.priorConversationContext,
    expected: scenario.expected,
    labeling: scenario.labeling,
    review: review ? {
      rating: review.rating,
      reviewer: review.reviewer,
      notes: review.notes,
      actualPrediction: review.actualPrediction,
      expectedAnnotation: review.expectedAnnotation,
      reviewedAt: review.reviewedAt,
    } : null,
  };
}

const SKIP_DEFER_MS = 4 * 60 * 60 * 1000;

const TERMINAL_STAGES = new Set<string>([
  "BOOKED",
  "COMPLETED",
  "CLOSED",
  "LOST",
  "RESOLVED",
  "NOT_INTERESTED",
]);

export type MadisonCategory = "follow_up_due";

export type MadisonSessionRow = {
  id: number;
  leadPhone: string;
  leadName: string | null;
  leadSource: string | null;
  stage: string;
  isBooked: number;
  bookedAt: Date | null;
  smsOptOut: number;
  followUpDate: string | null;
  followUpSent: number;
  messageHistory: string;
  serviceType: string | null;
  address: string | null;
  quotedPrice: string | null;
  lastInboundPhoneNumberId: string | null;
  csStatusTier: string | null;
  csPriorityTag: string | null;
  csPriorityReason: string | null;
  lastMessageText: string | null;
  lastMessageTs: number | null;
  lastCustomerMessageTs: number | null;
  lastMessageRole: string | null;
  madisonDeferredUntil: number | null;
  csResolvedAt: number | Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MadisonCandidate = {
  category: MadisonCategory;
  rank: number;
  whyNow: string;
  session: MadisonSessionRow;
};

function normalizedPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-10) || phone;
}

async function evaluateSupportTaskForDraft(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  draftId: number,
  fromPhone: string,
): Promise<MadisonDecisionEvaluation> {
  return evaluateMadisonSupportTaskForDraft(db, draftId, fromPhone);
}
function activityTimestamp(session: MadisonSessionRow): number {
  return session.lastMessageTs ?? session.updatedAt.getTime() ?? session.createdAt.getTime();
}

function canonicalSessions(rows: readonly MadisonSessionRow[]): MadisonSessionRow[] {
  const latestByPhone = new Map<string, MadisonSessionRow>();
  for (const row of rows) {
    const key = normalizedPhone(row.leadPhone);
    const existing = latestByPhone.get(key);
    if (!existing || activityTimestamp(row) > activityTimestamp(existing) ||
      (activityTimestamp(row) === activityTimestamp(existing) && row.id > existing.id)) {
      latestByPhone.set(key, row);
    }
  }
  return Array.from(latestByPhone.values());
}

function isBaseEligible(session: MadisonSessionRow): boolean {
  if (session.smsOptOut === 1) return false;
  if (session.isBooked === 1 || session.bookedAt !== null) return false;
  if (TERMINAL_STAGES.has(session.stage)) return false;
  if (session.csResolvedAt !== null) return false;
  return true;
}

function easternToday(now: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const values = new Map(parts.map(part => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function followUpIsDueOrOverdue(session: MadisonSessionRow, todayET: string): boolean {
  return session.followUpDate !== null
    && session.followUpSent === 0
    && session.followUpDate <= todayET;
}

function hasFutureScheduledFollowUp(session: MadisonSessionRow, todayET: string): boolean {
  return session.followUpDate !== null
    && session.followUpSent === 0
    && session.followUpDate > todayET;
}

function categoryFor(session: MadisonSessionRow, now: number, todayET: string): MadisonCandidate | null {
  if (session.madisonDeferredUntil !== null && session.madisonDeferredUntil > now) {
    return null;
  }

  if (session.lastMessageRole !== "assistant") return null;
  if (hasFutureScheduledFollowUp(session, todayET)) return null;

  const elapsedMs = Math.max(0, now - activityTimestamp(session));
  const scheduledFollowUpDue = followUpIsDueOrOverdue(session, todayET);
  return {
    category: "follow_up_due",
    rank: 1,
    whyNow: scheduledFollowUpDue
      ? `Scheduled follow-up is due; we sent the last message ${formatElapsed(elapsedMs)} ago and have not heard back.`
      : `We sent the last message ${formatElapsed(elapsedMs)} ago and have not heard back.`,
    session,
  };
}

function formatElapsed(elapsedMs: number): string {
  const minutes = Math.max(1, Math.floor(elapsedMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

/**
 * Pure deterministic queue for the human follow-up portion of CsInbox2's
 * Waiting on Customer column: assistant-last active conversations, newest first.
 */
export function rankMadisonSessions(
  rows: readonly MadisonSessionRow[],
  now: number,
): MadisonCandidate[] {
  const todayET = easternToday(now);
  return canonicalSessions(rows)
    .filter(isBaseEligible)
    .map(session => categoryFor(session, now, todayET))
    .filter((candidate): candidate is MadisonCandidate => candidate !== null)
    .sort((a, b) => activityTimestamp(b.session) - activityTimestamp(a.session));
}

async function loadMadisonCandidates() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  // Use the same actual-inbound eligibility semantics as CsInbox2. Acquisition
  // source and nurture enrollment are not part of Waiting on Customer membership.
  const inboundMessageActivityFilter = sql`(
    JSON_SEARCH(${conversationSessions.messageHistory}, 'one', 'user', NULL, '$[*].role') IS NOT NULL
    OR JSON_SEARCH(${conversationSessions.messageHistory}, 'one', 'customer', NULL, '$[*].role') IS NOT NULL
  )`;

  const sessions = await db
    .select({
        id: conversationSessions.id,
        leadPhone: conversationSessions.leadPhone,
        leadName: conversationSessions.leadName,
        leadSource: conversationSessions.leadSource,
        stage: conversationSessions.stage,
        isBooked: conversationSessions.isBooked,
        bookedAt: conversationSessions.bookedAt,
        smsOptOut: conversationSessions.smsOptOut,
        followUpDate: conversationSessions.followUpDate,
        followUpSent: conversationSessions.followUpSent,
        messageHistory: conversationSessions.messageHistory,
        serviceType: conversationSessions.serviceType,
        address: conversationSessions.address,
        quotedPrice: conversationSessions.quotedPrice,
        lastInboundPhoneNumberId: conversationSessions.lastInboundPhoneNumberId,
        csStatusTier: conversationSessions.csStatusTier,
        csPriorityTag: conversationSessions.csPriorityTag,
        csPriorityReason: conversationSessions.csPriorityReason,
        lastMessageText: conversationSessions.lastMessageText,
        lastMessageTs: conversationSessions.lastMessageTs,
        lastCustomerMessageTs: conversationSessions.lastCustomerMessageTs,
        lastMessageRole: conversationSessions.lastMessageRole,
        madisonDeferredUntil: conversationSessions.madisonDeferredUntil,
        csResolvedAt: conversationSessions.csResolvedAt,
        createdAt: conversationSessions.createdAt,
        updatedAt: conversationSessions.updatedAt,
      })
      .from(conversationSessions)
      .where(and(
        inboundMessageActivityFilter,
        isNull(conversationSessions.csResolvedAt),
        eq(conversationSessions.smsOptOut, 0),
        ne(conversationSessions.isBooked, 1),
        isNull(conversationSessions.bookedAt),
        sql`${conversationSessions.stage} NOT IN ('BOOKED', 'COMPLETED', 'CLOSED', 'LOST', 'RESOLVED', 'NOT_INTERESTED')`,
      ));

  return rankMadisonSessions(
    sessions as MadisonSessionRow[],
    Date.now(),
  );
}

function publicCandidate(candidate: MadisonCandidate) {
  const { session } = candidate;
  return {
    sessionId: session.id,
    leadName: session.leadName ?? "Unknown lead",
    leadPhone: session.leadPhone,
    serviceType: session.serviceType,
    address: session.address,
    quotedPrice: session.quotedPrice,
    messageHistory: session.messageHistory,
    lastMessageText: session.lastMessageText,
    lastMessageTs: session.lastMessageTs,
    lastMessageRole: session.lastMessageRole,
    lastInboundPhoneNumberId: session.lastInboundPhoneNumberId,
    category: candidate.category,
    whyNow: candidate.whyNow,
  };
}

export function getSmsQueueLastRole(messageHistory: string | null): string | null {
  // The summary columns can be stale when an inbound/outbound write races or
  // when older history was backfilled. The queue must match the conversation
  // the owner sees, so use the last real SMS entry from messageHistory.
  if (!messageHistory) return null;
  try {
    const history = JSON.parse(messageHistory) as unknown;
    if (!Array.isArray(history)) return null;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const role = (history[index] as { role?: unknown } | null)?.role;
      if (role === "user" || role === "assistant") return role;
    }
    return null;
  } catch {
    return null;
  }
}

export function shouldShowSmsQueueCard(lastRole: string | null): boolean {
  // If Madison or the office sent the latest message, the customer does not
  // currently need a response. Draft status alone must not keep stale cards
  // in the owner queue.
  return lastRole === "user";
}

export const madisonRouter = router({
  getActiveSmsQueue: opsChatProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({
        id: opsChatMessages.id,
        createdAt: opsChatMessages.createdAt,
        body: opsChatMessages.body,
        metadata: opsChatMessages.metadata,
        mediaUrl: opsChatMessages.mediaUrl,
        draftStatus: madisonSmsDrafts.status,
        messageHistory: conversationSessions.messageHistory,
      })
      .from(opsChatMessages)
      .innerJoin(madisonSmsDrafts, and(
        eq(sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${opsChatMessages.metadata}, '$.draftId')) AS UNSIGNED)`, madisonSmsDrafts.id),
        notInArray(madisonSmsDrafts.status, ["DISMISSED"]),
      ))
      .leftJoin(conversationSessions, eq(opsChatMessages.sessionId, conversationSessions.id))
      .where(and(
        eq(opsChatMessages.channel, "command"),
        eq(opsChatMessages.quickAction as any, "madison_sms_draft"),
        eq(opsChatMessages.cardStatus as any, "active"),
        sql`JSON_VALID(${opsChatMessages.metadata}) = 1`,
      ))
      .orderBy(desc(opsChatMessages.lastActivityAt), desc(opsChatMessages.id));
    return rows
      .filter(row => shouldShowSmsQueueCard(getSmsQueueLastRole(row.messageHistory)))
      .map(row => ({
        id: row.id,
        ts: row.createdAt instanceof Date ? row.createdAt.getTime() : Date.now(),
        quickAction: "madison_sms_draft" as const,
        body: row.body,
        metadata: row.metadata ?? null,
        mediaUrl: row.mediaUrl ?? null,
      }));
  }),
  getActionApproval: opsChatProcedure
    .input(z.object({ draftId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [stored] = await db.select().from(madisonSmsActionApprovals).where(eq(madisonSmsActionApprovals.draftId, input.draftId)).limit(1);
      if (stored) {
        const evaluation = stored.decisionEvaluation ?? await evaluateSupportTaskForDraft(db, input.draftId, stored.fromPhone);
        return { ...stored, decisionEvaluation: evaluation };
      }
      const [draft] = await db.select({ sessionId: madisonSmsDrafts.sessionId, fromPhone: madisonSmsDrafts.fromPhone, senderName: madisonSmsDrafts.senderName, originalMessage: madisonSmsDrafts.originalMessage }).from(madisonSmsDrafts).where(eq(madisonSmsDrafts.id, input.draftId)).limit(1);
      if (!draft) return null;
      const proposal = buildMadisonActionProposal(draft.originalMessage);
      if (!proposal) return null;
      const decisionEvaluation = await evaluateSupportTaskForDraft(db, input.draftId, draft.fromPhone);
      return { id: null, draftId: input.draftId, sessionId: draft.sessionId, fromPhone: draft.fromPhone, customerName: draft.senderName, incomingMessage: draft.originalMessage, ...proposal, decisionEvaluation, status: "PROPOSED" as const, approvedBy: null, approvedAt: null, issueId: null };
    }),
  getReplyDecisionEvaluation: opsChatProcedure
    .input(z.object({ draftId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      return evaluateMadisonReplyForDraft(db, input.draftId);
    }),
  getUnifiedReview: opsChatProcedure
    .input(z.object({ draftId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [draft] = await db.select({
        id: madisonSmsDrafts.id,
        sessionId: madisonSmsDrafts.sessionId,
        fromPhone: madisonSmsDrafts.fromPhone,
        originalMessage: madisonSmsDrafts.originalMessage,
        generatedDraft: madisonSmsDrafts.generatedDraft,
        approvedText: madisonSmsDrafts.approvedText,
        status: madisonSmsDrafts.status,
      }).from(madisonSmsDrafts).where(eq(madisonSmsDrafts.id, input.draftId)).limit(1);
      if (!draft) return null;
      const [shadow] = await db.select({
        sourceMessageId: madisonMessageUnderstanding.sourceMessageId,
        primaryCategory: madisonMessageUnderstanding.primaryCategory,
        mission: madisonMessageUnderstanding.mission,
        missionState: madisonMessageUnderstanding.missionState,
        nextBestAction: madisonMessageUnderstanding.nextBestAction,
        confidence: madisonMessageUnderstanding.confidence,
        knownFacts: madisonMessageUnderstanding.knownFacts,
        missingFacts: madisonMessageUnderstanding.missingFacts,
        extractionStatus: madisonMessageUnderstanding.extractionStatus,
        extractionQualityNote: madisonMessageUnderstanding.extractionQualityNote,
        model: madisonMessageUnderstanding.model,
        classifierVersion: madisonMessageUnderstanding.classifierVersion,
        createdAt: madisonMessageUnderstanding.createdAt,
      }).from(madisonMessageUnderstanding)
        .where(eq(madisonMessageUnderstanding.draftId, input.draftId))
        .orderBy(desc(madisonMessageUnderstanding.createdAt)).limit(1);
      const replyEvaluation = await evaluateMadisonReplyForDraft(db, input.draftId);
      const actionEvaluation = await evaluateSupportTaskForDraft(db, input.draftId, draft.fromPhone);
      const facts = await db.select({
        eventId: madisonConversationFactEvents.eventId,
        factKey: madisonConversationFactEvents.factKey,
        value: madisonConversationFactEvents.value,
        sourceType: madisonConversationFactEvents.sourceType,
        sourceMessageId: madisonConversationFactEvents.sourceMessageId,
        sourceRecordId: madisonConversationFactEvents.sourceRecordId,
        status: madisonConversationFactEvents.status,
        validationStatus: madisonConversationFactEvents.validationStatus,
        evidenceExcerpt: madisonConversationFactEvents.evidenceExcerpt,
        normalizationContext: madisonConversationFactEvents.normalizationContext,
        confidence: madisonConversationFactEvents.confidence,
        observedAt: madisonConversationFactEvents.observedAt,
        validUntil: madisonConversationFactEvents.validUntil,
      }).from(madisonConversationFactEvents)
        .where(eq(madisonConversationFactEvents.draftId, input.draftId))
        .orderBy(asc(madisonConversationFactEvents.observedAt), asc(madisonConversationFactEvents.eventId));
      return {
        draft,
        predictionState: shadow ? "succeeded" as const : "legacy_missing" as const,
        shadow,
        replyEvaluation,
        actionEvaluation,
        facts,
        evaluationVersions: replyEvaluation.versions,
      };
    }),
  getFactEvidence: opsChatProcedure
    .input(z.object({ draftId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select({
          eventId: madisonConversationFactEvents.eventId,
          factKey: madisonConversationFactEvents.factKey,
          value: madisonConversationFactEvents.value,
          sourceType: madisonConversationFactEvents.sourceType,
          sourceMessageId: madisonConversationFactEvents.sourceMessageId,
          sourceRecordId: madisonConversationFactEvents.sourceRecordId,
          status: madisonConversationFactEvents.status,
          validationStatus: madisonConversationFactEvents.validationStatus,
          evidenceExcerpt: madisonConversationFactEvents.evidenceExcerpt,
          normalizationContext: madisonConversationFactEvents.normalizationContext,
          confidence: madisonConversationFactEvents.confidence,
          observedAt: madisonConversationFactEvents.observedAt,
          validUntil: madisonConversationFactEvents.validUntil,
        })
        .from(madisonConversationFactEvents)
        .where(eq(madisonConversationFactEvents.draftId, input.draftId))
        .orderBy(asc(madisonConversationFactEvents.observedAt), asc(madisonConversationFactEvents.eventId));
      return rows;
    }),
  approveActionTask: opsChatProcedure
    .input(z.object({ draftId: z.number().int().positive(), approvedBy: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { ok: false as const, reason: "no_db" };
      let [approval] = await db.select().from(madisonSmsActionApprovals).where(eq(madisonSmsActionApprovals.draftId, input.draftId)).limit(1);
      if (!approval) {
        const [draft] = await db.select({ sessionId: madisonSmsDrafts.sessionId, fromPhone: madisonSmsDrafts.fromPhone, senderName: madisonSmsDrafts.senderName, originalMessage: madisonSmsDrafts.originalMessage }).from(madisonSmsDrafts).where(eq(madisonSmsDrafts.id, input.draftId)).limit(1);
        if (!draft) return { ok: false as const, reason: "not_found" };
        const proposal = buildMadisonActionProposal(draft.originalMessage);
        if (!proposal) return { ok: false as const, reason: "no_action_proposed" };
        const decisionEvaluation = await evaluateSupportTaskForDraft(db, input.draftId, draft.fromPhone);
        await db.insert(madisonSmsActionApprovals).values({ draftId: input.draftId, sessionId: draft.sessionId, fromPhone: draft.fromPhone, customerName: draft.senderName, incomingMessage: draft.originalMessage, ...proposal, decisionEvaluation, status: "PROPOSED", createdAt: new Date(), updatedAt: new Date() }).onDuplicateKeyUpdate({ set: { updatedAt: new Date(), decisionEvaluation } });
        [approval] = await db.select().from(madisonSmsActionApprovals).where(eq(madisonSmsActionApprovals.draftId, input.draftId)).limit(1);
      }
      if (!approval) return { ok: false as const, reason: "not_found" };
      if (approval.status === "APPROVED") return { ok: true as const, alreadyApproved: true, issueId: approval.issueId };
      const decisionEvaluation = approval.decisionEvaluation ?? await evaluateSupportTaskForDraft(db, input.draftId, approval.fromPhone);
      if (approval.decisionEvaluation == null) {
        await db.update(madisonSmsActionApprovals).set({ decisionEvaluation, updatedAt: new Date() }).where(eq(madisonSmsActionApprovals.id, approval.id));
      }
      if (decisionEvaluation.outcome !== "ready_for_human_approval") {
        return { ok: false as const, reason: decisionEvaluation.outcome, decisionEvaluation };
      }
      const [claim] = await db.update(madisonSmsActionApprovals).set({ status: "APPROVING", updatedAt: new Date() }).where(and(eq(madisonSmsActionApprovals.id, approval.id), eq(madisonSmsActionApprovals.status, "PROPOSED")));
      if (((claim as any).affectedRows ?? 0) === 0) return { ok: false as const, reason: "already_approving" };
      const issueType = approval.proposalType === "reschedule" ? "reschedule_needed" : approval.proposalType === "cancellation" ? "other" : "manager_review";
      try {
        const now = Date.now();
        const [issueInsert] = await db.insert(issueEngineTable).values({ title: `${approval.task} — ${approval.customerName ?? "Customer"}`, issueType: issueType as any, severity: "medium", status: "open", notes: `${approval.task}.\n\n${approval.recommendation}\n\nIncoming SMS: ${approval.incomingMessage}\nPhone: ${approval.fromPhone}\nBooking remains unchanged pending human verification.`, ownerName: null, waitingOn: "Office", relatedSessionId: approval.sessionId, relatedJobId: null, createdByName: input.approvedBy, lastActivityAt: now });
        const issueId = Number((issueInsert as any)?.insertId);
        await db.insert(issueEngineTimeline).values({ issueId, event: `AI-recommended task approved by ${input.approvedBy}`, actor: input.approvedBy });
        await db.update(madisonSmsActionApprovals).set({ status: "APPROVED", approvedBy: input.approvedBy, approvedAt: new Date(), issueId, updatedAt: new Date() }).where(eq(madisonSmsActionApprovals.id, approval.id));
        broadcastOpsUpdate("madison_action_task_approved", { draftId: input.draftId, issueId });
        return { ok: true as const, alreadyApproved: false, issueId };
      } catch (error) {
        await db.update(madisonSmsActionApprovals).set({ status: "PROPOSED", updatedAt: new Date() }).where(eq(madisonSmsActionApprovals.id, approval.id));
        throw error;
      }
    }),
  resolveSmsCard: opsChatProcedure
    .input(z.object({
      messageId: z.number().int().positive(),
      resolutionReason: z.enum(["no_reply_needed", "handled_elsewhere"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { ok: false as const, reason: "no_db" };
      const [card] = await db.select({ metadata: opsChatMessages.metadata, cardStatus: opsChatMessages.cardStatus })
        .from(opsChatMessages)
        .where(and(eq(opsChatMessages.id, input.messageId), eq(opsChatMessages.quickAction as any, "madison_sms_draft")))
        .limit(1);
      if (!card) return { ok: false as const, reason: "not_found" };
      if (card.cardStatus !== "active") return { ok: false as const, reason: "already_resolved" };
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(card.metadata ?? "{}"); } catch { /* replace malformed metadata with an audit payload */ }
      const updatedMetadata = JSON.stringify({ ...metadata, resolvedBy: ctx.opsCaller.name, resolvedAt: new Date().toISOString(), resolutionReason: input.resolutionReason });
      await db.update(opsChatMessages)
        .set({ metadata: updatedMetadata, cardStatus: "dismissed", activeDedupKey: null })
        .where(and(eq(opsChatMessages.id, input.messageId), eq(opsChatMessages.cardStatus as any, "active")));
      broadcastOpsUpdate("madison_sms_card_resolved", { messageId: input.messageId });
      return { ok: true as const };
    }),
  getGoldenTestCases: opsChatProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const dataset = loadGoldenDataset();
    const reviews = await db.select().from(madisonGoldenCaseReviews);
    const reviewByCase = new Map(reviews.map(review => [review.caseId, review]));
    return dataset.scenarios.map(scenario => publicGoldenCase(scenario, reviewByCase.get(scenario.caseId)));
  }),
  runGoldenTestCase: opsChatProcedure
    .input(z.object({ caseId: z.string().regex(/^MADISON-\d{3}$/) }))
    .mutation(async ({ input }) => {
      const scenario = loadGoldenDataset().scenarios.find(item => item.caseId === input.caseId);
      if (!scenario) throw new TRPCError({ code: "NOT_FOUND", message: "Golden Test case not found" });
      const actual = await classifyMadisonMessageShadow({
        inboundText: scenario.currentInboundMessage,
        actorRole: scenario.currentActorRole,
        actor: {
          role: scenario.currentActorRole === "cleaner" ? "CLEANER" : scenario.currentActorRole === "employee" || scenario.currentActorRole === "madison" ? "STAFF" : "CUSTOMER",
          source: scenario.currentActorSource ?? "SYSTEM",
          ...(scenario.currentActorIdentityHash ? { identityHash: scenario.currentActorIdentityHash } : {}),
        },
        conversationMessages: scenario.priorConversationContext,
      });
      return { caseId: scenario.caseId, actual, providerPath: "classifyMadisonMessageShadow -> invokeLLM", model: actual.model };
    }),
  runGoldenReplyPreview: opsChatProcedure
    .input(z.object({ sessionId: z.number().int().positive(), inboundMessage: z.string().min(1).max(4000) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [session] = await db.select({ messageHistory: conversationSessions.messageHistory, leadName: conversationSessions.leadName, serviceType: conversationSessions.serviceType, address: conversationSessions.address, quotedPrice: conversationSessions.quotedPrice }).from(conversationSessions).where(eq(conversationSessions.id, input.sessionId)).limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Live SMS session not found" });
      let parsedHistory: unknown = [];
      try { parsedHistory = JSON.parse(session.messageHistory || "[]"); } catch { parsedHistory = []; }
      const history = Array.isArray(parsedHistory)
        ? parsedHistory.filter((message): message is { role: "user" | "assistant"; content: string } => Boolean(message && typeof message === "object" && ((message as any).role === "user" || (message as any).role === "assistant") && typeof (message as any).content === "string")).map(message => ({ role: message.role, content: message.content }))
        : [];
      const jobContext = [session.serviceType && `Service: ${session.serviceType}`, session.address && `Address: ${session.address}`, session.quotedPrice && `Quoted price: ${session.quotedPrice}`].filter(Boolean).join("\n");
      const result = await generateCommandChatReply({
        history,
        customerName: session.leadName ?? undefined,
        jobContext: jobContext || undefined,
        scenario: `Current inbound SMS: "${input.inboundMessage}". Write the reply to this current turn using the conversation history and verified session context above.`,
      });
      return {
        sessionId: input.sessionId,
        inboundMessage: input.inboundMessage,
        reply: result.reply,
        providerPath: "generateCommandChatReply -> invokeLLM",
        readOnly: true,
      };
    }),
  saveGoldenTestRating: opsChatProcedure
    .input(z.object({
      caseId: z.string().regex(/^MADISON-\d{3}$/),
      rating: z.enum(madisonGoldenReviewRatings),
      notes: z.string().max(2000).nullable().optional(),
      actualPrediction: z.unknown().nullable().optional(),
      expectedAnnotation: z.unknown().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scenario = loadGoldenDataset().scenarios.find(item => item.caseId === input.caseId);
      if (!scenario) throw new TRPCError({ code: "NOT_FOUND", message: "Golden Test case not found" });
      if (scenario.split === "held_out") throw new TRPCError({ code: "FORBIDDEN", message: "Held-out cases are locked until development review is complete" });
      const now = new Date();
      await db.insert(madisonGoldenCaseReviews).values({
        caseId: input.caseId,
        rating: input.rating,
        reviewer: ctx.opsCaller.name,
        notes: input.notes ?? null,
        actualPrediction: input.actualPrediction ?? null,
        expectedAnnotation: input.expectedAnnotation ?? null,
        reviewedAt: now,
        updatedAt: now,
      }).onDuplicateKeyUpdate({ set: {
        rating: input.rating,
        reviewer: ctx.opsCaller.name,
        notes: input.notes ?? null,
        actualPrediction: input.actualPrediction ?? null,
        expectedAnnotation: input.expectedAnnotation ?? null,
        reviewedAt: now,
        updatedAt: now,
      } });
      return { ok: true as const, caseId: input.caseId, rating: input.rating };
    }),
  saveGoldenTestLabel: opsChatProcedure
    .input(z.object({
      caseId: z.string().regex(/^MADISON-\d{3}$/),
      expectedAnnotation: z.unknown(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scenario = loadGoldenDataset().scenarios.find(item => item.caseId === input.caseId);
      if (!scenario) throw new TRPCError({ code: "NOT_FOUND", message: "Golden Test case not found" });
      if (scenario.split === "held_out") throw new TRPCError({ code: "FORBIDDEN", message: "Held-out cases are locked until development review is complete" });
      const [existing] = await db.select({ id: madisonGoldenCaseReviews.id })
        .from(madisonGoldenCaseReviews)
        .where(eq(madisonGoldenCaseReviews.caseId, input.caseId))
        .limit(1);
      const now = new Date();
      if (existing) {
        await db.update(madisonGoldenCaseReviews)
          .set({ expectedAnnotation: input.expectedAnnotation, reviewer: ctx.opsCaller.name, updatedAt: now })
          .where(eq(madisonGoldenCaseReviews.id, existing.id));
      } else {
        await db.insert(madisonGoldenCaseReviews).values({
          caseId: input.caseId,
          rating: "uncertain",
          reviewer: ctx.opsCaller.name,
          notes: null,
          actualPrediction: null,
          expectedAnnotation: input.expectedAnnotation,
          reviewedAt: now,
          updatedAt: now,
        });
      }
      return { ok: true as const, caseId: input.caseId };
    }),
  getNextBestActions: opsChatProcedure.query(async () => {
    const candidates = await loadMadisonCandidates();
    return {
      current: candidates[0] ? publicCandidate(candidates[0]) : null,
      upNext: candidates[1] ? publicCandidate(candidates[1]) : null,
      eligibleCount: candidates.length,
    };
  }),

  deferNextBestAction: opsChatProcedure
    .input(z.object({ sessionId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const madisonDeferredUntil = Date.now() + SKIP_DEFER_MS;
      await db
        .update(conversationSessions)
        .set({ madisonDeferredUntil })
        .where(eq(conversationSessions.id, input.sessionId));

      return { success: true, madisonDeferredUntil };
    }),
});
