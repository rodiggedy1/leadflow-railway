import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { customerEmailTaskSchema, customerSmsTaskSchema, customerTaskSchema, CLAUDE_CUSTOMER_TASK_ACTION } from "../../shared/claudeCustomerTasks";
import { CUSTOMER_EMAIL_RECEIPT_ACTION, CUSTOMER_EMAIL_RECEIPT_CHANNEL, dispatchClaudeCustomerEmail, type CustomerEmailSnapshot } from "./claudeCustomerEmail";
import { customerEmailBinding } from "./claudeCustomerEmailSource";
import { createClaudeCustomerEmailStore } from "./claudeCustomerEmailStore";
import { createClaudeCustomerTasksStore } from "./claudeCustomerTasksStore";
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));

const now = Date.parse("2026-11-16T20:00:00Z");
const source = "  Please move my visit to Friday.\nUse gate 1234.\n";
const plan = { replyText: "We will take care of this and confirm once changed.", task: { title: "Move visit and update gate", items: [
  { title: "Move visit", evidenceQuote: "move my visit to Friday" }, { title: "Update gate", evidenceQuote: "Use gate 1234" },
] } };
const owner = { id: "17", name: "Sam" }, other = { id: "18", name: "Sam" };
function snapshot(id = "gmail-in-1", createdAt = now): CustomerEmailSnapshot {
  return { mailboxEmail: "office@example.com", threadId: "actual-gmail-thread", messages: [{
    id, threadId: "actual-gmail-thread", fromEmail: "jane@example.com", fromName: "Jane", to: "office@example.com",
    replyToEmail: "reply@example.com", subject: "Visit change", text: source, html: "<p>Complete original html</p>", createdAt,
    headers: { From: "Jane <jane@example.com>", To: "office@example.com", "Reply-To": "reply@example.com", "Message-ID": `<${id}@example.com>`, Subject: "Visit change" }, labelIds: ["INBOX", "UNREAD"],
  }] };
}
function port() {
  const binding = customerEmailBinding(snapshot(), "gmail-in-1", now + 10)!;
  let state: any = { cards: [], sent: [], legacy: [], meta: [{ id: 1, threadId: binding.threadId, senderEmail: binding.fromEmail, lastMessageAt: now, messageCount: 1 }], next: 100 };
  const queries: Array<{ sql: string; params: any[] }> = [];
  let tail = Promise.resolve(), failure = "", truncate = false, maxBytes = Infinity;
  const db: any = {
    async transaction(fn: any) {
      let release!: () => void;
      const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const before = structuredClone(state);
      try { return await fn(db); } catch (error) { state = before; throw error; } finally { release(); }
    },
    insert(table: any) { return { async values(values: any) {
      const name = getTableName(table);
      if (failure === `insert:${name}` || failure === `insert:${values.quickAction}`) throw new Error("offline insert failure");
      const target = name === "ops_chat_messages" ? state.cards : name === "gmail_sent_log" ? state.sent : null;
      if (!target) throw new Error(`Unexpected table ${name}`);
      if (values.metadata && Buffer.byteLength(values.metadata, "utf8") > maxBytes) throw Object.assign(new Error("offline TEXT storage overflow"), { code: "ER_DATA_TOO_LONG" });
      if (target.some((row: any) => name === "ops_chat_messages" ? values.activeDedupKey && row.activeDedupKey === values.activeDedupKey : row.messageId === values.messageId)) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      const id = ++state.next;
      target.push({ sessionId: null, sentAt: new Date(), id, ...structuredClone(values), ...(truncate && values.metadata ? { metadata: values.metadata.slice(0, -1) } : {}) });
      return [{ insertId: id, affectedRows: 1 }];
    } }; },
    async execute(query: any) {
      const q = new MySqlDialect().sqlToQuery(query); queries.push(q);
      const s = q.sql.replace(/\s+/g, " "), p = q.params;
      if (failure && s.includes(failure)) throw new Error("offline SQL failure");
      if (s.startsWith("SELECT")) {
        if (s.includes("FROM gmail_thread_meta")) return [state.meta.filter((row: any) => row.threadId === p[0])];
        if (s.includes("FROM madison_email_drafts")) return [state.legacy.filter((row: any) => row.threadId === p[0])];
        if (s.includes("FROM gmail_sent_log WHERE threadId")) return [state.sent.filter((row: any) => row.threadId === p[0] && Number(row.sentAt) >= Number(p[1]))];
        if (s.includes("FROM gmail_sent_log WHERE messageId")) return [state.sent.filter((row: any) => row.messageId === p[0])];
        if (s.includes("FROM ops_chat_messages WHERE activeDedupKey")) return [state.cards.filter((row: any) => row.activeDedupKey === p[0])];
        if (s.includes("FROM ops_chat_messages WHERE id")) return [state.cards.filter((row: any) => row.id === p[0] && row.quickAction === p[1])];
        if (s.includes("FROM ops_chat_messages WHERE quickAction")) return [state.cards.filter((row: any) => row.quickAction === p[0] && row.channel === "command").sort((a: any, b: any) => b.id - a.id)];
      }
      if (s.startsWith("UPDATE ops_chat_messages")) {
        const row = state.cards.find((row: any) => row.id === p[2] && row.quickAction === p[3]
          && (p.length === 4 || row.channel === p[4] && row.activeDedupKey === p[5]));
        if (!row) return [{ affectedRows: 0 }];
        if (Buffer.byteLength(p[0] as string, "utf8") > maxBytes) throw new Error("offline TEXT storage overflow");
        row.metadata = truncate ? (p[0] as string).slice(0, -1) : p[0]; row.lastActivityAt = p[1]; return [{ affectedRows: 1 }];
      }
      throw new Error(`Unmocked SQL ${s}`);
    },
  };
  const store = createClaudeCustomerEmailStore(db), tasks = createClaudeCustomerTasksStore(db);
  const receipts = () => state.cards.filter((row: any) => row.quickAction === CUSTOMER_EMAIL_RECEIPT_ACTION && JSON.parse(row.metadata).type === "receipt");
  const taskRows = () => state.cards.filter((row: any) => row.quickAction === CLAUDE_CUSTOMER_TASK_ACTION);
  const receipt = () => JSON.parse(receipts()[0].metadata);
  async function prepared() { const claim = (await store.claim(binding))!; expect(claim).not.toBeNull(); expect(await store.prepare(claim, plan)).toBe(true); return claim; }
  const nextBinding = () => {
    const captured = snapshot("gmail-in-2", now + 100);
    captured.messages.unshift(snapshot().messages[0]);
    Object.assign(state.meta[0], { lastMessageAt: now + 100, messageCount: 2 });
    return customerEmailBinding(captured, "gmail-in-2", now + 110)!;
  };
  return { db, store, tasks, binding, queries, receipts, receipt, taskRows, prepared, nextBinding, state: () => state,
    fail: (value: string) => { failure = value; }, truncate: (value: boolean) => { truncate = value; }, maxBytes: (value: number) => { maxBytes = value; } };
}

describe("email store — offline actual transactional SQL metadata port", () => {
  beforeEach(() => { vi.stubEnv("CLAUDE_CUSTOMER_EMAIL_ENABLED", "true"); vi.stubEnv("CLAUDE_CUSTOMER_EMAIL_START_AT", "2026-11-16T19:00:00Z"); });
  afterEach(() => { vi.unstubAllEnvs(); });
  it("claims before model once, uses private distinct SHA256 keys below 128 chars and immutable original source", async () => {
    const h = port();
    const claims = await Promise.all([h.store.claim(h.binding), h.store.claim(h.binding)]);
    expect(claims.filter(Boolean)).toHaveLength(1); expect(h.receipts()).toHaveLength(1); expect(h.state().cards).toHaveLength(2);
    expect(h.state().cards.every((row: any) => row.channel === CUSTOMER_EMAIL_RECEIPT_CHANNEL && row.sessionId === null)).toBe(true);
    expect(new Set(h.state().cards.map((row: any) => row.activeDedupKey)).size).toBe(2);
    expect(h.state().cards.every((row: any) => row.activeDedupKey.length <= 128 && /:[a-f0-9]{64}$/.test(row.activeDedupKey))).toBe(true);
    const captured = structuredClone(h.receipt().binding); h.binding.snapshot.messages[0].text = "caller mutated source";
    expect(h.receipt().binding).toEqual(captured); expect(claims.find(Boolean)?.binding.snapshot.messages[0].text).toBe(source);
    expect(h.queries.every(q => !/^(INSERT|UPDATE|DELETE)/.test(q.sql) || q.sql.includes("ops_chat_messages"))).toBe(true);
  });
  it("creates exact same canonical task and reply atomically before provider submission, with real email identity and no fake SMS fields", async () => {
    const h = port(), c = await h.prepared(), task = (await h.tasks.list())[0];
    expect(h.receipt()).toMatchObject({ phase: "SENDING", taskId: task.id, replyText: plan.replyText, providerMessageId: null });
    expect(task).toMatchObject({ kind: CLAUDE_CUSTOMER_TASK_ACTION, sessionId: null, customerPhone: null, receivingPhoneNumberId: null,
      receivingPhoneNumber: null, sourceText: source, sourceMessageId: "gmail-in-1", email: { threadId: h.binding.threadId, mailboxEmail: h.binding.mailboxEmail,
        recipientEmail: "reply@example.com", rfcMessageId: h.binding.rfcMessageId }, reply: { text: plan.replyText, status: "prepared" } });
    expect(customerEmailTaskSchema.parse(task)).toEqual(task); expect(customerSmsTaskSchema.safeParse(task).success).toBe(false);
    expect(await h.store.prepare(c, plan)).toBe(false); expect(h.taskRows()).toHaveLength(1);
  });
  it("HTML-only original source remains complete and carries its representation into the same task", async () => {
    const h = port(), captured = snapshot();
    captured.messages[0].text = "";
    captured.messages[0].html = "<p>Please move my visit to Friday.</p><p>Use gate 1234.</p>";
    const b = customerEmailBinding(captured, "gmail-in-1", now + 10)!;
    const c = (await h.store.claim(b))!;
    expect(await h.store.prepare(c, plan)).toBe(true);
    const task = (await h.tasks.list())[0];
    expect(task.sourceText).toBe(captured.messages[0].html);
    expect("email" in task && task.email.bodyFormat).toBe("html");
    expect(await h.store.recordAcceptance(c, "html-accepted-id")).toBe(true);
    expect((await h.tasks.get(task.id))?.sourceText).toBe(captured.messages[0].html);
  });
  it.each(["insert:claude_customer_task", "UPDATE ops_chat_messages SET metadata"])("prepare %s failure rolls back exact task and SENDING together", async failure => {
    const h = port(), c = (await h.store.claim(h.binding))!, before = structuredClone(h.state()); h.fail(failure);
    await expect(h.store.prepare(c, plan)).rejects.toThrow("offline"); expect(h.state()).toEqual(before); expect(h.receipt().phase).toBe("generating");
  });
  it("metadata TEXT read-back failure aborts claim rather than losing immutable evidence", async () => {
    const h = port(); h.truncate(true); await expect(h.store.claim(h.binding)).rejects.toThrow("round-trip"); expect(h.state().cards).toHaveLength(0);
  });
  it("complete large UTF8 source is retained when storage fits; real TEXT overflow is a blocker with rollback, never truncation", async () => {
    const h = port(), captured = snapshot(); captured.messages[0].text = `${source}${"é".repeat(40000)}`;
    const b = customerEmailBinding(captured, "gmail-in-1", now + 10)!;
    h.maxBytes(65535); await expect(h.store.claim(b)).rejects.toThrow("overflow"); expect(h.state().cards).toHaveLength(0);
    h.maxBytes(Infinity); const c = (await h.store.claim(b))!; expect(h.receipt().binding.snapshot.messages[0].text).toBe(captured.messages[0].text);
    expect(await h.store.prepare(c, { replyText: "Exact full source answer", task: null })).toBe(true);
  });
  it("provider acceptance atomically attributes Instinct and updates canonical task, replay once, never delivery", async () => {
    const h = port(), c = await h.prepared(); expect(await h.store.recordAcceptance(c, "gmail-out-1")).toBe(true);
    expect(h.state().sent).toHaveLength(1); expect(h.state().sent[0]).toMatchObject({ threadId: h.binding.threadId, messageId: "gmail-out-1", agentName: "Instinct", agentOpenId: "instinct" });
    expect((await h.tasks.list())[0].reply).toEqual({ text: plan.replyText, status: "sent", providerMessageId: "gmail-out-1" });
    expect(h.receipt()).not.toHaveProperty("deliveredAt"); expect(await h.store.recordAcceptance(c, "gmail-out-1")).toBe(true);
    await expect(h.store.recordAcceptance(c, "gmail-out-2")).rejects.toMatchObject({ code: "CONFLICT" }); expect(h.state().sent).toHaveLength(1);
    expect(await h.store.ownsThread(h.binding.threadId)).toBe(false);
  });
  it("acceptance write failure rolls back attribution and task, permanent uncertainty blocks every resend/human/claim", async () => {
    const h = port(), c = await h.prepared(), before = structuredClone(h.state()); h.fail("UPDATE ops_chat_messages");
    await expect(h.store.recordAcceptance(c, "gmail-out-1")).rejects.toThrow(); expect(h.state()).toEqual(before);
    h.fail(""); await h.store.markUncertain(c); expect(h.receipt().phase).toBe("uncertain"); expect((await h.tasks.list())[0].reply.status).toBe("uncertain");
    await h.store.suppress(c, "UNSAFE_RESET"); expect(h.receipt().phase).toBe("uncertain");
    expect(await h.store.recordAcceptance(c, "gmail-out-1")).toBe(false); expect(await h.store.prepare(c, plan)).toBe(false);
    expect(await h.store.claim(h.binding)).toBeNull(); expect(await h.store.claim(h.nextBinding())).toBeNull();
    await expect(h.store.guardHumanReply(h.binding.threadId)).rejects.toThrow("CUSTOMER_EMAIL_IN_FLIGHT_OR_UNCERTAIN");
    expect(await h.store.ownsThread(h.binding.threadId)).toBe(true); expect(h.state().sent).toHaveLength(0);
  });
  it("every inbound has a distinct permanent receipt in the same actual thread after accepted/suppressed predecessors", async () => {
    const h = port(), c = await h.prepared(); await h.store.recordAcceptance(c, "gmail-out-1");
    // Anchor is later than the prior send in this synthetic clock.
    h.state().sent[0].sentAt = new Date(now + 50);
    const b = h.nextBinding(), second = (await h.store.claim(b))!; expect(second).not.toBeNull(); await h.store.suppress(second, "DISABLED");
    expect(h.receipts()).toHaveLength(2); expect(h.receipts().map((row: any) => JSON.parse(row.metadata).binding.threadId)).toEqual([h.binding.threadId, h.binding.threadId]);
    expect(new Set(h.receipts().map((row: any) => row.activeDedupKey)).size).toBe(2); expect(h.receipt().phase).toBe("sent");
    expect(await h.store.claim(b)).toBeNull(); expect(await h.store.claim(h.binding)).toBeNull();
    expect(h.receipts().every((row: any) => !!row.activeDedupKey && row.cardStatus === "active")).toBe(true);
    expect(await h.store.ownsThread(h.binding.threadId)).toBe(false);
  });
  it("cross-inbound same-thread SENDING cannot be overwritten even before uncertainty is recorded", async () => {
    const h = port(); await h.prepared(); const original = structuredClone(h.receipts());
    expect(await h.store.claim(h.nextBinding())).toBeNull(); expect(h.receipts()).toEqual(original);
  });
  it("flag-off no-claim guard is read-only even without historical metadata; enabled unrelated/old manual sends remain unchanged", async () => {
    const h = port(); vi.stubEnv("CLAUDE_CUSTOMER_EMAIL_ENABLED", "false"); h.state().meta = [];
    await h.store.guardHumanReply(h.binding.threadId); expect(h.state().cards).toHaveLength(0);
    expect(h.queries.every(q => q.sql.startsWith("SELECT"))).toBe(true);
    vi.stubEnv("CLAUDE_CUSTOMER_EMAIL_ENABLED", "true");
    await h.store.guardHumanReply(h.binding.threadId); expect(h.state().cards).toHaveLength(0);
    h.state().meta = [{ threadId: h.binding.threadId, lastMessageAt: now - 7200000, messageCount: 1 }];
    await h.store.guardHumanReply(h.binding.threadId); expect(h.state().cards).toHaveLength(0);
  });
  it("disabled human guard still protects existing SENDING/uncertain authority without releasing any receipts", async () => {
    const h = port(), c = await h.prepared(); vi.stubEnv("CLAUDE_CUSTOMER_EMAIL_ENABLED", "false");
    await expect(h.store.guardHumanReply(h.binding.threadId)).rejects.toThrow("CUSTOMER_EMAIL_IN_FLIGHT_OR_UNCERTAIN");
    await h.store.markUncertain(c);
    await expect(h.store.guardHumanReply(h.binding.threadId)).rejects.toThrow("CUSTOMER_EMAIL_IN_FLIGHT_OR_UNCERTAIN");
    expect(await h.store.ownsThread(h.binding.threadId)).toBe(true);
  });
  it("coordinator-only known-not-submitted suppression releases prepared acknowledgment but preserves source/key forever", async () => {
    const h = port(), c = await h.prepared(), originalBinding = structuredClone(h.receipt().binding), originalKey = h.receipts()[0].activeDedupKey;
    await h.store.suppress(c, "EMAIL_PRE_SUBMISSION_FAILED");
    expect(h.receipt()).toMatchObject({ phase: "suppressed", code: "EMAIL_PRE_SUBMISSION_FAILED", binding: originalBinding });
    expect(h.receipts()[0].activeDedupKey).toBe(originalKey); expect((await h.tasks.list())[0].reply.status).toBe("suppressed");
    expect(await h.store.claim(h.binding)).toBeNull(); expect(await h.store.recordAcceptance(c, "wrong-later-id")).toBe(false);
    expect(h.state().sent).toHaveLength(0);
  });
  it("human reply wins against generating and permanently guards its exact anchor", async () => {
    const h = port(), c = (await h.store.claim(h.binding))!; await h.store.guardHumanReply(h.binding.threadId);
    expect(h.receipt()).toMatchObject({ phase: "suppressed", code: "HUMAN_REPLY" }); expect(await h.store.prepare(c, plan)).toBe(false);
    expect(h.taskRows()).toHaveLength(0); expect(await h.store.claim(h.binding)).toBeNull(); expect(await h.store.ownsThread(h.binding.threadId)).toBe(false);
    const b = h.nextBinding(); expect(await h.store.claim(b)).not.toBeNull();
  });
  it("human-first authority and generating-first authority serialize under the same real thread lock", async () => {
    const first = port(); await first.store.guardHumanReply(first.binding.threadId); expect(await first.store.claim(first.binding)).toBeNull();
    const h = port(), c = (await h.store.claim(h.binding))!;
    const results = await Promise.allSettled([h.store.prepare(c, plan), h.store.guardHumanReply(h.binding.threadId)]);
    expect(results[0]).toMatchObject({ status: "fulfilled", value: true }); expect(results[1]).toMatchObject({ status: "rejected", reason: { message: "CUSTOMER_EMAIL_IN_FLIGHT_OR_UNCERTAIN" } });
    expect(h.receipt().phase).toBe("SENDING");
  });
  it.each(["SENDING", "DRAFT_READY", "TOOLS_RUNNING", "RECEIVED", "CLASSIFIED", "uncertain"])("real-thread active legacy %s blocks claim/prepare without rewriting it", async status => {
    const h = port(), c = (await h.store.claim(h.binding))!;
    h.state().legacy.push({ id: 8, threadId: h.binding.threadId, status: status === "uncertain" ? "FAILED" : status,
      errorCode: status === "uncertain" ? "SUBMISSION_UNCERTAIN" : null, originalMessage: "protected legacy original" });
    const before = structuredClone(h.state().legacy); expect(await h.store.prepare(c, plan)).toBe(false); expect(h.state().legacy).toEqual(before);
    const next = h.nextBinding(); expect(await h.store.claim(next)).toBeNull(); expect(h.state().legacy).toEqual(before);
    expect(h.queries.filter(q => q.sql.includes("madison_email_drafts")).every(q => q.sql.startsWith("SELECT") && q.params[0] === h.binding.threadId)).toBe(true);
  });
  it("a proven older unsent draft does not suppress a distinct new message in the full same thread", async () => {
    const h = port(), b = h.nextBinding();
    h.state().legacy.push({ id: 8, threadId: h.binding.threadId, status: "DRAFT_READY", inboundMessageId: h.binding.inboundMessageId });
    const original = structuredClone(h.state().legacy);
    const c = (await h.store.claim(b))!;
    expect(c).not.toBeNull(); expect(await h.store.prepare(c, plan)).toBe(true);
    expect(h.state().legacy).toEqual(original);
  });
  it.each(["date", "count", "sender", "sent-log"])("DB source freshness %s change suppresses without creating task", async kind => {
    const h = port(), c = (await h.store.claim(h.binding))!;
    if (kind === "date") h.state().meta[0].lastMessageAt++;
    if (kind === "count") h.state().meta[0].messageCount++;
    if (kind === "sender") h.state().meta[0].senderEmail = "other@example.com";
    if (kind === "sent-log") h.state().sent.push({ id: 7, threadId: h.binding.threadId, sentAt: new Date(now + 1) });
    expect(await h.store.prepare(c, plan)).toBe(false); expect(h.taskRows()).toHaveLength(0); expect(h.receipt().phase).toBe("suppressed");
  });
  it("full binding changes to identity, headers, snapshot, actual source, or receipt key reject all writes", async () => {
    const h = port(), c = await h.prepared(), before = structuredClone(h.state());
    for (const mutate of [(x: any) => x.binding.recipientEmail = "wrong@example.com", (x: any) => x.binding.rfcMessageId = "<wrong@example.com>",
      (x: any) => x.binding.snapshot.messages[0].html = "different html", (x: any) => x.receiptId++, (x: any) => x.key = "other-key"]) {
      const changed = structuredClone(c); mutate(changed); await expect(h.store.recordAcceptance(changed, "out-id")).rejects.toThrow(); expect(h.state()).toEqual(before);
    }
  });
  it("non-task replies still persist exact SENDING/accepted receipt and require no synthetic task", async () => {
    const h = port(), c = (await h.store.claim(h.binding))!; expect(await h.store.prepare(c, { replyText: "Grounded original answer", task: null })).toBe(true);
    expect(h.receipt()).toMatchObject({ taskId: null, phase: "SENDING", replyText: "Grounded original answer" });
    expect(await h.store.recordAcceptance(c, "gmail-out-1")).toBe(true); expect(h.taskRows()).toHaveLength(0);
  });
  it("same canonical regular-agent ownership/item/note/done rules, exact actor identity, no send from completion", async () => {
    const h = port(); await h.prepared(); const task = (await h.tasks.list())[0];
    await expect(h.tasks.completeTask(task.id, "done", owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.tasks.claimTask(task.id, owner); await expect(h.tasks.claimTask(task.id, other)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(h.tasks.completeTask(task.id, "done", other)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.tasks.completeTask(task.id, "  ", owner)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await h.tasks.completeItem(task.id, "item-1", owner); expect((await h.tasks.get(task.id))?.status).toBe("claimed");
    const before = structuredClone(h.receipts()), queriesBefore = h.queries.length;
    const done = await h.tasks.completeTask(task.id, " Manually made the changes ", owner);
    expect(done).toMatchObject({ status: "done", owner, completedBy: owner, completionNote: "Manually made the changes" });
    expect(done.items.every(item => item.completedBy?.id === owner.id)).toBe(true); expect(h.receipts()).toEqual(before); expect(h.state().sent).toHaveLength(0);
    expect(h.queries.slice(queriesBefore).every(q => q.sql.includes("ops_chat_messages"))).toBe(true);
    expect(await h.tasks.completeTask(task.id, "must not overwrite", owner)).toEqual(done);
    expect(await h.tasks.list()).toEqual([done]);
  });
  it("email row session must actually be NULL; strict SMS parse rejects email routing and mixed phone identity", async () => {
    const h = port(); await h.prepared(); const row = h.taskRows()[0], task = JSON.parse(row.metadata).task;
    expect(customerTaskSchema.safeParse({ ...task, sessionId: 7 }).success).toBe(false);
    expect(customerTaskSchema.safeParse({ ...task, customerPhone: "+17035551234" }).success).toBe(false);
    row.sessionId = 0; await expect(h.tasks.get(task.id)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("coordinator/store exact-task-before-send and canonical human completion stay offline with one mocked provider", async () => {
    const h = port();
    const send = vi.fn(async () => { expect(h.receipt().phase).toBe("SENDING"); expect((await h.tasks.list())[0].sourceText).toBe(source); return { messageId: "gmail-out-1", threadId: h.binding.threadId }; });
    expect(await dispatchClaudeCustomerEmail(h.binding, { readConfig: () => ({ enabled: true, startAt: now - 1 }), store: h.store,
      readCurrent: async () => true, generate: async () => plan, send })).toBe("sent");
    const task = (await h.tasks.list())[0]; await h.tasks.claimTask(task.id, owner); await h.tasks.completeTask(task.id, "Completed manually", owner);
    expect(send).toHaveBeenCalledTimes(1); expect(h.state().sent).toHaveLength(1);
    expect(await dispatchClaudeCustomerEmail(h.binding, { readConfig: () => ({ enabled: true, startAt: now - 1 }), store: h.store,
      readCurrent: async () => true, generate: async () => { throw new Error("must not regenerate"); }, send })).toBe("duplicate");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
