import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ enqueue: vi.fn(), history: vi.fn(), inbox: vi.fn(), broadcast: vi.fn(), state: "100" }));
vi.mock("./gmailGlanceWorker", () => ({ enqueueThread: h.enqueue, backfillGlanceQueue: vi.fn() }));
vi.mock("./gmailService", () => ({
  getHistoryEvents: h.history, listInboxThreads: h.inbox, getGmailAuthUrl: vi.fn(), exchangeCodeForTokens: vi.fn(), clearRefreshTokenCache: vi.fn(), setupGmailWatch: vi.fn(),
}));
vi.mock("./_core/env", () => ({ ENV: {} }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: h.broadcast }));
vi.mock("../drizzle/schema", () => ({ gmailState: { id: "id" }, gmailThreadMeta: { threadId: "threadId" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => ({
  select: () => ({ from: () => ({ where: async () => [{ historyId: h.state }] }) }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
}) }));
const events = (newMessages: Array<{ id: string; threadId: string; date: number }> = []) => ({ newMessages, markRead: new Set(), markUnread: new Set(), markArchived: new Set(), markInboxed: new Set() });
async function webhook() {
  const routes = new Map<string, Function>();
  (await import("./gmailRoutes")).registerGmailRoutes({ get: () => {}, post: (path: string, handler: Function) => routes.set(path, handler) } as any);
  const res = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
  await routes.get("/api/gmail/webhook")!({ body: { message: { data: Buffer.from(JSON.stringify({ historyId: "101" })).toString("base64") } } }, res);
  return res;
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); h.state = "100";
  vi.spyOn(Date, "now").mockReturnValue(2000);
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  h.history.mockResolvedValue(events()); h.inbox.mockResolvedValue({ threads: [] });
});
afterEach(() => vi.restoreAllMocks());
describe("genuine Gmail webhook anchors", () => {
  it("carries every exact history-event Gmail ID and webhook receipt time without inventing IDs or using a historic date as receipt", async () => {
    h.history.mockResolvedValue(events([{ id: "message-first", threadId: "thread-actual", date: 500 }, { id: "message-current", threadId: "thread-actual", date: 1000 }]));
    const res = await webhook();
    expect(h.enqueue.mock.calls).toEqual([
      ["thread-actual", "pubsub", { inboundMessageId: "message-first", receivedAt: 2000 }],
      ["thread-actual", "pubsub", { inboundMessageId: "message-current", receivedAt: 2000 }],
    ]);
    expect(h.inbox).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(200);
  });
  it("preserves history-gap fallback but gives it no synthetic inbound anchor", async () => {
    h.inbox.mockResolvedValue({ threads: [{ id: "fallback-thread" }] });
    await webhook(); expect(h.enqueue.mock.calls).toEqual([["fallback-thread", "pubsub"]]);
  });
  it("preserves first-history notification with no processing", async () => {
    h.state = "0"; await webhook(); expect(h.history).not.toHaveBeenCalled(); expect(h.enqueue).not.toHaveBeenCalled();
  });
  it("preserves no-new-thread and label-only paths without automatic customer processing", async () => {
    const result = events(); result.markRead.add("thread-label-only"); h.history.mockResolvedValue(result);
    await webhook(); expect(h.enqueue).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled();
  });
});
