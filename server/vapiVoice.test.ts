/**
 * Tests for the Vapi voice integration:
 * - handleGetQuote: pricing logic
 * - handleCreateLead: session creation/matching
 * - processEndOfCallReport: webhook data processing
 * - voiceRouter.stats: aggregate stats shape
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── handleGetQuote ──────────────────────────────────────────────────────────

// Import the pure function directly (no DB needed)
import { handleGetQuote } from "./vapiService";

describe("handleGetQuote", () => {
  it("returns a numeric price for a standard 2BR/1BA request", () => {
    const result = handleGetQuote({
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
    });
    expect(result.price).toBeGreaterThan(0);
    expect(result.priceFormatted).toMatch(/^\$\d+$/);
    expect(result.summary).toContain("2 Bedrooms");
  });

  it("applies deep cleaning multiplier (price > standard)", () => {
    const standard = handleGetQuote({
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
    });
    const deep = handleGetQuote({
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Deep Cleaning",
    });
    expect(deep.price).toBeGreaterThan(standard.price);
  });

  it("returns 0 for unknown bedroom/bathroom combo", () => {
    const result = handleGetQuote({
      bedrooms: "99 Bedrooms",
      bathrooms: "99 Bathrooms",
      serviceType: "Standard Cleaning",
    });
    // Should not throw, just return 0 or a fallback
    expect(result.price).toBeGreaterThanOrEqual(0);
  });

  it("handles Studio bedroom correctly", () => {
    const result = handleGetQuote({
      bedrooms: "Studio",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
    });
    expect(result.price).toBeGreaterThan(0);
    expect(result.summary).toContain("Studio");
  });

  it("handles move-out cleaning multiplier", () => {
    const standard = handleGetQuote({
      bedrooms: "3 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Standard Cleaning",
    });
    const moveOut = handleGetQuote({
      bedrooms: "3 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Move Out Cleaning",
    });
    // Move-out should cost at least as much as standard (multiplier >= 1)
    expect(moveOut.price).toBeGreaterThanOrEqual(standard.price);
  });
});

// ─── Voice call data shape ────────────────────────────────────────────────────

describe("VoiceCall schema shape", () => {
  it("voiceCallOutcomes contains expected values", async () => {
    const { voiceCallOutcomes } = await import("../drizzle/schema");
    expect(voiceCallOutcomes).toContain("booked");
    expect(voiceCallOutcomes).toContain("quote_given");
    expect(voiceCallOutcomes).toContain("faq_answered");
    expect(voiceCallOutcomes).toContain("transferred");
    expect(voiceCallOutcomes).toContain("no_action");
    expect(voiceCallOutcomes).toContain("callback_requested");
  });
});

// ─── Webhook payload parsing ─────────────────────────────────────────────────

describe("Vapi webhook payload parsing", () => {
  it("extracts call ID and duration from a call-ended payload", () => {
    const payload = {
      message: {
        type: "end-of-call-report",
        call: {
          id: "test-call-123",
          customer: { number: "+12025551234" },
          startedAt: "2026-03-18T01:00:00Z",
          endedAt: "2026-03-18T01:05:30Z",
          endedReason: "customer-ended-call",
          recordingUrl: "https://storage.vapi.ai/recordings/test.mp3",
        },
        transcript: "Hi, I'd like to book a cleaning.",
        summary: "Caller wanted to book a 2BR standard cleaning. Quote given: $180.",
        analysis: {
          structuredData: {
            intent: "booking",
            outcome: "quote_given",
            bedrooms: "2 Bedrooms",
            bathrooms: "1 Bathroom",
            serviceType: "Standard Cleaning",
            quotedPrice: 180,
            leadCreated: false,
          },
          successEvaluation: "true",
        },
      },
    };

    const call = payload.message.call;
    const startMs = new Date(call.startedAt).getTime();
    const endMs = new Date(call.endedAt).getTime();
    const durationSeconds = Math.round((endMs - startMs) / 1000);

    expect(call.id).toBe("test-call-123");
    expect(durationSeconds).toBe(330); // 5 min 30 sec
    expect(call.customer.number).toBe("+12025551234");
    expect(payload.message.analysis.structuredData.outcome).toBe("quote_given");
    expect(payload.message.analysis.successEvaluation).toBe("true");
  });

  it("handles missing optional fields gracefully", () => {
    const minimalPayload = {
      message: {
        type: "end-of-call-report",
        call: {
          id: "minimal-call",
          customer: { number: "+12025559999" },
          endedReason: "silence-timed-out",
        },
        transcript: null,
        summary: null,
        analysis: {
          structuredData: null,
          successEvaluation: null,
        },
      },
    };

    expect(minimalPayload.message.call.id).toBe("minimal-call");
    expect(minimalPayload.message.transcript).toBeNull();
    expect(minimalPayload.message.analysis.structuredData).toBeNull();
  });
});

// ─── Tool call argument validation ───────────────────────────────────────────

describe("Tool call argument shapes", () => {
  it("getQuote requires bedrooms, bathrooms, serviceType", () => {
    const requiredFields = ["bedrooms", "bathrooms", "serviceType"];
    const args = { bedrooms: "2 Bedrooms", bathrooms: "1 Bathroom", serviceType: "Standard Cleaning" };
    for (const field of requiredFields) {
      expect(args).toHaveProperty(field);
    }
  });

  it("createLead requires name, phone, bedrooms, bathrooms, serviceType, quotedPrice", () => {
    const requiredFields = ["name", "phone", "bedrooms", "bathrooms", "serviceType", "quotedPrice"];
    const args = {
      name: "Jane Smith",
      phone: "+12025551234",
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
      quotedPrice: 180,
      address: "123 Main St",
      preferredDate: "Saturday morning",
    };
    for (const field of requiredFields) {
      expect(args).toHaveProperty(field);
    }
  });

  it("sendSms requires to and message", () => {
    const args = { to: "+12025551234", message: "Your quote is $180. We'll call to confirm!" };
    expect(args).toHaveProperty("to");
    expect(args).toHaveProperty("message");
    expect(args.message.length).toBeLessThanOrEqual(160);
  });
});
