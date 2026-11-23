import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  sendThumbtackDirectQuoSms,
  sanitizeThumbtackQuoSmsResult,
  THUMBTACK_QUO_SMS_TIMEOUT_MS,
  type ThumbtackQuoSmsResult,
} from "./thumbtackDirectQuoSms";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const KEY = "synthetic-private-key-NOT-REAL";
const input = { to: "(202) 555-0199", content: "Hello! 👋\n\nExact approved synthetic text.\n", fromNumberId: "PN-synthetic-line" };
const accepted = (status = "queued", extra: Record<string, unknown> = {}) => ({ data: { id: "msg-synthetic-receipt", status, ...extra } });
const response = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const mockFetch = () => vi.fn<typeof globalThis.fetch>();
function send(fetch: typeof globalThis.fetch, options: Partial<Parameters<typeof sendThumbtackDirectQuoSms>[1]> = {}, patch: Partial<typeof input> = {}) {
  return sendThumbtackDirectQuoSms({ ...input, ...patch }, { apiKey: KEY, fetch, random: () => 0, ...options });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function controlledBody(status: number, body: Promise<unknown>) {
  const json = vi.fn(() => body);
  return { response: { status, headers: new Headers(), json } as unknown as Response, json };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => {
  const timerCount = vi.getTimerCount();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  expect(timerCount, "owned sender leaves no pending timers").toBe(0);
});

describe("dedicated Thumbtack Quo transport: exact contract", () => {
  it("sends the full exact content/from/to payload, current headers, raw key and owned signal", async () => {
    const parent = new AbortController();
    const fetch = mockFetch().mockResolvedValue(response(202, accepted()));
    expect(await send(fetch, { signal: parent.signal })).toMatchObject({ kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: "msg-synthetic-receipt", providerStatus: "queued", httpStatus: 202 });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe("https://api.quo.com/messages");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({ Authorization: KEY, "Quo-Api-Version": "2026-03-30", "Content-Type": "application/json" });
    expect(JSON.parse(request!.body as string)).toEqual({ content: input.content, from: input.fromNumberId, to: ["+12025550199"] });
    expect(request!.signal).toBeInstanceOf(AbortSignal);
    expect(request!.signal).not.toBe(parent.signal);
    expect(request!.signal!.aborted).toBe(false);
  });

  it.each(["queued", "sent", "delivered", "failed", "undelivered"])("retains actual 202 %s status without claiming carrier delivery", async status => {
    const fetch = mockFetch().mockResolvedValue(response(202, accepted(status)));
    const result = await send(fetch);
    expect(result).toMatchObject({ kind: "accepted", success: true, messageId: "msg-synthetic-receipt", providerStatus: status });
    expect(result.code).toBe("QUO_ACCEPTED");
    expect(result).not.toHaveProperty("delivered");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("requires only the usable data.id, ignoring all unrelated unknown receipt fields", async () => {
    const fetch = mockFetch().mockResolvedValue(response(202, { data: { id: "receipt-0123456789", alien: { values: [KEY, input.content] }, content: input.content, from: {}, to: null }, unknown: [KEY] }));
    expect(await send(fetch)).toEqual({ kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: "receipt-0123456789", httpStatus: 202 });
  });

  it.each(["opaque-id-" + "x".repeat(600), " opaque receipt identifier "])("preserves a nonblank opaque message ID exactly without a guessed length cap", async id => {
    expect(await send(mockFetch().mockResolvedValue(response(202, { data: { id } })))).toMatchObject({ kind: "accepted", messageId: id });
  });

  it.each(["a", " ", "👋".repeat(1_600), `${"a".repeat(1_598)}👋\n`])("allows 1–1600 Unicode code points without truncation or rewriting", async content => {
    const fetch = mockFetch().mockResolvedValue(response(202, accepted()));
    expect((await send(fetch, {}, { content })).kind).toBe("accepted");
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).content).toBe(content);
  });

  it.each([
    [{ to: "not a number" }, {}, "INVALID_DESTINATION"],
    [{ to: "+01205550199" }, {}, "INVALID_DESTINATION"],
    [{ to: "" }, {}, "INVALID_DESTINATION"],
    [{ fromNumberId: "+12025550199" }, {}, "INVALID_FROM_NUMBER_ID"],
    [{ fromNumberId: "" }, {}, "INVALID_FROM_NUMBER_ID"],
    [{ fromNumberId: "PN\nbad" }, {}, "INVALID_FROM_NUMBER_ID"],
    [{ content: "" }, {}, "INVALID_CONTENT"],
    [{ content: "👋".repeat(1_601) }, {}, "INVALID_CONTENT"],
    [{ content: "a".repeat(1_601) }, {}, "INVALID_CONTENT"],
    [{}, { apiKey: "" }, "INVALID_API_KEY"],
    [{}, { apiKey: "  " }, "INVALID_API_KEY"],
    [{}, { apiKey: "bad\r\nkey" }, "INVALID_API_KEY"],
    [{}, { apiKey: "bad\u0000key" }, "INVALID_API_KEY"],
    [{}, { deadlineAt: NaN }, "INVALID_DEADLINE"],
    [{}, { deadlineAt: Infinity }, "INVALID_DEADLINE"],
  ] as const)("rejects invalid technical input before submission (%s %s)", async (patch, options, code) => {
    const fetch = mockFetch();
    expect(await send(fetch, options, patch)).toEqual({ kind: "rejected", success: false, code });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["PN", "PN opaque:identifier", "PN-" + "x".repeat(600)])("uses only the documented PN sender contract without guessing ID characters or length", async fromNumberId => {
    const fetch = mockFetch().mockResolvedValue(response(202, accepted()));
    expect((await send(fetch, {}, { fromNumberId })).kind).toBe("accepted");
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).from).toBe(fromNumberId);
  });

  it("formats international destinations without imposing a country whitelist", async () => {
    const fetch = mockFetch().mockResolvedValue(response(202, accepted()));
    await send(fetch, {}, { to: "+44 7700 900123" });
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).to).toEqual(["+447700900123"]);
  });

  it.each(["+11205550199", "+17031551234", "+44", "+2561234", "123", "12345678"])
  ("accepts Quo-format recipient %s without NANP, shortcode or international-length vetoes", async to => {
    const fetch = mockFetch().mockResolvedValue(response(202, accepted()));
    expect(await send(fetch, {}, { to })).toMatchObject({ kind: "accepted" });
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).to).toEqual([to]);
  });

  it("has no runtime service import, business filters, new throttle or idempotency invention", () => {
    const source = readFileSync(new URL("./thumbtackDirectQuoSms.ts", import.meta.url), "utf8");
    expect([...source.matchAll(/^import .* from "([^"]+)"/gm)].map(match => match[1])).toEqual(["../../shared/thumbtackSmsPhone"]);
    expect(source).not.toMatch(/setInterval|idempotency[-_]key|cleaner_jobs|cleanerJobs|invokeLLM|estimatePrice|stage\s*===/i);
  });
});

describe("provider acceptance/rejection classification and sanitized metadata", () => {
  it.each([400, 401, 402, 403, 404, 422, 429])("HTTP %i is a definitive rejection with bounded documented reason", async status => {
    const fetch = mockFetch().mockResolvedValue(response(status, { title: "Synthetic refusal", message: "Request could not be used", code: "synthetic_error", traceId: "trace-synthetic" }));
    const pending = send(fetch, { deadlineAt: NOW + 200 });
    if (status === 429) await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toMatchObject({ kind: "rejected", success: false, code: `QUO_HTTP_${status}`, httpStatus: status, providerReason: "Synthetic refusal — Request could not be used", providerCode: "synthetic_error", traceId: "trace-synthetic" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([200, 201, 202, 206, 299])("successful HTTP %i with a real message ID records acceptance without resubmitting", async status => {
    const fetch = mockFetch().mockResolvedValue(response(status, accepted()));
    expect(await send(fetch)).toMatchObject({ kind: "accepted", success: true, messageId: "msg-synthetic-receipt", httpStatus: status });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["bad\nid", "bad\u0000id"])("opaque ID %j is retained exactly, not rejected by an invented character rule", async id => {
    expect(await send(mockFetch().mockResolvedValue(response(202, { data: { id } })))).toMatchObject({ kind: "accepted", messageId: id });
  });

  it.each([204, 409, 500, 502, 503])("ambiguous HTTP %i does not justify a replacement POST", async status => {
    const fetch = mockFetch().mockResolvedValue(status === 204 ? new Response(null, { status }) : response(status, accepted()));
    expect(await send(fetch)).toMatchObject({ kind: "uncertain", success: false, httpStatus: status });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([{}, { data: {} }, { data: null }, { data: { id: "" } }, { data: { id: " " } }, { data: { id: 123 } }, { data: { id: [] } }, { id: "outside-data" }, { data: { id: KEY } }])("malformed/missing 202 receipt is uncertain without retries: %s", async body => {
    const fetch = mockFetch().mockResolvedValue(response(202, body));
    expect(await send(fetch)).toMatchObject({ kind: "uncertain", success: false, code: "INVALID_ACCEPTANCE_RECEIPT", httpStatus: 202 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([202, 400, 429, 500])("bad JSON preserves HTTP %i classification without blind retry", async status => {
    const fetch = mockFetch().mockResolvedValue(new Response("not JSON", { status }));
    const pending = send(fetch, { deadlineAt: NOW + 100 });
    if (status === 429) await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ kind: [400, 429].includes(status) ? "rejected" : "uncertain", success: false, httpStatus: status });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("bounds/redacts reasons and ignores raw values, unknown fields, credentials and approved content", async () => {
    const fetch = mockFetch().mockResolvedValue(response(422, {
      title: `Synthetic refusal ${KEY}`,
      message: `Rejected ${input.content} ${input.to} +12025550199 staff@example.invalid Authorization: ${KEY} token=other-secret`,
      detail: `${"safe ".repeat(300)}${KEY}`,
      code: `provider_${KEY}`, traceId: `trace_${KEY}`,
      values: { content: input.content, key: KEY }, errors: [{ value: KEY, reason: input.content }], rawBody: KEY,
      error: { title: "Provider validation failure", values: [KEY] },
    }));
    const result = await send(fetch), serialized = JSON.stringify(result);
    for (const secret of [KEY, input.content, input.to, "+12025550199", "staff@example.invalid", "other-secret"]) expect(serialized).not.toContain(secret);
    expect(Array.from(result.providerReason!).length).toBeLessThanOrEqual(512);
    expect(result.providerCode!.length).toBeLessThanOrEqual(128);
    expect(result.traceId!.length).toBeLessThanOrEqual(128);
    expect(result).not.toHaveProperty("values"); expect(result).not.toHaveProperty("rawBody");
    expect(result.providerReason).toContain("Synthetic refusal");
  });

  it("does not expose a thrown fetch/json exception containing secrets", async () => {
    const fetch = mockFetch().mockRejectedValue(new Error(`${KEY} ${input.content}`));
    const result = await send(fetch);
    expect(result).toEqual({ kind: "uncertain", success: false, code: "TRANSPORT_ERROR" });
    expect(fetch).toHaveBeenCalledOnce();
    const json = controlledBody(202, Promise.reject(new Error(KEY)));
    expect(JSON.stringify(await send(mockFetch().mockResolvedValue(json.response)))).not.toContain(KEY);
  });

  it("captures provider error nested metadata and header trace without requiring optional fields", async () => {
    const result = await send(mockFetch().mockResolvedValue(response(403, { error: { title: "Synthetic forbidden", message: "Scope refused", code: 403 } }, { "x-request-id": "request-synthetic" })));
    expect(result).toMatchObject({ providerReason: "Synthetic forbidden — Scope refused", providerCode: "403", traceId: "request-synthetic" });
  });

  it("retains the official numeric trace field as a support identifier rather than misclassifying it as a phone number", async () => {
    const trace = "6897907457496870895";
    const result = await send(mockFetch().mockResolvedValue(response(401, { message: "Unauthorized", title: "Unauthorized", trace })));
    expect(result).toMatchObject({ kind: "rejected", httpStatus: 401, traceId: trace });
    expect(sanitizeThumbtackQuoSmsResult(result).traceId).toBe(trace);
  });

  it("captures explicit providerReason/providerCode/providerStatus without serializing unknown fields", async () => {
    const result = await send(mockFetch().mockResolvedValue(response(422, { providerReason: "Synthetic explicit validation rejection", providerCode: "validation_synthetic", providerStatus: "rejected", unknown: { values: KEY } })));
    expect(result).toMatchObject({ providerReason: "Synthetic explicit validation rejection", providerCode: "validation_synthetic", providerStatus: "rejected" });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("sanitization helper bounds human text, omits unknown fields and preserves a usable receipt ID", () => {
    const result = sanitizeThumbtackQuoSmsResult({ kind: "accepted", success: true, code: "QUO_ACCEPTED", messageId: "receipt-0123456789", providerReason: `Authorization: synthetic-secret\n${"x".repeat(800)}`, providerStatus: "queued" } as ThumbtackQuoSmsResult);
    expect(result.messageId).toBe("receipt-0123456789");
    expect(result.providerReason!.length).toBeLessThanOrEqual(512);
    expect(result.providerReason).not.toContain("synthetic-secret");
  });
});

describe("only explicit 429 retries inside the original absolute budget", () => {
  it("retries with exponential backoff plus jitter and unchanged payload", async () => {
    const fetch = mockFetch().mockResolvedValueOnce(response(429)).mockResolvedValueOnce(response(429)).mockResolvedValueOnce(response(202, accepted()));
    const random = vi.fn(() => 0.4);
    const pending = send(fetch, { random });
    await flush(); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(549); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_099); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).kind).toBe("accepted");
    expect(fetch).toHaveBeenCalledTimes(3); expect(random).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(call => call[1]?.body === fetch.mock.calls[0][1]?.body)).toBe(true);
    expect(fetch.mock.calls.every(call => call[1]?.signal === fetch.mock.calls[0][1]?.signal)).toBe(true);
  });

  it.each([["2", 2_000], ["0.75", 750], [new Date(NOW + 3_000).toUTCString(), 3_000]] as const)("respects usable Retry-After %s", async (header, delay) => {
    const fetch = mockFetch().mockResolvedValueOnce(response(429, {}, { "retry-after": header })).mockResolvedValueOnce(response(202, accepted()));
    const pending = send(fetch); await flush();
    await vi.advanceTimersByTimeAsync(delay - 1); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect((await pending).kind).toBe("accepted");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["nonsense", "-2", "0", new Date(NOW - 10_000).toUTCString()])("ignores unusable/expired Retry-After %s, retaining exponential minimum", async header => {
    const fetch = mockFetch().mockResolvedValueOnce(response(429, {}, { "retry-after": header })).mockResolvedValueOnce(response(202, accepted()));
    const pending = send(fetch); await flush();
    await vi.advanceTimersByTimeAsync(499); expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect((await pending).kind).toBe("accepted");
  });

  it("Retry-After beyond budget never submits early or creates an oversized sleep", async () => {
    const fetch = mockFetch().mockResolvedValue(response(429, { title: "Synthetic rate rejection" }, { "retry-after": "99999999" }));
    const pending = send(fetch, { deadlineAt: NOW + 1_000 }); await flush();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toMatchObject({ kind: "rejected", code: "QUO_HTTP_429", providerReason: "Synthetic rate rejection" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });

  it("has no maximum attempt rule; explicit rejections retry only until original deadline", async () => {
    const fetch = mockFetch().mockResolvedValue(response(429));
    const pending = send(fetch); await vi.advanceTimersByTimeAsync(THUMBTACK_QUO_SMS_TIMEOUT_MS);
    expect(await pending).toMatchObject({ kind: "rejected", code: "QUO_HTTP_429", httpStatus: 429 });
    expect(fetch).toHaveBeenCalledTimes(6); // 0, 500, 1500, 3500, 7500, 15500ms
    await vi.advanceTimersByTimeAsync(60_000); expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("retains 429 at deadline during its response body", async () => {
    const body = deferred<unknown>(), controlled = controlledBody(429, body.promise);
    const fetch = mockFetch().mockResolvedValue(controlled.response);
    const pending = send(fetch, { deadlineAt: NOW + 100 }); await flush();
    expect(controlled.json).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ kind: "rejected", code: "QUO_HTTP_429", httpStatus: 429 });
    body.resolve({ title: "Late synthetic body" }); await flush();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retains 429 at deadline during backoff with no replacement POST", async () => {
    const fetch = mockFetch().mockImplementation(async () => response(429, { title: "Slow down" }));
    const pending = send(fetch, { deadlineAt: NOW + 1_200 }); await flush();
    await vi.advanceTimersByTimeAsync(500); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(700);
    expect(await pending).toMatchObject({ kind: "rejected", code: "QUO_HTTP_429", providerReason: "Slow down" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a second POST in flight makes prior 429 insufficient proof of current rejection", async () => {
    const late = deferred<Response>();
    const fetch = mockFetch().mockResolvedValueOnce(response(429)).mockImplementationOnce(() => late.promise);
    const pending = send(fetch, { deadlineAt: NOW + 700 }); await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    const result = await pending;
    expect(result).toEqual({ kind: "uncertain", success: false, code: "SUBMISSION_TIMEOUT" });
    late.resolve(response(202, accepted())); await flush();
    expect(result.kind).toBe("uncertain"); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never retries an ambiguous network error after an explicit 429", async () => {
    const fetch = mockFetch().mockResolvedValueOnce(response(429)).mockRejectedValueOnce(new Error("Synthetic connection loss"));
    const pending = send(fetch); await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual({ kind: "uncertain", success: false, code: "TRANSPORT_ERROR" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("absolute deadline, parent cancellation, noncooperative operations and cleanup", () => {
  it("registers its single root timer synchronously before the first fetch and caller fallback", async () => {
    const order: string[] = [];
    const fetch = mockFetch().mockImplementation((_url, request) => {
      expect(vi.getTimerCount()).toBe(1);
      request!.signal!.addEventListener("abort", () => order.push("owned abort"), { once: true });
      return new Promise(() => {});
    });
    const pending = send(fetch);
    const fallback = setTimeout(() => order.push("parent fallback"), THUMBTACK_QUO_SMS_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(THUMBTACK_QUO_SMS_TIMEOUT_MS);
    expect(await pending).toMatchObject({ kind: "uncertain", code: "SUBMISSION_TIMEOUT" });
    expect(order).toEqual(["owned abort", "parent fallback"]);
    clearTimeout(fallback);
  });

  it.each(["cancelled", "expired"])("pre-dispatch %s is rejected/no-submit", async mode => {
    const parent = new AbortController(); if (mode === "cancelled") parent.abort();
    const fetch = mockFetch();
    expect(await send(fetch, { signal: parent.signal, deadlineAt: mode === "expired" ? NOW : NOW + 30_000 })).toMatchObject({ kind: "rejected", success: false, code: mode === "expired" ? "SUBMISSION_TIMEOUT_BEFORE_DISPATCH" : "SUBMISSION_CANCELLED_BEFORE_DISPATCH" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([202, 400, 401, 402, 403, 404, 422, 429, 500])("parent cancellation during HTTP %i body preserves only explicit rejections", async status => {
    const parent = new AbortController(), late = deferred<unknown>(), controlled = controlledBody(status, late.promise);
    const fetch = mockFetch().mockResolvedValue(controlled.response);
    const remove = vi.spyOn(parent.signal, "removeEventListener");
    const pending = send(fetch, { signal: parent.signal }); await flush(); parent.abort();
    const result = await pending;
    expect(result).toMatchObject({ kind: [400, 401, 402, 403, 404, 422, 429].includes(status) ? "rejected" : "uncertain", httpStatus: status });
    expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    late.resolve(accepted()); await flush(); expect(fetch).toHaveBeenCalledOnce();
  });

  it("parent cancellation during backoff cancels the sleep and preserves 429", async () => {
    const parent = new AbortController(), fetch = mockFetch().mockResolvedValue(response(429, { title: "Synthetic busy" }));
    const pending = send(fetch, { signal: parent.signal }); await flush();
    expect(vi.getTimerCount()).toBe(2); parent.abort();
    expect(await pending).toMatchObject({ kind: "rejected", code: "QUO_HTTP_429" });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000); expect(fetch).toHaveBeenCalledOnce();
  });

  it("parent cancellation during second POST is uncertain, not the prior rejection", async () => {
    const parent = new AbortController(), late = deferred<Response>();
    const fetch = mockFetch().mockResolvedValueOnce(response(429)).mockImplementationOnce(() => late.promise);
    const pending = send(fetch, { signal: parent.signal }); await vi.advanceTimersByTimeAsync(500); parent.abort();
    expect(await pending).toEqual({ kind: "uncertain", success: false, code: "SUBMISSION_CANCELLED" });
    late.reject(new Error("late synthetic failure")); await flush(); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bounds a cooperative fetch abort with no blind retry", async () => {
    const fetch = mockFetch().mockImplementation((_url, request) => new Promise((_resolve, reject) => request!.signal!.addEventListener("abort", () => reject(new Error("Synthetic abort")), { once: true })));
    const pending = send(fetch, { deadlineAt: NOW + 50 }); await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual({ kind: "uncertain", success: false, code: "SUBMISSION_TIMEOUT" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["resolve429", "resolve202", "reject"])("noncooperative late fetch %s is consumed, never parsed/retried", async settlement => {
    const late = deferred<Response>(), fetch = mockFetch().mockImplementation(() => late.promise);
    const controlled = controlledBody(settlement === "resolve429" ? 429 : 202, Promise.resolve(accepted()));
    const pending = send(fetch, { deadlineAt: NOW + 100 }); await vi.advanceTimersByTimeAsync(100);
    const result = await pending; expect(result).toEqual({ kind: "uncertain", success: false, code: "SUBMISSION_TIMEOUT" });
    expect(vi.getTimerCount()).toBe(0);
    if (settlement === "reject") late.reject(new Error(KEY)); else late.resolve(controlled.response);
    await flush(); await vi.advanceTimersByTimeAsync(60_000);
    expect(controlled.json).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce(); expect(result.kind).toBe("uncertain");
  });

  it.each([[202, "resolve"], [202, "reject"], [429, "resolve"], [429, "reject"]] as const)("noncooperative HTTP %i json late %s is consumed with no retries", async (status, settlement) => {
    const late = deferred<unknown>(), controlled = controlledBody(status, late.promise), fetch = mockFetch().mockResolvedValue(controlled.response);
    const pending = send(fetch, { deadlineAt: NOW + 100 }); await flush();
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending; expect(result.kind).toBe(status === 429 ? "rejected" : "uncertain");
    expect(vi.getTimerCount()).toBe(0);
    if (settlement === "resolve") late.resolve(accepted()); else late.reject(new Error(KEY));
    await flush(); await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledOnce(); expect(result.kind).toBe(status === 429 ? "rejected" : "uncertain");
  });

  it("uses the supplied original absolute budget across POST, body and retry", async () => {
    const late = deferred<unknown>(), controlled = controlledBody(429, late.promise);
    const fetch = mockFetch().mockResolvedValueOnce(controlled.response).mockImplementation(() => new Promise(() => {}));
    const pending = send(fetch, { deadlineAt: NOW + 1_000 }); await flush();
    await vi.advanceTimersByTimeAsync(600); late.resolve({ title: "Synthetic busy" }); await flush();
    await vi.advanceTimersByTimeAsync(400);
    expect(await pending).toMatchObject({ kind: "rejected", code: "QUO_HTTP_429" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("removes parent listeners/timers on success; later parent cancellation cannot affect receipt", async () => {
    const parent = new AbortController(), fetch = mockFetch().mockResolvedValue(response(202, accepted()));
    const add = vi.spyOn(parent.signal, "addEventListener"), remove = vi.spyOn(parent.signal, "removeEventListener");
    const result = await send(fetch, { signal: parent.signal });
    expect(add).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
    expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0); parent.abort();
    expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(false); expect(result.kind).toBe("accepted");
  });
});
