import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { conversationSessions, opsChatMessages } from "../drizzle/schema";
import { claimNativeThumbtackLead } from "./thumbtackNativeClaim";

const dialect = new MySqlDialect();
const caller = { id: "7", name: "Synthetic Agent", isOwner: false };
const owner = { id: "owner", name: "Synthetic Owner", isOwner: true };
const negotiation = "offline-negotiation";
const payload = (phone: string | null = "+12025550123") => ({ data: { negotiationID: negotiation,
  customer: { firstName: "Synthetic", lastName: "Lead", ...(phone ? { phone } : {}) },
  request: { category: { name: "House cleaning" }, location: { city: "Washington", state: "DC" } } } });
function harness(options: { missingCapture?: boolean; raw?: string; card?: any; session?: any; failUpdate?: boolean; invalidInsert?: boolean; phone?: string | null } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const inserts: Array<{ table: unknown; value: any }> = [];
  const updates: Array<{ table: unknown; value: any }> = [];
  const capture = { id: 100, raw_payload: options.raw ?? JSON.stringify(payload(options.phone)) };
  let card = options.card, session = options.session, rolledBack = false;
  const execute = vi.fn(async (query: any) => {
    const q = dialect.sqlToQuery(query); calls.push(q);
    if (q.sql.includes("FROM webhook_events")) return [options.missingCapture ? [] : [capture]];
    if (q.sql.includes("FROM ops_chat_messages")) return [card ? [card] : []];
    if (q.sql.includes("FROM conversation_sessions")) return [session ? [session] : []];
    if (q.sql.includes("FROM agents")) return [[{ id: 9 }]];
    throw new Error("Unexpected offline SQL");
  });
  const tx = { execute,
    insert: (table: unknown) => ({ values: async (value: any) => {
      inserts.push({ table, value }); const id = options.invalidInsert ? 0 : table === conversationSessions ? 201 : 301;
      if (table === conversationSessions) session = { id, ...value };
      if (table === opsChatMessages) card = { id, ...value };
      return [{ insertId: id, affectedRows: 1 }];
    } }),
    update: (table: unknown) => ({ set: (value: any) => ({ where: async (_condition: unknown) => {
      if (options.failUpdate) throw new Error("OFFLINE_SAVE_FAILED");
      updates.push({ table, value });
      if (table === opsChatMessages) card = { ...card, ...value };
      if (table === conversationSessions) session = { ...session, ...value };
      return [{ affectedRows: 1 }];
    } }) }),
  };
  let queue = Promise.resolve();
  const transaction = vi.fn((fn: (tx: any) => Promise<any>) => {
    const result = queue.then(async () => { try { return await fn(tx); } catch (e) { rolledBack = true; throw e; } });
    queue = result.catch(() => undefined); return result;
  });
  return { db: { transaction } as never, calls, inserts, updates, transaction, rolledBack: () => rolledBack,
    run: (who = caller) => claimNativeThumbtackLead({ transaction } as never, negotiation, who) };
}
beforeEach(() => vi.clearAllMocks());

describe("human native Thumbtack claiming — offline only", () => {
  it("creates a real card and session for a retained lead with no saved claim card", async () => {
    const h = harness(); const r = await h.run();
    expect(r).toMatchObject({ success: true, messageId: 301, sessionId: 201, claimedBy: caller.name });
    expect(h.inserts).toHaveLength(2);
    expect(h.inserts[0]).toMatchObject({ table: conversationSessions, value: { leadSource: "thumbtack", messageHistory: "[]", leadPhone: "+12025550123" } });
    const m = JSON.parse(h.inserts[1].value.metadata);
    expect(m).toMatchObject({ negotiationId: negotiation, claimedBy: caller.name, sessionId: 201 });
    expect(h.updates).toMatchObject([{ table: conversationSessions, value: { assignedAgentName: caller.name, assignedAgentId: 7 } }]);
    expect(h.calls[0].sql).toContain("LIMIT 1 FOR UPDATE");
    expect(h.calls[0].params).toEqual([negotiation]);
  });
  it("reuses the matching actual phone session instead of creating a duplicate", async () => {
    const h = harness({ session: { id: 41, assignedAgentName: null } });
    expect(await h.run()).toMatchObject({ success: true, messageId: 301, sessionId: 41 });
    expect(h.inserts).toHaveLength(1); expect(h.inserts[0].table).toBe(opsChatMessages);
    expect(h.calls.find(c => c.sql.includes("FROM conversation_sessions"))?.params).toContain("2025550123");
  });
  it("repairs an existing card whose metadata points to an unverified placeholder session", async () => {
    const h = harness({ card: { id: 31, sessionId: 99, metadata: JSON.stringify({ sessionId: 99, retainedField: "unchanged" }) }, session: { id: 41 } });
    expect(await h.run()).toMatchObject({ success: true, messageId: 31, sessionId: 41 });
    expect(h.inserts).toHaveLength(0);
    expect(JSON.parse(h.updates[0].value.metadata)).toMatchObject({ retainedField: "unchanged", sessionId: 41, claimedBy: caller.name });
    expect(h.updates[0].value.sessionId).toBe(41);
  });
  it("preserves an existing real card and session rather than creating a replacement", async () => {
    const h = harness({ card: { id: 31, sessionId: 41, metadata: "{}" }, session: { id: 41 } });
    expect(await h.run()).toMatchObject({ success: true, messageId: 31, sessionId: 41 });
    expect(h.inserts).toHaveLength(0);
  });
  it("does not overwrite a card already claimed by another agent", async () => {
    const h = harness({ card: { id: 31, metadata: JSON.stringify({ claimedBy: "Existing Agent" }) } });
    expect(await h.run()).toEqual({ success: false, alreadyClaimedBy: "Existing Agent" });
    expect(h.inserts).toHaveLength(0); expect(h.updates).toHaveLength(0);
  });
  it("does not steal an existing assigned session when its native card is absent", async () => {
    const h = harness({ session: { id: 41, assignedAgentName: "Existing Agent" } });
    expect(await h.run()).toEqual({ success: false, alreadyClaimedBy: "Existing Agent" });
    expect(h.inserts).toHaveLength(0); expect(h.updates).toHaveLength(0);
  });
  it("serializes competing human claims and creates only one claimable card", async () => {
    const h = harness();
    const [first, second] = await Promise.all([h.run(), h.run({ id: "8", name: "Second Agent", isOwner: false })]);
    expect(first.success).toBe(true); expect(second).toEqual({ success: false, alreadyClaimedBy: caller.name });
    expect(h.inserts.filter(i => i.table === opsChatMessages)).toHaveLength(1);
  });
  it("uses the same owner-to-agent name mapping as ordinary claiming", async () => {
    const h = harness({ session: { id: 41 } }); await h.run(owner);
    expect(h.calls.find(c => c.sql.includes("FROM agents"))?.params).toEqual([owner.name]);
    expect(h.updates.at(-1)?.value).toMatchObject({ assignedAgentName: owner.name, assignedAgentId: 9 });
  });
  it("does not invent an integer agent ID for a nonnumeric caller", async () => {
    const h = harness(); await h.run({ ...caller, id: "office-session" });
    expect(h.updates.at(-1)?.value).not.toHaveProperty("assignedAgentId");
  });
  it("supports manual claiming without a phone and preserves a no-phone session identity", async () => {
    const h = harness({ phone: null }); expect(await h.run()).toMatchObject({ success: true });
    expect(h.inserts[0].value.leadPhone).toBe("no-phone-tt-100");
    expect(h.calls.find(c => c.sql.includes("FROM ops_chat_messages"))?.sql).not.toContain("leadPhone" );
  });
  it("rejects a missing retained negotiation without creating any records", async () => {
    const h = harness({ missingCapture: true }); await expect(h.run()).rejects.toMatchObject({ code: "NOT_FOUND", message: "Thumbtack lead not found" });
    expect(h.inserts).toHaveLength(0); expect(h.updates).toHaveLength(0);
  });
  it.each(["not json", JSON.stringify({ data: { negotiationID: "wrong-negotiation" } })])("rejects malformed or mismatched retained identity %#", async raw => {
    const h = harness({ raw }); await expect(h.run()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(h.inserts).toHaveLength(0);
  });
  it("requires a valid real insert ID instead of passing a fake card ID onward", async () => {
    const h = harness({ invalidInsert: true }); await expect(h.run()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); expect(h.rolledBack()).toBe(true);
  });
  it("rolls back the native transaction if assignment cannot be saved", async () => {
    const h = harness({ failUpdate: true }); await expect(h.run()).rejects.toThrow("OFFLINE_SAVE_FAILED"); expect(h.rolledBack()).toBe(true);
  });
});
