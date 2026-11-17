import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";
import { createCustomerBookingLinkInputSchema, customerBookingLinkPricingSchema } from "../../shared/bookingFunnel";
import { createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICED_EXTRAS } from "../../shared/publicBookingPricing";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "../knowledgeBase";
import {
  buildCallBookingQuoteToolDefinitions,
  callBookingQuotePricingSchema,
  callBookingQuoteSendInputSchema,
  callBookingQuoteServerToken,
  parseCallBookingQuoteToolArguments,
  previewCallBookingQuote,
  verifyCallBookingQuoteServerToken,
  withCallBookingQuoteInstructions,
  type CallBookingQuotePricing,
} from "./callBookingQuote";

const pricing: CallBookingQuotePricing = {
  pricingMode: "home", serviceId: "standard", bedrooms: 2, bathrooms: 2,
  homeType: "House", condition: 5, maidCount: 1, hourCount: 1, extras: [], recurrence: "one-time",
};
const quote = { pricing, extrasConfirmed: true };
const send = {
  ...quote, address: "123 Synthetic Street, Washington, DC 20001", customerName: "Sarah Johnson", customerPhone: "+13029816191", smsNumberConfirmed: true,
  requestedLocalDate: "2036-02-29", requestedLocalTime: "10:30",
};
const pricingKeys = Object.keys(pricing);
const publicExtraIds = Object.keys(PUBLIC_BOOKING_PRICED_EXTRAS);
const parityCases: { label: string; pricing: CallBookingQuotePricing }[] = [
  ...(["home", "hourly"] as const).flatMap(pricingMode =>
    (["standard", "deep", "moveout"] as const).flatMap(serviceId =>
      (["one-time", "weekly", "biweekly", "monthly"] as const).map(recurrence => ({
        label: `${pricingMode}/${serviceId}/${recurrence}`,
        pricing: { ...pricing, pricingMode, serviceId, recurrence, condition: 8, maidCount: 3, hourCount: 4,
          extras: [{ id: "inside-fridge", quantity: 2 }, { id: "interior-windows", quantity: 7 }] },
      })))),
  ...publicExtraIds.map(id => ({ label: `public-extra/${id}`, pricing: { ...pricing, extras: [{ id, quantity: 50 }] } })),
  ...(["House", "Apartment", "Townhome", "Condo"] as const).map(homeType => ({
    label: `home-type/${homeType}`, pricing: { ...pricing, homeType, bedrooms: 0, bathrooms: 1, condition: 1 },
  })),
  { label: "all-upper-bounds", pricing: { ...pricing, bedrooms: 7, bathrooms: 5, condition: 10, maidCount: 4, hourCount: 8 } },
];

describe("call-only canonical quote pricing", () => {
  it.each(parityCases)("matches the authoritative snapshot: $label", ({ pricing: input }) => {
    const expected = createPublicBookingPriceSnapshot(input);
    const result = previewCallBookingQuote({ pricing: input, extrasConfirmed: true });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(result.priceSnapshot).toEqual(expected);
    expect(result.firstCleaningTotalCents).toBe(expected.breakdown.firstCleaningTotalCents);
    expect(result.futureVisitTotalCents).toBe(expected.breakdown.futureVisitTotalCents);
    expect(result.extras).toEqual(expected.breakdown.extras);
    expect(result.serviceName).toBe(expected.serviceName);
    expect(result.recurrence).toBe(input.recurrence);
    expect(result.discountPercent).toBe(expected.breakdown.discountPercent);
    const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
    expect(result.priceFormatted).toBe(formatter.format(expected.breakdown.firstCleaningTotalCents / 100));
    expect(result.futureVisitPriceFormatted).toBe(expected.breakdown.futureVisitTotalCents === null ? null : formatter.format(expected.breakdown.futureVisitTotalCents / 100));
    expect(result.bookingConfirmed).toBe(false);
    expect(result.reservationConfirmed).toBe(false);
    expect(result).not.toHaveProperty("url");
    expect(result).not.toHaveProperty("token");
    expect(result.priceSnapshot.input).not.toHaveProperty("customPriceCents");
  });

  it("does not mutate input and gets independently owned snapshot extras", () => {
    const raw = { pricing: { ...pricing, extras: [{ id: "inside-oven", quantity: 2 }] }, extrasConfirmed: true };
    const before = structuredClone(raw);
    const result = previewCallBookingQuote(raw);
    expect(raw).toEqual(before);
    if (!result.success) throw new Error(result.message);
    result.priceSnapshot.input.extras[0].quantity = 4;
    expect(raw).toEqual(before);
  });

  it.each(pricingKeys)("requires canonical pricing.%s without guessing defaults", key => {
    const rawPricing: Record<string, unknown> = { ...pricing };
    delete rawPricing[key];
    expect(previewCallBookingQuote({ ...quote, pricing: rawPricing })).toMatchObject({
      success: false, code: "INCOMPLETE_QUOTE", missing: [`pricing.${key}`],
    });
  });

  it.each([undefined, false])("requires explicit extras confirmation (%s)", extrasConfirmed => {
    expect(previewCallBookingQuote({ pricing, extrasConfirmed })).toMatchObject({
      success: false, code: "INCOMPLETE_QUOTE", missing: ["extrasConfirmed"],
    });
  });

  it("returns every exact missing parse path", () => {
    const { bedrooms: _bedrooms, bathrooms: _bathrooms, condition: _condition, ...remaining } = pricing;
    expect(previewCallBookingQuote({ pricing: remaining, extrasConfirmed: false })).toMatchObject({
      code: "INCOMPLETE_QUOTE", missing: ["pricing.bedrooms", "pricing.bathrooms", "pricing.condition", "extrasConfirmed"],
    });
    expect(previewCallBookingQuote({})).toMatchObject({ code: "INCOMPLETE_QUOTE", missing: ["pricing", "extrasConfirmed"] });
  });

  it("reports a missing extra quantity exactly without inventing one", () => {
    expect(previewCallBookingQuote({ ...quote, pricing: { ...pricing, extras: [{ id: "interior-windows" }] } })).toMatchObject({
      code: "INCOMPLETE_QUOTE", missing: ["pricing.extras.0.quantity"],
    });
  });

  it.each([
    { label: "model custom price", input: { ...quote, pricing: { ...pricing, customPriceCents: 1 } } },
    { label: "model URL", input: { ...quote, url: "https://untrusted.invalid" } },
    { label: "model total", input: { ...quote, price: 1 } },
    { label: "extra arbitrary field", input: { ...quote, pricing: { ...pricing, extras: [{ id: "inside-oven", quantity: 1, unitPriceCents: 1 }] } } },
    { label: "unsupported legacy extra", input: { ...quote, pricing: { ...pricing, extras: [{ id: "i_have_pets", quantity: 1 }] } } },
    { label: "post-booking extra", input: { ...quote, pricing: { ...pricing, extras: [{ id: "moving-help", quantity: 1 }] } } },
    { label: "duplicate extra", input: { ...quote, pricing: { ...pricing, extras: [{ id: "inside-oven", quantity: 1 }, { id: "inside-oven", quantity: 2 }] } } },
    { label: "wrong confirmation type", input: { ...quote, extrasConfirmed: "true" } },
    { label: "null pricing", input: { ...quote, pricing: null } },
    { label: "non-object", input: "not a quote" },
  ])("rejects $label without a fallback quote", ({ input }) => {
    expect(previewCallBookingQuote(input)).toMatchObject({ success: false, code: "INVALID_QUOTE", missing: [] });
  });

  it("rejects mixed invalid/missing inputs as invalid while keeping missing paths", () => {
    const { condition: _condition, ...remaining } = pricing;
    expect(previewCallBookingQuote({ pricing: { ...remaining, bedrooms: -1 }, extrasConfirmed: true })).toMatchObject({
      success: false, code: "INVALID_QUOTE", missing: ["pricing.condition"],
    });
  });

  it("duplicate validation exposes the actual duplicate selection path", () => {
    const result = callBookingQuotePricingSchema.safeParse({ ...pricing, extras: [{ id: "inside-oven", quantity: 1 }, { id: "inside-oven", quantity: 2 }] });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Duplicate accepted");
    expect(result.error.issues[0].path).toEqual(["extras", 1, "id"]);
  });

  it.each([
    ["bedrooms", -1], ["bedrooms", 8], ["bathrooms", 0], ["bathrooms", 6],
    ["condition", 0], ["condition", 11], ["maidCount", 0], ["maidCount", 5],
    ["hourCount", 0], ["hourCount", 9], ["bathrooms", 1.5],
  ])("preserves canonical business bounds for %s=%s", (field, value) => {
    const input = { ...pricing, [field]: value };
    expect(callBookingQuotePricingSchema.safeParse(input).success).toBe(customerBookingLinkPricingSchema.safeParse(input).success);
    expect(previewCallBookingQuote({ ...quote, pricing: input })).toMatchObject({ success: false, code: "INVALID_QUOTE" });
  });

  it.each([0, 1, 50, 51, 1.5])("retains canonical quantity bounds (%s)", quantity => {
    const input = { ...pricing, extras: [{ id: "inside-oven", quantity }] };
    expect(callBookingQuotePricingSchema.safeParse(input).success).toBe(customerBookingLinkPricingSchema.safeParse(input).success);
  });
});

describe("call quote send input", () => {
  it("keeps canonical contact fields and defaults only notes", () => {
    expect(callBookingQuoteSendInputSchema.parse(send)).toEqual({ ...send, notes: [] });
    expect(callBookingQuoteSendInputSchema.shape.customerPhone).toBe(createCustomerBookingLinkInputSchema.shape.customerPhone);
    expect(callBookingQuoteSendInputSchema.shape.customerName).toBe(createCustomerBookingLinkInputSchema.shape.customerName);
    expect(callBookingQuoteSendInputSchema.shape.customerEmail).toBe(createCustomerBookingLinkInputSchema.shape.customerEmail);
    expect(callBookingQuoteSendInputSchema.shape.address).toBe(createCustomerBookingLinkInputSchema.shape.address.unwrap());
    expect(callBookingQuoteSendInputSchema.shape.requestedLocalTime).toBe(createCustomerBookingLinkInputSchema.shape.requestedLocalTime);
    expect(callBookingQuoteSendInputSchema.shape.notes).toBe(createCustomerBookingLinkInputSchema.shape.notes);
  });

  it.each(["+13029816191", "302-981-6191", "5551234", "+442079460123", "202-888-5362"])("does not reject an alternate/forwarded contact beyond shared schema: %s", customerPhone => {
    // The business-line recipient guard is deliberately application-owned, not a schema rewrite.
    const input = { ...send, customerPhone };
    expect(callBookingQuoteSendInputSchema.safeParse(input).success).toBe(createCustomerBookingLinkInputSchema.safeParse(input).success);
  });

  it.each(["requestedLocalDate", "requestedLocalTime", "smsNumberConfirmed", "extrasConfirmed"])("requires %s without a fabricated value", key => {
    const raw: Record<string, unknown> = { ...send };
    delete raw[key];
    const result = callBookingQuoteSendInputSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Missing input accepted");
    expect(result.error.issues.map(issue => issue.path.join("."))).toEqual([key]);
  });

  it.each(["smsNumberConfirmed", "extrasConfirmed"])("rejects false %s", key => {
    expect(callBookingQuoteSendInputSchema.safeParse({ ...send, [key]: false }).success).toBe(false);
  });

  it.each(["2026-02-29", "2026-02-30", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "tomorrow", "2026-2-01"])("strengthens calendar validation only here: %s", requestedLocalDate => {
    expect(callBookingQuoteSendInputSchema.safeParse({ ...send, requestedLocalDate }).success).toBe(false);
  });

  it.each(["2000-02-29", "2026-11-17", "2036-02-29", "2026-12-31"])("leaves future/past and same-day decisions to workflow runtime: %s", requestedLocalDate => {
    expect(callBookingQuoteSendInputSchema.safeParse({ ...send, requestedLocalDate }).success).toBe(true);
  });

  it("does not modify the shared regex-only date contract", () => {
    expect(createCustomerBookingLinkInputSchema.safeParse({ ...send, requestedLocalDate: "2026-02-30" }).success).toBe(true);
    expect(callBookingQuoteSendInputSchema.safeParse({ ...send, requestedLocalDate: "2026-02-30" }).success).toBe(false);
  });

  it.each(["24:00", "12:60", "9:30", "noon", "12:00:00"])("keeps canonical local time validation: %s", requestedLocalTime => {
    expect(callBookingQuoteSendInputSchema.safeParse({ ...send, requestedLocalTime }).success).toBe(false);
  });

  it.each(["sender", "from", "to", "price", "quotedPrice", "customPriceCents", "url", "bookingUrl", "token", "message"])("rejects model-owned %s", key => {
    expect(callBookingQuoteSendInputSchema.safeParse({ ...send, [key]: "untrusted" }).success).toBe(false);
  });

  it("retains existing character/array bounds without new usage caps", () => {
    const input = { ...send, customerName: "N".repeat(255), customerPhone: "P".repeat(40), address: "A".repeat(500), notes: Array.from({ length: 20 }, () => "n".repeat(1000)) };
    expect(callBookingQuoteSendInputSchema.safeParse(input).success).toBe(true);
    expect(callBookingQuoteSendInputSchema.safeParse({ ...input, notes: [...input.notes, "extra"] }).success).toBe(false);
    expect(callBookingQuoteSendInputSchema.safeParse({ ...send, customerEmail: "not-email", address: "123" }).success).toBe(false);
    expect(callBookingQuoteSendInputSchema.safeParse({ ...send, pricing: { ...pricing, customPriceCents: 123 } }).success).toBe(false);
  });
});

function objectSchema(value: JSONSchema._JSONSchema | undefined): JSONSchema.JSONSchema {
  if (!value || typeof value !== "object") throw new Error("Expected object-form JSON schema");
  return value;
}

describe("native call quote tools and scoped authorization", () => {
  it("returns exactly two native tools with complete strict schemas and no model overrides", () => {
    const tools = buildCallBookingQuoteToolDefinitions("https://offline.invalid/api/webhooks/vapi", "derived-token");
    expect(tools.map(tool => tool.function.name)).toEqual(["getBookingQuote", "textBookingQuote"]);
    for (const tool of tools) {
      expect(tool.type).toBe("function");
      expect(tool.server).toEqual({ url: "https://offline.invalid/api/webhooks/vapi", headers: { "X-Instinct-Call-Quote-Token": "derived-token" } });
      const json = tool.function.parameters;
      expect(json.type).toBe("object");
      expect(json).not.toHaveProperty("additionalProperties"); expect(json).not.toHaveProperty("$schema");
      const modelPricing = objectSchema(json.properties!.pricing);
      expect(modelPricing).not.toHaveProperty("additionalProperties");
      expect(Object.keys(modelPricing.properties!)).toEqual(pricingKeys);
      expect(modelPricing.required).toEqual(pricingKeys);
      const extrasSchema = objectSchema(modelPricing.properties!.extras);
      expect(extrasSchema).not.toHaveProperty("maxItems");
      const extra = extrasSchema.items as { properties: Record<string, { enum?: string[]; minimum?: number; maximum?: number }>; additionalProperties: boolean };
      expect(extra).not.toHaveProperty("additionalProperties");
      expect(extra.properties.id.enum).toEqual(publicExtraIds);
      expect(extra.properties.quantity).not.toHaveProperty("minimum");
      expect(extra.properties.quantity).not.toHaveProperty("maximum");
      expect(objectSchema(json.properties!.extrasConfirmed).description).toContain("Must be true");
      expect(json.required).toContain("extrasConfirmed");
      for (const property of ["customPriceCents", "price", "quotedPrice", "url", "bookingUrl", "token", "sender", "from", "to", "message"]) {
        expect(json.properties).not.toHaveProperty(property);
        expect(modelPricing.properties).not.toHaveProperty(property);
      }
    }
    expect(tools[0].function.parameters.required).toEqual(["pricing", "extrasConfirmed"]);
    const text = tools[1].function.parameters;
    expect(text.required).toEqual(expect.arrayContaining(["customerName", "customerPhone", "smsNumberConfirmed", "requestedLocalDate", "requestedLocalTime", "pricing", "extrasConfirmed"]));
    expect(text.required).not.toContain("customerEmail");
    expect(text.required).toContain("address");
    expect(text.required).not.toContain("notes");
    expect(objectSchema(text.properties!.smsNumberConfirmed).description).toContain("Must be true");
    expect(objectSchema(text.properties!.requestedLocalDate).format).toBe("date");
    expect(objectSchema(text.properties!.requestedLocalTime).pattern).toBe(z.toJSONSchema(createCustomerBookingLinkInputSchema.shape.requestedLocalTime).pattern);
    expect(tools[1].function.description).toContain("NEW cleaning quote");
    expect(tools[1].function.description).toContain("Not for rescheduling, cancellation");
    expect(tools[1].function.description).toContain("provider artifact");
  });

  it("derives exactly the scoped HMAC and sends no private key", () => {
    const privateKey = "offline-provider-private-key";
    const token = callBookingQuoteServerToken(privateKey);
    expect(token).toBe(createHmac("sha256", privateKey).update("instinct-call-booking-quote:v1").digest("hex"));
    expect(token).toHaveLength(64);
    expect(verifyCallBookingQuoteServerToken(token, privateKey)).toBe(true);
    expect(JSON.stringify(buildCallBookingQuoteToolDefinitions("https://offline.invalid", token))).not.toContain(privateKey);
  });

  it.each([undefined, null, false, 1, [], {}, "", "x", "0".repeat(64), "é".repeat(64), "0".repeat(65)])("fails closed for invalid token %s", value => {
    expect(verifyCallBookingQuoteServerToken(value, "offline-key")).toBe(false);
  });

  it("fails closed without a configured key and rejects tokens for another key", () => {
    expect(callBookingQuoteServerToken("")).toBe("");
    expect(verifyCallBookingQuoteServerToken("", "")).toBe(false);
    const token = callBookingQuoteServerToken("one");
    expect(verifyCallBookingQuoteServerToken(token, "")).toBe(false);
    expect(verifyCallBookingQuoteServerToken(token, "two")).toBe(false);
  });
});

const syntheticPrefix = "VOICE GREETING byte-for-byte\n## Existing customer detection\nlookupCustomer → rescheduleRequest/cancelRequest/complaintRequest/requestEtaCall\n\n";
const syntheticArguments = "## Tool argument format rules (CRITICAL — follow exactly)\n- For createLead phone: old new-lead phone\n- For createLead bedrooms: old room labels\n- For createLead bathrooms: old room labels\n- For createLead serviceType: old type labels\n- If createLead returns success=false, old follow-up\n- For scheduleCallback phone: KEEP EXACTLY\n- For createLead unrelatedField: KEEP EXACTLY\n\n";
const syntheticSuffix = "## Important rules\nKEEP EXACTLY voice constraints\n## Confirming the SMS/callback number\nKEEP EXACTLY alternate phone/callback instructions\n### Callback Scheduling\nKEEP EXACTLY transferCall and scheduleCallback\n## FAQ close\nold automatic quote summary\n## KNOWLEDGE BASE\nOld pricing table must remain but is superseded.\n";
const synthetic = syntheticPrefix + "## PRICING — calculate this yourself\nmanual prices\n\n## Booking qualification flow\ncalculate price, then createLead/sendSms\n\n" + syntheticArguments + syntheticSuffix;

function extractPromptBuilder(source: string, callTime: string): string {
  const ast = ts.createSourceFile("vapiService.ts", source, ts.ScriptTarget.Latest, true);
  const builder = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "buildSystemPrompt");
  if (!builder) throw new Error("Actual voice prompt builder missing");
  const compiled = ts.transpileModule(builder.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const fixedTime = new Date(callTime).getTime();
  class FixedDate extends Date {
    constructor(value?: string | number | Date) { super(value === undefined ? fixedTime : value instanceof Date ? value.getTime() : value); }
    static now() { return fixedTime; }
  }
  // Only the extracted pure builder is evaluated: no runtime vapiService imports or traffic.
  return runInNewContext(`${compiled}\nbuildSystemPrompt()`, { Date: FixedDate, Intl, MAIDS_IN_BLACK_KNOWLEDGE_BASE, withCallBookingQuoteInstructions });
}

function expectedPreservedArgumentTail(original: string): string {
  const header = /^## Tool argument format rules[^\n]*\n/m.exec(original);
  if (!header) throw new Error("Missing argument header");
  const tail = original.slice(header.index + header[0].length);
  const nextSection = /^## /m.exec(tail);
  const end = nextSection?.index ?? tail.length;
  return tail.slice(0, end).split(/(?<=\n)/).filter(line => !/^\- (?:For createLead (?:phone|bedrooms|bathrooms|serviceType):|If createLead returns success=false,)/.test(line)).join("") + tail.slice(end);
}

describe("narrow call quote prompt replacement", () => {
  it("preserves synthetic protected sections and unrelated argument rules byte-for-byte", () => {
    const result = withCallBookingQuoteInstructions(synthetic);
    expect(result.slice(0, result.indexOf("## PRICING"))).toBe(syntheticPrefix);
    expect(result.slice(result.indexOf("## Important rules"))).toBe(syntheticSuffix);
    expect(result).toContain("- For scheduleCallback phone: KEEP EXACTLY\n- For createLead unrelatedField: KEEP EXACTLY\n");
    expect(result).not.toContain("old new-lead phone");
    expect(result).not.toContain("old room labels");
    expect(result).not.toContain("old follow-up");
    expect(result).not.toContain("manual prices\n");
    expect(result).toContain("overrides conflicting old knowledge-base price tables");
    expect(result).toContain("Do NOT call createLead or sendSms for this new quote flow");
    expect(result).toContain("Call getBookingQuote BEFORE stating any price");
    expect(result).toContain("Do not text unless the caller explicitly requests it");
    expect(result).toContain("all other canonical fields are known");
    expect(result).toContain("before texting");
    expect(result).toContain("smsNumberConfirmed: true only after confirmation");
    expect(result).toContain("successful downstream provider-artifact verification");
    for (const id of publicExtraIds) expect(result).toContain(id);
  });

  it("keeps CRLF protected bytes and uses the original newline convention", () => {
    const original = synthetic.replaceAll("\n", "\r\n");
    const result = withCallBookingQuoteInstructions(original);
    expect(result.slice(0, result.indexOf("## PRICING"))).toBe(syntheticPrefix.replaceAll("\n", "\r\n"));
    expect(result.slice(result.indexOf("## Important rules"))).toBe(syntheticSuffix.replaceAll("\n", "\r\n"));
    expect(result.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it.each(["", "## PRICING\nOnly one section", "## Booking qualification flow\n## PRICING\n## Tool argument format rules\n"])("fails explicitly rather than broad rewriting an unrecognized prompt", original => {
    expect(() => withCallBookingQuoteInstructions(original)).toThrow("expected legacy pricing");
  });

  it.each(["2026-11-17T06:15:00Z", "2026-11-17T15:30:00Z", "2026-11-18T01:30:00Z"])("preserves real-source greeting/customer/callback/voice/KB bytes offline at %s", callTime => {
    const originalSource = execFileSync("git", ["show", "HEAD:server/vapiService.ts"], { encoding: "utf8" });
    const original = extractPromptBuilder(originalSource, callTime);
    const result = withCallBookingQuoteInstructions(original);
    expect(extractPromptBuilder(originalSource, callTime)).toBe(original);
    expect(result.slice(0, result.indexOf("## PRICING"))).toBe(original.slice(0, original.indexOf("## PRICING")));
    expect(result.slice(result.indexOf("## Important rules"))).toBe(original.slice(original.indexOf("## Important rules")));
    const resultTail = result.slice(result.indexOf("## Tool argument format rules"));
    const resultLines = resultTail.split(/(?<=\n)/);
    // The header and one scoped replacement bullet precede the untouched remaining tail.
    expect(resultLines.slice(2).join("")).toBe(expectedPreservedArgumentTail(original));
    expect(result).not.toContain("calculate this yourself");
    expect(result).not.toContain("Step 10 — Save lead");
    expect(result).not.toContain("Step 11 — Send SMS");
    expect(result).toContain(MAIDS_IN_BLACK_KNOWLEDGE_BASE);
    const actualSource = readFileSync(new URL("../vapiService.ts", import.meta.url), "utf8");
    const actual = extractPromptBuilder(actualSource, callTime);
    const adaptedActual = actual.includes("## PRICING — authoritative call booking quote tools") ? actual : withCallBookingQuoteInstructions(actual);
    // Only the separately approved customer-context repair may differ from this historical prompt.
    const customerSection = /## Existing customer detection[^\n]*\n[\s\S]*?(?=## PRICING)/g;
    const priorSection = original.match(customerSection);
    const currentSection = adaptedActual.match(customerSection);
    expect(priorSection).toHaveLength(1);
    expect(currentSection).toHaveLength(1);
    expect(currentSection![0]).toBe(actual.match(customerSection)![0]);
    expect(currentSection![0]).toContain("hasUpcomingBooking=true and upcomingBooking is present");
    expect(currentSection![0]).toContain("previousBooking is a historical record");
    expect(adaptedActual.replace(customerSection, () => priorSection![0])).toBe(result);
  });
});


describe("call quote runtime clock and home structural fields", () => {
  it("uses the current local calendar day across midnight", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-18T04:59:00Z"));
      expect(previewCallBookingQuote(quote)).toMatchObject({ currentLocalDate: "2026-11-17", currentLocalTime: "23:59" });
      vi.setSystemTime(new Date("2026-11-18T05:01:00Z"));
      expect(previewCallBookingQuote(quote)).toMatchObject({ currentLocalDate: "2026-11-18", currentLocalTime: "00:01" });
    } finally { vi.useRealTimers(); }
  });
  it("keeps flat home pricing unchanged with unused structural maid/hour fields", () => {
    const one = previewCallBookingQuote({ ...quote, pricing: { ...pricing, maidCount: 1, hourCount: 1 } });
    const other = previewCallBookingQuote({ ...quote, pricing: { ...pricing, maidCount: 4, hourCount: 8 } });
    expect(one.success).toBe(true); expect(other.success).toBe(true);
    if (one.success && other.success) expect(one.firstCleaningTotalCents).toBe(other.firstCleaningTotalCents);
    expect(withCallBookingQuoteInstructions(synthetic)).toContain("Ask for maidCount and hourCount only for hourly pricing");
  });
});


describe("documented native Vapi DTO and unchanged strict backend validation", () => {
  it("exposes only supported native JSON Schema fields at every depth", () => {
    const allowed = new Set(["type", "properties", "items", "required", "enum", "description", "title", "pattern", "format"]);
    const visit = (schema: any) => {
      expect(Object.keys(schema).every(key => allowed.has(key))).toBe(true);
      if (schema.properties) Object.values(schema.properties).forEach(visit);
      if (schema.items) visit(schema.items);
    };
    for (const tool of buildCallBookingQuoteToolDefinitions("https://offline.invalid", "token")) {
      expect(Object.keys(tool.function.parameters).sort()).toEqual(["properties", "required", "type"]);
      visit(tool.function.parameters);
    }
    expect(callBookingQuoteSendInputSchema.safeParse({ ...send, smsNumberConfirmed: false }).success).toBe(false);
    expect(callBookingQuoteSendInputSchema.safeParse({ ...send, unexpected: "override" }).success).toBe(false);
    expect(callBookingQuotePricingSchema.safeParse({ ...pricing, condition: 11 }).success).toBe(false);
  });
});

describe("call-only quote transport and cleanliness-scale repair", () => {
  it("preserves object arguments without mutating or inventing fields", () => {
    const before = structuredClone(quote);
    expect(parseCallBookingQuoteToolArguments(quote)).toBe(quote);
    expect(quote).toEqual(before);
    expect(parseCallBookingQuoteToolArguments({})).toEqual({});
    expect(previewCallBookingQuote(parseCallBookingQuoteToolArguments({}))).toMatchObject({ success: false, missing: ["pricing", "extrasConfirmed"] });
  });
  it("decodes JSON strings to the same strictly validated no-extras quote", () => {
    const decoded = parseCallBookingQuoteToolArguments(JSON.stringify(quote));
    expect(decoded).toEqual(quote);
    expect(previewCallBookingQuote(decoded)).toEqual(previewCallBookingQuote(quote));
  });
  it.each(["not JSON", "{", "null", "[]", "true", "123", null, [], false, 123])("does not turn malformed or non-object input %s into a valid quote", input => {
    expect(previewCallBookingQuote(parseCallBookingQuoteToolArguments(input))).toMatchObject({ success: false, code: "INVALID_QUOTE" });
  });
  it.each([
    { ...quote, extrasConfirmed: "true" },
    { ...quote, pricing: { ...pricing, bedrooms: "2" } },
    { ...quote, pricing: { ...pricing, extras: "[]" } },
    { ...quote, pricing: { ...pricing, customPriceCents: 1 } },
    { ...quote, price: 1 },
  ])("retains strict rejection of invalid values/overrides in either transport form", input => {
    for (const raw of [input, JSON.stringify(input)]) {
      expect(previewCallBookingQuote(parseCallBookingQuoteToolArguments(raw))).toMatchObject({ success: false, code: "INVALID_QUOTE" });
    }
  });
  it("defines low-to-high cleaning workload in both native tools without changing pricing fields", () => {
    for (const tool of buildCallBookingQuoteToolDefinitions("https://offline.invalid", "token")) {
      const condition = objectSchema(objectSchema(tool.function.parameters.properties!.pricing).properties!.condition);
      expect(condition.type).toBe("integer");
      expect(condition.description).toContain("1 = already clean");
      expect(condition.description).toContain("5 = light / normal");
      expect(condition.description).toContain("10 = severe buildup / needs a serious reset");
      expect(condition.description).toContain("more cleaning work, not a cleaner home");
    }
    const low = previewCallBookingQuote({ ...quote, pricing: { ...pricing, condition: 1 } });
    const normal = previewCallBookingQuote({ ...quote, pricing: { ...pricing, condition: 5 } });
    const high = previewCallBookingQuote({ ...quote, pricing: { ...pricing, condition: 10 } });
    if (!low.success || !normal.success || !high.success) throw new Error("Valid workload score rejected");
    expect(low.firstCleaningTotalCents).toBe(normal.firstCleaningTotalCents);
    expect(high.firstCleaningTotalCents).toBeGreaterThan(normal.firstCleaningTotalCents);
  });
  it("explains the same correct scale in the spoken qualification instructions", () => {
    const prompt = withCallBookingQuoteInstructions(synthetic);
    expect(prompt).toContain("1 = already clean; 5 = light / normal; 10 = severe buildup / needs a serious reset");
    expect(prompt).toContain("higher condition scores mean more cleaning work, not a cleaner home");
    expect(prompt).not.toContain("10 being the cleanest");
    expect(prompt.slice(prompt.indexOf("## Important rules"))).toBe(syntheticSuffix);
  });
});
