import { describe, expect, it } from "vitest";
import { getSmsQueueLastRole, shouldShowSmsQueueCard } from "./madisonRouter";

describe("Madison queue visibility", () => {
  it("shows a card when the stored conversation history ends with the client", () => {
    expect(getSmsQueueLastRole(JSON.stringify([{ role: "assistant" }, { role: "user" }]))).toBe("user");
    expect(shouldShowSmsQueueCard(getSmsQueueLastRole(JSON.stringify([{ role: "assistant" }, { role: "user" }])))).toBe(true);
  });

  it("hides a card when the stored conversation history ends with Madison", () => {
    expect(getSmsQueueLastRole(JSON.stringify([{ role: "user" }, { role: "assistant" }]))).toBe("assistant");
    expect(shouldShowSmsQueueCard(getSmsQueueLastRole(JSON.stringify([{ role: "user" }, { role: "assistant" }])))).toBe(false);
  });

  it("ignores a stale summary role and trusts the actual history", () => {
    // The old summary said user for this shape, but the visible conversation
    // ends with Madison. The card must not enter the client-response queue.
    expect(getSmsQueueLastRole(JSON.stringify([{ role: "user" }, { role: "assistant" }]))).toBe("assistant");
    expect(shouldShowSmsQueueCard("assistant")).toBe(false);
  });

  it("ignores internal notes after the latest SMS", () => {
    expect(getSmsQueueLastRole(JSON.stringify([
      { role: "user" },
      { role: "assistant" },
      { role: "note" },
    ]))).toBe("assistant");
  });

  it("does not show malformed or empty history", () => {
    expect(getSmsQueueLastRole("not-json")).toBe(null);
    expect(getSmsQueueLastRole("[]")).toBe(null);
    expect(shouldShowSmsQueueCard(null)).toBe(false);
  });
});
