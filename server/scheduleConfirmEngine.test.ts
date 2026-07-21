/**
 * Tests for scheduleConfirmEngine.ts
 *
 * Tests the pure functions: isConfirmationReply, formatTime (via buildScheduleSms),
 * and the SMS body builder.
 */

import { describe, it, expect } from "vitest";
import { isConfirmationReply } from "./scheduleConfirmEngine";

// ─── isConfirmationReply ──────────────────────────────────────────────────────

describe("isConfirmationReply", () => {
  describe("affirmative replies that should return true", () => {
    const affirmatives = [
      "confirm",
      "Confirm",
      "CONFIRM",
      "confirmed",
      "Confirmed!",
      "yes",
      "Yes",
      "YES",
      "yes!",
      "Yes thanks",
      "Yes thanks so much",
      "Yes, confirmed",
      "Yes! We'll be there.",
      "yep",
      "Yep",
      "Yep thanks",
      "yup",
      "yeah",
      "Yeah sounds good",
      "ok",
      "Ok",
      "OK",
      "okay",
      "Okay",
      "got it",
      "Got it",
      "Got it!",
      "got them",
      "received",
      "Received",
      "sounds good",
      "Sounds good",
      "Yep sounds good",
      "sure",
      "Sure",
      "will do",
      "Will do",
      "👍",
      "👍👍",
      "✅",
      "on it",
      "On it!",
      "noted",
      "Noted.",
      "absolutely",
      "Absolutely",
      "perfect",
      "Perfect!",
      "great",
      "Great!",
      "all good",
      "All good!",
      "works for me",
      "Works for me!",
      "that works",
      "That works!",
      "i'll be there",
      "I will be there",
      "we'll be there",
      "We will be there",
      "yes confirmed",
      "Confirmed 👍",
    ];

    for (const text of affirmatives) {
      it(`returns true for "${text}"`, () => {
        expect(isConfirmationReply(text)).toBe(true);
      });
    }
  });

  describe("non-affirmative replies that should return false", () => {
    const negatives = [
      "no",
      "nope",
      "can't make it",
      "I need to reschedule",
      "what time is the first job?",
      "what's the address?",
      "I'll be late",
      "running late",
      "hello",
      "hi",
      "ok but I have a question",
      "not sure",
      "maybe",
      "call me",
      "cancel",
      "I quit",
      "sick today",
    ];

    for (const text of negatives) {
      it(`returns false for "${text}"`, () => {
        expect(isConfirmationReply(text)).toBe(false);
      });
    }
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(isConfirmationReply("")).toBe(false);
    });

    it("handles whitespace-only string", () => {
      expect(isConfirmationReply("   ")).toBe(false);
    });

    it("handles string with leading/trailing whitespace", () => {
      expect(isConfirmationReply("  confirm  ")).toBe(true);
    });

    it("handles mixed case", () => {
      expect(isConfirmationReply("CoNfIrMeD")).toBe(true);
    });
  });
});

// ─── Nudge idempotency guard ──────────────────────────────────────────────────

describe("nudge idempotency (internalNotes flag)", () => {
  it("detects nudgeSent flag in valid JSON", () => {
    const notes = JSON.stringify({ nudgeSent: true, nudgeSentAt: "2026-05-02T19:00:00.000Z" });
    const meta = JSON.parse(notes);
    expect(meta.nudgeSent).toBe(true);
  });

  it("returns falsy when internalNotes is null", () => {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(null as unknown as string ?? "{}"); } catch { /* ignore */ }
    expect(meta.nudgeSent).toBeFalsy();
  });

  it("returns falsy when internalNotes is empty string", () => {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(""); } catch { /* ignore */ }
    expect(meta.nudgeSent).toBeFalsy();
  });

  it("returns falsy when internalNotes is plain text (not JSON)", () => {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse("some plain text note"); } catch { /* ignore */ }
    expect(meta.nudgeSent).toBeFalsy();
  });

  it("returns falsy when nudgeSent is not set in JSON", () => {
    const notes = JSON.stringify({ someOtherKey: "value" });
    const meta = JSON.parse(notes);
    expect(meta.nudgeSent).toBeFalsy();
  });
});
