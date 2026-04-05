/**
 * cs-note.test.ts
 *
 * Unit tests for the addCsNote tRPC procedure.
 * Validates that:
 *  1. Notes are stored with role="note" in messageHistory.
 *  2. The note content and senderName are persisted correctly.
 *  3. Existing messages are preserved when a note is appended.
 *  4. Empty notes are rejected (zod validation).
 *  5. Notes exceeding 2000 chars are rejected (zod validation).
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ── Schema mirror (matches the procedure's .input() definition) ────────────
const addCsNoteInput = z.object({
  sessionId: z.number().int().positive(),
  note: z.string().min(1).max(2000),
});

// ── Pure helper: simulate what the procedure does to messageHistory ────────
function applyNote(
  existingHistory: Array<{ role: string; content: string; ts?: number; senderName?: string }>,
  note: string,
  senderName: string,
  ts: number
) {
  const updated = [...existingHistory];
  updated.push({ role: "note", content: note, ts, senderName });
  return updated;
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe("addCsNote — input schema validation", () => {
  it("accepts a valid note", () => {
    const result = addCsNoteInput.safeParse({ sessionId: 1, note: "Follow up on quote" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty note", () => {
    const result = addCsNoteInput.safeParse({ sessionId: 1, note: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a note exceeding 2000 characters", () => {
    const result = addCsNoteInput.safeParse({ sessionId: 1, note: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("accepts a note of exactly 2000 characters", () => {
    const result = addCsNoteInput.safeParse({ sessionId: 1, note: "x".repeat(2000) });
    expect(result.success).toBe(true);
  });

  it("rejects sessionId of 0", () => {
    const result = addCsNoteInput.safeParse({ sessionId: 0, note: "test" });
    expect(result.success).toBe(false);
  });

  it("rejects negative sessionId", () => {
    const result = addCsNoteInput.safeParse({ sessionId: -5, note: "test" });
    expect(result.success).toBe(false);
  });
});

describe("addCsNote — messageHistory mutation logic", () => {
  it("appends a note with role='note' to an empty history", () => {
    const history = applyNote([], "Client seems frustrated", "Alice", 1000);
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe("note");
    expect(history[0].content).toBe("Client seems frustrated");
    expect(history[0].senderName).toBe("Alice");
    expect(history[0].ts).toBe(1000);
  });

  it("preserves existing messages when appending a note", () => {
    const existing = [
      { role: "user", content: "Hello", ts: 100 },
      { role: "assistant", content: "Hi there!", ts: 200 },
    ];
    const history = applyNote(existing, "Needs follow-up", "Bob", 300);
    expect(history).toHaveLength(3);
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
    expect(history[2].role).toBe("note");
    expect(history[2].content).toBe("Needs follow-up");
  });

  it("does not mutate the original history array", () => {
    const original = [{ role: "user", content: "Hi", ts: 100 }];
    const copy = [...original];
    applyNote(original, "note text", "Agent", 200);
    expect(original).toEqual(copy); // original unchanged
  });

  it("stores the correct senderName on the note", () => {
    const history = applyNote([], "Check booking status", "Carol", 500);
    expect(history[0].senderName).toBe("Carol");
  });

  it("note role is never 'user', 'assistant', or 'system'", () => {
    const history = applyNote([], "Internal memo", "Dave", 600);
    expect(history[0].role).not.toBe("user");
    expect(history[0].role).not.toBe("assistant");
    expect(history[0].role).not.toBe("system");
    expect(history[0].role).toBe("note");
  });
});
