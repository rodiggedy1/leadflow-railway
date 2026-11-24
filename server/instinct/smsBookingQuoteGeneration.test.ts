import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import type { CreateCustomerBookingLinkInput } from "../../shared/bookingFunnel";
import { createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICED_EXTRAS, type PublicBookingPricingInput } from "../../shared/publicBookingPricing";
import { buildSystemPrompt } from "../csReplyStream";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "../knowledgeBase";
import type { InitialLeadDraftOptions } from "./claudeAgentClient";
import { buildCallBookingQuoteSms, createSmsBookingQuotePresentation, renderSmsBookingQuoteText } from "./bookingQuotePresentation";
import {
  CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS,
  CLAUDE_CUSTOMER_SMS_STYLE_INSTRUCTIONS,
  createClaudeCustomerReplyGenerator,
  createClaudeCustomerSmsGeneratorWithReply,
  type ClaudeCustomerReplyInput,
  type ClaudeCustomerSmsGenerationBinding,
} from "./claudeCustomerSmsGeneration";
import { advanceSmsBookingQuote, SMS_BOOKING_QUOTE_INSTRUCTIONS, type SmsBookingQuoteFields, type SmsBookingQuoteState, type SmsBookingQuoteUpdate } from "./smsBookingQuote";
import { createSmsBookingQuoteReplyGenerator, SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS } from "./smsBookingQuoteGeneration";

const NOW = Date.parse("2026-11-17T17:00:00.000Z");
const FUTURE_DATE = new Date(NOW + 86400000).toISOString().split("T")[0];
const fields: SmsBookingQuoteFields = {
  pricingMode: "home", serviceId: "standard", bedrooms: 2, bathrooms: 2,
  homeType: "House", condition: 5, extras: [], extrasConfirmed: true, recurrence: "one-time",
  address: "123 Synthetic Street, Washington DC", requestedLocalDate: FUTURE_DATE, requestedLocalTime: "10:30",
};
const fullText = `Please send a NEW cleaning booking link. Standard home cleaning, 2 bedrooms, 2 bathrooms, House, condition 5, one-time, no extras confirmed, 123 Synthetic Street, Washington DC, ${FUTURE_DATE} at 10:30.`;
const quoteTemplate = "Hi Maya! Your first cleaning quote is {{firstCleaningPrice}}. {{extras}}. This is a quote, not a confirmed booking.";
const linkTemplate = `${quoteTemplate} Review and complete your booking here: {{bookingLink}}`;
function fixture(text = fullText, history?: any[], changes: Partial<ClaudeCustomerSmsGenerationBinding> = {}): ClaudeCustomerReplyInput {
  const originalConversation = history ?? [
    { role: "user", content: "I am interested in a new cleaning.", opMsgId: "old-customer" },
    { role: "assistant", content: "Which service and home details would you prefer?" },
    { role: "customer", content: text, opMsgId: changes.providerMessageId ?? "msg-current", direction: "incoming" },
  ];
  const binding: ClaudeCustomerSmsGenerationBinding = { sessionId: 42, providerMessageId: "msg-current", fromPhone: "+12025550123",
    receivingPhoneNumberId: "PN-actual", receivingPhoneNumber: "+12025550999", inboundText: text,
    createdAt: NOW - 1, receivedAt: NOW, customerName: "Maya Lane",
    historyHash: createHash("sha256").update(JSON.stringify(originalConversation)).digest("hex"), ...changes };
  return { incomingMessage: text, context: { binding, contact: { sessionId: "42", displayName: binding.customerName, phone: binding.fromPhone },
    originalConversation, receivingPhoneNumberId: binding.receivingPhoneNumberId, receivingPhoneNumber: binding.receivingPhoneNumber, bookingContext: null },
  protectedIds: [binding.providerMessageId, binding.receivingPhoneNumberId] };
}
function update(input: ClaudeCustomerReplyInput, patch: SmsBookingQuoteFields = fields, options: Partial<SmsBookingQuoteUpdate> = {}): SmsBookingQuoteUpdate {
  const turnIndex = (input.context.originalConversation as any[]).length - 1;
  return { action: "link", fields: structuredClone(patch), intentEvidenceQuote: input.incomingMessage,
    evidence: Object.fromEntries(Object.keys(patch).map(key => [key, { turnIndex, quote: input.incomingMessage }])), ...options };
}
function harness(result: unknown, state: SmsBookingQuoteState | null = null, options: { signal?: AbortSignal } = {}) {
  const readKnowledge = vi.fn(async () => MAIDS_IN_BLACK_KNOWLEDGE_BASE);
  const runner = vi.fn(async (_options: InitialLeadDraftOptions) => ({ finalSmsText: typeof result === "string" ? result : JSON.stringify(result) }));
  const readState = vi.fn(async (_binding: ClaudeCustomerSmsGenerationBinding) => state);
  return { readKnowledge, runner, readState, generate: createSmsBookingQuoteReplyGenerator({ readKnowledge, runner, smsBookingQuote: { readState }, ...options }) };
}
function active(input: ClaudeCustomerReplyInput, extra: Record<string, unknown> = {}) {
  return { replyText: "Thanks, Maya! Here are the details for you to review.", task: null, bookingQuote: update(input), quoteTextTemplate: linkTemplate, ...extra };
}
function canonicalPresentation(input: ClaudeCustomerReplyInput, patch = update(input), language: "en" | "es" = "en", previous: SmsBookingQuoteState | null = null) {
  const advanced = advanceSmsBookingQuote(previous, patch, { binding: input.context.binding as ClaudeCustomerSmsGenerationBinding,
    originalConversation: input.context.originalConversation as any[], nowMs: NOW });
  if (!advanced.preview?.success) throw Error("Expected complete synthetic pricing");
  return createSmsBookingQuotePresentation(advanced.preview.priceSnapshot, patch.action === "link", language);
}
let network: ReturnType<typeof vi.spyOn>;
beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("OFFLINE_ONLY")); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("SMS-only additive quote generation", () => {
  it("prepends only the new highest-priority contract to the exact full base prompt with one actual runner call", async () => {
    const input = fixture(), h = harness(active(input));
    const before = JSON.stringify(input);
    const plan = await h.generate(input);
    expect(plan).toEqual({ replyText: "Thanks, Maya! Here are the details for you to review.", task: null,
      smsBookingQuote: { previous: null, update: update(input), originalConversation: input.context.originalConversation, quoteTextTemplate: canonicalPresentation(input) } });
    expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.readKnowledge).toHaveBeenCalledTimes(1);
    expect(h.readState).toHaveBeenCalledTimes(1);
    expect(h.readState).toHaveBeenCalledWith(input.context.binding);
    const baseRunner = vi.fn(async (_options: InitialLeadDraftOptions) => ({ finalSmsText: JSON.stringify({ replyText: "Hello Maya!", task: null }) }));
    await createClaudeCustomerReplyGenerator({ readKnowledge: async () => MAIDS_IN_BLACK_KNOWLEDGE_BASE, runner: baseRunner })(input);
    const prompts = h.runner.mock.calls[0][0];
    expect(prompts.systemPrompt).toBe(`=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===\n${SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS}\n\n${baseRunner.mock.calls[0][0].systemPrompt}`);
    expect(prompts.systemPrompt).toContain(SMS_BOOKING_QUOTE_INSTRUCTIONS);
    expect(prompts.systemPrompt).toContain(CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS);
    expect(prompts.systemPrompt).toContain(CLAUDE_CUSTOMER_SMS_STYLE_INSTRUCTIONS);
    expect(prompts.systemPrompt.endsWith(buildSystemPrompt())).toBe(true);
    expect(prompts.systemPrompt).toContain(MAIDS_IN_BLACK_KNOWLEDGE_BASE);
    expect(Object.keys(prompts).sort()).toEqual(["systemPrompt", "userPrompt"]);
    expect(JSON.parse(prompts.userPrompt)).toEqual({ incomingMessage: input.incomingMessage, context: { ...input.context,
      originalConversation: (input.context.originalConversation as any[]).map((turn, turnIndex) => ({ ...turn, turnIndex })),
      smsBookingQuote: { state: null, currentLocalDate: "2026-11-17", currentLocalTime: "12:00" }, knowledgeBase: MAIDS_IN_BLACK_KNOWLEDGE_BASE } });
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    "Hello Maya! How can I help? 🧹✨",
    "5pm EST works as your requested preference.",
    "Cuando estés lista, aquí tienes la información.",
    "Our approved price is $100 and our website is maidsinblack.com.",
    "Votre question concerne quel service ?",
    "清掃サービスについて、何をお知りになりたいですか？",
    "ما الذي تود معرفته عن التنظيف؟",
    "I'll send your link.",
    "We've updated your notes.",
    "Your booking is confirmed.",
    "Tomorrow is available.",
    "You're all set.",
    "We have reserved your appointment.",
    "We'll handle your request.",
    "Booking code MIB-123, confirmation number ABC-456, msg-current, PN-actual. Requested time: 10:30 EST.",
  ])("preserves ordinary nonquote output byte-for-byte with no new quote guards: %s", async replyText => {
    const input = fixture("Ordinary question"), h = harness({ replyText, task: null, bookingQuote: null });
    expect(await h.generate(input)).toEqual({ replyText, task: null });
    expect(h.runner).toHaveBeenCalledTimes(1);
  });

  it("accepts legacy ordinary two-field output and never returns state metadata", async () => {
    const input = fixture("What is your service area?"), h = harness({ replyText: "We serve the approved areas. Which area are you in?", task: null });
    expect(await h.generate(input)).toEqual({ replyText: "We serve the approved areas. Which area are you in?", task: null });
    expect(h.runner).toHaveBeenCalledTimes(1);
  });

  it("leaves complete shared email context and the old two-field generator unaffected", async () => {
    const input = { incomingMessage: "Hola", context: { email: { threadId: "mail-thread" }, originalConversation: [{ text: "Full email body" }] }, protectedIds: [] };
    const runner = vi.fn(async () => ({ finalSmsText: '{"replyText":"¡Hola!","task":null}' }));
    expect(await createClaudeCustomerReplyGenerator({ runner, readKnowledge: async () => MAIDS_IN_BLACK_KNOWLEDGE_BASE })(input)).toEqual({ replyText: "¡Hola!", task: null });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it.each([
    "I'll send your link.", "We've updated your notes.", "Your booking is confirmed.",
    "Tomorrow is available.", "You're all set.", "We have reserved your appointment.",
    "We'll handle your request. Booking code MIB-123, confirmation number ABC-456, msg-current, PN-actual. 10:30 EST.",
  ])("preserves shared two-field replies with task:null and protected IDs without phrase or presentation rejection: %s", async replyText => {
    const input = fixture("Please handle my existing booking request."), before = JSON.stringify(input);
    const runner = vi.fn(async (_options: InitialLeadDraftOptions) => ({ finalSmsText: JSON.stringify({ replyText, task: null }) }));
    const readKnowledge = vi.fn(async () => MAIDS_IN_BLACK_KNOWLEDGE_BASE);
    expect(await createClaudeCustomerReplyGenerator({ runner, readKnowledge })(input)).toEqual({ replyText, task: null });
    expect(runner).toHaveBeenCalledTimes(1); expect(readKnowledge).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("reads exact-bound complete durable state and complete large incoming/outgoing history without clipping or mutation", async () => {
    const input = fixture();
    const prior = advanceSmsBookingQuote(null, update(input), { binding: input.context.binding as ClaudeCustomerSmsGenerationBinding, originalConversation: input.context.originalConversation as any[], nowMs: NOW }).state;
    prior.link = { fingerprint: "synthetic-fingerprint", token: "mib-saved-token", urlPath: "/book/mib-saved-token", firstCleaningTotalCents: 10000 };
    prior.fields.notes = Array.from({ length: 20 }, () => "Customer instructions ".repeat(40).trim());
    const history = Array.from({ length: 650 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Turn ${index} ${"z".repeat(600)}` }));
    const large = fixture("Thank you", [...history, { role: "user", content: "Thank you", opMsgId: "msg-current" }]);
    const h = harness({ replyText: "You’re welcome, Maya!", task: null, bookingQuote: null }, prior);
    const before = JSON.stringify(prior);
    await h.generate(large);
    const payload = JSON.parse(h.runner.mock.calls[0][0].userPrompt);
    expect(payload.context.originalConversation).toEqual((large.context.originalConversation as any[]).map((turn, turnIndex) => ({ ...turn, turnIndex })));
    expect(payload.context.originalConversation.map((turn: any) => turn.turnIndex)).toEqual(Array.from({ length: 651 }, (_, index) => index));
    expect((large.context.originalConversation as any[]).every(turn => !Object.prototype.hasOwnProperty.call(turn, "turnIndex"))).toBe(true);
    expect(payload.context.smsBookingQuote.state).toEqual(prior);
    expect(payload.context.knowledgeBase).toBe(MAIDS_IN_BLACK_KNOWLEDGE_BASE);
    expect(JSON.stringify(prior)).toBe(before);
  });

  it("supplies authoritative indices for the reproduced 114-turn qualification failure without changing durable evidence", async () => {
    const text = "Yes, that's the home that is for and it's a standard cleaning";
    const history = Array.from({ length: 114 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Synthetic history ${index}` }));
    history[105] = { role: "user", content: "123 Synthetic Street and 8 AM would work well it's a two bedroom two bathroom" };
    history[106] = { role: "assistant", content: "123 Synthetic Street, a 2 bedroom, 2 bathroom home" };
    history[112] = { role: "assistant", content: "Is this for 123 Synthetic Street, 2 bedrooms and 2 bathrooms, and which clean?" };
    history[113] = { role: "user", content: text };
    const input = fixture(text, history.map((turn, index) => index === 113 ? { ...turn, opMsgId: "msg-current" } : turn));
    const before = JSON.stringify(input);
    const h = harness(null);
    h.runner.mockImplementation(async options => {
      const payload = JSON.parse(options.userPrompt), turns = payload.context.originalConversation;
      const home = turns.find((turn: any) => turn.role === "user" && turn.content.includes("two bedroom two bathroom"));
      const current = turns.at(-1);
      expect(home.turnIndex).toBe(105); expect(current.turnIndex).toBe(113);
      expect(options.systemPrompt).toContain("copy that exact value into evidence");
      const evidence = (turnIndex: number, quote: string) => ({ turnIndex, quote });
      return { finalSmsText: JSON.stringify({ replyText: "Would you prefer one-time, weekly, biweekly or monthly cleaning, and which day and time?", task: null,
        bookingQuote: { action: "collect", intentEvidenceQuote: "it's a standard cleaning",
          fields: { address: "123 Synthetic Street", bedrooms: 2, bathrooms: 2, pricingMode: "home", serviceId: "standard" },
          evidence: { address: evidence(home.turnIndex, "123 Synthetic Street"), bedrooms: evidence(home.turnIndex, "two bedroom"),
            bathrooms: evidence(home.turnIndex, "two bathroom"), pricingMode: evidence(current.turnIndex, "Yes, that's the home that is for"),
            serviceId: evidence(current.turnIndex, "it's a standard cleaning") } }, quotePresentationLanguage: "en" }) };
    });
    const result = await h.generate(input);
    expect(result.smsBookingQuote?.update.evidence.address?.turnIndex).toBe(105);
    expect(result.smsBookingQuote?.update.evidence.serviceId?.turnIndex).toBe(113);
    expect(result.smsBookingQuote?.originalConversation).toBe(input.context.originalConversation);
    expect(result.smsBookingQuote?.quoteTextTemplate).toBeNull(); expect(result.task).toBeNull();
    expect(JSON.stringify(input)).toBe(before); expect(h.runner).toHaveBeenCalledTimes(1);
    const invalid = structuredClone(result.smsBookingQuote!.update);
    for (const evidence of Object.values(invalid.evidence)) if (evidence) evidence.turnIndex += 1;
    await expect(harness({ replyText: result.replyText, task: null, bookingQuote: invalid }).generate(input)).rejects.toThrow("SMS_QUOTE_EVIDENCE_NOT_CUSTOMER");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("overwrites untrusted turnIndex labels only in model input, not original history or its hash", async () => {
    const input = fixture();
    (input.context.originalConversation as any[])[0].turnIndex = 900;
    (input.context.originalConversation as any[])[1].turnIndex = 0;
    const before = JSON.stringify(input), h = harness(active(input));
    const result = await h.generate(input);
    expect(JSON.parse(h.runner.mock.calls[0][0].userPrompt).context.originalConversation.map((turn: any) => turn.turnIndex)).toEqual([0, 1, 2]);
    expect(result.smsBookingQuote?.originalConversation).toBe(input.context.originalConversation);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("uses receivedAt rather than boot/current wall clock for relative-date context", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2040-05-15T03:00:00Z"));
    const h = harness({ replyText: "What time tomorrow would you prefer?", task: null, bookingQuote: null });
    await h.generate(fixture());
    expect(JSON.parse(h.runner.mock.calls[0][0].userPrompt).context.smsBookingQuote).toMatchObject({ currentLocalDate: "2026-11-17", currentLocalTime: "12:00" });
  });

  it("accepts a canonical quote with explicitly confirmed no extras and no invented staffing facts", async () => {
    const input = fixture(), bookingQuote = update(input, fields, { action: "quote" });
    const h = harness(active(input, { bookingQuote, quoteTextTemplate: quoteTemplate }));
    const plan = await h.generate(input);
    expect(plan.smsBookingQuote?.update.fields).toEqual(fields);
    expect(plan.smsBookingQuote?.quoteTextTemplate).toBe(canonicalPresentation(input, bookingQuote));
    expect(plan.smsBookingQuote?.update.fields).not.toHaveProperty("maidCount");
    expect(h.runner).toHaveBeenCalledTimes(1);
  });

  it("lets incomplete quote/link actions ask a base question with no output template", async () => {
    const input = fixture("Please send a new cleaning quote"), bookingQuote = update(input, {}, { action: "link", evidence: {} });
    const h = harness(active(input, { replyText: "How many bedrooms and bathrooms are in your home?", bookingQuote, quoteTextTemplate: null }));
    const plan = await h.generate(input);
    expect(plan.replyText).toBe("Would you like a standard, deep or move-out cleaning?");
    expect(plan.smsBookingQuote).toEqual({ previous: null, update: bookingQuote, originalConversation: input.context.originalConversation,
      quoteTextTemplate: null, missingQuestionLanguage: "en" });
  });

  it.each(["home", "hourly"] as const)("replaces a premature %s-mode page recap with the authoritative missing condition across every service and locale", async pricingMode => {
    for (const serviceId of ["standard", "deep", "moveout"] as const) for (const action of ["quote", "link"] as const)
      for (const language of ["en", "es"] as const) {
        const priorFields: SmsBookingQuoteFields = { ...fields, pricingMode, serviceId, maidCount: 2, hourCount: 3 };
        delete priorFields.condition;
        const priorInput = fixture(`Please prepare my new ${serviceId} ${pricingMode} cleaning quote: 2 bedrooms, 2 bathrooms, condition 5, one-time, no extras confirmed, two cleaners for three hours, 123 Synthetic Street, Washington DC, ${FUTURE_DATE} at 10:30.`);
        const previous = advanceSmsBookingQuote(null, update(priorInput, priorFields, { action: "collect" }), {
          binding: priorInput.context.binding as ClaudeCustomerSmsGenerationBinding, originalConversation: priorInput.context.originalConversation as any[], nowMs: NOW,
        }).state;
        const input = fixture(`For that new cleaning quote, ${FUTURE_DATE} at 08:30 please.`);
        const bookingQuote = update(input, { requestedLocalDate: FUTURE_DATE, requestedLocalTime: "08:30" }, { action });
        const replyText = language === "es" ? "Revisa los detalles y completa tu reserva en la página." : "Please review the details and complete your booking on the page to lock it in.";
        const h = harness(active(input, { bookingQuote, replyText, quoteTextTemplate: null, quotePresentationLanguage: language }), previous);
        const before = JSON.stringify(previous), plan = await h.generate(input);
        expect(plan.replyText).toBe(language === "es"
          ? "¿Cuánta limpieza necesita (del 1 al 10)?\n1 = limpio, 5 = normal, 10 = mucha suciedad."
          : "How much cleaning does it need (1 to 10)?\n1 = already clean, 5 = normal, 10 = heavy buildup.");
        expect(plan.replyText).not.toMatch(/page|página|https?:|\$|\{\{/);
        expect(plan.smsBookingQuote).toEqual({ previous, update: bookingQuote, originalConversation: input.context.originalConversation,
          quoteTextTemplate: null, missingQuestionLanguage: language });
        const advanced = advanceSmsBookingQuote(previous, plan.smsBookingQuote!.update, {
          binding: input.context.binding as ClaudeCustomerSmsGenerationBinding, originalConversation: input.context.originalConversation as any[], nowMs: NOW,
        });
        expect(advanced.missing).toEqual(["condition"]); expect(advanced.preview).toBeNull(); expect(advanced.input).toBeNull();
        expect(advanced.state.fields).toMatchObject({ requestedLocalDate: FUTURE_DATE, requestedLocalTime: "08:30", extras: [], extrasConfirmed: true });
        expect(advanced.state.fields).not.toHaveProperty("condition"); expect(JSON.stringify(previous)).toBe(before);
        expect(h.runner).toHaveBeenCalledTimes(1);
      }
  });

  it("accepts a customer-language Spanish quote template with backend-only prices/link and EST inside estés", async () => {
    const input = fixture("Estoy emocionada por una limpieza nueva. Envíame el enlace de esta cotización.");
    const previousInput = fixture();
    const previous = advanceSmsBookingQuote(null, update(previousInput), { binding: previousInput.context.binding as ClaudeCustomerSmsGenerationBinding,
      originalConversation: previousInput.context.originalConversation as any[], nowMs: NOW }).state;
    const template = "¡Qué alegría que estés emocionada, Maya! 🧹 Tu primera limpieza tiene un precio de {{firstCleaningPrice}}. {{extras}}. Revisa y completa tu reserva aquí: {{bookingLink}}. Esto es una cotización, no una reserva confirmada.";
    const h = harness(active(input, { replyText: "¡Gracias, Maya! Aquí puedes revisar los detalles.", bookingQuote: update(input, {}), quoteTextTemplate: template }), previous);
    const result = await h.generate(input);
    expect(result.replyText).toBe("¡Gracias, Maya! Aquí puedes revisar los detalles.");
    expect(result.smsBookingQuote?.quoteTextTemplate).toBe(canonicalPresentation(input, update(input, {}), "es", previous));
    expect(h.runner).toHaveBeenCalledTimes(1);
  });

  it("supports distinct authoritative first/future placeholders for recurring quotes", async () => {
    const input = fixture(), bookingQuote = update(input, { ...fields, recurrence: "weekly" }, { action: "quote" });
    const template = "First cleaning: {{firstCleaningPrice}}. Weekly future visits: {{futureVisitPrice}}. {{extras}}.";
    expect((await harness(active(input, { bookingQuote, quoteTextTemplate: template })).generate(input)).smsBookingQuote?.quoteTextTemplate).toBe(canonicalPresentation(input, bookingQuote));
  });

  it("keeps ordinary requested staff work and literal current-inbound task evidence", async () => {
    const input = fixture("Please cancel my existing cleaning."), task = { title: "Review cancellation", items: [{ title: "Review requested cancellation", evidenceQuote: "cancel my existing cleaning" }] };
    const replyText = "Thanks, Maya! We'll review your request and confirm once updated.";
    expect(await harness({ replyText, task, bookingQuote: null }).generate(input)).toEqual({ replyText, task });
  });

  it.each(["Historical customer quote", "Paraphrased current request"])("retains current-inbound task evidence validation: %s", async evidenceQuote => {
    const input = fixture(), task = { title: "Review request", items: [{ title: "Review", evidenceQuote }] };
    await expect(harness(active(input, { task })).generate(input)).rejects.toThrow("TASK_EVIDENCE_NOT_CURRENT_INBOUND");
  });

  it.each(["malformed JSON", "provider rejection", "bad quote evidence", "model-owned price"])("recovers %s once using the identical request, original signal and complete unchanged customer, history, knowledge and state", async failure => {
    const history = Array.from({ length: 650 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Turn ${index} ${"z".repeat(600)}` }));
    const input = fixture(fullText, [...history, { role: "customer", content: fullText, opMsgId: "msg-current", direction: "incoming" }]);
    const previous = advanceSmsBookingQuote(null, update(input), { binding: input.context.binding as ClaudeCustomerSmsGenerationBinding,
      originalConversation: input.context.originalConversation as any[], nowMs: NOW }).state;
    previous.link = { fingerprint: "synthetic-fingerprint", token: "mib-saved-token", urlPath: "/book/mib-saved-token", firstCleaningTotalCents: 10000 };
    previous.fields.notes = Array.from({ length: 20 }, () => "Customer instructions ".repeat(40).trim());
    const controller = new AbortController(), beforeInput = JSON.stringify(input), beforeState = JSON.stringify(previous), h = harness(active(input), previous, { signal: controller.signal });
    const invalidEvidence = update(input); invalidEvidence.evidence.bedrooms = { turnIndex: 1, quote: "Turn 1" };
    if (failure === "provider rejection") h.runner.mockRejectedValueOnce(new Error("FIRST_PROVIDER_FAILURE"));
    else h.runner.mockResolvedValueOnce({ finalSmsText: failure === "malformed JSON" ? "Not JSON"
      : JSON.stringify(active(input, failure === "bad quote evidence" ? { bookingQuote: invalidEvidence } : { replyText: "It is $250." })) });
    const plan = await h.generate(input);
    expect(plan).toEqual({ replyText: "Thanks, Maya! Here are the details for you to review.", task: null,
      smsBookingQuote: { previous, update: update(input), originalConversation: input.context.originalConversation,
        quoteTextTemplate: canonicalPresentation(input, update(input), "en", previous) } });
    expect(plan.smsBookingQuote?.originalConversation).toBe(input.context.originalConversation);
    expect(h.runner).toHaveBeenCalledTimes(2);
    const firstRequest = h.runner.mock.calls[0][0], secondRequest = h.runner.mock.calls[1][0];
    expect(secondRequest).toBe(firstRequest);
    expect(secondRequest.systemPrompt).toBe(firstRequest.systemPrompt);
    expect(secondRequest.userPrompt).toBe(firstRequest.userPrompt);
    expect(firstRequest.signal).toBe(controller.signal);
    expect(secondRequest.signal).toBe(controller.signal);
    expect(firstRequest.systemPrompt).toContain(MAIDS_IN_BLACK_KNOWLEDGE_BASE);
    expect(firstRequest.systemPrompt.endsWith(buildSystemPrompt())).toBe(true);
    expect(JSON.parse(firstRequest.userPrompt)).toEqual({ incomingMessage: input.incomingMessage, context: { ...input.context,
      originalConversation: (input.context.originalConversation as any[]).map((turn, turnIndex) => ({ ...turn, turnIndex })),
      smsBookingQuote: { state: previous, currentLocalDate: "2026-11-17", currentLocalTime: "12:00" }, knowledgeBase: MAIDS_IN_BLACK_KNOWLEDGE_BASE } });
    expect(h.readKnowledge).toHaveBeenCalledTimes(1);
    expect(h.readKnowledge).toHaveBeenCalledWith(input.incomingMessage);
    expect(h.readState).toHaveBeenCalledTimes(1);
    expect(h.readState).toHaveBeenCalledWith(input.context.binding);
    expect(JSON.stringify(input)).toBe(beforeInput);
    expect(JSON.stringify(previous)).toBe(beforeState);
  });

  it.each(["ordinary", "active link"] as const)("accepts %s phrase/presentation output after the single shared recovery with no third attempt", async mode => {
    const input = fixture(), replyText = "I'll send your link. We've updated your notes. Your booking is confirmed. Tomorrow is available. You're all set. We have reserved your appointment. We'll handle your request. Booking code MIB-123, msg-current, PN-actual.";
    const result = mode === "ordinary" ? { replyText, task: null, bookingQuote: null }
      : active(input, { replyText, quoteTextTemplate: `${linkTemplate} ${replyText}` });
    const h = harness(result), before = JSON.stringify(input);
    h.runner.mockResolvedValueOnce({ finalSmsText: "Not JSON" });
    const plan = await h.generate(input);
    expect(plan.replyText).toBe(replyText); expect(plan.task).toBeNull();
    if (mode === "ordinary") expect(plan).toEqual({ replyText, task: null });
    else expect(plan.smsBookingQuote).toEqual({ previous: null, update: update(input),
      originalConversation: input.context.originalConversation, quoteTextTemplate: canonicalPresentation(input) });
    expect(h.runner).toHaveBeenCalledTimes(2);
    expect(h.runner.mock.calls[1][0]).toBe(h.runner.mock.calls[0][0]);
    expect(h.readKnowledge).toHaveBeenCalledTimes(1); expect(h.readState).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    "Not JSON", '```json\n{"replyText":"Hello","task":null,"bookingQuote":null}\n```',
  ])("rejects repeated malformed JSON after exactly two actual turns: %j", async result => {
    const h = harness(result);
    await expect(h.generate(fixture())).rejects.toThrow(SyntaxError);
    expect(h.runner).toHaveBeenCalledTimes(2);
  });

  it.each([
    { replyText: "Hello", bookingQuote: null }, { replyText: "Hello", task: null, bookingQuote: null, send: true },
    { replyText: "Hello", task: null, bookingQuote: { action: "collect", fields: {}, evidence: {} } },
    { replyText: "Hello", task: null, bookingQuote: null, smsBookingQuote: {} },
    { replyText: " \n\t", task: null, bookingQuote: null },
    { replyText: "Hello", task: null, bookingQuote: null, quotePresentationLanguage: "fr" },
  ])("recovers schema-invalid, blank or unauthorized JSON once and still rejects invalid second output: %j", async result => {
    const input = fixture(), h = harness(result);
    await expect(h.generate(input)).rejects.toThrow();
    expect(h.runner).toHaveBeenCalledTimes(2);
    expect(h.runner.mock.calls[1][0]).toBe(h.runner.mock.calls[0][0]);
    expect(h.readKnowledge).toHaveBeenCalledTimes(1); expect(h.readState).toHaveBeenCalledTimes(1);
    const recovery = harness(result);
    recovery.runner.mockResolvedValueOnce({ finalSmsText: "Not JSON" });
    await expect(recovery.generate(input)).rejects.toThrow();
    expect(recovery.runner).toHaveBeenCalledTimes(2);
    const success = harness(active(input));
    success.runner.mockResolvedValueOnce({ finalSmsText: JSON.stringify(result) });
    expect((await success.generate(input)).smsBookingQuote?.update).toEqual(update(input));
    expect(success.runner).toHaveBeenCalledTimes(2);
    expect(success.runner.mock.calls[1][0]).toBe(success.runner.mock.calls[0][0]);
    expect(success.readKnowledge).toHaveBeenCalledTimes(1); expect(success.readState).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "customer field evidence", output: (input: ClaudeCustomerReplyInput) => {
      const bookingQuote = update(input);
      bookingQuote.evidence.bedrooms = { turnIndex: 1, quote: "service and home details" };
      return active(input, { bookingQuote });
    }, error: "SMS_QUOTE_EVIDENCE_NOT_CUSTOMER" },
    { name: "current-inbound task evidence", output: (input: ClaudeCustomerReplyInput) => active(input,
      { task: { title: "Review request", items: [{ title: "Review", evidenceQuote: "Historical customer quote" }] } }), error: "TASK_EVIDENCE_NOT_CURRENT_INBOUND" },
    { name: "model-owned price", output: (input: ClaudeCustomerReplyInput) => active(input,
      { replyText: "It is $250." }), error: "SMS_QUOTE_MODEL_PRICE" },
    { name: "model-owned URL", output: (input: ClaudeCustomerReplyInput) => active(input,
      { quoteTextTemplate: `${linkTemplate} https://example.com/book/fake` }), error: "SMS_QUOTE_MODEL_URL" },
    { name: "literal field evidence", output: (input: ClaudeCustomerReplyInput) => {
      const bookingQuote = update(input);
      bookingQuote.evidence.bedrooms = { turnIndex: 2, quote: "invented literal" };
      return active(input, { bookingQuote });
    }, error: "SMS_QUOTE_EVIDENCE_NOT_LITERAL" },
    { name: "current quote intent", output: (input: ClaudeCustomerReplyInput) => active(input,
      { bookingQuote: update(input, {}, { intentEvidenceQuote: "I am interested in a new cleaning.", evidence: {} }) }), error: "SMS_QUOTE_INTENT_NOT_CURRENT_INBOUND" },
    { name: "template without quote update", output: (input: ClaudeCustomerReplyInput) => active(input,
      { bookingQuote: null }), error: "SMS_QUOTE_TEMPLATE_WITHOUT_UPDATE" },
    { name: "incomplete quote template", output: (input: ClaudeCustomerReplyInput) => active(input,
      { bookingQuote: update(input, {}) }), error: "SMS_QUOTE_TEMPLATE_INCOMPLETE" },
    { name: "template placeholder", output: (input: ClaudeCustomerReplyInput) => active(input,
      { quoteTextTemplate: `${linkTemplate} {{customPrice}}` }), error: "SMS_QUOTE_TEMPLATE_PLACEHOLDER" },
    { name: "template duplicate link", output: (input: ClaudeCustomerReplyInput) => active(input,
      { quoteTextTemplate: `${linkTemplate} {{bookingLink}}` }), error: "SMS_QUOTE_TEMPLATE_LINK_COUNT" },
    { name: "template in reply", output: (input: ClaudeCustomerReplyInput) => active(input,
      { replyText: "Your price is {{firstCleaningPrice}}" }), error: "SMS_QUOTE_TEMPLATE_IN_REPLY" },
  ])("recovers $name once while keeping every validation active and nested total runner calls bounded to two", async row => {
    const input = fixture(), result = row.output(input), h = harness(result);
    await expect(h.generate(input)).rejects.toThrow(row.error);
    expect(h.runner).toHaveBeenCalledTimes(2);
    expect(h.runner.mock.calls[1][0]).toBe(h.runner.mock.calls[0][0]);
    expect(h.readKnowledge).toHaveBeenCalledTimes(1); expect(h.readState).toHaveBeenCalledTimes(1);
    const recovery = harness(result);
    recovery.runner.mockResolvedValueOnce({ finalSmsText: "Not JSON" });
    await expect(recovery.generate(input)).rejects.toThrow(row.error);
    expect(recovery.runner).toHaveBeenCalledTimes(2);
    expect(recovery.runner.mock.calls[1][0]).toBe(recovery.runner.mock.calls[0][0]);
    expect(recovery.readKnowledge).toHaveBeenCalledTimes(1); expect(recovery.readState).toHaveBeenCalledTimes(1);
    const success = harness(active(input));
    success.runner.mockResolvedValueOnce({ finalSmsText: JSON.stringify(result) });
    expect(await success.generate(input)).toEqual({ replyText: active(input).replyText, task: null,
      smsBookingQuote: { previous: null, update: update(input), originalConversation: input.context.originalConversation,
        quoteTextTemplate: canonicalPresentation(input) } });
    expect(success.runner).toHaveBeenCalledTimes(2);
    expect(success.runner.mock.calls[1][0]).toBe(success.runner.mock.calls[0][0]);
    expect(success.readKnowledge).toHaveBeenCalledTimes(1); expect(success.readState).toHaveBeenCalledTimes(1);
  });

  it.each([new Error("RUNNER_FAILURE"), new SyntaxError("RUNNER_SYNTAX_FAILURE")])("recovers first provider rejection once, including provider SyntaxError: %s", async error => {
    const input = fixture(), h = harness(active(input));
    h.runner.mockRejectedValueOnce(error);
    expect((await h.generate(input)).smsBookingQuote?.update).toEqual(update(input));
    expect(h.runner).toHaveBeenCalledTimes(2);
    expect(h.runner.mock.calls[1][0]).toBe(h.runner.mock.calls[0][0]);
    expect(h.readKnowledge).toHaveBeenCalledTimes(1); expect(h.readState).toHaveBeenCalledTimes(1);
  });

  it.each([new Error("SECOND_RUNNER_FAILURE"), new SyntaxError("SECOND_RUNNER_SYNTAX_FAILURE")])("propagates second runner rejection without a third call: %s", async error => {
    const h = harness(active(fixture()));
    h.runner.mockResolvedValueOnce({ finalSmsText: "Not JSON" }).mockRejectedValueOnce(error);
    await expect(h.generate(fixture())).rejects.toBe(error);
    expect(h.runner).toHaveBeenCalledTimes(2);
  });

  it.each(["JSON then quote evidence", "JSON then provider", "provider then model price", "bad quote then JSON", "bad quote then bad task"])("never stacks shared and quote retries beyond two actual runner calls: %s", async mode => {
    const input = fixture(), h = harness(active(input)), badQuote = update(input), providerError = new Error("PROVIDER_FAILURE");
    badQuote.evidence.bedrooms = { turnIndex: 1, quote: "service and home details" };
    const badQuoteText = JSON.stringify(active(input, { bookingQuote: badQuote }));
    let expected: string | typeof SyntaxError;
    if (mode.startsWith("JSON")) {
      h.runner.mockResolvedValueOnce({ finalSmsText: "Not JSON" });
      if (mode === "JSON then provider") { h.runner.mockRejectedValueOnce(providerError); expected = providerError.message; }
      else { h.runner.mockResolvedValueOnce({ finalSmsText: badQuoteText }); expected = "SMS_QUOTE_EVIDENCE_NOT_CUSTOMER"; }
    } else if (mode === "provider then model price") {
      h.runner.mockRejectedValueOnce(providerError).mockResolvedValueOnce({ finalSmsText: JSON.stringify(active(input, { replyText: "It is $250." })) });
      expected = "SMS_QUOTE_MODEL_PRICE";
    } else {
      h.runner.mockResolvedValueOnce({ finalSmsText: badQuoteText });
      if (mode === "bad quote then JSON") { h.runner.mockResolvedValueOnce({ finalSmsText: "Not JSON" }); expected = SyntaxError; }
      else {
        h.runner.mockResolvedValueOnce({ finalSmsText: JSON.stringify(active(input, { task: { title: "Review", items: [{ title: "Review", evidenceQuote: "Historical request" }] } })) });
        expected = "TASK_EVIDENCE_NOT_CURRENT_INBOUND";
      }
    }
    await expect(h.generate(input)).rejects.toThrow(expected);
    expect(h.runner).toHaveBeenCalledTimes(2);
    expect(h.runner.mock.calls[1][0]).toBe(h.runner.mock.calls[0][0]);
    expect(h.readKnowledge).toHaveBeenCalledTimes(1); expect(h.readState).toHaveBeenCalledTimes(1);
  });

  it("discards the first bad quote capture when the recovery produces different ordinary output", async () => {
    const input = fixture(), task = { title: "Review request", items: [{ title: "Review requested details", evidenceQuote: "Standard home cleaning" }] };
    const ordinary = { replyText: "Thanks, Maya! We'll review your request and confirm once updated.", task, bookingQuote: null };
    const h = harness(ordinary), badQuote = update(input), before = JSON.stringify(input);
    badQuote.evidence.bedrooms = { turnIndex: 1, quote: "service and home details" };
    h.runner.mockResolvedValueOnce({ finalSmsText: JSON.stringify(active(input, { bookingQuote: badQuote })) });
    const plan = await h.generate(input);
    expect(plan).toEqual({ replyText: ordinary.replyText, task });
    expect(plan).not.toHaveProperty("smsBookingQuote");
    expect(h.runner).toHaveBeenCalledTimes(2);
    expect(h.runner.mock.calls[1][0]).toBe(h.runner.mock.calls[0][0]);
    expect(h.readKnowledge).toHaveBeenCalledTimes(1); expect(h.readState).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(["knowledge", "state"] as const)("retries a rejected %s read once, caches successful snapshots and generates exactly once", async failedRead => {
    const input = fixture(), previous = advanceSmsBookingQuote(null, update(input), { binding: input.context.binding as ClaudeCustomerSmsGenerationBinding,
      originalConversation: input.context.originalConversation as any[], nowMs: NOW }).state;
    const before = JSON.stringify({ input, previous }), h = harness(active(input), previous);
    if (failedRead === "knowledge") h.readKnowledge.mockRejectedValueOnce(new Error("KNOWLEDGE_READ_FAILURE"));
    else h.readState.mockRejectedValueOnce(new Error("STATE_READ_FAILURE"));
    const plan = await h.generate(input);
    expect(plan.smsBookingQuote).toEqual({ previous, update: update(input), originalConversation: input.context.originalConversation,
      quoteTextTemplate: canonicalPresentation(input, update(input), "en", previous) });
    expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.readKnowledge).toHaveBeenCalledTimes(failedRead === "knowledge" ? 2 : 1);
    expect(h.readState).toHaveBeenCalledTimes(failedRead === "state" ? 2 : 1);
    expect(h.readKnowledge.mock.calls.every(([text]) => text === input.incomingMessage)).toBe(true);
    expect(h.readState.mock.calls.every(([binding]) => binding === input.context.binding)).toBe(true);
    expect(JSON.parse(h.runner.mock.calls[0][0].userPrompt)).toEqual({ incomingMessage: input.incomingMessage, context: { ...input.context,
      originalConversation: (input.context.originalConversation as any[]).map((turn, turnIndex) => ({ ...turn, turnIndex })),
      smsBookingQuote: { state: previous, currentLocalDate: "2026-11-17", currentLocalTime: "12:00" }, knowledgeBase: MAIDS_IN_BLACK_KNOWLEDGE_BASE } });
    expect(JSON.stringify({ input, previous })).toBe(before);
  });

  it.each(["knowledge", "state"] as const)("does not bypass exhausted recovery after a %s read rejection and one bad quote", async failedRead => {
    const input = fixture(), h = harness(active(input, { replyText: "It is $250." }));
    if (failedRead === "knowledge") h.readKnowledge.mockRejectedValueOnce(new Error("KNOWLEDGE_READ_FAILURE"));
    else h.readState.mockRejectedValueOnce(new Error("STATE_READ_FAILURE"));
    await expect(h.generate(input)).rejects.toThrow("SMS_QUOTE_MODEL_PRICE");
    expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.readKnowledge).toHaveBeenCalledTimes(failedRead === "knowledge" ? 2 : 1);
    expect(h.readState).toHaveBeenCalledTimes(failedRead === "state" ? 2 : 1);
  });

  it.each(["knowledge", "state"] as const)("stops after two rejected %s reads with zero model calls", async failedRead => {
    const input = fixture(), h = harness(active(input));
    if (failedRead === "knowledge") h.readKnowledge.mockRejectedValue(new Error("REPEATED_READ_FAILURE"));
    else h.readState.mockRejectedValue(new Error("REPEATED_READ_FAILURE"));
    await expect(h.generate(input)).rejects.toThrow("REPEATED_READ_FAILURE");
    expect(h.runner).not.toHaveBeenCalled();
    expect(h.readKnowledge).toHaveBeenCalledTimes(failedRead === "knowledge" ? 2 : 0);
    expect(h.readState).toHaveBeenCalledTimes(failedRead === "state" ? 2 : 1);
  });

  it.each([{}, { version: 99 }, { version: 1, sessionId: 42 }])("cannot reread or bypass schema-invalid stored state %j", async state => {
    const h = harness(active(fixture()), state as SmsBookingQuoteState);
    await expect(h.generate(fixture())).rejects.toThrow();
    expect(h.readState).toHaveBeenCalledTimes(1);
    expect(h.runner).not.toHaveBeenCalled(); expect(h.readKnowledge).not.toHaveBeenCalled();
  });

  it.each(["missing binding", "invalid conversation", "incoming mismatch"])("rejects invalid stored generation context before any reads or model calls: %s", async kind => {
    const input = fixture(), h = harness(active(input));
    if (kind === "missing binding") delete input.context.binding;
    else if (kind === "invalid conversation") input.context.originalConversation = "not an array";
    else input.incomingMessage = "Different incoming message";
    await expect(h.generate(input)).rejects.toThrow("SMS_QUOTE_GENERATION_CONTEXT");
    expect(h.runner).not.toHaveBeenCalled(); expect(h.readKnowledge).not.toHaveBeenCalled(); expect(h.readState).not.toHaveBeenCalled();
  });

  it("keeps caller saved-session verification ahead of quote recovery with zero state, knowledge and model calls", async () => {
    const input = fixture(), binding = input.context.binding as ClaudeCustomerSmsGenerationBinding, h = harness(active(input));
    const session = { contact: { sessionId: "42", rawPhone: "202-555-0123", phone: "+12025550123", displayName: "Maya Lane", contactGap: null },
      messageHistory: input.context.originalConversation, lastInboundPhoneNumberId: "PN-actual" };
    const generate = createClaudeCustomerSmsGeneratorWithReply(h.generate);
    await expect(generate({ ...binding, historyHash: "0".repeat(64) }, session)).rejects.toThrow("CUSTOMER_PLAN_HISTORY_MISMATCH");
    expect(h.runner).not.toHaveBeenCalled(); expect(h.readKnowledge).not.toHaveBeenCalled(); expect(h.readState).not.toHaveBeenCalled();
  });

  it("starts no state, knowledge or runner call for an already aborted quote request", async () => {
    const controller = new AbortController(); controller.abort(new Error("PRE_ABORTED"));
    const input = fixture(), h = harness(active(input), null, { signal: controller.signal });
    await expect(h.generate(input)).rejects.toThrow("PRE_ABORTED");
    expect(h.runner).not.toHaveBeenCalled(); expect(h.readKnowledge).not.toHaveBeenCalled(); expect(h.readState).not.toHaveBeenCalled();
  });

  it("starts no third call after abort while the recovery runner is pending with a late invalid quote", async () => {
    const controller = new AbortController(), input = fixture(), h = harness(active(input), null, { signal: controller.signal });
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const start = new Promise<void>(resolve => { started = resolve; });
    h.runner.mockResolvedValueOnce({ finalSmsText: "Not JSON" }).mockImplementationOnce(async request => {
      expect(request.signal).toBe(controller.signal); started(); await gate;
      return { finalSmsText: JSON.stringify(active(input, { replyText: "It is $250." })) };
    });
    const pending = h.generate(input), rejected = expect(pending).rejects.toThrow("SMS_QUOTE_MODEL_PRICE");
    await start; expect(h.runner).toHaveBeenCalledTimes(2); controller.abort(); release(); await rejected;
    expect(h.runner).toHaveBeenCalledTimes(2);
    expect(h.runner.mock.calls[1][0]).toBe(h.runner.mock.calls[0][0]);
    expect(h.readKnowledge).toHaveBeenCalledTimes(1); expect(h.readState).toHaveBeenCalledTimes(1);
  });

  it("does not start recovery when aborted while the first runner is pending and returns malformed JSON", async () => {
    const controller = new AbortController(), h = harness("Not JSON");
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const start = new Promise<void>(resolve => { started = resolve; });
    h.runner.mockImplementationOnce(async () => { started(); await gate; return { finalSmsText: "Not JSON" }; });
    const generate = createSmsBookingQuoteReplyGenerator({ signal: controller.signal, runner: h.runner,
      readKnowledge: h.readKnowledge, smsBookingQuote: { readState: h.readState } });
    const pending = generate(fixture()), rejected = expect(pending).rejects.toThrow();
    await start;
    expect(h.runner).toHaveBeenCalledTimes(1);
    controller.abort();
    release();
    await rejected;
    expect(controller.signal.aborted).toBe(true);
    expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.readKnowledge).toHaveBeenCalledTimes(1);
    expect(h.readState).toHaveBeenCalledTimes(1);
  });

  it.each(["customerPhone", "price", "customPriceCents", "url", "token", "sender", "smsNumberConfirmed"])("rejects model-owned %s even if supplied with evidence", async key => {
    const input = fixture(), bookingQuote = update(input);
    Object.assign(bookingQuote.fields, { [key]: "untrusted" });
    Object.assign(bookingQuote.evidence, { [key]: { turnIndex: 2, quote: input.incomingMessage } });
    await expect(harness(active(input, { bookingQuote })).generate(input)).rejects.toThrow();
  });

  it("rejects assistant-origin field evidence even when the quote is literal", async () => {
    const input = fixture(), bookingQuote = update(input);
    bookingQuote.evidence.bedrooms = { turnIndex: 1, quote: "service and home details" };
    await expect(harness(active(input, { bookingQuote })).generate(input)).rejects.toThrow("SMS_QUOTE_EVIDENCE_NOT_CUSTOMER");
  });
  it("rejects invented field evidence and old intent evidence", async () => {
    const input = fixture(), bookingQuote = update(input);
    bookingQuote.evidence.bedrooms = { turnIndex: 2, quote: "invented literal" };
    await expect(harness(active(input, { bookingQuote })).generate(input)).rejects.toThrow("SMS_QUOTE_EVIDENCE_NOT_LITERAL");
    const oldIntent = update(input, {}, { intentEvidenceQuote: "I am interested in a new cleaning.", evidence: {} });
    await expect(harness(active(input, { bookingQuote: oldIntent })).generate(input)).rejects.toThrow("SMS_QUOTE_INTENT_NOT_CURRENT_INBOUND");
  });
  it("rejects evidence from another customer envelope", async () => {
    const input = fixture();
    (input.context.originalConversation as any[])[2].fromPhone = "+12025550124";
    await expect(harness(active(input)).generate(input)).rejects.toThrow("SMS_QUOTE_TURN_IDENTITY_MISMATCH");
  });
  it("rejects mismatched saved-state identity before knowledge or runner invocation", async () => {
    const input = fixture(), state = advanceSmsBookingQuote(null, update(input), { binding: input.context.binding as ClaudeCustomerSmsGenerationBinding,
      originalConversation: input.context.originalConversation as any[], nowMs: NOW }).state;
    state.customerPhone = "+12025550124";
    const h = harness(active(input), state);
    await expect(h.generate(input)).rejects.toThrow("SMS_QUOTE_STATE_IDENTITY_MISMATCH");
    expect(h.runner).not.toHaveBeenCalled(); expect(h.readKnowledge).not.toHaveBeenCalled();
  });

  it.each(["It is $250.", "Your price is USD 250.", "Your price is 250.", "Your quote: 250", "El precio es 250.", "That is 250 dollars.", "The first visit will be 250 US dollars.", "The first visit will be dollars 250.", "The discount is 20%.", "The price is €200.", "First cleaning: 250.", "Future visits: 200.", "The price is two hundred.", "El precio es doscientos."])("rejects generated active-quote monetary literals in both output text locations: %s", async text => {
    const input = fixture();
    await expect(harness(active(input, { replyText: text })).generate(input)).rejects.toThrow("SMS_QUOTE_MODEL_PRICE");
    await expect(harness(active(input, { quoteTextTemplate: `${linkTemplate} ${text}` })).generate(input)).rejects.toThrow("SMS_QUOTE_MODEL_PRICE");
  });
  it.each(["https://example.com/book/fake", "maidsinblack.com", "www.example.org", "/book/mib-fake"])("rejects actual URLs in active base and template: %s", async text => {
    const input = fixture();
    await expect(harness(active(input, { replyText: `Review ${text}` })).generate(input)).rejects.toThrow("SMS_QUOTE_MODEL_URL");
    await expect(harness(active(input, { quoteTextTemplate: `${linkTemplate} ${text}` })).generate(input)).rejects.toThrow("SMS_QUOTE_MODEL_URL");
  });
  it.each([
    "I'll send your link.", "We've updated your notes.", "Your booking is confirmed.",
    "Tomorrow is available.", "You're all set.", "We have reserved your appointment.",
    "Your slot is guaranteed.", "Your reservation is confirmed.", "Your time is reserved.",
    "I've reserved your appointment.", "Friday is available.", "Notes are in.", "We can fit you in.",
    "Tu reserva está confirmada.", "We have processed your payment.",
  ])("accepts active reply and template phrases with task:null while keeping the canonical quote presentation: %s", async text => {
    const input = fixture();
    for (const location of ["replyText", "quoteTextTemplate"] as const) {
      const h = harness(active(input, { [location]: location === "replyText" ? text : `${linkTemplate} ${text}` }));
      const plan = await h.generate(input);
      expect(plan.replyText).toBe(location === "replyText" ? text : active(input).replyText);
      expect(plan.task).toBeNull(); expect(plan.smsBookingQuote?.update).toEqual(update(input));
      expect(plan.smsBookingQuote?.quoteTextTemplate).toBe(canonicalPresentation(input));
      expect(h.runner).toHaveBeenCalledTimes(1);
    }
  });
  it.each(["{{customPrice}}", "{{ firstCleaningPrice }}", "{{bookingLink", "{price}"])("rejects unapproved or malformed template placeholder %s", async token => {
    const input = fixture();
    await expect(harness(active(input, { quoteTextTemplate: `${linkTemplate} ${token}` })).generate(input)).rejects.toThrow("SMS_QUOTE_TEMPLATE_PLACEHOLDER");
  });
  it("rejects template misuse, incomplete facts and raw placeholders in base replies", async () => {
    const input = fixture();
    await expect(harness(active(input, { bookingQuote: null })).generate(input)).rejects.toThrow("SMS_QUOTE_TEMPLATE_WITHOUT_UPDATE");
    await expect(harness(active(input, { bookingQuote: update(input, {}) })).generate(input)).rejects.toThrow("SMS_QUOTE_TEMPLATE_INCOMPLETE");
    await expect(harness(active(input, { bookingQuote: update(input, fields, { action: "collect" }) })).generate(input)).rejects.toThrow("SMS_QUOTE_TEMPLATE_INCOMPLETE");
    await expect(harness(active(input, { replyText: "Your price is {{firstCleaningPrice}}" })).generate(input)).rejects.toThrow("SMS_QUOTE_TEMPLATE_IN_REPLY");
  });
  it.each([
    "Booking code MIB-123, confirmation number ABC-456, msg-current, PN-actual. Requested time: 10:30 EST.",
    "We'll handle your request.", "We'll review this.", "We'll take care of your change.",
  ])("accepts reference/protected-ID presentation and pending-task acknowledgments in active replies and templates with task:null: %s", async text => {
    const input = fixture();
    const h = harness(active(input, { replyText: text, quoteTextTemplate: `${linkTemplate} ${text}` }));
    expect(await h.generate(input)).toEqual({ replyText: text, task: null,
      smsBookingQuote: { previous: null, update: update(input), originalConversation: input.context.originalConversation,
        quoteTextTemplate: canonicalPresentation(input) } });
    expect(h.runner).toHaveBeenCalledTimes(1);
  });
  it("does not block grounded room counts, condition-scale questions or timezone text in an active quote", async () => {
    const input = fixture(), replyText = "Your quote for 2 bedrooms is ready to review. You requested 10:30 EST.";
    expect((await harness(active(input, { replyText })).generate(input)).replyText).toBe(replyText);
    const collect = update(input, {}, { action: "collect", evidence: {} });
    const question = "What is the condition, from 1 for already clean, 5 for light or normal, to 10 for severe buildup?";
    expect((await harness(active(input, { replyText: question, bookingQuote: collect, quoteTextTemplate: null })).generate(input)).replyText).toBe(question);
  });

  it("isolates per-call metadata when simultaneous runs finish in the opposite order", async () => {
    const a = fixture("Please send a new cleaning quote, two bedrooms.");
    const b = fixture("Please send a new cleaning quote, three bedrooms.", undefined,
      { sessionId: 43, fromPhone: "+12025550124", providerMessageId: "msg-other", customerName: "Lucia Lane" });
    let releaseA!: () => void;
    const gateA = new Promise<void>(resolve => { releaseA = resolve; });
    let startedA!: () => void;
    const startA = new Promise<void>(resolve => { startedA = resolve; });
    const runner = vi.fn(async (options: InitialLeadDraftOptions) => {
      const payload = JSON.parse(options.userPrompt), isA = payload.context.binding.sessionId === 42;
      if (isA) { startedA(); await gateA; }
      const input = isA ? a : b;
      return { finalSmsText: JSON.stringify({ replyText: isA ? "How many bathrooms, Maya?" : "How many bathrooms, Lucia?", task: null,
        bookingQuote: update(input, { bedrooms: isA ? 2 : 3 }, { action: "collect" }), quoteTextTemplate: null }) };
    });
    const readState = vi.fn(async () => null);
    const generate = createSmsBookingQuoteReplyGenerator({ runner, readKnowledge: async () => MAIDS_IN_BLACK_KNOWLEDGE_BASE, smsBookingQuote: { readState } });
    const pendingA = generate(a); await startA;
    const planB = await generate(b); releaseA(); const planA = await pendingA;
    expect(planA.smsBookingQuote?.update.fields).toEqual({ bedrooms: 2 });
    expect(planB.smsBookingQuote?.update.fields).toEqual({ bedrooms: 3 });
    expect(planA.smsBookingQuote?.originalConversation).toBe(a.context.originalConversation);
    expect(planB.smsBookingQuote?.originalConversation).toBe(b.context.originalConversation);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("propagates repeated provider failure after exactly two calls without a synthetic reply", async () => {
    const runner = vi.fn(async () => { throw new Error("OFFLINE_RUNNER_FAILURE"); });
    const generate = createSmsBookingQuoteReplyGenerator({ runner, readKnowledge: async () => MAIDS_IN_BLACK_KNOWLEDGE_BASE, smsBookingQuote: { readState: async () => null } });
    await expect(generate(fixture())).rejects.toThrow("OFFLINE_RUNNER_FAILURE");
    expect(runner).toHaveBeenCalledTimes(2);
  });
  it("contains no extra provider, DB, send, classifier, cap or mutation path", () => {
    const source = readFileSync(new URL("./smsBookingQuoteGeneration.ts", import.meta.url), "utf8");
    expect(source).toContain("options.runner ?? runInitialLeadDraft");
    expect(source).toContain("advanceSmsBookingQuote(previous, update");
    expect(source).not.toMatch(/invokeLLM|runGeneralSmsDraft|sendSms|fetch\(|getDb|\.slice\(|maxTokens|max_tokens|setInterval|setTimeout/);
    for (const instruction of ["CURRENT incomingMessage", "zero-based", "restart:true ONLY", "phone is ALWAYS", "never a phone-confirmation question", "COMPLETE customer-facing quote", "quotePresentationLanguage", "its layout is never rendered"]) {
      expect(SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS).toContain(instruction);
    }
  });
});

describe("server-owned booking quote presentation", () => {
  const url = "https://quote.maidinblack.com/book/mib-synthetic-quote";
  const pricing = (changes: Partial<PublicBookingPricingInput> = {}): PublicBookingPricingInput => ({
    pricingMode: "home", serviceId: "standard", bedrooms: 2, bathrooms: 2, homeType: "House", condition: 5,
    maidCount: 1, hourCount: 1, extras: [], recurrence: "one-time", ...changes,
  });
  const format = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  const originalCallFormatter = () => {
    const source = execFileSync("git", ["show", "b1bf3cff91be631ec7a38e2675a28993ebd3e1d6:server/instinct/callBookingQuoteApplication.ts"], { encoding: "utf8" });
    const formatter = source.substring(source.indexOf("const money ="), source.indexOf("\ntype Store ="));
    expect(formatter).toContain("export function buildCallBookingQuoteSms");
    const js = ts.transpileModule(formatter.replace("export function", "function"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function("createPublicBookingPriceSnapshot", `${js}\nreturn buildCallBookingQuoteSms;`)(createPublicBookingPriceSnapshot) as typeof buildCallBookingQuoteSms;
  };

  it.each([
    { name: "sparse $383 biweekly quote with no extras/future placeholders", changes: { serviceId: "deep", bedrooms: 3, recurrence: "biweekly" }, template: "First cleaning: {{firstCleaningPrice}}. Review: {{bookingLink}}.", first: "$383", future: "$325", extras: "No add-ons selected" },
    { name: "sparse $428 quote omitting Inside Fridge", changes: { serviceId: "deep", bedrooms: 3, recurrence: "biweekly", extras: [{ id: "inside-fridge", quantity: 1 }] }, template: "First cleaning: {{firstCleaningPrice}}. Review: {{bookingLink}}.", first: "$428", future: "$325", extras: "Inside Fridge" },
    { name: "weekly future sentence incorrectly repeating the $359 first price", changes: { recurrence: "weekly", extras: [{ id: "inside-fridge", quantity: 1 }, { id: "inside-oven", quantity: 1 }] }, template: "First cleaning: {{firstCleaningPrice}}. Weekly future visits: {{firstCleaningPrice}}. {{extras}}.", first: "$359", future: "$215", extras: "Inside Fridge" },
  ])("accepts and server-corrects the actual generator output for $name", async row => {
    const input = fixture(), bookingQuote = update(input, { ...fields, ...row.changes } as SmsBookingQuoteFields);
    const h = harness(active(input, { bookingQuote, quoteTextTemplate: row.template }));
    const plan = await h.generate(input);
    const advanced = advanceSmsBookingQuote(null, bookingQuote, { binding: input.context.binding as ClaudeCustomerSmsGenerationBinding,
      originalConversation: input.context.originalConversation as any[], nowMs: NOW });
    if (!advanced.preview?.success) throw Error("Expected complete canonical quote");
    const rendered = renderSmsBookingQuoteText(plan.replyText, plan.smsBookingQuote?.quoteTextTemplate, advanced.preview.priceSnapshot, url);
    expect(rendered).toContain(`Your first-cleaning quote is ${row.first}.`);
    expect(rendered).toContain(`Your ${row.changes.recurrence} follow-up cleaning price is ${row.future}.`);
    expect(rendered).toContain(row.extras);
    expect(rendered).toContain(url);
    expect(rendered.startsWith(`${plan.replyText}\n\n`)).toBe(true);
    expect(rendered).not.toMatch(/\{\{|N\/A/);
    expect(rendered.split(row.first)).toHaveLength(2);
    expect(h.runner).toHaveBeenCalledTimes(1);
    // Even bypassing generator canonicalization cannot let an old model layout own facts.
    expect(renderSmsBookingQuoteText(plan.replyText, row.template, advanced.preview.priceSnapshot, url)).toBe(rendered);
  });

  it.each([
    "Here is the link: {{bookingLink}}",
    "First cleaning: {{firstCleaningPrice}}.",
    "First cleaning: {{firstCleaningPrice}}. Future: {{futureVisitPrice}}.",
    "Here are the quote details for your review.",
    null,
  ])("rebuilds complete one-time facts without rejecting usable old layout %j", async quoteTextTemplate => {
    const input = fixture(), h = harness(active(input, { quoteTextTemplate }));
    const plan = await h.generate(input);
    expect(plan.smsBookingQuote?.quoteTextTemplate).toBe(canonicalPresentation(input));
    const snapshot = createPublicBookingPriceSnapshot(pricing());
    const rendered = renderSmsBookingQuoteText(plan.replyText, plan.smsBookingQuote?.quoteTextTemplate, snapshot, url);
    expect(rendered).toContain("Your first-cleaning quote is $269.");
    expect(rendered).toContain("No add-ons selected");
    expect(rendered).not.toMatch(/future|follow-up|N\/A|\{\{/);
    expect(rendered.split(url)).toHaveLength(2);
    expect(h.runner).toHaveBeenCalledTimes(1);
  });

  it("keeps duplicate-link validation before preparing the canonical presentation", async () => {
    const input = fixture(), quoteTextTemplate = "First cleaning: {{firstCleaningPrice}}. {{bookingLink}} {{bookingLink}}";
    await expect(harness(active(input, { quoteTextTemplate })).generate(input)).rejects.toThrow("SMS_QUOTE_TEMPLATE_LINK_COUNT");
  });

  it("preserves personalized Spanish acknowledgement and complete localized facts using one structured language hint", async () => {
    const input = fixture("Quiero una cotización para una limpieza nueva."), bookingQuote = update(input, { ...fields,
      recurrence: "biweekly", extras: [{ id: "inside-fridge", quantity: 1 }, { id: "interior-windows", quantity: 3 }] }, { action: "quote" });
    const replyText = "¡Gracias, Maya! Qué alegría que estés emocionada por tu hogar. 🧹";
    const h = harness(active(input, { replyText, bookingQuote, quoteTextTemplate: null, quotePresentationLanguage: "es" }));
    const plan = await h.generate(input), snapshot = createPublicBookingPriceSnapshot(pricing({ recurrence: "biweekly",
      extras: [{ id: "inside-fridge", quantity: 1 }, { id: "interior-windows", quantity: 3 }] }));
    const rendered = renderSmsBookingQuoteText(plan.replyText, plan.smsBookingQuote?.quoteTextTemplate, snapshot, null);
    expect(plan.replyText).toBe(replyText);
    expect(rendered).toBe(`${replyText}\n\nTu cotización para la primera limpieza es $344.\nPróximas visitas (cada dos semanas): $229.\nServicios adicionales:\nInterior del refrigerador\n3 × Ventanas interiores`);
    expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.readKnowledge).toHaveBeenCalledTimes(1);
  });

  it("renders Spanish confirmed-none and verified link without English fallback or extra model calls", async () => {
    const input = fixture(), h = harness(active(input, { replyText: "Gracias, Maya. Aquí puedes revisar los detalles.", quoteTextTemplate: null, quotePresentationLanguage: "es" }));
    const plan = await h.generate(input), snapshot = createPublicBookingPriceSnapshot(pricing());
    const rendered = renderSmsBookingQuoteText(plan.replyText, plan.smsBookingQuote?.quoteTextTemplate, snapshot, url);
    expect(rendered).toContain("No se seleccionaron servicios adicionales");
    expect(rendered).toContain("Revisa los detalles, elige tu horario y completa tu reserva");
    expect(rendered).toContain(url);
    expect(rendered).not.toMatch(/Your|No add-ons|follow-up|\{\{/);
    expect(h.runner).toHaveBeenCalledTimes(1);
  });

  it("does not let model layout select price/extras placement even when it resembles the Spanish canonical presentation", () => {
    const snapshot = createPublicBookingPriceSnapshot(pricing({ recurrence: "weekly" }));
    const spanish = createSmsBookingQuotePresentation(snapshot, true, "es");
    const altered = spanish.replace("{{futureVisitPrice}}", "{{firstCleaningPrice}}").replace("{{extras}}", "");
    const rendered = renderSmsBookingQuoteText("Thanks, Maya!", altered, snapshot, url);
    expect(rendered).toContain("Your first-cleaning quote is $269.");
    expect(rendered).toContain("Your weekly follow-up cleaning price is $215.");
    expect(rendered).toContain("No add-ons selected");
    expect(rendered.split("$269")).toHaveLength(2);
  });

  it("matches the actual pinned HEAD call formatter byte-for-byte across canonical modes, services, recurrences, domains and all extras", () => {
    const original = originalCallFormatter();
    const extras = [[], [{ id: "inside-fridge", quantity: 1 }], Object.keys(PUBLIC_BOOKING_PRICED_EXTRAS).map((id, index) => ({ id, quantity: index + 1 }))];
    let comparisons = 0;
    for (const pricingMode of ["home", "hourly"] as const) for (const serviceId of ["standard", "deep", "moveout"] as const)
      for (const recurrence of ["one-time", "weekly", "biweekly", "monthly"] as const) for (let bedrooms = 0; bedrooms <= 7; bedrooms++) for (const selectedExtras of extras) {
        const input: CreateCustomerBookingLinkInput = { customerName: bedrooms % 2 ? "Ángela Muñoz" : "Maya Lane", customerPhone: "+12025550123",
          requestedLocalDate: FUTURE_DATE, requestedLocalTime: "10:30", notes: [], pricing: pricing({ pricingMode, serviceId, recurrence, bedrooms,
            bathrooms: bedrooms % 5 + 1, condition: bedrooms % 2 ? 10 : 5, homeType: (["House", "Apartment", "Townhome", "Condo"] as const)[bedrooms % 4],
            maidCount: bedrooms % 4 + 1, hourCount: bedrooms + 1, extras: selectedExtras }) };
        const snapshot = createPublicBookingPriceSnapshot(input.pricing), link = { token: "mib-synthetic-quote", urlPath: "/book/mib-synthetic-quote", firstCleaningTotalCents: snapshot.breakdown.firstCleaningTotalCents };
        expect(buildCallBookingQuoteSms(input, link, "https://quote.maidinblack.com")).toBe(original(input, link, "https://quote.maidinblack.com"));
        const sms = renderSmsBookingQuoteText("Thanks!", null, snapshot, url);
        expect(sms).toContain(format(snapshot.breakdown.firstCleaningTotalCents));
        if (snapshot.breakdown.futureVisitTotalCents !== null) expect(sms).toContain(format(snapshot.breakdown.futureVisitTotalCents));
        for (const extra of snapshot.breakdown.extras) expect(sms).toContain(`${extra.quantity > 1 ? `${extra.quantity} × ` : ""}${extra.label}`);
        comparisons++;
      }
    expect(comparisons).toBe(576);
    // Exercise every remaining condition value and cents formatting supported by
    // the formatter's wider public input type, not new call pricing permissions.
    for (let condition = 1; condition <= 10; condition++) for (const customPriceCents of [undefined, 12345, 12300]) {
      const input: CreateCustomerBookingLinkInput = { customerName: "  Maya Lane", customerPhone: "+12025550123", requestedLocalDate: FUTURE_DATE,
        requestedLocalTime: "10:30", notes: [], pricing: pricing({ condition, customPriceCents, recurrence: "weekly" }) };
      const link = { token: "mib-synthetic-quote", urlPath: "/book/mib-synthetic-quote", firstCleaningTotalCents: createPublicBookingPriceSnapshot(input.pricing).breakdown.firstCleaningTotalCents };
      expect(buildCallBookingQuoteSms(input, link, "https://quote.maidinblack.com")).toBe(original(input, link, "https://quote.maidinblack.com"));
    }
  });

  it("preserves original call link and price rejection behavior exactly", () => {
    const original = originalCallFormatter();
    const input: CreateCustomerBookingLinkInput = { customerName: "Maya Lane", customerPhone: "+12025550123", requestedLocalDate: FUTURE_DATE,
      requestedLocalTime: "10:30", notes: [], pricing: pricing() };
    const firstCleaningTotalCents = createPublicBookingPriceSnapshot(input.pricing).breakdown.firstCleaningTotalCents;
    for (const [urlPath, cents] of [["https://attacker.example/book/mib-bad", firstCleaningTotalCents], ["/book/mib-good?q=bad", firstCleaningTotalCents],
      ["/book/mib-good#bad", firstCleaningTotalCents], ["/not-a-booking", firstCleaningTotalCents], ["/book/mib-good", firstCleaningTotalCents + 1]] as const) {
      const link = { token: "mib-good", urlPath, firstCleaningTotalCents: cents };
      let expectedError = "";
      try { original(input, link, "https://quote.maidinblack.com"); } catch (error) { expectedError = (error as Error).message; }
      expect(expectedError).not.toBe("");
      expect(() => buildCallBookingQuoteSms(input, link, "https://quote.maidinblack.com")).toThrow(expectedError);
    }
  });
});
