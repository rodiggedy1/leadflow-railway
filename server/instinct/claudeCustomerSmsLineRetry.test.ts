// Receiving-line lookup: bounded retry, real failure logging, and the existing staff review task when the line
// cannot be verified. Offline: the real lookup code runs against a fake OpenPhone; nothing is sent anywhere.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeCustomerSmsService, type CustomerSmsConfig, type CustomerSmsInput, type CustomerSmsOptions, type CustomerSmsSession, type CustomerSmsStore } from "./claudeCustomerSms";
import { createReceivingLineReader } from "./claudeSmsAlternative";
import { readReceivingLineWithRetry, retryAfterMs, RECEIVING_LINE_MAX_RETRY_WAIT_MS, RECEIVING_LINE_RETRY_DELAY_MS, RECEIVING_LINE_TIMEOUT_MS } from "./claudeCustomerSmsApplication";
import { UNVERIFIED_RECEIVING_LINE } from "./claudeCustomerTasksStore";

vi.mock("../db", () => ({ getDb: async () => null }));
vi.mock("../_core/notification", () => ({ notifyOwner: async () => true }));

const createdAt = "2026-11-16T18:00:00Z", at = Date.parse(createdAt);
const input: CustomerSmsInput = { sessionId: 71, providerMessageId: "AC-inbound", fromPhone: "+12025550123", receivingPhoneNumberId: "PN-cs",
  inboundText: "I was charged twice, please fix it", createdAt, receivedAt: at + 1000, isCleaner: false, direction: "incoming" };
const lineList = (data: unknown[]) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
const ok = () => lineList([{ id: "PN-cs", number: "+12025550999" }, { id: "PN-other", number: "+12025550888" }]);
const status = (code: number, headers: Record<string, string> = {}) => new Response("{}", { status: code, headers });
let logSpy: ReturnType<typeof vi.spyOn>;
const diagnostics = () => logSpy.mock.calls.map(args => JSON.parse(String(args[0]))).filter(line => line.message === "[ClaudeCustomerSMS][Diagnostic]");
beforeEach(() => { vi.stubEnv("OPENPHONE_API_KEY", "offline-test-key"); logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function lookup(responses: Array<Response | Error>) {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);          // every request is time-limited
    expect(init?.redirect).toBe("error");                     // the lookup's own settings are kept
    const next = responses.shift(); if (!next) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next; return next;
  });
  const sleep = vi.fn(async (_ms: number) => undefined);
  return { fetch, sleep, run: () => readReceivingLineWithRetry(input, "PN-cs", createReceivingLineReader, { fetch: fetch as unknown as typeof globalThis.fetch, sleep }) };
}
const reasons = () => diagnostics().filter(line => line.stage === "receiving_line_read").map(line => line.reason);

describe("receiving-line lookup: one bounded retry for temporary failures", () => {
  it("uses the documented bounds", () => {
    expect([RECEIVING_LINE_TIMEOUT_MS, RECEIVING_LINE_RETRY_DELAY_MS, RECEIVING_LINE_MAX_RETRY_WAIT_MS]).toEqual([10_000, 1_500, 5_000]);
  });
  it("a first-time success makes one request and no retry", async () => {
    const l = lookup([ok()]);
    await expect(l.run()).resolves.toBe("+12025550999");
    expect(l.fetch).toHaveBeenCalledTimes(1); expect(l.sleep).not.toHaveBeenCalled(); expect(reasons()).toEqual([]);
  });
  it.each([
    { name: "rate limit with Retry-After 2 s", first: () => status(429, { "retry-after": "2" }), wait: 2_000, reason: "RECEIVING_LINE_HTTP_429_RETRYING" },
    { name: "rate limit without Retry-After", first: () => status(429), wait: 1_500, reason: "RECEIVING_LINE_HTTP_429_RETRYING" },
    { name: "server error", first: () => status(503), wait: 1_500, reason: "RECEIVING_LINE_HTTP_503_RETRYING" },
    { name: "network error", first: () => new TypeError("fetch failed"), wait: 1_500, reason: "RECEIVING_LINE_NETWORK_ERROR_RETRYING" },
    { name: "timeout", first: () => Object.assign(new Error("timed out"), { name: "TimeoutError" }), wait: 1_500, reason: "RECEIVING_LINE_TIMEOUT_RETRYING" },
  ])("$name: waits, retries once, and succeeds", async ({ first, wait, reason }) => {
    const l = lookup([first(), ok()]);
    await expect(l.run()).resolves.toBe("+12025550999");
    expect(l.fetch).toHaveBeenCalledTimes(2); expect(l.sleep.mock.calls).toEqual([[wait]]); expect(reasons()).toEqual([reason]);
  });
  it("two temporary failures: exactly two requests, then the original RECEIVING_LINE_UNAVAILABLE error", async () => {
    const l = lookup([status(502), status(503)]);
    await expect(l.run()).rejects.toThrow("RECEIVING_LINE_UNAVAILABLE");
    expect(l.fetch).toHaveBeenCalledTimes(2); expect(l.sleep).toHaveBeenCalledTimes(1);
    expect(reasons()).toEqual(["RECEIVING_LINE_HTTP_502_RETRYING", "RECEIVING_LINE_HTTP_503"]);
  });
  it("a Retry-After longer than the 5 s window is respected by not retrying", async () => {
    const l = lookup([status(429, { "retry-after": "30" })]);
    await expect(l.run()).rejects.toThrow("RECEIVING_LINE_UNAVAILABLE");
    expect(l.fetch).toHaveBeenCalledTimes(1); expect(l.sleep).not.toHaveBeenCalled(); expect(reasons()).toEqual(["RECEIVING_LINE_HTTP_429"]);
  });
  it.each([
    { name: "authorization refused", first: () => status(401), reason: "RECEIVING_LINE_HTTP_401" },
    { name: "line not in the list", first: () => lineList([{ id: "PN-other", number: "+12025550888" }]), reason: "RECEIVING_LINE_LOOKUP_REJECTED" },
    { name: "line listed twice", first: () => lineList([{ id: "PN-cs", number: "+12025550999" }, { id: "PN-cs", number: "+12025550999" }]), reason: "RECEIVING_LINE_LOOKUP_REJECTED" },
    { name: "number not in standard format", first: () => lineList([{ id: "PN-cs", number: "202-555-0999" }]), reason: "RECEIVING_LINE_LOOKUP_REJECTED" },
  ])("configuration failure ($name) is not retried", async ({ first, reason }) => {
    const l = lookup([first()]);
    await expect(l.run()).rejects.toThrow("RECEIVING_LINE_UNAVAILABLE");
    expect(l.fetch).toHaveBeenCalledTimes(1); expect(l.sleep).not.toHaveBeenCalled(); expect(reasons()).toEqual([reason]);
  });
  it("a missing API key makes no request and is not retried", async () => {
    vi.stubEnv("OPENPHONE_API_KEY", "");
    const l = lookup([]);
    await expect(l.run()).rejects.toThrow("RECEIVING_LINE_UNAVAILABLE");
    expect(l.fetch).not.toHaveBeenCalled(); expect(reasons()).toEqual(["RECEIVING_LINE_NO_API_KEY"]);
  });
  it("reads Retry-After as seconds or an HTTP date", () => {
    expect(retryAfterMs("3")).toBe(3_000); expect(retryAfterMs(null)).toBeNull(); expect(retryAfterMs("soon")).toBeNull();
    expect(retryAfterMs(new Date(1_000_000 + 4_000).toUTCString(), 1_000_000)).toBe(4_000);
  });
  it("never logs the API key, the response body or the phone list", async () => {
    const l = lookup([status(500), lineList([{ id: "PN-cs", number: "+12025550999" }])]);
    await l.run();
    const text = JSON.stringify(logSpy.mock.calls);
    expect(text).not.toContain("offline-test-key"); expect(text).not.toContain("+12025550999"); expect(text).not.toContain(input.inboundText);
  });
});

// ── The pipeline when the line cannot be verified ─────────────────────────────
const config: CustomerSmsConfig = { startAt: at - 1000, allowedPhone: "", testCustomerOverride: false };
const session = (): CustomerSmsSession => ({ contact: { sessionId: "71", rawPhone: input.fromPhone, phone: input.fromPhone, displayName: "Jane Smith", contactGap: null },
  messageHistory: JSON.stringify([{ role: "user", content: input.inboundText, opMsgId: input.providerMessageId }]),
  lastInboundPhoneNumberId: input.receivingPhoneNumberId, leadSource: "cs-inbound", smsOptOut: 0, csQueue: "Clients" });
function pipeline(review: CustomerSmsStore["reportUnverifiedLineFailure"] | undefined) {
  const store = { claim: vi.fn(), prepare: vi.fn(), recordAcceptance: vi.fn(), markUncertain: vi.fn(), suppress: vi.fn(), suppressBeforeSubmission: vi.fn(),
    reportFailure: vi.fn(), ...(review ? { reportUnverifiedLineFailure: vi.fn(review) } : {}) };
  const generate = vi.fn(), send = vi.fn(), onFailure = vi.fn(async () => undefined), onTaskChange = vi.fn(async () => undefined);
  const readReceivingLine = vi.fn<CustomerSmsOptions["readReceivingLine"]>(async () => { throw new Error("RECEIVING_LINE_UNAVAILABLE"); });
  const run = createClaudeCustomerSmsService({ config: () => ({ ...config }), readSession: async () => session(), readReceivingLine, generate, store: store as any, send, onFailure, onTaskChange });
  return { store, generate, send, onFailure, onTaskChange, run };
}
const identity = { sessionId: 71, customerName: "Jane Smith", customerPhone: input.fromPhone, sourceMessageId: input.providerMessageId,
  sourceText: input.inboundText, receivedAt: input.receivedAt, receivingPhoneNumberId: "PN-cs" };
const lineLines = () => diagnostics().filter(line => line.stage === "receiving_line_read" && line.reason !== "RECEIVING_LINE_READ_REACHED");

describe("unverified receiving line: existing staff review task, never a reply", () => {
  it("creates the review task, refreshes task lists and sends the owner alert with the task", async () => {
    const p = pipeline(async () => ({ taskId: 501, notify: true }));
    expect(await p.run(input)).toEqual({ outcome: "failed" });
    expect((p.store as any).reportUnverifiedLineFailure.mock.calls).toEqual([[identity, "RECEIVING_LINE_UNAVAILABLE"]]);
    expect(p.onFailure.mock.calls).toEqual([[{ taskId: 501, code: "RECEIVING_LINE_UNAVAILABLE", sessionId: 71 }]]);
    expect(p.onTaskChange).toHaveBeenCalledTimes(1);
    for (const fn of [p.store.claim, p.generate, p.store.prepare, p.send, p.store.reportFailure]) expect(fn).not.toHaveBeenCalled();
    expect(lineLines().map(line => line.reason)).toEqual(["EXCEPTION", "REVIEW_TASK_CREATED"]);
  });
  it("a skipped review (e.g. a later reply exists) keeps the existing owner alert and logs why", async () => {
    const p = pipeline(async () => ({ skipped: "LATER_REPLY_EXISTS" }));
    expect(await p.run(input)).toEqual({ outcome: "failed" });
    expect(p.onFailure.mock.calls).toEqual([[{ taskId: null, code: "RECEIVING_LINE_UNAVAILABLE", sessionId: 71 }]]);
    expect(p.onTaskChange).not.toHaveBeenCalled(); expect(p.send).not.toHaveBeenCalled(); expect(p.store.claim).not.toHaveBeenCalled();
    expect(lineLines().map(line => [line.reason, line.exclusion])).toEqual([["EXCEPTION", undefined], ["REVIEW_TASK_SKIPPED", "LATER_REPLY_EXISTS"]]);
  });
  it("a failed task creation keeps the existing owner alert and logs the failure", async () => {
    const p = pipeline(async () => { throw Object.assign(new Error("private database detail"), { code: "ER_LOCK_DEADLOCK" }); });
    expect(await p.run(input)).toEqual({ outcome: "failed" });
    expect(p.onFailure.mock.calls).toEqual([[{ taskId: null, code: "RECEIVING_LINE_UNAVAILABLE", sessionId: 71 }]]);
    expect(p.send).not.toHaveBeenCalled(); expect(p.store.claim).not.toHaveBeenCalled();
    const failed = lineLines().find(line => line.reason === "REVIEW_TASK_FAILED");
    expect(failed).toMatchObject({ errorCode: "ER_LOCK_DEADLOCK" }); expect(JSON.stringify(logSpy.mock.calls)).not.toContain("private database detail");
  });
  it("a store without the review method keeps today's behavior: owner alert only", async () => {
    const p = pipeline(undefined);
    expect(await p.run(input)).toEqual({ outcome: "failed" });
    expect(p.onFailure.mock.calls).toEqual([[{ taskId: null, code: "RECEIVING_LINE_UNAVAILABLE", sessionId: 71 }]]);
    expect(p.send).not.toHaveBeenCalled();
  });
});

// ── The "unverified" marker can never become a sending number ─────────────────
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
describe("the unverified-line marker is never used to send", () => {
  it("is not a phone number", () => { expect(UNVERIFIED_RECEIVING_LINE).toBe("unverified"); expect(UNVERIFIED_RECEIVING_LINE).not.toMatch(/\d/); });
  it("no screen sends from a task's fields: every 'from' line comes from the conversation's own receiving-line ID or the fixed CS line", () => {
    for (const file of sources("client/src")) {
      const text = readFileSync(file, "utf8");
      for (const line of text.split("\n").filter(value => /fromNumberId/.test(value))) {
        expect(line, file).toMatch(/getCsInboxReplyPhoneNumberId|fromNumberId: "PN0wVLcpCq"|fromNumberId,|fromNumberId = getCsInboxReplyPhoneNumberIdForSelectedConversation/);
      }
      expect(text.match(/task\??\.receivingPhoneNumber\b/g) ?? [], file).toEqual([]);
    }
  });
  it("no server code reads a stored task's receiving number; sends use receiving-line IDs only", () => {
    const readers = sources("server").filter(file => /\.receivingPhoneNumber\b/.test(readFileSync(file, "utf8")));
    // Only the verified reply binding (claim) and the reply pipeline's own lookup read a receiving number.
    expect(readers.sort()).toEqual(["server/instinct/claudeCustomerSmsGeneration.ts", "server/instinct/claudeCustomerTasksStore.ts",
      "server/instinct/claudeSmsAlternative.ts", "server/instinct/customerSmsAttribution.ts"]);
    const store = readFileSync("server/instinct/claudeCustomerTasksStore.ts", "utf8");
    expect(store.match(/\.receivingPhoneNumber\b/g)?.length).toBe((store.match(/binding\.receivingPhoneNumber\b/g) ?? []).length);
    expect(store).not.toMatch(/task\.receivingPhoneNumber\b/);
    const openphone = readFileSync("server/openphone.ts", "utf8");
    expect(openphone).not.toMatch(/receivingPhoneNumber\b/);
  });
});
