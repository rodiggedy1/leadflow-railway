import { describe, expect, it } from "vitest";
import { computeSessionSummary } from "./sessionSummary";

describe("computeSessionSummary", () => {
  it("returns empty summary fields for empty history", () => {
    expect(computeSessionSummary([])).toEqual({
      lastMessageText: null,
      lastMessageTs: null,
      lastCustomerMessageTs: null,
      lastMessageRole: null,
      messageCount: 0,
    });
  });

  it("uses the latest valid numeric timestamp rather than final array position", () => {
    expect(
      computeSessionSummary([
        { role: "assistant", content: "Latest chronologically", ts: 2_000 },
        { role: "user", content: "Older but appended later", ts: 1_000 },
      ]),
    ).toEqual({
      lastMessageText: "Latest chronologically",
      lastMessageTs: 2_000,
      lastCustomerMessageTs: 1_000,
      lastMessageRole: "assistant",
      messageCount: 2,
    });
  });

  it("uses the later original array ordinal when timestamps tie", () => {
    expect(
      computeSessionSummary([
        { role: "user", content: "Customer at shared timestamp", ts: 2_000 },
        { role: "assistant", content: "Assistant at shared timestamp", ts: 2_000 },
      ]),
    ).toEqual({
      lastMessageText: "Assistant at shared timestamp",
      lastMessageTs: 2_000,
      lastCustomerMessageTs: 2_000,
      lastMessageRole: "assistant",
      messageCount: 2,
    });
  });

  it("uses the later original ordinal without inventing a timestamp when every entry lacks one", () => {
    expect(
      computeSessionSummary([
        { role: "user", content: "First without timestamp" },
        { role: "assistant", content: "Last without timestamp" },
      ]),
    ).toEqual({
      lastMessageText: "Last without timestamp",
      lastMessageTs: null,
      lastCustomerMessageTs: null,
      lastMessageRole: "assistant",
      messageCount: 2,
    });
  });

  it("uses the latest user or customer entry for the customer timestamp", () => {
    expect(
      computeSessionSummary([
        { role: "user", content: "Initial customer message", ts: 1_000 },
        { role: "assistant", content: "Agent reply", ts: 2_000 },
        { role: "customer", content: "Later customer message", ts: 3_000 },
        { role: "assistant", content: "Final assistant reply", ts: 4_000 },
      ]),
    ).toEqual({
      lastMessageText: "Final assistant reply",
      lastMessageTs: 4_000,
      lastCustomerMessageTs: 3_000,
      lastMessageRole: "assistant",
      messageCount: 4,
    });
  });

  it("keeps role, text, and timestamp from one final chronological entry and truncates only its text", () => {
    const finalText = "x".repeat(300);

    expect(
      computeSessionSummary([
        { role: "user", content: "Customer message", ts: 1_000 },
        { role: "assistant", content: finalText, ts: 2_000 },
      ]),
    ).toEqual({
      lastMessageText: finalText.slice(0, 255),
      lastMessageTs: 2_000,
      lastCustomerMessageTs: 1_000,
      lastMessageRole: "assistant",
      messageCount: 2,
    });
  });
});
