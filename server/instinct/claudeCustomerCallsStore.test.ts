import { withCallBookingQuoteTask } from "./callBookingQuoteTask";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, it, expect, vi } from "vitest";
import { createClaudeCustomerCallsStore, CUSTOMER_CALL_RECEIPT_ACTION } from "./claudeCustomerCallsStore";
import { createClaudeCustomerTasksStore } from "./claudeCustomerTasksStore";
import { createClaudeCustomerCallTaskHandler, type CustomerCallSource } from "./claudeCustomerCalls";
import { customerCallTaskSchema } from "../../shared/claudeCustomerTasks";
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));
const source = (): CustomerCallSource => ({ voiceCallId: 77, providerCallId: "synthetic-call", sessionId: null, callerPhone: "+13015550123", callerName: "Synthetic Jane",
  receivedAt: 1800000000000, transcript: "AI: How can I help?\nUser: Move the visit to Friday and add oven cleaning.\nAI: Staff will review your request.",
  customerTurns: ["Move the visit to Friday and add oven cleaning."], recordingUrl: "https://recordings.example.test/private.wav", callbackTaskIds: [401],
  callbackRequests: [{ id: 401, notes: "Reschedule request", preferredCallbackTime: "tomorrow" }] });
const plan = { title: "Review Friday change and oven cleaning", items: [{ title: "Review Friday reschedule", evidenceQuote: "Move the visit to Friday" }, { title: "Add oven cleaning", evidenceQuote: "add oven cleaning" }] };
const owner = { id: "agent-17", name: "Synthetic Sam" }, other = { id: "agent-18", name: "Synthetic Sam" };
function port() {
  let state: any = { cards: [], calls: [{ id: 77, vapiCallId: "synthetic-call" }], next: 100 };
  let tail = Promise.resolve(), failWrite = false, truncate = false;
  const queries: Array<{ sql: string; params: any[] }> = [];
  const db: any = {
    async transaction(fn: any) {
      let release!: () => void; const prior = tail; tail = new Promise<void>(resolve => { release = resolve; }); await prior;
      const before = structuredClone(state); try { return await fn(db); } catch (e) { state = before; throw e; } finally { release(); }
    },
    insert(table: any) { return { async values(values: any) {
      expect(getTableName(table)).toBe("ops_chat_messages");
      if (failWrite) throw Error("Offline write failed");
      if (state.cards.some((r: any) => r.activeDedupKey === values.activeDedupKey)) throw Object.assign(Error("Duplicate"), { code: "ER_DUP_ENTRY" });
      const id = ++state.next; state.cards.push({ sessionId: null, id, ...structuredClone(values), ...(truncate && values.metadata ? { metadata: values.metadata.slice(0, -1) } : {}) }); return [{ insertId: id, affectedRows: 1 }];
    } }; },
    async execute(query: any) {
      const q = new MySqlDialect().sqlToQuery(query); queries.push(q); const s = q.sql.replace(/\s+/g, " "), p = q.params;
      if (s.startsWith("SELECT")) {
        if (s.includes("FROM voice_calls")) return [state.calls.filter((r: any) => r.id === p[0])];
        if (s.includes("FROM ops_chat_messages WHERE activeDedupKey")) return [state.cards.filter((r: any) => r.activeDedupKey === p[0])];
        if (s.includes("FROM ops_chat_messages WHERE id")) return [state.cards.filter((r: any) => r.id === p[0] && r.quickAction === p[1])];
        if (s.includes("FROM ops_chat_messages WHERE quickAction")) return [state.cards.filter((r: any) => r.quickAction === p[0] && r.channel === "command")];
      }
      if (s.startsWith("UPDATE ops_chat_messages")) {
        if (failWrite) throw Error("Offline write failed");
        const row = state.cards.find((r: any) => r.id === p[2] && r.quickAction === p[3]); if (!row) return [{ affectedRows: 0 }];
        row.metadata = truncate ? (p[0] as string).slice(0, -1) : p[0]; row.lastActivityAt = p[1]; return [{ affectedRows: 1 }];
      }
      throw Error(`Unexpected SQL ${s}`);
    },
  };
  return { db, store: createClaudeCustomerCallsStore(db), tasks: createClaudeCustomerTasksStore(db), queries, state: () => state,
    failWrites: (v: boolean) => { failWrite = v; }, truncate: (v: boolean) => { truncate = v; } };
}
const receipts = (h: ReturnType<typeof port>) => h.state().cards.filter((r: any) => r.quickAction === CUSTOMER_CALL_RECEIPT_ACTION);
describe("actual durable call task adapter — offline transactional storage", () => {
  it("claims once across simultaneous handlers and fresh store instances, without duplicate callback records", async () => {
    const h = port(); const result = await Promise.all([h.store.claim(source()), createClaudeCustomerCallsStore(h.db).claim(source())]);
    expect(result.filter(Boolean)).toHaveLength(1); expect(receipts(h)).toHaveLength(1); expect(h.state().cards).toHaveLength(1);
    expect(h.queries.every(q => !/^(INSERT|UPDATE|DELETE)/.test(q.sql) || q.sql.includes("ops_chat_messages"))).toBe(true);
    expect(h.state().cards[0].activeDedupKey.length).toBeLessThan(128);
  });
  it("creates the same canonical task atomically with caller evidence and no SMS submission state", async () => {
    const h = port(); const claim = (await h.store.claim(source()))!; const id = await h.store.prepare(claim, plan);
    const task = (await h.tasks.get(id!))!; expect(customerCallTaskSchema.parse(task)).toEqual(task);
    expect(task).toMatchObject({ status: "unclaimed", sourceMessageId: "synthetic-call", sourceText: source().customerTurns.join("\n\n"), sessionId: null,
      call: { providerCallId: "synthetic-call", transcript: source().transcript, callbackTaskIds: [401] }, reply: { text: "", status: "not_applicable", providerMessageId: null } });
    expect(await h.store.prepare(claim, plan)).toBe(id); expect((await h.tasks.list())).toHaveLength(1);
    expect(JSON.parse(receipts(h)[0].metadata)).toMatchObject({ phase: "prepared", taskId: id });
  });
  it("records no-task FAQ results durably without creating a task or retrying later", async () => {
    const h = port(); const claim = (await h.store.claim(source()))!; expect(await h.store.prepare(claim, null)).toBeNull();
    expect(await createClaudeCustomerCallsStore(h.db).claim(source())).toBeNull(); expect(await h.tasks.list()).toEqual([]);
    expect(JSON.parse(receipts(h)[0].metadata).phase).toBe("no_task");
  });
  it("retains failed receipts without hidden retries or fallbacks", async () => {
    const h = port(); const claim = (await h.store.claim(source()))!; await h.store.fail(claim, "GENERATION_FAILED");
    expect(await h.store.claim(source())).toBeNull(); expect(await h.tasks.list()).toEqual([]); expect(JSON.parse(receipts(h)[0].metadata)).toMatchObject({ phase: "failed", code: "GENERATION_FAILED" });
  });
  it("rejects assistant-only, historical or invented task evidence and rolls back task creation", async () => {
    const h = port(); const claim = (await h.store.claim(source()))!;
    for (const evidenceQuote of ["Staff will review your request.", "Cancel yesterday's booking", "invented source"]) await expect(h.store.prepare(claim, { ...plan, items: [{ title: "Wrong", evidenceQuote }] })).rejects.toThrow("caller's actual words");
    expect(await h.tasks.list()).toEqual([]); expect(JSON.parse(receipts(h)[0].metadata).phase).toBe("generating");
  });
  it("does not bind to a missing or different provider call or a mutated source snapshot", async () => {
    const h = port(); await expect(h.store.claim({ ...source(), voiceCallId: 78 })).rejects.toThrow("changed");
    await expect(h.store.claim({ ...source(), providerCallId: "other-call" })).rejects.toThrow("changed");
    const raw = source(); const claim = (await h.store.claim(raw))!; raw.customerTurns[0] = "caller mutation"; expect(claim.source.customerTurns[0]).not.toBe(raw.customerTurns[0]);
    await expect(h.store.prepare({ ...claim, source: { ...claim.source, transcript: "mutated" } }, plan)).rejects.toThrow("changed");
  });
  it("rejects truncated TEXT receipts and task envelopes, never silently loses transcript evidence", async () => {
    const h = port(); h.truncate(true); await expect(h.store.claim(source())).rejects.toThrow("changed"); expect(h.state().cards).toHaveLength(0);
    h.truncate(false); const c = (await h.store.claim(source()))!; h.truncate(true); await expect(h.store.prepare(c, plan)).rejects.toThrow(); expect(await h.tasks.list()).toEqual([]);
  });
  it("rolls back failed preparation and preserves the existing claimed receipt", async () => {
    const h = port(); const c = (await h.store.claim(source()))!; h.failWrites(true); await expect(h.store.prepare(c, plan)).rejects.toThrow(); h.failWrites(false);
    expect(await h.tasks.list()).toEqual([]); expect(JSON.parse(receipts(h)[0].metadata).phase).toBe("generating");
  });
  it("keeps call task visible on repeated Claim; requires owner and explicit nonempty completion note", async () => {
    const h = port(); const c = (await h.store.claim(source()))!; const id = (await h.store.prepare(c, plan))!;
    const claimed = await h.tasks.claimTask(id, owner); expect(await h.tasks.claimTask(id, owner)).toEqual(claimed);
    expect((await h.tasks.list())[0].status).toBe("claimed"); await expect(h.tasks.claimTask(id, other)).rejects.toThrow("already claimed");
    await expect(h.tasks.completeTask(id, "", owner)).rejects.toThrow("completion note"); await expect(h.tasks.completeTask(id, "Done", other)).rejects.toThrow("Only the staff");
    const done = await h.tasks.completeTask(id, "Reviewed Friday change and oven cleaning", owner);
    expect(done).toMatchObject({ status: "done", completedBy: owner, completionNote: "Reviewed Friday change and oven cleaning" }); expect(done.items.every(i => i.completedBy?.id === owner.id)).toBe(true);
    expect(done.reply.status).toBe("not_applicable");
  });
  it("executes a complete synthetic call-to-task-to-human-Done trace using actual coordinator and store", async () => {
    const h = port(); const generate = vi.fn(async () => plan);
    const options = { readSource: vi.fn(async () => source()), store: h.store, generate }; const handle = createClaudeCustomerCallTaskHandler(options);
    const created = await handle({ message: { call: { id: "synthetic-call" } } }); expect(created.status).toBe("created");
    const duplicate = await createClaudeCustomerCallTaskHandler({ ...options, store: createClaudeCustomerCallsStore(h.db) })({ message: { call: { id: "synthetic-call" } } }); expect(duplicate.status).toBe("duplicate"); expect(generate).toHaveBeenCalledTimes(1);
    const task = (await h.tasks.list())[0]; await h.tasks.claimTask(task.id, owner); expect((await h.tasks.get(task.id))?.status).toBe("claimed");
    await h.tasks.completeItem(task.id, "item-1", owner); await h.tasks.completeTask(task.id, "Both actions completed by staff", owner);
    expect((await h.tasks.get(task.id))?.status).toBe("done"); expect(h.state().cards.filter((r: any) => r.channel === "command")).toHaveLength(1);
  });
});


describe("quoted booking request retains the existing AI CALL task card", () => {
  it("persists one unclaimed call task after a quote link, not Done or a confirmed booking", async () => {
    const h = port();
    const generate = withCallBookingQuoteTask({ hasSavedQuote: async id => id === "synthetic-call", generate: async () => null });
    const handle = createClaudeCustomerCallTaskHandler({ readSource: async () => source(), store: h.store, generate });
    const created = await handle({ message: { call: { id: "synthetic-call" } } });
    expect(created.status).toBe("created");
    const task = (await h.tasks.list())[0];
    expect(task.status).toBe("unclaimed"); expect(task.completedAt).toBeNull();
    expect(task.title).toBe("Follow up on cleaning booking link");
    expect(task.items[0].title).toBe("Review the customer's booking-link completion");
    expect(task.items[0].evidenceQuote).toBe(source().customerTurns[0]);
    expect(h.state().cards.filter((row: any) => row.channel === "command")).toHaveLength(1);
    expect((await handle({ message: { call: { id: "synthetic-call" } } })).status).toBe("duplicate");
    await h.tasks.claimTask(task.id, owner); expect((await h.tasks.get(task.id))?.status).toBe("claimed");
    await expect(h.tasks.completeTask(task.id, "", owner)).rejects.toThrow("completion note");
    await h.tasks.completeTask(task.id, "Customer completion reviewed by staff", owner);
    expect((await h.tasks.get(task.id))?.status).toBe("done");
  });
  it("preserves non-quote tasks exactly and keeps additional requested caller actions on quote cards", async () => {
    expect(await withCallBookingQuoteTask({ hasSavedQuote: async () => false, generate: async () => plan })(source())).toBe(plan);
    const quoted = await withCallBookingQuoteTask({ hasSavedQuote: async () => true, generate: async () => plan })(source());
    expect(quoted!.items.slice(0, plan.items.length)).toEqual(plan.items);
    expect(quoted!.items).toHaveLength(plan.items.length + 1);
  });
});
