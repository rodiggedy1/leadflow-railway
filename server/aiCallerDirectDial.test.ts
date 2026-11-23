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
