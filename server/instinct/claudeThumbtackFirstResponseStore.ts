import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { conversationSessions, opsChatMessages, madisonSmsDrafts } from "../../drizzle/schema";
import type { getDb } from "../db";
import { normalizePhone } from "../utils/phone";
import { THUMBTACK_ACCOUNT, THUMBTACK_FIRST_RESPONSE_CAPABILITY as capability,
  type CapturedLead, type EligibleLead, type FirstResponseClaim, type FirstResponseConfig, type FirstResponseStore } from "./claudeThumbtackFirstResponse";
import type { ClaudeInitialLeadResult } from "../../shared/claudeInitialLead";
import { automaticClaudeSmsProvenance } from "../../shared/smsSenderProvenance";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const rows = (result: unknown): any[] => (result as any)[0];
const header = (result: unknown): { insertId: number; affectedRows: number } => (result as any)[0];
const json = (value: unknown): any => typeof value === "string" ? JSON.parse(value) : value;
const payloadHash = (lead: EligibleLead) => createHash("sha256").update(lead.capture.rawPayload).digest("hex");
const stop = (text: unknown) => typeof text === "string" && /^\s*(stop|unsubscribe|cancel|quit|end|remove me|opt.?out)\s*$/i.test(text);
function isPhoneReceiptDuplicate(error: unknown): boolean {
  // Drizzle wraps the MySQL insertion error in cause; only this receipt index is an expected race.
  for (let current: any = error, depth = 0; current && depth < 5; current = current.cause, depth++) {
    if (current.code === "ER_DUP_ENTRY" && /\buq_sms_draft_inbound\b/.test(`${current.sqlMessage ?? ""} ${current.message ?? ""}`)) return true;
  }
  return false;
}
const binding = (claim: FirstResponseClaim) => ({ source: "thumbtack", account: THUMBTACK_ACCOUNT, negotiationId: claim.lead.native.negotiationId,
  captureId: claim.lead.capture.id, payloadHash: payloadHash(claim.lead), sessionId: claim.sessionId, key: claim.lead.key,
  phone: claim.lead.phone, fromNumberId: claim.fromNumberId, originalConversation: [] });

export function createClaudeThumbtackFirstResponseStore(db: Db, quote: (lead: EligibleLead) => string | null): FirstResponseStore {
  async function fresh(tx: Tx, claim: FirstResponseClaim): Promise<boolean> {
    const [draft] = rows(await tx.execute(sql`SELECT * FROM madison_sms_drafts WHERE id = ${claim.draftId} FOR UPDATE`));
    const [session] = rows(await tx.execute(sql`SELECT * FROM conversation_sessions WHERE id = ${claim.sessionId} FOR UPDATE`));
    const [card] = rows(await tx.execute(sql`SELECT * FROM ops_chat_messages WHERE id = ${claim.cardId} FOR UPDATE`));
    if (!draft || !session || !card || !claim.lead.sendEligible || !claim.lead.phone || draft.status !== "TOOLS_RUNNING" || draft.dismissedAt || draft.dismissedBy
      || draft.capability !== capability || draft.inboundOpenPhoneId !== claim.lead.key || Number(draft.sessionId) !== claim.sessionId
      || draft.fromPhone !== claim.lead.phone || session.leadPhone !== claim.lead.phone || session.leadSource !== "thumbtack"
      || session.stage !== "AVAILABILITY" || Number(session.aiMode) !== 0 || Number(session.smsOptOut) !== 0 || Number(session.isBooked) !== 0
      || session.assignedAgentId || session.assignedAgentName || session.lastCalledAt || session.respondedAt || session.csResolvedAt
      || session.madisonDeferredUntil || session.lastProcessedMessageId || session.lastCustomerReplyAt || session.lastCustomerMessageTs
      || session.lastAiMessageAt || session.internalNotes || Number(session.messageCount) !== 0) return false;
    const savedBinding = json(draft.resolvedContext), expected = binding(claim), metadata = json(card.metadata ?? "{}");
    if (Object.keys(expected).some(key => JSON.stringify(savedBinding?.[key]) !== JSON.stringify((expected as any)[key]))
      || Number(card.sessionId) !== claim.sessionId || Number(metadata.sessionId) !== claim.sessionId || metadata.nativeFirstResponseKey !== claim.lead.key
      || metadata.claimedBy || card.cardStatus === "dismissed" || !Array.isArray(json(session.messageHistory)) || json(session.messageHistory).length !== 0) return false;
    const [capture] = rows(await tx.execute(sql`SELECT source, event_type, raw_payload FROM webhook_events WHERE id = ${claim.lead.capture.id}`));
    if (!capture || capture.source !== "thumbtack" || capture.event_type !== "NegotiationCreatedV4" || capture.raw_payload !== claim.lead.capture.rawPayload) return false;
    if (rows(await tx.execute(sql`SELECT id FROM sms_opt_outs WHERE phone = ${claim.lead.phone}`)).length) return false;
    // Preserve global consent checks without using previous conversations/messages to reject a lead.
    const phone10 = claim.lead.phone.slice(-10);
    const otherSessions = rows(await tx.execute(sql`SELECT leadPhone, smsOptOut FROM conversation_sessions
      WHERE RIGHT(REGEXP_REPLACE(leadPhone, '[^0-9]', ''), 10) = ${phone10} AND id <> ${claim.sessionId}`));
    if (otherSessions.some(other => normalizePhone(other.leadPhone) === claim.lead.phone && Number(other.smsOptOut))) return false;
    if (rows(await tx.execute(sql`SELECT id FROM ops_chat_messages WHERE
      (sessionId = ${claim.sessionId} OR (JSON_VALID(metadata) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sessionId')) = ${String(claim.sessionId)}))
      AND id <> ${claim.cardId} AND (authorRole <> 'system' OR quickAction = 'madison_sms_dismissed')`)).length) return false;
    return !stop(claim.lead.facts.description) && !claim.lead.facts.nativeDetails.some(detail => stop(detail.answer));
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
      try {
        return await db.transaction(async tx => {
          if (rows(await tx.execute(sql`SELECT id FROM madison_sms_drafts WHERE inboundOpenPhoneId = ${lead.key} AND capability = ${capability} LIMIT 1`)).length) return null;
          // Older native receipts used negotiation/attempt hashes but persisted the same canonical phone.
          if (lead.phone && rows(await tx.execute(sql`SELECT id FROM madison_sms_drafts WHERE fromPhone = ${lead.phone}
            AND capability = ${capability} AND inboundOpenPhoneId LIKE 'tt-first:v1:%' LIMIT 1`)).length) return null;
          const price = quote(lead), now = new Date();
          const phone = lead.phone ?? `no-phone-tt-${lead.capture.id}`;
          const sessionId = Number(header(await tx.insert(conversationSessions).values({ leadPhone: phone, leadName: lead.facts.name,
            stage: "AVAILABILITY", quotedPrice: price, serviceType: lead.facts.serviceType, bedrooms: lead.facts.bedrooms,
            bathrooms: lead.facts.bathrooms, extras: JSON.stringify(lead.facts.extras), address: lead.facts.address, messageHistory: "[]",
            leadSource: "thumbtack", barkQA: [lead.facts.description, lead.facts.frequency ? `Frequency: ${lead.facts.frequency}` : null,
              `Thumbtack ID: ${lead.native.negotiationId}`].filter(Boolean).join(" | ") })).insertId);
          if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw new Error("SESSION_INSERT_ID_MISSING");
          const claim: FirstResponseClaim = { draftId: 0, sessionId, cardId: 0, lead, fromNumberId: config.fromNumberId };
          claim.draftId = Number(header(await tx.insert(madisonSmsDrafts).values({ inboundOpenPhoneId: lead.key, sessionId, fromPhone: phone,
            senderName: lead.facts.name, senderType: "customer", status: lead.sendEligible ? "TOOLS_RUNNING" : "DISMISSED", capability, capabilityVersion: 1,
            resolvedContext: binding(claim), capabilityResult: { phase: lead.sendEligible ? "claimed" : "suppressed_native_dates", startAt: config.startAt },
            errorStage: lead.sendEligible ? null : "GATE", errorCode: lead.sendEligible ? null : "SUPPRESSED_NATIVE_DATES",
            originalMessage: buildOriginalMessage(lead), observations: [], suggestedActions: [], followUps: [],
            sendPolicyMode: "automatic", sendPolicyEnabled: 1, sendPolicyEvaluatedAt: now, createdAt: now, updatedAt: now })).insertId);
          const size = [lead.facts.bedrooms, lead.facts.bathrooms].filter(Boolean).join(" / ");
          claim.cardId = Number(header(await tx.insert(opsChatMessages).values({ channel: "command", authorName: "🎯 New Lead", authorRole: "system",
            quickAction: "new_lead", sessionId, body: `📌 **Thumbtack Lead** · ${lead.facts.name} · ${phone}\n🏠 **${lead.facts.serviceType ?? "Not provided"}**${size ? ` · ${size}` : ""}${price ? ` · **$${price}**` : ""}`,
            metadata: JSON.stringify({ leadName: lead.facts.name, leadPhone: lead.phone, serviceType: lead.facts.serviceType,
              location: lead.facts.location, requestedDates: lead.facts.requestedDates, propertyType: null, extras: lead.facts.extras,
              bedrooms: lead.facts.bedrooms, bathrooms: lead.facts.bathrooms, frequency: lead.facts.frequency, summary: lead.facts.description,
              size, price, utmSource: "thumbtack", sessionId, arrivedAt: now.getTime(), negotiationId: lead.native.negotiationId,
              nativeFirstResponseKey: lead.key }) })).insertId);
          if (![claim.draftId, claim.cardId].every(id => Number.isSafeInteger(id) && id > 0)) throw new Error("CLAIM_OR_CARD_INSERT_ID_MISSING");
          return claim;
        });
      } catch (error) {
        // The existing unique receipt index arbitrates simultaneous first arrivals for the same phone.
        if (isPhoneReceiptDuplicate(error) && rows(await db.execute(sql`SELECT id FROM madison_sms_drafts
          WHERE inboundOpenPhoneId = ${lead.key} AND capability = ${capability} LIMIT 1`)).length) return null;
        throw error;
      }
    },
    fresh: claim => db.transaction(tx => fresh(tx, claim)),
    beginSend: (claim, result) => db.transaction(async tx => {
      if (!await fresh(tx, claim)) return false;
      const updated = await tx.execute(sql`UPDATE madison_sms_drafts SET status = 'SENDING', generatedDraft = ${result.replyText},
        approvedText = ${result.replyText}, approvedBy = 'claude_thumbtack_auto', approvedAt = NOW(3),
        capabilityResult = ${JSON.stringify({ phase: "submission_started", result, fromNumberId: claim.fromNumberId })}, updatedAt = NOW(3)
        WHERE id = ${claim.draftId} AND status = 'TOOLS_RUNNING' AND dismissedAt IS NULL AND dismissedBy IS NULL`);
      return header(updated).affectedRows === 1;
    }),
    accepted: (claim, result, messageId) => db.transaction(async tx => {
      const [draft] = rows(await tx.execute(sql`SELECT * FROM madison_sms_drafts WHERE id = ${claim.draftId} FOR UPDATE`));
      if (!draft || draft.inboundOpenPhoneId !== claim.lead.key || Number(draft.sessionId) !== claim.sessionId
        || draft.generatedDraft !== result.replyText || json(draft.capabilityResult)?.phase !== "submission_started") throw new Error("ACCEPTANCE_BINDING_CHANGED");
      // Atomic SQL append uses current history, never the generation-time snapshot.
      const appended = await tx.execute(sql`UPDATE conversation_sessions SET messageHistory = JSON_ARRAY_APPEND(messageHistory, '$', CAST(${JSON.stringify({ role: "assistant",
        content: result.replyText, ts: Date.now(), senderName: "Madison", opMsgId: messageId, fromNumberId: claim.fromNumberId,
        smsProvenance: automaticClaudeSmsProvenance(claim.draftId, messageId) })} AS JSON)),
        lastMessageText = ${result.replyText.slice(0, 255)}, lastMessageTs = ${Date.now()}, lastMessageRole = 'assistant',
        messageCount = messageCount + 1 WHERE id = ${claim.sessionId} AND leadPhone = ${claim.lead.phone} AND leadSource = 'thumbtack'`);
      if (header(appended).affectedRows !== 1) throw new Error("ACCEPTANCE_SESSION_SAVE_FAILED");
      const saved = await tx.execute(sql`UPDATE madison_sms_drafts SET status = CASE WHEN status = 'DISMISSED' THEN 'DISMISSED' ELSE 'SENT' END,
        outboundOpenPhoneId = ${messageId}, sentAt = NOW(3), capabilityResult = ${JSON.stringify({ phase: "accepted", messageId, result, fromNumberId: claim.fromNumberId })},
        errorStage = NULL, errorCode = NULL, updatedAt = NOW(3) WHERE id = ${claim.draftId}`);
      if (header(saved).affectedRows !== 1) throw new Error("ACCEPTANCE_SAVE_FAILED");
    }),
    async blocked(claim, code, uncertain) {
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
