import { createHash } from "node:crypto";
import type { CustomerReplyPlan } from "../../shared/claudeCustomerTasks";
import { normalizePhone } from "../utils/phone";
import type { AlternativeSessionRow } from "./claudeSmsAlternativeSessionRead";
import type { CustomerSmsBinding, CustomerSmsClaim } from "./claudeCustomerTasksStore";

export interface CustomerSmsInput {
  sessionId: number; providerMessageId: string; fromPhone: string; receivingPhoneNumberId: string;
  inboundText: string; createdAt: unknown; receivedAt: number; isCleaner: boolean; direction?: string;
}
export interface CustomerSmsConfig { startAt: number; allowedPhone: string; testCustomerOverride: boolean }
export function customerSmsInstant(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = Date.parse(value);
  const calendar = Date.parse(value.slice(0, 10) + "T00:00:00Z");
  return Number.isFinite(date) && Number.isFinite(calendar) && new Date(calendar).toISOString().slice(0, 10) === value.slice(0, 10) ? date : null;
}
export function claudeCustomerSmsConfig(env: NodeJS.ProcessEnv = process.env): CustomerSmsConfig | null {
  if (env.CLAUDE_CUSTOMER_SMS_ENABLED !== "true") return null;
  const startAt = customerSmsInstant(env.CLAUDE_CUSTOMER_SMS_START_AT);
  const allowedPhone = env.CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE;
  if (startAt === null || typeof allowedPhone !== "string" || !/^\+[1-9]\d{1,14}$/.test(allowedPhone)
    || normalizePhone(allowedPhone) !== allowedPhone) return null;
  return { startAt, allowedPhone, testCustomerOverride: env.CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE === "true" };
}
export function isClaudeCustomerSmsPilotPhone(phone: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const config = claudeCustomerSmsConfig(env);
  return config !== null && typeof phone === "string" && /^\+?[\d().\s-]+$/.test(phone)
    && normalizePhone(phone) === config.allowedPhone;
}
export function isClaudeCustomerSmsPilotCustomerOverride(phone: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE === "true" && isClaudeCustomerSmsPilotPhone(phone, env);
}
export const customerHistoryHash = (history: unknown): string => createHash("sha256").update(typeof history === "string" ? history : JSON.stringify(history)).digest("hex");
export interface CustomerSmsSession extends AlternativeSessionRow { leadSource?: unknown; smsOptOut?: unknown; csQueue?: unknown }
export interface CustomerSmsStore {
  claim(binding: CustomerSmsBinding): Promise<CustomerSmsClaim | null>;
  prepare(claim: CustomerSmsClaim, plan: CustomerReplyPlan): Promise<boolean>;
  recordAcceptance(claim: CustomerSmsClaim, providerMessageId: string): Promise<boolean>;
  markUncertain(claim: CustomerSmsClaim): Promise<void>;
  suppress(claim: CustomerSmsClaim, code: string): Promise<void>;
  suppressBeforeSubmission(claim: CustomerSmsClaim, code: string): Promise<void>;
}
export interface CustomerSmsOptions {
  config: () => CustomerSmsConfig | null;
  readSession(id: number): Promise<CustomerSmsSession | null>;
  readReceivingLine(id: string): Promise<string>;
  generate(binding: CustomerSmsBinding, session: CustomerSmsSession): Promise<CustomerReplyPlan>;
  store: CustomerSmsStore;
  send(input: { to: string; content: string; fromNumberId: string }): Promise<{ success: boolean; messageId?: string; error?: string }>;
  onTaskChange?: () => void | Promise<void>;
}
const excludedSenders = new Set(["+16505164957", "+16506469270", "+17259009272"]);
const stopped = (text: string) => /^\s*(stop|unsubscribe|quit|end|remove me|opt.?out)\s*$/i.test(text);
function currentTurn(row: CustomerSmsSession, input: CustomerSmsInput): boolean {
  let history: unknown;
  try { history = typeof row.messageHistory === "string" ? JSON.parse(row.messageHistory) : row.messageHistory; } catch { return false; }
  if (!Array.isArray(history)) return false;
  if (history.some(turn => !turn || typeof turn !== "object" || typeof turn.role !== "string" || typeof turn.content !== "string")) return false;
  const envelopes = (turn: any): any[] => {
    let meta = turn.metadata;
    if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch { return []; } }
    if (meta != null && (typeof meta !== "object" || Array.isArray(meta))) return [];
    return meta ? [turn, meta] : [turn];
  };
  const ids = (turn: any): string[] => Array.from(new Set(envelopes(turn).flatMap(value =>
    [value.opMsgId, value.openPhoneId, value.openPhoneMessageId, value.providerMessageId].filter(id => typeof id === "string" && id))));
  const inbound = history.filter(turn => turn && ["user", "customer"].includes(turn.role));
  const matching = inbound.filter(turn => ids(turn).includes(input.providerMessageId));
  if (matching.length !== 1 || matching[0] !== inbound.at(-1) || matching[0].content !== input.inboundText
    || ids(matching[0]).length !== 1) return false;
  if (history.slice(history.indexOf(matching[0]) + 1).some(turn => ["assistant", "agent", "office"].includes(turn.role))) return false;
  return envelopes(matching[0]).every(value => {
    if (value.sessionId != null && String(value.sessionId) !== String(input.sessionId)) return false;
    for (const key of ["phoneNumberId", "receivingPhoneNumberId"]) if (value[key] != null && value[key] !== input.receivingPhoneNumberId) return false;
    for (const key of ["from", "fromPhone", "customerPhone"]) if (value[key] != null && normalizePhone(typeof value[key] === "string" ? value[key] : null) !== input.fromPhone) return false;
    return true;
  });
}
/** No import-time work, queues, schedulers or retry authority. One actual saved
 * inbound event can claim one existing-table receipt. An uncertain send stays
 * blocked; human task completion is a separate service and never reaches send. */
export function createClaudeCustomerSmsService(options: CustomerSmsOptions) {
  return async (input: CustomerSmsInput): Promise<{ outcome: "disabled" | "excluded" | "duplicate" | "suppressed" | "accepted" | "uncertain" | "failed" }> => {
    const initialConfig = options.config();
    if (!initialConfig) return { outcome: "disabled" };
    const config = { ...initialConfig };
    const createdAt = customerSmsInstant(input.createdAt), phone = normalizePhone(input.fromPhone);
    const testCustomerOverride = config.testCustomerOverride === true && phone === config.allowedPhone;
    if (input.direction !== "incoming" || (input.isCleaner && !testCustomerOverride) || !Number.isSafeInteger(input.sessionId) || input.sessionId <= 0
      || typeof input.providerMessageId !== "string" || !input.providerMessageId.trim() || input.providerMessageId.startsWith("cs-fallback-")
      || typeof input.receivingPhoneNumberId !== "string" || !input.receivingPhoneNumberId.trim()
      || typeof input.inboundText !== "string" || !input.inboundText.trim() || !phone || phone !== input.fromPhone
      || phone !== config.allowedPhone
      || excludedSenders.has(phone) || stopped(input.inboundText) || createdAt === null || !Number.isFinite(input.receivedAt)
      || createdAt < config.startAt || input.receivedAt < config.startAt || createdAt > input.receivedAt) return { outcome: "excluded" };
    let claim: CustomerSmsClaim | null = null;
    let submissionStarted = false;
    let hasTask = false;
    const refreshTask = async () => {
      if (!hasTask) return;
      try { await options.onTaskChange?.(); } catch { /* A refresh is not the committed task/send outcome. */ }
    };
    try {
      const session = await options.readSession(input.sessionId);
      if (!session || session.contact.sessionId !== String(input.sessionId) || session.contact.phone !== phone
        || normalizePhone(session.contact.rawPhone) !== phone || session.lastInboundPhoneNumberId !== input.receivingPhoneNumberId
        || Number(session.smsOptOut) === 1 || (!testCustomerOverride && (session.csQueue === "Teams"
        || typeof session.leadSource !== "string" || /cleaner|hiring|interview|internal|staff/i.test(session.leadSource)))
        || !currentTurn(session, input)) return { outcome: "excluded" };
      const receivingPhoneNumber = await options.readReceivingLine(input.receivingPhoneNumberId);
      if (normalizePhone(receivingPhoneNumber) !== receivingPhoneNumber || !receivingPhoneNumber || receivingPhoneNumber === phone) return { outcome: "excluded" };
      const binding: CustomerSmsBinding = { sessionId: input.sessionId, providerMessageId: input.providerMessageId, fromPhone: phone,
        receivingPhoneNumberId: input.receivingPhoneNumberId, receivingPhoneNumber, inboundText: input.inboundText,
        createdAt, receivedAt: input.receivedAt, customerName: session.contact.displayName, historyHash: customerHistoryHash(session.messageHistory) };
      claim = await options.store.claim(binding);
      if (!claim) return { outcome: "duplicate" };
      const plan = await options.generate(binding, session);
      const currentConfig = options.config();
      if (!currentConfig || currentConfig.startAt !== config.startAt || currentConfig.allowedPhone !== config.allowedPhone
        || currentConfig.testCustomerOverride !== config.testCustomerOverride) {
        await options.store.suppress(claim, "CONFIG_CHANGED"); return { outcome: "suppressed" };
      }
      if (!await options.store.prepare(claim, plan)) return { outcome: "suppressed" };
      hasTask = plan.task !== null;
      await refreshTask();
      const submissionConfig = options.config();
      if (!submissionConfig || submissionConfig.startAt !== config.startAt || submissionConfig.allowedPhone !== config.allowedPhone
        || submissionConfig.testCustomerOverride !== config.testCustomerOverride) {
        await options.store.suppressBeforeSubmission(claim, "CONFIG_CHANGED"); await refreshTask(); return { outcome: "suppressed" };
      }
      // Durable exact reply and actionable task already exist before submission.
      submissionStarted = true;
      const response = await options.send({ to: phone, content: plan.replyText, fromNumberId: input.receivingPhoneNumberId });
      if (!response.success || typeof response.messageId !== "string" || !response.messageId.trim()) {
        await options.store.markUncertain(claim); await refreshTask(); return { outcome: "uncertain" };
      }
      if (!await options.store.recordAcceptance(claim, response.messageId)) {
        await options.store.markUncertain(claim); await refreshTask(); return { outcome: "uncertain" };
      }
      await refreshTask();
      return { outcome: "accepted" };
    } catch {
      if (claim) {
        try {
          if (submissionStarted) await options.store.markUncertain(claim);
          else await options.store.suppressBeforeSubmission(claim, "GENERATION_OR_PERSISTENCE_FAILED");
        } catch { /* Existing durable claim remains blocked, never retried. */ }
      }
      await refreshTask();
      return { outcome: submissionStarted ? "uncertain" : "failed" };
    }
  };
}
