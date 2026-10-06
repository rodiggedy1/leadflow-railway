import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { conversationSessions, madisonSmsDrafts, opsChatMessages } from "../drizzle/schema";
import { getDb } from "./db";
import { opsChatProcedure, router } from "./_core/trpc";
import { broadcastOpsUpdate } from "./sseBroadcast";

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
        notInArray(madisonSmsDrafts.status, ["SENT", "DISMISSED", "DELIVERED"]),
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
