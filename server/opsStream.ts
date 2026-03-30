/**
 * opsStream.ts — The production SSE endpoint for OpsChat real-time updates.
 *
 * GET /api/ops-stream
 *   Requires an agent or owner session cookie (same auth as opsChatProcedure).
 *   Opens a persistent SSE stream. The server pushes an "ops_update" event
 *   whenever any relevant mutation fires (new message, job update, lead claim, etc.).
 *   The client calls refetch() on the affected tRPC queries — no data travels
 *   over the stream itself, only a typed event hint.
 *
 * The stream also receives a "ping" keepalive every 25 seconds (from sseBroadcast.ts)
 * to prevent proxy timeouts.
 */

import type { Express, Request, Response } from "express";
import { getAgentFromRequest } from "./_core/agentAuth";
import { sdk } from "./_core/sdk";
import { registerOpsClient, getOpsClientCount } from "./sseBroadcast";

/** Verify either an agent cookie or an owner (Manus OAuth) session cookie. */
async function isAuthorizedOpsUser(req: Request): Promise<boolean> {
  // 1. Agent session
  const agent = await getAgentFromRequest(req);
  if (agent) return true;

  // 2. Manus OAuth owner session
  try {
    const user = await sdk.authenticateRequest(req);
    return Boolean(user);
  } catch {
    return false;
  }
}

export function registerOpsStreamRoute(app: Express) {
  app.get("/api/ops-stream", async (req: Request, res: Response) => {
    // Auth check — same gate as opsChatProcedure
    const authorized = await isAuthorizedOpsUser(req);
    if (!authorized) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders();

    // Register with the broadcast hub
    const unregister = registerOpsClient(res);

    // Send an immediate "connected" event so the client knows the stream is live
    res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now(), clients: getOpsClientCount() })}\n\n`);
    const r = res as unknown as { flush?: () => void };
    if (typeof r.flush === "function") r.flush();

    // Clean up when the client disconnects
    req.on("close", () => {
      unregister();
    });
  });
}
