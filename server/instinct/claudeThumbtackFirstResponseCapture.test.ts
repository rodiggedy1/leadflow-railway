import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), oldNative: vi.fn(), dispatch: vi.fn() }));
vi.mock("../db", () => ({ getDb: async () => ({ execute: mocks.execute }) }));
vi.mock("../thumbtackWebhook", () => ({ handleNativeThumbTackLead: mocks.oldNative }));
vi.mock("./claudeThumbtackFirstResponseApplication", () => ({ dispatchClaudeThumbtackFirstResponse: mocks.dispatch }));
import { registerThumbTackWebhookCaptureRoute } from "../thumbtackWebhookCapture";
import { THUMBTACK_FIRST_RESPONSE_OWNER_URL, relayClaudeThumbtackFirstResponse } from "./claudeThumbtackFirstResponseRelay";
const vars = ["THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED", "THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT", "OPENPHONE_PHONE_NUMBER_ID", "RAILWAY_ENVIRONMENT_NAME", "PREVIEW_MODE", "CRON_SECRET"];
const baseline = vars.map(key => process.env[key]);
beforeEach(() => { vars.forEach(key => delete process.env[key]); vi.resetAllMocks(); mocks.dispatch.mockResolvedValue(undefined); mocks.oldNative.mockResolvedValue(undefined); });
afterEach(() => { vars.forEach((key, i) => { if (baseline[i] === undefined) delete process.env[key]; else process.env[key] = baseline[i]; }); vi.unstubAllGlobals(); });
function route() {
  const posts: Record<string, any> = {};
  registerThumbTackWebhookCaptureRoute({ get: () => {}, post: (path: string, handler: any) => { posts[path] = handler; } } as any);
  const res: any = { headersSent: false, status: vi.fn(() => res), json: vi.fn(() => { res.headersSent = true; return res; }) };
  return { post: posts["/api/webhooks/thumbtack-capture"], owner: posts["/api/webhooks/thumbtack-capture/first-response"], res,
    body: { event: { eventType: "NegotiationCreatedV4", webhookID: "shared-webhook" }, data: { negotiationID: "n1" } } };
}
function on() {
  process.env.RAILWAY_ENVIRONMENT_NAME = "production"; process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED = "true";
  process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT = "2026-11-16T17:00:00Z"; process.env.OPENPHONE_PHONE_NUMBER_ID = "PN-lead";
}
function req(captureId: unknown, auth = "test-relay-secret") { return { body: { captureId }, query: {}, get: (name: string) => name === "x-cron-secret" ? auth : undefined }; }
describe("offline native capture hook", () => {
  it("disabled legacy path saves/ACKs then processes every arrival without a duplicate lookup", async () => {
    const { post, res, body } = route(); mocks.execute.mockResolvedValue([{ insertId: 7 }]);
    mocks.oldNative.mockImplementation(async value => { expect(res.json).toHaveBeenCalled(); expect(value).toBe(body); });
    await post({ body }, res); await post({ body }, res);
    expect(mocks.oldNative).toHaveBeenCalledTimes(2); expect(mocks.dispatch).not.toHaveBeenCalled();
    const queries = mocks.execute.mock.calls.map(([q]) => new MySqlDialect().sqlToQuery(q).sql);
    expect(queries.some(q => q.startsWith("SELECT"))).toBe(false);
    expect(JSON.stringify(body)).toBe('{"event":{"eventType":"NegotiationCreatedV4","webhookID":"shared-webhook"},"data":{"negotiationID":"n1"}}');
  });
  it("active path dispatches the exact saved capture after ACK and never runs the legacy model", async () => {
    on(); const { post, res, body } = route(); mocks.execute.mockResolvedValue([{ insertId: 7 }]);
    mocks.dispatch.mockImplementation(async id => { expect(id).toBe(7); expect(res.json).toHaveBeenCalled(); expect(mocks.execute).toHaveBeenCalledTimes(1); });
    await post({ body }, res); expect(mocks.dispatch).toHaveBeenCalledOnce(); expect(mocks.oldNative).not.toHaveBeenCalled();
  });
  it("distinct leads sharing a webhook ID and repeated negotiations each dispatch their own capture", async () => {
    on(); const { post, res, body } = route(); let id = 6;
    mocks.execute.mockImplementation(async q => new MySqlDialect().sqlToQuery(q).sql.startsWith("INSERT") ? [{ insertId: ++id }] : [{ affectedRows: 1 }]);
    await post({ body }, res); await post({ body: { ...body, data: { negotiationID: "n2" } } }, res); await post({ body }, res);
    expect(mocks.dispatch.mock.calls.map(([captureId]) => captureId)).toEqual([7, 8, 9]);
  });
  it("missing webhook ID does not reject a lead", async () => {
    on(); const { post, res } = route(); mocks.execute.mockResolvedValue([{ insertId: 7 }]);
    await post({ body: { event: { eventType: "NegotiationCreatedV4" }, data: { negotiationID: "n1" } } }, res);
    expect(mocks.dispatch).toHaveBeenCalledWith(7);
  });
  it.each(["MessageCreatedV4", "ReviewCreatedV4"])("%s remains capture-only, including in Preview", async eventType => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "preview"; const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { post, res } = route(); mocks.execute.mockResolvedValue([{ insertId: 7 }]);
    await post({ body: { event: { eventType } } }, res);
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.oldNative).not.toHaveBeenCalled();
  });
  it("Preview forwards only the saved ID after ACK without recapturing payload or running any local model", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "preview"; process.env.PREVIEW_MODE = "true"; process.env.CRON_SECRET = "test-relay-secret";
    const { post, res, body } = route(); mocks.execute.mockResolvedValue([{ insertId: 7 }]);
    const fetch = vi.fn(async () => { expect(res.headersSent).toBe(true); expect(mocks.execute).toHaveBeenCalledTimes(1); return { ok: true, status: 200 }; }); vi.stubGlobal("fetch", fetch);
    await post({ body }, res);
    expect(fetch).toHaveBeenCalledWith(THUMBTACK_FIRST_RESPONSE_OWNER_URL, expect.objectContaining({ method: "POST", body: '{"captureId":7}',
      headers: { "Content-Type": "application/json", "x-cron-secret": "test-relay-secret" }, redirect: "error" }));
    expect(mocks.execute).toHaveBeenCalledTimes(2); expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.oldNative).not.toHaveBeenCalled();
  });
  it("Preview handoff failure never invokes legacy/local AI or marks the saved capture processed", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "preview"; process.env.CRON_SECRET = "test-relay-secret";
    const fetch = vi.fn(async () => ({ ok: false, status: 503 })); vi.stubGlobal("fetch", fetch);
    const { post, res, body } = route(); mocks.execute.mockResolvedValue([{ insertId: 7 }]); await post({ body }, res);
    expect(fetch).toHaveBeenCalledOnce(); expect(mocks.execute).toHaveBeenCalledOnce(); expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.oldNative).not.toHaveBeenCalled(); expect(res.status).not.toHaveBeenCalledWith(500);
  });
  it("relay checks auth/capture identity before its single HTTP submission", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(relayClaudeThumbtackFirstResponse(7)).rejects.toThrow("RELAY_AUTH_MISSING");
    process.env.CRON_SECRET = "test-relay-secret";
    await expect(relayClaudeThumbtackFirstResponse(0)).rejects.toThrow("CAPTURE_ID_MISSING"); expect(fetch).not.toHaveBeenCalled();
  });
  it("active failed dispatcher has no fallback", async () => {
    on(); const { post, res, body } = route(); mocks.execute.mockResolvedValue([{ insertId: 7 }]); mocks.dispatch.mockRejectedValue(new Error("generation failed"));
    await post({ body }, res); expect(mocks.oldNative).not.toHaveBeenCalled();
  });
  it("failed durable capture never dispatches", async () => {
    on(); const { post, res, body } = route(); mocks.execute.mockRejectedValue(new Error("capture unavailable"));
    await post({ body }, res); expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.oldNative).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(500);
  });
  it("Production receiver requires existing auth and calls only the existing saved-capture dispatcher", async () => {
    on(); process.env.CRON_SECRET = "test-relay-secret"; const { owner, res } = route(); await owner(req(7), res);
    expect(mocks.dispatch).toHaveBeenCalledWith(7); expect(mocks.execute).not.toHaveBeenCalled(); expect(res.json).toHaveBeenCalledWith({ dispatched: true });
  });
  it("receiver rejects wrong auth before dispatch", async () => {
    on(); process.env.CRON_SECRET = "test-relay-secret"; const { owner, res } = route(); await owner(req(7, "wrong"), res);
    expect(res.status).toHaveBeenCalledWith(403); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, "7", null, Number.MAX_SAFE_INTEGER + 1])("receiver rejects invalid capture ID %s", async id => {
    on(); process.env.CRON_SECRET = "test-relay-secret"; const { owner, res } = route(); await owner(req(id), res);
    expect(res.status).toHaveBeenCalledWith(400); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it.each(["preview", undefined])("receiver cannot execute in environment %s", async environment => {
    on(); if (environment === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME; else process.env.RAILWAY_ENVIRONMENT_NAME = environment;
    process.env.CRON_SECRET = "test-relay-secret"; const { owner, res } = route(); await owner(req(7), res);
    expect(res.status).toHaveBeenCalledWith(503); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("receiver cannot report dispatch with the existing native capability disabled", async () => {
    on(); delete process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED; process.env.CRON_SECRET = "test-relay-secret";
    const { owner, res } = route(); await owner(req(7), res); expect(res.status).toHaveBeenCalledWith(503); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("receiver reports a dispatch exception without claiming SMS delivery", async () => {
    on(); process.env.CRON_SECRET = "test-relay-secret"; mocks.dispatch.mockRejectedValue(new Error("DB unavailable"));
    const { owner, res } = route(); await owner(req(7), res); expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Native first-response handoff failed" });
  });
});
