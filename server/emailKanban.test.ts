import { describe, expect, it } from "vitest";
import { getEmailKanbanColumn } from "../client/src/lib/emailKanban";

const now = 1_786_452_506_000;

describe("getEmailKanbanColumn", () => {
  it("puts an exact latest sent-log ID match in Waiting on Customer", () => {
    expect(getEmailKanbanColumn({
      latestMessageId: "agent-message",
      latestSentMessageId: "agent-message",
      lastMessageAt: now - 60 * 60 * 1000,
      messageCount: 2,
    }, now)).toBe("Waiting on Customer");
  });

  it("returns a thread to customer-age classification when a newer customer message has a different ID", () => {
    expect(getEmailKanbanColumn({
      latestMessageId: "customer-message",
      latestSentMessageId: "agent-message",
      lastMessageAt: now - 31 * 60 * 1000,
      messageCount: 3,
    }, now)).toBe("At Risk");
  });

  it("does not falsely classify a legacy null ID as agent-last", () => {
    expect(getEmailKanbanColumn({
      latestMessageId: null,
      latestSentMessageId: "agent-message",
      lastMessageAt: now - 5 * 60 * 1000,
      messageCount: 2,
    }, now)).toBe("New");
  });
});
