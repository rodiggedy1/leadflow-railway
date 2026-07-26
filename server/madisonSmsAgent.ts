/**
 * Madison SMS Draft Agent
 *
 * Pipeline: Inbound SMS → Classify → Resolve Intent → Resolve Context
 *           → Execute Capability (or Knowledge Retrieval) → Generate DraftResponse
 *           → Score Quality → Post Draft Card to Command Chat
 *
 * This file is the single entry point. Call triggerMadisonSmsDraft() fire-and-forget
 * from handleCsInboundMessage() in webhooks.ts.
 *
 * Architecture rules:
 * - This file NEVER throws — all errors are caught and written to madisonSmsDrafts.status=FAILED
 * - Knowledge retrieval is NOT a capability — it runs as a separate context enrichment step
 * - The shared capability registry is used for business operations (get_eta, card_status)
 * - Quality score is computed deterministically, not by LLM self-assessment
 * - generatedDraft is NEVER overwritten — approvedText stores what was actually sent
 */

import { getDb } from "./db";
import { madisonSmsDrafts, conversationSessions, opsChatMessages } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";
import { ENV } from "./_core/env";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "./knowledgeBase";
import { retrieveKnowledge } from "./madisonKnowledgeRetrieval";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SmsMessageType = "QUESTION" | "ACTION" | "INFORMATION" | "CONVERSATION" | "UNKNOWN";

export interface ClassificationResult {
  type: SmsMessageType;
  intentConfidence: number; // 0–1
}

export interface ResolvedContext {
  customerId?: number;
  customerName?: string;
  cleanerJobId?: number;
  teamName?: string;
  cleanerPhone?: string;
  serviceDateTime?: string;
  isCleaner: boolean;
  senderName?: string;
}

export interface CapabilityResult {
  capability: string;
  capabilityVersion: number;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  observations: string[];
  suggestedActions: string[];
  followUps: string[];
}

export interface DraftResponse {
  draft: string;
  intentSummary: string; // one-sentence human-readable summary of customer intent
  draftConfidence: number; // 0–1
  observations: string[];
  suggestedActions: string[];
  followUps: string[];
}

export interface QualityScore {
  intentConfidence: number;
  draftConfidence: number;
  toolGrounded: boolean;
  hasVerification: boolean;
  usedKnowledgeBase: boolean;
  usedDatabase: boolean;
  usedPureLLM: boolean;
  hallucinationRisk: "low" | "medium" | "high";
}

// ─── Pipeline Entry Point ─────────────────────────────────────────────────────

/**
 * Phone numbers that will never trigger an AI SMS draft card in Command Chat.
 * Add E.164 formatted numbers here (e.g. "+17259009272").
 */
const SMS_DRAFT_EXCLUDED_PHONES = new Set<string>([
  "+17259009272",
]);

/**
 * Fire-and-forget entry point. Call from webhooks.ts after storing the inbound message.
 * Never throws — all errors are caught and written to the DB.
 */
export async function triggerMadisonSmsDraft(params: {
  inboundOpenPhoneId: string;
  sessionId: number;
  fromPhone: string;
  senderName?: string;
  isCleaner: boolean;
  inboundText: string;
}): Promise<void> {
  const { inboundOpenPhoneId, sessionId, fromPhone, senderName, isCleaner, inboundText } = params;

  // Skip empty messages
  if (!inboundText?.trim()) return;
  // Skip excluded phone numbers
  if (SMS_DRAFT_EXCLUDED_PHONES.has(fromPhone)) {
    console.log(`[MadisonSMS] Skipping draft for excluded phone: ${fromPhone}`);
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error("[MadisonSMS] No DB connection");
    return;
  }

  const now = new Date();
  let draftId: number | undefined;

  try {
    // ── Step 0: Create draft record (RECEIVED) ────────────────────────────────
    const insertResult = await db.insert(madisonSmsDrafts).values({
      inboundOpenPhoneId,
      sessionId,
      fromPhone,
      senderName,
      senderType: isCleaner ? "cleaner" : "customer",
      status: "RECEIVED",
      originalMessage: inboundText,
      observations: [],
      suggestedActions: [],
      followUps: [],
      createdAt: now,
      updatedAt: now,
    }).catch((err) => {
      // Duplicate inboundOpenPhoneId — already processed
      if (err.message?.includes("Duplicate") || err.code === "ER_DUP_ENTRY") {
        console.log(`[MadisonSMS] Duplicate inboundOpenPhoneId ${inboundOpenPhoneId} — skipping`);
        return null;
      }
      throw err;
    });

    if (!insertResult) return;
    const [insertHeader] = insertResult as any;
    draftId = insertHeader.insertId as number;

    // ── Step 1: Classify ──────────────────────────────────────────────────────
    const classification = await classifyMessage(inboundText);
    await db.update(madisonSmsDrafts)
      .set({ status: "CLASSIFIED", messageType: classification.type, updatedAt: new Date() })
      .where(eq(madisonSmsDrafts.id, draftId));

    // ── Step 2: Resolve Intent (deterministic rules first, LLM fallback) ──────
    const intent = resolveIntent(classification.type, inboundText);

    // ── Step 3: Resolve Context (who is this person?) ─────────────────────────
    const context = await resolveContext(fromPhone, isCleaner, senderName, db);
    await db.update(madisonSmsDrafts)
      .set({
        status: "TOOLS_RUNNING",
        intent,
        resolvedContext: context as any,
        updatedAt: new Date(),
      })
      .where(eq(madisonSmsDrafts.id, draftId));

    // ── Step 4: Execute Capability or Knowledge Retrieval ─────────────────────
    let capabilityResult: CapabilityResult | null = null;
    let knowledgeContext: string | null = null;

    if (intent === "get_eta") {
      capabilityResult = await executeGetEta(context, db);
    } else if (intent === "card_status") {
      capabilityResult = await executeCardStatus(context, db);
    } else if (classification.type === "QUESTION") {
      // Knowledge retrieval — NOT a capability
      knowledgeContext = await retrieveKnowledge(inboundText);
    }
    // INFORMATION, CONVERSATION, UNKNOWN → no tool needed

    // ── Step 5: Generate DraftResponse ────────────────────────────────────────
    const draftResponse = await generateDraftResponse({
      inboundText,
      senderName: context.senderName ?? senderName,
      isCleaner,
      classification,
      intent,
      context,
      capabilityResult,
      knowledgeContext,
    });

    // ── Step 6: Compute Quality Score ─────────────────────────────────────────
    const qualityScore = computeQualityScore({
      intentConfidence: classification.intentConfidence,
      draftConfidence: draftResponse.draftConfidence,
      capabilityResult,
      knowledgeContext,
    });

    // ── Step 7: Persist draft ─────────────────────────────────────────────────
    await db.update(madisonSmsDrafts)
      .set({
        status: "DRAFT_READY",
        capability: capabilityResult?.capability ?? null,
        capabilityVersion: capabilityResult?.capabilityVersion ?? null,
        capabilityArgs: capabilityResult?.args as any ?? null,
        capabilityResult: capabilityResult?.result as any ?? null,
        observations: draftResponse.observations as any,
        suggestedActions: draftResponse.suggestedActions as any,
        followUps: draftResponse.followUps as any,
        generatedDraft: draftResponse.draft,
        intentSummary: draftResponse.intentSummary,
        qualityScore: qualityScore as any,
        updatedAt: new Date(),
      })
      .where(eq(madisonSmsDrafts.id, draftId));

    // ── Step 8: Post Draft Card to Command Chat ───────────────────────────────
    await postDraftCardToCommandChat({
      draftId,
      sessionId,
      fromPhone,
      senderName: context.senderName ?? senderName,
      isCleaner,
      inboundText,
      draft: draftResponse.draft,
      observations: draftResponse.observations,
      db,
    });

    console.log(`[MadisonSMS] Draft ${draftId} posted for ${fromPhone} (${intent ?? classification.type})`);

  } catch (err: any) {
    console.error("[MadisonSMS] Pipeline error:", err);
    if (draftId) {
      const db2 = await getDb();
      if (db2) {
        await db2.update(madisonSmsDrafts)
          .set({
            status: "FAILED",
            errorStage: "pipeline",
            errorCode: err.code ?? "UNKNOWN",
            errorMessage: err.message ?? String(err),
            updatedAt: new Date(),
          })
          .where(eq(madisonSmsDrafts.id, draftId))
          .catch(() => {});
      }
    }
  }
}

// ─── Step 1: Classify ─────────────────────────────────────────────────────────

async function classifyMessage(text: string): Promise<ClassificationResult> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You classify inbound SMS messages into exactly one of these types:
- QUESTION: Customer/cleaner is asking a question (about services, pricing, scheduling, policies, ETA, etc.)
- ACTION: Customer/cleaner wants something done (reschedule, get ETA, send payment link, etc.)
- INFORMATION: Customer/cleaner is providing information (gate code, address, notes, confirmation)
- CONVERSATION: Social/conversational message (thank you, OK, sounds good, emoji, etc.)
- UNKNOWN: Cannot determine type

Return JSON only.`,
        },
        {
          role: "user",
          content: `Classify this SMS: "${text}"`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "classification",
          strict: true,
          schema: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["QUESTION", "ACTION", "INFORMATION", "CONVERSATION", "UNKNOWN"],
              },
              intentConfidence: { type: "number" },
            },
            required: ["type", "intentConfidence"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response?.choices?.[0]?.message?.content;
    if (!content) throw new Error("No LLM response");
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return {
      type: parsed.type as SmsMessageType,
      intentConfidence: Math.min(1, Math.max(0, parsed.intentConfidence ?? 0.7)),
    };
  } catch (err) {
    console.warn("[MadisonSMS] Classification failed, defaulting to UNKNOWN:", err);
    return { type: "UNKNOWN", intentConfidence: 0.5 };
  }
}

// ─── Step 2: Resolve Intent ───────────────────────────────────────────────────

/**
 * Deterministic keyword rules first. LLM fallback only for ACTION type when rules don't match.
 */
function resolveIntent(type: SmsMessageType, text: string): string | null {
  const lower = text.toLowerCase();

  if (type === "ACTION" || type === "QUESTION") {
    // ETA patterns
    if (/\beta\b|when.*arriv|how.*long|on.*way|running.*late|where.*team|where.*clean/i.test(text)) {
      return "get_eta";
    }
    // Card / payment patterns
    if (/card.*file|payment.*method|credit.*card|debit.*card|card.*status|charge|payment.*issue/i.test(text)) {
      return "card_status";
    }
  }

  // For QUESTION type without a specific capability match → knowledge retrieval
  if (type === "QUESTION") return "knowledge_question";

  // INFORMATION, CONVERSATION, UNKNOWN → no specific intent
  return null;
}

// ─── Step 3: Resolve Context ──────────────────────────────────────────────────

async function resolveContext(
  fromPhone: string,
  isCleaner: boolean,
  senderName: string | undefined,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ResolvedContext> {
  const { cleanerJobs, cleanerProfiles, completedJobs } = await import("../drizzle/schema");
  const { like, ne } = await import("drizzle-orm");

  const fromPhoneDigits = fromPhone.replace(/^\+1/, "").replace(/[^\d]/g, "");
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Try to find today's job for this phone number
  try {
    if (isCleaner) {
      // Look up by cleaner phone
      const [profile] = await db
        .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone })
        .from(cleanerProfiles)
        .where(eq(cleanerProfiles.phone, fromPhoneDigits))
        .limit(1);

      if (profile) {
        const [job] = await db
          .select({
            id: cleanerJobs.id,
            customerName: cleanerJobs.customerName,
            teamName: cleanerJobs.teamName,
            serviceDateTime: cleanerJobs.serviceDateTime,
          })
          .from(cleanerJobs)
          .where(
            and(
              eq(cleanerJobs.cleanerProfileId, profile.id),
              eq(cleanerJobs.jobDate, today),
              ne(cleanerJobs.bookingStatus, "cancelled"),
              ne(cleanerJobs.bookingStatus, "rescheduled"),
            )
          )
          .orderBy(cleanerJobs.serviceDateTime)
          .limit(1);

        return {
          isCleaner: true,
          senderName: profile.name ?? senderName,
          cleanerJobId: job?.id,
          customerName: job?.customerName ?? undefined,
          teamName: job?.teamName ?? undefined,
          serviceDateTime: job?.serviceDateTime ?? undefined,
          cleanerPhone: fromPhone,
        };
      }
    } else {
      // Look up customer by phone — check completedJobs and cleanerJobs
      const phoneFormatted = `(${fromPhoneDigits.slice(0, 3)}) ${fromPhoneDigits.slice(3, 6)}-${fromPhoneDigits.slice(6)}`;

      const [job] = await db
        .select({
          id: cleanerJobs.id,
          customerName: cleanerJobs.customerName,
          teamName: cleanerJobs.teamName,
          serviceDateTime: cleanerJobs.serviceDateTime,
          cleanerPhone: cleanerProfiles.phone,
        })
        .from(cleanerJobs)
        .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
        .where(
          and(
            like(cleanerJobs.customerPhone, `%${fromPhoneDigits.slice(-7)}%`),
            eq(cleanerJobs.jobDate, today),
            ne(cleanerJobs.bookingStatus, "cancelled"),
            ne(cleanerJobs.bookingStatus, "rescheduled"),
          )
        )
        .orderBy(cleanerJobs.serviceDateTime)
        .limit(1);

      if (job) {
        return {
          isCleaner: false,
          senderName: job.customerName ?? senderName,
          cleanerJobId: job.id,
          customerName: job.customerName ?? undefined,
          teamName: job.teamName ?? undefined,
          serviceDateTime: job.serviceDateTime ?? undefined,
          cleanerPhone: job.cleanerPhone ? `+1${job.cleanerPhone}` : undefined,
        };
      }
    }
  } catch (err) {
    console.warn("[MadisonSMS] resolveContext error:", err);
  }

  return { isCleaner, senderName };
}

// ─── Step 4a: Capability — get_eta ───────────────────────────────────────────

async function executeGetEta(
  context: ResolvedContext,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<CapabilityResult> {
  const observations: string[] = [];
  const suggestedActions: string[] = ["send", "edit", "dismiss"];
  const followUps: string[] = [];

  if (!context.cleanerJobId) {
    observations.push("No job found for today for this contact.");
    return {
      capability: "get_eta",
      capabilityVersion: 1,
      args: { fromPhone: context.cleanerPhone },
      result: { found: false },
      observations,
      suggestedActions: ["send", "edit", "dismiss"],
      followUps: ["Check if job is scheduled for a different date"],
    };
  }

  // Check for a recent ETA call result (< 30 minutes old)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const recentEtaMsg = await db
    .select({ body: opsChatMessages.body, createdAt: opsChatMessages.createdAt })
    .from(opsChatMessages)
    .where(
      and(
        eq(opsChatMessages.quickAction, "eta_call_result"),
        eq(opsChatMessages.channel, "command"),
      )
    )
    .orderBy(desc(opsChatMessages.createdAt))
    .limit(1)
    .catch(() => []);

  const recentEta = recentEtaMsg[0];
  const etaAge = recentEta ? (Date.now() - new Date(recentEta.createdAt).getTime()) : Infinity;

  if (recentEta && etaAge < 15 * 60 * 1000) {
    // Fresh ETA (< 15 min) — use directly
    observations.push(`✅ ETA already on file (${Math.round(etaAge / 60000)} min ago): ${recentEta.body?.slice(0, 100)}`);
    observations.push(`Job scheduled: ${context.serviceDateTime ?? "unknown time"}`);
    return {
      capability: "get_eta",
      capabilityVersion: 1,
      args: { cleanerJobId: context.cleanerJobId },
      result: { etaFromCache: recentEta.body, ageMinutes: Math.round(etaAge / 60000) },
      observations,
      suggestedActions: ["send", "edit", "dismiss"],
      followUps: [],
    };
  } else if (recentEta && etaAge < 30 * 60 * 1000) {
    // Slightly stale (15–30 min) — use with timestamp
    observations.push(`⚠️ ETA on file is ${Math.round(etaAge / 60000)} min old: ${recentEta.body?.slice(0, 100)}`);
    observations.push(`Job scheduled: ${context.serviceDateTime ?? "unknown time"}`);
    suggestedActions.push("call_team");
    followUps.push("Consider calling team for a fresh ETA");
  } else {
    // No recent ETA — suggest calling
    observations.push(`No recent ETA on file.`);
    observations.push(`Job scheduled: ${context.serviceDateTime ?? "unknown time"}`);
    if (context.teamName) observations.push(`Team: ${context.teamName}`);
    suggestedActions.push("call_team");
    followUps.push("Call team to get current ETA");
  }

  return {
    capability: "get_eta",
    capabilityVersion: 1,
    args: { cleanerJobId: context.cleanerJobId },
    result: {
      found: true,
      serviceDateTime: context.serviceDateTime,
      teamName: context.teamName,
      hasRecentEta: !!recentEta && etaAge < 30 * 60 * 1000,
    },
    observations,
    suggestedActions,
    followUps,
  };
}

// ─── Step 4b: Capability — card_status ───────────────────────────────────────

async function executeCardStatus(
  context: ResolvedContext,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<CapabilityResult> {
  const observations: string[] = [];

  if (!context.cleanerJobId) {
    observations.push("No job found for today for this contact.");
    return {
      capability: "card_status",
      capabilityVersion: 1,
      args: {},
      result: { found: false },
      observations,
      suggestedActions: ["send", "edit", "dismiss"],
      followUps: [],
    };
  }

  try {
    const { cleanerJobs } = await import("../drizzle/schema");
    const [job] = await db
      .select({
        id: cleanerJobs.id,
        customerName: cleanerJobs.customerName,
        bookingStatus: cleanerJobs.bookingStatus,
        cardStatus: (cleanerJobs as any).cardStatus,
        preAuthStatus: (cleanerJobs as any).preAuthStatus,
      })
      .from(cleanerJobs)
      .where(eq(cleanerJobs.id, context.cleanerJobId))
      .limit(1);

    if (!job) {
      observations.push("Job not found in database.");
      return {
        capability: "card_status",
        capabilityVersion: 1,
        args: { cleanerJobId: context.cleanerJobId },
        result: { found: false },
        observations,
        suggestedActions: ["send", "edit", "dismiss"],
        followUps: [],
      };
    }

    const cardStatus = job.cardStatus ?? "unknown";
    const preAuthStatus = job.preAuthStatus ?? "unknown";

    if (cardStatus === "on_file" || cardStatus === "charged") {
      observations.push(`✅ Card on file for ${job.customerName}`);
      observations.push(`Payment status: ${cardStatus}`);
    } else {
      observations.push(`⚠️ Card issue for ${job.customerName}: ${cardStatus}`);
      observations.push(`Pre-auth status: ${preAuthStatus}`);
    }

    return {
      capability: "card_status",
      capabilityVersion: 1,
      args: { cleanerJobId: context.cleanerJobId },
      result: { cardStatus, preAuthStatus, customerName: job.customerName },
      observations,
      suggestedActions: ["send", "edit", "dismiss"],
      followUps: [],
    };
  } catch (err) {
    observations.push("Could not retrieve card status from database.");
    return {
      capability: "card_status",
      capabilityVersion: 1,
      args: { cleanerJobId: context.cleanerJobId },
      result: { error: String(err) },
      observations,
      suggestedActions: ["send", "edit", "dismiss"],
      followUps: [],
    };
  }
}

// ─── Step 5: Generate DraftResponse ──────────────────────────────────────────

async function generateDraftResponse(params: {
  inboundText: string;
  senderName?: string;
  isCleaner: boolean;
  classification: ClassificationResult;
  intent: string | null;
  context: ResolvedContext;
  capabilityResult: CapabilityResult | null;
  knowledgeContext: string | null;
}): Promise<DraftResponse> {
  const { inboundText, senderName, isCleaner, classification, intent, context, capabilityResult, knowledgeContext } = params;

  const firstName = senderName?.split(" ")[0] ?? (isCleaner ? "there" : "there");

  // Build context block for LLM
  let contextBlock = "";
  if (capabilityResult) {
    contextBlock = `\n\nCapability result (${capabilityResult.capability}):\n${JSON.stringify(capabilityResult.result, null, 2)}\nObservations:\n${capabilityResult.observations.join("\n")}`;
  } else if (knowledgeContext) {
    contextBlock = `\n\nRelevant knowledge base context:\n${knowledgeContext}`;
  }

  const systemPrompt = `You are Madison, the AI assistant for Maids in Black, a professional cleaning service in Washington DC.
You are drafting an SMS reply to a ${isCleaner ? "cleaner/team member" : "customer"} named ${firstName}.

Rules:
- Keep replies SHORT (1–3 sentences max for SMS)
- Warm, professional, helpful tone
- Never make up information — only use the context provided
- If you don't have enough info to answer confidently, say so warmly and offer to check
- Do NOT include greetings like "Hi!" unless it's a conversational reply
- Return JSON only${contextBlock}

Business context:
${MAIDS_IN_BLACK_KNOWLEDGE_BASE.slice(0, 2000)}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Draft a reply to this inbound SMS: "${inboundText}"\n\nIntent: ${intent ?? classification.type}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "draft_response",
          strict: true,
          schema: {
            type: "object",
            properties: {
              draft: { type: "string" },
              intentSummary: { type: "string", description: "One sentence describing what the customer wants, e.g. 'This is a thank-you after today's cleaning.' or 'They're asking about their ETA.'" },
              draftConfidence: { type: "number" },
              observations: { type: "array", items: { type: "string" } },
              suggestedActions: { type: "array", items: { type: "string" } },
              followUps: { type: "array", items: { type: "string" } },
            },
            required: ["draft", "intentSummary", "draftConfidence", "observations", "suggestedActions", "followUps"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response?.choices?.[0]?.message?.content;
    if (!content) throw new Error("No LLM response");
    const parsed = typeof content === "string" ? JSON.parse(content) : content;

    // Merge capability observations with LLM observations
    const allObservations = [
      ...(capabilityResult?.observations ?? []),
      ...(parsed.observations ?? []),
    ].filter((o, i, arr) => arr.indexOf(o) === i); // dedupe

    const allSuggestedActions = capabilityResult?.suggestedActions ?? parsed.suggestedActions ?? ["send", "edit", "dismiss"];

    return {
      draft: parsed.draft,
      intentSummary: parsed.intentSummary ?? "I drafted a reply for you.",
      draftConfidence: Math.min(1, Math.max(0, parsed.draftConfidence ?? 0.7)),
      observations: allObservations,
      suggestedActions: allSuggestedActions,
      followUps: [...(capabilityResult?.followUps ?? []), ...(parsed.followUps ?? [])],
    };
  } catch (err) {
    console.warn("[MadisonSMS] Draft generation failed:", err);
    // Fallback draft
    return {
      draft: `Hi! I received your message. Let me check on that and get back to you shortly.`,
      intentSummary: "I drafted a reply for you.",
      draftConfidence: 0.3,
      observations: ["Draft generation failed — fallback used"],
      suggestedActions: ["edit", "dismiss"],
      followUps: ["Review and edit before sending"],
    };
  }
}

// ─── Step 6: Compute Quality Score ───────────────────────────────────────────

function computeQualityScore(params: {
  intentConfidence: number;
  draftConfidence: number;
  capabilityResult: CapabilityResult | null;
  knowledgeContext: string | null;
}): QualityScore {
  const { intentConfidence, draftConfidence, capabilityResult, knowledgeContext } = params;

  const toolGrounded = !!capabilityResult;
  const hasVerification = toolGrounded && !!capabilityResult?.result && Object.keys(capabilityResult.result).length > 1;
  const usedKnowledgeBase = !!knowledgeContext;
  const usedDatabase = toolGrounded;
  const usedPureLLM = !toolGrounded && !knowledgeContext;

  let hallucinationRisk: "low" | "medium" | "high";
  if (toolGrounded && hasVerification) {
    hallucinationRisk = "low";
  } else if (usedKnowledgeBase || toolGrounded) {
    hallucinationRisk = "medium";
  } else {
    hallucinationRisk = draftConfidence > 0.8 ? "medium" : "high";
  }

  return {
    intentConfidence,
    draftConfidence,
    toolGrounded,
    hasVerification,
    usedKnowledgeBase,
    usedDatabase,
    usedPureLLM,
    hallucinationRisk,
  };
}

// ─── Step 7: Post Draft Card to Command Chat ──────────────────────────────────

async function postDraftCardToCommandChat(params: {
  draftId: number;
  sessionId: number;
  fromPhone: string;
  senderName?: string;
  isCleaner: boolean;
  inboundText: string;
  draft: string;
  observations: string[];
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
}): Promise<void> {
  const { draftId, sessionId, fromPhone, senderName, isCleaner, inboundText, draft, observations, db } = params;

  const displayName = senderName ?? fromPhone;
  const senderLabel = isCleaner ? "🧹 Cleaner" : "👤 Customer";

  // Build the card body — Madison narrates what she found, then presents the draft
  const body = [
    `${senderLabel}: ${displayName}`,
    `"${inboundText.slice(0, 120)}${inboundText.length > 120 ? "…" : ""}"`,
    "",
    ...observations.slice(0, 3),
    "",
    `Draft: ${draft}`,
  ].join("\n").trim();

  await db.insert(opsChatMessages).values({
    channel: "command",
    authorName: "Madison",
    authorRole: "system",
    body,
    quickAction: "madison_sms_draft",
    metadata: JSON.stringify({ draftId, quickActionVersion: 1, sessionId }),
    replyToId: null,
    replyToBody: null,
    replyToAuthor: null,
    threadParentId: null,
  });

  // Broadcast SSE so Command Chat updates instantly
  const { broadcastOpsUpdate } = await import("./sseBroadcast");
  broadcastOpsUpdate("new_message", { channel: "command" });
}

// ─── Retry ────────────────────────────────────────────────────────────────────

/**
 * Resume a FAILED pipeline from the last successful stage.
 * Called by the retrySmsDraft tRPC procedure.
 */
export async function retrySmsDraft(draftId: number): Promise<{ ok: boolean; reason?: string }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "no_db" };

  const [draft] = await db
    .select()
    .from(madisonSmsDrafts)
    .where(eq(madisonSmsDrafts.id, draftId))
    .limit(1);

  if (!draft) return { ok: false, reason: "not_found" };
  if (draft.status !== "FAILED") return { ok: false, reason: "not_failed" };

  // Re-trigger from scratch — the UNIQUE constraint on inboundOpenPhoneId will prevent
  // duplicate processing if somehow the original succeeded
  await db.update(madisonSmsDrafts)
    .set({ status: "RECEIVED", errorStage: null, errorCode: null, errorMessage: null, updatedAt: new Date() })
    .where(eq(madisonSmsDrafts.id, draftId));

  // Re-run the pipeline
  triggerMadisonSmsDraft({
    inboundOpenPhoneId: `retry_${draftId}_${Date.now()}`, // new ID to bypass unique constraint
    sessionId: draft.sessionId as number,
    fromPhone: draft.fromPhone,
    senderName: draft.senderName ?? undefined,
    isCleaner: draft.senderType === "cleaner",
    inboundText: draft.originalMessage,
  }).catch(console.error);

  return { ok: true };
}
