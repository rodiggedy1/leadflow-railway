import { describe, expect, it, vi } from "vitest";
import { createAnalysisRequest, createRequestInterpreter } from "./interpret";
import { createModelMessageKeys, keyedActionSchema, keyedOutputSchema, originalProofUnits, type KeyedAction } from "./modelMessageKeys";
import type { AnalysisRequest, AuthorizedScope, Expectation, InstinctInvokeParams, InstinctInvokeResult, ModelCallable, SourceContext, StoredEvidence } from "../../shared/instinct";

const now = "2026-11-13T18:00:00.000Z", fingerprint = "a".repeat(64);
const scope: AuthorizedScope = { installationScope: "fixture", sourceAccountKey: "account", authorizationVersion: "v1", actor: { staffId: "1", role: "admin" } };
function request(texts = ["Move my appointment to 2026-11-16 at 9 AM"]): AnalysisRequest {
  const evidence: StoredEvidence[] = texts.map((text, index) => ({ ref: { store: "conversation_sessions", sourceKind: "sms", sourceId: `message:${index}`, providerId: null, sourceRevision: "r1", contextFingerprint: fingerprint, sourceAccountKey: "account", sessionId: "7", threadId: null, occurredAtUtc: now, observedAtUtc: now, timeBasis: "history", handlingEvidence: null },
    originalText: text, originalTurns: [], translatedText: null, participants: { from: "+13015550123", to: ["+13015550456"], cc: [], replyTo: null, businessLine: "+13015550456", mailbox: null }, direction: "inbound", contentBasis: "original_full", availability: "complete", limitations: [] }));
  const context: SourceContext = { evidence, manifest: { contextId: "context:fixture", revision: "r1", contextFingerprint: fingerprint, sourceAccountKey: "account", entries: evidence.map((item, ordinal) => ({ ref: item.ref, ordinal, originalTextLength: item.originalText!.length, turnCount: 0, availability: "complete" })), complete: true, continuation: null, capturedAtUtc: now, limitations: [] } };
  return createAnalysisRequest(context);
}
const expected: Expectation = { bookingReference: null, date: "2026-11-16", originalDate: null, time: "09:00", timeKind: "exact", windowEnd: null, timeZone: "America/New_York", scope: "visit", address: null, serviceName: null, extras: null, extrasMode: "unspecified", teamName: null, amountCents: null, notes: null, notesDestination: "unspecified" };
interface Message { key: string; text: string; originalRange: { evidenceIndex: number; start: number; end: number } }
interface Child { actions: KeyedAction[]; contextFacts: Array<{ text: string; evidenceKeys: string[] }>; leaves: string[] }
interface Payload { threadKey: string; messages: Message[]; context?: unknown; originals?: Array<{ originalText: string; originalRange: Message["originalRange"] }>; segmentId?: string; orderedChildren?: Child[]; expectedSegments?: string[] }
function payload(params: InstinctInvokeParams): Payload { return JSON.parse(String(params.messages[1].content)); }
function action(data: Pick<Payload, "threadKey" | "messages">, index = 0, change: Partial<KeyedAction> = {}): KeyedAction { return { threadKey: data.threadKey, anchorMessageKey: data.messages[index].key, evidenceKeys: [data.messages[index].key], supersededByMessageKey: null, action: "reschedule", agreement: "requested", expected, explanation: "Recorded requested schedule.", confidence: 0.95, ambiguous: false, missingParameters: [], ...change }; }
function reply(value: unknown): InstinctInvokeResult { return { id: "offline", created: 0, model: "offline", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(value) }, finish_reason: "stop" }] }; }
async function extract(make: (data: Payload) => unknown, req = request()) { const model = vi.fn<ModelCallable>(async params => reply(make(payload(params)))); const receipt = await createRequestInterpreter({ model }).interpret(scope, req); return { model, receipt }; }

describe("server-owned SMS model message keys", () => {
  it("requests only the strict keyed action schema and binds actionable/no-action originals", async () => {
    const { model, receipt } = await extract(data => ({ actions: [action(data)] }));
    expect(receipt).toMatchObject({ status: "complete", failure: null }); expect(receipt.actions[0].expected.time).toBe("09:00");
    const format = model.mock.calls[0][0].response_format!; expect(format.type).toBe("json_schema");
    const schema = JSON.stringify(format); for (const key of ["threadKey", "anchorMessageKey", "evidenceKeys", "supersededByMessageKey"]) expect(schema).toContain(key);
    for (const key of ["exactQuote", "anchorEvidenceIndex", '"start"', '"end"', "supersededByEvidenceIndex"]) expect(schema).not.toContain(key);
    expect(keyedOutputSchema.safeParse({ actions: [action(payload(model.mock.calls[0][0]))] }).success).toBe(true);
    const empty = await extract(() => ({ actions: [] }), request(["Thanks! Cleaner ETA is 10 minutes."]));
    expect(empty.receipt).toMatchObject({ status: "complete", actions: [], failure: null });
  });
  it("calculates emoji UTF-16 citations server-side and keeps distinct requests in one body separate", async () => {
    const text = "Hello 🧼. Move my appointment to 2026-11-16 at 9 AM. Move my appointment to 2026-11-17 at 11 AM.";
    const { receipt } = await extract(data => ({ actions: [action(data, 1), action(data, 2, { expected: { ...expected, date: "2026-11-17", time: "11:00" } })] }), request([text]));
    expect(receipt.status).toBe("complete"); expect(receipt.actions).toHaveLength(2);
    expect(receipt.actions[0].citations[0].start).toBe(text.indexOf("Move")); expect(receipt.actions[0].citations[0].exactQuote).toBe("Move my appointment to 2026-11-16 at 9 AM. ");
    expect(receipt.actions[0].id).not.toBe(receipt.actions[1].id);
  });
  it("can cite multiple adjacent proof units without expanding either original range", async () => {
    const text = "Move my appointment. To 2026-11-16 at 9 AM.";
    const { receipt } = await extract(data => ({ actions: [action(data, 0, { evidenceKeys: data.messages.map(message => message.key) })] }), request([text]));
    expect(receipt.status).toBe("complete"); expect(receipt.actions[0].citations.map(citation => citation.exactQuote).join("")).toBe(text);
    expect(receipt.actions[0].citations).toHaveLength(2);
  });
  it.each(["Gate 2841. Use side door.", "Gate 2841.\nUse side door."])("preserves exact adjacent note proof: %s", async notes => {
    const text = `Please set cleaner instructions: ${notes}`;
    const req = request([text]);
    req.context.evidence[0].originalTurns = [{ turnId: "customer:1", speaker: "customer", role: "customer", text, start: 0, end: text.length, occurredAtUtc: now, timeBasis: "turn" }];
    req.context.manifest.entries[0].turnCount = 1;
    const { receipt } = await extract(data => ({ actions: [action(data, 0, { action: "access_notes", expected: { ...expected, date: null, time: null, timeKind: "unspecified", scope: "unspecified", notes, notesDestination: "cleaner_instructions" }, evidenceKeys: data.messages.map(message => message.key) })] }), req);
    expect(receipt.status).not.toBe("unavailable"); expect(receipt.failure).not.toBe("INVALID_MODEL_RESPONSE");
    expect(receipt.actions[0].expected.notes).toBe(notes);
    expect(receipt.actions[0].citations.map(citation => citation.exactQuote).join("")).toBe(text);
    expect(receipt.actions[0].citations).toHaveLength(notes.includes("\n") ? 3 : 2);
  });
  it.each(["gap", "other source", "other turn"])("does not combine note proof across %s", async defect => {
    const text = defect === "gap" ? "Please set cleaner instructions: Gate 2841. OMITTED. Use side door." : "Please set cleaner instructions: Gate 2841. Use side door.";
    const req = request(defect === "other source" ? ["Please set cleaner instructions: Gate 2841. ", "Use side door."] : [text]);
    if (defect === "other turn") {
      const boundary = text.indexOf("Use side door.");
      req.context.evidence[0].originalTurns = [{ turnId: "customer:1", speaker: "customer", role: "customer", text: text.slice(0, boundary), start: 0, end: boundary, occurredAtUtc: now, timeBasis: "turn" }, { turnId: "staff:1", speaker: "staff", role: "staff", text: text.slice(boundary), start: boundary, end: text.length, occurredAtUtc: now, timeBasis: "turn" }];
      req.context.manifest.entries[0].turnCount = 2;
    }
    const { receipt } = await extract(data => ({ actions: [action(data, 0, { action: "access_notes", expected: { ...expected, date: null, time: null, timeKind: "unspecified", scope: "unspecified", notes: "Gate 2841. Use side door.", notesDestination: "cleaner_instructions" }, evidenceKeys: data.messages.filter(message => !message.text.startsWith("OMITTED")).map(message => message.key) })] }), req);
    expect(receipt).toMatchObject({ status: "unavailable", failure: "INVALID_MODEL_RESPONSE", actions: [] });
    expect(receipt.limitations).toContain("Interpretation diagnostic: invalid_target_grounding.");
  });
  it.each(["invented evidence", "foreign thread", "unknown anchor", "omitted anchor", "missing correction", "invented correction"])("rejects %s rather than claiming complete No-action", async defect => {
    const { receipt } = await extract(data => {
      const value = action(data);
      if (defect === "invented evidence") value.evidenceKeys.push("message:invented");
      if (defect === "foreign thread") value.threadKey = "thread:foreign";
      if (defect === "unknown anchor") value.anchorMessageKey = "message:invented";
      if (defect === "omitted anchor") value.evidenceKeys = [data.messages[1].key];
      if (defect === "missing correction") value.supersededByMessageKey = data.messages[1].key;
      if (defect === "invented correction") { value.supersededByMessageKey = "message:invented"; value.evidenceKeys.push("message:invented"); }
      return { actions: [value] };
    }, request(["Move my appointment to 2026-11-16 at 9 AM", "Actually 11 AM"]));
    expect(receipt).toMatchObject({ status: "unavailable", failure: "INVALID_SOURCE_REFERENCE", actions: [] });
    expect(receipt.limitations).toContain("Interpretation diagnostic: invalid_source_key.");
  });
  it("stale context revision and foreign range keys have no registry membership", () => {
    const req = request(["First sentence. Next sentence."]); const ranges = [{ evidenceIndex: 0, start: 0, end: req.context.evidence[0].originalText!.length }];
    const first = createModelMessageKeys(req, scope, ranges);
    const changed = structuredClone(req); changed.context.manifest.revision = "r2";
    const stale = createModelMessageKeys(changed, scope, ranges);
    expect(() => stale.decodeAction(action(first))).toThrow("INVALID_SOURCE_REFERENCE");
    const segment = createModelMessageKeys(req, scope, [{ ...ranges[0], start: 16 }]);
    expect(() => segment.decodeAction(action(first))).toThrow("INVALID_SOURCE_REFERENCE");
    expect(segment.messages.every(message => message.originalRange.start >= 16)).toBe(true);
  });
  it("binds an included ordered correction key without dropping either request", async () => {
    const req = request(["Move my appointment to 2026-11-16 at 9 AM", "Actually move my appointment 2026-11-16 to 11 AM instead"]);
    const item = req.context.evidence[1]; item.ref = { ...item.ref, occurredAtUtc: "2026-11-13T18:01:00.000Z" }; req.context.manifest.entries[1].ref = item.ref;
    const { receipt } = await extract(data => ({ actions: [action(data, 0, { evidenceKeys: data.messages.map(message => message.key), supersededByMessageKey: data.messages[1].key }), action(data, 1, { expected: { ...expected, time: "11:00" } })] }), req);
    expect(receipt.status).toBe("complete"); expect(receipt.actions).toHaveLength(2); expect(receipt.actions[0].supersededByRef?.sourceId).toBe(item.ref.sourceId);
  });
  it("adaptive body segments publish only their exact UTF-16 text, including emoji boundaries", async () => {
    const text = "AB🧼CD🧼EF🧼GH🧼IJ🧼KL"; const seen: Message[] = [];
    const model: ModelCallable = async params => {
      const data = payload(params);
      if (data.context || data.originals?.some(original => original.originalText.length > 7)) throw new Error("MODEL_CONTEXT_CONSTRAINT");
      if (data.originals) { seen.push(...data.messages); return reply({ actions: [], contextFacts: [] }); }
      return reply({ actions: [], contextFacts: [], accountedSegments: data.expectedSegments });
    };
    const receipt = await createRequestInterpreter({ model }).interpret(scope, request([text])); seen.sort((a, b) => a.originalRange.start - b.originalRange.start);
    expect(receipt.status).toBe("complete"); expect(seen.map(message => message.text).join("")).toBe(text);
    for (const message of seen) { expect(message.text).toBe(text.slice(message.originalRange.start, message.originalRange.end)); expect(message.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/); }
  });
  it("partitions turns, lines and sentences with no truncation or overlap", () => {
    const req = request(["🧼 First.\nSecond line\nThird."]);
    const text = req.context.evidence[0].originalText!;
    req.context.evidence[0].originalTurns = [{ turnId: "turn:1", speaker: "customer", role: "customer", text: text.slice(0, 11), start: 0, end: 11, occurredAtUtc: now, timeBasis: "turn" }];
    req.context.manifest.entries[0].turnCount = 1;
    const units = originalProofUnits(req, [{ evidenceIndex: 0, start: 0, end: text.length }]);
    expect(units.map(unit => text.slice(unit.start, unit.end)).join("")).toBe(text);
    expect(units.some(unit => unit.end === 11)).toBe(true); expect(units.every((unit, index) => index === 0 || unit.start === units[index - 1].end)).toBe(true);
  });
  it("keeps the entire large history and body in the original payload with no new caps", async () => {
    const texts = Array.from({ length: 160 }, (_, index) => `Original ${index}: ${"word ".repeat(1000)}`);
    const { model, receipt } = await extract(() => ({ actions: [] }), request(texts));
    const sent = JSON.parse(String(model.mock.calls[0][0].messages[1].content));
    expect(receipt.status).toBe("complete"); expect(sent.context.evidence.map((item: StoredEvidence) => item.originalText)).toEqual(texts); expect(model).toHaveBeenCalledTimes(1);
  });
  it("adaptive segments use scoped keys and reductions preserve only supplied child proof", async () => {
    const req = request(["Move my appointment to 2026-11-16 at 9 AM. Hidden unused original.", "Thanks."]);
    const model = vi.fn<ModelCallable>(async params => {
      const data = payload(params);
      if (data.context) throw new Error("MODEL_CONTEXT_CONSTRAINT");
      if (data.originals) return reply({ actions: data.messages[0].text.startsWith("Move") ? [action(data)] : [], contextFacts: [] });
      expect(data.messages).toHaveLength(1); expect(data.messages[0].text).not.toContain("Hidden");
      expect(data.orderedChildren![0].actions[0]).not.toHaveProperty("citations");
      return reply({ actions: data.orderedChildren!.flatMap(child => child.actions), contextFacts: [], accountedSegments: data.expectedSegments });
    });
    const receipt = await createRequestInterpreter({ model }).interpret(scope, req);
    expect(receipt).toMatchObject({ status: "complete", totalSegments: 2, reductionComplete: true });
    expect(receipt.actions[0].citations[0].exactQuote).toBe("Move my appointment to 2026-11-16 at 9 AM. ");
  });
  it("keyed reducer cannot collapse independent same-action same-destination requests into a union proof", async () => {
    const model: ModelCallable = async params => {
      const data = payload(params);
      if (data.context) throw new Error("MODEL_CONTEXT_CONSTRAINT");
      if (data.originals) return reply({ actions: data.messages[0].text.startsWith("Move") ? [action(data, 0), action(data, 1, { expected: { ...expected, date: "2026-11-17", time: "11:00" } })] : [], contextFacts: [] });
      const inputs = data.orderedChildren!.flatMap(child => child.actions);
      return reply({ actions: [{ ...inputs[0], evidenceKeys: inputs.flatMap(value => value.evidenceKeys) }], contextFacts: [], accountedSegments: data.expectedSegments });
    };
    const receipt = await createRequestInterpreter({ model }).interpret(scope, request(["Move my appointment to 2026-11-16 at 9 AM. Move my appointment to 2026-11-17 at 11 AM.", "Thanks."]));
    expect(receipt).toMatchObject({ status: "unavailable", failure: "INVALID_MODEL_RESPONSE", reductionComplete: false }); expect(receipt.actions).toHaveLength(2);
  });
  it.each(["stale leaf key", "invented proof", "action omission", "fact omission", "segment omission"])("reducer rejects %s while retaining successful requests for review", async defect => {
    let leafKey = "";
    const model: ModelCallable = async params => {
      const data = payload(params);
      if (data.context) throw new Error("MODEL_CONTEXT_CONSTRAINT");
      if (data.originals) { if (data.messages[0].text.startsWith("Move")) leafKey = data.messages[0].key; return reply({ actions: data.messages[0].text.startsWith("Move") ? [action(data)] : [], contextFacts: [{ text: "Required original fact", evidenceKeys: [data.messages[0].key] }] }); }
      const actions = data.orderedChildren!.flatMap(child => child.actions);
      const facts = data.orderedChildren!.flatMap(child => child.contextFacts);
      if (defect === "stale leaf key" || defect === "invented proof") actions[0].evidenceKeys.push(defect === "stale leaf key" ? leafKey : "message:invented");
      return reply({ actions: defect === "action omission" ? [] : actions, contextFacts: defect === "fact omission" ? [] : facts, accountedSegments: defect === "segment omission" ? [] : data.expectedSegments });
    };
    const receipt = await createRequestInterpreter({ model }).interpret(scope, request(["Move my appointment to 2026-11-16 at 9 AM", "Other original."]));
    expect(receipt.status).toBe("unavailable"); expect(receipt.reductionComplete).toBe(false); expect(receipt.actions).toHaveLength(1); expect(receipt.actions[0].ambiguous).toBe(true);
  });
  it("keyed contextFacts can retain unresolved evidence but never prove complete No-action", async () => {
    const model: ModelCallable = async params => { const data = payload(params); if (data.context) throw new Error("MODEL_CONTEXT_CONSTRAINT"); return reply(data.originals ? { actions: [], contextFacts: [{ text: "Unresolved dependence", evidenceKeys: [data.messages[0].key] }] } : { actions: [], contextFacts: data.orderedChildren!.flatMap(child => child.contextFacts), accountedSegments: data.expectedSegments }); };
    expect(await createRequestInterpreter({ model }).interpret(scope, request(["Move it", "That date"]))).toMatchObject({ status: "partial", failure: "PARTIAL_CONTEXT", actions: [] });
  });
  it.each(["envelope", "expected", "action", "json", "transport", "source", "grounding"])("allowlisted %s diagnostics are redacted and true failure retries", async defect => {
    let first = true;
    const model = vi.fn<ModelCallable>(async params => {
      const data = payload(params);
      if (!first) return reply({ actions: [action(data)] });
      first = false;
      if (defect === "json") { const response = reply(null); response.choices[0].message.content = "RAW-SECRET invalid JSON"; return response; }
      if (defect === "transport") throw new Error("RAW-SECRET provider body");
      if (defect === "envelope") return reply({ RAW_SECRET: [] });
      const value = action(data);
      if (defect === "expected") value.expected = { ...expected, time: null };
      if (defect === "action") return reply({ actions: [{ ...value, confidence: "RAW-SECRET" }] });
      if (defect === "source") value.anchorMessageKey = "RAW-SECRET";
      if (defect === "grounding") value.expected = { ...expected, address: "RAW-SECRET invented address" };
      return reply({ actions: [value] });
    });
    const interpreter = createRequestInterpreter({ model }); const req = request();
    const failed = await interpreter.interpret(scope, req);
    const categories: Record<string, string> = { envelope: "invalid_envelope", expected: "invalid_action_expected", action: "invalid_action", json: "invalid_json", transport: "model_transport", source: "invalid_source_key", grounding: "invalid_target_grounding" };
    expect(failed.status).toBe("unavailable"); expect(failed.limitations).toContain(`Interpretation diagnostic: ${categories[defect]}.`); expect(JSON.stringify(failed)).not.toContain("RAW-SECRET");
    expect(model).toHaveBeenCalledTimes(1); expect((await interpreter.interpret(scope, req)).status).toBe("complete"); expect(model).toHaveBeenCalledTimes(2);
  });
  it("malformed keyed actions cannot fall back to coercion or complete empty output", async () => {
    const { receipt } = await extract(data => ({ actions: [action(data), { ...action(data), expected: { ...expected, amountCents: "100" } }] }));
    expect(receipt).toMatchObject({ status: "unavailable", actions: [], failure: "INVALID_MODEL_RESPONSE" });
    expect(keyedActionSchema.safeParse({ ...action({ threadKey: "thread", messages: [{ key: "key", text: "text", originalRange: { evidenceIndex: 0, start: 0, end: 4 } }] }), extra: true }).success).toBe(false);
  });
});
