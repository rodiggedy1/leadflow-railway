import { describe, expect, it } from "vitest";
import { getSmsQueueLastRole, shouldShowSmsQueueCard } from "./madisonRouter";

describe("Madison queue visibility", () => {
  it("shows a card when the customer sent the latest message", () => {
    expect(shouldShowSmsQueueCard("user", "RECEIVED")).toBe(true);
    expect(shouldShowSmsQueueCard("user", "TOOLS_RUNNING")).toBe(true);
  });

  it("hides non-pending cards when Madison or an agent sent the latest message", () => {
    expect(shouldShowSmsQueueCard("assistant", "SENT")).toBe(false);
    expect(shouldShowSmsQueueCard("assistant", "RECEIVED")).toBe(false);
    expect(shouldShowSmsQueueCard("unknown", "FAILED")).toBe(false);
  });

  it("keeps a DRAFT_READY reply visible for owner approval", () => {
    expect(shouldShowSmsQueueCard("assistant", "DRAFT_READY")).toBe(true);
    expect(shouldShowSmsQueueCard(null, "DRAFT_READY")).toBe(true);
  });

  it("falls back to message history when the summary role is missing", () => {
    expect(getSmsQueueLastRole(JSON.stringify([{ role: "assistant" }, { role: "user" }]), null)).toBe("user");
    expect(getSmsQueueLastRole(JSON.stringify([{ role: "user" }, { role: "assistant" }]), "unknown")).toBe("assistant");
    expect(getSmsQueueLastRole("not-json", null)).toBe(null);
  });
});
