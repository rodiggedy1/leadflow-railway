import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), broadcast: vi.fn(), reschedule: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { router: t.router, agentProcedure: t.procedure, bookingsAgentProcedure: t.procedure, opsChatProcedure: t.procedure, agentPageProcedure: () => t.procedure };
});
vi.mock("./leadflowCallMatrixRouter", async () => {
  const { initTRPC } = await import("@trpc/server"); return { leadflowCallMatrixRouter: initTRPC.create().router({}) };
});
vi.mock("./cleanerPortalUpdates", () => ({ broadcastCleanerPortalJobsChanged: mocks.broadcast }));
vi.mock("./openphone", () => ({ sendSms: vi.fn(() => { throw new Error("SMS prohibited"); }) }));
vi.mock("./leadflowJobsService", () => ({
  LEADFLOW_JOB_ORIGIN_LAUNCH27: "launch27_import", importLaunch27JobsForDate: vi.fn(),
  importNextThirtyDaysOfLaunch27Jobs: vi.fn(), refreshImportedLaunch27JobDetails: vi.fn(),
}));
vi.mock("./bookingRescheduleService", () => ({
  rescheduleOperationalBooking: mocks.reschedule,
  operationalBookingLocalTime: (value: string | null) => value ? "09:00" : null,
}));
import { leadflowJobsRouter } from "./leadflowJobsRouter";

let db: any;
let row: Record<string, any>;
let events: string[];
beforeEach(() => {
  vi.clearAllMocks(); events = [];
  row = { id: 10, jobDate: "2026-10-30", serviceDateTime: "2026-10-30T13:00:00Z", frequency: "Weekly", bookingStatus: "assigned", jobTotalCents: 21500, teamId: 7 };
  db = {
    transaction: async (callback: (tx: any) => Promise<unknown>) => {
      events.push("begin"); const draft = { ...row };
      const tx = {
        select: () => {
          const chain = { from: () => chain, where: () => chain, limit: () => chain, for: () => chain,
            then: (resolve: (value: any[]) => unknown) => Promise.resolve([{ ...draft }]).then(resolve) };
          return chain;
        },
        update: () => ({ set: (values: any) => ({ where: async () => { events.push("frequency-update"); Object.assign(draft, values); } }) }),
      };
      try { const result = await callback(tx); row = draft; events.push("commit"); return result; }
      catch (error) { events.push("rollback"); throw error; }
    },
  };
  mocks.getDb.mockResolvedValue(db);
  mocks.broadcast.mockImplementation(() => events.push("broadcast"));
  mocks.reschedule.mockImplementation(async () => { events.push("reschedule"); return { selectedJobId: 10, movedCount: 1, continuationCreated: false }; });
});
const caller = () => leadflowJobsRouter.createCaller({} as any);

describe("operational schedule mutation", () => {
  it.each(["visit", "subsequent"] as const)("retains submitted jobTime and forwards explicit %s choice inside transaction", async rescheduleMode => {
    const result = await caller().update({ jobId: 10, jobDate: "2026-11-02", jobTime: "14:30", rescheduleMode });
    expect(mocks.reschedule).toHaveBeenCalledWith(expect.objectContaining({ select: expect.any(Function), update: expect.any(Function) }), {
      jobId: 10, previousLocalDate: "2026-10-30", requestedLocalDate: "2026-11-02", requestedLocalTime: "14:30", mode: rescheduleMode,
    });
    expect(result).toEqual({ id: 10, jobDate: "2026-11-02", jobTime: "14:30", frequency: "Weekly" });
    expect(events).toEqual(["begin", "reschedule", "commit", "broadcast"]);
  });
  it("supports time-only moves", async () => {
    await caller().update({ jobId: 10, jobTime: "14:30", rescheduleMode: "visit" });
    expect(mocks.reschedule.mock.calls[0][1]).toMatchObject({ requestedLocalDate: "2026-10-30", requestedLocalTime: "14:30" });
  });
  it("preserves the existing local time for date-only updates", async () => {
    await caller().update({ jobId: 10, jobDate: "2026-11-02", rescheduleMode: "visit" });
    expect(mocks.reschedule.mock.calls[0][1]).toMatchObject({ requestedLocalTime: "09:00" });
  });
  it("preserves frequency-only behavior without invoking reschedule or requiring a mode", async () => {
    expect(await caller().update({ jobId: 10, frequency: "Monthly" })).toMatchObject({ jobDate: "2026-10-30", frequency: "Monthly" });
    expect(row.frequency).toBe("Monthly"); expect(mocks.reschedule).not.toHaveBeenCalled();
    expect(events).toEqual(["begin", "frequency-update", "commit", "broadcast"]);
  });
  it("does not trigger recurrence logic for an unchanged date/time", async () => {
    await caller().update({ jobId: 10, jobDate: "2026-10-30", jobTime: "09:00" });
    expect(mocks.reschedule).not.toHaveBeenCalled(); expect(events).toEqual(["begin", "commit", "broadcast"]);
  });
  it("rolls back without frequency edits or broadcasts on reschedule collision or missing choice", async () => {
    const before = { ...row };
    mocks.reschedule.mockRejectedValue(new Error("Choose Move only this visit or Shift subsequent visits"));
    await expect(caller().update({ jobId: 10, jobDate: "2026-11-02", jobTime: "14:30", frequency: "Monthly" })).rejects.toThrow("Choose Move only");
    expect(mocks.reschedule.mock.calls[0][1].mode).toBeUndefined();
    expect(row).toEqual(before); expect(events).toEqual(["begin", "rollback"]); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("rejects invalid date/time/mode before transaction or DB access", async () => {
    await expect(caller().update({ jobId: 10, jobTime: "24:01" })).rejects.toThrow();
    await expect(caller().update({ jobId: 10, jobDate: "2026-02-30" })).rejects.toThrow();
    await expect(caller().update({ jobId: 10, jobTime: "09:00", rescheduleMode: "all" as any })).rejects.toThrow();
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("requires a chosen time for a date move when original time is unknown", async () => {
    row.serviceDateTime = null;
    await expect(caller().update({ jobId: 10, jobDate: "2026-11-02", rescheduleMode: "visit" })).rejects.toThrow("Choose a booking time");
    expect(mocks.reschedule).not.toHaveBeenCalled(); expect(events).toEqual(["begin", "rollback"]);
  });
});
