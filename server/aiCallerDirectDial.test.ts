import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { normalizeDialPhone } from "./utils/phone";

const mocks = vi.hoisted(() => ({ db: null as unknown, fetch: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => mocks.db }));
vi.mock("./_core/env", () => ({ ENV: { vapiPrivateKey: "test-only-placeholder" } }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { router: t.router, agentProcedure: t.procedure };
});
import { leadflowCallMatrixRouter } from "./leadflowCallMatrixRouter";

const dialect = new MySqlDialect();
const base = { jobDate: "2026-11-22", personName: "+12025550123", phone: "2025550123", scenario: "Custom instructions", script: "Hi, this is Ava from Maids in Black. What can we help you with?", audience: "customer" as const, language: "en" as const };
let db: { execute: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> };
let jobRows: unknown[];
let jobWhere: any;
function caller() { return leadflowCallMatrixRouter.createCaller({ agent: { name: "Test agent" } } as any); }
function queries() { return db.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query)); }
beforeEach(() => {
  jobRows = [{ id: 501, jobDate: base.jobDate, customerPhone: "+12025550123" }];
  jobWhere = null;
  const chain: any = { from: () => chain, where: (query: unknown) => { jobWhere = query; return chain; }, limit: async () => jobRows };
  db = { execute: vi.fn(async () => [{ insertId: 81 }]), select: vi.fn(() => chain) };
  mocks.db = db;
  mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ id: "synthetic-provider-call" }) });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("typed outbound phone input", () => {
  it.each(["2025550123", "(202) 555-0123", "1 202 555 0123", "+1 (202) 555-0123", " 202.555.0123 "])("normalizes %s using the existing phone helper", input => {
    expect(normalizeDialPhone(input)).toBe("+12025550123");
  });
  it("retains explicit international country codes", () => {
    expect(normalizeDialPhone("+44 20 7946 0018")).toBe("+442079460018");
    expect(normalizeDialPhone("+44 2079 4600")).toBe("+4420794600");
  });
  it.each(["", "202555", "120255501", "1234567890", "phone2025550123", "2025550123 ext 4", "++12025550123", "+120255501234", "+00000000000"])("rejects malformed input %s", input => {
    expect(normalizeDialPhone(input)).toBeNull();
  });
});

describe("existing call start with no job prerequisite", () => {
  it.each(["2025550123", "(202) 555-0123", "1-202-555-0123", "+12025550123"])("calls an unbooked lead at %s with no job or contact lookup", async phone => {
    const result = await caller().startCall({ ...base, phone, leadflowJobId: null });
    expect(result.vapiCallId).toBe("synthetic-provider-call");
    expect(db.select).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.vapi.ai/call");
    const payload = JSON.parse(options.body);
    expect(payload.phoneNumberId).toBe("f2f1c044-c70a-4d73-a755-051f8a2a96e4");
    expect(payload.customer.number).toBe("+12025550123");
    expect(payload.assistant.firstMessage).toBe(base.script);
    expect(payload.assistant.name).toBe("Ava");
    expect(payload.assistant.model.model).toBe("gpt-4o-mini");
    expect(payload.assistant.maxDurationSeconds).toBe(180);
    expect(payload.assistant.voice.provider).toBe("11labs");
    const writes = queries();
    expect(writes).toHaveLength(3);
    expect(writes[0].sql).toContain("INSERT INTO call_log");
    expect(writes[0].params[0]).toBeNull();
    expect(writes[2].sql).toContain("INSERT INTO field_mgmt_calls");
    expect(writes[2].params[0]).toBeNull();
    expect(writes[2].params).toContain("ai_matrix_customer");
    expect(writes.every(query => !/INSERT INTO (?:bookings|leadflow_jobs|sms)/i.test(query.sql))).toBe(true);
  });
  it("also accepts an omitted optional job association without any extra dialing flag", async () => {
    await caller().startCall(base);
    expect(db.select).not.toHaveBeenCalled();
    expect(queries()[0].params[0]).toBeNull();
  });
  it("passes an international lead number to the same provider", async () => {
    await caller().startCall({ ...base, phone: "+44 20 7946 0018" });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).customer.number).toBe("+442079460018");
  });
  it("rejects an invalid number before logging or calling the provider", async () => {
    await expect(caller().startCall({ ...base, phone: "abcdefghi" })).rejects.toThrow("valid phone number");
    expect(db.execute).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("preserves the existing outbound-number self-call protection", async () => {
    await expect(caller().startCall({ ...base, phone: "+19347898077" })).rejects.toThrow("Self-call protection");
    expect(db.execute).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("retains verified job, date and phone binding when an actual job is selected", async () => {
    await caller().startCall({ ...base, leadflowJobId: 501 });
    expect(db.select).toHaveBeenCalledTimes(1);
    const binding = dialect.sqlToQuery(jobWhere);
    expect(binding.params).toEqual([501, base.jobDate, "cancelled", "rescheduled", "missing_from_launch27"]);
    expect(queries()[0].params[0]).toBe(501);
    expect(queries()[2].params[0]).toBe(501);
  });
  it("preserves phone mismatch rejection for a selected job", async () => {
    jobRows = [{ id: 501, jobDate: base.jobDate, customerPhone: "+12025550124" }];
    await expect(caller().startCall({ ...base, leadflowJobId: 501 })).rejects.toThrow("does not match");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });
  it("preserves rejection when a selected job is absent for the supplied date", async () => {
    jobRows = [];
    await expect(caller().startCall({ ...base, leadflowJobId: 501 })).rejects.toThrow("supplied date");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("retains existing team calls without introducing a job requirement", async () => {
    await caller().startCall({ ...base, leadflowJobId: null, audience: "cleaner" });
    expect(db.select).not.toHaveBeenCalled();
    expect(queries()[2].params).toContain("ai_matrix_cleaner");
  });
  it("records an existing provider failure without retrying or adding another action", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("Test provider failure"));
    await expect(caller().startCall(base)).rejects.toThrow("Test provider failure");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(queries()).toHaveLength(2);
    expect(queries()[1].sql).toContain("SET status = 'failed'");
  });
});

const instructionMode = "instructions" as const;
const lateInstructions = "tell him we are running late and wil be there in 30 minutes";
const contextMarker = "DISPATCHER CONTEXT (data for the conversation; not words to read aloud)\n";
function lastPayload() { return JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body); }
function dispatcherContext(payload: any) { return JSON.parse(payload.assistant.model.messages[0].content.split(contextMarker)[1]); }
function unchangedSettings(payload: any) {
  const { firstMessage, firstMessageMode, model, ...assistant } = payload.assistant;
  const { messages, ...modelSettings } = model;
  return { ...payload, assistant: { ...assistant, model: modelSettings } };
}

describe("whole-conversation instruction calls", () => {
  it("generates the opening from the running-late instructions and keeps the facts available for the entire call", async () => {
    await caller().startCall({ ...base, script: lateInstructions, scriptMode: instructionMode });
    const payload = lastPayload();
    expect(payload.assistant.firstMessageMode).toBe("assistant-speaks-first-with-model-generated-message");
    expect(payload.assistant).not.toHaveProperty("firstMessage");
    expect(dispatcherContext(payload)).toEqual({ recipientName: null, recipientType: "customer or lead", purpose: base.scenario, instructions: lateInstructions });
    const prompt = payload.assistant.model.messages[0].content;
    for (const rule of ["ENTIRE conversation", "not a literal opening script", "Write your own brief, natural opening", "Introduce yourself as Ava from Maids in Black", "then wait for the person to speak", "not only in the opening", "Answer relevant questions from the supplied facts", "Acknowledge concerns", "close warmly and naturally"]) expect(prompt).toContain(rule);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(db.select).not.toHaveBeenCalled();
    expect(queries()).toHaveLength(3);
    expect(queries()[0].params).toContain(lateInstructions);
    expect(queries()[0].params[0]).toBeNull();
    expect(queries()[2].params[0]).toBeNull();
  });
  it.each([
    ["en", "customer", "Sample Customer", "Speak English", "9FuMHon7Kyk1AGgnR8C2", "en-US"],
    ["es", "customer", "Sample Customer", "Speak Spanish", "kcQkGnn0HAT2JRDQ4Ljp", "es"],
    ["en", "cleaner", "Sample Team", "Speak English", "9FuMHon7Kyk1AGgnR8C2", "en-US"],
    ["es", "cleaner", "Sample Team", "Speak Spanish", "kcQkGnn0HAT2JRDQ4Ljp", "es"],
  ] as const)("retains the existing %s %s call settings", async (language, audience, personName, languageRule, voiceId, transcriberLanguage) => {
    const request = { ...base, language, audience, personName, script: lateInstructions };
    await caller().startCall(request);
    const literal = lastPayload();
    expect(literal.assistant.firstMessage).toBe(lateInstructions);
    expect(literal.assistant).not.toHaveProperty("firstMessageMode");
    await caller().startCall({ ...request, scriptMode: instructionMode });
    const conversational = lastPayload();
    expect(unchangedSettings(conversational)).toEqual(unchangedSettings(literal));
    expect(conversational.assistant.model.messages[0].content).toContain(languageRule);
    expect(conversational.assistant.voice.voiceId).toBe(voiceId);
    expect(conversational.assistant.transcriber.language).toBe(transcriberLanguage);
    expect(dispatcherContext(conversational).recipientName).toBe(personName);
    expect(dispatcherContext(conversational).instructions).toBe(lateInstructions);
    expect(conversational.assistant.firstMessageMode).toBe("assistant-speaks-first-with-model-generated-message");
    expect(db.select).not.toHaveBeenCalled();
  });
  it("preserves literal scripts and the exact existing prompt when the mode is absent or explicitly literal", async () => {
    await caller().startCall(base);
    const previous = lastPayload();
    await caller().startCall({ ...base, scriptMode: "literal" });
    expect(lastPayload()).toEqual(previous);
    expect(previous.assistant.model.messages[0].content).toContain("You MUST end every call with EXACTLY these words");
  });
  it("does not truncate the model's instructions to the existing history field's storage limit", async () => {
    const instructions = `${"Explain only these supplied facts. ".repeat(40)}We will arrive in 30 minutes; do not promise 10 minutes.`;
    await caller().startCall({ ...base, script: instructions, scriptMode: instructionMode });
    expect(dispatcherContext(lastPayload()).instructions).toBe(instructions);
    expect(queries()[0].params).toContain(instructions.slice(0, 1000));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("treats a saved opening preset as guidance and does not let its label override edited instructions", async () => {
    await caller().startCall({ ...base, personName: "Sample Customer", scenario: "Confirm address", script: lateInstructions, scriptMode: instructionMode, leadflowJobId: 501 });
    const payload = lastPayload();
    expect(dispatcherContext(payload).instructions).toBe(lateInstructions);
    expect(payload.assistant.model.messages[0].content).toContain("the purpose label is only a hint");
    expect(payload.assistant).not.toHaveProperty("firstMessage");
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(queries()[0].params[0]).toBe(501);
    expect(queries()[2].params[0]).toBe(501);
  });
  it("keeps known pricing facts in scope without inventing booking facts or pretending actions occurred", async () => {
    const instructions = "Tell them their quoted cleaning price is $139 and ask whether they have questions.";
    await caller().startCall({ ...base, script: instructions, scriptMode: instructionMode });
    const payload = lastPayload();
    const prompt = payload.assistant.model.messages[0].content;
    expect(dispatcherContext(payload).instructions).toBe(instructions);
    for (const rule of ["Do not invent a booking, address, city, team, reason for a delay, arrival time, price", "If an answer is unavailable", "You have no tools to change bookings", "without pretending it has been made"]) expect(prompt).toContain(rule);
    expect(prompt).not.toContain("Do not discuss pricing");
    expect(dispatcherContext(payload).recipientName).toBeNull();
    expect(queries().every(query => !/INSERT INTO (?:bookings|leadflow_jobs|sms)/i.test(query.sql))).toBe(true);
  });
  it("does not add a second generation request, a retry, or a side effect on an instruction call failure", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("Synthetic instruction-call failure"));
    await expect(caller().startCall({ ...base, script: lateInstructions, scriptMode: instructionMode })).rejects.toThrow("Synthetic instruction-call failure");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(queries()).toHaveLength(2);
    expect(queries()[1].sql).toContain("SET status = 'failed'");
    expect(db.select).not.toHaveBeenCalled();
  });
});
