/**
 * escalationEngine.ts
 *
 * 8 PM ET escalation: for any cleaner who still hasn't confirmed their schedule
 * after the 5 PM SMS and 7 PM nudge, place a VAPI call asking them to confirm.
 *
 * If they confirm verbally on the call → mark all their tomorrow jobs as confirmed.
 * If they don't answer or don't confirm → post a Command Chat card flagging them
 * for a manual follow-up call.
 *
 * This module is called by the /api/cron/schedule-escalation endpoint in cronSync.ts.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "./db";
import {
  cleanerJobs,
  cleanerProfiles,
  fieldMgmtCalls,
  opsChatMessages,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

// ─── Constants ────────────────────────────────────────────────────────────────

const VAPI_API_BASE = "https://api.vapi.ai";
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "f2f1c044-c70a-4d73-a755-051f8a2a96e4";
const VAPI_OUTBOUND_PHONE_NUMBER = "+19347898077"; // self-call protection

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EscalationResult {
  date: string;
  totalUnconfirmed: number;
  called: number;
  skipped: number; // no phone or self-call protection
  errors: number;
}

interface UnconfirmedCleaner {
  profileId: number;
  name: string;
  phone: string;
  jobIds: number[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTomorrowEt(): string {
  const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  etNow.setDate(etNow.getDate() + 1);
  return `${etNow.getFullYear()}-${String(etNow.getMonth() + 1).padStart(2, "0")}-${String(etNow.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  } catch {
    return dateStr;
  }
}

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

// ─── Get unconfirmed cleaners for tomorrow ────────────────────────────────────

async function getUnconfirmedCleaners(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  targetDate: string
): Promise<UnconfirmedCleaner[]> {
  // Get all active jobs for tomorrow with a cleaner assigned but not confirmed
  const jobs = await db
    .select({
      id: cleanerJobs.id,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      scheduleConfirmed: cleanerJobs.scheduleConfirmed,
      bookingStatus: cleanerJobs.bookingStatus,
    })
    .from(cleanerJobs)
    .where(
      and(
        eq(cleanerJobs.jobDate, targetDate),
        eq(cleanerJobs.scheduleConfirmed, 0)
      )
    );

  // Filter active jobs with assigned cleaners
  const activeUnconfirmed = jobs.filter(
    (j) =>
      j.cleanerProfileId !== null &&
      j.bookingStatus !== "cancelled" &&
      j.bookingStatus !== "rescheduled"
  );

  if (activeUnconfirmed.length === 0) return [];

  // Get unique profile IDs
  const profileIds = Array.from(new Set(activeUnconfirmed.map((j) => j.cleanerProfileId!)));

  // Fetch phone numbers
  const profiles = await db
    .select({ id: cleanerProfiles.id, phone: cleanerProfiles.phone, name: cleanerProfiles.name })
    .from(cleanerProfiles)
    .where(
      profileIds.length === 1
        ? eq(cleanerProfiles.id, profileIds[0])
        : or(...profileIds.map((id) => eq(cleanerProfiles.id, id)))!
    );

  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  // Group jobs by cleaner
  const cleanerMap = new Map<number, UnconfirmedCleaner>();
  for (const job of activeUnconfirmed) {
    if (!job.cleanerProfileId) continue;
    const profile = profileMap.get(job.cleanerProfileId);
    if (!profile?.phone) continue; // skip cleaners with no phone

    if (!cleanerMap.has(job.cleanerProfileId)) {
      cleanerMap.set(job.cleanerProfileId, {
        profileId: job.cleanerProfileId,
        name: profile.name ?? job.cleanerName ?? `Cleaner #${job.cleanerProfileId}`,
        phone: profile.phone,
        jobIds: [],
      });
    }
    cleanerMap.get(job.cleanerProfileId)!.jobIds.push(job.id);
  }

  return Array.from(cleanerMap.values());
}

// ─── Place escalation call ────────────────────────────────────────────────────

async function placeEscalationCall(
  cleaner: UnconfirmedCleaner,
  targetDate: string
): Promise<{ success: boolean; vapiCallId?: string; reason?: string }> {
  if (!ENV.vapiPrivateKey) {
    return { success: false, reason: "VAPI_PRIVATE_KEY not configured" };
  }

  const normalizedPhone = cleaner.phone.startsWith("+")
    ? cleaner.phone
    : `+1${cleaner.phone.replace(/\D/g, "")}`;

  // Self-call protection
  if (normalizedPhone === VAPI_OUTBOUND_PHONE_NUMBER) {
    return { success: false, reason: "Self-call protection triggered" };
  }

  const firstName = cleaner.name.split(" ")[0] ?? cleaner.name;
  const dateLabel = formatDateLabel(targetDate);

  const script =
    `Hi ${firstName}, this is an automated message from Maids in Black. ` +
    `We still need you to confirm your schedule for ${dateLabel}. ` +
    `Please say "confirm" or press 1 to confirm you'll be there, ` +
    `or call the office if you have any questions. Thank you!`;

  const payload = {
    phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
    customer: { number: normalizedPhone },
    assistant: {
      name: "ScheduleEscalation",
      firstMessage: script,
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              `You are a brief automated scheduling confirmation system for Maids in Black. ` +
              `Your only job is to get the cleaner to confirm their schedule for ${dateLabel}. ` +
              `If they say "yes", "confirm", "I'll be there", "ok", or anything affirmative, ` +
              `say "Great, you're all confirmed! See you ${dateLabel}." and end the call. ` +
              `If they say they can't make it or have questions, say ` +
              `"Please call the office right away so we can sort this out. Have a good night." and end the call. ` +
              `Keep responses very short. End the call after one exchange.`,
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
      metadata: {
        step: "schedule_escalation",
        cleanerProfileId: cleaner.profileId,
        cleanerName: cleaner.name,
        targetDate,
        jobIds: cleaner.jobIds,
      },
    },
  };

  try {
    const result = (await vapiPost("/call", payload)) as { id?: string };
    const vapiCallId = result?.id ?? null;
    console.log(
      `[Escalation] Call placed to ${cleaner.name} (${normalizedPhone}). VAPI ID: ${vapiCallId ?? "unknown"}`
    );
    return { success: true, vapiCallId: vapiCallId ?? undefined };
  } catch (err) {
    console.error(`[Escalation] Failed to call ${cleaner.name}:`, err);
    return { success: false, reason: String(err) };
  }
}

// ─── Post Command Chat card for non-responders ────────────────────────────────

async function postEscalationCard(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  cleaner: UnconfirmedCleaner,
  targetDate: string,
  reason: "no_answer" | "call_failed"
) {
  const dateLabel = formatDateLabel(targetDate);
  const emoji = reason === "no_answer" ? "📵" : "⚠️";
  const reasonLabel = reason === "no_answer" ? "Did not answer" : "Call failed";

  const body =
    `${emoji} Schedule not confirmed — ${cleaner.name}\n` +
    `${reasonLabel} after 8 PM escalation call.\n` +
    `Schedule date: ${dateLabel}\n` +
    `Jobs: ${cleaner.jobIds.length}\n` +
    `Please call ${cleaner.name} manually to confirm.`;

  await db.insert(opsChatMessages).values({
    channel: "command",
    authorName: "Ops Bot",
    authorRole: "system",
    body,
    quickAction: "schedule_escalation_flag" as any,
    metadata: JSON.stringify({
      cleanerProfileId: cleaner.profileId,
      cleanerName: cleaner.name,
      cleanerPhone: cleaner.phone,
      targetDate,
      jobIds: cleaner.jobIds,
      reason,
    }),
  });

  const { broadcastOpsUpdate } = await import("./sseBroadcast");
  broadcastOpsUpdate("new_message", { channel: "command" });

  console.log(`[Escalation] Posted Command Chat card for ${cleaner.name} (${reason})`);
}

// ─── Main escalation runner ───────────────────────────────────────────────────

/**
 * Called by the 8 PM ET cron. Calls all unconfirmed cleaners via VAPI.
 * Posts a Command Chat card for any cleaner who doesn't answer.
 *
 * Note: The VAPI end-of-call-report webhook handles the "confirmed verbally"
 * path — it marks jobs confirmed and skips the card in that case.
 */
export async function runEscalationCalls(
  targetDateOverride?: string
): Promise<EscalationResult> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const targetDate = targetDateOverride ?? getTomorrowEt();
  const unconfirmed = await getUnconfirmedCleaners(db, targetDate);

  console.log(
    `[Escalation] Running 8 PM escalation for ${targetDate}: ${unconfirmed.length} unconfirmed cleaners`
  );

  let called = 0;
  let skipped = 0;
  let errors = 0;

  for (const cleaner of unconfirmed) {
    const result = await placeEscalationCall(cleaner, targetDate);

    if (!result.success) {
      if (result.reason?.includes("Self-call") || result.reason?.includes("not configured")) {
        skipped++;
      } else {
        errors++;
        // Post a card immediately since the call itself failed
        await postEscalationCard(db, cleaner, targetDate, "call_failed").catch(() => {});
      }
      continue;
    }

    called++;

    // Store in fieldMgmtCalls so the end-of-call webhook can update it
    if (result.vapiCallId) {
      await db
        .insert(fieldMgmtCalls)
        .values({
          cleanerJobId: cleaner.jobIds[0], // primary job
          step: "schedule_escalation",
          vapiCallId: result.vapiCallId,
          calledPhone: cleaner.phone.startsWith("+")
            ? cleaner.phone
            : `+1${cleaner.phone.replace(/\D/g, "")}`,
          outcome: "no_answer", // will be updated by end-of-call webhook
          durationSeconds: 0,
          transcript: null,
          summary: null,
          endedReason: null,
          recordingUrl: null,
        })
        .catch((err: unknown) => {
          console.error("[Escalation] Failed to insert fieldMgmtCalls row:", err);
        });
    }

    // Small delay between calls to avoid rate limiting
    await new Promise((r) => setTimeout(r, 1_000));
  }

  return {
    date: targetDate,
    totalUnconfirmed: unconfirmed.length,
    called,
    skipped,
    errors,
  };
}

// ─── Handle end-of-call webhook for escalation calls ─────────────────────────

/**
 * Called from vapiWebhook.ts when an end-of-call-report arrives for a
 * schedule_escalation call.
 *
 * If the transcript shows the cleaner confirmed → mark all their tomorrow jobs
 * as confirmed and skip the Command Chat card.
 *
 * If they didn't confirm or didn't answer → post the Command Chat card.
 */
export async function handleEscalationCallEnd(params: {
  vapiCallId: string;
  transcript: string | null;
  endedReason: string | null;
  metadata: {
    cleanerProfileId?: number;
    cleanerName?: string;
    cleanerPhone?: string;
    targetDate?: string;
    jobIds?: number[];
  };
}): Promise<void> {
  const { transcript, endedReason, metadata } = params;
  const { cleanerProfileId, cleanerName, targetDate, jobIds } = metadata;

  if (!cleanerProfileId || !targetDate || !jobIds?.length) {
    console.warn("[Escalation] handleEscalationCallEnd: missing metadata, skipping");
    return;
  }

  const db = await getDb();
  if (!db) return;

  // Detect verbal confirmation in transcript
  const CONFIRM_PATTERNS = [
    /\bconfirm(ed)?\b/i,
    /\byes\b/i,
    /\bi('ll| will) be there\b/i,
    /\bsounds good\b/i,
    /\bno problem\b/i,
    /\bok(ay)?\b/i,
    /\bsure\b/i,
    /\bof course\b/i,
    /\bgot it\b/i,
    /\bwill do\b/i,
  ];

  const confirmedVerbally =
    transcript != null &&
    CONFIRM_PATTERNS.some((p) => p.test(transcript));

  const noAnswer =
    !confirmedVerbally &&
    (endedReason === "no-answer" ||
      endedReason === "customer-did-not-answer" ||
      endedReason === "voicemail" ||
      (transcript ?? "").trim().length < 20);

  if (confirmedVerbally) {
    // Mark all tomorrow jobs for this cleaner as confirmed
    await db
      .update(cleanerJobs)
      .set({ scheduleConfirmed: 1 })
      .where(
        and(
          eq(cleanerJobs.cleanerProfileId, cleanerProfileId),
          eq(cleanerJobs.jobDate, targetDate)
        )
      );
    console.log(
      `[Escalation] ${cleanerName} confirmed verbally on escalation call. Jobs marked confirmed.`
    );

    // Check if all cleaners are now confirmed → post ops summary
    const { allCleanersConfirmedForDate, postOpsSummary } = await import("./opsSummaryEngine");
    const allDone = await allCleanersConfirmedForDate(targetDate);
    if (allDone) {
      await postOpsSummary(targetDate).catch((err) =>
        console.error("[Escalation] Failed to post ops summary after verbal confirm:", err)
      );
    }
    return;
  }

  // Not confirmed — post Command Chat card
  const cleaner: UnconfirmedCleaner = {
    profileId: cleanerProfileId,
    name: cleanerName ?? `Cleaner #${cleanerProfileId}`,
    phone: metadata.cleanerPhone ?? "",
    jobIds,
  };

  await postEscalationCard(db, cleaner, targetDate, noAnswer ? "no_answer" : "no_answer");
}

// ─── Exported pure helpers for unit testing ───────────────────────────────────
/** Verbal confirmation patterns (same as used in handleEscalationCallEnd) */
export const ESCALATION_CONFIRM_PATTERNS: RegExp[] = [
  /\bconfirm(ed)?\b/i,
  /\byes\b/i,
  /\bi('ll| will) be there\b/i,
  /\bsounds good\b/i,
  /\bno problem\b/i,
  /\bok(ay)?\b/i,
  /\bsure\b/i,
  /\bof course\b/i,
  /\bgot it\b/i,
  /\bwill do\b/i,
];

/**
 * Returns true if the transcript contains a verbal confirmation.
 * Mirrors the logic in handleEscalationCallEnd.
 */
export function isVerbalConfirmation(transcript: string | null): boolean {
  if (transcript === null) return false;
  return ESCALATION_CONFIRM_PATTERNS.some((p) => p.test(transcript));
}

/**
 * Returns true if the call outcome indicates no answer / voicemail.
 */
export function isNoAnswer(endedReason: string | null, transcript: string | null): boolean {
  if (isVerbalConfirmation(transcript)) return false;
  return (
    endedReason === "no-answer" ||
    endedReason === "customer-did-not-answer" ||
    endedReason === "voicemail" ||
    (transcript ?? "").trim().length < 20
  );
}
