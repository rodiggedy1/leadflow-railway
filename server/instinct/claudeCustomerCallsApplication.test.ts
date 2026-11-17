import { describe, it, expect, vi } from "vitest";
import { customerCallSourceFromRecord, createCustomerCallSourceReader } from "./claudeCustomerCallsApplication";
import { createCustomerCallRecordingReader } from "./claudeCustomerCallRecording";
import { MySqlDialect } from "drizzle-orm/mysql-core";
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../vapiService", () => ({ getAssistantId: () => "synthetic-assistant" }));
const now = "2026-11-17T07:00:00Z";
const full = () => ({ id: "synthetic-call", assistantId: "synthetic-assistant", type: "inboundPhoneCall", status: "ended", endedReason: "customer-ended-call", endedAt: now,
  analysis: { structuredData: { callerName: "Synthetic Jane" } },
  customer: { number: "+13015550123" }, artifact: { transcript: "AI: How can I help?\nUser: Move the cleaning to Friday.\nAI: Staff will review it.",
    messages: [{ role: "assistant", message: "How can I help?" }, { role: "user", message: "Move the cleaning to Friday." }, { role: "assistant", message: "Staff will review it." }], recordingUrl: "https://recordings.example.test/private.wav" } });
const stored = () => ({ id: 77, vapiCallId: "synthetic-call", sessionId: 42, callerPhone: "+13015550123", structuredData: JSON.stringify({ callerName: "Synthetic Jane" }) });
const callback = () => ({ id: 401, voiceCallId: 77, callerPhone: "+13015550123", completed: 0, notes: "Review Friday", preferredCallbackTime: "tomorrow" });
const get = (f = full(), s = stored(), callbacks: any[] = [callback()]) => customerCallSourceFromRecord(f, s, callbacks, "synthetic-assistant");
describe("call evidence — actual verified provider record only", () => {
  it("binds exact call/assistant IDs, full transcript and caller-only literal turns; references existing callback IDs", () => {
    expect(get()).toMatchObject({ providerCallId: "synthetic-call", voiceCallId: 77, sessionId: 42, callerPhone: "+13015550123", callerName: "Synthetic Jane", customerTurns: ["Move the cleaning to Friday."], callbackTaskIds: [401] });
    expect(get()?.transcript).toBe(full().artifact.transcript);
  });
  it.each(["outboundPhoneCall", "webCall", "vapi.websocketCall", "unknown"])("rejects non-inbound call type %s", type => { const f = full(); f.type = type; expect(get(f)).toBeNull(); });
  it.each(["voicemail", "customer-did-not-answer", "customer-ended-call-during-greeting"])("does not invent tasks for %s", reason => { const f = full(); f.endedReason = reason; expect(get(f)).toBeNull(); });
  it("rejects wrong provider IDs, wrong assistants and unfinished calls", () => { for (const patch of [{ id: "other-call" }, { assistantId: "other-assistant" }, { status: "in-progress" }]) expect(get({ ...full(), ...patch })).toBeNull(); });
  it("rejects source disagreement and internal phone numbers without guessing", () => { expect(get(full(), { ...stored(), callerPhone: "+13015550999" })).toBeNull(); for (const number of ["+12028885362", "+19347898077"]) expect(get({ ...full(), customer: { number } })).toBeNull(); });
  it("does not infer phone or session from model-extracted contact when provider caller is absent", () => { const f = full(); f.customer = { number: "" }; expect(get(f)).toMatchObject({ callerPhone: null, sessionId: null, callbackTaskIds: [] }); });
  it("does not use summary, assistant-only text or mismatched transcript as caller evidence", () => { const f = full(); f.artifact.messages = [{ role: "assistant", message: "Move the cleaning to Friday." }]; expect(get(f)).toBeNull(); const g = full(); g.artifact.transcript = "AI: Invented request"; expect(get(g)).toBeNull(); });
  it("keeps long multilingual transcript and caller words untruncated", () => { const f = full(); const text = "¿Me puedes enviar el enlace? ".repeat(1500); f.artifact.messages.push({ role: "user", message: text }); f.artifact.transcript += "\nUser: " + text; expect(get(f)?.customerTurns.at(-1)).toBe(text); expect(get(f)?.transcript).toBe(f.artifact.transcript); });
  it("does not attach callbacks from another call, phone or already completed work", () => { expect(get(full(), stored(), [{ ...callback(), voiceCallId: 99 }, { ...callback(), callerPhone: "+13015550999" }, { ...callback(), completed: 1 }])?.callbackTaskIds).toEqual([]); });
  it("rejects invalid timestamps and absent utterance arrays", () => { const f: any = full(); f.endedAt = "invalid"; expect(get(f)).toBeNull(); const g: any = full(); delete g.artifact.messages; expect(get(g)).toBeNull(); });
  it("never uses a forged stored/webhook display name instead of the verified provider analysis", () => { expect(get(full(), { ...stored(), structuredData: '{"callerName":"Forged name"}' })?.callerName).toBe("Synthetic Jane"); const f: any = full(); delete f.analysis; expect(get(f)?.callerName).toBeNull(); });
  it("reads only the exact stored call, field-management guard and existing callback references; no writes", async () => {
    const queries: string[] = []; const fetchCall = vi.fn(async () => full());
    const db: any = { execute: vi.fn(async q => { const query = new MySqlDialect().sqlToQuery(q); queries.push(query.sql); if (query.sql.includes("voice_calls")) return [[stored()]]; if (query.sql.includes("field_mgmt_calls") || query.sql.includes("cleaner_profiles")) return [[]]; if (query.sql.includes("callback_tasks")) return [[callback()]]; throw Error("Unexpected query"); }) };
    const read = createCustomerCallSourceReader({ db, fetchCall, assistantId: "synthetic-assistant" });
    expect(await read({ message: { type: "end-of-call-report", call: { id: "synthetic-call" }, artifact: { transcript: "forged webhook evidence" } } })).not.toBeNull();
    expect(fetchCall).toHaveBeenCalledWith("synthetic-call"); expect(queries).toHaveLength(4); expect(queries.every(q => q.startsWith("SELECT"))).toBe(true);
  });
  it("excludes active cleaner callers without creating tasks or reading any job data", async () => { const queries: string[] = []; const db: any = { execute: vi.fn(async q => { const sql = new MySqlDialect().sqlToQuery(q).sql; queries.push(sql); if (sql.includes("voice_calls")) return [[stored()]]; if (sql.includes("cleaner_profiles")) return [[{ phone: "(301) 555-0123" }]]; return [[]]; }) }; expect(await createCustomerCallSourceReader({ db, fetchCall: async () => full(), assistantId: "synthetic-assistant" })({ message: { type: "end-of-call-report", call: { id: "synthetic-call" } } })).toBeNull(); expect(queries.some(q => q.includes("callback_tasks"))).toBe(false); });
  it("does not invoke provider lookup for unmatched or field-management calls", async () => {
    const fetchCall = vi.fn(); const db: any = { execute: vi.fn(async q => new MySqlDialect().sqlToQuery(q).sql.includes("voice_calls") ? [[stored()]] : [[{ id: 1 }]]) };
    expect(await createCustomerCallSourceReader({ db, fetchCall, assistantId: "synthetic-assistant" })({ message: { type: "end-of-call-report", call: { id: "synthetic-call" } } })).toBeNull(); expect(fetchCall).not.toHaveBeenCalled();
  });
});
describe("private Vapi recording links — read-only server-only redirects", () => {
  it("requests a fresh signed URL with server credentials, never forwards credentials to storage", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://storage.example.test/fresh-signed.wav" } }));
    const read = createCustomerCallRecordingReader({ key: "SYNTHETIC_TEST_KEY", fetch: fetcher as any });
    expect(await read("synthetic-call")).toBe("https://storage.example.test/fresh-signed.wav");
    expect(fetcher).toHaveBeenCalledWith("https://api.vapi.ai/call/synthetic-call/mono-recording", { headers: { Authorization: "Bearer SYNTHETIC_TEST_KEY" }, redirect: "manual" });
    await read("synthetic-call"); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("returns absent recordings as absent and never constructs credential-bearing URLs", async () => { const read = createCustomerCallRecordingReader({ key: "SYNTHETIC_TEST_KEY", fetch: vi.fn(async () => new Response(null, { status: 404 })) as any }); expect(await read("synthetic-call")).toBeNull(); });
  it.each(["http://unsafe.example.test/audio", "javascript:alert(1)", "data:audio/wav;base64,AAAA"])("rejects unsafe redirect %s", async location => { const read = createCustomerCallRecordingReader({ key: "test", fetch: vi.fn(async () => new Response(null, { status: 302, headers: { location } })) as any }); await expect(read("synthetic-call")).rejects.toThrow("CUSTOMER_CALL_RECORDING_UNAVAILABLE"); });
});
