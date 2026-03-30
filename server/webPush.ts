/**
 * webPush.ts — server-side Web Push helper
 *
 * Uses the `web-push` npm package with VAPID authentication.
 * Call `sendPushToAgent(agentKey, payload)` from any server-side code
 * (e.g. after saving a new ops chat message) to deliver a push notification
 * to all registered browser subscriptions for that agent.
 *
 * Stale/expired subscriptions (410 Gone) are automatically removed from the DB.
 */

import webpush from "web-push";
import { getDb } from "./db";
import { pushSubscriptions } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

// ── VAPID configuration ───────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@maidinblack.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  /** URL to open when notification is clicked — defaults to /ops-chat */
  url?: string;
  /** Whether to play the reminder chime sound in the SW */
  playSound?: boolean;
}

/**
 * Send a push notification to all registered subscriptions for the given agent.
 * Silently removes expired/invalid subscriptions (410 Gone).
 * Never throws — errors are logged but don't crash the caller.
 */
export async function sendPushToAgent(agentKey: string, payload: PushPayload): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("[WebPush] VAPID keys not configured — skipping push");
    return;
  }

  let subs: Array<{ id: number; endpoint: string; keys: string }> = [];
  try {
    const db = await getDb();
    if (!db) return;
    subs = await db
      .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, keys: pushSubscriptions.keys })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.agentKey, agentKey));
  } catch (err) {
    console.error("[WebPush] Failed to fetch subscriptions:", err);
    return;
  }

  if (subs.length === 0) return;

  const staleIds: number[] = [];
  const data = JSON.stringify({ ...payload, playSound: payload.playSound ?? true });

  await Promise.all(
    subs.map(async (sub) => {
      let keys: { p256dh: string; auth: string };
      try {
        keys = JSON.parse(sub.keys);
      } catch {
        staleIds.push(sub.id);
        return;
      }

      const pushSub = {
        endpoint: sub.endpoint,
        keys,
      };

      try {
        await webpush.sendNotification(pushSub, data, {
          TTL: 60 * 60, // 1 hour TTL — notification expires if browser is offline
        });
        // Update lastUsedAt
        const dbInner = await getDb();
        if (dbInner) await dbInner
          .update(pushSubscriptions)
          .set({ lastUsedAt: new Date() })
          .where(eq(pushSubscriptions.id, sub.id));
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Subscription is gone — remove it
          staleIds.push(sub.id);
        } else {
          console.error(`[WebPush] Failed to send to ${sub.endpoint.slice(0, 60)}:`, err);
        }
      }
    })
  );

  if (staleIds.length > 0) {
    try {
      const dbClean = await getDb();
      if (dbClean) await dbClean.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, staleIds));
      console.log(`[WebPush] Removed ${staleIds.length} stale subscription(s) for agent ${agentKey}`);
    } catch (err) {
      console.error("[WebPush] Failed to remove stale subscriptions:", err);
    }
  }
}

/**
 * Send a push notification to ALL registered agents (e.g. for new lead alerts).
 */
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  let allSubs: Array<{ id: number; agentKey: string; endpoint: string; keys: string }> = [];
  try {
    const db = await getDb();
    if (!db) return;
    allSubs = await db
      .select({ id: pushSubscriptions.id, agentKey: pushSubscriptions.agentKey, endpoint: pushSubscriptions.endpoint, keys: pushSubscriptions.keys })
      .from(pushSubscriptions);
  } catch (err) {
    console.error("[WebPush] Failed to fetch all subscriptions:", err);
    return;
  }

  if (allSubs.length === 0) return;

  const staleIds: number[] = [];
  const data = JSON.stringify({ ...payload, playSound: payload.playSound ?? true });

  await Promise.all(
    allSubs.map(async (sub) => {
      let keys: { p256dh: string; auth: string };
      try {
        keys = JSON.parse(sub.keys);
      } catch {
        staleIds.push(sub.id);
        return;
      }

      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys }, data, { TTL: 60 * 60 });
        const dbUpd = await getDb();
        if (dbUpd) await dbUpd.update(pushSubscriptions).set({ lastUsedAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          staleIds.push(sub.id);
        } else {
          console.error(`[WebPush] Broadcast failed for ${sub.agentKey}:`, err);
        }
      }
    })
  );

  if (staleIds.length > 0) {
    try {
      const dbClean = await getDb();
      if (dbClean) await dbClean.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, staleIds));
    } catch {}
  }
}
