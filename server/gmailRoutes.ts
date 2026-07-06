/**
 * gmailRoutes.ts — Gmail OAuth callback + Pub/Sub push webhook
 */
import type { Express } from "express";
import { getGmailAuthUrl, exchangeCodeForTokens, getHistoryEvents, clearRefreshTokenCache, setupGmailWatch } from "./gmailService";
import { enqueueThread, backfillGlanceQueue, type EnqueueSource } from "./gmailGlanceWorker";
import { ENV } from "./_core/env";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { getDb } from "./db";
import { gmailState, gmailThreadMeta } from "../drizzle/schema";
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

      // Fetch history events (new messages + label changes) since last historyId
      const events = await getHistoryEvents(lastHistoryId);

      // Update historyId
      await db.update(gmailState).set({ historyId: newHistoryId }).where(eq(gmailState.id, 1));

      // ── Handle new messages ────────────────────────────────────────────────
      if (events.newMessages.length > 0) {
        const affectedThreadIds = Array.from(new Set(events.newMessages.map((m) => m.threadId).filter(Boolean) as string[]));
        for (const tid of affectedThreadIds) {
          console.log(`[Webhook] threadId=${tid} enqueueing`);
          enqueueThread(tid, "pubsub" as EnqueueSource);
          // Optimistic isUnread=1 — UPDATE only (never INSERT to avoid partial rows)
          // Worker will correct if wrong when it processes the thread
          db.update(gmailThreadMeta)
            .set({ isUnread: 1 })
            .where(eq(gmailThreadMeta.threadId, tid))
            .catch(() => {});
        }
        // NOTE: broadcastOpsUpdate is intentionally NOT called here.
        // The worker calls it after the DB commit so the UI refetch sees fresh data.
        console.log(`[Webhook] ${affectedThreadIds.length} thread(s) enqueued — broadcast deferred to worker`);
      }

      // ── Handle label changes — no threads.get, no AI rerun ────────────────
      const readCount = events.markRead.size;
      const unreadCount = events.markUnread.size;
      const archivedCount = events.markArchived.size;
      const inboxedCount = events.markInboxed.size;

      if (readCount + unreadCount + archivedCount + inboxedCount > 0) {
        console.log(`[GmailWebhook] labelChanges read=${readCount} unread=${unreadCount} archived=${archivedCount} inboxed=${inboxedCount}`);

        const labelUpdates: Promise<any>[] = [];

        for (const tid of events.markRead) {
          labelUpdates.push(
            db.update(gmailThreadMeta).set({ isUnread: 0 }).where(eq(gmailThreadMeta.threadId, tid)).catch(() => {})
          );
        }
        for (const tid of events.markUnread) {
          labelUpdates.push(
            db.update(gmailThreadMeta).set({ isUnread: 1 }).where(eq(gmailThreadMeta.threadId, tid)).catch(() => {})
          );
        }
        for (const tid of events.markArchived) {
          labelUpdates.push(
            db.update(gmailThreadMeta).set({ isInInbox: 0 }).where(eq(gmailThreadMeta.threadId, tid)).catch(() => {})
          );
        }
        for (const tid of events.markInboxed) {
          labelUpdates.push(
            db.update(gmailThreadMeta).set({ isInInbox: 1 }).where(eq(gmailThreadMeta.threadId, tid)).catch(() => {})
          );
        }

        await Promise.all(labelUpdates);

        if (archivedCount > 0 || inboxedCount > 0) {
          // Inbox composition changed — broadcast so the UI refreshes
          broadcastOpsUpdate("gmail_new_messages");
        }
      }

      res.status(200).send("ok");
    } catch (err) {
      console.error("[Gmail] Webhook error:", err);
      res.status(200).send("ok"); // Always 200 to prevent Google retries
    }
  });

  // ── Diagnostics: full Gmail pipeline health check (no auth required — no secrets exposed) ──
  app.get("/api/gmail/diag", async (_req, res) => {
    try {
      const db = await getDb();
      const diag: Record<string, any> = { ts: new Date().toISOString() };

      if (!db) {
        diag.db = "UNAVAILABLE";
        return res.json(diag);
      }

      // 1. Gmail state row
      const [state] = await db.select().from(gmailState).where(eq(gmailState.id, 1));
      diag.hasRefreshToken = !!state?.refreshToken;
      diag.historyId = state?.historyId ?? "none";
      diag.watchExpiration = state?.watchExpiration
        ? new Date(state.watchExpiration).toISOString()
        : "none";
      diag.watchExpired = state?.watchExpiration ? state.watchExpiration < Date.now() : true;

      // 2. Test token validity by calling Gmail profile
      try {
        const { google } = await import("googleapis");
        const oauth2 = new google.auth.OAuth2(
          ENV.gmailClientId,
          ENV.gmailClientSecret,
          ENV.gmailRedirectUri
        );
        if (state?.refreshToken) oauth2.setCredentials({ refresh_token: state.refreshToken });
        const gmail = google.gmail({ version: "v1", auth: oauth2 });
        const profile = await gmail.users.getProfile({ userId: "me" });
        diag.tokenValid = true;
        diag.gmailAddress = profile.data.emailAddress;
        diag.gmailMessagesTotal = profile.data.messagesTotal;
      } catch (tokenErr: any) {
        diag.tokenValid = false;
        diag.tokenError = tokenErr?.response?.data?.error ?? tokenErr?.message ?? String(tokenErr);
      }

      // 3. Most recent thread in DB
      const recentThreads = await db
        .select({ threadId: gmailThreadMeta.threadId, lastMessageAt: gmailThreadMeta.lastMessageAt, subject: gmailThreadMeta.subject })
        .from(gmailThreadMeta)
        .orderBy(gmailThreadMeta.lastMessageAt)
        .limit(3);
      diag.threadsInDb = recentThreads.length;
      diag.mostRecentThread = recentThreads[recentThreads.length - 1] ?? null;

      return res.json(diag);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // ── Manual backfill: re-process last 100 inbox threads ──────────────────────
  // Safe to call at any time — only enqueues threads not yet in DB.
  // Auth: ?secret=CRON_SECRET in query string.
  app.get("/api/gmail/backfill", async (req, res) => {
    const secret = req.query["secret"] as string | undefined;
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return res.status(403).json({ error: "Unauthorized — provide ?secret=CRON_SECRET" });
    }
    try {
      console.log("[Gmail] Manual backfill triggered via /api/gmail/backfill");
      await backfillGlanceQueue();
      return res.send(`
        <html><body style="font-family:sans-serif;padding:40px">
          <h2>✅ Gmail backfill complete!</h2>
          <p>Last 100 inbox threads have been queued for processing.</p>
          <p>Check the CS inbox — missed emails should appear within a minute.</p>
        </body></html>
      `);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Gmail] Manual backfill error:", err);
      return res.status(500).send("Backfill error: " + msg);
    }
  });
}
