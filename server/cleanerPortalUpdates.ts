import type { Response } from "express";

// This registry is deliberately separate from Ops SSE. Cleaner connections receive
// only a generic refresh hint and never operations events or job/customer payloads.
const clients = new Set<Response>();

function writeEvent(res: Response, event: string, data: string): void {
  try {
    res.write(`event: ${event}\ndata: ${data}\n\n`);
    const response = res as Response & { flush?: () => void };
    response.flush?.();
  } catch {
    clients.delete(res);
  }
}

export function registerCleanerPortalClient(res: Response): () => void {
  clients.add(res);
  return () => clients.delete(res);
}

/**
 * Sends no job, team, customer, or operations data. Each authenticated Cleaner
 * Portal independently re-reads its existing team-owned queries after this hint.
 */
export function broadcastCleanerPortalJobsChanged(): void {
  if (clients.size === 0) return;
  for (const res of Array.from(clients)) {
    writeEvent(res, "cleaner_portal_update", JSON.stringify({ type: "jobs_changed" }));
  }
}

// Keep the cleaner-only SSE connection open through proxy idle timeouts without
// invoking a refresh in the portal client.
setInterval(() => {
  for (const res of Array.from(clients)) writeEvent(res, "ping", "{}");
}, 25_000);
