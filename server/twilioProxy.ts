/**
 * twilioProxy.ts — Twilio Proxy helpers for masked cleaner ↔ client calls.
 *
 * Sessions are keyed by `job-{cleanerJobId}` as the Twilio uniqueName.
 * This makes the endpoint idempotent — if the session already exists,
 * Twilio returns it and we just fetch the proxy number. No DB storage needed.
 *
 * Sessions are closed (by uniqueName) when the job is marked complete.
 */

import twilio from "twilio";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const PROXY_SERVICE_SID = process.env.TWILIO_PROXY_SERVICE_SID ?? "";

function getClient() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    throw new Error("Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)");
  }
  return twilio(ACCOUNT_SID, AUTH_TOKEN);
}

/**
 * Normalize a phone number to E.164 format (+1XXXXXXXXXX for US numbers).
 */
function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Get or create a Twilio Proxy session for a job.
 * Returns the proxy number the cleaner should dial to reach the client.
 *
 * Idempotent: if a session with uniqueName `job-{cleanerJobId}` already exists,
 * returns the existing proxy number without creating a new session.
 */
export async function getOrCreateProxySession(
  cleanerJobId: number,
  cleanerPhone: string,
  clientPhone: string
): Promise<string> {
  if (!PROXY_SERVICE_SID) {
    throw new Error("TWILIO_PROXY_SERVICE_SID not configured");
  }

  const client = getClient();
  const uniqueName = `job-${cleanerJobId}`;

  // Try to fetch an existing session first
  let sessionSid: string;
  try {
    const existing = await client.proxy.v1
      .services(PROXY_SERVICE_SID)
      .sessions(uniqueName)
      .fetch();
    sessionSid = existing.sid;

    // Session exists — fetch the cleaner participant's proxyIdentifier
    const participants = await client.proxy.v1
      .services(PROXY_SERVICE_SID)
      .sessions(sessionSid)
      .participants.list();

    const clientParticipant = participants.find(p => p.friendlyName === "Client");
    if (clientParticipant?.proxyIdentifier) {
      return clientParticipant.proxyIdentifier;
    }
    // If we can't find the proxy number, fall through to recreate
  } catch {
    // Session doesn't exist yet — create it below
  }

  // Create a new session
  const session = await client.proxy.v1
    .services(PROXY_SERVICE_SID)
    .sessions.create({
      uniqueName,
      ttl: 86400, // 24h safety TTL; we close manually on job completion
    });

  sessionSid = session.sid;

  // Add cleaner as participant 1
  await client.proxy.v1
    .services(PROXY_SERVICE_SID)
    .sessions(sessionSid)
    .participants.create({
      identifier: toE164(cleanerPhone),
      friendlyName: "Cleaner",
    });

  // Add client as participant 2 — Twilio assigns the proxy number at this point
  const clientParticipant = await client.proxy.v1
    .services(PROXY_SERVICE_SID)
    .sessions(sessionSid)
    .participants.create({
      identifier: toE164(clientPhone),
      friendlyName: "Client",
    });

  const proxyNumber = clientParticipant.proxyIdentifier;
  if (!proxyNumber) {
    // Clean up and surface a clear error
    await client.proxy.v1
      .services(PROXY_SERVICE_SID)
      .sessions(sessionSid)
      .remove()
      .catch(() => {});
    throw new Error("No proxy number available — pool may be exhausted");
  }

  return proxyNumber;
}

/**
 * Close the Twilio Proxy session for a job (by uniqueName).
 * Safe to call even if the session doesn't exist or is already closed.
 */
export async function closeProxySession(cleanerJobId: number): Promise<void> {
  if (!PROXY_SERVICE_SID) return;
  const uniqueName = `job-${cleanerJobId}`;
  try {
    const client = getClient();
    await client.proxy.v1
      .services(PROXY_SERVICE_SID)
      .sessions(uniqueName)
      .remove();
  } catch (err: any) {
    if (err?.status !== 404) {
      console.error("[TwilioProxy] closeProxySession error:", err?.message ?? err);
    }
  }
}
