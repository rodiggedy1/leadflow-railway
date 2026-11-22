import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { createNativeIntroductionFailureReporter } from "./claudeThumbtackFirstResponseFailure";
import { capturedThumbtackLead, thumbtackFirstResponseConfig, type FirstResponseFailure } from "./claudeThumbtackFirstResponse";
function fixture() {
  const config = thumbtackFirstResponseConfig({ THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED: "true", OPENPHONE_PHONE_NUMBER_ID: "PN-test" })!;
  const lead = capturedThumbtackLead({ id: 7, source: "thumbtack", eventType: "NegotiationCreatedV4", receivedAt: new Date(),
    rawPayload: JSON.stringify({ event: { eventType: "NegotiationCreatedV4" }, data: { negotiationID: "offline-negotiation", customer: { firstName: "Jane", phone: "+17035551234" } } }) }, config)!;
  const failure: FirstResponseFailure = { captureId: 7, lead, claim: null, stage: "claim", code: "CLAIM_FAILED", uncertain: false };
  let state: any = { tasks: [], notices: [], next: 10 };
  let failTable = "";
  let tail = Promise.resolve();
  const db: any = {
    async transaction(run: any) {
      let release!: () => void; const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const before = structuredClone(state);
      try { return await run(db); } catch (error) { state = before; throw error; } finally { release(); }
    },
    async execute(query: any) {
      const q = new MySqlDialect().sqlToQuery(query);
      if (q.sql.includes("webhook_events")) return [[{ id: 7 }]];
      if (q.sql.includes("ops_chat_messages")) return [state.notices.filter((row: any) => row.activeDedupKey === q.params[0])];
      throw new Error("Unmocked query");
    },
    insert(table: any) { return { values: async (value: any) => {
      const name = getTableName(table); if (failTable === name) throw new Error("offline persistence failure");
      const id = ++state.next;
      (name === "ops_tasks" ? state.tasks : state.notices).push({ id, ...value });
      return [{ insertId: id }];
    } }; },
  };
  const notify = vi.fn(async () => true), refresh = vi.fn(async () => {});
  return { failure, db, notify, refresh, state: () => state, fail: (table: string) => { failTable = table; },
    report: createNativeIntroductionFailureReporter({ db, notify, refresh }) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("native introduction failure escalation offline", () => {
  it("creates a real existing operational task and Command Chat notice even before a receipt/session committed", async () => {
    const h = fixture(); await h.report(h.failure);
    expect(h.state().tasks).toHaveLength(1); expect(h.state().notices).toHaveLength(1);
    expect(h.state().tasks[0]).toMatchObject({ priority: "urgent", status: "todo", createdByAgentName: "Claude" });
    expect(h.state().tasks[0].description).toContain("Failure before an introduction receipt committed");
    expect(h.state().notices[0].sessionId).toBeNull();
    expect(JSON.parse(h.state().notices[0].metadata).opsTaskId).toBe(h.state().tasks[0].id);
    expect(h.notify).toHaveBeenCalledOnce(); expect(h.refresh).toHaveBeenCalledOnce();
  });
  it("deduplicates repeated and concurrent reports of the same introduction, not other new lead cards", async () => {
    const h = fixture(); await Promise.all([h.report(h.failure), h.report({ ...h.failure, captureId: 8 })]);
    await h.report(h.failure);
    expect(h.state().tasks).toHaveLength(1); expect(h.state().notices).toHaveLength(1); expect(h.notify).toHaveBeenCalledOnce();
    await h.report({ ...h.failure, lead: { ...h.failure.lead!, key: "tt-first:v1:different-new-card" } });
    expect(h.state().tasks).toHaveLength(2); expect(h.notify).toHaveBeenCalledTimes(2);
  });
  it("retains uncertainty and directs staff to inspect Quo without claiming the SMS failed or retrying", async () => {
    const h = fixture(); await h.report({ ...h.failure, stage: "submission", code: "SUBMISSION_UNCERTAIN", uncertain: true });
    expect(h.state().tasks[0].description).toContain("submission may already have been accepted");
    expect(h.state().tasks[0].description).toContain("Check the existing Quo conversation before sending anything");
    expect(JSON.parse(h.state().notices[0].metadata).responseFailure.uncertain).toBe(true);
  });
  it.each(["ops_tasks", "ops_chat_messages"])("%s persistence failure rolls back and still attempts the independent owner alert", async table => {
    const h = fixture(); h.fail(table); vi.spyOn(console, "error").mockImplementation(() => {});
    await h.report(h.failure);
    expect(h.state().tasks).toHaveLength(0); expect(h.state().notices).toHaveLength(0);
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Staff task could not be saved") }));
  });
  it("database unavailability does not prevent an owner notification attempt", async () => {
    const h = fixture(); vi.spyOn(console, "error").mockImplementation(() => {});
    await createNativeIntroductionFailureReporter({ db: null, notify: h.notify, refresh: h.refresh })(h.failure);
    expect(h.notify).toHaveBeenCalledOnce(); expect(h.refresh).not.toHaveBeenCalled();
  });
  it("an unavailable notification keeps the committed task and emits an explicit diagnostic", async () => {
    const h = fixture(); h.notify.mockResolvedValue(false); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await h.report(h.failure);
    expect(h.state().tasks).toHaveLength(1);
    expect(log).toHaveBeenCalledWith("[ThumbtackClaude] owner failure notification unavailable", expect.objectContaining({ persisted: true }));
  });
  it("a hanging notification cannot hang the response after the task committed", async () => {
    vi.useFakeTimers(); const h = fixture(); h.notify.mockImplementation(() => new Promise(() => {}));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = h.report(h.failure); await vi.advanceTimersByTimeAsync(5_001); await pending;
    expect(h.state().tasks).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  });
});
