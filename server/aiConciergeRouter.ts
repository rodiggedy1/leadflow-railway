/**
 * aiConciergeRouter.ts
 * Powers the AI Concierge slide-in panel in Command Chat.
 *
 * Current commands: ETA update, text cleaners
 * Expansion path: add more intents to the LLM classifier and add handlers below.
 *
 * Design principle: this router ONLY orchestrates existing procedures.
 * It does NOT re-implement any logic that already exists elsewhere.
 * - Team data  → fieldMgmtRouter.getTeamEtaSummary (already used by TeamEtaModal)
 * - ETA call   → placeEtaCall (same as requestEta mutation)
 * - Poll result → fieldMgmt.getTeamEtaSummary (same data TeamEtaModal shows)
 * - SMS        → sendSms from openphone.ts (same as everywhere else)
 */
import { z } from "zod";
import { router, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { cleanerJobs, cleanerProfiles } from "../drizzle/schema";
import { eq, ne, and, inArray } from "drizzle-orm";
import { parseServiceDateTime, formatTimeET, placeEtaCall } from "./fieldMgmtEngine";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ── Result types ──────────────────────────────────────────────────────────────

interface EtaPendingResult {
  type: "eta_pending";
  /** Job ID to poll fieldMgmt.getTeamEtaSummary for */
  jobId: number;
  teamName: string;
  cleanerName: string;
  scheduledTimeET: string;
  /** Today's date string for the getTeamEtaSummary query */
  date: string;
}

interface CompletedResult {
  type: "completed";
  message: string;
}

interface ErrorResult {
  type: "error";
  message: string;
}

interface ClarifyResult {
  type: "clarify";
  message: string;
  teams: Array<{ name: string; currentJobId: number; address: string; scheduled: string; etaStatus: string }>;
}

export interface BulkSmsRecipient {
  cleanerProfileId: number;
  name: string;
  phone: string;
}

/** Returned when the AI has drafted a message and resolved recipients — agent must confirm before sending */
interface BulkSmsConfirmResult {
  type: "bulk_sms_confirm";
  /** Human-readable description of who will be texted */
  targetDescription: string;
  recipients: BulkSmsRecipient[];
  /** AI-drafted message — agent can edit before sending */
  draftMessage: string;
}

/** Returned after agent confirms and messages are sent */
interface BulkSmsSentResult {
  type: "bulk_sms_sent";
  message: string;
  results: Array<{
    name: string;
    phone: string;
    success: boolean;
    error?: string;
  }>;
}

type ConciergeResult =
  | EtaPendingResult
  | CompletedResult
  | ErrorResult
  | ClarifyResult
  | BulkSmsConfirmResult
  | BulkSmsSentResult;

// ── Intent classifier ─────────────────────────────────────────────────────────
type Intent =
  | { action: "eta_update"; teamHint: string | null }
  | { action: "text_cleaners"; targetHint: string | null; messageHint: string | null }
  | { action: "unknown" };

async function classifyIntent(message: string): Promise<Intent> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an intent classifier for a cleaning operations AI assistant.
Classify the user's message into one of these actions:
- eta_update: user wants to request an ETA call for a team (e.g. "send ETA for Team 8", "call team 3 for ETA", "get ETA update", "ETA for Maria")
- text_cleaners: user wants to send an SMS to one or more cleaners (e.g. "text cleaners working today", "text all DC cleaners", "text Maria and ask if she found a purse", "message all cleaners about tomorrow", "text team 5")
- unknown: anything else

Return JSON only:
{
  "action": "eta_update" | "text_cleaners" | "unknown",
  "teamHint": "<team/cleaner name for eta_update, or null>",
  "targetHint": "<who to text for text_cleaners — e.g. 'working today', 'DC', 'Maria', 'all active', or null>",
  "messageHint": "<the message content or topic the user wants to send, or null>"
}`,
      },
      { role: "user", content: message },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "intent",
        strict: true,
        schema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["eta_update", "text_cleaners", "unknown"] },
            teamHint: { type: ["string", "null"] },
            targetHint: { type: ["string", "null"] },
            messageHint: { type: ["string", "null"] },
          },
          required: ["action", "teamHint", "targetHint", "messageHint"],
          additionalProperties: false,
        },
      },
    },
  });
  try {
    const parsed = JSON.parse(result.choices[0].message.content as string);
    return parsed as Intent;
  } catch {
    return { action: "unknown" };
  }
}

// ── Fetch today's teams ───────────────────────────────────────────────────────
async function getTodayTeams(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const today = getTodayET();

  const jobs = await db
    .select({
      id: cleanerJobs.id,
      cleanerName: cleanerJobs.cleanerName,
      teamName: cleanerJobs.teamName,
      customerName: cleanerJobs.customerName,
      jobAddress: cleanerJobs.jobAddress,
      serviceDateTime: cleanerJobs.serviceDateTime,
      jobStatus: cleanerJobs.jobStatus,
      cleanerPhone: cleanerProfiles.phone,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
    })
    .from(cleanerJobs)
    .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
    .where(
      and(
        eq(cleanerJobs.jobDate, today),
        ne(cleanerJobs.bookingStatus, "cancelled"),
        ne(cleanerJobs.bookingStatus, "rescheduled")
      )
    )
    .orderBy(cleanerJobs.serviceDateTime);

  const teamMap = new Map<string, {
    teamName: string;
    cleanerName: string;
    cleanerPhone: string | null;
    cleanerProfileId: number;
    jobs: typeof jobs;
  }>();

  for (const job of jobs) {
    const key = job.teamName ?? job.cleanerName;
    if (!teamMap.has(key)) {
      teamMap.set(key, {
        teamName: key,
        cleanerName: job.cleanerName,
        cleanerPhone: job.cleanerPhone ?? null,
        cleanerProfileId: job.cleanerProfileId,
        jobs: [],
      });
    }
    teamMap.get(key)!.jobs.push(job);
  }

  return Array.from(teamMap.values()).map(team => {
    const currentJob = team.jobs.find(j =>
      j.jobStatus !== "completed" && j.jobStatus !== "cancelled"
    ) ?? team.jobs[team.jobs.length - 1];
    return {
      teamName: team.teamName,
      cleanerName: team.cleanerName,
      cleanerPhone: team.cleanerPhone,
      cleanerProfileId: team.cleanerProfileId,
      currentJobId: currentJob?.id ?? null,
      currentJobAddress: currentJob?.jobAddress ?? null,
      currentJobServiceDateTime: currentJob?.serviceDateTime ?? null,
      currentJobStatus: currentJob?.jobStatus ?? null,
    };
  });
}

// ── Text cleaners: resolve target list ───────────────────────────────────────
async function resolveTextTargets(
  targetHint: string | null,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<{ recipients: BulkSmsRecipient[]; targetDescription: string }> {
  const today = getTodayET();
  const hint = (targetHint ?? "").toLowerCase().trim();

  // "working today" or "working right now" or no hint → cleaners with jobs today
  if (!hint || hint.includes("today") || hint.includes("working") || hint.includes("right now")) {
    const teams = await getTodayTeams(db);
    const recipients = teams
      .filter(t => t.cleanerPhone)
      .map(t => ({ cleanerProfileId: t.cleanerProfileId, name: t.cleanerName, phone: t.cleanerPhone! }));
    // Deduplicate by cleanerProfileId
    const seen = new Set<number>();
    const unique = recipients.filter(r => {
      if (seen.has(r.cleanerProfileId)) return false;
      seen.add(r.cleanerProfileId);
      return true;
    });
    return { recipients: unique, targetDescription: "cleaners working today" };
  }

  // "all active" or "everyone" → all active cleaner profiles
  if (hint.includes("all") || hint.includes("everyone") || hint.includes("active")) {
    const profiles = await db
      .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone })
      .from(cleanerProfiles)
      .where(and(eq(cleanerProfiles.isActive, 1)));
    const recipients = profiles
      .filter(p => p.phone)
      .map(p => ({ cleanerProfileId: p.id, name: p.name, phone: p.phone! }));
    return { recipients, targetDescription: "all active cleaners" };
  }

  // DC / Virginia / Maryland / area-based → cleaners with jobs today in that area
  const areaKeywords: Record<string, string[]> = {
    "dc": ["washington", "dc", " dc", "d.c"],
    "virginia": ["virginia", " va", ", va"],
    "maryland": ["maryland", " md", ", md"],
  };
  for (const [areaLabel, keywords] of Object.entries(areaKeywords)) {
    if (keywords.some(k => hint.includes(k))) {
      const teams = await getTodayTeams(db);
      const inArea = teams.filter(t =>
        t.currentJobAddress &&
        keywords.some(k => t.currentJobAddress!.toLowerCase().includes(k))
      );
      const recipients = inArea
        .filter(t => t.cleanerPhone)
        .map(t => ({ cleanerProfileId: t.cleanerProfileId, name: t.cleanerName, phone: t.cleanerPhone! }));
      const seen = new Set<number>();
      const unique = recipients.filter(r => {
        if (seen.has(r.cleanerProfileId)) return false;
        seen.add(r.cleanerProfileId);
        return true;
      });
      return { recipients: unique, targetDescription: `cleaners working in ${areaLabel.toUpperCase()} today` };
    }
  }

  // "haven't confirmed" / "schedule confirm" → cleaners with SCHEDULE_CONFIRM_SENT
  if (hint.includes("confirm") || hint.includes("schedule")) {
    const teams = await getTodayTeams(db);
    const recipients = teams
      .filter(t => t.cleanerPhone)
      .map(t => ({ cleanerProfileId: t.cleanerProfileId, name: t.cleanerName, phone: t.cleanerPhone! }));
    const seen = new Set<number>();
    const unique = recipients.filter(r => {
      if (seen.has(r.cleanerProfileId)) return false;
      seen.add(r.cleanerProfileId);
      return true;
    });
    return { recipients: unique, targetDescription: "cleaners working today (schedule confirmation)" };
  }

  // Specific cleaner name → match by name in profiles
  const profiles = await db
    .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone })
    .from(cleanerProfiles)
    .where(eq(cleanerProfiles.isActive, 1));

  const matched = profiles.filter(p =>
    p.name.toLowerCase().includes(hint) || hint.includes(p.name.toLowerCase().split(" ")[0])
  );

  if (matched.length > 0) {
    const recipients = matched
      .filter(p => p.phone)
      .map(p => ({ cleanerProfileId: p.id, name: p.name, phone: p.phone! }));
    const names = recipients.map(r => r.name).join(", ");
    return { recipients, targetDescription: names };
  }

  // Specific team name → match by teamName in today's jobs
  const teams = await getTodayTeams(db);
  const teamMatched = teams.filter(t =>
    t.teamName.toLowerCase().includes(hint) || t.cleanerName.toLowerCase().includes(hint)
  );
  if (teamMatched.length > 0) {
    const recipients = teamMatched
      .filter(t => t.cleanerPhone)
      .map(t => ({ cleanerProfileId: t.cleanerProfileId, name: t.cleanerName, phone: t.cleanerPhone! }));
    const seen = new Set<number>();
    const unique = recipients.filter(r => {
      if (seen.has(r.cleanerProfileId)) return false;
      seen.add(r.cleanerProfileId);
      return true;
    });
    return { recipients: unique, targetDescription: `cleaners on ${teamMatched[0].teamName}` };
  }

  // Fallback: today's cleaners
  const fallbackTeams = await getTodayTeams(db);
  const fallbackRecipients = fallbackTeams
    .filter(t => t.cleanerPhone)
    .map(t => ({ cleanerProfileId: t.cleanerProfileId, name: t.cleanerName, phone: t.cleanerPhone! }));
  const seen = new Set<number>();
  const unique = fallbackRecipients.filter(r => {
    if (seen.has(r.cleanerProfileId)) return false;
    seen.add(r.cleanerProfileId);
    return true;
  });
  return { recipients: unique, targetDescription: "cleaners working today" };
}

// ── Text cleaners: draft message ──────────────────────────────────────────────
async function draftCleanerMessage(
  messageHint: string | null,
  targetDescription: string,
  recipients: BulkSmsRecipient[]
): Promise<string> {
  const recipientNames = recipients.map(r => r.name.split(" ")[0]).join(", ");
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are drafting a short, professional SMS message from a cleaning company dispatcher to their cleaning staff.
Keep it brief (1-3 sentences), friendly, and direct.
Do NOT include greetings like "Hi [Name]" — the message goes to multiple people.
Do NOT include a sign-off or company name.
Just write the message body.`,
      },
      {
        role: "user",
        content: `Draft an SMS to send to ${targetDescription} (${recipientNames}).
The dispatcher wants to: ${messageHint ?? "send a general message to the team"}`,
      },
    ],
  });
  return (result.choices[0].message.content as string).trim();
}

// ── Text cleaners handler ─────────────────────────────────────────────────────
async function handleTextCleaners(
  targetHint: string | null,
  messageHint: string | null,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConciergeResult> {
  const { recipients, targetDescription } = await resolveTextTargets(targetHint, db);

  if (recipients.length === 0) {
    return { type: "error", message: `No cleaners found matching "${targetHint ?? "your request"}". Try "working today" or a specific name.` };
  }

  const draftMessage = await draftCleanerMessage(messageHint, targetDescription, recipients);

  return {
    type: "bulk_sms_confirm",
    targetDescription,
    recipients,
    draftMessage,
  };
}

// ── ETA update handler ────────────────────────────────────────────────────────
async function handleEtaUpdate(
  teamHint: string | null,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConciergeResult> {
  const teams = await getTodayTeams(db);
  const today = getTodayET();

  if (teams.length === 0) {
    return { type: "error", message: "No active jobs found for today." };
  }

  let matched = teams.find(t => {
    if (!teamHint) return false;
    const hint = teamHint.toLowerCase();
    return (
      t.teamName.toLowerCase().includes(hint) ||
      t.cleanerName.toLowerCase().includes(hint)
    );
  });

  if (!matched && teams.length === 1) {
    matched = teams[0];
  }

  if (!matched) {
    return {
      type: "clarify",
      message: teamHint
        ? `I couldn't find a team matching "${teamHint}". Which team do you want the ETA for?`
        : "Which team do you want the ETA for?",
      teams: teams
        .filter(t => t.currentJobId !== null)
        .map(t => ({
          name: t.teamName,
          currentJobId: t.currentJobId!,
          address: t.currentJobAddress ?? "—",
          scheduled: t.currentJobServiceDateTime ?? "—",
          etaStatus: t.currentJobStatus ?? "pending",
        })),
    };
  }

  if (!matched.currentJobId) {
    return { type: "error", message: `No active job found for ${matched.teamName} today.` };
  }

  if (!matched.cleanerPhone) {
    return { type: "error", message: `No phone number on file for ${matched.cleanerName}.` };
  }

  const [row] = await db
    .select({
      id: cleanerJobs.id,
      customerName: cleanerJobs.customerName,
      serviceDateTime: cleanerJobs.serviceDateTime,
      cleanerPhone: cleanerProfiles.phone,
      cleanerName: cleanerJobs.cleanerName,
    })
    .from(cleanerJobs)
    .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
    .where(eq(cleanerJobs.id, matched.currentJobId))
    .limit(1);

  if (!row) return { type: "error", message: "Job not found." };

  const cleanerFirstName = (row.cleanerName ?? "there").split(" ")[0];
  const customerFirstName = (row.customerName ?? "your customer").split(" ")[0];

  if (!row.serviceDateTime) {
    return { type: "error", message: `Job for ${matched.teamName} has no service time set.` };
  }

  const serviceTime = parseServiceDateTime(row.serviceDateTime);
  if (!serviceTime) return { type: "error", message: "Could not parse service date/time for this job." };

  const scheduledTimeET = formatTimeET(serviceTime);

  const result = await placeEtaCall({
    cleanerJobId: matched.currentJobId,
    step: "eta_call_1",
    cleanerPhone: row.cleanerPhone ?? matched.cleanerPhone,
    cleanerFirstName,
    customerFirstName,
    scheduledTimeET,
    bypassStepLock: true,
  });

  if (!result.success) {
    return {
      type: "error",
      message: result.reason ?? "ETA call failed. Please try again or use the ETA modal.",
    };
  }

  return {
    type: "eta_pending",
    jobId: matched.currentJobId,
    teamName: matched.teamName,
    cleanerName: matched.cleanerName,
    scheduledTimeET,
    date: today,
  };
}

// ── ETA by resolved job ID (when agent picks from clarify list) ───────────────
async function handleEtaUpdateByJobId(
  jobId: number,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConciergeResult> {
  const today = getTodayET();

  const [row] = await db
    .select({
      id: cleanerJobs.id,
      customerName: cleanerJobs.customerName,
      serviceDateTime: cleanerJobs.serviceDateTime,
      cleanerPhone: cleanerProfiles.phone,
      cleanerName: cleanerJobs.cleanerName,
      teamName: cleanerJobs.teamName,
    })
    .from(cleanerJobs)
    .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
    .where(eq(cleanerJobs.id, jobId))
    .limit(1);

  if (!row) return { type: "error", message: "Job not found." };
  if (!row.cleanerPhone) return { type: "error", message: `No phone number on file for ${row.cleanerName}.` };
  if (!row.serviceDateTime) return { type: "error", message: "Job has no service time set." };

  const serviceTime = parseServiceDateTime(row.serviceDateTime);
  if (!serviceTime) return { type: "error", message: "Could not parse service date/time." };

  const cleanerFirstName = (row.cleanerName ?? "there").split(" ")[0];
  const customerFirstName = (row.customerName ?? "your customer").split(" ")[0];
  const scheduledTimeET = formatTimeET(serviceTime);
  const teamName = row.teamName ?? row.cleanerName;

  const result = await placeEtaCall({
    cleanerJobId: jobId,
    step: "eta_call_1",
    cleanerPhone: row.cleanerPhone,
    cleanerFirstName,
    customerFirstName,
    scheduledTimeET,
    bypassStepLock: true,
  });

  if (!result.success) {
    return { type: "error", message: result.reason ?? "ETA call failed." };
  }

  return {
    type: "eta_pending",
    jobId,
    teamName,
    cleanerName: row.cleanerName ?? teamName,
    scheduledTimeET,
    date: today,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────
export const aiConciergeRouter = router({
  /**
   * Main chat endpoint for the AI Concierge panel.
   * Receives the agent's message, classifies intent, executes the action,
   * and returns a structured result the UI renders.
   */
  chat: agentProcedure
    .input(
      z.object({
        message: z.string().min(1).max(2000),
        resolvedJobId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      if (input.resolvedJobId) {
        return await handleEtaUpdateByJobId(input.resolvedJobId, db);
      }

      const intent = await classifyIntent(input.message);

      if (intent.action === "eta_update") {
        return await handleEtaUpdate(intent.teamHint, db);
      }

      if (intent.action === "text_cleaners") {
        return await handleTextCleaners(intent.targetHint, intent.messageHint, db);
      }

      return {
        type: "error" as const,
        message: "I can handle ETA updates and texting cleaners. Try: \"Send ETA for Team 8\" or \"Text cleaners working today about tomorrow's schedule\".",
      };
    }),

  /**
   * Confirm and send bulk SMS after agent reviews/edits the draft.
   * Called when agent clicks "Send" on the bulk_sms_confirm card.
   */
  sendBulkSms: agentProcedure
    .input(
      z.object({
        recipients: z.array(z.object({
          cleanerProfileId: z.number(),
          name: z.string(),
          phone: z.string(),
        })),
        message: z.string().min(1).max(1600),
      })
    )
    .mutation(async ({ input }) => {
      const results: BulkSmsSentResult["results"] = [];

      for (const recipient of input.recipients) {
        try {
          const result = await sendSms({
            to: recipient.phone,
            content: input.message,
            fromNumberId: ENV.openPhoneCsNumberId,
          });
          results.push({ name: recipient.name, phone: recipient.phone, success: result.success });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ name: recipient.name, phone: recipient.phone, success: false, error: msg });
        }
      }

      const sent = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return {
        type: "bulk_sms_sent" as const,
        message: failed === 0
          ? `Sent to ${sent} cleaner${sent !== 1 ? "s" : ""}.`
          : `Sent to ${sent}, failed for ${failed}.`,
        results,
      };
    }),
});
