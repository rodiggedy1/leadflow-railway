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
import { bootstrapVapiAssistant } from "../vapiService";
import { startInternalCron } from "../internalCron";
import { registerWidgetEmbedRoute } from "../widgetEmbed";
import { registerSseTestRoutes } from "../sseTest";
import { registerOpsStreamRoute } from "../opsStream";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerVideoUploadRoute } from "../videoUpload";

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

  // Video upload for applicant recordings
  registerVideoUploadRoute(app as any);
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
  // Nightly cron endpoint for Launch27 auto-sync
  registerCronRoutes(app);
  // Follow-up cron endpoints (5-min silence nudge + scheduled circle-back)
  registerFollowUpCronRoutes(app);
  // Vapi voice AI webhook (tool-calls + end-of-call-report)
  registerVapiWebhookRoute(app);
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
  });
}

startServer().catch(console.error);
