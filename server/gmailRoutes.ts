/**
 * gmailRoutes.ts — Gmail OAuth callback + Pub/Sub push webhook
 */
import type { Express } from "express";
import { getGmailAuthUrl, exchangeCodeForTokens, getNewMessagesSince, clearRefreshTokenCache, setupGmailWatch } from "./gmailService";
import { enqueueThread } from "./gmailGlanceWorker";
import { ENV } from "./_core/env";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { getDb } from "./db";
import { gmailState } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export function registerGmailRoutes(app: Express) {
  // ── OAuth: initiate ──────────────────────────────────────────────────────────
  app.get("/api/gmail/oauth/start", (_req, res) => {
    const url = getGmailAuthUrl();
    res.redirect(url);
  });

  // ── OAuth: callback ──────────────────────────────────────────────────────────
  app.get("/api/gmail/oauth/callback", async (req, res) => {
    const code = req.query.code as string;
    if (!code) return res.status(400).send("Missing code");
    try {
      const tokens = await exchangeCodeForTokens(code);
      const refreshToken = tokens.refresh_token;
      if (!refreshToken) {
        return res.status(400).send(
          "No refresh token returned. Make sure you revoked previous access and try again."
        );
      }
      const db = await getDb();
      if (!db) return res.status(500).send("DB not available");
      // Store historyId placeholder — actual historyId will be set on first watch setup
      await db
        .insert(gmailState)
        .values({ id: 1, refreshToken, historyId: "0", watchExpiration: 0 })
        .onDuplicateKeyUpdate({ set: { refreshToken, historyId: "0" } });
      clearRefreshTokenCache();
      console.log("[Gmail] OAuth complete — refresh token stored");
      res.send(`
        <html><body style="font-family:sans-serif;padding:40px">
          <h2>✅ Gmail connected successfully!</h2>
          <p>Refresh token stored. You can close this tab.</p>
          <p><strong>Next step:</strong> Set up Pub/Sub watch by visiting 
          <a href="/api/gmail/watch/setup">/api/gmail/watch/setup</a></p>
        </body></html>
      `);
    } catch (err) {
      console.error("[Gmail] OAuth callback error:", err);
      res.status(500).send("OAuth error: " + String(err));
    }
  });

  // ── Watch setup — one-time call to register Gmail Pub/Sub watch ────────────────
  app.get("/api/gmail/watch/setup", async (_req, res) => {
    try {
      const topicName = ENV.gmailPubsubTopic;
      if (!topicName) return res.status(400).send("GMAIL_PUBSUB_TOPIC env var not set.");
      const db = await getDb();
      if (!db) return res.status(500).send("DB not available");
      const [state] = await db.select().from(gmailState).where(eq(gmailState.id, 1));
      if (!state?.refreshToken) return res.status(400).send("Gmail not connected. Run OAuth first.");
      const { historyId, expiration } = await setupGmailWatch(topicName);
      await db.update(gmailState).set({ historyId, watchExpiration: Number(expiration) }).where(eq(gmailState.id, 1));
      console.log("[Gmail] Watch set up — historyId:", historyId, "expiration:", expiration);
      res.send(`
        <html><body style="font-family:sans-serif;padding:40px">
          <h2>✅ Gmail Pub/Sub watch activated!</h2>
          <p>History ID: <code>${historyId}</code></p>
          <p>Expires: <code>${new Date(Number(expiration)).toLocaleString()}</code></p>
          <p>Real-time inbox notifications are now active.</p>
        </body></html>
      `);
    } catch (err) {
      console.error("[Gmail] Watch setup error:", err);
      res.status(500).send("Watch setup error: " + String(err));
    }
  });

  // ── Pub/Sub webhook — receives push notifications from Google ────────────────
  app.post("/api/gmail/webhook", async (req, res) => {
    try {
      // Google sends base64-encoded JSON in req.body.message.data
      const message = req.body?.message;
      if (!message?.data) return res.status(200).send("ok");

      const decoded = JSON.parse(Buffer.from(message.data, "base64").toString("utf-8"));
      const newHistoryId = String(decoded.historyId);

      const db = await getDb();
      if (!db) return res.status(200).send("ok");

      // Load last known historyId from DB
      const [state] = await db.select().from(gmailState).where(eq(gmailState.id, 1));
      const lastHistoryId = state?.historyId ?? "0";

      if (lastHistoryId === "0" || !lastHistoryId) {
        // First notification — just save historyId, no messages to fetch yet
        await db.update(gmailState).set({ historyId: newHistoryId }).where(eq(gmailState.id, 1));
        return res.status(200).send("ok");
      }

      // Fetch new messages since last historyId
      const newMessages = await getNewMessagesSince(lastHistoryId);

      // Update historyId
      await db.update(gmailState).set({ historyId: newHistoryId }).where(eq(gmailState.id, 1));

      if (newMessages.length > 0) {
        console.log(`[Gmail] ${newMessages.length} new message(s) received`);
        broadcastOpsUpdate("gmail_new_messages");
        // Enqueue affected threads for AI re-processing (non-blocking)
        const affectedThreadIds = Array.from(new Set(newMessages.map((m) => m.threadId).filter(Boolean) as string[]));
        for (const tid of affectedThreadIds) enqueueThread(tid);
      }

      res.status(200).send("ok");
    } catch (err) {
      console.error("[Gmail] Webhook error:", err);
      res.status(200).send("ok"); // Always 200 to prevent Google retries
    }
  });
}
