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
import { eq, and, desc, sql } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";
import { ENV } from "./_core/env";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "./knowledgeBase";
import { retrieveKnowledge } from "./madisonKnowledgeRetrieval";
import { sendSms } from "./openphone";
import { resolveMadisonContext, getMadisonEtaProgress, getMadisonBookingPayment } from "./madisonContext";
import type { MadisonResolvedContext } from "./madisonContext";
import { persistMadisonDecision } from "./madisonDecisionWriter";
import { persistMadisonMessageShadow } from "./madisonMessageUnderstanding";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SmsMessageType = "QUESTION" | "ACTION" | "INFORMATION" | "CONVERSATION" | "UNKNOWN";

export interface ClassificationResult {
  type: SmsMessageType;
  intentConfidence: number; // 0–1
}

export type ResolvedContext = MadisonResolvedContext;

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
  /** Minutes the customer has been waiting unanswered — set by the unanswered alarm cron */
  unansweredMinutes?: number;
}): Promise<void> {
  const { inboundOpenPhoneId, sessionId, fromPhone, senderName, isCleaner, inboundText, unansweredMinutes } = params;

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

    // Shadow-only understanding. Await the write so runtime teardown cannot
    // abandon the prediction before it reaches the database. The helper
    // reports its own errors and cannot affect Madison's draft, approval, or
    // send path.
    const shadowResult = await persistMadisonMessageShadow({
      db,
      sourceMessageId: inboundOpenPhoneId,
      draftId,
      sessionId,
      inboundText,
    });
    if (!shadowResult.ok) {
      console.error(
        `[MadisonSMS] Shadow ${shadowResult.stage} failure for draft ${draftId}: ${shadowResult.errorCode} ${shadowResult.errorMessage}`
      );
      await db.update(madisonSmsDrafts)
        .set({
          errorStage: `shadow_${shadowResult.stage}`,
          errorCode: shadowResult.errorCode,
          errorMessage: shadowResult.errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(madisonSmsDrafts.id, draftId))
        .catch(error => console.error(`[MadisonSMS] Could not record Shadow failure for draft ${draftId}:`, error));
    }

    // ── Step 0.5: Phase 1A Deterministic Auto-Reply ────────────────────────────────────────────────────────────────────
    // Context-independent social acknowledgments — no LLM needed, fixed safe response.
    // Brutally narrow: only phrases that are harmless regardless of prior conversation.
    const phase1aResponse = pickPhase1AResponse(inboundText);
    if (phase1aResponse) {
      // Atomic claim: RECEIVED → SENDING (prevents duplicate send on webhook retry)
      const [claimResult] = await db
        .update(madisonSmsDrafts)
        .set({ status: "SENDING", messageType: "CONVERSATION", intent: "social_acknowledgment",
               generatedDraft: phase1aResponse, approvedText: phase1aResponse,
               approvedBy: "madison_auto_template", approvedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(madisonSmsDrafts.id, draftId), eq(madisonSmsDrafts.status, "RECEIVED")));
      const claimed = (claimResult as any).affectedRows ?? 0;
      if (claimed === 0) {
        console.log(`[MadisonSMS] Phase1A claim failed for draft ${draftId} — already owned`);
        return;
      }
      // Send using the same path as approveSmsDraft
      await sendSms({ to: fromPhone, content: phase1aResponse, fromNumberId: ENV.openPhoneCsNumberId || undefined });
      await db.update(madisonSmsDrafts)
        .set({ status: "SENT", sentAt: new Date(),
               qualityScore: { intentConfidence: 1.0, draftConfidence: 1.0, autoSendReason: "deterministic_template" },
               updatedAt: new Date() })
        .where(eq(madisonSmsDrafts.id, draftId));
      await postAutoSentCard({ draftId, sessionId, fromPhone,
        senderName: senderName ?? fromPhone, inboundText,
        autoReply: phase1aResponse, autoSendReason: "deterministic_template", autoSendConfidence: 1.0, db });
      console.log(`[MadisonSMS] Phase1A AUTO-SENT for ${fromPhone}: "${inboundText}" → "${phase1aResponse}"`);
      return;
    }

    // ── Step 1: Classify ────────────────────────────────────────────────────────────────────
    const classification = await classifyMessage(inboundText);
    await db.update(madisonSmsDrafts)
      .set({ status: "CLASSIFIED", messageType: classification.type, updatedAt: new Date() })
      .where(eq(madisonSmsDrafts.id, draftId));

    // ── Step 2: Resolve Intent (deterministic rules first, LLM fallback) ──────
    const intent = resolveIntent(classification.type, inboundText);

    // ── Step 3: Resolve Context (who is this person?) ─────────────────────────
    const context = await resolveMadisonContext(fromPhone, isCleaner, senderName, db);
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

    // ── Step 4.5: Fetch conversation history for LLM context ─────────────────
    let conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
    try {
      const [sessionRow] = await db
        .select({
          messageHistory: conversationSessions.messageHistory,
        })
        .from(conversationSessions)
        .where(eq(conversationSessions.id, sessionId))
        .limit(1);
      const parsed = JSON.parse((sessionRow?.messageHistory as string) ?? "[]");
      if (Array.isArray(parsed)) {
        conversationMessages = parsed
          .map((m: any) => {
            const role =
              m.role === "assistant" ? "assistant" as const
              : m.role === "user" ? "user" as const
              : null;
            return role && m.content?.trim()
              ? { role, content: m.content.trim() }
              : null;
          })
          .filter((m): m is { role: "user" | "assistant"; content: string } => m !== null)
          .slice(-8);
      }
    } catch (err) {
      console.warn("[MadisonSMS] Failed to fetch conversation history:", err);
    }

    // ── Step 5: Generate DraftResponse ────────────────────────────────────────
    // Quote Agent is isolated but intentionally disabled; quote messages use
    // the normal Madison approval draft until that agent is rebuilt and tested.
    const draftResponse = await generateDraftResponse({
      inboundText,
      senderName: context.senderName ?? senderName,
      isCleaner,
      classification,
      intent,
      context,
      capabilityResult,
      knowledgeContext,
      conversationMessages,
    });
    const reviewDraft = draftResponse.draft;

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
        generatedDraft: reviewDraft,
        intentSummary: draftResponse.intentSummary,
        qualityScore: qualityScore as any,
        updatedAt: new Date(),
      })
      .where(eq(madisonSmsDrafts.id, draftId));

    const contextUsed = [
      {
        kind: "latest_message" as const,
        id: inboundOpenPhoneId,
        summary: "Latest inbound SMS",
      },
      ...(context.bookingId
        ? [{ kind: "active_booking" as const, id: String(context.bookingId), summary: "Matched native booking" }]
        : []),
      ...(context.leadflowJobId
        ? [{ kind: "upcoming_booking" as const, id: String(context.leadflowJobId), summary: "Matched LeadFlow operational job" }]
        : []),
    ];
    await persistMadisonDecision(db, {
      sourceMessageId: inboundOpenPhoneId,
      sessionId,
      customerId: context.customerId ?? null,
      inboundText,
      classification,
      intent,
      intentSummary: draftResponse.intentSummary,
      draft: reviewDraft,
      context,
      capabilityResult,
      contextUsed,
    });
    // ── Step 7.5: Classify lead category ────────────────────────────────────────
    const leadCategory = await classifyLeadCategory({
      sessionId,
      context,
      intent,
      intentSummary: draftResponse.intentSummary,
      conversationMessages,
      db,
    });

    // ── Step 7.6: Human approval boundary ─────────────────────────────────────
    // Quote replies and every other substantive generated draft remain DRAFT_READY
    // until an agent approves them through opsChat.approveSmsDraft.

    // ── Step 8: Post Draft Card to Command Chat ───────────────────────────────
    await postDraftCardToCommandChat({
      draftId,
      sessionId,
      fromPhone,
      senderName: context.senderName ?? senderName,
      isCleaner,
      inboundText,
      draft: reviewDraft,
      observations: draftResponse.observations,
      leadCategory,
      unansweredMinutes,
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

// ─── Step 4a: Capability — get_eta ───────────────────────────────────────────

export async function executeGetEta(
  context: ResolvedContext,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<CapabilityResult> {
  if (!context.leadflowJobId) {
    return {
      capability: "get_eta",
      capabilityVersion: 2,
      args: {},
      result: { found: false, reason: "leadflow_job_unresolved" },
      observations: ["No unambiguous LeadFlow-owned operational job matched this customer."],
      suggestedActions: ["send", "edit", "dismiss"],
      followUps: ["Verify the customer and booking before checking ETA."],
    };
  }

  const progress = await getMadisonEtaProgress(context.leadflowJobId, db);

  return {
    capability: "get_eta",
    capabilityVersion: 2,
    args: { leadflowJobId: context.leadflowJobId },
    result: {
      found: true,
      serviceDateTime: context.serviceDateTime,
      teamName: context.teamName,
      etaTimeStr: progress?.etaTimeStr ?? null,
      etaTimestamp: progress?.etaTimestamp ?? null,
      jobStatus: progress?.jobStatus ?? "assigned",
    },
    observations: progress?.etaTimeStr
      ? [`LeadFlow ETA on file: ${progress.etaTimeStr}.`]
      : ["LeadFlow job matched, but no ETA has been recorded yet."],
    suggestedActions: ["send", "edit", "dismiss"],
    followUps: progress?.etaTimeStr ? [] : ["Verify ETA with the assigned team before promising a time."],
  };
}

// ─── Step 4b: Capability — card_status ───────────────────────────────────────

export async function executeCardStatus(
  context: ResolvedContext,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<CapabilityResult> {
  if (!context.bookingId) {
    return {
      capability: "card_status",
      capabilityVersion: 2,
      args: {},
      result: { found: false, reason: "booking_unresolved" },
      observations: ["No unambiguous native booking matched this customer."],
      suggestedActions: ["send", "edit", "dismiss"],
      followUps: ["Verify the customer and booking before checking payment status."],
    };
  }

  const payment = await getMadisonBookingPayment(context.bookingId, db);
  return {
    capability: "card_status",
    capabilityVersion: 2,
    args: { bookingId: context.bookingId },
    result: payment ? { found: true, ...payment } : { found: false, reason: "booking_not_found" },
    observations: payment
      ? [`Native booking payment status: ${payment.paymentStatus}.`]
      : ["The resolved native booking no longer exists."],
    suggestedActions: ["send", "edit", "dismiss"],
    followUps: [],
  };
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
  conversationMessages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<DraftResponse> {
  const { inboundText, senderName, isCleaner, classification, intent, context, capabilityResult, knowledgeContext, conversationMessages } = params;

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

=== TONE ===
Warm, direct, and genuinely human. Think: a real person texting, not a corporate script. Short sentences. Conversational. Like you actually care — because you do.

Be SPECIFIC. Use the customer's actual name, their actual booking date, their actual cleaner's name, their actual service type. Generic messages feel hollow. Specific messages feel like you actually know them — because you do.

Be CONNECTING. Don't just answer the question and bail. Acknowledge the person, not just the problem. A little warmth goes a long way. If they're excited, match it. If they're frustrated, sit with them for a moment before solving.

Length: Write until the message feels COMPLETE — not until you hit a sentence count. The test is: would a real person feel heard, helped, and cared for after reading this? If yes, you're done. If it still feels like a quick brush-off, you're not done yet. A genuine response to a special request, a complaint, or a meaningful moment should feel warm and full — not like a ticket being closed. Never count sentences. Never truncate to save space. Never pad with filler. Just write what the moment actually deserves.

Examples of the right tone:
- "No worries at all, [Name]! Life happens 😊. We've moved your clean to [New Day] at [New Time]. Your home will be ready whenever you are. ✨"
- "[Name], we are SO sorry we missed [area]. That's not our standard. We're sending someone back at NO charge to make it right. When works for you? 🙏"
- "Hey [Name]! Just checking in — still loving that clean-house feeling? 🌟 If anything wasn't perfect, tell us and we'll make it right. No drama, no hassle. 💪"
- "[Name], thank you for telling us — seriously. We'd rather know than not. Let's fix this together. What would make it right for you? 🤝"
- "Rise and shine, [Name]! ☀️ Today's the day your home gets its glow-up. Your crew arrives at [Time] and they are READY."
- "Hey [Name]! Meet your cleaner today — [Cleaner Name]! 👋 They're one of our absolute favorites (don't tell the others 😄). You're in great hands."
- "[Name], we're here! 🏡 Your crew just arrived and is getting started. Grab a coffee, go enjoy your day — we've completely got it from here. 😌"
- "Hey [Name]! Your cleaner noticed your [fridge/oven] was looking a little rough, so they showed it some extra love today — no charge. 🙌 We just can't help ourselves."
- "Hi [Name]! Your regular cleaner [Name] is out today. We're sending [Sub Name] instead, who is equally amazing. Same standards, same care. You're covered! 💛"
- "[Name], we completely understand the frustration and we hear you. Let us make this right — no runaround, no excuses. Here's what we're going to do: [solution]. Does that work for you? 💛"
- "No worries at all, [Name] — life is unpredictable and we totally get it! ✌️ Your clean is cancelled with zero fees. Whenever you're ready to book again, we'll be right here. 💛"
- "[Name], we saw your feedback and we're genuinely grateful you told us. We dropped the ball and we own it. Can we earn your trust back? We'd love one more shot — on us. 🙏"
- "[Name], please do NOT apologize for the mess — that's literally why we exist and we LOVE it 😄. The bigger the challenge, the better we feel about the results. No judgment ever. 🧹💪"
- "[Name], this just made our whole day!! 🥹 We're passing this along to [Cleaner Name] right now — they are going to be SO happy to hear this. Thank YOU for taking the time. 💛"
- "[Name], you've been with us for [X] months and we just want to make sure we're still knocking it out of the park for you. 🏡 Anything we can do better or differently? Honest answers welcome!"
- "Got it, [Name]! Notes are in — [specific instructions]. Your crew has been briefed and will follow these to the letter. ✅"

=== WHAT NOT TO WRITE (BAD EXAMPLES) ===
These are the kinds of hollow, corporate-sounding messages you must NEVER produce:
- "Got it, Kate! Thanks for confirming. Our team will take care of those cabinets for you. 😊" ← Too short. No warmth. Feels like a ticket being closed.
- "Hi Sarah! We've received your request and will handle it accordingly." ← Corporate, cold, zero personality.
- "No problem! We'll pass that along to the team." ← Vague, impersonal, says nothing.
- "Thank you for letting us know. We appreciate your patience." ← Filler. Means nothing. Sounds automated.
- "Noted! We'll make sure to address that." ← One sentence. No connection. Doesn't feel human.

When you catch yourself writing something like the above — stop. Start over. Ask: does this feel like a real person who actually cares? If not, rewrite it.

=== EMOJI RULES ===
- Use 1–3 emojis max per message, placed naturally (not forced).
- Only use emojis that fit the moment: 🙏 for apologies, ✨ for positive moments, 😊 for friendly, 💪 for reassurance.
- Never use sparkle/glitter emojis (✨🌟) for complaints or serious situations.
- No emoji overload. Less is more.

=== WRITING RULES ===
1. Write the EXACT message — not a template, not advice.
2. Use the customer's first name naturally (once, near the start).
3. If job details are provided (date, service type, cleaner name), weave them in naturally — don't just list them.
4. Always include a clear next step or resolution — never leave them hanging.
5. Never be defensive. Never make excuses. Own the experience.
6. Sound like a real person, not a brand. No corporate buzzwords, no "we strive to...", no "rest assured".
7. Do NOT say "make your home sparkle" or similar cheesy lines.
8. Use the Maids in Black knowledge base for accurate details (guarantee, policies, team info).
9. Never make up information — only use the context provided.
10. If you don't have enough info to answer confidently, say so warmly and offer to check.

Return JSON only.${contextBlock}

Additional context:
- The customer's intent has been classified as "${intent ?? classification.type}".
- Use that classification when drafting the reply.
- Do not ask questions already answered in the conversation history above.

=== MAIDS IN BLACK KNOWLEDGE BASE ===
${MAIDS_IN_BLACK_KNOWLEDGE_BASE}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationMessages,
        { role: "user", content: inboundText },
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

// ─── Step 7.5: Classify Lead Category ───────────────────────────────────────

// leadCategory is only persisted when classification succeeds: "lead" | "regular".
// Technical failures (timeout, malformed output) return null — nothing is stored.
type LeadCategory = "lead" | "regular";

/**
 * Classifies whether this conversation is about a new sales opportunity (lead)
 * or an operational/service interaction with an existing customer (regular).
 *
 * Rules: deterministic overrides first, AI fallback only for ambiguous cases.
 * Never fires on leadSource alone. Never fires on bookedCount alone.
 */
async function classifyLeadCategory(params: {
  sessionId: number;
  context: ResolvedContext;
  intent: string | null;
  intentSummary: string;
  conversationMessages: Array<{ role: "user" | "assistant"; content: string }>;
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
}): Promise<LeadCategory | null> {
  const { sessionId, context, intent, intentSummary, conversationMessages, db } = params;

  try {
    // ── Deterministic rule 1: cleaner/team member → always regular ────────────
    if (context.isCleaner) return "regular";

    // ── Deterministic rule 2: has a job today → operational → regular ─────────
    if (context.bookingId || context.leadflowJobId) return "regular";

    // ── Deterministic rule 3: operational intents → regular ───────────────────
    if (intent === "get_eta" || intent === "card_status") return "regular";

    // ── Deterministic rule 4: fetch session to check stage/csQueue ────────────
    const [session] = await db
      .select({
        stage: conversationSessions.stage,
        csQueue: conversationSessions.csQueue,
      })
      .from(conversationSessions)
      .where(eq(conversationSessions.id, sessionId))
      .limit(1);

    // Session not found — fall through to AI fallback
    if (!session) {
      // handled below
    } else {
      // Post-booking operational stages → regular
      const operationalStages = new Set([
        "BOOKED",
        "SCHEDULE_CONFIRM_SENT",
        "SCHEDULE_CONFIRM_DONE",
        "QUALITY_RATING_REQUESTED",
        "QUALITY_RATING_DONE",
        "REVIEW_REQUESTED",
        "REVIEW_DONE",
        "REVIEW_REBOOKING_REQUESTED",
        "REVIEW_REBOOKING_DONE",
      ]);
      if (operationalStages.has(session.stage)) return "regular";
      // Cleaner-side CS queue → regular
      if (session.csQueue === "Teams") return "regular";
    }

    // ── AI fallback: force lead | regular decision ─────────────────────────────
    const lastMessages = conversationMessages.slice(-6);
    const historyText = lastMessages
      .map(m => `${m.role === "user" ? "Customer" : "Agent"}: ${m.content}`)
      .join("\n");

    const prompt = [
      `Intent summary: ${intentSummary}`,
      historyText ? `\nRecent conversation:\n${historyText}` : "",
    ].join("").trim();

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You classify customer SMS conversations for a cleaning service.

You MUST choose exactly one:
- "lead" = potential customer currently considering, requesting, or trying to book a cleaning service they haven't booked yet
- "regular" = existing/booked customer, cleaner/team member, operational or support conversation, or anything that is NOT a current sales opportunity

Return JSON only. No prose.`,
        },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "lead_category",
          strict: true,
          schema: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["lead", "regular"] },
            },
            required: ["category"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response?.choices?.[0]?.message?.content;
    if (!content) {
      console.warn("[MadisonSMS] classifyLeadCategory: empty LLM response — omitting category");
      return null;
    }
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    const cat = parsed?.category;
    if (cat === "lead" || cat === "regular") return cat;
    console.warn("[MadisonSMS] classifyLeadCategory: unexpected LLM value:", cat, "— omitting category");
    return null;
  } catch (err) {
    console.warn("[MadisonSMS] classifyLeadCategory failed — omitting category:", err);
    return null;
  }
}

// ─── Step 8: Post Draft Card to Command Chat ──────────────────────────────────

async function postDraftCardToCommandChat(params: {
  draftId: number;
  sessionId: number;
  fromPhone: string;
  senderName?: string;
  isCleaner: boolean;
  inboundText: string;
  draft: string;
  observations: string[];
  leadCategory: LeadCategory | null;
  /** Minutes the customer has been waiting unanswered — shown as red banner in the card */
  unansweredMinutes?: number;
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
}): Promise<void> {
  const { draftId, sessionId, fromPhone, senderName, isCleaner, inboundText, draft, observations, leadCategory, unansweredMinutes, db } = params;

  const displayName = senderName ?? fromPhone;
  const senderLabel = isCleaner ? "🧹 Cleaner" : "👤 Customer";

  // Build the card body — Madison narrates what she found, then presents the draft
  const body = [
    `${senderLabel}: ${displayName}`,
    `"${inboundText}"`,
    "",
    ...observations.slice(0, 3),
    "",
    `Draft: ${draft}`,
  ].join("\n").trim();

  // Upsert: one active card per session — if a card already exists for this session,
  // update its body/metadata/lastActivityAt so it resurfaces at the top of the feed.
  // Uses Drizzle's onDuplicateKeyUpdate() which produces a fully parameterized query;
  // no customer-controlled string is ever concatenated into SQL text.
  const eventTs = Date.now();
  const dedupKey = `madison_sms_draft:${sessionId}`;
  // Preserve any existing metadata keys; add leadCategory without rebuilding from scratch
  let existingMeta: Record<string, unknown> = {};
  try {
    const [existing] = await db
      .select({ metadata: opsChatMessages.metadata })
      .from(opsChatMessages)
      .where(eq(opsChatMessages.activeDedupKey, dedupKey))
      .limit(1);
    if (existing?.metadata) existingMeta = JSON.parse(existing.metadata as string);
  } catch { /* no existing card — start fresh */ }
  // Only include leadCategory in metadata when classification succeeded (non-null).
  // On technical failure, omit the key entirely so old cards stay visually unchanged.
  // isCleaner is always written — it is a deterministic boolean, never ambiguous.
  const metadataJson = JSON.stringify({
    ...existingMeta,
    draftId,
    quickActionVersion: 1,
    sessionId,
    isCleaner,
    ...(leadCategory !== null ? { leadCategory } : {}),
    ...(unansweredMinutes !== undefined ? { unansweredMinutes } : {}),
  });
  await db
    .insert(opsChatMessages)
    .values({
      channel: "command",
      authorName: "Madison",
      authorRole: "system",
      body,
      quickAction: "madison_sms_draft",
      metadata: metadataJson,
      sessionId,
      lastActivityAt: eventTs,
      cardStatus: "active",
      activeDedupKey: dedupKey,
    })
    .onDuplicateKeyUpdate({
      set: {
        body,
        metadata: metadataJson,
        // Keep the later timestamp; GREATEST guards against clock skew on retry
        lastActivityAt: sql`GREATEST(COALESCE(${opsChatMessages.lastActivityAt}, 0), ${eventTs})`,
        cardStatus: "active",
        activeDedupKey: dedupKey,
      },
    });

  // Broadcast SSE so Command Chat updates instantly
  const { broadcastOpsUpdate } = await import("./sseBroadcast");
  broadcastOpsUpdate("new_message", { channel: "command" });
}

// ─── Phase 1A: Deterministic Template Responses ────────────────────────────────────────────────────────────────────

/**
 * Context-independent social acknowledgments — safe regardless of prior conversation.
 * One fixed response per group. No LLM. No randomization.
 */
const PHASE1A_TEMPLATES: [RegExp, string][] = [
  [/^(thanks|thank you|thank u|thx)[!.\s]*$/i,             "You're welcome! \uD83D\uDE0A"],
  [/^(okay thanks|ok thanks|ok thank you|got it thanks)[!.\s]*$/i, "You're welcome! \uD83D\uDE0A"],
  [/^(have a good day|have a great day)[!.\s]*$/i,          "You too! Have a great day \uD83D\uDE0A"],
];

/**
 * Returns the fixed template response if the inbound text is a Phase 1A phrase,
 * or null if it should go through the normal Madison pipeline.
 */
function pickPhase1AResponse(inboundText: string): string | null {
  const normalised = inboundText.trim().replace(/[\u{1F300}-\u{1FFFF}]/gu, "").trim();
  for (const [pattern, response] of PHASE1A_TEMPLATES) {
    if (pattern.test(normalised)) return response;
  }
  return null;
}

async function postAutoSentCard(params: {
  draftId: number;
  sessionId: number;
  fromPhone: string;
  senderName: string;
  inboundText: string;
  autoReply: string;
  autoSendReason: "deterministic_template" | "verified_quote";
  autoSendConfidence: number;
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
}): Promise<void> {
  const { draftId, sessionId, fromPhone, senderName, inboundText, autoReply, autoSendReason, autoSendConfidence, db } = params;
  const eventTs = Date.now();
  const body = `Madison sent reply\n${senderName}: "${inboundText}"\nMadison: "${autoReply}"`;
  const metadataJson = JSON.stringify({
    draftId,
    sessionId,
    leadName: senderName,
    inboundText,
    autoReply,
    autoSentAt: new Date().toISOString(),
    autoSendReason,
    autoSendConfidence,
  });
  await db.insert(opsChatMessages).values({
    channel: "command",
    authorName: "Madison",
    authorRole: "system",
    body,
    quickAction: "madison_sms_draft",
    metadata: metadataJson,
    sessionId,
    lastActivityAt: eventTs,
    // Keep the sent reply visible until the owner explicitly dismisses it.
    cardStatus: "active",
    activeDedupKey: null,
  });
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
