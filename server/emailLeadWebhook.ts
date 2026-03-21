/**
 * Email Lead Integration — Mailgun Inbound Webhook Handler
 *
 * Flow:
 *  1. Gmail auto-forwards lead emails (from zapiermail.com) to leads@mg.heyeverywhere.com
 *  2. Mailgun receives the email and POSTs to POST /api/webhooks/email-lead
 *  3. We parse the structured email body:
 *       Phone: +1 202 365 6619
 *       Cleaning Type: BiWeekly 0.85
 *       Bedrooms: Two 179
 *       Bathrooms: One 30
 *  4. We price the job, create a conversationSessions row with leadSource="email"
 *  5. We send the same SMS flow as the quote form (smsFlow A or B per settings)
 *  6. We alert the CS team and log the activity
 *
 * Adding a new email source: just add another Gmail forwarding rule to the same
 * Mailgun inbound address — zero code changes needed.
 */

import type { Express } from "express";
import crypto from "crypto";
import { getDb } from "./db";
import { conversationSessions } from "../drizzle/schema";
import { sendSms, estimatePrice } from "./openphone";
import { getNextAvailableSlots, formatAvailabilityQuestion } from "./availability";
import { logActivity } from "./activityLogger";
import { notifyOwner } from "./_core/notification";
import { normalizePhone } from "./routers";
import { getSetting, getFlowTemplate } from "./settingsRouter";
import { ENV } from "./_core/env";

// ── Constants ─────────────────────────────────────────────────────────────────
const CS_SUPPORT_NUMBER = "+12028885362";
const SECONDARY_ALERT_NUMBER = "+13029816191";
const MADISON_PHOTO_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/madison-headshot-SPXr6KHGViveW2LxjwfyqN.png";

// ── Word-to-number map ────────────────────────────────────────────────────────
const WORD_TO_NUMBER: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  studio: 0,
};

// ── Cleaning type → serviceType + frequency map ───────────────────────────────
interface CleaningTypeMapping {
  serviceType: string;
  frequency: string | null;
}

const CLEANING_TYPE_MAP: Record<string, CleaningTypeMapping> = {
  biweekly: { serviceType: "Standard Cleaning", frequency: "Bi-Weekly" },
  "bi-weekly": { serviceType: "Standard Cleaning", frequency: "Bi-Weekly" },
  "bi weekly": { serviceType: "Standard Cleaning", frequency: "Bi-Weekly" },
  weekly: { serviceType: "Standard Cleaning", frequency: "Weekly" },
  monthly: { serviceType: "Standard Cleaning", frequency: "Monthly" },
  "one-time": { serviceType: "Standard Cleaning", frequency: "One-Time" },
  onetime: { serviceType: "Standard Cleaning", frequency: "One-Time" },
  standard: { serviceType: "Standard Cleaning", frequency: null },
  "standard clean": { serviceType: "Standard Cleaning", frequency: null },
  deep: { serviceType: "Deep Cleaning", frequency: null },
  "deep clean": { serviceType: "Deep Cleaning", frequency: null },
  "deep cleaning": { serviceType: "Deep Cleaning", frequency: null },
  "move in": { serviceType: "Move-In/Out Cleaning", frequency: null },
  "move out": { serviceType: "Move-In/Out Cleaning", frequency: null },
  "move in/out": { serviceType: "Move-In/Out Cleaning", frequency: null },
  "move-in": { serviceType: "Move-In/Out Cleaning", frequency: null },
  "move-out": { serviceType: "Move-In/Out Cleaning", frequency: null },
  "move-in/out": { serviceType: "Move-In/Out Cleaning", frequency: null },
  "post construction": { serviceType: "Post Construction Cleaning", frequency: null },
  "post-construction": { serviceType: "Post Construction Cleaning", frequency: null },
  office: { serviceType: "Office Cleaning", frequency: null },
  "office cleaning": { serviceType: "Office Cleaning", frequency: null },
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmailLeadParsed {
  phone: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  serviceType: string;
  frequency: string | null;
  rawCleaningType: string | null;
}

// ── Mailgun Inbound Payload ───────────────────────────────────────────────────

export interface MailgunInboundPayload {
  // Mailgun sends these fields as form-encoded
  recipient?: string;
  sender?: string;
  from?: string;
  subject?: string;
  "body-plain"?: string;
  "body-html"?: string;
  "stripped-text"?: string;
  timestamp?: string;
  token?: string;
  signature?: string;
  // Any other Mailgun fields
  [key: string]: unknown;
}

// ── Email Body Parser ─────────────────────────────────────────────────────────

/**
 * Strips a trailing numeric suffix from a value string.
 * e.g. "BiWeekly 0.85" → "BiWeekly", "Two 179" → "Two", "One 30" → "One"
 * Handles integers and decimals. Leaves strings without numeric suffix unchanged.
 */
export function stripNumericSuffix(value: string): string {
  return value.replace(/\s+\d+(\.\d+)?\s*$/, "").trim();
}

/**
 * Converts a word-form or digit bedroom count to the canonical DB format.
 * e.g. "Two" → "2 Bedrooms", "1" → "1 Bedroom", "Studio" → "Studio"
 */
export function parseBedroomCount(raw: string): string | null {
  const cleaned = stripNumericSuffix(raw).trim().toLowerCase();

  if (cleaned === "studio") return "Studio";

  // Try word-to-number map first
  const fromWord = WORD_TO_NUMBER[cleaned];
  if (fromWord !== undefined) {
    return fromWord === 1 ? "1 Bedroom" : `${fromWord} Bedrooms`;
  }

  // Try parsing as a digit
  const num = parseInt(cleaned, 10);
  if (!isNaN(num) && num >= 0 && num <= 10) {
    if (num === 0) return "Studio";
    return num === 1 ? "1 Bedroom" : `${num} Bedrooms`;
  }

  return null;
}

/**
 * Converts a word-form or digit bathroom count to the canonical DB format.
 * e.g. "One" → "1 Bathroom", "2" → "2 Bathrooms", "1.5" → "1.5 Bathrooms"
 */
export function parseBathroomCount(raw: string): string | null {
  const cleaned = stripNumericSuffix(raw).trim().toLowerCase();

  // Try word-to-number map
  const fromWord = WORD_TO_NUMBER[cleaned];
  if (fromWord !== undefined) {
    return fromWord === 1 ? "1 Bathroom" : `${fromWord} Bathrooms`;
  }

  // Try parsing as a number (supports decimals like 1.5, 2.5)
  const num = parseFloat(cleaned);
  if (!isNaN(num) && num >= 0 && num <= 10) {
    return num === 1 ? "1 Bathroom" : `${num} Bathrooms`;
  }

  return null;
}

/**
 * Maps a cleaning type string (with optional numeric suffix) to serviceType + frequency.
 * e.g. "BiWeekly 0.85" → { serviceType: "Standard Cleaning", frequency: "Bi-Weekly" }
 */
export function parseCleaningType(raw: string): CleaningTypeMapping {
  const cleaned = stripNumericSuffix(raw).trim().toLowerCase();
  return CLEANING_TYPE_MAP[cleaned] ?? { serviceType: "Standard Cleaning", frequency: null };
}

/**
 * Parses the structured email body into lead fields.
 * Handles the format:
 *   Phone: +1 202 365 6619
 *   Cleaning Type: BiWeekly 0.85
 *   Bedrooms: Two 179
 *   Bathrooms: One 30
 *
 * Field names are matched case-insensitively. Extra whitespace is trimmed.
 * Unknown or missing fields fall back to safe defaults.
 */
export function parseEmailLeadBody(body: string): EmailLeadParsed {
  const lines = body.split(/\r?\n/);
  const fields: Record<string, string> = {};

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) {
      fields[key] = value;
    }
  }

  // Extract phone — try multiple field name variants
  const rawPhone =
    fields["phone"] ??
    fields["phone number"] ??
    fields["mobile"] ??
    fields["cell"] ??
    null;

  // Extract cleaning type
  const rawCleaningType =
    fields["cleaning type"] ??
    fields["service type"] ??
    fields["service"] ??
    fields["type"] ??
    null;

  // Extract bedrooms
  const rawBedrooms =
    fields["bedrooms"] ??
    fields["bedroom"] ??
    fields["beds"] ??
    fields["bed"] ??
    null;

  // Extract bathrooms
  const rawBathrooms =
    fields["bathrooms"] ??
    fields["bathroom"] ??
    fields["baths"] ??
    fields["bath"] ??
    null;

  const { serviceType, frequency } = rawCleaningType
    ? parseCleaningType(rawCleaningType)
    : { serviceType: "Standard Cleaning", frequency: null };

  return {
    phone: rawPhone,
    bedrooms: rawBedrooms ? parseBedroomCount(rawBedrooms) : null,
    bathrooms: rawBathrooms ? parseBathroomCount(rawBathrooms) : null,
    serviceType,
    frequency,
    rawCleaningType: rawCleaningType ? stripNumericSuffix(rawCleaningType) : null,
  };
}

// ── Mailgun Signature Verification ───────────────────────────────────────────

/**
 * Verifies the Mailgun webhook signature to prevent spoofed requests.
 * Returns true if valid, false if invalid or if API key is not configured.
 * In development (no key set), skips verification to allow local testing.
 */
export function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string,
  apiKey: string
): boolean {
  if (!apiKey) return true; // dev mode: skip verification
  const value = timestamp + token;
  const expected = crypto
    .createHmac("sha256", apiKey)
    .update(value)
    .digest("hex");
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(signature);
  // timingSafeEqual requires same-length buffers — length mismatch means invalid
  if (expectedBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

// ── SMS Builder ───────────────────────────────────────────────────────────────

/**
 * Builds the intro SMS for an email lead.
 * Uses the same Flow A (Madison) template as the quote form for consistency.
 * References the frequency if it's a recurring service.
 */
export async function buildEmailLeadIntroSms(
  firstName: string,
  serviceType: string,
  bedrooms: string,
  bathrooms: string,
  price: string,
  frequency: string | null
): Promise<string> {
  const freqNote = frequency && frequency !== "One-Time"
    ? ` (${frequency.toLowerCase()} service)`
    : "";
  const fallback = `Hi ${firstName}! Madison here from Maids in Black. Your ${serviceType} quote for a ${bedrooms} bed / ${bathrooms} bath home is $${price}${freqNote} — our fully insured team handles everything. 🏠`;

  return getFlowTemplate("emailFlowA_sms1", fallback, {
    "{firstName}": firstName,
    "{serviceType}": serviceType,
    "{bedrooms}": bedrooms,
    "{bathrooms}": bathrooms,
    "{price}": price,
    "{freqNote}": freqNote,
  });
}

/**
 * Builds the scheduling follow-up SMS for an email lead.
 */
export function buildEmailLeadSchedulingSms(): string {
  const slots = getNextAvailableSlots(2);
  return formatAvailabilityQuestion(slots);
}

// ── Main Handler ──────────────────────────────────────────────────────────────

/**
 * Processes an inbound email lead from Mailgun.
 * Called by the webhook route handler after signature verification.
 */
export async function handleEmailLead(payload: MailgunInboundPayload): Promise<void> {
  // Prefer stripped-text (Mailgun removes quoted replies), fall back to body-plain
  const emailBody = payload["stripped-text"] ?? payload["body-plain"] ?? "";
  const fromAddress = payload.sender ?? payload.from ?? "unknown";

  console.log(`[EmailLead] New email from: ${fromAddress}`);
  console.log(`[EmailLead] Body preview: ${emailBody.slice(0, 200)}`);

  // ── Step 1: Parse the email body ──────────────────────────────────────────
  const parsed = parseEmailLeadBody(emailBody);
  console.log(`[EmailLead] Parsed: phone=${parsed.phone}, bedrooms=${parsed.bedrooms}, bathrooms=${parsed.bathrooms}, serviceType=${parsed.serviceType}, frequency=${parsed.frequency}`);

  if (!parsed.phone) {
    console.error("[EmailLead] No phone number found in email body — dropping lead");
    return;
  }

  const normalizedPhone = normalizePhone(parsed.phone);
  if (!normalizedPhone) {
    console.error(`[EmailLead] Could not normalize phone: ${parsed.phone}`);
    return;
  }

  // ── Step 2: Use parsed data with safe fallbacks ────────────────────────────
  const bedrooms = parsed.bedrooms ?? "3 Bedrooms";
  const bathrooms = parsed.bathrooms ?? "2 Bathrooms";
  const serviceType = parsed.serviceType;
  const frequency = parsed.frequency;

  // Use "Customer" as name since email leads don't include a name field
  const firstName = "there";
  const displayName = "Email Lead";

  // ── Step 3: Price the job ──────────────────────────────────────────────────
  const price = estimatePrice({ bedrooms, bathrooms, serviceType });

  // ── Step 4: Build SMS messages ─────────────────────────────────────────────
  const introSms = await buildEmailLeadIntroSms(
    firstName,
    serviceType,
    bedrooms,
    bathrooms,
    price,
    frequency
  );
  const schedulingSms = buildEmailLeadSchedulingSms();

  // ── Step 5: Send SMS #1 (intro + photo) ───────────────────────────────────
  const sms1 = await sendSms({
    to: normalizedPhone,
    content: introSms,
    mediaUrl: MADISON_PHOTO_URL,
  });
  console.log(`[EmailLead] Intro SMS sent: ${sms1.success}`);

  // ── Step 6: Send SMS #2 (scheduling) with natural delay ───────────────────
  await new Promise((r) => setTimeout(r, 2000));
  const sms2 = await sendSms({ to: normalizedPhone, content: schedulingSms });
  console.log(`[EmailLead] Scheduling SMS sent: ${sms2.success}`);

  // ── Step 7: Alert CS team ──────────────────────────────────────────────────
  const freqLabel = frequency ? ` (${frequency})` : "";
  const alertMsg = `📧 New Email lead: ${normalizedPhone} — ${serviceType}${freqLabel} · ${bedrooms} / ${bathrooms} · $${price}`;
  sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[EmailLead] CS alert failed:", err)
  );
  sendSms({ to: SECONDARY_ALERT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[EmailLead] Secondary alert failed:", err)
  );

  // ── Step 8: Create conversation session ───────────────────────────────────
  const db = await getDb();
  if (!db) {
    console.error("[EmailLead] No DB connection — skipping session creation");
    return;
  }

  const now = Date.now();
  const initialHistory = JSON.stringify([
    { role: "assistant", content: introSms, ts: now },
    { role: "assistant", content: schedulingSms, ts: now + 1 },
  ]);

  const emailSummary = [
    parsed.rawCleaningType ? `Cleaning Type: ${parsed.rawCleaningType}` : null,
    frequency ? `Frequency: ${frequency}` : null,
    `From: ${fromAddress}`,
  ]
    .filter(Boolean)
    .join(" | ");

  try {
    await db.insert(conversationSessions).values({
      leadPhone: normalizedPhone,
      leadName: displayName,
      stage: "AVAILABILITY",
      quotedPrice: price,
      serviceType,
      bedrooms,
      bathrooms,
      messageHistory: initialHistory,
      leadSource: "email",
      barkQA: emailSummary, // reuse barkQA column for email summary notes
    });
    console.log(`[EmailLead] Session created for ${normalizedPhone}`);
  } catch (dbErr) {
    console.error("[EmailLead] Failed to create session:", dbErr);
  }

  // ── Step 9: Log activity ───────────────────────────────────────────────────
  logActivity({
    eventType: "new_lead",
    title: `New Email lead: ${normalizedPhone}`,
    body: `${serviceType}${freqLabel} · ${bedrooms} / ${bathrooms} · $${price}`,
    meta: {
      leadPhone: normalizedPhone,
      leadName: displayName,
      serviceType,
      price,
      source: "email",
    },
  }).catch(() => {});

  // ── Step 10: Notify owner ──────────────────────────────────────────────────
  notifyOwner({
    title: `New Email Lead: ${normalizedPhone}`,
    content: `${serviceType}${freqLabel} · ${bedrooms} / ${bathrooms} · $${price}\n\nFrom: ${fromAddress}`,
  }).catch(() => {});
}

// ── Route Registration ────────────────────────────────────────────────────────

/**
 * Registers POST /api/webhooks/email-lead on the Express app.
 * Called from webhooks.ts.
 *
 * Mailgun sends inbound email data as multipart/form-data or
 * application/x-www-form-urlencoded — Express body-parser handles both.
 *
 * Signature verification uses MAILGUN_WEBHOOK_SIGNING_KEY (from Mailgun dashboard
 * → Settings → Webhooks → HTTP webhook signing key).
 */
export function registerEmailLeadWebhookRoute(app: Express): void {
  app.post("/api/webhooks/email-lead", async (req, res) => {
    // Respond immediately — Mailgun expects a 200 within a few seconds
    res.status(200).json({ received: true });

    try {
      const body = req.body as MailgunInboundPayload;

      // ── Signature verification ──────────────────────────────────────────
      const signingKey = ENV.mailgunWebhookSigningKey ?? "";
      const timestamp = String(body.timestamp ?? "");
      const token = String(body.token ?? "");
      const signature = String(body.signature ?? "");

      if (signingKey && timestamp && token && signature) {
        const valid = verifyMailgunSignature(timestamp, token, signature, signingKey);
        if (!valid) {
          console.error("[EmailLead] Invalid Mailgun signature — dropping request");
          return;
        }
      } else if (signingKey) {
        // Key is set but signature fields are missing — suspicious, drop it
        console.warn("[EmailLead] Mailgun signature fields missing — dropping request");
        return;
      }

      await handleEmailLead(body);
    } catch (err) {
      console.error("[EmailLead] Unhandled error:", err);
    }
  });

  console.log("[EmailLeadWebhook] Route registered: POST /api/webhooks/email-lead");
}
