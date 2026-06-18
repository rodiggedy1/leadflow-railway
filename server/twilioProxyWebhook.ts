/**
 * twilioProxyWebhook.ts
 *
 * Handles Twilio Proxy callback events.
 * When a proxy call completes with a recording, posts the recording link
 * to the ops chat thread for that job.
 *
 * Route: POST /api/webhooks/twilio-proxy
 * Set this as the callbackUrl on the MIB-Proxy service.
 */

import type { Express } from "express";
import twilio from "twilio";
import { getDb } from "./db";
import { opsChatMessages, cleanerJobs } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";

function getClient() {
  return twilio(ACCOUNT_SID, AUTH_TOKEN);
}

/** Wait for a recording to become available (Twilio takes a few seconds after call ends) */
async function waitForRecording(recordingSid: string, maxAttempts = 8): Promise<string | null> {
  const client = getClient();
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const rec = await client.recordings(recordingSid).fetch();
      if (rec.status === "completed") {
        // Twilio recording URL — use .mp3 format for easy playback
        return `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Recordings/${recordingSid}.mp3`;
      }
    } catch {
      // Not ready yet
    }
  }
  return null;
}

export function registerTwilioProxyWebhookRoute(app: Express) {
  /**
   * Intercept Callback URL — called by Twilio BEFORE each proxy interaction.
   * Returning { record: true } tells Twilio to record the voice call.
   * Must respond within 5 seconds. Always returns 200 so the call is never blocked.
   * Set this as the Intercept Callback URL in Twilio Proxy console.
   */
  app.post("/api/webhooks/twilio-proxy-intercept", (req, res) => {
    const body = req.body as Record<string, string>;
    const interactionType = body.InteractionType; // "message" | "voice"
    console.log("[TwilioProxy] Intercept event:", interactionType, body.SessionUniqueName);
    if (interactionType === "voice") {
      // Tell Twilio to record this call
      res.status(200).json({ record: true });
    } else {
      // SMS/chat — no action needed
      res.status(200).json({});
    }
  });

  app.post("/api/webhooks/twilio-proxy", async (req, res) => {
    // Acknowledge immediately
    res.status(200).send("OK");

    try {
      const body = req.body as Record<string, string>;

      console.log("[TwilioProxy] Callback event:", JSON.stringify(body));

      const interactionType = body.InteractionType; // "message" | "voice"
      const interactionStatus = body.InteractionStatus; // "completed" | "in-progress" etc
      const sessionUniqueName = body.SessionUniqueName; // "job-{cleanerJobId}"
      const recordingSid = body.RecordingSid;
      const callDuration = body.CallDuration; // seconds as string

      // We only care about completed voice calls with a recording
      if (interactionType !== "voice" || interactionStatus !== "completed") return;
      if (!recordingSid) {
        console.log("[TwilioProxy] Voice call completed but no RecordingSid — recording may be disabled");
        return;
      }

      // Parse job ID from session unique name
      const match = sessionUniqueName?.match(/^job-(\d+)$/);
      if (!match) {
        console.log("[TwilioProxy] Could not parse job ID from sessionUniqueName:", sessionUniqueName);
        return;
      }
      const cleanerJobId = parseInt(match[1], 10);

      // Format duration
      const durationSecs = parseInt(callDuration ?? "0", 10);
      const mins = Math.floor(durationSecs / 60);
      const secs = durationSecs % 60;
      const durationLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

      // Wait for recording to be ready
      const recordingUrl = await waitForRecording(recordingSid);
      if (!recordingUrl) {
        console.log("[TwilioProxy] Recording not ready after retries for SID:", recordingSid);
        return;
      }

      // Look up customer name for the message body
      const db = await getDb();
      if (!db) return;

      const [job] = await db
        .select({ customerName: cleanerJobs.customerName })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, cleanerJobId))
        .limit(1);

      const customerName = job?.customerName ?? "Client";

      // Post to ops chat for this job
      await db.insert(opsChatMessages).values({
        cleanerJobId,
        authorName: "System",
        authorRole: "system",
        body: `📞 Call recording — Cleaner ↔ ${customerName} (${durationLabel})`,
        mediaUrl: recordingUrl,
      });

      // Broadcast SSE so the ops chat refreshes
      const { broadcastOpsUpdate } = await import("./sseBroadcast");
      broadcastOpsUpdate("new_message", { jobId: cleanerJobId });

      console.log(`[TwilioProxy] Recording posted to ops chat for job ${cleanerJobId} — ${durationLabel}`);
    } catch (err) {
      console.error("[TwilioProxy] Callback handler error:", err);
    }
  });
}
