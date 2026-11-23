import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { createClaudeThumbtackFirstResponseStore, guardClaudeThumbtackManualSendInStore, guardClaudeThumbtackLegacyDraftActionInStore } from "./claudeThumbtackFirstResponseStore";
import { capturedThumbtackLead, createClaudeThumbtackFirstResponseService, thumbtackFirstResponseConfig } from "./claudeThumbtackFirstResponse";
const cfg = thumbtackFirstResponseConfig({ THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED: "true", THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT: "2026-11-16T17:00:00Z", OPENPHONE_PHONE_NUMBER_ID: "PN-lead" })!;
function port(createdAt: string | null = "2026-11-16T17:00:01Z", rawOverride?: string) {
  const raw = rawOverride ?? JSON.stringify({ event: { eventType: "NegotiationCreatedV4", triggeredAt: "2026-11-16T17:00:02Z" }, data: { negotiationID: "n1", createdAt,
    customer: { firstName: "Jane", phone: "+17035551234" }, request: { description: "Clean kitchen", details: [{ question: "Extra requests", answer: "oven" }] } } });
  const capture = { id: 7, source: "thumbtack", eventType: "NegotiationCreatedV4", receivedAt: new Date("2026-11-16T17:01:00Z"), rawPayload: raw, earliestId: 7, earliestReceivedAt: new Date("2026-11-16T17:01:00Z") };
  const lead = capturedThumbtackLead(capture, cfg)!;
  let state: any = { sessions: [], drafts: [], cards: [], next: 100 };
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let tail = Promise.resolve();
  const extra: any = { optout: [], sibling: [], activity: [], messages: [], openphone: [] };
  let fail = "";
  const db: any = {
    async transaction(fn: any) {
      let release!: () => void; const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const saved = structuredClone(state);
      try { return await fn(db); } catch (error) { state = saved; throw error; } finally { release(); }
    },
    insert(table: any) { return { async values(values: any) {
      const tableName = getTableName(table), id = ++state.next;
      if (fail === tableName) throw new Error("insert failed");
      if (tableName === "madison_sms_drafts") {
        if (state.drafts.some((row: any) => row.inboundOpenPhoneId === values.inboundOpenPhoneId)) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
        state.drafts.push({ id, ...values });
      } else if (tableName === "conversation_sessions") state.sessions.push({ id, aiMode: 0, smsOptOut: 0, isBooked: 0, messageCount: 0, ...values });
      else state.cards.push({ id, ...values });
      return [{ insertId: id, affectedRows: 1 }];
    } }; },
    async execute(query: any) {
      const q = new MySqlDialect().sqlToQuery(query); queries.push(q); const s = q.sql.replace(/\s+/g, " "), p = q.params;
      if (fail && s.includes(fail)) throw new Error("SQL save failure");
      if (s.startsWith("SELECT")) {
        if (s.includes("FROM madison_sms_drafts WHERE inboundOpenPhoneId")) return [state.drafts.filter((d: any) => d.inboundOpenPhoneId === p[0])];
        if (s.includes("FROM madison_sms_drafts WHERE capability")) return [state.drafts.filter((d: any) => s.includes("sessionId =") ? d.sessionId === p[1] : d.fromPhone === p[1])];
        if (s.includes("FROM madison_sms_drafts WHERE id")) return [state.drafts.filter((d: any) => d.id === p[0])];
        if (s.includes("FROM conversation_sessions WHERE id")) return [state.sessions.filter((d: any) => d.id === p[0])];
        if (s.includes("FROM conversation_sessions")) return [extra.sibling];
        if (s.includes("FROM ops_chat_messages WHERE id")) return [state.cards.filter((d: any) => d.id === p[0])];
        if (s.includes("FROM ops_chat_messages WHERE")) return [extra.activity];
        if (s.includes("FROM sms_opt_outs")) return [extra.optout];
        if (s.includes("source = 'openphone'")) return [extra.openphone];
        if (s.includes("event_type = 'MessageCreatedV4'")) return [extra.messages];
        if (s.includes("ORDER BY id ASC")) return [[{ id: capture.earliestId, created_at: capture.earliestReceivedAt }]];
        if (s.includes("FROM webhook_events WHERE id")) return [[{ id: 7, source: "thumbtack", event_type: "NegotiationCreatedV4", created_at: capture.receivedAt, raw_payload: raw }]];
      }
      if (s.includes("UPDATE conversation_sessions SET messageHistory")) {
        const session = state.sessions.find((r: any) => r.id === p[3]); if (!session || session.leadPhone !== p[4]) return [{ affectedRows: 0 }];
        session.messageHistory = JSON.stringify([...JSON.parse(session.messageHistory), JSON.parse(p[0] as string)]); return [{ affectedRows: 1 }];
      }
      if (s.includes("SET status = 'SENDING'")) {
        const d = state.drafts.find((r: any) => r.id === p[3] && r.status === "TOOLS_RUNNING" && !r.dismissedAt && !r.dismissedBy);
        if (!d) return [{ affectedRows: 0 }]; Object.assign(d, { status: "SENDING", generatedDraft: p[0], approvedText: p[1], capabilityResult: JSON.parse(p[2] as string) }); return [{ affectedRows: 1 }];
      }
      if (s.includes("SET status = 'DISMISSED'")) {
        const d = state.drafts.find((r: any) => r.id === p[0] && r.status === "TOOLS_RUNNING"); if (!d) return [{ affectedRows: 0 }];
        Object.assign(d, { status: "DISMISSED", errorCode: "MANUAL_FIRST_RESPONSE" }); return [{ affectedRows: 1 }];
      }
      if (s.includes("SET status = CASE WHEN status = 'DISMISSED'")) {
        const d = state.drafts.find((r: any) => r.id === p[2]); Object.assign(d, { status: d.status === "DISMISSED" ? "DISMISSED" : "SENT", outboundOpenPhoneId: p[0], capabilityResult: JSON.parse(p[1] as string) }); return [{ affectedRows: 1 }];
      }
      if (s.includes("SET status = CASE WHEN status = 'TOOLS_RUNNING'")) {
        const d = state.drafts.find((r: any) => r.id === p[2]); if (d.status === "TOOLS_RUNNING") d.status = "DISMISSED"; d.errorCode = p[1]; return [{ affectedRows: 1 }];
      }
      throw new Error(`Unmocked SQL: ${s}`);
    },
  };
  const store = createClaudeThumbtackFirstResponseStore(db, () => null);
  const result: any = { replyText: "EXACT generated text", agentId: "same-agent" };
  return { db, lead, store, result, extra, queries, state: () => state, fail: (value: string) => { fail = value; } };
}
describe("native first response real store offline transactions", () => {
  it("reloads durable original and earliest negotiation; atomically creates exact session/card/claim only once", async () => {
    const h = port(); expect(await h.store.loadCapture(7)).toEqual(h.lead.capture);
    const [a, b] = await Promise.all([h.store.claim(h.lead, cfg), h.store.claim(h.lead, cfg)]);
    expect([a, b].filter(Boolean)).toHaveLength(1); expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1);
    expect(h.state().sessions[0].messageHistory).toBe("[]"); expect(h.state().sessions[0].bedrooms).toBeNull();
    expect(h.state().cards[0].quickAction).toBe("new_lead"); expect(JSON.parse(h.state().cards[0].metadata).sessionId).toBe(a!.sessionId);
    expect(JSON.parse(h.state().cards[0].metadata)).not.toHaveProperty("draftId");
    for (const status of ["DISMISSED", "SENT", "SENDING", "FAILED"]) { h.state().drafts[0].status = status; expect(await h.store.claim(h.lead, cfg)).toBeNull(); }
  });
  it.each(["madison_sms_drafts", "ops_chat_messages"])("rolls back new conversation on %s insert failure", async table => {
    const h = port(); h.fail(table); await expect(h.store.claim(h.lead, cfg)).rejects.toThrow();
    expect(h.state().sessions).toHaveLength(0); expect(h.state().drafts).toHaveLength(0); expect(h.state().cards).toHaveLength(0);
  });
  it("preserves real opt-outs and immutable binding but ignores engagement markers", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!; expect(await h.store.fresh(c)).toBe(true);
    h.extra.optout = [{ id: 1 }]; expect(await h.store.fresh(c)).toBe(false); h.extra.optout = [];
    for (const change of [{ leadPhone: "+12025559876" }, { leadSource: "email" }, { smsOptOut: 1 }]) {
      const before = { ...h.state().sessions[0] }; Object.assign(h.state().sessions[0], change); expect(await h.store.fresh(c)).toBe(false); Object.assign(h.state().sessions[0], before);
    }
    Object.assign(h.state().sessions[0], { assignedAgentId: 2, assignedAgentName: "Staff", aiMode: 1,
      stage: "RESOLVED", isBooked: 1, lastCalledAt: new Date(), respondedAt: Date.now(), csResolvedAt: Date.now(),
      madisonDeferredUntil: Date.now(), lastProcessedMessageId: "reply", lastCustomerReplyAt: Date.now(),
      lastCustomerMessageTs: Date.now(), lastAiMessageAt: Date.now(), internalNotes: "Staff notes", messageCount: 2,
      messageHistory: '[{"role":"user","content":"Reply"},{"role":"assistant","content":"Staff text"}]' });
    const metadata = JSON.parse(h.state().cards[0].metadata);
    h.state().cards[0].metadata = JSON.stringify({ ...metadata, claimedBy: "Staff" }); h.state().cards[0].cardStatus = "dismissed";
    h.extra.sibling = [{ leadPhone: c.lead.phone, messageHistory: JSON.stringify([{ role: "assistant", content: "staff text", ts: c.lead.createdAt + 1 }]) }];
    h.extra.messages = [{ raw_payload: "{}", created_at: new Date(c.lead.createdAt + 1) }]; h.extra.activity = [{ id: 9 }];
    expect(await h.store.fresh(c)).toBe(true); expect(await h.store.beginSend(c, h.result)).toBe(true);
    const b = port(), d = (await b.store.claim(b.lead, cfg))!;
    b.state().drafts[0].dismissedBy = "Staff"; expect(await b.store.fresh(d)).toBe(false);
    h.state().drafts[0].resolvedContext.negotiationId = "different"; expect(await h.store.fresh(c)).toBe(false);
  });
  it.each(["stop", "unsubscribe", "cancel", "quit", "end", "remove me", "opt-out"])("request description/answer '%s' is not a real SMS opt-out", async word => {
    const raw = JSON.stringify({ event: { eventType: "NegotiationCreatedV4" }, data: { negotiationID: "n1",
      customer: { firstName: "Jane", phone: "+17035551234" }, request: { description: word, details: [{ question: "Anything else", answer: word }] } } });
    const h = port(null, raw), c = (await h.store.claim(h.lead, cfg))!;
    expect(await h.store.fresh(c)).toBe(true); expect(await h.store.beginSend(c, h.result)).toBe(true);
  });
  it("old same-phone history/bookings/notes/assignment never exclude a NEW negotiation; sibling optout remains global", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!, old = c.lead.createdAt - 1;
    h.extra.sibling = [{ id: 1, leadPhone: c.lead.phone, messageHistory: JSON.stringify([
      { role: "user", content: "previous customer", ts: old }, { role: "assistant", content: "previous response", ts: old },
      { role: "note", content: "old note", ts: old }]), isBooked: 1, bookedAt: new Date(old), assignedAgentId: 2, assignedAgentName: "Staff",
      lastCalledAt: new Date(old), respondedAt: String(old), lastCustomerReplyAt: old, lastCustomerMessageTs: old, internalNotes: "existing note" }];
    expect(await h.store.fresh(c)).toBe(true);
    for (const history of ["invalid old history", null, '[{"role":"assistant","content":"untimed old text"}]']) {
      h.extra.sibling[0].messageHistory = history; expect(await h.store.fresh(c)).toBe(true);
    }
    h.extra.sibling[0].smsOptOut = 1; expect(await h.store.fresh(c)).toBe(false);
    expect(h.state().sessions).toHaveLength(1); expect(c.sessionId).not.toBe(h.extra.sibling[0].id);
  });
  it.each(["user", "assistant", "note"])("post-lead %s history does not suppress the introduction", async role => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    h.extra.sibling = [{ leadPhone: c.lead.phone, messageHistory: JSON.stringify([{ role, ts: c.lead.createdAt }]) }];
    expect(await h.store.fresh(c)).toBe(true);
    h.extra.sibling[0].messageHistory = JSON.stringify([{ role, ts: c.lead.createdAt + 1 }]); expect(await h.store.fresh(c)).toBe(true);
    h.extra.sibling[0].messageHistory = JSON.stringify([{ role: "system", ts: c.lead.createdAt + 1 }]); expect(await h.store.fresh(c)).toBe(true);
  });
  it.each(["lastCalledAt", "respondedAt", "bookedAt", "lastCustomerReplyAt", "lastCustomerMessageTs"])("sibling %s never suppresses the introduction", async field => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    const dateField = field === "lastCalledAt" || field === "bookedAt";
    h.extra.sibling = [{ leadPhone: c.lead.phone, messageHistory: "[]", [field]: dateField ? new Date(c.lead.createdAt - 1) : String(c.lead.createdAt - 1) }];
    expect(await h.store.fresh(c)).toBe(true);
    h.extra.sibling[0][field] = dateField ? new Date(c.lead.createdAt + 1) : String(c.lead.createdAt + 1); expect(await h.store.fresh(c)).toBe(true);
  });
  it("OpenPhone inbound/outbound activity never suppresses the introduction", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    const event = (createdAt: number | undefined, incoming: boolean, receivedAt: number) => ({ created_at: new Date(receivedAt),
      raw_payload: JSON.stringify({ data: { object: { createdAt: createdAt === undefined ? undefined : new Date(createdAt).toISOString(),
        from: incoming ? c.lead.phone : "+12025550000", to: incoming ? ["+12025550000"] : [c.lead.phone] } } }) });
    for (const incoming of [true, false]) {
      h.extra.openphone = [event(c.lead.createdAt - 1, incoming, c.lead.createdAt + 10)]; expect(await h.store.fresh(c)).toBe(true);
      h.extra.openphone = [event(c.lead.createdAt + 1, incoming, c.lead.createdAt + 10)]; expect(await h.store.fresh(c)).toBe(true);
      h.extra.openphone = [event(undefined, incoming, c.lead.createdAt - 1)]; expect(await h.store.fresh(c)).toBe(true);
      h.extra.openphone = [event(undefined, incoming, c.lead.createdAt + 1)]; expect(await h.store.fresh(c)).toBe(true);
    }
    expect(h.queries.some(q => q.sql.includes("source = 'openphone'"))).toBe(false);
  });
  it("native Thumbtack messages never suppress the introduction", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    h.extra.messages = [{ raw_payload: JSON.stringify({ data: { createdAt: new Date(c.lead.createdAt - 1).toISOString() } }), created_at: new Date(c.lead.createdAt + 1) }];
    expect(await h.store.fresh(c)).toBe(true);
    h.extra.messages[0].raw_payload = JSON.stringify({ data: { createdAt: new Date(c.lead.createdAt + 1).toISOString() } }); expect(await h.store.fresh(c)).toBe(true);
    expect(h.queries.some(q => q.sql.includes("event_type = 'MessageCreatedV4'"))).toBe(false);
  });
  it.each(["{", '{"data":{}}', '{"data":{"negotiationID":12}}', '{"data":{"negotiationID":"  "}}'])("retained malformed identity %s cannot invent a claim or mutate its capture", async raw => {
    const h = port(null, raw); expect(await h.store.loadCapture(7)).toBeNull();
    expect(h.state().sessions).toHaveLength(0); expect(h.state().cards).toHaveLength(0); expect(h.state().drafts).toHaveLength(0);
    expect(h.queries).toHaveLength(1); expect(h.queries[0].sql).toMatch(/^SELECT/);
  });
  it.each([null, "invalid", "2026-11-15T17:00:01Z", "2026-11-17T17:00:01Z"])("native date %s permits one generated and submitted introduction through the real store", async createdAt => {
    const h = port(createdAt); let generated = 0, sent = 0;
    const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: h.store,
      generate: async input => { generated++; return { kind: "initial_lead", requestId: input.requestId, sessionId: input.sessionId,
        customerPhone: input.customerPhone, contextHash: "a".repeat(64), replyText: h.result.replyText,
        mode: "review_only", smsSent: false, actionsExecuted: false, agentId: "same-agent", agentSessionId: "offline-session" }; },
      send: async () => { sent++; return { success: true, messageId: "offline-provider-id" }; } });
    await run(7); await run(7);
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1); expect(h.state().drafts).toHaveLength(1);
    expect(h.state().cards[0].quickAction).toBe("new_lead"); expect(h.state().sessions[0].leadSource).toBe("thumbtack");
    expect(h.state().drafts[0]).toMatchObject({ status: "SENT", outboundOpenPhoneId: "offline-provider-id", errorCode: null });
    expect(generated).toBe(1); expect(sent).toBe(1);
    const c = { draftId: h.state().drafts[0].id, sessionId: h.state().sessions[0].id, cardId: h.state().cards[0].id, lead: h.lead, fromNumberId: cfg.fromNumberId };
    expect(await h.store.beginSend(c, h.result)).toBe(false); expect(await h.store.claim({ ...h.lead, sendEligible: true }, cfg)).toBeNull();
  });
  it("a manual reply does not cancel the introduction; explicit dismissal and SENDING remain protected", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    await guardClaudeThumbtackManualSendInStore(h.db, { sessionId: c.sessionId });
    expect(h.state().drafts[0].status).toBe("TOOLS_RUNNING"); expect(await h.store.beginSend(c, h.result)).toBe(true);
    const dismissed = port(), dismissedClaim = (await dismissed.store.claim(dismissed.lead, cfg))!;
    dismissed.state().drafts[0].status = "DISMISSED"; expect(await dismissed.store.beginSend(dismissedClaim, dismissed.result)).toBe(false);
    const b = port(), d = (await b.store.claim(b.lead, cfg))!; expect(await b.store.beginSend(d, b.result)).toBe(true);
    await expect(guardClaudeThumbtackManualSendInStore(b.db, { phone: d.lead.phone! })).rejects.toThrow("AUTO_FIRST_RESPONSE_IN_FLIGHT");
    await b.store.blocked(d, "SUBMISSION_UNCERTAIN", true); expect(b.state().drafts[0].status).toBe("SENDING");
    await expect(guardClaudeThumbtackManualSendInStore(b.db, { phone: d.lead.phone! })).rejects.toThrow("AUTO_FIRST_RESPONSE_REVIEW_REQUIRED");
    expect(await b.store.beginSend(d, b.result)).toBe(false);
  });
  it("concurrent automatic submissions have one winner; manual activity never cancels a pending introduction", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    const outcomes = await Promise.all([h.store.beginSend(c, h.result), h.store.beginSend(c, h.result)]);
    expect(outcomes).toEqual([true, false]);
    const b = port(), d = (await b.store.claim(b.lead, cfg))!;
    await guardClaudeThumbtackManualSendInStore(b.db, { sessionId: d.sessionId });
    expect(await b.store.beginSend(d, b.result)).toBe(true);
    await expect(guardClaudeThumbtackLegacyDraftActionInStore(h.db, c.draftId)).rejects.toThrow("AUTO_FIRST_RESPONSE_PROTECTED");
    await expect(guardClaudeThumbtackLegacyDraftActionInStore(h.db, 999)).resolves.toBeUndefined();
  });
  it("acceptance append is atomic current history and includes provider ID/explicit line; save failure stays SENDING", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!; await h.store.beginSend(c, h.result);
    h.state().sessions[0].messageHistory = '[{"role":"user","content":"current activity"}]';
    await h.store.accepted(c, h.result, "provider-1"); const history = JSON.parse(h.state().sessions[0].messageHistory);
    expect(history).toHaveLength(2); expect(history[1]).toMatchObject({ content: h.result.replyText, opMsgId: "provider-1", fromNumberId: "PN-lead" });
    expect(h.state().drafts[0].status).toBe("SENT"); expect(h.state().drafts[0]).not.toHaveProperty("deliveredAt");
    const b = port(), d = (await b.store.claim(b.lead, cfg))!; await b.store.beginSend(d, b.result); b.fail("outboundOpenPhoneId =");
    await expect(b.store.accepted(d, b.result, "provider-2")).rejects.toThrow(); expect(b.state().drafts[0].status).toBe("SENDING"); expect(b.state().sessions[0].messageHistory).toBe("[]");
  });
});
