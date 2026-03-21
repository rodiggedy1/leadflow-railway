/**
 * vapiLeadNotification.ts
 *
 * Fires an outbound VAPI call to the CS team whenever a new lead arrives.
 * Uses a simple TTS assistant (no tools, no AI conversation) to read a
 * short alert script and hang up.
 *
 * Business hours guard: only calls between 7 am – 7 pm ET.
 * Test number: 302-981-6191  (switch to 202-888-5362 for CS team)
 */

import { ENV } from "./_core/env";

// ─── Constants ────────────────────────────────────────────────────────────────

const VAPI_API_BASE = "https://api.vapi.ai";

/**
 * The VAPI phone number ID used as the "from" number for outbound calls.
 * Discovered via GET /phone-number — +1 (934) 789-8077.
 */
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "f2f1c044-c70a-4d73-a755-051f8a2a96e4";

/**
 * The number to call for new-lead alerts.
 * Currently set to the test number; change to CS team when ready.
 */
export const LEAD_ALERT_CALL_NUMBER = "+13029816191"; // test: 302-981-6191

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeadAlertDetails {
  name: string;
  city?: string;
  serviceType: string;
  bedrooms: string;
  bathrooms: string;
}

// ─── Business hours helper ────────────────────────────────────────────────────

/**
 * Returns true if the current time is within 7 am – 7 pm Eastern Time.
 * Uses the Intl API so it works regardless of server timezone.
 */
export function isWithinBusinessHours(now: Date = new Date()): boolean {
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  const hour = parseInt(etFormatter.format(now), 10);
  // 7 (7:00 am) inclusive → 18 (6:59 pm) inclusive; 19 (7:00 pm) is excluded
  return hour >= 7 && hour < 19;
}

// ─── Script builder ───────────────────────────────────────────────────────────

/**
 * Builds the TTS alert script read to the CS team member who picks up.
 *
 * Example output:
 *   "New lead alert. Sarah from Washington D.C. requested a standard cleaning
 *    for 3 bedrooms, 2 bathrooms. Claim it in Heyjade and call right away."
 */
export function buildLeadAlertScript(details: LeadAlertDetails): string {
  const { name, city, serviceType, bedrooms, bathrooms } = details;

  // Normalize bedroom/bathroom labels for natural speech
  const bedroomLabel = bedrooms === "1" ? "1 bedroom" : `${bedrooms} bedrooms`;
  const bathroomLabel = bathrooms === "1" ? "1 bathroom" : `${bathrooms} bathrooms`;

  const locationPart = city ? ` from ${city}` : "";

  return (
    `New lead alert. ${name}${locationPart} requested a ${serviceType} ` +
    `for ${bedroomLabel}, ${bathroomLabel}. ` +
    `Claim it in Heyjade and call right away.`
  );
}

// ─── VAPI call helper ─────────────────────────────────────────────────────────

async function vapiPost(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${VAPI_API_BASE}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${ENV.vapiPrivateKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`VAPI POST ${path} → ${res.status}: ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fires an outbound VAPI call to LEAD_ALERT_CALL_NUMBER with a TTS alert.
 *
 * - Silently no-ops outside business hours (7 am – 7 pm ET).
 * - Never throws — logs errors and returns false on failure.
 *
 * @returns true if the call was initiated, false otherwise.
 */
export async function notifyNewLeadViaCall(
  details: LeadAlertDetails
): Promise<boolean> {
  if (!ENV.vapiPrivateKey) {
    console.warn("[VapiAlert] VAPI_PRIVATE_KEY not set — skipping lead call notification");
    return false;
  }

  if (!isWithinBusinessHours()) {
    console.log("[VapiAlert] Outside business hours (7am–7pm ET) — skipping call notification");
    return false;
  }

  const script = buildLeadAlertScript(details);
  console.log(`[VapiAlert] Placing call to ${LEAD_ALERT_CALL_NUMBER} with script: "${script}"`);

  try {
    const callPayload = {
      phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
      customer: {
        number: LEAD_ALERT_CALL_NUMBER,
      },
      assistant: {
        // One-shot TTS assistant: reads the script and hangs up
        name: "LeadAlert",
        firstMessage: script,
        model: {
          provider: "openai",
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a brief automated notification system. " +
                "You have already delivered your message. " +
                "If the person says anything, simply say 'Thank you, goodbye.' and end the call.",
            },
          ],
        },
        voice: {
          provider: "11labs",
          voiceId: "burt", // neutral, clear voice for alerts
        },
        endCallMessage: "Thank you, goodbye.",
        endCallPhrases: ["goodbye", "thanks", "ok", "got it", "thank you"],
        maxDurationSeconds: 60,
      },
    };

    const result = await vapiPost("/call", callPayload) as { id?: string };
    console.log(`[VapiAlert] Call initiated. VAPI call ID: ${result?.id ?? "unknown"}`);
    return true;
  } catch (err) {
    console.error("[VapiAlert] Failed to place lead alert call:", err);
    return false;
  }
}
