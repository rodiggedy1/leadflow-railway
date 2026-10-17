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

function isStatusAuthorized(req: { query: Record<string, unknown>; get: (name: string) => string | undefined }): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const querySecret = typeof req.query.secret === "string" ? req.query.secret : undefined;
  const headerSecret = req.get("x-cron-secret");
  const authorization = req.get("authorization");
  const bearerSecret = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  return querySecret === secret || headerSecret === secret || bearerSecret === secret;
}

function parsePayload(rawPayload: unknown): Record<string, unknown> {
  if (typeof rawPayload !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(rawPayload);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
  app.get("/api/webhooks/thumbtack-capture/events", async (req, res) => {
    if (!isStatusAuthorized(req)) {
      res.status(403).json({ error: "Unauthorized" });
      return;
    }

    const negotiationId = typeof req.query.negotiationId === "string" ? req.query.negotiationId : null;
    const eventType = typeof req.query.eventType === "string" ? req.query.eventType : null;

    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      const filters = [sql`source = ${"thumbtack"}`];
      if (negotiationId) filters.push(sql`JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.data.negotiationID')) = ${negotiationId}`);
      if (eventType) filters.push(sql`event_type = ${eventType}`);
      const where = sql.join(filters, sql` AND `);
      const rows = await db.execute(
        sql`SELECT id, event_type, event_id, created_at, raw_payload FROM webhook_events WHERE ${where} ORDER BY id DESC LIMIT 100`
      );
      const records = ((rows as any)[0] as any[]).map((row: any) => {
        const payload = parsePayload(row.raw_payload);
        return {
          id: row.id,
          eventType: firstStringAtPaths(payload, ["event.eventType", "event.type", "eventType", "type"]) ?? row.event_type,
          webhookId: firstStringAtPaths(payload, ["event.webhookID", "event.webhookId", "webhookID", "webhookId"]),
          negotiationId: firstStringAtPaths(payload, ["data.negotiationID", "data.negotiationId", "negotiationID", "negotiationId"]),
          timestamp: row.created_at,
          payload,
        };
      });

      res.status(200).json({ count: records.length, limit: 100, filters: { negotiationId, eventType }, events: records });
    } catch (error) {
      console.error("[ThumbTackCapture] failed to read event history:", error);
      res.status(500).json({ error: "Failed to read event history" });
    }
  });

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
          payload: parsePayload(latest.raw_payload),
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

  console.log("[ThumbTackCapture] Routes registered: POST /api/webhooks/thumbtack-capture; GET /api/webhooks/thumbtack-capture/status; GET /api/webhooks/thumbtack-capture/events");
}
