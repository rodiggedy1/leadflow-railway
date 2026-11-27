// Unverified receiving line against a REAL local TiDB (fictional data only): the real task store, session reader and
// reply pipeline. Runs only when CUSTOMER_SMS_TEST_DB points at a local throwaway database
// (for example mysql://root@127.0.0.1:4015/leadflow_test); skipped otherwise. Nothing is sent: send is a test double.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import { createClaudeCustomerSmsService, type CustomerSmsInput } from "./claudeCustomerSms";
import { createClaudeCustomerTasksStore, UNVERIFIED_RECEIVING_LINE } from "./claudeCustomerTasksStore";
import { createAlternativeSessionReader } from "./claudeSmsAlternativeSessionRead";

const url = process.env.CUSTOMER_SMS_TEST_DB;
const local = Boolean(url && /^mysql:\/\/[^@]*@127\.0\.0\.1:\d+\//.test(url));
const run = local ? describe : describe.skip;
let pool: mysql.Pool, db: any;
const LINE = "PN-cs-test", BUSINESS = "+12025550999";
const createdAt = "2026-11-16T18:00:00Z", at = Date.parse(createdAt);
let seq = 0;
const newPhone = () => `+1202555${String(1000 + ++seq).slice(-4)}`;
const rows = (result: unknown): any[] => (result as any)[0];

async function conversation(phone: string, turns: unknown[], extra: { smsOptOut?: number } = {}) {
  const [result] = await pool.query("INSERT INTO conversation_sessions (leadPhone, leadName, leadSource, stage, lastInboundPhoneNumberId, messageHistory, smsOptOut, createdAt, updatedAt) VALUES (?, ?, 'cs-inbound', 'OPEN', ?, ?, ?, NOW(), NOW())",
    [phone, "Maya Test", LINE, JSON.stringify(turns), extra.smsOptOut ?? 0]) as any;
  return Number(result.insertId);
}
const text = (id: string, content: string, ts = at + 1000) => ({ role: "user", content, ts, opMsgId: id });
const event = (sessionId: number, phone: string, id: string, content: string): CustomerSmsInput =>
  ({ sessionId, providerMessageId: id, fromPhone: phone, receivingPhoneNumberId: LINE, inboundText: content, createdAt, receivedAt: at + 1000, isCleaner: false, direction: "incoming" });
async function appendTurn(sessionId: number, turn: unknown) {
  await pool.query("UPDATE conversation_sessions SET messageHistory = JSON_ARRAY_APPEND(messageHistory, '$', CAST(? AS JSON)) WHERE id = ?", [JSON.stringify(turn), sessionId]);
}
const tasks = async (sessionId: number) => rows(await pool.query("SELECT id, body, metadata, activeDedupKey FROM ops_chat_messages WHERE quickAction = 'claude_customer_task' AND sessionId = ?", [sessionId]))
  .map(row => ({ ...row, task: (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata).task }));
const attempts = async (id: string) => rows(await pool.query("SELECT id, status, errorCode FROM madison_sms_drafts WHERE inboundOpenPhoneId = ?", [id]));

function pipeline(readReceivingLine: (id: string) => Promise<string>, generateOverride?: (binding: any) => Promise<any>) {
  const reader = createAlternativeSessionReader({ getDatabase: async () => db });
  const readSession = async (id: number) => {
    const context = await reader(id); if (!context) return null;
    const [r] = rows(await db.execute(sql`SELECT leadSource, smsOptOut, csQueue FROM conversation_sessions WHERE id = ${id}`));
    return { ...context, leadSource: r.leadSource, smsOptOut: r.smsOptOut, csQueue: r.csQueue };
  };
  const generate = vi.fn(generateOverride ?? (async (binding: any) => ({ replyText: "Thanks, our team will look into this and follow up.",
    task: { title: "Follow up with the customer", items: [{ title: "Follow up", evidenceQuote: binding.inboundText }] } })));
  const send = vi.fn(async () => ({ success: true, messageId: `AC-out-${++seq}` }));
  const onFailure = vi.fn(async (_detail: { taskId: number | null; code: string; sessionId: number }) => undefined);
  const service = createClaudeCustomerSmsService({ config: () => ({ startAt: at - 1000, allowedPhone: "", testCustomerOverride: false }),
    readSession, readReceivingLine: vi.fn(readReceivingLine), generate, store: createClaudeCustomerTasksStore(db), send, onFailure, onTaskChange: async () => undefined });
  return { service, generate, send, onFailure };
}
const lineDown = async () => { throw new Error("RECEIVING_LINE_UNAVAILABLE"); };
let logSpy: ReturnType<typeof vi.spyOn>;
const reviewLines = () => logSpy.mock.calls.map(args => { try { return JSON.parse(String(args[0])); } catch { return null; } })
  .filter(line => line?.reason === "REVIEW_TASK_SKIPPED" || line?.reason === "REVIEW_TASK_CREATED" || line?.reason === "REVIEW_TASK_FAILED");

run("unverified receiving line on a real local TiDB", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    pool = mysql.createPool({ uri: url! });
    db = drizzle(pool);
    // Local throwaway test database only (the address check above refuses anything but 127.0.0.1).
    for (const table of ["conversation_sessions", "madison_sms_drafts", "ops_chat_messages", "sms_opt_outs"]) await pool.query(`DELETE FROM \`${table}\``);
  });
  afterAll(async () => { await pool?.end(); });
  beforeEach(() => { logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined); return () => logSpy.mockRestore(); });

  it("creates exactly one existing-style review task with the line marked unverified; nothing generated or sent", async () => {
    const phone = newPhone(), id = "AC-line-1", body = "I was charged $266 when I shouldn’t have. Please undo this.";
    const sid = await conversation(phone, [{ role: "assistant", content: "Your cleaning is confirmed", ts: at - 86_400_000, opMsgId: "AC-old" }, text(id, body)]);
    const p = pipeline(lineDown);
    expect(await p.service(event(sid, phone, id, body))).toEqual({ outcome: "failed" });
    const [t, ...more] = await tasks(sid);
    expect(more).toHaveLength(0);
    expect(t.body).toBe("Review customer message after reply failure");
    expect(t.task).toMatchObject({ status: "unclaimed", sourceMessageId: id, sourceText: body, customerPhone: phone,
      receivingPhoneNumberId: LINE, receivingPhoneNumber: UNVERIFIED_RECEIVING_LINE,
      reply: { text: "No customer reply was submitted.", status: "suppressed", providerMessageId: null },
      items: [{ id: "item-1", title: "Review the unanswered customer message and follow up", evidenceQuote: body, completedBy: null }] });
    expect(await attempts(id)).toEqual([]);
    expect(p.generate).not.toHaveBeenCalled(); expect(p.send).not.toHaveBeenCalled();
    expect(p.onFailure.mock.calls).toEqual([[{ taskId: t.id, code: "RECEIVING_LINE_UNAVAILABLE", sessionId: sid }]]);
  });

  it("duplicate webhook delivery reaching the pipeline 5 times at once: one task, the others skipped, owner alerted each time", async () => {
    const phone = newPhone(), id = "AC-dup-1", body = "Please call me about my bill";
    const sid = await conversation(phone, [text(id, body)]);
    const p = pipeline(lineDown);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => p.service(event(sid, phone, id, body))));
    expect(results).toEqual(Array(5).fill({ outcome: "failed" }));
    expect(await tasks(sid)).toHaveLength(1);
    expect(reviewLines().map(line => line.reason).sort()).toEqual(["REVIEW_TASK_CREATED", ...Array(4).fill("REVIEW_TASK_SKIPPED")]);
    expect(reviewLines().filter(line => line.exclusion).map(line => line.exclusion)).toEqual(Array(4).fill("TASK_EXISTS"));
    expect(p.onFailure).toHaveBeenCalledTimes(5); expect(p.send).not.toHaveBeenCalled();
  });

  it("two texts close together: the first's lookup fails while the second arrives; the first gets a review task, the second is answered", async () => {
    const phone = newPhone(), a = "AC-burst-a", b = "AC-burst-b";
    const sid = await conversation(phone, [text(a, "I was charged twice")]);
    // While A's lookup is failing, B's webhook stores B in the conversation.
    const first = pipeline(async () => { await appendTurn(sid, text(b, "Please refund one of them", at + 2000)); throw new Error("RECEIVING_LINE_UNAVAILABLE"); });
    expect(await first.service(event(sid, phone, a, "I was charged twice"))).toEqual({ outcome: "failed" });
    expect(reviewLines().map(line => line.reason)).toEqual(["REVIEW_TASK_CREATED"]);
    const second = pipeline(async () => BUSINESS);
    expect(await second.service({ ...event(sid, phone, b, "Please refund one of them"), receivedAt: at + 2000 })).toEqual({ outcome: "accepted" });
    expect(second.send).toHaveBeenCalledTimes(1); expect(first.send).not.toHaveBeenCalled();
    const all = await tasks(sid);
    // A's failure stays visible (review task, line unverified); B has its normal task. Only B's reply was sent.
    expect(all.map(row => row.task.sourceMessageId).sort()).toEqual([a, b].sort());
    expect(all.find(row => row.task.sourceMessageId === a)!.task).toMatchObject({ receivingPhoneNumber: UNVERIFIED_RECEIVING_LINE, reply: { status: "suppressed" } });
  });

  it("a reply sent after the text no longer hides the failure: the review task is created", async () => {
    const phone = newPhone(), id = "AC-replied", body = "Is my cleaner coming today?";
    const sid = await conversation(phone, [text(id, body)]);
    const p = pipeline(async () => { await appendTurn(sid, { role: "assistant", content: "Yes, on the way!", ts: at + 5000, senderName: "Staff" }); throw new Error("RECEIVING_LINE_UNAVAILABLE"); });
    expect(await p.service(event(sid, phone, id, body))).toEqual({ outcome: "failed" });
    const [t] = await tasks(sid);
    expect(t.task).toMatchObject({ sourceMessageId: id, reply: { status: "suppressed" } });
    expect(reviewLines().map(line => line.reason)).toEqual(["REVIEW_TASK_CREATED"]);
    expect(p.onFailure.mock.calls).toEqual([[{ taskId: t.id, code: "RECEIVING_LINE_UNAVAILABLE", sessionId: sid }]]);
  });

  it("an opted-out customer (opt-out list) gets no review task", async () => {
    const phone = newPhone(), id = "AC-optout", body = "Where is my receipt?";
    const sid = await conversation(phone, [text(id, body)]);
    await pool.query("INSERT INTO sms_opt_outs (phone) VALUES (?)", [phone]);
    const p = pipeline(lineDown);
    expect(await p.service(event(sid, phone, id, body))).toEqual({ outcome: "failed" });
    expect(await tasks(sid)).toHaveLength(0);
    expect(reviewLines().map(line => line.exclusion)).toEqual(["OPTED_OUT"]);
  });

  it("a conversation marked opted out is excluded before any lookup (unchanged rule)", async () => {
    const phone = newPhone(), id = "AC-optout-flag", body = "Hello?";
    const sid = await conversation(phone, [text(id, body)], { smsOptOut: 1 });
    const lookup = vi.fn(lineDown), p = pipeline(lookup);
    expect(await p.service(event(sid, phone, id, body))).toEqual({ outcome: "excluded" });
    expect(lookup).not.toHaveBeenCalled(); expect(await tasks(sid)).toHaveLength(0);
  });

  it("an existing reply attempt for the text means no review task", async () => {
    const phone = newPhone(), id = "AC-attempt", body = "Can I add an extra hour?";
    const sid = await conversation(phone, [text(id, body)]);
    await pool.query("INSERT INTO madison_sms_drafts (inboundOpenPhoneId, sessionId, fromPhone, senderType, status, originalMessage, observations, suggestedActions, followUps, createdAt, updatedAt) VALUES (?, ?, ?, 'customer', 'DRAFT_READY', ?, '[]', '[]', '[]', NOW(), NOW())", [id, sid, phone, body]);
    const p = pipeline(lineDown);
    expect(await p.service(event(sid, phone, id, body))).toEqual({ outcome: "failed" });
    expect(await tasks(sid)).toHaveLength(0);
    expect(reviewLines().map(line => line.exclusion)).toEqual(["REPLY_ATTEMPT_EXISTS"]);
  });

  it("after a review task exists, a duplicate whose lookup succeeds can never send a reply or add a task", async () => {
    const phone = newPhone(), id = "AC-dup-then-ok", body = "I need to reschedule";
    const sid = await conversation(phone, [text(id, body)]);
    expect(await pipeline(lineDown).service(event(sid, phone, id, body))).toEqual({ outcome: "failed" });
    const later = pipeline(async () => BUSINESS);
    const outcome = await later.service(event(sid, phone, id, body));
    expect(outcome.outcome).not.toBe("accepted");
    expect(later.send).not.toHaveBeenCalled();
    expect(await tasks(sid)).toHaveLength(1);
  });

  it("end to end through the real application with no network: lookup fails, is retried once, and the review task is created", async () => {
    const phone = newPhone(), id = "AC-app-1", body = "Why was I charged again?";
    const sid = await conversation(phone, [text(id, body)]);
    vi.stubEnv("DATABASE_URL", url!); vi.stubEnv("CLAUDE_CUSTOMER_SMS_ENABLED", "true"); vi.stubEnv("CLAUDE_CUSTOMER_SMS_START_AT", "2026-11-16T17:59:00Z");
    vi.stubEnv("OPENPHONE_API_KEY", "offline-test-key"); vi.stubEnv("NTFY_TOPIC", "");
    const { dispatchClaudeCustomerSms } = await import("./claudeCustomerSmsApplication");
    expect(await dispatchClaudeCustomerSms(event(sid, phone, id, body))).toEqual({ outcome: "failed" });
    const lines = logSpy.mock.calls.map(args => { try { return JSON.parse(String(args[0])); } catch { return null; } }).filter(Boolean);
    expect(lines.filter(line => line.stage === "receiving_line_read" && /^RECEIVING_LINE_/.test(line.reason ?? "") && line.reason !== "RECEIVING_LINE_READ_REACHED").map(line => line.reason))
      .toEqual(["RECEIVING_LINE_NETWORK_ERROR_RETRYING", "RECEIVING_LINE_NETWORK_ERROR"]);
    const [t] = await tasks(sid);
    expect(t.task).toMatchObject({ sourceMessageId: id, receivingPhoneNumber: UNVERIFIED_RECEIVING_LINE, reply: { status: "suppressed" } });
    expect(await attempts(id)).toEqual([]);
    vi.unstubAllEnvs();
  });

  // ── Generation and persistence failures: staff must know ─────────────────────
  const fails = (fn?: (binding: any) => Promise<void> | void) => async (binding: any) => { await fn?.(binding); throw new SyntaxError("invalid model output"); };
  const lineOk = async () => BUSINESS;
  const reviewOf = async (sid: number, id: string) => (await tasks(sid)).filter(row => row.task.sourceMessageId === id);

  it("a generation failure creates the existing review task; nothing is sent", async () => {
    const phone = newPhone(), id = "AC-gen-1", body = "Can you move my cleaning to Thursday?";
    const sid = await conversation(phone, [text(id, body)]);
    const p = pipeline(lineOk, fails());
    expect(await p.service(event(sid, phone, id, body))).toEqual({ outcome: "failed" });
    const [t, ...more] = await reviewOf(sid, id); expect(more).toHaveLength(0);
    expect(t.task).toMatchObject({ title: "Review customer message after reply failure", receivingPhoneNumber: BUSINESS,
      reply: { text: "No customer reply was submitted.", status: "suppressed", providerMessageId: null } });
    expect(await attempts(id)).toEqual([expect.objectContaining({ status: "DISMISSED", errorCode: "GENERATION_OR_PERSISTENCE_FAILED" })]);
    expect(p.send).not.toHaveBeenCalled(); expect(p.generate).toHaveBeenCalledTimes(1);
    expect(reviewLines().map(line => line.reason)).toEqual(["REVIEW_TASK_CREATED"]);
    expect(p.onFailure.mock.calls).toEqual([[{ taskId: t.id, code: "GENERATION_OR_PERSISTENCE_FAILED", sessionId: sid }]]);
  });

  it("the customer texting again while Claude writes no longer hides the failure; the newer text is answered normally", async () => {
    const phone = newPhone(), a = "AC-gen-a", b = "AC-gen-b";
    const sid = await conversation(phone, [text(a, "I was double charged")]);
    const first = pipeline(lineOk, fails(() => appendTurn(sid, text(b, "Please fix it today", at + 30_000))));
    expect(await first.service(event(sid, phone, a, "I was double charged"))).toEqual({ outcome: "failed" });
    expect(await reviewOf(sid, a)).toHaveLength(1);
    const second = pipeline(lineOk);
    expect(await second.service({ ...event(sid, phone, b, "Please fix it today"), receivedAt: at + 30_000 })).toEqual({ outcome: "accepted" });
    expect(second.send).toHaveBeenCalledTimes(1); expect(first.send).not.toHaveBeenCalled();
    expect((await tasks(sid)).map(row => row.task.sourceMessageId).sort()).toEqual([a, b].sort());
  });

  it("consecutive failed texts each get a review task, so the request is never left unattended", async () => {
    const phone = newPhone(), a = "AC-cons-a", b = "AC-cons-b";
    const sid = await conversation(phone, [text(a, "My cleaner never showed up")]);
    expect(await pipeline(lineOk, fails(() => appendTurn(sid, text(b, "Hello??", at + 20_000)))).service(event(sid, phone, a, "My cleaner never showed up"))).toEqual({ outcome: "failed" });
    expect(await pipeline(lineOk, fails()).service({ ...event(sid, phone, b, "Hello??"), receivedAt: at + 20_000 })).toEqual({ outcome: "failed" });
    expect((await tasks(sid)).map(row => row.task.sourceMessageId).sort()).toEqual([a, b].sort());
    expect(reviewLines().map(line => line.reason)).toEqual(["REVIEW_TASK_CREATED", "REVIEW_TASK_CREATED"]);
  });

  it("a staff reply during the attempt no longer hides the failure (redundant review task accepted)", async () => {
    const phone = newPhone(), id = "AC-gen-staff", body = "Is the cleaner still coming?";
    const sid = await conversation(phone, [text(id, body)]);
    const p = pipeline(lineOk, fails(() => appendTurn(sid, { role: "assistant", content: "Yes, 10 minutes away.", ts: at + 5000, senderName: "Maria" })));
    expect(await p.service(event(sid, phone, id, body))).toEqual({ outcome: "failed" });
    expect(await reviewOf(sid, id)).toHaveLength(1); expect(p.send).not.toHaveBeenCalled();
  });

  it("opt-out during the attempt still skips the review task, with the reason logged", async () => {
    const phone = newPhone(), id = "AC-gen-optout", body = "What do you charge for windows?";
    const sid = await conversation(phone, [text(id, body)]);
    const p = pipeline(lineOk, fails(() => pool.query("INSERT INTO sms_opt_outs (phone) VALUES (?)", [phone]).then(() => undefined)));
    expect(await p.service(event(sid, phone, id, body))).toEqual({ outcome: "failed" });
    expect(await tasks(sid)).toHaveLength(0);
    expect(reviewLines().map(line => [line.reason, line.exclusion])).toEqual([["REVIEW_TASK_SKIPPED", "OPTED_OUT"]]);
    expect(p.send).not.toHaveBeenCalled(); expect(p.onFailure).not.toHaveBeenCalled();
  });

  it("an attempt stopped as stale (newer text arrived before sending) gets a review task; the generated reply is not sent", async () => {
    const phone = newPhone(), a = "AC-stale-a", b = "AC-stale-b";
    const sid = await conversation(phone, [text(a, "Can you come earlier on Friday?")]);
    const p = pipeline(lineOk, async binding => { await appendTurn(sid, text(b, "Like 8am?", at + 15_000));
      return { replyText: "Let me check with the team.", task: { title: "Check Friday time", items: [{ title: "Ask team", evidenceQuote: binding.inboundText }] } }; });
    expect(await p.service(event(sid, phone, a, "Can you come earlier on Friday?"))).toEqual({ outcome: "suppressed" });
    const [t] = await reviewOf(sid, a);
    expect(t.task).toMatchObject({ title: "Review customer message after reply failure", reply: { status: "suppressed" } });
    expect(p.send).not.toHaveBeenCalled();
  });

  it("a claim that fails after the line was verified gets a review task on the verified line", async () => {
    const phone = newPhone(), a = "AC-claim-a", b = "AC-claim-b";
    const sid = await conversation(phone, [text(a, "Do you clean ovens?")]);
    // The newer text lands during the line lookup, so the claim refuses the stale text.
    const p = pipeline(async () => { await appendTurn(sid, text(b, "And fridges?", at + 3000)); return BUSINESS; });
    expect(await p.service(event(sid, phone, a, "Do you clean ovens?"))).toEqual({ outcome: "failed" });
    expect(await attempts(a)).toEqual([]); expect(p.generate).not.toHaveBeenCalled(); expect(p.send).not.toHaveBeenCalled();
    const [t] = await reviewOf(sid, a);
    expect(t.task).toMatchObject({ receivingPhoneNumber: BUSINESS, receivingPhoneNumberId: LINE, reply: { status: "suppressed" } });
  });

  it("simultaneous duplicate deliveries of a failing text: one AI attempt, one review task, nothing sent", async () => {
    const phone = newPhone(), id = "AC-gen-dup", body = "Where is my receipt?";
    const sid = await conversation(phone, [text(id, body)]);
    const p = pipeline(lineOk, fails());
    const results = await Promise.all([1, 2, 3].map(() => p.service(event(sid, phone, id, body))));
    expect(results.filter(r => r.outcome === "failed").length).toBeGreaterThanOrEqual(1);
    expect(p.generate).toHaveBeenCalledTimes(1);
    expect(await reviewOf(sid, id)).toHaveLength(1); expect(p.send).not.toHaveBeenCalled();
  });

  it("repeated failure reports for one attempt still leave exactly one review task", async () => {
    const phone = newPhone(), id = "AC-gen-repeat", body = "Can I tip my cleaner?";
    const sid = await conversation(phone, [text(id, body)]);
    const store = createClaudeCustomerTasksStore(db);
    const p = pipeline(lineOk, fails());
    expect(await p.service(event(sid, phone, id, body))).toEqual({ outcome: "failed" });
    const [draft] = await attempts(id);
    const raw = rows(await pool.query("SELECT resolvedContext FROM madison_sms_drafts WHERE id = ?", [draft.id]))[0].resolvedContext;
    const binding = typeof raw === "string" ? JSON.parse(raw) : raw;
    const claim = { draftId: draft.id, key: id, binding };
    const again = await Promise.all([1, 2, 3].map(() => store.reportFailure(claim as any, "GENERATION_OR_PERSISTENCE_FAILED")));
    expect(again).toEqual(Array(3).fill({ skipped: "REVIEW_ALREADY_RECORDED" }));
    expect(await reviewOf(sid, id)).toHaveLength(1);
  });
});
