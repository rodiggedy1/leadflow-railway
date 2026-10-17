import type { Express } from "express";

export type ThumbTackWebhookCapture = {
  eventType: string | null;
  fieldPaths: string[];
  leadId: string | null;
  negotiationId: string | null;
  phonePaths: string[];
  phoneValuesPresent: boolean;
};

let latestCapture: { receivedAt: string; summary: ThumbTackWebhookCapture } | null = null;

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
 * Diagnostic-only endpoint for observing Thumbtack webhook payload shape.
 * It deliberately does not create/update LeadFlow records or send messages.
 */
export function registerThumbTackWebhookCaptureRoute(app: Express): void {
  app.get("/api/webhooks/thumbtack-capture/status", (_req, res) => {
    res.status(200).json({ latestCapture });
  });

  app.post("/api/webhooks/thumbtack-capture", (req, res) => {
    const summary = summarizeThumbTackWebhook(req.body);
    latestCapture = { receivedAt: new Date().toISOString(), summary };
    console.log("[ThumbTackCapture] received payload summary", JSON.stringify(summary));
    res.status(200).json({ received: true, summary });
  });

  console.log("[ThumbTackCapture] Route registered: POST /api/webhooks/thumbtack-capture");
}
