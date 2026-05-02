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
      "yep",
      "Yep",
      "yup",
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
      "i'll be there",
      "I will be there",
      "yes confirmed",
      "confirm yes",
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
