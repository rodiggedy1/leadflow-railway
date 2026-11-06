import express, { type Express, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { conversationSessions, opsChatMessages } from "../drizzle/schema";
import { getDb } from "./db";
import { isValidUSPhone, normalizePhone } from "./utils/phone";

export const WEBSITE_HERO_SOURCE = "Website hero section";
const PATH = "/api/leads/website-hero";
const APPROVED_ORIGINS = [
  "https://maidsweb-uhd9bbhv.manus.space",
  "https://maidsinblack.com",
  "https://www.maidsinblack.com",
  "https://wordpress-1428546-5340884.cloudwaysapps.com",
  "https://8328-iayvzs65tb8u6ytl8foku-0986f185.us5.manus.computer",
] as const;
const boundedText = (max: number) => z.string().max(max).trim().refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const inputSchema = z.object({
  firstName: boundedText(100).refine(value => value.length > 0),
  phone: boundedText(40).refine(isValidUSPhone).transform(value => normalizePhone(value)!),
  bedrooms: z.number().int().min(1).max(4),
  bathrooms: z.number().int().min(1).max(4),
  requestId: z.string().uuid(),
  website: z.literal("").optional(),
  utmSource: boundedText(100).optional(),
  utmMedium: boundedText(100).optional(),
  utmCampaign: boundedText(255).optional(),
  utmContent: boundedText(255).optional(),
  gclid: boundedText(255).optional(),
}).strict();
export type WebsiteHeroInput = z.infer<typeof inputSchema>;

/** Same session/card representation as the popup; no quote/SMS processor is called. */
export async function saveWebsiteHeroLead(input: WebsiteHeroInput): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const bedrooms = `${input.bedrooms} ${input.bedrooms === 1 ? "Bedroom" : "Bedrooms"}`;
  const bathrooms = `${input.bathrooms} ${input.bathrooms === 1 ? "Bathroom" : "Bathrooms"}`;
  const arrivedAt = Date.now();
  await db.transaction(async tx => {
    const [result] = await tx.insert(conversationSessions).values({
      leadPhone: input.phone,
      leadName: input.firstName,
      stage: "WIDGET_SIZING",
      bedrooms,
      bathrooms,
      leadSource: WEBSITE_HERO_SOURCE,
      aiMode: 0,
      // Empty history truthfully means no messages have been sent or received.
      messageHistory: "[]",
      utmSource: input.utmSource || null,
      utmMedium: input.utmMedium || null,
      utmCampaign: input.utmCampaign || null,
      utmContent: input.utmContent || null,
      gclid: input.gclid || null,
    });
    const sessionId = result.insertId;
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw new Error("Save failed");
    await tx.insert(opsChatMessages).values({
      channel: "command",
      authorName: "🎯 New Lead",
      authorRole: "system",
      quickAction: "new_lead",
      body: `${WEBSITE_HERO_SOURCE} · ${bedrooms} / ${bathrooms}`,
      metadata: JSON.stringify({
        leadName: input.firstName,
        leadPhone: input.phone,
        source: WEBSITE_HERO_SOURCE,
        bedrooms,
        bathrooms,
        size: `${bedrooms} / ${bathrooms}`,
        sessionId,
        arrivedAt,
      }),
      createdAt: new Date(arrivedAt),
    });
  });
}

type RouteOptions = {
  save?: (input: WebsiteHeroInput) => Promise<void>;
  additionalOrigins?: readonly string[];
  now?: () => number;
};

/** Mount BEFORE global CORS and JSON parsing so only this route owns its preflight and body limit. */
export function registerWebsiteHeroLeadRoute(app: Express, options: RouteOptions = {}): void {
  const origins = new Set<string>(APPROVED_ORIGINS);
  // Deliberate deployment-time exact allowlist; this does not change any environment variables.
  const additions = options.additionalOrigins ?? (process.env.WEBSITE_HERO_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  for (const value of additions) {
    const origin = value.trim();
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin) throw new Error("Invalid hero origin configuration");
    origins.add(origin);
  }
  const now = options.now ?? Date.now;
  const save = options.save ?? saveWebsiteHeroLead;
  // Best-effort per-process/network-peer admission, not distributed or durable deduplication.
  const rate = new Map<string, { expiresAt: number; attempts: number }>();
  const router = express.Router();
  const reject = (res: express.Response, status: number, error: string) => res.status(status).json({ success: false, saved: false, error });
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.vary("Origin");
    if (!req.headers.origin || !origins.has(req.headers.origin)) return void reject(res, 403, "ORIGIN_NOT_ALLOWED");
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (Object.keys(req.query).length > 0) return void reject(res, 400, "INVALID_INPUT");
    if (req.method === "OPTIONS") {
      const requestedHeaders = (req.headers["access-control-request-headers"] ?? "").toString().toLowerCase().split(",").map(value => value.trim()).filter(Boolean);
      if (req.headers["access-control-request-method"] !== "POST" || requestedHeaders.some(value => value !== "content-type")) return void reject(res, 403, "PREFLIGHT_NOT_ALLOWED");
      return void res.sendStatus(204);
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return void reject(res, 405, "METHOD_NOT_ALLOWED");
    }
    const time = now();
    rate.forEach((bucket, key) => { if (bucket.expiresAt <= time) rate.delete(key); });
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const bucket = rate.get(key);
    if ((bucket && bucket.attempts >= 5) || (!bucket && rate.size >= 10_000)) {
      res.setHeader("Retry-After", "60");
      return void reject(res, 429, "RATE_LIMITED");
    }
    rate.set(key, { expiresAt: bucket?.expiresAt ?? time + 60_000, attempts: (bucket?.attempts ?? 0) + 1 });
    if (!req.is("application/json")) return void reject(res, 415, "JSON_REQUIRED");
    if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") return void reject(res, 415, "JSON_REQUIRED");
    next();
  });
  router.use(express.json({ limit: "4kb", strict: true, inflate: false }));
  router.post("/", async (req, res) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) return void reject(res, 400, "INVALID_INPUT");
    try {
      await save(parsed.data);
      res.status(200).json({ success: true, saved: true });
    } catch {
      // Never emit a provider/SQL error, body, customer identity or saved IDs.
      reject(res, 503, "SAVE_FAILED");
    }
  });
  const parserError: ErrorRequestHandler = (error, _req, res, _next) => {
    reject(res, error?.type === "entity.too.large" ? 413 : 400, error?.type === "entity.too.large" ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON");
  };
  router.use(parserError);
  app.use(PATH, router);
}
