/**
 * clientStatusInquiryEngine.ts
 *
 * When a client texts asking about their job status (e.g. "Is the team on the way?",
 * "What time will they arrive?"), this engine:
 *
 *   1. Detects the status-inquiry intent from the inbound text.
 *   2. Looks up today's cleanerJob for that client phone.
 *   3. Sends the client an acknowledgment: "Checking with your team, will text you back shortly."
 *   4. Places a VAPI call to the assigned cleaner asking for their ETA.
 *   5. When the end-of-call-report arrives (handled in vapiWebhook.ts), extracts the
 *      ETA from the transcript via LLM and sends the client the update.
 *
 * Session lifecycle:
 *   CLIENT_STATUS_INQUIRY → CLIENT_STATUS_INQUIRY_DONE
 */

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { normalizePhoneLegacy } from "./utils/phone";
import { getDb } from "./db";
import {
  cleanerJobs,
  cleanerProfiles,
  conversationSessions,
  fieldMgmtCalls,
} from "../drizzle/schema";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";

// ─── Constants ────────────────────────────────────────────────────────────────

const VAPI_API_BASE = "https://api.vapi.ai";
// ROLLBACK: old VAPI-bought number (daily outbound limit): f2f1c044-c70a-4d73-a755-051f8a2a96e4
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "61431a3e-8144-4acd-b394-8f600ec3a473"; // Twilio-backed, no daily cap
const VAPI_OUTBOUND_PHONE_NUMBER = "+12028519290"; // self-call protection

// ─── Status-inquiry detection ─────────────────────────────────────────────────

const STATUS_INQUIRY_PATTERNS = [
  // on the way variants
  /\b(on\s+the\s+way|on\s+their\s+way|on\s+her\s+way|on\s+his\s+way)\b/i,
  // what time / when will they arrive/come/show
  /\b(what\s+time|when\s+will|when\s+are|when\s+is)\b.{0,40}\b(arriv|com|here|show)/i,
  // still coming / still arriving / still on
  /\b(still\s+com|still\s+show|still\s+arriv|still\s+on|still\s+here)\b/i,
  // is/are she/he still arriving / coming
  /\b(is|are)\s+(she|he|they|the\s+team|the\s+cleaner)\s+still\b/i,
  // how long / how much longer
  /\b(how\s+long|how\s+much\s+longer|how\s+much\s+more\s+time)\b/i,
  // ETA
  /\b(eta|e\.t\.a)\b/i,
  // where are/is the team/cleaner/maid/they/she/he
  /\b(where\s+are|where\s+is)\b.{0,40}\b(team|cleaner|maid|they|she|he)\b/i,
  // running late / still coming / still on the way
  /\b(running\s+late|still\s+coming|still\s+on\s+the\s+way)\b/i,
  // is the team / are the cleaners
  /\b(is\s+the\s+team|are\s+the\s+cleaners|is\s+the\s+cleaner)\b/i,
  // any update / status update
  /\b(any\s+update|status\s+update|update\s+on)\b/i,
  // haven't arrived / not here yet / hasn't arrived
  /\b(haven'?t\s+arrived|hasn'?t\s+arrived|not\s+here\s+yet|not\s+arrived)\b/i,
  // expected arrival / arrival time
  /\b(expected\s+arrival|arrival\s+time)\b/i,
];

export function isStatusInquiry(text: string): boolean {
  const t = text.trim();
  return STATUS_INQUIRY_PATTERNS.some((p) => p.test(t));
}

// ─── Today's job lookup ───────────────────────────────────────────────────────

interface TodayJobResult {
  cleanerJobId: number;
  cleanerProfileId: number | null;
  cleanerName: string | null;
  cleanerPhone: string | null; // E.164 if found
  customerName: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
  bookingStatus: string | null;
}

/**
 * Find today's active cleanerJob for a given client phone number (10-digit digits).
 * Returns null if no job found or job is cancelled/completed.
 */
export async function findTodaysJobForClient(fromPhoneDigits: string): Promise<TodayJobResult | null> {
  const db = await getDb();
  if (!db) return null;

  // Today's date in ET as YYYY-MM-DD
  const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const y = etNow.getFullYear();
  const m = String(etNow.getMonth() + 1).padStart(2, "0");
  const d = String(etNow.getDate()).padStart(2, "0");
  const todayStr = `${y}-${m}-${d}`;

  const rows = await db
    .select({
      id: cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      customerName: cleanerJobs.customerName,
      jobAddress: cleanerJobs.jobAddress,
      serviceDateTime: cleanerJobs.serviceDateTime,
      bookingStatus: cleanerJobs.bookingStatus,
    })
    .from(cleanerJobs)
    .where(
      and(
        eq(cleanerJobs.jobDate, todayStr),
        sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') = ${fromPhoneDigits}`
      )
    )
    .limit(1);

  const job = rows[0];
  if (!job) return null;

  // Skip cancelled or completed jobs
  if (job.bookingStatus === "cancelled" || job.bookingStatus === "rescheduled") return null;

  // Look up cleaner phone from cleanerProfiles
  let cleanerPhone: string | null = null;
  if (job.cleanerProfileId) {
    const [profile] = await db
      .select({ phone: cleanerProfiles.phone })
      .from(cleanerProfiles)
      .where(eq(cleanerProfiles.id, job.cleanerProfileId))
      .limit(1);
    if (profile?.phone) {
      // cleanerProfiles.phone is stored as 10 digits — convert to E.164
      cleanerPhone = normalizePhone(profile.phone);
    }
  }

  return {
    cleanerJobId: job.id,
    cleanerProfileId: job.cleanerProfileId,
    cleanerName: job.cleanerName,
    cleanerPhone,
    customerName: job.customerName,
    jobAddress: job.jobAddress,
    serviceDateTime: job.serviceDateTime,
    bookingStatus: job.bookingStatus,
  };
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

// ─── Main trigger function ────────────────────────────────────────────────────

export interface StatusInquiryTriggerResult {
  triggered: boolean;
  reason?: string;
  sessionId?: number;
  vapiCallId?: string;
  cleanerPhone?: string;
}

/**
 * Called from handleCsInboundMessage when a non-cleaner texts the CS line
 * with a status-inquiry message.
 *
 * 1. Detects status-inquiry intent.
 * 2. Finds today's job for the client.
 * 3. Sends acknowledgment SMS to client.
 * 4. Places VAPI call to cleaner.
 * 5. Creates CLIENT_STATUS_INQUIRY session linked to the fieldMgmtCalls row.
 */
export async function tryHandleClientStatusInquiry(params: {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  fromPhone: string; // E.164
  fromPhoneDigits: string; // 10 digits
  clientName: string | null;
  inboundText: string;
}): Promise<StatusInquiryTriggerResult> {
  const { db, fromPhone, fromPhoneDigits, clientName, inboundText } = params;

  // 1. Detect intent
  if (!isStatusInquiry(inboundText)) {
    return { triggered: false, reason: "not_a_status_inquiry" };
  }

  // 2. Find today's job
  const job = await findTodaysJobForClient(fromPhoneDigits);
  if (!job) {
    return { triggered: false, reason: "no_job_today" };
  }

  if (!job.cleanerPhone) {
    return { triggered: false, reason: "no_cleaner_phone" };
  }

  // Self-call protection
  if (job.cleanerPhone === VAPI_OUTBOUND_PHONE_NUMBER) {
    return { triggered: false, reason: "self_call_protection" };
  }

  const clientFirstName = clientName?.split(" ")[0] ?? "there";
  const cleanerFirstName = job.cleanerName?.split(" ")[0] ?? "the team";

  // 3. Send acknowledgment SMS to client FIRST (before DB ops, per skill rules)
  const ackText = `Hi ${clientFirstName}! We're checking in with your team right now and will text you back with an update shortly. 🧹`;
  const ackResult = await sendSms({ to: fromPhone, content: ackText });
  if (!ackResult.success) {
    console.error(`[StatusInquiry] Failed to send ack SMS to ${fromPhone}:`, ackResult.error);
    // Continue anyway — we still want to call the cleaner
  }

  // 4. Create CLIENT_STATUS_INQUIRY session
  const [sessionInsert] = await db.insert(conversationSessions).values({
    leadPhone: fromPhone,
    leadName: clientName ?? null,
    stage: "CLIENT_STATUS_INQUIRY" as any,
    leadSource: "client_status_inquiry",
    aiMode: 1,
    messageHistory: JSON.stringify([
      { role: "user", content: inboundText, ts: Date.now() },
      { role: "assistant", content: ackText, ts: Date.now() },
    ]),
  });
  const sessionId = (sessionInsert as any).insertId as number;

  // 5. Place VAPI call to cleaner
  const script =
    `Hi ${cleanerFirstName}, this is an automated message from Maids in Black. ` +
    `One of your clients is asking about your arrival time for their job today. ` +
    `What time do you expect to arrive at ${job.jobAddress ?? "the client's address"}? ` +
    `Please say your estimated arrival time now.`;

  let vapiCallId: string | null = null;
  try {
    if (!ENV.vapiPrivateKey) {
      console.warn("[StatusInquiry] VAPI_PRIVATE_KEY not set — skipping cleaner call");
    } else {
      const payload = {
        phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
        customer: { number: job.cleanerPhone },
        assistant: {
          name: "StatusInquiryAlert",
          firstMessage: script,
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "You are a brief automated notification system for a cleaning company. " +
                  "Your only goal is to collect the cleaner's ETA. " +
                  "After they give you a time, confirm it back and end the call. " +
                  "Keep the call under 30 seconds.",
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

      const result = await vapiPost("/call", payload) as { id?: string };
      vapiCallId = result?.id ?? null;
      console.log(`[StatusInquiry] VAPI call placed to ${job.cleanerPhone}. Call ID: ${vapiCallId ?? "unknown"}`);
    }
  } catch (err) {
    console.error("[StatusInquiry] VAPI call failed:", err);
  }

  // 6. Store fieldMgmtCalls row linking the call to the session
  if (vapiCallId) {
    await db.insert(fieldMgmtCalls).values({
      cleanerJobId: job.cleanerJobId,
      clientStatusInquirySessionId: sessionId,
      step: "client_status_inquiry",
      vapiCallId,
      calledPhone: job.cleanerPhone,
      outcome: "no_answer", // will be updated by end-of-call webhook
      durationSeconds: 0,
      transcript: null,
      summary: null,
      endedReason: null,
      recordingUrl: null,
    } as any).catch((err: unknown) => {
      console.error("[StatusInquiry] Failed to insert fieldMgmtCalls row:", err);
    });
  }

  return {
    triggered: true,
    sessionId,
    vapiCallId: vapiCallId ?? undefined,
    cleanerPhone: job.cleanerPhone,
  };
}

// ─── ETA extraction from call transcript ─────────────────────────────────────

/**
 * Use LLM to extract the ETA from the cleaner's call transcript.
 * Returns a human-readable ETA string like "around 11:30 AM" or null if not found.
 */
export async function extractEtaFromTranscript(transcript: string): Promise<string | null> {
  if (!transcript || transcript.trim().length < 10) return null;

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You extract arrival time estimates from short phone call transcripts. " +
            "Return ONLY a JSON object with one field: 'eta' (string or null). " +
            "The eta should be a short, natural phrase like '11:30 AM', 'around noon', 'in about 20 minutes', etc. " +
            "If no clear ETA was given, return null.",
        },
        {
          role: "user",
          content: `Extract the ETA from this transcript:\n\n${transcript}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "eta_extraction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              eta: { type: ["string", "null"], description: "The estimated arrival time, or null if not found" },
            },
            required: ["eta"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = (response as any)?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return parsed.eta ?? null;
  } catch (err) {
    console.error("[StatusInquiry] ETA extraction failed:", err);
    return null;
  }
}

/**
 * Called from vapiWebhook.ts when an end-of-call-report arrives for a
 * client_status_inquiry call. Extracts ETA from transcript and sends
 * the client an update SMS.
 */
export async function handleStatusInquiryCallEnd(params: {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  sessionId: number;
  transcript: string | null;
  outcome: string;
  cleanerName: string | null;
}): Promise<void> {
  const { db, sessionId, transcript, outcome, cleanerName } = params;

  // Look up the session to get the client phone
  const [session] = await db
    .select({ leadPhone: conversationSessions.leadPhone, leadName: conversationSessions.leadName })
    .from(conversationSessions)
    .where(eq(conversationSessions.id, sessionId))
    .limit(1);

  if (!session) {
    console.warn(`[StatusInquiry] Session ${sessionId} not found for call-end handler`);
    return;
  }

  const clientPhone = session.leadPhone;
  const clientFirstName = session.leadName?.split(" ")[0] ?? "there";
  const cleanerFirstName = cleanerName?.split(" ")[0] ?? "the team";

  let replyText: string;

  if (outcome === "no_answer" || outcome === "failed" || !transcript) {
    // Cleaner didn't answer — let the client know
    replyText =
      `Hi ${clientFirstName}! We weren't able to reach your team right now, but we're following up. ` +
      `We'll text you as soon as we have an update. Sorry for the wait! 🧹`;
  } else {
    // Try to extract ETA from transcript
    const eta = await extractEtaFromTranscript(transcript);
    if (eta) {
      replyText =
        `Hi ${clientFirstName}! We just spoke with ${cleanerFirstName} — ` +
        `they expect to arrive ${eta}. Thanks for your patience! 🧹`;
    } else {
      // Call connected but couldn't extract a clear ETA
      replyText =
        `Hi ${clientFirstName}! We just checked in with your team — ` +
        `they're on their way and should be there soon. Thanks for your patience! 🧹`;
    }
  }

  // Send reply to client FIRST (per skill rules: SMS before DB update)
  const smsResult = await sendSms({ to: clientPhone, content: replyText });
  if (!smsResult.success) {
    console.error(`[StatusInquiry] Failed to send ETA reply to ${clientPhone}:`, smsResult.error);
  } else {
    console.log(`[StatusInquiry] ETA reply sent to ${clientPhone}: "${replyText}"`);
  }

  // Advance session to DONE
  await db
    .update(conversationSessions)
    .set({ stage: "CLIENT_STATUS_INQUIRY_DONE" as any })
    .where(eq(conversationSessions.id, sessionId))
    .catch((err: unknown) => console.error("[StatusInquiry] Failed to advance session:", err));
}
