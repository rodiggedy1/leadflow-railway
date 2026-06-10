/**
 * gmailWatchRenewCron.ts
 *
 * Heartbeat-triggered endpoint that renews the Gmail Pub/Sub watch every 6 days.
 * Gmail watches expire after 7 days — this keeps the real-time inbox notifications
 * alive indefinitely without manual intervention.
 *
 * Endpoint: POST /api/scheduled/gmail-watch-renew
 *
 * Auth: x-manus-cron-task-uid header (set by the Manus platform gateway).
 * Also accepts CRON_SECRET header for manual triggers.
 *
 * On failure: posts a system message to Command Chat so the team sees it immediately.
 */
import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import { gmailState, opsChatMessages } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { ENV } from "./_core/env";
import { setupGmailWatch } from "./gmailService";

/**
 * Posts a cron failure alert to the Command Chat channel so the team is notified.
 * Fire-and-forget — never throws.
 */
async function postCronFailure(error: string, triggeredAt: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(opsChatMessages).values({
      channel: "command",
      authorName: "System",
      authorRole: "system",
      body: `🚨 Gmail Watch Renewal Failed\n\nError: ${error}\n\nTriggered at: ${triggeredAt}\n\nManual fix: visit /api/gmail/watch/setup`,
      quickAction: "cron_failure",
      metadata: JSON.stringify({ cronName: "gmail-watch-renew", error, triggeredAt }),
    });
    const { broadcastOpsUpdate } = await import("./sseBroadcast");
    broadcastOpsUpdate("new_message", { channel: "command" });
  } catch (err) {
    console.error("[GmailWatchRenew] Failed to post failure to Command Chat:", err);
  }
}

export function registerGmailWatchRenewCron(app: Express): void {
  app.post("/api/scheduled/gmail-watch-renew", async (req: Request, res: Response) => {
    const startedAt = new Date().toISOString();
    try {
      // ── Auth: Manus Heartbeat gateway or manual CRON_SECRET ──────────────────
      const cronTaskUid = req.headers["x-manus-cron-task-uid"] as string | undefined;
      const cronSecret = req.headers["x-cron-secret"] as string | undefined;
      const isAuthorized =
        !!cronTaskUid ||
        (process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET);

      if (!isAuthorized) {
        return res.status(403).json({ error: "Unauthorized — cron only" });
      }

      // ── Validate config ───────────────────────────────────────────────────────
      const topicName = ENV.gmailPubsubTopic;
      if (!topicName) {
        const msg = "GMAIL_PUBSUB_TOPIC env var not set — cannot renew watch.";
        console.error("[GmailWatchRenew]", msg);
        await postCronFailure(msg, startedAt);
        return res.status(500).json({ error: msg });
      }

      // ── Check we have a stored refresh token ─────────────────────────────────
      const db = await getDb();
      if (!db) {
        const msg = "DB unavailable — cannot renew Gmail watch.";
        console.error("[GmailWatchRenew]", msg);
        await postCronFailure(msg, startedAt);
        return res.status(500).json({ error: msg });
      }

      const [state] = await db.select().from(gmailState).where(eq(gmailState.id, 1));
      if (!state?.refreshToken) {
        const msg = "No Gmail refresh token in DB — OAuth not completed. Visit /api/gmail/oauth/start.";
        console.error("[GmailWatchRenew]", msg);
        await postCronFailure(msg, startedAt);
        return res.status(500).json({ error: msg });
      }

      // ── Renew the watch ───────────────────────────────────────────────────────
      const { historyId, expiration } = await setupGmailWatch(topicName);

      await db
        .update(gmailState)
        .set({ historyId, watchExpiration: Number(expiration) })
        .where(eq(gmailState.id, 1));

      const expiresAt = new Date(Number(expiration)).toISOString();
      console.log(`[GmailWatchRenew] ✅ Watch renewed — historyId: ${historyId}, expires: ${expiresAt}`);

      return res.json({ ok: true, historyId, expiresAt, renewedAt: startedAt });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[GmailWatchRenew] ❌ Error:", err);

      // Post failure to Command Chat so the team sees it immediately
      await postCronFailure(errMsg, startedAt);

      return res.status(500).json({
        error: errMsg,
        stack: err instanceof Error ? err.stack : undefined,
        context: { triggeredAt: startedAt },
        timestamp: new Date().toISOString(),
      });
    }
  });
}
