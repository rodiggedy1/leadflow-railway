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
import { registerEmergencyAgentLoginRoute } from "../emergencyAgentLoginRoute";
import { signAgentSession } from "./agentAuth";
import { getSessionCookieOptions } from "./cookies";
import { AGENT_COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getAgentByEmail } from "../db";

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

async function startServer() {
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
