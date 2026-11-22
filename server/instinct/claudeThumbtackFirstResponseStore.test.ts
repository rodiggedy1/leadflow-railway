import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { createClaudeThumbtackFirstResponseStore, guardClaudeThumbtackManualSendInStore, guardClaudeThumbtackLegacyDraftActionInStore } from "./claudeThumbtackFirstResponseStore";
import { capturedThumbtackLead, createClaudeThumbtackFirstResponseService, thumbtackFirstResponseConfig } from "./claudeThumbtackFirstResponse";
import { smsSenderLabel } from "../../shared/smsSenderProvenance";
import { NON_LEAD_SOURCES } from "../../shared/leadSources";
const cfg = thumbtackFirstResponseConfig({ THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED: "true", THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT: "2026-11-16T17:00:00Z", OPENPHONE_PHONE_NUMBER_ID: "PN-lead" })!;
function port(createdAt: string | null = "2026-11-16T17:00:01Z", rawOverride?: string) {
  const raw = rawOverride ?? JSON.stringify({ event: { eventType: "NegotiationCreatedV4", triggeredAt: "2026-11-16T17:00:02Z" }, data: { negotiationID: "n1", createdAt,
    customer: { firstName: "Jane", phone: "+17035551234" }, request: { description: "Clean kitchen", details: [{ question: "Extra requests", answer: "oven" }] } } });
  const capture = { id: 7, source: "thumbtack", eventType: "NegotiationCreatedV4", receivedAt: new Date("2026-11-16T17:01:00Z"), rawPayload: raw };
  const lead = capturedThumbtackLead(capture, cfg)!;
  // Both receipt kinds share the same mocked SQL table/unique constraint; expose them separately for send assertions.
  let state: any = { sessions: [], drafts: [], intakes: [], cards: [], next: 100 };
  const receipts = () => [...state.drafts, ...state.intakes];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let tail = Promise.resolve();
  const extra: any = { optout: [], sibling: [], activity: [], messages: [], openphone: [], captures: { 7: capture } };
  let fail = "";
  const db: any = {
    async transaction(fn: any) {
      let release!: () => void; const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const saved = structuredClone(state);
      let concurrentWinner: any;
      let concurrentIntake: any;
      try {
        const result = await fn(db);
        if (extra.commitPhoneWinner) {
          concurrentWinner = extra.commitPhoneWinner; extra.commitPhoneWinner = null;
          if (extra.commitCompleteWinner) {
            concurrentIntake = structuredClone(state); concurrentIntake.drafts = [...saved.drafts, concurrentWinner];
            extra.commitCompleteWinner = false;
          }
          throw Object.assign(new Error("Duplicate entry for key 'madison_sms_drafts.uq_sms_draft_inbound' at COMMIT"), { code: "ER_DUP_ENTRY" });
        }
        if (extra.commitIntakeWinner) {
          extra.commitIntakeWinner = false; concurrentIntake = structuredClone(state);
          throw Object.assign(new Error("Duplicate entry for key 'madison_sms_drafts.uq_sms_draft_inbound' at recovery COMMIT"), { code: "ER_DUP_ENTRY" });
        }
        return result;
      } catch (error) {
        state = saved; if (concurrentWinner) state.drafts.push(concurrentWinner); throw error;
      } finally {
        if (concurrentIntake) state = concurrentIntake; // Concurrent winner committed the same complete session/card/intake atomically.
        release();
      }
    },
    insert(table: any) { return { async values(values: any) {
      const tableName = getTableName(table), id = ++state.next;
      if (fail === tableName) throw new Error("insert failed");
      if (tableName === "madison_sms_drafts") {
        const intake = values.capability === "thumbtack_lead_intake_v1";
        if (!intake && fail === "duplicate") throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
        if (!intake && fail === "unrelated-duplicate") throw Object.assign(new Error("duplicate for key 'other_unique_index'"), { code: "ER_DUP_ENTRY" });
        if (receipts().some((row: any) => row.inboundOpenPhoneId === values.inboundOpenPhoneId)) {
          const error = Object.assign(new Error("Duplicate entry for key 'madison_sms_drafts.uq_sms_draft_inbound'"), { code: "ER_DUP_ENTRY" });
          throw extra.wrappedDuplicate ? Object.assign(new Error("Failed query"), { cause: error }) : error;
        }
        (intake ? state.intakes : state.drafts).push({ id, ...values });
      } else if (tableName === "conversation_sessions") state.sessions.push({ id, aiMode: 0, smsOptOut: 0, isBooked: 0, messageCount: 0, ...values });
      else state.cards.push({ id, ...values });
      return [{ insertId: id, affectedRows: 1 }];
    } }; },
    async execute(query: any) {
      const q = new MySqlDialect().sqlToQuery(query); queries.push(q); const s = q.sql.replace(/\s+/g, " "), p = q.params;
      if (fail && s.includes(fail)) throw new Error("SQL save failure");
      if (s.startsWith("SELECT")) {
        if (s.includes("FROM madison_sms_drafts WHERE inboundOpenPhoneId") || (s.includes("FROM madison_sms_drafts") && s.includes("WHERE inboundOpenPhoneId"))) {
          const intake = String(p[0]).startsWith("tt-intake:");
          if (intake && extra.hideIntakes > 0) { extra.hideIntakes--; return [[]]; }
          if (!intake && extra.hideClaims > 0 && !s.includes("FOR UPDATE")) { extra.hideClaims--; return [[]]; }
          return [receipts().filter((d: any) => d.inboundOpenPhoneId === p[0] && (p[1] === undefined || d.capability === p[1]))];
        }
        if (s.includes("FROM madison_sms_drafts WHERE fromPhone")) {
          if (extra.hideClaims > 0) { extra.hideClaims--; return [[]]; }
          return [state.drafts.filter((d: any) => d.fromPhone === p[0] && d.capability === p[1] && d.inboundOpenPhoneId.startsWith("tt-first:v1:"))];
        }
        if (s.includes("FROM madison_sms_drafts WHERE capability")) return [state.drafts.filter((d: any) => s.includes("sessionId =") ? d.sessionId === p[1] : d.fromPhone === p[1])];
        if (s.includes("FROM madison_sms_drafts WHERE id")) return [receipts().filter((d: any) => d.id === p[0])];
        if (s.includes("FROM conversation_sessions WHERE id")) return [state.sessions.filter((d: any) => d.id === p[0])];
        if (s.includes("FROM conversation_sessions")) return [extra.sibling];
        if (s.includes("FROM ops_chat_messages WHERE id")) return [state.cards.filter((d: any) => d.id === p[0])];
        if (s.includes("FROM ops_chat_messages WHERE")) return [extra.activity];
        if (s.includes("FROM sms_opt_outs")) return [extra.optout];
        if (s.includes("source = 'openphone'")) return [extra.openphone];
        if (s.includes("event_type = 'MessageCreatedV4'")) return [extra.messages];
        if (s.includes("FROM webhook_events WHERE id")) {
          const c = extra.captures[String(p[0])];
          return [c ? [{ id: c.id, source: c.source, event_type: c.eventType, created_at: c.receivedAt, raw_payload: c.rawPayload }] : []];
        }
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
function nextLead(h: ReturnType<typeof port>, negotiationId = "n2", phone = "(703) 555-1234", id = 8) {
  const payload = JSON.parse(h.lead.capture.rawPayload);
  payload.data.negotiationID = negotiationId; payload.data.customer.phone = phone;
  payload.data.customer.firstName = "New customer"; payload.data.request.description = "New negotiation details";
  const capture = { ...h.lead.capture, id, rawPayload: JSON.stringify(payload) };
  h.extra.captures[id] = capture;
  return capturedThumbtackLead(capture, cfg)!;
}
describe("native first response real store offline transactions", () => {
  it("reloads the exact capture and atomically creates only one introduction receipt for the same intake/card", async () => {
    const h = port(); expect(await h.store.loadCapture(7)).toEqual(h.lead.capture);
    const [a, b] = await Promise.all([h.store.claim(h.lead, cfg), h.store.claim(h.lead, cfg)]);
    expect([a, b].filter(Boolean)).toHaveLength(1); expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1);
    expect(h.state().drafts).toHaveLength(1);
    expect(h.state().sessions[0].messageHistory).toBe("[]"); expect(h.state().sessions[0].bedrooms).toBeNull();
    expect(h.state().cards[0].quickAction).toBe("new_lead"); expect(JSON.parse(h.state().cards[0].metadata).sessionId).toBe(a!.sessionId);
    expect(JSON.parse(h.state().cards[0].metadata)).not.toHaveProperty("draftId");
    for (const status of ["DISMISSED", "SENT", "SENDING", "FAILED"]) { h.state().drafts[0].status = status; expect(await h.store.claim(h.lead, cfg)).toBeNull(); }
    expect(h.queries.some(q => q.sql.includes("ORDER BY id ASC LIMIT 1"))).toBe(false);
  });
  it("same phone under a different negotiation creates its own visible card and introduction", async () => {
    const h = port(); await h.store.claim(h.lead, cfg); const lead = nextLead(h);
    expect(lead.key).not.toBe(h.lead.key); expect(await h.store.claim(lead, cfg)).not.toBeNull();
    expect(h.state().drafts).toHaveLength(2); expect(h.state().sessions).toHaveLength(2);
    expect(h.state().intakes).toHaveLength(2); expect(h.state().cards).toHaveLength(2);
    expect(h.state().sessions[1]).toMatchObject({ leadPhone: "+17035551234", leadName: "New customer", leadSource: "thumbtack",
      stage: "AVAILABILITY", aiMode: 0, isBooked: 0, messageHistory: "[]", barkQA: "New negotiation details | Thumbtack ID: n2" });
    expect(NON_LEAD_SOURCES as readonly string[]).not.toContain(h.state().sessions[1].leadSource);
    expect(JSON.parse(h.state().cards[1].metadata)).toMatchObject({ sessionId: h.state().sessions[1].id, negotiationId: "n2", summary: "New negotiation details" });
    expect(JSON.parse(h.state().cards[1].metadata)).not.toHaveProperty("draftId");
    await h.store.claim(lead, cfg); await h.store.claim(nextLead(h, "n2", "+17035551234", 9), cfg);
    expect(h.state().sessions).toHaveLength(2); expect(h.state().cards).toHaveLength(2);
    for (const marker of h.state().intakes) {
      expect(marker).toMatchObject({ status: "DISMISSED", sendPolicyEnabled: 0, sendPolicyMode: "disabled", suggestedActions: [], originalMessage: "" });
      expect(marker).not.toHaveProperty("generatedDraft"); expect(marker).not.toHaveProperty("approvedText");
    }
  });
  it("different phones sharing negotiation/webhook identity each receive an introduction claim", async () => {
    const h = port(); const payload = JSON.parse(h.lead.capture.rawPayload); payload.data.customer.phone = "+12025559876";
    const other = capturedThumbtackLead({ ...h.lead.capture, id: 8, rawPayload: JSON.stringify(payload) }, cfg)!;
    const [a, b] = await Promise.all([h.store.claim(h.lead, cfg), h.store.claim(other, cfg)]);
    expect(a).not.toBeNull(); expect(b).not.toBeNull(); expect(a!.lead.key).not.toBe(b!.lead.key);
    expect(h.state().drafts).toHaveLength(2);
  });
  it.each([false, true])("the existing unique index resolves competing intake claims after missed reads (wrapped error: %s)", async wrapped => {
    const h = port(); h.extra.hideIntakes = 2; h.extra.hideClaims = 4; h.extra.wrappedDuplicate = wrapped;
    const results = await Promise.all([h.store.claim(h.lead, cfg), h.store.claim(h.lead, cfg)]);
    expect(results.filter(Boolean)).toHaveLength(1); expect(h.state().drafts).toHaveLength(1);
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1); expect(h.state().intakes).toHaveLength(1);
  });
  it.each([false, true])("competing distinct negotiations each introduce while retries preserve two intakes (wrapped: %s)", async wrapped => {
    const h = port(); h.extra.hideClaims = 4; h.extra.wrappedDuplicate = wrapped;
    const other = nextLead(h);
    const results = await Promise.all([h.store.claim(h.lead, cfg), h.store.claim(other, cfg), h.store.claim(other, cfg)]);
    expect(results.filter(Boolean)).toHaveLength(2); expect(h.state().drafts).toHaveLength(2);
    expect(h.state().sessions).toHaveLength(2); expect(h.state().cards).toHaveLength(2); expect(h.state().intakes).toHaveLength(2);
    for (const claim of results.filter(Boolean)) expect(await h.store.fresh(claim!)).toBe(true);
  });
  it.each(["SENT", "SENDING", "DISMISSED", "FAILED", "TOOLS_RUNNING"])("older different-negotiation receipts never suppress a new card/introduction across %s status", async status => {
    for (const key of ["tt-first:v1:" + "a".repeat(64), "tt-first:v1:" + "b".repeat(64)]) {
      const h = port(); const prior = { id: 1, inboundOpenPhoneId: key, fromPhone: h.lead.phone,
        capability: "claude_thumbtack_first_response_v1", status, resolvedContext: { negotiationId: "previous-negotiation" } };
      h.state().drafts.push(prior); expect(await h.store.claim(h.lead, cfg)).not.toBeNull();
      expect(h.state().drafts).toHaveLength(2); expect(h.state().drafts[0]).toEqual(prior);
      expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1);
      expect(h.state().intakes).toHaveLength(1); expect(h.state().sessions[0].leadSource).toBe("thumbtack");
      await h.store.claim(h.lead, cfg); expect(h.state().sessions).toHaveLength(1);
    }
  });
  it.each(["SENT", "SENDING", "DISMISSED", "FAILED", "TOOLS_RUNNING"])("previous same-phone receipt in %s never blocks another new card's model/send", async status => {
    const h = port(); await h.store.claim(h.lead, cfg); h.state().drafts[0].status = status;
    nextLead(h); let generated = 0, sent = 0;
    const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: h.store,
      generate: async input => { generated++; return { ...h.result, kind: "initial_lead", requestId: input.requestId, sessionId: input.sessionId,
        customerPhone: input.customerPhone, contextHash: "a".repeat(64), mode: "review_only", smsSent: false, actionsExecuted: false,
        agentSessionId: "offline-agent-session" }; },
      send: async input => { sent++; expect(input.to).toBe(h.lead.phone); return { success: true, messageId: "offline-new-card" }; } });
    await run(8); await run(8);
    expect(generated).toBe(1); expect(sent).toBe(1); expect(h.state().drafts).toHaveLength(2);
    expect(h.state().sessions).toHaveLength(2); expect(h.state().cards).toHaveLength(2); expect(h.state().intakes).toHaveLength(2);
    expect(h.state().drafts[0].status).toBe(status); expect(h.state().drafts[1].status).toBe("SENT");
  });
  it.each([false, true])("pre-fix receipt bindings recognize existing intake without creating a marker (older key: %s)", async older => {
    const h = port(); await h.store.claim(h.lead, cfg); h.state().intakes.length = 0;
    if (older) h.state().drafts[0].inboundOpenPhoneId = "tt-first:v1:old-native-attempt";
    expect(await h.store.claim(h.lead, cfg)).toBeNull();
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1); expect(h.state().intakes).toHaveLength(0);
  });
  it("any historical matching binding prevents duplicate legacy intake, not an arbitrary first phone receipt", async () => {
    const h = port(); h.state().drafts.push(
      { id: 1, inboundOpenPhoneId: h.lead.key, fromPhone: h.lead.phone, capability: "claude_thumbtack_first_response_v1", status: "SENT", resolvedContext: { negotiationId: "other" } },
      { id: 2, inboundOpenPhoneId: "tt-first:v1:older-bad", fromPhone: h.lead.phone, capability: "claude_thumbtack_first_response_v1", status: "SENT", resolvedContext: "{" },
      { id: 3, inboundOpenPhoneId: "tt-first:v1:older-match", fromPhone: h.lead.phone, capability: "claude_thumbtack_first_response_v1", status: "SENT", resolvedContext: JSON.stringify({ negotiationId: "n1" }) });
    expect(await h.store.claim(h.lead, cfg)).toBeNull();
    expect(h.state().sessions).toHaveLength(0); expect(h.state().cards).toHaveLength(0); expect(h.state().intakes).toHaveLength(0);
  });
  it("malformed exact-card receipt binding still prevents duplicate intake and introduction", async () => {
    const h = port(); h.state().drafts.push({ id: 1, inboundOpenPhoneId: h.lead.key, fromPhone: h.lead.phone,
      capability: "claude_thumbtack_first_response_v1", status: "SENT", resolvedContext: "{" });
    expect(await h.store.claim(h.lead, cfg)).toBeNull();
    expect(h.state().sessions).toHaveLength(0); expect(h.state().cards).toHaveLength(0); expect(h.state().drafts).toHaveLength(1);
  });
  it.each(["another-negotiation", "n1"])("verified commit-time exact-card key winner (%s binding) never creates duplicate intake/introduction", async negotiationId => {
    const h = port(); const winner = { id: 1, inboundOpenPhoneId: h.lead.key, fromPhone: h.lead.phone,
      capability: "claude_thumbtack_first_response_v1", status: "SENT", resolvedContext: { negotiationId } };
    h.extra.commitPhoneWinner = winner;
    expect(await h.store.claim(h.lead, cfg)).toBeNull();
    expect(h.state().drafts).toEqual([winner]);
    expect(h.state().sessions).toHaveLength(0); expect(h.state().cards).toHaveLength(0); expect(h.state().intakes).toHaveLength(0);
    await h.store.claim(h.lead, cfg); expect(h.state().sessions).toHaveLength(0);
  });
  it("another delivery committing the complete same-card intake wins atomically without any recovery intake", async () => {
    const h = port(); h.extra.commitPhoneWinner = { id: 1, inboundOpenPhoneId: h.lead.key, fromPhone: h.lead.phone,
      capability: "claude_thumbtack_first_response_v1", status: "SENT", resolvedContext: { negotiationId: "n1" } };
    h.extra.commitCompleteWinner = true;
    expect(await h.store.claim(h.lead, cfg)).toBeNull();
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1); expect(h.state().intakes).toHaveLength(1);
    expect(h.state().drafts).toHaveLength(1); expect(h.state().drafts[0].status).toBe("SENT");
    expect(h.queries.filter(q => q.sql.startsWith("SELECT id, resolvedContext FROM madison_sms_drafts WHERE fromPhone"))).toHaveLength(1);
    await h.store.claim(h.lead, cfg); expect(h.state().cards).toHaveLength(1);
  });
  it("mixed pre-fix writer's same-negotiation immediate phone conflict rolls back provisional intake", async () => {
    const h = port(); await h.store.claim(h.lead, cfg); h.state().intakes.length = 0; h.extra.hideClaims = 2;
    expect(await h.store.claim(h.lead, cfg)).toBeNull();
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1);
    expect(h.state().intakes).toHaveLength(0); expect(h.state().drafts).toHaveLength(1);
  });
  it("concurrent distinct negotiations call the mocked model/provider once per new card, with no repeat on redelivery", async () => {
    const h = port(); nextLead(h); let generated = 0, sent = 0;
    const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: h.store,
      generate: async input => { generated++; return { ...h.result, kind: "initial_lead", requestId: input.requestId, sessionId: input.sessionId,
        customerPhone: input.customerPhone, contextHash: "a".repeat(64), mode: "review_only", smsSent: false, actionsExecuted: false,
        agentSessionId: "offline-agent-session" }; },
      send: async input => { sent++; expect(input.to).toBe(h.lead.phone); return { success: true, messageId: "offline-only-provider-id" }; } });
    await Promise.all([run(7), run(8), run(7), run(8)]);
    expect(generated).toBe(2); expect(sent).toBe(2); expect(h.state().drafts).toHaveLength(2);
    expect(h.state().drafts.every((draft: any) => draft.status === "SENT")).toBe(true); expect(h.state().sessions).toHaveLength(2);
    expect(h.state().intakes).toHaveLength(2); expect(h.state().cards).toHaveLength(2);
    for (const session of h.state().sessions) expect(JSON.parse(session.messageHistory)).toHaveLength(1);
  });
  it("missing-phone redelivery under a new capture has one intake and no model/provider call", async () => {
    const payload = JSON.parse(port().lead.capture.rawPayload); delete payload.data.customer.phone;
    const h = port(null, JSON.stringify(payload)); nextLead(h, "n1", "", 8); let calls = 0;
    const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: h.store,
      generate: async () => { calls++; throw new Error("must not generate"); },
      send: async () => { calls++; throw new Error("must not send"); } });
    await Promise.all([run(7), run(8)]);
    expect(calls).toBe(0); expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1);
    expect(h.state().intakes).toHaveLength(1); expect(h.state().drafts).toHaveLength(1);
  });
  it.each(["madison_sms_drafts", "ops_chat_messages"])("repeat-phone %s insertion failure rolls back only the arriving lead and never mutates prior receipt", async table => {
    const h = port(); await h.store.claim(h.lead, cfg); const prior = structuredClone(h.state()); h.fail(table);
    await expect(h.store.claim(nextLead(h), cfg)).rejects.toThrow();
    expect(h.state()).toEqual(prior);
  });
  it("a failed current receipt verification rolls back the competing lead rather than swallowing the error", async () => {
    const h = port(); await h.store.claim(h.lead, cfg); h.state().intakes.length = 0; const prior = structuredClone(h.state());
    h.extra.hideClaims = 4; h.fail("LIMIT 1 FOR UPDATE");
    await expect(h.store.claim(h.lead, cfg)).rejects.toThrow("SQL save failure");
    expect(h.state()).toEqual(prior);
  });
  it.each([
    { fromPhone: "+12025559876", capability: "claude_thumbtack_first_response_v1", inboundOpenPhoneId: "tt-first:v1:old" },
    { fromPhone: "+17035551234", capability: "claude_customer_reply_v1", inboundOpenPhoneId: "tt-first:v1:old" },
    { fromPhone: "+17035551234", capability: "claude_thumbtack_first_response_v1", inboundOpenPhoneId: "ordinary-sms" },
    { fromPhone: "no-phone-tt-6", capability: "claude_thumbtack_first_response_v1", inboundOpenPhoneId: "tt-first:v1:no-phone:6" },
  ])("unrelated receipt %j cannot block this phone's first introduction", async prior => {
    const h = port(); h.state().drafts.push({ id: 1, status: "SENT", ...prior });
    expect(await h.store.claim(h.lead, cfg)).not.toBeNull(); expect(h.state().sessions).toHaveLength(1);
  });
  it("an unrelated duplicate index error is not swallowed even when a matching phone receipt exists after missed reads", async () => {
    const h = port(); await h.store.claim(h.lead, cfg); h.extra.hideClaims = 4; h.fail("unrelated-duplicate");
    await expect(h.store.claim(nextLead(h), cfg)).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1); expect(h.state().drafts).toHaveLength(1);
    expect(h.state().intakes).toHaveLength(1);
  });
  it("does not silently swallow an unexpected duplicate database error; the transaction rolls back", async () => {
    const h = port(); h.fail("duplicate"); await expect(h.store.claim(h.lead, cfg)).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    expect(h.state().sessions).toHaveLength(0); expect(h.state().drafts).toHaveLength(0); expect(h.state().cards).toHaveLength(0);
    expect(h.state().intakes).toHaveLength(0);
  });
  it.each(["madison_sms_drafts", "ops_chat_messages"])("rolls back new conversation on %s insert failure", async table => {
    const h = port(); h.fail(table); await expect(h.store.claim(h.lead, cfg)).rejects.toThrow();
    expect(h.state().sessions).toHaveLength(0); expect(h.state().drafts).toHaveLength(0); expect(h.state().cards).toHaveLength(0);
    expect(h.state().intakes).toHaveLength(0);
  });
  it("checks explicit global/session/sibling optouts without using unrelated history", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!; expect(await h.store.fresh(c)).toBe(true);
    for (const apply of [() => { h.extra.optout = [{ id: 1 }]; }, () => { h.state().sessions[0].smsOptOut = 1; },
      () => { h.extra.sibling = [{ leadPhone: "(703) 555-1234", smsOptOut: 1 }]; }]) {
      apply(); expect(await h.store.fresh(c)).toBe(false); expect(await h.store.beginSend(c, h.result)).toBe(false);
      h.extra.optout = []; h.extra.sibling = []; h.state().sessions[0].smsOptOut = 0;
    }
    h.extra.sibling = [{ leadPhone: "+12025559876", smsOptOut: 1 }]; expect(await h.store.fresh(c)).toBe(true);
  });
  it.each(["actual-phone", "missing-session", "missing-receipt", "capability", "receipt-key", "receipt-session", "receipt-phone",
    "dismissed-at", "dismissed-by", "dismissed-status", "sending-status", "sent-status", "failed-status"])("%s still prevents fresh/send authorization and model/provider calls", async changed => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!, draft = h.state().drafts[0];
    if (changed === "actual-phone") h.state().sessions[0].leadPhone = "+12025559876";
    if (changed === "missing-session") h.state().sessions.length = 0;
    if (changed === "missing-receipt") h.state().drafts.length = 0;
    if (changed === "capability") draft.capability = "claude_customer_reply_v1";
    if (changed === "receipt-key") draft.inboundOpenPhoneId = "tt-first:v1:wrong";
    if (changed === "receipt-session") draft.sessionId = c.sessionId + 1;
    if (changed === "receipt-phone") draft.fromPhone = "+12025559876";
    if (changed === "dismissed-at") draft.dismissedAt = new Date();
    if (changed === "dismissed-by") draft.dismissedBy = "Staff";
    if (changed.endsWith("-status")) draft.status = changed.split("-")[0].toUpperCase();
    expect(await h.store.fresh(c)).toBe(false); expect(await h.store.beginSend(c, h.result)).toBe(false);
    let generated = 0, sent = 0;
    const run = createClaudeThumbtackFirstResponseService({ config: () => cfg,
      store: { ...h.store, claim: async () => c, blocked: async () => {} },
      generate: async () => { generated++; throw new Error("model must not run"); },
      send: async () => { sent++; throw new Error("SMS must not run"); } });
    await run(7); expect(generated).toBe(0); expect(sent).toBe(0);
    expect(h.queries.some(q => q.sql.includes("SET status = 'SENDING'"))).toBe(false);
  });
  it.each(["description", "detail"])("exact STOP-style native %s facts still prevent model/provider calls", async field => {
    for (const text of ["STOP", " unsubscribe ", "cancel", "QUIT", "end", "remove me", "opt-out", "opt out"]) {
      const payload = JSON.parse(port().lead.capture.rawPayload);
      if (field === "description") payload.data.request.description = text;
      else payload.data.request.details[0].answer = text;
      const h = port(null, JSON.stringify(payload)), c = (await h.store.claim(h.lead, cfg))!;
      expect(await h.store.fresh(c)).toBe(false); expect(await h.store.beginSend(c, h.result)).toBe(false);
      let generated = 0, sent = 0;
      const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: { ...h.store, claim: async () => c },
        generate: async () => { generated++; throw new Error("model must not run"); },
        send: async () => { sent++; throw new Error("SMS must not run"); } });
      await run(7); expect(generated).toBe(0); expect(sent).toBe(0);
    }
  });
  it.each(["AVAILABILITY", "RESOLVED", "BOOKED"])("same-session business fields and nonempty history never block fresh/beginSend in %s", async stage => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!, now = new Date(c.lead.createdAt + 1);
    Object.assign(h.state().sessions[0], { leadSource: "email", stage, aiMode: 1, isBooked: 1, bookedAt: now,
      assignedAgentId: 2, assignedAgentName: "Staff", lastCalledAt: now, respondedAt: now, csResolvedAt: now,
      madisonDeferredUntil: now, lastProcessedMessageId: "existing", lastCustomerReplyAt: now, lastCustomerMessageTs: now,
      lastAiMessageAt: now, internalNotes: "existing note", messageCount: 9,
      messageHistory: JSON.stringify([{ role: "user", content: "STOP" }, { role: "assistant", content: "prior response" }, { role: "note", content: "staff note" }]) });
    expect(await h.store.fresh(c)).toBe(true); expect(await h.store.beginSend(c, h.result)).toBe(true);
    expect(h.state().drafts[0].status).toBe("SENDING"); expect(await h.store.beginSend(c, h.result)).toBe(false);
  });
  it.each([null, "invalid history", '[{"role":"assistant","content":"existing response"}]'])("same-session history %s is not an eligibility gate", async history => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!; h.state().sessions[0].messageHistory = history;
    expect(await h.store.fresh(c)).toBe(true); expect(await h.store.beginSend(c, h.result)).toBe(true);
  });
  it.each(["missing", "claimed", "dismissed", "wrong-metadata", "invalid-metadata", "wrong-session"])("%s card and unrelated activity never block fresh/beginSend", async changed => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!, card = h.state().cards[0];
    if (changed === "missing") h.state().cards.length = 0;
    if (changed === "claimed") card.metadata = JSON.stringify({ ...JSON.parse(card.metadata), claimedBy: "Staff" });
    if (changed === "dismissed") card.cardStatus = "dismissed";
    if (changed === "wrong-metadata") card.metadata = JSON.stringify({ sessionId: 999, nativeFirstResponseKey: "wrong" });
    if (changed === "invalid-metadata") card.metadata = "{";
    if (changed === "wrong-session") card.sessionId = 999;
    h.extra.activity = [{ id: 9, authorRole: "staff", quickAction: "madison_sms_dismissed" }];
    h.extra.messages = [{ raw_payload: "{}", created_at: new Date(c.lead.createdAt + 1) }];
    h.extra.openphone = [{ raw_payload: "{}", created_at: new Date(c.lead.createdAt + 1) }];
    expect(await h.store.fresh(c)).toBe(true); expect(await h.store.beginSend(c, h.result)).toBe(true);
    expect(h.queries.some(q => /FROM ops_chat_messages|FROM webhook_events/.test(q.sql))).toBe(false);
  });
  it.each(["changed", "malformed", "missing"])("%s resolved context/capture and informational eligibility flag do not gate fresh/beginSend", async changed => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    h.state().drafts[0].resolvedContext = changed === "changed" ? { negotiationId: "different", payloadHash: "different" } : changed === "malformed" ? "{" : null;
    delete h.extra.captures[7]; c.lead.sendEligible = false;
    expect(await h.store.fresh(c)).toBe(true); expect(await h.store.beginSend(c, h.result)).toBe(true);
    expect(h.queries.some(q => q.sql.includes("FROM webhook_events"))).toBe(false);
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
  it.each(["user", "assistant", "note"])("previous %s history does not reject an arriving lead at any timestamp", async role => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    h.extra.sibling = [{ leadPhone: c.lead.phone, messageHistory: JSON.stringify([{ role, ts: c.lead.createdAt }]) }];
    expect(await h.store.fresh(c)).toBe(true);
    h.extra.sibling[0].messageHistory = JSON.stringify([{ role, ts: c.lead.createdAt + 1 }]); expect(await h.store.fresh(c)).toBe(true);
    h.extra.sibling[0].messageHistory = JSON.stringify([{ role: "system", ts: c.lead.createdAt + 1 }]); expect(await h.store.fresh(c)).toBe(true);
  });
  it.each(["lastCalledAt", "respondedAt", "bookedAt", "lastCustomerReplyAt", "lastCustomerMessageTs"])("sibling %s activity never rejects an arriving lead", async field => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    const dateField = field === "lastCalledAt" || field === "bookedAt";
    h.extra.sibling = [{ leadPhone: c.lead.phone, messageHistory: "[]", [field]: dateField ? new Date(c.lead.createdAt - 1) : String(c.lead.createdAt - 1) }];
    expect(await h.store.fresh(c)).toBe(true);
    h.extra.sibling[0][field] = dateField ? new Date(c.lead.createdAt + 1) : String(c.lead.createdAt + 1); expect(await h.store.fresh(c)).toBe(true);
  });
  it("previous OpenPhone inbound/outbound messages no longer reject an arriving lead", async () => {
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
  it("native lead conversation messages never reject its introduction", async () => {
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
  it.each(["createdAt", "triggeredAt"])("missing/invalid/old/future native %s still generates/sends exactly once", async field => {
    for (const value of [undefined, null, "invalid", "2026-02-30T17:00:01Z", "2026-11-15T17:00:01Z", "2026-11-17T17:00:01Z"]) {
      const payload = JSON.parse(port().lead.capture.rawPayload); (field === "createdAt" ? payload.data : payload.event)[field] = value;
      const h = port(null, JSON.stringify(payload)); let generated = 0, sent = 0;
      const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: h.store,
        generate: async input => { generated++; return { ...h.result, kind: "initial_lead", requestId: input.requestId, sessionId: input.sessionId,
          customerPhone: input.customerPhone, contextHash: "a".repeat(64), mode: "review_only", smsSent: false, actionsExecuted: false,
          agentSessionId: "offline-agent-session" }; },
        send: async input => { sent++; expect(h.state().drafts[0].status).toBe("SENDING");
          expect(input).toEqual({ to: h.lead.phone, content: h.result.replyText, fromNumberId: cfg.fromNumberId });
          return { success: true, messageId: "offline-date-receipt" }; } });
      await run(7); await run(7);
      expect(h.lead.sendEligible).toBe(true);
      expect(h.lead.createdAt).toBe(field === "createdAt" && [undefined, null, "invalid", "2026-02-30T17:00:01Z"].includes(value)
        ? h.lead.capture.receivedAt.getTime() : Date.parse(payload.data.createdAt));
      expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1); expect(h.state().drafts).toHaveLength(1);
      expect(h.state().cards[0].quickAction).toBe("new_lead"); expect(h.state().sessions[0].leadSource).toBe("thumbtack");
      expect(h.state().drafts[0]).toMatchObject({ status: "SENT", errorCode: null, outboundOpenPhoneId: "offline-date-receipt" });
      expect(generated).toBe(1); expect(sent).toBe(1); expect(JSON.parse(h.state().sessions[0].messageHistory)).toHaveLength(1);
      expect(await h.store.claim(h.lead, cfg)).toBeNull();
    }
  });
  it.each(["2026-11-15T17:00:00Z", "2026-11-17T17:00:00Z"])("capture time %s is informational and does not suppress an introduction", async receivedAt => {
    const h = port(); h.extra.captures[7].receivedAt = new Date(receivedAt); let generated = 0, sent = 0;
    const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: h.store,
      generate: async input => { generated++; return { ...h.result, kind: "initial_lead", requestId: input.requestId, sessionId: input.sessionId,
        customerPhone: input.customerPhone, contextHash: "a".repeat(64), mode: "review_only", smsSent: false, actionsExecuted: false,
        agentSessionId: "offline-agent-session" }; },
      send: async () => { sent++; return { success: true, messageId: "offline-capture-date" }; } });
    await run(7); await run(7);
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1); expect(h.state().drafts).toHaveLength(1);
    expect(h.state().drafts[0].status).toBe("SENT"); expect(generated).toBe(1); expect(sent).toBe(1);
  });
  it("same-second fractional trigger completes the first introduction receipt rather than poisoning its phone slot", async () => {
    const raw = JSON.stringify({ event: { eventType: "NegotiationCreatedV4", triggeredAt: "2026-11-16T17:01:00.500Z" },
      data: { negotiationID: "precision-case", createdAt: "2026-11-16T17:00:59.999Z", customer: { firstName: "Jane", phone: "(703) 555-1234" },
        request: { description: "Clean the home" } } });
    const h = port(null, raw); let generated = 0, sent = 0;
    const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: h.store,
      generate: async input => { generated++; return { ...h.result, kind: "initial_lead", requestId: input.requestId, sessionId: input.sessionId,
        customerPhone: input.customerPhone, contextHash: "a".repeat(64), mode: "review_only", smsSent: false, actionsExecuted: false,
        agentSessionId: "offline-agent-session" }; },
      send: async input => { sent++; expect(h.state().drafts[0].status).toBe("SENDING");
        expect(input).toEqual({ to: "+17035551234", content: h.result.replyText, fromNumberId: cfg.fromNumberId });
        return { success: true, messageId: "offline-precision-receipt" }; } });
    await run(7); await run(7);
    expect(generated).toBe(1); expect(sent).toBe(1); expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1);
    expect(h.state().drafts).toHaveLength(1); expect(h.state().drafts[0]).toMatchObject({ status: "SENT", errorCode: null,
      inboundOpenPhoneId: h.lead.key, outboundOpenPhoneId: "offline-precision-receipt" });
    expect(JSON.parse(h.state().sessions[0].messageHistory)).toHaveLength(1);
  });
  it("human dismissal or manual claim wins before send; SENDING cannot be reset", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    await guardClaudeThumbtackManualSendInStore(h.db, { sessionId: c.sessionId }); expect(await h.store.beginSend(c, h.result)).toBe(false);
    const b = port(), d = (await b.store.claim(b.lead, cfg))!; expect(await b.store.beginSend(d, b.result)).toBe(true);
    await expect(guardClaudeThumbtackManualSendInStore(b.db, { phone: d.lead.phone! })).rejects.toThrow("AUTO_FIRST_RESPONSE_IN_FLIGHT");
    await b.store.blocked(d, "SUBMISSION_UNCERTAIN", true); expect(b.state().drafts[0].status).toBe("SENDING");
    await expect(guardClaudeThumbtackManualSendInStore(b.db, { phone: d.lead.phone! })).rejects.toThrow("AUTO_FIRST_RESPONSE_REVIEW_REQUIRED");
    expect(await b.store.beginSend(d, b.result)).toBe(false);
  });
  it("atomic native/manual race has one winner, and legacy actions permanently protect namespaced records", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    const outcomes = await Promise.allSettled([h.store.beginSend(c, h.result), guardClaudeThumbtackManualSendInStore(h.db, { sessionId: c.sessionId })]);
    expect(outcomes[0]).toEqual({ status: "fulfilled", value: true }); expect(outcomes[1].status).toBe("rejected");
    await expect(guardClaudeThumbtackLegacyDraftActionInStore(h.db, c.draftId)).rejects.toThrow("AUTO_FIRST_RESPONSE_PROTECTED");
    await expect(guardClaudeThumbtackLegacyDraftActionInStore(h.db, 999)).resolves.toBeUndefined();
  });
  it("acceptance append is atomic current history and includes provider ID/explicit line; save failure stays SENDING", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!; await h.store.beginSend(c, h.result);
    h.state().sessions[0].messageHistory = '[{"role":"user","content":"current activity"}]';
    await h.store.accepted(c, h.result, "provider-1"); const history = JSON.parse(h.state().sessions[0].messageHistory);
    expect(history).toHaveLength(2); expect(history[1]).toMatchObject({ content: h.result.replyText, opMsgId: "provider-1", fromNumberId: "PN-lead" });
    expect(history[0]).toEqual({ role: "user", content: "current activity" });
    expect(history[1].senderName).toBe("Madison");
    expect(history[1].smsProvenance).toEqual({ version: 1, generator: "claude", mode: "automatic",
      workflow: "thumbtack_first_response", receiptId: c.draftId, providerMessageId: "provider-1" });
    expect(smsSenderLabel(history[1], "Rohan")).toBe("Claude AI · Automatic");
    expect(smsSenderLabel({ ...history[1], opMsgId: "different-provider-message" }, "Rohan")).toBe("Madison");
    expect(h.state().drafts[0].status).toBe("SENT"); expect(h.state().drafts[0]).not.toHaveProperty("deliveredAt");
    const b = port(), d = (await b.store.claim(b.lead, cfg))!; await b.store.beginSend(d, b.result); b.fail("outboundOpenPhoneId =");
    await expect(b.store.accepted(d, b.result, "provider-2")).rejects.toThrow(); expect(b.state().drafts[0].status).toBe("SENDING"); expect(b.state().sessions[0].messageHistory).toBe("[]");
  });
});
