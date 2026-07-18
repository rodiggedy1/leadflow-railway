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
import { eq, ne, and, inArray, like, or, desc, gte } from "drizzle-orm";
import { parseServiceDateTime, formatTimeET, placeEtaCall } from "./fieldMgmtEngine";
import { normalizePhoneLegacy } from "./utils/phone";
import { randomBytes } from "crypto";
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
    teamName: string | null;
    cleanerName: string;
    customerName: string | null;
    jobAddress: string | null;
    serviceDateTime: string | null;
    jobStatus: string | null;
  }>;
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
  | QueryResultResult;

// ── Intent classifier ─────────────────────────────────────────────────────────
type Intent =
  | { action: "eta_update"; teamHint: string | null }
  | { action: "text_cleaners"; targetHint: string | null; messageHint: string | null }
  | { action: "text_client"; clientName: string | null; messageHint: string | null }
  | { action: "send_payment_link"; clientName: string | null }
  | { action: "call_client"; clientName: string | null; questionHint: string | null }
  | { action: "query_data" }
  | { action: "unknown" };

async function classifyIntent(message: string): Promise<Intent> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an intent classifier for a cleaning operations AI assistant.
Classify the user's message into one of these actions:
- eta_update: user wants to request an ETA call for a team (e.g. "send ETA for Team 8", "call team 3 for ETA", "get ETA update", "ETA for Maria")
- text_cleaners: user wants to send an SMS to one or more CLEANERS/STAFF (e.g. "text cleaners working today", "text all DC cleaners", "text team 5", "message all cleaners about tomorrow")
- text_client: user wants to send an SMS to a specific CUSTOMER/CLIENT by name (e.g. "text Abigail Avrick and ask if we can come early", "text John Smith about his appointment", "message Sarah Jones")
- send_payment_link: user wants to send a Stripe payment/card link to a specific customer (e.g. "send payment link to Mary Jones", "send card link to John Smith", "send stripe link to Sarah", "send payment link for Mary")
- call_client: user wants to call a specific customer to ask them something or deliver a message (e.g. "call rohan gilkes and ask if he wants to reschedule", "call Mary Jones and tell her we're running late", "give sarah a call about her appointment")
- query_data: user is asking a question about job data, clients, or teams (e.g. "list all jobs today", "what jobs does Team 3 have", "show me jobs for Kara Turner", "how many jobs this week", "what's the status of the 10am job", "which teams are working today")
- unknown: anything else
KEY DISTINCTION: "text_client" is for texting a specific named customer. "text_cleaners" is for texting cleaning staff/teams. "send_payment_link" is specifically for sending a Stripe card-on-file link. "call_client" is for placing an outbound VAPI call to a customer.

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
  "action": "eta_update" | "text_cleaners" | "text_client" | "send_payment_link" | "call_client" | "query_data" | "unknown",
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
            action: { type: "string", enum: ["eta_update", "text_cleaners", "text_client", "send_payment_link", "call_client", "query_data", "unknown"] },
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
  resolvedClientPhone?: string
): Promise<ConciergeResult> {
  if (!clientName && !resolvedClientPhone) {
    return { type: "error", message: "Please specify a client name to send the payment link to." };
  }

  let recipientPhone: string;
  let recipientName: string;
  let recipientAddress: string | null = null;

  if (resolvedClientPhone) {
    // Agent already picked from disambiguation
    const rows = await db
      .select({ phone: completedJobs.phone, name: completedJobs.name, address: completedJobs.address })
      .from(completedJobs)
      .where(like(completedJobs.phone, `%${resolvedClientPhone}%`))
      .limit(1);
    const client = rows[0];
    if (!client) return { type: "error", message: "Client not found." };
    recipientPhone = resolvedClientPhone;
    recipientName = client.name ?? resolvedClientPhone;
    recipientAddress = client.address ?? null;
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
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConciergeResult> {
  const today = getTodayET();
  // 90-day window keeps the payload well under the LLM context limit
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const cutoff = ninetyDaysAgo.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const jobs = await db
    .select({
      id: cleanerJobs.id,
      jobDate: cleanerJobs.jobDate,
      teamName: cleanerJobs.teamName,
      cleanerName: cleanerJobs.cleanerName,
      customerName: cleanerJobs.customerName,
      jobAddress: cleanerJobs.jobAddress,
      serviceDateTime: cleanerJobs.serviceDateTime,
      jobStatus: cleanerJobs.jobStatus,
    })
    .from(cleanerJobs)
    .where(
      and(
        gte(cleanerJobs.jobDate, cutoff),
        ne(cleanerJobs.bookingStatus, "cancelled"),
        ne(cleanerJobs.bookingStatus, "rescheduled")
      )
    )
    .orderBy(cleanerJobs.serviceDateTime);

  if (jobs.length === 0) {
    return { type: "query_result", answer: "No job data found." };
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

  const llmResult = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an operations assistant for a cleaning company. Answer the dispatcher's question using only the provided job data. If the answer cannot be determined from the data, say so. Do not invent information. Today is ${today}. Be concise and direct.`,
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
      teamName: j.teamName,
      cleanerName: j.cleanerName,
      customerName: j.customerName,
      jobAddress: j.jobAddress,
      serviceDateTime: j.serviceDateTime,
      jobStatus: j.jobStatus,
    })),
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
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      if (input.resolvedJobId) {
        return await handleEtaUpdateByJobId(input.resolvedJobId, db);
      }

      if (input.resolvedClientPhone) {
        if (input.resolvedPaymentLink) {
          return await handleSendPaymentLink(null, db, input.resolvedClientPhone);
        }
        if (input.resolvedCallClient) {
          return await handleCallPerson(null, input.resolvedCallQuestionHint ?? null, db, input.resolvedClientPhone, input.resolvedCallPersonName);
        }
        return await handleTextClient(null, input.resolvedClientMessageHint ?? null, db, input.resolvedClientPhone);
      }

      const intent = await classifyIntent(input.message);

      if (intent.action === "eta_update") {
        return await handleEtaUpdate(intent.teamHint, db);
      }

      if (intent.action === "text_cleaners") {
        return await handleTextCleaners(intent.targetHint, intent.messageHint, db);
      }

      if (intent.action === "text_client") {
        return await handleTextClient(intent.clientName, intent.messageHint, db);
      }

            if (intent.action === "send_payment_link") {
        return await handleSendPaymentLink(intent.clientName, db);
      }
      if (intent.action === "call_client") {
        return await handleCallPerson(intent.clientName, intent.questionHint, db);
      }
      if (intent.action === "query_data") {
        return await handleQueryData(input.message, db);
      }
      return {
        type: "error" as const,
        message: "I can handle ETA updates, texting cleaners, texting clients, sending payment links, calling clients or cleaners, and answering questions about today's jobs. Try: \"Send ETA for Team 8\", \"Text cleaners working today\", \"Text Abigail Avrick\", \"Send payment link to Mary Jones\", \"Call Rohan Gilkes and ask about reschedule\", or \"List all jobs today\".",
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
    .mutation(async ({ input }) => {
      try {
        const result = await sendSms({
          to: input.recipientPhone,
          content: input.smsText,
          fromNumberId: ENV.openPhoneCsNumberId,
        });
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
