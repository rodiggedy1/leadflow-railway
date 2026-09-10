import type { Express, Request, Response } from "express";
import { getCleanerFromRequest } from "./_core/cleanerAuth";
import { registerCleanerPortalClient } from "./cleanerPortalUpdates";

/**
 * Cleaner-only SSE endpoint. A valid cleaner session may receive a generic
 * job-refresh hint, while the existing Cleaner Portal tRPC queries continue to
 * enforce each cleaner's team-owned data boundary.
 */
export function registerCleanerPortalStreamRoute(app: Express): void {
  app.get("/api/cleaner-portal-stream", async (req: Request, res: Response) => {
    const cleaner = await getCleanerFromRequest(req);
    if (!cleaner) {
      res.status(401).json({ error: "Cleaner login required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const unregister = registerCleanerPortalClient(res);
    res.write("event: connected\ndata: {}\n\n");
    const response = res as Response & { flush?: () => void };
    response.flush?.();

    req.on("close", unregister);
  });
}
