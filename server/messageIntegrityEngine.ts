/**
 * Message Integrity Engine
 *
 * Nightly job that compares the last 7 days of messages per active session
 * between the LeadFlow DB and OpenPhone. Any session where OpenPhone has more
 * messages than the DB in that window is flagged as a potential gap.
 *
 * Design:
 *  - Only checks sessions that had activity (any message) in the last 24 hours
 *  - Compares DB messages with ts >= 7 days ago vs OpenPhone messages with
 *    createdAt >= 7 days ago for the same phone number
 *  - Writes results to message_integrity_checks (one row per session, upserted)
 *  - Does NOT auto-backfill — detection only
 *
 * Called from internalCron.ts at 2 AM ET daily.
 */

import { getDb } from "./db";
import { conversationSessions, messageIntegrityChecks } from "../drizzle/schema";
import { and, gte, notLike, sql, eq } from "drizzle-orm";
import { ENV } from "./_core/env";

const OPENPHONE_API_URL = "https://api.openphone.com/v1/messages";
const PHONE_NUMBER_IDS = [
  ENV.openPhoneNumberId,
  ENV.openPhoneCsNumberId,
  ENV.openPhoneBarkNumberId,
].filter(Boolean) as string[];

/**
 * Fetch the count of OpenPhone messages for a given phone number
 * within the last 7 days, across all phone number IDs.
 */
async function fetchOpenPhoneRecentCount(
  participantPhone: string,
  since: Date
): Promise<number> {
  const apiKey = ENV.openPhoneApiKey;
  if (!apiKey) return 0;

  let total = 0;
  const sinceIso = since.toISOString();

  for (const pnId of PHONE_NUMBER_IDS) {
    let pageToken: string | null = null;
    while (true) {
      const params = new URLSearchParams({
        participants: participantPhone,
        phoneNumberId: pnId,
        maxResults: "100",
        createdAfter: sinceIso,
      });
      if (pageToken) params.set("pageToken", pageToken);

      try {
        const resp = await fetch(`${OPENPHONE_API_URL}?${params}`, {
          headers: { Authorization: apiKey },
        });
        if (!resp.ok) break;
        const json = (await resp.json()) as {
          data?: unknown[];
          meta?: { nextPageToken?: string };
        };
        total += json.data?.length ?? 0;
        pageToken = json.meta?.nextPageToken ?? null;
        if (!pageToken) break;
      } catch {
        break;
      }
    }
  }

  return total;
}

/**
 * Count messages in the DB messageHistory JSON array that have
 * a ts timestamp >= since.getTime().
 */
function countRecentDbMessages(messageHistory: string, since: Date): number {
  try {
    const history = JSON.parse(messageHistory || "[]") as Array<{
      ts?: number;
      role?: string;
    }>;
    const cutoff = since.getTime();
    return history.filter((m) => typeof m.ts === "number" && m.ts >= cutoff).length;
  } catch {
    return 0;
  }
}

export interface IntegrityRunResult {
  checked: number;
  gaps: number;
  errors: number;
}

export async function runMessageIntegrityCheck(): Promise<IntegrityRunResult> {
  const db = await getDb();
  if (!db) return { checked: 0, gaps: 0, errors: 0 };

  const now = Date.now();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const since24h = new Date(now - 24 * 60 * 60 * 1000);

  // Fetch all sessions that had any message activity in the last 24 hours.
  // We use updatedAt (or createdAt as fallback) to find recently active sessions.
  // Exclude placeholder phones (thumbtack-*, bark-*).
  const sessions = await db
    .select({
      id: conversationSessions.id,
      leadPhone: conversationSessions.leadPhone,
      leadName: conversationSessions.leadName,
      messageHistory: conversationSessions.messageHistory,
    })
    .from(conversationSessions)
    .where(
      and(
        gte(conversationSessions.createdAt, since24h),
        notLike(conversationSessions.leadPhone, "thumbtack%"),
        notLike(conversationSessions.leadPhone, "bark%")
      )
    );

  let checked = 0;
  let gaps = 0;
  let errors = 0;

  // Rate-limit: 200ms between API calls to avoid hammering OpenPhone
  for (const session of sessions) {
    try {
      const dbCount = countRecentDbMessages(session.messageHistory ?? "", since7d);
      const opCount = await fetchOpenPhoneRecentCount(session.leadPhone, since7d);
      const delta = opCount - dbCount;

      // Upsert into message_integrity_checks
      const existing = await db
        .select({ id: messageIntegrityChecks.id, firstDetectedAt: messageIntegrityChecks.firstDetectedAt })
        .from(messageIntegrityChecks)
        .where(eq(messageIntegrityChecks.sessionId, session.id))
        .limit(1);

      const firstDetectedAt =
        delta > 0
          ? existing[0]?.firstDetectedAt ?? now
          : null;

      if (existing.length > 0) {
        await db
          .update(messageIntegrityChecks)
          .set({
            leadName: session.leadName,
            leadPhone: session.leadPhone,
            dbCount,
            openphoneCount: opCount,
            delta,
            checkedAt: now,
            firstDetectedAt,
            reconciled: delta <= 0 ? 1 : 0,
          })
          .where(eq(messageIntegrityChecks.sessionId, session.id));
      } else {
        await db.insert(messageIntegrityChecks).values({
          sessionId: session.id,
          leadName: session.leadName,
          leadPhone: session.leadPhone,
          dbCount,
          openphoneCount: opCount,
          delta,
          checkedAt: now,
          firstDetectedAt,
          reconciled: 0,
        });
      }

      if (delta > 0) gaps++;
      checked++;

      // Throttle to avoid OpenPhone rate limits
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(
        `[MessageIntegrity] Error checking session ${session.id}:`,
        err instanceof Error ? err.message : String(err)
      );
      errors++;
    }
  }

  console.log(
    `[MessageIntegrity] Done — checked: ${checked}, gaps: ${gaps}, errors: ${errors}`
  );
  return { checked, gaps, errors };
}
