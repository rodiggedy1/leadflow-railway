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
 * On invalid_grant: posts a dedicated re-auth alert with the direct OAuth link.
 */
import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import { gmailState, opsChatMessages } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { ENV } from "./_core/env";
import { setupGmailWatch } from "./gmailService";

/**
 * Detects whether an error is an OAuth invalid_grant (token revoked by Google).
 */
function isInvalidGrant(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("invalid_grant") || msg.includes("invalid grant")) return true;
  const e = err as any;
  const reason = e?.response?.data?.error ?? e?.response?.data?.error_description ?? "";
  return typeof reason === "string" && (reason.includes("invalid_grant") || reason.includes("invalid grant"));
}

/**
 * Posts a failure alert to Command Chat.
 * When reauth=true, posts a high-visibility re-auth card with the direct OAuth link.
 * Fire-and-forget — never throws.
 */
async function postCronFailure(error: string, triggeredAt: string, reauth?: boolean): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    if (reauth) {
      // High-visibility re-auth alert with clickable link
      await db.insert(opsChatMessages).values({
        channel: "command",
        authorName: "System",
        authorRole: "system",
        body: `🔐 Gmail Re-Authorization Required\n\nThe Gmail OAuth token has been revoked by Google (invalid_grant).\nReal-time inbox notifications are paused until you re-authorize.\n\n👉 Step 1 — Re-authorize: https://quote.maidinblack.com/api/gmail/oauth/start\n👉 Step 2 — Renew watch: https://quote.maidinblack.com/api/gmail/watch/setup\n\nDetected at: ${triggeredAt}`,
        quickAction: "gmail_reauth_required",
        metadata: JSON.stringify({ cronName: "gmail-watch-renew", error, triggeredAt, reauth: true }),
      });
    } else {
      await db.insert(opsChatMessages).values({
        channel: "command",
        authorName: "System",
        authorRole: "system",
        body: `🚨 Gmail Watch Renewal Failed\n\nError: ${error}\n\nTriggered at: ${triggeredAt}\n\nManual fix: visit /api/gmail/watch/setup`,
        quickAction: "cron_failure",
        metadata: JSON.stringify({ cronName: "gmail-watch-renew", error, triggeredAt }),
      });
    }
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
        const msg = "No Gmail refresh token in DB — OAuth not completed.";
        console.error("[GmailWatchRenew]", msg);
        await postCronFailure(msg, startedAt, true); // treat missing token as reauth needed
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

      // Detect invalid_grant — post re-auth alert instead of generic failure
      const needsReauth = isInvalidGrant(err);
      await postCronFailure(errMsg, startedAt, needsReauth);

      return res.status(500).json({
        error: errMsg,
        stack: err instanceof Error ? err.stack : undefined,
        context: { triggeredAt: startedAt },
        timestamp: new Date().toISOString(),
      });
    }
  });
}
