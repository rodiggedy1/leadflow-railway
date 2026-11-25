import { describe, expect, it } from "vitest";
import { CLAUDE_HISTORY_WINDOW, historyWindowStart, withoutQuotedEmailHistory } from "./claudeHistoryWindow";

describe("history window sent to Claude (stored history is never changed)", () => {
  it("keeps the last 30 messages, or everything for shorter conversations", () => {
    expect(CLAUDE_HISTORY_WINDOW).toBe(30);
    expect(historyWindowStart(0)).toBe(0);
    expect(historyWindowStart(5)).toBe(0);
    expect(historyWindowStart(30)).toBe(0);
    expect(historyWindowStart(31)).toBe(1);
    expect(historyWindowStart(651)).toBe(621);
  });
  it("always includes the message being answered, widening the window if needed", () => {
    expect(historyWindowStart(100, 99)).toBe(70);
    expect(historyWindowStart(100, 80)).toBe(70);
    expect(historyWindowStart(100, 10)).toBe(10);
    expect(historyWindowStart(100, -1)).toBe(70);
  });
});

describe("earlier email text without the thread quoted inside it", () => {
  it("cuts at the Gmail/Apple reply separator", () => {
    expect(withoutQuotedEmailHistory("Friday works, thanks!\n\nOn Mon, Nov 17, 2026 at 9:00 AM Office <office@example.com> wrote:\n> Which day works?\n> Thanks"))
      .toBe("Friday works, thanks!");
  });
  it("cuts at Outlook separators", () => {
    expect(withoutQuotedEmailHistory("Please add the oven.\r\n\r\n-----Original Message-----\r\nFrom: Office\r\nOld text")).toBe("Please add the oven.");
    expect(withoutQuotedEmailHistory("Please add the oven.\n\nFrom: Office <office@example.com>\nSent: Monday\nTo: Alex\nOld text")).toBe("Please add the oven.");
  });
  it("removes >-quoted lines but keeps answers written between them", () => {
    expect(withoutQuotedEmailHistory("> What time?\n10am please\n> Any pets?\nOne cat")).toBe("10am please\nOne cat");
  });
  it("leaves text with nothing quoted byte-for-byte unchanged", () => {
    for (const text of ["full history ".repeat(50), "Line one\nLine two  \n\n", "From: me\nno sent line here", "Someone wrote: hello"])
      expect(withoutQuotedEmailHistory(text)).toBe(text);
  });
  it("never empties a message: an all-quoted email is kept as it is", () => {
    const text = "On Mon, Nov 17, 2026, Office wrote:\n> Old";
    expect(withoutQuotedEmailHistory(text)).toBe(text);
    expect(withoutQuotedEmailHistory("> only quoted")).toBe("> only quoted");
  });
});
