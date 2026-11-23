import { createHash, randomUUID } from "node:crypto";
import { buildThumbtackLeadDraftContext, THUMBTACK_FIRST_RESPONSE_PROMPT, claudeInitialLeadFactsSchema,
  thumbtackInitialLeadResultSchema, type ClaudeInitialLeadFacts, type ClaudeInitialLeadInput, type ThumbtackInitialLeadResult } from "../../shared/claudeInitialLead";
import { projectThumbtackNativeLead, type ThumbtackNativeLeadPayload, type ThumbtackNativeLead } from "../../shared/thumbtackNativeLead";
import { normalizeThumbtackSmsPhone } from "../../shared/thumbtackSmsPhone";
import type { ThumbtackQuoSmsResult } from "./thumbtackDirectQuoSms";

export const THUMBTACK_FIRST_RESPONSE_CAPABILITY = "claude_thumbtack_first_response_v1";
export const THUMBTACK_ACCOUNT = "default";
export const THUMBTACK_INTRODUCTION_SEND_TIMEOUT_MS = 30_000;
export type FirstResponseConfig = { startAt: number; fromNumberId: string };
function fixedInstant(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const calendarDate = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendarDate) || new Date(calendarDate).toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
export function thumbtackFirstResponseConfig(env: NodeJS.ProcessEnv = process.env): FirstResponseConfig | null {
  // Receipt context only. A rollout timestamp is not new-card eligibility.
  const startAt = fixedInstant(env.THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT) ?? 0;
  const fromNumberId = env.OPENPHONE_PHONE_NUMBER_ID?.trim();
  return env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED === "true" && fromNumberId ? { startAt, fromNumberId } : null;
}
/** Legacy phone-only identity retained for existing receipt compatibility. */
export function thumbtackFirstResponseKey(phone: string): string {
  const normalized = normalizeThumbtackSmsPhone(phone);
  if (!normalized) throw new Error("THUMBTACK_FIRST_RESPONSE_PHONE_INVALID");
  return "tt-first:v1:" + createHash("sha256").update(JSON.stringify(["thumbtack", THUMBTACK_ACCOUNT, normalized])).digest("hex");
}
export type CapturedLead = { id: number; source: string; eventType: string; receivedAt: Date; rawPayload: string };
export type EligibleLead = { capture: CapturedLead; native: ThumbtackNativeLead; payload: ThumbtackNativeLeadPayload;
  facts: ClaudeInitialLeadFacts; key: string; phone: string | null; createdAt: number; sendEligible: boolean };
/** New lead card + valid phone triggers the existing introduction. Dates are context only. */
export function capturedThumbtackLead(capture: CapturedLead, _config: FirstResponseConfig): EligibleLead | null {
  if (capture.source !== "thumbtack" || capture.eventType !== "NegotiationCreatedV4") return null;
  try {
    const payload = JSON.parse(capture.rawPayload) as ThumbtackNativeLeadPayload;
    if (payload.event?.eventType !== "NegotiationCreatedV4") return null;
    const createdAt = fixedInstant(payload.data?.createdAt);
    const native = projectThumbtackNativeLead(payload);
    if (!native) return null;
    const facts = claudeInitialLeadFactsSchema.parse({ name: native.name, serviceType: native.serviceType, category: native.category,
      address: native.address, location: native.location, requestedDates: native.requestedDates, bedrooms: native.bedrooms,
      bathrooms: native.bathrooms, homeSize: native.homeSize, rooms: null, propertyType: null, frequency: native.frequency,
      extras: native.extras, pets: native.pets, description: native.description, summary: null, travelPreferences: native.travelPreferences,
      proposedTimes: native.proposedTimes, nativeDetails: native.nativeDetails });
    const phone = normalizeThumbtackSmsPhone(native.phone);
    const key = phone ? "tt-first:v1:" + createHash("sha256")
      .update(JSON.stringify(["thumbtack", THUMBTACK_ACCOUNT, native.negotiationId, phone])).digest("hex") : `tt-first:v1:no-phone:${capture.id}`;
    return { capture, native, payload, facts, key, phone, createdAt: createdAt ?? capture.receivedAt.getTime(), sendEligible: Boolean(phone) };
  } catch { return null; }
}
export function eligibleThumbtackLead(capture: CapturedLead, config: FirstResponseConfig): EligibleLead | null {
  const lead = capturedThumbtackLead(capture, config);
  return lead?.phone ? lead : null;
}
export type FirstResponseClaim = { draftId: number; sessionId: number; cardId: number; lead: EligibleLead; fromNumberId: string };
export type FirstResponseOutcome = { captureId: number; outcome: "disabled" | "duplicate" | "no_phone" | "suppressed" | "sent" | "failed" | "uncertain";
  code?: string; draftId?: number; messageId?: string; providerStatus?: string };
export type FirstResponseFailure = { captureId: number; lead: EligibleLead | null; claim: FirstResponseClaim | null;
  stage: "capture" | "claim" | "generation" | "pre_send" | "submission" | "acceptance"; code: string; uncertain: boolean;
  provider?: ThumbtackQuoSmsResult; messageId?: string };
export interface FirstResponseStore {
  loadCapture(id: number): Promise<CapturedLead | null>;
  claim(lead: EligibleLead, config: FirstResponseConfig): Promise<FirstResponseClaim | null>;
  fresh(claim: FirstResponseClaim): Promise<boolean>;
  beginSend(claim: FirstResponseClaim, result: ThumbtackInitialLeadResult): Promise<boolean>;
  accepted(claim: FirstResponseClaim, result: ThumbtackInitialLeadResult, messageId: string, provider?: ThumbtackQuoSmsResult): Promise<void>;
  blocked(claim: FirstResponseClaim, code: string, uncertain: boolean, provider?: ThumbtackQuoSmsResult): Promise<void>;
}
export function createClaudeThumbtackFirstResponseService(deps: {
  config: () => FirstResponseConfig | null; store: FirstResponseStore;
  generate: (input: ClaudeInitialLeadInput) => Promise<ThumbtackInitialLeadResult>;
  send: (input: { to: string; content: string; fromNumberId: string }, options?: { signal: AbortSignal; deadlineAt: number })
    => Promise<ThumbtackQuoSmsResult | { success: boolean; messageId?: string }>;
  onFailure?: (failure: FirstResponseFailure) => Promise<void>;
}) {
  return async (captureId: number): Promise<FirstResponseOutcome> => {
    const config = deps.config();
    if (!config) return { captureId, outcome: "disabled", code: "DISABLED_OR_SENDER_UNAVAILABLE" };
    let lead: EligibleLead | null = null, claim: FirstResponseClaim | null = null;
    let dispatchStarted = false;
    let provider: ThumbtackQuoSmsResult | undefined, knownMessageId: string | undefined;
    let stage: FirstResponseFailure["stage"] = "capture";
    const report = async (code: string, uncertain = false) => {
      const details = { ...(provider ? { provider } : {}), ...(knownMessageId ? { messageId: knownMessageId } : {}) };
      const failure = { captureId, lead, claim, stage, code, uncertain, ...details };
      console.error("[ThumbtackClaude] introduction requires staff review", { captureId, draftId: claim?.draftId, stage, code, uncertain, ...details });
      try { await deps.onFailure?.(failure); }
      catch { console.error("[ThumbtackClaude] failure escalation could not be saved", { captureId, draftId: claim?.draftId, stage, code }); }
    };
    try {
      const capture = await deps.store.loadCapture(captureId);
      lead = capture && capturedThumbtackLead(capture, config);
      if (!lead) { await report("INVALID_NATIVE_CAPTURE"); return { captureId, outcome: "failed", code: "INVALID_NATIVE_CAPTURE" }; }
      stage = "claim";
      claim = await deps.store.claim(lead, config);
      if (!claim) return { captureId, outcome: "duplicate" };
      if (!lead.phone) return { captureId, draftId: claim.draftId, outcome: "no_phone", code: "NO_VALID_PHONE" };
      if (!await deps.store.fresh(claim)) {
        await deps.store.blocked(claim, "SUPPRESSED_BEFORE_MODEL", false);
        return { captureId, draftId: claim.draftId, outcome: "suppressed", code: "CONSENT_OR_SEND_OWNERSHIP_CHANGED" };
      }
      stage = "generation";
      const context = buildThumbtackLeadDraftContext(lead.facts), requestId = randomUUID();
      const result = thumbtackInitialLeadResultSchema.parse(await deps.generate({ sessionId: claim.sessionId, customerPhone: lead.phone,
        requestId, leadDetails: lead.facts, originalConversation: [], draftRequest: { conversationContext: "", customerName: lead.facts.name,
          jobContext: context, scenario: `${THUMBTACK_FIRST_RESPONSE_PROMPT}\n\nThumbtack lead:\n${context}` } }));
      if (result.sessionId !== claim.sessionId || result.customerPhone !== lead.phone || result.requestId !== requestId) throw new Error("GENERATION_BINDING_CHANGED");
      stage = "pre_send";
      const current = deps.config();
      if (!current) {
        await deps.store.blocked(claim, "CONFIG_CHANGED", false);
        await report("CONFIG_CHANGED");
        return { captureId, draftId: claim.draftId, outcome: "failed", code: "CONFIG_CHANGED" };
      }
      if (!await deps.store.beginSend(claim, result)) {
        await deps.store.blocked(claim, "SUPPRESSED_BEFORE_SEND", false);
        return { captureId, draftId: claim.draftId, outcome: "suppressed", code: "CONSENT_OR_SEND_OWNERSHIP_CHANGED" };
      }
      dispatchStarted = true;
      stage = "submission";
      let timer: ReturnType<typeof setTimeout> | undefined;
      let sent: Awaited<ReturnType<typeof deps.send>>;
      const controller = new AbortController();
      const deadlineAt = Date.now() + THUMBTACK_INTRODUCTION_SEND_TIMEOUT_MS;
      try {
        sent = await Promise.race([
          deps.send({ to: lead.phone, content: result.replyText, fromNumberId: claim.fromNumberId }, { signal: controller.signal, deadlineAt }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => {
            controller.abort();
            reject(new Error("THUMBTACK_SMS_SUBMISSION_TIMEOUT"));
          }, Math.max(0, deadlineAt - Date.now())); }),
        ]);
      } finally { if (timer) clearTimeout(timer); controller.abort(); }
      provider = "kind" in sent ? sent : undefined;
      if (Date.now() >= deadlineAt && (!provider || provider.kind === "accepted")) {
        provider = undefined;
        throw new Error("THUMBTACK_SMS_SUBMISSION_TIMEOUT");
      }
      if (provider && provider.kind !== "accepted") {
        const uncertain = provider.kind === "uncertain";
        await deps.store.blocked(claim, provider.code, uncertain, provider);
        await report(provider.code, uncertain);
        return { captureId, draftId: claim.draftId, outcome: uncertain ? "uncertain" : "failed", code: provider.code };
      }
      if (!sent.success || !sent.messageId?.trim()) {
        await deps.store.blocked(claim, "SUBMISSION_UNCERTAIN", true);
        await report("SUBMISSION_UNCERTAIN", true);
        return { captureId, draftId: claim.draftId, outcome: "uncertain", code: "SUBMISSION_UNCERTAIN" };
      }
      knownMessageId = sent.messageId;
      stage = "acceptance";
      if (provider) await deps.store.accepted(claim, result, knownMessageId, provider);
      else await deps.store.accepted(claim, result, knownMessageId);
      if (provider?.providerStatus === "failed" || provider?.providerStatus === "undelivered") {
        const code = provider.providerStatus === "failed" ? "QUO_MESSAGE_FAILED" : "QUO_MESSAGE_UNDELIVERED";
        await report(code);
        return { captureId, draftId: claim.draftId, outcome: "failed", code, messageId: knownMessageId, providerStatus: provider.providerStatus };
      }
      return { captureId, draftId: claim.draftId, outcome: "sent", messageId: knownMessageId,
        ...(provider?.providerStatus ? { providerStatus: provider.providerStatus } : {}) };
    } catch {
      const uncertain = dispatchStarted && !knownMessageId && provider?.kind !== "rejected";
      const code = knownMessageId ? "ACCEPTANCE_SAVE_FAILED" : provider?.code ?? (dispatchStarted ? "SUBMISSION_UNCERTAIN"
        : stage === "claim" ? "CLAIM_FAILED" : stage === "capture" ? "CAPTURE_LOAD_FAILED" : "GENERATION_OR_SAVE_FAILED");
      if (knownMessageId && !provider) provider = { kind: "accepted", success: true, code: "PROVIDER_ACCEPTED", messageId: knownMessageId };
      if (claim) {
        const save = provider ? deps.store.blocked(claim, code, uncertain, provider) : deps.store.blocked(claim, code, uncertain);
        await save.catch(() => console.error("[ThumbtackClaude] durable outcome save failed", { captureId, draftId: claim?.draftId, stage, code,
          ...(knownMessageId ? { messageId: knownMessageId } : {}) }));
      }
      await report(code, uncertain);
      return { captureId, draftId: claim?.draftId, outcome: uncertain ? "uncertain" : "failed", code,
        ...(knownMessageId ? { messageId: knownMessageId } : {}) };
    }
  };
}

// Passive lazy boundaries for the parent's existing-route middleware.
export async function guardClaudeThumbtackManualSend(input: { sessionId?: number; phone?: string }): Promise<void> {
  if (!thumbtackFirstResponseConfig()) return;
  const application = await import("./claudeThumbtackFirstResponseApplication");
  await application.guardClaudeThumbtackManualSend(input);
}
export async function guardClaudeThumbtackLegacyDraftAction(draftId: number): Promise<void> {
  const application = await import("./claudeThumbtackFirstResponseApplication");
  await application.guardClaudeThumbtackLegacyDraftAction(draftId);
}
