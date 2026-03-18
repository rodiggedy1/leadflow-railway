/**
 * activityLogger.ts
 *
 * Lightweight helper to write events to the activity_log table.
 * Import `logActivity` from any server-side file and call it fire-and-forget.
 * All errors are caught and logged to console — never throws.
 */

import { getDb } from "./db";
import { activityLog } from "../drizzle/schema";

export type ActivityEventType =
  | "lead_reply"
  | "ai_sms_sent"
  | "silence_nudge"
  | "scheduled_followup"
  | "always_on_batch"
  | "nightly_sync"
  | "review_send"
  | "booking"
  | "new_lead";

export interface LogActivityOptions {
  eventType: ActivityEventType;
  title: string;
  body?: string;
  meta?: Record<string, unknown>;
}

/**
 * Write an activity event to the log. Fire-and-forget — never throws.
 */
export async function logActivity(opts: LogActivityOptions): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(activityLog).values({
      eventType: opts.eventType as any,
      title: opts.title,
      body: opts.body ?? null,
      meta: opts.meta ? JSON.stringify(opts.meta) : null,
    });
  } catch (err) {
    console.error("[ActivityLogger] Failed to log activity:", err);
  }
}
