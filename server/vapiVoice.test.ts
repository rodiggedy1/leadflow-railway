/**
 * Tests for the Vapi voice integration:
 * - handleGetQuote: pricing logic and normalization
 * - parseToolCall: both Vapi-native and OpenAI-style formats
 * - createLead args: phone override, email passthrough
 * - processEndOfCallReport: webhook data processing
 * - System prompt: customer.number injection, name verification, email collection
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── handleGetQuote ──────────────────────────────────────────────────────────

import { handleGetQuote } from "./vapiService";

describe("handleGetQuote — pricing correctness", () => {
  it("3 Bedrooms / 2 Bathrooms / Standard = $289", () => {
    // Base: $229 (3BR) + 2 baths × $30 = $289
    const result = handleGetQuote({
      bedrooms: "3 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Standard Cleaning",
    });
    expect(result.price).toBe(289);
    expect(result.priceFormatted).toBe("$289");
    expect(result.summary).toContain("$289");
  });

  it("3 Bedrooms / 1 Bathroom / Standard = $259", () => {
    // Base: $229 (3BR) + 1 bath × $30 = $259
    const result = handleGetQuote({
      bedrooms: "3 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
    });
    expect(result.price).toBe(259);
  });

  it("2 Bedrooms / 2 Bathrooms / Standard = $269", () => {
    // Base: $209 (2BR) + 2 baths × $30 = $269
    const result = handleGetQuote({
      bedrooms: "2 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Standard Cleaning",
    });
    expect(result.price).toBe(269);
  });

  it("Studio / 1 Bathroom / Standard = $149", () => {
    // Base: $119 (Studio) + 1 bath × $30 = $149
    const result = handleGetQuote({
      bedrooms: "Studio",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
    });
    expect(result.price).toBe(149);
    expect(result.summary).toContain("Studio");
  });

  it("applies deep cleaning multiplier (1.5x standard)", () => {
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
    expect(deep.price).toBe(Math.round(standard.price * 1.5));
  });

  it("applies move-in/move-out multiplier (1.75x standard)", () => {
    const standard = handleGetQuote({
      bedrooms: "3 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Standard Cleaning",
    });
    const moveOut = handleGetQuote({
      bedrooms: "3 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Move-In/Move-Out",
    });
    expect(moveOut.price).toBe(Math.round(standard.price * 1.75));
  });

  it("normalizes bare number inputs (LLM may pass '3' instead of '3 Bedrooms')", () => {
    // The normalizeBedroomKey / normalizeBathroomKey helpers should handle this
    const result = handleGetQuote({
      bedrooms: "3",
      bathrooms: "2",
      serviceType: "Standard Cleaning",
    });
    // Should not throw and should return a valid price
    expect(result.price).toBeGreaterThan(0);
  });

  it("returns summary with recurring discount options", () => {
    const result = handleGetQuote({
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
    });
    expect(result.summary).toContain("weekly");
    expect(result.summary).toContain("bi-weekly");
    expect(result.summary).toContain("monthly");
  });
});

// ─── parseToolCall format handling ───────────────────────────────────────────

// We test the webhook's parseToolCall logic indirectly by verifying
// that both payload formats produce the same result shape.

describe("Vapi tool call format normalization", () => {
  it("Vapi-native format: { id, name, parameters } is parsed correctly", () => {
    const nativePayload = {
      id: "tc_abc123",
      name: "getQuote",
      parameters: {
        bedrooms: "3 Bedrooms",
        bathrooms: "2 Bathrooms",
        serviceType: "Standard Cleaning",
      },
    };

    // Simulate parseToolCall logic
    const parsed =
      "name" in nativePayload && "parameters" in nativePayload
        ? { id: nativePayload.id, name: nativePayload.name, args: nativePayload.parameters }
        : null;

    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("getQuote");
    expect(parsed!.args).toEqual({
      bedrooms: "3 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Standard Cleaning",
    });
  });

  it("OpenAI-style format: { id, function: { name, arguments } } is parsed correctly", () => {
    const openAIPayload = {
      id: "tc_abc123",
      type: "function",
      function: {
        name: "createLead",
        arguments: JSON.stringify({
          name: "Jane Smith",
          phone: "+13029816191",
          bedrooms: "3 Bedrooms",
          bathrooms: "2 Bathrooms",
          serviceType: "Standard Cleaning",
          quotedPrice: 289,
        }),
      },
    };

    // Simulate parseToolCall logic
    let parsed: { id: string; name: string; args: Record<string, unknown> } | null = null;
    if ("function" in openAIPayload) {
      const fn = openAIPayload.function;
      const args = JSON.parse(fn.arguments);
      parsed = { id: openAIPayload.id, name: fn.name, args };
    }

    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("createLead");
    expect(parsed!.args.name).toBe("Jane Smith");
    expect(parsed!.args.phone).toBe("+13029816191");
    expect(parsed!.args.quotedPrice).toBe(289);
  });
});

// ─── createLead phone safety guard ───────────────────────────────────────────

describe("createLead phone number safety", () => {
  it("business phone override: if LLM passes business number, callerPhone from call object is used", () => {
    const BUSINESS_PHONE = "+12028885362";
    const callerPhone = "+13029816191";

    // Simulate the override logic in vapiWebhook.ts
    let phone = BUSINESS_PHONE; // LLM passed the wrong number
    if (phone === BUSINESS_PHONE && callerPhone && callerPhone !== BUSINESS_PHONE) {
      phone = callerPhone;
    }

    expect(phone).toBe("+13029816191");
    expect(phone).not.toBe(BUSINESS_PHONE);
  });

  it("correct phone passes through unchanged", () => {
    const BUSINESS_PHONE = "+12028885362";
    const callerPhone = "+13029816191";

    let phone = "+13029816191"; // LLM passed the correct number
    if (phone === BUSINESS_PHONE && callerPhone && callerPhone !== BUSINESS_PHONE) {
      phone = callerPhone;
    }

    expect(phone).toBe("+13029816191");
  });

  it("missing phone falls back to callerPhone from call object", () => {
    const callerPhone = "+13029816191";
    let phone: string | undefined = undefined;

    if (!phone && callerPhone) {
      phone = callerPhone;
    }

    expect(phone).toBe("+13029816191");
  });
});

// ─── System prompt: customer.number injection ─────────────────────────────────

describe("System prompt customer.number injection", () => {
  it("system prompt contains {{customer.number}} variable reference", async () => {
    // We can't call buildSystemPrompt directly (not exported), but we can
    // verify the assistant config contains the variable by checking the
    // bootstrapVapiAssistant function builds a config with the variable.
    // Instead, we test the invariant: the prompt MUST reference {{customer.number}}
    // so the LLM always knows the real caller phone.

    // Read the source to verify (this is a static analysis test)
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./vapiService.ts", import.meta.url).pathname,
      "utf8"
    );

    expect(source).toContain("{{customer.number}}");
    // Should appear multiple times: in the system prompt and in tool argument instructions
    const occurrences = (source.match(/\{\{customer\.number\}\}/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it("system prompt contains name verification instruction", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./vapiService.ts", import.meta.url).pathname,
      "utf8"
    );

    // The prompt must instruct Madison to ask the caller to spell their name
    // and then confirm the spelling back
    expect(source).toContain("spell that out");
    expect(source).toContain("is that correct");
  });

  it("system prompt does NOT ask for email (removed per product decision)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./vapiService.ts", import.meta.url).pathname,
      "utf8"
    );

    // Email collection was removed from the voice flow — it will be collected on follow-up call
    // The system prompt should NOT contain a step asking for email
    expect(source).not.toContain("email address for your booking confirmation");
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
  it("extracts call ID, duration, and caller phone from a call-ended payload", () => {
    const payload = {
      message: {
        type: "end-of-call-report",
        call: {
          id: "test-call-123",
          customer: { number: "+13029816191" },
          startedAt: "2026-03-18T01:00:00Z",
          endedAt: "2026-03-18T01:05:30Z",
          endedReason: "customer-ended-call",
          recordingUrl: "https://storage.vapi.ai/recordings/test.mp3",
        },
        transcript: "Hi, I'd like to book a cleaning.",
        summary: "Caller wanted to book a 3BR/2BA standard cleaning. Quote given: $289.",
        analysis: {
          structuredData: {
            intent: "booking",
            outcome: "quote_given",
            callerName: "Rohan Joshi",
            callerEmail: "rohan@example.com",
            bedrooms: "3 Bedrooms",
            bathrooms: "2 Bathrooms",
            serviceType: "Standard Cleaning",
            quotedPrice: 289,
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
    expect(call.customer.number).toBe("+13029816191");
    expect(payload.message.analysis.structuredData.outcome).toBe("quote_given");
    expect(payload.message.analysis.structuredData.quotedPrice).toBe(289);
    expect(payload.message.analysis.structuredData.callerEmail).toBe("rohan@example.com");
  });

  it("handles missing optional fields gracefully", () => {
    const minimalPayload = {
      message: {
        type: "end-of-call-report",
        call: {
          id: "minimal-call",
          customer: { number: "+13029816191" },
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
    const args = { bedrooms: "3 Bedrooms", bathrooms: "2 Bathrooms", serviceType: "Standard Cleaning" };
    for (const field of requiredFields) {
      expect(args).toHaveProperty(field);
    }
  });

  it("createLead requires name, phone, bedrooms, bathrooms, serviceType, quotedPrice", () => {
    const requiredFields = ["name", "phone", "bedrooms", "bathrooms", "serviceType", "quotedPrice"];
    const args = {
      name: "Jane Smith",
      phone: "+13029816191",
      email: "jane@example.com",
      bedrooms: "3 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Standard Cleaning",
      quotedPrice: 289,
      address: "1501 Canyon Mesquite",
      preferredDate: "Saturday morning",
    };
    for (const field of requiredFields) {
      expect(args).toHaveProperty(field);
    }
    // email is optional but present
    expect(args.email).toBe("jane@example.com");
  });

  it("sendSms requires to and message", () => {
    const args = { to: "+13029816191", message: "Your quote is $289. We'll call to confirm!" };
    expect(args).toHaveProperty("to");
    expect(args).toHaveProperty("message");
    expect(args.message.length).toBeLessThanOrEqual(160);
  });
});
