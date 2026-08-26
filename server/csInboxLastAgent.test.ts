import { describe, expect, it } from "vitest";
import { findLastExactActiveAgentName } from "./csInboxLastAgent";

describe("CsInbox active-card last agent resolver", () => {
  const activeAgents = new Map([
    ["rohan", "Rohan"],
    ["diane", "Diane"],
  ]);

  it("scans backward past customer, automation, blank, and unmatched senders to an exact active agent", () => {
    expect(findLastExactActiveAgentName(JSON.stringify([
      { role: "assistant", senderName: "Rohan" },
      { role: "user" },
      { role: "assistant", senderName: "OpenPhone" },
      { role: "assistant", senderName: "" },
      { role: "assistant", senderName: "Unknown" },
    ]), activeAgents)).toBe("Rohan");
  });

  it("uses trimmed case-normalized exact matching and never guesses partial names", () => {
    expect(findLastExactActiveAgentName(JSON.stringify([
      { role: "assistant", senderName: "  dIaNe  " },
    ]), activeAgents)).toBe("Diane");
    expect(findLastExactActiveAgentName(JSON.stringify([
      { role: "assistant", senderName: "Diane Ruiz" },
    ]), activeAgents)).toBeNull();
  });
});
