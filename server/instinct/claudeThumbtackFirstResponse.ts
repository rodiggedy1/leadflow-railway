import { createHash, randomUUID } from "node:crypto";
import { buildThumbtackLeadDraftContext, THUMBTACK_FIRST_RESPONSE_PROMPT, claudeInitialLeadFactsSchema,
  claudeInitialLeadResultSchema, type ClaudeInitialLeadFacts, type ClaudeInitialLeadInput, type ClaudeInitialLeadResult } from "../../shared/claudeInitialLead";
import { projectThumbtackNativeLead, type ThumbtackNativeLeadPayload, type ThumbtackNativeLead } from "../../shared/thumbtackNativeLead";
import { normalizePhone } from "../utils/phone";

export const THUMBTACK_FIRST_RESPONSE_CAPABILITY = "claude_thumbtack_first_response_v1";
export const THUMBTACK_ACCOUNT = "default"; // Existing single-merchant application namespace; not a payload guess.
export type FirstResponseConfig = { startAt: number; fromNumberId: string };
function fixedInstant(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const calendarDate = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendarDate) || new Date(calendarDate).toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
export function thumbtackFirstResponseConfig(env: NodeJS.ProcessEnv = process.env): FirstResponseConfig | null {
  const startAt = fixedInstant(env.THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT);
  const fromNumberId = env.OPENPHONE_PHONE_NUMBER_ID?.trim();
  return env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED === "true" && startAt !== null && fromNumberId
    ? { startAt, fromNumberId } : null;
}
export const thumbtackFirstResponseKey = (negotiationId: string) => "tt-first:v1:" + createHash("sha256")
  .update(JSON.stringify(["thumbtack", THUMBTACK_ACCOUNT, negotiationId])).digest("hex");
export type CapturedLead = { id: number; source: string; eventType: string; receivedAt: Date; rawPayload: string; earliestId: number; earliestReceivedAt: Date };
export type EligibleLead = { capture: CapturedLead; native: ThumbtackNativeLead; payload: ThumbtackNativeLeadPayload;
  facts: ClaudeInitialLeadFacts; key: string; phone: string | null; createdAt: number; sendEligible: boolean };
/** Intake is first capture only; native timestamps never suppress its introduction. */
export function capturedThumbtackLead(capture: CapturedLead, config: FirstResponseConfig): EligibleLead | null {
  if (!Number.isFinite(capture.receivedAt.getTime()) || !Number.isFinite(capture.earliestReceivedAt.getTime())
    || capture.source !== "thumbtack" || capture.eventType !== "NegotiationCreatedV4" || capture.id !== capture.earliestId
    || capture.receivedAt.getTime() < config.startAt || capture.earliestReceivedAt.getTime() < config.startAt) return null;
  try {
    const payload = JSON.parse(capture.rawPayload) as ThumbtackNativeLeadPayload;
    if (payload.event?.eventType !== "NegotiationCreatedV4") return null;
    const native = projectThumbtackNativeLead(payload);
    if (!native) return null;
    // Native-only UI projection leaves rooms/propertyType/summary absent. Do not substitute email/extraction defaults.
    const facts = claudeInitialLeadFactsSchema.parse({ name: native.name, serviceType: native.serviceType, category: native.category,
      address: native.address, location: native.location, requestedDates: native.requestedDates, bedrooms: native.bedrooms,
      bathrooms: native.bathrooms, homeSize: native.homeSize, rooms: null, propertyType: null, frequency: native.frequency,
      extras: native.extras, pets: native.pets, description: native.description, summary: null, travelPreferences: native.travelPreferences,
      proposedTimes: native.proposedTimes, nativeDetails: native.nativeDetails });
    return { capture, native, payload, facts, key: thumbtackFirstResponseKey(native.negotiationId), phone: normalizePhone(native.phone),
      createdAt: capture.receivedAt.getTime(), sendEligible: true };
  } catch { return null; }
}
export function eligibleThumbtackLead(capture: CapturedLead, config: FirstResponseConfig): EligibleLead | null {
  const lead = capturedThumbtackLead(capture, config);
  return lead?.sendEligible ? lead : null;
}
export type FirstResponseClaim = { draftId: number; sessionId: number; cardId: number; lead: EligibleLead; fromNumberId: string };
export interface FirstResponseStore {
  loadCapture(id: number): Promise<CapturedLead | null>;
  claim(lead: EligibleLead, config: FirstResponseConfig): Promise<FirstResponseClaim | null>;
  fresh(claim: FirstResponseClaim): Promise<boolean>;
  beginSend(claim: FirstResponseClaim, result: ClaudeInitialLeadResult): Promise<boolean>;
  accepted(claim: FirstResponseClaim, result: ClaudeInitialLeadResult, messageId: string): Promise<void>;
  blocked(claim: FirstResponseClaim, code: string, uncertain: boolean): Promise<void>;
}
export function createClaudeThumbtackFirstResponseService(deps: {
  config: () => FirstResponseConfig | null; store: FirstResponseStore;
  generate: (input: ClaudeInitialLeadInput) => Promise<ClaudeInitialLeadResult>;
  send: (input: { to: string; content: string; fromNumberId: string }) => Promise<{ success: boolean; messageId?: string }>;
}) {
  return async (captureId: number): Promise<void> => {
    const config = deps.config();
    if (!config) return;
    const capture = await deps.store.loadCapture(captureId);
    const lead = capture && capturedThumbtackLead(capture, config);
    if (!lead) return;
    const claim = await deps.store.claim(lead, config);
    if (!claim) return;
    let dispatchStarted = false;
    try {
      if (!lead.phone || !await deps.store.fresh(claim)) return await deps.store.blocked(claim, "SUPPRESSED_BEFORE_MODEL", false);
      const context = buildThumbtackLeadDraftContext(lead.facts), requestId = randomUUID();
      const result = claudeInitialLeadResultSchema.parse(await deps.generate({ sessionId: claim.sessionId, customerPhone: lead.phone,
        requestId, leadDetails: lead.facts, originalConversation: [], draftRequest: { conversationContext: "", customerName: lead.facts.name,
          jobContext: context, scenario: `${THUMBTACK_FIRST_RESPONSE_PROMPT}\n\nThumbtack lead:\n${context}` } }));
      if (result.sessionId !== claim.sessionId || result.customerPhone !== lead.phone || result.requestId !== requestId) throw new Error("GENERATION_BINDING_CHANGED");
      const current = deps.config();
      if (!current || current.startAt !== config.startAt || current.fromNumberId !== config.fromNumberId
        || !await deps.store.beginSend(claim, result)) return await deps.store.blocked(claim, "SUPPRESSED_BEFORE_SEND", false);
      dispatchStarted = true; // durable SENDING + exact text precede the only provider submission
      const sent = await deps.send({ to: lead.phone, content: result.replyText, fromNumberId: claim.fromNumberId });
      if (!sent.success || !sent.messageId?.trim()) return await deps.store.blocked(claim, "SUBMISSION_UNCERTAIN", true);
      await deps.store.accepted(claim, result, sent.messageId);
    } catch (error) {
      await deps.store.blocked(claim, dispatchStarted ? "SUBMISSION_UNCERTAIN" : "GENERATION_OR_SAVE_FAILED", dispatchStarted)
        .catch(saveError => console.error("[ThumbtackClaude] durable outcome uncertain; claim remains blocked", saveError));
      console.error("[ThumbtackClaude] first response stopped", error);
    }
  };
}

// Passive lazy boundaries for the parent's narrow existing-route middleware.
export async function guardClaudeThumbtackManualSend(input: { sessionId?: number; phone?: string }): Promise<void> {
  if (!thumbtackFirstResponseConfig()) return;
  const application = await import("./claudeThumbtackFirstResponseApplication");
  await application.guardClaudeThumbtackManualSend(input);
}
export async function guardClaudeThumbtackLegacyDraftAction(draftId: number): Promise<void> {
  const application = await import("./claudeThumbtackFirstResponseApplication");
  await application.guardClaudeThumbtackLegacyDraftAction(draftId);
}
