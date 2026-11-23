import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { conversationSessions, opsChatMessages, madisonSmsDrafts } from "../../drizzle/schema";
import type { getDb } from "../db";
import { normalizePhone } from "../utils/phone";
import { normalizeThumbtackSmsPhone } from "../../shared/thumbtackSmsPhone";
import { THUMBTACK_ACCOUNT, THUMBTACK_FIRST_RESPONSE_CAPABILITY as capability,
  type CapturedLead, type EligibleLead, type FirstResponseClaim, type FirstResponseConfig, type FirstResponseStore } from "./claudeThumbtackFirstResponse";
import type { ThumbtackInitialLeadResult } from "../../shared/claudeInitialLead";
import { automaticClaudeSmsProvenance, automaticChatGptSmsProvenance, CHATGPT_WORLDCLASS_GENERATOR_ID } from "../../shared/smsSenderProvenance";
import type { ThumbtackQuoSmsResult } from "./thumbtackDirectQuoSms";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const rows = (result: unknown): any[] => (result as any)[0];
const header = (result: unknown): { insertId: number; affectedRows: number } => (result as any)[0];
const json = (value: unknown): any => typeof value === "string" ? JSON.parse(value) : value;
const payloadHash = (lead: EligibleLead) => createHash("sha256").update(lead.capture.rawPayload).digest("hex");
const intakeCapability = "thumbtack_lead_intake_v1";
const intakeKey = (lead: EligibleLead) => "tt-intake:v1:" + createHash("sha256")
  .update(JSON.stringify(["thumbtack", THUMBTACK_ACCOUNT, lead.native.negotiationId, lead.phone])).digest("hex");
function isSameNegotiation(receipt: any, lead: EligibleLead): boolean {
  try { return json(receipt?.resolvedContext)?.negotiationId === lead.native.negotiationId; } catch { return false; }
}
function isReceiptDuplicate(error: unknown): boolean {
  // Drizzle wraps the MySQL insertion error in cause; only this receipt index is an expected race.
  for (let current: any = error, depth = 0; current && depth < 5; current = current.cause, depth++) {
    if (current.code === "ER_DUP_ENTRY" && /\buq_sms_draft_inbound\b/.test(`${current.sqlMessage ?? ""} ${current.message ?? ""}`)) return true;
  }
  return false;
}
const binding = (claim: FirstResponseClaim) => ({ source: "thumbtack", account: THUMBTACK_ACCOUNT, negotiationId: claim.lead.native.negotiationId,
  captureId: claim.lead.capture.id, payloadHash: payloadHash(claim.lead), sessionId: claim.sessionId, key: claim.lead.key,
  phone: claim.lead.phone, fromNumberId: claim.fromNumberId, originalConversation: [] });

// Transport results are already redacted; persist only bounded receipt fields, never raw responses.
function providerReceipt(provider: ThumbtackQuoSmsResult): Record<string, string | number | boolean> {
  const receipt: Record<string, string | number | boolean> = { kind: provider.kind, success: provider.success };
  const limits = { code: 128, httpStatus: 16, providerStatus: 128, providerReason: 500, providerCode: 128, traceId: 256 };
  for (const [key, limit] of Object.entries(limits)) {
    const value = (provider as unknown as Record<string, unknown>)[key];
    if (typeof value === "string") receipt[key] = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
    else if (typeof value === "number" && Number.isFinite(value)) receipt[key] = value;
  }
  if (provider.kind === "accepted") receipt.messageId = provider.messageId;
  return receipt;
}

export function createClaudeThumbtackFirstResponseStore(db: Db, quote: (lead: EligibleLead) => string | null): FirstResponseStore {
  async function fresh(tx: Tx, claim: FirstResponseClaim): Promise<boolean> {
    const [draft] = rows(await tx.execute(sql`SELECT * FROM madison_sms_drafts WHERE id = ${claim.draftId} FOR UPDATE`));
    const [session] = rows(await tx.execute(sql`SELECT * FROM conversation_sessions WHERE id = ${claim.sessionId} FOR UPDATE`));
    // Business/card activity is not eligibility. Keep only this phone's send ownership and explicit consent.
    if (!draft || !session || !claim.lead.phone || draft.status !== "TOOLS_RUNNING" || draft.dismissedAt || draft.dismissedBy
      || draft.capability !== capability || draft.inboundOpenPhoneId !== claim.lead.key || Number(draft.sessionId) !== claim.sessionId
      || draft.fromPhone !== claim.lead.phone || session.leadPhone !== claim.lead.phone || Number(session.smsOptOut) !== 0) return false;
    if (rows(await tx.execute(sql`SELECT id FROM sms_opt_outs WHERE phone = ${claim.lead.phone}`)).length) return false;
    // Preserve global consent checks without using previous conversations/messages to reject a lead.
    const phone10 = claim.lead.phone.replace(/\D/g, "").slice(-10);
    const otherSessions = rows(await tx.execute(sql`SELECT leadPhone, smsOptOut FROM conversation_sessions
      WHERE RIGHT(REGEXP_REPLACE(leadPhone, '[^0-9]', ''), 10) = ${phone10} AND id <> ${claim.sessionId}`));
    if (otherSessions.some(other => normalizeThumbtackSmsPhone(other.leadPhone) === claim.lead.phone && Number(other.smsOptOut))) return false;
    return true;
  }
  async function resume(tx: Tx, lead: EligibleLead, config: FirstResponseConfig): Promise<FirstResponseClaim | null> {
    const [draft] = rows(await tx.execute(sql`SELECT * FROM madison_sms_drafts
      WHERE inboundOpenPhoneId = ${lead.key} AND capability = ${capability} LIMIT 1 FOR UPDATE`));
    if (!draft || !lead.phone || !isSameNegotiation(draft, lead) || !["DISMISSED", "FAILED"].includes(draft.status)
      || draft.dismissedAt || draft.dismissedBy || draft.errorCode === "MANUAL_FIRST_RESPONSE" || draft.outboundOpenPhoneId) return null;
    let state: any;
    try { state = json(draft.capabilityResult); } catch { return null; }
    if (!state || state.messageId || state.provider?.messageId) return null;
    const neverSubmitted = state.phase === "claimed" && draft.errorStage === "GATE" && draft.errorCode && !state.provider;
    const rejected = state.phase === "submission_rejected" && state.provider?.kind === "rejected";
    if (!neverSubmitted && !rejected) return null;
    const sessionId = Number(draft.sessionId);
    const [session] = rows(await tx.execute(sql`SELECT messageHistory FROM conversation_sessions WHERE id = ${sessionId} FOR UPDATE`));
    let history: any;
    try { history = json(session?.messageHistory); } catch { return null; }
    if (!session || !Array.isArray(history) || history.some(message => message?.role === "assistant")) return null;
    const [card] = rows(await tx.execute(sql`SELECT id FROM ops_chat_messages WHERE sessionId = ${sessionId} AND quickAction = 'new_lead' LIMIT 1`));
    if (!card) return null;
    const claim: FirstResponseClaim = { draftId: Number(draft.id), sessionId, cardId: Number(card.id), lead, fromNumberId: config.fromNumberId };
    const updated = await tx.execute(sql`UPDATE madison_sms_drafts SET status = 'TOOLS_RUNNING',
      capabilityResult = ${JSON.stringify({ phase: "claimed", startAt: config.startAt })}, errorStage = NULL, errorCode = NULL,
      updatedAt = NOW(3) WHERE id = ${claim.draftId} AND status = ${draft.status}
      AND dismissedAt IS NULL AND dismissedBy IS NULL AND outboundOpenPhoneId IS NULL`);
    if (header(updated).affectedRows !== 1) return null;
    return claim;
  }
  return {
    async loadCapture(id) {
      const [row] = rows(await db.execute(sql`SELECT id, source, event_type, created_at, raw_payload FROM webhook_events WHERE id = ${id}`));
      if (!row || row.source !== "thumbtack" || row.event_type !== "NegotiationCreatedV4") return null;
      let negotiationId: unknown;
      try { negotiationId = json(row.raw_payload)?.data?.negotiationID; } catch { /* retained payload remains available in native listing */ }
      if (typeof negotiationId !== "string" || !negotiationId.trim()) {
        console.warn("[ThumbtackClaude] retained native capture has no usable negotiation identity; intake claim unavailable", id);
        return null;
      }
      return { id: Number(row.id), source: row.source, eventType: row.event_type, receivedAt: new Date(row.created_at),
        rawPayload: row.raw_payload } satisfies CapturedLead;
    },
    async claim(lead, config) {
      const key = intakeKey(lead);
      let introductionAttempted = false;
      const attempt = (confirmedPhoneReceipt?: any) => db.transaction(async tx => {
          if (rows(await tx.execute(sql`SELECT id FROM madison_sms_drafts WHERE inboundOpenPhoneId = ${key} AND capability = ${intakeCapability} LIMIT 1`)).length) return resume(tx, lead, config);
          const [exact] = rows(await tx.execute(sql`SELECT id, resolvedContext FROM madison_sms_drafts WHERE inboundOpenPhoneId = ${lead.key} AND capability = ${capability} LIMIT 1`));
          // Older native receipts used negotiation/attempt hashes but persisted the same canonical phone.
          const older = lead.phone ? rows(await tx.execute(sql`SELECT id, resolvedContext FROM madison_sms_drafts WHERE fromPhone = ${lead.phone}
            AND capability = ${capability} AND inboundOpenPhoneId LIKE 'tt-first:v1:%'`)) : [];
          // Pre-fix claims already created their session/card atomically. Recognize those retries too.
          if (exact) return resume(tx, lead, config);
          if (confirmedPhoneReceipt || older.some(receipt => isSameNegotiation(receipt, lead))) return null;
          const price = quote(lead), now = new Date();
          const phone = lead.phone ?? `no-phone-tt-${lead.capture.id}`;
          const sessionId = Number(header(await tx.insert(conversationSessions).values({ leadPhone: phone, leadName: lead.facts.name,
            stage: "AVAILABILITY", quotedPrice: price, serviceType: lead.facts.serviceType, bedrooms: lead.facts.bedrooms,
            bathrooms: lead.facts.bathrooms, extras: JSON.stringify(lead.facts.extras), address: lead.facts.address, messageHistory: "[]",
            leadSource: "thumbtack", barkQA: [lead.facts.description, lead.facts.frequency ? `Frequency: ${lead.facts.frequency}` : null,
              `Thumbtack ID: ${lead.native.negotiationId}`].filter(Boolean).join(" | ") })).insertId);
          if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw new Error("SESSION_INSERT_ID_MISSING");
          const claim: FirstResponseClaim = { draftId: 0, sessionId, cardId: 0, lead, fromNumberId: config.fromNumberId };
          // Terminal, non-sendable receipt: its unique key belongs to intake, never to an introduction.
          const intakeId = Number(header(await tx.insert(madisonSmsDrafts).values({ inboundOpenPhoneId: key, sessionId, fromPhone: phone,
            senderName: lead.facts.name, senderType: "customer", status: "DISMISSED", capability: intakeCapability, capabilityVersion: 1,
            resolvedContext: binding(claim), capabilityResult: { phase: "intake_recorded" }, originalMessage: "",
            observations: [], suggestedActions: [], followUps: [], sendPolicyMode: "disabled", sendPolicyEnabled: 0,
            sendPolicyEvaluatedAt: now, createdAt: now, updatedAt: now })).insertId);
          const size = [lead.facts.bedrooms, lead.facts.bathrooms].filter(Boolean).join(" / ");
          claim.cardId = Number(header(await tx.insert(opsChatMessages).values({ channel: "command", authorName: "🎯 New Lead", authorRole: "system",
            quickAction: "new_lead", sessionId, body: `📌 **Thumbtack Lead** · ${lead.facts.name} · ${phone}\n🏠 **${lead.facts.serviceType ?? "Not provided"}**${size ? ` · ${size}` : ""}${price ? ` · **$${price}**` : ""}`,
            metadata: JSON.stringify({ leadName: lead.facts.name, leadPhone: lead.phone, serviceType: lead.facts.serviceType,
              location: lead.facts.location, requestedDates: lead.facts.requestedDates, propertyType: null, extras: lead.facts.extras,
              bedrooms: lead.facts.bedrooms, bathrooms: lead.facts.bathrooms, frequency: lead.facts.frequency, summary: lead.facts.description,
              size, price, utmSource: "thumbtack", sessionId, arrivedAt: now.getTime(), negotiationId: lead.native.negotiationId,
              nativeFirstResponseKey: lead.key }) })).insertId);
          if (![intakeId, claim.cardId].every(id => Number.isSafeInteger(id) && id > 0)) throw new Error("INTAKE_OR_CARD_INSERT_ID_MISSING");
          // A new lead card is the trigger. Another negotiation's phone receipt is not an eligibility veto.
          try {
            introductionAttempted = true;
            claim.draftId = Number(header(await tx.insert(madisonSmsDrafts).values({ inboundOpenPhoneId: lead.key, sessionId, fromPhone: phone,
              senderName: lead.facts.name, senderType: "customer", status: lead.sendEligible ? "TOOLS_RUNNING" : "DISMISSED", capability, capabilityVersion: 1,
              resolvedContext: binding(claim), capabilityResult: { phase: lead.sendEligible ? "claimed" : "no_valid_phone", startAt: config.startAt },
              errorStage: lead.sendEligible ? null : "GATE", errorCode: lead.sendEligible ? null : "NO_VALID_PHONE",
              originalMessage: buildOriginalMessage(lead), observations: [], suggestedActions: [], followUps: [],
              sendPolicyMode: "automatic", sendPolicyEnabled: 1, sendPolicyEvaluatedAt: now, createdAt: now, updatedAt: now })).insertId);
          } catch (error) {
            // A competing negotiation won this phone. Current locking read confirms it; intake still commits.
            if (isReceiptDuplicate(error)) {
              const [winner] = rows(await tx.execute(sql`SELECT id, resolvedContext FROM madison_sms_drafts
                WHERE inboundOpenPhoneId = ${lead.key} AND capability = ${capability} LIMIT 1 FOR UPDATE`));
              if (winner && !isSameNegotiation(winner, lead)) return null;
              // A pre-fix writer may have just created this same negotiation: roll back provisional intake.
            }
            throw error;
          }
          if (!Number.isSafeInteger(claim.draftId) || claim.draftId <= 0) throw new Error("CLAIM_INSERT_ID_MISSING");
          return claim;
        });
      try {
        return await attempt();
      } catch (error) {
        // Same-negotiation race: the losing transaction rolls back its entire duplicate intake.
        if (isReceiptDuplicate(error) && rows(await db.execute(sql`SELECT id FROM madison_sms_drafts
          WHERE inboundOpenPhoneId = ${key} AND capability = ${intakeCapability} LIMIT 1`)).length) return null;
        // Some engines detect uniqueness at COMMIT. Recover intake once, only after a committed phone winner is verified.
        if (introductionAttempted && isReceiptDuplicate(error)) {
          const [winner] = rows(await db.execute(sql`SELECT id, resolvedContext FROM madison_sms_drafts
            WHERE inboundOpenPhoneId = ${lead.key} AND capability = ${capability} LIMIT 1`));
          if (winner) {
            try { return await attempt(winner); } catch (recoveryError) {
              // Another delivery may win intake during this one bounded, intake-only recovery.
              if (isReceiptDuplicate(recoveryError) && rows(await db.execute(sql`SELECT id FROM madison_sms_drafts
                WHERE inboundOpenPhoneId = ${key} AND capability = ${intakeCapability} LIMIT 1`)).length) return null;
              throw recoveryError;
            }
          }
        }
        throw error;
      }
    },
    fresh: claim => db.transaction(tx => fresh(tx, claim)),
    beginSend: (claim, result) => db.transaction(async tx => {
      if (!await fresh(tx, claim)) return false;
      const updated = await tx.execute(sql`UPDATE madison_sms_drafts SET status = 'SENDING', generatedDraft = ${result.replyText},
        approvedText = ${result.replyText}, approvedBy = ${result.agentId === CHATGPT_WORLDCLASS_GENERATOR_ID ? "chatgpt_thumbtack_auto" : "claude_thumbtack_auto"}, approvedAt = NOW(3),
        capabilityResult = ${JSON.stringify({ phase: "submission_started", result, fromNumberId: claim.fromNumberId })}, updatedAt = NOW(3)
        WHERE id = ${claim.draftId} AND status = 'TOOLS_RUNNING' AND dismissedAt IS NULL AND dismissedBy IS NULL`);
      return header(updated).affectedRows === 1;
    }),
    accepted: (claim, result: ThumbtackInitialLeadResult, messageId, provider?: ThumbtackQuoSmsResult) => db.transaction(async tx => {
      const [draft] = rows(await tx.execute(sql`SELECT * FROM madison_sms_drafts WHERE id = ${claim.draftId} FOR UPDATE`));
      if (!draft) throw new Error("ACCEPTANCE_SAVE_FAILED");
      let state: any = {};
      try { state = json(draft.capabilityResult) ?? {}; } catch { /* Mutable metadata must not discard a provider receipt. */ }
      if (draft.outboundOpenPhoneId || state.messageId
        || (state.provider?.kind === "accepted" && state.provider.messageId)) return;
      const [session] = rows(await tx.execute(sql`SELECT messageHistory FROM conversation_sessions WHERE id = ${claim.sessionId} FOR UPDATE`));
      if (!session) throw new Error("ACCEPTANCE_SESSION_SAVE_FAILED");
      const history = json(session.messageHistory);
      const alreadyAppended = Array.isArray(history) && history.some(message => message?.opMsgId === messageId);
      // Atomic SQL append uses current history, never the generation-time snapshot.
      if (!alreadyAppended) {
        const appended = await tx.execute(sql`UPDATE conversation_sessions SET messageHistory = JSON_ARRAY_APPEND(messageHistory, '$', CAST(${JSON.stringify({ role: "assistant",
          content: result.replyText, ts: Date.now(), senderName: "Madison", opMsgId: messageId, fromNumberId: claim.fromNumberId,
          smsProvenance: (result.agentId === CHATGPT_WORLDCLASS_GENERATOR_ID ? automaticChatGptSmsProvenance : automaticClaudeSmsProvenance)(claim.draftId, messageId) })} AS JSON)),
          lastMessageText = ${result.replyText.slice(0, 255)}, lastMessageTs = ${Date.now()}, lastMessageRole = 'assistant',
          messageCount = messageCount + 1 WHERE id = ${claim.sessionId}`);
        if (header(appended).affectedRows !== 1) throw new Error("ACCEPTANCE_SESSION_SAVE_FAILED");
      }
      const receipt = provider ? providerReceipt(provider) : undefined;
      const failureCode = receipt?.providerStatus === "failed" ? "QUO_MESSAGE_FAILED"
        : receipt?.providerStatus === "undelivered" ? "QUO_MESSAGE_UNDELIVERED" : null;
      const errors = provider ? sql`errorStage = ${failureCode ? "SEND" : null}, errorCode = ${failureCode}` : sql`errorStage = NULL, errorCode = NULL`;
      const outcome = provider ? { ...state, phase: "accepted", messageId, result, fromNumberId: claim.fromNumberId, provider: receipt }
        : { phase: "accepted", messageId, result, fromNumberId: claim.fromNumberId };
      const saved = await tx.execute(sql`UPDATE madison_sms_drafts SET status = CASE WHEN status = 'DISMISSED' THEN 'DISMISSED' ELSE 'SENT' END,
        outboundOpenPhoneId = ${messageId}, sentAt = NOW(3), capabilityResult = ${JSON.stringify(outcome)},
        ${errors}, updatedAt = NOW(3) WHERE id = ${claim.draftId}`);
      if (header(saved).affectedRows !== 1) throw new Error("ACCEPTANCE_SAVE_FAILED");
    }),
    async blocked(claim, code, uncertain, provider?: ThumbtackQuoSmsResult) {
      if (provider) {
        if (provider.kind === "accepted" && code !== "ACCEPTANCE_SAVE_FAILED") return;
        await db.transaction(async tx => {
          const [draft] = rows(await tx.execute(sql`SELECT * FROM madison_sms_drafts WHERE id = ${claim.draftId} FOR UPDATE`));
          if (!draft) return;
          let state: any = {};
          try { state = json(draft.capabilityResult) ?? {}; } catch { /* Mutable metadata must not discard a provider receipt. */ }
          if (draft.outboundOpenPhoneId || state.messageId
            || (state.provider?.kind === "accepted" && state.provider.messageId)) return;
          const phase = provider.kind === "rejected" ? "submission_rejected"
            : provider.kind === "accepted" ? "provider_accepted_recording_failed" : "submission_started";
          const status = provider.kind === "rejected" ? "DISMISSED" : "SENDING";
          const receipt = providerReceipt(provider);
          const outcome = { ...state, phase, provider: receipt, ...(provider.kind === "accepted" ? { messageId: provider.messageId } : {}) };
          const knownId = provider.kind === "accepted" ? sql`, outboundOpenPhoneId = ${provider.messageId}` : sql``;
          await tx.execute(sql`UPDATE madison_sms_drafts SET status = ${status}, capabilityResult = ${JSON.stringify(outcome)},
            errorStage = 'SEND', errorCode = ${code} ${knownId}, updatedAt = NOW(3)
            WHERE id = ${claim.draftId}`);
        });
        return;
      }
      await db.execute(sql`UPDATE madison_sms_drafts SET status = CASE WHEN status = 'TOOLS_RUNNING' THEN 'DISMISSED' ELSE status END,
        errorStage = ${uncertain ? "SEND" : "GATE"}, errorCode = ${code}, updatedAt = NOW(3)
        WHERE id = ${claim.draftId} AND inboundOpenPhoneId = ${claim.lead.key} AND status IN ('TOOLS_RUNNING', 'SENDING', 'DISMISSED')`);
    },
  };
}
function buildOriginalMessage(lead: EligibleLead): string {
  return [lead.facts.description, ...lead.facts.nativeDetails.map(detail => [detail.question, detail.answer].filter(Boolean).join(": "))].filter(Boolean).join("\n");
}

/** Both this guard and native beginSend serialize on the same draft row lock. */
export async function guardClaudeThumbtackManualSendInStore(db: Db, input: { sessionId?: number; phone?: string }): Promise<void> {
  await db.transaction(async tx => {
    const [exactSession] = input.sessionId
      ? rows(await tx.execute(sql`SELECT leadPhone FROM conversation_sessions WHERE id = ${input.sessionId}`)) : [];
    const phone = normalizePhone(input.phone ?? exactSession?.leadPhone);
    if (!input.sessionId && !phone) return;
    const filter = input.sessionId && phone ? sql`(sessionId = ${input.sessionId} OR fromPhone = ${phone})`
      : input.sessionId ? sql`sessionId = ${input.sessionId}` : sql`fromPhone = ${phone}`;
    const pending = rows(await tx.execute(sql`SELECT * FROM madison_sms_drafts WHERE capability = ${capability}
      AND inboundOpenPhoneId LIKE 'tt-first:v1:%' AND ${filter} ORDER BY id ASC FOR UPDATE`));
    for (const draft of pending) {
      const state = json(draft.capabilityResult);
      if (draft.status === "SENDING" || (state?.phase === "submission_started" && !draft.outboundOpenPhoneId)) {
        throw new Error(draft.errorCode ? "AUTO_FIRST_RESPONSE_REVIEW_REQUIRED" : "AUTO_FIRST_RESPONSE_IN_FLIGHT");
      }
      if (draft.status !== "TOOLS_RUNNING") continue;
      const changed = await tx.execute(sql`UPDATE madison_sms_drafts SET status = 'DISMISSED', errorStage = 'GATE',
        errorCode = 'MANUAL_FIRST_RESPONSE', updatedAt = NOW(3) WHERE id = ${draft.id} AND status = 'TOOLS_RUNNING'`);
      if (header(changed).affectedRows !== 1) {
        const [current] = rows(await tx.execute(sql`SELECT status, errorCode FROM madison_sms_drafts WHERE id = ${draft.id} FOR UPDATE`));
        if (current?.status === 'SENDING') throw new Error(current.errorCode ? "AUTO_FIRST_RESPONSE_REVIEW_REQUIRED" : "AUTO_FIRST_RESPONSE_IN_FLIGHT");
        if (current?.status === 'TOOLS_RUNNING') throw new Error("THUMBTACK_MANUAL_CAS_LOST");
      }
    }
  });
}

export async function guardClaudeThumbtackLegacyDraftActionInStore(db: Db, draftId: number): Promise<void> {
  const [draft] = rows(await db.execute(sql`SELECT inboundOpenPhoneId FROM madison_sms_drafts WHERE id = ${draftId}`));
  if (typeof draft?.inboundOpenPhoneId === "string" && draft.inboundOpenPhoneId.startsWith("tt-first:v1:")) {
    throw new Error("AUTO_FIRST_RESPONSE_PROTECTED");
  }
}
