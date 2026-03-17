/**
 * alwaysOnSend.ts
 *
 * Sends the daily always-on SMS batch via OpenPhone.
 *
 * Rules:
 *  - Only sends Mon–Sat (never Sunday)
 *  - Only sends between 9:00 AM – 8:00 PM US Eastern Time (TCPA compliance)
 *  - For each active group, picks up to batchSize PENDING enrollments
 *  - Personalizes message by replacing [Name] with firstName
 *  - Marks each enrollment as SENT and updates group sentCount
 *  - Returns a summary of sends per group
 */

import { getDb } from "./db";
import { alwaysOnGroups, alwaysOnEnrollments, conversationSessions, type AlwaysOnGroupType } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { sendSms } from "./openphone";

// ─── TCPA compliance helpers ──────────────────────────────────────────────────

/**
 * Returns the current time in US Eastern Time.
 * Handles both EST (UTC-5) and EDT (UTC-4) automatically via Intl.
 */
export function getNowInET(nowMs: number = Date.now()): { hour: number; dayOfWeek: number; dateStr: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const hour = parseInt(get("hour"), 10);
  const weekday = get("weekday"); // "Mon", "Tue", ..., "Sun"
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const dateStr = `${get("year")}-${get("month")}-${get("day")}`;

  return { hour, dayOfWeek, dateStr };
}

/**
 * Returns true if it is currently within the TCPA-compliant send window:
 *  - Monday through Saturday (dayOfWeek 1–6)
 *  - 9:00 AM to 7:59 PM ET (hour 9–19)
 */
export function isWithinTcpaWindow(nowMs: number = Date.now()): boolean {
  const { hour, dayOfWeek } = getNowInET(nowMs);
  const isSunday = dayOfWeek === 0;
  const isBeforeNine = hour < 9;
  const isAfterEight = hour >= 20; // 8 PM or later
  return !isSunday && !isBeforeNine && !isAfterEight;
}

// ─── Message personalization ──────────────────────────────────────────────────

/**
 * Replaces template tokens with actual contact values.
 *
 * Supported tokens:
 *  [Name]            → firstName (or "there" if missing)
 *  [Price]           → lastBookingPrice formatted as $X
 *  [DiscountedPrice] → lastBookingPrice * (1 - discountPct/100)
 */
export function personalizeMessage(
  template: string,
  enrollment: {
    firstName?: string | null;
    lastBookingPrice?: number | null;
    discountPct?: number | null;
  }
): string {
  const name = enrollment.firstName?.trim() || "there";
  const price = enrollment.lastBookingPrice
    ? `$${Math.round(enrollment.lastBookingPrice / 100)}`
    : "";
  const discountPct = enrollment.discountPct ?? 10;
  const discountedPrice = enrollment.lastBookingPrice
    ? `$${Math.round((enrollment.lastBookingPrice / 100) * (1 - discountPct / 100))}`
    : "";

  return template
    .replace(/\[Name\]/gi, name)
    .replace(/\[Price\]/gi, price)
    .replace(/\[DiscountedPrice\]/gi, discountedPrice);
}

// ─── Mark replied ────────────────────────────────────────────────────────────

/**
 * Marks the most recent SENT always-on enrollment for a given phone as REPLIED.
 * Called by the webhook when an inbound message arrives.
 */
export async function markAlwaysOnContactReplied(phone: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Find the most recent SENT enrollment for this phone
  const [enrollment] = await db
    .select()
    .from(alwaysOnEnrollments)
    .where(
      and(
        eq(alwaysOnEnrollments.phone, phone),
        eq(alwaysOnEnrollments.status, "SENT")
      )
    )
    .orderBy(alwaysOnEnrollments.sentAt)
    .limit(1);

  if (!enrollment) return;

  await db
    .update(alwaysOnEnrollments)
    .set({ status: "REPLIED", repliedAt: new Date() })
    .where(eq(alwaysOnEnrollments.id, enrollment.id));

  // Update the group's repliedCount
  await db
    .update(alwaysOnGroups)
    .set({ repliedCount: sql`${alwaysOnGroups.repliedCount} + 1` })
    .where(eq(alwaysOnGroups.id, enrollment.groupId));

  console.log(`[AlwaysOn] Marked enrollment ${enrollment.id} (${phone}) as REPLIED.`);
}

// ─── Send batch ───────────────────────────────────────────────────────────────

export interface SendBatchResult {
  groupType: AlwaysOnGroupType;
  attempted: number;
  sent: number;
  failed: number;
  skippedTcpa: boolean;
}

/**
 * Sends the daily always-on batch for all active groups.
 *
 * @param nowMs  Injectable timestamp for testing (defaults to Date.now())
 * @param dryRun If true, skips actual OpenPhone calls (for testing)
 */
export async function sendAlwaysOnBatch(
  nowMs: number = Date.now(),
  dryRun = false
): Promise<SendBatchResult[]> {
  const results: SendBatchResult[] = [];

  // TCPA check — abort entire batch if outside window
  if (!isWithinTcpaWindow(nowMs)) {
    const { hour, dayOfWeek } = getNowInET(nowMs);
    console.log(`[AlwaysOn] TCPA window check failed — hour=${hour}, dayOfWeek=${dayOfWeek}. Skipping send.`);
    return results;
  }

  const db = await getDb();
  if (!db) return results;

  // Load all active groups
  const groups = await db
    .select()
    .from(alwaysOnGroups)
    .where(eq(alwaysOnGroups.isActive, 1));

  for (const group of groups) {
    const result: SendBatchResult = {
      groupType: group.groupType as AlwaysOnGroupType,
      attempted: 0,
      sent: 0,
      failed: 0,
      skippedTcpa: false,
    };

    // Pick up to batchSize PENDING enrollments for this group
    const pending = await db
      .select()
      .from(alwaysOnEnrollments)
      .where(
        and(
          eq(alwaysOnEnrollments.groupId, group.id),
          eq(alwaysOnEnrollments.status, "PENDING")
        )
      )
      .limit(group.batchSize);

    if (pending.length === 0) {
      console.log(`[AlwaysOn] Group "${group.name}": no PENDING enrollments.`);
      results.push(result);
      continue;
    }

    console.log(`[AlwaysOn] Group "${group.name}": sending ${pending.length} messages...`);
    result.attempted = pending.length;

    for (const enrollment of pending) {
      const message = personalizeMessage(group.messageTemplate, {
        firstName: enrollment.firstName,
        lastBookingPrice: enrollment.lastBookingPrice,
        discountPct: enrollment.discountPct,
      });

      let success = false;
      let openPhoneMessageId: string | undefined;

      if (dryRun) {
        console.log(`[AlwaysOn][DryRun] Would send to ${enrollment.phone}: "${message.slice(0, 60)}..."`);
        success = true;
      } else {
        const sendResult = await sendSms({ to: enrollment.phone, content: message });
        success = sendResult.success;
        openPhoneMessageId = sendResult.messageId;
        if (!success) {
          console.error(`[AlwaysOn] Failed to send to ${enrollment.phone}: ${sendResult.error}`);
        }
      }

      if (success) {
        // Create a conversation session so inbound replies are routed through the AI engine
        let sessionId: number | null = null;
        try {
          const [sessionResult] = await db.insert(conversationSessions).values({
            leadPhone: enrollment.phone,
            leadName: enrollment.name ?? enrollment.firstName ?? "",
            stage: "REACTIVATION",
            leadSource: "always-on",
            reactivationLastPrice: enrollment.lastBookingPrice
              ? Math.round(enrollment.lastBookingPrice / 100)
              : null,
            reactivationDiscountPct: enrollment.discountPct ?? 10,
            messageHistory: "[]",
            aiMode: 1,
            isBooked: 0,
          });
          sessionId = (sessionResult as any).insertId as number;
        } catch (err) {
          console.error(`[AlwaysOn] Failed to create session for ${enrollment.phone}:`, err);
        }

        // Mark as SENT and link session
        await db
          .update(alwaysOnEnrollments)
          .set({
            status: "SENT",
            sentAt: new Date(),
            openPhoneMessageId: openPhoneMessageId ?? null,
            sessionId: sessionId ?? undefined,
          })
          .where(eq(alwaysOnEnrollments.id, enrollment.id));

        result.sent++;
      } else {
        // Mark as FAILED so it can be retried
        await db
          .update(alwaysOnEnrollments)
          .set({ status: "FAILED" })
          .where(eq(alwaysOnEnrollments.id, enrollment.id));

        result.failed++;
      }
    }

    // Update group sentCount
    if (result.sent > 0) {
      await db
        .update(alwaysOnGroups)
        .set({ sentCount: sql`${alwaysOnGroups.sentCount} + ${result.sent}` })
        .where(eq(alwaysOnGroups.id, group.id));
    }

    console.log(`[AlwaysOn] Group "${group.name}": sent=${result.sent}, failed=${result.failed}`);
    results.push(result);
  }

  return results;
}
