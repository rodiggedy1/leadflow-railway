import type { Express, Request, Response } from "express";
import { and, desc, eq, gte, isNotNull, isNull, or } from "drizzle-orm";
import { conversationSessions } from "../drizzle/schema";
import { getDb } from "./db";
import { syncAllOutboundMessages } from "./webhooks";
import { normalizePhoneLegacy } from "./utils/phone";

export const CS_INBOX_LEAD_SOURCES = [
  "cs-inbound",
  "cs-inbound-cleaner",
  "cs_initiated",
  "ai_call",
] as const;

export const RECOVERY_WINDOW_MS = 48 * 60 * 60 * 1000;
export const RECOVERY_BATCH_LIMIT = 20;
export const RECOVERY_BETWEEN_SESSION_DELAY_MS = 200;

export type QuoDeliveryObject = {
  direction?: string;
  phoneNumberId?: string;
  to?: string | string[];
};

export type RecentCsSession = {
  id: number;
  leadPhone: string;
  leadSource: string | null;
  csResolvedAt: Date | null;
  lastMessageTs: number | null;
};

export type OutboundSyncResult = { added: number; newestOutboundTs: number | null } | undefined;

export function getConfiguredCsPhoneNumberIds(phoneNumberIds: Array<string | undefined>): Set<string> {
  return new Set(phoneNumberIds.filter((id): id is string => Boolean(id)));
}

/**
 * Returns the external recipient only for an outbound delivery event sent through
 * one of the configured CS/Leads company numbers. The caller handles this after
 * the webhook has already acknowledged Quo.
 */
export function getCsOutboundDeliveryRecipient(
  message: QuoDeliveryObject | undefined,
  configuredPhoneNumberIds: Set<string>,
): string | null {
  if (!message || message.direction !== "outgoing") return null;
  if (!message.phoneNumberId || !configuredPhoneNumberIds.has(message.phoneNumberId)) return null;
  const rawRecipient = Array.isArray(message.to) ? message.to[0] : message.to;
  if (!rawRecipient) return null;
  return normalizePhoneLegacy(rawRecipient);
}

export function isEligibleRecentCsSession(session: RecentCsSession, nowMs: number): boolean {
  return (
    Boolean(session.leadPhone) &&
    session.csResolvedAt === null &&
    CS_INBOX_LEAD_SOURCES.includes(session.leadSource as (typeof CS_INBOX_LEAD_SOURCES)[number]) &&
    typeof session.lastMessageTs === "number" &&
    session.lastMessageTs >= nowMs - RECOVERY_WINDOW_MS
  );
}

export async function reconcileSessionBatch(
  sessions: Array<Pick<RecentCsSession, "id" | "leadPhone">>,
  sync: (leadPhone: string, sessionId: number) => Promise<OutboundSyncResult>,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<{ scanned: number; mergedMessages: number; errors: number }> {
  let mergedMessages = 0;
  let errors = 0;
  for (const session of sessions) {
    try {
      const result = await sync(session.leadPhone, session.id);
      mergedMessages += result?.added ?? 0;
    } catch (error) {
      errors++;
      console.warn(`[QuoOutboundRecovery] session=${session.id} failed:`, error);
    }
    if (RECOVERY_BETWEEN_SESSION_DELAY_MS > 0) {
      await wait(RECOVERY_BETWEEN_SESSION_DELAY_MS);
    }
  }
  return { scanned: sessions.length, mergedMessages, errors };
}

export async function reconcileDeliveredCsOutbound(leadPhone: string): Promise<{ matched: boolean; added: number }> {
  const db = await getDb();
  if (!db) return { matched: false, added: 0 };

  const [session] = await db
    .select({ id: conversationSessions.id })
    .from(conversationSessions)
    .where(and(
      eq(conversationSessions.leadPhone, leadPhone),
      isNull(conversationSessions.csResolvedAt),
      or(...CS_INBOX_LEAD_SOURCES.map(source => eq(conversationSessions.leadSource, source))),
    ))
    .orderBy(desc(conversationSessions.updatedAt))
    .limit(1);

  if (!session) return { matched: false, added: 0 };
  const result = await syncAllOutboundMessages(leadPhone, session.id);
  return { matched: true, added: result?.added ?? 0 };
}

export function registerQuoOutboundRecoveryRoute(app: Express): void {
  app.post("/api/scheduled/cs-outbound-reconcile", async (req: Request, res: Response) => {
    const cronTaskUid = req.headers["x-manus-cron-task-uid"] as string | undefined;
    const cronSecret = req.headers["x-cron-secret"] as string | undefined;
    const authorized = Boolean(cronTaskUid) || Boolean(process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET);
    if (!authorized) {
      return res.status(403).json({ error: "Unauthorized — cron only" });
    }

    try {
      const db = await getDb();
      if (!db) return res.json({ ok: true, scanned: 0, mergedMessages: 0, errors: 0, skipped: "db_unavailable" });
      const cutoff = Date.now() - RECOVERY_WINDOW_MS;
      const sessions = await db
        .select({
          id: conversationSessions.id,
          leadPhone: conversationSessions.leadPhone,
        })
        .from(conversationSessions)
        .where(and(
          isNotNull(conversationSessions.leadPhone),
          isNull(conversationSessions.csResolvedAt),
          gte(conversationSessions.lastMessageTs, cutoff),
          or(...CS_INBOX_LEAD_SOURCES.map(source => eq(conversationSessions.leadSource, source))),
        ))
        .orderBy(desc(conversationSessions.lastMessageTs))
        .limit(RECOVERY_BATCH_LIMIT);

      const result = await reconcileSessionBatch(sessions, syncAllOutboundMessages);
      return res.json({ ok: true, ...result, limit: RECOVERY_BATCH_LIMIT, windowHours: RECOVERY_WINDOW_MS / 3_600_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[QuoOutboundRecovery] failed:", message);
      return res.status(500).json({ error: message });
    }
  });
}
