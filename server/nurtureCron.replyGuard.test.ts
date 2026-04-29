/**
 * nurtureCron.replyGuard.test.ts
 *
 * Unit tests for the hasReplyAfterLastSend pure helper.
 * Verifies the core logic that prevents the nurture cron from firing
 * a scheduled step when the lead has already replied.
 */
import { describe, it, expect } from "vitest";
import { hasReplyAfterLastSend } from "./nurtureCron";

const msg = (role: string, tsMs: number, content = "hi") =>
  JSON.stringify([{ role, content, ts: tsMs }]);

const msgs = (entries: Array<{ role: string; tsMs: number }>) =>
  JSON.stringify(entries.map(({ role, tsMs }) => ({ role, content: "x", ts: tsMs })));

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;

describe("hasReplyAfterLastSend", () => {
  it("returns false when messageHistory is null", () => {
    expect(hasReplyAfterLastSend(null, new Date(NOW - HOUR))).toBe(false);
  });

  it("returns false when messageHistory is empty", () => {
    expect(hasReplyAfterLastSend("[]", new Date(NOW - HOUR))).toBe(false);
  });

  it("returns false when only assistant messages exist after lastSentAt", () => {
    const history = JSON.stringify([
      { role: "assistant", content: "Hey!", ts: NOW - 30 * 60 * 1000 },
    ]);
    expect(hasReplyAfterLastSend(history, new Date(NOW - HOUR))).toBe(false);
  });

  it("returns false when user message is BEFORE lastSentAt", () => {
    const lastSentAt = new Date(NOW - HOUR); // 1 hour ago
    const history = JSON.stringify([
      { role: "user", content: "Hello", ts: NOW - 2 * HOUR }, // 2 hours ago — before last send
    ]);
    expect(hasReplyAfterLastSend(history, lastSentAt)).toBe(false);
  });

  it("returns true when user message is AFTER lastSentAt (the Jacqueline case)", () => {
    const lastSentAt = new Date(NOW - 2 * HOUR); // sent 2 hours ago
    const history = JSON.stringify([
      { role: "assistant", content: "Jade here...", ts: NOW - 2 * HOUR },
      { role: "user", content: "I'd still be interested in rates", ts: NOW - 97 * 60 * 1000 }, // 97 min ago — after last send
    ]);
    expect(hasReplyAfterLastSend(history, lastSentAt)).toBe(true);
  });

  it("returns true when user message is exactly 1ms after lastSentAt", () => {
    const lastSentAt = new Date(NOW - HOUR);
    const history = JSON.stringify([
      { role: "user", content: "hi", ts: NOW - HOUR + 1 },
    ]);
    expect(hasReplyAfterLastSend(history, lastSentAt)).toBe(true);
  });

  it("returns false when user message is exactly at lastSentAt (not after)", () => {
    const lastSentAt = new Date(NOW - HOUR);
    const history = JSON.stringify([
      { role: "user", content: "hi", ts: NOW - HOUR }, // same ms — not strictly after
    ]);
    expect(hasReplyAfterLastSend(history, lastSentAt)).toBe(false);
  });

  it("returns true when lastSentAt is null and any user message exists", () => {
    const history = JSON.stringify([
      { role: "user", content: "hi", ts: NOW - 5 * 60 * 1000 },
    ]);
    expect(hasReplyAfterLastSend(history, null)).toBe(true);
  });

  it("returns false when lastSentAt is null and no user messages exist", () => {
    const history = JSON.stringify([
      { role: "assistant", content: "Jade here...", ts: NOW - 5 * 60 * 1000 },
    ]);
    expect(hasReplyAfterLastSend(history, null)).toBe(false);
  });

  it("handles messages with timestamp field instead of ts", () => {
    const lastSentAt = new Date(NOW - HOUR);
    const history = JSON.stringify([
      { role: "user", content: "hi", timestamp: NOW - 30 * 60 * 1000 }, // uses 'timestamp' key
    ]);
    expect(hasReplyAfterLastSend(history, lastSentAt)).toBe(true);
  });

  it("handles messages with createdAt field instead of ts", () => {
    const lastSentAt = new Date(NOW - HOUR);
    const history = JSON.stringify([
      { role: "user", content: "hi", createdAt: NOW - 30 * 60 * 1000 }, // uses 'createdAt' key
    ]);
    expect(hasReplyAfterLastSend(history, lastSentAt)).toBe(true);
  });

  it("returns false when user message has no timestamp at all", () => {
    const lastSentAt = new Date(NOW - HOUR);
    const history = JSON.stringify([
      { role: "user", content: "hi" }, // no ts field
    ]);
    expect(hasReplyAfterLastSend(history, lastSentAt)).toBe(false);
  });

  it("returns true when at least one of multiple messages is after lastSentAt", () => {
    const lastSentAt = new Date(NOW - HOUR);
    const history = JSON.stringify([
      { role: "user", content: "old msg", ts: NOW - 2 * HOUR },   // before
      { role: "user", content: "new msg", ts: NOW - 30 * 60 * 1000 }, // after
    ]);
    expect(hasReplyAfterLastSend(history, lastSentAt)).toBe(true);
  });

  it("handles malformed JSON gracefully (returns false)", () => {
    expect(hasReplyAfterLastSend("{bad json}", new Date(NOW - HOUR))).toBe(false);
  });
});
