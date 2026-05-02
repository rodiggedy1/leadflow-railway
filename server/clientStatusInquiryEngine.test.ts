/**
 * Unit tests for clientStatusInquiryEngine.ts
 *
 * Tests the status-inquiry detection patterns and ETA extraction logic.
 * DB / VAPI / SMS calls are not tested here (integration-level concerns).
 */

import { describe, it, expect } from "vitest";
import { isStatusInquiry } from "./clientStatusInquiryEngine";

// ─── isStatusInquiry detection ────────────────────────────────────────────────

describe("isStatusInquiry", () => {
  describe("should detect status inquiry messages", () => {
    const positives = [
      // on the way variants
      "Is the team on the way?",
      "Are they on their way?",
      "Is she on her way?",
      "Is he on his way?",
      // what time / when
      "What time will they arrive?",
      "When will they be here?",
      "When are they coming?",
      "What time is the team coming?",
      "When is the cleaner arriving?",
      // still coming
      "Are they still coming?",
      "Is the team still showing up?",
      "Is she still arriving?",
      "Still on the way?",
      // how long
      "How long until they arrive?",
      "How much longer?",
      "How much more time?",
      // ETA
      "What's the ETA?",
      "Do you have an ETA?",
      "E.T.A. please",
      // where are they
      "Where are the cleaners?",
      "Where is the team?",
      "Where is the maid?",
      "Where are they?",
      "Where is she?",
      // running late / still coming
      "Are they running late?",
      "Is the team still coming today?",
      "Still on the way?",
      // is the team
      "Is the team coming today?",
      "Are the cleaners on their way?",
      "Is the cleaner coming?",
      // any update
      "Any update on the team?",
      "Can I get a status update?",
      "Update on my cleaning?",
      // haven't arrived
      "They haven't arrived yet",
      "The team is not here yet",
      "She hasn't arrived",
      // expected arrival
      "What's the expected arrival time?",
      "What is the arrival time?",
      // mixed case
      "WHERE IS THE TEAM",
      "what time will they arrive",
      "ETA?",
    ];

    positives.forEach((msg) => {
      it(`detects: "${msg}"`, () => {
        expect(isStatusInquiry(msg)).toBe(true);
      });
    });
  });

  describe("should NOT detect non-status-inquiry messages", () => {
    const negatives = [
      // Greetings
      "Hello",
      "Hi there",
      "Good morning",
      // Booking requests
      "I'd like to book a cleaning",
      "Can I schedule a cleaning for next week?",
      // Complaints (not status inquiries)
      "The team did a terrible job",
      "I'm not happy with the service",
      // Confirmations
      "Yes, that works for me",
      "Confirmed",
      "OK sounds good",
      // Cancellations
      "I need to cancel my appointment",
      "Please cancel my booking",
      // Payment
      "How much does a cleaning cost?",
      "What are your prices?",
      // Reviews
      "Great service, 5 stars!",
      "The team was amazing",
      // Random
      "Thank you!",
      "See you then",
      "I'll be home",
      "",
      "   ",
    ];

    negatives.forEach((msg) => {
      it(`does NOT detect: "${msg}"`, () => {
        expect(isStatusInquiry(msg)).toBe(false);
      });
    });
  });
});
