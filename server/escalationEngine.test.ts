/**
 * Unit tests for escalationEngine.ts
 *
 * Tests the pure functions:
 *   - isVerbalConfirmation — detects verbal confirmation in call transcripts
 *   - isNoAnswer — detects no-answer / voicemail outcomes
 *
 * DB-dependent functions (runEscalationCalls, handleEscalationCallEnd) are
 * not tested here — they are integration-level concerns.
 */
import { describe, it, expect } from "vitest";
import { isVerbalConfirmation, isNoAnswer } from "./escalationEngine";

// ─── isVerbalConfirmation ─────────────────────────────────────────────────────
describe("isVerbalConfirmation", () => {
  describe("transcripts that SHOULD be detected as verbal confirmation", () => {
    const positives = [
      // "confirm" variants
      "Yes, I confirm",
      "Confirmed, I'll be there",
      "confirm",
      "CONFIRM",
      // "yes" variants
      "yes",
      "Yes I will be there",
      "YES",
      // "I'll be there" variants
      "I'll be there at 9 AM",
      "I will be there",
      // "sounds good"
      "Sounds good, see you then",
      "sounds good",
      // "no problem"
      "No problem, I'll be there",
      "no problem",
      // "ok" / "okay"
      "ok",
      "OK",
      "okay",
      "Okay, got it",
      // "sure"
      "Sure, I'll be there",
      "sure",
      // "of course"
      "Of course I'll be there",
      "of course",
      // "got it"
      "Got it, thank you",
      "got it",
      // "will do"
      "Will do",
      "will do, see you tomorrow",
    ];

    for (const transcript of positives) {
      it(`detects confirmation in: "${transcript}"`, () => {
        expect(isVerbalConfirmation(transcript)).toBe(true);
      });
    }
  });

  describe("transcripts that should NOT be detected as verbal confirmation", () => {
    const negatives = [
      // Cancellations
      "I can't make it tomorrow",
      "I need to cancel",
      "I'm sick today",
      // Questions
      "What time is the first job?",
      "What's the address?",
      "Can you call me back?",
      // Running late (not a confirmation)
      "I'm running late",
      "I'll be 30 minutes late",
      // Greetings only
      "Hello?",
      "Who is this?",
      // Negative responses
      "No, I can't",
      "Not available",
    ];

    for (const transcript of negatives) {
      it(`does NOT detect confirmation in: "${transcript}"`, () => {
        expect(isVerbalConfirmation(transcript)).toBe(false);
      });
    }
  });

  describe("edge cases", () => {
    it("returns false for null transcript", () => {
      expect(isVerbalConfirmation(null)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isVerbalConfirmation("")).toBe(false);
    });

    it("returns false for whitespace-only string", () => {
      expect(isVerbalConfirmation("   ")).toBe(false);
    });

    it("is case-insensitive for 'YES'", () => {
      expect(isVerbalConfirmation("YES")).toBe(true);
    });

    it("is case-insensitive for 'Confirmed'", () => {
      expect(isVerbalConfirmation("Confirmed")).toBe(true);
    });

    it("detects confirmation within a longer sentence", () => {
      expect(isVerbalConfirmation("Hi, yes I will be there for the job tomorrow")).toBe(true);
    });
  });
});

// ─── isNoAnswer ───────────────────────────────────────────────────────────────
describe("isNoAnswer", () => {
  describe("endedReason values that indicate no answer", () => {
    const noAnswerReasons = [
      "no-answer",
      "customer-did-not-answer",
      "voicemail",
    ];

    for (const reason of noAnswerReasons) {
      it(`detects no-answer for endedReason="${reason}"`, () => {
        expect(isNoAnswer(reason, null)).toBe(true);
      });
    }
  });

  describe("short transcripts (< 20 chars) indicate no answer", () => {
    it("returns true for a very short transcript with no confirmation", () => {
      // Less than 20 chars, no confirmation pattern
      expect(isNoAnswer(null, "Hello?")).toBe(true);
    });

    it("returns true for null transcript", () => {
      expect(isNoAnswer(null, null)).toBe(true);
    });

    it("returns true for empty transcript", () => {
      expect(isNoAnswer(null, "")).toBe(true);
    });
  });

  describe("confirmed verbally → NOT no-answer", () => {
    it("returns false when transcript contains 'yes'", () => {
      expect(isNoAnswer("no-answer", "yes I'll be there")).toBe(false);
    });

    it("returns false when transcript contains 'confirm'", () => {
      expect(isNoAnswer("voicemail", "I confirm my schedule")).toBe(false);
    });

    it("returns false when transcript contains 'sounds good'", () => {
      expect(isNoAnswer("no-answer", "Sounds good, see you then!")).toBe(false);
    });
  });

  describe("answered calls with substantive transcripts", () => {
    it("returns false for a long transcript without confirmation", () => {
      // More than 20 chars, no confirmation pattern, no no-answer reason
      const longTranscript =
        "I have a question about the schedule for tomorrow. What time is the first job?";
      expect(isNoAnswer("assistant-ended-call", longTranscript)).toBe(false);
    });

    it("returns false for null endedReason with a long transcript", () => {
      const longTranscript = "I need to talk to someone about my schedule please.";
      expect(isNoAnswer(null, longTranscript)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns true for null endedReason and null transcript", () => {
      expect(isNoAnswer(null, null)).toBe(true);
    });

    it("returns true for unknown endedReason with short transcript", () => {
      expect(isNoAnswer("unknown-reason", "Hi")).toBe(true);
    });

    it("returns false for unknown endedReason with long non-confirming transcript", () => {
      const longTranscript = "I am calling to ask about my work schedule for next week.";
      expect(isNoAnswer("unknown-reason", longTranscript)).toBe(false);
    });
  });
});
