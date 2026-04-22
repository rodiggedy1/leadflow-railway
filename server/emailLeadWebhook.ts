/**
 * Email Lead Integration — Zapier Webhook Handler
 *
 * Handles two email types sent via Zapier:
 *
 * 1. FORM SUBMISSION (Gmail label: "LeadFlow Forms")
 *    Zapier trigger: Gmail → New Email matching label "LeadFlow Forms"
 *    Body format:
 *      Email: rohan@innclusive.com
 *      Phone: +1 302 981 6191
 *      Cleaning Type: BiWeekly 0.85
 *      Bedrooms: One 149
 *      Bathrooms: Five 150
 *    Action: Create conversation session + send SMS quote flow
 *
 * 2. PHONE CALL NOTIFICATION (Gmail label: "Google Calls")
 *    Zapier trigger: Gmail → New Email matching label "Google Calls"
 *    Body format:
 *      Hi,
 *      You received a call from:
 *      (858) 776-5144
 *      at
 *      2026-03-21 09:57 AM -04:00
 *    Action: Create a "voice" lead session + send SMS intro
 *
 * Authentication: Both Zapier Zaps send X-Zapier-Secret header with the
 * ZAPIER_WEBHOOK_SECRET env var value. Requests without the correct secret
 * are rejected with 401.
 *
 * Endpoint: POST /api/webhooks/email-lead
 * Zapier sends JSON body with fields: subject, body_plain, body_html, from_email
 */

import type { Express } from "express";
import crypto from "crypto";
import { getDb } from "./db";
import { conversationSessions, opsChatMessages } from "../drizzle/schema";
import { sendSms, estimatePrice } from "./openphone";
import { getNextAvailableSlots, formatAvailabilityQuestion } from "./availability";
import { logActivity } from "./activityLogger";
import { notifyOwner } from "./_core/notification";
import { sendPushToAll } from "./webPush";
import { normalizePhone } from "./routers";
import { getSetting, getFlowTemplate } from "./settingsRouter";
import { ENV } from "./_core/env";
import { and, desc, eq, ne } from "drizzle-orm";

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
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  serviceType: string;
  frequency: string | null;
  rawCleaningType: string | null;
}

/** Unified Zapier webhook payload — fields sent as JSON */
export interface ZapierEmailPayload {
  subject?: string;
  body_plain?: string;
  body_html?: string;
  from_email?: string;
  from_name?: string;
  // Legacy Mailgun field names (kept for backwards compatibility)
  "body-plain"?: string;
  "stripped-text"?: string;
  sender?: string;
  from?: string;
  timestamp?: string;
  token?: string;
  signature?: string;
  [key: string]: unknown;
}

// ── Email type detection ──────────────────────────────────────────────────────

export type EmailType = "form_submission" | "phone_call" | "yelp_inquiry" | "thumbtack_lead" | "unknown";

/**
 * Detects whether an email is a form submission or a Google Voice/Fi call notification.
 *
 * Form submissions contain structured "Phone:", "Cleaning Type:", etc. lines.
 * Call notifications contain the phrase "You received a call from".
 */
export function detectEmailType(body: string, subject?: string, fromAddress?: string): EmailType {
  const bodyLower = body.toLowerCase();
  const subjectLower = (subject ?? "").toLowerCase();

  // Google Voice/Fi call notification
  if (
    bodyLower.includes("you received a call from") ||
    subjectLower.includes("missed call") ||
    subjectLower.includes("received a call")
  ) {
    return "phone_call";
  }

  // Yelp inquiry: sender is Yelp's messaging proxy, or body/subject contains Yelp-specific phrasing
  const fromLower = (fromAddress ?? "").toLowerCase();
  if (
    fromLower.includes("messaging.yelp.com") ||
    fromLower.includes("yelp.com") ||
    subjectLower.startsWith("new lead: reply to") ||
    (bodyLower.includes("reply to") && bodyLower.includes("yelp biz")) ||
    subjectLower.includes("yelp") ||
    bodyLower.includes("yelp.com") ||
    (bodyLower.includes("sent to") && bodyLower.includes("maids in black") && bodyLower.includes("bedroom"))
  ) {
    return "yelp_inquiry";
  }

  // Thumbtack lead: subject contains "New direct lead" or "New lead" from Thumbtack,
  // or sender is from thumbtack.com, or body contains Thumbtack-specific phrasing
  if (
    fromLower.includes("thumbtack.com") ||
    subjectLower.includes("new direct lead") ||
    (subjectLower.includes("new lead") && bodyLower.includes("thumbtack")) ||
    bodyLower.includes("thumbtack.com") ||
    (bodyLower.includes("direct lead") && bodyLower.includes("dates:")) ||
    (bodyLower.includes("travel preferences") && bodyLower.includes("professionals may travel"))
  ) {
    return "thumbtack_lead";
  }

  // Form submission: has at least a Phone field and one of the service fields
  if (
    (bodyLower.includes("phone:") || bodyLower.includes("phone number:")) &&
    (bodyLower.includes("cleaning type:") || bodyLower.includes("service type:") || bodyLower.includes("bedrooms:"))
  ) {
    return "form_submission";
  }

  return "unknown";
}

// ── Phone Call Email Parser ───────────────────────────────────────────────────

/**
 * Parses a Google Voice/Fi call notification email body.
 *
 * Expected format:
 *   Hi,
 *   You received a call from:
 *   (858) 776-5144
 *   at
 *   2026-03-21 09:57 AM -04:00
 *
 * Returns the caller's phone number, or null if not found.
 */
export function parseCallNotificationBody(body: string): { phone: string | null; callTime: string | null } {
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let phone: string | null = null;
  let callTime: string | null = null;
  let foundCallFrom = false;
  let foundAt = false;

  for (const line of lines) {
    const lineLower = line.toLowerCase();

    if (lineLower.includes("you received a call from") || lineLower === "call from:") {
      foundCallFrom = true;
      continue;
    }

    if (foundCallFrom && !phone) {
      // Next non-empty line after "call from:" is the phone number
      // Matches formats: (858) 776-5144, +18587765144, 858-776-5144, etc.
      const cleaned = line.replace(/[^\d+\-\(\)\s]/g, "").trim();
      if (cleaned.length >= 7) {
        phone = cleaned;
        continue;
      }
    }

    if (foundCallFrom && phone && (lineLower === "at" || lineLower.startsWith("at "))) {
      foundAt = true;
      // "at" might have the timestamp on the same line
      const afterAt = line.slice(2).trim();
      if (afterAt.length > 5) {
        callTime = afterAt;
      }
      continue;
    }

    if (foundAt && !callTime) {
      callTime = line;
    }
  }

  return { phone, callTime };
}

// ── Form Submission Email Parser ──────────────────────────────────────────────

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

  const fromWord = WORD_TO_NUMBER[cleaned];
  if (fromWord !== undefined) {
    return fromWord === 1 ? "1 Bedroom" : `${fromWord} Bedrooms`;
  }

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

  const fromWord = WORD_TO_NUMBER[cleaned];
  if (fromWord !== undefined) {
    return fromWord === 1 ? "1 Bathroom" : `${fromWord} Bathrooms`;
  }

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
 * Parses the structured form submission email body into lead fields.
 *
 * Handles the format:
 *   Email: rohan@innclusive.com
 *   Phone: +1 302 981 6191
 *   Cleaning Type: BiWeekly 0.85
 *   Bedrooms: One 149
 *   Bathrooms: Five 150
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

  // Extract email
  const rawEmail =
    fields["email"] ??
    fields["email address"] ??
    fields["e-mail"] ??
    null;

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

  // Extract name fields
  const rawFirstName =
    fields["first name"] ??
    fields["firstname"] ??
    fields["first"] ??
    null;
  const rawLastName =
    fields["last name"] ??
    fields["lastname"] ??
    fields["last"] ??
    null;
  const rawFullName =
    fields["name"] ??
    fields["full name"] ??
    fields["fullname"] ??
    null;

  const { serviceType, frequency } = rawCleaningType
    ? parseCleaningType(rawCleaningType)
    : { serviceType: "Standard Cleaning", frequency: null };

  return {
    phone: rawPhone,
    email: rawEmail,
    firstName: rawFirstName ?? null,
    lastName: rawLastName ?? null,
    fullName: rawFullName ?? null,
    bedrooms: rawBedrooms ? parseBedroomCount(rawBedrooms) : null,
    bathrooms: rawBathrooms ? parseBathroomCount(rawBathrooms) : null,
    serviceType,
    frequency,
    rawCleaningType: rawCleaningType ? stripNumericSuffix(rawCleaningType) : null,
  };
}

// ── Mailgun Signature Verification (legacy, kept for backwards compat) ─────────

export function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string,
  apiKey: string
): boolean {
  if (!apiKey) return true;
  const value = timestamp + token;
  const expected = crypto
    .createHmac("sha256", apiKey)
    .update(value)
    .digest("hex");
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(signature);
  if (expectedBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

// ── Zapier Secret Verification ────────────────────────────────────────────────

/**
 * Verifies the X-Zapier-Secret header against the configured secret.
 * Returns true if:
 *   - No secret is configured (dev mode — allow all)
 *   - The header matches the configured secret
 * Returns false if the secret is configured but the header is missing or wrong.
 */
export function verifyZapierSecret(headerValue: string | undefined, configuredSecret: string): boolean {
  if (!configuredSecret) return true; // dev mode: no secret configured
  if (!headerValue) return false;
  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(configuredSecret);
  const provided = Buffer.from(headerValue);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

// ── SMS Builder ───────────────────────────────────────────────────────────────

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

  return getFlowTemplate("email_lead_intro", fallback, {
    "{firstName}": firstName,
    "{serviceType}": serviceType,
    "{bedrooms}": bedrooms,
    "{bathrooms}": bathrooms,
    "{price}": price,
    "{freqNote}": freqNote,
  });
}

export function buildEmailLeadSchedulingSms(): string {
  const slots = getNextAvailableSlots(2);
  return formatAvailabilityQuestion(slots);
}

// ── Yelp Inquiry Parser ──────────────────────────────────────────────────────

export interface YelpLeadParsed {
  clientName: string | null;
  serviceType: string;
  bedrooms: string | null;
  bathrooms: string | null;
  requestedDate: string | null;
  zipCode: string | null;
}

/**
 * Parses a Yelp inquiry email body.
 *
 * Example format:
 *   You have a new move-in or move-out cleaning request.
 *   Reply to Seattle on Yelp Biz
 *   Sent to Maids in Black
 *
 *   5028 Wisconsin Ave Washington, DC 20016   ← business address, ignore
 *
 *   How many bedrooms are in your home?
 *   1 bedroom
 *
 *   How many bathrooms are in your home?
 *   1 bathroom
 *
 *   When do you require this service?
 *   2026-05-18
 *
 *   In what location do you need the service?
 *   22025
 *
 *   Seattle G.
 */
export function parseYelpLeadBody(body: string, subject?: string): YelpLeadParsed {
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Extract client name: "Reply to <Name> on Yelp Biz"
  let clientName: string | null = null;
  for (const line of lines) {
    const replyMatch = line.match(/^Reply to (.+?) on Yelp Biz/i);
    if (replyMatch) {
      clientName = replyMatch[1].trim();
      break;
    }
  }
  // Fallback: last non-empty line that looks like a name (e.g. "Seattle G.")
  if (!clientName) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (/^[A-Z][a-z]+(\s[A-Z]\.?)?$/.test(l)) {
        clientName = l;
        break;
      }
    }
  }

  // Extract service type from the first line or subject
  let serviceType = "Move-In/Out Cleaning"; // default for Yelp move-in/out
  const firstLine = lines[0]?.toLowerCase() ?? "";
  const subjectLower = (subject ?? "").toLowerCase();
  if (firstLine.includes("deep clean") || subjectLower.includes("deep clean")) {
    serviceType = "Deep Cleaning";
  } else if (firstLine.includes("standard") || subjectLower.includes("standard")) {
    serviceType = "Standard Cleaning";
  } else if (firstLine.includes("move") || subjectLower.includes("move")) {
    serviceType = "Move-In/Out Cleaning";
  } else if (firstLine.includes("office") || subjectLower.includes("office")) {
    serviceType = "Office Cleaning";
  }

  // Parse Q&A pairs: question line followed by answer line
  let bedrooms: string | null = null;
  let bathrooms: string | null = null;
  let requestedDate: string | null = null;
  let zipCode: string | null = null;

  for (let i = 0; i < lines.length - 1; i++) {
    const q = lines[i].toLowerCase();
    const answer = lines[i + 1];

    if (q.includes("how many bedroom")) {
      bedrooms = parseBedroomCount(answer);
      i++;
    } else if (q.includes("how many bathroom")) {
      bathrooms = parseBathroomCount(answer);
      i++;
    } else if (q.includes("when do you require") || q.includes("what date") || q.includes("service date")) {
      requestedDate = answer.trim();
      i++;
    } else if (q.includes("what location") || q.includes("location do you need") || q.includes("zip") || q.includes("area")) {
      // Only treat as zip if the answer looks like a zip code (5 digits)
      if (/^\d{5}(-\d{4})?$/.test(answer.trim())) {
        zipCode = answer.trim();
      }
      i++;
    }
  }

  // Fallback zip: scan all lines for a 5-digit zip that is NOT the business address
  if (!zipCode) {
    // Skip lines that contain the business address keywords
    for (const line of lines) {
      if (
        line.toLowerCase().includes("wisconsin") ||
        line.toLowerCase().includes("washington, dc") ||
        line.toLowerCase().includes("sent to")
      ) continue;
      const zipMatch = line.match(/\b(\d{5})\b/);
      if (zipMatch) {
        zipCode = zipMatch[1];
        break;
      }
    }
  }

  return { clientName, serviceType, bedrooms, bathrooms, requestedDate, zipCode };
}

// ── Handler: Yelp Inquiry ─────────────────────────────────────────────────────

export async function handleYelpInquiryEmail(
  body: string,
  fromAddress: string,
  subject?: string
): Promise<void> {
  console.log(`[YelpLead] Processing Yelp inquiry from: ${fromAddress}`);

  const parsed = parseYelpLeadBody(body, subject);
  console.log(`[YelpLead] Parsed: name=${parsed.clientName}, service=${parsed.serviceType}, bedrooms=${parsed.bedrooms}, bathrooms=${parsed.bathrooms}, date=${parsed.requestedDate}, zip=${parsed.zipCode}`);

  const db = await getDb();
  if (!db) {
    console.error("[YelpLead] No DB connection — skipping");
    return;
  }

  const displayName = parsed.clientName ?? "Yelp Lead";
  const bedroomsDisplay = parsed.bedrooms ?? "Unknown";
  const bathroomsDisplay = parsed.bathrooms ?? "Unknown";
  const dateDisplay = parsed.requestedDate ?? "Not specified";
  const zipDisplay = parsed.zipCode ?? "Not specified";

  // Build Command Chat card body
  const leadBody = [
    `📍 **Yelp Inquiry** · ${displayName}`,
    `🏠 **${parsed.serviceType}** · ${bedroomsDisplay} / ${bathroomsDisplay}`,
    `📅 Requested date: **${dateDisplay}**`,
    `📮 Zip code: **${zipDisplay}**`,
    `⚠️ No phone number — follow up via Yelp Biz to get contact info`,
  ].join("\n");

  const metadata = JSON.stringify({
    leadName: displayName,
    leadPhone: null,
    serviceType: parsed.serviceType,
    size: `${bedroomsDisplay} / ${bathroomsDisplay}`,
    requestedDate: parsed.requestedDate,
    zipCode: parsed.zipCode,
    utmSource: "yelp",
    arrivedAt: Date.now(),
  });

  try {
    await db.insert(opsChatMessages).values({
      cleanerJobId: null,
      channel: "command",
      authorName: "📍 Yelp Lead",
      authorRole: "system",
      body: leadBody,
      mediaUrl: null,
      quickAction: "new_lead",
      metadata,
    });
    console.log(`[YelpLead] Posted Yelp lead card to Command Chat`);
  } catch (err) {
    console.error("[YelpLead] Failed to post lead card:", err);
  }

  // Alert CS team via SMS
  const alertMsg = `📍 New Yelp lead: ${displayName} · ${parsed.serviceType} · ${bedroomsDisplay}/${bathroomsDisplay} · Date: ${dateDisplay} · Zip: ${zipDisplay}\nNo phone — follow up on Yelp Biz`;
  sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[YelpLead] CS alert SMS failed:", err)
  );
  sendSms({ to: SECONDARY_ALERT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[YelpLead] Secondary alert SMS failed:", err)
  );

   notifyOwner({
    title: `New Yelp Lead: ${displayName}`,
    content: `${parsed.serviceType} · ${bedroomsDisplay} / ${bathroomsDisplay}\nDate: ${dateDisplay} · Zip: ${zipDisplay}\n\nNo phone number — follow up via Yelp Biz.`,
  }).catch(() => {});
  void sendPushToAll({
    title: `⭐ New Yelp Lead`,
    body: `${displayName} · ${parsed.serviceType}`,
    tag: `new-lead-yelp-${Date.now()}`,
    url: "/ops-chat",
    playSound: true,
  });
  logActivity({
    eventType: "new_lead",
    title: `New Yelp lead: ${displayName}`,
    body: `${parsed.serviceType} · ${bedroomsDisplay} / ${bathroomsDisplay} · ${dateDisplay}`,
    meta: { leadName: displayName, serviceType: parsed.serviceType, source: "yelp" },
  }).catch(() => {});

  // Create a placeholder session so the lead appears in the Leads list.
  // Use a synthetic phone key since Yelp does not provide a phone number.
  const placeholderPhone = `yelp-${Date.now()}`;
  try {
    await db.insert(conversationSessions).values({
      leadPhone: placeholderPhone,
      leadName: displayName,
      stage: "QUOTE_SENT" as any,
      serviceType: parsed.serviceType ?? null,
      bedrooms: bedroomsDisplay !== "Unknown" ? bedroomsDisplay : null,
      bathrooms: bathroomsDisplay !== "Unknown" ? bathroomsDisplay : null,
      leadSource: "yelp",
      aiMode: 0, // no AI — no phone to SMS
      barkQA: `Requested date: ${dateDisplay}\nZip: ${zipDisplay}`,
    } as any);
    console.log(`[YelpLead] Created placeholder session with phone=${placeholderPhone}`);
  } catch (err) {
    console.error("[YelpLead] Failed to create placeholder session:", err);
    notifyOwner({
      title: "⚠️ Yelp Lead Lost — Session Creation Failed",
      content: `Lead: ${displayName}\nError: ${err instanceof Error ? err.message : String(err)}\n\nThis lead appeared in Command Chat but was NOT saved to the Leads list.`,
    }).catch(() => {});
  }
}

// ── Thumbtack Lead Parser ────────────────────────────────────────────────────

export interface ThumbtackLeadParsed {
  clientName: string | null;
  phone: string | null;
  serviceType: string;
  description: string | null;
  location: string | null;
  requestedDates: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  rooms: string | null;
}

/**
 * Parses a Thumbtack "New direct lead" email body.
 *
 * Example format:
 *   Baiju C.
 *   Direct lead
 *
 *   Carpet Cleaning
 *
 *   Manassas, VA 20110
 *
 *   Dates: Mar 27-29
 *   Open to other dates you suggest
 *
 *   571-xxx-xxxx
 *
 *   I have a town house that needs carpet cleaned...
 *
 *   Number of rooms: 3 rooms
 *   Property type: Two-story house
 *   Cleaning method: Steam cleaning
 */
export function parseThumbtackLeadBody(body: string, subject?: string): ThumbtackLeadParsed {
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Extract name from subject: "🎉 New direct lead! Baiju C."
  let clientName: string | null = null;
  if (subject) {
    const subjectMatch = subject.match(/new direct lead[!.]?\s+(.+)/i);
    if (subjectMatch) {
      clientName = subjectMatch[1].trim();
    }
  }
  // Fallback: first line that looks like a name (e.g. "Baiju C.")
  if (!clientName) {
    for (const line of lines) {
      if (/^[A-Z][a-z]+\s+[A-Z]\.?$/.test(line) || /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(line)) {
        clientName = line;
        break;
      }
    }
  }

  // Extract phone — look for a line that is just a phone number
  let phone: string | null = null;
  for (const line of lines) {
    // Matches: 571-xxx-xxxx, (571) 234-5678, +15712345678, 571 234 5678
    if (/^[\+\(]?[\d\s\-\(\)x]{7,15}$/.test(line.replace(/[^\d\+\-\(\)\s]/g, ''))) {
      const digits = line.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) {
        phone = line;
        break;
      }
    }
  }

  // Extract service type — typically the first short line after "Direct lead"
  let serviceType = "Home Cleaning";
  let foundDirectLead = false;
  for (const line of lines) {
    if (line.toLowerCase() === "direct lead") {
      foundDirectLead = true;
      continue;
    }
    if (foundDirectLead && line.length > 2 && line.length < 60 && !line.includes(":")) {
      // Skip location lines (contain comma + state abbreviation)
      if (!/,\s*[A-Z]{2}/.test(line)) {
        serviceType = line;
        break;
      }
    }
  }

  // Map Thumbtack service names to our canonical service types
  const serviceTypeLower = serviceType.toLowerCase();
  let canonicalServiceType = "Standard Cleaning";
  if (serviceTypeLower.includes("carpet")) {
    canonicalServiceType = "Carpet Cleaning";
  } else if (serviceTypeLower.includes("deep")) {
    canonicalServiceType = "Deep Cleaning";
  } else if (serviceTypeLower.includes("move")) {
    canonicalServiceType = "Move-In/Out Cleaning";
  } else if (serviceTypeLower.includes("office") || serviceTypeLower.includes("commercial")) {
    canonicalServiceType = "Office Cleaning";
  } else if (serviceTypeLower.includes("post") && serviceTypeLower.includes("construct")) {
    canonicalServiceType = "Post Construction Cleaning";
  } else if (serviceTypeLower.includes("standard") || serviceTypeLower.includes("house") || serviceTypeLower.includes("home")) {
    canonicalServiceType = "Standard Cleaning";
  }

  // Extract location — line with ", VA" or ", MD" or ", DC" pattern
  let location: string | null = null;
  for (const line of lines) {
    if (/,\s*[A-Z]{2}\s+\d{5}/.test(line) || /,\s*(VA|MD|DC|Virginia|Maryland)/.test(line)) {
      location = line;
      break;
    }
  }

  // Extract requested dates — line starting with "Dates:"
  let requestedDates: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().startsWith("dates:")) {
      requestedDates = lines[i].replace(/^dates:\s*/i, "").trim();
      // Include the next line if it says "Open to other dates"
      if (i + 1 < lines.length && lines[i + 1].toLowerCase().includes("open to other dates")) {
        requestedDates += " (flexible)";
      }
      break;
    }
  }

  // Extract description — the longest free-text line (not a label:value pair)
  let description: string | null = null;
  for (const line of lines) {
    if (line.includes(":") && line.indexOf(":") < 40) continue; // skip label:value lines
    if (line.toLowerCase() === "direct lead") continue;
    if (line === clientName) continue;
    if (line === serviceType) continue;
    if (line === location) continue;
    if (phone && line.includes(phone.replace(/\D/g, '').slice(0, 6))) continue;
    if (line.length > 30 && !line.match(/^[A-Z][a-z]+\s+[A-Z]\.?$/)) {
      description = line;
      break;
    }
  }

  // Extract structured Q&A fields ("Number of rooms:", "Property type:", etc.)
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0 && colonIdx < 50) {
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();
      if (key && value) fields[key] = value;
    }
  }

  // Bedrooms/bathrooms from structured fields or description
  const rawBedrooms = fields["number of bedrooms"] ?? fields["bedrooms"] ?? fields["bedroom"] ?? null;
  const rawBathrooms = fields["number of bathrooms"] ?? fields["bathrooms"] ?? fields["bathroom"] ?? null;
  const rawRooms = fields["number of rooms"] ?? fields["rooms"] ?? null;

  return {
    clientName,
    phone,
    serviceType: canonicalServiceType,
    description,
    location,
    requestedDates,
    bedrooms: rawBedrooms ? parseBedroomCount(rawBedrooms) : null,
    bathrooms: rawBathrooms ? parseBathroomCount(rawBathrooms) : null,
    rooms: rawRooms,
  };
}

// ── Handler: Thumbtack Lead ───────────────────────────────────────────────────

export async function handleThumbtackEmail(
  body: string,
  fromAddress: string,
  subject?: string
): Promise<void> {
  console.log(`[Thumbtack] Processing Thumbtack lead from: ${fromAddress}`);

  const parsed = parseThumbtackLeadBody(body, subject);
  console.log(`[Thumbtack] Parsed: name=${parsed.clientName}, phone=${parsed.phone}, service=${parsed.serviceType}, location=${parsed.location}`);

  const db = await getDb();
  if (!db) {
    console.error("[Thumbtack] No DB connection — skipping");
    return;
  }

  const displayName = parsed.clientName ?? "Thumbtack Lead";
  const locationDisplay = parsed.location ?? "Not specified";
  const datesDisplay = parsed.requestedDates ?? "Not specified";
  const descDisplay = parsed.description ?? "";
  const roomsDisplay = parsed.rooms ?? null;

  // Normalize phone if present
  const normalizedPhone = parsed.phone ? normalizePhone(parsed.phone) : null;

  const bedrooms = parsed.bedrooms ?? "3 Bedrooms";
  const bathrooms = parsed.bathrooms ?? "2 Bathrooms";

  // ── Silenced services — controlled via Settings page ──────────────────────
  const silencedRaw = await getSetting("silenced_services", "");
  const SILENCED_SERVICES = silencedRaw.split(",").map(s => s.trim()).filter(Boolean);
  if (SILENCED_SERVICES.some(s => parsed.serviceType.toLowerCase().includes(s.toLowerCase()))) {
    console.log(`[EmailLead] Silenced service "${parsed.serviceType}" — dropping lead silently`);
    return;
  }

  const price = estimatePrice({ bedrooms, bathrooms, serviceType: parsed.serviceType });

  const barkQA = [
    `Service: ${parsed.serviceType}`,
    parsed.location ? `Location: ${parsed.location}` : null,
    parsed.requestedDates ? `Dates: ${parsed.requestedDates}` : null,
    parsed.rooms ? `Rooms: ${parsed.rooms}` : null,
    parsed.description ? `Notes: ${parsed.description}` : null,
  ].filter(Boolean).join(" | ");

  let initialHistory: string = "[]"; // default to empty array — messageHistory is NOT NULL

  if (normalizedPhone) {
    const introSms = await buildEmailLeadIntroSms(
      displayName.split(" ")[0],
      parsed.serviceType,
      bedrooms,
      bathrooms,
      price,
      null
    );
    const schedulingSms = buildEmailLeadSchedulingSms();

    const sms1 = await sendSms({ to: normalizedPhone, content: introSms, mediaUrl: MADISON_PHOTO_URL });
    console.log(`[Thumbtack] Intro SMS sent: ${sms1.success}`);

    await new Promise((r) => setTimeout(r, 2000));
    const sms2 = await sendSms({ to: normalizedPhone, content: schedulingSms });
    console.log(`[Thumbtack] Scheduling SMS sent: ${sms2.success}`);

    const now = Date.now();
    initialHistory = JSON.stringify([
      { role: "assistant", content: introSms, ts: now },
      { role: "assistant", content: schedulingSms, ts: now + 1 },
    ]);
  }

  // Always create a session so the lead appears on the Leads page.
  // Use a placeholder phone key when no phone is available (same pattern as Yelp).
  const sessionPhone = normalizedPhone ?? `thumbtack-${Date.now()}`;
  try {
    await db.insert(conversationSessions).values({
      leadPhone: sessionPhone,
      leadName: displayName,
      stage: normalizedPhone ? "AVAILABILITY" : ("QUOTE_SENT" as any),
      quotedPrice: price,
      serviceType: parsed.serviceType,
      bedrooms: parsed.bedrooms,
      bathrooms: parsed.bathrooms,
      messageHistory: initialHistory,
      leadSource: "thumbtack",
      smsFlow: normalizedPhone ? "B" : null,
      aiMode: normalizedPhone ? undefined : 0,
      barkQA,
    } as any);
    console.log(`[Thumbtack] Session created — phone=${sessionPhone}`);
  } catch (dbErr) {
    console.error("[Thumbtack] Failed to create session:", dbErr);
    notifyOwner({
      title: "⚠️ Thumbtack Lead Lost — Session Creation Failed",
      content: `Lead: ${displayName}\nPhone: ${sessionPhone}\nError: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}\n\nThis lead appeared in Command Chat but was NOT saved to the Leads list.`,
    }).catch(() => {});
  }

  // Build Command Chat card
  const cardLines = [
    `📌 **Thumbtack Lead** · ${displayName}${normalizedPhone ? ` · ${normalizedPhone}` : " · No phone"}`,
    `🏠 **${parsed.serviceType}** · ${locationDisplay}`,
    parsed.requestedDates ? `📅 Dates: **${datesDisplay}**` : null,
    roomsDisplay ? `🛏 ${roomsDisplay}` : null,
    descDisplay ? `💬 "${descDisplay.slice(0, 120)}${descDisplay.length > 120 ? "..." : ""}"` : null,
    !normalizedPhone ? `⚠️ No phone number — follow up via Thumbtack` : null,
  ].filter(Boolean).join("\n");

  const metadata = JSON.stringify({
    leadName: displayName,
    leadPhone: normalizedPhone ?? null,
    serviceType: parsed.serviceType,
    location: parsed.location,
    requestedDates: parsed.requestedDates,
    utmSource: "thumbtack",
    arrivedAt: Date.now(),
  });

  try {
    await db.insert(opsChatMessages).values({
      cleanerJobId: null,
      channel: "command",
      authorName: "📌 Thumbtack Lead",
      authorRole: "system",
      body: cardLines,
      mediaUrl: null,
      quickAction: "new_lead",
      metadata,
    });
    console.log(`[Thumbtack] Posted lead card to Command Chat`);
  } catch (err) {
    console.error("[Thumbtack] Failed to post lead card:", err);
  }

  // Alert CS team
  const alertMsg = `📌 New Thumbtack lead: ${displayName}${normalizedPhone ? ` · ${normalizedPhone}` : " (no phone)"} · ${parsed.serviceType} · ${locationDisplay}${datesDisplay !== "Not specified" ? ` · Dates: ${datesDisplay}` : ""}`;
  sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[Thumbtack] CS alert SMS failed:", err)
  );
  sendSms({ to: SECONDARY_ALERT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[Thumbtack] Secondary alert SMS failed:", err)
  );

   notifyOwner({
    title: `New Thumbtack Lead: ${displayName}`,
    content: `${parsed.serviceType} · ${locationDisplay}\nDates: ${datesDisplay}${descDisplay ? `\n\n"${descDisplay.slice(0, 200)}"` : ""}${normalizedPhone ? `\n\nPhone: ${normalizedPhone}` : "\n\nNo phone — follow up via Thumbtack."}`,
  }).catch(() => {});
  void sendPushToAll({
    title: `📌 New Thumbtack Lead`,
    body: `${displayName} · ${parsed.serviceType}`,
    tag: `new-lead-thumbtack-${Date.now()}`,
    url: "/ops-chat",
    playSound: true,
  });
  logActivity({
    eventType: "new_lead",
    title: `New Thumbtack lead: ${displayName}`,
    body: `${parsed.serviceType} · ${locationDisplay} · ${datesDisplay}`,
    meta: { leadName: displayName, leadPhone: normalizedPhone, serviceType: parsed.serviceType, source: "thumbtack" },
  }).catch(() => {});
}

// ── Handler: Form Submission Lead ─────────────────────────────────────────────

export async function handleFormSubmissionEmail(
  body: string,
  fromAddress: string
): Promise<void> {
  console.log(`[EmailLead] Processing form submission from: ${fromAddress}`);

  const parsed = parseEmailLeadBody(body);
  console.log(`[EmailLead] Parsed: phone=${parsed.phone}, email=${parsed.email}, bedrooms=${parsed.bedrooms}, bathrooms=${parsed.bathrooms}, serviceType=${parsed.serviceType}, frequency=${parsed.frequency}`);

  // NEVER drop a form lead due to missing phone — use placeholder and alert
  let normalizedPhone: string;
  if (!parsed.phone) {
    normalizedPhone = `no-phone-form-${Date.now()}`;
    console.warn(`[EmailLead] No phone in form email — using placeholder: ${normalizedPhone}`);
    notifyOwner({
      title: "⚠️ Form Lead — No Phone Number",
      content: `From: ${fromAddress}\nNo phone number found in form submission. Session created with placeholder. Check the form email manually.`,
    }).catch(() => {});
  } else {
    const np = normalizePhone(parsed.phone);
    if (!np) {
      normalizedPhone = `no-phone-form-${Date.now()}`;
      console.warn(`[EmailLead] Could not normalize phone "${parsed.phone}" — using placeholder`);
      notifyOwner({
        title: "⚠️ Form Lead — Unnormalizable Phone",
        content: `From: ${fromAddress}\nRaw phone: ${parsed.phone}\nSession created with placeholder. Check the form email manually.`,
      }).catch(() => {});
    } else {
      normalizedPhone = np;
    }
  }

  const bedrooms = parsed.bedrooms ?? "3 Bedrooms";
  const bathrooms = parsed.bathrooms ?? "2 Bathrooms";
  const serviceType = parsed.serviceType;
  const frequency = parsed.frequency;

  // Build full name for display, first name for SMS greeting
  const parsedFirstName = parsed.firstName ?? parsed.fullName?.split(" ")[0] ?? null;
  const parsedLastName = parsed.lastName ?? (parsed.fullName?.includes(" ") ? parsed.fullName.split(" ").slice(1).join(" ") : null) ?? null;
  const fullName = parsedFirstName && parsedLastName
    ? `${parsedFirstName} ${parsedLastName}`
    : parsedFirstName ?? parsedLastName ?? null;
  const firstName = parsedFirstName ?? "there"; // used only in SMS greeting
  const displayName = fullName ?? (parsed.email ? `Form Lead (${parsed.email})` : "Form Lead");

  const price = estimatePrice({ bedrooms, bathrooms, serviceType });

  const introSms = await buildEmailLeadIntroSms(firstName, serviceType, bedrooms, bathrooms, price, frequency);
  const schedulingSms = buildEmailLeadSchedulingSms();

  // Send SMS #1 (intro + photo)
  const sms1 = await sendSms({ to: normalizedPhone, content: introSms, mediaUrl: MADISON_PHOTO_URL });
  console.log(`[EmailLead] Intro SMS sent: ${sms1.success}`);

  // Send SMS #2 (scheduling) with natural delay
  await new Promise((r) => setTimeout(r, 2000));
  const sms2 = await sendSms({ to: normalizedPhone, content: schedulingSms });
  console.log(`[EmailLead] Scheduling SMS sent: ${sms2.success}`);

  // Alert CS team
  const freqLabel = frequency ? ` (${frequency})` : "";
  const alertMsg = `📧 New Form lead: ${normalizedPhone} — ${serviceType}${freqLabel} · ${bedrooms} / ${bathrooms} · $${price}${parsed.email ? `\nEmail: ${parsed.email}` : ""}`;
  sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[EmailLead] CS alert failed:", err)
  );
  sendSms({ to: SECONDARY_ALERT_NUMBER, content: alertMsg }).catch((err) =>
    console.error("[EmailLead] Secondary alert failed:", err)
  );

  // Create conversation session
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
    parsed.email ? `Email: ${parsed.email}` : null,
    `From: ${fromAddress}`,
  ].filter(Boolean).join(" | ");

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
      smsFlow: "B",
      barkQA: emailSummary,
    });
    console.log(`[EmailLead] Session created for ${normalizedPhone}`);
  } catch (dbErr) {
    console.error("[EmailLead] Failed to create session:", dbErr);
    notifyOwner({
      title: "⚠️ Form Lead Lost — Session Creation Failed",
      content: `Lead: ${displayName}\nPhone: ${normalizedPhone}\nError: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}\n\nThis lead submitted the form but was NOT saved to the Leads list.`,
    }).catch(() => {});
  }

  logActivity({
    eventType: "new_lead",
    title: `New Form lead: ${normalizedPhone}`,
    body: `${serviceType}${freqLabel} · ${bedrooms} / ${bathrooms} · $${price}`,
    meta: { leadPhone: normalizedPhone, leadName: displayName, serviceType, price, source: "email" },
  }).catch(() => {});

  notifyOwner({
    title: `New Form Lead: ${normalizedPhone}`,
    content: `${serviceType}${freqLabel} · ${bedrooms} / ${bathrooms} · $${price}\n\nFrom: ${fromAddress}${parsed.email ? `\nEmail: ${parsed.email}` : ""}`,
  }).catch(() => {});
  void sendPushToAll({
    title: `📝 New Form Lead`,
    body: `${normalizedPhone} · ${serviceType} · $${price}`,
    tag: `new-lead-form-${Date.now()}`,
    url: "/ops-chat",
    playSound: true,
  });
  // ── Post new lead card to MIB Command Chatt ────────────────────────────────
  try {
    // Look up the session we just created to get its ID
    const [emailSession] = await db
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, normalizedPhone))
      .orderBy(desc(conversationSessions.id))
      .limit(1);
    const emailSessionId = emailSession?.id ?? null;

    const freqDisplay = frequency ? ` (${frequency})` : "";
    const leadBody = `📧 **Email/Form Lead** · ${displayName} · ${normalizedPhone}\n🏠 **${serviceType}${freqDisplay}** · ${bedrooms} / ${bathrooms} · **$${price}**`;
    const metadata = JSON.stringify({
      leadName: displayName,
      leadPhone: normalizedPhone,
      serviceType,
      size: `${bedrooms} / ${bathrooms}`,
      price,
      utmSource: "email",
      sessionId: emailSessionId,
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
  } catch (err) {
    console.error("[EmailLead] Failed to post lead card to command channel:", err);
  }
}

// ── Handler: Phone Call Notification ─────────────────────────────────────────

export async function handleCallNotificationEmail(
  body: string,
  fromAddress: string
): Promise<void> {
  console.log(`[EmailLead] Processing call notification from: ${fromAddress}`);

  const { phone: rawPhone, callTime } = parseCallNotificationBody(body);
  console.log(`[EmailLead] Call notification: phone=${rawPhone}, callTime=${callTime}`);

  // NEVER drop a call lead due to missing phone — use placeholder and alert
  let normalizedPhone: string;
  if (!rawPhone) {
    normalizedPhone = `no-phone-call-${Date.now()}`;
    console.warn(`[EmailLead] No phone in call notification — using placeholder: ${normalizedPhone}`);
    notifyOwner({
      title: "⚠️ Call Lead — No Phone Number",
      content: `From: ${fromAddress}\nNo phone number found in call notification. Session created with placeholder. Check the email manually.`,
    }).catch(() => {});
  } else {
    const np = normalizePhone(rawPhone);
    if (!np) {
      normalizedPhone = `no-phone-call-${Date.now()}`;
      console.warn(`[EmailLead] Could not normalize call phone "${rawPhone}" — using placeholder`);
      notifyOwner({
        title: "⚠️ Call Lead — Unnormalizable Phone",
        content: `From: ${fromAddress}\nRaw phone: ${rawPhone}\nSession created with placeholder. Check the email manually.`,
      }).catch(() => {});
    } else {
      normalizedPhone = np;
    }
  }

  // Check if we already have an active session for this number — avoid duplicates
  const db = await getDb();
  if (!db) {
    console.error("[EmailLead] No DB connection");
    return;
  }

  const existingSessions = await db
    .select()
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.leadPhone, normalizedPhone),
        ne(conversationSessions.stage, "DONE" as any)
      )
    )
    .limit(1);

  if (existingSessions.length > 0) {
    console.log(`[EmailLead] Active session already exists for ${normalizedPhone} — skipping call notification lead creation`);
    // Still alert CS so they know someone called
    const alertMsg = `📞 Received call: ${normalizedPhone}${callTime ? ` at ${callTime}` : ""} — active session already exists`;
    sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch(() => {});
    return;
  }

  // Build intro SMS for a voice/call lead
  const introSms = `Hi! This is Madison from Maids in Black 😊 I saw you gave us a call — I'd love to help you get a quote! What type of cleaning are you looking for?`;
  const displayName = "Voice Lead";

  // Send intro SMS
  const sms1 = await sendSms({ to: normalizedPhone, content: introSms, mediaUrl: MADISON_PHOTO_URL });
  console.log(`[EmailLead] Call lead intro SMS sent: ${sms1.success}`);

  // Alert CS
  const alertMsg = `📞 Received call: ${normalizedPhone}${callTime ? ` at ${callTime}` : ""} — intro SMS sent`;
  sendSms({ to: CS_SUPPORT_NUMBER, content: alertMsg }).catch(() => {});
  sendSms({ to: SECONDARY_ALERT_NUMBER, content: alertMsg }).catch(() => {});

  // Create session
  const now = Date.now();
  const initialHistory = JSON.stringify([
    { role: "assistant", content: introSms, ts: now },
  ]);

  try {
    await db.insert(conversationSessions).values({
      leadPhone: normalizedPhone,
      leadName: "Anonymous (Google Ads Call)",
      stage: "WIDGET_SIZING",
      quotedPrice: null,
      serviceType: null,
      bedrooms: null,
      bathrooms: null,
      extras: null,
      messageHistory: initialHistory,
      leadSource: "voice",
      aiMode: 0,
      barkQA: callTime ? `Missed call at: ${callTime}` : "Missed call (time unknown)",
    });
    console.log(`[EmailLead] Voice lead session created for ${normalizedPhone}`);
  } catch (dbErr: any) {
    console.error("[EmailLead] Failed to create voice lead session:", dbErr?.message ?? dbErr);
    notifyOwner({
      title: "⚠️ Inbound Call Lead Lost — Session Creation Failed",
      content: `Phone: ${normalizedPhone}\nError: ${dbErr?.message ?? String(dbErr)}\n\nThis caller was NOT saved to the Leads list.`,
    }).catch(() => {});
  }

  logActivity({
    eventType: "new_lead",
    title: `Received call: ${normalizedPhone}`,
    body: callTime ? `Called at ${callTime}` : "Received call",
    meta: { leadPhone: normalizedPhone, leadName: displayName, source: "voice" },
  }).catch(() => {});

  notifyOwner({
    title: `Received Call: ${normalizedPhone}`,
    content: `Caller: ${normalizedPhone}${callTime ? `\nTime: ${callTime}` : ""}\n\nIntro SMS sent automatically.`,
  }).catch(() => {});

  // ── Post call lead card to MIB Command Chat ──────────────────────────────
  try {
    // Look up the session we just created to get its ID
    const [voiceSession] = await db
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, normalizedPhone))
      .orderBy(desc(conversationSessions.id))
      .limit(1);
    const voiceSessionId = voiceSession?.id ?? null;

    const callTimeDisplay = callTime ? ` at ${callTime}` : "";
    const leadBody = `📞 **Missed Call Lead** · ${normalizedPhone}${callTimeDisplay}\n🤖 Intro SMS sent automatically via Madison`;
    const metadata = JSON.stringify({
      leadPhone: normalizedPhone,
      leadName: "Anonymous (Google Ads Call)",
      serviceType: "Voice",
      utmSource: "voice",
      callTime: callTime ?? null,
      sessionId: voiceSessionId,
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
  } catch (err) {
    console.error("[EmailLead] Failed to post call lead card to command channel:", err);
  }
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

/**
 * Dispatches an inbound Zapier email payload to the correct handler
 * based on the detected email type.
 */
export async function handleEmailLead(payload: ZapierEmailPayload): Promise<void> {
  // Normalize body field: Zapier uses body_plain, Mailgun uses body-plain or stripped-text
  const emailBody =
    payload.body_plain ??
    payload["stripped-text"] ??
    payload["body-plain"] ??
    "";

  const fromAddress = payload.from_email ?? payload.sender ?? payload.from ?? "unknown";
  const subject = payload.subject ?? "";

  console.log(`[EmailLead] New email from: ${fromAddress}, subject: "${subject}"`);
  console.log(`[EmailLead] Body preview: ${emailBody.slice(0, 200)}`);

  const emailType = detectEmailType(emailBody, subject, fromAddress);
  console.log(`[EmailLead] Detected email type: ${emailType}`);

  if (emailType === "form_submission") {
    await handleFormSubmissionEmail(emailBody, fromAddress);
  } else if (emailType === "phone_call") {
    await handleCallNotificationEmail(emailBody, fromAddress);
  } else if (emailType === "yelp_inquiry") {
    await handleYelpInquiryEmail(emailBody, fromAddress, subject);
  } else if (emailType === "thumbtack_lead") {
    await handleThumbtackEmail(emailBody, fromAddress, subject);
  } else {
    console.warn(`[EmailLead] Unknown email type — subject="${subject}", body preview="${emailBody.slice(0, 100)}". Dropping.`);
  }
}

// ── Route Registration ────────────────────────────────────────────────────────

/**
 * Registers POST /api/webhooks/email-lead on the Express app.
 *
 * Authentication: Zapier sends X-Zapier-Secret header.
 * Set ZAPIER_WEBHOOK_SECRET env var to enable verification.
 * Without the env var, all requests are accepted (dev mode).
 *
 * Zapier sends JSON body with fields:
 *   subject, body_plain, from_email, from_name
 */
export function registerEmailLeadWebhookRoute(app: Express): void {
  app.post("/api/webhooks/email-lead", async (req, res) => {
    // Verify Zapier secret before acknowledging
    const zapierSecret = ENV.zapierWebhookSecret;
    const providedSecret = req.headers["x-zapier-secret"] as string | undefined;

    if (!verifyZapierSecret(providedSecret, zapierSecret)) {
      console.warn("[EmailLead] Rejected: invalid or missing X-Zapier-Secret header");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Acknowledge immediately — Zapier expects a 200 within a few seconds
    res.status(200).json({ received: true });

    try {
      const body = req.body as ZapierEmailPayload;
      await handleEmailLead(body);
    } catch (err) {
      console.error("[EmailLead] Unhandled error:", err);
    }
  });

  console.log("[EmailLeadWebhook] Route registered: POST /api/webhooks/email-lead");
}
