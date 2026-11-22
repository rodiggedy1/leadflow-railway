import { createHash } from "node:crypto";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomerBookingLinkInputSchema, type CreateCustomerBookingLinkInput } from "../../shared/bookingFunnel";
import { createPublicBookingPriceSnapshot } from "../../shared/publicBookingPricing";
import { callBookingQuotePricingSchema, callBookingQuoteSendInputSchema } from "./callBookingQuote";
import { smsBookingQuoteSendInputSchema } from "./smsBookingQuoteSendSchema";
import {
  createSmsBookingQuoteStore, SMS_BOOKING_QUOTE_ACTION, SMS_BOOKING_QUOTE_CHANNEL,
} from "./smsBookingQuoteStore";
import type { SmsBookingQuoteState } from "./smsBookingQuote";

// No application, database connection, provider, booking execution or model.
const forbidden = vi.hoisted(() => ({ createLink: vi.fn(() => { throw Error("OFFLINE_ONLY"); }) }));
vi.mock("../../drizzle/schema", () => ({ opsChatMessages: { syntheticTable: "ops_chat_messages" } }));
vi.mock("../customerBookingLinkService", () => ({ createCustomerBookingLink: forbidden.createLink }));

const pricing = {
  pricingMode: "home" as const, serviceId: "standard" as const, bedrooms: 2, bathrooms: 2,
  homeType: "House" as const, condition: 5, maidCount: 1, hourCount: 1, extras: [], recurrence: "one-time" as const,
};
const input: CreateCustomerBookingLinkInput = {
  customerName: "Maya Lane", customerPhone: "+12025550123", address: "123 Synthetic Street",
  requestedLocalDate: "2026-11-18", requestedLocalTime: "10:30", pricing, notes: [],
};
const send = { ...input, extrasConfirmed: true, smsNumberConfirmed: true };
const binding = {
  sessionId: 42, fromPhone: input.customerPhone, receivingPhoneNumberId: "PN-offline-synthetic",
  receivingPhoneNumber: "+12028885362", providerMessageId: "inbound-offline", inboundText: "Repeat my new cleaning quote link.",
  createdAt: 1, receivedAt: 1, customerName: null, historyHash: "synthetic-history",
};
const identity = { account: "openphone", sessionId: binding.sessionId, customerPhone: input.customerPhone,
  receivingPhoneNumberId: binding.receivingPhoneNumberId };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function savedQuote(quoteId = "original-quote", canonicalInput = input) {
  const token = quoteId === "original-quote" ? "mib-offline-current" : "mib-offline-historical";
  return { quoteId, input: structuredClone(canonicalInput), link: {
    fingerprint: hash(canonicalJson({ identity, quoteId, input: canonicalInput })), token, urlPath: `/book/${token}`,
    firstCleaningTotalCents: createPublicBookingPriceSnapshot(canonicalInput.pricing).breakdown.firstCleaningTotalCents,
  } };
}
function fixture(includeHistory: boolean) {
  const saved = savedQuote();
  const state: SmsBookingQuoteState = {
    version: 1, revision: 1, sessionId: binding.sessionId, customerPhone: input.customerPhone,
    receivingPhoneNumberId: binding.receivingPhoneNumberId, quoteId: saved.quoteId,
    fields: { ...pricing, customerName: input.customerName, address: input.address,
      requestedLocalDate: input.requestedLocalDate, requestedLocalTime: input.requestedLocalTime, extrasConfirmed: true },
    evidence: {}, link: saved.link,
  };
  const key = `sms-quote:v1:${hash(JSON.stringify([identity.account, identity.sessionId, identity.customerPhone, identity.receivingPhoneNumberId]))}`;
  const metadata = { version: 1, id: 100, key, account: "openphone", state,
    ...(includeHistory ? { quotes: [saved, savedQuote("older-quote", { ...input, customerName: "Valued Customer", pricing: { ...pricing, bedrooms: 3 } })] } : {}) };
  return { id: 100, activeDedupKey: key, channel: SMS_BOOKING_QUOTE_CHANNEL, quickAction: SMS_BOOKING_QUOTE_ACTION,
    sessionId: binding.sessionId, authorName: "Instinct", authorRole: "system", body: "Private SMS booking quote state", cardStatus: "active",
    metadata };
}
function reader(row: ReturnType<typeof fixture>, encoded = false) {
  const dialect = new MySqlDialect();
  const execute = vi.fn(async (query: any) => {
    const q = dialect.sqlToQuery(query);
    expect(q.sql).toBe("SELECT * FROM ops_chat_messages WHERE activeDedupKey = ?");
    expect(q.params).toEqual([row.activeDedupKey]);
    return [[{ ...structuredClone(row), metadata: encoded ? JSON.stringify(row.metadata) : structuredClone(row.metadata) }]];
  });
  return { execute, store: createSmsBookingQuoteStore({ execute } as any) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("OFFLINE_ONLY"); }));
});
afterEach(() => {
  expect(forbidden.createLink).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("channel-correct SMS send contract", () => {
  it("accepts complete SMS inputs without inventing voice confirmations or city, while calls still reject them", () => {
    expect(smsBookingQuoteSendInputSchema.parse(send)).toEqual(send);
    expect(createCustomerBookingLinkInputSchema.parse(input)).toEqual(input);
    const call = callBookingQuoteSendInputSchema.safeParse(send);
    expect(call.success).toBe(false);
    if (call.success) throw Error("Voice confirmations must remain required");
    expect(call.error.issues.map(issue => issue.path.join("."))).toEqual(["customerNameConfirmed", "city", "addressConfirmed"]);
  });
  it("reuses canonical contact, time, notes and strict public pricing validation", () => {
    const shape = smsBookingQuoteSendInputSchema.shape, canonical = createCustomerBookingLinkInputSchema.shape;
    for (const key of ["customerName", "customerPhone", "customerEmail", "requestedLocalTime", "notes"] as const) {
      expect(shape[key]).toBe(canonical[key]);
    }
    expect(shape.address).toBe(canonical.address.unwrap());
    expect(shape.pricing).toBe(callBookingQuotePricingSchema);
    const { notes: _notes, ...withoutNotes } = send;
    expect(smsBookingQuoteSendInputSchema.parse(withoutNotes).notes).toEqual([]);
  });
  it("retains historical SMS name/address rules instead of silently imposing call-only identity checks", () => {
    expect(smsBookingQuoteSendInputSchema.safeParse({ ...send, customerName: "Valued Customer" }).success).toBe(true);
    expect(smsBookingQuoteSendInputSchema.safeParse({ ...send, address: "123 Synthetic Street" }).success).toBe(true);
    expect(callBookingQuoteSendInputSchema.shape.customerName.safeParse("Valued Customer").success).toBe(false);
  });
  it.each(["customerNameConfirmed", "city", "addressConfirmed", "price", "token", "url", "sender"])("does not accept unapproved SMS field %s", key => {
    expect(smsBookingQuoteSendInputSchema.safeParse({ ...send, [key]: true }).success).toBe(false);
  });
  it.each([
    { customerName: "A" }, { customerPhone: "123" }, { customerEmail: "not-email" }, { address: undefined }, { address: "abc" },
    { requestedLocalDate: "2026-02-30" }, { requestedLocalDate: "2026-02-29" }, { requestedLocalDate: "2026-13-01" },
    { requestedLocalTime: "24:00" }, { requestedLocalTime: "9:30" }, { extrasConfirmed: false }, { smsNumberConfirmed: false },
    { pricing: { ...pricing, customPriceCents: 1 } }, { pricing: { ...pricing, condition: 1.5 } },
    { pricing: { ...pricing, extras: [{ id: "unsupported", quantity: 1 }] } },
    { pricing: { ...pricing, extras: [{ id: "inside-fridge", quantity: 1 }, { id: "inside-fridge", quantity: 2 }] } },
    { pricing: { ...pricing, extras: [{ id: "inside-fridge", quantity: 1, price: 1 }] } },
  ])("preserves rejection of invalid contacts/calendar/pricing/confirmation values: %j", patch => {
    expect(smsBookingQuoteSendInputSchema.safeParse({ ...send, ...patch }).success).toBe(false);
  });
  it("allows real calendar dates while leaving invocation-time freshness policy to qualification", () => {
    expect(smsBookingQuoteSendInputSchema.safeParse({ ...send, requestedLocalDate: "2028-02-29" }).success).toBe(true);
    expect(smsBookingQuoteSendInputSchema.safeParse({ ...send, requestedLocalDate: "2000-02-29" }).success).toBe(true);
  });
});

describe("offline persisted SMS link validation", () => {
  it.each([false, true])("reconstructs a legacy v1 current link without receipt history (encoded=%s)", async encoded => {
    const row = fixture(false), h = reader(row, encoded);
    expect(await h.store.read(binding)).toEqual(row.metadata.state);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("validates current and older canonical SMS receipts without voice fields (encoded=%s)", async encoded => {
    const row = fixture(true), h = reader(row, encoded);
    expect(await h.store.read(binding)).toEqual(row.metadata.state);
    expect(h.execute).toHaveBeenCalledTimes(1);
    for (const saved of row.metadata.quotes!) {
      for (const field of ["customerNameConfirmed", "city", "addressConfirmed"]) expect(saved.input).not.toHaveProperty(field);
    }
  });
  it.each(["fingerprint", "input", "quoteId", "phone", "urlPath", "price", "duplicate", "unknown-input"])("still fails closed for a tampered historical %s", async corruption => {
    const row = fixture(true), quotes = row.metadata.quotes!, historical = quotes[1];
    if (corruption === "fingerprint") historical.link.fingerprint = "0".repeat(64);
    if (corruption === "input") historical.input.pricing.bedrooms = 4;
    if (corruption === "quoteId") historical.quoteId = "other-identity";
    if (corruption === "phone") historical.input.customerPhone = "+12025550999";
    if (corruption === "urlPath") historical.link.urlPath = "https://attacker.example.test/book/untrusted";
    if (corruption === "price") historical.link.firstCleaningTotalCents++;
    if (corruption === "duplicate") quotes.push(structuredClone(historical));
    if (corruption === "unknown-input") Object.assign(historical.input, { customerNameConfirmed: true });
    await expect(reader(row).store.read(binding)).rejects.toThrow("SMS_QUOTE_STATE_CONFLICT");
  });
  it.each(["identity", "fingerprint", "input", "date", "extras-confirmation"])("still fails closed for corrupted current-state %s", async corruption => {
    const row = fixture(false), state = row.metadata.state;
    if (corruption === "identity") state.receivingPhoneNumberId = "PN-other";
    if (corruption === "fingerprint") state.link!.fingerprint = "0".repeat(64);
    if (corruption === "input") state.fields.bedrooms = 3;
    if (corruption === "date") state.fields.requestedLocalDate = "2026-02-30";
    if (corruption === "extras-confirmation") state.fields.extrasConfirmed = false;
    await expect(reader(row).store.read(binding)).rejects.toThrow("SMS_QUOTE_STATE_CONFLICT");
  });
});
