/**
 * twilioProxy.ts — Twilio Proxy helpers for masked cleaner ↔ client calls.
 *
 * Sessions are keyed by `job-{cleanerJobId}` as the Twilio uniqueName.
 * The cleaner dials their own proxy number → Twilio bridges to the client.
 * Sessions are closed when the job is marked complete.
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

function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Get or create a Twilio Proxy session for a job.
 * Returns the proxy number the CLEANER should dial to reach the client.
 * Cleaner dials their proxy number → Twilio bridges to client's real number.
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

  // Try to fetch an existing session first (idempotent)
  try {
    const existing = await client.proxy.v1
      .services(PROXY_SERVICE_SID)
      .sessions(uniqueName)
      .fetch();

    const participants = await client.proxy.v1
      .services(PROXY_SERVICE_SID)
      .sessions(existing.sid)
      .participants.list();

    // Return the CLEANER's proxy number — the one they dial to reach the client
    const cleanerParticipant = participants.find(p => p.friendlyName === "Cleaner");
    if (cleanerParticipant?.proxyIdentifier) {
      return cleanerParticipant.proxyIdentifier;
    }
    // Session exists but can't find cleaner participant — close and recreate
    await client.proxy.v1.services(PROXY_SERVICE_SID).sessions(existing.sid).remove().catch(() => {});
  } catch {
    // Session doesn't exist yet — create below
  }

  // Create a new session
  const session = await client.proxy.v1
    .services(PROXY_SERVICE_SID)
    .sessions.create({
      uniqueName,
      ttl: 86400,
    });

  // Add cleaner — capture their proxy number (this is what they dial)
  const cleanerParticipant = await client.proxy.v1
    .services(PROXY_SERVICE_SID)
    .sessions(session.sid)
    .participants.create({
      identifier: toE164(cleanerPhone),
      friendlyName: "Cleaner",
    });

  // Add client
  await client.proxy.v1
    .services(PROXY_SERVICE_SID)
    .sessions(session.sid)
    .participants.create({
      identifier: toE164(clientPhone),
      friendlyName: "Client",
    });

  const proxyNumber = cleanerParticipant.proxyIdentifier;
  if (!proxyNumber) {
    await client.proxy.v1.services(PROXY_SERVICE_SID).sessions(session.sid).remove().catch(() => {});
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
