import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_CUSTOMER_REPLY_CAPABILITY as capability, CLAUDE_CUSTOMER_TASK_ACTION as taskAction } from "../../shared/claudeCustomerTasks";
import { createPublicBookingPriceSnapshot } from "../../shared/publicBookingPricing";
import { createCustomerBookingLink } from "../customerBookingLinkService";
import { previewCallBookingQuote, type CallBookingQuotePricing } from "./callBookingQuote";
import { createClaudeCustomerSmsService, type CustomerSmsInput } from "./claudeCustomerSms";
import { createClaudeCustomerSmsGeneratorWithReply } from "./claudeCustomerSmsGeneration";
import { createClaudeCustomerTasksStore, type CustomerSmsBinding } from "./claudeCustomerTasksStore";
import { createSmsBookingQuotePlanPreparer } from "./smsBookingQuoteApplication";
import { createSmsBookingQuoteReplyGenerator } from "./smsBookingQuoteGeneration";
import { createSmsBookingQuoteStore, SMS_BOOKING_QUOTE_ACTION, SMS_BOOKING_QUOTE_CHANNEL, SMS_QUOTE_BOOKING_ORIGIN } from "./smsBookingQuoteStore";
import type { SmsBookingQuoteFields, SmsBookingQuoteState, SmsBookingQuoteUpdate } from "./smsBookingQuote";

// Only infrastructure is mocked. Qualification, generation validation, canonical
// pricing/link creation, transactions, receipt/task/history and dispatch are real.
const forbidden = vi.hoisted(() => ({
  getDb: vi.fn(() => { throw Error("Forbidden application database acquisition"); }),
  sendSms: vi.fn(() => { throw Error("Forbidden alternate sender"); }),
  runInitialLeadDraft: vi.fn(() => { throw Error("Forbidden live model"); }),
  broadcast: vi.fn(() => { throw Error("Forbidden application broadcast"); }),
}));
vi.mock("../db", () => ({ getDb: forbidden.getDb }));
vi.mock("../openphone", () => ({ sendSms: forbidden.sendSms }));
vi.mock("../sseBroadcast", () => ({ broadcastOpsUpdate: forbidden.broadcast }));
vi.mock("./claudeAgentClient", async importOriginal => ({
  ...await importOriginal<typeof import("./claudeAgentClient")>(), runInitialLeadDraft: forbidden.runInitialLeadDraft,
}));

const NOW = Date.parse("2026-11-17T18:00:00.000Z");
const PHONE = "+13015550123", LINE = "PN-synthetic-cs", LINE_TWO = "PN-synthetic-other";
const BUSINESS = "+12028885362", BUSINESS_TWO = "+19347898077";
const NAME = "María García", ADDRESS = "123 Synthetic Street, Washington, DC 20001";
const KNOWLEDGE = "Complete approved synthetic company text for offline transport verification. Customer preferences are not verified availability.";
const OWNER = { id: "17", name: "Sam" }, OTHER = { id: "18", name: "Sam" };
const pricing: CallBookingQuotePricing = {
  pricingMode: "home", serviceId: "deep", bedrooms: 3, bathrooms: 2, homeType: "House", condition: 5,
  maidCount: 1, hourCount: 1, extras: [], recurrence: "biweekly",
};
const fullFields: SmsBookingQuoteFields = {
  ...pricing, customerName: NAME, address: ADDRESS, requestedLocalDate: "2026-11-20", requestedLocalTime: "10:30", extrasConfirmed: true,
};
const FULL_TEXT = `Please send my new cleaning quote link. My name is ${NAME}, ${ADDRESS}, Friday November 20 at 10:30 am. Deep home cleaning, 3 bedrooms, 2 bathrooms, House, condition 5, biweekly, no extras confirmed.`;
const QUOTE_TEMPLATE = "Your first cleaning quote is {{firstCleaningPrice}}. Future visits: {{futureVisitPrice}}. Extras: {{extras}}.";
const LINK_TEMPLATE = `${QUOTE_TEMPLATE} Review and complete your booking here: {{bookingLink}}. This is a quote, not a reservation.`;
const FOLLOWUP_TITLE = "Follow up on cleaning booking link";
const FOLLOWUP_ITEM = "Review the customer's booking-link completion";
const MISSING_CONDITION_QUESTION = {
  en: "How much cleaning does it need (1 to 10)?\n1 = already clean, 5 = normal, 10 = heavy buildup.",
  es: "¿Cuánta limpieza necesita (del 1 al 10)?\n1 = limpio, 5 = normal, 10 = mucha suciedad.",
};
const STALE_PAGE_RECAP = "Thanks, María. Review the details and complete your booking on the page.";
const MISSING_HOME_CASES = (["standard", "deep", "moveout"] as const).flatMap(serviceId =>
  (["home", "hourly"] as const).flatMap(pricingMode =>
    (["en", "es"] as const).map(language => ({ serviceId, pricingMode, language }))));
const DEFAULT_HOME_CASES = (["standard", "deep", "moveout"] as const).flatMap(serviceId =>
  (["one-time", "weekly", "biweekly", "monthly"] as const).map(recurrence => ({ serviceId, recurrence })));
function missingHomeFixture(serviceId: CallBookingQuotePricing["serviceId"], pricingMode: CallBookingQuotePricing["pricingMode"]) {
  const completePricing: CallBookingQuotePricing = { ...pricing, serviceId, pricingMode, bedrooms: 4, bathrooms: 3, condition: 7,
    maidCount: pricingMode === "hourly" ? 2 : 1, hourCount: pricingMode === "hourly" ? 4 : 1,
    recurrence: "weekly", extras: [{ id: "inside-fridge", quantity: 2 }, { id: "inside-oven", quantity: 1 }] };
  const fields: SmsBookingQuoteFields = { ...fullFields, ...completePricing,
    requestedLocalDate: "2026-11-23", requestedLocalTime: "14:45" };
  delete fields.homeType;
  const text = `Please send my new ${serviceId} ${pricingMode} cleaning quote link. My name is ${NAME}, ${ADDRESS}, Monday November 23 at 2:45 pm. `
    + "4 bedrooms, 3 bathrooms, condition 7, weekly cleaning. Two Inside Fridge and one Inside Oven, extras confirmed."
    + (pricingMode === "hourly" ? " I want 2 maids for 4 hours." : "");
  return { completePricing, fields, text };
}
type Row = Record<string, any>;
type Fault = "none" | "funnel" | "state-insert" | "state-save" | "task-insert" | "task-save" | "receipt-insert" | "receipt-prepare" | "acceptance-save";

/** Explicit MySQL port, modeled on the canonical task/call application tests.
 * Transaction snapshot rollback, unique indexes, detached SELECTs, lock checks,
 * and narrow SQL branches prevent an unimplemented query from passing silently. */
function transactionalDb() {
  let state: { sessions: Row[]; drafts: Row[]; cards: Row[]; funnels: Row[]; optouts: Row[]; nativeBookings: Row[]; next: number } = {
    sessions: [], drafts: [], cards: [], funnels: [], optouts: [], nativeBookings: [{ id: 81, status: "untouched" }], next: 100,
  };
  const dialect = new MySqlDialect(), queries: Array<{ sql: string; params: any[] }> = [], unhandled: string[] = [];
  const writes: Array<{ table: string; kind: string }> = [], events: string[] = [];
  let tail = Promise.resolve(), depth = 0, fault: Fault = "none";
  const fail = (target: Fault) => {
    if (fault === target) { events.push(`fault:${target}`); throw Error(`Injected ${target} persistence failure`); }
  };
  const unknown = (text: string): never => { unhandled.push(text); throw Error(`Unhandled synthetic SQL: ${text}`); };
  const read = (rows: Row[]) => [structuredClone(rows)];
  function insert(table: any, inTransaction: boolean) {
    const name = getTableName(table);
    if (!["madison_sms_drafts", "ops_chat_messages", "booking_funnel_records"].includes(name)) return unknown(`INSERT ${name}`);
    return { async values(values: Row) {
      expect(inTransaction).toBe(true);
      writes.push({ table: name, kind: values.quickAction ?? "insert" });
      if (name === "madison_sms_drafts") {
        fail("receipt-insert");
        if (state.drafts.some(row => row.inboundOpenPhoneId === values.inboundOpenPhoneId)) throw Object.assign(Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      } else if (name === "booking_funnel_records") {
        fail("funnel");
        if (state.funnels.some(row => row.publicFunnelNumber === values.publicFunnelNumber || row.idempotencyKey === values.idempotencyKey)) throw Object.assign(Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      } else {
        if (![taskAction, SMS_BOOKING_QUOTE_ACTION].includes(values.quickAction)) return unknown(`INSERT ops_chat_messages ${values.quickAction}`);
        fail(values.quickAction === taskAction ? "task-insert" : "state-insert");
        if (values.activeDedupKey && state.cards.some(row => row.activeDedupKey === values.activeDedupKey)) throw Object.assign(Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      }
      const id = ++state.next, target = name === "madison_sms_drafts" ? state.drafts : name === "booking_funnel_records" ? state.funnels : state.cards;
      target.push({ id, ...structuredClone(values) }); events.push(`insert:${name}`);
      return [{ insertId: id, affectedRows: 1 }];
    } };
  }
  async function execute(query: any, inTransaction: boolean) {
    const q = dialect.sqlToQuery(query); queries.push(q);
    const s = q.sql.replace(/\s+/g, " ").trim(), p = q.params;
    if (s.endsWith("FOR UPDATE")) expect(inTransaction).toBe(true);
    if (s.startsWith("SELECT")) {
      if (/^SELECT (?:id|\*) FROM madison_sms_drafts WHERE inboundOpenPhoneId = \?$/.test(s)) return read(state.drafts.filter(row => row.inboundOpenPhoneId === p[0]));
      if (s === "SELECT * FROM madison_sms_drafts WHERE id = ? FOR UPDATE") return read(state.drafts.filter(row => row.id === p[0]));
      if (s === "SELECT * FROM conversation_sessions WHERE id = ? FOR UPDATE") return read(state.sessions.filter(row => row.id === p[0]));
      if (s === "SELECT id FROM sms_opt_outs WHERE phone = ?") return read(state.optouts.filter(row => row.phone === p[0]));
      if (/^SELECT \* FROM ops_chat_messages WHERE activeDedupKey = \?(?: FOR UPDATE)?$/.test(s)) return read(state.cards.filter(row => row.activeDedupKey === p[0]));
      if (/^SELECT \* FROM ops_chat_messages WHERE id = \? AND quickAction = \?(?: FOR UPDATE)?$/.test(s)) return read(state.cards.filter(row => row.id === p[0] && row.quickAction === p[1]));
      if (s === "SELECT * FROM ops_chat_messages WHERE quickAction = ? AND channel = 'command' ORDER BY id DESC") return read(state.cards.filter(row => row.quickAction === p[0] && row.channel === "command").sort((a, b) => b.id - a.id));
      return unknown(s);
    }
    expect(inTransaction).toBe(true);
    if (s === "UPDATE ops_chat_messages SET metadata = ?, lastActivityAt = ? WHERE id = ? AND activeDedupKey = ? AND quickAction = ? AND channel = ? AND sessionId = ?") {
      fail("state-save"); writes.push({ table: "ops_chat_messages", kind: "state-update" });
      const row = state.cards.find(row => row.id === p[2] && row.activeDedupKey === p[3] && row.quickAction === p[4] && row.channel === p[5] && row.sessionId === p[6]);
      if (!row) return [{ affectedRows: 0 }];
      row.metadata = p[0]; row.lastActivityAt = p[1]; return [{ affectedRows: 1 }];
    }
    if (s === "UPDATE ops_chat_messages SET metadata = ?, lastActivityAt = ? WHERE id = ? AND quickAction = ?") {
      fail("task-save"); writes.push({ table: "ops_chat_messages", kind: "task-update" });
      const row = state.cards.find(row => row.id === p[2] && row.quickAction === p[3]);
      if (!row) return [{ affectedRows: 0 }];
      row.metadata = p[0]; row.lastActivityAt = p[1]; return [{ affectedRows: 1 }];
    }
    if (s === "UPDATE conversation_sessions SET messageHistory = JSON_ARRAY_APPEND(messageHistory, '$', CAST(? AS JSON)), lastMessageText = ?, lastMessageTs = ?, lastMessageRole = 'assistant', messageCount = messageCount + 1 WHERE id = ? AND leadPhone = ?") {
      writes.push({ table: "conversation_sessions", kind: "append-accepted-history" });
      const row = state.sessions.find(row => row.id === p[3] && row.leadPhone === p[4]);
      if (!row) return [{ affectedRows: 0 }];
      row.messageHistory = JSON.stringify([...JSON.parse(row.messageHistory), JSON.parse(p[0] as string)]);
      Object.assign(row, { lastMessageText: p[1], lastMessageTs: p[2], lastMessageRole: "assistant", messageCount: row.messageCount + 1 });
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith("UPDATE madison_sms_drafts SET status = 'SENDING', generatedDraft = ?") && s.endsWith("WHERE id = ? AND capability = ? AND status = 'TOOLS_RUNNING'")) {
      fail("receipt-prepare"); writes.push({ table: "madison_sms_drafts", kind: "prepare" });
      const row = state.drafts.find(row => row.id === p[3] && row.capability === p[4] && row.status === "TOOLS_RUNNING");
      if (!row) return [{ affectedRows: 0 }];
      Object.assign(row, { status: "SENDING", generatedDraft: p[0], approvedText: p[1], capabilityResult: JSON.parse(p[2] as string) });
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith("UPDATE madison_sms_drafts SET status = 'SENT', outboundOpenPhoneId = ?") && s.endsWith("WHERE id = ? AND capability = ? AND status = 'SENDING'")) {
      fail("acceptance-save"); writes.push({ table: "madison_sms_drafts", kind: "accept" });
      const row = state.drafts.find(row => row.id === p[1] && row.capability === p[2] && row.status === "SENDING");
      if (!row) return [{ affectedRows: 0 }];
      Object.assign(row, { status: "SENT", outboundOpenPhoneId: p[0], sentAt: new Date(NOW), errorStage: null, errorCode: null });
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith("UPDATE madison_sms_drafts SET status = 'DISMISSED', errorStage = 'GATE', errorCode = ?") && s.includes("WHERE id = ? AND capability = ?")) {
      const beforeSubmission = s.endsWith("AND (errorCode IS NULL OR errorCode <> 'SUBMISSION_UNCERTAIN')");
      const freshOnly = s.endsWith("AND status = 'TOOLS_RUNNING'");
      if (!beforeSubmission && !freshOnly) return unknown(s);
      writes.push({ table: "madison_sms_drafts", kind: "suppress" });
      const row = state.drafts.find(row => row.id === p[1] && row.capability === p[2] && (beforeSubmission
        ? ["TOOLS_RUNNING", "SENDING"].includes(row.status) && !row.outboundOpenPhoneId && !row.sentAt && row.errorCode !== "SUBMISSION_UNCERTAIN"
        : row.status === "TOOLS_RUNNING"));
      if (!row) return [{ affectedRows: 0 }];
      Object.assign(row, { status: "DISMISSED", errorCode: p[0], errorStage: "GATE" }); return [{ affectedRows: 1 }];
    }
    if (s === "UPDATE madison_sms_drafts SET errorStage = 'SEND', errorCode = 'SUBMISSION_UNCERTAIN', updatedAt = NOW(3) WHERE id = ? AND capability = ? AND status = 'SENDING'") {
      writes.push({ table: "madison_sms_drafts", kind: "uncertain" });
      const row = state.drafts.find(row => row.id === p[0] && row.capability === p[1] && row.status === "SENDING");
      if (!row) return [{ affectedRows: 0 }];
      row.errorStage = "SEND"; row.errorCode = "SUBMISSION_UNCERTAIN"; return [{ affectedRows: 1 }];
    }
    return unknown(s);
  }
  const tx: any = { insert: (table: any) => insert(table, true), execute: (query: any) => execute(query, true) };
  const db: any = {
    insert: (table: any) => insert(table, false), execute: (query: any) => execute(query, false),
    async transaction(fn: any) {
      let release!: () => void;
      const prior = tail; tail = new Promise<void>(resolve => { release = resolve; }); await prior;
      const snapshot = structuredClone(state); depth++; events.push("begin");
      try { const result = await fn(tx); events.push("commit"); return result; }
      catch (error) { state = snapshot; events.push("rollback"); throw error; }
      finally { depth--; release(); }
    },
  };
  return { db, queries, writes, events, unhandled, state: () => state, transactions: () => depth, setFault: (value: Fault) => { fault = value; } };
}
const memories: ReturnType<typeof transactionalDb>[] = [];
function harness(reuseFactories = false) {
  const memory = transactionalDb(); memories.push(memory);
  let sequence = 0, queued: any = null, afterModel: (() => void) | undefined;
  let transport: (() => Promise<{ success: boolean; messageId?: string }>) | undefined;
  let config: any = { startAt: NOW - 60_000, allowedPhone: PHONE, testCustomerOverride: false, scope: "all_customers" };
  const addSession = (id: number, line = LINE, phone = PHONE, name: string | null = NAME) => {
    memory.state().sessions.push({ id, leadPhone: phone, lastInboundPhoneNumberId: line, smsOptOut: 0, messageCount: 0,
      leadSource: "cs-inbound", csQueue: "Clients", stage: "CS_INBOUND", messageHistory: "[]", customerName: name });
  };
  addSession(7);
  const row = (id = 7) => memory.state().sessions.find(value => value.id === id)!;
  const history = (id = 7): Row[] => JSON.parse(row(id).messageHistory);
  const quoteRows = () => memory.state().cards.filter(value => value.quickAction === SMS_BOOKING_QUOTE_ACTION);
  const quote = (id = 7, line = LINE): SmsBookingQuoteState | null => {
    const found = quoteRows().map(value => JSON.parse(value.metadata).state as SmsBookingQuoteState).find(value =>
      value.sessionId === id && value.receivingPhoneNumberId === line && value.customerPhone === row(id).leadPhone);
    return found ?? null;
  };
  const tasks = () => memory.state().cards.filter(value => value.quickAction === taskAction).map(value => JSON.parse(value.metadata).task);
  const readKnowledge = vi.fn(async () => KNOWLEDGE);
  const runner = vi.fn(async (_options: { systemPrompt: string; userPrompt: string }) => {
    if (queued === null) throw Error("No synthetic model output queued");
    const value = queued; queued = null; afterModel?.();
    return { finalSmsText: typeof value === "string" ? value : JSON.stringify(value) };
  });
  const send = vi.fn(async (input: { to: string; fromNumberId: string; content: string }): Promise<{ success: boolean; messageId?: string }> => {
    expect(memory.transactions()).toBe(0); expect(memory.events.at(-1)).toBe("commit");
    const draft = memory.state().drafts.find(value => value.status === "SENDING" && value.generatedDraft === input.content);
    expect(draft, "the finalized exact SMS must already be durable before provider submission").toBeDefined();
    expect(draft!.capability).toBe(capability); expect(draft!.approvedText).toBe(input.content);
    const binding = draft!.resolvedContext as CustomerSmsBinding;
    expect(input.to).toBe(binding.fromPhone); expect(input.fromNumberId).toBe(binding.receivingPhoneNumberId);
    if (draft!.capabilityResult.taskId !== null) {
      const task = tasks().find(value => value.id === draft!.capabilityResult.taskId);
      expect(task).toMatchObject({ status: "unclaimed", sourceMessageId: binding.providerMessageId, reply: { text: input.content, status: "prepared", providerMessageId: null } });
    }
    if (input.content.includes(`${SMS_QUOTE_BOOKING_ORIGIN}/book/`)) {
      const saved = quote(binding.sessionId, binding.receivingPhoneNumberId)!;
      expect(saved).toMatchObject({ version: 1, customerPhone: input.to, receivingPhoneNumberId: input.fromNumberId });
      expect(saved.link).not.toBeNull();
      const matching = memory.state().funnels.filter(value => value.publicFunnelNumber === saved.link!.token);
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({ stage: "lead", customerPhone: input.to, firstCleaningTotalCents: saved.link!.firstCleaningTotalCents });
      expect(input.content).toContain(`${SMS_QUOTE_BOOKING_ORIGIN}${saved.link!.urlPath}`);
    }
    memory.events.push("provider-preconditions-verified");
    if (transport) return transport();
    return { success: true, messageId: `synthetic-outbound-${send.mock.calls.length}` };
  });
  const stores = () => {
    const quoteStore = createSmsBookingQuoteStore(memory.db);
    return { quoteStore, taskStore: createClaudeCustomerTasksStore(memory.db, { preparePlan: createSmsBookingQuotePlanPreparer(quoteStore, () => NOW) }) };
  };
  const service = () => {
    const { quoteStore, taskStore } = stores();
    return createClaudeCustomerSmsService({
      config: () => config,
      readSession: async id => {
        const value = row(id); if (!value) return null;
        return { contact: { sessionId: String(id), rawPhone: value.leadPhone, phone: value.leadPhone, displayName: value.customerName, contactGap: null },
          messageHistory: value.messageHistory, lastInboundPhoneNumberId: value.lastInboundPhoneNumberId,
          leadSource: value.leadSource, smsOptOut: value.smsOptOut, csQueue: value.csQueue };
      },
      readReceivingLine: async id => { if (id === LINE) return BUSINESS; if (id === LINE_TWO) return BUSINESS_TWO; throw Error("Unknown synthetic receiving line"); },
      generate: createClaudeCustomerSmsGeneratorWithReply(createSmsBookingQuoteReplyGenerator({ runner, readKnowledge, smsBookingQuote: { readState: quoteStore.read } })),
      store: taskStore, send,
    });
  };
  // Default: fresh factories for each inbound; the bounded reuse control keeps the
  // same complete service alive without resetting any factory or synthetic state.
  const reusedService = reuseFactories ? service() : null;
  const run = (input: CustomerSmsInput) => (reusedService ?? service())(input);
  const append = (text: string, id = 7, line = row(id).lastInboundPhoneNumberId): CustomerSmsInput => {
    const providerMessageId = `synthetic-inbound-${++sequence}`, value = row(id);
    const turns = history(id);
    turns.push({ role: "user", content: text, ts: NOW + sequence, opMsgId: providerMessageId, sessionId: id,
      receivingPhoneNumberId: line, direction: "incoming", from: value.leadPhone, to: [line === LINE ? BUSINESS : BUSINESS_TWO] });
    value.messageHistory = JSON.stringify(turns); value.messageCount++; value.lastInboundPhoneNumberId = line;
    return { sessionId: id, providerMessageId, fromPhone: value.leadPhone, receivingPhoneNumberId: line, inboundText: text,
      createdAt: new Date(NOW).toISOString(), receivedAt: NOW + sequence, direction: "incoming", isCleaner: false };
  };
  function output(input: CustomerSmsInput, fields: SmsBookingQuoteFields = {}, action: SmsBookingQuoteUpdate["action"] = "link", extra: Row = {}) {
    const turns = history(input.sessionId), index = turns.findIndex(turn => turn.opMsgId === input.providerMessageId);
    return { replyText: "Thanks, María. Here are the details for your review.", task: null, bookingQuote: {
      action, intentEvidenceQuote: input.inboundText, fields: structuredClone(fields),
      evidence: Object.fromEntries(Object.keys(fields).map(key => [key, { turnIndex: index, quote: input.inboundText }])),
    }, ...extra };
  }
  async function turn(text = FULL_TEXT, fields: SmsBookingQuoteFields = fullFields, action: SmsBookingQuoteUpdate["action"] = "link", extra: Row = {}, id = 7, line?: string) {
    const input = append(text, id, line); queued = output(input, fields, action, extra);
    return { input, result: await run(input) };
  }
  return { ...memory, addSession, row, history, quoteRows, quote, tasks, send, runner, readKnowledge, stores, run, append, output, turn,
    queue: (value: any) => { queued = value; }, afterModel: (fn: (() => void) | undefined) => { afterModel = fn; },
    setTransport: (value: typeof transport) => { transport = value; },
    changeConfig: (value: any) => { config = value; }, config: () => config };
}
function expectAcceptedHistory(h: ReturnType<typeof harness>, input: CustomerSmsInput) {
  const draft = h.state().drafts.find(value => value.inboundOpenPhoneId === input.providerMessageId)!;
  const submitted = h.send.mock.calls.find(([value]) => value.content === draft.generatedDraft)![0];
  const accepted = h.history(input.sessionId).filter(value => value.opMsgId === draft.outboundOpenPhoneId);
  expect(accepted).toHaveLength(1);
  expect(accepted[0]).toMatchObject({ role: "assistant", content: submitted.content, fromNumberId: input.receivingPhoneNumberId, to: [input.fromPhone] });
  expect(draft).toMatchObject({ status: "SENT", generatedDraft: submitted.content, approvedText: submitted.content });
  expect(draft).not.toHaveProperty("deliveredAt");
}
function canonicalInput(fields = fullFields) {
  const { customerName, address, requestedLocalDate, requestedLocalTime } = fields;
  return { customerName: customerName!, customerPhone: PHONE, address: address!, requestedLocalDate: requestedLocalDate!, requestedLocalTime: requestedLocalTime!,
    pricing: { ...pricing, bedrooms: fields.bedrooms!, extras: fields.extras!, condition: fields.condition!, recurrence: fields.recurrence! }, notes: fields.notes ?? [] };
}

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Forbidden network access"); }));
});
afterEach(() => {
  for (const memory of memories.splice(0)) {
    expect(memory.unhandled).toEqual([]); expect(memory.transactions()).toBe(0);
    expect(memory.state().nativeBookings).toEqual([{ id: 81, status: "untouched" }]);
    expect(memory.state().sessions.every(row => row.stage === "CS_INBOUND")).toBe(true);
    expect(memory.state().funnels.every(row => row.stage === "lead")).toBe(true);
  }
  expect(forbidden.getDb).not.toHaveBeenCalled(); expect(forbidden.sendSms).not.toHaveBeenCalled();
  expect(forbidden.runInitialLeadDraft).not.toHaveBeenCalled(); expect(forbidden.broadcast).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("SMS new-booking quote application: real generator → qualification → canonical link → original task/receipt → one sender", () => {
  it("collects a multi-turn quote durably, never invents empty extras or re-asks known name/address/time, and matches call/shared canonical prices exactly", async () => {
    const h = harness();
    const first = await h.turn(`I want a new deep home cleaning quote. My name is ${NAME}. The address is ${ADDRESS}, Friday November 20 at 10:30 am.`, {
      customerName: NAME, address: ADDRESS, requestedLocalDate: "2026-11-20", requestedLocalTime: "10:30", pricingMode: "home", serviceId: "deep",
    }, "collect", { replyText: "How many bedrooms and bathrooms are there?" });
    expect(first.result).toEqual({ outcome: "accepted" }); expect(h.state().funnels).toEqual([]);
    expect(h.quote()?.fields).not.toHaveProperty("extras"); expect(h.quote()?.fields).not.toHaveProperty("recurrence");
    expect(h.quote()?.fields.homeType).toBe("House"); expect(h.quote()?.evidence).not.toHaveProperty("homeType");
    const quoteId = h.quote()!.quoteId;
    const second = await h.turn("It is a House with 3 bedrooms and 2 bathrooms. Condition 5, biweekly cleaning please.", {
      homeType: "House", bedrooms: 3, bathrooms: 2, condition: 5, recurrence: "biweekly",
    }, "collect", { replyText: "Would you like any add-ons, or no extras?" });
    expect(second.result).toEqual({ outcome: "accepted" }); expect(h.quote()?.fields).not.toHaveProperty("extras");
    expect(h.quote()?.evidence.homeType).toEqual({ turnIndex: 2, quote: second.input.inboundText });
    const prompt = JSON.parse(h.runner.mock.calls[1][0].userPrompt);
    expect(prompt.context.smsBookingQuote.state).toMatchObject({ quoteId, fields: { customerName: NAME, address: ADDRESS, requestedLocalTime: "10:30" } });
    expect(prompt.context.originalConversation).toHaveLength(3); expect(prompt.context.originalConversation[1].role).toBe("assistant");
    expect(prompt.context.knowledgeBase).toBe(KNOWLEDGE);
    expect(h.runner.mock.calls[1][0].systemPrompt).toContain("COMPLETE CURRENT CS WRITING PROMPT");
    expect(h.runner.mock.calls[1][0].systemPrompt).toContain("never repeat known usable fields");
    const third = await h.turn("No extras. Please show my quote.", { extras: [], extrasConfirmed: true }, "quote", { quoteTextTemplate: QUOTE_TEMPLATE });
    expect(third.result).toEqual({ outcome: "accepted" }); expect(h.state().funnels).toEqual([]);
    expect(h.quote()).toMatchObject({ quoteId, revision: 3, link: null, fields: fullFields });
    expect(h.quote()?.evidence.extras).toEqual({ turnIndex: 4, quote: third.input.inboundText });
    const preview = previewCallBookingQuote({ pricing, extrasConfirmed: true }); expect(preview.success).toBe(true);
    if (!preview.success) throw Error("Canonical fixture must preview successfully");
    const quoteReply = h.send.mock.calls[2][0].content;
    expect(quoteReply).toContain(preview.priceFormatted); expect(quoteReply).toContain(preview.futureVisitPriceFormatted!);
    expect(quoteReply).toContain("No add-ons selected"); expect(quoteReply).not.toContain("/book/");
    expect(h.tasks()).toEqual([]);
    const fourth = await h.turn("Yes, please send my new cleaning booking link.", {}, "link", { quoteTextTemplate: LINK_TEMPLATE });
    expect(fourth.result).toEqual({ outcome: "accepted" }); expect(h.state().funnels).toHaveLength(1); expect(h.tasks()).toHaveLength(1);
    expect(h.tasks()[0]).toMatchObject({ title: FOLLOWUP_TITLE, status: "unclaimed", sourceMessageId: fourth.input.providerMessageId,
      items: [{ title: FOLLOWUP_ITEM, evidenceQuote: fourth.input.inboundText, completedBy: null, completedAt: null }],
      reply: { text: h.send.mock.calls[3][0].content, status: "sent" } });
    const funnel = h.state().funnels[0], snapshot = createPublicBookingPriceSnapshot(pricing);
    expect(funnel).toMatchObject({ customerName: NAME, customerPhone: PHONE, address: ADDRESS, requestedLocalDate: "2026-11-20", requestedLocalTime: "10:30",
      stage: "lead", source: "customer-booking-link", bookedByAgentName: "Instinct · AI SMS", extras: [], priceSnapshot: snapshot,
      firstCleaningTotalCents: preview.firstCleaningTotalCents, futureVisitTotalCents: preview.futureVisitTotalCents });
    const sharedRows: Row[] = [];
    await createCustomerBookingLink({ insert: () => ({ values: async (value: Row) => { sharedRows.push(value); return [{ affectedRows: 1 }]; } }) } as any,
      canonicalInput(), { agentId: null, agentName: "Synthetic shared-service control" }, () => {});
    expect(funnel.priceSnapshot).toEqual(sharedRows[0].priceSnapshot);
    expect(h.quote()).toMatchObject({ quoteId, revision: 4, link: { token: funnel.publicFunnelNumber, firstCleaningTotalCents: preview.firstCleaningTotalCents } });
    for (const value of [first, second, third, fourth]) expectAcceptedHistory(h, value.input);
    expect(h.runner).toHaveBeenCalledTimes(4); expect(h.send).toHaveBeenCalledTimes(4); expect(h.readKnowledge).toHaveBeenCalledTimes(4);
    expect(h.send.mock.calls[3][0].content).toContain(`${SMS_QUOTE_BOOKING_ORIGIN}/book/${funnel.publicFunnelNumber}`);
    expect(h.send.mock.calls[3][0].content).not.toMatch(/\{\{|2026-11-17T|18:00:00|booking (?:code|number|confirmed)|payment complete/i);
    expect(h.quoteRows()).toHaveLength(1); expect(h.quoteRows()[0].channel).toBe(SMS_BOOKING_QUOTE_CHANNEL);
  });

  it.each(MISSING_HOME_CASES)("defaults absent homeType to House and links $serviceId/$pricingMode on the first turn in $language without fabricated evidence", async ({ serviceId, pricingMode, language }) => {
    const h = harness(), fixture = missingHomeFixture(serviceId, pricingMode);
    const first = await h.turn(fixture.text, fixture.fields, "link", {
      replyText: STALE_PAGE_RECAP, quotePresentationLanguage: language,
    });
    expect(first.result).toEqual({ outcome: "accepted" });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.quote()).toMatchObject({ quoteId: first.input.providerMessageId, revision: 1 });
    expect(h.quote()!.fields).toEqual({ ...fixture.fields, homeType: "House" });
    expect(h.quote()!.evidence).not.toHaveProperty("homeType");
    expect(h.quote()!.fields).toMatchObject({ requestedLocalDate: "2026-11-23", requestedLocalTime: "14:45",
      extras: fixture.completePricing.extras, extrasConfirmed: true, recurrence: "weekly",
      maidCount: pricingMode === "hourly" ? 2 : 1, hourCount: pricingMode === "hourly" ? 4 : 1 });
    if (pricingMode === "hourly") {
      expect(h.quote()!.evidence.maidCount).toEqual({ turnIndex: 0, quote: fixture.text });
      expect(h.quote()!.evidence.hourCount).toEqual({ turnIndex: 0, quote: fixture.text });
    } else {
      expect(h.quote()!.evidence).not.toHaveProperty("maidCount"); expect(h.quote()!.evidence).not.toHaveProperty("hourCount");
    }
    expect(h.quoteRows()).toHaveLength(1); expect(h.state().funnels).toHaveLength(1);
    const preview = previewCallBookingQuote({ pricing: fixture.completePricing, extrasConfirmed: true });
    if (!preview.success) throw Error("Defaulted home-type fixture must preview successfully");
    const funnel = h.state().funnels[0], link = h.quote()!.link!, content = h.send.mock.calls[0][0].content;
    expect(funnel).toMatchObject({ customerName: NAME, customerPhone: PHONE, address: ADDRESS,
      requestedLocalDate: "2026-11-23", requestedLocalTime: "14:45", extras: fixture.completePricing.extras,
      priceSnapshot: createPublicBookingPriceSnapshot(fixture.completePricing),
      firstCleaningTotalCents: preview.firstCleaningTotalCents, futureVisitTotalCents: preview.futureVisitTotalCents,
      stage: "lead", source: "customer-booking-link", bookedByAgentName: "Instinct · AI SMS" });
    expect(link).toMatchObject({ token: funnel.publicFunnelNumber, firstCleaningTotalCents: preview.firstCleaningTotalCents });
    expect(content).toContain(preview.priceFormatted);
    expect(content).toContain(language === "es" ? `Próximas visitas (semanales): ${preview.futureVisitPriceFormatted}.`
      : `Your weekly follow-up cleaning price is ${preview.futureVisitPriceFormatted}.`);
    expect(content).toContain(language === "es" ? "2 × Interior del refrigerador" : "2 × Inside Fridge");
    expect(content).toContain(language === "es" ? "Interior del horno" : "Inside Oven");
    expect(content).not.toContain(STALE_PAGE_RECAP);
    expect(content).not.toMatch(/No add-ons selected|No se seleccionaron|\{\{|house|apartment|townhome|condo|casa|apartamento|condominio|arrival window|ventana de llegada/i);
    expect(content).not.toContain("?");
    const url = `${SMS_QUOTE_BOOKING_ORIGIN}${link.urlPath}`;
    expect(content.split(url)).toHaveLength(2);
    expect(content.match(/https?:\/\/[^\s]+/g)).toEqual([url]);
    expect(h.tasks()).toHaveLength(1);
    const task = h.tasks()[0];
    expect(task).toMatchObject({ title: FOLLOWUP_TITLE, status: "unclaimed", owner: null, completionNote: null,
      sourceMessageId: first.input.providerMessageId, sourceText: fixture.text,
      items: [{ title: FOLLOWUP_ITEM, evidenceQuote: fixture.text, completedBy: null, completedAt: null }],
      reply: { text: content, status: "sent", providerMessageId: h.state().drafts[0].outboundOpenPhoneId } });
    expectAcceptedHistory(h, first.input);
    expect(h.runner).toHaveBeenCalledTimes(1); expect(h.readKnowledge).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(1);
    const before = structuredClone(h.state());
    expect(["excluded", "duplicate"]).toContain((await h.run(first.input)).outcome);
    expect(h.state()).toEqual(before); expect(h.send).toHaveBeenCalledTimes(1); expect(h.runner).toHaveBeenCalledTimes(1);
  });

  it.each(DEFAULT_HOME_CASES)("defaults unknown mode/type for $serviceId/$recurrence without changing canonical prices or inventing customer evidence", async ({ serviceId, recurrence }) => {
    const h = harness(), fixture = missingHomeFixture(serviceId, "home");
    const fields = { ...fixture.fields, recurrence };
    delete fields.pricingMode; delete fields.maidCount; delete fields.hourCount;
    const text = fixture.text.replace(`${serviceId} home`, serviceId).replace("weekly cleaning", `${recurrence} cleaning`);
    const value = await h.turn(text, fields);
    expect(value.result).toEqual({ outcome: "accepted" });
    expect(h.quote()!.fields).toEqual({ ...fields, pricingMode: "home", homeType: "House", maidCount: 1, hourCount: 1 });
    expect(h.quote()!.evidence).toEqual(Object.fromEntries(Object.keys(fields).map(key => [key, { turnIndex: 0, quote: text }])));
    const expectedPricing = { ...fixture.completePricing, recurrence }, snapshot = createPublicBookingPriceSnapshot(expectedPricing);
    const preview = previewCallBookingQuote({ pricing: expectedPricing, extrasConfirmed: true });
    if (!preview.success) throw Error("Application-default fixture must preview successfully");
    expect(h.state().funnels).toHaveLength(1); expect(h.quoteRows()).toHaveLength(1); expect(h.tasks()).toHaveLength(1);
    expect(h.state().funnels[0]).toMatchObject({ priceSnapshot: snapshot, firstCleaningTotalCents: preview.firstCleaningTotalCents,
      futureVisitTotalCents: preview.futureVisitTotalCents, stage: "lead" });
    const content = h.send.mock.calls[0][0].content;
    expect(content).toContain(`🧹 Service: ${snapshot.serviceName}`); expect(content).toContain(`💵 Total: ${preview.priceFormatted}`);
    if (recurrence === "one-time") expect(content).not.toMatch(/follow-up cleaning|future-visit|Próximas visitas/);
    else expect(content).toContain(`Your ${recurrence} follow-up cleaning price is ${preview.futureVisitPriceFormatted}.`);
    expect(content).not.toMatch(/home-cleaning quote or|hourly-cleaning quote|house|apartment|townhome|condo|\?/i);
    expect(content.match(/https?:\/\/[^\s]+/g)).toEqual([`${SMS_QUOTE_BOOKING_ORIGIN}${h.quote()!.link!.urlPath}`]);
    expectAcceptedHistory(h, value.input); expect(h.runner).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(1);
    const before = structuredClone(h.state());
    expect(["excluded", "duplicate"]).toContain((await h.run(value.input)).outcome);
    expect(h.state()).toEqual(before); expect(h.runner).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(1);
  });

  it.each(["Apartment", "Townhome", "Condo"] as const)("preserves a customer-provided %s while defaulting only unknown pricing mode", async homeType => {
    const h = harness(), fields = { ...fullFields, homeType };
    delete fields.pricingMode; delete fields.maidCount; delete fields.hourCount;
    const value = await h.turn(FULL_TEXT.replace("Deep home cleaning", "Deep cleaning").replace("House", homeType), fields);
    expect(value.result).toEqual({ outcome: "accepted" });
    expect(h.quote()?.fields).toMatchObject({ pricingMode: "home", homeType, maidCount: 1, hourCount: 1 });
    expect(h.quote()?.evidence.homeType).toEqual({ turnIndex: 0, quote: value.input.inboundText });
    expect(h.quote()?.evidence).not.toHaveProperty("pricingMode");
    expect(h.state().funnels[0].priceSnapshot).toEqual(createPublicBookingPriceSnapshot({ ...pricing, homeType }));
    expect(h.send.mock.calls[0][0].content).not.toContain(homeType); expectAcceptedHistory(h, value.input);
  });

  it("requires actual counts for explicit hourly after a default home quote, then preserves prior hourly mode/counts on an omitted patch", async () => {
    const h = harness(), fields = { ...fullFields };
    delete fields.pricingMode; delete fields.homeType; delete fields.maidCount; delete fields.hourCount;
    expect((await h.turn(FULL_TEXT.replace("Deep home cleaning", "Deep cleaning").replace(", House", ""), fields)).result).toEqual({ outcome: "accepted" });
    const hourly = await h.turn("Change this new cleaning quote to hourly and send its link.", { pricingMode: "hourly" });
    expect(hourly.result).toEqual({ outcome: "accepted" });
    expect(h.quote()?.fields).toMatchObject({ pricingMode: "hourly", homeType: "House" });
    expect(h.quote()?.fields).not.toHaveProperty("maidCount"); expect(h.quote()?.fields).not.toHaveProperty("hourCount");
    expect(h.send.mock.calls[1][0].content).toBe("How many cleaners would you like for your hourly cleaning?");
    expect(h.send.mock.calls[1][0].content).not.toContain("/book/"); expect(h.state().funnels).toHaveLength(1); expect(h.tasks()).toHaveLength(1);
    const cleaners = await h.turn("For this new hourly cleaning quote I want 2 cleaners; please send the link.", { maidCount: 2 });
    expect(cleaners.result).toEqual({ outcome: "accepted" });
    expect(h.send.mock.calls[2][0].content).toBe("How many hours would you like for your hourly cleaning?");
    expect(h.state().funnels).toHaveLength(1); expect(h.tasks()).toHaveLength(1);
    const complete = await h.turn("I want 4 hours for this new hourly cleaning quote; send its link.", { hourCount: 4 });
    expect(complete.result).toEqual({ outcome: "accepted" });
    const current = structuredClone(h.quote()!);
    expect(current.fields).toMatchObject({ pricingMode: "hourly", maidCount: 2, hourCount: 4, homeType: "House" });
    expect(current.evidence).toMatchObject({ pricingMode: { turnIndex: 2, quote: hourly.input.inboundText },
      maidCount: { turnIndex: 4, quote: cleaners.input.inboundText }, hourCount: { turnIndex: 6, quote: complete.input.inboundText } });
    expect(current.evidence).not.toHaveProperty("homeType");
    expect(h.state().funnels[1].priceSnapshot).toEqual(createPublicBookingPriceSnapshot({ ...pricing, pricingMode: "hourly", maidCount: 2, hourCount: 4 }));
    const repeated = await h.turn("Please repeat that exact new hourly quote link.", {});
    expect(repeated.result).toEqual({ outcome: "accepted" }); expect(h.quote()?.link).toEqual(current.link);
    expect(h.quote()?.fields).toEqual(current.fields); expect(h.quote()?.evidence).toEqual(current.evidence);
    expect(h.state().funnels).toHaveLength(2); expect(h.tasks()).toHaveLength(3); expect(h.send).toHaveBeenCalledTimes(5);
    for (const value of [hourly, cleaners, complete, repeated]) expectAcceptedHistory(h, value.input);
  });

  it.each(["en", "es"] as const)("corrects stale incomplete-link page prose during direct claim/prepare without generation in %s", async language => {
    const h = harness(), fixture = missingHomeFixture("deep", "hourly");
    delete fixture.fields.condition;
    const input = h.append(fixture.text.replace("condition 7, ", ""));
    const store = h.stores().taskStore, binding: CustomerSmsBinding = {
      sessionId: input.sessionId, providerMessageId: input.providerMessageId, fromPhone: PHONE,
      receivingPhoneNumberId: LINE, receivingPhoneNumber: BUSINESS, inboundText: input.inboundText,
      createdAt: NOW, receivedAt: input.receivedAt, customerName: NAME,
      historyHash: createHash("sha256").update(h.row().messageHistory).digest("hex"),
    };
    const claim = await store.claim(binding);
    expect(claim).not.toBeNull();
    const output = h.output(input, fixture.fields, "link"), rawPlan = {
      replyText: STALE_PAGE_RECAP, task: null,
      smsBookingQuote: { previous: null, update: output.bookingQuote, originalConversation: h.history(), quoteTextTemplate: null,
        ...(language === "es" ? { missingQuestionLanguage: "es" as const } : {}) },
    };
    const prepared = await store.prepare(claim!, rawPlan);
    expect(prepared).toEqual({ replyText: MISSING_CONDITION_QUESTION[language], task: null });
    expect(prepared!.replyText).not.toMatch(/complete your booking|booking (?:on|page)|completa.*reserva|https?:|\/book\/|\{\{/i);
    expect(h.quote()!.fields).toEqual({ ...fixture.fields, homeType: "House" });
    expect(h.quote()!.evidence).not.toHaveProperty("homeType"); expect(h.quote()!.fields).not.toHaveProperty("condition");
    expect(h.quote()).toMatchObject({ quoteId: input.providerMessageId, revision: 1, link: null });
    expect(h.state().funnels).toEqual([]); expect(h.tasks()).toEqual([]);
    expect(h.state().drafts[0]).toMatchObject({ status: "SENDING", generatedDraft: MISSING_CONDITION_QUESTION[language],
      approvedText: MISSING_CONDITION_QUESTION[language], capabilityResult: { phase: "submission_started", taskId: null } });
    expect(h.runner).not.toHaveBeenCalled(); expect(h.readKnowledge).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    const accepted = await h.send({ to: PHONE, fromNumberId: LINE, content: MISSING_CONDITION_QUESTION[language] });
    expect(accepted.success).toBe(true);
    expect(await store.recordAcceptance(claim!, accepted.messageId!)).toBe(true);
    expectAcceptedHistory(h, input);
    expect(h.state().funnels).toEqual([]); expect(h.tasks()).toEqual([]); expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.runner).not.toHaveBeenCalled();
  });

  it.each(["en", "es"] as const)("keeps %s when a complete link preference becomes past before durable preparation", async language => {
    const crossings = [
      { receivedAt: Date.parse("2026-11-17T18:00:00Z"), preparedAt: Date.parse("2026-11-17T18:01:00Z"), time: "13:00",
        question: { en: "What time would you prefer for your cleaning?", es: "¿Qué horario prefieres para tu limpieza?" } },
      { receivedAt: Date.parse("2026-11-18T04:59:00Z"), preparedAt: Date.parse("2026-11-18T05:00:00Z"), time: "23:59",
        question: { en: "Which upcoming date would you prefer for your cleaning?", es: "¿Qué próxima fecha prefieres para tu limpieza?" } },
    ];
    for (const crossing of crossings) {
      const h = harness(), fields = { ...fullFields, requestedLocalDate: "2026-11-17", requestedLocalTime: crossing.time };
      const input = h.append(`${FULL_TEXT} For this new quote use November 17 at ${crossing.time}.`);
      const binding: CustomerSmsBinding = { sessionId: input.sessionId, providerMessageId: input.providerMessageId,
        fromPhone: PHONE, receivingPhoneNumberId: LINE, receivingPhoneNumber: BUSINESS, inboundText: input.inboundText,
        createdAt: crossing.receivedAt, receivedAt: crossing.receivedAt, customerName: NAME,
        historyHash: createHash("sha256").update(h.row().messageHistory).digest("hex") };
      h.queue(h.output(input, fields, "link", { quotePresentationLanguage: language }));
      const generate = createSmsBookingQuoteReplyGenerator({ runner: h.runner, readKnowledge: h.readKnowledge,
        smsBookingQuote: { readState: async () => null } });
      const plan = await generate({ incomingMessage: input.inboundText,
        context: { binding, originalConversation: h.history(), receivingPhoneNumberId: LINE, receivingPhoneNumber: BUSINESS },
        protectedIds: [input.providerMessageId, LINE] });
      expect(plan.smsBookingQuote!.quoteTextTemplate).not.toBeNull();
      expect(plan.smsBookingQuote).not.toHaveProperty("missingQuestionLanguage");
      const store = createClaudeCustomerTasksStore(h.db, { preparePlan: createSmsBookingQuotePlanPreparer(h.stores().quoteStore, () => crossing.preparedAt) });
      const claim = await store.claim(binding); expect(claim).not.toBeNull();
      const prepared = await store.prepare(claim!, plan);
      expect(prepared).toEqual({ replyText: crossing.question[language], task: null });
      expect(h.state().drafts[0]).toMatchObject({ status: "SENDING", generatedDraft: crossing.question[language], approvedText: crossing.question[language] });
      expect(h.quote()).toMatchObject({ link: null, fields: { requestedLocalDate: "2026-11-17", requestedLocalTime: crossing.time } });
      expect(h.state().funnels).toEqual([]); expect(h.tasks()).toEqual([]);
      expect(h.runner).toHaveBeenCalledTimes(1); expect(h.send).not.toHaveBeenCalled();
    }
  });

  it("corrects pricing under the same quote id but creates a replacement personalized link only on a later explicit link request", async () => {
    const h = harness(); expect((await h.turn()).result.outcome).toBe("accepted");
    const initial = structuredClone(h.quote()!), oldToken = initial.link!.token;
    const correction = await h.turn("Correction: it is 4 bedrooms. Please show the revised quote.", { bedrooms: 4 }, "quote", { quoteTextTemplate: QUOTE_TEMPLATE });
    expect(correction.result.outcome).toBe("accepted"); expect(h.state().funnels).toHaveLength(1);
    expect(h.quote()).toMatchObject({ quoteId: initial.quoteId, fields: { bedrooms: 4 }, link: null });
    expect(h.tasks()).toHaveLength(1);
    const changed = { ...pricing, bedrooms: 4 }, expected = previewCallBookingQuote({ pricing: changed, extrasConfirmed: true });
    if (!expected.success) throw Error("Corrected fixture must preview successfully");
    expect(expected.firstCleaningTotalCents).not.toBe(initial.link!.firstCleaningTotalCents);
    expect(h.send.mock.calls[1][0].content).toContain(expected.priceFormatted); expect(h.send.mock.calls[1][0].content).not.toContain("/book/");
    expect((await h.turn("Please send the revised booking link now.", {}, "link")).result.outcome).toBe("accepted");
    expect(h.state().funnels).toHaveLength(2); expect(h.quote()?.quoteId).toBe(initial.quoteId);
    expect(h.quote()?.link?.token).not.toBe(oldToken); expect(h.state().funnels[0].publicFunnelNumber).toBe(oldToken);
    expect(h.state().funnels[1].priceSnapshot).toEqual(createPublicBookingPriceSnapshot(changed));
  });

  it("does not append qualification-only follow-up tasks when collect or quote actions retain an already durable current link", async () => {
    const h = harness(); await h.turn(); const original = structuredClone(h.quote()!.link!);
    const collected = await h.turn("For that new quote, what remains to review?", {}, "collect", { replyText: "You can review the details on the booking page." });
    expect(collected.result.outcome).toBe("accepted"); expect(h.quote()?.link).toEqual(original);
    expect(h.tasks()).toHaveLength(1); expect(h.send.mock.calls[1][0].content).not.toContain("/book/");
    const quoted = await h.turn("Please show the price details for that same new quote.", {}, "quote");
    expect(quoted.result.outcome).toBe("accepted"); expect(h.quote()?.link).toEqual(original);
    expect(h.tasks()).toHaveLength(1); expect(h.state().funnels).toHaveLength(1);
    expect(h.send.mock.calls[2][0].content).not.toContain("/book/");
  });

  it("reuses one saved personalized link for a distinct explicit message repeating the same quote and blocks repeated delivery of its original provider id", async () => {
    const h = harness(), first = await h.turn(); expect(first.result.outcome).toBe("accepted");
    const before = structuredClone(h.state()), count = h.runner.mock.calls.length;
    expect(["excluded", "duplicate"]).toContain((await h.run(first.input)).outcome);
    expect(h.state()).toEqual(before); expect(h.runner).toHaveBeenCalledTimes(count); expect(h.send).toHaveBeenCalledTimes(1);
    const repeated = await h.turn("Please send that exact same new cleaning quote link again.", {}, "link");
    expect(repeated.result).toEqual({ outcome: "accepted" }); expect(h.state().funnels).toHaveLength(1);
    expect(h.quote()?.link).toEqual(JSON.parse(before.cards.find(row => row.quickAction === SMS_BOOKING_QUOTE_ACTION)!.metadata).state.link);
    expect(h.send).toHaveBeenCalledTimes(2); expect(h.runner).toHaveBeenCalledTimes(2); expectAcceptedHistory(h, repeated.input);
    expect(h.send.mock.calls[1][0].content).toContain(h.state().funnels[0].publicFunnelNumber);
    expect(h.tasks()).toHaveLength(2);
    expect(h.tasks().map(task => task.sourceMessageId)).toEqual([first.input.providerMessageId, repeated.input.providerMessageId]);
    expect(h.tasks()[1]).toMatchObject({ title: FOLLOWUP_TITLE, items: [{ title: FOLLOWUP_ITEM, evidenceQuote: repeated.input.inboundText }] });
  });

  it.each([false, true])("reuses the exact original A link after A → B → A with reuseFactories=%s and only two canonical funnel rows", async reuseFactories => {
    const h = harness(reuseFactories), first = await h.turn();
    expect(first.result.outcome).toBe("accepted");
    const original = structuredClone(h.quote()!), originalLink = original.link!;
    const second = await h.turn("For this new cleaning quote use 4 bedrooms and send the revised link.", { bedrooms: 4 }, "link");
    expect(second.result.outcome).toBe("accepted"); expect(h.quote()?.link?.token).not.toBe(originalLink.token);
    const third = await h.turn("Actually use the original 3 bedrooms and send that new cleaning quote link.", { bedrooms: 3 }, "link");
    expect(third.result.outcome).toBe("accepted");
    expect(h.quote()).toMatchObject({ quoteId: original.quoteId, revision: 3, fields: { bedrooms: 3 }, link: originalLink });
    expect(h.state().funnels).toHaveLength(2); expect(h.quoteRows()).toHaveLength(1);
    expect(h.state().funnels.map(row => row.publicFunnelNumber)).toContain(originalLink.token);
    const envelope = JSON.parse(h.quoteRows()[0].metadata);
    expect(envelope.quotes).toHaveLength(2);
    expect(envelope.quotes.map((saved: Row) => saved.input.pricing.bedrooms)).toEqual([3, 4]);
    expect(envelope.quotes.every((saved: Row) => saved.quoteId === original.quoteId)).toBe(true);
    expect(h.send.mock.calls[2][0].content).toContain(`${SMS_QUOTE_BOOKING_ORIGIN}${originalLink.urlPath}`);
    expect(h.tasks()).toHaveLength(3); expect(h.state().drafts).toHaveLength(3);
    for (const turn of [first, second, third]) expectAcceptedHistory(h, turn.input);
    for (const [options] of h.runner.mock.calls) {
      const context = JSON.parse(options.userPrompt).context.smsBookingQuote;
      expect(context).not.toHaveProperty("quotes");
      if (context.state) { expect(context.state).not.toHaveProperty("quotes"); expect(context.state).not.toHaveProperty("input"); }
    }
    const before = structuredClone(h.state());
    expect(["excluded", "duplicate"]).toContain((await h.run(third.input)).outcome);
    expect(h.state()).toEqual(before); expect(h.send).toHaveBeenCalledTimes(3); expect(h.runner).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])("reuses the exact default House link after an evidenced Apartment correction then House return with reuseFactories=%s", async reuseFactories => {
    const h = harness(reuseFactories), fixture = missingHomeFixture("deep", "home");
    delete fixture.fields.pricingMode; delete fixture.fields.maidCount; delete fixture.fields.hourCount;
    const first = await h.turn(fixture.text.replace("deep home", "deep"), fixture.fields);
    expect(first.result).toEqual({ outcome: "accepted" });
    const original = structuredClone(h.quote()!), originalContent = h.send.mock.calls[0][0].content;
    expect(original.fields).toMatchObject({ pricingMode: "home", homeType: "House" });
    expect(original.evidence).not.toHaveProperty("homeType"); expect(original.evidence).not.toHaveProperty("pricingMode");
    const correction = await h.turn("Correction: it is an Apartment. Send the revised new cleaning quote link.", { homeType: "Apartment" });
    expect(correction.result).toEqual({ outcome: "accepted" }); expect(h.quote()?.link?.token).not.toBe(original.link!.token);
    expect(h.quote()?.evidence.homeType).toEqual({ turnIndex: 2, quote: correction.input.inboundText });
    const returned = await h.turn("Actually it is a House. Please send that original new cleaning quote link.", { homeType: "House" });
    expect(returned.result).toEqual({ outcome: "accepted" });
    expect(h.quote()).toMatchObject({ quoteId: original.quoteId, revision: 3, fields: original.fields, link: original.link });
    expect(h.quote()?.evidence.homeType).toEqual({ turnIndex: 4, quote: returned.input.inboundText });
    expect(h.quote()?.evidence).not.toHaveProperty("pricingMode");
    expect(h.state().funnels).toHaveLength(2); expect(h.quoteRows()).toHaveLength(1);
    expect(h.state().funnels.map(row => row.priceSnapshot.input.homeType)).toEqual(["House", "Apartment"]);
    const saved = JSON.parse(h.quoteRows()[0].metadata).quotes;
    expect(saved).toHaveLength(2); expect(saved.map((row: Row) => row.input.pricing.homeType)).toEqual(["House", "Apartment"]);
    expect(saved.every((row: Row) => row.quoteId === original.quoteId)).toBe(true);
    expect(h.send.mock.calls[2][0].content).toBe(originalContent);
    expect(h.tasks()).toHaveLength(3); expect(h.state().drafts).toHaveLength(3);
    for (const value of [first, correction, returned]) expectAcceptedHistory(h, value.input);
    const before = structuredClone(h.state());
    expect(["excluded", "duplicate"]).toContain((await h.run(returned.input)).outcome);
    expect(h.state()).toEqual(before); expect(h.send).toHaveBeenCalledTimes(3); expect(h.runner).toHaveBeenCalledTimes(3);
  });

  it("normalizes name spacing, email case, note whitespace and extras order when returning to an earlier exact input without factory resets", async () => {
    const h = harness(true), extras = [{ id: "inside-oven", quantity: 1 }, { id: "inside-fridge", quantity: 1 }];
    const fields = { ...fullFields, customerName: "María  García", customerEmail: "Maya@Example.com", notes: ["  use side entrance  "], extras };
    const text = FULL_TEXT.replace("no extras confirmed", "one Inside Oven and one Inside Fridge, extras confirmed")
      + " My email is Maya@Example.com; use side entrance.";
    expect((await h.turn(text, fields)).result.outcome).toBe("accepted");
    const original = structuredClone(h.quote()!);
    expect((await h.turn("Use 4 bedrooms for this new quote and send the link.", { bedrooms: 4 })).result.outcome).toBe("accepted");
    expect((await h.turn("Return to 3 bedrooms, María García, maya@example.com, use side entrance; one Inside Fridge and one Inside Oven confirmed. Please send the new quote link.", {
      bedrooms: 3, customerName: NAME, customerEmail: "maya@example.com", notes: ["use side entrance"], extras: [...extras].reverse(), extrasConfirmed: true,
    })).result.outcome).toBe("accepted");
    expect(h.quote()?.quoteId).toBe(original.quoteId); expect(h.quote()?.link).toEqual(original.link);
    expect(h.state().funnels).toHaveLength(2);
    const saved = JSON.parse(h.quoteRows()[0].metadata).quotes;
    expect(saved).toHaveLength(2);
    expect(saved[0].input).toMatchObject({ customerName: NAME, customerEmail: "maya@example.com", notes: ["use side entrance"],
      pricing: { bedrooms: 3, extras: [...extras].reverse() } });
    expect(h.send.mock.calls[2][0].content).toContain(original.link!.token);
  });

  it("seeds a legacy current state without receipt history before a correction so the original link remains reusable", async () => {
    const h = harness(); expect((await h.turn()).result.outcome).toBe("accepted");
    const original = structuredClone(h.quote()!), card = h.quoteRows()[0], envelope = JSON.parse(card.metadata);
    delete envelope.quotes; card.metadata = JSON.stringify(envelope);
    expect((await h.turn("Please use 4 bedrooms for this new quote and send its link.", { bedrooms: 4 })).result.outcome).toBe("accepted");
    expect((await h.turn("Return to 3 bedrooms for the new quote and send that link.", { bedrooms: 3 })).result.outcome).toBe("accepted");
    expect(h.quote()?.link).toEqual(original.link); expect(h.state().funnels).toHaveLength(2);
    const saved = JSON.parse(h.quoteRows()[0].metadata).quotes;
    expect(saved).toHaveLength(2); expect(saved[0]).toMatchObject({ quoteId: original.quoteId, link: original.link });
    expect(h.send.mock.calls[2][0].content).toContain(original.link!.token);
  });

  it.each(["fingerprint", "input", "quote-id", "customer-phone", "url-path", "price"])("rejects a tampered historical %s receipt before generation, persistence or another send", async corruption => {
    const h = harness(); await h.turn();
    await h.turn("Use 4 bedrooms for this new quote and send the revised link.", { bedrooms: 4 });
    const card = h.quoteRows()[0], envelope = JSON.parse(card.metadata);
    expect(envelope.quotes).toHaveLength(2);
    const historical = envelope.quotes[0]; expect(historical.input.pricing.bedrooms).toBe(3);
    expect(envelope.state.fields.bedrooms).toBe(4);
    if (corruption === "fingerprint") historical.link.fingerprint = "0".repeat(64);
    if (corruption === "input") historical.input.pricing.bedrooms = 5;
    if (corruption === "quote-id") historical.quoteId = "a-different-quote-id";
    if (corruption === "customer-phone") historical.input.customerPhone = "+17035559876";
    if (corruption === "url-path") historical.link.urlPath = "https://attacker.example.test/book/untrusted";
    if (corruption === "price") historical.link.firstCleaningTotalCents += 1;
    card.metadata = JSON.stringify(envelope);
    const before = structuredClone({ cards: h.state().cards, funnels: h.state().funnels }), input = h.append("Return to 3 bedrooms and send my new quote link.");
    h.queue(h.output(input, { bedrooms: 3 }));
    expect(await h.run(input)).toEqual({ outcome: "failed" });
    expect(h.state().cards).toEqual(before.cards); expect(h.state().funnels).toEqual(before.funnels);
    expect(h.runner).toHaveBeenCalledTimes(2); expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.state().drafts.at(-1)).toMatchObject({ status: "DISMISSED", errorCode: "GENERATION_OR_PERSISTENCE_FAILED" });
    expect(h.history().filter(turn => turn.role === "assistant")).toHaveLength(2);
  });

  it("a simultaneous repeated provider delivery can generate, create a link and submit only once even across fresh factories", async () => {
    const h = harness(), input = h.append(FULL_TEXT); h.queue(h.output(input, fullFields));
    const results = await Promise.all([h.run(input), h.run(input), h.run(input)]);
    expect(results.filter(result => result.outcome === "accepted")).toHaveLength(1);
    expect(results.filter(result => result.outcome === "duplicate")).toHaveLength(2);
    expect(h.state().drafts).toHaveLength(1); expect(h.state().funnels).toHaveLength(1); expect(h.quoteRows()).toHaveLength(1);
    expect(h.tasks()).toHaveLength(1);
    expect(h.runner).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("starts a distinct quote only when the current customer explicitly asks to restart a new booking", async () => {
    const h = harness(true); await h.turn(); const old = structuredClone(h.quote()!);
    const input = h.append(`Start a distinct new booking quote, not the previous one. ${FULL_TEXT}`), output = h.output(input, fullFields);
    Object.assign(output.bookingQuote, { restart: true }); h.queue(output);
    expect(await h.run(input)).toEqual({ outcome: "accepted" }); expect(h.state().funnels).toHaveLength(2);
    expect(h.quote()?.quoteId).toBe(input.providerMessageId); expect(h.quote()?.quoteId).not.toBe(old.quoteId);
    expect(h.quote()?.link?.token).not.toBe(old.link?.token);
    const restarted = structuredClone(h.quote()!);
    expect((await h.turn("Please repeat this distinct new quote link.", {})).result.outcome).toBe("accepted");
    expect(h.quote()?.quoteId).toBe(restarted.quoteId); expect(h.quote()?.link).toEqual(restarted.link);
    expect(h.state().funnels).toHaveLength(2);
    expect(JSON.parse(h.quoteRows()[0].metadata).quotes.map((saved: Row) => saved.quoteId)).toEqual([old.quoteId, restarted.quoteId]);
    expect(h.send.mock.calls[2][0].content).toContain(restarted.link!.token);
    expect(h.send.mock.calls[2][0].content).not.toContain(old.link!.token);
  });

  it("isolates same-customer quote state by receiving line and session without importing another quote's fields", async () => {
    const h = harness(); await h.turn(); const original = structuredClone(h.quote()!);
    h.addSession(8, LINE_TWO); h.addSession(9, LINE);
    expect((await h.turn("I would like a new cleaning quote.", { serviceId: "standard" }, "collect", { replyText: "How many bedrooms and bathrooms should this quote use?" }, 8)).result.outcome).toBe("accepted");
    expect(h.quote(8, LINE_TWO)).toMatchObject({ fields: { customerName: NAME, serviceId: "standard" }, link: null });
    expect(h.quote(8, LINE_TWO)?.fields).not.toHaveProperty("address"); expect(h.quote(8, LINE_TWO)?.fields).not.toHaveProperty("extras");
    expect((await h.turn("I need a separate new quote.", {}, "collect", { replyText: "What cleaning service would you like?" }, 9)).result.outcome).toBe("accepted");
    expect(h.quote(9)?.fields).not.toHaveProperty("bedrooms");
    // Same session, different line is also a distinct key; old-turn metadata is not borrowed.
    expect((await h.turn("A new quote on this line please.", {}, "collect", { replyText: "What cleaning service would you like?" }, 7, LINE_TWO)).result.outcome).toBe("accepted");
    expect(h.quote(7, LINE_TWO)?.fields).not.toHaveProperty("address"); expect(h.quote(7, LINE)).toEqual(original);
    expect(h.quoteRows()).toHaveLength(4); expect(h.state().funnels).toHaveLength(1);
    expect(h.send.mock.calls.at(-1)?.[0]).toMatchObject({ to: PHONE, fromNumberId: LINE_TWO });
  });

  it("does not reuse a saved receipt for identical quote inputs on another receiving line, session or customer phone", async () => {
    const h = harness(true); expect((await h.turn()).result.outcome).toBe("accepted");
    const original = structuredClone(h.quote()!);
    expect((await h.turn(FULL_TEXT, fullFields, "link", {}, 7, LINE_TWO)).result.outcome).toBe("accepted");
    h.addSession(8); expect((await h.turn(FULL_TEXT, fullFields, "link", {}, 8)).result.outcome).toBe("accepted");
    h.row(7).leadPhone = "+17035559876";
    expect((await h.turn(FULL_TEXT, fullFields, "link", {}, 7, LINE)).result.outcome).toBe("accepted");
    expect(h.state().funnels).toHaveLength(4); expect(h.quoteRows()).toHaveLength(4);
    expect(new Set(h.state().funnels.map(row => row.publicFunnelNumber)).size).toBe(4);
    expect(h.state().funnels.at(-1)).toMatchObject({ customerPhone: "+17035559876" });
    const savedOriginal = h.quoteRows().map(row => JSON.parse(row.metadata).state).find(state =>
      state.sessionId === 7 && state.customerPhone === PHONE && state.receivingPhoneNumberId === LINE);
    expect(savedOriginal).toEqual(original);
  });

  it.each([3, 0])("sends the exact server-owned requested-date/time summary for %s bedrooms with all canonical extras and a single actual link/CTA", async bedrooms => {
    const h = harness(), extras = [{ id: "inside-oven", quantity: 1 }, { id: "inside-fridge", quantity: 2 }];
    const fields = { ...fullFields, bedrooms, recurrence: "weekly" as const, extras };
    const text = FULL_TEXT.replace("3 bedrooms", bedrooms === 0 ? "a studio" : "3 bedrooms").replace("biweekly", "weekly")
      .replace("no extras confirmed", "one Inside Oven and two Inside Fridge, extras confirmed");
    const value = await h.turn(text, fields, "link", {
      replyText: "Thanks, María. This is for 3 bedrooms and 2 bathrooms. Your requested time is 10:30 am.",
      quoteTextTemplate: LINK_TEMPLATE,
    });
    expect(value.result).toEqual({ outcome: "accepted" });
    expect(h.state().funnels).toHaveLength(1);
    const snapshot = createPublicBookingPriceSnapshot({ ...pricing, bedrooms, recurrence: "weekly", extras: [...extras].sort((a, b) => a.id.localeCompare(b.id)) });
    const preview = previewCallBookingQuote({ pricing: { ...pricing, bedrooms, recurrence: "weekly", extras }, extrasConfirmed: true });
    if (!preview.success) throw Error("Expected canonical complete SMS summary fixture");
    const url = `${SMS_QUOTE_BOOKING_ORIGIN}${h.quote()!.link!.urlPath}`, content = h.send.mock.calls[0][0].content;
    expect(content).toBe("Your cleaning is ready to schedule. Here are the details:\n\n"
      + "📅 Requested date: Friday, November 20\n⏰ Requested time: 10:30 AM\n"
      + `📍 Address: ${ADDRESS}\n🧹 Service: ${snapshot.serviceName}\n`
      + `🛏️ Home size: ${bedrooms === 0 ? "Studio" : "3 bed"} / 2 bath\n💵 Total: ${preview.priceFormatted}`
      + `\nYour weekly follow-up cleaning price is ${preview.futureVisitPriceFormatted}.`
      + "\nExtras:\n2 × Inside Fridge\nInside Oven\n\nBefore we arrive:\n"
      + "Please clear personal items off counters and floors\nLet us know about pets or any entry instructions 🧼\n\n"
      + "Last step to complete your booking: 👇\nWe’ve added your info to this quick link, so you can finish in about 60 seconds ⏱️\n"
      + `🔗 ${url}`);
    expect(content.match(/https?:\/\/[^\s]+/g)).toEqual([url]);
    expect(content.split("Last step to complete your booking:")).toHaveLength(2);
    expect(content).not.toMatch(/arrival window|November 17|2026-11-17|13:00|House|Apartment|townhome|condo|reserved|confirmed|guaranteed|available/i);
    expect(h.state().funnels[0]).toMatchObject({ requestedLocalDate: "2026-11-20", requestedLocalTime: "10:30", priceSnapshot: snapshot });
    expect(h.state().funnels[0].priceSnapshot.input).not.toHaveProperty("arrivalPreference");
    expect(h.send).toHaveBeenCalledTimes(1); expect(h.tasks()).toHaveLength(1);
    expectAcceptedHistory(h, value.input);
  });

  it.each([
    { label: "sparse recurring", recurrence: "biweekly" as const, extras: [], template: "First cleaning: {{firstCleaningPrice}}." },
    { label: "omitted selected extras", recurrence: "biweekly" as const, extras: [{ id: "inside-fridge", quantity: 1 }], template: "First cleaning: {{firstCleaningPrice}}." },
    { label: "misplaced future price", recurrence: "weekly" as const, extras: [], template: "First cleaning: {{firstCleaningPrice}}. Weekly future visits: {{firstCleaningPrice}}. {{extras}}." },
  ])("corrects a valid $label template into complete server-owned price/extras/future facts rather than rejecting or forwarding it", async ({ recurrence, extras, template }) => {
    for (const action of ["quote", "link"] as const) {
      const h = harness(), fields = { ...fullFields, recurrence, extras };
      const text = FULL_TEXT.replace("biweekly", recurrence).replace("no extras confirmed", extras.length ? "one Inside Fridge, extras confirmed" : "no extras confirmed");
      const value = await h.turn(text, fields, action, { quoteTextTemplate: template + (action === "link" ? " Review: {{bookingLink}}." : "") });
      expect(value.result).toEqual({ outcome: "accepted" });
      const preview = previewCallBookingQuote({ pricing: { ...pricing, recurrence, extras }, extrasConfirmed: true });
      if (!preview.success) throw Error("Expected canonical parity fixture");
      const content = h.send.mock.calls[0][0].content;
      expect(preview.futureVisitPriceFormatted).not.toBe(preview.priceFormatted);
      expect(content).toContain(action === "link" ? `💵 Total: ${preview.priceFormatted}` : `Your first-cleaning quote is ${preview.priceFormatted}.`);
      expect(content).toMatch(new RegExp(`Your ${recurrence} (?:follow-up cleaning|future-visit) price is \\$${preview.futureVisitTotalCents! / 100}\\.`));
      expect(content.split(preview.priceFormatted)).toHaveLength(2);
      expect(content.split(preview.futureVisitPriceFormatted!)).toHaveLength(2);
      expect(content).toContain(extras.length ? "Inside Fridge" : "No add-ons selected");
      expect(content).not.toMatch(/\{\{|Weekly future visits:/);
      expect(h.state().funnels).toHaveLength(action === "link" ? 1 : 0);
      expect(h.tasks()).toHaveLength(action === "link" ? 1 : 0);
      if (action === "link") expect(content).toContain(`${SMS_QUOTE_BOOKING_ORIGIN}${h.quote()!.link!.urlPath}`);
      else expect(content).not.toContain("/book/");
      expectAcceptedHistory(h, value.input);
    }
  });

  it.each(["quote", "link"] as const)("accepts a legitimate Maya Pounds acknowledgement without mistaking the surname for a price for %s", async action => {
    const h = harness(), name = "Maya Pounds", replyText = "Thanks, Maya Pounds. Here are the details for your review.";
    h.row().customerName = name;
    const value = await h.turn(FULL_TEXT.replace(NAME, name), { ...fullFields, customerName: name }, action, { replyText });
    expect(value.result).toEqual({ outcome: "accepted" }); expect(h.send).toHaveBeenCalledTimes(1);
    if (action === "quote") expect(h.send.mock.calls[0][0].content).toContain(replyText);
    else expect(h.send.mock.calls[0][0].content).not.toContain(replyText);
    expect(h.quote()?.fields.customerName).toBe(name); expect(h.state().funnels).toHaveLength(action === "link" ? 1 : 0);
    if (action === "link") expect(h.state().funnels[0].customerName).toBe(name);
    expect(h.tasks()).toHaveLength(action === "link" ? 1 : 0);
    expectAcceptedHistory(h, value.input);
  });

  it.each(["complete", "sparse legacy"])("does not mistake volunteered email in conversational text for a fabricated URL with a %s template", async style => {
    const h = harness(), email = "maya@example.com";
    const patch = { replyText: `Thanks, María. Your email is ${email}.`, quoteTextTemplate: style === "complete" ? LINK_TEMPLATE
      : "First cleaning: {{firstCleaningPrice}}. Review and complete booking here: {{bookingLink}}." };
    const value = await h.turn(`${FULL_TEXT} My email is ${email}.`, { ...fullFields, customerEmail: email }, "link", patch);
    expect(value.result).toEqual({ outcome: "accepted" });
    expect(h.quote()?.fields.customerEmail).toBe(email);
    expect(h.send.mock.calls[0][0].content).not.toContain(patch.replyText);
    expect(h.state().funnels).toHaveLength(1);
    expect(h.state().funnels[0].customerEmail).toBe(email);
    expectAcceptedHistory(h, value.input);
  });

  it("rejects a duplicate link placeholder before attempting quote-state or funnel persistence", async () => {
    const h = harness();
    const value = await h.turn(FULL_TEXT, fullFields, "link", {
      quoteTextTemplate: "First cleaning: {{firstCleaningPrice}}. Review: {{bookingLink}}. Again: {{bookingLink}}.",
    });
    expect(value.result).toEqual({ outcome: "failed" });
    expect(h.writes.some(write => write.table === "booking_funnel_records" || write.table === "ops_chat_messages")).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("uses a Spanish server-owned summary with complete canonical facts instead of the model acknowledgement without a legacy template", async () => {
    const h = harness(), fields = { ...fullFields, extras: [{ id: "inside-fridge", quantity: 2 }] };
    const text = `Quiero el enlace para una limpieza nueva. Soy ${NAME}, ${ADDRESS}, el veinte de noviembre a las diez y media, limpieza profunda, casa, tres dormitorios, dos baños, condición cinco, cada dos semanas, dos interiores de refrigerador confirmados.`;
    const value = await h.turn(text, fields, "link", { replyText: "Gracias, María. Revisa los detalles antes de completar la reserva.", quotePresentationLanguage: "es" });
    expect(value.result.outcome).toBe("accepted");
    const content = h.send.mock.calls[0][0].content, preview = previewCallBookingQuote({ pricing: { ...pricing, extras: fields.extras }, extrasConfirmed: true });
    if (!preview.success) throw Error("Expected canonical Spanish fixture");
    expect(content).toContain(`💵 Total: ${preview.priceFormatted}`);
    expect(content).toContain(`Próximas visitas (cada dos semanas): ${preview.futureVisitPriceFormatted}.`);
    expect(content).toContain("2 × Interior del refrigerador"); expect(content).not.toContain("No se seleccionaron");
    expect(content).toMatch(/^Tu limpieza está lista para agendar\. Estos son los detalles:\n\n/);
    expect(content).toContain(`📍 Dirección: ${ADDRESS}\n🧹 Servicio: Deep Cleaning\n🛏️ Tamaño: 3 habitaciones / 2 baños`);
    expect(content).toContain("📅 Fecha solicitada: viernes, 20 de noviembre");
    expect(content).toContain("⏰ Hora solicitada: 10:30 a.m.");
    expect(content).toContain("Antes de nuestra llegada:\nRetira los objetos personales de las superficies y los pisos\nAvísanos si hay mascotas o instrucciones de acceso 🧼");
    expect(content).toContain("Agregamos tus datos a este enlace rápido para que puedas terminar en unos 60 segundos ⏱️");
    expect(content).not.toMatch(/Gracias, María|Your first-cleaning|casa|apartamento|condominio|ventana de llegada|confirmada|reservada|disponibilidad garantizada/i);
    expect(content.split(`${SMS_QUOTE_BOOKING_ORIGIN}${h.quote()!.link!.urlPath}`)).toHaveLength(2);
    expect(content.match(/https?:\/\/[^\s]+/g)).toEqual([`${SMS_QUOTE_BOOKING_ORIGIN}${h.quote()!.link!.urlPath}`]);
    expect(content.split("Último paso para completar tu reserva:")).toHaveLength(2);
    expectAcceptedHistory(h, value.input);
  });

  it("renders Spanish server placeholders with distinct recurring prices and the exact durable URL, never timestamps or a fake confirmation", async () => {
    const h = harness(), text = `Quiero el enlace para una limpieza nueva. Soy ${NAME}, ${ADDRESS}, el veinte de noviembre a las diez y media, limpieza profunda, casa, tres dormitorios, dos baños, condición cinco, cada dos semanas, sin extras.`;
    const value = await h.turn(text, fullFields, "link", { replyText: "Gracias, María. Revisa tu cotización y completa la reserva en la página.",
      quoteTextTemplate: "Primera limpieza: {{firstCleaningPrice}}. Próximas visitas: {{futureVisitPrice}}. Extras: {{extras}}. Revisa y completa tu reserva: {{bookingLink}}. Esta cotización no es una reserva confirmada." });
    expect(value.result.outcome).toBe("accepted"); const content = h.send.mock.calls[0][0].content;
    expect(content).toMatch(/^Tu limpieza está lista para agendar\. Estos son los detalles:/);
    expect(content).not.toContain("Gracias, María"); expect(content).toContain("Próximas visitas");
    const preview = previewCallBookingQuote({ pricing, extrasConfirmed: true }); if (!preview.success) throw Error("Expected canonical quote");
    expect(content).toContain(preview.priceFormatted); expect(content).toContain(preview.futureVisitPriceFormatted!);
    expect(content).toContain(`${SMS_QUOTE_BOOKING_ORIGIN}${h.quote()?.link?.urlPath}`); expect(content).not.toMatch(/\{\{|2026-11-17T|18:00:00|PN-synthetic|synthetic-inbound|pago completado|tu reserva está confirmada/i);
    expectAcceptedHistory(h, value.input);
  });
});

describe("SMS booking quote original intake gates, atomic rollback and submission uncertainty", () => {
  it.each(["new-inbound", "human-reply", "global-optout", "session-optout", "line-changed", "phone-changed", "source-history", "config-changed"])("rejects %s changed during generation with no quote, link, task or provider submission", async change => {
    const h = harness(), input = h.append(FULL_TEXT); h.queue(h.output(input, fullFields));
    h.afterModel(() => {
      if (change === "new-inbound") h.append("A newer inbound message, please wait.");
      if (change === "human-reply") h.row().messageHistory = JSON.stringify([...h.history(), { role: "assistant", content: "A human has replied.", opMsgId: "human-outbound" }]);
      if (change === "global-optout") h.state().optouts.push({ id: 1, phone: PHONE });
      if (change === "session-optout") h.row().smsOptOut = 1;
      if (change === "line-changed") h.row().lastInboundPhoneNumberId = LINE_TWO;
      if (change === "phone-changed") h.row().leadPhone = "+17035559876";
      if (change === "source-history") h.row().messageHistory = h.row().messageHistory.replace("3 bedrooms", "4 bedrooms");
      if (change === "config-changed") h.changeConfig({ ...h.config(), startAt: NOW - 2 });
    });
    expect(await h.run(input)).toEqual({ outcome: "suppressed" });
    expect(h.state().drafts[0].status).toBe("DISMISSED"); expect(h.state().funnels).toEqual([]); expect(h.state().cards).toEqual([]); expect(h.send).not.toHaveBeenCalled();
  });

  it.each(["STOP", " stop ", "unsubscribe"])("excludes exact opt-out %j before any generation, receipt or quote state writes", async text => {
    const h = harness(), input = h.append(text);
    expect(await h.run(input)).toEqual({ outcome: "excluded" }); expect(h.runner).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    expect(h.state().drafts).toEqual([]); expect(h.state().cards).toEqual([]); expect(h.state().funnels).toEqual([]);
  });

  it("global exact-phone opt-out prevents claiming/generation even if the saved session still says opted in", async () => {
    const h = harness(), input = h.append(FULL_TEXT); h.state().optouts.push({ id: 1, phone: PHONE }); h.queue(h.output(input, fullFields));
    expect(await h.run(input)).toEqual({ outcome: "failed" }); expect(h.state().drafts).toEqual([]); expect(h.runner).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled(); expect(h.quoteRows()).toEqual([]);
  });

  it.each(["customerPhone", "fromNumberId", "url", "price", "customPriceCents"])("rejects model-owned %s without creating quote/link/task/sender effects", async key => {
    const h = harness(), input = h.append(FULL_TEXT), output = h.output(input, fullFields); (output.bookingQuote.fields as Row)[key] = "untrusted"; h.queue(output);
    expect(await h.run(input)).toEqual({ outcome: "failed" }); expect(h.send).not.toHaveBeenCalled(); expect(h.state().cards).toEqual([]); expect(h.state().funnels).toEqual([]);
  });

  it.each([
    ["generated price", { replyText: "Your quote is $1." }],
    ["numeric currency words", { replyText: "Your first cleaning costs 383 dollars." }],
    ["spelled currency words", { replyText: "Your first cleaning costs three hundred dollars." }],
    ["qualified numeric currency words", { replyText: "The first visit will be 250 US dollars." }],
    ["currency before numeric amount", { replyText: "The first visit will be dollars 250." }],
    ["currency code", { replyText: "Your first cleaning costs USD 383." }],
    ["generated URL", { replyText: "Review your quote at https://attacker.example.test/book/untrusted" }],
    ["booking confirmation", { replyText: "Your booking is confirmed." }],
    ["reservation confirmation", { replyText: "Your reservation is reserved." }],
    ["payment completion", { replyText: "We have processed your payment." }],
    ["Spanish fake confirmation", { replyText: "Tu reserva está confirmada." }],
    ["template price", { quoteTextTemplate: "Your quote is $1. {{firstCleaningPrice}} {{bookingLink}}" }],
    ["template numeric currency words", { quoteTextTemplate: "Your first cleaning costs 383 dollars. {{firstCleaningPrice}} {{bookingLink}}" }],
    ["template qualified numeric currency words", { quoteTextTemplate: "The first visit will be 250 US dollars. {{firstCleaningPrice}} {{bookingLink}}" }],
    ["template currency before amount", { quoteTextTemplate: "The first visit will be dollars 250. {{firstCleaningPrice}} {{bookingLink}}" }],
    ["template attacker URL", { quoteTextTemplate: "Your quote: {{firstCleaningPrice}} https://attacker.example.test {{bookingLink}}" }],
    ["template fake confirmation", { quoteTextTemplate: "Your booking is confirmed. {{firstCleaningPrice}} {{bookingLink}}" }],
    ["unknown template placeholder", { quoteTextTemplate: "{{firstCleaningPrice}} {{bookingLink}} {{customPrice}}" }],
  ])("rejects active %s rather than trusting the model with prices, links or completed-business claims", async (_label, patch) => {
    const h = harness(), input = h.append(FULL_TEXT); h.queue(h.output(input, fullFields, "link", patch as Row));
    expect(await h.run(input)).toEqual({ outcome: "failed" });
    expect(h.state().cards).toEqual([]); expect(h.state().funnels).toEqual([]); expect(h.send).not.toHaveBeenCalled();
  });

  it("does not make an incomplete link request bookable or invent extras while their selection is still unknown", async () => {
    const h = harness(), fields = structuredClone(fullFields); delete fields.extras; delete fields.extrasConfirmed;
    const first = await h.turn(FULL_TEXT.replace(", no extras confirmed", ""), fields, "link", { replyText: "Would you like any add-ons, or no extras?" });
    expect(first.result.outcome).toBe("accepted"); expect(h.quote()?.fields).not.toHaveProperty("extras"); expect(h.quote()?.link).toBeNull();
    expect(h.tasks()).toEqual([]);
    expect(h.state().funnels).toEqual([]); expect(h.send.mock.calls[0][0].content).not.toMatch(/\$|\/book\//);
  });

  it.each(["assistant-evidence", "nonliteral-evidence", "wrong-turn-phone", "wrong-turn-session", "wrong-turn-line", "historical-intent"])("rejects %s in the actual generator/qualification chain", async corruption => {
    const h = harness();
    h.row().messageHistory = JSON.stringify([{ role: "assistant", content: FULL_TEXT, opMsgId: "historical-assistant" }]);
    const input = h.append(FULL_TEXT), output = h.output(input, fullFields);
    if (corruption === "assistant-evidence") output.bookingQuote.evidence.bedrooms.turnIndex = 0;
    if (corruption === "nonliteral-evidence") output.bookingQuote.evidence.bedrooms.quote = "seven bedrooms";
    if (corruption === "historical-intent") output.bookingQuote.intentEvidenceQuote = "An old intent that is absent from this message";
    if (corruption.startsWith("wrong-turn")) {
      const turns = h.history(), wrong: Row = { role: "user", content: "3 bedrooms", opMsgId: "historical-user", from: PHONE, sessionId: 7, receivingPhoneNumberId: LINE };
      if (corruption === "wrong-turn-phone") wrong.from = "+17035559876";
      if (corruption === "wrong-turn-session") wrong.sessionId = 99;
      if (corruption === "wrong-turn-line") wrong.receivingPhoneNumberId = LINE_TWO;
      turns.unshift(wrong); h.row().messageHistory = JSON.stringify(turns);
      for (const evidence of Object.values(output.bookingQuote.evidence)) evidence.turnIndex = 2;
      output.bookingQuote.evidence.bedrooms = { turnIndex: 0, quote: "3 bedrooms" };
    }
    h.queue(output); expect(await h.run(input)).toEqual({ outcome: "failed" });
    expect(h.state().funnels).toEqual([]); expect(h.state().cards).toEqual([]); expect(h.send).not.toHaveBeenCalled();
  });

  it.each(["funnel", "state-insert", "state-save", "task-insert", "task-save", "receipt-prepare", "receipt-insert"] as Fault[])("rolls back all quote/link/task effects when %s persistence fails before submission", async fault => {
    const h = harness(), input = h.append(`${FULL_TEXT} Also update my gate note to use gate 1234.`);
    h.queue(h.output(input, fullFields, "link", { task: { title: "Update the existing customer access note", items: [{ title: "Update the gate note", evidenceQuote: "use gate 1234" }] } }));
    const beforeHistory = h.row().messageHistory; h.setFault(fault);
    expect(await h.run(input)).toEqual({ outcome: "failed" });
    expect(h.state().cards).toEqual([]); expect(h.state().funnels).toEqual([]); expect(h.row().messageHistory).toBe(beforeHistory); expect(h.send).not.toHaveBeenCalled();
    if (fault === "receipt-insert") expect(h.state().drafts).toEqual([]);
    else expect(h.state().drafts[0]).toMatchObject({ status: "DISMISSED", errorCode: "GENERATION_OR_PERSISTENCE_FAILED" });
    expect(h.events).toContain("rollback");
    expect(h.events).toContain(`fault:${fault}`);
  });

  it("a failed correction transaction preserves the previously durable quote and link exactly", async () => {
    const h = harness(); await h.turn(); const before = structuredClone({ cards: h.state().cards, funnels: h.state().funnels });
    h.setFault("receipt-prepare");
    expect((await h.turn("Please change my new quote to 4 bedrooms and send the revised link.", { bedrooms: 4 }, "link")).result.outcome).toBe("failed");
    expect(h.state().cards).toEqual(before.cards); expect(h.state().funnels).toEqual(before.funnels); expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("a failed preparation while reusing a historical receipt rolls back current state, full receipt history and follow-up task before any send", async () => {
    const h = harness(true); await h.turn(); const originalLink = structuredClone(h.quote()!.link!);
    await h.turn("Please use 4 bedrooms for this new quote and send the revised link.", { bedrooms: 4 });
    const before = structuredClone({ cards: h.state().cards, funnels: h.state().funnels });
    h.setFault("receipt-prepare");
    expect((await h.turn("Return to 3 bedrooms and send the original new cleaning quote link.", { bedrooms: 3 })).result.outcome).toBe("failed");
    expect(h.state().cards).toEqual(before.cards); expect(h.state().funnels).toEqual(before.funnels);
    expect(h.send).toHaveBeenCalledTimes(2); expect(h.tasks()).toHaveLength(2);
    expect(h.events).toContain("fault:receipt-prepare"); expect(h.events).toContain("rollback");
    expect(h.state().drafts.at(-1)).toMatchObject({ status: "DISMISSED", errorCode: "GENERATION_OR_PERSISTENCE_FAILED" });
    h.setFault("none");
    expect((await h.turn("Please use 3 bedrooms and send that original new quote link now.", { bedrooms: 3 })).result.outcome).toBe("accepted");
    expect(h.quote()?.link).toEqual(originalLink); expect(h.state().funnels).toHaveLength(2);
    expect(JSON.parse(h.quoteRows()[0].metadata).quotes).toHaveLength(2);
    expect(h.send).toHaveBeenCalledTimes(3); expect(h.tasks()).toHaveLength(3);
  });

  it("records timeout as uncertain in the original SENDING receipt and never automatically retries the same provider message after a restart", async () => {
    const h = harness(); h.setTransport(async () => { throw Error("Synthetic provider timeout after submission may have been accepted"); });
    const first = await h.turn(); expect(first.result).toEqual({ outcome: "uncertain" });
    expect(h.events.filter(event => event === "provider-preconditions-verified")).toHaveLength(1);
    expect(h.state().drafts[0]).toMatchObject({ status: "SENDING", errorCode: "SUBMISSION_UNCERTAIN" });
    expect(h.state().funnels).toHaveLength(1); expect(h.quote()?.link).not.toBeNull(); expect(h.history().filter(turn => turn.role === "assistant")).toEqual([]);
    const before = structuredClone(h.state()); expect(await h.run(first.input)).toEqual({ outcome: "duplicate" });
    expect(h.state()).toEqual(before); expect(h.runner).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("acceptance-save failure rolls back accepted history, retains the durable quote, and blocks a second provider attempt", async () => {
    const h = harness(); h.setFault("acceptance-save"); const first = await h.turn();
    expect(first.result).toEqual({ outcome: "uncertain" }); expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.events).toContain("provider-preconditions-verified"); expect(h.events).toContain("fault:acceptance-save");
    expect(h.history().filter(turn => turn.role === "assistant")).toEqual([]); expect(h.state().funnels).toHaveLength(1);
    expect(h.state().drafts[0]).toMatchObject({ status: "SENDING", errorCode: "SUBMISSION_UNCERTAIN" });
    h.setFault("none"); expect(await h.run(first.input)).toEqual({ outcome: "duplicate" }); expect(h.send).toHaveBeenCalledTimes(1); expect(h.runner).toHaveBeenCalledTimes(1);
  });
});

describe("ordinary customer service and original human-task authority remain intact", () => {
  it("preserves ordinary reply/checklist text, creates no quote state and still requires human claim plus a completion note without booking or resolving a session", async () => {
    const h = harness(), text = "Please move my existing visit to Friday and use gate 1234.", input = h.append(text);
    const replyText = "Thanks, María! We'll take care of your request and confirm once the changes are made.";
    h.queue({ replyText, task: { title: "Review requested cleaning changes", items: [
      { title: "Move the existing visit to Friday", evidenceQuote: "move my existing visit to Friday" }, { title: "Update the gate note", evidenceQuote: "use gate 1234" },
    ] }, bookingQuote: null });
    expect(await h.run(input)).toEqual({ outcome: "accepted" }); expect(h.send.mock.calls[0][0]).toEqual({ to: PHONE, fromNumberId: LINE, content: replyText });
    expect(h.quoteRows()).toEqual([]); expect(h.state().funnels).toEqual([]); expect(h.tasks()).toHaveLength(1); expectAcceptedHistory(h, input);
    const store = h.stores().taskStore, id = h.tasks()[0].id;
    expect(await store.list()).toHaveLength(1);
    await expect(store.completeTask(id, "Not claimed", OWNER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await store.claimTask(id, OWNER)).toMatchObject({ status: "claimed", owner: OWNER });
    await expect(store.completeTask(id, "Other staff cannot confirm", OTHER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(store.completeTask(id, " ", OWNER)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await store.completeItem(id, "item-1", OWNER); expect((await store.get(id))?.status).toBe("claimed");
    const done = await store.completeTask(id, "I completed both changes manually in the existing booking interface.", OWNER);
    expect(done).toMatchObject({ status: "done", completedBy: OWNER, completionNote: "I completed both changes manually in the existing booking interface.", reply: { text: replyText, status: "sent" } });
    expect(await h.stores().taskStore.get(id)).toEqual(done); expect(done.items.every(item => item.completedBy?.id === OWNER.id)).toBe(true);
    expect(h.send).toHaveBeenCalledTimes(1); expect(h.quoteRows()).toEqual([]); expect(h.row().stage).toBe("CS_INBOUND");
    expect(h.writes.filter(value => value.table === "ops_chat_messages").every(value => [taskAction, "task-update"].includes(value.kind))).toBe(true);
  });

  it("keeps the server-added booking-link follow-up pending until its human owner claims and confirms completion with a note", async () => {
    const h = harness(), value = await h.turn(); expect(value.result.outcome).toBe("accepted");
    expect(h.tasks()).toHaveLength(1);
    const task = h.tasks()[0], beforeQuote = structuredClone(h.quote()), beforeFunnels = structuredClone(h.state().funnels);
    expect(task).toMatchObject({ title: FOLLOWUP_TITLE, status: "unclaimed", owner: null, completionNote: null,
      sourceMessageId: value.input.providerMessageId, sourceText: value.input.inboundText,
      items: [{ title: FOLLOWUP_ITEM, evidenceQuote: value.input.inboundText, completedBy: null, completedAt: null }],
      reply: { status: "sent", text: h.send.mock.calls[0][0].content } });
    const store = h.stores().taskStore;
    await expect(store.completeTask(task.id, "Not claimed", OWNER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(store.completeItem(task.id, task.items[0].id, OWNER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await store.claimTask(task.id, OWNER)).toMatchObject({ status: "claimed", owner: OWNER });
    await expect(store.completeTask(task.id, "Not the owner", OTHER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(store.completeTask(task.id, " ", OWNER)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await store.completeItem(task.id, task.items[0].id, OWNER);
    expect(await store.get(task.id)).toMatchObject({ status: "claimed", completionNote: null });
    const done = await store.completeTask(task.id, "I reviewed the customer's booking-link completion manually.", OWNER);
    expect(done).toMatchObject({ status: "done", owner: OWNER, completedBy: OWNER,
      completionNote: "I reviewed the customer's booking-link completion manually." });
    expect(await h.stores().taskStore.get(task.id)).toEqual(done);
    expect(h.quote()).toEqual(beforeQuote); expect(h.state().funnels).toEqual(beforeFunnels);
    expect(h.row().stage).toBe("CS_INBOUND"); expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("a mixed new quote and real access-note request retains the actual task and its finalized durable acknowledgment before provider submission", async () => {
    const acknowledgment = "Thanks, María. We'll take care of your request and confirm once the access note is updated.";
    const h = harness(), value = await h.turn(`${FULL_TEXT} Also use gate 1234 for my existing customer access note.`, fullFields, "link", {
      replyText: acknowledgment,
      task: { title: "Update customer access note", items: [{ title: "Use the requested gate code", evidenceQuote: "use gate 1234" }] },
    });
    expect(value.result).toEqual({ outcome: "accepted" }); expect(h.tasks()).toHaveLength(1); expect(h.state().funnels).toHaveLength(1);
    const content = h.send.mock.calls[0][0].content, url = `${SMS_QUOTE_BOOKING_ORIGIN}${h.quote()!.link!.urlPath}`;
    expect(content.startsWith(`${acknowledgment}\n\nYour cleaning is ready to schedule. Here are the details:\n\n`)).toBe(true);
    expect(content.split(acknowledgment)).toHaveLength(2);
    expect(content).toContain("📅 Requested date: Friday, November 20\n⏰ Requested time: 10:30 AM");
    expect(content).toContain("🛏️ Home size: 3 bed / 2 bath\n💵 Total:");
    expect(content.match(/https?:\/\/[^\s]+/g)).toEqual([url]);
    expect(content.split("Last step to complete your booking:")).toHaveLength(2);
    expect(content.endsWith(`🔗 ${url}`)).toBe(true);
    expect(content.slice(acknowledgment.length)).not.toMatch(/access note (?:is|was|has been) updated|booking (?:confirmed|reserved)|arrival window|House/i);
    expect(h.send).toHaveBeenCalledTimes(1); expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.tasks()[0]).toMatchObject({ title: "Update customer access note", status: "unclaimed",
      reply: { text: h.send.mock.calls[0][0].content, status: "sent" }, items: [
        { title: "Use the requested gate code", evidenceQuote: "use gate 1234" },
        { title: FOLLOWUP_ITEM, evidenceQuote: value.input.inboundText },
      ] });
    expect(h.tasks()[0].reply.text).toContain(h.quote()!.link!.token); expectAcceptedHistory(h, value.input);
    const before = structuredClone(h.state());
    expect(["excluded", "duplicate"]).toContain((await h.run(value.input)).outcome);
    expect(h.state()).toEqual(before); expect(h.send).toHaveBeenCalledTimes(1); expect(h.runner).toHaveBeenCalledTimes(1);
  });

  it("keeps a grounded ordinary question's exact legacy two-field reply with no task or quote-state write", async () => {
    const h = harness(), input = h.append("Is a requested cleaning time guaranteed?");
    const replyText = "A requested cleaning time is a preference, not verified availability.";
    h.queue({ replyText, task: null }); expect(await h.run(input)).toEqual({ outcome: "accepted" });
    expect(h.send.mock.calls[0][0].content).toBe(replyText); expect(h.state().cards).toEqual([]); expect(h.state().funnels).toEqual([]);
    expect(h.writes.some(value => value.table === "ops_chat_messages")).toBe(false);
  });
});
