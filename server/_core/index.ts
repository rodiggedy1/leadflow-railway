import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerWebhookRoutes } from "../webhooks";
import { registerCronRoutes } from "../cronSync";
import { registerFollowUpCronRoutes } from "../followUpCron";
import { registerVapiWebhookRoute } from "../vapiWebhook";
import { registerThumbTackBridgeRoute } from "../thumbtackBridgeRoute";
import { registerCallCenterCronRoute } from "../callCommandCenterCron";
import { bootstrapVapiAssistant } from "../vapiService";
import { startInternalCron } from "../internalCron";
import { registerWidgetEmbedRoute } from "../widgetEmbed";
import { registerSseTestRoutes } from "../sseTest";
import { registerOpsStreamRoute } from "../opsStream";
import { registerCsElevateStreamRoute } from "../csElevateStream";
import { registerCsReplyStreamRoute } from "../csReplyStream";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerVideoUploadRoute } from "../videoUpload";
import { ENV } from "./env";
import { registerInterviewUploadRoutes } from "../interviewUpload";
import { registerDeepgramStreamRoute } from "../deepgramStream";
import { registerAgentLoginRoute } from "../agentLoginRoute";
import { registerGmailRoutes } from "../gmailRoutes";
import { registerGmailWatchRenewCron } from "../gmailWatchRenewCron";
import { registerGbpRoutes } from "../gbpRoutes";
import { backfillTeamGeocodesOnStartup } from "../schedulingUtils";
import { startGlanceWorker, backfillGlanceQueue, clearBackfillCooldown } from "../gmailGlanceWorker";
import { registerEmergencyAgentLoginRoute } from "../emergencyAgentLoginRoute";
import { signAgentSession } from "./agentAuth";
import { getSessionCookieOptions } from "./cookies";
import { AGENT_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getAgentByEmail, getDb } from "../db";
import { sql, isNotNull, count } from "drizzle-orm";
import { gmailThreadMeta } from "../../drizzle/schema";

// Allowed origins for cross-origin requests (widget on maidsinblack.com)
const ALLOWED_ORIGINS = [
  "https://maidsinblack.com",
  "https://www.maidsinblack.com",
  "http://localhost:3000",
  "http://localhost:5173",
];

const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Allow same-origin requests (quote.maidinblack.com itself)
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function runStartupMigrations() {
  const db = await getDb();
  if (!db) {
    console.log('[Migration] No DB available — skipping startup migrations');
    return;
  }
  try {
    await db.execute(sql.raw(`
      ALTER TABLE confirmation_calls
        ADD COLUMN IF NOT EXISTS manual_outcome VARCHAR(32) NULL,
        ADD COLUMN IF NOT EXISTS manual_outcome_label VARCHAR(128) NULL,
        ADD COLUMN IF NOT EXISTS manual_override_by VARCHAR(64) NULL,
        ADD COLUMN IF NOT EXISTS manual_override_at BIGINT NULL
    `));
    console.log('[Migration] confirmation_calls manual override columns: OK');
  } catch (err) {
    console.error('[Migration] Failed to apply confirmation_calls migration:', err);
    // Non-fatal: server continues — columns may already exist or DB may be read-only
  }

  // ── Stripe card-on-file tables ────────────────────────────────────────────
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS card_auth_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        token VARCHAR(64) NOT NULL UNIQUE,
        customerPhone VARCHAR(30) NOT NULL,
        customerName VARCHAR(255),
        jobDate VARCHAR(64),
        jobAddress VARCHAR(512),
        cleanerJobId INT,
        used TINYINT NOT NULL DEFAULT 0,
        expiresAt BIGINT NOT NULL,
        completedAt BIGINT,
        createdAt TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));
    console.log('[Migration] card_auth_tokens: OK');
  } catch (err) {
    console.error('[Migration] Failed to create card_auth_tokens:', err);
  }

  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS stripe_customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phone VARCHAR(30) NOT NULL UNIQUE,
        name VARCHAR(255),
        stripeCustomerId VARCHAR(64) NOT NULL,
        stripePaymentMethodId VARCHAR(64),
        cardBrand VARCHAR(32),
        cardLast4 VARCHAR(4),
        cardExpMonth INT,
        cardExpYear INT,
        cardSavedAt BIGINT,
        createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
        updatedAt TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP
      )
    `));
    console.log('[Migration] stripe_customers: OK');
  } catch (err) {
    console.error('[Migration] Failed to create stripe_customers:', err);
  }

  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS payment_authorizations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cleanerJobId INT,
        jobLabel VARCHAR(255),
        customerPhone VARCHAR(30) NOT NULL,
        customerName VARCHAR(255),
        stripeCustomerId VARCHAR(64) NOT NULL,
        stripePaymentMethodId VARCHAR(64) NOT NULL,
        stripePaymentIntentId VARCHAR(64),
        amountCents INT NOT NULL,
        currency VARCHAR(8) NOT NULL DEFAULT 'usd',
        status VARCHAR(32) NOT NULL DEFAULT 'authorized',
        errorMessage TEXT,
        createdBy VARCHAR(128),
        actionBy VARCHAR(128),
        notes TEXT,
        authorizedAt BIGINT,
        capturedAt BIGINT,
        cancelledAt BIGINT,
        createdAt TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));
    console.log('[Migration] payment_authorizations: OK');
  } catch (err) {
    console.error('[Migration] Failed to create payment_authorizations:', err);
  }

  // ── conversation_sessions inbox summary columns ────────────────────────────────────
  // Adds denormalized summary fields so listCsInbox can stop selecting messageHistory.
  // Idempotent: uses ADD COLUMN IF NOT EXISTS. Safe to run on every deploy.
  try {
    await db.execute(sql.raw(`
      ALTER TABLE conversation_sessions
        ADD COLUMN IF NOT EXISTS lastMessageText       VARCHAR(255) NULL,
        ADD COLUMN IF NOT EXISTS lastMessageTs         BIGINT NULL,
        ADD COLUMN IF NOT EXISTS lastCustomerMessageTs BIGINT NULL,
        ADD COLUMN IF NOT EXISTS lastMessageRole       VARCHAR(16) NULL,
        ADD COLUMN IF NOT EXISTS messageCount          INT NOT NULL DEFAULT 0
    `));
    console.log('[Migration] conversation_sessions summary columns: OK');
  } catch (err) {
    console.error('[Migration] Failed to add conversation_sessions summary columns:', err);
  }

  // ── Backfill summary columns from messageHistory ──────────────────────────────────
  // Only processes rows where lastMessageTs IS NULL (not yet backfilled).
  // Uses lastMessageTs = 0 as a sentinel for rows with empty messageHistory.
  // Idempotent: safe to run on every deploy — exits immediately if nothing to do.
  try {
    const [pendingRows] = await db.execute(sql.raw(
      `SELECT COUNT(*) AS pending FROM conversation_sessions WHERE lastMessageTs IS NULL`
    )) as any;
    const pending = Array.isArray(pendingRows) ? (pendingRows[0]?.pending ?? 0) : 0;

    if (pending === 0) {
      console.log('[Migration] conversation_sessions backfill: nothing to do (all rows already have summary fields)');
    } else {
      console.log(`[Migration] conversation_sessions backfill: starting for ${pending} rows...`);
      let processed = 0;
      let updated = 0;
      let empty = 0;
      const BATCH = 200;

      while (true) {
        const [rows] = await db.execute(sql.raw(
          `SELECT id, messageHistory FROM conversation_sessions WHERE lastMessageTs IS NULL LIMIT ${BATCH}`
        )) as any;
        if (!Array.isArray(rows) || rows.length === 0) break;

        for (const row of rows) {
          let msgs: Array<{ role: string; content?: string; ts?: number }> = [];
          try { msgs = JSON.parse(row.messageHistory ?? '[]'); if (!Array.isArray(msgs)) msgs = []; } catch { msgs = []; }

          if (msgs.length === 0) {
            await db.execute(sql.raw(
              `UPDATE conversation_sessions SET lastMessageText=NULL, lastMessageTs=0, lastCustomerMessageTs=NULL, lastMessageRole='unknown', messageCount=0 WHERE id=${row.id}`
            ));
            empty++;
          } else {
            const last = msgs[msgs.length - 1];
            const lastCustomer = [...msgs].reverse().find(m => m.role === 'user');
            const rawText = typeof last.content === 'string' ? last.content : JSON.stringify(last.content ?? '');
            const text = rawText.slice(0, 255).replace(/'/g, "''");
            const ts = last.ts ?? 0;
            const custTs = lastCustomer?.ts ?? 'NULL';
            const role = (last.role ?? 'unknown').slice(0, 16).replace(/'/g, "''");
            const count = msgs.length;
            await db.execute(sql.raw(
              `UPDATE conversation_sessions SET lastMessageText='${text}', lastMessageTs=${ts}, lastCustomerMessageTs=${custTs}, lastMessageRole='${role}', messageCount=${count} WHERE id=${row.id}`
            ));
            updated++;
          }
          processed++;
        }

        if (processed % 1000 === 0) {
          console.log(`[Migration] conversation_sessions backfill progress: ${processed} rows (${updated} updated, ${empty} empty)...`);
        }
      }

      const [remainingRows] = await db.execute(sql.raw(
        `SELECT COUNT(*) AS remaining FROM conversation_sessions WHERE lastMessageTs IS NULL`
      )) as any;
      const remaining = Array.isArray(remainingRows) ? (remainingRows[0]?.remaining ?? 0) : '?';

      console.log(`[Migration] conversation_sessions backfill complete: processed=${processed} updated=${updated} empty=${empty} remaining_null=${remaining}`);
    }
  } catch (err) {
    console.error('[Migration] conversation_sessions backfill failed (non-fatal):', err);
  }

  // ── cleaner_profiles.launch27TeamId (ghost-profile fix) ──────────────────────────
  // Adds the canonical L27 team ID column so the sync can match by ID instead of name.
  // The UNIQUE constraint prevents two profiles from ever claiming the same L27 team.
  try {
    await db.execute(sql.raw(`
      ALTER TABLE cleaner_profiles
        ADD COLUMN IF NOT EXISTS launch27TeamId INT NULL
    `));
    console.log('[Migration] cleaner_profiles.launch27TeamId column: OK');
  } catch (err) {
    console.error('[Migration] Failed to add cleaner_profiles.launch27TeamId:', err);
  }
  try {
    // Check if the unique index already exists before trying to add it
    // (MySQL does not support CREATE INDEX IF NOT EXISTS)
    const [rows] = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'cleaner_profiles'
        AND index_name = 'cleaner_profiles_launch27TeamId_unique'
    `)) as any;
    const alreadyExists = Array.isArray(rows) && rows[0]?.cnt > 0;
    if (!alreadyExists) {
      await db.execute(sql.raw(
        `ALTER TABLE cleaner_profiles ADD UNIQUE INDEX cleaner_profiles_launch27TeamId_unique (launch27TeamId)`
      ));
      console.log('[Migration] cleaner_profiles.launch27TeamId unique index: created');
    } else {
      console.log('[Migration] cleaner_profiles.launch27TeamId unique index: already exists, skipped');
    }
  } catch (err) {
    // Non-fatal: log and continue — the column still works without the index
    console.warn('[Migration] cleaner_profiles.launch27TeamId unique index: skipped —', (err as any)?.message);
  }
}

async function startServer() {
  // Run startup migrations before anything else touches the DB
  await runStartupMigrations();

  const app = express();
  const server = createServer(app);

  // CORS — must be before all other middleware so preflight OPTIONS requests are handled
  app.use(corsMiddleware);
  app.options("*", corsMiddleware); // handle preflight for all routes

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Raw binary parser for video/image uploads (must be before tRPC middleware)
  app.use("/api/upload/video", express.raw({ type: ["video/webm", "video/mp4", "video/*", "image/*"], limit: "200mb" }));
  // Raw binary parser for interview video chunks
  app.use("/api/interview/chunk", express.raw({ type: ["video/webm", "video/mp4", "video/*"], limit: "20mb" }));

  // Media proxy — serves R2/S3 images with correct CORS headers so all users can view them
  app.get("/api/media-proxy", async (req, res) => {
    const url = req.query.url as string;
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Missing url" });
    // Only proxy our own R2 bucket — accept r2.dev URLs or the configured public URL
    const r2PublicUrl = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");
    const isR2 = url.includes(".r2.dev/") || (r2PublicUrl && url.startsWith(r2PublicUrl));
    if (!isR2) {
      return res.status(403).json({ error: "Forbidden domain" });
    }
    try {
      const upstream = await fetch(url);
      if (!upstream.ok) return res.status(upstream.status).end();
      const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.send(buf);
    } catch {
      return res.status(502).json({ error: "Upstream fetch failed" });
    }
  });

  // Health check for Railway — includes commit SHA for deployment verification
  app.get("/api/health", (_req, res) => res.json({
    ok: true,
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || "unknown",
    time: new Date().toISOString(),
  }));

  // TEMPORARY debug endpoint — remove after login is confirmed working
  app.get("/api/debug-login", async (_req, res) => {
    try {
      const { getAgentByEmail } = await import("../db");
      const agent = await getAgentByEmail("rohangilkes@hey.com");
      res.json({
        found: !!agent,
        isActive: agent?.isActive,
        isAdmin: agent?.isAdmin,
        hashPrefix: agent?.passwordHash?.slice(0, 10),
        emergencyToken: process.env.EMERGENCY_AGENT_LOGIN_TOKEN ? "set" : "missing",
        emergencyEmail: process.env.EMERGENCY_AGENT_EMAIL ? "set" : "missing",
        dbUrl: process.env.DATABASE_URL ? "set" : "missing",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Video upload for applicant recordings
  registerVideoUploadRoute(app as any);
  // Interview video chunk upload + finalize
  registerInterviewUploadRoutes(app as any);
  // Deepgram streaming WebSocket proxy for real-time call assist
  registerDeepgramStreamRoute(server);
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // OpenPhone webhook for inbound SMS replies
  registerWebhookRoutes(app);
  // Embeddable widget script for external websites
  registerWidgetEmbedRoute(app);
  // SSE proof-of-concept test routes
  registerSseTestRoutes(app);
  // Production SSE stream for OpsChat real-time updates
  registerOpsStreamRoute(app);
  // Streaming SSE endpoint for CS Inbox world-class elevate rewrite
  registerCsElevateStreamRoute(app);
  // Streaming SSE endpoint for CS Inbox auto-draft (fills compose box live)
  registerCsReplyStreamRoute(app);
  // Nightly cron endpoint for Launch27 auto-sync
  registerCronRoutes(app);
  // Follow-up cron endpoints (5-min silence nudge + scheduled circle-back)
  registerFollowUpCronRoutes(app);
  // Vapi voice AI webhook (tool-calls + end-of-call-report)
  registerVapiWebhookRoute(app);
  // Thumbtack Chrome extension bridge: SMS + Vapi conference call
  registerThumbTackBridgeRoute(app);
  // Call Command Center: auto-raise no-checkin issues (Heartbeat cron)
  registerCallCenterCronRoute(app);
  // Plain REST login — bypasses /api/trpc to avoid platform rate limit on that path
  registerAgentLoginRoute(app as any);
  // Gmail OAuth + Pub/Sub webhook routes
  registerGmailRoutes(app);
  // Gmail watch auto-renewal cron (Heartbeat, every 6 days)
  registerGmailWatchRenewCron(app);
  // Google Business Profile OAuth + reviews routes
  registerGbpRoutes(app);

  // Preview auto-login: when PREVIEW_MODE=true, visiting /api/preview-login sets
  // an admin agent session cookie automatically so the UI is accessible without credentials.
  // Uses EMERGENCY_AGENT_EMAIL to look up a real agent so agents.me DB lookup succeeds.
  if (ENV.isPreviewMode) {
    app.get("/api/preview-login", async (req, res) => {
      const defaultEmail = process.env.EMERGENCY_AGENT_EMAIL;
      if (!defaultEmail) {
        console.error("[Preview] EMERGENCY_AGENT_EMAIL not set — cannot auto-login");
        return res.status(500).send("Preview login unavailable: EMERGENCY_AGENT_EMAIL not configured");
      }
      try {
        const agent = await getAgentByEmail(defaultEmail.toLowerCase().trim());
        if (!agent || !agent.isActive) {
          console.error(`[Preview] Agent not found or inactive: ${defaultEmail}`);
          return res.status(500).send("Preview login unavailable: agent not found");
        }
        const token = await signAgentSession({
          agentId: agent.id,
          agentName: agent.name,
          agentEmail: agent.email,
          isAdmin: agent.isAdmin === 1,
        });
        const cookieOpts = getSessionCookieOptions(req);
        res.cookie(AGENT_COOKIE_NAME, token, { ...cookieOpts, maxAge: ONE_YEAR_MS });
        console.log(`[Preview] Auto-login as ${agent.email} (id=${agent.id})`);
        return res.redirect("/admin/leads");
      } catch (err) {
        console.error("[Preview] Auto-login error:", err);
        return res.status(500).send("Preview login error");
      }
    });
    console.log("[Preview] Auto-login endpoint registered: GET /api/preview-login");
  }
  // TEMPORARY emergency magic-link login — remove after Manus support fixes 429
  registerEmergencyAgentLoginRoute(app as any);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      allowMethodOverride: true,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Start internal cron scheduler immediately (nightly sync, follow-ups, always-on).
    // The AI warmup cron has its own 60s startup delay built in.
    if (ENV.isPreviewMode) {
      console.log("[Preview] PREVIEW_MODE=true — all cron jobs and Vapi bootstrap disabled");
    } else {
      // Backfill homeLat/homeLng for any teams that have a homeAddress but missing geocode.
      // Runs once at startup, takes <1s per team, uses the geocode cache.
      setTimeout(() => { backfillTeamGeocodesOnStartup().catch(console.error); }, 5_000);
      // Start the AI glance worker (600ms interval) and backfill last 100 inbox threads.
      // Purely additive — never touches existing inbox/SMS/webhook flows.
      startGlanceWorker();
      // Startup backfill is disabled by default.
      // Set GMAIL_BACKFILL_ENABLED=true in Railway env vars ONLY after the Gmail health check
      // (node scripts/check-gmail-quota.mjs) returns 200 OK.
      // After backfill completes, remove or set GMAIL_BACKFILL_ENABLED=false to prevent re-runs.
      if (process.env.GMAIL_BACKFILL_ENABLED !== "true") {
        console.log("[GlanceWorker] Startup backfill disabled — set GMAIL_BACKFILL_ENABLED=true to enable.");
      } else
      setTimeout(async () => {
        try {
          const db = await getDb();
          if (!db) return;
          const [row] = await db
            .select({ hydratedRows: count() })
            .from(gmailThreadMeta)
            .where(isNotNull(gmailThreadMeta.senderName));
          const hydratedRows = Number(row?.hydratedRows ?? 0);
          if (hydratedRows >= 50) {
            console.log(`[GlanceWorker] Backfill skipped on startup — inbox already seeded (${hydratedRows} hydrated rows).`);
            return;
          }
          console.log(`[GlanceWorker] Inbox not yet seeded (${hydratedRows} hydrated rows) — running backfill.`);
          await clearBackfillCooldown();
          await backfillGlanceQueue();
        } catch (e) {
          console.error("[GlanceWorker] Startup backfill guard failed:", e);
        }
      }, 15_000);
      startInternalCron();
      // Bootstrap Vapi assistant after a 30s startup delay so health checks pass first.
      // Always use the production domain so Vapi tool calls reach the live server.
      // VAPI_WEBHOOK_URL env var sets the webhook destination; defaults to production domain.
      const webhookUrl = process.env.VAPI_WEBHOOK_URL ?? "https://quote.maidinblack.com/api/webhooks/vapi";
      const VAPI_STARTUP_DELAY_MS = 30_000;
      console.log(`[Vapi] Bootstrap scheduled in ${VAPI_STARTUP_DELAY_MS / 1000}s...`);
      setTimeout(() => {
        bootstrapVapiAssistant(webhookUrl).catch(console.error);
      }, VAPI_STARTUP_DELAY_MS);
    }
  });
}

startServer().catch(console.error);
