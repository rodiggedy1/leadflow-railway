import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), oldNative: vi.fn(), dispatch: vi.fn() }));
vi.mock("../db", () => ({ getDb: async () => ({ execute: mocks.execute }) }));
vi.mock("../thumbtackWebhook", () => ({ handleNativeThumbTackLead: mocks.oldNative }));
vi.mock("./claudeThumbtackFirstResponseApplication", () => ({ dispatchClaudeThumbtackFirstResponse: mocks.dispatch }));
import { registerThumbTackWebhookCaptureRoute } from "../thumbtackWebhookCapture";
const vars = ["THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED", "THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT", "OPENPHONE_PHONE_NUMBER_ID"];
const baseline = vars.map(key => process.env[key]);
afterEach(() => { vars.forEach((key, i) => { if (baseline[i] === undefined) delete process.env[key]; else process.env[key] = baseline[i]; }); vi.clearAllMocks(); });
function route() {
  let post: any;
  registerThumbTackWebhookCaptureRoute({ get: () => {}, post: (_: string, handler: any) => { post = handler; } } as any);
  const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) };
  return { post, res, body: { event: { eventType: "NegotiationCreatedV4", webhookID: "delivery-1" }, data: { negotiationID: "n1" } } };
}
function on() { process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED = "true"; process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_START_AT = "2026-11-16T17:00:00Z"; process.env.OPENPHONE_PHONE_NUMBER_ID = "PN-lead"; }
describe("offline native capture hook", () => {
  it("disabled saves untouched payload, acknowledges then delegates exact existing native lifecycle", async () => {
    delete process.env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED; const { post, res, body } = route();
    mocks.execute.mockResolvedValueOnce([{ insertId: 7 }]).mockResolvedValueOnce([[{ id: 7 }]]).mockResolvedValueOnce([{}]);
    mocks.oldNative.mockImplementation(async value => { expect(res.json).toHaveBeenCalled(); expect(value).toBe(body); });
    await post({ body }, res); expect(mocks.oldNative).toHaveBeenCalledTimes(1); expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).toBe('{"event":{"eventType":"NegotiationCreatedV4","webhookID":"delivery-1"},"data":{"negotiationID":"n1"}}');
  });
  it("active path dispatches exact durable insertID after ACK, never invokes old model/template lifecycle", async () => {
    on(); const { post, res, body } = route(); mocks.execute.mockResolvedValue([{ insertId: 7 }]);
    mocks.dispatch.mockImplementation(async id => { expect(id).toBe(7); expect(res.json).toHaveBeenCalled(); expect(mocks.execute).toHaveBeenCalledTimes(1); });
    await post({ body }, res); expect(mocks.dispatch).toHaveBeenCalledTimes(1); expect(mocks.oldNative).not.toHaveBeenCalled();
  });
  it("active rejected/failed dispatcher has no fallback; nonlead notifications are capture only", async () => {
    on(); const { post, res, body } = route(); mocks.execute.mockResolvedValue([{ insertId: 7 }]); mocks.dispatch.mockRejectedValue(new Error("generation failed"));
    await post({ body }, res); expect(mocks.oldNative).not.toHaveBeenCalled(); mocks.dispatch.mockClear();
    await post({ body: { event: { eventType: "MessageCreatedV4" } } }, res); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("failed durable capture never dispatches", async () => {
    on(); const { post, res, body } = route(); mocks.execute.mockRejectedValue(new Error("capture unavailable"));
    await post({ body }, res); expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.oldNative).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(500);
  });
});
