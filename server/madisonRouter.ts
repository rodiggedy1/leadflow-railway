import { TRPCError } from "@trpc/server";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { conversationSessions, nurtureEnrollments } from "../drizzle/schema";
import { NON_LEAD_SOURCES } from "../shared/leadSources";
import { getDb } from "./db";
import { opsChatProcedure, router } from "./_core/trpc";

const FOLLOW_UP_DUE_MS = 2 * 60 * 60 * 1000;
const SKIP_DEFER_MS = 4 * 60 * 60 * 1000;
const RECENT_CUSTOMER_REPLY_MS = 7 * 24 * 60 * 60 * 1000;

const EXCLUDED_SOURCES = new Set<string>([
  ...NON_LEAD_SOURCES,
  "cs_initiated",
  "cs-inbound",
  "cs-inbound-cleaner",
  "hiring_interview",
  "hiring",
  "review_rebooking",
  "review",
  "schedule_confirm",
]);

const TERMINAL_STAGES = new Set<string>([
  "BOOKED",
  "COMPLETED",
  "CLOSED",
  "LOST",
  "RESOLVED",
  "NOT_INTERESTED",
]);

const URGENT_STATUS_TIERS = new Set(["hot_lead", "scheduling", "objection"]);
const URGENT_PRIORITY_TAGS = new Set(["booking", "urgent"]);

export type MadisonCategory =
  | "customer_waiting"
  | "urgent_high_intent"
  | "follow_up_due"
  | "re_engagement";

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

function isBaseEligible(session: MadisonSessionRow, activeNurtureSessionIds: ReadonlySet<number>): boolean {
  if (session.smsOptOut === 1) return false;
  if (session.isBooked === 1 || session.bookedAt !== null) return false;
  if (TERMINAL_STAGES.has(session.stage)) return false;
  if (!session.leadSource || EXCLUDED_SOURCES.has(session.leadSource)) return false;
  if (activeNurtureSessionIds.has(session.id)) return false;
  if (session.followUpDate && session.followUpSent === 0) return false;
  return true;
}

function categoryFor(session: MadisonSessionRow, now: number): MadisonCandidate | null {
  const customerReplyElapsedMs = session.lastMessageRole === "user"
    ? Math.max(0, now - (session.lastCustomerMessageTs ?? session.lastMessageTs ?? now))
    : null;
  const lastTouchElapsedMs = Math.max(0, now - activityTimestamp(session));

  if (customerReplyElapsedMs !== null && customerReplyElapsedMs <= RECENT_CUSTOMER_REPLY_MS) {
    return {
      category: "customer_waiting",
      rank: 1,
      whyNow: `Customer replied ${formatElapsed(customerReplyElapsedMs)} ago and is waiting for us.`,
      session,
    };
  }

  if (session.madisonDeferredUntil !== null && session.madisonDeferredUntil > now) {
    return null;
  }

  if (URGENT_STATUS_TIERS.has(session.csStatusTier ?? "") || URGENT_PRIORITY_TAGS.has(session.csPriorityTag ?? "")) {
    if (lastTouchElapsedMs > RECENT_CUSTOMER_REPLY_MS) {
      return {
        category: "re_engagement",
        rank: 4,
        whyNow: `Last touch was ${formatElapsed(lastTouchElapsedMs)} ago; consider a manual re-engagement touch.`,
        session,
      };
    }
    return {
      category: "urgent_high_intent",
      rank: 2,
      whyNow: session.csPriorityReason?.trim() || urgentReason(session),
      session,
    };
  }

  if (session.lastMessageRole === "assistant" && session.lastMessageTs !== null && now - session.lastMessageTs >= FOLLOW_UP_DUE_MS) {
    if (lastTouchElapsedMs > RECENT_CUSTOMER_REPLY_MS) {
      return {
        category: "re_engagement",
        rank: 4,
        whyNow: `Last touch was ${formatElapsed(lastTouchElapsedMs)} ago; consider a manual re-engagement touch.`,
        session,
      };
    }
    return {
      category: "follow_up_due",
      rank: 3,
      whyNow: `We sent the last message ${formatElapsed(now - session.lastMessageTs)} ago and have not heard back.`,
      session,
    };
  }

  if (customerReplyElapsedMs !== null || session.stage === "COLD" || session.csStatusTier === "cold_lead") {
    return {
      category: "re_engagement",
      rank: 4,
      whyNow: customerReplyElapsedMs !== null
        ? `Customer last replied ${formatElapsed(customerReplyElapsedMs)} ago; consider a manual re-engagement touch.`
        : "This lead is eligible for a manual re-engagement touch.",
      session,
    };
  }

  return null;
}

function urgentReason(session: MadisonSessionRow): string {
  if (session.csPriorityTag === "booking") return "This lead has active booking intent.";
  if (session.csPriorityTag === "urgent") return "This lead has an urgent support signal.";
  if (session.csStatusTier === "scheduling") return "This lead is actively discussing scheduling.";
  if (session.csStatusTier === "objection") return "This lead has an active decision objection to address.";
  return "This lead has a high-intent conversation signal.";
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
 * Pure deterministic ranking used by both the live query and focused tests.
 * A user-last conversation intentionally ignores a still-active Madison defer.
 */
export function rankMadisonSessions(
  rows: readonly MadisonSessionRow[],
  activeNurtureSessionIds: ReadonlySet<number>,
  now: number,
): MadisonCandidate[] {
  return canonicalSessions(rows)
    .filter(session => isBaseEligible(session, activeNurtureSessionIds))
    .map(session => categoryFor(session, now))
    .filter((candidate): candidate is MadisonCandidate => candidate !== null)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const aTs = a.category === "customer_waiting"
        ? a.session.lastCustomerMessageTs ?? a.session.lastMessageTs ?? 0
        : a.session.lastMessageTs ?? a.session.createdAt.getTime();
      const bTs = b.category === "customer_waiting"
        ? b.session.lastCustomerMessageTs ?? b.session.lastMessageTs ?? 0
        : b.session.lastMessageTs ?? b.session.createdAt.getTime();
      if (a.rank === 1) return bTs - aTs;
      if (a.rank === 3) return aTs - bTs;
      return bTs - aTs;
    });
}

async function loadMadisonCandidates() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const [sessions, activeNurtures] = await Promise.all([
    db
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
        createdAt: conversationSessions.createdAt,
        updatedAt: conversationSessions.updatedAt,
      })
      .from(conversationSessions)
      .where(and(
        eq(conversationSessions.smsOptOut, 0),
        ne(conversationSessions.isBooked, 1),
        isNull(conversationSessions.bookedAt),
        sql`${conversationSessions.stage} NOT IN ('BOOKED', 'COMPLETED', 'CLOSED', 'LOST', 'RESOLVED', 'NOT_INTERESTED')`,
        or(isNull(conversationSessions.followUpDate), ne(conversationSessions.followUpSent, 0)),
      )),
    db
      .select({ sessionId: nurtureEnrollments.sessionId })
      .from(nurtureEnrollments)
      .where(and(eq(nurtureEnrollments.status, "active"), isNull(nurtureEnrollments.deletedAt))),
  ]);

  return rankMadisonSessions(
    sessions as MadisonSessionRow[],
    new Set(activeNurtures.map(row => row.sessionId)),
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

export const madisonRouter = router({
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
      const candidates = await loadMadisonCandidates();
      if (!candidates.some(candidate => candidate.session.id === input.sessionId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Madison action is no longer eligible" });
      }

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
