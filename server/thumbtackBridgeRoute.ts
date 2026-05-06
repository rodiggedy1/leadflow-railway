/**
 * POST /api/thumbtack/bridge-call
 *
 * Called by the Chrome extension when the user clicks "Send" on a Thumbtack lead.
 * Fires three actions simultaneously:
 *   1. Sends the generated message as an SMS to the lead's phone
 *   2. Places a Vapi outbound call to the office (202-888-5362), then bridges to the lead
 *   3. Returns success so the extension can also inject the message into Thumbtack
 *
 * Auth: requires a valid session cookie (same as agentProcedure).
 */

import type { Express } from "express";
import { getDb } from "./db";
import { conversationSessions } from "../drizzle/schema";
import { eq, like, and, or, isNull, notLike } from "drizzle-orm";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";
import { broadcastOpsUpdate } from "./sseBroadcast";

const VAPI_API_BASE = "https://api.vapi.ai";
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "61431a3e-8144-4acd-b394-8f600ec3a473";
const OFFICE_NUMBER = "+12028885362";

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

export function registerThumbTackBridgeRoute(app: Express) {
  /**
   * POST /api/thumbtack/update-lead-phone
   *
   * Called by the Chrome extension after "Click to show phone number" reveals the real phone.
   * Finds the matching LeadFlow session by:
   *   - leadName matches the Thumbtack display name (e.g. "Mauli D." or "Mauli D")
   *   - leadPhone starts with "thumbtack-" or "no-phone-thumbtack-" (placeholder)
   * Updates the session with the real phone number and full name (if available).
   * Returns the sessionId so the bridge call can be fired with the correct session.
   */
  // Wipe all previously revealed real phones from the DB.
  // Called the moment a new lead is detected — before anything else.
  app.post("/api/thumbtack/clear-previous-phone", async (req, res) => {
    try {
      const db = await getDb();
      if (!db) { res.status(500).json({ error: "Database unavailable" }); return; }
      // Find sessions with a real phone (starts with + or digit — not a placeholder)
      const revealed = await db
        .select({ id: conversationSessions.id, leadName: conversationSessions.leadName })
        .from(conversationSessions)
        .where(
          and(
            notLike(conversationSessions.leadPhone, "thumbtack%"),
            notLike(conversationSessions.leadPhone, "no-phone%"),
            notLike(conversationSessions.leadPhone, "thumbtack-cleared%")
          )
        )
        .limit(20);
      const toWipe = revealed.filter(s => s.leadName); // only real sessions
      for (const s of toWipe) {
        await db
          .update(conversationSessions)
          .set({ leadPhone: `thumbtack-cleared-${Date.now()}` })
          .where(eq(conversationSessions.id, s.id));
        console.log(`[ThumbTackBridge] clear-previous-phone: wiped phone from session ${s.id} ("${s.leadName}")`);
      }
      res.json({ success: true, wiped: toWipe.length });
    } catch (err) {
      console.error("[ThumbTackBridge] clear-previous-phone error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/thumbtack/update-lead-phone", async (req, res) => {
    try {
      const {
        thumbtackName,   // e.g. "Mauli D." — the name shown on the Thumbtack lead page
        fullName,        // e.g. "Mauli Dosi" — full name revealed on Messages page (optional)
        realPhone,       // e.g. "+14105551234" — the real phone number after reveal
      } = req.body as {
        thumbtackName: string;
        fullName?: string;
        realPhone: string;
      };

      if (!thumbtackName || !realPhone) {
        res.status(400).json({ error: "thumbtackName and realPhone are required" });
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "Database unavailable" });
        return;
      }

      // Normalize the real phone to E.164
      const normalizedPhone = realPhone.startsWith("+")
        ? realPhone
        : `+1${realPhone.replace(/\D/g, "")}`;

      // Normalize the thumbtack name for matching:
      // Strip ALL periods so "L. W." and "L W." both become "L W" for LIKE matching
      const nameNormalized = thumbtackName.trim().replace(/\./g, "").replace(/\s+/g, " ").trim();

      // Safety check: if this realPhone is already assigned to an existing session,
      // something is wrong (stale phone from a previous lead). Refuse the update.
      const existing = await db
        .select({ id: conversationSessions.id, leadName: conversationSessions.leadName })
        .from(conversationSessions)
        .where(eq(conversationSessions.leadPhone, normalizedPhone))
        .limit(1);

      if (existing.length > 0) {
        console.warn(`[ThumbTackBridge] REJECTED update-lead-phone — phone ${normalizedPhone} already belongs to session ${existing[0].id} ("${existing[0].leadName}"). Refusing to overwrite.`);
        res.status(409).json({ error: `Phone ${normalizedPhone} is already assigned to session ${existing[0].id} ("${existing[0].leadName}"). Possible stale phone — update rejected.` });
        return;
      }

      // Find the session: leadName matches (with or without trailing period) AND phone is a placeholder OR null
      // Thumbtack leads with no phone get leadPhone=null; those with a placeholder get leadPhone='no-phone-thumbtack-...' or 'thumbtack-...'
      const sessions = await db
        .select()
        .from(conversationSessions)
        .where(
          and(
            like(conversationSessions.leadName, `${nameNormalized}%`),
            or(
              isNull(conversationSessions.leadPhone),
              like(conversationSessions.leadPhone, "thumbtack%"),
              like(conversationSessions.leadPhone, "no-phone%")
            )
          )
        )
        .orderBy(conversationSessions.id)
        .limit(5);

      if (sessions.length === 0) {
        console.warn(`[ThumbTackBridge] No session found for name="${thumbtackName}" with thumbtack placeholder phone`);
        res.status(404).json({ error: `No session found for "${thumbtackName}" with a Thumbtack placeholder phone` });
        return;
      }

      // Pick the most recent session (highest id)
      const session = sessions[sessions.length - 1];

      // Update phone ONLY. Do NOT touch leadName — the session already has the correct name from when it was created.
      await db
        .update(conversationSessions)
        .set({ leadPhone: normalizedPhone })
        .where(eq(conversationSessions.id, session.id));

      console.log(`[ThumbTackBridge] Session ${session.id} updated: phone ${session.leadPhone} → ${normalizedPhone}, name preserved as "${session.leadName}"`);
      broadcastOpsUpdate("phone_update", { leadName: session.leadName ?? "", newPhone: normalizedPhone });

      res.json({
        success: true,
        sessionId: String(session.id),
        leadName: session.leadName,
        leadPhone: normalizedPhone,
      });
    } catch (err) {
      console.error("[ThumbTackBridge] update-lead-phone error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/thumbtack/bridge-call", async (req, res) => {
    try {
      const {
        sessionId,        // LeadFlow session ID (to log the SMS)
        leadPhone,        // Lead's phone number e.g. "+12025551234"
        leadName,         // Lead's first name e.g. "Rohan"
        serviceType,      // e.g. "Move-In/Move-Out Cleaning"
        message,          // The generated wand message to send as SMS
      } = req.body as {
        sessionId?: string;
        leadPhone: string;
        leadName: string;
        serviceType?: string;
        message?: string;
      };

      if (!leadPhone) {
        res.status(400).json({ error: "leadPhone is required" });
        return;
      }

      // Normalize phone
      const normalizedPhone = leadPhone.startsWith("+")
        ? leadPhone
        : `+1${leadPhone.replace(/\D/g, "")}`;

      const results: { sms: boolean; call: boolean; callId?: string; errors: string[] } = {
        sms: false,
        call: false,
        errors: [],
      };

      // ── 1. Send SMS ────────────────────────────────────────────────────────
      try {
        // Only send SMS if a message was provided (phone-reveal-only calls skip SMS)
        if (!message) {
          results.errors.push("SMS skipped — no message provided");
          // Skip to Vapi call
        } else {
          const smsResult = await sendSms({ to: normalizedPhone, content: message });
          results.sms = smsResult.success;
          if (!smsResult.success) {
            results.errors.push(`SMS failed: ${smsResult.error ?? "unknown"}`);
          }
          // Log the SMS to the session thread so it appears in the lead drawer
          if (smsResult.success && sessionId) {
            const db = await getDb();
            if (db) {
              const [session] = await db
                .select({ messageHistory: conversationSessions.messageHistory })
                .from(conversationSessions)
                .where(eq(conversationSessions.id, parseInt(sessionId)))
                .limit(1);
              if (session) {
                const history: Array<{ role: string; content: string }> =
                  JSON.parse(session.messageHistory as unknown as string) ?? [];
                history.push({ role: "assistant", content: message });
                await db
                  .update(conversationSessions)
                  .set({ messageHistory: JSON.stringify(history) })
                  .where(eq(conversationSessions.id, parseInt(sessionId)));
              }
            }
          }
        }
      } catch (err) {
        results.errors.push(`SMS error: ${String(err)}`);
      }

      // ── 2. Vapi conference bridge ──────────────────────────────────────────
      // Step 1: Call the office first with a brief announcement
      // Step 2: When office picks up, Vapi bridges to the lead
      // We use a two-leg approach: call office with a "transfer" assistant that
      // immediately dials the lead once the office answers.
      try {
        const firstName = leadName?.split(" ")[0] ?? leadName ?? "the client";
        const service = serviceType ?? "cleaning";

        const officeScript =
          `You have a new Thumbtack lead — ${firstName} is looking for ${service}. Connecting you now...`;

        const payload = {
          phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
          customer: { number: OFFICE_NUMBER },
          assistant: {
            name: "ThumbTackBridge",
            firstMessage: officeScript,
            model: {
              provider: "openai",
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content:
                    "You are a brief automated bridge system. You have delivered your announcement. " +
                    "Say nothing else — immediately transfer the call to the lead using the transferCall tool.",
                },
              ],
              tools: [
                {
                  type: "transferCall",
                  destinations: [
                    {
                      type: "number",
                      number: normalizedPhone,
                      message: `Connecting you to ${firstName} now...`,
                    },
                  ],
                },
              ],
            },
            voice: {
              provider: "11labs",
              voiceId: "EXAVITQu4vr4xnSDxMaL",
              stability: 0.5,
              similarityBoost: 0.75,
            },
            maxDurationSeconds: 120,
          },
        };

        const callResult = await vapiPost("/call", payload) as { id?: string };
        results.call = true;
        results.callId = callResult?.id;
        console.log(`[ThumbTackBridge] Conference call placed. Office: ${OFFICE_NUMBER}, Lead: ${normalizedPhone}, Vapi call ID: ${callResult?.id}`);
      } catch (err) {
        results.errors.push(`Call error: ${String(err)}`);
        console.error("[ThumbTackBridge] Vapi call failed:", err);
      }

      res.json({
        success: results.sms || results.call,
        sms: results.sms,
        call: results.call,
        callId: results.callId,
        errors: results.errors,
      });
    } catch (err) {
      console.error("[ThumbTackBridge] Unexpected error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
