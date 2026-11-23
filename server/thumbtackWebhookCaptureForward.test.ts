import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), fetch: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { registerThumbTackWebhookCaptureRoute } from "./thumbtackWebhookCapture";

const URL = "https://quote.maidinblack.com/api/webhooks/thumbtack-capture";
const ENV_KEYS = ["THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED", "THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT", "OPENPHONE_PHONE_NUMBER_ID"];
let baseline: Array<string | undefined>;
const lead = (negotiationID = "offline-new-negotiation") => ({
  event: { eventType: "NegotiationCreatedV4", webhookID: "shared-subscription-id", triggeredAt: "2026-11-23T18:10:00Z" },
  data: { negotiationID, createdAt: "2026-11-23T18:09:59Z", customer: { firstName: "Synthetic", phone: "+12025550123" },
    request: { category: { name: "House cleaning" }, description: "Synthetic offline lead" } },
});
const ack = () => ({ received: true, persisted: true, summary: { phoneValuesPresent: true } });
const upstream = (body: unknown = ack(), status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function route() {
  const app = { get: vi.fn(), post: vi.fn() };
  registerThumbTackWebhookCaptureRoute(app as never);
  expect(app.post).toHaveBeenCalledOnce();
  expect(app.post.mock.calls[0][0]).toBe("/api/webhooks/thumbtack-capture");
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return { handler: app.post.mock.calls[0][1] as (req: { body: unknown }, response: typeof res) => Promise<void>, res, app };
}
beforeEach(() => {
  vi.clearAllMocks();
  baseline = ENV_KEYS.map(k => process.env[k]);
  process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED = "false";
  delete process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT;
  delete process.env.OPENPHONE_PHONE_NUMBER_ID;
  mocks.getDb.mockRejectedValue(new Error("PREVIEW_DB_MUST_NOT_BE_USED_FOR_POST"));
  mocks.fetch.mockImplementation(async () => upstream());
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  expect(mocks.getDb).not.toHaveBeenCalled();
  ENV_KEYS.forEach((k, i) => { if (baseline[i] === undefined) delete process.env[k]; else process.env[k] = baseline[i]; });
  vi.unstubAllGlobals();
});

describe("Preview Thumbtack receiver forwards to the existing Production owner", () => {
  it("forwards the unchanged native lead without requiring Preview enablement or sender settings", async () => {
    const h = route(), body = lead();
    await h.handler({ body }, h.res);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(URL, expect.objectContaining({ method: "POST", redirect: "error",
      headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: expect.any(AbortSignal) }));
    expect(h.res.status).toHaveBeenCalledWith(200);
    expect(h.res.json).toHaveBeenCalledWith(ack());
  });
  it("forwards different new leads sharing one webhook/subscription ID", async () => {
    const h = route(), first = lead("offline-negotiation-one"), second = lead("offline-negotiation-two");
    await h.handler({ body: first }, h.res); await h.handler({ body: second }, h.res);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls.map(c => JSON.parse(c[1].body).data.negotiationID)).toEqual(["offline-negotiation-one", "offline-negotiation-two"]);
    expect(h.res.status.mock.calls).toEqual([[200], [200]]);
  });
  it("has no local duplicate-delivery gate even when the same payload arrives again", async () => {
    const h = route(), body = lead();
    await h.handler({ body }, h.res); await h.handler({ body }, h.res);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[0][1].body).toBe(mocks.fetch.mock.calls[1][1].body);
  });
  it.each(["MessageCreatedV4", "NegotiationUpdatedV4", "ReviewCreatedV4"])("also preserves the native %s event for Production", async eventType => {
    const h = route(), body = { event: { eventType, webhookID: "shared-subscription-id" }, data: { text: "Synthetic event" } };
    await h.handler({ body }, h.res);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual(body);
    expect(h.res.status).toHaveBeenCalledWith(200);
  });
  it("does not discard a native payload for missing phone or date fields", async () => {
    const h = route(), body = { event: { eventType: "NegotiationCreatedV4" }, data: { negotiationID: "offline-no-phone" } };
    await h.handler({ body }, h.res);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual(body);
  });
  it("waits for the Production capture acknowledgement instead of acknowledging or writing locally first", async () => {
    const h = route(); let resolve!: (r: Response) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    const pending = h.handler({ body: lead() }, h.res);
    expect(h.res.json).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
    resolve(upstream()); await pending;
    expect(h.res.json).toHaveBeenCalledWith(ack());
  });
  it.each([400, 429, 500, 503])("returns upstream status %s without falsely acknowledging success or falling back", async status => {
    const h = route(); mocks.fetch.mockResolvedValueOnce(upstream({ error: "OFFLINE_UPSTREAM_ERROR" }, status));
    await h.handler({ body: lead() }, h.res);
    expect(h.res.status).toHaveBeenCalledWith(status);
    expect(h.res.json).toHaveBeenCalledWith(expect.objectContaining({ received: false, forwarded: false }));
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it.each([null, {}, { received: true }, { received: false, persisted: true }])("does not accept an incomplete durable capture acknowledgement %#", async body => {
    const h = route(); mocks.fetch.mockResolvedValueOnce(upstream(body));
    await h.handler({ body: lead() }, h.res);
    expect(h.res.status).toHaveBeenCalledWith(502);
    expect(h.res.json).toHaveBeenCalledWith(expect.objectContaining({ received: false }));
  });
  it("does not falsely acknowledge an HTML fallback as a successful capture", async () => {
    const h = route(); mocks.fetch.mockResolvedValueOnce(new Response("<html>Not the capture handler</html>", { status: 200 }));
    await h.handler({ body: lead() }, h.res);
    expect(h.res.status).toHaveBeenCalledWith(502);
  });
  it.each(["TypeError", "TimeoutError"])("returns a retryable failure on %s without a local send or retry loop", async name => {
    const h = route(); mocks.fetch.mockRejectedValueOnce(Object.assign(new Error("OFFLINE_FAILURE"), { name }));
    await h.handler({ body: lead() }, h.res);
    expect(h.res.status).toHaveBeenCalledWith(502); expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("uses a bounded transport timeout and blocks redirects", async () => {
    const h = route(), timeout = vi.spyOn(AbortSignal, "timeout");
    try { await h.handler({ body: lead() }, h.res); expect(timeout).toHaveBeenCalledWith(15_000); }
    finally { timeout.mockRestore(); }
    expect(mocks.fetch.mock.calls[0][1].redirect).toBe("error");
  });
  it("preserves both existing read routes byte-for-byte and leaves the primary webhook file unchanged", () => {
    const current = readFileSync("server/thumbtackWebhookCapture.ts", "utf8");
    const original = execFileSync("git", ["show", "453f334ede94e9de6b0d0fbf2e00917d0e6ba963:server/thumbtackWebhookCapture.ts"], { encoding: "utf8" });
    const readBlock = (s: string) => s.slice(s.indexOf('  app.get("/api/webhooks/thumbtack-capture/events"'), s.indexOf('  app.post("/api/webhooks/thumbtack-capture"'));
    expect(readBlock(current)).toBe(readBlock(original));
    expect(readFileSync("server/thumbtackWebhook.ts", "utf8")).toBe(execFileSync("git", ["show", "453f334ede94e9de6b0d0fbf2e00917d0e6ba963:server/thumbtackWebhook.ts"], { encoding: "utf8" }));
    const post = current.slice(current.indexOf('  app.post("/api/webhooks/thumbtack-capture"'));
    expect(post).not.toMatch(/getDb\(|db\.execute|handleNativeThumbTackLead|sendSms|invokeLLM|setInterval|priorRows|event_id\s*=|skipped duplicate/);
  });
});
