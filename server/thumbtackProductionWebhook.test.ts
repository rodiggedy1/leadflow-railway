import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), getDb: vi.fn(), dispatch: vi.fn(), sendSms: vi.fn(),
  invokeLLM: vi.fn(), notify: vi.fn(), activity: vi.fn(), setting: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./openphone", () => ({ sendSms: mocks.sendSms, estimatePrice: () => "139" }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("./availability", () => ({ getNextAvailableSlots: () => [], formatAvailabilityQuestion: () => "Availability" }));
vi.mock("./activityLogger", () => ({ logActivity: mocks.activity }));
vi.mock("./_core/notification", () => ({ notifyOwner: mocks.notify }));
// Never import the application's full router or settings implementation in this offline test.
vi.mock("./routers", () => ({ normalizePhone: (phone: string) => phone }));
vi.mock("./settingsRouter", () => ({ getSetting: mocks.setting }));
vi.mock("./instinct/claudeThumbtackFirstResponseApplication", () => ({ dispatchClaudeThumbtackFirstResponse: mocks.dispatch }));

import { registerThumbTackWebhookRoute } from "./thumbtackWebhook";
import { registerThumbTackWebhookCaptureRoute } from "./thumbtackWebhookCapture";
import { capturedThumbtackLead } from "./instinct/claudeThumbtackFirstResponse";

const envKeys = ["RAILWAY_ENVIRONMENT_NAME", "PREVIEW_MODE", "THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED", "THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT", "OPENPHONE_PHONE_NUMBER_ID"];
const baseline = envKeys.map(key => process.env[key]);
const payload = () => ({
  event: { eventType: "NegotiationCreatedV4", webhookID: "offline-native-delivery", triggeredAt: "2026-11-23T14:22:00Z" },
  data: {
    negotiationID: "offline-negotiation", createdAt: "2026-11-23T14:21:57Z",
    customer: { firstName: "Synthetic", lastName: "Lead", phone: "2025550123" },
    request: { category: { name: "House Cleaning" }, location: { city: "Test City", state: "MD" },
      details: [{ question: "Home size", answer: "2 bedrooms and 1 bathroom" }] },
  },
});
function routes() {
  const posts: Record<string, any> = {};
  const app = { post: (path: string, handler: any) => { posts[path] = handler; }, get: () => {} };
  registerThumbTackWebhookRoute(app as any);
  registerThumbTackWebhookCaptureRoute(app as any);
  const res: any = { headersSent: false, status: vi.fn(() => res), json: vi.fn(() => { res.headersSent = true; return res; }) };
  return { legacyUrl: posts["/api/webhooks/thumbtack"], captureUrl: posts["/api/webhooks/thumbtack-capture"], res };
}
beforeEach(() => {
  vi.resetAllMocks();
  envKeys.forEach(key => delete process.env[key]);
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED = "true";
  process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT = "2026-11-16T17:43:22Z";
  process.env.OPENPHONE_PHONE_NUMBER_ID = "PN-offline";
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
  mocks.execute.mockResolvedValue([{ insertId: 501, affectedRows: 1 }]);
  mocks.dispatch.mockImplementation(async captureId => ({ captureId, outcome: "sent", messageId: "OM-offline" }));
  mocks.notify.mockResolvedValue(true); mocks.activity.mockResolvedValue(undefined);
  mocks.sendSms.mockResolvedValue({ success: true }); mocks.setting.mockResolvedValue("");
});
afterEach(() => {
  envKeys.forEach((key, i) => { if (baseline[i] === undefined) delete process.env[key]; else process.env[key] = baseline[i]; });
  vi.unstubAllGlobals();
});

describe("Production native Thumbtack webhook ownership", () => {
  it.each(["legacyUrl", "captureUrl"] as const)("%s preserves the real nested phone and dispatches the exact saved capture after acknowledgement", async endpoint => {
    const h = routes(), body = payload();
    mocks.dispatch.mockImplementation(async captureId => {
      expect(captureId).toBe(501); expect(h.res.headersSent).toBe(true);
      expect(mocks.execute).toHaveBeenCalledOnce();
      return { captureId, outcome: "sent", messageId: "OM-offline" };
    });
    await h[endpoint]({ body }, h.res);
    expect(mocks.dispatch).toHaveBeenCalledWith(501);
    const insert = new MySqlDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(insert.sql).toContain("INSERT INTO webhook_events");
    expect(insert.params).toContain(JSON.stringify(body));
    const projected = capturedThumbtackLead({ id: 501, source: "thumbtack", eventType: "NegotiationCreatedV4",
      receivedAt: new Date("2026-11-23T14:22:12Z"), earliestId: 501, earliestReceivedAt: new Date("2026-11-23T14:22:12Z"),
      rawPayload: JSON.stringify(body) }, { startAt: 0, fromNumberId: "PN-offline" });
    expect(projected).toMatchObject({ phone: "+12025550123", sendEligible: true });
    expect(mocks.sendSms).not.toHaveBeenCalled(); expect(mocks.invokeLLM).not.toHaveBeenCalled();
    expect(mocks.setting).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
    expect(h.res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true, persisted: true }));
  });
  it.each(["MessageCreatedV4", "ReviewCreatedV4"])("the Production URL retains %s without generating another introduction", async eventType => {
    const h = routes(), body = payload(); body.event.eventType = eventType;
    await h.legacyUrl({ body }, h.res);
    expect(mocks.execute).toHaveBeenCalledOnce(); expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled(); expect(mocks.invokeLLM).not.toHaveBeenCalled();
  });
  it("does not fall back to the two-message legacy sender when native dispatch fails", async () => {
    const h = routes(); mocks.dispatch.mockRejectedValue(new Error("OFFLINE_FAILURE"));
    await h.legacyUrl({ body: payload() }, h.res);
    expect(mocks.dispatch).toHaveBeenCalledOnce(); expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(new MySqlDialect().sqlToQuery(mocks.execute.mock.calls[1][0]).sql).toContain("SET processed = 1");
    expect(mocks.sendSms).not.toHaveBeenCalled(); expect(mocks.invokeLLM).not.toHaveBeenCalled();
  });
  it("does not invoke any sender when durable native capture fails", async () => {
    const h = routes(); mocks.execute.mockRejectedValue(new Error("offline persistence failure"));
    await h.legacyUrl({ body: payload() }, h.res);
    expect(h.res.status).toHaveBeenCalledWith(500); expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled(); expect(mocks.invokeLLM).not.toHaveBeenCalled();
  });
  it("routes each native arrival independently without a shared-webhook-ID eligibility check", async () => {
    const h = routes(); let id = 500;
    mocks.execute.mockImplementation(async query => new MySqlDialect().sqlToQuery(query).sql.startsWith("INSERT")
      ? [{ insertId: ++id }] : [{ affectedRows: 1 }]);
    await h.legacyUrl({ body: payload() }, h.res);
    const next = payload(); next.data.negotiationID = "offline-second-negotiation";
    await h.legacyUrl({ body: next }, h.res);
    expect(mocks.dispatch.mock.calls.map(([captureId]) => captureId)).toEqual([501, 502]);
    expect(mocks.sendSms).not.toHaveBeenCalled();
  });
});
