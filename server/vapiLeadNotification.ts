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
import { getSetting } from "./settingsRouter";

// ─── Constants ────────────────────────────────────────────────────────────────

const VAPI_API_BASE = "https://api.vapi.ai";

/**
 * The VAPI phone number ID used as the "from" number for outbound calls.
 * Twilio-backed (+1 202-851-9290) — no daily outbound cap.
 * ROLLBACK: old VAPI-bought number (daily limit): f2f1c044-c70a-4d73-a755-051f8a2a96e4
 */
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "61431a3e-8144-4acd-b394-8f600ec3a473"; // Twilio-backed, no daily cap

/**
 * The primary number to call for new-lead alerts (configurable via DB settings).
 */
export const LEAD_ALERT_CALL_NUMBER = "+13029816191"; // 302-981-6191

/**
 * The fixed CS line that ALWAYS receives a call regardless of settings.
 * This is the main business line and cannot be disabled.
 */
const CS_FIXED_CALL_NUMBER = "+12028885362"; // 202-888-5362

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeadAlertDetails {
  /** Lead's first name (title-cased) */
  name: string;
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
 *   "New lead alert from Sarah. Check the lead platform now and respond in the
 *    next 30 seconds. Bonus for most leads closed this month."
 */
export function buildLeadAlertScript(details: LeadAlertDetails): string {
  const { name } = details;
  return (
    `Hi Maids in Black crew, this is a notification. ` +
    `New lead alert from ${name}. ` +
    `Check the lead platform now and respond in the next 30 seconds. ` +
    `Bonus for most leads closed this month. ` +
    `Good luck.`
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
 * Builds the VAPI call payload for a given destination number.
 */
function buildCallPayload(callTo: string, script: string) {
  return {
    phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
    customer: { number: callTo },
    assistant: {
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
              "If the person says anything, simply say 'Got it, good luck!' and end the call.",
          },
        ],
      },
      voice: {
        provider: "11labs",
        voiceId: "EXAVITQu4vr4xnSDxMaL",
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0.3,
        useSpeakerBoost: true,
      },
      maxDurationSeconds: 45,
    },
  };
}

/**
 * Fires outbound VAPI calls to BOTH the configurable alert number AND the
 * fixed CS line (202-888-5362) whenever a new lead arrives.
 *
 * - Silently no-ops outside business hours (7 am – 7 pm ET).
 * - Never throws — logs errors and returns false on failure.
 * - Both calls fire in parallel; failure of one does not block the other.
 *
 * @returns true if at least one call was initiated, false otherwise.
 */
export async function notifyNewLeadViaCall(
  details: LeadAlertDetails
): Promise<boolean> {
  if (!ENV.vapiPrivateKey) {
    console.warn("[VapiAlert] VAPI_PRIVATE_KEY not set — skipping lead call notification");
    return false;
  }

  // Read live settings from DB (falls back to hardcoded defaults if DB unavailable)
  const [enabledStr, phoneFromDb] = await Promise.all([
    getSetting("callAlertEnabled", "true"),
    getSetting("callAlertPhone", LEAD_ALERT_CALL_NUMBER),
  ]);

  if (enabledStr !== "true") {
    console.log("[VapiAlert] Call notification disabled in settings — skipping");
    return false;
  }

  if (!isWithinBusinessHours()) {
    console.log("[VapiAlert] Outside business hours (7am–7pm ET) — skipping call notification");
    return false;
  }

  const primaryNumber = phoneFromDb.trim() || LEAD_ALERT_CALL_NUMBER;
  const script = buildLeadAlertScript(details);

  // Deduplicate: if the configurable number is the same as the fixed CS number,
  // only call once to avoid ringing the same phone twice.
  const numbersToCall = primaryNumber === CS_FIXED_CALL_NUMBER
    ? [CS_FIXED_CALL_NUMBER]
    : [primaryNumber, CS_FIXED_CALL_NUMBER];

  console.log(`[VapiAlert] Placing calls to: ${numbersToCall.join(", ")}`);

  const results = await Promise.allSettled(
    numbersToCall.map(async (num) => {
      const payload = buildCallPayload(num, script);
      const result = await vapiPost("/call", payload) as { id?: string };
      console.log(`[VapiAlert] Call to ${num} initiated. VAPI call ID: ${result?.id ?? "unknown"}`);
      return true;
    })
  );

  const anySucceeded = results.some(r => r.status === "fulfilled");
  const failures = results.filter(r => r.status === "rejected");
  if (failures.length > 0) {
    failures.forEach(f => console.error("[VapiAlert] A call failed:", (f as PromiseRejectedResult).reason));
  }

  return anySucceeded;
}
