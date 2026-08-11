import { describe, expect, it } from "vitest";
import { getLatestGmailMessageMetadata } from "./gmailThreadMetadata";

describe("getLatestGmailMessageMetadata", () => {
  it("returns the exact identity and timestamp of the newest Gmail message", () => {
    expect(getLatestGmailMessageMetadata([
      { id: "customer-message", internalDate: "1786452400000" },
      { id: "agent-message", internalDate: "1786452506000" },
    ])).toEqual({
      latestMessageId: "agent-message",
      lastMessageAt: 1786452506000,
    });
  });

  it("keeps legacy or incomplete threads direction-neutral", () => {
    expect(getLatestGmailMessageMetadata([])).toEqual({
      latestMessageId: null,
      lastMessageAt: 0,
    });
  });
});
