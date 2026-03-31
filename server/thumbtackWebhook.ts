/**
 * Thumbtack Lead Integration — Webhook Handler
 *
 * Flow:
 *  1. Zapier "New Lead" trigger on Thumbtack POSTs to POST /api/webhooks/thumbtack
 *  2. We parse the Thumbtack payload (name, phone, email, description/Q&A)
 *  3. AI extracts bedrooms/bathrooms/serviceType from the description
 *  4. We price the job, create a conversationSessions row with leadSource="thumbtack"
 *  5. We send the intro SMS (with photo) + scheduling SMS immediately
 *     — skipping qualification questions since we already have the data
 *  6. We alert the CS team and log the activity
 *
 * This file is entirely additive — it does not modify any existing code paths.
 * All existing form/widget/bark/reactivation flows are unaffected.
 *
 * Zapier setup:
 *  - Trigger: Thumbtack > New Lead (or New Message from Customer)
 *  - Action: Webhooks by Zapier > POST to https://quote.maidinblack.com/api/webhooks/thumbtack
 *  - No auth header required (same pattern as Bark)
 */

import type { Express } from "express";
import { getDb } from "./db";
import { conversationSessions, opsChatMessages } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { sendSms, estimatePrice } from "./openphone";
import { invokeLLM } from "./_core/llm";
import { getNextAvailableSlots, formatAvailabilityQuestion } from "./availability";
import { logActivity } from "./activityLogger";
import { notifyOwner } from "./_core/notification";
import { normalizePhone } from "./routers";

// ── Constants ─────────────────────────────────────────────────────────────────
const CS_SUPPORT_NUMBER = "+12028885362";
const SECONDARY_ALERT_NUMBER = "+13029816191";
const MADISON_PHOTO_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/madison-headshot-SPXr6KHGViveW2LxjwfyqN.png";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The Zapier "New Lead" Thumbtack trigger payload.
 * Thumbtack field names vary by Zapier version — all fields are optional defensively.
 *
 * Common Thumbtack Zapier fields:
 *   customer_name / name / first_name / last_name
 *   customer_phone / phone / phone_number
 *   customer_email / email
 *   request_description / description / details / message
 *   service_name / service / category
 *   location / city / zip / zipcode / postal_code
 *   lead_id / id
 */
export interface ThumbTackZapierPayload {
  // Contact info
  customer_name?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  customer_phone?: string;
  phone?: string;
  phone_number?: string;
  customer_email?: string;
  email?: string;
  email_address?: string;

  // Lead details
  lead_id?: string;
  id?: string;
  service_name?: string;
  service?: string;
  category?: string;

  // Location
  location?: string;
  city?: string;
  zip?: string;
  zipcode?: string;
  postal_code?: string;

  // The free-text job description — most valuable field for AI extraction
  request_description?: string;
  description?: string;
  details?: string;
  message?: string;
  job_description?: string;
}

/**
 * Structured data extracted from the Thumbtack description by the AI.
 */
export interface ThumbTackExtractedData {
  bedrooms: string | null;
  bathrooms: string | null;
  serviceType: string | null;
  frequency: string | null;
  summary: string;
}

// ── Q&A Extractor ─────────────────────────────────────────────────────────────

/**
 * Uses the LLM to extract structured cleaning job details from Thumbtack's
 * free-text description/request field.
 *
 * Falls back to sensible defaults if extraction fails so the lead is
 * never dropped — it just gets a generic quote.
 */
export async function extractThumbTackDescription(description: string): Promise<ThumbTackExtractedData> {
  const fallback: ThumbTackExtractedData = {
    bedrooms: null,
    bathrooms: null,
    serviceType: "Standard Clean",
    frequency: null,
    summary: description.slice(0, 500),
  };

  if (!description || description.trim().length < 5) return fallback;

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a data extraction assistant. Extract cleaning job details from a Thumbtack lead description. Return ONLY valid JSON.",
        },
        {
          role: "user",
          content: `Extract the following from this Thumbtack lead description. Return JSON only.

Description:
${description}

Return this exact JSON structure:
{
  "bedrooms": "3 Bedrooms" | "2 Bedrooms" | "1 Bedroom" | "Studio" | "4 Bedrooms" | "5 Bedrooms" | null,
  "bathrooms": "1 Bathroom" | "2 Bathrooms" | "3 Bathrooms" | "4 Bathrooms" | "1.5 Bathrooms" | "2.5 Bathrooms" | null,
  "serviceType": "Standard Clean" | "Deep Clean" | "Move In/Out Clean" | "Post Construction Clean" | "Office Cleaning",
  "frequency": "Weekly" | "Bi-Weekly" | "Monthly" | "One-Time" | null,
  "summary": "2-3 sentence plain English summary of the job request"
}

Rules:
- Use the exact bedroom/bathroom label formats shown above (e.g. "3 Bedrooms" not "3")
- If bedrooms/bathrooms are not mentioned, return null
- Default serviceType to "Standard Clean" if unclear
- summary should be concise and human-readable for the admin dashboard`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "thumbtack_extraction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              bedrooms: { type: ["string", "null"] },
              bathrooms: { type: ["string", "null"] },
              serviceType: { type: "string" },
              frequency: { type: ["string", "null"] },
              summary: { type: "string" },
            },
            required: ["bedrooms", "bathrooms", "serviceType", "frequency", "summary"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = response?.choices?.[0]?.message?.content;
    if (!raw) return fallback;

    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      bedrooms: parsed.bedrooms ?? null,
      bathrooms: parsed.bathrooms ?? null,
      serviceType: parsed.serviceType ?? "Standard Clean",
      frequency: parsed.frequency ?? null,
      summary: parsed.summary ?? description.slice(0, 300),
    };
  } catch (err) {
    console.error("[ThumbTackWebhook] Description extraction failed, using fallback:", err);
    return fallback;
  }
}

// ── Payload Normalizer ────────────────────────────────────────────────────────

/**
 * Normalizes the Zapier Thumbtack payload into clean fields.
 * Handles variations in field naming that Zapier may send.
 */
export function normalizeThumbTackPayload(body: ThumbTackZapierPayload): {
  name: string;
  phone: string;
  email: string;
  leadId: string;
  description: string;
  serviceCategory: string;
} {
  const firstName = body.first_name ?? "";
  const lastName = body.last_name ?? "";
  const fullName =
    body.customer_name ??
    body.name ??
    (firstName || lastName ? `${firstName} ${lastName}`.trim() : "Customer");

  const phone =
    body.customer_phone ?? body.phone ?? body.phone_number ?? "";
  const email =
    body.customer_email ?? body.email ?? body.email_address ?? "";
  const leadId =
    body.lead_id ?? body.id ?? "";
  const description =
    body.request_description ?? body.job_description ?? body.description ?? body.details ?? body.message ?? "";
  const serviceCategory =
    body.service_name ?? body.service ?? body.category ?? "House Cleaning";

  return { name: fullName, phone, email, leadId, description, serviceCategory };
}

// ── SMS Builders ──────────────────────────────────────────────────────────────

/**
 * Builds the intro SMS for a Thumbtack lead.
 * Since we already have job details from the description, we skip qualification
 * questions and go straight to scheduling.
 */
export function buildThumbTackIntroSms(
  firstName: string,
  serviceType: string,
  bedrooms: string | null,
  bathrooms: string | null,
  price: string,
  frequency: string | null
): string {
  const roomInfo =
    bedrooms && bathrooms
      ? ` for your ${bedrooms} / ${bathrooms} home`
      : bedrooms
      ? ` for your ${bedrooms} home`
      : "";
  const freqNote = frequency && frequency !== "One-Time" ? ` (${frequency.toLowerCase()})` : "";

  return `Hi ${firstName}! Madison here from Maids in Black — I saw your request on Thumbtack for a ${serviceType}${roomInfo}${freqNote}. Your quote is $${price} — our fully insured team handles everything!`;
}

/**
 * Builds the scheduling follow-up SMS for a Thumbtack lead.
 */
export function buildThumbTackSchedulingSms(): string {
  const slots = getNextAvailableSlots(2);
  return formatAvailabilityQuestion(slots);
}

// ── Main Handler ──────────────────────────────────────────────────────────────

/**
 * Processes an inbound Thumbtack lead from Zapier.
 * Called by the webhook route handler.
 */
export async function handleThumbTackLead(body: ThumbTackZapierPayload): Promise<void> {
  const { name, phone, email, leadId, description, serviceCategory } =
    normalizeThumbTackPayload(body);

  console.log(`[ThumbTackWebhook] New lead: name=${name}, phone=${phone}, leadId=${leadId}`);

  // ── Validate required fields ───────────────────────────────────────────────
  if (!phone) {
    console.error("[ThumbTackWebhook] No phone number in payload — dropping lead");
    return;
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    console.error(`[ThumbTackWebhook] Could not normalize phone: ${phone}`);
    return;
  }

  const firstName = name.split(" ")[0] ?? name;

  // ── Step 1: Extract job details with AI ───────────────────────────────────
  const extracted = await extractThumbTackDescription(description);
  console.log(`[ThumbTackWebhook] Extracted: bedrooms=${extracted.bedrooms}, bathrooms=${extracted.bathrooms}, serviceType=${extracted.serviceType}`);

  // ── Step 2: Price the job ──────────────────────────────────────────────────
  const bedrooms = extracted.bedrooms ?? "3 Bedrooms";
  const bathrooms = extracted.bathrooms ?? "2 Bathrooms";
  const serviceType = extracted.serviceType ?? "Standard Clean";

  // ── Silenced services — drop lead immediately ──────────────────────────────
  const SILENCED_SERVICES = ["Window Cleaning", "Carpet Cleaning"];
  if (SILENCED_SERVICES.some(s => serviceType.toLowerCase().includes(s.toLowerCase()))) {
    console.log(`[ThumbTackWebhook] Silenced service "${serviceType}" — dropping lead silently`);
    return;
  }

  const price = estimatePrice({ bedrooms, bathrooms, serviceType });

  // ── Step 3: Build SMS messages ─────────────────────────────────────────────
  const introSms = buildThumbTackIntroSms(
    firstName,
    serviceType,
    extracted.bedrooms,
    extracted.bathrooms,
    price,
    extracted.frequency
  );
  const schedulingSms = buildThumbTackSchedulingSms();

  // ── Step 4: Send SMS #1 (intro + photo) ───────────────────────────────────
  const sms1 = await sendSms({
    to: normalizedPhone,
    content: introSms,
    mediaUrl: MADISON_PHOTO_URL,
  });
  console.log(`[ThumbTackWebhook] Intro SMS sent: ${sms1.success}`);

  // ── Step 5: Send SMS #2 (scheduling) with natural delay ───────────────────
  await new Promise((r) => setTimeout(r, 2000));
  const sms2 = await sendSms({ to: normalizedPhone, content: schedulingSms });
  console.log(`[ThumbTackWebhook] Scheduling SMS sent: ${sms2.success}`);

  // ── Step 6: Alert CS team ──────────────────────────────────────────────────
  const alertMsg = `📌 New Thumbtack lead: ${name} (${normalizedPhone}) — ${serviceType}${extracted.bedrooms ? ` · ${extracted.bedrooms}` : ""}${extracted.bathrooms ? ` / ${extracted.bathrooms}` : ""}. Quote: $${price}`;
  sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[ThumbTackWebhook] CS alert failed:", err)
  );
  sendSms({ to: SECONDARY_ALERT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[ThumbTackWebhook] Secondary alert failed:", err)
  );

  // ── Step 7: Create conversation session ───────────────────────────────────
  const db = await getDb();
  if (!db) {
    console.error("[ThumbTackWebhook] No DB connection — skipping session creation");
    return;
  }

  const now = Date.now();
  const initialHistory = JSON.stringify([
    { role: "assistant", content: introSms, ts: now },
    { role: "assistant", content: schedulingSms, ts: now + 1 },
  ]);

  // Store the Thumbtack description summary in barkQA column (shared field for lead Q&A)
  const leadQASummary = [
    extracted.summary,
    extracted.frequency ? `Frequency: ${extracted.frequency}` : null,
    leadId ? `Thumbtack ID: ${leadId}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  try {
    await db.insert(conversationSessions).values({
      leadPhone: normalizedPhone,
      leadName: name,
      stage: "AVAILABILITY",
      quotedPrice: price,
      serviceType,
      bedrooms,
      bathrooms,
      messageHistory: initialHistory,
      leadSource: "thumbtack",
      barkQA: leadQASummary,
    });
    console.log(`[ThumbTackWebhook] Session created for ${normalizedPhone}`);
  } catch (dbErr) {
    console.error("[ThumbTackWebhook] Failed to create session:", dbErr);
  }

  // ── Step 8: Log activity ───────────────────────────────────────────────────
  logActivity({
    eventType: "new_lead",
    title: `New Thumbtack lead: ${name}`,
    body: `${serviceType}${extracted.bedrooms ? ` · ${extracted.bedrooms}` : ""}${extracted.bathrooms ? ` / ${extracted.bathrooms}` : ""} · $${price}`,
    meta: {
      leadPhone: normalizedPhone,
      leadName: name,
      serviceType,
      price,
      source: "thumbtack",
      leadId,
    },
  }).catch(() => {});

  // ── Step 9: Notify owner ───────────────────────────────────────────────────
  notifyOwner({
    title: `New Thumbtack Lead: ${name}`,
    content: `${serviceType}${extracted.bedrooms ? ` · ${extracted.bedrooms}` : ""}${extracted.bathrooms ? ` / ${extracted.bathrooms}` : ""} · $${price}\n\n${extracted.summary}`,
  }).catch(() => {});

  // ── Step 10: Post new lead card to MIB Command Chat ───────────────────────
  try {
    const [ttSession] = await db
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, normalizedPhone))
      .orderBy(desc(conversationSessions.id))
      .limit(1);
    const ttSessionId = ttSession?.id ?? null;

    const sizeDisplay = `${bedrooms} / ${bathrooms}`;
    const leadBody = `📌 **Thumbtack Lead** · ${name} · ${normalizedPhone}\n🏠 **${serviceType}** · ${sizeDisplay} · **$${price}**`;
    const metadata = JSON.stringify({
      leadName: name,
      leadPhone: normalizedPhone,
      serviceType,
      size: sizeDisplay,
      price,
      utmSource: "thumbtack",
      sessionId: ttSessionId,
      arrivedAt: Date.now(),
    });
    await db.insert(opsChatMessages).values({
      cleanerJobId: null,
      channel: "command",
      authorName: "🎯 New Lead",
      authorRole: "system",
      body: leadBody,
      mediaUrl: null,
      quickAction: "new_lead",
      metadata,
    });
    console.log(`[ThumbTackWebhook] Posted new_lead card with sessionId=${ttSessionId}`);
  } catch (err) {
    console.error("[ThumbTackWebhook] Failed to post lead card to command channel:", err);
  }
}

// ── Route Registration ────────────────────────────────────────────────────────

/**
 * Registers POST /api/webhooks/thumbtack on the Express app.
 * Called from webhooks.ts — the only change needed in existing files.
 */
export function registerThumbTackWebhookRoute(app: Express): void {
  app.post("/api/webhooks/thumbtack", async (req, res) => {
    // Respond immediately — Zapier expects a 200 within a few seconds
    res.status(200).json({ received: true });

    try {
      await handleThumbTackLead(req.body as ThumbTackZapierPayload);
    } catch (err) {
      console.error("[ThumbTackWebhook] Unhandled error:", err);
    }
  });

  console.log("[ThumbTackWebhook] Route registered: POST /api/webhooks/thumbtack");
}
