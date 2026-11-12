import { describe, expect, it, vi } from "vitest";
import { hydrateAuditEvidence, mergeAuditEvidence, readAuditProviderPage } from "./dailyActionAuditEvidence";
import type { AuditMessage, AuditThread } from "../shared/dailyActionAudit";
const start = new Date("2026-11-11T05:00:00.000Z"), end = new Date("2026-11-12T05:00:00.000Z");
const providerMessage = { id: "ACfixture01", from: "+13015550123", to: ["+12025550199"], text: "Please move tomorrow to 9am", phoneNumberId: "PNfixture", direction: "incoming", status: "received", createdAt: "2026-11-11T15:00:00.000Z" };
const raw: AuditMessage = { key: "stored:1", sessionId: 1, customerPhone: providerMessage.from, businessPhone: null, direction: "inbound", text: providerMessage.text, occurredAt: "2026-11-11T15:01:00.000Z", observedAt: "2026-11-11T15:01:00.000Z", timeBasis: "history", delivery: "received", source: "conversation_history", providerMessageId: providerMessage.id };
const thread: AuditThread = { key: "stored-thread", customerPhone: raw.customerPhone, customerName: "Fixture Customer", truncated: false, messages: [raw] };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function deps(request: (...args: any[]) => Promise<Response>) { return { apiKey: "nonfunctional-offline-fixture", lineIds: ["PNfixture"], request: request as typeof fetch, pause: vi.fn(async () => undefined) }; }

describe("Daily Action Audit read-only provider evidence", () => {
  it("uses the documented versioned GET endpoint and exact day bounds, with no write or send", async () => {
    const request = vi.fn(async () => response({ data: [providerMessage], nextCursor: null }));
    const result = await readAuditProviderPage({ start, end }, deps(request));
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.quo.com/messages");
    expect(parsed.searchParams.get("phoneNumberId")).toBe("PNfixture");
    expect(parsed.searchParams.get("createdAt[gt]")).toBe("2026-11-11T04:59:59.999Z");
    expect(parsed.searchParams.get("createdAt[lt]")).toBe(end.toISOString());
    expect(parsed.searchParams.get("limit")).toBe("50");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.body).toBeUndefined();
    expect(init.headers).toHaveProperty("Quo-Api-Version", "2026-03-30");
    expect(result.messages[0]).toMatchObject({ timeBasis: "provider", direction: "inbound", delivery: "received", source: "provider" });
    expect(result.complete).toBe(true);
  });
  it("includes exact midnight and excludes the next day's midnight", async () => {
    const request = async () => response({ data: [{ ...providerMessage, createdAt: start.toISOString() }, { ...providerMessage, id: "ACend", createdAt: end.toISOString() }], nextCursor: null });
    const result = await readAuditProviderPage({ start, end }, deps(request));
    expect(result.messages).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("returns a continuation instead of fetching every provider page automatically", async () => {
    const request = vi.fn(async () => response({ data: [providerMessage], nextCursor: "opaque-next" }));
    const result = await readAuditProviderPage({ start, end }, deps(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ complete: false, lineIndex: 0, after: "opaque-next" });
  });
  it("advances to the next configured business line only on the next explicit batch", async () => {
    const request = vi.fn(async () => response({ data: [], nextCursor: null }));
    const result = await readAuditProviderPage({ start, end }, { ...deps(request), lineIds: ["PNfixture", "PNsecond"] });
    expect(result).toMatchObject({ complete: false, lineIndex: 1, after: null });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { phoneNumberId: "PNother-tenant" }, { from: "+13015550124" , to: ["+12025550199", "+13015550999"] },
    { direction: "unknown" }, { createdAt: "2026-02-30T15:00:00Z" }, { createdAt: "2026-11-11T15:00:00" },
    { id: "../../send-sms" }, { from: "invalid" }, { text: "x".repeat(8_001) },
  ])("rejects unsupported identity/time/group or unsafe message evidence %j", async change => {
    const result = await readAuditProviderPage({ start, end }, deps(async () => response({ data: [{ ...providerMessage, ...change }], nextCursor: null })));
    expect(result.messages).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("does not mark an outbound draft or failed message as sent", async () => {
    const values = ["queued", "failed", "undelivered", "sent", "delivered"].map((status, i) => ({ ...providerMessage, id: `AC${i}`, from: providerMessage.to[0], to: [providerMessage.from], direction: "outgoing", status }));
    const result = await readAuditProviderPage({ start, end }, deps(async () => response({ data: values, nextCursor: null })));
    expect(result.messages.map(message => message.delivery)).toEqual(["unknown", "unknown", "unknown", "sent", "delivered"]);
  });
  it("fails safely on a 429 without retries or exposing provider payloads", async () => {
    const request = vi.fn(async () => response({ error: "credential-token customer text" }, 429));
    const result = await readAuditProviderPage({ start, end }, deps(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.available).toBe(false);
    expect(result.warnings.join(" ")).not.toMatch(/credential-token|customer text/);
  });
  it("rejects oversized streaming response bodies and excessive page item counts", async () => {
    const large = await readAuditProviderPage({ start, end }, deps(async () => response({ data: "x".repeat(512_001), nextCursor: null })));
    const count = await readAuditProviderPage({ start, end }, deps(async () => response({ data: Array.from({ length: 51 }, () => providerMessage), nextCursor: null })));
    expect(large.available).toBe(false); expect(count.available).toBe(false);
  });
  it("does not loop when a provider repeats the same cursor", async () => {
    const request = vi.fn(async () => response({ data: [], nextCursor: "repeat" }));
    const result = await readAuditProviderPage({ start, end, cursor: { sessionAfterId: 0, inboundAfterId: 0, asOf: end.toISOString(), providerAfter: "repeat" } }, deps(request));
    expect(result.available).toBe(false); expect(request).toHaveBeenCalledTimes(1);
  });
  it("makes zero requests when credentials or configured business lines are absent", async () => {
    const request = vi.fn(async () => response({ data: [], nextCursor: null }));
    await readAuditProviderPage({ start, end }, { ...deps(request), apiKey: "" });
    await readAuditProviderPage({ start, end }, { ...deps(request), lineIds: [] });
    expect(request).not.toHaveBeenCalled();
  });
  it("binds stored evidence to the exact customer, text, direction, business line and provider ID", async () => {
    const request = vi.fn(async () => response({ data: providerMessage }));
    const result = await hydrateAuditEvidence([thread], "2026-11-11", "America/New_York", deps(request));
    expect(result.threads[0].messages).toHaveLength(1);
    expect(result.threads[0].messages[0]).toMatchObject({ timeBasis: "provider", occurredAt: providerMessage.createdAt, delivery: "received" });
    expect(request.mock.calls[0][0]).toBe(`https://api.quo.com/messages/${providerMessage.id}`);
  });
  it.each(["failed", "queued", "sent", "delivered"])("retrieves historical outbound IDs but trusts only the provider's actual %s status", async status => {
    const message = { ...raw, direction: "outbound" as const, delivery: "unknown" as const, text: "Confirmed tomorrow at 9am" };
    const provider = { ...providerMessage, from: providerMessage.to[0], to: [providerMessage.from], direction: "outgoing", text: message.text, status };
    const request = vi.fn(async () => response({ data: provider }));
    const result = await hydrateAuditEvidence([{ ...thread, messages: [message] }], "2026-11-11", "America/New_York", deps(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.threads[0].messages[0]).toMatchObject({ timeBasis: "provider", delivery: status === "sent" || status === "delivered" ? status : "unknown" });
  });
  it("does not authorize a historical confirmation bound to another customer or business line", async () => {
    const message = { ...raw, direction: "outbound" as const, delivery: "unknown" as const, text: "Confirmed tomorrow at 9am" };
    for (const change of [{ to: ["+13015550124"] }, { phoneNumberId: "PNother-tenant" }]) {
      const provider = { ...providerMessage, from: providerMessage.to[0], to: [providerMessage.from], direction: "outgoing", text: message.text, status: "sent", ...change };
      const result = await hydrateAuditEvidence([{ ...thread, messages: [message] }], "2026-11-11", "America/New_York", deps(async () => response({ data: provider })));
      expect(result.threads[0].messages[0]).toMatchObject({ timeBasis: "history", delivery: "unknown" });
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
  it.each([
    { from: "+13015550124" }, { text: "Another customer's request" }, { id: "ACwrong" },
    { direction: "outgoing" }, { to: ["+12025550198"] }, { phoneNumberId: "PNuntrusted" },
  ])("does not upgrade mismatched stored evidence %j", async change => {
    const stored = { ...thread, messages: [{ ...raw, businessPhone: providerMessage.to[0] }] };
    const result = await hydrateAuditEvidence([stored], "2026-11-11", "America/New_York", deps(async () => response({ data: { ...providerMessage, ...change } })));
    expect(result.threads[0].messages[0].timeBasis).toBe("history");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("stops lookup requests on the first provider error and never tries arbitrary text IDs", async () => {
    const request = vi.fn(async () => response({}, 429));
    const result = await hydrateAuditEvidence([{ ...thread, messages: [raw, { ...raw, key: "second", providerMessageId: "ACsecond" }, { ...raw, key: "unsafe", providerMessageId: "../../send" }] }], "2026-11-11", "America/New_York", deps(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("enforces at most twelve optional lookups and paces requests instead of a burst", async () => {
    const messages = Array.from({ length: 14 }, (_, i) => ({ ...raw, key: `m${i}`, providerMessageId: `AC${i}` }));
    const options = deps(async () => response({ data: { ...providerMessage, id: "ACunmatched" } }));
    const request = vi.spyOn(options, "request");
    const result = await hydrateAuditEvidence([{ ...thread, messages }], "2026-11-11", "America/New_York", options);
    expect(request).toHaveBeenCalledTimes(12);
    expect(options.pause).toHaveBeenCalledTimes(11);
    expect(result.warnings.join(" ")).toContain("per-batch limit");
  });
  it("deduplicates provider IDs only within the same exact customer and direction, never by content", () => {
    const second: AuditThread = { ...thread, customerPhone: "+13015550124", messages: [{ ...raw, customerPhone: "+13015550124" }] };
    const merged = mergeAuditEvidence([thread, second], [{ ...raw, source: "provider", timeBasis: "provider" }]);
    expect(merged).toHaveLength(2);
    expect(merged[0].messages).toHaveLength(1);
    expect(merged[1].messages).toHaveLength(1);
    expect(merged[0].messages[0].key).not.toBe(merged[1].messages[0].key);
    const distinct = mergeAuditEvidence([thread], [{ ...raw, providerMessageId: "ACdifferent", timeBasis: "provider" }]);
    expect(distinct[0].messages).toHaveLength(2);
  });
});
