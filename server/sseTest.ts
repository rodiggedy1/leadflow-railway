/**
 * sseTest.ts — Proof-of-concept SSE endpoint.
 *
 * GET /api/sse-test
 *   Opens a Server-Sent Events stream. Sends:
 *     - An immediate "connected" event
 *     - A "ping" event every 2 seconds with a counter and timestamp
 *     - A "done" event after 30 pings (1 minute), then closes
 *
 * POST /api/sse-test/trigger
 *   Broadcasts a one-off "trigger" event to ALL currently connected SSE clients.
 *   Use this to verify the server can push events on demand (simulates a new lead arriving).
 *
 * This endpoint is intentionally simple — no auth, no DB — so we can isolate
 * whether the hosting proxy supports SSE before building the full migration.
 */

import type { Express, Request, Response } from "express";

// In-memory registry of active SSE connections
const clients = new Set<Response>();

export function registerSseTestRoutes(app: Express) {
  // ── SSE stream endpoint ────────────────────────────────────────────────────
  app.get("/api/sse-test", (req: Request, res: Response) => {
    // Required SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders(); // Flush immediately so the client receives headers

    // Register this client
    clients.add(res);

    // Send immediate connected event
    sendEvent(res, "connected", {
      message: "SSE connection established ✅",
      clientCount: clients.size,
      ts: Date.now(),
    });

    // Send a ping every 2 seconds
    let count = 0;
    const MAX_PINGS = 30; // auto-close after 1 minute
    const interval = setInterval(() => {
      count++;
      sendEvent(res, "ping", {
        count,
        ts: Date.now(),
        message: `Ping #${count} — proxy is NOT buffering ✅`,
      });

      if (count >= MAX_PINGS) {
        sendEvent(res, "done", { message: "Test complete — SSE works end-to-end 🎉" });
        clearInterval(interval);
        clients.delete(res);
        res.end();
      }
    }, 2000);

    // Clean up when the client disconnects
    req.on("close", () => {
      clearInterval(interval);
      clients.delete(res);
    });
  });

  // ── Manual trigger endpoint ────────────────────────────────────────────────
  // POST /api/sse-test/trigger — broadcasts a "trigger" event to all connected clients
  app.post("/api/sse-test/trigger", (req: Request, res: Response) => {
    const payload = {
      message: "Manual trigger fired — all clients received this instantly 🚀",
      ts: Date.now(),
      connectedClients: clients.size,
    };

    let sent = 0;
    for (const client of Array.from(clients)) {
      sendEvent(client, "trigger", payload);
      sent++;
    }

    res.json({ ok: true, clientsNotified: sent });
  });
}

// ── Helper ─────────────────────────────────────────────────────────────────────
function sendEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  // Force flush — critical for proxies that buffer responses
  if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
    (res as unknown as { flush: () => void }).flush();
  }
}
