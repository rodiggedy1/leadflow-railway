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
import { cleanerJobs, cleanerProfiles, completedJobs, cardAuthTokens, callLog, fieldMgmtCalls } from "../drizzle/schema";
import { eq, ne, and, inArray, like, or, desc, gte, sql } from "drizzle-orm";
import { parseServiceDateTime, formatTimeET, placeEtaCall } from "./fieldMgmtEngine";
import { normalizePhoneLegacy } from "./utils/phone";
import { randomBytes } from "crypto";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";
import { appendCsOutboundMessage } from "./sms/appendCsOutboundMessage";

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
}

/** Returned when the concierge answers a natural-language query about today's jobs */
export interface QueryResultResult {
  type: "query_result";
  answer: string;
  rows?: Array<{
    id: number;
    jobDate: string | null;
    teamName: string | null;
    cleanerName: string | null;
    customerName: string | null;
    jobAddress: string | null;
    serviceDateTime: string | null;
    jobStatus: string | null;
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
  | CustomerProfileResult;

// ── Intent classifier ─────────────────────────────────────────────────────────
type Intent =
  | { action: "eta_update"; teamHint: string | null }
  | { action: "get_eta_for_customer"; clientName: string | null }
  | { action: "text_cleaners"; targetHint: string | null; messageHint: string | null }
  | { action: "text_client"; clientName: string | null; messageHint: string | null }
  | { action: "send_payment_link"; clientName: string | null }
  | { action: "call_client"; clientName: string | null; questionHint: string | null }
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
- query_data: user is asking a question about job data, clients, or teams (e.g. "list all jobs today", "what jobs does Team 3 have", "show me jobs for Kara Turner", "how many jobs this week", "what's the status of the 10am job", "which teams are working today")
- customer_profile: user wants a full profile/overview of a specific customer (e.g. "tell me about Mary Jones", "who is Rohan Gilkes", "show me Kara Turner's profile", "what do we know about Sarah Smith", "customer profile for John Doe", "give me the rundown on Dave Pringle", "tell me everything about Dave Pringle", "pull up John Smith")
- unknown: anything else
KEY DISTINCTION: "text_client" is for texting a specific named customer. "text_cleaners" is for texting cleaning staff/teams. "send_payment_link" is specifically for sending a Stripe card-on-file link. "call_client" is for placing an outbound VAPI call to a customer. "customer_profile" is for viewing a customer's full history, stats, messages, and AI summary — NOT for texting or calling them.

For customer_profile:
- clientName MUST be the exact full name of the customer as written by the user (e.g. "tell me everything about Dave Pringle" → clientName = "Dave Pringle", "who is Mary Jones" → clientName = "Mary Jones")
For get_eta_for_customer:
- clientName MUST be the exact full name of the customer as written by the user (e.g. "get ETA for Dave Pringle" → clientName = "Dave Pringle")

For text_cleaners:
- targetHint should be the EXACT group or cleaner name (e.g. "working today", "DC", "team 5", "all active", or a specific cleaner's name)
- messageHint should be the topic/content to send

For text_client:
- clientName MUST be the exact full name of the customer as written by the user
- messageHint should be the topic/content to send
For send_payment_link:
- clientName MUST be the exact full name of the customer as written by the user (e.g. "send rohan gilkes a payment link" → clientName = "rohan gilkes")
- messageHint is null
For call_client:
- clientName MUST be the exact full name of the customer as written by the user (e.g. "call rohan gilkes and ask about reschedule" → clientName = "rohan gilkes")
- questionHint should be the topic or question to ask (e.g. "ask if he wants to reschedule", "tell her we're running late")
Return JSON only:
{
  "action": "eta_update" | "get_eta_for_customer" | "text_cleaners" | "text_client" | "send_payment_link" | "call_client" | "query_data" | "customer_profile" | "unknown",
  "teamHint": "<team/cleaner name for eta_update, or null>",
  "targetHint": "<who to text for text_cleaners — exact name or group, or null>",
  "clientName": "<exact customer full name for text_client, send_payment_link, or call_client, or null>",
  "messageHint": "<the message content or topic for text_client or text_cleaners, or null>",
  "questionHint": "<the topic/question to ask for call_client, or null>"
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
          },
          required: ["action", "teamHint", "targetHint", "clientName", "messageHint", "questionHint"],
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

  // Try exact full-name match first, then partial
  const hintWords = hint.split(/\s+/).filter(Boolean);
  const matched = profiles.filter(p => {
    const pName = p.name.toLowerCase();
    // Full name contains hint or hint contains full name
    if (pName.includes(hint) || hint.includes(pName)) return true;
    // All hint words appear in the profile name
    if (hintWords.length >= 2 && hintWords.every(w => pName.includes(w))) return true;
    // First name exact match only (must be at least 4 chars to avoid false positives)
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
        resolvedClientPhone: z.string().optional(),
        resolvedClientMessageHint: z.string().nullable().optional(),
        resolvedPaymentLink: z.boolean().optional(),
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
          return await handleSendPaymentLink(null, db, input.resolvedClientPhone);
        }
        if (input.resolvedCallClient) {
          return await handleCallPerson(null, input.resolvedCallQuestionHint ?? null, db, input.resolvedClientPhone, input.resolvedCallPersonName);
        }
        return await handleTextClient(null, input.resolvedClientMessageHint ?? null, db, input.resolvedClientPhone);
      }

      // resolvedEntity = chip-attached person (already resolved by the UI).
      // Intent classification always runs — the chip is injected only as the pre-resolved
      // target for the matching intent. Strict type guards prevent cross-type mismatches.
      // When the chip type conflicts with the classified intent, fall back to the
      // unresolved handler so the LLM-extracted name is used instead.
      const re = input.resolvedEntity ?? null;
      const intent = await classifyIntent(input.message);
      console.log("[Concierge] intent:", JSON.stringify(intent), "resolvedEntity:", re ? `${re.type}:${re.type === "customer" ? re.phone : re.cleanerProfileId}` : "none", "message:", input.message);

      if (intent.action === "eta_update") {
        return await handleEtaUpdate(intent.teamHint, db);
      }
      if (intent.action === "get_eta_for_customer") {
        return await handleGetEtaForCustomer(intent.clientName, db);
      }

      if (intent.action === "text_cleaners") {
        // Use chip only when it is a cleaner entity; customer chip → fall back to LLM name
        return re?.type === "cleaner"
          ? await handleTextCleaners(re.name, intent.messageHint, db)
          : await handleTextCleaners(intent.targetHint, intent.messageHint, db);
      }

      if (intent.action === "text_client") {
        // Use chip only when it is a customer entity; cleaner chip → fall back to LLM name
        return re?.type === "customer"
          ? await handleTextClient(null, intent.messageHint, db, re.phone)
          : await handleTextClient(intent.clientName, intent.messageHint, db);
      }

      if (intent.action === "send_payment_link") {
        // Use chip only when it is a customer entity; cleaner chip → fall back to LLM name
        return re?.type === "customer"
          ? await handleSendPaymentLink(null, db, re.phone, re.name)
          : await handleSendPaymentLink(intent.clientName, db);
      }

      if (intent.action === "call_client") {
        // Use chip only when it is a customer entity; cleaner chip → fall back to LLM name
        return re?.type === "customer"
          ? await handleCallPerson(null, intent.questionHint, db, re.phone, re.name)
          : await handleCallPerson(intent.clientName, intent.questionHint, db);
      }

      if (intent.action === "query_data") {
        // handleQueryData only supports cleaner entities — pass chip only when it is a cleaner
        return re?.type === "cleaner"
          ? await handleQueryData(input.message, db, re)
          : await handleQueryData(input.message, db);
      }

      if (intent.action === "customer_profile") {
        // Use chip only when it is a customer entity; cleaner chip → fall back to LLM name
        if (re?.type === "customer") {
          return await handleCustomerProfile(re.name, db);
        }
        if (!intent.clientName) {
          return { type: "error" as const, message: "Please include the customer's name. Example: \"Tell me about Mary Jones\"" };
        }
        return await handleCustomerProfile(intent.clientName, db);
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
      })
    )
        .mutation(async ({ ctx, input }) => {
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
        return {
          type: "payment_link_sent" as const,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          paymentLinkUrl: input.paymentLinkUrl,
          success: result.success,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          type: "payment_link_sent" as const,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          paymentLinkUrl: input.paymentLinkUrl,
          success: false,
          error: msg,
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
      })
    )
        .mutation(async ({ ctx, input }) => {
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

      return {
        type: "bulk_sms_sent" as const,
        message: failed === 0
          ? `Sent to ${sent} cleaner${sent !== 1 ? "s" : ""}.`
          : `Sent to ${sent}, failed for ${failed}.`,
        results,
      };
    }),
});
