import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callBookingQuotePricingSchema } from "./callBookingQuote";
import { advanceSmsBookingQuote, type SmsBookingQuoteFields, type SmsBookingQuoteUpdate } from "./smsBookingQuote";
import { createSmsBookingQuoteMissingQuestion } from "./smsBookingQuoteMissingQuestion";

const NOW = Date.parse("2026-11-17T17:00:00Z");
const fields: SmsBookingQuoteFields = {
  customerName: "Maya Lane", address: "123 Synthetic Street, Washington DC", requestedLocalDate: "2026-11-18", requestedLocalTime: "08:30",
  pricingMode: "hourly", serviceId: "standard", bedrooms: 2, bathrooms: 2, homeType: "House", condition: 5,
  maidCount: 2, hourCount: 3, extras: [{ id: "inside-fridge", quantity: 1 }], extrasConfirmed: true, recurrence: "one-time",
};
const context = {
  binding: { sessionId: 42, fromPhone: "+12025550123", receivingPhoneNumberId: "PN-synthetic", providerMessageId: "msg-current",
    inboundText: "Please prepare this new cleaning quote using my supplied details.", receivedAt: NOW, customerName: null },
  originalConversation: [{ role: "user", content: "Please prepare this new cleaning quote using my supplied details.", opMsgId: "msg-current" }], nowMs: NOW,
};
function qualify(patch: SmsBookingQuoteFields, action: SmsBookingQuoteUpdate["action"] = "link") {
  return advanceSmsBookingQuote(null, { action, fields: patch, intentEvidenceQuote: context.binding.inboundText,
    evidence: Object.fromEntries(Object.keys(patch).map(key => [key, { turnIndex: 0, quote: context.binding.inboundText }])) }, context);
}
const requiredFields = [...Object.keys(callBookingQuotePricingSchema.shape), "extrasConfirmed", "customerName", "address", "requestedLocalDate", "requestedLocalTime"] as (keyof SmsBookingQuoteFields)[];
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw Error("OFFLINE_ONLY"); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("SMS authoritative missing-fact questions", () => {
  it.each(requiredFields)("asks the canonical missing %s without mutating, guessing, price math or a page claim", field => {
    for (const serviceId of ["standard", "deep", "moveout"] as const) for (const language of ["en", "es"] as const) {
      const patch: SmsBookingQuoteFields = { ...structuredClone(fields), serviceId };
      delete patch[field];
      const advanced = qualify(patch), before = JSON.stringify(advanced);
      expect(advanced.missing[0]).toBe(field);
      const question = createSmsBookingQuoteMissingQuestion(advanced, "link", language);
      expect(question).toBeTypeOf("string"); expect(question!.endsWith("?")).toBe(true);
      expect(question).not.toMatch(/page|página|https?:|\/book\/|\$|\{\{|booked|confirmed|reservad/i);
      expect(advanced.input).toBeNull(); expect(advanced.state.fields).not.toHaveProperty(field);
      expect(JSON.stringify(advanced)).toBe(before);
      expect(createSmsBookingQuoteMissingQuestion(advanced, "collect", language)).toBeNull();
    }
  });

  it("asks for confirmed-none rather than claiming that an unconfirmed empty extras list is a selection", () => {
    const advanced = qualify({ ...fields, extras: [], extrasConfirmed: false });
    expect(advanced.missing).toEqual(["extrasConfirmed"]);
    expect(createSmsBookingQuoteMissingQuestion(advanced, "link")).toBe("Would you like any extras, or no extras?");
    expect(advanced.state.fields).not.toHaveProperty("extrasConfirmed"); expect(advanced.input).toBeNull();
  });

  it("asks only the first authoritative missing fact and does not re-ask optional contact information", () => {
    const patch: SmsBookingQuoteFields = { ...fields };
    delete patch.homeType; delete patch.condition; delete patch.customerName;
    const advanced = qualify(patch);
    expect(advanced.missing).toEqual(["homeType", "condition", "customerName"]);
    expect(createSmsBookingQuoteMissingQuestion(advanced, "link")).toBe("One detail before I can prepare your quote: is this a house, apartment, townhome or condo?");
    const full = qualify(fields);
    expect(full.missing).toEqual([]); expect(full.input).not.toBeNull();
    expect(full.state.fields).not.toHaveProperty("customerEmail"); expect(full.state.fields).not.toHaveProperty("notes");
    expect(createSmsBookingQuoteMissingQuestion(full, "link")).toBeNull();
  });

  it.each(["home", "hourly"] as const)("keeps complete %s pricing and all service variants unchanged", pricingMode => {
    for (const serviceId of ["standard", "deep", "moveout"] as const) {
      const patch = { ...fields, pricingMode, serviceId };
      if (pricingMode === "home") { delete patch.maidCount; delete patch.hourCount; }
      const complete = qualify(patch), before = JSON.stringify(complete);
      expect(complete.missing).toEqual([]); expect(complete.preview?.success).toBe(true); expect(complete.input).not.toBeNull();
      for (const action of ["collect", "quote", "link"] as const) expect(createSmsBookingQuoteMissingQuestion(complete, action)).toBeNull();
      expect(JSON.stringify(complete)).toBe(before);
    }
  });

  it("preserves canonical price-only quotes without requiring link-only facts", () => {
    const patch: SmsBookingQuoteFields = { ...fields };
    for (const key of ["customerName", "address", "requestedLocalDate", "requestedLocalTime"] as const) delete patch[key];
    const advanced = qualify(patch, "quote");
    expect(advanced.preview?.success).toBe(true); expect(advanced.input).toBeNull();
    expect(createSmsBookingQuoteMissingQuestion(advanced, "quote")).toBeNull();
    expect(createSmsBookingQuoteMissingQuestion(advanced, "link")).toBe("What name would you like to use for your cleaning quote?");
  });

  it("asks for a replacement past preference rather than reusing it as a valid link input", () => {
    const date = qualify({ ...fields, requestedLocalDate: "2026-11-16" });
    expect(date.missing).toEqual(["requestedLocalDate"]);
    expect(createSmsBookingQuoteMissingQuestion(date, "link")).toBe("Which upcoming date would you prefer for your cleaning?");
    const time = qualify({ ...fields, requestedLocalDate: "2026-11-17", requestedLocalTime: "08:30" });
    expect(time.missing).toEqual(["requestedLocalTime"]);
    expect(createSmsBookingQuoteMissingQuestion(time, "link")).toBe("What time would you prefer for your cleaning?");
    expect(time.state.fields.requestedLocalTime).toBe("08:30"); expect(time.input).toBeNull();
  });

  it("fails closed for a future unmapped requirement instead of reverting to model page prose", () => {
    const advanced = qualify(fields);
    expect(() => createSmsBookingQuoteMissingQuestion({ ...advanced, input: null, missing: ["futureRequiredFact"] }, "link")).toThrow("SMS_QUOTE_MISSING_QUESTION");
  });
});
