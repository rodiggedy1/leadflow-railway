import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { PUBLIC_BOOKING_PRICED_EXTRAS, type PublicBookingPricingInput } from "../../shared/publicBookingPricing";
import { buildSystemPrompt } from "../csReplyStream";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "../knowledgeBase";
import type { InitialLeadDraftOptions } from "./claudeAgentClient";
import { renderSmsBookingQuoteText } from "./bookingQuotePresentation";
import { previewCallBookingQuote } from "./callBookingQuote";
import {
  CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS,
  CLAUDE_CUSTOMER_SMS_STYLE_INSTRUCTIONS,
  createClaudeCustomerReplyGenerator,
  type ClaudeCustomerReplyInput,
  type ClaudeCustomerSmsGenerationBinding,
} from "./claudeCustomerSmsGeneration";
import {
  advanceSmsBookingQuote,
  assertSmsBookingQuoteModelText,
  type SmsBookingQuoteAdvanceResult,
  type SmsBookingQuoteFields,
  type SmsBookingQuoteState,
  type SmsBookingQuoteUpdate,
} from "./smsBookingQuote";
import { createSmsBookingQuoteReplyGenerator, SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS } from "./smsBookingQuoteGeneration";
import { createSmsBookingQuoteMissingQuestion } from "./smsBookingQuoteMissingQuestion";
import { withoutApprovedStaffCallFeature } from "../staffCallSourceControl";

// These are offline preservation/contract tests, not a real Claude compliance evaluation.
// All content and state readers are injected; no stores, transports or live models run.
const BASELINE = "30445a6f98a69af8e6db27c16c9cce380c26031a";
const NOW = Date.parse("2026-11-17T17:00:00.000Z");
const DATE = "2026-11-18";
const URL = "https://quote.maidinblack.com/book/mib-synthetic-writing-style";
type Language = "en" | "es";
const conditionQuestions: Record<Language, string> = {
  en: "How much cleaning does it need (1 to 10)?\n1 = already clean, 5 = normal, 10 = heavy buildup.",
  es: "¿Cuánta limpieza necesita (del 1 al 10)?\n1 = limpio, 5 = normal, 10 = mucha suciedad.",
};
const matrix = (["standard", "deep", "moveout"] as const).flatMap(serviceId =>
  (["home", "hourly"] as const).flatMap(pricingMode =>
    (["en", "es"] as const).map(language => ({ serviceId, pricingMode, language }))));
const localesAndActions = (["en", "es"] as const).flatMap(language =>
  (["quote", "link"] as const).map(action => ({ language, action })));
const emojis: Record<string, string> = {
  "inside-cabinets": "🗄️", "inside-fridge": "🧊", "inside-oven": "🍳", "interior-windows": "🪟",
  basement: "🏠", "organizing-hour": "📦", "laundry-load": "🧺", "wipe-walls-room": "🧽", "sweep-garage": "🧹",
};
// Localized labels mirror the existing, protected canonical renderer; IDs/units stay catalog-owned.
const spanishLabels: Record<string, string> = {
  "inside-cabinets": "Interior de los gabinetes", "inside-fridge": "Interior del refrigerador",
  "inside-oven": "Interior del horno", "interior-windows": "Ventanas interiores", basement: "Sótano",
  "organizing-hour": "Una hora de organización", "laundry-load": "Lavandería",
  "wipe-walls-room": "Limpieza de paredes", "sweep-garage": "Barrido del garaje",
};
const spanishUnits: Record<string, string> = { window: "ventanas", hour: "horas", load: "cargas", room: "habitaciones" };
const extrasLines = (language: Language) => Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS).map(([id, extra]) =>
  `${emojis[id]} ${language === "es" ? spanishLabels[id] : extra.label}${extra.quantityUnit
    ? ` (${language === "es" ? spanishUnits[extra.quantityUnit] : `${extra.quantityUnit}s`})` : ""}`);
const questionReply = (language: Language) => `${conditionQuestions[language]}\n\n${language === "es" ? "¿Algún servicio adicional?" : "Any extras?"}\n${extrasLines(language).join("\n")}\n${language === "es"
  ? "Dime cuáles y cuántos, o ninguno." : "Tell me which and how many, or no extras."}`;
function pricing(row: Pick<(typeof matrix)[number], "pricingMode" | "serviceId">): PublicBookingPricingInput {
  return { pricingMode: row.pricingMode, serviceId: row.serviceId, bedrooms: 2, bathrooms: 2, homeType: "House", condition: 5,
    maidCount: row.pricingMode === "home" ? 1 : 2, hourCount: row.pricingMode === "home" ? 1 : 3,
    recurrence: "weekly", extras: Object.keys(PUBLIC_BOOKING_PRICED_EXTRAS).map((id, index) => ({ id, quantity: index + 2 })) };
}
function fields(row: Pick<(typeof matrix)[number], "pricingMode" | "serviceId">): SmsBookingQuoteFields {
  return { ...pricing(row), extras: [...pricing(row).extras], extrasConfirmed: true,
    address: "123 Synthetic Street, Washington DC", requestedLocalDate: DATE, requestedLocalTime: "10:30" };
}
function fixture(text: string): ClaudeCustomerReplyInput {
  const originalConversation = [
    { role: "customer", content: "I'd like a new cleaning quote.", opMsgId: "synthetic-old" },
    { role: "assistant", content: "Which service and home details?" },
    { role: "customer", content: text, opMsgId: "synthetic-current", direction: "incoming" },
  ];
  const binding: ClaudeCustomerSmsGenerationBinding = {
    sessionId: 42, providerMessageId: "synthetic-current", fromPhone: "+12025550123",
    receivingPhoneNumberId: "PN-synthetic", receivingPhoneNumber: "+12025550999",
    inboundText: text, createdAt: NOW - 1, receivedAt: NOW, customerName: "Maya Lane",
    historyHash: createHash("sha256").update(JSON.stringify(originalConversation)).digest("hex"),
  };
  return { incomingMessage: text, context: { binding, originalConversation, bookingContext: null,
    contact: { sessionId: "42", displayName: binding.customerName, phone: binding.fromPhone },
    receivingPhoneNumberId: binding.receivingPhoneNumberId, receivingPhoneNumber: binding.receivingPhoneNumber },
    protectedIds: [binding.providerMessageId, binding.receivingPhoneNumberId] };
}
function update(input: ClaudeCustomerReplyInput, patch: SmsBookingQuoteFields, action: SmsBookingQuoteUpdate["action"]): SmsBookingQuoteUpdate {
  return { action, intentEvidenceQuote: input.incomingMessage, fields: structuredClone(patch),
    evidence: Object.fromEntries(Object.keys(patch).map(key => [key, { turnIndex: 2, quote: input.incomingMessage }])) };
}
function advance(input: ClaudeCustomerReplyInput, patch: SmsBookingQuoteUpdate, previous: SmsBookingQuoteState | null = null) {
  return advanceSmsBookingQuote(previous, patch, { binding: input.context.binding as ClaudeCustomerSmsGenerationBinding,
    originalConversation: input.context.originalConversation as any[], nowMs: NOW });
}
function harness(output: unknown, previous: SmsBookingQuoteState | null = null) {
  const runner = vi.fn(async (_options: InitialLeadDraftOptions) => ({ finalSmsText: JSON.stringify(output) }));
  const readKnowledge = vi.fn(async () => MAIDS_IN_BLACK_KNOWLEDGE_BASE);
  const readState = vi.fn(async (_binding: ClaudeCustomerSmsGenerationBinding) => previous);
  return { runner, readKnowledge, readState,
    generate: createSmsBookingQuoteReplyGenerator({ runner, readKnowledge, smsBookingQuote: { readState } }) };
}
let network: ReturnType<typeof vi.spyOn>;
beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("OFFLINE_ONLY")); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.restoreAllMocks(); });

describe("SMS-only writing instructions", () => {
  it("requires direct shorter complete replies without repeating recaps or changing tasks or limits", () => {
    const instructions = SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS;
    for (const rule of [
      "replyText for quotes AND ordinary customer-service SMS", "Answer the current message directly",
      "shortest complete, warm reply", "skip repeated greetings, repeated reassurance",
      "Ask the next needed question rather than recap every collected fact",
      "Preserve necessary answers, important clarifications, approved knowledge",
      "truthful pending-human task acknowledgements", "Never shorten task titles, checklist actions or literal evidence for style",
      "No character or token limit, truncation, extra model call or output rewriting",
      "friendly acknowledgement plus only useful grounded details, on separate short lines",
      "label it as requested, not confirmed", "Do not repeat the full address, rooms, condition, recurrence and extras",
      "Do not repeat the price, selected-extras summary or booking-page instructions",
      "not over safety or required facts",
    ]) expect(instructions).toContain(rule);
  });
  it("requires one relevant emoji-led plain SMS line per canonical extra, with quantities and no repeated menu", () => {
    const instructions = SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS;
    for (const rule of ["short heading", "each listed extra on its own line", "starting with a relevant emoji as the bullet",
      "plain SMS text, not Markdown, asterisks or dash bullets", "preserve its labels and quantity units",
      "ask how many", "short option to choose no extras", "with a blank line, not one long paragraph",
      "Do not re-offer the full extras menu", "actual selections and quantities", "every supported service and both pricing modes",
      "explicit positive whole numbers (1-50)", "no duplicate IDs", "extras:[] requires explicit customer confirmation of none",
      "customer evidence not predating the latest extras change"]) expect(instructions).toContain(rule);
    for (const [id, extra] of Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS)) {
      expect(instructions).toContain(`${id} (${extra.label}${extra.quantityUnit ? `; quantity in ${extra.quantityUnit}s` : ""})`);
    }
    expect(Object.keys(emojis).sort()).toEqual(Object.keys(PUBLIC_BOOKING_PRICED_EXTRAS).sort());
    expect(Object.keys(spanishLabels).sort()).toEqual(Object.keys(PUBLIC_BOOKING_PRICED_EXTRAS).sort());
  });
  it("explains the unchanged workload meaning succinctly, with no second explanatory paragraph", () => {
    for (const rule of ["1 = already clean; 5 = light / normal; 10 = severe buildup / needs a serious reset",
      "Higher means more work, not a cleaner home", "Ask succinctly on two lines", "in the customer's language",
      conditionQuestions.en.split("\n")[0], conditionQuestions.en.split("\n")[1],
      "Do not add a second paragraph repeating the scale explanation"]) expect(SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS).toContain(rule);
  });
});

describe("actual generator preserves concrete formatted collecting replies", () => {
  it.each(matrix)("preserves $language $serviceId $pricingMode condition/extras lines and qualification", async row => {
    const priorFields = fields(row);
    delete priorFields.condition; delete priorFields.extras; delete priorFields.extrasConfirmed;
    priorFields.notes = ["Please avoid the synthetic study."];
    const priorInput = fixture(`Please prepare a NEW ${row.serviceId} ${row.pricingMode} quote: 2 bedrooms, 2 bathrooms, House, weekly, two cleaners for three hours, 123 Synthetic Street, Washington DC, ${DATE} at 10:30. Please avoid the synthetic study.`);
    const previous = advance(priorInput, update(priorInput, priorFields, "collect")).state;
    const input = fixture(`For my NEW ${row.serviceId} ${row.pricingMode} cleaning quote, make that 3 bedrooms.`);
    const bookingQuote = update(input, { bedrooms: 3 }, "collect");
    const replyText = questionReply(row.language);
    const h = harness({ replyText, task: null, bookingQuote, quotePresentationLanguage: row.language }, previous);
    const before = JSON.stringify({ input, previous, bookingQuote });
    const plan = await h.generate(input);
    expect(plan.replyText).toBe(replyText); expect(plan.task).toBeNull();
    expect(plan.smsBookingQuote).toEqual({ previous, update: bookingQuote,
      originalConversation: input.context.originalConversation, quoteTextTemplate: null });
    const lines = extrasLines(row.language);
    expect(lines).toHaveLength(Object.keys(PUBLIC_BOOKING_PRICED_EXTRAS).length);
    for (const [index, [id, extra]] of Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS).entries()) {
      expect(lines[index]).toBe(`${emojis[id]} ${row.language === "es" ? spanishLabels[id] : extra.label}${extra.quantityUnit
        ? ` (${row.language === "es" ? spanishUnits[extra.quantityUnit] : `${extra.quantityUnit}s`})` : ""}`);
      expect(lines[index]).toMatch(/^\p{Extended_Pictographic}/u);
      expect(lines[index]).not.toMatch(/^[\s*-]|\*/);
      expect(plan.replyText.split("\n")).toContain(lines[index]);
    }
    expect(plan.replyText.startsWith(`${conditionQuestions[row.language]}\n\n`)).toBe(true);
    expect(plan.replyText).not.toMatch(/\$|https?:|\{\{|\*/);
    expect(() => assertSmsBookingQuoteModelText(plan.replyText)).not.toThrow();
    const result = advance(input, plan.smsBookingQuote!.update, previous);
    expect(result.missing).toEqual(["condition", "extras", "extrasConfirmed"]);
    expect(result.preview).toBeNull(); expect(result.input).toBeNull();
    expect(result.state.fields).toEqual({ ...previous.fields, bedrooms: 3 });
    expect(result.state.evidence).toEqual({ ...previous.evidence, bedrooms: bookingQuote.evidence.bedrooms });
    expect(result.state.revision).toBe(previous.revision + 1);
    expect(plan.smsBookingQuote!.update).not.toHaveProperty("restart");
    expect(JSON.stringify({ input, previous, bookingQuote })).toBe(before);
    expect(h.runner).toHaveBeenCalledTimes(1); expect(h.readKnowledge).toHaveBeenCalledTimes(1); expect(h.readState).toHaveBeenCalledTimes(1);
  });
});

describe("succinct localized missing-condition presentation", () => {
  it.each(localesAndActions)("pure $action helper returns the exact $language question without mutating qualification", ({ language, action }) => {
    const input = fixture("Please prepare my NEW standard home quote, 2 bedrooms, 2 bathrooms, House, weekly, no extras confirmed.");
    const patch = fields({ pricingMode: "home", serviceId: "standard" }); delete patch.condition;
    const advanced: SmsBookingQuoteAdvanceResult = advance(input, update(input, patch, action));
    expect(advanced.missing).toEqual(["condition"]);
    const before = JSON.stringify(advanced);
    const question = createSmsBookingQuoteMissingQuestion(advanced, action, language);
    expect(question).toBe(conditionQuestions[language]); expect(question!.split("\n")).toHaveLength(2);
    expect(() => assertSmsBookingQuoteModelText(question!)).not.toThrow();
    expect(question).not.toMatch(/\$|https?:|\{\{|confirmed|confirmada/);
    expect(JSON.stringify(advanced)).toBe(before); expect(advanced.preview).toBeNull(); expect(advanced.input).toBeNull();
    expect(createSmsBookingQuoteMissingQuestion(advanced, "collect", language)).toBeNull();
  });
  it.each(localesAndActions)("actual incomplete $action generator uses $language condition helper with unchanged patch/evidence", async ({ language, action }) => {
    const input = fixture(`Please prepare my NEW deep hourly quote: 2 bedrooms, 2 bathrooms, House, 2 cleaners for 3 hours, weekly, no extras confirmed, ${DATE} at 10:30, 123 Synthetic Street, Washington DC.`);
    const patch = fields({ pricingMode: "hourly", serviceId: "deep" }); delete patch.condition;
    const bookingQuote = update(input, patch, action), before = JSON.stringify({ input, bookingQuote });
    const h = harness({ replyText: language === "es" ? "Aquí están los detalles." : "Here are the details.", task: null, bookingQuote, quotePresentationLanguage: language });
    const plan = await h.generate(input);
    expect(plan.replyText).toBe(conditionQuestions[language]); expect(plan.task).toBeNull();
    expect(plan.smsBookingQuote).toEqual({ previous: null, update: bookingQuote,
      originalConversation: input.context.originalConversation, quoteTextTemplate: null, missingQuestionLanguage: language });
    expect(advance(input, plan.smsBookingQuote!.update).missing).toEqual(["condition"]);
    expect(JSON.stringify({ input, bookingQuote })).toBe(before); expect(h.runner).toHaveBeenCalledTimes(1);
  });
});

describe("brief formatted introduction before the complete canonical quote", () => {
  it.each(matrix)("keeps $language $serviceId $pricingMode recap, canonical prices/extras/quantities and one verified URL", async row => {
    const patch = fields(row);
    const selections = patch.extras!.map(extra => `${extra.id} quantity ${extra.quantity}`).join(", ");
    const input = fixture(`Please send a NEW ${row.serviceId} ${row.pricingMode} cleaning quote link: 2 bedrooms, 2 bathrooms, House, condition 5, 2 cleaners for 3 hours, weekly, ${selections}, all extras confirmed, 123 Synthetic Street, Washington DC, ${DATE} at 10:30.`);
    const bookingQuote = update(input, patch, "link");
    const replyText = row.language === "es" ? `¡Gracias, Maya! 🧹\n📅 Fecha solicitada: ${DATE} a las 10:30.` : `Thanks, Maya! 🧹\n📅 Requested: ${DATE} at 10:30.`;
    const h = harness({ replyText, task: null, bookingQuote, quotePresentationLanguage: row.language });
    const before = JSON.stringify({ input, bookingQuote });
    const plan = await h.generate(input);
    expect(plan.replyText).toBe(replyText); expect(plan.task).toBeNull();
    expect(plan.smsBookingQuote!.update).toEqual(bookingQuote);
    const advanced = advance(input, plan.smsBookingQuote!.update);
    expect(advanced.missing).toEqual([]); expect(advanced.input).not.toBeNull();
    expect(advanced.input!.pricing).toEqual(pricing(row));
    expect(Object.keys(advanced.input!.pricing).sort()).toEqual(Object.keys(pricing(row)).sort());
    expect(advanced.input!.pricing).not.toHaveProperty("customPriceCents");
    expect(advanced.input!.customerPhone).toBe((input.context.binding as ClaudeCustomerSmsGenerationBinding).fromPhone);
    const preview = previewCallBookingQuote({ pricing: advanced.input!.pricing, extrasConfirmed: true });
    if (!preview.success || !advanced.preview?.success) throw new Error("Expected complete synthetic canonical preview");
    expect(preview.priceSnapshot).toEqual(advanced.preview.priceSnapshot);
    const snapshotBefore = JSON.stringify(preview.priceSnapshot);
    const rendered = renderSmsBookingQuoteText(plan.replyText, plan.smsBookingQuote!.quoteTextTemplate, preview.priceSnapshot, URL);
    expect(rendered.startsWith(`${replyText}\n\n`)).toBe(true);
    expect(rendered).toContain(row.language === "es" ? `Tu cotización para la primera limpieza es ${preview.priceFormatted}.` : `Your first-cleaning quote is ${preview.priceFormatted}.`);
    expect(preview.futureVisitPriceFormatted).not.toBe(preview.priceFormatted);
    expect(rendered).toContain(row.language === "es" ? `Próximas visitas (semanales): ${preview.futureVisitPriceFormatted}.` : `Your weekly follow-up cleaning price is ${preview.futureVisitPriceFormatted}.`);
    expect(rendered.split(preview.priceFormatted)).toHaveLength(2);
    expect(rendered.split(preview.futureVisitPriceFormatted!)).toHaveLength(2);
    for (const extra of preview.priceSnapshot.breakdown.extras) {
      expect(rendered.split("\n")).toContain(`${extra.quantity} × ${row.language === "es" ? spanishLabels[extra.id] : extra.label}`);
    }
    expect(rendered.split(URL)).toHaveLength(2);
    expect(rendered.match(/https?:\/\/[^\s]+/g)).toEqual([URL]);
    expect(rendered).not.toMatch(/\{\{|N\/A/);
    expect(replyText).not.toContain(patch.address!); expect(replyText).not.toMatch(/bedroom|habitacion|condition|extras|book|reserva/i);
    expect(JSON.stringify(preview.priceSnapshot)).toBe(snapshotBefore);
    expect(JSON.stringify({ input, bookingQuote })).toBe(before);
    expect(h.runner).toHaveBeenCalledTimes(1); expect(h.readState).toHaveBeenCalledTimes(1); expect(h.readKnowledge).toHaveBeenCalledTimes(1);
  });
});

describe("ordinary SMS uses the same additive writing rules without changing shared/email/task behavior", () => {
  it("passes the actual writing overlay plus the unchanged full base prompt for an approved FAQ with no task or quote metadata", async () => {
    const input = fixture("Do you bring your own supplies?");
    const faq = /\*\*Q: Do you bring your own supplies\?\*\*\nA: ([^\n]+)/.exec(MAIDS_IN_BLACK_KNOWLEDGE_BASE)?.[1];
    expect(faq).toBe("Yes, all professional-grade products and equipment are provided.");
    const h = harness({ replyText: faq, task: null, bookingQuote: null });
    expect(await h.generate(input)).toEqual({ replyText: faq, task: null });
    const baseRunner = vi.fn(async (_options: InitialLeadDraftOptions) => ({ finalSmsText: JSON.stringify({ replyText: faq, task: null }) }));
    await createClaudeCustomerReplyGenerator({ readKnowledge: async () => MAIDS_IN_BLACK_KNOWLEDGE_BASE, runner: baseRunner })(input);
    const sent = h.runner.mock.calls[0][0];
    expect(sent.systemPrompt).toBe(`=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===\n${SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS}\n\n${baseRunner.mock.calls[0][0].systemPrompt}`);
    expect(sent.systemPrompt).toContain("replyText for quotes AND ordinary customer-service SMS");
    expect(sent.systemPrompt).toContain(CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS);
    expect(sent.systemPrompt).toContain(CLAUDE_CUSTOMER_SMS_STYLE_INSTRUCTIONS);
    expect(sent.systemPrompt.endsWith(buildSystemPrompt())).toBe(true);
    expect(sent.systemPrompt).toContain(MAIDS_IN_BLACK_KNOWLEDGE_BASE);
    expect(JSON.parse(sent.userPrompt).context.knowledgeBase).toBe(MAIDS_IN_BLACK_KNOWLEDGE_BASE);
    expect(h.readKnowledge).toHaveBeenCalledWith(input.incomingMessage);
    expect(h.runner).toHaveBeenCalledTimes(1); expect(baseRunner).toHaveBeenCalledTimes(1);
  });
  it("preserves a real pending-human checklist and literal evidence byte-for-byte while allowing a brief reply", async () => {
    const input = fixture("Please cancel my existing cleaning and have the team call me.");
    const task = { title: "Review cancellation and callback", items: [
      { title: "Review the requested cancellation", evidenceQuote: "cancel my existing cleaning" },
      { title: "Arrange the requested team callback", evidenceQuote: "have the team call me" },
    ] };
    const replyText = "Thanks, Maya. We'll review your request and confirm once updated.";
    const h = harness({ replyText, task, bookingQuote: null });
    expect(await h.generate(input)).toEqual({ replyText, task }); expect(h.runner).toHaveBeenCalledTimes(1);
    const invalid = structuredClone(task); invalid.items[0].evidenceQuote = "a paraphrased request";
    await expect(harness({ replyText, task: invalid, bookingQuote: null }).generate(input)).rejects.toThrow("TASK_EVIDENCE_NOT_CURRENT_INBOUND");
  });
  it.each([
    { replyText: "Your quote is $250.", error: "SMS_QUOTE_MODEL_PRICE" },
    { replyText: "Review https://example.com/book/fake", error: "SMS_QUOTE_MODEL_URL" },
    { replyText: "Your booking is confirmed.", error: "UNSAFE_REPLY_CLAIM" },
  ])("retains quote safety for a brief but unsafe response: $error", async ({ replyText, error }) => {
    const input = fixture("Please prepare a NEW cleaning quote.");
    const h = harness({ replyText, task: null, bookingQuote: update(input, {}, "collect") });
    await expect(h.generate(input)).rejects.toThrow(error); expect(h.runner).toHaveBeenCalledTimes(1);
  });
  it("still rejects assistant field evidence instead of treating a formatted question as authority", async () => {
    const input = fixture("Please prepare a NEW standard home quote.");
    const bookingQuote = update(input, { serviceId: "standard" }, "collect");
    bookingQuote.evidence.serviceId = { turnIndex: 1, quote: "service" };
    const h = harness({ replyText: questionReply("en"), task: null, bookingQuote });
    await expect(h.generate(input)).rejects.toThrow("SMS_QUOTE_EVIDENCE_NOT_CUSTOMER"); expect(h.runner).toHaveBeenCalledTimes(1);
  });
});

// Compare untouched bytes, removing ONLY AST-identified authorized string initializers.
// This is stricter than comparing reformatted/printed ASTs, which can conceal unrelated edits.
const currentSource = (path: string) => readFileSync(path, "utf8");
const baselineSource = (path: string) => execFileSync("git", ["show", `${BASELINE}:${path}`], { encoding: "utf8" });
function withoutPromptInitializer(source: string, path: string, name: string): string {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches: ts.Expression[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) matches.push(node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(tree); expect(matches).toHaveLength(1);
  const initializer = matches[0]; expect(ts.isTemplateExpression(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)).toBe(true);
  return source.slice(0, initializer.getStart(tree)) + "AUTHORIZED_PROMPT_INITIALIZER" + source.slice(initializer.end);
}
function withoutConditionStrings(source: string, path: string): string {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const spans: { start: number; end: number; language: string }[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "condition" && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) {
        expect(ts.isPropertyAssignment(property)).toBe(true);
        if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) throw new Error("Unexpected condition property");
        expect(["en", "es"]).toContain(property.name.text); expect(ts.isStringLiteral(property.initializer)).toBe(true);
        spans.push({ start: property.initializer.getStart(tree), end: property.initializer.end, language: property.name.text });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); expect(spans.map(span => span.language).sort()).toEqual(["en", "es"]);
  for (const span of spans.sort((a, b) => b.start - a.start)) source = source.slice(0, span.start) + `AUTHORIZED_CONDITION_${span.language}` + source.slice(span.end);
  return source;
}
const protectedSources = [
  "server/instinct/claudeCustomerSmsGeneration.ts",
  "server/instinct/claudeCustomerSms.ts", "server/instinct/claudeCustomerSmsApplication.ts", "server/instinct/claudeCustomerSmsManualGuard.ts",
  "server/instinct/claudeCustomerEmail.ts", "server/instinct/claudeCustomerEmailApplication.ts", "server/instinct/claudeCustomerEmailGuards.ts",
  "server/instinct/claudeCustomerEmailSource.ts", "server/instinct/claudeCustomerEmailStore.ts",
  "server/instinct/callBookingQuote.ts", "server/instinct/callBookingQuoteApplication.ts", "server/instinct/callBookingQuoteStore.ts", "server/instinct/callBookingQuoteTask.ts",
  "server/instinct/claudeSmsAlternative.ts", "server/instinct/claudeAgentClient.ts",
  "server/csReplyStream.ts", "server/knowledgeBase.ts", "server/madisonKnowledgeRetrieval.ts",
  "shared/publicBookingPricing.ts", "shared/bookingFunnel.ts", "shared/claudeCustomerTasks.ts", "shared/claudeSmsAlternative.ts",
];
describe("local source-preservation audit against the approved baseline", () => {
  it.each([
    { path: "server/instinct/smsBookingQuote.ts", name: "SMS_BOOKING_QUOTE_INSTRUCTIONS", boundary: "/** Additive overlay" },
    { path: "server/instinct/smsBookingQuoteGeneration.ts", name: "TEMPLATE_INSTRUCTIONS", boundary: "// These checks apply" },
  ])("changes only $name, leaving schemas, qualifier, guards and actual generator byte-identical", ({ path, name, boundary }) => {
    const source = currentSource(path), baseline = baselineSource(path);
    const approvedDefaults = "  // Explicitly approved SMS defaults, not customer statements or invented evidence.\n  fields.pricingMode ??= \"home\";\n  fields.homeType ??= \"House\";\n\n";
    const controlSource = name === "SMS_BOOKING_QUOTE_INSTRUCTIONS" ? source.replace(approvedDefaults, "") : source;
    if (name === "SMS_BOOKING_QUOTE_INSTRUCTIONS") expect(source).toContain(approvedDefaults);
    expect(withoutPromptInitializer(controlSource, path, name)).toBe(withoutPromptInitializer(baseline, path, name));
    expect(source.indexOf(boundary)).toBeGreaterThan(-1); expect(baseline.indexOf(boundary)).toBeGreaterThan(-1);
    if (name === "SMS_BOOKING_QUOTE_INSTRUCTIONS") expect(controlSource.slice(0, controlSource.indexOf(boundary))).toBe(baseline.slice(0, baseline.indexOf(boundary)));
    else expect(source.slice(source.indexOf(boundary))).toBe(baseline.slice(baseline.indexOf(boundary)));
  });
  it("changes only the condition en/es string values, preserving every other question and the pure helper", () => {
    const path = "server/instinct/smsBookingQuoteMissingQuestion.ts";
    expect(withoutConditionStrings(currentSource(path), path)).toBe(withoutConditionStrings(baselineSource(path), path));
  });
  it("appends only a new SMS summary while preserving the entire existing call and price-only SMS presentation", () => {
    const path = "server/instinct/bookingQuotePresentation.ts";
    expect(currentSource(path).startsWith(baselineSource(path))).toBe(true);
    expect(currentSource(path).slice(baselineSource(path).length)).toContain("export function renderSmsBookingQuoteSummary(");
  });
  it("adds only application-owned mixed-task acknowledgment preservation in the original bridge", () => {
    const path = "server/instinct/smsBookingQuoteApplication.ts";
    expect(currentSource(path)).toBe(baselineSource(path).replace("      replyText: plan.replyText,\n", "      replyText: plan.replyText,\n      preserveTaskAcknowledgment: plan.task !== null,\n"));
  });
  it.each(protectedSources)("preserves protected call/email/base/style/renderer/transport/pricing source: %s", path => {
    expect(withoutApprovedStaffCallFeature(path, currentSource(path))).toBe(baselineSource(path));
  });
});
