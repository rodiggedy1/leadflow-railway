import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceSmsBookingQuote, type SmsBookingQuoteFields, type SmsBookingQuoteUpdate } from "./smsBookingQuote";
import { createSmsBookingQuoteReplyGenerator } from "./smsBookingQuoteGeneration";
import type { ClaudeCustomerSmsGenerationBinding } from "./claudeCustomerSmsGeneration";

const NOW = Date.parse("2026-11-23T23:27:00Z");
const pricing: SmsBookingQuoteFields = { serviceId: "standard", bedrooms: 0, bathrooms: 3, condition: 5,
  recurrence: "one-time", extras: [], extrasConfirmed: true };
const priorText = "A new one-time standard quote for only 3 bathrooms, no bedrooms, condition 5, no extras.";
const initialBinding: ClaudeCustomerSmsGenerationBinding = { sessionId: 42, providerMessageId: "OM_OLD", fromPhone: "+12025550123",
  receivingPhoneNumberId: "PN_SYNTHETIC", receivingPhoneNumber: "+12025550999", inboundText: priorText,
  createdAt: NOW - 60000, receivedAt: NOW - 60000, customerName: "Maya Lane", historyHash: "a".repeat(64) };
const initialHistory = [{ role: "user", content: priorText, opMsgId: "OM_OLD" }];
const initialUpdate: SmsBookingQuoteUpdate = { action: "collect", intentEvidenceQuote: priorText, fields: pricing,
  evidence: Object.fromEntries(Object.keys(pricing).map(key => [key, { turnIndex: 0, quote: priorText }])) };
const prior = advanceSmsBookingQuote(null, initialUpdate, { binding: initialBinding, originalConversation: initialHistory, nowMs: NOW }).state;
function input(latest: boolean) {
  const text = latest ? "Wednesday in the morning" : "Yes please";
  const history = [...initialHistory, { role: "assistant", content: "Would you like the revised quote? What day, time and address?" },
    { role: "user", content: "Wednesday in the morning", opMsgId: latest ? "OM_CURRENT" : "OM_PREFERENCE" },
    ...(!latest ? [{ role: "assistant", content: "I'll prepare the revised quote." }, { role: "user", content: text, opMsgId: "OM_CURRENT" }] : [])];
  const binding = { ...initialBinding, providerMessageId: "OM_CURRENT", inboundText: text, createdAt: NOW, receivedAt: NOW,
    historyHash: createHash("sha256").update(JSON.stringify(history)).digest("hex") };
  return { incomingMessage: text, context: { binding, originalConversation: history }, protectedIds: [] };
}
let network: ReturnType<typeof vi.spyOn>;
beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("OFFLINE_ONLY")); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.restoreAllMocks(); });

describe("partial SMS scheduling: instructions and offline state plumbing, not a live model-quality guarantee", () => {
  it.each([true, false])("supplies the complete Wednesday-morning answer and explicit partial-answer instructions when latest=%s", async latest => {
    const current = input(latest), before = JSON.stringify({ current, prior });
    const update: SmsBookingQuoteUpdate = { action: "collect", intentEvidenceQuote: current.incomingMessage,
      fields: { requestedLocalDate: "2026-11-25" }, evidence: { requestedLocalDate: { turnIndex: 2, quote: "Wednesday" } } };
    const runner = vi.fn(async (request: { systemPrompt: string; userPrompt: string }) => {
      expect(request.systemPrompt).toContain('For "Wednesday in the morning", acknowledge Wednesday morning');
      expect(request.systemPrompt).toContain("clarify only the exact time within that morning");
      expect(request.systemPrompt).toContain("Changing room counts or repricing the same quote does not erase scheduling answers");
      const payload = JSON.parse(request.userPrompt);
      expect(payload.context.originalConversation[2]).toMatchObject({ content: "Wednesday in the morning", turnIndex: 2 });
      expect(payload.context.smsBookingQuote.state).toEqual(prior);
      return { finalSmsText: JSON.stringify({ replyText: "Wednesday morning noted as your preference, Maya. What exact morning time would you prefer, and what is the address?",
        task: null, bookingQuote: update, quotePresentationLanguage: "en" }) };
    });
    const generate = createSmsBookingQuoteReplyGenerator({ runner, readKnowledge: async () => "Synthetic approved knowledge", smsBookingQuote: { readState: async () => prior } });
    const result = await generate(current);
    expect(result.replyText).toBe("Wednesday morning noted as your preference, Maya. What exact morning time would you prefer, and what is the address?");
    const advanced = advanceSmsBookingQuote(prior, result.smsBookingQuote!.update, { binding: current.context.binding, originalConversation: current.context.originalConversation, nowMs: NOW });
    expect(advanced.state.fields).toMatchObject({ bedrooms: 0, bathrooms: 3, requestedLocalDate: "2026-11-25" });
    expect(advanced.state.fields).not.toHaveProperty("requestedLocalTime"); expect(advanced.missing).toEqual(["address", "requestedLocalTime"]);
    expect(advanced.state.evidence.requestedLocalDate).toEqual({ turnIndex: 2, quote: "Wednesday" });
    expect(advanced.input).toBeNull(); expect(advanced.preview?.success).toBe(true);
    expect(result.smsBookingQuote!.quoteTextTemplate).toBeNull();
    expect(runner).toHaveBeenCalledTimes(1); expect(JSON.stringify({ current, prior })).toBe(before);
  });
  it("retains the durable date and exact time during an actual customer room-count correction", () => {
    const current = input(false);
    const oldText = "A new one-time standard quote for 2 bedrooms, 2 bathrooms, condition 5, no extras.";
    current.context.originalConversation[0].content = oldText;
    current.context.originalConversation[2].content = "Wednesday in the morning at 9:30";
    const correction = "Please update my quote to only 3 bathrooms, no bedrooms.";
    current.incomingMessage = correction; current.context.binding.inboundText = correction;
    current.context.originalConversation[4].content = correction;
    current.context.binding.historyHash = createHash("sha256").update(JSON.stringify(current.context.originalConversation)).digest("hex");
    const old = advanceSmsBookingQuote(null, { ...initialUpdate, intentEvidenceQuote: oldText,
      fields: { ...pricing, bedrooms: 2, bathrooms: 2 },
      evidence: Object.fromEntries(Object.keys(pricing).map(key => [key, { turnIndex: 0, quote: oldText }])) },
      { binding: { ...initialBinding, inboundText: oldText }, originalConversation: [current.context.originalConversation[0]], nowMs: NOW }).state;
    const saved = advanceSmsBookingQuote(old, { action: "collect", intentEvidenceQuote: current.incomingMessage,
      fields: { requestedLocalDate: "2026-11-25", requestedLocalTime: "09:30" },
      evidence: { requestedLocalDate: { turnIndex: 2, quote: "Wednesday" }, requestedLocalTime: { turnIndex: 2, quote: "9:30" } } },
      { binding: current.context.binding, originalConversation: current.context.originalConversation, nowMs: NOW }).state;
    const before = JSON.stringify(saved);
    const advanced = advanceSmsBookingQuote(saved, { action: "quote", intentEvidenceQuote: current.incomingMessage,
      fields: { bedrooms: 0, bathrooms: 3 }, evidence: { bedrooms: { turnIndex: 4, quote: "no bedrooms" }, bathrooms: { turnIndex: 4, quote: "3 bathrooms" } } },
      { binding: current.context.binding, originalConversation: current.context.originalConversation, nowMs: NOW });
    expect(advanced.state.fields).toMatchObject({ bedrooms: 0, bathrooms: 3 });
    expect(advanced.state.fields.requestedLocalDate).toBe("2026-11-25"); expect(advanced.state.fields.requestedLocalTime).toBe("09:30");
    expect(advanced.missing).toEqual(["address"]); expect(JSON.stringify(saved)).toBe(before);
  });
});
