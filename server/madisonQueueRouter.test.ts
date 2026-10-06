import { describe, expect, it } from "vitest";
import { getSmsQueueLastRole, shouldShowSmsQueueCard } from "./madisonRouter";

describe("Madison queue visibility", () => {
  it("shows a card when the customer sent the latest message", () => {
    expect(shouldShowSmsQueueCard("user")).toBe(true);
  });

  it("hides cards when Madison or the office sent the latest message", () => {
    expect(shouldShowSmsQueueCard("assistant")).toBe(false);
    expect(shouldShowSmsQueueCard("unknown")).toBe(false);
    expect(shouldShowSmsQueueCard(null)).toBe(false);
  });

  it("does not let DRAFT_READY status keep a stale assistant-last card visible", () => {
    expect(shouldShowSmsQueueCard("assistant")).toBe(false);
  });

  it("falls back to message history when the summary role is missing", () => {
    expect(getSmsQueueLastRole(JSON.stringify([{ role: "assistant" }, { role: "user" }]), null)).toBe("user");
    expect(getSmsQueueLastRole(JSON.stringify([{ role: "user" }, { role: "assistant" }]), "unknown")).toBe("assistant");
    expect(getSmsQueueLastRole("not-json", null)).toBe(null);
  });
});
