import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { TeamEvidence, TeamEvidenceWindow } from "../shared/teamLeaderboardEvidence";
import type { Backend } from "./instinct/claudeAgentClient";
import type { TeamEvidenceAuditRead } from "./teamLeaderboardEvidenceService";
import {
  createTeamWeeklyReviewContext, TEAM_WEEKLY_REVIEW_TOOL_NAMES,
  type TeamWeeklyReviewManifest, type TeamWeeklyReviewPage,
} from "./teamWeeklyReviewContext";

const start = "2026-11-15T05:00:00.000Z";
const sunday = "2026-11-15T15:00:00.000Z";
const monday = "2026-11-16T15:00:00.000Z";
const tuesday = "2026-11-17T15:00:00.000Z";
const capture = "2026-11-20T04:00:00.000Z";
const old = "2026-10-01T15:00:00.000Z";
const window: TeamEvidenceWindow = {
  weekStart: "2026-11-15", weekEnd: "2026-11-21", throughDate: "2026-11-19",
  timeZone: "America/New_York", startInclusiveUtc: start, endExclusiveUtc: capture, capturedAtUtc: capture,
};
function source(id: string, values: Partial<TeamEvidence> = {}): TeamEvidence {
  return {
    id, revision: "a".repeat(64), sourceKind: "sms", store: "conversation_sessions", sourceRowId: id,
    providerId: `provider-${id}`, sessionId: "session-1", threadId: null, originalText: `Exact original ${id} \n`,
    occurredAtUtc: monday, observedAtUtc: monday, timeBasis: "original", bodyBasis: "original", speakerBasis: "customer",
    customerPhone: "+17035551234", customerEmail: null, customerName: "Same Name", businessLine: "+17035559876", mailboxEmail: null,
    limitations: [], ...values,
  };
}
function audit(evidence: TeamEvidence[], values: Partial<TeamEvidenceAuditRead["sources"]> = {}): TeamEvidenceAuditRead {
  return {
    status: "unpublished_read", publication: null, scoreResults: null,
    sources: { window: { ...window }, evidence, families: [
      { store: "conversation_sessions", scannedRows: evidence.length, evidenceItems: evidence.length, status: "read", exhausted: true, limitations: [] },
    ], collectionComplete: true, limitations: [], ...values },
    history: { visits: [], teams: [], assignments: [], complete: true, limitations: [] },
  };
}
const page = async (backend: Backend, name: string, offset = 0, limit = 100, event = "event-1") =>
  await backend.callTool(name, { offset, limit }, event) as TeamWeeklyReviewPage;
const manifest = async (backend: Backend) => await backend.callTool("get_weekly_review_manifest", {}, "manifest") as TeamWeeklyReviewManifest;

function fourChannels(): TeamEvidence[] {
  return [
    source("sms-later", { occurredAtUtc: tuesday, originalText: "Customer: Thank you; that was resolved." }),
    source("sms-outbound", { occurredAtUtc: monday, speakerBasis: "non_customer", originalText: "Staff: We can arrange a reclean." }),
    source("sms-first", { occurredAtUtc: sunday, originalText: "Customer: El baño quedó sucio." }),
    source("human", { sourceKind: "human_call", store: "ops_chat_messages:staff_call_receipts", sessionId: "phone-session", providerId: "call-1",
      speakerBasis: "unverified", bodyBasis: "snapshot", originalText: "Unattributed: Kitchen is still dirty", limitations: ["Saved snapshot evidence segments only"] }),
    source("unverified", { sourceKind: "phone_unverified", store: "openphone_call_recordings", sessionId: "phone-session", providerId: "call-1",
      speakerBasis: "unverified", originalText: "The kitchen is dirty\nWe can help", limitations: ["Turn speaker/timing structure not retained by DTO"] }),
    source("ai", { sourceKind: "ai_call", store: "voice_calls", sessionId: null, providerId: "vapi-call", speakerBasis: "unverified",
      occurredAtUtc: null, timeBasis: "stored", observedAtUtc: monday, originalText: "Customer: No limpiaron el baño.\nAI: Puedo ayudar." }),
    source("ai-translation", { sourceKind: "ai_call", store: "call_log", sessionId: null, providerId: "vapi-call", bodyBasis: "snapshot",
      occurredAtUtc: null, timeBasis: "stored", observedAtUtc: monday, speakerBasis: "unverified", originalText: "Customer: They did not clean the bathroom.",
      limitations: ["Stored English translation is a non-original variant, not eligible original complaint evidence"] }),
    source("email-first", { sourceKind: "email", store: "ops_chat_messages:email_receipts", sessionId: null, providerId: "message-1", threadId: "thread-1",
      customerEmail: "customer@example.test", customerPhone: null, mailboxEmail: "office@example.test", originalText: "Exact inbound body\nRegards", occurredAtUtc: sunday }),
    source("email-sent", { sourceKind: "email", store: "ops_chat_messages:email_receipts", sessionId: null, providerId: "message-2", threadId: "thread-1",
      customerEmail: "customer@example.test", customerPhone: null, mailboxEmail: "office@example.test", originalText: "Exact outbound reply", speakerBasis: "non_customer" }),
    source("email-html", { sourceKind: "email", store: "ops_chat_messages:email_receipts", sessionId: null, providerId: "message-1", threadId: "thread-1",
      customerEmail: "customer@example.test", customerPhone: null, mailboxEmail: "office@example.test", originalText: "<div>Exact inbound body</div>", occurredAtUtc: sunday,
      limitations: ["Original body is HTML; no stripped/rewritten text substituted"] }),
  ];
}

describe("weekly communication context (synthetic and passive)", () => {
  it("exposes the exact five constant closed schemas with a Backend-compatible shape", async () => {
    const context = createTeamWeeklyReviewContext(audit([]));
    const backend: Backend = context.backend;
    const directBackend: Backend = context;
    expect(directBackend.tools).toEqual(backend.tools);
    expect(backend.tools.map(tool => tool.name)).toEqual(TEAM_WEEKLY_REVIEW_TOOL_NAMES);
    expect(backend.tools).toHaveLength(5);
    for (const tool of backend.tools) {
      expect(tool.description).not.toBe("");
      expect(Object.keys(tool).sort()).toEqual(["description", "input_schema", "name"]);
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(tool.name).not.toMatch(/^(?:read|bash|write|edit|mcp__|ant__)$/);
    }
    expect(backend.tools[0].input_schema).toMatchObject({ properties: {}, required: [] });
    expect(backend.tools[1].input_schema).toMatchObject({ properties: { offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["offset", "limit"] });
  });

  it("returns coherent complete chronological SMS/email units and every original ID/revision including outbound context", async () => {
    const originals = fourChannels();
    const context = createTeamWeeklyReviewContext(audit(originals));
    const sms = await page(context, "read_weekly_sms", 0, 1);
    expect(sms.units).toHaveLength(1);
    expect(sms.units[0].sources.map(entry => entry.source.id)).toEqual(["sms-first", "sms-outbound", "sms-later"]);
    expect(sms.units[0].sources.map(entry => entry.source.originalText)).toEqual([originals[2].originalText, originals[1].originalText, originals[0].originalText]);
    expect(sms.units[0].sources[1]).toMatchObject({ candidateEligible: false, contextReason: "non_customer" });
    expect(sms.units[0].sources[1].speakerLabel).toContain("staff/business/assistant");
    expect(sms.returnedEligibleIds).toEqual(["sms-first", "sms-later"]);
    const email = await page(context, "read_weekly_emails", 0, 1);
    expect(email.units).toHaveLength(1);
    expect(email.units[0].identity.basis).toBe("thread_mailbox");
    expect(email.units[0].sources.map(entry => entry.source.id)).toEqual(["email-first", "email-html", "email-sent"]);
    expect(email.units[0].sources[1].source.originalText).toBe("<div>Exact inbound body</div>");
    expect(email.units[0].sources[2].candidateEligible).toBe(false);
    expect(email.units[0].sources.every(entry => entry.source.revision === "a".repeat(64))).toBe(true);
    expect(email.units[0].warnings.join(" ")).toContain("original full headers/subject are not supplied");
  });

  it("distinguishes human, AI and unverified saved calls without fabricating body, speaker, timestamps or audio review", async () => {
    const context = createTeamWeeklyReviewContext(audit(fourChannels()));
    const human = await page(context, "read_weekly_human_calls", 0, 1);
    expect(human.units[0].callHandling).toBe("human_and_unverified");
    expect(human.units[0].sources).toHaveLength(2);
    expect([...human.returnedEligibleIds].sort()).toEqual(["human", "unverified"]);
    for (const entry of human.units[0].sources) {
      expect(entry.speakerLabel).toContain("unverified speaker");
      expect(entry.source.speakerBasis).toBe("unverified");
      expect(entry.warnings.join(" ")).toContain("Recording not reviewed");
      expect(entry.warnings.join(" ")).toContain("no separate transcript-turn speaker IDs/times");
    }
    expect(human.units[0].warnings.join(" ")).toContain("selected evidence segments");
    const ai = await page(context, "read_weekly_ai_calls");
    expect(ai.units[0].callHandling).toBe("ai");
    expect(ai.units[0].sources[0].source.occurredAtUtc).toBe(null);
    expect(ai.units[0].sources[0].membership).toEqual({ atUtc: monday, basis: "observation_fallback", uncertain: true });
    expect(ai.units[0].sources[0].source.originalText).toBe("Customer: No limpiaron el baño.\nAI: Puedo ayudar.");
    expect(ai.units[0].sources[1]).toMatchObject({ candidateEligible: false, contextReason: "translation_variant" });
    expect(ai.returnedEligibleIds).toEqual(["ai"]);
    expect(ai.units[0].warnings.join(" ")).toContain("not fabricated or match-eligible");
  });

  it("never groups unrelated sessions/shared contacts/names or different email mailboxes/threads", async () => {
    const records = [source("s1"), source("s2", { sessionId: "session-2" }), source("standalone-1", { sessionId: null, providerId: null }), source("standalone-2", { sessionId: null, providerId: null }),
      ...["e1", "e2", "e3", "e4"].map((id, index) => source(id, { sourceKind: "email", threadId: index === 2 ? "other-thread" : "same-thread", sessionId: null,
        mailboxEmail: index === 1 ? "other-mailbox@example.test" : index === 3 ? null : "office@example.test", customerEmail: "shared@example.test", providerId: "same-message" }))];
    const context = createTeamWeeklyReviewContext(audit(records));
    expect((await page(context, "read_weekly_sms")).totalGroups).toBe(4);
    expect((await page(context, "read_weekly_emails")).totalGroups).toBe(4);
    expect(context.getCoverage().eligibleTotal).toBe(8);
    expect(context.getCoverage().completeDelivery).toBe(true);
  });

  it("retains equivalent and conflicting provider variants without evidence suppression", async () => {
    const context = createTeamWeeklyReviewContext(audit([
      source("original", { sessionId: null, providerId: "same" }),
      source("equivalent", { sessionId: null, providerId: "same", originalText: "Exact original original \n" }),
      source("conflict", { sessionId: null, providerId: "same", customerPhone: "+17035550000", originalText: "Different text" }),
      source("different-revision", { sessionId: null, providerId: "same", originalText: "Different text", revision: "b".repeat(64) }),
    ]));
    const result = await page(context, "read_weekly_sms");
    expect(result.totalGroups).toBe(1);
    expect(result.units[0].sources).toHaveLength(4);
    expect(new Set(result.units[0].sourceIds)).toEqual(new Set(["original", "equivalent", "conflict", "different-revision"]));
    expect(result.units[0].warnings.join(" ")).toContain("differing contact/session/routing provenance");
    expect(context.getCoverage()).toMatchObject({ eligibleTotal: 4, deliveredEligibleCount: 4, completeDelivery: true, pendingIds: [] });
  });

  it("keeps same-ID conflicting revisions in delivery requirements without hiding any original", async () => {
    const records = [source("shared-id", { sessionId: "first" }), source("shared-id", { sessionId: "second", revision: "b".repeat(64), originalText: "second source revision" })];
    const context = createTeamWeeklyReviewContext(audit(records));
    await page(context, "read_weekly_sms", 0, 1);
    expect(context.getCoverage()).toMatchObject({ eligibleTotal: 1, deliveredEligibleCount: 0, pendingIds: ["shared-id"], completeDelivery: false });
    await page(context, "read_weekly_sms", 1, 1);
    expect(context.getCoverage()).toMatchObject({ eligibleTotal: 1, deliveredEligibleCount: 1, completeDelivery: true });
    expect(context.getSources()).toEqual(records);
  });

  it("preserves transcripts larger than 64KB and never splits a session/thread at page boundaries", async () => {
    const full = "Customer: Exact long original ü\n".repeat(4000) + "END-OF-ORIGINAL";
    const context = createTeamWeeklyReviewContext(audit([
      source("long-call", { sourceKind: "human_call", sessionId: null, speakerBasis: "unverified", originalText: full }),
      ...Array.from({ length: 125 }, (_, index) => source(`sms-${index}`, { originalText: `original turn ${index}`, sessionId: "one-large-session" })),
    ]));
    expect(Buffer.byteLength(full)).toBeGreaterThan(65536);
    const result = await page(context, "read_weekly_human_calls", 0, 1);
    expect(result.units[0].sources[0].source.originalText).toBe(full);
    expect(result.units[0].sources[0].source.originalText?.endsWith("END-OF-ORIGINAL")).toBe(true);
    const sms = await page(context, "read_weekly_sms", 0, 1);
    expect(sms.units[0].sources).toHaveLength(125);
    expect(sms.exhausted).toBe(true);
  });

  it("pages every eligible source across all channels without a dataset cap and records actual returned IDs only", async () => {
    const records: TeamEvidence[] = [];
    for (const kind of ["sms", "human_call", "ai_call", "email"] as const) {
      for (let index = 0; index < 237; index++) records.push(source(`${kind}-${index}`, { sourceKind: kind,
        sessionId: kind === "sms" ? `session-${index}` : null, threadId: kind === "email" ? `thread-${index}` : null,
        mailboxEmail: kind === "email" ? "office@example.test" : null }));
    }
    const context = createTeamWeeklyReviewContext(audit(records));
    expect((await manifest(context)).delivery).toEqual({ eligibleTotal: 948, deliveredEligibleCount: 0, completeDelivery: false, pendingCount: 948 });
    expect(context.getCoverage().deliveredEligibleCount).toBe(0);
    const delivered = new Set<string>();
    for (const name of TEAM_WEEKLY_REVIEW_TOOL_NAMES.slice(1)) {
      let offset = 0;
      const offsets: number[] = [];
      for (;;) {
        offsets.push(offset);
        const result = await page(context, name, offset, 100);
        for (const id of result.returnedEligibleIds) delivered.add(id);
        if (result.exhausted) {
          expect(result.nextOffset).toBe(237);
          const terminal = await page(context, name, result.nextOffset, 100);
          expect(terminal).toMatchObject({ units: [], returnedEligibleIds: [], nextOffset: 237, exhausted: true });
          break;
        }
        expect(result.nextOffset).toBeGreaterThan(offset);
        offset = result.nextOffset;
      }
      expect(offsets).toEqual([0, 100, 200]);
    }
    expect(delivered).toEqual(new Set(records.map(record => record.id)));
    expect(context.getCoverage()).toMatchObject({ eligibleTotal: 948, deliveredEligibleCount: 948, pendingIds: [], completeDelivery: true, providerCoverageComplete: false });
    expect(Object.values(context.getCoverage().channels).every(channel => channel.exhausted && channel.deliveredGroups === 237)).toBe(true);
    expect((await manifest(context)).delivery.completeDelivery).toBe(true);
  });

  it("tool replays and overlapping reads are idempotent delivery sets, not extra reviewed counts", async () => {
    const context = createTeamWeeklyReviewContext(audit([source("a", { sessionId: "a" }), source("b", { sessionId: "b" })]));
    const first = await page(context, "read_weekly_sms", 0, 1, "same-event");
    expect(await page(context, "read_weekly_sms", 0, 1, "same-event")).toEqual(first);
    expect(await page(context, "read_weekly_sms", 0, 1, "different-event")).toEqual(first);
    expect(context.getCoverage()).toMatchObject({ eligibleTotal: 2, deliveredEligibleCount: 1, completeDelivery: false });
    expect(context.getCoverage().pendingIds).toHaveLength(1);
    await page(context, "read_weekly_sms", 0, 2);
    await page(context, "read_weekly_sms", 1, 1);
    expect(context.getCoverage()).toMatchObject({ deliveredEligibleCount: 2, completeDelivery: true });
  });

  it("keeps all-date gaps and snippets as compact coverage counters, never claimed weekly text or pending candidates", async () => {
    const records = [source("valid"), ...Array.from({ length: 27000 }, (_, index) => source(`gap-${index}`, { sourceKind: "email", store: "gmail_thread_meta",
      bodyBasis: "snippet", originalText: "Old snippet body MUST NOT BE READ", observedAtUtc: old, limitations: ["Original headers/body/date not available"] })),
      source("missing", { originalText: null, bodyBasis: "missing" }), source("undated", { occurredAtUtc: null, observedAtUtc: null, timeBasis: "unknown" }),
      source("old", { occurredAtUtc: old, observedAtUtc: monday }), source("old-observation", { occurredAtUtc: null, observedAtUtc: old, timeBasis: "stored" })];
    const context = createTeamWeeklyReviewContext(audit(records));
    const result = await manifest(context);
    expect(result).toMatchObject({ eligibleSources: 1, groups: 1, retainedWeeklySources: 1 });
    expect(result.coverageGaps.find(gap => gap.reason === "snippet_not_original")).toMatchObject({ count: 27000, sampleIds: ["gap-0", "gap-1", "gap-2", "gap-3", "gap-4"] });
    expect(JSON.stringify(result)).not.toContain("Old snippet body MUST NOT BE READ");
    expect(JSON.stringify(result).length).toBeLessThan(10000);
    expect(context.getCoverage().pendingIds).toEqual(["valid"]);
    expect((await page(context, "read_weekly_emails")).units).toEqual([]);
    expect(context.getRead().sources.evidence).toHaveLength(27005);
    await page(context, "read_weekly_sms");
    expect(context.getCoverage()).toMatchObject({ eligibleTotal: 1, completeDelivery: true, deliveredEligibleCount: 1 });
    expect(context.getCoverage().coverageGaps.length).toBeGreaterThan(0);
  });

  it("honestly includes observation fallback and received-time bodies while excluding old originals and exact end boundary", async () => {
    const records = [
      source("at-start", { occurredAtUtc: start }), source("before-start", { occurredAtUtc: "2026-11-15T04:59:59.999Z" }),
      source("at-end", { occurredAtUtc: capture }), source("old-original", { occurredAtUtc: old, observedAtUtc: monday }),
      source("received", { occurredAtUtc: null, observedAtUtc: sunday, timeBasis: "received" }),
      source("snapshot", { sourceKind: "email", occurredAtUtc: null, observedAtUtc: monday, timeBasis: "stored", bodyBasis: "snapshot", mailboxEmail: null,
        limitations: ["Original mailbox, headers and timestamp missing"] }),
      source("bad-calendar-time", { occurredAtUtc: "2026-02-30T12:00:00Z", observedAtUtc: monday }),
    ];
    const context = createTeamWeeklyReviewContext(audit(records));
    expect((await manifest(context)).eligibleSources).toBe(4);
    const sms = await page(context, "read_weekly_sms");
    expect(sms.returnedEligibleIds).toEqual(["at-start", "received", "bad-calendar-time"]);
    const received = sms.units[0].sources.find(entry => entry.source.id === "received")!;
    expect(received.membership).toEqual({ atUtc: sunday, basis: "received", uncertain: true });
    expect(received.source.occurredAtUtc).toBe(null);
    const malformed = sms.units[0].sources.find(entry => entry.source.id === "bad-calendar-time")!;
    expect(malformed.membership.basis).toBe("observation_fallback");
    expect(malformed.source.occurredAtUtc).toBe("2026-02-30T12:00:00Z");
    const email = await page(context, "read_weekly_emails");
    expect(email.units[0].sources[0].membership.basis).toBe("observation_fallback");
    expect(email.units[0].sources[0].source.mailboxEmail).toBe(null);
  });

  it("excludes known staff/assistant, internal and translation variants from candidate-needed IDs but keeps context", async () => {
    const context = createTeamWeeklyReviewContext(audit([
      source("outbound", { speakerBasis: "non_customer", originalText: "Staff offers refund" }),
      source("staff-hiring", { sourceKind: "ai_call", store: "call_log", speakerBasis: "non_customer", originalText: "Hiring/team administrative call" }),
      source("translation-only", { sourceKind: "ai_call", bodyBasis: "snapshot", limitations: ["Stored English translation is a non-original variant"] }),
    ]));
    expect(context.getCoverage()).toMatchObject({ eligibleTotal: 0, deliveredEligibleCount: 0, completeDelivery: true, pendingIds: [] });
    const result = await manifest(context);
    expect(result.contextOnlySources).toBe(3);
    expect(result.warnings.join(" ")).toContain("Hiring/employment and administrative discussions are not team-service complaints");
    expect((await page(context, "read_weekly_sms")).units[0].sources[0].candidateEligible).toBe(false);
    const calls = await page(context, "read_weekly_ai_calls");
    expect(calls.units.flatMap(unit => unit.sources).every(entry => !entry.candidateEligible)).toBe(true);
  });

  it("shows real provider/read/history limitations and correctly exhausts empty channels", async () => {
    const input = audit([], { collectionComplete: false, families: [
      { store: "voice_calls", scannedRows: 10, evidenceItems: 0, status: "unavailable", exhausted: false, limitations: ["DB_SCHEMA"] },
      { store: "inbound_sms", scannedRows: 0, evidenceItems: 0, status: "read", exhausted: true, limitations: [] },
    ], limitations: ["Retained reads are not transactional"] });
    input.history.complete = false; input.history.limitations.push("Visit history missing");
    const context = createTeamWeeklyReviewContext(input);
    const result = await manifest(context);
    expect(result).toMatchObject({ eligibleSources: 0, groups: 0, collectionComplete: false, historyComplete: false, providerCoverageComplete: false });
    expect(result.warnings.join(" ")).toContain("voice_calls");
    expect(result.warnings.join(" ")).toContain("DB_SCHEMA");
    expect(result.warnings.join(" ")).toContain("Visit history missing");
    for (const name of TEAM_WEEKLY_REVIEW_TOOL_NAMES.slice(1)) expect(await page(context, name)).toMatchObject({ totalGroups: 0, units: [], nextOffset: 0, exhausted: true });
    expect(Object.values(context.getCoverage().channels).every(channel => channel.exhausted)).toBe(true);
    expect(context.getCoverage().completeDelivery).toBe(true);
  });

  it("cannot mutate input, snapshot, returned tools, pages, read or delivery state through exposed outputs", async () => {
    const input = audit(fourChannels());
    const before = structuredClone(input);
    const context = createTeamWeeklyReviewContext(input);
    expect(input).toEqual(before);
    expect(Object.isFrozen(input)).toBe(false);
    input.sources.evidence[0].originalText = "Changed after snapshot";
    input.sources.window.weekStart = "2026-01-04";
    expect(context.read).toEqual(before);
    expect(context.getRead()).toEqual(before);
    const one = context.tools, two = context.tools;
    expect(one).not.toBe(two);
    expect(() => { one[0].name = "publish"; }).toThrow();
    expect(() => { (one[1].input_schema.properties as Record<string, unknown>).publish = {}; }).toThrow();
    expect(context.tools[0].name).toBe("get_weekly_review_manifest");
    const result = await page(context, "read_weekly_sms");
    expect(() => { result.units[0].sources[0].source.originalText = "forged"; }).toThrow();
    expect(() => { result.returnedEligibleIds.push("forged"); }).toThrow();
    expect(() => { context.read.sources.evidence[0].limitations.push("forged"); }).toThrow();
    const coverage = context.getCoverage();
    expect(() => { coverage.pendingIds.length = 0; }).toThrow();
    expect(() => { context.getSources()[0].revision = "b".repeat(64); }).toThrow();
    expect(context.getRead()).toEqual(before);
    expect(context.getCoverage().pendingIds.length).toBeGreaterThan(0);
  });

  it.each([
    null, [], "input", 1, {}, { offset: 0 }, { limit: 1 }, { offset: "0", limit: 1 }, { offset: 0, limit: "1" },
    { offset: -1, limit: 1 }, { offset: 0.1, limit: 1 }, { offset: NaN, limit: 1 }, { offset: Infinity, limit: 1 },
    { offset: Number.MAX_SAFE_INTEGER + 1, limit: 1 }, { offset: 0, limit: 0 }, { offset: 0, limit: 101 }, { offset: 0, limit: -1 },
    { offset: 0, limit: 1.1 }, { offset: 0, limit: 1, publish: true }, { offset: 0, limit: 1, evidenceId: "forged" },
    { offset: 0, limit: 1, reviewedIds: ["forged"] }, { offset: 0, limit: 1, send: true },
    Object.create({ offset: 0, limit: 1 }), { offset: 0, limit: 1, [Symbol("extra")]: true },
  ])("rejects malformed or extra paging input %# without changing coverage", async input => {
    const context = createTeamWeeklyReviewContext(audit([source("pending")]));
    await expect(context.callTool("read_weekly_sms", input as Record<string, unknown>, "event")).rejects.toThrow("WEEKLY_REVIEW_INVALID_INPUT");
    expect(context.getCoverage().deliveredEligibleCount).toBe(0);
  });

  it("rejects manifest fields, getters, inherited authority and all unknown/native/mutation tool names", async () => {
    const context = createTeamWeeklyReviewContext(audit([source("pending")]));
    for (const input of [{ offset: 0 }, { publish: true }, { weekStart: "2026-11-15" }, null, []])
      await expect(context.callTool("get_weekly_review_manifest", input as Record<string, unknown>, "event")).rejects.toThrow("WEEKLY_REVIEW_INVALID_INPUT");
    const getter = vi.fn(() => 0);
    const input = { get offset() { return getter(); }, limit: 1 };
    await expect(context.callTool("read_weekly_sms", input, "event")).rejects.toThrow("WEEKLY_REVIEW_INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled();
    for (const name of ["bash", "read", "publish", "send_sms", "get_customer_context", "read_weekly_emails ", "__proto__", "constructor", "toString", "getCoverage"])
      await expect(context.callTool(name, {}, "event")).rejects.toThrow("WEEKLY_REVIEW_UNKNOWN_TOOL");
    const terminal = await page(context, "read_weekly_sms", Number.MAX_SAFE_INTEGER, 100);
    expect(terminal).toMatchObject({ units: [], exhausted: true, nextOffset: 1 });
    expect(context.getCoverage().deliveredEligibleCount).toBe(0);
  });

  it("has only erased type imports and does not touch live runtime capabilities even during factory/tool reads", async () => {
    const implementation = readFileSync(new URL("./teamWeeklyReviewContext.ts", import.meta.url), "utf8");
    const imports = implementation.split("\n").filter(line => /^import\s/.test(line));
    expect(imports).toHaveLength(3);
    expect(imports.every(line => line.startsWith("import type "))).toBe(true);
    expect(implementation).not.toMatch(/import\s*\(|require\s*\(|\bfetch\s*\(|process\.env|setInterval\s*\(|setTimeout\s*\(|new Date\(\)|\.select\s*\(|\.execute\s*\(/);
    expect(implementation).not.toContain(["cleaner", "jobs"].join("_"));
    expect(implementation).not.toContain(["cleaner", "Jobs"].join(""));
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("LIVE_IO_FORBIDDEN"); });
    try {
      const context = createTeamWeeklyReviewContext(audit(fourChannels()));
      await manifest(context);
      for (const name of TEAM_WEEKLY_REVIEW_TOOL_NAMES.slice(1)) await page(context, name);
      context.getRead(); context.getSources(); context.getCoverage();
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});
