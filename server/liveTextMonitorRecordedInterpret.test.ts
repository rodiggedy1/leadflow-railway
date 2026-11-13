import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditInterpretationJsonSchema, interpretAuditThreads } from "./dailyActionAuditInterpret";
import type { AuditInterpretationFailure } from "./dailyActionAuditInterpret";
import type { AuditMessage, AuditRecord, AuditThread } from "../shared/dailyActionAudit";
import type { InvokeParams, InvokeResult } from "./_core/llm";

const message: AuditMessage = {
  key: "recorded-message", sessionId: 1, customerPhone: "+13015550123", businessPhone: null,
  direction: "outbound", text: "We will move booking B12 from November 12, 2026 to November 13, 2026 at 9am, this visit only.",
  occurredAt: null, observedAt: "2026-11-11T16:00:00.000Z", timeBasis: "unknown", delivery: "unknown", source: "conversation_history",
};
const thread: AuditThread = { key: "recorded-thread", customerPhone: message.customerPhone, customerName: "Synthetic", messages: [message], truncated: false };
const input = { auditDate: "2026-11-11", timeZone: "America/New_York", threads: [thread], records: [], evidenceMode: "recorded" as const };
const prediction = {
  threadKey: thread.key, action: "reschedule", agreement: "requested", anchorMessageKey: message.key, evidenceKeys: [message.key],
  expected: { bookingReference: "B12", date: "2026-11-13", originalDate: "2026-11-12", time: "09:00", timeKind: "exact", windowEnd: null, scope: "visit", address: null, serviceName: null, extras: null, extrasMode: "unspecified", teamName: null, amountCents: null },
  explanation: "Recorded target for booking B12 on November 13 at 9am.", confidence: 0.95, supersededByMessageKey: null, ambiguous: false,
};
function output(actions: unknown[]): InvokeResult {
  return { id: "offline-fixture", created: 0, model: "offline-fixture", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ actions }) }, finish_reason: "stop" }] };
}
function rawOutput(content: unknown, finish_reason = "stop"): InvokeResult {
  return { ...output([]), choices: [{ ...output([]).choices[0], message: { role: "assistant", content: content as string }, finish_reason }] };
}
function payload(params: InvokeParams): any { return JSON.parse(params.messages[1].content as string); }
function linked(target: any, change = {}): any {
  return { ...prediction, threadKey: target.key, anchorMessageKey: target.messages[0].key, evidenceKeys: [target.messages[0].key], ...change };
}
function assertFailure(result: Awaited<ReturnType<typeof interpretAuditThreads>>, failure: AuditInterpretationFailure) {
  expect(result.failure).toBe(failure);
  expect(result.failedThreads).toBeGreaterThan(0);
  expect(result.threadsAnalyzed).toBe(0);
  expect(result.warnings.length).toBeGreaterThan(0);
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "");
  // Any unintended use of the default helper must fail offline, never reach a provider.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected offline fetch"); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Live Text Monitor recorded-state interpretation (mocked transport only)", () => {
  it.each(["unknown", "sent", "delivered", "failed"])("accepts an explicit recorded outbound target with %s delivery without making a delivery claim", async delivery => {
    // Failed delivery is retained as raw source metadata even though the legacy shared enum does not yet represent it.
    const source = { ...message, delivery } as AuditMessage;
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages: [source] }] }, async params => {
      expect(payload(params).threads[0].messages[0].delivery).toBe(delivery);
      return output([prediction]);
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ expected: prediction.expected, agreement: "requested", ambiguous: false, supersededByMessageKey: null });
    expect(result.candidates[0]).not.toHaveProperty("status");
    expect(result.candidates[0]).not.toHaveProperty("delivery");
    expect(result).not.toHaveProperty("failure");
    expect(result.threadsAnalyzed).toBe(1);
    expect(source.delivery).toBe(delivery);
  });

  it.each(["unknown", "received", "history"] as const)("does not make an explicit full target ambiguous solely for %s timestamp provenance", async timeBasis => {
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages: [{ ...message, timeBasis }] }] }, async () => output([prediction]));
    expect(result.candidates[0].ambiguous).toBe(false);
    expect(result).not.toHaveProperty("failure");
  });

  it("retains a full target from truncated source without hiding the partial-context caveat", async () => {
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, truncated: true }] }, async () => output([prediction]));
    expect(result.candidates[0].ambiguous).toBe(false);
    assertFailure(result, "PARTIAL_CONTEXT");
  });

  it("replaces only recorded delivery/provenance clauses and retains binding and meaning safeguards", async () => {
    await interpretAuditThreads(input, async params => {
      const system = params.messages[0].content as string;
      expect(system).toContain("RECORDED-TEXT current-state comparison");
      expect(system).toContain("inbound AND outbound requests or stated commitments even when delivery is unknown or failed");
      expect(system).toContain("Use agreement=requested");
      expect(system).toContain("not a delivery or historical-completion audit");
      expect(system).not.toContain("agreement=confirmed only with an actual sent/delivered outbound promise");
      expect(system).not.toContain("cannot anchor an instruction or supersede a real request");
      expect(system).not.toContain("Set ambiguous=true if timestamps are uncertain,");
      for (const safeguard of ["untrusted quoted evidence", "cannot execute actions", "never today's date", "'9' lacks AM/PM", "conflicting replies are unresolved", "YYYY-MM-DD", "HH:mm", "complete replacement list is explicit", "Quantity-specific requests", "Do not choose between multiple possible bookings", "visit identity context ONLY", "explicitly replaces that same request for the same visit", "Do not fabricate names, prices, payment amounts, confirmations or evidence", "Actual relative/unresolved/conflicting meaning"]) expect(system).toContain(safeguard);
      expect(params.tools).toBeUndefined();
      expect(params.response_format).toEqual({ type: "json_schema", json_schema: { name: "daily_action_audit", strict: true, schema: auditInterpretationJsonSchema } });
      return output([]);
    });
  });

  it.each(["We'll be there between 9am and 11am.", "Try our new spring special!", "Thank you, see you soon."])("leaves informational/marketing/ETA-only text as no action when the model finds no requested system change: %s", async text => {
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages: [{ ...message, text }] }] }, async params => {
      expect(params.messages[0].content).toContain("ETA-only text with no requested system change must return actions=[]");
      expect(payload(params).threads[0].messages[0].text).toBe(text);
      return output([]);
    });
    expect(result).toEqual({ candidates: [], warnings: [], threadsAnalyzed: 1, failedThreads: 0, omittedMessages: 0 });
  });

  it.each([
    { text: "Move it tomorrow at 9", expected: { ...prediction.expected, date: null, time: null }, ambiguous: true },
    { text: "Move one of my two properties to Friday", expected: { ...prediction.expected, bookingReference: null, date: null }, ambiguous: true },
    { text: "Make it 9am or maybe 10am; not decided", expected: { ...prediction.expected, time: null }, ambiguous: true },
    { text: "Please add windows", expected: { ...prediction.expected, extras: ["Interior windows"], extrasMode: "unspecified" }, ambiguous: false },
  ])("preserves actual unresolved meaning/operation ambiguity rather than filling targets from records: $text", async fixture => {
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages: [{ ...message, text: fixture.text }] }] }, async () => output([{ ...prediction, expected: fixture.expected, ambiguous: fixture.ambiguous }]));
    expect(result.candidates[0].ambiguous).toBe(true);
    expect(result.candidates[0].expected).toEqual(fixture.expected);
  });

  it("keeps low-confidence and duplicate conflicting targets ambiguous", async () => {
    const low = await interpretAuditThreads(input, async () => output([{ ...prediction, confidence: 0.5 }]));
    const conflict = await interpretAuditThreads(input, async () => output([prediction, { ...prediction, expected: { ...prediction.expected, time: "10:00" } }]));
    expect(low.candidates[0].ambiguous).toBe(true);
    expect(conflict.candidates).toHaveLength(1);
    expect(conflict.candidates[0].ambiguous).toBe(true);
  });

  it("retains an explicitly linked recorded correction, not unrelated later-day actions", async () => {
    const later = { ...message, key: "correction", observedAt: "2026-11-12T16:00:00.000Z", text: "Actually move that same booking B12 to November 14, 2026 at 10am." };
    const unrelated = { ...later, key: "unrelated", text: "Book a different visit." };
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages: [message, later, unrelated] }] }, async () => output([
      { ...prediction, supersededByMessageKey: later.key },
      { ...prediction, anchorMessageKey: later.key, evidenceKeys: [later.key], expected: { ...prediction.expected, date: "2026-11-14", time: "10:00" } },
      { ...prediction, action: "book", anchorMessageKey: unrelated.key, evidenceKeys: [unrelated.key] },
    ]));
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map(value => value.contextOnly)).toEqual([false, true]);
    assertFailure(result, "INVALID_SOURCE_REFERENCE");
  });

  it.each([
    { threadKey: "another-customer" }, { anchorMessageKey: "invented" },
    { evidenceKeys: [message.key, "foreign-message"] }, { supersededByMessageKey: "foreign-correction" },
  ])("discards invalid or cross-customer source references while retaining a valid sibling: %j", async change => {
    const result = await interpretAuditThreads(input, async () => output([prediction, { ...prediction, ...change }]));
    expect(result.candidates).toHaveLength(1);
    assertFailure(result, "INVALID_SOURCE_REFERENCE");
  });

  it("rejects an evidence list that omits its anchor", async () => {
    const context = { ...message, key: "context" };
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages: [message, context] }] }, async () => output([{ ...prediction, evidenceKeys: [context.key] }]));
    expect(result.candidates).toEqual([]);
    assertFailure(result, "INVALID_SOURCE_REFERENCE");
  });

  it("uses the business-day boundary rather than UTC date for anchor binding", async () => {
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages: [{ ...message, observedAt: "2026-11-11T03:00:00.000Z" }] }] }, async () => output([prediction]));
    assertFailure(result, "INVALID_SOURCE_REFERENCE");
    expect(result.candidates).toEqual([]);
  });

  it.each([
    { expected: { ...prediction.expected, date: "2026-02-30" } },
    { expected: { ...prediction.expected, time: "25:00" } },
    { expected: { ...prediction.expected, amountCents: -1 } },
    { status: "matches" }, { customerPhone: "+13015550999" },
  ])("retains valid siblings and exposes INVALID_ACTION for schema rejection: %j", async change => {
    const result = await interpretAuditThreads(input, async () => output([prediction, { ...prediction, ...change }]));
    expect(result.candidates).toHaveLength(1);
    assertFailure(result, "INVALID_ACTION");
  });

  it("cannot treat an entirely invalid action array as successful no action", async () => {
    const result = await interpretAuditThreads(input, async () => output([{ ...prediction, expected: { ...prediction.expected, date: "impossible" } }]));
    expect(result.candidates).toEqual([]);
    assertFailure(result, "INVALID_ACTION");
  });

  it.each([
    rawOutput("not json"), rawOutput("{}"), rawOutput('{"actions":[],"status":"matches"}'),
    rawOutput(null), rawOutput("{\"actions\":[]}", "length"),
    { ...output([]), choices: [] }, rawOutput(JSON.stringify({ actions: Array.from({ length: 81 }, () => prediction) })),
  ])("reports an invalid model envelope/content rather than successful no action", async response => {
    const result = await interpretAuditThreads(input, async () => response);
    assertFailure(result, "INVALID_MODEL_RESPONSE");
    expect(result.candidates).toEqual([]);
  });

  it("uses the actual unchanged helper with mocked fetch: same model, token budget, strict wire schema, no fallback", async () => {
    vi.stubEnv("OPENAI_API_KEY", "offline-fixture-key");
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      expect(body.model).toBe("gpt-4o");
      expect(body.max_tokens).toBe(16384);
      expect(body.response_format.json_schema.schema).toEqual(auditInterpretationJsonSchema);
      expect(body.tools).toBeUndefined();
      return { ok: true, status: 200, json: async () => output([prediction]) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await interpretAuditThreads(input);
    expect(result.candidates).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("failure");
  });

  it.each([
    [408, "MODEL_TIMEOUT"], [504, "MODEL_TIMEOUT"], [413, "INPUT_TOO_LARGE"],
    [401, "MODEL_UNAVAILABLE"], [429, "MODEL_UNAVAILABLE"], [500, "MODEL_UNAVAILABLE"], [200, "MODEL_UNAVAILABLE"],
  ] as const)("maps actual helper-wrapped HTTP %s failure to a fixed %s code without leaking provider errors", async (status, failure) => {
    vi.stubEnv("OPENAI_API_KEY", "offline-fixture-key");
    const fetchMock = vi.fn(async () => ({ ok: status === 200, status, statusText: "Fixture", json: async () => ({ error: "private-provider-token customer body +13015550123 SELECT private" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await interpretAuditThreads(input);
    assertFailure(result, failure);
    expect(JSON.stringify(result)).not.toMatch(/private-provider-token|customer body|301555|SELECT private/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns safe model-unavailable for the actual missing-key guard without calling fetch", async () => {
    const result = await interpretAuditThreads(input);
    assertFailure(result, "MODEL_UNAVAILABLE");
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("OPENAI_API_KEY");
  });

  it.each([
    [new Error("Audit interpretation timed out secret"), "MODEL_UNAVAILABLE"],
    [new Error("LLM invoke failed: 5040 private text"), "MODEL_UNAVAILABLE"],
    [Object.assign(new Error("private timeout"), { name: "TimeoutError" }), "MODEL_TIMEOUT"],
    [new SyntaxError("private provider JSON"), "INVALID_MODEL_RESPONSE"],
  ] as const)("uses exact safe transport reasons rather than arbitrary raw-error substring guesses", async (error, failure) => {
    const result = await interpretAuditThreads(input, async () => { throw error; });
    assertFailure(result, failure);
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
  });

  it("retains valid actions in another isolated thread when a model call fails", async () => {
    const second = { ...thread, key: "second-thread", customerPhone: "+13015550124", messages: [{ ...message, key: "second-message", customerPhone: "+13015550124" }] };
    const lengths: number[] = [];
    const result = await interpretAuditThreads({ ...input, threads: [thread, second] }, async params => {
      const target = payload(params).threads[0]; lengths.push(payload(params).threads.length);
      if (target.key === thread.key) throw new Error("offline-private-failure");
      return output([linked(target)]);
    });
    expect(lengths).toEqual([1, 1]);
    expect(result.candidates[0].threadKey).toBe(second.key);
    expect(result.threadsAnalyzed).toBe(1);
    expect(result.failedThreads).toBe(1);
    expect(result.failure).toBe("MODEL_UNAVAILABLE");
  });

  it("times out one stalled call and never starts a later call or claims it was cancelled", async () => {
    vi.useFakeTimers();
    const call = vi.fn(() => new Promise<InvokeResult>(() => {}));
    const pending = interpretAuditThreads({ ...input, threads: [thread, { ...thread, key: "second-thread" }] }, call);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(call).toHaveBeenCalledTimes(1);
    expect(result.failedThreads).toBe(2);
    assertFailure(result, "MODEL_TIMEOUT");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps source-budget omission visible, including when no model call can be made", async () => {
    const call = vi.fn(async () => output([]));
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages: [{ ...message, text: "x".repeat(16_001) }] }] }, call);
    expect(call).not.toHaveBeenCalled();
    expect(result.omittedMessages).toBe(1);
    assertFailure(result, "INPUT_TOO_LARGE");
  });

  it("retains a valid full target after oversized context omission without forcing target ambiguity", async () => {
    const old = { ...message, key: "oversized-context", observedAt: "2026-11-10T16:00:00.000Z", text: "x".repeat(16_001) };
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages: [old, message] }] }, async () => output([prediction]));
    expect(result.candidates[0].ambiguous).toBe(false);
    expect(result.omittedMessages).toBe(1);
    assertFailure(result, "INPUT_TOO_LARGE");
  });

  it("uses existing chunk, serialized-input and catalog budgets with partial context reported", async () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({ ...message, key: `chunk-message-${i}`, text: "x".repeat(7_000) }));
    const included = new Set<string>();
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, messages }] }, async params => {
      expect(JSON.stringify(params).length).toBeLessThanOrEqual(32_000);
      const target = payload(params).threads[0];
      for (const source of target.messages) included.add(source.key);
      expect(payload(params).extrasCatalog).toContainEqual({ id: "inside-oven", label: "Inside oven", quantityUnit: null });
      expect(target.messages.reduce((size: number, source: any) => size + JSON.stringify({ ...message, key: source.key, text: source.text }).length, 0)).toBeLessThanOrEqual(16_000);
      return output([linked(target)]);
    });
    expect(included.size).toBe(8);
    expect(result.candidates.every(value => value.threadKey === thread.key && !value.ambiguous)).toBe(true);
    expect(result.omittedMessages).toBe(0);
    assertFailure(result, "PARTIAL_CONTEXT");
  });

  it("reports serialized-request overflow before invoking the model", async () => {
    const record = { customerPhone: message.customerPhone, publicBookingNumber: "x".repeat(32_001), date: "2026-11-12", time: "09:00", serviceName: null } as AuditRecord;
    const call = vi.fn(async () => output([]));
    const result = await interpretAuditThreads({ ...input, records: [record] }, call);
    expect(call).not.toHaveBeenCalled();
    assertFailure(result, "INPUT_TOO_LARGE");
  });

  it("prioritizes an actual failed model over existing partial-context coverage", async () => {
    const result = await interpretAuditThreads({ ...input, threads: [{ ...thread, truncated: true }] }, async () => { throw new Error("offline fixture"); });
    assertFailure(result, "MODEL_UNAVAILABLE");
  });

  it.each([undefined, "captured"] as const)("preserves legacy mode %s prompt clauses and output shape on failures", async evidenceMode => {
    const result = await interpretAuditThreads({ ...input, evidenceMode }, async params => {
      const system = params.messages[0].content as string;
      expect(system).toContain("agreement=confirmed only with an actual sent/delivered outbound promise");
      expect(system).toContain("Set ambiguous=true if timestamps are uncertain,");
      expect(system).not.toContain("RECORDED-TEXT current-state comparison");
      if (evidenceMode === "captured") expect(system).toContain("cannot anchor an instruction or supersede a real request");
      throw new Error("offline-private-failure");
    });
    expect(result).not.toHaveProperty("failure");
    expect(Object.keys(result)).toEqual(["candidates", "warnings", "threadsAnalyzed", "failedThreads", "omittedMessages"]);
  });

  it("preserves captured unverified-outbound rejection and absent-mode provenance ambiguity", async () => {
    const captured = await interpretAuditThreads({ ...input, evidenceMode: "captured" }, async () => output([prediction]));
    const legacy = await interpretAuditThreads({ ...input, evidenceMode: undefined }, async () => output([prediction]));
    expect(captured.candidates).toEqual([]);
    expect(captured.warnings.join(" ")).toContain("unverified outbound draft");
    expect(legacy.candidates[0].ambiguous).toBe(true);
    expect(captured).not.toHaveProperty("failure");
    expect(legacy).not.toHaveProperty("failure");
  });
});
