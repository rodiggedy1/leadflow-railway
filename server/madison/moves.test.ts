import { describe, expect, it } from "vitest";
import { buildCancellationOpeningMoves, buildFillCapacityMove, shouldObserveCancellationTransition } from "./moves";

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
});
