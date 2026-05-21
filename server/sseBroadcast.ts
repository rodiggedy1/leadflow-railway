/**
 * sseBroadcast.ts — Central SSE broadcast hub for the OpsChat real-time layer.
 *
 * Architecture:
 *   - A single in-process client registry holds all active SSE response objects.
 *   - Any server mutation (new message, lead claimed, issue flagged, etc.) calls
 *     `broadcastOpsUpdate(eventType)` to notify every connected agent instantly.
 *   - The frontend `useOpsStream` hook listens and calls `refetch()` on the
 *     relevant tRPC queries — no query logic moves to the server.
 *
 * Event types:
 *   "new_message"     — a message was posted to any channel or job thread
 *   "lead_update"     — a lead was claimed or its metadata changed
 *   "job_update"      — a job status, flag, or issue changed
 *   "reaction_update" — a reaction was added or removed
 *   "reminder_update" — a reminder was set or fired
 *   "agent_status"    — an agent's on-call status changed (call answered/completed)
 *   "phone_update"    — update-lead-phone successfully linked a real phone to a lead
 *   "issue_comment"     — a comment was posted on an issue thread in Command Chat
 *   "lead_assignment"   — a lead was assigned to an agent from Lead Ops
 *   "ping"              — keepalive (sent every 25s to prevent proxy timeouts)
 */

import type { Response } from "express";

export type OpsEventType =
  | "new_message"
  | "lead_update"
  | "job_update"
  | "reaction_update"
  | "reminder_update"
  | "agent_status"
  | "phone_update"
  | "issue_comment"
  | "lead_assignment"
  | "ping";

export interface OpsEvent {
  type: OpsEventType;
  /** Optional channel or jobId hint so the client can be selective */
  channel?: string;
  jobId?: number;
  /** For phone_update events */
  leadName?: string;
  newPhone?: string;
  /** For issue_comment events */
  issueKey?: string;
  /** For lead_assignment events */
  assignmentId?: number;
  targetAgentId?: number;
  ts: number;
}

// ── Client registry ────────────────────────────────────────────────────────────
const clients = new Set<Response>();

export function registerOpsClient(res: Response): () => void {
  clients.add(res);
  return () => clients.delete(res);
}

export function getOpsClientCount(): number {
  return clients.size;
}

// ── Broadcast ──────────────────────────────────────────────────────────────────
export function broadcastOpsUpdate(
  type: OpsEventType,
  extra?: Omit<OpsEvent, "type" | "ts">
): void {
  if (clients.size === 0) return; // no-op when nobody is connected

  const event: OpsEvent = { type, ts: Date.now(), ...extra };
  const payload = `event: ops_update\ndata: ${JSON.stringify(event)}\n\n`;

  for (const res of Array.from(clients)) {
    try {
      res.write(payload);
      // Flush if the response supports it (compression middleware adds flush)
      const r = res as unknown as { flush?: () => void };
      if (typeof r.flush === "function") r.flush();
    } catch {
      // Client disconnected mid-write — remove it
      clients.delete(res);
    }
  }
}

// ── Keepalive ping ─────────────────────────────────────────────────────────────
// Proxies close idle connections after ~30s. Send a ping every 25s to keep them alive.
setInterval(() => {
  if (clients.size > 0) broadcastOpsUpdate("ping");
}, 25_000);
