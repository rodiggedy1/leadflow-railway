import { describe, expect, it } from "vitest";
import { buildCancellationOpeningMoves, buildFillCapacityMove, buildProtectTomorrowMove, listMadisonMoveHistory, listMadisonMoves, shouldObserveCancellationTransition } from "./moves";

describe("Madison’s Moves cancellation observation", () => {
  it("records only an active booking becoming cancelled", () => {
    expect(shouldObserveCancellationTransition("assigned", "cancelled")).toBe(true);
  });

  it("records only an active booking becoming rescheduled", () => {
    expect(shouldObserveCancellationTransition("assigned", "rescheduled")).toBe(true);
  });

  it("does not invent an opening from a missing, unchanged, or terminal status", () => {
    expect(shouldObserveCancellationTransition(null, "cancelled")).toBe(false);
    expect(shouldObserveCancellationTransition("assigned", "assigned")).toBe(false);
    expect(shouldObserveCancellationTransition("cancelled", "rescheduled")).toBe(false);
    expect(shouldObserveCancellationTransition("completed", "cancelled")).toBe(false);
  });
});

describe("Madison’s Moves Fill Capacity", () => {
  const source = { bookingId: 714, jobDate: "2026-08-28", address: "12 Main St, Washington, DC 20001", previousStatus: "assigned", nextStatus: "cancelled" };
  const lead = { name: "Taylor Customer", phone: "+12025550123", reason: "Qualified quote lead in the opening’s area" };

  it("builds a review-first capacity move only from a verified cancellation opening", () => {
    const move = buildFillCapacityMove({ parentMoveKey: "cancel:714:2026-08-28", source, recipients: [lead], exclusions: ["STOP opt-out"], status: "ready" });
    expect(move).toMatchObject({ kind: "fill_capacity", moveKey: "fill:cancel:714:2026-08-28", eligibleCount: 1, excludedCount: 1 });
    expect(move?.recipients).toEqual([lead]);
    expect(move?.draftMessage).toContain("opening available");
  });

  it("does not create a sendable capacity move with no safe recipient or after dismissal", () => {
    expect(buildFillCapacityMove({ parentMoveKey: "cancel:714:2026-08-28", source, recipients: [], exclusions: ["STOP opt-out"], status: "ready" })).toBeNull();
    expect(buildFillCapacityMove({ parentMoveKey: "cancel:714:2026-08-28", source, recipients: [lead], exclusions: [], status: "dismissed" })).toBeNull();
  });

  it("returns the cancellation card and its derived Fill Capacity card from one observed opening", () => {
    const pair = buildCancellationOpeningMoves({
      parentMoveKey: "cancel:714:2026-08-28",
      source,
      recipients: [lead],
      exclusions: ["STOP opt-out"],
      fillStatus: "ready",
      cancellationId: 9,
    });
    expect(pair.cancellation).toMatchObject({ kind: "save_cancellation", moveKey: "cancel:714:2026-08-28", eligibleCount: 1 });
    expect(pair.fill).toMatchObject({ kind: "fill_capacity", moveKey: "fill:cancel:714:2026-08-28", eligibleCount: 1 });
  });

  it("turns a stored active cancellation observation into a live Fill Capacity move", async () => {
    const moves = await listMadisonMoves({} as any, {
      storedMoveRows: async () => [{ id: 9, cardStatus: "active", metadata: JSON.stringify({ moveKey: "cancel:714:2026-08-28", kind: "save_cancellation", source }) }],
      computeReadinessSummary: async () => ({ totalIssues: 0 }) as any,
      eligibleQualifiedLeads: async (_db, options) => {
        if (options?.area) expect(options.area).toBe("zip:20001");
        return { recipients: [lead], exclusions: [] };
      },
    });
    expect(moves.map((move) => move.kind)).toEqual(expect.arrayContaining(["save_cancellation", "fill_capacity"]));
    expect(moves.find((move) => move.kind === "fill_capacity")).toMatchObject({ moveKey: "fill:cancel:714:2026-08-28", recipients: [lead] });
  });

  it("reconstructs original dismissal details from the stored History snapshot", async () => {
    const [history] = await listMadisonMoveHistory({} as any, {
      storedMoveRows: async () => [{
        id: 11,
        cardStatus: "dismissed",
        metadata: JSON.stringify({ moveKey: "protect:2026-08-28", kind: "protect_tomorrow", outcome: "dismissed", snapshot: {
          moveKey: "protect:2026-08-28", kind: "protect_tomorrow", priority: "urgent", headline: "2 verified items could affect tomorrow", businessReason: "One schedule and one confirmation issue are open.", impact: "Protect tomorrow’s scheduled revenue.", eligibleCount: 0, excludedCount: 0, excludedReasons: [], recipients: [], details: ["Taylor is unassigned."], status: "ready",
        } }),
      }],
    });
    expect(history).toMatchObject({ id: 11, status: "dismissed", headline: "2 verified items could affect tomorrow", details: ["Taylor is unassigned."] });
  });
});

describe("Madison’s Moves Protect Tomorrow", () => {
  it("lists every category in the headline breakdown and expanded details that contributes to the verified total", () => {
    const move = buildProtectTomorrowMove({
      tomorrow: "2026-08-28", status: "ready",
      readiness: {
        totalIssues: 5,
        dimensions: {
          jobs: { issueCount: 1, unassigned: [{ customerName: "Jordan", jobTime: "9:00 AM" }], doubleBooked: [] },
          teams: { issueCount: 1, rows: [{ name: "Team One", confirmed: false, jobCount: 2 }] },
          payments: { issueCount: 1, rows: [{ customerName: "Taylor", jobTime: "10:00 AM", status: "no_card" }] },
          confirmations: { issueCount: 1, rows: [{ customerName: "Casey", jobTime: "11:00 AM", status: "pending" }] },
          clientRequests: { issueCount: 1, rows: [{ customerName: "Riley", requestedTeam: "Team Two", assignedTeam: null, status: "unassigned" }] },
        },
      } as any,
    });
    expect(move?.businessReason).toContain("1 schedule, 1 team, 1 payment, 1 confirmation, 1 client request");
    expect(move?.details).toHaveLength(5);
    expect(move?.details).toEqual(expect.arrayContaining([expect.stringContaining("Team One"), expect.stringContaining("Taylor"), expect.stringContaining("Riley")]));
  });
});
