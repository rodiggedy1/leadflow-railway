import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICED_EXTRAS } from "../../shared/publicBookingPricing";
import { callBookingQuoteSendInputSchema, type CallBookingQuotePricing } from "./callBookingQuote";
import { smsBookingQuoteSendInputSchema } from "./smsBookingQuoteSendSchema";
import { createSmsBookingQuoteMissingQuestion } from "./smsBookingQuoteMissingQuestion";
import {
  advanceSmsBookingQuote,
  assertSmsBookingQuoteModelText,
  SMS_BOOKING_QUOTE_INSTRUCTIONS,
  smsBookingQuoteFieldsSchema,
  smsBookingQuoteStateSchema,
  smsBookingQuoteUpdateSchema,
  type SmsBookingQuoteContext,
  type SmsBookingQuoteFields,
  type SmsBookingQuoteState,
  type SmsBookingQuoteUpdate,
} from "./smsBookingQuote";

const NOW = Date.parse("2026-11-17T17:00:00Z"); // Noon New York, not the UTC date/time.
const PHONE = "+12025550123";
const LINE = "PN-synthetic-customer-service";
const pricing: CallBookingQuotePricing = {
  pricingMode: "home", serviceId: "standard", bedrooms: 2, bathrooms: 2,
  homeType: "House", condition: 5, maidCount: 1, hourCount: 1, extras: [], recurrence: "one-time",
};
const fullFields: SmsBookingQuoteFields = {
  ...pricing, customerName: "Maya Lane", address: "123 Synthetic Street, Washington DC",
  requestedLocalDate: "2026-11-18", requestedLocalTime: "10:30", extrasConfirmed: true,
};
const fullText = "Please send a NEW cleaning booking link. I'm Maya Lane, 123 Synthetic Street, Washington DC, 2 bedrooms, 2 bathrooms, House, standard home cleaning, condition 5, one-time, no extras confirmed, tomorrow at 10:30.";
function context(text = fullText, options: Partial<SmsBookingQuoteContext> = {}): SmsBookingQuoteContext {
  const binding = {
    sessionId: 42, fromPhone: PHONE, receivingPhoneNumberId: LINE,
    providerMessageId: "inbound-1", inboundText: text, receivedAt: NOW, customerName: null,
    ...options.binding,
  };
  return {
    nowMs: NOW, ...options, binding,
    originalConversation: options.originalConversation ?? [{ role: "user", content: text, providerMessageId: binding.providerMessageId }],
  };
}
function update(fields: SmsBookingQuoteFields = fullFields, options: Partial<SmsBookingQuoteUpdate> = {}): SmsBookingQuoteUpdate {
  return {
    action: "link", intentEvidenceQuote: "Please send", fields,
    evidence: Object.fromEntries(Object.keys(fields).map(key => [key, { turnIndex: 0, quote: fullText }])),
    ...options,
  };
}
function run(fields: SmsBookingQuoteFields = fullFields, options: Partial<SmsBookingQuoteUpdate> = {}) {
  return advanceSmsBookingQuote(null, update(fields, options), context());
}
function withLink(): SmsBookingQuoteState {
  const state = run().state;
  state.link = { fingerprint: "synthetic-fingerprint", token: "mib-synthetic-token", urlPath: "/book/mib-synthetic-token", firstCleaningTotalCents: createPublicBookingPriceSnapshot(pricing).breakdown.firstCleaningTotalCents };
  return state;
}
function nextTurn(state: SmsBookingQuoteState, fields: SmsBookingQuoteFields, text: string, options: Partial<SmsBookingQuoteUpdate> = {}, history = context().originalConversation) {
  const turnIndex = history.length;
  const binding = { ...context().binding, providerMessageId: `inbound-${turnIndex + 1}`, inboundText: text };
  const ctx = context(text, { binding, originalConversation: [...history, { role: "customer", content: text, opMsgId: binding.providerMessageId }] });
  const patch = update(fields, {
    action: "collect", intentEvidenceQuote: text,
    evidence: Object.fromEntries(Object.keys(fields).map(key => [key, { turnIndex, quote: text }])), ...options,
  });
  return { ctx, patch, result: advanceSmsBookingQuote(state, patch, ctx) };
}
afterEach(() => { vi.useRealTimers(); });

describe("strict flat SMS model contract", () => {
  it("exports a partial schema without notes/default extras/recurrence or staffing facts", () => {
    expect(smsBookingQuoteFieldsSchema.parse({})).toEqual({});
    expect(smsBookingQuoteUpdateSchema.parse(update({}, { action: "collect", evidence: {} })).fields).toEqual({});
    expect(smsBookingQuoteUpdateSchema.safeParse(null).success).toBe(false);
  });
  it("keeps model JSON schema limited to flat canonical fields and strict evidence", () => {
    const json = z.toJSONSchema(smsBookingQuoteUpdateSchema, { io: "input" });
    expect(json.additionalProperties).toBe(false);
    expect(Object.keys(json.properties!)).toEqual(["action", "restart", "intentEvidenceQuote", "fields", "evidence"]);
    expect(Object.keys(smsBookingQuoteFieldsSchema.shape)).toEqual([
      "customerName", "customerEmail", "address", "requestedLocalDate", "requestedLocalTime", "notes",
      ...Object.keys(pricing), "extrasConfirmed",
    ]);
  });
  it.each(["customerPhone", "sender", "from", "to", "receivingPhoneNumberId", "price", "quotedPrice", "customPriceCents", "url", "bookingUrl", "token", "book", "smsNumberConfirmed", "pricing"])("rejects model-owned %s at every envelope", key => {
    expect(smsBookingQuoteUpdateSchema.safeParse({ ...update(), [key]: "untrusted" }).success).toBe(false);
    expect(smsBookingQuoteFieldsSchema.safeParse({ [key]: "untrusted" }).success).toBe(false);
  });
  it.each([
    { bedrooms: -1 }, { bedrooms: 8 }, { bathrooms: 0 }, { bathrooms: 6 },
    { condition: 0 }, { condition: 11 }, { condition: 1.5 }, { bedrooms: "2" },
    { maidCount: 0 }, { maidCount: 5 }, { hourCount: 0 }, { hourCount: 9 },
    { serviceId: "office" }, { pricingMode: "commercial" }, { recurrence: "fortnightly" },
    { homeType: "office" }, { notes: "note" }, { customerEmail: "invalid" }, { address: "abc" },
    { requestedLocalTime: "24:00" }, { requestedLocalTime: "9:30" },
    { requestedLocalDate: "2026-02-29" }, { requestedLocalDate: "2026-02-30" },
    { requestedLocalDate: "2026-04-31" }, { requestedLocalDate: "2026-13-01" },
    { requestedLocalDate: "tomorrow" }, { requestedLocalDate: "2026-1-01" },
    { extrasConfirmed: "true" }, { customerName: null },
  ])("rejects invalid supplied values, not ordinary incompleteness: %j", fields => {
    expect(smsBookingQuoteFieldsSchema.safeParse(fields).success).toBe(false);
    expect(() => run(fields as SmsBookingQuoteFields)).toThrow();
  });
  it.each(["2000-02-29", "2028-02-29", "2036-02-29", "2026-11-17"])("accepts valid calendar date %s without applying clock rules in the schema", requestedLocalDate => {
    expect(smsBookingQuoteFieldsSchema.safeParse({ requestedLocalDate }).success).toBe(true);
  });
  it.each([
    [{ id: "i_have_pets", quantity: 1 }], [{ id: "moving-help", quantity: 1 }],
    [{ id: "inside-fridge", quantity: 0 }], [{ id: "inside-fridge", quantity: -1 }],
    [{ id: "inside-fridge", quantity: 51 }], [{ id: "inside-fridge", quantity: 1.5 }],
    [{ id: "inside-fridge" }], [{ id: "inside-fridge", quantity: 1, customPriceCents: 1 }],
    [{ id: "inside-fridge", quantity: 1, price: 1 }],
    [{ id: "inside-fridge", quantity: 1 }, { id: "inside-fridge", quantity: 2 }],
  ])("rejects unsupported, duplicate, nonpositive and custom-priced extras: %j", (...extras) => {
    expect(smsBookingQuoteFieldsSchema.safeParse({ extras }).success).toBe(false);
  });
  it.each(Object.keys(PUBLIC_BOOKING_PRICED_EXTRAS))("accepts the public extra %s with canonical upper quantity", id => {
    expect(smsBookingQuoteFieldsSchema.parse({ extras: [{ id, quantity: 50 }] })).toEqual({ extras: [{ id, quantity: 50 }] });
  });
  it.each(["", " ", "\n"])("rejects blank intent or evidence %j", quote => {
    expect(smsBookingQuoteUpdateSchema.safeParse(update({}, { intentEvidenceQuote: quote, evidence: {} })).success).toBe(false);
    expect(smsBookingQuoteUpdateSchema.safeParse(update({ bedrooms: 2 }, { evidence: { bedrooms: { turnIndex: 0, quote } } })).success).toBe(false);
  });
  it("rejects absent/orphan/unknown evidence, unknown evidence properties and negative indices", () => {
    for (const evidence of [
      {}, { bedrooms: { turnIndex: -1, quote: "2" } },
      { bedrooms: { turnIndex: 0.5, quote: "2" } },
      { bedrooms: { turnIndex: 0, quote: "2", fabricated: true } },
      { bedrooms: { turnIndex: 0, quote: "2" }, customerName: { turnIndex: 0, quote: "Maya" } },
      { price: { turnIndex: 0, quote: "2" } },
    ]) expect(smsBookingQuoteUpdateSchema.safeParse(update({ bedrooms: 2 }, { evidence: evidence as any })).success).toBe(false);
    expect(smsBookingQuoteUpdateSchema.safeParse(update({ bedrooms: undefined }, { evidence: { bedrooms: { turnIndex: 0, quote: "2" } } })).success).toBe(false);
  });
});

describe("pure progressive qualification and canonical parity", () => {
  it("handles a routine incomplete quote without throwing or guessing", () => {
    const result = run({ bedrooms: 2 }, { action: "collect" });
    expect(result.preview).toBeNull(); expect(result.input).toBeNull();
    expect(result.state.fields).toEqual({ bedrooms: 2, pricingMode: "home", homeType: "House", maidCount: 1, hourCount: 1 });
    expect(result.missing).toEqual(expect.arrayContaining(["serviceId", "bathrooms", "condition", "extras", "recurrence", "extrasConfirmed", "customerName", "address", "requestedLocalDate", "requestedLocalTime"]));
    for (const key of ["pricingMode", "homeType", "maidCount", "hourCount"]) expect(result.missing).not.toContain(key);
    expect(result.state.evidence).not.toHaveProperty("pricingMode"); expect(result.state.evidence).not.toHaveProperty("homeType");
    expect(result.state).toMatchObject({ version: 1, revision: 1, sessionId: 42, customerPhone: PHONE, receivingPhoneNumberId: LINE, quoteId: "inbound-1", link: null });
  });
  it("adds only the approved unknown-property default and structural home staffing, not other pricing facts", () => {
    const result = run({ pricingMode: "home" }, { action: "collect" });
    expect(result.state.fields).toEqual({ pricingMode: "home", homeType: "House", maidCount: 1, hourCount: 1 });
    expect(result.state.evidence).not.toHaveProperty("maidCount");
    expect(result.missing).not.toContain("maidCount"); expect(result.missing).not.toContain("hourCount");
    expect(result.missing).toEqual(expect.arrayContaining(["extras", "recurrence", "extrasConfirmed"]));
  });
  it("makes a complete canonical preview and bound link input with verified SMS identity", () => {
    const result = run();
    expect(result.missing).toEqual([]); expect(result.preview?.success).toBe(true);
    if (!result.preview?.success) throw new Error("Missing preview");
    expect(result.preview.priceSnapshot).toEqual(createPublicBookingPriceSnapshot(pricing));
    expect(result.preview).toMatchObject({ currentLocalDate: "2026-11-17", currentLocalTime: "12:00", bookingConfirmed: false, reservationConfirmed: false });
    expect(result.input).toEqual({
      customerName: fullFields.customerName, customerPhone: PHONE, address: fullFields.address,
      requestedLocalDate: fullFields.requestedLocalDate, requestedLocalTime: fullFields.requestedLocalTime,
      pricing, notes: [],
    });
    const send = { ...result.input, extrasConfirmed: true, smsNumberConfirmed: true };
    expect(smsBookingQuoteSendInputSchema.safeParse(send).success).toBe(true);
    const call = callBookingQuoteSendInputSchema.safeParse(send);
    expect(call.success).toBe(false);
    if (call.success) throw new Error("Voice confirmations must remain required");
    expect(call.error.issues.map(issue => issue.path.join("."))).toEqual(["customerNameConfirmed", "city", "addressConfirmed"]);
    for (const key of ["customerNameConfirmed", "city", "addressConfirmed"]) {
      expect(result.input).not.toHaveProperty(key); expect(result.state.fields).not.toHaveProperty(key);
    }
    expect(result.input).not.toHaveProperty("token"); expect(result.state.link).toBeNull();
  });
  it.each(["collect", "quote"] as const)("does not return execution input for %s", action => {
    const result = run(fullFields, { action });
    expect(result.preview?.success).toBe(true); expect(result.input).toBeNull();
  });
  it("can preview pricing while contact/date/time remain missing", () => {
    const result = run({ ...pricing, extrasConfirmed: true }, { action: "quote" });
    expect(result.preview?.success).toBe(true); expect(result.input).toBeNull();
    if (!result.preview?.success) throw new Error("Price-only quote must remain valid");
    expect(result.preview.priceSnapshot).toEqual(createPublicBookingPriceSnapshot(pricing));
    expect(result.missing).toEqual(["customerName", "address", "requestedLocalDate", "requestedLocalTime"]);
    expect(createSmsBookingQuoteMissingQuestion(result, "quote")).toBeNull();
    for (const key of result.missing) expect(result.state.fields).not.toHaveProperty(key);
    const link = run({ ...pricing, extrasConfirmed: true });
    expect(link.input).toBeNull(); expect(link.preview?.success).toBe(true);
    expect(createSmsBookingQuoteMissingQuestion(link, "link")).toBe("What name would you like to use for your cleaning quote?");
  });
  it.each(["home", "hourly"] as const)("matches every service and recurrence using the canonical engine in %s mode", pricingMode => {
    for (const serviceId of ["standard", "deep", "moveout"] as const) {
      for (const recurrence of ["one-time", "weekly", "biweekly", "monthly"] as const) {
        const expectedPricing = { ...pricing, pricingMode, serviceId, recurrence, condition: 8,
          maidCount: pricingMode === "home" ? 1 : 3, hourCount: pricingMode === "home" ? 1 : 4,
          extras: [{ id: "inside-fridge", quantity: 2 }, { id: "interior-windows", quantity: 7 }] };
        const result = run({ ...fullFields, ...expectedPricing });
        if (!result.preview?.success) throw new Error("Canonical preview missing");
        expect(result.preview.priceSnapshot).toEqual(createPublicBookingPriceSnapshot(expectedPricing));
      }
    }
  });
  it("preserves actual hourly counts and requires them if not supplied", () => {
    expect(run({ ...fullFields, pricingMode: "hourly", maidCount: 3, hourCount: 4 }).input?.pricing).toMatchObject({ pricingMode: "hourly", maidCount: 3, hourCount: 4 });
    const { maidCount: _maid, hourCount: _hour, ...fields } = fullFields;
    const result = run({ ...fields, pricingMode: "hourly" });
    expect(result.missing).toEqual(["maidCount", "hourCount"]); expect(result.preview).toBeNull();
  });
  it("requires actual staffing when switching from home to hourly", () => {
    const result = nextTurn(run().state, { pricingMode: "hourly" }, "Actually quote hourly.").result;
    expect(result.state.fields).not.toHaveProperty("maidCount"); expect(result.state.fields).not.toHaveProperty("hourCount");
    expect(result.missing).toEqual(["maidCount", "hourCount"]); expect(result.input).toBeNull();
    const real = nextTurn(run().state, { pricingMode: "hourly", maidCount: 2, hourCount: 3 }, "Actually hourly, two maids for three hours.").result;
    expect(real.preview?.success).toBe(true); expect(real.state.fields).toMatchObject({ maidCount: 2, hourCount: 3 });
  });
  it("merges multiple customer turns and corrections without re-asking or erasing notes", () => {
    const first = run({ customerName: "Maya Lane", bedrooms: 2, notes: ["Gate code at arrival"] }, { action: "collect" });
    const second = nextTurn(first.state, { bedrooms: 3, bathrooms: 2, pricingMode: "home" }, "Actually 3 bedrooms, 2 baths, home pricing.");
    const { customerName: _name, bedrooms: _bed, bathrooms: _bath, pricingMode: _mode, maidCount: _maid, hourCount: _hour, ...remaining } = fullFields;
    const third = nextTurn(second.result.state, remaining, "Complete my new cleaning quote with these details, no extras confirmed.", { action: "link" }, second.ctx.originalConversation).result;
    expect(third.state.fields).toMatchObject({ customerName: "Maya Lane", bedrooms: 3, bathrooms: 2, notes: ["Gate code at arrival"], maidCount: 1, hourCount: 1 });
    expect(third.missing).toEqual([]); expect(third.input?.pricing.bedrooms).toBe(3);
    expect(third.state).toMatchObject({ revision: 3, quoteId: "inbound-1" });
    expect(third.state.evidence.bedrooms?.turnIndex).toBe(1); expect(third.state.evidence.serviceId?.turnIndex).toBe(2);
  });
  it("allows volunteered email and explicit null clear without keeping the old address", () => {
    const first = run({ ...fullFields, customerEmail: "maya@example.test" });
    const next = nextTurn(first.state, { customerEmail: null }, "Please remove that email from this quote.", { action: "link" }).result;
    expect(next.state.fields.customerEmail).toBeNull(); expect(next.input).not.toHaveProperty("customerEmail");
    expect(next.missing).not.toContain("customerEmail");
  });
  it("does not mutate supplied state, patches, context or nested extras", () => {
    const state = withLink(); const patch = update(); const ctx = context();
    const before = structuredClone({ state, patch, ctx });
    const result = advanceSmsBookingQuote(state, patch, ctx);
    expect({ state, patch, ctx }).toEqual(before);
    result.state.fields.extras!.push({ id: "inside-oven", quantity: 1 });
    expect({ state, patch, ctx }).toEqual(before);
  });
});

describe("explicit extras and fresh reconfirmation", () => {
  it("never defaults unmentioned extras to none, even if extrasConfirmed is true", () => {
    const { extras: _extras, ...fields } = fullFields;
    expect(run(fields).missing).toContain("extras");
    expect(run(fields).preview).toBeNull(); expect(run(fields).input).toBeNull();
  });
  it("requires evidence for explicit no extras and confirmation, then accepts canonical []", () => {
    const result = run();
    expect(result.state.fields).toMatchObject({ extras: [], extrasConfirmed: true });
    expect(result.preview?.success).toBe(true);
    const { extrasConfirmed: _confirmed, ...unconfirmed } = fullFields;
    expect(run(unconfirmed).missing).toContain("extrasConfirmed");
    expect(run(unconfirmed).preview).toBeNull();
  });
  it.each([undefined, false])("invalidates confirmation when extras change without fresh true: %j", extrasConfirmed => {
    const fields = { extras: [{ id: "inside-oven", quantity: 1 }], ...(extrasConfirmed === undefined ? {} : { extrasConfirmed }) };
    const result = nextTurn(withLink(), fields, "Add one oven cleaning.").result;
    expect(result.state.fields.extrasConfirmed).not.toBe(true);
    expect(result.missing).toContain("extrasConfirmed"); expect(result.preview).toBeNull(); expect(result.state.link).toBeNull();
  });
  it("accepts same-turn explicit reconfirmation after adding extras", () => {
    const result = nextTurn(run().state, { extras: [{ id: "inside-oven", quantity: 1 }], extrasConfirmed: true }, "Add one oven cleaning and that is my complete extras selection.", { action: "link" }).result;
    expect(result.state.fields.extrasConfirmed).toBe(true); expect(result.input?.pricing.extras).toEqual([{ id: "inside-oven", quantity: 1 }]);
  });
  it("rejects a confirmation predating changed extras without failing routine qualification", () => {
    const first = run().state;
    const text = "Add one oven cleaning.";
    const ctx = context(text, { binding: { ...context().binding, providerMessageId: "inbound-2", inboundText: text }, originalConversation: [...context().originalConversation, { role: "user", content: text, opMsgId: "inbound-2" }] });
    const patch = update({ extras: [{ id: "inside-oven", quantity: 1 }], extrasConfirmed: true }, { intentEvidenceQuote: text, evidence: {
      extras: { turnIndex: 1, quote: text }, extrasConfirmed: { turnIndex: 0, quote: "no extras confirmed" },
    } });
    const result = advanceSmsBookingQuote(first, patch, ctx);
    expect(result.missing).toContain("extrasConfirmed"); expect(result.state.fields.extrasConfirmed).toBeUndefined(); expect(result.input).toBeNull();
  });
  it("accepts confirmation on a later turn and preserves selected extras", () => {
    const change = nextTurn(run().state, { extras: [{ id: "inside-fridge", quantity: 2 }] }, "Two fridges please.");
    const confirmed = nextTurn(change.result.state, { extrasConfirmed: true }, "Yes, two fridges and no other extras.", { action: "link" }, change.ctx.originalConversation).result;
    expect(confirmed.missing).toEqual([]); expect(confirmed.input?.pricing.extras).toEqual([{ id: "inside-fridge", quantity: 2 }]);
  });
});

describe("literal inbound evidence and exact identity binding", () => {
  it("rejects intent evidence copied from history instead of current inbound", () => {
    const state = run().state;
    expect(() => nextTurn(state, {}, "Thanks", { intentEvidenceQuote: "Please send" })).toThrow("SMS_QUOTE_INTENT_NOT_CURRENT_INBOUND");
  });
  it("requires a literal case-sensitive substring rather than paraphrase", () => {
    expect(() => run({ bedrooms: 2 }, { evidence: { bedrooms: { turnIndex: 0, quote: "TWO BEDROOMS" } } })).toThrow("SMS_QUOTE_EVIDENCE_NOT_LITERAL");
  });
  it.each(["assistant", "agent", "office", "system", "tool"])("does not trust %s statements as field evidence", role => {
    const ctx = context(fullText, { originalConversation: [{ role, content: "2 bedrooms" }, { role: "user", content: fullText, opMsgId: "inbound-1" }] });
    expect(() => advanceSmsBookingQuote(null, update({ bedrooms: 2 }, { evidence: { bedrooms: { turnIndex: 0, quote: "2 bedrooms" } } }), ctx)).toThrow("SMS_QUOTE_EVIDENCE_NOT_CUSTOMER");
  });
  it.each([1, 999])("rejects nonexistent evidence index %s", turnIndex => {
    expect(() => run({ bedrooms: 2 }, { evidence: { bedrooms: { turnIndex, quote: "2 bedrooms" } } })).toThrow();
  });
  it("accepts old customer facts at original indices across staff turns", () => {
    const text = "Please send my new cleaning quote.";
    const ctx = context(text, { originalConversation: [
      { role: "customer", content: "2 bedrooms", from: "202-555-0123", metadata: JSON.stringify({ sessionId: "42", phoneNumberId: LINE, direction: "incoming" }) },
      { role: "assistant", content: "How many baths?" },
      { role: "user", content: text, opMsgId: "inbound-1" },
    ] });
    const result = advanceSmsBookingQuote(null, update({ bedrooms: 2 }, { intentEvidenceQuote: "Please send", evidence: { bedrooms: { turnIndex: 0, quote: "2 bedrooms" } } }), ctx);
    expect(result.state.fields.bedrooms).toBe(2);
  });
  it.each([
    { sessionId: 43 }, { from: "+12025550999" }, { fromPhone: "+12025550999" },
    { customerPhone: "+12025550999" }, { receivingPhoneNumberId: "PN-other" }, { phoneNumberId: "PN-other" },
    { direction: "outgoing" },
  ])("rejects foreign per-turn identity/direction at root and metadata: %j", foreign => {
    for (const part of [foreign, { metadata: foreign }, { metadata: JSON.stringify(foreign) }]) {
      const ctx = context(fullText, { originalConversation: [
        { role: "user", content: "2 bedrooms", ...part },
        { role: "user", content: fullText, opMsgId: "inbound-1" },
      ] });
      expect(() => advanceSmsBookingQuote(null, update({ bedrooms: 2 }, { evidence: { bedrooms: { turnIndex: 0, quote: "2 bedrooms" } } }), ctx)).toThrow();
    }
  });
  it.each([
    { sessionId: 43 }, { customerPhone: "+12025550999" }, { receivingPhoneNumberId: "PN-other" },
  ])("rejects mismatched stored state identity even on restart: %j", foreign => {
    const state = { ...run().state, ...foreign };
    expect(() => advanceSmsBookingQuote(state, update({}, { restart: true, evidence: {} }), context())).toThrow("SMS_QUOTE_STATE_IDENTITY_MISMATCH");
  });
  it("requires the exact current saved inbound provider event, latest customer text and no prior answer", () => {
    const patch = update({ bedrooms: 2 });
    const histories = [
      [], [{ role: "user", content: fullText }],
      [{ role: "user", content: "Other text", opMsgId: "inbound-1" }],
      [{ role: "user", content: fullText, opMsgId: "inbound-1", providerMessageId: "contradiction" }],
      [{ role: "user", content: fullText, opMsgId: "inbound-1" }, { role: "user", content: "later", opMsgId: "later-id" }],
      [{ role: "user", content: fullText, opMsgId: "inbound-1" }, { role: "assistant", content: "already answered" }],
      [{ role: "user", content: fullText, opMsgId: "inbound-1" }, { role: "user", content: fullText, opMsgId: "inbound-1" }],
    ];
    for (const originalConversation of histories) expect(() => advanceSmsBookingQuote(null, patch, context(fullText, { originalConversation }))).toThrow();
  });
  it.each(["invalid-json", [], 12])("rejects invalid evidence metadata %j", metadata => {
    const ctx = context(fullText, { originalConversation: [{ role: "user", content: fullText, opMsgId: "inbound-1", metadata }] });
    expect(() => advanceSmsBookingQuote(null, update(), ctx)).toThrow();
  });
  it("validates state schemas and rejects orphan stored evidence", () => {
    const state = run().state;
    expect(smsBookingQuoteStateSchema.safeParse(state).success).toBe(true);
    expect(smsBookingQuoteStateSchema.safeParse({ ...state, version: 2 }).success).toBe(false);
    expect(smsBookingQuoteStateSchema.safeParse({ ...state, revision: -1 }).success).toBe(false);
    expect(smsBookingQuoteStateSchema.safeParse({ ...state, fields: {}, evidence: state.evidence }).success).toBe(false);
    expect(smsBookingQuoteStateSchema.safeParse({ ...state, fields: { ...state.fields, price: 1 } }).success).toBe(false);
  });
});

describe("saved names, explicit restarts and existing-link lifetime", () => {
  it("seeds the exact usable saved contact name without customer evidence", () => {
    const ctx = context(); ctx.binding.customerName = "Renée O’Neill";
    const result = advanceSmsBookingQuote(null, update({ bedrooms: 2 }), ctx);
    expect(result.state.fields.customerName).toBe("Renée O’Neill"); expect(result.state.evidence).not.toHaveProperty("customerName");
    expect(result.missing).not.toContain("customerName");
  });
  it.each([null, "", "A", "Unknown", "Test Customer", "PN-example", PHONE, "New Customer", "Contact", "null", "n/a", " Jane Smith "])("does not seed an unusable name %j", customerName => {
    const ctx = context(); ctx.binding.customerName = customerName;
    const result = advanceSmsBookingQuote(null, update({ bedrooms: 2 }), ctx);
    expect(result.state.fields.customerName).toBeUndefined(); expect(result.missing).toContain("customerName");
  });
  it("never overrides a customer-supplied or durable name with saved display name", () => {
    const ctx = context(); ctx.binding.customerName = "Saved Person";
    expect(advanceSmsBookingQuote(null, update(), ctx).state.fields.customerName).toBe("Maya Lane");
    const state = run().state;
    expect(advanceSmsBookingQuote(state, update({}, { evidence: {} }), ctx).state.fields.customerName).toBe("Maya Lane");
  });
  it("retains fields, quote identity and link on ordinary continuing turns", () => {
    const state = withLink();
    const next = nextTurn(state, {}, "Please show my new quote again.", { action: "link" }).result;
    expect(next.state.fields).toEqual(state.fields); expect(next.state.quoteId).toBe("inbound-1");
    expect(next.state.revision).toBe(2); expect(next.state.link).toEqual(state.link); expect(next.input).not.toBeNull();
  });
  it("does not clear the existing link for identical inputs/evidence-only updates", () => {
    const state = withLink();
    const next = nextTurn(state, { bedrooms: 2 }, "Yes, still 2 bedrooms.").result;
    expect(next.state.link).toEqual(state.link);
  });
  it.each([
    { bedrooms: 3 }, { requestedLocalDate: "2026-11-19" }, { requestedLocalTime: "11:00" },
    { address: "456 Other Synthetic Street" }, { customerName: "Maya Corrected" },
    { customerEmail: "new@example.test" }, { notes: ["new gate note"] }, { recurrence: "weekly" as const },
  ])("invalidates old links when canonical inputs change: %j", fields => {
    const next = nextTurn(withLink(), fields, "Please correct these new quote details.").result;
    expect(next.state.link).toBeNull();
  });
  it("does not silently restart even when every fact is corrected", () => {
    const next = nextTurn(withLink(), { ...fullFields, bedrooms: 3 }, "Change all details for my new cleaning quote.").result;
    expect(next.state.quoteId).toBe("inbound-1"); expect(next.state.revision).toBe(2);
  });
  it("restarts ONLY explicitly, clearing old fields/evidence/link and using current provider ID", () => {
    const next = nextTurn(withLink(), { bedrooms: 1 }, "Start a distinct new quote for a 1-bedroom home.", { restart: true }).result;
    expect(next.state).toMatchObject({ revision: 2, quoteId: "inbound-2", fields: { bedrooms: 1 }, link: null });
    expect(next.state.fields).toEqual({ bedrooms: 1, pricingMode: "home", homeType: "House", maidCount: 1, hourCount: 1 }); expect(Object.keys(next.state.evidence)).toEqual(["bedrooms"]);
    expect(next.input).toBeNull(); expect(next.missing).toContain("serviceId"); expect(next.missing).not.toContain("pricingMode");
  });
});

describe("New York NOW, relative-date model resolution, and past preferences", () => {
  it.each([
    { date: "2026-11-16", time: "14:00", missing: ["requestedLocalDate"] },
    { date: "2026-11-17", time: "11:59", missing: ["requestedLocalTime"] },
    { date: "2026-11-17", time: "12:00", missing: [] },
    { date: "2026-11-17", time: "12:01", missing: [] },
    { date: "2026-11-18", time: "00:00", missing: [] },
  ])("qualifies $date $time against actual local now", ({ date, time, missing }) => {
    const result = run({ ...fullFields, requestedLocalDate: date, requestedLocalTime: time });
    expect(result.missing).toEqual(missing); expect(result.input === null).toBe(missing.length > 0);
    expect(result.state.fields).toMatchObject({ requestedLocalDate: date, requestedLocalTime: time });
    expect(result.preview?.success).toBe(true);
  });
  it("uses invocation NOW rather than old inbound receivedAt", () => {
    const ctx = context(); ctx.binding.receivedAt = Date.parse("2026-11-15T17:00:00Z");
    const result = advanceSmsBookingQuote(null, update({ ...fullFields, requestedLocalDate: "2026-11-16" }), ctx);
    expect(result.missing).toEqual(["requestedLocalDate"]); expect(result.input).toBeNull();
  });
  it("requires model-resolved ISO date while allowing literal relative customer wording as evidence", () => {
    const text = "Please send a new quote for tomorrow at half past ten.";
    const ctx = context(text);
    const good = update({ requestedLocalDate: "2026-11-18", requestedLocalTime: "10:30" }, { intentEvidenceQuote: "new quote", evidence: {
      requestedLocalDate: { turnIndex: 0, quote: "tomorrow" }, requestedLocalTime: { turnIndex: 0, quote: "half past ten" },
    } });
    const result = advanceSmsBookingQuote(null, good, ctx);
    expect(result.state.fields).toEqual({ requestedLocalDate: "2026-11-18", requestedLocalTime: "10:30", pricingMode: "home", homeType: "House", maidCount: 1, hourCount: 1 });
    expect(smsBookingQuoteUpdateSchema.safeParse({ ...good, fields: { requestedLocalDate: "tomorrow" } }).success).toBe(false);
    expect(() => advanceSmsBookingQuote(null, { ...good, evidence: { ...good.evidence, requestedLocalDate: { turnIndex: 0, quote: "2026-11-18" } } }, ctx)).toThrow("SMS_QUOTE_EVIDENCE_NOT_LITERAL");
  });
  it("does not invent tomorrow/noon when either requested date or time is absent", () => {
    const { requestedLocalDate: _date, requestedLocalTime: _time, ...fields } = fullFields;
    const result = run(fields);
    expect(result.missing).toEqual(["requestedLocalDate", "requestedLocalTime"]);
    expect(result.state.fields).not.toHaveProperty("requestedLocalDate"); expect(result.state.fields).not.toHaveProperty("requestedLocalTime"); expect(result.input).toBeNull();
  });
  it("evaluates New York midnight and does not re-resolve durable tomorrow on a later day", () => {
    const state = run({ ...fullFields, requestedLocalDate: "2026-11-17", requestedLocalTime: "23:59" }).state;
    const patch = update({}, { evidence: {} });
    const before = advanceSmsBookingQuote(state, patch, context(fullText, { nowMs: Date.parse("2026-11-18T04:58:00Z") }));
    expect(before.preview).toMatchObject({ currentLocalDate: "2026-11-17", currentLocalTime: "23:58" });
    expect(before.missing).toEqual([]); expect(before.input).not.toBeNull();
    const after = advanceSmsBookingQuote(state, patch, context(fullText, { nowMs: Date.parse("2026-11-18T05:01:00Z") }));
    expect(after.preview).toMatchObject({ currentLocalDate: "2026-11-18", currentLocalTime: "00:01" });
    expect(after.missing).toEqual(["requestedLocalDate"]); expect(after.input).toBeNull();
    expect(after.state.fields.requestedLocalDate).toBe("2026-11-17");
  });
  it("handles New York year boundary without using the UTC calendar day", () => {
    const patch = update({ ...fullFields, requestedLocalDate: "2026-12-31", requestedLocalTime: "23:59" });
    const result = advanceSmsBookingQuote(null, patch, context(fullText, { nowMs: Date.parse("2027-01-01T04:30:00Z") }));
    expect(result.preview).toMatchObject({ currentLocalDate: "2026-12-31", currentLocalTime: "23:30" });
    expect(result.missing).toEqual([]);
  });
  it("uses summertime New York offset rather than a hardcoded UTC minus five", () => {
    const patch = update({ ...fullFields, requestedLocalDate: "2026-07-15", requestedLocalTime: "12:30" });
    const result = advanceSmsBookingQuote(null, patch, context(fullText, { nowMs: Date.parse("2026-07-15T16:00:00Z") }));
    expect(result.preview).toMatchObject({ currentLocalDate: "2026-07-15", currentLocalTime: "12:00" }); expect(result.missing).toEqual([]);
  });
  it("uses Date.now at invocation when not injected and overrides canonical preview clock coherently", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-18T05:01:00Z"));
    const ctx = context(); delete ctx.nowMs;
    const result = advanceSmsBookingQuote(null, update(), ctx);
    expect(result.preview).toMatchObject({ currentLocalDate: "2026-11-18", currentLocalTime: "00:01" }); expect(result.missing).toEqual([]);
  });
  it.each([NaN, Infinity, -Infinity])("rejects invalid nowMs %s", nowMs => {
    expect(() => advanceSmsBookingQuote(null, update(), context(fullText, { nowMs }))).toThrow("SMS_QUOTE_INVALID_CLOCK");
  });
});

describe("active SMS text money check does not reject ordinary names or words", () => {
  it.each([
    "Thanks, Maya Pounds. Here are the details for your review.",
    "Thanks, Maya Cents. Do you have any add-ons?",
    "Your surname is Pounds and we can use the saved email.",
    "There are pounds of cleaning supplies at the property.",
    "Gracias, Maya Pounds. ¿Qué fecha prefieres?",
  ])("permits ordinary customer wording: %s", text => {
    expect(() => assertSmsBookingQuoteModelText(text)).not.toThrow();
  });
  it.each([
    "Your quote is 250 dollars.", "Your quote is two hundred pounds.",
    "250dollars", "250euros", "250pesos",
    "The first visit will be 250 US dollars.", "The first visit will be dollars 250.",
    "The first visit will be two hundred US dollars.", "The first visit will be US dollars two hundred.",
    "Serán doscientos pesos.", "Your price is USD 250.", "Your price is $250.",
    "The price is two hundred.", "El precio es doscientos.", "The discount is 20%.",
  ])("still rejects unverified monetary assertions: %s", text => {
    expect(() => assertSmsBookingQuoteModelText(text)).toThrow("SMS_QUOTE_MODEL_PRICE");
  });
});

describe("additive SMS overlay and side-effect-free dependency surface", () => {
  it("contains qualification, canonical-only output and preservation requirements", () => {
    for (const clause of [
      "SMS-ONLY", "complete originalConversation", "previous durable", "one or two related missing questions", "never repeat known",
      "bookingQuote:null", "preserve ALL existing reply/task/checklist behavior", "reschedule or cancellation",
      "1 = already clean", "5 = light / normal", "10 = severe buildup", "Higher means more work",
      "maidCount:1/hourCount:1", "actual customer-provided maid and hour counts", "extras:[] requires explicit",
      "one-time, weekly, biweekly or monthly", "not predating the latest extras change", "source turn timing",
      "MUST NOT contain ANY dollar price", "server appends only verified canonical", "customer must review and complete booking on the page",
      "Never claim anything was saved, sent, booked", "same-day future", "never default tomorrow/noon", "zero-based",
    ]) expect(SMS_BOOKING_QUOTE_INSTRUCTIONS).toContain(clause);
    for (const id of Object.keys(PUBLIC_BOOKING_PRICED_EXTRAS)) expect(SMS_BOOKING_QUOTE_INSTRUCTIONS).toContain(id);
  });
  it("imports only passive canonical schemas/pricing/normalizer and contains no execution capability", () => {
    const source = readFileSync(new URL("./smsBookingQuote.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:getDb|sendSms|fetch|runInitialLeadDraft|executeCallBookingQuoteTool|createCustomerBookingLink)\s*\(/);
    expect(source).not.toMatch(/from ["'][^"']*(?:db|openphone|Application|Store|claudeAgentClient)["']/);
    expect(source).toContain("previewCallBookingQuote({ pricing, extrasConfirmed: true })");
    expect(source).toContain("smsBookingQuoteSendInputSchema.parse({");
    expect(source).not.toContain("callBookingQuoteSendInputSchema");
  });
});
