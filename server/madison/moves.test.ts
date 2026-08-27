import { describe, expect, it } from "vitest";
import { shouldObserveCancellationTransition } from "./moves";

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
