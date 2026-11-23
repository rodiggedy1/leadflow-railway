import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { createClaudeThumbtackFirstResponseStore, guardClaudeThumbtackManualSendInStore, guardClaudeThumbtackLegacyDraftActionInStore } from "./claudeThumbtackFirstResponseStore";
import { capturedThumbtackLead, createClaudeThumbtackFirstResponseService, thumbtackFirstResponseConfig } from "./claudeThumbtackFirstResponse";
import { smsSenderLabel } from "../../shared/smsSenderProvenance";
import { NON_LEAD_SOURCES } from "../../shared/leadSources";
import type { ThumbtackQuoSmsResult } from "./thumbtackDirectQuoSms";
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
        if (s.includes("FROM conversation_sessions")) return [extra.sibling.filter((r: any) => String(r.leadPhone).replace(/\D/g, "").slice(-10) === p[0])];
        if (s.includes("FROM ops_chat_messages WHERE id")) return [state.cards.filter((d: any) => d.id === p[0])];
        if (s.includes("FROM ops_chat_messages WHERE sessionId")) return [state.cards.filter((d: any) => d.sessionId === p[0] && d.quickAction === "new_lead")];
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
        const session = state.sessions.find((r: any) => r.id === p[3]); if (!session) return [{ affectedRows: 0 }];
        session.messageHistory = JSON.stringify([...JSON.parse(session.messageHistory), JSON.parse(p[0] as string)]); return [{ affectedRows: 1 }];
      }
      if (s.includes("SET status = 'TOOLS_RUNNING'")) {
        const d = state.drafts.find((r: any) => r.id === p[1] && r.status === p[2] && !r.dismissedAt && !r.dismissedBy && !r.outboundOpenPhoneId);
        if (!d || extra.resumeCasLost) return [{ affectedRows: 0 }];
        Object.assign(d, { status: "TOOLS_RUNNING", capabilityResult: JSON.parse(p[0] as string), errorStage: null, errorCode: null });
        return [{ affectedRows: 1 }];
      }
      if (s.includes("SET status = 'SENDING'")) {
        const d = state.drafts.find((r: any) => r.id === p[4] && r.status === "TOOLS_RUNNING" && !r.dismissedAt && !r.dismissedBy);
        if (!d) return [{ affectedRows: 0 }]; Object.assign(d, { status: "SENDING", generatedDraft: p[0], approvedText: p[1], approvedBy: p[2], capabilityResult: JSON.parse(p[3] as string) }); return [{ affectedRows: 1 }];
      }
      if (s.includes("SET status = 'DISMISSED'")) {
        const d = state.drafts.find((r: any) => r.id === p[0] && r.status === "TOOLS_RUNNING"); if (!d) return [{ affectedRows: 0 }];
        Object.assign(d, { status: "DISMISSED", errorCode: "MANUAL_FIRST_RESPONSE" }); return [{ affectedRows: 1 }];
      }
      if (s.includes("SET status = ?")) {
        const hasId = s.includes("outboundOpenPhoneId ="), offset = hasId ? 4 : 3;
        const d = state.drafts.find((r: any) => r.id === p[offset]);
        if (!d || extra.outcomeSaveLost) return [{ affectedRows: 0 }];
        Object.assign(d, { status: p[0], capabilityResult: JSON.parse(p[1] as string), errorStage: "SEND", errorCode: p[2] });
        if (hasId) d.outboundOpenPhoneId = p[3];
        return [{ affectedRows: 1 }];
      }
      if (s.includes("SET status = CASE WHEN status = 'DISMISSED'")) {
        const provider = s.includes("errorStage = ?"), d = state.drafts.find((r: any) => r.id === p[provider ? 4 : 2]);
        if (!d || extra.outcomeSaveLost) return [{ affectedRows: 0 }];
        Object.assign(d, { status: d.status === "DISMISSED" ? "DISMISSED" : "SENT", outboundOpenPhoneId: p[0], capabilityResult: JSON.parse(p[1] as string),
          errorStage: provider ? p[2] : null, errorCode: provider ? p[3] : null }); return [{ affectedRows: 1 }];
      }
      if (s.includes("SET status = CASE WHEN status = 'TOOLS_RUNNING'")) {
        const d = state.drafts.find((r: any) => r.id === p[2]); if (d.status === "TOOLS_RUNNING") d.status = "DISMISSED"; d.errorStage = p[0]; d.errorCode = p[1]; return [{ affectedRows: 1 }];
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
  it.each([["+11005551234", "(100) 555-1234"], ["+17031551234", "703-155-1234"], ["+44123456789", "+44 1234 56789"],
    ["+123456", "+1 23456"], ["12345", "12345"]])("native sibling opt-out matches %s from %s without global phone validity gates", async (phone, siblingPhone) => {
    const h = port(); h.lead.phone = phone;
    const c = (await h.store.claim(h.lead, cfg))!;
    expect(await h.store.fresh(c)).toBe(true);
    h.extra.sibling = [{ leadPhone: siblingPhone, smsOptOut: 1 }];
    expect(await h.store.fresh(c)).toBe(false); expect(await h.store.beginSend(c, h.result)).toBe(false);
    h.extra.sibling = [{ leadPhone: "+12025559876", smsOptOut: 1 }];
    expect(await h.store.fresh(c)).toBe(true);
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
  it.each(["description", "detail"].flatMap(field =>
    ["STOP", " unsubscribe ", "cancel", "QUIT", "end", "remove me", "opt-out", "opt out"].map(text => [field, text])))
  ("native %s text %j never vetoes a new lead's automatic introduction", async (field, text) => {
    const payload = JSON.parse(port().lead.capture.rawPayload);
    if (field === "description") payload.data.request.description = text;
    else payload.data.request.details[0].answer = text;
    const h = port(null, JSON.stringify(payload)), c = (await h.store.claim(h.lead, cfg))!;
    expect(await h.store.fresh(c)).toBe(true);
    let generated = 0, sent = 0;
    const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: { ...h.store, claim: async () => c },
      generate: async input => { generated++; return { ...h.result, kind: "initial_lead", requestId: input.requestId, sessionId: input.sessionId,
        customerPhone: input.customerPhone, contextHash: "a".repeat(64), mode: "review_only", smsSent: false, actionsExecuted: false,
        agentSessionId: "offline-agent-session" }; },
      send: async input => { sent++; expect(input).toEqual({ to: h.lead.phone, content: h.result.replyText, fromNumberId: cfg.fromNumberId });
        return { success: true, messageId: "offline-keyword-introduction" }; } });
    expect(await run(7)).toMatchObject({ outcome: "sent", messageId: "offline-keyword-introduction" });
    expect(generated).toBe(1); expect(sent).toBe(1); expect(h.state().drafts[0].status).toBe("SENT");
    expect(JSON.parse(h.state().sessions[0].messageHistory)[0].content).toBe(h.result.replyText);
  });
  it.each(["global", "session", "sibling"])("explicit %s opt-out still blocks with keyword text in lead-form fields", async source => {
    const payload = JSON.parse(port().lead.capture.rawPayload);
    payload.data.request.description = "cancel"; payload.data.request.details[0].answer = "end";
    const h = port(null, JSON.stringify(payload)), c = (await h.store.claim(h.lead, cfg))!;
    if (source === "global") h.extra.optout = [{ id: 1 }];
    if (source === "session") h.state().sessions[0].smsOptOut = 1;
    if (source === "sibling") h.extra.sibling = [{ leadPhone: h.lead.phone, smsOptOut: 1 }];
    expect(await h.store.fresh(c)).toBe(false); expect(await h.store.beginSend(c, h.result)).toBe(false);
    let generated = 0, sent = 0;
    const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: { ...h.store, claim: async () => c },
      generate: async () => { generated++; throw new Error("model must not run"); },
      send: async () => { sent++; throw new Error("SMS must not run"); } });
    expect(await run(7)).toMatchObject({ outcome: "suppressed" }); expect(generated).toBe(0); expect(sent).toBe(0);
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
  it.each(["QUO_HTTP_400", "QUO_CONFIG_MISSING"])("definite rejection/not-submitted %s releases the manual guard and only later redelivery resumes the same claim", async code => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    const result = { ...h.result, agentId: "openai:gpt-4o", agentSessionId: "chatcmpl-rejected" };
    await h.store.beginSend(c, result); const before = structuredClone(h.state().drafts[0].capabilityResult);
    await h.store.blocked(c, code, false, { kind: "rejected", success: false, code, httpStatus: 400, providerReason: "Rejected destination", traceId: "trace-reject" });
    expect(h.state().drafts[0]).toMatchObject({ status: "DISMISSED", errorStage: "SEND", errorCode: code, approvedBy: "chatgpt_thumbtack_auto",
      capabilityResult: { ...before, phase: "submission_rejected", provider: { kind: "rejected", success: false, code, httpStatus: 400, providerReason: "Rejected destination", traceId: "trace-reject" } } });
    expect(h.state().drafts[0]).not.toHaveProperty("outboundOpenPhoneId"); expect(h.state().sessions[0].messageHistory).toBe("[]");
    await expect(guardClaudeThumbtackManualSendInStore(h.db, { sessionId: c.sessionId })).resolves.toBeUndefined();
    await expect(guardClaudeThumbtackManualSendInStore(h.db, { phone: c.lead.phone! })).resolves.toBeUndefined();
    expect(await h.store.beginSend(c, result)).toBe(false); expect(await h.store.claim(h.lead, cfg)).toEqual(c);
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1); expect(h.state().drafts).toHaveLength(1);
  });
  it.each(["generation", "rejected"])("later redelivery after %s failure reuses one card/session/draft and sends only after a new atomic claim", async failure => {
    const h = port(); let generated = 0, sent = 0;
    const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: h.store,
      generate: async input => {
        generated++; if (failure === "generation" && generated === 1) throw new Error("offline generation failed");
        return { ...h.result, kind: "initial_lead", requestId: input.requestId, sessionId: input.sessionId,
          customerPhone: input.customerPhone, contextHash: "a".repeat(64), mode: "review_only", smsSent: false, actionsExecuted: false,
          agentSessionId: "offline-agent-session" };
      },
      send: async () => {
        sent++; if (failure === "rejected" && sent === 1) return { kind: "rejected", success: false, code: "QUO_HTTP_400" };
        return { kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: "redelivery-provider-id" };
      } });
    expect(await run(7)).toMatchObject({ outcome: "failed" });
    const ids = { draft: h.state().drafts[0].id, session: h.state().sessions[0].id, card: h.state().cards[0].id };
    expect(sent).toBe(failure === "generation" ? 0 : 1);
    expect(await run(7)).toMatchObject({ outcome: "sent", messageId: "redelivery-provider-id" });
    expect(await run(7)).toMatchObject({ outcome: "duplicate" });
    expect(generated).toBe(2); expect(sent).toBe(failure === "generation" ? 1 : 2);
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1); expect(h.state().drafts).toHaveLength(1); expect(h.state().intakes).toHaveLength(1);
    expect({ draft: h.state().drafts[0].id, session: h.state().sessions[0].id, card: h.state().cards[0].id }).toEqual(ids);
    expect(JSON.parse(h.state().sessions[0].messageHistory)).toHaveLength(1);
  });
  it.each(["generation", "rejected"])("concurrent %s failure redeliveries have exactly one resumed claim using the current configured sender", async failure => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    if (failure === "generation") await h.store.blocked(c, "GENERATION_OR_SAVE_FAILED", false);
    else {
      await h.store.beginSend(c, h.result);
      await h.store.blocked(c, "QUO_HTTP_400", false, { kind: "rejected", success: false, code: "QUO_HTTP_400" });
    }
    const current = { ...cfg, fromNumberId: "PN-current" };
    const claims = await Promise.all([h.store.claim(h.lead, current), h.store.claim(h.lead, current), h.store.claim(h.lead, current)]);
    expect(claims.filter(Boolean)).toEqual([{ ...c, fromNumberId: "PN-current" }]);
    expect(h.state().drafts[0]).toMatchObject({ status: "TOOLS_RUNNING", errorStage: null, errorCode: null, capabilityResult: { phase: "claimed" } });
    expect(h.state().drafts[0].capabilityResult).not.toHaveProperty("provider");
    expect(await h.store.beginSend(claims.find(Boolean)!, h.result)).toBe(true);
    expect(h.state().drafts[0].capabilityResult.fromNumberId).toBe("PN-current");
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1); expect(h.state().drafts).toHaveLength(1);
  });
  it.each(["global", "session", "sibling"])("resumed claim still rechecks genuine %s opt-outs before any generation/send", async source => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    await h.store.blocked(c, "GENERATION_OR_SAVE_FAILED", false);
    if (source === "global") h.extra.optout = [{ id: 1 }];
    if (source === "session") h.state().sessions[0].smsOptOut = 1;
    if (source === "sibling") h.extra.sibling = [{ leadPhone: c.lead.phone, smsOptOut: 1 }];
    let calls = 0;
    const run = createClaudeThumbtackFirstResponseService({ config: () => cfg, store: h.store,
      generate: async () => { calls++; throw new Error("must not generate"); }, send: async () => { calls++; throw new Error("must not send"); } });
    expect(await run(7)).toMatchObject({ outcome: "suppressed" }); expect(calls).toBe(0);
    expect(h.state().sessions).toHaveLength(1); expect(h.state().cards).toHaveLength(1); expect(h.state().drafts).toHaveLength(1);
  });
  it.each(["active", "sending", "uncertain", "accepted", "recording-failed", "manual-code", "dismissed-at", "dismissed-by", "manual-replied",
    "malformed", "missing-state", "missing-error", "unproven-error", "unproven-rejection", "outbound-id", "state-id", "provider-id", "missing-session", "missing-card", "invalid-history"])
  ("%s existing receipt remains non-resumable without duplicate session/card/draft creation", async protectedState => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    await h.store.blocked(c, "GENERATION_OR_SAVE_FAILED", false); const draft = h.state().drafts[0];
    if (protectedState === "active") draft.status = "TOOLS_RUNNING";
    if (protectedState === "sending") draft.status = "SENDING";
    if (protectedState === "uncertain") draft.capabilityResult = { phase: "submission_started", provider: { kind: "uncertain" } };
    if (protectedState === "accepted") draft.capabilityResult.phase = "accepted";
    if (protectedState === "recording-failed") draft.capabilityResult.phase = "provider_accepted_recording_failed";
    if (protectedState === "manual-code") draft.errorCode = "MANUAL_FIRST_RESPONSE";
    if (protectedState === "dismissed-at") draft.dismissedAt = new Date();
    if (protectedState === "dismissed-by") draft.dismissedBy = "Staff";
    if (protectedState === "manual-replied") h.state().sessions[0].messageHistory = '[{"role":"assistant","content":"manual reply","senderName":"Staff"}]';
    if (protectedState === "malformed") draft.capabilityResult = "{";
    if (protectedState === "missing-state") draft.capabilityResult = null;
    if (protectedState === "missing-error") draft.errorCode = null;
    if (protectedState === "unproven-error") draft.errorStage = "SEND";
    if (protectedState === "unproven-rejection") draft.capabilityResult = { phase: "submission_rejected", provider: { kind: "uncertain" } };
    if (protectedState === "outbound-id") draft.outboundOpenPhoneId = "known-id";
    if (protectedState === "state-id") draft.capabilityResult.messageId = "known-id";
    if (protectedState === "provider-id") draft.capabilityResult = { phase: "submission_rejected", provider: { kind: "rejected", messageId: "known-id" } };
    if (protectedState === "missing-session") h.state().sessions.length = 0;
    if (protectedState === "missing-card") h.state().cards.length = 0;
    if (protectedState === "invalid-history") h.state().sessions[0].messageHistory = "{";
    const before = structuredClone(h.state());
    expect(await h.store.claim(h.lead, cfg)).toBeNull(); expect(h.state()).toEqual(before);
  });
  it("a lost resume compare-and-set never returns send ownership or creates another card", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!; await h.store.blocked(c, "GENERATION_OR_SAVE_FAILED", false);
    const before = structuredClone(h.state()); h.extra.resumeCasLost = true;
    expect(await h.store.claim(h.lead, cfg)).toBeNull(); expect(h.state()).toEqual(before);
  });
  it("unknown acceptance stays locked with bounded whitelisted diagnostics and no unverified outbound ID", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!; await h.store.beginSend(c, h.result);
    const before = structuredClone(h.state().drafts[0].capabilityResult);
    const provider = { kind: "uncertain", success: false, code: "QUO_TIMEOUT", providerReason: "x".repeat(900), traceId: "trace\n" + "t".repeat(500),
      httpStatus: 503, providerCode: 42, providerStatus: "unknown", messageId: "unverified", rawBody: "secret", authorization: "credential" } as unknown as ThumbtackQuoSmsResult;
    await h.store.blocked(c, "QUO_TIMEOUT", true, provider);
    const draft = h.state().drafts[0];
    expect(draft).toMatchObject({ status: "SENDING", errorStage: "SEND", errorCode: "QUO_TIMEOUT", capabilityResult: { ...before, phase: "submission_started" } });
    expect(draft.capabilityResult.provider).toEqual({ kind: "uncertain", success: false, code: "QUO_TIMEOUT", httpStatus: 503, providerStatus: "unknown",
      providerReason: "x".repeat(500), providerCode: 42, traceId: ("trace " + "t".repeat(500)).slice(0, 256) });
    expect(draft).not.toHaveProperty("outboundOpenPhoneId"); expect(draft.capabilityResult).not.toHaveProperty("messageId");
    expect(h.state().sessions[0].messageHistory).toBe("[]");
    await expect(guardClaudeThumbtackManualSendInStore(h.db, { sessionId: c.sessionId })).rejects.toThrow("AUTO_FIRST_RESPONSE_REVIEW_REQUIRED");
    expect(await h.store.beginSend(c, h.result)).toBe(false);
  });
  it("known acceptance with failed local recording retains its ID and WorldClass result while remaining locked without history append", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    const result = { ...h.result, agentId: "openai:gpt-4o", agentSessionId: "chatcmpl-local-failure" };
    await h.store.beginSend(c, result); const before = structuredClone(h.state().drafts[0].capabilityResult);
    const provider: ThumbtackQuoSmsResult = { kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: "known-provider-id", providerStatus: "queued", httpStatus: 202 };
    h.fail("sentAt ="); await expect(h.store.accepted(c, result, provider.messageId, provider)).rejects.toThrow("SQL save failure"); h.fail("");
    await h.store.blocked(c, "ACCEPTANCE_SAVE_FAILED", true, provider);
    expect(h.state().drafts[0]).toMatchObject({ status: "SENDING", outboundOpenPhoneId: "known-provider-id", errorStage: "SEND", errorCode: "ACCEPTANCE_SAVE_FAILED",
      approvedBy: "chatgpt_thumbtack_auto", capabilityResult: { ...before, phase: "provider_accepted_recording_failed", messageId: "known-provider-id", provider } });
    expect(h.state().sessions[0].messageHistory).toBe("[]");
    await expect(guardClaudeThumbtackManualSendInStore(h.db, { sessionId: c.sessionId })).rejects.toThrow("AUTO_FIRST_RESPONSE_REVIEW_REQUIRED");
    const recorded = structuredClone(h.state());
    await h.store.blocked(c, "QUO_HTTP_400", false, { kind: "rejected", success: false, code: "QUO_HTTP_400" });
    expect(h.state()).toEqual(recorded); expect(await h.store.beginSend(c, result)).toBe(false);
  });
  it("preserves the exact opaque accepted ID in history, receipt and recording-failure metadata without a guessed length cap", async () => {
    const messageId = "AC-" + "opaque".repeat(50);
    for (const recordingFailure of [false, true]) {
      const h = port(), c = (await h.store.claim(h.lead, cfg))!; await h.store.beginSend(c, h.result);
      const provider: ThumbtackQuoSmsResult = { kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId, providerStatus: "queued" };
      if (recordingFailure) await h.store.blocked(c, "ACCEPTANCE_SAVE_FAILED", false, provider);
      else await h.store.accepted(c, h.result, messageId, provider);
      const draft = h.state().drafts[0];
      expect(draft.outboundOpenPhoneId).toBe(messageId); expect(draft.capabilityResult.messageId).toBe(messageId);
      expect(draft.capabilityResult.provider.messageId).toBe(messageId);
      if (!recordingFailure) expect(JSON.parse(h.state().sessions[0].messageHistory)[0].opMsgId).toBe(messageId);
    }
  });
  it.each(["queued", "sent", "failed", "undelivered"])("accepted provider receipt retains actual %s status and never claims carrier delivery", async providerStatus => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    const result = { ...h.result, agentId: "openai:gpt-4o", agentSessionId: "chatcmpl-provider" };
    await h.store.beginSend(c, result); h.state().drafts[0].capabilityResult.originalReceiptMetadata = "preserved";
    h.state().sessions[0].messageHistory = '[{"role":"user","content":"current activity"}]';
    const provider: ThumbtackQuoSmsResult = { kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: "provider-status-id", httpStatus: 202,
      providerStatus, providerReason: "provider reason", providerCode: "provider-code", traceId: "trace-id" };
    await h.store.accepted(c, result, provider.messageId, provider);
    const code = providerStatus === "failed" ? "QUO_MESSAGE_FAILED" : providerStatus === "undelivered" ? "QUO_MESSAGE_UNDELIVERED" : null;
    const draft = h.state().drafts[0];
    expect(draft).toMatchObject({ status: "SENT", outboundOpenPhoneId: provider.messageId, errorStage: code ? "SEND" : null, errorCode: code,
      capabilityResult: { phase: "accepted", messageId: provider.messageId, result, fromNumberId: "PN-lead", originalReceiptMetadata: "preserved", provider } });
    expect(draft).not.toHaveProperty("deliveredAt");
    const history = JSON.parse(h.state().sessions[0].messageHistory);
    expect(history).toHaveLength(2); expect(history[0].content).toBe("current activity");
    expect(history[1]).toMatchObject({ content: result.replyText, opMsgId: provider.messageId, fromNumberId: "PN-lead",
      smsProvenance: { generator: "chatgpt", providerMessageId: provider.messageId, receiptId: c.draftId } });
    expect(smsSenderLabel(history[1], "Rohan")).toBe("ChatGPT · Automatic");
    const committed = structuredClone(h.state());
    await h.store.blocked(c, "ACCEPTANCE_SAVE_FAILED", true, provider);
    await h.store.blocked(c, "QUO_TIMEOUT", true, { kind: "uncertain", success: false, code: "QUO_TIMEOUT" });
    await h.store.blocked(c, "QUO_HTTP_400", false, { kind: "rejected", success: false, code: "QUO_HTTP_400" });
    expect(h.state()).toEqual(committed);
  });
  it.each(["key", "session", "capability", "phone", "sender", "result", "generated-text", "phase", "dismissed", "failed", "tools-running",
    "sent-without-id", "accepted-phase-without-id", "missing-state", "malformed-state", "session-phone", "session-source"])("changed %s metadata never discards accepted, rejected, uncertain or recording-failed receipts", async changed => {
    for (const kind of ["accepted", "rejected", "uncertain", "recording-failed"] as const) {
      const h = port(), c = (await h.store.claim(h.lead, cfg))!; await h.store.beginSend(c, h.result);
      const draft = h.state().drafts[0];
      if (changed === "key") draft.inboundOpenPhoneId = "tt-first:v1:other";
      if (changed === "session") draft.sessionId++;
      if (changed === "capability") draft.capability = "other";
      if (changed === "phone") draft.fromPhone = "+12025559876";
      if (changed === "sender") draft.capabilityResult.fromNumberId = "PN-other";
      if (changed === "result") draft.capabilityResult.result = { replyText: "changed stored result" };
      if (changed === "generated-text") draft.generatedDraft = "changed stored text";
      if (changed === "phase") draft.capabilityResult.phase = "provider_accepted_recording_failed";
      if (changed === "dismissed") draft.status = "DISMISSED";
      if (changed === "failed") draft.status = "FAILED";
      if (changed === "tools-running") draft.status = "TOOLS_RUNNING";
      if (changed === "sent-without-id") draft.status = "SENT";
      if (changed === "accepted-phase-without-id") draft.capabilityResult.phase = "accepted";
      if (changed === "missing-state") draft.capabilityResult = null;
      if (changed === "malformed-state") draft.capabilityResult = "{";
      if (changed === "session-phone") h.state().sessions[0].leadPhone = "+12025559876";
      if (changed === "session-source") h.state().sessions[0].leadSource = "email";
      const accepted: ThumbtackQuoSmsResult = { kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: "genuine-provider-id" };
      if (kind === "accepted") {
        await h.store.accepted(c, h.result, accepted.messageId, accepted);
        expect(draft).toMatchObject({ outboundOpenPhoneId: accepted.messageId,
          capabilityResult: { phase: "accepted", messageId: accepted.messageId, result: h.result, fromNumberId: c.fromNumberId, provider: accepted } });
        expect(JSON.parse(h.state().sessions[0].messageHistory)).toMatchObject([{ content: h.result.replyText, opMsgId: accepted.messageId }]);
      } else {
        const provider: ThumbtackQuoSmsResult = kind === "recording-failed" ? accepted
          : { kind, success: false, code: kind === "rejected" ? "QUO_HTTP_400" : "QUO_TIMEOUT" };
        const code = kind === "recording-failed" ? "ACCEPTANCE_SAVE_FAILED" : provider.code;
        await h.store.blocked(c, code, kind !== "rejected", provider);
        expect(draft).toMatchObject({ status: kind === "rejected" ? "DISMISSED" : "SENDING", errorCode: code,
          capabilityResult: { phase: kind === "rejected" ? "submission_rejected" : kind === "recording-failed" ? "provider_accepted_recording_failed" : "submission_started", provider } });
        expect(h.state().sessions[0].messageHistory).toBe("[]");
        if (kind === "recording-failed") expect(draft.outboundOpenPhoneId).toBe(accepted.messageId);
        else expect(draft.outboundOpenPhoneId).toBeUndefined();
      }
      const writes = h.queries.filter(q => q.sql.startsWith("UPDATE") && !q.sql.includes("SET status = 'SENDING'"));
      for (const write of writes) expect(write.sql.split("WHERE")[1].trim()).toBe("id = ?");
    }
  });
  it.each(["outbound-id", "state-id", "provider-id"])("known acceptance from %s is never overwritten or downgraded by another outcome", async known => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!; await h.store.beginSend(c, h.result);
    const draft = h.state().drafts[0];
    if (known === "outbound-id") draft.outboundOpenPhoneId = "original-provider-id";
    if (known === "state-id") draft.capabilityResult.messageId = "original-provider-id";
    if (known === "provider-id") draft.capabilityResult.provider = { kind: "accepted", messageId: "original-provider-id" };
    const before = structuredClone(h.state());
    const accepted: ThumbtackQuoSmsResult = { kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: "different-provider-id" };
    await h.store.accepted(c, h.result, accepted.messageId, accepted);
    await h.store.accepted(c, h.result, "legacy-different-id");
    for (const provider of [{ kind: "rejected", success: false, code: "QUO_HTTP_400" }, { kind: "uncertain", success: false, code: "QUO_TIMEOUT" }, accepted] as ThumbtackQuoSmsResult[]) {
      await h.store.blocked(c, provider.kind === "accepted" ? "ACCEPTANCE_SAVE_FAILED" : provider.code, provider.kind !== "rejected", provider);
      expect(h.state()).toEqual(before);
    }
  });
  it("repeated accepted callbacks never append the same provider ID twice, including an existing history entry", async () => {
    for (const historyExists of [false, true]) {
      const h = port(), c = (await h.store.claim(h.lead, cfg))!; await h.store.beginSend(c, h.result);
      const messageId = "same-provider-id";
      if (historyExists) h.state().sessions[0].messageHistory = JSON.stringify([{ role: "assistant", content: h.result.replyText, opMsgId: messageId }]);
      const provider: ThumbtackQuoSmsResult = { kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId };
      await Promise.all([h.store.accepted(c, h.result, messageId, provider), h.store.accepted(c, h.result, messageId, provider)]);
      expect(JSON.parse(h.state().sessions[0].messageHistory)).toHaveLength(1);
      expect(h.state().drafts[0]).toMatchObject({ status: "SENT", outboundOpenPhoneId: messageId });
      expect(h.queries.filter(q => q.sql.includes("UPDATE conversation_sessions SET messageHistory"))).toHaveLength(historyExists ? 0 : 1);
    }
  });
  it.each(["draft", "session"])("missing %s still prevents acceptance recording without writing partial history", async missing => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!; await h.store.beginSend(c, h.result);
    if (missing === "draft") h.state().drafts.length = 0;
    else h.state().sessions.length = 0;
    const before = structuredClone(h.state());
    const provider: ThumbtackQuoSmsResult = { kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: "known-id" };
    await expect(h.store.accepted(c, h.result, provider.messageId, provider)).rejects.toThrow(missing === "draft" ? "ACCEPTANCE_SAVE_FAILED" : "ACCEPTANCE_SESSION_SAVE_FAILED");
    expect(h.state()).toEqual(before);
    if (missing === "draft") {
      await h.store.blocked(c, "ACCEPTANCE_SAVE_FAILED", true, provider);
      expect(h.state()).toEqual(before);
    }
  });
  it("failed acceptance write rolls back its history append and preserves the accepted ID on fallback", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!; await h.store.beginSend(c, h.result); const before = structuredClone(h.state());
    const provider: ThumbtackQuoSmsResult = { kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: "save-lost-id" };
    h.extra.outcomeSaveLost = true;
    await expect(h.store.accepted(c, h.result, provider.messageId, provider)).rejects.toThrow("ACCEPTANCE_SAVE_FAILED");
    expect(h.state()).toEqual(before); h.extra.outcomeSaveLost = false;
    await h.store.blocked(c, "ACCEPTANCE_SAVE_FAILED", true, provider);
    expect(h.state().drafts[0]).toMatchObject({ status: "SENDING", outboundOpenPhoneId: provider.messageId,
      capabilityResult: { phase: "provider_accepted_recording_failed", messageId: provider.messageId, provider } });
    expect(h.state().sessions[0].messageHistory).toBe("[]");
  });
  it("legacy three-argument accepted/blocked paths retain their original metadata, statuses and stage behavior", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    await h.store.blocked(c, "PRE_SEND_GATE", false);
    expect(h.state().drafts[0]).toMatchObject({ status: "DISMISSED", errorStage: "GATE", errorCode: "PRE_SEND_GATE", capabilityResult: { phase: "claimed" } });
    const b = port(), d = (await b.store.claim(b.lead, cfg))!; await b.store.beginSend(d, b.result);
    const before = structuredClone(b.state().drafts[0].capabilityResult);
    await b.store.blocked(d, "SUBMISSION_UNCERTAIN", true);
    expect(b.state().drafts[0]).toMatchObject({ status: "SENDING", errorStage: "SEND", errorCode: "SUBMISSION_UNCERTAIN", capabilityResult: before });
    await b.store.accepted(d, b.result, "legacy-id");
    expect(b.state().drafts[0]).toMatchObject({ status: "SENT", errorStage: null, errorCode: null,
      capabilityResult: { phase: "accepted", messageId: "legacy-id", result: b.result, fromNumberId: "PN-lead" } });
    expect(b.state().drafts[0].capabilityResult).not.toHaveProperty("provider");
  });
  it("WorldClass approval and accepted history identify ChatGPT while preserving exact text, sender line and atomic history", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    const result = { ...h.result, agentId: "openai:gpt-4o", agentSessionId: "chatcmpl-offline" };
    expect(await h.store.beginSend(c, result)).toBe(true);
    expect(h.state().drafts[0].approvedBy).toBe("chatgpt_thumbtack_auto");
    h.state().sessions[0].messageHistory = '[{"role":"user","content":"current activity"}]';
    await h.store.accepted(c, result, "provider-chatgpt");
    const history = JSON.parse(h.state().sessions[0].messageHistory);
    expect(history).toHaveLength(2); expect(history[0].content).toBe("current activity");
    expect(history[1]).toMatchObject({ content: result.replyText, senderName: "Madison", fromNumberId: "PN-lead",
      smsProvenance: { version: 1, generator: "chatgpt", mode: "automatic", workflow: "thumbtack_first_response",
        receiptId: c.draftId, providerMessageId: "provider-chatgpt" } });
    expect(smsSenderLabel(history[1], "Rohan")).toBe("ChatGPT · Automatic");
    expect(h.state().drafts[0].capabilityResult.result.agentSessionId).toBe("chatcmpl-offline");
    expect(h.state().drafts[0].status).toBe("SENT");
  });
  it("existing Claude results keep their original automatic approval attribution", async () => {
    const h = port(), c = (await h.store.claim(h.lead, cfg))!;
    expect(await h.store.beginSend(c, h.result)).toBe(true);
    expect(h.state().drafts[0].approvedBy).toBe("claude_thumbtack_auto");
  });
});
