import { describe, expect, it } from "vitest";
import { keepLatestEmailThreadPerSender } from "./emailInbox";

describe("keepLatestEmailThreadPerSender", () => {
  it("keeps the first newest-first row for each normalized sender email", () => {
    const rows = [
      { threadId: "newest-rohan", senderEmail: " Rohan@Innclusive.com " },
      { threadId: "newest-other", senderEmail: "other@example.com" },
      { threadId: "older-rohan", senderEmail: "rohan@innclusive.com" },
    ];
    expect(keepLatestEmailThreadPerSender(rows)).toEqual([rows[0], rows[1]]);
  });

  it("does not merge blank sender-email rows", () => {
    const rows = [
      { threadId: "blank-one", senderEmail: null },
      { threadId: "blank-two", senderEmail: "   " },
    ];
    expect(keepLatestEmailThreadPerSender(rows)).toEqual(rows);
  });
});
