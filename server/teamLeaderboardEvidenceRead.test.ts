import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TeamEvidence, TeamEvidenceWindow } from "../shared/teamLeaderboardEvidence";
import type { SelectPort, SqlRow, SqlValue } from "./instinct/readDb";
import { customerEmailBinding } from "./instinct/claudeCustomerEmailSource";
import type { CustomerEmailSnapshot, CustomerEmailTurn } from "./instinct/claudeCustomerEmail";
import { assertTeamEvidenceSelect } from "./teamLeaderboardReadPort";
import { resolveTeamEvidenceWindow } from "./teamLeaderboardEvidenceWindow";
import { readTeamEvidenceVisitHistory, readTeamEvidenceWeek } from "./teamLeaderboardEvidenceRead";

const now = new Date("2026-11-23T17:00:00.000Z");
const input = { weekStart: "2026-11-15" };
const window = resolveTeamEvidenceWindow(input, now);
const sunday = "2026-11-15T15:00:00.000Z", monday = "2026-11-16T15:00:00.000Z", friday = "2026-11-20T15:00:00.000Z";
const old = "2026-10-01T15:00:00.000Z", late = "2026-11-23T15:00:00.000Z";
const phone = "+17035551234", line = "+17035559876";
const date = (at: string) => new Date(at);
const ms = (at: string) => Date.parse(at);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourceTable = (sql: string) => /FROM `([a-z_]+)`/.exec(sql)![1];
const key = (sql: string, params: readonly SqlValue[]) => sourceTable(sql) === "ops_chat_messages" ? `${sourceTable(sql)}:${params[1]}` : sourceTable(sql);

/** Fake SQL routing is deliberately closed. The same guard as integration runs
 * before every fake read; no application DB/provider/model is acquired. */
class FakePort implements SelectPort {
  tables: Record<string, SqlRow[]> = {};
  failures = new Set<string>();
  calls: { sql: string; params: readonly SqlValue[] }[] = [];
  nonadvancing = new Set<string>();
  async select(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    assertTeamEvidenceSelect(sql);
    expect(sql).not.toMatch(/SELECT\s+(?:\w+\.)?\*|\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|FOR|LOCK|SET)\b/i);
    this.calls.push({ sql, params });
    const table = sourceTable(sql), family = key(sql, params);
    if (this.failures.has(table) || this.failures.has(family)) throw Object.assign(new Error("secret connection details"), { code: "ER_NO_SUCH_TABLE" });
    const raw = this.tables[family] ?? this.tables[table] ?? [];
    if (/WHERE `id` = \?/.test(sql)) return raw.filter(row => String(row.id) === String(params[0]));
    let rows = [...raw];
    if (table === "booking_assignments") rows = rows.filter(row => Number(row.bookingId) === Number(params[1]));
    const instant = (value: unknown): number | null => value instanceof Date ? value.getTime() : typeof value === "number" ? value : typeof value === "string" ? /^\d+$/.test(value) ? Number(value) : Date.parse(value.replace(" ", "T") + (value.includes(" ") ? "Z" : "")) : null;
    const range = (value: unknown, start: SqlValue, end: SqlValue) => {
      const at = instant(value), first = instant(start), last = instant(end);
      return at !== null && first !== null && last !== null && at >= first && at < last;
    };
    const before = (value: unknown, cutoff: SqlValue, inclusive = false) => {
      const at = instant(value), end = instant(cutoff); return at !== null && end !== null && (inclusive ? at <= end : at < end);
    };
    if (table === "conversation_sessions") rows = rows.filter(row => before(row.createdAt, params[1]) && instant(row.updatedAt) !== null && instant(params[2]) !== null && instant(row.updatedAt)! >= instant(params[2])!);
    if (table === "inbound_sms") rows = rows.filter(row => range(row.receivedAt, params[1], params[2]) || row.receivedAt == null || Number(row.receivedAt) <= Number(params[3]));
    if (table === "ops_chat_messages") rows = rows.filter(row => before(row.createdAt, params[3], true));
    if (table === "openphone_call_recordings") rows = rows.filter(row => range(row.callStartedAt, params[1], params[2]) || row.callStartedAt == null);
    if (table === "voice_calls" || table === "gmail_thread_meta") rows = rows.filter(row => before(row.createdAt, params[1], true));
    if (table === "call_log" || table === "confirmation_calls") rows = rows.filter(row => range(row.firedAt, params[1], params[2]) || (row.firedAt == null || Number(row.firedAt) <= Number(params[3])) && before(row.createdAt, params[4], true));
    if (table === "field_mgmt_calls") rows = rows.filter(row => range(row.completedAt, params[1], params[2]) || before(row.createdAt, params[3], true));
    if (table === "madison_email_drafts") rows = rows.filter(row => range(row.createdAt, params[1], params[2]));
    if (!this.nonadvancing.has(table)) rows = rows.filter(row => BigInt(String(row.id)) > BigInt(String(params[0])));
    rows.sort((a, b) => Number(a.id) - Number(b.id));
    return rows.slice(0, Number(params.at(-1)));
  }
}
const session = (id: number, history: unknown[], overrides: Record<string, unknown> = {}): SqlRow => ({ id, leadPhone: phone, leadName: "Customer", messageHistory: JSON.stringify(history), createdAt: date(old), updatedAt: date(late), ...overrides });
const sms = (id: number, body = "The kitchen is still dirty", overrides: Record<string, unknown> = {}): SqlRow => ({ id, fromPhone: phone, toPhone: line, message: body, openPhoneMessageId: `SM${id}`, receivedAt: ms(monday), createdAt: date(monday), ...overrides });
const call = (id: number, overrides: Record<string, unknown> = {}): SqlRow => ({ id, vapiCallId: `vapi-${id}`, callerPhone: phone, calledPhone: phone, calledTarget: "client", transcript: "Customer: The kitchen is still dirty\nAssistant: I can help", createdAt: date(monday), ...overrides });
function evidence(overrides: Partial<TeamEvidence> = {}): TeamEvidence {
  return { id: "evidence-1", revision: "a".repeat(64), sourceKind: "sms", store: "conversation_sessions", sourceRowId: "1", providerId: "SM1", sessionId: "1", threadId: null,
    originalText: "The kitchen is still dirty", occurredAtUtc: monday, observedAtUtc: monday, timeBasis: "original", bodyBasis: "original", speakerBasis: "customer",
    customerPhone: phone, customerEmail: null, customerName: "Customer", businessLine: line, mailboxEmail: null, limitations: [], ...overrides };
}
function emailTurn(id: string, at: string, overrides: Partial<CustomerEmailTurn> = {}): CustomerEmailTurn {
  return { id, threadId: "thread-1", fromEmail: "customer@example.test", fromName: "Customer", to: "office@example.test", replyToEmail: null,
    subject: "Quality", text: "The kitchen is still dirty", html: "", createdAt: ms(at), headers: {
      From: "Customer <customer@example.test>", To: "office@example.test", Subject: "Quality", "Message-ID": `<${id}@example.test>`,
    }, labelIds: ["INBOX"], ...overrides };
}
function emailReceipt(id: number, messages: CustomerEmailTurn[]): SqlRow {
  const snapshot: CustomerEmailSnapshot = { mailboxEmail: "office@example.test", threadId: "thread-1", messages };
  const binding = customerEmailBinding(snapshot, messages.at(-1)!.id, ms(late));
  if (!binding) throw new Error("bad email test fixture");
  return { id, quickAction: "claude_customer_email_receipt", channel: "instinct_email_receipts", createdAt: date(late), lastActivityAt: ms(late), sessionId: null,
    activeDedupKey: `ce-receipt:v1:${hash([binding.mailboxEmail, binding.threadId, binding.inboundMessageId])}`,
    metadata: JSON.stringify({ version: 1, type: "receipt", binding, phase: "sent", taskId: null, replyText: null, providerMessageId: null, code: null }) };
}
function staffReceipt(id: number, overrides: Record<string, unknown> = {}): SqlRow {
  const source = { recordingId: 7, providerCallId: "AC-call", sessionId: null, callerPhone: phone, callerName: "Customer", receivedAt: ms(monday),
    transcript: "Unattributed: The kitchen is still dirty", evidenceSegments: ["The kitchen is still dirty"], transcriptSource: "saved", evidenceScope: "call_transcript",
    recordingUrl: "https://example.test/recording.mp3", businessPhoneNumberId: "PN-line", businessPhoneNumber: line, staffUserId: "US-staff", direction: "incoming", ...overrides };
  return { id, quickAction: "claude_staff_call_receipt", channel: "instinct_staff_call", createdAt: date(friday), sessionId: null,
    activeDedupKey: `sc-receipt:v1:${createHash("sha256").update(String(source.providerCallId)).digest("hex")}`,
    metadata: JSON.stringify({ version: 1, providerCallId: source.providerCallId, recordingId: source.recordingId, fingerprint: hash(source), phase: "no_task", taskId: null, code: null, sourceSnapshot: source }) };
}
function visit(id: number, overrides: Record<string, unknown> = {}): SqlRow {
  return { id, origin: "launch27_import", bookingId: null, launch27BookingId: 900 + id, jobDate: "2026-11-10", serviceDateTime: "2026-11-10T14:00:00Z",
    bookingStatus: "assigned", customerName: "Customer", customerPhone: "(703) 555-1234", customerEmail: "customer@example.test", jobAddress: "100 Test St", teamId: 70, teamName: "Original Team",
    updatedAt: date(friday), customerRating: 2, progressStatus: "completed", progressTeamId: 70, progressUpdatedAt: date("2026-11-10T17:00:00Z"), etaTimestamp: ms("2026-11-10T13:30:00Z"),
    signoffTeamId: 70, signedOffAt: date("2026-11-10T16:45:00Z"), publicBookingNumber: null, bookingCustomerPhone: null, bookingCustomerEmail: null, ...overrides };
}

describe("weekly retained evidence reader (offline)", () => {
  it("exhausts 237 sessions and preserves Sunday evidence older than 48 hours", async () => {
    const port = new FakePort(); port.tables.conversation_sessions = Array.from({ length: 237 }, (_, i) => session(i + 1, [{ role: "user", content: `Sunday original ${i}`, timestamp: sunday }]));
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.evidence).toHaveLength(237); expect(result.window).toEqual(window);
    expect(result.collectionComplete).toBe(true);
    expect(result.families.find(f => f.store === "conversation_sessions")).toMatchObject({ scannedRows: 237, evidenceItems: 237, exhausted: true, status: "read" });
    const calls = port.calls.filter(c => sourceTable(c.sql) === "conversation_sessions");
    expect(calls.map(c => c.params[0])).toEqual(["0", "100", "200", "237"]);
    expect(calls.every(c => /`createdAt` < \?/.test(c.sql) && /`updatedAt` >= \?/.test(c.sql) && !/`updatedAt`\s*</.test(c.sql))).toBe(true);
  });
  it("uses original message timestamps, exact half-open week boundaries, and old sessions updated after week end", async () => {
    const port = new FakePort(); port.tables.conversation_sessions = [session(1, [
      { role: "user", content: "Before", ts: ms(window.startInclusiveUtc) - 1 },
      { role: "user", content: "At start", ts: ms(window.startInclusiveUtc) },
      { role: "assistant", content: "Staff outbound", ts: ms(monday) },
      { role: "user", content: "At last millisecond", ts: ms(window.endExclusiveUtc) - 1 },
      { role: "user", content: "At end excluded", ts: ms(window.endExclusiveUtc) },
      { role: "user", content: "After excluded", ts: ms(late) },
    ])];
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.evidence.map(e => e.originalText)).toEqual(["At start", "Staff outbound", "At last millisecond"]);
    expect(result.evidence.find(e => e.originalText === "Staff outbound")?.speakerBasis).toBe("non_customer");
    expect(result.evidence.every(e => e.revision.match(/^[a-f0-9]{64}$/) && e.id.startsWith("team-evidence:"))).toBe(true);
  });
  it("clips a current week to capture and never includes messages at/after capture", async () => {
    const capture = new Date("2026-11-19T17:00:00Z"), port = new FakePort();
    port.tables.conversation_sessions = [session(1, [{ role: "user", content: "Earlier", ts: ms(monday) }, { role: "user", content: "At capture", ts: capture.getTime() }])];
    const result = await readTeamEvidenceWeek(port, input, capture);
    expect(result.evidence.map(e => e.originalText)).toEqual(["Earlier"]);
    expect(result.window.endExclusiveUtc).toBe(capture.toISOString());
  });
  it("withholds undated bodies, records malformed-history gaps, and marks conflicting endpoints unverified", async () => {
    const port = new FakePort(); port.tables.conversation_sessions = [session(1, [{ role: "user", content: "Undated complaint" }, { role: "user", content: "Bad date", ts: "2026-11-16" },
      { role: "user", content: "Conflict", ts: ms(monday), fromPhone: "+17035550000", toPhone: line }]), { ...session(2, []), messageHistory: "invalid-json" }];
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.evidence.some(e => e.originalText === "Undated complaint" || e.originalText === "Bad date")).toBe(false);
    expect(result.evidence.filter(e => e.originalText === null)).toHaveLength(2);
    expect(result.evidence.find(e => e.originalText === "Conflict")).toMatchObject({ speakerBasis: "unverified", occurredAtUtc: monday });
    expect(result.limitations.join(" ")).toContain("missing/invalid original timestamps");
  });
  it("exhausts inbound SMS and deduplicates only identical provider/contact/text/time with conflicts retained", async () => {
    const port = new FakePort(); port.tables.inbound_sms = Array.from({ length: 130 }, (_, i) => sms(i + 1));
    port.tables.inbound_sms.push(sms(131, "The kitchen is still dirty", { openPhoneMessageId: "SM1" }), sms(132, "Different original", { openPhoneMessageId: "SM1" }), sms(133, "Different contact", { openPhoneMessageId: "SM1", fromPhone: "+17035550000" }));
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.families.find(f => f.store === "inbound_sms")).toMatchObject({ scannedRows: 133, exhausted: true, status: "read" });
    expect(result.evidence).toHaveLength(132);
    const repeated = result.evidence.filter(e => e.providerId === "SM1"); expect(repeated).toHaveLength(3);
    expect(repeated.every(e => e.limitations.join(" ").includes("Conflicting provider"))).toBe(true);
    expect(repeated.some(e => e.limitations.join(" ").includes("Exact provider duplicate"))).toBe(true);
    expect(result.evidence.every(e => e.occurredAtUtc === null && e.timeBasis === "received" && e.observedAtUtc === monday)).toBe(true);
  });
  it("does not erase session originals with observation-only SMS or invent timestamp equivalence", async () => {
    const port = new FakePort(); port.tables.conversation_sessions = [session(1, [{ role: "user", content: "The kitchen is still dirty", ts: ms(monday), opMsgId: "SM1" }])];
    port.tables.inbound_sms = [sms(1)];
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.evidence).toHaveLength(2); expect(result.evidence.some(e => e.timeBasis === "original")).toBe(true);
    expect(result.evidence.some(e => e.timeBasis === "received")).toBe(true);
  });
  it("uses original receipt snapshot dates even when latest inbound/receipt activity is after the week", async () => {
    const port = new FakePort(); port.tables["ops_chat_messages:claude_customer_email_receipt"] = [emailReceipt(1, [emailTurn("m1", sunday), emailTurn("m2", monday), emailTurn("m3", late)])];
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.evidence.map(e => e.providerId)).toEqual(["m1", "m2"]);
    expect(result.evidence.every(e => e.bodyBasis === "original" && e.speakerBasis === "customer" && e.customerEmail === "customer@example.test")).toBe(true);
    expect(port.calls.filter(c => sourceTable(c.sql) === "ops_chat_messages").every(c => !/lastActivityAt|phase/.test(c.sql.split(" WHERE ")[1]))).toBe(true);
  });
  it("does not trust invalid email bindings and returns independent partial snippet/draft gaps", async () => {
    const port = new FakePort(), receipt = emailReceipt(1, [emailTurn("m1", monday)]);
    const metadata = JSON.parse(String(receipt.metadata)); metadata.binding.fromEmail = "forged@example.test";
    port.tables["ops_chat_messages:claude_customer_email_receipt"] = [{ ...receipt, metadata: JSON.stringify(metadata) }];
    port.tables.gmail_thread_meta = [{ id: 1, threadId: "thread-1", senderEmail: "customer@example.test", snippet: "Partial snippet", lastMessageAt: ms(late), messageCount: 5, createdAt: date(old), updatedAt: date(late) }];
    port.tables.madison_email_drafts = [{ id: 1, threadId: "thread-1", inboundMessageId: "m1", fromEmail: "customer@example.test", originalMessage: "Draft snapshot", createdAt: date(monday), updatedAt: date(late) }];
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.evidence.some(e => e.bodyBasis === "original")).toBe(false);
    expect(result.evidence.find(e => e.originalText === "Partial snippet")).toMatchObject({ sourceKind: "email", bodyBasis: "snippet", occurredAtUtc: null, speakerBasis: "unverified" });
    expect(result.evidence.find(e => e.originalText === "Draft snapshot")).toMatchObject({ bodyBasis: "snapshot", occurredAtUtc: null });
    expect(result.limitations.join(" ")).toContain("binding is invalid");
  });
  it("does not duplicate already covered email snapshot with a draft or matching complete thread count", async () => {
    const port = new FakePort(); port.tables["ops_chat_messages:claude_customer_email_receipt"] = [emailReceipt(1, [emailTurn("m1", monday)])];
    port.tables.gmail_thread_meta = [{ id: 1, threadId: "thread-1", messageCount: 1, createdAt: date(monday), lastMessageAt: ms(monday) }];
    port.tables.madison_email_drafts = [{ id: 1, threadId: "thread-1", inboundMessageId: "m1", fromEmail: "customer@example.test", originalMessage: "Partial", createdAt: date(monday) }];
    const result = await readTeamEvidenceWeek(port, input, now); expect(result.evidence).toHaveLength(1); expect(result.evidence[0].bodyBasis).toBe("original");
  });
  it("reads every call family, using occurrence rather than later record creation where available", async () => {
    const port = new FakePort();
    port.tables.openphone_call_recordings = [{ id: 7, sessionId: 1, openphoneCallId: "AC-call", callerPhone: phone, direction: "incoming", transcript: JSON.stringify([{ identifier: phone, content: "The kitchen is still dirty", start: 0, end: 5 }]), callStartedAt: date(monday), createdAt: date(late) },
      { id: 8, openphoneCallId: "AC-old", callerPhone: phone, transcript: JSON.stringify([{ content: "Old call" }]), callStartedAt: date(old), createdAt: date(monday) }];
    port.tables.voice_calls = [call(1)];
    port.tables.call_log = [call(1, { firedAt: ms(sunday), createdAt: date(late), transcriptEnglish: "Different translation" }), call(2, { firedAt: ms(old), createdAt: date(monday) }), call(3, { firedAt: ms(monday), calledTarget: "team" })];
    port.tables.field_mgmt_calls = [call(1, { completedAt: date(friday), createdAt: date(old), step: "eta_call" })];
    port.tables.confirmation_calls = [call(1, { firedAt: ms(monday), createdAt: date(late), leadflowJobId: 33 })];
    const result = await readTeamEvidenceWeek(port, input, now);
    for (const store of ["openphone_call_recordings", "voice_calls", "call_log", "field_mgmt_calls", "confirmation_calls"]) expect(result.evidence.some(e => e.store === store)).toBe(true);
    expect(result.evidence.some(e => e.providerId === "AC-old")).toBe(false);
    expect(result.evidence.some(e => e.store === "call_log" && e.sourceRowId === "2")).toBe(false);
    expect(result.evidence.find(e => e.store === "openphone_call_recordings")).toMatchObject({ occurredAtUtc: monday, sourceKind: "phone_unverified", speakerBasis: "unverified" });
    expect(result.evidence.find(e => e.store === "voice_calls")).toMatchObject({ occurredAtUtc: null, timeBasis: "stored" });
    expect(result.evidence.find(e => e.store === "field_mgmt_calls")).toMatchObject({ occurredAtUtc: null, observedAtUtc: friday });
    expect(result.evidence.find(e => e.originalText === "Different translation")).toMatchObject({ bodyBasis: "snapshot", speakerBasis: "unverified" });
    expect(result.evidence.find(e => e.store === "call_log" && e.sourceRowId === "3")).toMatchObject({ speakerBasis: "non_customer", customerPhone: null });
  });
  it("exposes old/late observation-only call gaps, invalid receivedAt, and malformed Quo originals without fabricated dates", async () => {
    const port = new FakePort();
    port.tables.inbound_sms = [sms(1, "Undated SMS withheld", { receivedAt: 0 })];
    port.tables.openphone_call_recordings = [{ id: 7, openphoneCallId: "AC-bad", callerPhone: phone, callStartedAt: date(monday), createdAt: date(monday), transcript: "malformed" }];
    port.tables.voice_calls = [call(1, { createdAt: date(late) }), call(2, { createdAt: date(old) })];
    port.tables.field_mgmt_calls = [call(1, { createdAt: date(old), completedAt: date(late) })];
    port.tables.call_log = [call(1, { createdAt: date(late), firedAt: 0 })];
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.evidence.every(e => e.occurredAtUtc === null || e.store === "openphone_call_recordings")).toBe(true);
    expect(result.evidence.every(e => e.originalText === null)).toBe(true);
    for (const store of ["inbound_sms", "openphone_call_recordings", "voice_calls", "field_mgmt_calls", "call_log"]) expect(result.evidence.some(e => e.store === store)).toBe(true);
    expect(result.evidence.filter(e => e.store === "voice_calls")).toHaveLength(2);
    expect(result.limitations.join(" ")).toContain("membership cannot be established");
  });
  it("preserves both original MIME text and HTML body variants without stripping original formatting", async () => {
    const port = new FakePort(); port.tables["ops_chat_messages:claude_customer_email_receipt"] = [emailReceipt(1, [emailTurn("m1", monday, { text: " Exact plain original \n", html: "<div>Exact HTML original</div>" })])];
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.evidence.map(e => e.originalText).sort()).toEqual([" Exact plain original \n", "<div>Exact HTML original</div>"].sort());
    expect(result.evidence.every(e => e.bodyBasis === "original" && e.occurredAtUtc === monday)).toBe(true);
    expect(result.evidence.some(e => e.limitations.join(" ").includes("Original body is HTML"))).toBe(true);
  });
  it("uses validated immutable staff receipt provenance without authenticating speakers, retaining transcript variants", async () => {
    const port = new FakePort(); port.tables.openphone_call_recordings = [{ id: 7, openphoneCallId: "AC-call", callerPhone: phone, direction: "incoming", callStartedAt: date(monday), createdAt: date(monday), transcript: JSON.stringify([{ content: "Different newer transcript" }]) }];
    port.tables["ops_chat_messages:claude_staff_call_receipt"] = [staffReceipt(1)];
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.evidence.filter(e => e.providerId === "AC-call")).toHaveLength(2);
    expect(result.evidence.find(e => e.store.includes("staff_call_receipts"))).toMatchObject({ sourceKind: "human_call", speakerBasis: "unverified", bodyBasis: "snapshot", occurredAtUtc: monday });
    expect(result.evidence.find(e => e.store.includes("staff_call_receipts"))?.limitations.join(" ")).toContain("US-staff");
  });
  it("null staffUserId does not establish known human handling; bad receipt fingerprint is a gap", async () => {
    const port = new FakePort(); port.tables.openphone_call_recordings = [{ id: 7, openphoneCallId: "AC-call", callerPhone: phone, direction: "incoming", callStartedAt: date(monday), createdAt: date(monday), transcript: null }];
    const bad = staffReceipt(2), metadata = JSON.parse(String(bad.metadata)); metadata.fingerprint = "0".repeat(64);
    port.tables["ops_chat_messages:claude_staff_call_receipt"] = [staffReceipt(1, { staffUserId: null }), { ...bad, metadata: JSON.stringify(metadata) }];
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.evidence.filter(e => e.store.includes("staff_call_receipts") && e.originalText)).toHaveLength(1);
    expect(result.evidence.find(e => e.store.includes("staff_call_receipts") && e.originalText)?.sourceKind).toBe("phone_unverified");
    expect(result.limitations.join(" ")).toContain("fingerprint conflicts");
  });
  it("failed source is unavailable/incomplete, while independently read zero-row families are exhausted", async () => {
    const port = new FakePort(); port.failures.add("field_mgmt_calls");
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.collectionComplete).toBe(false);
    expect(result.families.find(f => f.store === "field_mgmt_calls")).toMatchObject({ status: "unavailable", exhausted: false, scannedRows: 0, limitations: ["DB_SCHEMA"] });
    expect(result.families.filter(f => f.store !== "field_mgmt_calls").every(f => f.status === "read" && f.exhausted && f.scannedRows === 0)).toBe(true);
    expect(result.evidence.some(e => e.store === "field_mgmt_calls" && e.originalText === null)).toBe(true);
    expect(result.limitations.join(" ")).not.toContain("secret connection details");
  });
  it("guards nonadvancing keyset cursors instead of hanging or declaring completeness", async () => {
    const port = new FakePort(); port.tables.conversation_sessions = [session(1, [{ role: "user", content: "Original", ts: ms(monday) }])]; port.nonadvancing.add("conversation_sessions");
    const result = await readTeamEvidenceWeek(port, input, now);
    expect(result.collectionComplete).toBe(false); expect(result.limitations.join(" ")).toContain("NONADVANCING_SOURCE_CURSOR");
    expect(port.calls.filter(c => sourceTable(c.sql) === "conversation_sessions")).toHaveLength(2);
  });
});

describe("retained visit history reader (offline)", () => {
  it("exhausts more than 100 all-date prior visits, joins completion/public identity, and retains historical assignment intervals", async () => {
    const port = new FakePort(); port.tables.scheduling_teams = [{ id: 2, name: "Current Team", launch27TeamId: 70 }, { id: 70, name: "Numeric collision unrelated", launch27TeamId: 200 }];
    port.tables.leadflow_jobs = Array.from({ length: 137 }, (_, i) => visit(i + 1, { bookingId: 5, origin: "native_booking", launch27BookingId: null, teamId: 2, publicBookingNumber: "LF-0005" }));
    port.tables.booking_assignments = Array.from({ length: 121 }, (_, i) => ({ id: i + 1, bookingId: 5, teamId: 2, teamName: "Historical Team", status: "unassigned", assignedAt: date(old), unassignedAt: date(monday) }));
    const result = await readTeamEvidenceVisitHistory(port, [evidence()], window);
    expect(result.complete).toBe(true); expect(result.visits).toHaveLength(137); expect(result.assignments).toHaveLength(121);
    expect(result.visits[0]).toMatchObject({ publicBookingNumber: "LF-0005", progressStatus: "completed", bookingStatus: "assigned", storedTeamId: 2, progressTeamId: 2, signoffTeamId: 2 });
    expect(result.assignments[0]).toMatchObject({ assignedAtUtc: old, unassignedAtUtc: monday, status: "unassigned", teamId: 2 });
    const reads = port.calls.filter(c => sourceTable(c.sql) === "leadflow_jobs");
    expect(reads[0].sql).toContain("LEFT JOIN `cleaner_portal_job_progress`");
    expect(reads[0].sql).toContain("LEFT JOIN `cleaner_portal_job_signoffs`");
    expect(reads[0].sql).toContain("LEFT JOIN `bookings`");
    expect(reads[0].sql).not.toMatch(/GROUP BY|jobDate`\s*>=|LIMIT 50|completedAt/i);
    expect(reads[0].params).not.toContain(window.weekStart);
    expect(reads.map(c => c.params[0])).toEqual(["0", "100", "137"]);
  });
  it("maps imported/portal IDs by Launch27 identity, not numerically coincident scheduling ID or team name", async () => {
    const port = new FakePort(); port.tables.scheduling_teams = [{ id: 2, name: "Local", launch27TeamId: 70 }, { id: 70, name: "Original Team", launch27TeamId: 200 }];
    port.tables.leadflow_jobs = [visit(1), visit(2, { origin: "native_booking", bookingId: 5, launch27BookingId: null, teamId: 70, progressTeamId: null, signoffTeamId: null })];
    const result = await readTeamEvidenceVisitHistory(port, [evidence()], window);
    expect(result.visits.find(v => v.id === 1)).toMatchObject({ storedTeamId: 2, progressTeamId: 2, signoffTeamId: 2 });
    expect(result.visits.find(v => v.id === 2)?.storedTeamId).toBe(70);
  });
  it("retains date-only serviceStart null and actual stored states without invented completion timestamps", async () => {
    const port = new FakePort(); port.tables.scheduling_teams = [{ id: 2, name: "Local", launch27TeamId: 70 }];
    port.tables.leadflow_jobs = [visit(1, { serviceDateTime: "2026-11-10" }), visit(2, { serviceDateTime: null, progressStatus: "started", signedOffAt: null }), visit(3, { jobDate: "2026-11-25", serviceDateTime: null }), visit(4, { jobDate: "2026-11-21", serviceDateTime: "2026-11-22T05:00:00Z" })];
    const result = await readTeamEvidenceVisitHistory(port, [evidence()], window);
    expect(result.visits.map(v => v.id)).toEqual([1, 2]);
    expect(result.visits.every(v => v.serviceStartUtc === null && !("completedAt" in v))).toBe(true);
    expect(result.visits[1].progressStatus).toBe("started");
    expect(result.limitations.join(" ")).toContain("date-only/invalid service start retained as null");
  });
  it("preserves stored native canonical completion without converting operational update or ETA to completedAt", async () => {
    const port = new FakePort(); port.tables.scheduling_teams = [{ id: 2, name: "Local", launch27TeamId: 70 }];
    port.tables.leadflow_jobs = [visit(1, { bookingId: 5, launch27BookingId: null, origin: "native_booking", teamId: 2, canonicalBookingStatus: "completed", canonicalRequestedLocalDate: "2026-11-10", bookingStatus: "assigned", progressStatus: null, progressTeamId: null, signoffTeamId: null }),
      visit(2, { bookingId: 5, launch27BookingId: null, origin: "leadflow_recurrence", jobDate: "2026-11-17", serviceDateTime: "2026-11-17T14:00:00Z", teamId: 2, canonicalBookingStatus: "completed", canonicalRequestedLocalDate: "2026-11-10", bookingStatus: "assigned", progressStatus: null, progressTeamId: null, signoffTeamId: null })];
    const result = await readTeamEvidenceVisitHistory(port, [evidence()], window);
    expect(result.visits[0].bookingStatus).toBe("completed"); expect(result.visits[0]).not.toHaveProperty("completedAt");
    expect(result.visits[1].bookingStatus).toBe("assigned");
    expect(result.limitations.join(" ")).toContain("native bookingStatus uses stored bookings.status");
  });
  it("retains date-only same-day uncertainty on current-week reads for parent matcher review", async () => {
    const current: TeamEvidenceWindow = resolveTeamEvidenceWindow(input, new Date("2026-11-19T17:00:00Z")), port = new FakePort();
    port.tables.scheduling_teams = [{ id: 2, name: "Local", launch27TeamId: 70 }]; port.tables.leadflow_jobs = [visit(1, { jobDate: "2026-11-19", serviceDateTime: null })];
    const result = await readTeamEvidenceVisitHistory(port, [evidence()], current);
    expect(result.visits).toHaveLength(1); expect(result.visits[0].serviceStartUtc).toBeNull();
  });
  it("uses canonical phone normalization or lowercase email after coarse narrowing and never groups same-name people", async () => {
    const port = new FakePort(); port.tables.scheduling_teams = [{ id: 2, name: "Local", launch27TeamId: 70 }];
    port.tables.leadflow_jobs = [visit(1, { customerPhone: "+1 (703) 555-1234" }), visit(2, { customerPhone: "+17035550000", customerEmail: "other@example.test" }), visit(3, { customerPhone: null, customerEmail: "CUSTOMER@EXAMPLE.TEST" })];
    const result = await readTeamEvidenceVisitHistory(port, [evidence(), evidence({ id: "email1", customerPhone: null, customerEmail: "CUSTOMER@EXAMPLE.TEST" })], window);
    expect(result.visits.map(v => v.id)).toEqual([1, 3]);
    expect(port.calls.filter(c => sourceTable(c.sql) === "leadflow_jobs")).toHaveLength(4);
  });
  it("ambiguous imported map is a limitation instead of a name-based guess; history failure is incomplete", async () => {
    const port = new FakePort(); port.tables.scheduling_teams = [{ id: 2, name: "Same name", launch27TeamId: 70 }, { id: 3, name: "Same name", launch27TeamId: 70 }]; port.tables.leadflow_jobs = [visit(1, { bookingId: 5 })]; port.failures.add("booking_assignments");
    const result = await readTeamEvidenceVisitHistory(port, [evidence()], window);
    expect(result.visits[0].storedTeamId).toBeNull(); expect(result.complete).toBe(false);
    expect(result.limitations.join(" ")).toContain("ambiguous scheduling mapping"); expect(result.limitations.join(" ")).toContain("booking_assignments: DB_SCHEMA");
  });
  it("makes no contact/name-wide visit reads when evidence has no usable contact", async () => {
    const port = new FakePort(); const result = await readTeamEvidenceVisitHistory(port, [evidence({ customerPhone: null, customerEmail: null })], window);
    expect(result).toEqual({ visits: [], teams: [], assignments: [], complete: true, limitations: [] }); expect(port.calls).toHaveLength(0);
  });
  it("new reader imports only passive helpers, uses literal read-only projections and no legacy dependency", () => {
    const source = readFileSync(new URL("./teamLeaderboardEvidenceRead.ts", import.meta.url), "utf8");
    const forbiddenTable = ["cleaner", "jobs"].join("_"); const forbiddenSymbol = ["cleaner", "Jobs"].join("");
    expect(source).not.toContain(forbiddenTable); expect(source).not.toContain(forbiddenSymbol);
    expect(source).not.toMatch(/from ["'][^"']*(?:drizzle|\/schema|\/db|openphone|AgentClient|sending)["']/);
    expect(source).not.toMatch(/getDb\(|getPool\(|fetch\(|\.snapshot\(|\.query\(|\.execute\(/);
  });
});
