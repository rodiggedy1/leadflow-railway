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
import { router, agentProcedure, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { cleanerJobs, cleanerProfiles, completedJobs, cardAuthTokens, callLog, fieldMgmtCalls, madisonMissions, confirmationCalls, scheduleAssignments, opsChatMessages } from "../drizzle/schema";
import { matchConfirmationCallsToJobs } from "./confirmationMatchHelper";
import { eq, ne, and, inArray, like, or, desc, gte, sql, isNull, lt } from "drizzle-orm";
import { parseServiceDateTime, formatTimeET, placeEtaCall } from "./fieldMgmtEngine";
import { normalizePhoneLegacy } from "./utils/phone";
import { randomBytes } from "crypto";
import { sendSms } from "./openphone";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import { appendCsOutboundMessage } from "./sms/appendCsOutboundMessage";
import { parseConciergeRequest, validateAndNormalizePlan } from "./conciergeParser";
import { resolveQuery } from "./conciergeResolvers";
import type { QueryPlan } from "./conciergeQuery";
import { getTodayET, resolveServiceDateRange } from "./conciergeTime";

// ── Helpers ───────────────────────────────────────────────────────────────────
// getTodayET and resolveServiceDateRange are imported from ./conciergeTime

// ── Mission metadata ─────────────────────────────────────────────────────────

export interface MissionStep {
  id: string;
  label: string;
  status: "completed" | "failed" | "skipped";
  detail?: string;
  /** Present on call steps — used by MissionCard to poll recording + transcript */
  vapiCallId?: string;
}

export interface MissionStats {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  waiting: number;
}

export interface MissionMetadata {
  missionId: string;
  missionTitle: string;
  missionStatus: "completed" | "failed" | "blocked";
  missionStartedAt: string;
  missionCompletedAt: string;
  missionSteps: MissionStep[];
  missionStats: MissionStats;
  missionSummary: string;
}

function createMissionMetadata({
  title,
  startedAt,
  status,
  summary,
  steps,
}: {
  title: string;
  startedAt: Date;
  status: "completed" | "failed" | "blocked";
  summary: string;
  steps: MissionStep[];
}): MissionMetadata {
  const stats: MissionStats = {
    total: steps.length,
    completed: steps.filter(s => s.status === "completed").length,
    failed: steps.filter(s => s.status === "failed").length,
    skipped: steps.filter(s => s.status === "skipped").length,
    waiting: 0,
  };
  return {
    missionId: crypto.randomUUID(),
    missionTitle: title,
    missionStatus: status,
    missionStartedAt: startedAt.toISOString(),
    missionCompletedAt: new Date().toISOString(),
    missionSteps: steps,
    missionStats: stats,
    missionSummary: summary,
  };
}

// ── Mission persistence ──────────────────────────────────────────────────────

/**
 * Persists a completed mission to the madison_missions table.
 * MUST be called only after the external side effect (SMS/payment) has already succeeded.
 * If persistence fails, logs + alerts the owner but does NOT throw — the caller must
 * return missionPersistenceError: true in that case.
 *
 * @returns the saved MissionMetadata on success, or null on failure.
 */
async function createAndSaveMission(
  mission: MissionMetadata,
  agentId: number,
  command: string,
  source: "chat" | "scheduled" | "automatic" | "api" = "chat"
): Promise<MissionMetadata | null> {
  try {
    const db = await getDb();
    if (!db) {
      console.error("[MissionPersistence] DB unavailable — mission not saved", mission.missionId);
      notifyOwner({
        title: "Mission persistence failed (no DB)",
        content: `Mission "${mission.missionTitle}" (${mission.missionId}) could not be saved — DB unavailable.`,
      }).catch(() => {});
      return null;
    }
    await db.insert(madisonMissions).values({
      missionId: mission.missionId,
      agentId,
      command: command.trim().slice(0, 2000),
      title: mission.missionTitle,
      status: mission.missionStatus,
      source,
      summary: mission.missionSummary,
      steps: mission.missionSteps as any,
      stats: mission.missionStats as any,
      startedAt: new Date(mission.missionStartedAt).getTime(),
      completedAt: new Date(mission.missionCompletedAt).getTime(),
    });
    return mission;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[MissionPersistence] Insert failed:", msg, "missionId:", mission.missionId);
    notifyOwner({
      title: "Mission persistence failed",
      content: `Mission "${mission.missionTitle}" (${mission.missionId}) by agent ${agentId} could not be saved.\nError: ${msg}`,
    }).catch(() => {});
    return null;
  }
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
  /** Original user command — carried through to sendBulkSms for mission persistence */
  command?: string;
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
  mission?: MissionMetadata | null;
  /** True when SMS succeeded but DB persistence failed — client should still show success */
  missionPersistenceError?: boolean;
}

/** Returned when a client name search returns multiple matches — agent must pick one */
export interface ClientDisambiguationResult {
  type: "client_disambiguation";
  query: string;
  messageHint: string | null;
  matches: Array<{
    phone: string;
    name: string;
    city: string | null;
    totalCleans: number;
    ltv: number;
    lastJobDate: string | null;
  }>;
}

/** Returned when payment link is created and ready to send — agent must confirm before sending SMS */
export interface PaymentLinkConfirmResult {
  type: "payment_link_confirm";
  recipientName: string;
  recipientFirstName: string;
  recipientPhone: string;
  paymentLinkUrl: string;
  expiresAt: number;
  /** Pre-filled SMS text with first name and link already substituted */
  smsText: string;
  /** Original user command — carried through to sendPaymentLinkSms for mission persistence */
  command?: string;
}

/** Returned when concierge is about to call a client — agent must confirm script before firing */
export interface CallClientConfirmResult {
  type: "call_client_confirm";
  recipientName: string;
  recipientFirstName: string;
  recipientPhone: string;
  /** AI-drafted script the agent can edit before firing */
  script: string;
  /** "customer" | "cleaner" — passed to callMatrix.startCall */
  audience: "customer" | "cleaner";
  /** 0 for concierge calls with no specific job */
  cleanerJobId: number;
}
/** Returned after the concierge call is fired — UI polls callLogId for result */
export interface CallClientPendingResult {
  type: "call_client_pending";
  callLogId: number;
  recipientName: string;
  recipientPhone: string;
}
/** Returned after payment link SMS is sent */
export interface PaymentLinkSentResult {
  type: "payment_link_sent";
  recipientName: string;
  recipientPhone: string;
  paymentLinkUrl: string;
  success: boolean;
  error?: string;
  mission?: MissionMetadata | null;
  /** True when SMS succeeded but DB persistence failed — client should still show success */
  missionPersistenceError?: boolean;
}

/** Returned when the concierge answers a natural-language query about today's jobs */
export interface QueryResultResult {
  type: "query_result";
  answer: string;
  status: "complete" | "partial" | "not_found" | "ambiguous" | "error";
}

/** Returned when the concierge lists teams with no confirmed ETA today */
export interface NoEtaResult {
  type: "list_no_eta";
  date: string; // YYYY-MM-DD
  rows: Array<{
    teamName: string;
    cleanerName: string;
    scheduledTime: string; // formatted e.g. "8:30 AM"
    serviceDateTime: string | null; // raw ISO for comparison
    etaStatus: "pending" | "unclear" | "no_answer";
    isPastScheduled: boolean; // true if serviceDateTime < now
    currentJobId: number;
  }>;
}

/** Returned when the concierge shows the list of jobs for confirmation texts (list-first, then Send All) */
export interface ConfirmationTextsResult {
  type: "confirmation_texts";
  date: string; // YYYY-MM-DD
  dateLabel: string; // human-readable e.g. "tomorrow"
  rows: Array<{
    cleanerJobId: number;
    customerName: string;
    customerPhone: string | null;
    serviceDateTime: string | null;
    teamName: string | null;
    alreadySent: boolean; // true if smsFollowupSent = 1
    smsConfirmedAt: number | null;
  }>;
}

/** Returned when the concierge shows confirmation text results for a date */
export interface ConfirmationResultsResult {
  type: "confirmation_results";
  date: string; // YYYY-MM-DD
  dateLabel: string;
  rows: Array<{
    clientName: string | null;
    calledPhone: string | null;
    smsFollowupSent: number | null;
    smsConfirmedAt: number | null;
    smsReply: string | null;
    aiOutcome: string | null;
    aiOutcomeLabel: string | null;
    manualOutcome: string | null;
    manualOutcomeLabel: string | null;
    firedAt: number | null;
  }>;
  totalSent: number;
  totalConfirmed: number;
  totalPending: number;
}

/** Returned when the concierge ranks teams/cleaners by customer rating */
export interface TeamRatingsResult {
  type: "rank_teams";
  windowDays: number;
  minRatings: number;
  rows: Array<{
    rank: number;
    cleanerName: string;
    avgRating: number;
    ratedJobs: number;
    totalJobs: number;
  }>;
  excluded: number; // cleaners with < minRatings rated jobs
}

/** Returned when the concierge shows card/payment hold status for jobs on a date */
export interface CardStatusResult {
  type: "card_status";
  date: string; // YYYY-MM-DD
  rows: Array<{
    customerName: string;
    cardBrand: string | null;
    last4: string | null;
    status: "on_hold" | "no_preauth" | "no_card";
    amountCents: number;
  }>;
}

export interface CustomerProfileResult {
  type: "customer_profile";
  profile: {
    name: string;
    phone: string;
    address: string | null;
    frequency: string | null;
    totalBookings: number;
    ltv: number;
    avgPrice: number | null;
    usualTeam: string | null;
    isVip: boolean;
    lastJobs: Array<{
      jobDate: string | null;
      serviceType: string | null;
      price: number | null;
      rating: number | null;
      teamName: string | null;
    }>;
    upcomingJob: {
      jobDate: string | null;
      serviceDateTime: string | null;
      jobStatus: string | null;
      teamName: string | null;
      jobAddress: string | null;
    } | null;
    lastMessages: Array<{ content: string; ts: number | null }>;
    aiMemoryBullets: string[];
    openPhoneCalls: Array<{
      direction: string | null;
      durationSeconds: number | null;
      callStartedAt: Date | null;
      callDebrief: string | null;
    }>;
    vapiCalls: Array<{
      step: string | null;
      outcome: string | null;
      summary: string | null;
      durationSeconds: number | null;
      createdAt: Date | null;
    }>;
    aiSummary: string;
  };
}

type ConciergeResult =
  | EtaPendingResult
  | CompletedResult
  | ErrorResult
  | ClarifyResult
  | BulkSmsConfirmResult
  | BulkSmsSentResult
  | ClientDisambiguationResult
  | PaymentLinkConfirmResult
  | PaymentLinkSentResult
  | CallClientConfirmResult
  | CallClientPendingResult
  | QueryResultResult
  | CardStatusResult
  | TeamRatingsResult
  | NoEtaResult
  | ConfirmationTextsResult
  | ConfirmationResultsResult;
  // CustomerProfileResult removed — all informational queries now go through resolveQuery()

// ── Intent classifier ─────────────────────────────────────────────────────────
type TargetType = "customer" | "cleaner" | "team" | "unknown";
type Intent =
  | { action: "eta_update"; teamHint: string | null }
  | { action: "get_eta_for_customer"; clientName: string | null }
  | { action: "text_cleaners"; targetHint: string | null; messageHint: string | null; targetType: TargetType }
  | { action: "text_client"; clientName: string | null; messageHint: string | null; targetType: TargetType }
  | { action: "send_payment_link"; clientName: string | null }
  | { action: "call_client"; clientName: string | null; questionHint: string | null; targetType: TargetType }
  | { action: "query_data" }
  | { action: "customer_profile"; clientName: string | null }
  | { action: "unknown" };

async function classifyIntent(message: string): Promise<Intent> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an intent classifier for a cleaning operations AI assistant.
Classify the user's message into one of these actions:
- eta_update: user wants to request an ETA call for a team by team name (e.g. "send ETA for Team 8", "call team 3 for ETA", "get ETA update", "ETA for Maria")
- get_eta_for_customer: user wants an ETA for a specific CUSTOMER's job — the system will find which team is assigned and call them (e.g. "get ETA for Dave Pringle", "ETA for Mary Jones", "what's the ETA for John Smith's job")
- text_cleaners: user wants to send an SMS to one or more CLEANERS/STAFF (e.g. "text cleaners working today", "text all DC cleaners", "text team 5", "message all cleaners about tomorrow")
- text_client: user wants to send an SMS to a specific CUSTOMER/CLIENT by name (e.g. "text Abigail Avrick and ask if we can come early", "text John Smith about his appointment", "message Sarah Jones")
- send_payment_link: user wants to send a Stripe payment/card link to a specific customer (e.g. "send payment link to Mary Jones", "send card link to John Smith", "send stripe link to Sarah", "send payment link for Mary")
- call_client: user wants to call a specific customer to ask them something or deliver a message (e.g. "call rohan gilkes and ask if he wants to reschedule", "call Mary Jones and tell her we're running late", "give sarah a call about her appointment")
- query_data: user is asking about a job property — which cleaner or team is assigned, what time, what status, what address, what happened on a specific date — even if a customer name is mentioned. Examples: "list all jobs today", "what jobs does Team 3 have", "show me jobs for Kara Turner", "how many jobs this week", "what's the status of the 10am job", "which teams are working today", "who is assigned to Cindy today?", "who handled Cindy last time?", "what time is Cindy's cleaning?", "who's going to Cindy's house?", "who has Robert today?", "what crew has Cindy?"
- customer_profile: user requests broad information about a customer's identity, relationship, notes, or booking history — NOT a specific job property. Use ONLY when the request is explicitly broad. Examples: "Who is Cindy?", "Pull up Cindy.", "Tell me Cindy's history.", "What do we know about Cindy?", "Give me the rundown on Dave Pringle.", "Tell me everything about Dave Pringle.", "Show me Kara Turner's profile."
- unknown: anything else
KEY DISTINCTION: "text_client" is for texting a specific named customer. "text_cleaners" is for texting cleaning staff/teams. "send_payment_link" is specifically for sending a Stripe card-on-file link. "call_client" is for placing an outbound VAPI call to a customer. "customer_profile" is for BROAD identity/history requests only — NOT for job-property questions. When a customer name appears alongside a job-property question (assigned, team, time, status, address, cleaning), always use query_data.
CRITICAL ROUTING RULE: If the question asks about assignment, team, cleaner, scheduled time, job status, address, or access — even if a customer name is mentioned — classify as query_data, never customer_profile.

For customer_profile:
- clientName MUST be the exact full name of the customer as written by the user (e.g. "tell me everything about Dave Pringle" → clientName = "Dave Pringle", "who is Mary Jones" → clientName = "Mary Jones")
For get_eta_for_customer:
- clientName MUST be the exact full name of the customer as written by the user (e.g. "get ETA for Dave Pringle" → clientName = "Dave Pringle")

For text_cleaners:
- targetHint should be the EXACT group or cleaner name (e.g. "working today", "DC", "team 5", "all active", or a specific cleaner's name)
- messageHint should be the topic/content to send
- targetType: set to "cleaner" or "team" — NEVER "customer"
For text_client:
- clientName MUST be the exact full name of the customer as written by the user
- messageHint should be the topic/content to send
- targetType: set to "customer"
For send_payment_link:
- clientName MUST be the exact full name of the customer as written by the user (e.g. "send rohan gilkes a payment link" → clientName = "rohan gilkes")
- messageHint is null
For call_client:
- clientName MUST be the exact full name of the customer as written by the user (e.g. "call rohan gilkes and ask about reschedule" → clientName = "rohan gilkes")
- questionHint should be the topic or question to ask (e.g. "ask if he wants to reschedule", "tell her we're running late")
- targetType: "customer" when calling a named client/homeowner; "cleaner" when calling cleaning staff

targetType classification rules:
- "customer": the named person is a homeowner/client receiving cleaning services. A full personal name (first + last) like "Rohan Gilkes", "Mary Jones", "John Smith" is almost always a customer.
- "cleaner": the named person is cleaning staff or a specific cleaner by name
- "team": refers to a team label (e.g. "Team 5", "DC cleaners", "all cleaners")
- "unknown": cannot determine
Return JSON only:
{
  "action": "eta_update" | "get_eta_for_customer" | "text_cleaners" | "text_client" | "send_payment_link" | "call_client" | "query_data" | "customer_profile" | "unknown",
  "teamHint": "<team/cleaner name for eta_update, or null>",
  "targetHint": "<who to text for text_cleaners — exact name or group, or null>",
  "clientName": "<exact customer full name for text_client, send_payment_link, or call_client, or null>",
  "messageHint": "<the message content or topic for text_client or text_cleaners, or null>",
  "questionHint": "<the topic/question to ask for call_client, or null>",
  "targetType": "customer" | "cleaner" | "team" | "unknown"
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
            action: { type: "string", enum: ["eta_update", "get_eta_for_customer", "text_cleaners", "text_client", "send_payment_link", "call_client", "query_data", "customer_profile", "unknown"] },
            teamHint: { type: ["string", "null"] },
            targetHint: { type: ["string", "null"] },
            clientName: { type: ["string", "null"] },
            messageHint: { type: ["string", "null"] },
            questionHint: { type: ["string", "null"] },
            targetType: { type: "string", enum: ["customer", "cleaner", "team", "unknown"] },
          },
          required: ["action", "teamHint", "targetHint", "clientName", "messageHint", "questionHint", "targetType"],
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

// ── Fetch teams for a given service date ─────────────────────────────────────
async function getTeamsForDate(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, serviceDate: string) {
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
        eq(cleanerJobs.jobDate, serviceDate),
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
  plan: QueryPlan,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<{ recipients: BulkSmsRecipient[]; targetDescription: string }> {
  // Date comes exclusively from the parsed plan — never from re-parsing the hint string
  const { startDate } = resolveServiceDateRange(plan.timeScope);
  const dateLabel = startDate === getTodayET() ? "today" : startDate;
  const hint = (plan.targetHint ?? "").toLowerCase().trim();

  // "working [date]" or "working right now" or no hint → cleaners with jobs on the resolved date
  if (!hint || hint.includes("working") || hint.includes("right now")) {
    const teams = await getTeamsForDate(db, startDate);
    const recipients = teams
      .filter(t => t.cleanerPhone)
      .map(t => ({ cleanerProfileId: t.cleanerProfileId, name: t.cleanerName, phone: t.cleanerPhone! }));
    const seen = new Set<number>();
    const unique = recipients.filter(r => {
      if (seen.has(r.cleanerProfileId)) return false;
      seen.add(r.cleanerProfileId);
      return true;
    });
    return { recipients: unique, targetDescription: `cleaners working ${dateLabel}` };
  }
  // "all active" or "everyone" → all active cleaner profiles (date-independent)
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
  // DC / Virginia / Maryland / area-based → cleaners with jobs on the resolved date in that area
  const areaKeywords: Record<string, string[]> = {
    "dc": ["washington", "dc", " dc", "d.c"],
    "virginia": ["virginia", " va", ", va"],
    "maryland": ["maryland", " md", ", md"],
  };
  for (const [areaLabel, keywords] of Object.entries(areaKeywords)) {
    if (keywords.some(k => hint.includes(k))) {
      const teams = await getTeamsForDate(db, startDate);
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
      return { recipients: unique, targetDescription: `cleaners working in ${areaLabel.toUpperCase()} ${dateLabel}` };
    }
  }
  // "haven't confirmed" / "schedule confirm" → cleaners on the resolved date
  if (hint.includes("confirm") || hint.includes("schedule")) {
    const teams = await getTeamsForDate(db, startDate);
    const recipients = teams
      .filter(t => t.cleanerPhone)
      .map(t => ({ cleanerProfileId: t.cleanerProfileId, name: t.cleanerName, phone: t.cleanerPhone! }));
    const seen = new Set<number>();
    const unique = recipients.filter(r => {
      if (seen.has(r.cleanerProfileId)) return false;
      seen.add(r.cleanerProfileId);
      return true;
    });
    return { recipients: unique, targetDescription: `cleaners working ${dateLabel} (schedule confirmation)` };
  }
  // Specific cleaner name → match by name in profiles (date-independent)
  const profiles = await db
    .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone })
    .from(cleanerProfiles)
    .where(eq(cleanerProfiles.isActive, 1));
  const hintWords = hint.split(/\s+/).filter(Boolean);
  const matched = profiles.filter(p => {
    const pName = p.name.toLowerCase();
    if (pName.includes(hint) || hint.includes(pName)) return true;
    if (hintWords.length >= 2 && hintWords.every(w => pName.includes(w))) return true;
    const firstName = pName.split(" ")[0];
    if (firstName.length >= 4 && hint === firstName) return true;
    return false;
  });
  if (matched.length > 0) {
    const recipients = matched
      .filter(p => p.phone)
      .map(p => ({ cleanerProfileId: p.id, name: p.name, phone: p.phone! }));
    const names = recipients.map(r => r.name).join(", ");
    return { recipients, targetDescription: names };
  }
  // Specific team name → match by teamName in jobs on the resolved date
  const teams = await getTeamsForDate(db, startDate);
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
  // Fallback: cleaners on the resolved date
  const fallbackTeams = await getTeamsForDate(db, startDate);
  const fallbackRecipients = fallbackTeams
    .filter(t => t.cleanerPhone)
    .map(t => ({ cleanerProfileId: t.cleanerProfileId, name: t.cleanerName, phone: t.cleanerPhone! }));
  const seen = new Set<number>();
  const unique = fallbackRecipients.filter(r => {
    if (seen.has(r.cleanerProfileId)) return false;
    seen.add(r.cleanerProfileId);
    return true;
  });
  return { recipients: unique, targetDescription: `cleaners working ${dateLabel}` };
}
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

// ── Text client handler ──────────────────────────────────────────────────────
async function handleTextClient(
  clientName: string | null,
  messageHint: string | null,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  resolvedClientPhone?: string
): Promise<ConciergeResult> {
  if (!clientName && !resolvedClientPhone) {
    return { type: "error", message: "Please specify a client name to text." };
  }

  // If agent already picked from disambiguation, resolve directly
  if (resolvedClientPhone) {
    const q = `%${resolvedClientPhone}%`;
    const rows = await db
      .select({ phone: completedJobs.phone, name: completedJobs.name })
      .from(completedJobs)
      .where(like(completedJobs.phone, q))
      .limit(1);
    const client = rows[0];
    if (!client) return { type: "error", message: "Client not found." };
    const draft = await draftClientMessage(messageHint, client.name ?? clientName ?? "the client");
    return {
      type: "bulk_sms_confirm",
      targetDescription: client.name ?? resolvedClientPhone,
      recipients: [{ cleanerProfileId: 0, name: client.name ?? resolvedClientPhone, phone: resolvedClientPhone }],
      draftMessage: draft,
    };
  }

  // Search by name
  const q = `%${(clientName ?? "").trim()}%`;
  const rows = await db
    .select({
      phone: completedJobs.phone,
      name: completedJobs.name,
      address: completedJobs.address,
      lastBookingPrice: completedJobs.lastBookingPrice,
      jobDate: completedJobs.jobDate,
    })
    .from(completedJobs)
    .where(like(completedJobs.name, q))
    .orderBy(desc(completedJobs.jobDate))
    .limit(30);

  // Deduplicate by phone
  const byPhone = new Map<string, { phone: string; name: string; city: string | null; totalCleans: number; ltv: number; lastJobDate: string | null }>();
  for (const r of rows) {
    const key = r.phone;
    const existing = byPhone.get(key);
    if (existing) {
      existing.ltv += r.lastBookingPrice ?? 0;
      existing.totalCleans += 1;
      if (!existing.lastJobDate || (r.jobDate && r.jobDate > existing.lastJobDate)) existing.lastJobDate = r.jobDate ?? null;
    } else {
      byPhone.set(key, {
        phone: key,
        name: r.name ?? "",
        city: r.address ? r.address.split(",").slice(-2, -1)[0]?.trim() ?? null : null,
        ltv: r.lastBookingPrice ?? 0,
        totalCleans: 1,
        lastJobDate: r.jobDate ?? null,
      });
    }
  }

  const matches = Array.from(byPhone.values()).sort((a, b) => b.totalCleans - a.totalCleans).slice(0, 6);

  if (matches.length === 0) {
    return { type: "error", message: `No client found matching "${clientName}". Check the spelling or try a partial name.` };
  }

  if (matches.length === 1) {
    const client = matches[0];
    const draft = await draftClientMessage(messageHint, client.name);
    return {
      type: "bulk_sms_confirm",
      targetDescription: client.name,
      recipients: [{ cleanerProfileId: 0, name: client.name, phone: client.phone }],
      draftMessage: draft,
    };
  }

  // Multiple matches — return disambiguation card
  return {
    type: "client_disambiguation",
    query: clientName ?? "",
    messageHint,
    matches,
  };
}

// ── Payment link handler ─────────────────────────────────────────────────────

const PAYMENT_LINK_SMS_TEMPLATE = `Hi {first_name}! 👋 

This is Madison from Maids in Black. You're all scheduled for your cleaning service appointment, we just need a card on file via our secure Stripe link: {link}

🔒 100% secure – no one on our team sees your card info
✅ Pre-auth only – you're NOT charged until after service.
💳 Your card is not saved on our servers and is processed by Stripe.

Reply if you have any questions! See you soon 🧹✨`;

function buildPaymentSms(firstName: string, linkUrl: string): string {
  return PAYMENT_LINK_SMS_TEMPLATE
    .replace("{first_name}", firstName)
    .replace("{link}", linkUrl);
}

async function handleSendPaymentLink(
  clientName: string | null,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  resolvedClientPhone?: string,
  resolvedClientName?: string
): Promise<ConciergeResult> {
  if (!clientName && !resolvedClientPhone) {
    return { type: "error", message: "Please specify a client name to send the payment link to." };
  }

  let recipientPhone: string;
  let recipientName: string;
  let recipientAddress: string | null = null;

  if (resolvedClientPhone) {
    // TODO: Consolidate phone-based resolution into a shared resolveCustomerContext()
    // helper used by handleCallPerson and handleSendPaymentLink to prevent this
    // class of bug from recurring.

    // Chip is the authoritative identity — use phone and name directly.
    // Only look up the address, which the chip does not carry.
    recipientPhone = resolvedClientPhone;
    recipientName = resolvedClientName ?? resolvedClientPhone;

    // Normalize to last-10-digits for the address lookup (same convention used throughout)
    const phone10 = resolvedClientPhone.replace(/\D/g, "").slice(-10);

    // 1. Try completedJobs for address
    const completedRow = await db
      .select({ address: completedJobs.address })
      .from(completedJobs)
      .where(like(completedJobs.phone, `%${phone10}%`))
      .orderBy(desc(completedJobs.jobDate))
      .limit(1);
    recipientAddress = completedRow[0]?.address ?? null;

    // 2. Fall back to cleanerJobs if completedJobs had no address
    if (!recipientAddress) {
      const liveRow = await db
        .select({ jobAddress: cleanerJobs.jobAddress })
        .from(cleanerJobs)
        .where(like(cleanerJobs.customerPhone, `%${phone10}%`))
        .orderBy(desc(cleanerJobs.jobDate))
        .limit(1);
      recipientAddress = liveRow[0]?.jobAddress ?? null;
    }

    if (!recipientAddress) {
      return { type: "error", message: "I found the customer but couldn't locate a service address to generate a payment link." };
    }
  } else {
    // Search by name — same dual-table logic as searchCustomers (@ mentions)
    const q = `%${(clientName ?? "").trim()}%`;
    // 1. completedJobs (historical bookings)
    const completedRows = await db
      .select({
        phone: completedJobs.phone,
        name: completedJobs.name,
        address: completedJobs.address,
        lastBookingPrice: completedJobs.lastBookingPrice,
        jobDate: completedJobs.jobDate,
      })
      .from(completedJobs)
      .where(or(like(completedJobs.name, q), like(completedJobs.phone, q)))
      .orderBy(desc(completedJobs.jobDate))
      .limit(50);
    // Deduplicate by phone
    const byPhone = new Map<string, { phone: string; name: string; city: string | null; totalCleans: number; ltv: number; lastJobDate: string | null; address: string | null }>();
    for (const r of completedRows) {
      const key = r.phone;
      const existing = byPhone.get(key);
      if (existing) {
        existing.ltv += r.lastBookingPrice ?? 0;
        existing.totalCleans += 1;
        if (!existing.lastJobDate || (r.jobDate && r.jobDate > existing.lastJobDate)) existing.lastJobDate = r.jobDate ?? null;
      } else {
        byPhone.set(key, {
          phone: key,
          name: r.name ?? "",
          city: r.address ? r.address.split(",").slice(-2, -1)[0]?.trim() ?? null : null,
          ltv: r.lastBookingPrice ?? 0,
          totalCleans: 1,
          lastJobDate: r.jobDate ?? null,
          address: r.address ?? null,
        });
      }
    }
    // 2. cleanerJobs (upcoming/live bookings) — catches clients not yet in completedJobs
    const liveRows = await db
      .select({
        customerPhone: cleanerJobs.customerPhone,
        customerName: cleanerJobs.customerName,
        jobAddress: cleanerJobs.jobAddress,
        jobRevenue: cleanerJobs.jobRevenue,
        jobDate: cleanerJobs.jobDate,
      })
      .from(cleanerJobs)
      .where(like(cleanerJobs.customerName, q))
      .orderBy(desc(cleanerJobs.jobDate))
      .limit(30);
    for (const r of liveRows) {
      if (!r.customerPhone) continue;
      const digits10 = r.customerPhone.replace(/\D/g, "").slice(-10);
      const e164Key = `+1${digits10}`;
      const existing = byPhone.get(e164Key) ?? byPhone.get(r.customerPhone);
      if (!existing) {
        // Client not in completedJobs — add from cleanerJobs
        byPhone.set(e164Key, {
          phone: e164Key,
          name: r.customerName ?? "",
          city: r.jobAddress ? r.jobAddress.split(",").slice(-2, -1)[0]?.trim() ?? null : null,
          ltv: parseFloat(r.jobRevenue ?? "0") || 0,
          totalCleans: 1,
          lastJobDate: r.jobDate ?? null,
          address: r.jobAddress ?? null,
        });
      } else if (!existing.address && r.jobAddress) {
        // Found in completedJobs but address was null — backfill from cleanerJobs
        existing.address = r.jobAddress;
        existing.city = r.jobAddress.split(",").slice(-2, -1)[0]?.trim() ?? existing.city;
      }
    }
    const matches = Array.from(byPhone.values()).sort((a, b) => b.totalCleans - a.totalCleans).slice(0, 6);

    if (matches.length === 0) {
      return { type: "error", message: `No client found matching "${clientName}". Check the spelling or try a partial name.` };
    }

    if (matches.length > 1) {
      // Return disambiguation card — reuse existing client_disambiguation type
      // but store intent as payment_link so the UI knows what to do after selection
      return {
        type: "client_disambiguation",
        query: clientName ?? "",
        messageHint: "__payment_link__",
        matches: matches.map(m => ({
          phone: m.phone,
          name: m.name,
          city: m.city,
          totalCleans: m.totalCleans,
          ltv: m.ltv,
          lastJobDate: m.lastJobDate,
        })),
      };
    }

    const client = matches[0];
    recipientPhone = client.phone;
    recipientName = client.name;
    recipientAddress = client.address;
  }

  // Normalise phone for Stripe
  const digits = recipientPhone.replace(/\D/g, "");
  const normPhone = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : recipientPhone.startsWith("+") ? recipientPhone : `+${recipientPhone}`;

  // Create payment token using same logic as stripeRouter.generateCardAuthToken
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

  await db.insert(cardAuthTokens).values({
    token,
    customerPhone: normPhone,
    customerName: recipientName,
    jobDate: null,
    jobAddress: recipientAddress ?? null,
    cleanerJobId: null,
    used: 0,
    expiresAt,
  });

  const baseUrl = "https://quote.maidinblack.com";
  const params = new URLSearchParams();
  if (recipientName) params.set("name", recipientName);
  if (recipientAddress) params.set("address", recipientAddress);
  const qs = params.toString();
  const paymentLinkUrl = `${baseUrl}/pay/${token}${qs ? `?${qs}` : ""}`;

  const firstName = recipientName.split(" ")[0];
  const smsText = buildPaymentSms(firstName, paymentLinkUrl);

  return {
    type: "payment_link_confirm",
    recipientName,
    recipientFirstName: firstName,
    recipientPhone,
    paymentLinkUrl,
    expiresAt,
    smsText,
  };
}

// ── Call person handler ──────────────────────────────────────────────────────
/**
 * handleCallPerson — searches for a client or cleaner by name, drafts a VAPI call script,
 * and returns a call_client_confirm card. The UI then calls callMatrix.startCall directly.
 * No new VAPI infrastructure — reuses callMatrix.startCall + pollCall exactly.
 */
async function handleCallPerson(
  personName: string | null,
  questionHint: string | null,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  resolvedPhone?: string,
  resolvedName?: string,
): Promise<ConciergeResult> {
  if (!personName && !resolvedPhone) {
    return { type: "error", message: "Please specify who you want to call." };
  }
  let recipientPhone: string;
  let recipientName: string;
  let cleanerJobId = 0; // sentinel — no specific job for concierge calls
  let audience: "customer" | "cleaner" = "customer";
  if (resolvedPhone && resolvedName) {
    // Already resolved from disambiguation
    recipientPhone = resolvedPhone;
    recipientName = resolvedName;
    // Detect if it's a cleaner by checking cleanerProfiles
    const [cp] = await db.select({ id: cleanerProfiles.id }).from(cleanerProfiles)
      .where(like(cleanerProfiles.phone, `%${resolvedPhone.replace(/\D/g, "").slice(-10)}%`)).limit(1);
    if (cp) { audience = "cleaner"; cleanerJobId = 0; }
  } else {
    const q = `%${(personName ?? "").trim()}%`;
    // 1. Search cleanerProfiles first (exact name match wins)
    const cleaners = await db
      .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone })
      .from(cleanerProfiles)
      .where(and(eq(cleanerProfiles.isActive, 1), like(cleanerProfiles.name, q)))
      .limit(5);
    // 2. Search clients (same dual-table as payment link)
    const completedRows = await db
      .select({ phone: completedJobs.phone, name: completedJobs.name, jobDate: completedJobs.jobDate })
      .from(completedJobs)
      .where(or(like(completedJobs.name, q), like(completedJobs.phone, q)))
      .orderBy(desc(completedJobs.jobDate))
      .limit(30);
    const byPhone = new Map<string, { phone: string; name: string; isClient: boolean }>();
    for (const r of completedRows) {
      if (!r.phone || byPhone.has(r.phone)) continue;
      byPhone.set(r.phone, { phone: r.phone, name: r.name ?? "", isClient: true });
    }
    const liveRows = await db
      .select({ customerPhone: cleanerJobs.customerPhone, customerName: cleanerJobs.customerName })
      .from(cleanerJobs)
      .where(like(cleanerJobs.customerName, q))
      .limit(20);
    for (const r of liveRows) {
      if (!r.customerPhone) continue;
      const digits10 = r.customerPhone.replace(/\D/g, "").slice(-10);
      const e164 = `+1${digits10}`;
      if (!byPhone.has(e164) && !byPhone.has(r.customerPhone)) {
        byPhone.set(e164, { phone: e164, name: r.customerName ?? "", isClient: true });
      }
    }
    const clientMatches = Array.from(byPhone.values()).slice(0, 5);
    // Build combined list: cleaners first, then clients
    type Match = { phone: string; name: string; audience: "customer" | "cleaner" };
    const allMatches: Match[] = [
      ...cleaners.filter(c => c.phone).map(c => ({ phone: c.phone!, name: c.name, audience: "cleaner" as const })),
      ...clientMatches.map(c => ({ phone: c.phone, name: c.name, audience: "customer" as const })),
    ];
    if (allMatches.length === 0) {
      return { type: "error", message: `No client or cleaner found matching "${personName}". Check the spelling or try a partial name.` };
    }
    if (allMatches.length > 1) {
      // Disambiguation — reuse client_disambiguation card with __call_client__ sentinel
      return {
        type: "client_disambiguation",
        query: personName ?? "",
        messageHint: `__call_client__:${questionHint ?? ""}`,
        matches: allMatches.map(m => ({
          phone: m.phone,
          name: m.name,
          city: m.audience === "cleaner" ? "Cleaner" : "Client",
          totalCleans: 0,
          ltv: 0,
          lastJobDate: null,
        })),
      };
    }
    const match = allMatches[0];
    recipientPhone = match.phone;
    recipientName = match.name;
    audience = match.audience;
  }
  // Draft the call script using LLM
  const firstName = recipientName.split(" ")[0];
  const scriptResult = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are drafting a short, professional call script for a Maids in Black dispatcher.
The script is the FIRST MESSAGE the AI will say when the call is answered.
Keep it to 2-3 sentences max. Be warm, direct, and professional.
Address the person by first name. Do NOT include a sign-off.
Just write what the AI will say when the call connects.`,
      },
      {
        role: "user",
        content: `Draft a call script for ${firstName} (${audience}). The dispatcher wants to: ${questionHint ?? "check in with them"}`,
      },
    ],
  });
  const script = (scriptResult.choices[0].message.content as string).trim();
  return {
    type: "call_client_confirm",
    recipientName,
    recipientFirstName: firstName,
    recipientPhone,
    script,
    audience,
    cleanerJobId,
  } as CallClientConfirmResult;
}
async function draftClientMessage(messageHint: string | null, clientName: string): Promise<string> {
  const firstName = clientName.split(" ")[0];
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are drafting a short, professional SMS from a cleaning company to a client.
Keep it brief (1-3 sentences), friendly, and direct.
Address the client by first name.
Do NOT include a sign-off or company name.
Just write the message body.`,
      },
      {
        role: "user",
        content: `Draft an SMS to client ${firstName}. The dispatcher wants to: ${messageHint ?? "send a general message"}`,
      },
    ],
  });
  return (result.choices[0].message.content as string).trim();
}

// ── Query data handler ──────────────────────────────────────────────────────
async function handleQueryData(
  question: string,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  resolvedEntity?: { type: "cleaner"; cleanerProfileId: number; name: string }
): Promise<ConciergeResult> {
  const today = getTodayET();

  let entities: { customerName: string | null; cleanerName: string | null; dateHint: string | null; queryType: string };

  if (resolvedEntity) {
    // Cleaner was pre-resolved by the pill — skip LLM extraction entirely
    entities = { customerName: null, cleanerName: resolvedEntity.name, dateHint: null, queryType: "specific" };
    console.log("[QueryData] resolvedEntity (cleaner):", JSON.stringify(resolvedEntity));
  } else {
    // Step 1: extract search entities from the question
    const extractResult = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Extract search entities from a dispatcher's question about cleaning jobs. Return JSON only.
Rules:
- customerName: the name of a CLIENT/CUSTOMER (the person whose home is being cleaned)
- cleanerName: the name of a CLEANER, TEAM, or STAFF MEMBER (the person doing the cleaning). If the question is "jobs for [name]" or "what does [name] have today" and the name sounds like a person who works there (not a client), set cleanerName.
- When in doubt about whether a name is a customer or cleaner, set BOTH fields with the same name so the system can search both.
- dateHint: date reference like 'today', 'tomorrow', 'yesterday', 'July 10', else null`,
        },
        { role: "user", content: question },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "entities",
          strict: true,
          schema: {
            type: "object",
            properties: {
              customerName: { type: ["string", "null"], description: "Customer/client name if mentioned, else null" },
              cleanerName: { type: ["string", "null"], description: "Cleaner or team name if mentioned, else null" },
              dateHint: { type: ["string", "null"], description: "Date or relative term like 'today', 'yesterday', 'last week', 'July 10', else null" },
              queryType: { type: "string", enum: ["specific", "summary"], description: "specific = about a named person/team; summary = general counts or status across all jobs" },
            },
            required: ["customerName", "cleanerName", "dateHint", "queryType"],
            additionalProperties: false,
          },
        },
      },
    });
    try {
      entities = JSON.parse(extractResult.choices[0].message.content as string);
    } catch {
      entities = { customerName: null, cleanerName: null, dateHint: null, queryType: "summary" };
    }
    console.log("[QueryData] entities:", JSON.stringify(entities), "question:", question);
  }

  // Step 2: query both cleanerJobs (scheduled/active) and completedJobs (historical)
  // and merge results so customer history is always found regardless of which table it's in.

  // Helper: resolve a dateHint to a cutoff date string (YYYY-MM-DD)
  const resolveDateCutoff = (hint: string | null): string | null => {
    if (!hint) return null;
    const h = hint.toLowerCase();
    const d = new Date();
    if (h === "today") return today;
    if (h === "yesterday") { d.setDate(d.getDate() - 1); return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
    if (h.includes("last week") || h.includes("this week")) { d.setDate(d.getDate() - 7); return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
    if (h.includes("last month") || h.includes("this month")) { d.setDate(d.getDate() - 30); return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
    return null;
  };
  const dateCutoff = resolveDateCutoff(entities.dateHint);
  const hasSpecificFilter = !!(entities.customerName || entities.cleanerName) || !!resolvedEntity;
  // Default cutoff for summary queries: last 30 days
  const defaultCutoff = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); })();
  const effectiveCutoff = dateCutoff ?? (hasSpecificFilter ? null : defaultCutoff);

  // Query cleanerJobs (scheduled/upcoming/active jobs)
  const cjConditions: any[] = [
    ne(cleanerJobs.bookingStatus, "cancelled"),
    ne(cleanerJobs.bookingStatus, "rescheduled"),
  ];
  if (entities.customerName) cjConditions.push(like(cleanerJobs.customerName, `%${entities.customerName}%`));
  if (resolvedEntity) {
    // Resolved cleaner: query by cleanerProfileId — no name fallback
    cjConditions.push(eq(cleanerJobs.cleanerProfileId, resolvedEntity.cleanerProfileId));
  } else if (entities.cleanerName) {
    cjConditions.push(or(like(cleanerJobs.cleanerName, `%${entities.cleanerName}%`), like(cleanerJobs.teamName, `%${entities.cleanerName}%`)));
  }
  if (effectiveCutoff) cjConditions.push(gte(cleanerJobs.jobDate, effectiveCutoff));

  const scheduledJobs = await db
    .select({ id: cleanerJobs.id, jobDate: cleanerJobs.jobDate, teamName: cleanerJobs.teamName, cleanerName: cleanerJobs.cleanerName, customerName: cleanerJobs.customerName, jobAddress: cleanerJobs.jobAddress, serviceDateTime: cleanerJobs.serviceDateTime, jobStatus: cleanerJobs.jobStatus })
    .from(cleanerJobs)
    .where(and(...cjConditions))
    .orderBy(desc(cleanerJobs.jobDate))
    .limit(50);

  // Query completedJobs (historical bookings) — skipped when a cleaner is resolved (completedJobs.name is customer name)
  let historicalJobs: Array<{ id: number; jobDate: string | null; teamName: string | null; cleanerName: string | null; customerName: string | null; jobAddress: string | null; serviceDateTime: string | null; jobStatus: string | null }> = [];
  if (!resolvedEntity) {
    const compConditions: any[] = [];
    const nameSearch = entities.customerName || entities.cleanerName;
    if (nameSearch) compConditions.push(like(completedJobs.name, `%${nameSearch}%`));
    // Only apply date cutoff when NOT searching by a specific name
    if (!nameSearch && effectiveCutoff) compConditions.push(gte(completedJobs.jobDate, effectiveCutoff));

    const compRows = await db
      .select({ id: completedJobs.id, jobDate: completedJobs.jobDate, name: completedJobs.name, address: completedJobs.address, lastBookingPrice: completedJobs.lastBookingPrice, frequency: completedJobs.frequency, phone: completedJobs.phone })
      .from(completedJobs)
      .where(compConditions.length > 0 ? and(...compConditions) : undefined)
      .orderBy(desc(completedJobs.jobDate))
      .limit(hasSpecificFilter ? 50 : 30);

    // Backfill team data: match each completedJobs row to cleanerJobs by phone10 + jobDate
    const histPhones10 = [...new Set(compRows.map(r => r.phone?.replace(/\D/g, "").slice(-10)).filter(Boolean))] as string[];
    // Map: "phone10|jobDate" -> teamName
    const teamByPhoneDate = new Map<string, string>();
    if (histPhones10.length > 0) {
      const teamRows = await db
        .select({ customerPhone: cleanerJobs.customerPhone, teamName: cleanerJobs.teamName, cleanerName: cleanerJobs.cleanerName, jobDate: cleanerJobs.jobDate })
        .from(cleanerJobs)
        .where(inArray(sql`RIGHT(REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', ''), 10)`, histPhones10))
        .orderBy(desc(cleanerJobs.jobDate))
        .limit(histPhones10.length * 20);
      for (const tr of teamRows) {
        const p10 = (tr.customerPhone ?? "").replace(/\D/g, "").slice(-10);
        const key = `${p10}|${tr.jobDate ?? ""}`;
        if (p10 && tr.jobDate && !teamByPhoneDate.has(key)) {
          teamByPhoneDate.set(key, tr.teamName ?? tr.cleanerName ?? "");
        }
      }
    }

    historicalJobs = compRows.map(r => {
      const p10 = (r.phone ?? "").replace(/\D/g, "").slice(-10);
      const key = `${p10}|${r.jobDate ?? ""}`;
      const team = teamByPhoneDate.get(key) ?? null;
      return {
        id: r.id,
        jobDate: r.jobDate ?? null,
        teamName: team,
        cleanerName: null,
        customerName: r.name ?? null,
        jobAddress: r.address ?? null,
        serviceDateTime: null,
        jobStatus: `completed (${r.frequency ?? "one-time"}, $${r.lastBookingPrice ?? "?"})`
      };
    });
  }

  console.log("[QueryData] scheduledJobs:", scheduledJobs.length, "historicalJobs:", historicalJobs.length);
  // Deduplicate: if a job appears in both cleanerJobs (scheduled) and completedJobs (historical)
  // for the same customer+date+address, prefer the cleanerJobs row (has team data)
  const scheduledKeys = new Set(scheduledJobs.map(j => `${(j.jobAddress ?? "").toLowerCase().slice(0, 30)}|${j.jobDate ?? ""}`));
  const dedupedHistorical = historicalJobs.filter(j => {
    const key = `${(j.jobAddress ?? "").toLowerCase().slice(0, 30)}|${j.jobDate ?? ""}`;
    return !scheduledKeys.has(key);
  });
  const jobs = [...scheduledJobs, ...dedupedHistorical]
    .sort((a, b) => (b.jobDate ?? "").localeCompare(a.jobDate ?? ""))
    .slice(0, 80);

  if (jobs.length === 0) {
    return { type: "query_result", answer: "No matching jobs found in either scheduled or historical records." };
  }

  const jobSummary = jobs.map(j => ({
    id: j.id,
    date: j.jobDate,
    team: j.teamName ?? j.cleanerName,
    cleaner: j.cleanerName,
    customer: j.customerName ?? "Unknown",
    address: j.jobAddress ?? "—",
    time: j.serviceDateTime ?? "—",
    status: j.jobStatus ?? "not started",
  }));

  // Step 3: answer the question using only the matched rows
  const llmResult = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an operations assistant for a cleaning company. Answer the dispatcher's question using only the provided job data. If the answer cannot be determined from the data, say so. Do not invent information. Today is ${today}. Be concise and direct.

Formatting rules:
- Never show Job IDs
- For each job show: date, address, team/cleaner, and dollar amount (from status field)
- List jobs in reverse chronological order
- Use plain text, no markdown headers`
      },
      {
        role: "user",
        content: `Job data:\n${JSON.stringify(jobSummary, null, 2)}\n\nDispatcher question: ${question}`,
      },
    ],
  });

  const answer = (llmResult.choices[0].message.content as string).trim();
  return {
    type: "query_result",
    answer,
    rows: jobs.map(j => ({
      id: j.id,
      jobDate: j.jobDate,
      teamName: j.teamName,
      cleanerName: j.cleanerName,
      customerName: j.customerName,
      jobAddress: j.jobAddress,
      serviceDateTime: j.serviceDateTime,
      jobStatus: j.jobStatus,
    })),
  };
}

// ── Customer profile handler ────────────────────────────────────────────────
async function handleCustomerProfile(
  name: string,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConciergeResult> {
  // Delegate to the opsChatRouter.getCustomerProfile procedure logic directly
  // by calling the same DB queries inline (avoid circular imports)
  const { invokeLLM: llm } = await import("./_core/llm");
  const { conversationSessions, openphoneCallRecordings: opCR, fieldMgmtCalls: fmc } = await import("../drizzle/schema");
  const { desc: d2, eq: eq2, like: like2, inArray: inArray2, sql: sql2 } = await import("drizzle-orm");

  const digits10 = (p: string) => p.replace(/[^\d]/g, "").slice(-10);
  const q = `%${name.trim()}%`;

  // 1. Resolve phone
  const nameRows = await db.select({ phone: completedJobs.phone, name: completedJobs.name }).from(completedJobs).where(like2(completedJobs.name, q)).orderBy(d2(completedJobs.jobDate)).limit(1);
  let phone: string | null = nameRows[0]?.phone ?? null;
  let resolvedName: string = nameRows[0]?.name ?? name;
  if (!phone) {
    const cjRow = await db.select({ customerPhone: cleanerJobs.customerPhone, customerName: cleanerJobs.customerName }).from(cleanerJobs).where(like2(cleanerJobs.customerName, q)).orderBy(d2(cleanerJobs.jobDate)).limit(1);
    if (cjRow[0]?.customerPhone) {
      const p10 = digits10(cjRow[0].customerPhone);
      phone = `+1${p10}`;
      resolvedName = cjRow[0].customerName ?? name;
    }
  }
  if (!phone) {
    return { type: "error", message: `No customer found matching "${name}". Try their full name.` };
  }

  const phone10 = digits10(phone);
  const e164 = phone.startsWith("+") ? phone : `+1${phone10}`;

  // 2. completedJobs history
  const historyRows = await db.select({ jobDate: completedJobs.jobDate, serviceType: completedJobs.serviceType, lastBookingPrice: completedJobs.lastBookingPrice, frequency: completedJobs.frequency, address: completedJobs.address }).from(completedJobs).where(eq2(completedJobs.phone, e164)).orderBy(d2(completedJobs.jobDate)).limit(20);
  const totalBookings = historyRows.length;
  const ltv = historyRows.reduce((s, r) => s + (r.lastBookingPrice ?? 0), 0);
  const avgPrice = totalBookings > 0 ? Math.round(ltv / totalBookings) : null;
  const latestFrequency = historyRows[0]?.frequency ?? null;
  const latestAddress = historyRows[0]?.address ?? null;

  // 3. cleanerJobs
  const cjRows = await db.select({ jobDate: cleanerJobs.jobDate, serviceType: cleanerJobs.serviceType, jobRevenue: cleanerJobs.jobRevenue, customerRating: cleanerJobs.customerRating, teamName: cleanerJobs.teamName, cleanerName: cleanerJobs.cleanerName, jobStatus: cleanerJobs.jobStatus, jobAddress: cleanerJobs.jobAddress, serviceDateTime: cleanerJobs.serviceDateTime }).from(cleanerJobs).where(sql2`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') = ${phone10}`).orderBy(d2(cleanerJobs.jobDate)).limit(20);

  const teamCounts = new Map<string, number>();
  for (const r of cjRows) { if (r.teamName) teamCounts.set(r.teamName, (teamCounts.get(r.teamName) ?? 0) + 1); }
  const usualTeam = teamCounts.size > 0 ? Array.from(teamCounts.entries()).sort((a, b) => b[1] - a[1])[0][0] : null;

  const lastJobsFromCj = cjRows.slice(0, 5).map(r => ({ jobDate: r.jobDate, serviceType: r.serviceType, price: r.jobRevenue ? Math.round(parseFloat(r.jobRevenue)) : null, rating: r.customerRating ?? null, teamName: r.teamName ?? r.cleanerName ?? null }));
  const lastJobsFromHistory = historyRows.slice(0, 5).map(r => ({ jobDate: r.jobDate, serviceType: r.serviceType, price: r.lastBookingPrice ?? null, rating: null as number | null, teamName: null as string | null }));
  const lastJobs = [...lastJobsFromCj, ...lastJobsFromHistory].sort((a, b) => (b.jobDate ?? "").localeCompare(a.jobDate ?? "")).slice(0, 5);

  const nowET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const upcomingJob = cjRows.find(r => (r.jobDate ?? "") >= nowET) ?? null;

  // 4. conversationSessions
  const sessionRows = await db.select({ messageHistory: conversationSessions.messageHistory, csMemoryCache: conversationSessions.csMemoryCache, updatedAt: conversationSessions.updatedAt }).from(conversationSessions).where(sql2`RIGHT(REGEXP_REPLACE(${conversationSessions.leadPhone}, '[^0-9]', ''), 10) = ${phone10}`).orderBy(d2(conversationSessions.updatedAt)).limit(3);
  const lastMessages: Array<{ content: string; ts: number | null }> = [];
  for (const sess of sessionRows) {
    if (lastMessages.length >= 3) break;
    try {
      const history: Array<{ role: string; content: string; ts?: number }> = JSON.parse(sess.messageHistory ?? "[]");
      const userMsgs = history.filter(m => m.role === "user").slice(-3).reverse();
      for (const m of userMsgs) { if (lastMessages.length >= 3) break; lastMessages.push({ content: m.content, ts: m.ts ?? null }); }
    } catch { /* skip */ }
  }
  let aiMemoryBullets: string[] = [];
  const bestSession = sessionRows.find(s => s.csMemoryCache != null) ?? sessionRows[0];
  if (bestSession?.csMemoryCache) {
    try { const p = JSON.parse(bestSession.csMemoryCache); if (Array.isArray(p)) aiMemoryBullets = p.filter((b: unknown) => typeof b === "string"); } catch { /* skip */ }
  }

  // 5. OpenPhone calls
  const opCalls = await db.select({ direction: opCR.direction, durationSeconds: opCR.durationSeconds, callStartedAt: opCR.callStartedAt, callDebrief: opCR.callDebrief }).from(opCR).where(eq2(opCR.callerPhone, e164)).orderBy(d2(opCR.callStartedAt)).limit(5);

  // 6. Vapi calls
  const fmcRows = await db.select({ step: fmc.step, outcome: fmc.outcome, summary: fmc.summary, durationSeconds: fmc.durationSeconds, createdAt: fmc.createdAt }).from(fmc).where(sql2`${fmc.cleanerJobId} IN (SELECT id FROM cleaner_jobs WHERE REGEXP_REPLACE(customerPhone, '[^0-9]', '') = ${phone10} LIMIT 10)`).orderBy(d2(fmc.createdAt)).limit(5);

  // 7. AI summary
  const contextLines = [`Customer: ${resolvedName}`, `Total cleans: ${totalBookings}`, `LTV: $${ltv}`, `Frequency: ${latestFrequency ?? "unknown"}`, `Usual team: ${usualTeam ?? "unknown"}`, `Last job: ${lastJobs[0]?.jobDate ?? "unknown"}`, upcomingJob ? `Upcoming: ${upcomingJob.jobDate} — ${upcomingJob.jobStatus ?? "scheduled"}` : "No upcoming job"];
  const llmResult = await llm({ messages: [{ role: "system", content: "You are a concise CRM assistant for a home cleaning company. Write 2 sentences max. Be specific and actionable." }, { role: "user", content: `Summarize this customer and recommend the single best next action:\n${contextLines.join("\n")}` }] });
  const aiSummary = (llmResult?.choices?.[0]?.message?.content as string ?? "").trim();

  return {
    type: "customer_profile" as const,
    profile: {
      name: resolvedName,
      phone: e164,
      address: latestAddress,
      frequency: latestFrequency,
      totalBookings,
      ltv,
      avgPrice,
      usualTeam,
      isVip: totalBookings >= 10 || ltv >= 2000,
      lastJobs,
      upcomingJob: upcomingJob ? { jobDate: upcomingJob.jobDate, serviceDateTime: upcomingJob.serviceDateTime, jobStatus: upcomingJob.jobStatus, teamName: upcomingJob.teamName ?? upcomingJob.cleanerName ?? null, jobAddress: upcomingJob.jobAddress } : null,
      lastMessages,
      aiMemoryBullets,
      openPhoneCalls: opCalls.map(c => ({ direction: c.direction, durationSeconds: c.durationSeconds, callStartedAt: c.callStartedAt, callDebrief: c.callDebrief })),
      vapiCalls: fmcRows.map(c => ({ step: c.step, outcome: c.outcome, summary: c.summary, durationSeconds: c.durationSeconds, createdAt: c.createdAt })),
      aiSummary,
    },
  };
}

// ── Text cleaners handler ─────────────────────────────────────────────────────
async function handleTextCleaners(
  plan: QueryPlan,
  messageHint: string | null,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConciergeResult> {
  const { recipients, targetDescription } = await resolveTextTargets(plan, db);

  if (recipients.length === 0) {
    return { type: "error", message: `No cleaners found matching "${plan.targetHint ?? "your request"}". Try "working today" or a specific name.` };
  }

  const draftMessage = await draftCleanerMessage(messageHint, targetDescription, recipients);

  return {
    type: "bulk_sms_confirm",
    targetDescription,
    recipients,
    draftMessage,
  };
}

// ── ETA for customer: look up today's job, find assigned team, kick ETA call ──
async function handleGetEtaForCustomer(
  clientName: string | null,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConciergeResult> {
  if (!clientName) {
    return { type: "error", message: "Please include the customer's name. Example: \"Get ETA for Mary Jones\"" };
  }
  const today = getTodayET();
  // Find today's cleanerJobs row for this customer
  const q = `%${clientName.trim()}%`;
  const [job] = await db
    .select({
      id: cleanerJobs.id,
      customerName: cleanerJobs.customerName,
      teamName: cleanerJobs.teamName,
      cleanerName: cleanerJobs.cleanerName,
      serviceDateTime: cleanerJobs.serviceDateTime,
      jobAddress: cleanerJobs.jobAddress,
      cleanerPhone: cleanerProfiles.phone,
    })
    .from(cleanerJobs)
    .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
    .where(
      and(
        eq(cleanerJobs.jobDate, today),
        like(cleanerJobs.customerName, q),
        ne(cleanerJobs.bookingStatus, "cancelled"),
        ne(cleanerJobs.bookingStatus, "rescheduled")
      )
    )
    .orderBy(cleanerJobs.serviceDateTime)
    .limit(1);

  if (!job) {
    // Fall back: maybe clientName is a cleaner/team name, not a customer
    return await handleEtaUpdate(clientName, db);
  }
  if (!job.cleanerPhone) {
    return { type: "error", message: `Found ${job.customerName}'s job (${job.teamName ?? job.cleanerName}) but no phone number on file for the team.` };
  }
  if (!job.serviceDateTime) {
    return { type: "error", message: `${job.customerName}'s job has no service time set.` };
  }
  const serviceTime = parseServiceDateTime(job.serviceDateTime);
  if (!serviceTime) return { type: "error", message: "Could not parse service time for this job." };
  const scheduledTimeET = formatTimeET(serviceTime);
  const cleanerFirstName = (job.cleanerName ?? "there").split(" ")[0];
  const customerFirstName = (job.customerName ?? clientName).split(" ")[0];
  const teamName = job.teamName ?? job.cleanerName ?? "Unknown Team";

  const result = await placeEtaCall({
    cleanerJobId: job.id,
    step: "eta_call_1",
    cleanerPhone: job.cleanerPhone,
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
    jobId: job.id,
    teamName,
    cleanerName: job.cleanerName ?? teamName,
    scheduledTimeET,
    date: today,
  };
}

// ── ETA update handler ────────────────────────────────────────────────────────
async function handleEtaUpdate(
  teamHint: string | null,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConciergeResult> {
  const teams = await getTeamsForDate(db, today);
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

// ── Rank teams handler ───────────────────────────────────────────────────────
async function handleRankTeams(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): Promise<TeamRatingsResult> {
  const WINDOW_DAYS = 90;
  const MIN_RATINGS = 8;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - WINDOW_DAYS);
  const fromDate = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  const jobs = await db
    .select({
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      customerRating: cleanerJobs.customerRating,
    })
    .from(cleanerJobs)
    .where(
      and(
        sql`${cleanerJobs.jobDate} >= ${fromDate}`,
        ne(cleanerJobs.cleanerProfileId, 0),
      )
    );

  // Group by cleanerProfileId
  const byProfile = new Map<number, { name: string; ratings: number[]; totalJobs: number }>();
  for (const j of jobs) {
    if (!j.cleanerProfileId) continue;
    const existing = byProfile.get(j.cleanerProfileId);
    if (existing) {
      existing.totalJobs++;
      if (j.customerRating !== null) existing.ratings.push(j.customerRating);
    } else {
      byProfile.set(j.cleanerProfileId, {
        name: j.cleanerName ?? `Cleaner #${j.cleanerProfileId}`,
        ratings: j.customerRating !== null ? [j.customerRating] : [],
        totalJobs: 1,
      });
    }
  }

  // Filter to cleaners with >= MIN_RATINGS rated jobs, compute avg
  const qualified: Array<{ cleanerName: string; avgRating: number; ratedJobs: number; totalJobs: number }> = [];
  let excluded = 0;
  for (const c of byProfile.values()) {
    if (c.ratings.length < MIN_RATINGS) {
      excluded++;
      continue;
    }
    const avg = c.ratings.reduce((s, r) => s + r, 0) / c.ratings.length;
    qualified.push({
      cleanerName: c.name,
      avgRating: Math.round(avg * 10) / 10,
      ratedJobs: c.ratings.length,
      totalJobs: c.totalJobs,
    });
  }

  // Sort by avgRating descending
  qualified.sort((a, b) => b.avgRating - a.avgRating);

  const rows = qualified.map((c, i) => ({ rank: i + 1, ...c }));

  return { type: "rank_teams", windowDays: WINDOW_DAYS, minRatings: MIN_RATINGS, rows, excluded };
}

// ── Card status handler ───────────────────────────────────────────────────────
async function handleCardStatus(
  plan: QueryPlan,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): Promise<CardStatusResult> {
  const { startDate } = resolveServiceDateRange(plan.timeScope);
  const jobs = await db
    .select({
      customerName: cleanerJobs.customerName,
      cardBrand: cleanerJobs.paymentBrand,
      last4: cleanerJobs.paymentLast4,
      hasStripeCard: cleanerJobs.hasStripeCard,
      chargesOnHoldCents: cleanerJobs.chargesOnHoldCents,
    })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.jobDate, startDate));

  // Deduplicate by customerName (one row per customer per date)
  const seen = new Set<string>();
  const rows = jobs
    .filter(j => {
      const key = j.customerName ?? "";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(j => ({
      customerName: j.customerName ?? "Unknown",
      cardBrand: j.cardBrand ?? null,
      last4: j.last4 ?? null,
      status: (
        j.chargesOnHoldCents > 0 ? "on_hold" :
        j.hasStripeCard ? "no_preauth" :
        "no_card"
      ) as "on_hold" | "no_preauth" | "no_card",
      amountCents: j.chargesOnHoldCents,
    }))
    // Sort: on_hold first, then no_preauth, then no_card
    .sort((a, b) => {
      const order = { on_hold: 0, no_preauth: 1, no_card: 2 };
      return order[a.status] - order[b.status];
    });

  return { type: "card_status", date: startDate, rows };
}

// ── List teams with no confirmed ETA ──────────────────────────────────────
async function handleListNoEta(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): Promise<NoEtaResult> {
  const today = getTodayET();
  const nowMs = Date.now();

  // 1. Fetch all active jobs for today
  const jobs = await db
    .select({
      id: cleanerJobs.id,
      cleanerName: cleanerJobs.cleanerName,
      teamName: cleanerJobs.teamName,
      serviceDateTime: cleanerJobs.serviceDateTime,
      jobStatus: cleanerJobs.jobStatus,
      etaCallFiredAt: cleanerJobs.etaCallFiredAt,
    })
    .from(cleanerJobs)
    .where(and(
      eq(cleanerJobs.jobDate, today),
      ne(cleanerJobs.bookingStatus, "cancelled"),
      ne(cleanerJobs.bookingStatus, "rescheduled"),
    ))
    .orderBy(cleanerJobs.serviceDateTime);

  if (jobs.length === 0) return { type: "list_no_eta", date: today, rows: [] };

  // 2. Fetch all eta_call_result cards for today's jobs
  const jobIds = jobs.map(j => j.id);
  const etaCardRows = await db
    .select({
      id: opsChatMessages.id,
      cleanerJobId: opsChatMessages.cleanerJobId,
      metadata: opsChatMessages.metadata,
      createdAt: opsChatMessages.createdAt,
    })
    .from(opsChatMessages)
    .where(and(
      inArray(opsChatMessages.cleanerJobId as any, jobIds),
      eq(opsChatMessages.quickAction as any, "eta_call_result")
    ))
    .orderBy(desc(opsChatMessages.createdAt), desc(opsChatMessages.id));

  // 3. Priority-aware card selection (mirrors fieldMgmtRouter logic)
  function etaCardPriority(resultType: string): number {
    if (resultType === "success") return 0;
    if (resultType === "no_answer" || resultType === "dispatcher_needed") return 1;
    return 2;
  }

  const latestEtaCardByJob = new Map<number, { resultType: string; etaStatus: string | null }>();
  for (const row of etaCardRows) {
    if (!row.cleanerJobId) continue;
    let meta: { resultType?: string; etaStatus?: string | null } = {};
    try { meta = JSON.parse(row.metadata ?? "{}"); } catch { /* ignore */ }
    const resultType = meta.resultType ?? "unclear";
    const existing = latestEtaCardByJob.get(row.cleanerJobId);
    if (!existing || etaCardPriority(resultType) < etaCardPriority(existing.resultType)) {
      latestEtaCardByJob.set(row.cleanerJobId, { resultType, etaStatus: meta.etaStatus ?? null });
    }
  }

  // 4. Group by team, pick current job per team
  const teamMap = new Map<string, { teamName: string; cleanerName: string; jobs: typeof jobs }>();
  for (const j of jobs) {
    const key = j.teamName ?? j.cleanerName;
    if (!teamMap.has(key)) {
      teamMap.set(key, { teamName: key, cleanerName: j.cleanerName, jobs: [] });
    }
    teamMap.get(key)!.jobs.push(j);
  }

  const rows: NoEtaResult["rows"] = [];

  for (const team of teamMap.values()) {
    const currentJob = team.jobs.find(j =>
      (j.jobStatus as string) !== "completed" && (j.jobStatus as string) !== "cancelled"
    ) ?? team.jobs[team.jobs.length - 1];

    // Skip teams already on-site or done
    const jobSt = currentJob.jobStatus as string;
    if (jobSt === "arrived" || jobSt === "in_progress" || jobSt === "completed") continue;

    const card = latestEtaCardByJob.get(currentJob.id);

    // If there's a confirmed success ETA, skip this team
    if (card && card.resultType === "success" && card.etaStatus && card.etaStatus !== "unclear") {
      continue;
    }

    let etaStatus: "pending" | "unclear" | "no_answer" = "pending";
    if (card) {
      if (card.resultType === "no_answer" || card.resultType === "dispatcher_needed") {
        etaStatus = "no_answer";
      } else {
        etaStatus = "unclear";
      }
    } else if (currentJob.etaCallFiredAt) {
      etaStatus = "unclear";
    }

    const serviceTime = currentJob.serviceDateTime ? parseServiceDateTime(currentJob.serviceDateTime) : null;
    const scheduledTime = serviceTime ? formatTimeET(serviceTime) : "—";
    const isPastScheduled = serviceTime ? serviceTime.getTime() < nowMs : false;

    rows.push({
      teamName: team.teamName,
      cleanerName: team.cleanerName,
      scheduledTime,
      serviceDateTime: currentJob.serviceDateTime,
      etaStatus,
      isPastScheduled,
      currentJobId: currentJob.id,
    });
  }

  // Past-scheduled first, then by time
  rows.sort((a, b) => {
    if (a.isPastScheduled !== b.isPastScheduled) return a.isPastScheduled ? -1 : 1;
    return (a.serviceDateTime ?? "").localeCompare(b.serviceDateTime ?? "");
  });

  return { type: "list_no_eta", date: today, rows };
}

// ── Confirmation texts handler ───────────────────────────────────────────────

function resolveConfirmationDate(timeScope: QueryPlan["timeScope"]): { date: string; dateLabel: string } {
  const today = getTodayET();
  if (!timeScope || !timeScope.type || timeScope.type === "today") return { date: today, dateLabel: "today" };
  if (timeScope.type === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const date = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    return { date, dateLabel: "tomorrow" };
  }
  if (timeScope.type === "specific_date" && timeScope.specificDate) {
    return { date: timeScope.specificDate, dateLabel: timeScope.specificDate };
  }
  return { date: today, dateLabel: "today" };
}

async function handleConfirmationTexts(
  plan: QueryPlan,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConfirmationTextsResult> {
  const { date, dateLabel } = resolveConfirmationDate(plan.timeScope);

  // Fetch all jobs for the date
  const jobs = await db
    .select({
      id: cleanerJobs.id,
      customerName: cleanerJobs.customerName,
      customerPhone: cleanerJobs.customerPhone,
      serviceDateTime: cleanerJobs.serviceDateTime,
      teamName: cleanerJobs.teamName,
    })
    .from(cleanerJobs)
    .where(and(
      eq(cleanerJobs.jobDate, date),
      ne(cleanerJobs.bookingStatus, "cancelled"),
      ne(cleanerJobs.bookingStatus, "rescheduled"),
    ))
    .orderBy(cleanerJobs.serviceDateTime, cleanerJobs.customerName);

  if (jobs.length === 0) return { type: "confirmation_texts", date, dateLabel, rows: [] };

  // Fetch existing confirmation records for this date
  const existingCalls = await db
    .select({
      cleanerJobId: confirmationCalls.cleanerJobId,
      calledPhone: confirmationCalls.calledPhone,
      clientName: confirmationCalls.clientName,
      id: confirmationCalls.id,
      smsFollowupSent: confirmationCalls.smsFollowupSent,
      smsConfirmedAt: confirmationCalls.smsConfirmedAt,
    })
    .from(confirmationCalls)
    .where(eq(confirmationCalls.jobDate, date))
    .orderBy(desc(confirmationCalls.firedAt));

  const { matchConfirmationCallsToJobs } = await import("./confirmationMatchHelper");
  const confCallByJobId = matchConfirmationCallsToJobs(jobs, existingCalls);

  const rows = jobs.map(job => {
    const cc = confCallByJobId.get(job.id) ?? null;
    return {
      cleanerJobId: job.id,
      customerName: job.customerName ?? "Unknown",
      customerPhone: job.customerPhone ?? null,
      serviceDateTime: job.serviceDateTime ?? null,
      teamName: job.teamName ?? null,
      alreadySent: cc ? (cc.smsFollowupSent === 1) : false,
      smsConfirmedAt: cc ? (cc.smsConfirmedAt ?? null) : null,
    };
  });

  return { type: "confirmation_texts", date, dateLabel, rows };
}

async function handleConfirmationResults(
  plan: QueryPlan,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConfirmationResultsResult> {
  const { date, dateLabel } = resolveConfirmationDate(plan.timeScope);

  const rows = await db
    .select({
      clientName: confirmationCalls.clientName,
      calledPhone: confirmationCalls.calledPhone,
      smsFollowupSent: confirmationCalls.smsFollowupSent,
      smsConfirmedAt: confirmationCalls.smsConfirmedAt,
      smsReply: confirmationCalls.smsReply,
      aiOutcome: confirmationCalls.aiOutcome,
      aiOutcomeLabel: confirmationCalls.aiOutcomeLabel,
      manualOutcome: confirmationCalls.manualOutcome,
      manualOutcomeLabel: confirmationCalls.manualOutcomeLabel,
      firedAt: confirmationCalls.firedAt,
    })
    .from(confirmationCalls)
    .where(eq(confirmationCalls.jobDate, date))
    .orderBy(desc(confirmationCalls.firedAt));

  const totalSent = rows.filter(r => r.smsFollowupSent === 1).length;
  const totalConfirmed = rows.filter(r => {
    const outcome = r.manualOutcome ?? r.aiOutcome;
    return outcome === "confirmed" || r.smsConfirmedAt != null;
  }).length;
  const totalPending = totalSent - totalConfirmed;

  return { type: "confirmation_results", date, dateLabel, rows, totalSent, totalConfirmed, totalPending };
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
        resolvedClientPhone: z.string().optional(),
        resolvedClientMessageHint: z.string().nullable().optional(),
        resolvedPaymentLink: z.boolean().optional(),
        resolvedClientName: z.string().optional(),
        resolvedCallClient: z.boolean().optional(),
        resolvedCallPersonName: z.string().optional(),
        resolvedCallQuestionHint: z.string().nullable().optional(),
        resolvedEntity: z.discriminatedUnion("type", [
          z.object({ type: z.literal("customer"), phone: z.string(), name: z.string() }),
          z.object({ type: z.literal("cleaner"), cleanerProfileId: z.number(), name: z.string() }),
        ]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      if (input.resolvedJobId) {
        return await handleEtaUpdateByJobId(input.resolvedJobId, db);
      }

      // Legacy resolvedClientPhone path (disambiguation card flows — entity already resolved upstream)
      if (input.resolvedClientPhone) {
        if (input.resolvedPaymentLink) {
          const plResult = await handleSendPaymentLink(null, db, input.resolvedClientPhone, input.resolvedClientName);
          if (plResult.type === "payment_link_confirm") return { ...plResult, command: input.message };
          return plResult;
        }
        if (input.resolvedCallClient) {
          return await handleCallPerson(null, input.resolvedCallQuestionHint ?? null, db, input.resolvedClientPhone, input.resolvedCallPersonName);
        }
        const textClientResult = await handleTextClient(null, input.resolvedClientMessageHint ?? null, db, input.resolvedClientPhone);
        if (textClientResult.type === "bulk_sms_confirm") return { ...textClientResult, command: input.message };
        return textClientResult;
      }

      // resolvedEntity = chip-attached person (already resolved by the UI).
      // Intent classification always runs — the chip is injected only as the pre-resolved
      // target for the matching intent. Strict type guards prevent cross-type mismatches.
      // When the chip type conflicts with the classified intent, fall back to the
      // unresolved handler so the LLM-extracted name is used instead.
      const re = input.resolvedEntity ?? null;
      // Use new unified parser — replaces classifyIntent for all intents
      const rawPlan = await parseConciergeRequest(input.message);
      // Validate and normalize: resolve contradictions before dispatch
      const { plan, corrected, correction } = validateAndNormalizePlan(rawPlan, re);
      if (corrected && correction) {
        console.log(`[Concierge] Plan corrected: ${correction.originalAction} → ${correction.correctedAction} (${correction.reason}) [evidence: ${correction.evidenceSource}]`);
      }
      // Backward-compat: map plan to legacy intent shape for action handlers
      const intent = {
        action: plan.action === "query" ? "query_data" : plan.action,
        teamHint: plan.teamHint,
        targetHint: plan.targetHint,
        clientName: plan.clientName,
        messageHint: plan.messageHint,
        questionHint: plan.questionHint,
        targetType: plan.targetType,
      } as const;
      console.log("[Concierge] plan:", JSON.stringify({ action: plan.action, targetType: plan.targetType, fields: plan.requestedFields, timeScope: plan.timeScope.type, entities: plan.entities }), "resolvedEntity:", re ? `${re.type}:${re.type === "customer" ? re.phone : re.cleanerProfileId}` : "none", "message:", input.message);

      if (intent.action === "eta_update") {
        return await handleEtaUpdate(intent.teamHint, db);
      }
      if (intent.action === "get_eta_for_customer") {
        return await handleGetEtaForCustomer(intent.clientName, db);
      }

      if (intent.action === "text_cleaners") {
        // Use chip only when it is a cleaner entity; customer chip → fall back to LLM name
        const textCleanersResult = re?.type === "cleaner"
          ? await handleTextCleaners({ ...plan, targetHint: re.name }, intent.messageHint, db)
          : await handleTextCleaners(plan, intent.messageHint, db);
        if (textCleanersResult.type === "bulk_sms_confirm") {
          return { ...textCleanersResult, command: input.message };
        }
        return textCleanersResult;
      }

      if (intent.action === "text_client") {
        // If locked entity is a cleaner, route to handleTextCleaners — not customer search
        if (re?.type === "cleaner") {
          const r = await handleTextCleaners({ ...plan, targetHint: re.name }, intent.messageHint, db);
          if (r.type === "bulk_sms_confirm") return { ...r, command: input.message };
          return r;
        }
        const textClientResult = re?.type === "customer"
          ? await handleTextClient(null, intent.messageHint, db, re.phone)
          : await handleTextClient(intent.clientName, intent.messageHint, db);
        if (textClientResult.type === "bulk_sms_confirm") {
          return { ...textClientResult, command: input.message };
        }
        return textClientResult;
      }

      if (intent.action === "send_payment_link") {
        // Use chip only when it is a customer entity; cleaner chip → fall back to LLM name
        const paymentLinkResult = re?.type === "customer"
          ? await handleSendPaymentLink(null, db, re.phone, re.name)
          : await handleSendPaymentLink(intent.clientName, db);
        if (paymentLinkResult.type === "payment_link_confirm") {
          return { ...paymentLinkResult, command: input.message };
        }
        return paymentLinkResult;
      }

      if (intent.action === "call_client") {
        // Use chip only when it is a customer entity; cleaner chip → fall back to LLM name
        return re?.type === "customer"
          ? await handleCallPerson(null, intent.questionHint, db, re.phone, re.name)
          : await handleCallPerson(intent.clientName, intent.questionHint, db);
      }

      if (plan.action === "card_status") {
        return await handleCardStatus(plan, db);
      }
      if (plan.action === "rank_teams") {
        return await handleRankTeams(db);
      }
      if (plan.action === "list_no_eta") {
        return await handleListNoEta(db);
      }
      if (plan.action === "confirmation_texts") {
        return await handleConfirmationTexts(plan, db);
      }
      if (plan.action === "confirmation_results") {
        return await handleConfirmationResults(plan, db);
      }
      if (plan.action === "query") {
        // New unified query path — replaces both query_data and customer_profile
        const chipEntity = re?.type === "customer"
          ? { type: "customer" as const, name: re.name, phone: re.phone, phone10: re.phone.replace(/\D/g, "").slice(-10) }
          : re?.type === "cleaner"
            ? { type: "cleaner" as const, name: re.name, cleanerProfileId: re.cleanerProfileId }
            : undefined;
        const queryResult = await resolveQuery(plan, db, input.message, chipEntity);
        if (queryResult.type === "clarification") {
          return {
            type: "error" as const,
            message: queryResult.question,
          };
        }
        return {
          type: "query_result" as const,
          answer: queryResult.answer,
          status: queryResult.status,
        };
      }
      return {
        type: "error" as const,
        message: "I can handle ETA updates, texting cleaners, texting clients, sending payment links, calling clients or cleaners, answering questions about today's jobs, and pulling up customer profiles. Try: \"Tell me about Mary Jones\", \"List all jobs today\", \"Send ETA for Team 8\", \"Text Abigail Avrick\", or \"Call Rohan Gilkes\".",
      };
    }),

  /**
   * Send payment link SMS after agent confirms.
   * Called when agent clicks "Send" on the payment_link_confirm card.
   */
  sendPaymentLinkSms: agentProcedure
    .input(
      z.object({
        recipientPhone: z.string().min(7).max(30),
        recipientName: z.string(),
        smsText: z.string().min(1).max(1600),
        paymentLinkUrl: z.string(),
        /** Original user command from the confirm card — used for mission persistence */
        command: z.string().optional(),
      })
    )
        .mutation(async ({ ctx, input }) => {
      const startedAt = new Date();
      try {
        const result = await sendSms({
          to: input.recipientPhone,
          content: input.smsText,
          fromNumberId: ENV.openPhoneCsNumberId,
        });
        if (result.success) {
          const db = await getDb();
          if (db) {
            appendCsOutboundMessage({
              db: db as any,
              recipientPhone: input.recipientPhone,
              recipientName: input.recipientName,
              message: input.smsText,
              senderName: ctx.user?.name ?? "Agent",
              openPhoneMessageId: result.messageId,
            }).catch(console.error);
          }
        }
        const missionMeta = createMissionMetadata({
          title: `Payment Link → ${input.recipientName}`,
          startedAt,
          status: result.success ? "completed" : "failed",
          summary: result.success
            ? `Payment link sent to ${input.recipientName} (${input.recipientPhone.slice(-4)}).`
            : `Failed to send payment link to ${input.recipientName}.`,
          steps: [
            { id: crypto.randomUUID(), label: "Generated secure payment link", status: "completed" },
            {
              id: crypto.randomUUID(),
              label: `Sent link to ${input.recipientName}`,
              status: result.success ? "completed" : "failed",
              detail: result.success ? input.smsText : "SMS delivery failed",
            },
          ],
        });
        // Persist mission only after SMS side effect is complete.
        // Persistence failure must NOT cause the action to appear failed.
        let mission: MissionMetadata | null = missionMeta;
        let missionPersistenceError = false;
        if (result.success) {
          const saved = await createAndSaveMission(
            missionMeta,
            ctx.agent.agentId,
            input.command ?? `Send payment link to ${input.recipientName}`,
            "chat"
          );
          if (saved === null) missionPersistenceError = true;
          mission = saved ?? missionMeta;
        }
        return {
          type: "payment_link_sent" as const,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          paymentLinkUrl: input.paymentLinkUrl,
          success: result.success,
          mission,
          ...(missionPersistenceError ? { missionPersistenceError: true } : {}),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const missionMeta = createMissionMetadata({
          title: `Payment Link → ${input.recipientName}`,
          startedAt,
          status: "failed",
          summary: `Failed to send payment link to ${input.recipientName}: ${msg}`,
          steps: [
            { id: crypto.randomUUID(), label: "Generated secure payment link", status: "completed" },
            { id: crypto.randomUUID(), label: `Sent link to ${input.recipientName}`, status: "failed", detail: msg },
          ],
        });
        // SMS failed — no side effect to protect, persist the failure record best-effort
        createAndSaveMission(
          missionMeta,
          ctx.agent.agentId,
          input.command ?? `Send payment link to ${input.recipientName}`,
          "chat"
        ).catch(() => {});
        return {
          type: "payment_link_sent" as const,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          paymentLinkUrl: input.paymentLinkUrl,
          success: false,
          error: msg,
          mission: missionMeta,
        };
      }
    }),
  /**
   * Confirm and send bulk SMS after agent reviews/edits the draft.
   * Called when agent clicks "Send" on the bulk_sms_confirm card.
   */
  sendBulkSms: agentProcedure
    .input(
      z.object({
        recipients: z.array(z.object({
          cleanerProfileId: z.number().optional(),
          name: z.string(),
          phone: z.string(),
        })),
        message: z.string().min(1).max(1600),
        missionTitle: z.string().optional(),
        /** Original user command from the confirm card — used for mission persistence */
        command: z.string().optional(),
      })
    )
        .mutation(async ({ ctx, input }) => {
      const startedAt = new Date();
      const results: BulkSmsSentResult["results"] = [];
      const db = await getDb();
      for (const recipient of input.recipients) {
        try {
          const result = await sendSms({
            to: recipient.phone,
            content: input.message,
            fromNumberId: ENV.openPhoneCsNumberId,
          });
          results.push({ name: recipient.name, phone: recipient.phone, success: result.success });
          if (result.success && db) {
            appendCsOutboundMessage({
              db: db as any,
              recipientPhone: recipient.phone,
              recipientName: recipient.name,
              message: input.message,
              senderName: ctx.user?.name ?? "Agent",
              openPhoneMessageId: result.messageId,
            }).catch(console.error);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ name: recipient.name, phone: recipient.phone, success: false, error: msg });
        }
      }

      const sent = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      const missionSteps: MissionStep[] = results.map(r => ({
        id: crypto.randomUUID(),
        label: `Texted ${r.name}`,
        status: r.success ? "completed" : "failed",
        detail: r.success
          ? input.message
          : (r.error ?? "Send failed"),
      }));

      const overallStatus = failed === 0 ? "completed" : sent > 0 ? "completed" : "failed";
      const summary = failed === 0
        ? `${sent} message${sent !== 1 ? "s" : ""} sent successfully.`
        : `${sent} sent, ${failed} failed.`;

      const missionMeta = createMissionMetadata({
        title: input.missionTitle ?? `Text ${input.recipients.length === 1 ? input.recipients[0].name : `${input.recipients.length} Cleaners`}`,
        startedAt,
        status: overallStatus,
        summary,
        steps: missionSteps,
      });

      // Persist mission only after all SMS side effects are complete.
      // Persistence failure must NOT cause the action to appear failed.
      const anySent = sent > 0;
      let mission: MissionMetadata | null = missionMeta;
      let missionPersistenceError = false;
      if (anySent) {
        const saved = await createAndSaveMission(
          missionMeta,
          ctx.agent.agentId,
          input.command ?? input.missionTitle ?? `Text ${input.recipients.length} recipient${input.recipients.length !== 1 ? "s" : ""}`,
          "chat"
        );
        if (saved === null) missionPersistenceError = true;
        mission = saved ?? missionMeta;
      }

      return {
        type: "bulk_sms_sent" as const,
        message: failed === 0
          ? `Sent to ${sent} cleaner${sent !== 1 ? "s" : ""}.`
          : `Sent to ${sent}, failed for ${failed}.`,
        results,
        mission,
        ...(missionPersistenceError ? { missionPersistenceError: true } : {}),
      };
    }),

  /**
   * Returns the agent's active (non-archived) mission history, newest first.
   * agentId is taken from ctx.agent — never from client input.
   */
  getMissions: agentProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      before: z.number().int().optional(), // createdAt unix ms cursor for pagination
    }))
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db
        .select()
        .from(madisonMissions)
        .where(
          and(
            eq(madisonMissions.agentId, ctx.agent.agentId),
            isNull(madisonMissions.archivedAt)
          )
        )
        .orderBy(desc(madisonMissions.createdAt))
        .limit(50);
      return rows.map(r => ({
        id: r.id,
        missionId: r.missionId,
        command: r.command,
        title: r.title,
        status: r.status,
        source: r.source,
        summary: r.summary,
        steps: r.steps as MissionStep[],
        stats: r.stats as MissionMetadata["missionStats"],
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        createdAt: r.createdAt ? r.createdAt.getTime() : null,
      }));
    }),

  /**
   * Archives all active missions for the authenticated agent.
   * Sets archivedAt = NOW() on all rows where agentId = ctx.agent.agentId AND archivedAt IS NULL.
   * agentId is taken from ctx.agent — never from client input.
   */
  archiveMissions: agentProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const now = new Date();
      await db
        .update(madisonMissions)
        .set({ archivedAt: now })
        .where(
          and(
            eq(madisonMissions.agentId, ctx.agent.agentId),
            isNull(madisonMissions.archivedAt)
          )
        );
      return { archivedAt: now.getTime() };
    }),
  /**
   * Persists a call mission immediately after callMatrix.startCall fires.
   * Called by the client with the vapiCallId returned from startCall.
   * agentId is taken from ctx.agent — never from client input.
   */
  saveCallMission: agentProcedure
    .input(
      z.object({
        vapiCallId: z.string().min(1).max(128),
        recipientName: z.string(),
        recipientPhone: z.string(),
        script: z.string(),
        command: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const startedAt = new Date();
      const missionMeta: MissionMetadata = createMissionMetadata({
        title: `Call → ${input.recipientName}`,
        startedAt,
        status: "completed",
        summary: `Called ${input.recipientName} (${input.recipientPhone.slice(-4)}).`,
        steps: [
          {
            id: crypto.randomUUID(),
            label: `Called ${input.recipientName}`,
            status: "completed",
            detail: input.script,
            vapiCallId: input.vapiCallId,
          },
        ],
      });
      const saved = await createAndSaveMission(
        missionMeta,
        ctx.agent.agentId,
        input.command ?? `Call ${input.recipientName}`,
        "chat"
      );
      return { mission: saved ?? missionMeta, missionPersistenceError: saved === null };
    }),

  /**
   * getReadinessSummary
   * Returns a structured readiness summary for a given date (defaults to tomorrow ET).
   * Powers the Tomorrow Readiness drawer and AI Concierge checklist flow.
   *
   * Dimensions:
   *  1. Jobs Scheduled     — total jobs, unassigned count
   *  2. Team Confirmations — confirmed vs unconfirmed teams
   *  3. Payment Methods    — on_hold / no_preauth / no_card per customer
   *  4. Customer Confirmations — confirmed (call/SMS) vs pending per booking
   *  5. Client Requests    — requestedTeam honored vs violated
   */
  getReadinessSummary: agentProcedure
    .input(z.object({ date: z.string().optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      try {

      // Resolve target date — default to tomorrow ET
      const targetDate = input.date ?? (() => {
        const now = new Date();
        const etOffset = -4; // EDT; adjust to -5 for EST if needed
        const et = new Date(now.getTime() + etOffset * 60 * 60 * 1000);
        et.setUTCDate(et.getUTCDate() + 1);
        return et.toISOString().slice(0, 10);
      })();

      // ── 1. Fetch all non-cancelled/rescheduled jobs for the date ─────────
      const jobs = await db
        .select({
          id: cleanerJobs.id,
          customerName: cleanerJobs.customerName,
          customerPhone: cleanerJobs.customerPhone,
          serviceDateTime: cleanerJobs.serviceDateTime,
          serviceType: cleanerJobs.serviceType,
          cleanerProfileId: cleanerJobs.cleanerProfileId,
          cleanerName: cleanerJobs.cleanerName,
          teamName: cleanerJobs.teamName,
          teamId: cleanerJobs.teamId,
          scheduleConfirmed: cleanerJobs.scheduleConfirmed,
          hasStripeCard: cleanerJobs.hasStripeCard,
          chargesOnHoldCents: cleanerJobs.chargesOnHoldCents,
          paymentBrand: cleanerJobs.paymentBrand,
          paymentLast4: cleanerJobs.paymentLast4,
          requestedTeam: cleanerJobs.requestedTeam,
          bookingStatus: cleanerJobs.bookingStatus,
        })
        .from(cleanerJobs)
        .where(and(
          eq(cleanerJobs.jobDate, targetDate),
          sql`${cleanerJobs.bookingStatus} NOT IN ('cancelled', 'rescheduled')`,
        ));

      const jobIds = jobs.map(j => j.id);

      // ── 2. Fetch schedule assignments for client request check ────────────
      const assignments = jobIds.length > 0
        ? await db.select({
            cleanerJobId: scheduleAssignments.cleanerJobId,
            teamName: scheduleAssignments.teamName,
            isManual: scheduleAssignments.isManual,
          }).from(scheduleAssignments)
            .where(inArray(scheduleAssignments.cleanerJobId, jobIds))
        : [];
      const assignmentByJobId = new Map(assignments.map(a => [a.cleanerJobId, a]));

      // ── 3. Fetch confirmation calls by date (immune to job ID changes) ──────
      // Fetch by jobDate — not by cleanerJobId — so we still find calls even when
      // a job was deleted+re-inserted with a new ID. The shared helper then matches
      // by cleanerJobId first, then phone, then name.
      const confCalls = await db.select({
            cleanerJobId: confirmationCalls.cleanerJobId,
            calledPhone: confirmationCalls.calledPhone,
            clientName: confirmationCalls.clientName,
            aiOutcome: confirmationCalls.aiOutcome,
            manualOutcome: confirmationCalls.manualOutcome,
            smsConfirmedAt: confirmationCalls.smsConfirmedAt,
            aiOutcomeLabel: confirmationCalls.aiOutcomeLabel,
            manualOutcomeLabel: confirmationCalls.manualOutcomeLabel,
          }).from(confirmationCalls)
            .where(eq(confirmationCalls.jobDate, targetDate));
      const confCallByJobId = matchConfirmationCallsToJobs(jobs, confCalls);

      // ── DIMENSION 1: Jobs Scheduled ───────────────────────────────────────
      const totalJobs = jobs.length;
      const unassignedJobs = jobs.filter(j => !j.cleanerProfileId);
      // Double-booking: same cleaner assigned to 2+ jobs at the exact same time
      const timeKeyMap = new Map<string, typeof jobs>();
      for (const j of jobs) {
        if (!j.cleanerProfileId || !j.serviceDateTime) continue;
        const key = `${j.cleanerProfileId}::${j.serviceDateTime}`;
        if (!timeKeyMap.has(key)) timeKeyMap.set(key, []);
        timeKeyMap.get(key)!.push(j);
      }
      const doubleBookedJobs: Array<{ customerName: string; jobTime: string | null; cleanerName: string }> = [];
      for (const group of timeKeyMap.values()) {
        if (group.length >= 2) {
          for (const j of group) {
            doubleBookedJobs.push({
              customerName: j.customerName ?? "Unknown",
              jobTime: j.serviceDateTime ? formatTimeET(new Date(j.serviceDateTime)) : null,
              cleanerName: j.cleanerName ?? `Cleaner #${j.cleanerProfileId}`,
            });
          }
        }
      }
      const jobsIssueCount = unassignedJobs.length + doubleBookedJobs.length;

      // ── DIMENSION 2: Team Confirmations ──────────────────────────────────
      const teamMap = new Map<number, { name: string; confirmed: boolean; jobCount: number }>();
      for (const j of jobs) {
        if (!j.cleanerProfileId) continue;
        const existing = teamMap.get(j.cleanerProfileId);
        if (existing) {
          existing.jobCount++;
          if (!j.scheduleConfirmed) existing.confirmed = false;
        } else {
          teamMap.set(j.cleanerProfileId, {
            name: j.cleanerName ?? `Cleaner #${j.cleanerProfileId}`,
            confirmed: j.scheduleConfirmed === 1,
            jobCount: 1,
          });
        }
      }
      const teamRows = Array.from(teamMap.values());
      const teamsConfirmed = teamRows.filter(t => t.confirmed).length;
      const teamsTotal = teamRows.length;
      const teamsIssueCount = teamRows.filter(t => !t.confirmed).length;

      // ── DIMENSION 3: Payment Methods ─────────────────────────────────────
      const seenCustomers = new Set<string>();
      const paymentRows: Array<{
        customerName: string;
        jobTime: string | null;
        serviceType: string | null;
        cardBrand: string | null;
        last4: string | null;
        status: "on_hold" | "no_preauth" | "no_card";
        amountCents: number;
      }> = [];
      for (const j of jobs) {
        const key = j.customerName ?? "";
        if (seenCustomers.has(key)) continue;
        seenCustomers.add(key);
        const status: "on_hold" | "no_preauth" | "no_card" =
          (j.chargesOnHoldCents ?? 0) > 0 ? "on_hold" :
          j.hasStripeCard ? "no_preauth" :
          "no_card";
        paymentRows.push({
          customerName: j.customerName ?? "Unknown",
          jobTime: j.serviceDateTime ? formatTimeET(new Date(j.serviceDateTime)) : null,
          serviceType: j.serviceType ?? null,
          cardBrand: j.paymentBrand ?? null,
          last4: j.paymentLast4 ?? null,
          status,
          amountCents: j.chargesOnHoldCents ?? 0,
        });
      }
      const paymentsOnHold = paymentRows.filter(r => r.status === "on_hold").length;
      const paymentsTotal = paymentRows.length;
      const paymentsIssueCount = paymentRows.filter(r => r.status !== "on_hold").length;

      // ── DIMENSION 4: Customer Confirmations ──────────────────────────────
      const seenBookings = new Set<string>();
      const confirmationRows: Array<{
        customerName: string;
        jobTime: string | null;
        serviceType: string | null;
        status: "confirmed" | "pending";
        outcomeLabel: string | null;
      }> = [];
      for (const j of jobs) {
        const key = `${j.customerName}|${j.serviceDateTime}`;
        if (seenBookings.has(key)) continue;
        seenBookings.add(key);
        const call = confCallByJobId.get(j.id);
        const effectiveOutcome = call?.manualOutcome ?? call?.aiOutcome ?? null;
        const isConfirmed = effectiveOutcome === "confirmed" || ((call?.smsConfirmedAt ?? 0) > 0);
        const label = call?.manualOutcomeLabel ?? call?.aiOutcomeLabel ?? null;
        confirmationRows.push({
          customerName: j.customerName ?? "Unknown",
          jobTime: j.serviceDateTime ? formatTimeET(new Date(j.serviceDateTime)) : null,
          serviceType: j.serviceType ?? null,
          status: isConfirmed ? "confirmed" : "pending",
          outcomeLabel: label,
        });
      }
      const confirmationsConfirmed = confirmationRows.filter(r => r.status === "confirmed").length;
      const confirmationsTotal = confirmationRows.length;
      const confirmationsIssueCount = confirmationRows.filter(r => r.status === "pending").length;

      // ── DIMENSION 5: Client Requests ─────────────────────────────────────
      const clientRequestRows: Array<{
        customerName: string;
        jobTime: string | null;
        requestedTeam: string;
        assignedTeam: string | null;
        status: "honored" | "violated" | "unassigned";
      }> = [];
      for (const j of jobs) {
        if (!j.requestedTeam) continue;
        const assignment = assignmentByJobId.get(j.id);
        // Mirror the REQUESTED_TEAM_VIOLATED logic from schedulingRouter:
        // skip isManual === 2 (manual override), check name containment
        if (assignment?.isManual === 2) {
          clientRequestRows.push({
            customerName: j.customerName ?? "Unknown",
            jobTime: j.serviceDateTime ? formatTimeET(new Date(j.serviceDateTime)) : null,
            requestedTeam: j.requestedTeam,
            assignedTeam: assignment.teamName ?? null,
            status: "honored", // manual override = intentional
          });
          continue;
        }
        if (!j.cleanerProfileId || !assignment) {
          clientRequestRows.push({
            customerName: j.customerName ?? "Unknown",
            jobTime: j.serviceDateTime ? formatTimeET(new Date(j.serviceDateTime)) : null,
            requestedTeam: j.requestedTeam,
            assignedTeam: null,
            status: "unassigned",
          });
          continue;
        }
        const reqNorm = j.requestedTeam.toLowerCase().trim();
        const assignedNorm = (assignment.teamName ?? "").toLowerCase().trim();
        const honored = reqNorm.includes(assignedNorm) || assignedNorm.includes(reqNorm);
        clientRequestRows.push({
          customerName: j.customerName ?? "Unknown",
          jobTime: j.serviceDateTime ? formatTimeET(new Date(j.serviceDateTime)) : null,
          requestedTeam: j.requestedTeam,
          assignedTeam: assignment.teamName ?? null,
          status: honored ? "honored" : "violated",
        });
      }
      const clientRequestsHonored = clientRequestRows.filter(r => r.status === "honored").length;
      const clientRequestsTotal = clientRequestRows.length;
      const clientRequestsIssueCount = clientRequestRows.filter(r => r.status !== "honored").length;

      // ── Overall readiness % ───────────────────────────────────────────────
      // Weighted: confirmations 30%, payments 25%, teams 20%, clientRequests 15%, jobs 10%
      const score = (dim: { total: number; issueCount: number }, weight: number) => {
        if (dim.total === 0) return weight; // no data = full score
        return weight * (1 - dim.issueCount / dim.total);
      };
      const overallPct = Math.round(
        score({ total: confirmationsTotal, issueCount: confirmationsIssueCount }, 30) +
        score({ total: paymentsTotal, issueCount: paymentsIssueCount }, 25) +
        score({ total: teamsTotal, issueCount: teamsIssueCount }, 20) +
        score({ total: clientRequestsTotal, issueCount: clientRequestsIssueCount }, 15) +
        score({ total: totalJobs, issueCount: jobsIssueCount }, 10)
      );

      const totalIssues = confirmationsIssueCount + paymentsIssueCount + teamsIssueCount + clientRequestsIssueCount + jobsIssueCount;

      return {
        date: targetDate,
        overallPct,
        totalIssues,
        dimensions: {
          jobs: {
            total: totalJobs,
            issueCount: jobsIssueCount,
            unassigned: unassignedJobs.map(j => ({
              customerName: j.customerName ?? "Unknown",
              jobTime: j.serviceDateTime ? formatTimeET(new Date(j.serviceDateTime)) : null,
            })),
            doubleBooked: doubleBookedJobs,
          },
          teams: {
            total: teamsTotal,
            confirmed: teamsConfirmed,
            issueCount: teamsIssueCount,
            rows: teamRows,
          },
          payments: {
            total: paymentsTotal,
            onHold: paymentsOnHold,
            issueCount: paymentsIssueCount,
            rows: paymentRows,
          },
          confirmations: {
            total: confirmationsTotal,
            confirmed: confirmationsConfirmed,
            issueCount: confirmationsIssueCount,
            rows: confirmationRows,
          },
          clientRequests: {
            total: clientRequestsTotal,
            honored: clientRequestsHonored,
            issueCount: clientRequestsIssueCount,
            rows: clientRequestRows,
          },
        },
      };
      } catch (err) {
        console.error("[getReadinessSummary] ERROR:", err);
        throw err;
      }
    }),
});
