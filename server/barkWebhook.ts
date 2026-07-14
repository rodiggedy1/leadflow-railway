/**
 * Bark.com Lead Integration — Webhook Handler
 *
 * Flow:
 *  1. Zapier "New Purchased Bark" trigger POSTs to POST /api/webhooks/bark
 *  2. We parse the Bark payload (name, phone, email, display_text Q&A)
 *  3. AI extracts bedrooms/bathrooms/serviceType from the Q&A display_text
 *  4. We price the job, create a conversationSessions row with leadSource="bark"
 *  5. We send the intro SMS (with photo) + scheduling SMS immediately
 *     — skipping the qualification questions since we already have the data
 *  6. We alert the CS team and log the activity
 *
 * This file is entirely additive — it does not modify any existing code paths.
 * All existing form/widget/reactivation flows are unaffected.
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
 * The Zapier "New Purchased Bark" trigger payload.
 * Field names match what Bark sends via Zapier (snake_case).
 * All fields are optional defensively — Zapier field names can vary.
 */
export interface BarkZapierPayload {
  // Contact info
  name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  phone_number?: string;
  email?: string;
  email_address?: string;

  // Lead details
  bark_id?: string;
  id?: string;
  service?: string;
  category?: string;
  service_category?: string;
  location?: string;
  city?: string;
  postcode?: string;
  zip?: string;

  // The full Q&A transcript — most valuable field
  display_text?: string;
  description?: string;
  details?: string;
}

/**
 * Structured data extracted from the Bark Q&A display_text by the AI.
 */
export interface BarkExtractedData {
  bedrooms: string | null;
  bathrooms: string | null;
  serviceType: string | null;
  frequency: string | null;
  summary: string; // human-readable Q&A summary stored in barkQA column
}

// ── Q&A Extractor ─────────────────────────────────────────────────────────────

/**
 * Uses the LLM to extract structured cleaning job details from Bark's
 * free-text Q&A display_text field.
 *
 * Falls back to sensible defaults if extraction fails so the lead is
 * never dropped — it just gets a generic quote.
 */
export async function extractBarkQA(displayText: string): Promise<BarkExtractedData> {
  const fallback: BarkExtractedData = {
    bedrooms: null,
    bathrooms: null,
    serviceType: "Standard Clean",
    frequency: null,
    summary: displayText.slice(0, 500),
  };

  if (!displayText || displayText.trim().length < 10) return fallback;

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a data extraction assistant. Extract cleaning job details from a Bark.com lead Q&A transcript. Return ONLY valid JSON.",
        },
        {
          role: "user",
          content: `Extract the following from this Bark lead Q&A transcript. Return JSON only.

Transcript:
${displayText}

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
          name: "bark_extraction",
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
      summary: parsed.summary ?? displayText.slice(0, 300),
    };
  } catch (err) {
    console.error("[BarkWebhook] Q&A extraction failed, using fallback:", err);
    return fallback;
  }
}

// ── Payload Normalizer ────────────────────────────────────────────────────────

/**
 * Normalizes the Zapier payload into clean fields.
 * Handles variations in field naming that Zapier may send.
 */
export function normalizeBarkPayload(body: BarkZapierPayload): {
  name: string;
  phone: string;
  email: string;
  barkId: string;
  displayText: string;
  serviceCategory: string;
} {
  const firstName = body.first_name ?? "";
  const lastName = body.last_name ?? "";
  const fullName =
    body.name ??
    (firstName || lastName ? `${firstName} ${lastName}`.trim() : "Customer");

  const phone =
    body.phone ?? body.phone_number ?? "";
  const email =
    body.email ?? body.email_address ?? "";
  const barkId =
    body.bark_id ?? body.id ?? "";
  const displayText =
    body.display_text ?? body.description ?? body.details ?? "";
  const serviceCategory =
    body.service ?? body.category ?? body.service_category ?? "House Cleaning";

  return { name: fullName, phone, email, barkId, displayText, serviceCategory };
}

// ── First SMS Builder ─────────────────────────────────────────────────────────

/**
 * Builds the intro SMS for a Bark lead.
 * Since we already have the job details from the Q&A, we skip the
 * qualification questions and go straight to scheduling.
 *
 * Format mirrors the standard quote SMS but references the Bark request.
 */
export function buildBarkIntroSms(
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

  return `Hi ${firstName}! Madison here from Maids in Black — I saw your request on Bark for a ${serviceType}${roomInfo}${freqNote}. Your quote is $${price} — our fully insured team handles everything!`;
}

/**
 * Builds the scheduling follow-up SMS for a Bark lead.
 * Skips availability question and goes straight to scheduling.
 */
export function buildBarkSchedulingSms(): string {
  const slots = getNextAvailableSlots(2);
  return formatAvailabilityQuestion(slots);
}

// ── Main Handler ──────────────────────────────────────────────────────────────

/**
 * Processes an inbound Bark lead from Zapier.
 * Called by the webhook route handler.
 */
export async function handleBarkLead(body: BarkZapierPayload): Promise<void> {
  const { name, phone, email, barkId, displayText, serviceCategory } =
    normalizeBarkPayload(body);

  console.log(`[BarkWebhook] New lead: name=${name}, phone=${phone}, barkId=${barkId}`);

  // ── Validate / fallback phone ────────────────────────────────────────────
  // NEVER drop a lead due to missing phone — use a placeholder so the session
  // is always created and the CS team can follow up manually.
  let normalizedPhone: string;
  if (!phone) {
    normalizedPhone = `no-phone-bark-${Date.now()}`;
    console.warn(`[BarkWebhook] No phone in payload — using placeholder: ${normalizedPhone}`);
    notifyOwner({
      title: "⚠️ Bark Lead — No Phone Number",
      content: `Lead: ${name}\nBark ID: ${barkId}\nNo phone number in payload. Session created with placeholder. Follow up manually.`,
    }).catch(() => {});
  } else {
    const np = normalizePhone(phone);
    if (!np) {
      normalizedPhone = `no-phone-bark-${Date.now()}`;
      console.warn(`[BarkWebhook] Could not normalize phone "${phone}" — using placeholder: ${normalizedPhone}`);
      notifyOwner({
        title: "⚠️ Bark Lead — Unnormalizable Phone",
        content: `Lead: ${name}\nRaw phone: ${phone}\nBark ID: ${barkId}\nSession created with placeholder. Follow up manually.`,
      }).catch(() => {});
    } else {
      normalizedPhone = np;
    }
  }

  const firstName = name.split(" ")[0] ?? name;

  // ── Step 1: Extract Q&A data with AI ──────────────────────────────────────
  const extracted = await extractBarkQA(displayText);
  console.log(`[BarkWebhook] Extracted: bedrooms=${extracted.bedrooms}, bathrooms=${extracted.bathrooms}, serviceType=${extracted.serviceType}`);

  // ── Step 2: Price the job ──────────────────────────────────────────────────
  // Use extracted data if available, fall back to defaults
  const bedrooms = extracted.bedrooms ?? "3 Bedrooms";
  const bathrooms = extracted.bathrooms ?? "2 Bathrooms";
  const serviceType = extracted.serviceType ?? "Standard Clean";

  const price = estimatePrice({ bedrooms, bathrooms, serviceType });

  // ── Step 3: Build SMS messages ─────────────────────────────────────────────
  const introSms = buildBarkIntroSms(
    firstName,
    serviceType,
    extracted.bedrooms,
    extracted.bathrooms,
    price,
    extracted.frequency
  );
  const schedulingSms = buildBarkSchedulingSms();

  // ── Step 4: Send SMS #1 (intro + photo) ───────────────────────────────────
  const sms1 = await sendSms({
    to: normalizedPhone,
    content: introSms,
    mediaUrl: MADISON_PHOTO_URL,
  });
  console.log(`[BarkWebhook] Intro SMS sent: ${sms1.success}`);

  // ── Step 5: Send SMS #2 (scheduling) with natural delay ───────────────────
  await new Promise((r) => setTimeout(r, 2000));
  const sms2 = await sendSms({ to: normalizedPhone, content: schedulingSms });
  console.log(`[BarkWebhook] Scheduling SMS sent: ${sms2.success}`);

  // ── Step 6: Alert CS team ──────────────────────────────────────────────────
  const alertMsg = `🌿 New Bark lead: ${name} (${normalizedPhone}) — ${serviceType}${extracted.bedrooms ? ` · ${extracted.bedrooms}` : ""}${extracted.bathrooms ? ` / ${extracted.bathrooms}` : ""}. Quote: $${price}`;
  sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[BarkWebhook] CS alert failed:", err)
  );
  sendSms({ to: SECONDARY_ALERT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[BarkWebhook] Secondary alert failed:", err)
  );

  // ── Step 7: Create conversation session ───────────────────────────────────
  const db = await getDb();
  if (!db) {
    console.error("[BarkWebhook] No DB connection — skipping session creation");
    return;
  }

  const now = Date.now();
  const initialHistory = JSON.stringify([
    { role: "assistant", content: introSms, ts: now },
    { role: "assistant", content: schedulingSms, ts: now + 1 },
  ]);

  // Build barkQA summary: include frequency if available
  const barkQASummary = [
    extracted.summary,
    extracted.frequency ? `Frequency: ${extracted.frequency}` : null,
    barkId ? `Bark ID: ${barkId}` : null,
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
      leadSource: "bark",
      barkQA: barkQASummary,
    });
    console.log(`[BarkWebhook] Session created for ${normalizedPhone}`);
  } catch (dbErr) {
    console.error("[BarkWebhook] Failed to create session:", dbErr);
    notifyOwner({
      title: "⚠️ Bark Lead Lost — Session Creation Failed",
      content: `Lead: ${name}\nPhone: ${normalizedPhone}\nError: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}\n\nThis Bark lead was NOT saved to the Leads list.`,
    }).catch(() => {});
  }

  // ── Step 8: Log activity ───────────────────────────────────────────────────
  logActivity({
    eventType: "new_lead",
    title: `New Bark lead: ${name}`,
    body: `${serviceType}${extracted.bedrooms ? ` · ${extracted.bedrooms}` : ""}${extracted.bathrooms ? ` / ${extracted.bathrooms}` : ""} · $${price}`,
    meta: {
      leadPhone: normalizedPhone,
      leadName: name,
      serviceType,
      price,
      source: "bark",
      barkId,
    },
  }).catch(() => {});

  // ── Step 9: Notify owner ───────────────────────────────────────────────────
  notifyOwner({
    title: `New Bark Lead: ${name}`,
    content: `${serviceType}${extracted.bedrooms ? ` · ${extracted.bedrooms}` : ""}${extracted.bathrooms ? ` / ${extracted.bathrooms}` : ""} · $${price}\n\n${extracted.summary}`,
  }).catch(() => {});

  // ── Step 10: Post new lead card to MIB Command Chat ──────────────────────
  try {
    // Look up the session we just created to get its ID
    const [barkSession] = await db
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, normalizedPhone))
      .orderBy(desc(conversationSessions.id))
      .limit(1);
    const barkSessionId = barkSession?.id ?? null;

    const sizeDisplay = `${bedrooms} / ${bathrooms}`;
    const leadBody = `🐶 **Bark Lead** · ${name} · ${normalizedPhone}\n🏠 **${serviceType}** · ${sizeDisplay} · **$${price}**`;
    const metadata = JSON.stringify({
      leadName: name,
      leadPhone: normalizedPhone,
      serviceType,
      size: sizeDisplay,
      price,
      utmSource: "bark",
      sessionId: barkSessionId,
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
    const [barkInserted] = await db.select({ id: opsChatMessages.id }).from(opsChatMessages).orderBy(sql`id DESC`).limit(1);
    console.log(`[LeadAlert] INSERTED (bark) messageId=${barkInserted?.id} channel=command quickAction=new_lead`);
  } catch (err) {
    console.error("[BarkWebhook] Failed to post lead card to command channel:", err);
  }
}

// ── Route Registration ────────────────────────────────────────────────────────

/**
 * Registers POST /api/webhooks/bark on the Express app.
 * Called from webhooks.ts — the only change needed in existing files.
 */
export function registerBarkWebhookRoute(app: Express): void {
  app.post("/api/webhooks/bark", async (req, res) => {
    // Respond immediately — Zapier expects a 200 within a few seconds
    res.status(200).json({ received: true });

    try {
      await handleBarkLead(req.body as BarkZapierPayload);
    } catch (err) {
      console.error("[BarkWebhook] Unhandled error:", err);
    }
  });

  console.log("[BarkWebhook] Route registered: POST /api/webhooks/bark");
}
