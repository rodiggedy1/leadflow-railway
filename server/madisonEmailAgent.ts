/**
 * Madison Email Draft Agent
 *
 * Pipeline: Inbound Email → Generate Draft Reply → Insert madison_email_drafts
 *           → Post madison_email_draft card to Command Chat for human approval
 *
 * Entry point: triggerMadisonEmailDraft() — fire-and-forget from gmailRouter.ts listThreads
 *
 * Architecture rules (mirrors madisonSmsAgent.ts):
 * - This file NEVER throws — all errors are caught and written to madisonEmailDrafts.status=FAILED
 * - generatedDraft is NEVER overwritten — approvedText stores what was actually sent
 * - Sending uses sendGmailReply() — the same function the AI concierge uses
 */
import { getDb } from "./db";
import { madisonEmailDrafts, opsChatMessages } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "./knowledgeBase";
import { retrieveKnowledge } from "./madisonKnowledgeRetrieval";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailDraftResponse {
  draft: string;
  intentSummary: string;
  draftConfidence: number;
  observations: string[];
  suggestedActions: string[];
  followUps: string[];
}

// ─── Pipeline Entry Point ─────────────────────────────────────────────────────

/**
 * Fire-and-forget entry point. Call from listThreads after fetching unread actionable threads.
 * Never throws — all errors are caught and written to the DB.
 */
export async function triggerMadisonEmailDraft(params: {
  threadId: string;
  inboundMessageId: string;
  fromEmail: string;
  replyToEmail?: string | null;
  senderName?: string;
  subject?: string;
  inboundText: string;
}): Promise<void> {
  const { threadId, inboundMessageId, fromEmail, replyToEmail, senderName, subject, inboundText } = params;
  const pipelineStart = Date.now();

  // Skip empty messages
  if (!inboundText?.trim()) {
    console.log(`[email-draft] skipped threadId=${threadId} reason=empty_body`);
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error(`[email-draft] error threadId=${threadId} reason=no_db_connection`);
    return;
  }

  let draftId: number | undefined;

  try {
    // ── Step 0: Claim thread (insert RECEIVED row) ────────────────────────────
    console.log(`[email-draft] candidate threadId=${threadId} fromEmail=${fromEmail}`);

    const insertResult = await db.insert(madisonEmailDrafts).values({
      threadId,
      inboundMessageId,
      fromEmail,
      replyToEmail: replyToEmail ?? null,
      senderName,
      subject,
      status: "RECEIVED",
      originalMessage: inboundText,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).catch((err) => {
      // Duplicate threadId or inboundMessageId — already claimed
      if (err.message?.includes("Duplicate") || err.code === "ER_DUP_ENTRY") {
        console.log(`[email-draft] already_claimed threadId=${threadId} inboundMessageId=${inboundMessageId}`);
        return null;
      }
      throw err;
    });

    if (!insertResult) return;
    const [insertHeader] = insertResult as any;
    draftId = insertHeader.insertId as number;
    console.log(`[email-draft] claim_inserted threadId=${threadId} draftId=${draftId} elapsed=${Date.now() - pipelineStart}ms`);

    // ── Step 1: Mark CLASSIFIED ───────────────────────────────────────────────
    await db.update(madisonEmailDrafts)
      .set({ status: "CLASSIFIED", messageType: "QUESTION", updatedAt: new Date() })
      .where(eq(madisonEmailDrafts.id, draftId));

    // ── Step 2: Knowledge retrieval ───────────────────────────────────────────
    await db.update(madisonEmailDrafts)
      .set({ status: "TOOLS_RUNNING", updatedAt: new Date() })
      .where(eq(madisonEmailDrafts.id, draftId));

    let knowledgeContext: string | null = null;
    try {
      knowledgeContext = await retrieveKnowledge(inboundText);
    } catch {
      // Non-fatal — continue without KB context
    }

    // ── Step 3: Generate Draft Reply ──────────────────────────────────────────
    console.log(`[email-draft] llm_started threadId=${threadId} draftId=${draftId} elapsed=${Date.now() - pipelineStart}ms`);
    const draftResponse = await generateEmailDraftResponse({
      inboundText,
      senderName,
      subject,
      knowledgeContext,
    });

    // ── Step 4: Persist draft ─────────────────────────────────────────────────
    await db.update(madisonEmailDrafts)
      .set({
        status: "DRAFT_READY",
        observations: draftResponse.observations as any,
        suggestedActions: draftResponse.suggestedActions as any,
        followUps: draftResponse.followUps as any,
        generatedDraft: draftResponse.draft,
        intentSummary: draftResponse.intentSummary,
        updatedAt: new Date(),
      })
      .where(eq(madisonEmailDrafts.id, draftId));
    console.log(`[email-draft] draft_ready threadId=${threadId} draftId=${draftId} elapsed=${Date.now() - pipelineStart}ms`);

    // ── Step 5: Post Draft Card to Command Chat (idempotent) ──────────────────
    const opsChatId = await postEmailDraftCardToCommandChat({
      draftId,
      threadId,
      fromEmail,
      senderName,
      subject,
      inboundText,
      draft: draftResponse.draft,
      observations: draftResponse.observations,
      db,
    });
    console.log(`[email-draft] ops_chat_inserted threadId=${threadId} draftId=${draftId} opsChatMessageId=${opsChatId} elapsed=${Date.now() - pipelineStart}ms`);

    console.log(`[email-draft] complete threadId=${threadId} draftId=${draftId} total=${Date.now() - pipelineStart}ms`);

  } catch (err: any) {
    console.error(`[email-draft] pipeline_error threadId=${threadId} draftId=${draftId ?? 'none'} elapsed=${Date.now() - pipelineStart}ms error_code=${err.code ?? 'UNKNOWN'} error=${err.message ?? String(err)}`);
    if (draftId) {
      const db2 = await getDb();
      if (db2) {
        await db2.update(madisonEmailDrafts)
          .set({
            status: "FAILED",
            errorStage: "pipeline",
            errorCode: err.code ?? "UNKNOWN",
            errorMessage: err.message ?? String(err),
            updatedAt: new Date(),
          })
          .where(eq(madisonEmailDrafts.id, draftId))
          .catch(() => {});
      }
    }
  }
}

// ─── Generate Email Draft Response ───────────────────────────────────────────

async function generateEmailDraftResponse(params: {
  inboundText: string;
  senderName?: string;
  subject?: string;
  knowledgeContext: string | null;
}): Promise<EmailDraftResponse> {
  const { inboundText, senderName, subject, knowledgeContext } = params;

  const firstName = senderName?.split(" ")[0] ?? "there";

  let contextBlock = "";
  if (knowledgeContext) {
    contextBlock = `\n\nRelevant knowledge base context:\n${knowledgeContext}`;
  }

  const systemPrompt = `You are Madison, the AI assistant for Maids in Black, a professional cleaning service in Washington DC.
You are drafting an EMAIL reply to a customer named ${firstName}.
${subject ? `Email subject: "${subject}"` : ""}

Rules:
- Write a complete, professional email reply (2–4 sentences)
- Warm, professional, helpful tone
- Never make up information — only use the context provided
- If you don't have enough info to answer confidently, say so warmly and offer to check
- Do NOT include a subject line in the draft — just the body
- Sign off as "Madison | Maids in Black"
- Return JSON only${contextBlock}

Business context:
${MAIDS_IN_BLACK_KNOWLEDGE_BASE.slice(0, 2000)}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Draft a reply to this inbound email:\n\n"${inboundText}"`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "email_draft_response",
          strict: true,
          schema: {
            type: "object",
            properties: {
              draft: { type: "string", description: "The full email body to send" },
              intentSummary: { type: "string", description: "One sentence describing what the customer wants" },
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

    return {
      draft: parsed.draft,
      intentSummary: parsed.intentSummary ?? "I drafted an email reply for you.",
      draftConfidence: Math.min(1, Math.max(0, parsed.draftConfidence ?? 0.7)),
      observations: parsed.observations ?? [],
      suggestedActions: parsed.suggestedActions ?? ["send", "edit", "dismiss"],
      followUps: parsed.followUps ?? [],
    };
  } catch (err) {
    console.warn("[email-draft] draft_generation_failed:", err);
    return {
      draft: `Hi ${firstName},\n\nThank you for reaching out! I'll look into this and get back to you shortly.\n\nMadison | Maids in Black`,
      intentSummary: "I drafted an email reply for you.",
      draftConfidence: 0.3,
      observations: ["Draft generation failed — fallback used"],
      suggestedActions: ["edit", "dismiss"],
      followUps: ["Review and edit before sending"],
    };
  }
}

// ─── Post Draft Card to Command Chat (idempotent) ─────────────────────────────

/**
 * Inserts an opsChatMessages row for this draft.
 * Idempotent: checks for an existing row with the same draftId before inserting.
 * Returns the opsChatMessages row id (existing or newly created).
 */
async function postEmailDraftCardToCommandChat(params: {
  draftId: number;
  threadId: string;
  fromEmail: string;
  senderName?: string;
  subject?: string;
  inboundText: string;
  draft: string;
  observations: string[];
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
}): Promise<number> {
  const { draftId, threadId, fromEmail, senderName, subject, inboundText, draft, observations, db } = params;

  // Idempotency check — don't insert a second card for the same draftId
  const existing = await db
    .select({ id: opsChatMessages.id, metadata: opsChatMessages.metadata })
    .from(opsChatMessages)
    .where(
      and(
        eq(opsChatMessages.channel, "command"),
        eq(opsChatMessages.quickAction, "madison_email_draft")
      )
    )
    .limit(50);

  for (const row of existing) {
    try {
      const meta = JSON.parse(row.metadata ?? "{}");
      if (meta.draftId === draftId) {
        console.log(`[email-draft] ops_chat_already_exists threadId=${threadId} draftId=${draftId} opsChatMessageId=${row.id}`);
        return row.id;
      }
    } catch { /* ignore */ }
  }

  const displayName = senderName ?? fromEmail;

  const body = [
    `📧 Customer: ${displayName}`,
    subject ? `Subject: ${subject}` : null,
    `"${inboundText.slice(0, 300)}${inboundText.length > 300 ? "…" : ""}"`,
    "",
    ...observations.slice(0, 3),
    "",
    `Draft: ${draft}`,
  ].filter(Boolean).join("\n").trim();

  const insertResult = await db.insert(opsChatMessages).values({
    channel: "command",
    authorName: "Madison",
    authorRole: "system",
    body,
    quickAction: "madison_email_draft",
    metadata: JSON.stringify({ draftId, quickActionVersion: 1, threadId }),
    replyToId: null,
    replyToBody: null,
    replyToAuthor: null,
    threadParentId: null,
  });

  const [header] = insertResult as any;
  const newId = header.insertId as number;

  // Broadcast SSE so Command Chat updates instantly
  const { broadcastOpsUpdate } = await import("./sseBroadcast");
  broadcastOpsUpdate("new_message", { channel: "command" });
  console.log(`[email-draft] sse_broadcast_sent threadId=${threadId} draftId=${draftId}`);

  return newId;
}
