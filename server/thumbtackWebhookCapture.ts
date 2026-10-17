import type { Express } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "./db";

export type ThumbTackWebhookCapture = {
  eventType: string | null;
  fieldPaths: string[];
  leadId: string | null;
  negotiationId: string | null;
  phonePaths: string[];
  phoneValuesPresent: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectFieldPaths(value: unknown, prefix = "", paths: string[] = []): string[] {
  if (!isRecord(value)) return paths;

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    if (isRecord(child)) collectFieldPaths(child, path, paths);
  }

  return paths;
}

function findValuesByKey(value: unknown, wantedKeys: Set<string>, prefix = "", matches: string[] = []): string[] {
  if (!isRecord(value)) return matches;

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (wantedKeys.has(key.toLowerCase()) && typeof child === "string" && child.trim()) {
      matches.push(path);
    }
    if (isRecord(child)) findValuesByKey(child, wantedKeys, path, matches);
  }

  return matches;
}

function firstStringAtPaths(value: unknown, candidates: string[]): string | null {
  if (!isRecord(value)) return null;
  for (const candidate of candidates) {
    const parts = candidate.split(".");
    let current: unknown = value;
    for (const part of parts) {
      if (!isRecord(current)) {
        current = undefined;
        break;
      }
      current = current[part];
    }
    if (typeof current === "string" && current.trim()) return current;
  }
  return null;
}

function isStatusAuthorized(req: { query: Record<string, unknown> }): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && req.query.secret === secret);
}

export function summarizeThumbTackWebhook(body: unknown): ThumbTackWebhookCapture {
  const fieldPaths = collectFieldPaths(body).sort();
  const phonePaths = findValuesByKey(
    body,
    new Set(["phone", "phone_number", "phonenumber", "customer_phone", "customerphone"])
  ).sort();

  return {
    eventType: firstStringAtPaths(body, ["eventType", "event_type", "type", "event.name"]),
    fieldPaths,
    leadId: firstStringAtPaths(body, [
      "leadID",
      "leadId",
      "lead_id",
      "lead.id",
      "negotiation.lead.id",
    ]),
    negotiationId: firstStringAtPaths(body, [
      "negotiationID",
      "negotiationId",
      "negotiation_id",
      "negotiation.id",
      "negotiation.negotiationID",
      "negotiation.negotiationId",
    ]),
    phonePaths,
    phoneValuesPresent: phonePaths.length > 0,
  };
}

/**
 * Diagnostic-only endpoint for observing and retaining Thumbtack webhook payloads.
 * It does not create/update LeadFlow records or send messages.
 */
export function registerThumbTackWebhookCaptureRoute(app: Express): void {
  app.get("/api/webhooks/thumbtack-capture/status", async (req, res) => {
    if (!isStatusAuthorized(req)) {
      res.status(403).json({ error: "Unauthorized" });
      return;
    }

    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      const rows = await db.execute(
        sql`SELECT id, raw_payload, created_at FROM webhook_events WHERE source = ${"thumbtack"} ORDER BY id DESC LIMIT 1`
      );
      const latest = ((rows as any)[0] as any[])[0];
      if (!latest) {
        res.status(200).json({ latestCapture: null });
        return;
      }

      res.status(200).json({
        latestCapture: {
          id: latest.id,
          receivedAt: latest.created_at,
          payload: JSON.parse(latest.raw_payload),
        },
      });
    } catch (error) {
      console.error("[ThumbTackCapture] failed to read payload:", error);
      res.status(500).json({ error: "Failed to read capture" });
    }
  });

  app.post("/api/webhooks/thumbtack-capture", async (req, res) => {
    const summary = summarizeThumbTackWebhook(req.body);
    const body = isRecord(req.body) ? req.body : {};
    const eventId = firstStringAtPaths(body, [
      "data.negotiationID",
      "data.messageID",
      "event.webhookID",
    ]);
    const eventType = firstStringAtPaths(body, [
      "event.eventType",
      "event.type",
      "eventType",
      "type",
    ]) ?? "unknown";

    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      const rawPayload = JSON.stringify(req.body ?? {});
      await db.execute(
        sql`INSERT INTO webhook_events (source, event_type, event_id, from_phone, to_phone, raw_payload, processed, created_at) VALUES (${"thumbtack"}, ${eventType}, ${eventId}, ${null}, ${null}, ${rawPayload}, 0, NOW())`
      );
      console.log("[ThumbTackCapture] persisted payload summary", JSON.stringify(summary));
      res.status(200).json({ received: true, summary, persisted: true });
    } catch (error) {
      console.error("[ThumbTackCapture] failed to persist payload:", error);
      res.status(500).json({ received: false, persisted: false });
    }
  });

  console.log("[ThumbTackCapture] Routes registered: POST /api/webhooks/thumbtack-capture; GET /api/webhooks/thumbtack-capture/status");
}
