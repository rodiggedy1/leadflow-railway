import { createHash } from "node:crypto";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { CLAUDE_CUSTOMER_REPLY_CAPABILITY as capability, CLAUDE_CUSTOMER_TASK_ACTION as action } from "../../shared/claudeCustomerTasks";
import { createClaudeCustomerTasksStore, type CustomerSmsBinding } from "./claudeCustomerTasksStore";
import { createClaudeCustomerSmsService } from "./claudeCustomerSms";
import { createClaudeCustomerSmsGenerator } from "./claudeCustomerSmsGeneration";
import { createClaudeCustomerTasksRouter } from "../claudeCustomerTasksRouter";
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../_core/agentAuth", () => ({ getAgentFromRequest: vi.fn(async () => null) }));

const owner = { id: "17", name: "Sam" }, other = { id: "18", name: "Sam" };
const plan = { replyText: "We'll take care of this and confirm once changed.", task: { title: "Move the visit and update access notes", items: [
  { title: "Move the visit to Friday", evidenceQuote: "move my visit to Friday" },
  { title: "Update the access instructions", evidenceQuote: "use gate 1234" },
] } };
function port(options: Parameters<typeof createClaudeCustomerTasksStore>[1] = {}) {
  const history = JSON.stringify([{ role: "user", content: "Please move my visit to Friday and use gate 1234", ts: 100, opMsgId: "inbound-1" }]);
  const binding: CustomerSmsBinding = { account: "account-1", sessionId: 7, providerMessageId: "inbound-1", fromPhone: "+17035551234",
    receivingPhoneNumberId: "PN-cs", receivingPhoneNumber: "+12028885362", inboundText: "Please move my visit to Friday and use gate 1234",
    createdAt: 100, receivedAt: 110, customerName: "Jane", historyHash: createHash("sha256").update(history).digest("hex") };
  let state: any = { sessions: [{ id: 7, leadPhone: binding.fromPhone, lastInboundPhoneNumberId: "PN-cs", smsOptOut: 0, messageCount: 1,
    leadSource: "cs-inbound", csQueue: "Clients", stage: "CS_INBOUND",
    messageHistory: history }], drafts: [], cards: [], next: 100, optouts: [] };
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let tail = Promise.resolve(), failure = "";
  const db: any = {
    async transaction(fn: any) {
      let release!: () => void;
      const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const before = structuredClone(state);
      try { return await fn(db); } catch (error) { state = before; throw error; } finally { release(); }
    },
    insert(table: any) { return { async values(values: any) {
      const name = getTableName(table);
      if (failure === name) throw new Error("offline insert failure");
      const target = name === "madison_sms_drafts" ? state.drafts : name === "ops_chat_messages" ? state.cards : null;
      if (!target) throw new Error(`Unexpected table ${name}`);
      if (target.some((row: any) => name === "madison_sms_drafts" ? row.inboundOpenPhoneId === values.inboundOpenPhoneId
        : values.activeDedupKey && row.activeDedupKey === values.activeDedupKey)) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      const id = ++state.next; target.push({ id, ...structuredClone(values) }); return [{ insertId: id, affectedRows: 1 }];
    } }; },
    async execute(query: any) {
      const q = new MySqlDialect().sqlToQuery(query); queries.push(q);
      const s = q.sql.replace(/\s+/g, " "), p = q.params;
      if (failure && s.includes(failure)) throw new Error("offline SQL failure");
      if (s.startsWith("SELECT")) {
        if (s.includes("FROM madison_sms_drafts WHERE inboundOpenPhoneId")) return [state.drafts.filter((row: any) => row.inboundOpenPhoneId === p[0])];
        if (s.includes("FROM madison_sms_drafts WHERE id")) return [state.drafts.filter((row: any) => row.id === p[0])];
        if (s.includes("FROM conversation_sessions WHERE id")) return [state.sessions.filter((row: any) => row.id === p[0])];
        if (s.includes("FROM sms_opt_outs")) return [state.optouts];
        if (s.includes("FROM ops_chat_messages WHERE id")) return [state.cards.filter((row: any) => row.id === p[0] && row.quickAction === p[1])];
        if (s.includes("FROM ops_chat_messages WHERE quickAction")) return [state.cards.filter((row: any) => row.quickAction === p[0] && row.channel === "command").sort((a: any, b: any) => b.id - a.id)];
      }
      if (s.startsWith("UPDATE ops_chat_messages")) {
        const row = state.cards.find((row: any) => row.id === p[2] && row.quickAction === p[3]);
        if (!row) return [{ affectedRows: 0 }]; row.metadata = p[0]; row.lastActivityAt = p[1]; return [{ affectedRows: 1 }];
      }
      if (s.startsWith("UPDATE conversation_sessions")) {
        const row = state.sessions.find((row: any) => row.id === p[3] && row.leadPhone === p[4]);
        if (!row) return [{ affectedRows: 0 }]; row.messageHistory = JSON.stringify([...JSON.parse(row.messageHistory), JSON.parse(p[0] as string)]);
        Object.assign(row, { lastMessageText: p[1], lastMessageTs: p[2], lastMessageRole: "assistant", messageCount: row.messageCount + 1 });
        return [{ affectedRows: 1 }];
      }
      if (s.startsWith("UPDATE madison_sms_drafts")) {
        if (s.includes("SET status = 'SENDING'")) {
          const row = state.drafts.find((row: any) => row.id === p[3] && row.capability === p[4] && row.status === "TOOLS_RUNNING");
          if (!row) return [{ affectedRows: 0 }]; Object.assign(row, { status: "SENDING", generatedDraft: p[0], approvedText: p[1], capabilityResult: JSON.parse(p[2] as string) });
        } else if (s.includes("SET status = 'SENT'")) {
          const row = state.drafts.find((row: any) => row.id === p[1] && row.capability === p[2] && row.status === "SENDING");
          if (!row) return [{ affectedRows: 0 }]; Object.assign(row, { status: "SENT", outboundOpenPhoneId: p[0], sentAt: new Date(), errorCode: null });
        } else if (s.includes("SET status = 'DISMISSED'")) {
          const beforeSubmission = s.includes("status IN ('TOOLS_RUNNING', 'SENDING')");
          const row = state.drafts.find((row: any) => row.id === p[1] && row.capability === p[2]
            && (beforeSubmission ? ["TOOLS_RUNNING", "SENDING"].includes(row.status) && !row.outboundOpenPhoneId && !row.sentAt
              && row.errorCode !== "SUBMISSION_UNCERTAIN" : row.status === "TOOLS_RUNNING"));
          if (!row) return [{ affectedRows: 0 }]; Object.assign(row, { status: "DISMISSED", errorCode: p[0] });
        } else if (s.includes("SET errorStage = 'SEND'")) {
          const row = state.drafts.find((row: any) => row.id === p[0] && row.capability === p[1] && row.status === "SENDING");
          if (!row) return [{ affectedRows: 0 }]; row.errorCode = "SUBMISSION_UNCERTAIN";
        } else throw new Error(`Unmocked update ${s}`);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unmocked SQL: ${s}`);
    },
  };
  const store = createClaudeCustomerTasksStore(db, options);
  const task = () => JSON.parse(state.cards[0].metadata).task;
  async function prepared() { const claim = (await store.claim(binding))!; expect(await store.prepare(claim, plan)).toBe(true); return claim; }
  return { db, store, binding, queries, state: () => state, task, prepared, fail: (value: string) => { failure = value; } };
}

describe("customer task store — offline transactional SQL port", () => {
  it("claims the original provider ID exactly once under concurrent intake; no sibling or session creation", async () => {
    const h = port(); const claims = await Promise.all([h.store.claim(h.binding), h.store.claim(h.binding)]);
    expect(claims.filter(Boolean)).toHaveLength(1); expect(h.state().drafts).toHaveLength(1);
    expect(h.state().drafts[0]).toMatchObject({ inboundOpenPhoneId: "inbound-1", capability, status: "TOOLS_RUNNING" });
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(0);
    expect(h.queries.filter(q => q.sql.includes("conversation_sessions")).every(q => q.sql.includes("WHERE id ="))).toBe(true);
  });
  it.each(["DRAFT_READY", "FAILED", "SENT", "DISMISSED", "SENDING"])("an existing original-provider receipt in %s skips regardless of capability", async status => {
    const h = port(); h.state().drafts.push({ id: 900, inboundOpenPhoneId: "inbound-1", capability: "legacy_other", status });
    expect(await h.store.claim(h.binding)).toBeNull(); expect(h.queries).toHaveLength(1);
    expect(h.state().drafts).toHaveLength(1); expect(h.state().cards).toHaveLength(0);
  });
  it("errors surface instead of being mislabeled as duplicate intake", async () => {
    const h = port(); h.fail("madison_sms_drafts"); await expect(h.store.claim(h.binding)).rejects.toThrow("offline");
    expect(h.state().drafts).toHaveLength(0);
  });
  it("prepares exact text and concrete task atomically before any sender could run; source snapshot lives in same queue/stream record", async () => {
    const h = port(); const c = await h.prepared();
    expect(h.state().drafts[0]).toMatchObject({ status: "SENDING", generatedDraft: plan.replyText, approvedText: plan.replyText });
    expect(h.state().cards).toHaveLength(1); const task = h.task();
    expect(task).toMatchObject({ sourceMessageId: "inbound-1", sourceText: h.binding.inboundText, receivingPhoneNumberId: "PN-cs", status: "unclaimed", reply: { status: "prepared" } });
    expect(JSON.parse(h.state().cards[0].metadata)).toEqual({ taskId: task.id, task });
    expect(await h.store.get(task.id)).toEqual(task); expect(await h.store.list()).toEqual([task]);
    expect(await h.store.prepare(c, plan)).toBe(false); expect(h.state().cards).toHaveLength(1);
  });
  it.each(["ops_chat_messages", "UPDATE madison_sms_drafts SET status = 'SENDING'"])("prepare failure at %s rolls back task and leaves receipt pre-send", async failed => {
    const h = port(), c = (await h.store.claim(h.binding))!; h.fail(failed);
    await expect(h.store.prepare(c, plan)).rejects.toThrow(); expect(h.state().cards).toHaveLength(0);
    expect(h.state().drafts[0].status).toBe("TOOLS_RUNNING");
  });
  it("grounding rejects invented checklist evidence without any task/send write", async () => {
    const h = port(), c = (await h.store.claim(h.binding))!;
    await expect(h.store.prepare(c, { ...plan, task: { ...plan.task, items: [{ title: "Invented", evidenceQuote: "Tuesday" }] } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.state().cards).toHaveLength(0); expect(h.state().drafts[0].status).toBe("TOOLS_RUNNING");
  });
  it.each(["phone", "line", "session_optout", "global_optout", "source_kind", "queue", "interview_stage", "source_content", "source_id", "new_inbound", "human_reply", "exact_hash"])("fresh prepare rejects %s change", async change => {
    const h = port(), c = (await h.store.claim(h.binding))!, s = h.state().sessions[0];
    if (change === "phone") s.leadPhone = "+12025559876";
    if (change === "line") s.lastInboundPhoneNumberId = "PN-other";
    if (change === "session_optout") s.smsOptOut = 1;
    if (change === "global_optout") h.state().optouts = [{ id: 1 }];
    if (change === "source_kind") s.leadSource = "hiring";
    if (change === "queue") s.csQueue = "Teams";
    if (change === "interview_stage") s.stage = "INTERVIEW_READY";
    if (change === "source_content") s.messageHistory = s.messageHistory.replace("Friday", "Saturday");
    if (change === "source_id") s.messageHistory = s.messageHistory.replace("inbound-1", "inbound-2");
    if (change === "new_inbound" || change === "human_reply") s.messageHistory = JSON.stringify([...JSON.parse(s.messageHistory), { role: change === "new_inbound" ? "user" : "assistant", content: "New text", ts: 120, opMsgId: "new-1" }]);
    if (change === "exact_hash") s.messageHistory = ` ${s.messageHistory}`;
    expect(await h.store.prepare(c, plan)).toBe(false); expect(h.state().cards).toHaveLength(0);
    expect(h.state().drafts[0]).toMatchObject({ status: "DISMISSED", errorCode: "STALE_CUSTOMER_MESSAGE" });
  });
  it("even a supplied matching history hash cannot authorize an already replied-to source", async () => {
    const h = port(), s = h.state().sessions[0];
    s.messageHistory = JSON.stringify([...JSON.parse(s.messageHistory), { role: "assistant", content: "Human already replied" }]);
    h.binding.historyHash = createHash("sha256").update(s.messageHistory).digest("hex");
    await expect(h.store.claim(h.binding)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("acceptance appends to current exact-session history once, with exact text and receiving line, never delivery", async () => {
    const h = port(), c = await h.prepared();
    h.state().sessions[0].messageHistory = JSON.stringify([...JSON.parse(h.state().sessions[0].messageHistory), { role: "user", content: "New later message" }]);
    expect(await h.store.recordAcceptance(c, "outbound-1")).toBe(true);
    const history = JSON.parse(h.state().sessions[0].messageHistory);
    expect(history).toHaveLength(3); expect(history[2]).toMatchObject({ role: "assistant", content: plan.replyText, opMsgId: "outbound-1", fromNumberId: "PN-cs" });
    expect(h.task().reply).toEqual({ text: plan.replyText, status: "sent", providerMessageId: "outbound-1" });
    expect(h.state().drafts[0].status).toBe("SENT"); expect(h.state().drafts[0]).not.toHaveProperty("deliveredAt");
    expect(await h.store.recordAcceptance(c, "outbound-1")).toBe(true); expect(JSON.parse(h.state().sessions[0].messageHistory)).toHaveLength(3);
    await expect(h.store.recordAcceptance(c, "different-id")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("acceptance save failure rolls back history and preserves prepared task; uncertainty blocks retries", async () => {
    const h = port(), c = await h.prepared(), before = h.state().sessions[0].messageHistory;
    h.fail("outboundOpenPhoneId ="); await expect(h.store.recordAcceptance(c, "outbound-1")).rejects.toThrow();
    expect(h.state().sessions[0].messageHistory).toBe(before); expect(h.state().drafts[0].status).toBe("SENDING"); expect(h.task().reply.status).toBe("prepared");
    h.fail(""); await h.store.markUncertain(c); expect(h.task().reply.status).toBe("uncertain"); expect(h.state().drafts[0].status).toBe("SENDING");
    await h.store.suppress(c, "UNSAFE"); expect(h.state().drafts[0].status).toBe("SENDING");
    expect(await h.store.claim(h.binding)).toBeNull(); expect(await h.store.prepare(c, plan)).toBe(false);
  });
  it("pre-send suppression is terminal and cannot revive a receipt or create a task", async () => {
    const h = port(), c = (await h.store.claim(h.binding))!; await h.store.suppress(c, "STALE");
    expect(h.state().drafts[0]).toMatchObject({ status: "DISMISSED", errorCode: "STALE" });
    expect(await h.store.prepare(c, plan)).toBe(false); expect(await h.store.recordAcceptance(c, "outbound-1")).toBe(false);
    expect(h.state().cards).toHaveLength(0); expect(await h.store.claim(h.binding)).toBeNull();
  });
  it("releases a prepared reply only when no submission occurred, suppressing its task acknowledgment without history or retries", async () => {
    const h = port(), c = await h.prepared(), before = h.state().sessions[0].messageHistory;
    await h.store.suppressBeforeSubmission(c, "CONFIG_CHANGED");
    expect(h.state().drafts[0]).toMatchObject({ status: "DISMISSED", errorCode: "CONFIG_CHANGED" });
    expect(h.task().reply.status).toBe("suppressed"); expect(h.state().sessions[0].messageHistory).toBe(before);
    expect(await h.store.claim(h.binding)).toBeNull(); expect(await h.store.recordAcceptance(c, "later-id")).toBe(false);
  });
  it.each(["uncertain", "accepted_id", "sent_at"])("cannot release an uncertain/submitted prepared receipt: %s", async state => {
    const h = port(), c = await h.prepared();
    if (state === "uncertain") await h.store.markUncertain(c);
    if (state === "accepted_id") h.state().drafts[0].outboundOpenPhoneId = "provider-id";
    if (state === "sent_at") h.state().drafts[0].sentAt = new Date();
    await expect(h.store.suppressBeforeSubmission(c, "CONFIG_CHANGED")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.state().drafts[0].status).toBe("SENDING");
  });
  it("the explicit one-number test exception permits a cleaner/Teams snapshot without changing its role records", async () => {
    const h = port({ allowTestCustomer: phone => phone === "+17035551234" });
    Object.assign(h.state().sessions[0], { leadSource: "cs-inbound-cleaner", csQueue: "Teams" });
    const before = structuredClone(h.state().sessions[0]), c = await h.prepared();
    expect(c.binding.fromPhone).toBe("+17035551234"); expect(h.state().sessions[0]).toEqual(before);
    expect(h.task().customerPhone).toBe("+17035551234");
  });
  it.each(["other_phone", "session_optout", "global_optout"])("the test exception cannot bypass %s", async kind => {
    const h = port({ allowTestCustomer: phone => phone === (kind === "other_phone" ? "+13029816191" : "+17035551234") });
    Object.assign(h.state().sessions[0], { leadSource: "cs-inbound-cleaner", csQueue: "Teams" });
    if (kind === "session_optout") h.state().sessions[0].smsOptOut = 1;
    if (kind === "global_optout") h.state().optouts = [{ id: 1 }];
    await expect(h.store.claim(h.binding)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.state().drafts).toHaveLength(0); expect(h.state().cards).toHaveLength(0);
  });
  it("ordinary grounded answers need no task", async () => {
    const h = port(), c = (await h.store.claim(h.binding))!;
    expect(await h.store.prepare(c, { replyText: "A grounded answer", task: null })).toBe(true);
    expect(h.state().cards).toHaveLength(0); expect(await h.store.recordAcceptance(c, "outbound-1")).toBe(true);
  });
  it("concurrent task claims have one owner even with equal display names; no conversation assignment", async () => {
    const h = port(); await h.prepared(); const id = h.task().id;
    const results = await Promise.allSettled([h.store.claimTask(id, owner), h.store.claimTask(id, other)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
    expect(h.task().owner).toEqual(owner); expect(h.task().activity.filter((a: any) => a.action === "claimed")).toHaveLength(1);
    await h.store.claimTask(id, owner); expect(h.task().activity.filter((a: any) => a.action === "claimed")).toHaveLength(1);
    expect(h.state().sessions[0]).not.toHaveProperty("assignedAgentName");
    expect(h.queries.filter(q => q.sql.includes("FROM ops_chat_messages WHERE id") && q.sql.includes("FOR UPDATE")).length).toBeGreaterThan(1);
  });
  it("claim and item confirmation keep the same task claimed and listed until explicit whole-task completion", async () => {
    const h = port(); await h.prepared(); const id = h.task().id;
    const claimed = await h.store.claimTask(id, owner);
    expect(claimed).toMatchObject({ id, status: "claimed", completedAt: null, completionNote: null });
    expect(await h.store.list()).toEqual([claimed]);
    await h.store.completeItem(id, "item-1", owner); await h.store.completeItem(id, "item-2", owner);
    const stillOpen = await h.store.get(id);
    expect(stillOpen).toMatchObject({ id, status: "claimed", completedAt: null, completionNote: null });
    expect(await h.store.list()).toEqual([stillOpen]); expect(h.state().cards).toHaveLength(1);
    const done = await h.store.completeTask(id, "Both requested changes were completed manually.", owner);
    expect(done).toMatchObject({ id, status: "done", completionNote: "Both requested changes were completed manually." });
    expect(await h.store.list()).toEqual([done]); expect(h.state().cards).toHaveLength(1);
  });
  it.each([undefined, "", " \t\n "])("requires a nonempty completion note without changing the claimed task: %s", async note => {
    const h = port(); await h.prepared(); const id = h.task().id; await h.store.claimTask(id, owner);
    const before = structuredClone(h.state());
    await expect(h.store.completeTask(id, note, owner)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.state()).toEqual(before); expect((await h.store.get(id))?.status).toBe("claimed");
  });
  it("only authenticated owner confirms items/task; final confirmation marks remaining items and is idempotent, no send or business writes", async () => {
    const h = port(); await h.prepared(); const id = h.task().id;
    await expect(h.store.completeTask(id, "done", owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.store.claimTask(id, owner);
    await expect(h.store.completeItem(id, "item-1", other)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.store.completeTask(id, "done", other)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.store.completeItem(id, "missing", owner)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await h.store.completeItem(id, "item-1", owner); const queriesBefore = h.queries.length;
    const done = await h.store.completeTask(id, " Changed manually ", owner);
    expect(done).toMatchObject({ status: "done", completedBy: owner, completionNote: "Changed manually" });
    expect(done.items.every(item => item.completedBy?.id === owner.id && item.completedAt !== null)).toBe(true);
    expect(h.state().drafts[0].status).toBe("SENDING"); expect(done.reply.status).toBe("prepared");
    const same = await h.store.completeTask(id, "new note should not replace audit", owner); expect(same).toEqual(done);
    expect(h.queries.slice(queriesBefore).every(q => q.sql.includes("ops_chat_messages"))).toBe(true);
  });
  it("strict canonical parse rejects unknown versions, mismatched ids, wrong-kind rows and corrupted owner state", async () => {
    const h = port(); await h.prepared(); const id = h.task().id, original = h.state().cards[0].metadata;
    for (const change of [(e: any) => { e.task.version = 2; }, (e: any) => { e.taskId++; }, (e: any) => { e.task.id++; }, (e: any) => { e.task.status = "claimed"; }]) {
      const envelope = JSON.parse(original); change(envelope); h.state().cards[0].metadata = JSON.stringify(envelope);
      await expect(h.store.claimTask(id, owner)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }
    h.state().cards[0].metadata = original; h.state().cards[0].quickAction = "new_lead";
    expect(await h.store.get(id)).toBeNull(); await expect(h.store.claimTask(id, owner)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("full canonical list has no cutoff and includes done tasks", async () => {
    const h = port(); await h.prepared(); const original = h.state().cards[0];
    for (let index = 1; index < 153; index++) {
      const id = original.id + index, envelope = JSON.parse(original.metadata); envelope.taskId = id; envelope.task.id = id;
      h.state().cards.push({ ...original, id, metadata: JSON.stringify(envelope), activeDedupKey: `fixture-${id}` });
    }
    expect(await h.store.list()).toHaveLength(153); expect(h.queries.at(-1)?.sql).not.toContain("LIMIT");
  });
  it("another capability can never be prepared, accepted, suppressed or made uncertain by this store", async () => {
    const h = port(), c = (await h.store.claim(h.binding))!; h.state().drafts[0].capability = "protected_other_capability";
    for (const op of [() => h.store.prepare(c, plan), () => h.store.recordAcceptance(c, "outbound-1"), () => h.store.suppress(c, "CODE"), () => h.store.markUncertain(c)]) {
      await expect(op()).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(h.state().drafts[0].status).toBe("TOOLS_RUNNING"); expect(h.state().cards).toHaveLength(0);
  });
  it("executes the complete actual coordinator/generator/store/router flow offline and independently verifies human completion", async () => {
    const h = port(), trace: string[] = [];
    h.binding.createdAt = Date.parse("2026-11-16T18:00:00Z"); h.binding.receivedAt = h.binding.createdAt + 10;
    const generate = createClaudeCustomerSmsGenerator({ readKnowledge: async () => "Complete synthetic company facts for offline transport only.",
      runner: async options => { expect(options.systemPrompt).toContain("COMPLETE CURRENT CS WRITING PROMPT");
        expect(options.userPrompt).toContain(h.binding.inboundText); trace.push("existing-agent-generation-mocked");
        return { finalSmsText: JSON.stringify(plan) }; } });
    const send = vi.fn(async input => {
      const saved = await h.store.get(h.task().id);
      expect(saved?.status).toBe("unclaimed"); expect(saved?.reply.text).toBe(input.content);
      expect(saved?.items).toHaveLength(2); expect(h.state().drafts[0].status).toBe("SENDING");
      trace.push("durable-task-before-provider"); return { success: true, messageId: "offline-provider-acceptance" };
    });
    const service = createClaudeCustomerSmsService({ config: () => ({ startAt: h.binding.createdAt - 1, allowedPhone: h.binding.fromPhone, testCustomerOverride: false }),
      readSession: async () => ({ contact: { sessionId: "7", rawPhone: h.binding.fromPhone, phone: h.binding.fromPhone, displayName: "Jane", contactGap: null },
        messageHistory: h.state().sessions[0].messageHistory, lastInboundPhoneNumberId: "PN-cs", leadSource: "cs-inbound", smsOptOut: 0, csQueue: "Clients" }),
      readReceivingLine: async () => h.binding.receivingPhoneNumber, generate, store: h.store, send });
    expect(await service({ sessionId: 7, providerMessageId: "inbound-1", fromPhone: h.binding.fromPhone,
      receivingPhoneNumberId: "PN-cs", inboundText: h.binding.inboundText, createdAt: new Date(h.binding.createdAt).toISOString(),
      receivedAt: h.binding.receivedAt, isCleaner: false, direction: "incoming" })).toEqual({ outcome: "accepted" });
    const router = createClaudeCustomerTasksRouter({ getStore: async () => h.store, broadcast: () => { trace.push("existing-sse-task-update"); } });
    const context = (id: string): any => ({ user: { openId: id, name: "Sam" }, req: { headers: {} }, res: {} });
    const staff = router.createCaller(context("17")), someoneElse = router.createCaller(context("18")), id = h.task().id;
    expect((await staff.claim({ id })).owner?.id).toBe("17");
    await expect(someoneElse.complete({ id, note: "Fake confirmation" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await staff.complete({ id, note: "I made both changes in the existing booking interface." });
    const independent = await someoneElse.get({ id });
    expect(independent).toMatchObject({ status: "done", completedBy: { id: "17", name: "Sam" }, reply: { status: "sent", providerMessageId: "offline-provider-acceptance" } });
    expect(independent?.items.every(item => item.completedBy?.id === "17")).toBe(true);
    expect(independent?.completionNote).toContain("existing booking interface");
    expect(send).toHaveBeenCalledTimes(1); expect(h.state().sessions).toHaveLength(1);
    expect(h.state().sessions[0].stage).toBe("CS_INBOUND");
    expect(trace).toEqual(["existing-agent-generation-mocked", "durable-task-before-provider", "existing-sse-task-update", "existing-sse-task-update"]);
  });
});
