import { describe, expect, it, vi } from "vitest";
import { createInstinctService } from "./service";
import { assertReadSelect, type ReadDb, type SelectPort, type SqlRow, type SqlValue } from "./readDb";

const at = "2026-11-13T18:00:00.000Z", phone = "+13015550123", other = "+13015550888", line = "+13015550456";
const scope = { installationScope: "installation", sourceAccountKey: "account", authorizationVersion: "v1", actor: { staffId: "1", role: "admin" as const } };
class SenderDb implements ReadDb {
  calls: { sql: string; params: readonly SqlValue[] }[] = [];
  tables: Record<string, Record<string, unknown>[]> = {
    conversation_sessions: [{ id: "7", leadPhone: "(301) 555-0123", leadName: "Saved sender", messageHistory: "", createdAt: new Date(at), updatedAt: new Date(at) }], inbound_sms: [],
    bookings: [{ id: "1", publicBookingNumber: "LF-1", customerPhone: phone, customerEmail: "sender@example.test", customerName: "Native sender", requestedLocalDate: "2026-11-16", requestedLocalTime: "09:00", requestedTimeZone: "America/New_York", requestedStartAt: String(Date.parse("2026-11-16T14:00:00.000Z")), status: "confirmed", extras: [], specialRequestNotes: [], companyNotes: null, priceSnapshot: {}, updatedAt: new Date(at) }],
    leadflow_jobs: [], booking_series: [],
  };
  async select(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    assertReadSelect(sql); this.calls.push({ sql, params });
    const table = /FROM `([a-z_]+)`/.exec(sql)?.[1]; if (!table || !(table in this.tables)) throw new Error("Undeclared offline table");
    let rows = this.tables[table];
    if (sql.includes("MAX(`id`)")) return [{ throughId: rows.at(-1)?.id ?? null }];
    if (sql.includes("`id` > ?")) rows = rows.filter(row => BigInt(String(row.id)) > BigInt(String(params[0])) && BigInt(String(row.id)) <= BigInt(String(params[1]))).slice(0, Number(params.at(-1)));
    else if (sql.includes("REGEXP_REPLACE")) rows = rows.filter(row => String(row.customerPhone).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") === params[2]);
    else { const field = /WHERE `(\w+)` = \?/.exec(sql)?.[1]; if (!field) throw new Error("Unexpected offline SELECT"); rows = rows.filter(row => String(row[field]) === String(params[0])); }
    return rows;
  }
  async snapshot<T>(read: (port: SelectPort) => Promise<T>): Promise<T> { return read(this); }
}
async function check(metadata: Record<string, unknown> = {}, configure?: (db: SenderDb) => void) {
  const db = new SenderDb(); db.tables.conversation_sessions[0].messageHistory = JSON.stringify([{ role: "user", content: "Move my appointment LF-1 to 2026-11-16 at 9 AM", ts: at, ...metadata }]); configure?.(db);
  const model = vi.fn(async (params: { messages: { content: unknown }[] }) => {
    const text = JSON.parse(String(params.messages[1].content)).context.evidence[0].originalText;
    return { id: "offline", model: "injected", created: 1, choices: [{ index: 0, message: { role: "assistant" as const, content: JSON.stringify({ actions: [{ action: "reschedule", agreement: "requested", anchorEvidenceIndex: 0, citations: [{ evidenceIndex: 0, start: 0, end: text.length, exactQuote: text }], expected: { bookingReference: "LF-1", date: "2026-11-16", originalDate: null, time: "09:00", timeKind: "exact", windowEnd: null, timeZone: "America/New_York", scope: "visit", address: null, serviceName: null, extras: null, extrasMode: "unspecified", teamName: null, amountCents: null, notes: null, notesDestination: "unspecified" }, explanation: "Exact appointment request", confidence: 0.95, ambiguous: false, missingParameters: [], supersededByEvidenceIndex: null }] }) }, finish_reason: "stop" as const }] };
  });
  const service = createInstinctService({ scope, db, clock: { now: () => new Date(at) }, model, businessLines: [] });
  const inventory = await service.sources(scope, { sourceKinds: ["sms"] });
  const result = await service.check(scope, { sourceRefs: inventory.items.map(item => item.ref), expectedContextRevision: inventory.binding.contextRevision! });
  return { db, model, inventory, result };
}
describe("existing exact-session sender authority", () => {
  it("passes canonical headerless role/content/ts SMS phone to native lookup and corroborates it", async () => {
    const { db, model, result } = await check();
    expect(result.issues[0].identity).toMatchObject({ phone, decision: "verified" });
    expect(result.issues[0].identity.displayName).toBeTruthy();
    const lookup = db.calls.find(call => call.sql.includes("FROM `bookings` WHERE ("));
    expect(lookup?.params).toContain("3015550123");
    const contacts = db.calls.filter(call => call.sql.includes("`leadPhone`, `leadName` FROM `conversation_sessions`"));
    expect(contacts.length).toBeGreaterThan(0); expect(contacts.every(call => call.params[0] === "7")).toBe(true);
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("retains saved sender phone/name without inventing native proof when there is no booking", async () => {
    const { result, db } = await check({}, db => { db.tables.bookings = []; });
    expect(result.issues[0].identity).toMatchObject({ phone, displayName: "Saved sender", decision: "unavailable", fingerprint: null });
    expect(result.issues[0].outcome).not.toBe("matches_current");
    expect(db.calls.some(call => call.sql.includes("REGEXP_REPLACE"))).toBe(true);
  });
  it("same formatted phone is equivalent, not an explicit conflict", async () => {
    const { result } = await check({ from: "301-555-0123", fromPhone: phone, customerPhone: ["301-555-0123"], sessionId: "7", direction: "incoming" });
    expect(result.issues[0].identity.decision).toBe("verified");
  });
  it("uses exact session phone for outbound role/content/ts history as well", async () => {
    const { result } = await check({ role: "assistant", to: "301-555-0123", toPhone: phone });
    expect(result.issues[0].identity).toMatchObject({ phone, displayName: "Saved sender", decision: "verified" });
  });
  it.each([
    { fromPhone: 3015550123 }, { from: { phone } }, { from: [] }, { from: [phone, phone] }, { fromPhone: other },
    { customerPhone: other }, { customerPhone: { phone } }, { to: [line, other] }, { toPhone: 3015550456 }, { to: phone },
    { businessPhone: 3015550456 }, { businessLine: { phone: line } }, { businessPhone: line, metadata: { businessPhone: other } },
    { cc: [other] }, { cc: 123 }, { cc: {} }, { direction: "outgoing" }, { direction: {} }, { sessionId: "8" },
    { metadata: { fromPhone: other } }, { metadata: "invalid" }, { metadata: { cc: [other] } },
  ])("does not promote malformed or contradictory explicit metadata: %j", async metadata => {
    const { result, inventory, db } = await check(metadata);
    expect(inventory.items[0].limitations.join(" ")).toMatch(/conflict|participant|identity/i);
    expect(result.issues[0].identity.decision).not.toBe("verified");
    expect(result.issues[0].outcome).not.toBe("matches_current");
    expect(db.calls.some(call => call.sql.includes("REGEXP_REPLACE"))).toBe(false);
  });
  it("does not borrow a same-phone sibling name/contact", async () => {
    const { result, db } = await check({}, db => { db.tables.bookings = []; db.tables.conversation_sessions.push({ ...db.tables.conversation_sessions[0], id: "8", leadName: "Sibling" }); });
    expect(result.issues[0].identity.displayName).toBe("Saved sender");
    expect(db.calls.filter(call => /WHERE `id` = \?/.test(call.sql) && call.sql.includes("conversation_sessions")).every(call => call.params[0] === "7")).toBe(true);
  });
  it("native reused phone and conflicting canonical links remain unverified", async () => {
    const { result } = await check({}, db => { db.tables.bookings.push({ ...db.tables.bookings[0], id: "2", publicBookingNumber: "LF-2", customerEmail: "foreign@example.test" }); });
    expect(result.issues[0].identity.decision).not.toBe("verified");
    expect(result.issues[0].identity.reasons).toContain("SHARED_PHONE");
  });
  it("does not turn a partial native booking into verified proof", async () => {
    const { result } = await check({}, db => { db.tables.bookings[0].requestedStartAt = null; });
    expect(result.issues[0].identity).toMatchObject({ phone, displayName: "Saved sender", decision: "unavailable", fingerprint: null });
    expect(result.issues[0].identity.reasons).toContain("NATIVE_SNAPSHOT_INCOMPLETE");
  });
  it("retains contradictory linked native records instead of adopting their contact", async () => {
    const { result } = await check({}, db => {
      db.tables.bookings[0].customerPhone = other;
      db.tables.leadflow_jobs = [{ id: "20", bookingId: "1", customerPhone: phone, customerEmail: "sender@example.test", customerName: "Native sender", jobDate: "2026-11-16", serviceDateTime: "2026-11-16T14:00:00.000Z", extras: [], customerNotes: null }];
    });
    expect(result.issues[0].identity.decision).not.toBe("verified");
    expect(result.issues[0].identity.reasons).toContain("CANONICAL_CONTACT_CONFLICT");
  });
  it("body and speaker names cannot supply a missing canonical session phone", async () => {
    const { result, db } = await check({ senderName: "Native sender", content: `I am Native sender ${phone}. Move my appointment LF-1 to 2026-11-16 at 9 AM` }, db => { db.tables.conversation_sessions[0].leadPhone = null; });
    expect(result.issues[0].identity.phone).toBeNull();
    expect(result.issues[0].identity.decision).not.toBe("verified");
    expect(db.calls.some(call => call.sql.includes("REGEXP_REPLACE"))).toBe(false);
  });
});
