import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { AUDIT_COLLECTION_FAILURES, type AuditDayCollection, type AuditDaySms } from "../shared/dailyActionAudit";
import { collectAuditDaySms, prepareAuditDayThreads } from "./dailyActionAuditCollection";
import { createHash } from "node:crypto";

vi.mock("./_core/env", () => ({ ENV: { openPhoneApiKey: "offline-existing-key" } }));
const bounds = { start: new Date("2026-11-11T05:00:00.000Z"), end: new Date("2026-11-12T05:00:00.000Z") };
const CUSTOMER = "+17035551234";
const BUSINESS = "+12025552345";
const SECRET = "confidential provider error +17035551234 token=secret";
function sms(index: number, changes: Partial<AuditDaySms> = {}): AuditDaySms {
  const incoming = index % 2 === 0;
  return {
    id: `AC${index}`, from: incoming ? CUSTOMER : BUSINESS, to: [incoming ? BUSINESS : CUSTOMER],
    text: `Entire message ${index}`, phoneNumberId: "PNbusiness", conversationId: "CNconversation",
    direction: incoming ? "incoming" : "outgoing", status: incoming ? "received" : "sent",
    createdAt: "2026-11-11T18:00:00.000Z", updatedAt: "2026-11-11T18:01:00.000Z", media: [], ...changes,
  };
}
function response(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { status: 200, ...init });
}
function pages(values: unknown[]) {
  let index = 0;
  const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const value = values[index++];
    if (value instanceof Error) throw value;
    if (value instanceof Response) return value;
    if (value === undefined) throw new Error("Unexpected extra provider page");
    return response(value);
  });
  return request;
}
const collect = (request: typeof fetch, input = bounds, now?: () => number) => collectAuditDaySms(input, { apiKey: "offline-existing-key", request, now });
function failed(result: AuditDayCollection, code: keyof typeof AUDIT_COLLECTION_FAILURES) {
  expect(result.status).toBe("failed");
  expect(result.failure).toBe(code);
  expect(result).not.toHaveProperty("complete");
  expect(result).not.toHaveProperty("error");
  expect(prepareAuditDayThreads(result)).toMatchObject({ threads: [], unsupportedMessages: 0 });
}
function assembled(messages: AuditDaySms[]): AuditDayCollection {
  return { status: "complete", scope: "organization", start: bounds.start.toISOString(), end: bounds.end.toISOString(), messages, pagesRead: 1,
    incoming: messages.filter(m => m.direction === "incoming").length, outgoing: messages.filter(m => m.direction === "outgoing").length,
    duplicates: 0, outOfWindow: 0, failure: null };
}
beforeEach(() => {
  // No default-provider request can escape the injected offline transport.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in collector tests"); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("organization-wide complete SMS collection", () => {
  it("retains every ID and every text across 137 messages, sequentially, before preparing analysis", async () => {
    const messages = Array.from({ length: 137 }, (_, index) => sms(index));
    messages[2].text = "x".repeat(20_001);
    const request = pages([
      { data: messages.slice(0, 50), nextCursor: "page two opaque token" },
      { data: messages.slice(50, 100), nextCursor: "page three" },
      { data: messages.slice(100), nextCursor: null },
    ]);
    const result = await collect(request);
    expect(result).toMatchObject({ status: "complete", failure: null, scope: "organization", pagesRead: 3, incoming: 69, outgoing: 68, duplicates: 0, outOfWindow: 0 });
    expect(result.messages).toEqual(messages);
    const prepared = prepareAuditDayThreads(result);
    expect(prepared.unsupportedMessages).toBe(0);
    expect(prepared.threads).toHaveLength(1);
    expect(prepared.threads[0].messages).toHaveLength(137);
    expect(prepared.threads[0].truncated).toBe(false);
    expect(new Set(prepared.threads[0].messages.map(m => m.providerMessageId))).toEqual(new Set(messages.map(m => m.id)));
    expect(prepared.threads[0].messages.find(m => m.providerMessageId === "AC2")?.text).toHaveLength(20_001);
    expect(request.mock.calls).toHaveLength(3);
    request.mock.calls.forEach(([raw, init], index) => {
      const url = new URL(String(raw));
      expect(url.origin + url.pathname).toBe("https://api.quo.com/messages");
      expect([...url.searchParams.keys()].sort()).toEqual((index ? ["after", "createdAt[gt]", "createdAt[lt]", "limit"] : ["createdAt[gt]", "createdAt[lt]", "limit"]).sort());
      expect(url.searchParams.get("after")).toBe([null, "page two opaque token", "page three"][index]);
      expect(url.searchParams.get("limit")).toBe("50");
      expect(url.searchParams.get("createdAt[gt]")).toBe("2026-11-11T04:59:59.999Z");
      expect(url.searchParams.get("createdAt[lt]")).toBe(bounds.end.toISOString());
      expect(init).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: "offline-existing-key", "Quo-Api-Version": "2026-03-30" } });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init).not.toHaveProperty("body");
    });
  });
  it("does not fetch a later cursor until the preceding body is exhausted", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const stream = new ReadableStream<Uint8Array>({ async start(controller) {
      await gate;
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ data: [sms(0)], nextCursor: "next" })));
      controller.close();
    } });
    const request = pages([new Response(stream), { data: [sms(1)], nextCursor: null }]);
    const pending = collect(request);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    release();
    const result = await pending;
    expect(result.status).toBe("complete");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("uses only the existing ENV key and no business-line configuration", async () => {
    const request = pages([{ data: [], nextCursor: null }]);
    vi.stubGlobal("fetch", request);
    const result = await collectAuditDaySms(bounds);
    expect(result).toMatchObject({ status: "complete", messages: [], incoming: 0, outgoing: 0, pagesRead: 1, failure: null });
    expect(request.mock.calls[0][1]?.headers).toEqual({ Authorization: "offline-existing-key", "Quo-Api-Version": "2026-03-30" });
    expect(new URL(String(request.mock.calls[0][0])).searchParams.has("phoneNumberId")).toBe(false);
  });
  it("requires explicit valid exhaustion even when every row is out of the day", async () => {
    const request = pages([{ data: [sms(0, { createdAt: bounds.end.toISOString() })], nextCursor: "later" }, { data: [], nextCursor: null }]);
    expect(await collect(request)).toMatchObject({ status: "complete", messages: [], pagesRead: 2, incoming: 0, outgoing: 0, outOfWindow: 1 });
  });
  it.each([
    ["standard midnight", "2026-11-11T05:00:00Z", "2026-11-12T05:00:00Z"],
    ["spring DST 23-hour day", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z"],
    ["fall DST 25-hour day", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"],
  ])("uses supplied Eastern UTC bounds exactly for %s", async (_label, start, end) => {
    const input = { start: new Date(start), end: new Date(end) };
    const messages = [
      sms(0, { createdAt: new Date(input.start.getTime() - 1).toISOString() }),
      sms(1, { createdAt: input.start.toISOString() }),
      sms(2, { createdAt: new Date(input.end.getTime() - 1).toISOString() }),
      sms(3, { createdAt: input.end.toISOString() }),
    ];
    const request = pages([{ data: messages, nextCursor: null }]);
    const result = await collect(request, input);
    expect(result).toMatchObject({ status: "complete", incoming: 1, outgoing: 1, outOfWindow: 2 });
    expect(result.messages.map(m => m.id)).toEqual(["AC1", "AC2"]);
    expect(new URL(String(request.mock.calls[0][0])).searchParams.get("createdAt[gt]")).toBe(new Date(input.start.getTime() - 1).toISOString());
  });
  it("keeps both distinct repeated fall DST clock instants", async () => {
    const messages = [sms(0, { createdAt: "2026-11-01T01:30:00-04:00" }), sms(1, { createdAt: "2026-11-01T01:30:00-05:00" })];
    const result = await collect(pages([{ data: messages, nextCursor: null }]), { start: new Date("2026-11-01T04:00:00Z"), end: new Date("2026-11-02T05:00:00Z") });
    expect(result.messages).toEqual(messages);
    expect(prepareAuditDayThreads(result).threads[0].messages.map(m => m.occurredAt)).toEqual(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]);
  });
  it("retains groups, international, shortcodes, alphanumeric IDs, media-only and unknown lines before analysis", async () => {
    const missingLine = { ...sms(0) } as Record<string, unknown>;
    delete missingLine.phoneNumberId;
    const messages = [missingLine, sms(1, { phoneNumberId: null }), sms(2, { to: [BUSINESS, "+13015552345"] }),
      sms(3, { to: ["+447911123456"] }), sms(4, { from: "12345" }), sms(5, { from: "carrier-alpha" }),
      sms(6, { text: "", media: [{ url: "javascript:inert-not-fetched", type: null }, { url: "https://example.invalid/private" }] }),
      sms(7, { status: "failed", phoneNumberId: "PNanother" }), sms(8, { status: "queued" }),
      sms(9, { status: "undelivered" }), sms(10, { to: [] }), sms(11, { from: BUSINESS, to: [BUSINESS] }),
      sms(12, { from: "+4420255523" }), sms(13, { to: ["customer17035551234"] }), sms(14, { from: "Anonymous" })];
    const request = pages([{ data: messages, nextCursor: null }]);
    const result = await collect(request);
    expect(result.status).toBe("complete");
    expect(result.messages).toHaveLength(15);
    expect(result.messages[0].phoneNumberId).toBeNull();
    expect(result.messages[6].media).toEqual(messages[6].media);
    const prepared = prepareAuditDayThreads(result);
    expect(prepared.unsupportedMessages).toBe(12);
    expect(prepared.threads.flatMap(t => t.messages).map(m => m.providerMessageId).sort()).toEqual(["AC7", "AC8", "AC9"]);
    expect(prepared.threads.flatMap(t => t.messages).every(m => m.delivery === "unknown")).toBe(true);
    expect(prepared.threads).toHaveLength(2);
    expect(prepared.warnings.join(" ")).not.toContain("+447911");
    expect(request).toHaveBeenCalledTimes(1); // No attachment/line lookup.
  });
  it("retains official prefix IDs with spaces, punctuation, quotes and unusual carrier strings", async () => {
    const message = sms(0, { id: "AC odd:/\"|雪", phoneNumberId: "PN colon:|\"", conversationId: "CN colon:|\"", from: "carrier with +17035551234", to: ["arbitrary recipient"], media: [{ url: "not-a-url but inert", type: "unusual type" }] });
    const result = await collect(pages([{ data: [message], nextCursor: null }]));
    expect(result.messages).toEqual([message]);
    expect(prepareAuditDayThreads(result).unsupportedMessages).toBe(1);
  });
  it("accepts the full 4096-character official ID boundary without truncation", async () => {
    const message = sms(0, { id: "AC" + "a".repeat(4094), phoneNumberId: "PN" + "b".repeat(4094), conversationId: "CN" + "c".repeat(4094) });
    const result = await collect(pages([{ data: [message], nextCursor: null }]));
    expect(result.status).toBe("complete");
    expect(result.messages).toEqual([message]);
    expect(prepareAuditDayThreads(result).threads[0].messages[0].providerMessageId).toBe(message.id);
  });
  it("ignores raw extras and preserves long phone/carrier/text/media strings within the total budget", async () => {
    const message = sms(0, { from: "carrier".repeat(3000), text: "longtext".repeat(6000), media: [{ url: "inert".repeat(4000), type: "type".repeat(2000) }] });
    const result = await collect(pages([{ data: [{ ...message, privateExtra: SECRET, userId: "USignored", nested: { token: SECRET } }], nextCursor: null, extra: SECRET }]));
    expect(result.messages).toEqual([message]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe("strict provider page evidence and global duplicates", () => {
  it("deduplicates only exact global IDs, including out-of-window rows", async () => {
    const outside = sms(90, { createdAt: bounds.end.toISOString() });
    const request = pages([{ data: [sms(0), outside], nextCursor: "p2" }, { data: [sms(0), outside, sms(1)], nextCursor: null }]);
    const result = await collect(request);
    expect(result).toMatchObject({ status: "complete", duplicates: 2, outOfWindow: 1, incoming: 1, outgoing: 1 });
    expect(result.messages.map(m => m.id)).toEqual(["AC0", "AC1"]);
  });
  it("does not deduplicate different IDs with identical content", async () => {
    const message = sms(0);
    const result = await collect(pages([{ data: [message, { ...message, id: "ACdifferent" }], nextCursor: null }]));
    expect(result.messages).toHaveLength(2);
    expect(result.duplicates).toBe(0);
  });
  it.each([
    { from: "+13015552345" }, { to: ["+13015552345"] }, { text: "changed" }, { phoneNumberId: "PNdifferent" },
    { conversationId: "CNother" }, { direction: "outgoing" }, { status: "sent" },
    { createdAt: "2026-11-11T19:00:00Z" }, { updatedAt: "2026-11-11T19:01:00Z" },
    { media: [{ url: "https://example.invalid/changed" }] }, { media: [{ url: "same", type: "changed" }] },
  ] as Partial<AuditDaySms>[]) ("fails conflicting global ID fields %j without replacing the prefix", async changes => {
    const original = sms(0);
    const result = await collect(pages([{ data: [original], nextCursor: "p2" }, { data: [{ ...original, ...changes }], nextCursor: null }]));
    failed(result, "RESPONSE");
    expect(result.messages).toEqual([original]);
  });
  it.each([
    [{ url: "same" }], [{ url: "same", type: "image/jpeg" }], [{ url: "other", type: "image/png" }],
  ])("compares all media URL/type fields on global duplicate IDs", async media => {
    const original = sms(0, { media: [{ url: "same", type: "image/png" }] });
    const result = await collect(pages([{ data: [original], nextCursor: "p2" }, { data: [{ ...original, media }], nextCursor: null }]));
    failed(result, "RESPONSE");
    expect(result.messages).toEqual([original]);
  });
  it("rejects a conflict even if its changed timestamp moves the row outside the day", async () => {
    const result = await collect(pages([{ data: [sms(0)], nextCursor: "p2" }, { data: [sms(0, { createdAt: bounds.end.toISOString() })], nextCursor: null }]));
    failed(result, "RESPONSE");
  });
  it.each([
    null, [], { nextCursor: null }, { data: null, nextCursor: null }, { data: {}, nextCursor: null },
    { data: [sms(0)] }, { data: [], nextCursor: false }, { data: [], nextCursor: 0 },
    { data: [], nextCursor: "" }, { data: [], nextCursor: "a".repeat(4097) },
    { data: Array.from({ length: 51 }, (_, i) => sms(i)), nextCursor: null },
  ])("fails malformed page schema without claiming empty completeness: %j", async value => {
    failed(await collect(pages([value])), "RESPONSE");
  });
  it("preserves valid rows even if the page is missing its terminal cursor", async () => {
    const result = await collect(pages([{ data: [sms(0)] }]));
    failed(result, "RESPONSE");
    expect(result.messages).toEqual([sms(0)]);
  });
  const invalidRows: Array<[string, unknown]> = [
    ["null", null], ["array", []], ["wrong ID prefix", { ...sms(1), id: "SMS1" }],
    ["oversized ID", { ...sms(1), id: "AC" + "a".repeat(4095) }],
    ["numeric from", { ...sms(1), from: 123 }], ["nonarray recipients", { ...sms(1), to: CUSTOMER }],
    ["invalid recipient type", { ...sms(1), to: [CUSTOMER, null] }], ["null text", { ...sms(1), text: null }],
    ["bad line type", { ...sms(1), phoneNumberId: 7 }], ["bad line prefix", { ...sms(1), phoneNumberId: "line123" }],
    ["missing conversation", { ...sms(1), conversationId: undefined }], ["bad conversation prefix", { ...sms(1), conversationId: "conv1" }],
    ["unknown direction", { ...sms(1), direction: "inbound" }], ["unknown provider state", { ...sms(1), status: "accepted" }],
    ["nonstring status", { ...sms(1), status: null }], ["missing required media", { ...sms(1), media: undefined }],
    ["nonarray media", { ...sms(1), media: {} }], ["null media item", { ...sms(1), media: [null] }],
    ["missing media URL", { ...sms(1), media: [{ type: "image/png" }] }], ["bad media URL", { ...sms(1), media: [{ url: 1 }] }],
    ["bad media type", { ...sms(1), media: [{ url: "url", type: {} }] }],
    ["invalid calendar timestamp", { ...sms(1), createdAt: "2026-02-30T12:00:00Z" }],
    ["local timestamp", { ...sms(1), createdAt: "2026-11-11T12:00:00" }], ["bad offset", { ...sms(1), createdAt: "2026-11-11T12:00:00+99:00" }],
    ["bad updated timestamp", { ...sms(1), updatedAt: "garbage" }], ["24-hour timestamp", { ...sms(1), createdAt: "2026-11-11T24:00:00Z" }],
  ];
  it.each(invalidRows)("fails malformed row %s and retains its validated prefix", async (_label, invalid) => {
    const result = await collect(pages([{ data: [sms(0), invalid, sms(2)], nextCursor: null }]));
    failed(result, "RESPONSE");
    expect(result.messages).toEqual([sms(0)]);
    expect(result.pagesRead).toBe(1);
  });
  it.each(["id", "from", "to", "text", "conversationId", "direction", "status", "createdAt", "updatedAt", "media"])("fails missing required field %s", async field => {
    const raw = { ...sms(1) } as Record<string, unknown>;
    delete raw[field];
    failed(await collect(pages([{ data: [raw], nextCursor: null }])), "RESPONSE");
  });
  it.each([
    ["self cursor", [{ data: [sms(0)], nextCursor: "a" }, { data: [sms(1)], nextCursor: "a" }]],
    ["cursor cycle", [{ data: [sms(0)], nextCursor: "a" }, { data: [sms(1)], nextCursor: "b" }, { data: [sms(2)], nextCursor: "a" }]],
    ["repeated page new cursor", [{ data: [sms(0)], nextCursor: "a" }, { data: [sms(0)], nextCursor: "b" }]],
    ["repeated page false exhaustion", [{ data: [sms(0)], nextCursor: "a" }, { data: [sms(0)], nextCursor: null }]],
    ["empty page advancing cursor", [{ data: [], nextCursor: "a" }]],
  ] as Array<[string, unknown[]]>) ("fails %s without retries", async (_label, values) => {
    const request = pages(values);
    const result = await collect(request);
    failed(result, "CURSOR");
    expect(request).toHaveBeenCalledTimes(values.length);
  });
  it.each([
    new Response("not JSON", { status: 200 }),
    new Response(new Uint8Array([0xff, 0xfe]), { status: 200 }),
    new Response(null, { status: 200 }),
  ])("fails invalid JSON/encoding/missing body", async value => { failed(await collect(pages([value])), "RESPONSE"); });
});

describe("bounded collection with safe failure codes", () => {
  it.each([[401, "ACCESS"], [403, "ACCESS"], [429, "RATE_LIMIT"], [408, "TIMEOUT"], [504, "TIMEOUT"], [400, "FAILED"], [500, "FAILED"], [302, "FAILED"]] as const)("contains HTTP %s as %s with no retry or raw error text", async (status, code) => {
    const request = pages([{ data: [sms(0)], nextCursor: "next" }, new Response(SECRET, { status })]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await collect(request);
    failed(result, code);
    expect(result.messages).toEqual([sms(0)]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(prepareAuditDayThreads(result))).not.toContain(SECRET);
    expect(request).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it.each([
    [new Error(SECRET), "FAILED"], [Object.assign(new Error(SECRET), { name: "AbortError" }), "TIMEOUT"],
    [Object.assign(new Error(SECRET), { name: "TimeoutError" }), "TIMEOUT"], [Object.assign(new Error(SECRET), { code: "ETIMEDOUT" }), "TIMEOUT"],
  ] as const)("contains transport exceptions using only fixed codes", async (error, code) => {
    const request = pages([error]);
    const result = await collect(request);
    failed(result, code);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("fails missing configuration before any request", async () => {
    const request = pages([]);
    failed(await collectAuditDaySms(bounds, { apiKey: " ", request }), "CONFIGURATION");
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { start: new Date("invalid"), end: bounds.end }, { start: bounds.start, end: new Date("invalid") },
    { start: bounds.end, end: bounds.start }, { start: bounds.start, end: bounds.start },
  ])("fails invalid bounds locally", async input => {
    const request = pages([]);
    failed(await collect(request, input), "CONFIGURATION");
    expect(request).not.toHaveBeenCalled();
  });
  it("enforces the 5-second request timeout even when the injected request ignores AbortSignal", async () => {
    vi.useFakeTimers();
    const request = vi.fn((_url: string | URL | Request, _init?: RequestInit) => new Promise<Response>(() => {}));
    const pending = collect(request);
    await vi.advanceTimersByTimeAsync(5000);
    failed(await pending, "TIMEOUT");
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("times out and cancels a stalled body, not just slow response headers", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"data":[')); }, cancel });
    const request = pages([new Response(stream)]);
    const pending = collect(request);
    await vi.advanceTimersByTimeAsync(5000);
    failed(await pending, "TIMEOUT");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("enforces the 90-second total deadline and preserves the first page", async () => {
    let time = 0;
    const request = vi.fn(async () => { time += 46_000; return response({ data: [sms(time)], nextCursor: String(time) }); });
    const result = await collect(request, bounds, () => time);
    failed(result, "TIMEOUT");
    expect(result.messages.map(m => m.id)).toEqual(["AC46000"]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("times out rather than accepting a terminal page after the deadline", async () => {
    let time = 0;
    const request = vi.fn(async () => { time = 90_000; return response({ data: [], nextCursor: null }); });
    failed(await collect(request, bounds, () => time), "TIMEOUT");
  });
  it("refuses page 501 and retains all 500 preceding messages", async () => {
    let index = 0;
    const request = vi.fn(async () => { const n = index++; return response({ data: [sms(n)], nextCursor: `cursor${n}` }); });
    const result = await collect(request, bounds, () => 0);
    failed(result, "LIMIT");
    expect(result.pagesRead).toBe(500);
    expect(result.messages).toHaveLength(500);
    expect(request).toHaveBeenCalledTimes(500);
  });
  it("accepts valid null-cursor exhaustion on page 500", async () => {
    let index = 0;
    const request = vi.fn(async () => { const n = index++; return response({ data: [sms(n)], nextCursor: n === 499 ? null : `cursor${n}` }); });
    const result = await collect(request, bounds, () => 0);
    expect(result).toMatchObject({ status: "complete", pagesRead: 500, failure: null });
    expect(result.messages).toHaveLength(500);
    expect(request).toHaveBeenCalledTimes(500);
  });
  it.each([false, true])("at exactly 10,000 SMS only valid explicit exhaustion is complete (terminal=%s)", async terminal => {
    let index = 0;
    const request = vi.fn(async () => {
      const page = index++;
      return response({ data: Array.from({ length: 50 }, (_, offset) => sms(page * 50 + offset)), nextCursor: terminal && page === 199 ? null : `cursor${page}` });
    });
    const result = await collect(request, bounds, () => 0);
    if (terminal) expect(result.status).toBe("complete"); else failed(result, "LIMIT");
    expect(result.messages).toHaveLength(10_000);
    expect(result.pagesRead).toBe(200);
    expect(request).toHaveBeenCalledTimes(200);
  });
  it("checks cumulative Content-Length against 8 MiB and preserves prior pages", async () => {
    const request = pages([{ data: [sms(0)], nextCursor: "next" }, response({ data: [sms(1)], nextCursor: null }, { headers: { "content-length": String(8 * 1024 * 1024) } })]);
    const result = await collect(request);
    failed(result, "LIMIT");
    expect(result.messages).toEqual([sms(0)]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("enforces 8 MiB cumulative actual UTF-8 body bytes, not declared size or string length", async () => {
    const request = pages([
      { data: [sms(0, { text: "雪".repeat(1_400_000) })], nextCursor: "next" },
      { data: [sms(1, { text: "雪".repeat(1_400_000) })], nextCursor: null },
    ]);
    const result = await collect(request, bounds, () => 0);
    failed(result, "LIMIT");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toHaveLength(1_400_000);
  });
  it("stops reading and cancels immediately once a streamed chunk crosses the body budget", async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel });
    failed(await collect(pages([new Response(stream)]), bounds, () => 0), "LIMIT");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(chunks).toBeLessThanOrEqual(11); // One prefetched chunk is permitted by Web Streams.
  });
});

describe("complete-only unambiguous thread preparation", () => {
  it("separates provider line, conversation and exact customer without delimiter collisions", () => {
    const messages = [sms(0), sms(1), sms(2, { phoneNumberId: "PNother" }), sms(3, { conversationId: "CNother" }),
      sms(4, { from: "+13015552345" }), sms(5, { phoneNumberId: 'PN|:\"', conversationId: 'CN|:\"' }),
      sms(6, { phoneNumberId: 'PN|:', conversationId: 'CN\"|:' })];
    const prepared = prepareAuditDayThreads(assembled(messages));
    expect(prepared.threads).toHaveLength(6);
    expect(new Set(prepared.threads.map(t => t.key)).size).toBe(6);
    expect(prepared.threads.every(t => /^thread:[a-f0-9]{64}$/.test(t.key))).toBe(true);
    expect(prepared.threads.flatMap(t => t.messages)).toHaveLength(messages.length);
    expect(prepared.threads[0].messages.map(m => m.providerMessageId)).toEqual(["AC0", "AC1"]);
    for (const message of prepared.threads.flatMap(t => t.messages)) {
      const original = messages.find(m => m.id === message.providerMessageId)!;
      const identity = JSON.stringify([original.phoneNumberId, original.conversationId, original.id]);
      expect(message.key).toBe(`provider:${createHash("sha256").update(identity).digest("hex")}`);
      expect(message.source).toBe("provider"); expect(message.timeBasis).toBe("provider");
      expect(message.observedAt).toBeNull(); expect(message.sessionId).toBeNull();
    }
  });
  it("uses the canonical utility on formatted exact US phones and direction without changing raw SMS", () => {
    const messages = [sms(0, { from: "(703) 555-1234", to: ["202-555-2345"] }), sms(1, { from: "1 202 555 2345", to: ["+1 (703) 555-1234"] })];
    const before = JSON.stringify(messages);
    const prepared = prepareAuditDayThreads(assembled(messages));
    expect(prepared.threads).toHaveLength(1);
    expect(prepared.threads[0].customerPhone).toBe(CUSTOMER);
    expect(prepared.threads[0].messages.map(m => [m.direction, m.businessPhone])).toEqual([["inbound", BUSINESS], ["outbound", BUSINESS]]);
    expect(JSON.stringify(messages)).toBe(before);
  });
  it("rejects international ten-digit strings, embedded digits and identical normalized sender/recipient", () => {
    const prepared = prepareAuditDayThreads(assembled([
      sms(0, { from: "+4420255523" }), sms(1, { to: ["customer17035551234"] }),
      sms(2, { from: "7035551234", to: [CUSTOMER] }), sms(3, { to: ["703+5551234"] }),
    ]));
    expect(prepared).toMatchObject({ threads: [], unsupportedMessages: 4 });
  });
  it.each(["queued", "sent", "delivered", "undelivered", "received", "failed"]) ("does not invent delivery evidence for provider state %s", status => {
    const prepared = prepareAuditDayThreads(assembled([sms(0, { status }), sms(1, { status })]));
    const messages = prepared.threads[0].messages;
    expect(messages.find(m => m.direction === "inbound")?.delivery).toBe(status === "received" ? "received" : "unknown");
    expect(messages.find(m => m.direction === "outbound")?.delivery).toBe(status === "sent" ? "sent" : status === "delivered" ? "delivered" : "unknown");
  });
  it("retains literal unusual provider IDs while bounding model evidence keys", () => {
    const message = sms(0, { id: 'AC quoted"\\\n雪|:', phoneNumberId: 'PN"|:', conversationId: 'CN\\|:' });
    const prepared = prepareAuditDayThreads(assembled([message]));
    const key = prepared.threads[0].messages[0].key;
    expect(key).toBe(`provider:${createHash("sha256").update(JSON.stringify([message.phoneNumberId, message.conversationId, message.id])).digest("hex")}`);
    expect(prepared.threads[0].messages[0].providerMessageId).toBe(message.id);
  });
  it("keeps long opaque IDs within the unchanged interpretation schema without clipping the raw ID", () => {
    const message = sms(0, { id: `AC${"x".repeat(2_000)}`, phoneNumberId: `PN${"y".repeat(500)}` });
    const prepared = prepareAuditDayThreads(assembled([message]));
    expect(prepared.threads[0].messages[0].key.length).toBeLessThanOrEqual(200);
    expect(prepared.threads[0].messages[0].providerMessageId).toBe(message.id);
    expect(prepareAuditDayThreads(assembled([{ ...message, id: `${message.id}different` }])).threads[0].messages[0].key).not.toBe(prepared.threads[0].messages[0].key);
  });
  it("sorts chronologically without modifying or truncating provider text", () => {
    const messages = [sms(1, { text: "  unchanged\r\n".repeat(2000), createdAt: "2026-11-11T19:00:00Z" }), sms(0, { createdAt: "2026-11-11T18:00:00Z" })];
    const prepared = prepareAuditDayThreads(assembled(messages));
    expect(prepared.threads[0].messages.map(m => m.providerMessageId)).toEqual(["AC0", "AC1"]);
    expect(prepared.threads[0].messages[1].text).toBe(messages[0].text);
    expect(prepared.threads[0].truncated).toBe(false);
    expect(messages.map(m => m.id)).toEqual(["AC1", "AC0"]);
  });
  it("prepares no threads for any failed collection or contradictory completion", () => {
    const complete = assembled([sms(0)]);
    const failedCollection = { ...complete, status: "failed" as const, failure: "TIMEOUT" as const };
    expect(prepareAuditDayThreads(failedCollection)).toMatchObject({ threads: [], unsupportedMessages: 0 });
    expect(prepareAuditDayThreads({ ...complete, failure: "RESPONSE" })).toMatchObject({ threads: [], unsupportedMessages: 0 });
  });
  it("complete empty evidence is genuinely empty with no warnings", () => {
    expect(prepareAuditDayThreads(assembled([]))).toEqual({ threads: [], unsupportedMessages: 0, warnings: [] });
  });
  it("source has only provider GET and canonical phone utility; no persistence, extra credentials or provider-side eligibility filters", () => {
    const source = readFileSync(new URL("./dailyActionAuditCollection.ts", import.meta.url), "utf8");
    expect(source).toContain('method: "GET"');
    expect(source).toContain('from "./utils/phone"');
    expect(source).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(source).not.toMatch(/from\s+["'](?:.*(?:routers|openphone|db|schema|llm|dailyActionAuditData|dailyActionAuditEvidence|dailyActionAuditEngine))["']/);
    expect(source).not.toMatch(/(?:\.insert\(|\bdb\.update\(|\.delete\(|console\.|process\.env|lineIds|openPhoneNumberId|openPhoneCsNumberId|openPhoneBarkNumberId)/);
    expect(source).not.toMatch(/params\.set\(["'](?:phoneNumberId|from|to|status|direction|userId)["']/);
    expect(source).not.toMatch(/cleaner(?:_j|J)obs/);
  });
});
