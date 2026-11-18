import { createHash } from "node:crypto";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { CLAUDE_CUSTOMER_TASK_ACTION, customerTaskSchema, type ProposedCustomerTask } from "../../shared/claudeCustomerTasks";
import { getDb } from "../db";
import type { StaffCallSource } from "./claudeStaffCalls";
import { createClaudeStaffCallsStore, STAFF_CALL_RECEIPT_ACTION, STAFF_CALL_RECEIPT_CHANNEL } from "./claudeStaffCallsStore";
import { createClaudeCustomerTasksStore } from "./claudeCustomerTasksStore";

// The only mocked module is the import-time application DB acquisition seam.
// Transactional SQL and the canonical persistence/lifecycle implementation run.
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));
const source = (): StaffCallSource => ({
  recordingId: 77, providerCallId: "ACsyntheticCall001", sessionId: null,
  callerPhone: "+13015550123", callerName: "Synthetic Jane", receivedAt: 1800000000000,
  transcript: "Staff: How can I help?\nCustomer: Move the visit to Friday.\nStaff: I can review that.\nCustomer: Please add oven cleaning.",
  customerTurns: ["Move the visit to Friday.", "Please add oven cleaning."],
  recordingUrl: "https://recordings.example.test/private.wav", businessPhoneNumberId: "PNsyntheticLine001",
  businessPhoneNumber: "+12025550111", staffUserId: "USsyntheticStaff001", direction: "incoming",
});
const plan: ProposedCustomerTask = { title: "Review Friday change and oven cleaning", items: [
  { title: "Review Friday reschedule", evidenceQuote: "Move the visit to Friday" },
  { title: "Add oven cleaning", evidenceQuote: "add oven cleaning" },
] };
const owner = { id: "agent-17", name: "Synthetic Sam" }, other = { id: "agent-18", name: "Synthetic Sam" };
const hash = (id: string) => createHash("sha256").update(id).digest("hex");
type Corruptor = (value: string, action: string) => string;
function port() {
  let state: any = { cards: [], recordings: [{ id: 77, openphoneCallId: source().providerCallId,
    callerPhone: source().callerPhone, direction: "incoming" }], next: 100 };
  let tail = Promise.resolve(), failedAction = "", missNextKey = false;
  let corrupt: Corruptor = value => value;
  const queries: Array<{ sql: string; params: any[] }> = [], insertedTables: string[] = [];
  const db: any = {
    async transaction(fn: any) {
      let release!: () => void;
      const prior = tail; tail = new Promise<void>(resolve => { release = resolve; }); await prior;
      const before = structuredClone(state);
      try { return await fn(db); } catch (error) { state = before; throw error; } finally { release(); }
    },
    insert(table: any) { return { async values(values: any) {
      const name = getTableName(table); insertedTables.push(name); expect(name).toBe("ops_chat_messages");
      if (values.quickAction === failedAction) throw Error("Offline insert failed");
      if (state.cards.some((row: any) => row.activeDedupKey === values.activeDedupKey)) {
        throw Object.assign(Error("Duplicate"), { code: "ER_DUP_ENTRY" });
      }
      const id = ++state.next;
      state.cards.push({ sessionId: null, id, ...structuredClone(values),
        ...(values.metadata ? { metadata: corrupt(values.metadata, values.quickAction) } : {}) });
      return [{ insertId: id, affectedRows: 1 }];
    } }; },
    async execute(query: any) {
      const q = new MySqlDialect().sqlToQuery(query); queries.push(q);
      const s = q.sql.replace(/\s+/g, " "), p = q.params;
      if (s.startsWith("SELECT")) {
        if (s.includes("FROM openphone_call_recordings")) {
          expect(s).toBe("SELECT id, openphoneCallId, callerPhone, direction FROM openphone_call_recordings WHERE id = ? FOR UPDATE");
          return [state.recordings.filter((row: any) => row.id === p[0])];
        }
        if (s.includes("FROM ops_chat_messages WHERE activeDedupKey")) {
          expect(s).toContain("FOR UPDATE");
          if (missNextKey) { missNextKey = false; return [[]]; }
          return [state.cards.filter((row: any) => row.activeDedupKey === p[0])];
        }
        if (s.includes("FROM ops_chat_messages WHERE id")) return [state.cards.filter((row: any) => row.id === p[0] && row.quickAction === p[1])];
        if (s.includes("FROM ops_chat_messages WHERE quickAction")) return [state.cards.filter((row: any) => row.quickAction === p[0] && row.channel === "command").sort((a: any, b: any) => b.id - a.id)];
      }
      if (s.startsWith("UPDATE ops_chat_messages")) {
        if (p[3] === failedAction) throw Error("Offline update failed");
        const row = state.cards.find((row: any) => row.id === p[2] && row.quickAction === p[3]);
        if (!row) return [{ affectedRows: 0 }];
        row.metadata = corrupt(p[0] as string, row.quickAction); row.lastActivityAt = p[1];
        return [{ affectedRows: 1 }];
      }
      throw Error(`Unexpected SQL ${s}`);
    },
  };
  return { db, store: createClaudeStaffCallsStore(db), tasks: createClaudeCustomerTasksStore(db), queries, insertedTables,
    state: () => state, failWrites: (action: string) => { failedAction = action; },
    corrupt: (fn: Corruptor) => { corrupt = fn; },
    missNextKey: () => { missNextKey = true; } };
}
const receipts = (h: ReturnType<typeof port>) => h.state().cards.filter((row: any) => row.quickAction === STAFF_CALL_RECEIPT_ACTION);
const receiptState = (h: ReturnType<typeof port>) => JSON.parse(receipts(h)[0].metadata);

describe("staff call store — offline transactional canonical persistence", () => {
  it("claims once concurrently and after restart, retaining private fixed-length call-ID keys", async () => {
    const h = port();
    const claims = await Promise.all([h.store.claim(source()), createClaudeStaffCallsStore(h.db).claim(source())]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await createClaudeStaffCallsStore(h.db).claim(source())).toBeNull();
    expect(h.state().cards).toHaveLength(1);
    expect(receipts(h)[0]).toMatchObject({ channel: STAFF_CALL_RECEIPT_CHANNEL, sessionId: null,
      activeDedupKey: `sc-receipt:v1:${hash(source().providerCallId)}` });
    expect(receipts(h)[0].activeDedupKey.length).toBeLessThan(128);
    expect(receiptState(h)).toMatchObject({ fingerprint: hash(JSON.stringify(source())), phase: "generating", taskId: null, code: null });
    expect(h.insertedTables).toEqual(["ops_chat_messages"]);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("handles the unique-key race without another receipt, but propagates ordinary insert failure", async () => {
    const h = port(); await h.store.claim(source()); h.missNextKey();
    expect(await createClaudeStaffCallsStore(h.db).claim(source())).toBeNull(); expect(receipts(h)).toHaveLength(1);
    const failed = port(); failed.failWrites(STAFF_CALL_RECEIPT_ACTION);
    await expect(failed.store.claim(source())).rejects.toThrow("Offline insert"); expect(failed.state().cards).toEqual([]);
  });

  it.each([null, 501])("persists exactly one canonical task with source session %s and no SMS state", async sessionId => {
    const h = port(), raw = { ...source(), sessionId }, c = (await h.store.claim(raw))!;
    const ids = await Promise.all([h.store.prepare(c, plan), createClaudeStaffCallsStore(h.db).prepare(c, plan)]), id = ids[0]!;
    expect(ids).toEqual([id, id]); expect(id).toBeGreaterThan(0);
    const task = (await h.tasks.get(id))!; expect(customerTaskSchema.parse(task)).toEqual(task);
    expect(task).toMatchObject({ sessionId, status: "unclaimed", customerName: raw.callerName, customerPhone: raw.callerPhone,
      sourceMessageId: raw.providerCallId, sourceText: raw.customerTurns.join("\n\n"), receivedAt: raw.receivedAt,
      receivingPhoneNumberId: null, receivingPhoneNumber: null, call: {
        provider: "openphone", providerCallId: raw.providerCallId, recordingId: raw.recordingId,
        transcript: raw.transcript, recordingUrl: raw.recordingUrl, businessPhoneNumberId: raw.businessPhoneNumberId,
        businessPhoneNumber: raw.businessPhoneNumber, staffUserId: raw.staffUserId, direction: raw.direction,
      }, reply: { text: "", status: "not_applicable", providerMessageId: null } });
    if (!("call" in task)) throw Error("Expected a canonical call task");
    expect(task.call).not.toHaveProperty("voiceCallId"); expect(task.call).not.toHaveProperty("callbackTaskIds");
    expect(await h.tasks.list()).toEqual([task]); expect(h.state().cards).toHaveLength(2);
    expect(h.state().cards.find((row: any) => row.id === id).activeDedupKey).toBe(`sc-task:v1:${hash(raw.providerCallId)}`);
    expect(receiptState(h)).toMatchObject({ phase: "prepared", taskId: id });
    await h.store.fail(c, "LATE_FAILURE"); expect(receiptState(h).phase).toBe("prepared");
    expect(await createClaudeStaffCallsStore(h.db).claim(raw)).toBeNull();
  });

  it("supports an outgoing call and null optional name/recording without inventing a session", async () => {
    const h = port(); h.state().recordings[0].direction = "outgoing";
    const raw = { ...source(), direction: "outgoing" as const, callerName: null, recordingUrl: null };
    const c = (await h.store.claim(raw))!, id = (await h.store.prepare(c, plan))!;
    expect(await h.tasks.get(id)).toMatchObject({ sessionId: null, customerName: null,
      call: { recordingUrl: null, direction: "outgoing" } });
    expect(h.queries.every(q => /FROM (openphone_call_recordings|ops_chat_messages)|UPDATE ops_chat_messages/.test(q.sql))).toBe(true);
    expect(h.insertedTables.every(table => table === "ops_chat_messages")).toBe(true);
  });

  it.each(["no_task", "failed"])("keeps %s receipts terminal across fresh stores and late prepare/fail", async phase => {
    const h = port(), c = (await h.store.claim(source()))!;
    if (phase === "no_task") expect(await h.store.prepare(c, null)).toBeNull();
    else await h.store.fail(c, "GENERATION_FAILED");
    const saved = receipts(h)[0].metadata, restarted = createClaudeStaffCallsStore(h.db);
    expect(await restarted.claim(source())).toBeNull(); expect(await restarted.prepare(c, plan)).toBeNull();
    await restarted.fail(c, "LATER_FAILURE"); expect(receipts(h)[0].metadata).toBe(saved);
    expect(receiptState(h)).toMatchObject({ phase, taskId: null, code: phase === "failed" ? "GENERATION_FAILED" : null });
    expect(await h.tasks.list()).toEqual([]);
  });

  it.each(["I can review that.", "Cancel yesterday's booking", "Friday.\n\nPlease", "move the visit", "invented source"])(
    "rejects staff, historical, cross-turn, case-changed or invented evidence: %s", async evidenceQuote => {
      const h = port(), c = (await h.store.claim(source()))!;
      await expect(h.store.prepare(c, { ...plan, items: [{ title: "Wrong evidence", evidenceQuote }] })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await h.tasks.list()).toEqual([]); expect(receiptState(h).phase).toBe("generating");
    });

  it.each(["missing", "providerCallId", "callerPhone", "direction"])("independently rejects recording binding mismatch: %s", async kind => {
    const h = port();
    const changed = { ...source(), ...(kind === "missing" ? { recordingId: 78 } : kind === "providerCallId" ? { providerCallId: "ACotherCall002" }
      : kind === "callerPhone" ? { callerPhone: "+13015550999" } : { direction: "outgoing" as const }) };
    await expect(h.store.claim(changed)).rejects.toMatchObject({ code: "CONFLICT" }); expect(h.state().cards).toEqual([]);
    const c = (await h.store.claim(source()))!;
    if (kind === "missing") h.state().recordings = [];
    else h.state().recordings[0][kind === "providerCallId" ? "openphoneCallId" : kind] = kind === "providerCallId" ? changed.providerCallId : changed[kind as keyof StaffCallSource];
    await expect(h.store.prepare(c, plan)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(h.store.fail(c, "ERROR")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await h.tasks.list()).toEqual([]); expect(receiptState(h).phase).toBe("generating");
  });

  it("detaches the entire source before returning a claim", async () => {
    const h = port(), raw = source(), expected = structuredClone(raw), c = (await h.store.claim(raw))!;
    raw.customerTurns[0] = "mutated"; raw.transcript = "mutated"; raw.staffUserId = "USmutated";
    expect(c.source).toEqual(expected); expect(c.source).not.toBe(raw); expect(c.source.customerTurns).not.toBe(raw.customerTurns);
    expect(receiptState(h).fingerprint).toBe(hash(JSON.stringify(expected)));
    expect(await h.store.prepare(c, plan)).toBeGreaterThan(0);
  });

  it.each([
    ["recordingId", 78], ["providerCallId", "ACmutated"], ["sessionId", 22], ["callerPhone", "+13015550999"],
    ["callerName", "Mutated"], ["receivedAt", 1800000000001], ["transcript", "Mutated transcript"],
    ["customerTurns", ["Mutated words"]], ["recordingUrl", "https://recordings.example.test/other.wav"],
    ["businessPhoneNumberId", "PNmutated"], ["businessPhoneNumber", "+12025550999"], ["staffUserId", "USmutated"], ["direction", "outgoing"],
  ])("fingerprints exact source field %s", async (field, value) => {
    const h = port(), c = (await h.store.claim(source()))!;
    const mutated = { ...c, source: { ...c.source, [field as string]: value } };
    await expect(h.store.prepare(mutated, plan)).rejects.toThrow(); await expect(h.store.fail(mutated, "ERROR")).rejects.toThrow();
    expect(h.state().cards).toHaveLength(1); expect(receiptState(h).phase).toBe("generating");
  });

  it.each(["receiptId", "key", "channel", "quickAction", "sessionId", "fingerprint", "recordingId", "providerCallId", "phase"])(
    "rejects a mutated claim or receipt binding: %s", async field => {
      const h = port(), c = (await h.store.claim(source()))!, row = receipts(h)[0];
      if (field === "receiptId") c.receiptId++;
      else if (field === "key") c.key += "wrong";
      else if (["channel", "quickAction", "sessionId"].includes(field)) row[field] = field === "sessionId" ? 7 : "other-capability";
      else { const state = JSON.parse(row.metadata); state[field] = field === "recordingId" ? 78 : field === "phase" ? "prepared" : "mutated"; row.metadata = JSON.stringify(state); }
      await expect(h.store.prepare(c, plan)).rejects.toThrow(); await expect(h.store.fail(c, "ERROR")).rejects.toThrow();
      expect(h.state().cards).toHaveLength(1);
    });

  it("rejects truncated receipt creation, terminal receipt updates and failure codes with transaction rollback", async () => {
    const h = port(); h.corrupt(value => value.slice(0, -1));
    await expect(h.store.claim(source())).rejects.toThrow(); expect(h.state().cards).toEqual([]);
    h.corrupt(value => value); const c = (await h.store.claim(source()))!, saved = receipts(h)[0].metadata;
    h.corrupt((value, action) => action === STAFF_CALL_RECEIPT_ACTION ? value.slice(0, -1) : value);
    await expect(h.store.prepare(c, plan)).rejects.toThrow(); expect(h.state().cards).toHaveLength(1); expect(receipts(h)[0].metadata).toBe(saved);
    await expect(h.store.prepare(c, null)).rejects.toThrow(); expect(receipts(h)[0].metadata).toBe(saved);
    h.corrupt((value, action) => { if (action !== STAFF_CALL_RECEIPT_ACTION) return value; const state = JSON.parse(value); state.code = "TRUNCATED"; return JSON.stringify(state); });
    await expect(h.store.fail(c, "GENERATION_FAILED")).rejects.toThrow(); expect(receipts(h)[0].metadata).toBe(saved);
  });

  it.each(["invalid_json", "transcript", "sourceText", "recordingUrl", "staffUserId", "customerName", "title", "evidenceQuote"])(
    "rejects task truncation/substitution even when remaining JSON is valid: %s", async field => {
      const h = port(), c = (await h.store.claim(source()))!;
      h.corrupt((value, action) => {
        if (action !== CLAUDE_CUSTOMER_TASK_ACTION) return value;
        if (field === "invalid_json") return value.slice(0, -1);
        const envelope = JSON.parse(value), task = envelope.task;
        if (["transcript", "recordingUrl", "staffUserId"].includes(field)) task.call[field] = task.call[field].slice(0, -1);
        else if (field === "evidenceQuote") task.items[0].evidenceQuote = task.items[0].evidenceQuote.slice(0, -1);
        else task[field] = task[field].slice(0, -1);
        return JSON.stringify(envelope);
      });
      await expect(h.store.prepare(c, plan)).rejects.toThrow(); expect(await h.tasks.list()).toEqual([]);
      expect(h.state().cards).toHaveLength(1); expect(receiptState(h).phase).toBe("generating");
    });

  it.each([CLAUDE_CUSTOMER_TASK_ACTION, STAFF_CALL_RECEIPT_ACTION])("rolls back atomic preparation when writing %s fails", async action => {
    const h = port(), c = (await h.store.claim(source()))!, before = structuredClone(h.state()); h.failWrites(action);
    await expect(h.store.prepare(c, plan)).rejects.toThrow("Offline"); expect(h.state()).toEqual(before);
    h.failWrites(""); expect(await h.store.prepare(c, plan)).toBeGreaterThan(0); expect(await h.tasks.list()).toHaveLength(1);
  });

  it("preserves exact long transcript and customer-turn evidence without clipping", async () => {
    const h = port(), text = `${"Exact synthetic evidence. ".repeat(4000)}End of utterance.`;
    const raw = { ...source(), transcript: `Staff: hello\nCustomer: ${text}`, customerTurns: [text] };
    const c = (await h.store.claim(raw))!, id = (await h.store.prepare(c, { title: "Review request", items: [{ title: "Review request", evidenceQuote: "End of utterance." }] }))!;
    const task = (await h.tasks.get(id))!;
    if (!("call" in task)) throw Error("Expected a canonical call task");
    expect(task.sourceText).toBe(text); expect(task.call.transcript).toBe(raw.transcript);
    expect(task.sourceText.length).toBeGreaterThan(65535);
  });

  it("uses actual canonical list/get/Claim/item/Done lifecycle without auto-completion or external writes", async () => {
    const h = port(), c = (await h.store.claim(source()))!, id = (await h.store.prepare(c, plan))!;
    await expect(h.tasks.completeTask(id, "Premature", owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const results = await Promise.allSettled([h.tasks.claimTask(id, owner), h.tasks.claimTask(id, other)]);
    expect(results[0].status).toBe("fulfilled"); expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
    const claimed = (await h.tasks.get(id))!; expect(await h.tasks.claimTask(id, owner)).toEqual(claimed);
    expect(claimed).toMatchObject({ status: "claimed", owner, completedAt: null, completionNote: null });
    expect(await h.tasks.list()).toEqual([claimed]);
    await expect(h.tasks.completeItem(id, "item-1", other)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.tasks.completeTask(id, "Not my task", other)).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const note of [undefined, "", " \t\n "]) await expect(h.tasks.completeTask(id, note, owner)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await h.tasks.completeItem(id, "item-1", owner); await h.tasks.completeItem(id, "item-2", owner);
    expect((await h.tasks.get(id))?.status).toBe("claimed"); expect(await h.tasks.list()).toHaveLength(1);
    const done = await h.tasks.completeTask(id, "Both changes reviewed and completed manually", owner);
    expect(done).toMatchObject({ status: "done", completedBy: owner, completionNote: "Both changes reviewed and completed manually",
      reply: { text: "", status: "not_applicable", providerMessageId: null } });
    expect(done.items.every(item => item.completedBy?.id === owner.id && item.completedAt !== null)).toBe(true);
    expect(await h.tasks.get(id)).toEqual(done); expect(await h.tasks.list()).toEqual([done]);
    expect(await h.tasks.completeTask(id, "Do not replace audit", owner)).toEqual(done);
    expect(await createClaudeStaffCallsStore(h.db).claim(source())).toBeNull(); expect(h.state().cards).toHaveLength(2);
    expect(h.queries.every(q => /FROM (openphone_call_recordings|ops_chat_messages)|UPDATE ops_chat_messages/.test(q.sql))).toBe(true);
    expect(h.insertedTables.every(table => table === "ops_chat_messages")).toBe(true); expect(getDb).not.toHaveBeenCalled();
  });
});
