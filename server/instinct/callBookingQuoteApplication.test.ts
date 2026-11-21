import { withCallBookingQuoteTask } from "./callBookingQuoteTask";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicBookingPriceSnapshot } from "../../shared/publicBookingPricing";
import type { CreateCustomerBookingLinkInput } from "../../shared/bookingFunnel";
import { createCallBookingQuoteHandler, buildCallBookingQuoteSms, CALL_QUOTE_BOOKING_ORIGIN } from "./callBookingQuoteApplication";
import { createCallBookingQuoteStore, hasCallBookingQuoteAttempt, hasSavedCallBookingQuote, CALL_BOOKING_QUOTE_ACTION, CALL_BOOKING_QUOTE_FLOW_ACTION } from "./callBookingQuoteStore";

// These factories run against actual store/helper code, never live infrastructure.
const infrastructure = vi.hoisted(() => ({
  getDb: vi.fn(async () => null),
  sendSms: vi.fn(() => { throw new Error("Forbidden live SMS transport"); }),
  getAssistantId: vi.fn(() => "customer-assistant"),
  broadcast: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: infrastructure.getDb }));
vi.mock("../vapiService", () => ({ getAssistantId: infrastructure.getAssistantId }));
vi.mock("../openphone", () => ({ sendSms: infrastructure.sendSms }));
vi.mock("../_core/env", () => ({ ENV: {} }));
vi.mock("../sseBroadcast", () => ({ broadcastOpsUpdate: infrastructure.broadcast }));

const NOW = new Date("2026-11-17T16:00:00.000Z");
const CALL = "synthetic-customer-call";
const PHONE = "+13015550123";
const SENDER = "synthetic-sender-id";
const verifiedCall = () => ({ id: CALL, type: "inboundPhoneCall", status: "in-progress", assistantId: "customer-assistant", customer: { number: "+17035559876" } });
function input(): any {
  return { customerName: "María García", customerPhone: PHONE, smsNumberConfirmed: true,
    customerNameConfirmed: true, city: "Washington", addressConfirmed: true,
    requestedLocalDate: "2026-11-20", requestedLocalTime: "10:00",
    pricing: { pricingMode: "home", serviceId: "deep", bedrooms: 3, bathrooms: 2, homeType: "House", condition: 5,
      maidCount: 1, hourCount: 1, extras: [{ id: "inside-oven", quantity: 1 }], recurrence: "one-time" },
    extrasConfirmed: true, address: "123 Synthetic Street, Washington, DC 20001", notes: [] };
}
function canonical(raw = input()): CreateCustomerBookingLinkInput {
  const { smsNumberConfirmed: _sms, extrasConfirmed: _extras, customerNameConfirmed: _name, city: _city, addressConfirmed: _address, ...value } = raw;
  return value;
}
function request(args: unknown = input(), toolCallId = "synthetic-tool-id") {
  return { callId: CALL, toolCallId, name: "textBookingQuote", args };
}
type Fault = "none" | "all-writes" | "funnel-insert" | "receipt-insert" | "receipt-truncated" | "receipt-id" |
  "claim-update" | "claim-noop" | "claim-truncated" | "finish-update" | "finish-noop" | "finish-truncated" | "commit";

/** Model MySQL row locks, unique keys, SELECT readback and atomic snapshot rollback.
 * No SQL writes beyond the two approved tables can accidentally pass this harness. */
function transactionalDb() {
  let state: any = { cards: [], funnels: [], optouts: [], sessions: [], next: 100 };
  let tail = Promise.resolve();
  let fault: Fault = "none";
  const dialect = new MySqlDialect();
  const queries: Array<{ sql: string; params: any[] }> = [];
  const writes: Array<{ table: string; values: any }> = [];
  const events: string[] = [];
  let transactions = 0;
  let optoutReads = 0;
  let onOptoutRead: ((count: number) => void) | undefined;

  function insert(table: any) {
    const name = getTableName(table);
    if (!["booking_funnel_records", "ops_chat_messages"].includes(name)) throw Error(`Forbidden table write: ${name}`);
    return { async values(values: any) {
      writes.push({ table: name, values: structuredClone(values) });
      if (fault === "all-writes" || (name === "booking_funnel_records" && fault === "funnel-insert")) throw Error("Injected persistence failure");
      if (name === "booking_funnel_records") {
        if (state.funnels.some((row: any) => row.publicFunnelNumber === values.publicFunnelNumber || row.idempotencyKey === values.idempotencyKey)) throw Object.assign(Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
        const id = ++state.next; state.funnels.push({ id, ...structuredClone(values) });
        events.push("insert:funnel"); return [{ insertId: id, affectedRows: 1 }];
      }
      expect([CALL_BOOKING_QUOTE_ACTION, CALL_BOOKING_QUOTE_FLOW_ACTION]).toContain(values.quickAction);
      if (state.cards.some((row: any) => row.activeDedupKey === values.activeDedupKey)) throw Object.assign(Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 });
      if (values.quickAction === CALL_BOOKING_QUOTE_ACTION && fault === "receipt-insert") throw Error("Injected receipt insert failure");
      const id = ++state.next;
      const metadata = values.quickAction === CALL_BOOKING_QUOTE_ACTION && fault === "receipt-truncated" ? values.metadata.slice(0, -1) : values.metadata;
      state.cards.push({ id, sessionId: null, ...structuredClone(values), metadata });
      events.push(`insert:${values.quickAction}`);
      return [{ insertId: values.quickAction === CALL_BOOKING_QUOTE_ACTION && fault === "receipt-id" ? id + 1 : id, affectedRows: 1 }];
    } };
  }
  async function execute(query: any, inTransaction: boolean) {
    const q = dialect.sqlToQuery(query); queries.push(q);
    const s = q.sql.replace(/\s+/g, " ").trim(), p = q.params;
    if (s.startsWith("SELECT")) {
      if (s.includes("FROM sms_opt_outs")) {
        optoutReads++; onOptoutRead?.(optoutReads);
        return [structuredClone(state.optouts.filter((row: any) => p.includes(row.phone)))];
      }
      if (s.includes("FROM conversation_sessions")) {
        return [structuredClone(state.sessions.filter((row: any) => p.includes(row.leadPhone) && row.smsOptOut === 1))];
      }
      if (s.includes("FROM ops_chat_messages WHERE activeDedupKey")) {
        expect(s).toContain("FOR UPDATE"); expect(inTransaction).toBe(true);
        return [structuredClone(state.cards.filter((row: any) => row.activeDedupKey === p[0]))];
      }
      if (s.includes("FROM ops_chat_messages WHERE quickAction")) {
        return [structuredClone(state.cards.filter((row: any) => row.quickAction === p[0] && row.channel === p[1] &&
          (s.includes(" LIKE ") ? row.activeDedupKey.startsWith(String(p[2]).replace(/%$/, "")) : row.activeDedupKey === p[2])))];
      }
    }
    if (s.startsWith("UPDATE ops_chat_messages")) {
      expect(inTransaction).toBe(true);
      const next = JSON.parse(p[0]), stage = next.phase === "sending" ? "claim" : "finish";
      writes.push({ table: "ops_chat_messages", values: next });
      if (fault === "all-writes" || fault === `${stage}-update`) throw Error(`Injected ${stage} update failure`);
      if (fault === `${stage}-noop`) return [{ affectedRows: 0 }];
      const row = state.cards.find((row: any) => row.id === p[2] && row.quickAction === p[3]);
      if (!row) return [{ affectedRows: 0 }];
      row.metadata = fault === `${stage}-truncated` ? String(p[0]).slice(0, -1) : p[0];
      row.lastActivityAt = p[1]; events.push(`update:${next.phase}`); return [{ affectedRows: 1 }];
    }
    throw Error(`Unexpected or forbidden SQL: ${s}`);
  }
  const tx: any = { insert, execute: (q: any) => execute(q, true) };
  const db: any = {
    insert, execute: (q: any) => execute(q, false),
    async transaction(fn: any) {
      let release!: () => void;
      const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
      const snapshot = structuredClone(state); transactions++; events.push("begin");
      try {
        const result = await fn(tx);
        if (fault === "commit") throw Error("Injected transaction commit failure");
        events.push("commit"); return result;
      } catch (error) { state = snapshot; events.push("rollback"); throw error; }
      finally { transactions--; release(); }
    },
  };
  return { db, queries, writes, events, state: () => state, transactions: () => transactions,
    setFault: (value: Fault) => { fault = value; }, onOptoutRead: (fn: (count: number) => void) => { onOptoutRead = fn; } };
}
const receipts = (h: ReturnType<typeof transactionalDb>) => h.state().cards.filter((row: any) => row.quickAction === CALL_BOOKING_QUOTE_ACTION);
const markers = (h: ReturnType<typeof transactionalDb>) => h.state().cards.filter((row: any) => row.quickAction === CALL_BOOKING_QUOTE_FLOW_ACTION);
const receiptState = (h: ReturnType<typeof transactionalDb>) => JSON.parse(receipts(h)[0].metadata);
function harness() {
  const memory = transactionalDb();
  const readCall = vi.fn(async (_id: string): Promise<unknown> => verifiedCall());
  const isFieldManagementCall = vi.fn(async (_id: string) => false);
  const send = vi.fn(async (_params: any): Promise<any> => ({ success: true, messageId: "synthetic-message-id" }));
  const onLinkCreated = vi.fn(() => {
    expect(memory.transactions()).toBe(0); expect(memory.events.at(-1)).toBe("commit");
    expect(memory.state().funnels).toHaveLength(receipts(memory).length); memory.events.push("broadcast");
  });
  const deps = { assistantId: "customer-assistant", readCall, isFieldManagementCall, store: createCallBookingQuoteStore(memory.db), send,
    senderNumberId: SENDER, publicOrigin: CALL_QUOTE_BOOKING_ORIGIN, nowMs: () => NOW.getTime(), onLinkCreated };
  return { ...memory, deps, readCall, send, onLinkCreated, isFieldManagementCall,
    run: createCallBookingQuoteHandler(deps), restart: () => createCallBookingQuoteHandler({ ...deps, store: createCallBookingQuoteStore(memory.db) }) };
}
function expectNoEffects(h: ReturnType<typeof harness>) {
  expect(h.state().funnels).toEqual([]); expect(receipts(h)).toEqual([]);
  expect(h.state().cards.every((row: any) => row.quickAction === CALL_BOOKING_QUOTE_FLOW_ACTION)).toBe(true); expect(h.send).not.toHaveBeenCalled(); expect(h.onLinkCreated).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Forbidden network access"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  expect(infrastructure.getDb).not.toHaveBeenCalled(); expect(infrastructure.sendSms).not.toHaveBeenCalled();
  expect(infrastructure.broadcast).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("call-only booking quote — actual canonical engine, helper and durable SQL store", () => {
  it("persists the authoritative quote then submits its full token SMS after commit, never books or reserves", async () => {
    const h = harness(), raw = input(), before = structuredClone(raw), expected = createPublicBookingPriceSnapshot(raw.pricing);
    const result = await h.run(request(raw));
    expect(result).toMatchObject({ success: true, alreadySent: false, providerMessageId: "synthetic-message-id", deliveryStatus: "submitted",
      firstCleaningTotalCents: expected.breakdown.firstCleaningTotalCents, bookingConfirmed: false, reservationConfirmed: false });
    expect(h.readCall.mock.calls).toEqual([[CALL]]); expect(h.isFieldManagementCall.mock.calls).toEqual([[CALL]]);
    expect(h.state().funnels).toHaveLength(1); expect(receipts(h)).toHaveLength(1); expect(markers(h)).toHaveLength(1);
    const row = h.state().funnels[0], receipt = receiptState(h);
    expect(row).toMatchObject({ source: "customer-booking-link", stage: "lead", bookedByAgentId: null, bookedByAgentName: "Instinct · AI Call",
      customerName: raw.customerName, customerPhone: PHONE, serviceId: raw.pricing.serviceId, requestedLocalDate: raw.requestedLocalDate,
      requestedLocalTime: raw.requestedLocalTime, requestedTimeZone: "America/New_York", extras: raw.pricing.extras,
      specialRequestNotes: [], firstCleaningTotalCents: expected.breakdown.firstCleaningTotalCents,
      futureVisitTotalCents: expected.breakdown.futureVisitTotalCents, priceSnapshot: expected });
    expect(row.publicFunnelNumber).toMatch(/^mib-[a-z0-9-]+$/); expect(row.publicFunnelNumber.length).toBeLessThanOrEqual(40);
    expect(row.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/); expect(row.commandHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt).toMatchObject({ phase: "sent", recipient: PHONE, senderNumberId: SENDER, providerMessageId: "synthetic-message-id",
      link: { token: row.publicFunnelNumber, urlPath: `/book/${row.publicFunnelNumber}`, firstCleaningTotalCents: row.firstCleaningTotalCents } });
    expect(h.send.mock.calls).toEqual([[{ to: PHONE, fromNumberId: SENDER, content: buildCallBookingQuoteSms(canonical(raw), receipt.link, CALL_QUOTE_BOOKING_ORIGIN) }]]);
    expect(h.send.mock.calls[0][0].content).toContain(`${CALL_QUOTE_BOOKING_ORIGIN}/book/${row.publicFunnelNumber}`);
    expect(h.send.mock.calls[0][0].content).toContain("Inside Oven"); expect(h.send.mock.calls[0][0].content).toContain("María");
    expect(h.send.mock.calls[0][0].content.length).toBeGreaterThan(160);
    expect(h.onLinkCreated).toHaveBeenCalledTimes(1); expect(raw).toEqual(before);
    expect(h.writes.every(write => ["booking_funnel_records", "ops_chat_messages"].includes(write.table))).toBe(true);
    expect(h.queries.filter(q => q.sql.startsWith("UPDATE")).every(q => q.sql.includes("ops_chat_messages"))).toBe(true);
  });
  it.each(["weekly", "biweekly", "monthly"])("retains distinct canonical first/future prices in %s link and SMS", async recurrence => {
    const h = harness(), raw = input(); raw.pricing.recurrence = recurrence; raw.pricing.condition = 8;
    const expected = createPublicBookingPriceSnapshot(raw.pricing); expect((await h.run(request(raw))).success).toBe(true);
    expect(h.state().funnels[0].priceSnapshot).toEqual(expected);
    const format = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
    expect(h.send.mock.calls[0][0].content).toContain(format(expected.breakdown.firstCleaningTotalCents));
    expect(h.send.mock.calls[0][0].content).toContain(format(expected.breakdown.futureVisitTotalCents!));
  });
  it("supports explicit confirmed no extras without guessed add-ons", async () => {
    const h = harness(), raw = input(); raw.pricing.extras = [];
    expect((await h.run(request(raw))).success).toBe(true); expect(h.state().funnels[0].extras).toEqual([]);
    expect(h.send.mock.calls[0][0].content).toContain("No add-ons selected");
  });
  it("does not truncate long SMS, full URL or any canonical extras; Spanish Unicode facts persist", async () => {
    const h = harness(), raw = input(); raw.customerName = "Ángela Muñoz"; raw.address = "Calle del Niño, número 42, San José"; raw.city = "San José";
    raw.notes = ["Por favor, limpiar el horno y las ventanas; ¡gracias!"];
    raw.pricing.extras = [{ id: "inside-cabinets", quantity: 1 }, { id: "inside-fridge", quantity: 1 }, { id: "inside-oven", quantity: 1 },
      { id: "interior-windows", quantity: 8 }, { id: "organizing-hour", quantity: 2 }, { id: "laundry-load", quantity: 3 }];
    expect((await h.run(request(raw))).success).toBe(true);
    expect(h.state().funnels[0]).toMatchObject({ customerName: raw.customerName, address: raw.address, specialRequestNotes: raw.notes });
    const text = h.send.mock.calls[0][0].content;
    expect(text).toContain("Ángela"); for (const extra of createPublicBookingPriceSnapshot(raw.pricing).breakdown.extras) expect(text).toContain(extra.label);
    expect(text).toContain("8 × Interior Windows"); expect(text.endsWith(`${CALL_QUOTE_BOOKING_ORIGIN}/book/${h.state().funnels[0].publicFunnelNumber}`)).toBe(true);
    expect(text.length).toBeGreaterThan(160);
  });
  it("accepts an explicitly confirmed alternate recipient rather than forcing forwarded caller ID", async () => {
    const h = harness(); expect((await h.run(request())).success).toBe(true);
    expect(h.send.mock.calls[0][0].to).toBe(PHONE); expect(h.send.mock.calls[0][0].to).not.toBe(verifiedCall().customer.number);
  });
  it("does not introduce role/cleaner-phone lookups or exclusions for an otherwise verified customer call", async () => {
    const h = harness(); h.state().sessions.push({ id: 9, leadPhone: PHONE, smsOptOut: 0, leadSource: "cs-inbound-cleaner", csQueue: "Teams" });
    expect((await h.run(request())).success).toBe(true);
    expect(h.queries.some(q => /cleaner|team_members|contacts|bookings|payments|customer_portal/i.test(q.sql))).toBe(false);
    expect(h.state().sessions).toEqual([{ id: 9, leadPhone: PHONE, smsOptOut: 0, leadSource: "cs-inbound-cleaner", csQueue: "Teams" }]);
  });
  it("preview verifies its call and marks only private fallback suppression, without a quote link, SMS or broadcast", async () => {
    const h = harness(), raw = input();
    const result = await h.run({ ...request({ pricing: raw.pricing, extrasConfirmed: true }), name: "getBookingQuote" });
    expect(result).toMatchObject({ success: true, priceSnapshot: createPublicBookingPriceSnapshot(raw.pricing), bookingConfirmed: false, reservationConfirmed: false });
    expectNoEffects(h); expect(h.readCall).toHaveBeenCalledWith(CALL); expect(await hasCallBookingQuoteAttempt(h.db, CALL)).toBe(true); expect(receipts(h)).toEqual([]);
  });
});

describe("source verification, exact-phone STOP and input gates", () => {
  it.each([
    ["wrong provider ID", { id: "other-call" }], ["wrong assistant", { assistantId: "other-assistant" }],
    ["outbound", { type: "outboundPhoneCall" }], ["web", { type: "webCall" }], ["assistant", { type: "assistantCall" }],
    ["queued", { status: "queued" }], ["missing status", { status: undefined }], ["missing assistant", { assistantId: undefined }],
  ])("rejects %s artifacts with no writes or SMS", async (_label, patch) => {
    const h = harness(); h.readCall.mockResolvedValue({ ...verifiedCall(), ...patch });
    expect(await h.run(request())).toMatchObject({ success: false, code: "UNVERIFIED_CUSTOMER_CALL" }); expectNoEffects(h);
  });
  it.each([null, {}, [], "unverified"])("rejects malformed provider artifact %#", async artifact => {
    const h = harness(); h.readCall.mockResolvedValue(artifact); expect((await h.run(request())).success).toBe(false); expectNoEffects(h);
  });
  it("rejects an exact verified call identified as field management", async () => {
    const h = harness(); h.isFieldManagementCall.mockResolvedValue(true);
    expect((await h.run(request())).code).toBe("UNVERIFIED_CUSTOMER_CALL"); expectNoEffects(h);
  });
  it("fails closed when source reads throw", async () => {
    const h = harness(); h.readCall.mockRejectedValue(Error("Synthetic source unavailable"));
    expect((await h.run(request())).success).toBe(false); expectNoEffects(h);
  });
  it.each(["+12028885362", "202-888-5362", "+19347898077", "9347898077", "+447911123456", "1234567890"])("rejects internal or invalid recipient %s without creating a quote or sending SMS", async customerPhone => {
    const h = harness(); expect((await h.run(request({ ...input(), customerPhone }))).success).toBe(false); expectNoEffects(h); expect(h.readCall).toHaveBeenCalledWith(CALL);
  });
  it.each(["global", "session"])("checks %s STOP against the confirmed recipient across all matching rows, keeping only the flow marker", async kind => {
    const h = harness();
    h.state().optouts.push({ id: 1, phone: "+17035559876" });
    h.state().sessions.push({ id: 1, leadPhone: PHONE, smsOptOut: 0 }, { id: 2, leadPhone: "+17035559876", smsOptOut: 1 });
    if (kind === "global") h.state().optouts.push({ id: 8, phone: PHONE });
    else h.state().sessions.push({ id: 8, leadPhone: PHONE, smsOptOut: 1, leadSource: "hiring" });
    expect(await h.run(request())).toMatchObject({ success: false, code: "SMS_OPTED_OUT" });
    expect(h.state().funnels).toEqual([]); expect(receipts(h)).toEqual([]); expect(markers(h)).toHaveLength(1); expect(h.send).not.toHaveBeenCalled();
    expect(h.queries.some(q => q.sql.includes("sms_opt_outs") && q.params.includes(PHONE))).toBe(true);
    expect(h.queries.some(q => q.sql.includes("conversation_sessions") && q.params.includes(PHONE))).toBe(true);
    expect(await hasCallBookingQuoteAttempt(h.db, CALL)).toBe(true); expect(await hasCallBookingQuoteAttempt(h.db, "unrelated-call")).toBe(false);
  });
  it("does not let unrelated caller-ID opt-outs suppress the explicitly confirmed alternate phone", async () => {
    const h = harness(); h.state().optouts.push({ id: 1, phone: verifiedCall().customer.number });
    h.state().sessions.push({ id: 2, leadPhone: verifiedCall().customer.number, smsOptOut: 1 });
    expect((await h.run(request())).success).toBe(true); expect(h.send.mock.calls[0][0].to).toBe(PHONE);
  });
  it("rechecks opt-out immediately before claiming the one provider attempt", async () => {
    const h = harness(); h.onOptoutRead(count => { if (count === 2) h.state().optouts.push({ id: 4, phone: PHONE }); });
    expect((await h.run(request())).code).toBe("SMS_OPTED_OUT"); expect(h.state().funnels).toHaveLength(1);
    expect(receiptState(h).phase).toBe("prepared"); expect(h.send).not.toHaveBeenCalled(); expect(h.onLinkCreated).toHaveBeenCalledTimes(1);
  });
  it.each(["customerName", "customerPhone", "requestedLocalDate", "requestedLocalTime", "pricing", "extrasConfirmed", "smsNumberConfirmed", "customerNameConfirmed", "city", "addressConfirmed"])("asks for missing %s without guessed data", async key => {
    const h = harness(), raw = input(); delete raw[key];
    expect(await h.run(request(raw))).toMatchObject({ success: false, code: "INCOMPLETE_QUOTE" }); expectNoEffects(h);
  });
  it.each(["pricingMode", "serviceId", "bedrooms", "bathrooms", "homeType", "condition", "maidCount", "hourCount", "extras", "recurrence"])("requires explicit pricing.%s", async key => {
    const h = harness(), raw = input(); delete raw.pricing[key];
    expect((await h.run(request(raw))).success).toBe(false); expectNoEffects(h);
  });
  it.each(["extrasConfirmed", "smsNumberConfirmed", "customerNameConfirmed", "addressConfirmed"])("rejects false %s, including unconfirmed empty extras", async key => {
    const h = harness(), raw = input(); raw[key] = false; raw.pricing.extras = [];
    expect((await h.run(request(raw))).success).toBe(false); expectNoEffects(h);
  });
  it.each([
    ["invalid service", { serviceId: "office" }], ["invalid extra", { extras: [{ id: "invented", quantity: 1 }] }],
    ["duplicate extra", { extras: [{ id: "inside-oven", quantity: 1 }, { id: "inside-oven", quantity: 2 }] }],
    ["zero quantity", { extras: [{ id: "inside-oven", quantity: 0 }] }], ["custom override", { customPriceCents: 1 }],
    ["quoted price", { quotedPrice: 1 }], ["negative bedroom", { bedrooms: -1 }],
  ])("rejects %s before quote or SMS side effects", async (_label, patch) => {
    const h = harness(), raw = input(); Object.assign(raw.pricing, patch);
    expect((await h.run(request(raw))).success).toBe(false); expectNoEffects(h);
  });
  it.each(["quotedPrice", "customPriceCents", "url", "token", "content", "fromNumberId"])("does not accept model-supplied %s", async key => {
    const h = harness(); expect((await h.run(request({ ...input(), [key]: "invented" }))).success).toBe(false); expectNoEffects(h);
  });
  it.each(["2026-11-16", "2026-02-30", "2026-13-01"])("rejects past or invalid calendar date %s without a link or SMS", async requestedLocalDate => {
    const h = harness(); expect((await h.run(request({ ...input(), requestedLocalDate }))).success).toBe(false); expectNoEffects(h);
  });
  it("accepts today's requested date rather than forcing arbitrary tomorrow", async () => {
    const h = harness(); expect((await h.run(request({ ...input(), requestedLocalDate: "2026-11-17", requestedLocalTime: "18:00" }))).success).toBe(true);
  });
  it("rejects missing execution context and unknown tools without provider or store calls", async () => {
    for (const patch of [{ callId: "" }, { toolCallId: "" }, { name: "unknown" }]) {
      const h = harness(); expect((await h.run({ ...request(), ...patch })).success).toBe(false); expectNoEffects(h); expect(h.readCall).not.toHaveBeenCalled();
    }
  });
});

describe("call-only name and city acceptance", () => {
  it("rejects the observed Valued Customer and street-only request with no link or SMS", async () => {
    const h = harness(), raw = input();
    raw.customerName = "Valued Customer"; raw.address = "4033 Mansion Drive";
    delete raw.customerNameConfirmed; delete raw.city; delete raw.addressConfirmed;
    const result = await h.run(request(raw));
    expect(result).toMatchObject({ success: false, code: "INCOMPLETE_QUOTE" });
    expectNoEffects(h);
  });
  it.each([
    ["customerName", "Valued Customer", "customerName"],
    ["customerNameConfirmed", false, "customerNameConfirmed"],
    ["city", undefined, "city"], ["city", " ", "city"], ["city", "Unknown", "city"],
    ["address", "4033 Mansion Drive", "address"],
    ["address", "4033 Mansion Drive, Alexandria", "address"],
    ["address", ", Washington, DC", "address"],
    ["address", "   , Washington, DC", "address"],
    ["address", "4033 Mansion Drive\nWashington\nDC", "address"],
    ["addressConfirmed", false, "addressConfirmed"],
  ])("returns exact missing %s for %s without a link or SMS", async (field, value, missing) => {
    const h = harness(), raw = input(); raw[field] = value;
    const result = await h.run(request(raw));
    expect(result).toMatchObject({ success: false, code: "INCOMPLETE_QUOTE", missing: expect.arrayContaining([missing]) });
    expectNoEffects(h);
  });
  it("asks for missing identity first, then sends only the caller-corrected complete details", async () => {
    const h = harness(), incomplete = input();
    incomplete.customerName = "Valued Customer"; incomplete.address = "4033 Mansion Drive";
    delete incomplete.customerNameConfirmed; delete incomplete.city; delete incomplete.addressConfirmed;
    expect((await h.run(request(incomplete))).success).toBe(false); expectNoEffects(h);
    const corrected = { ...input(), customerName: "Anne-Marie O'Neill", address: "4033 Mansion Drive, Washington, DC" };
    expect(await h.run(request(corrected, "caller-corrected-details"))).toMatchObject({ success: true, alreadySent: false });
    expect(h.state().funnels).toHaveLength(1); expect(h.send).toHaveBeenCalledOnce();
    expect(h.state().funnels[0]).toMatchObject({ customerName: corrected.customerName, address: corrected.address });
    expect(h.send.mock.calls[0][0].content).toContain("Anne-Marie");
    expect(h.send.mock.calls[0][0].content).not.toContain("Valued");
    const savedInput = canonical(corrected);
    const expected = createPublicBookingPriceSnapshot(corrected.pricing);
    expect(h.state().funnels[0].priceSnapshot).toEqual(expected);
    expect(h.send.mock.calls[0][0].content).toBe(buildCallBookingQuoteSms(savedInput, receiptState(h).link, CALL_QUOTE_BOOKING_ORIGIN));
    for (const field of ["customerNameConfirmed", "city", "addressConfirmed"]) {
      expect(h.state().funnels[0]).not.toHaveProperty(field);
      expect(receiptState(h)).not.toHaveProperty(field);
    }
    const before = structuredClone(h.state());
    expect(await h.restart()(request({ ...corrected, city: " washington " }, "repeat-confirmed-input"))).toMatchObject({ success: true, alreadySent: true });
    expect(h.state().funnels).toEqual(before.funnels); expect(h.send).toHaveBeenCalledOnce();
  });
});

describe("durable fingerprint deduplication and at-most-one transport submission", () => {
  it("serializes simultaneous duplicate tool IDs and fresh store instances to one quote and one SMS", async () => {
    const h = harness();
    const results = await Promise.all([h.run(request()), h.restart()(request()), h.run(request(input(), "different-tool-id"))]);
    expect(results.some(result => result.success)).toBe(true); expect(h.state().funnels).toHaveLength(1); expect(receipts(h)).toHaveLength(1);
    expect(markers(h)).toHaveLength(1); expect(h.send).toHaveBeenCalledTimes(1); expect(h.onLinkCreated).toHaveBeenCalledTimes(1);
    expect(await h.restart()(request(input(), "restart-tool-id"))).toMatchObject({ success: true, alreadySent: true });
    expect(h.send).toHaveBeenCalledTimes(1); expect(receiptState(h).phase).toBe("sent");
  });
  it("normalizes equivalent phone formats and extras order into the same fingerprint", async () => {
    const h = harness(), a = input(); a.pricing.extras.push({ id: "inside-fridge", quantity: 2 });
    expect((await h.run(request(a))).success).toBe(true);
    const b = structuredClone(a); b.customerPhone = "(301) 555-0123"; b.pricing.extras.reverse();
    expect(await h.restart()(request(b, "reordered-tool"))).toMatchObject({ success: true, alreadySent: true });
    expect(h.state().funnels).toHaveLength(1); expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("permits a newly requested changed-extras quote on the same call, without an artificial one-per-call cap", async () => {
    const h = harness(), a = input(); expect((await h.run(request(a))).success).toBe(true);
    const b = input(); b.pricing.extras.push({ id: "inside-fridge", quantity: 1 });
    expect(await h.run(request(b, "new-request"))).toMatchObject({ success: true, alreadySent: false });
    expect(h.state().funnels).toHaveLength(2); expect(receipts(h)).toHaveLength(2); expect(markers(h)).toHaveLength(1);
    expect(h.send).toHaveBeenCalledTimes(2); expect(h.onLinkCreated).toHaveBeenCalledTimes(2);
    expect(h.state().funnels[0].publicFunnelNumber).not.toBe(h.state().funnels[1].publicFunnelNumber);
    expect(h.state().funnels[1].firstCleaningTotalCents).toBe(createPublicBookingPriceSnapshot(b.pricing).breakdown.firstCleaningTotalCents);
  });
  it.each([
    ["accepted without ID", { success: true }, "unknown"], ["accepted empty ID", { success: true, messageId: "" }, "unknown"],
    ["provider rejection", { success: false, error: "Synthetic rejection" }, "failed"],
  ])("records %s durably and never resends after restart", async (_label, outcome, phase) => {
    const h = harness(); h.send.mockResolvedValue(outcome);
    expect((await h.run(request())).success).toBe(false); expect(receiptState(h).phase).toBe(phase);
    expect((await h.restart()(request(input(), "retry-tool"))).success).toBe(false);
    expect(h.send).toHaveBeenCalledTimes(1); expect(h.state().funnels).toHaveLength(1); expect(h.onLinkCreated).toHaveBeenCalledTimes(1);
  });
  it("records thrown transport as unknown and blocks automatic resend", async () => {
    const h = harness(); h.send.mockRejectedValue(Error("Synthetic ambiguous transport"));
    expect((await h.run(request())).success).toBe(false); expect(receiptState(h)).toMatchObject({ phase: "unknown", code: "TRANSPORT_OUTCOME_UNKNOWN", providerMessageId: null });
    expect((await h.restart()(request())).success).toBe(false); expect(h.send).toHaveBeenCalledTimes(1);
  });
  it.each(["finish-update", "finish-noop", "finish-truncated"] as Fault[])("blocks future sends after SMS succeeds but durable %s fails", async fault => {
    const h = harness(); h.setFault(fault);
    expect((await h.run(request())).success).toBe(false); expect(h.send).toHaveBeenCalledTimes(1);
    expect(receiptState(h)).toMatchObject({ phase: "sending", providerMessageId: null }); h.setFault("none");
    expect((await h.restart()(request())).success).toBe(false); expect(h.send).toHaveBeenCalledTimes(1); expect(h.state().funnels).toHaveLength(1);
  });
  it("does not create any link, receipt, marker or SMS for an ended call with no existing quote", async () => {
    const h = harness(); h.readCall.mockResolvedValue({ ...verifiedCall(), status: "ended" });
    expect(await h.run(request())).toMatchObject({ success: false, code: "CALL_ENDED" }); expectNoEffects(h);
  });
  it("replays an ended-call sent duplicate successfully with zero new writes or resends", async () => {
    const h = harness(); expect((await h.run(request())).success).toBe(true);
    const before = structuredClone(h.state()), writes = h.writes.length;
    h.readCall.mockResolvedValue({ ...verifiedCall(), status: "ended" });
    expect(await h.restart()(request(input(), "ended-replay"))).toMatchObject({ success: true, alreadySent: true });
    expect(h.state()).toEqual(before); expect(h.writes).toHaveLength(writes); expect(h.send).toHaveBeenCalledTimes(1); expect(h.onLinkCreated).toHaveBeenCalledTimes(1);
  });
  it("does not create an ended-call changed quote even when an earlier quote was sent", async () => {
    const h = harness(); await h.run(request()); const before = structuredClone(h.state()), writes = h.writes.length;
    h.readCall.mockResolvedValue({ ...verifiedCall(), status: "ended" }); const changed = input(); changed.pricing.extras = [];
    expect((await h.run(request(changed, "ended-new"))).success).toBe(false);
    expect(h.state()).toEqual(before); expect(h.writes).toHaveLength(writes); expect(h.send).toHaveBeenCalledTimes(1);
  });
});

describe("actual SQL receipt readback, rollback and conflict safety", () => {
  it.each(["all-writes", "funnel-insert", "receipt-insert", "receipt-truncated", "receipt-id", "commit"] as Fault[])("rolls back %s with no SMS or premature broadcast", async fault => {
    const h = harness(); h.setFault(fault);
    expect((await h.run(request())).success).toBe(false); expect(h.state().funnels).toEqual([]); expect(receipts(h)).toEqual([]);
    expect(h.send).not.toHaveBeenCalled(); expect(h.onLinkCreated).not.toHaveBeenCalled();
    if (fault !== "all-writes") expect(markers(h)).toHaveLength(1);
  });
  it.each(["claim-update", "claim-noop", "claim-truncated"] as Fault[])("verifies %s before allowing transport submission", async fault => {
    const h = harness(); h.setFault(fault); expect((await h.run(request())).success).toBe(false);
    expect(h.send).not.toHaveBeenCalled(); expect(receiptState(h).phase).toBe("prepared"); expect(h.state().funnels).toHaveLength(1);
  });
  it.each(["bad-json", "bad-channel", "session-bound", "recipient-conflict", "fingerprint-conflict", "sender-conflict", "invalid-phase"])("rejects corrupt durable receipt %s without sending or creating a new link", async corruption => {
    const h = harness(); await h.run(request()); const row = receipts(h)[0], meta = JSON.parse(row.metadata);
    if (corruption === "bad-json") row.metadata = "{";
    else if (corruption === "bad-channel") row.channel = "command";
    else if (corruption === "session-bound") row.sessionId = 9;
    else {
      if (corruption === "recipient-conflict") meta.recipient = "+17035559876";
      if (corruption === "fingerprint-conflict") meta.fingerprint = "0".repeat(64);
      if (corruption === "sender-conflict") meta.senderNumberId = "other-sender";
      if (corruption === "invalid-phase") meta.phase = "delivered";
      row.metadata = JSON.stringify(meta);
    }
    const writes = h.writes.length;
    expect((await h.restart()(request())).success).toBe(false); expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.state().funnels).toHaveLength(1); expect(h.writes).toHaveLength(writes + 1); // duplicate marker insert only
  });
  it.each(["sent-without-provider-ID", "invalid-link-path", "token-path-mismatch", "canonical-price-mismatch"])("fails closed on semantically corrupt sent receipt %s", async corruption => {
    const h = harness(); await h.run(request()); const row = receipts(h)[0], meta = JSON.parse(row.metadata);
    if (corruption === "sent-without-provider-ID") meta.providerMessageId = null;
    if (corruption === "invalid-link-path") meta.link.urlPath = "https://attacker.example.test/not-a-booking";
    if (corruption === "token-path-mismatch") meta.link.token = "mib-unrelated-token";
    if (corruption === "canonical-price-mismatch") meta.link.firstCleaningTotalCents += 100;
    row.metadata = JSON.stringify(meta);
    const result = await h.restart()(request(input(), "corrupt-replay"));
    expect(h.send).toHaveBeenCalledTimes(1); expect(h.state().funnels).toHaveLength(1);
    expect(result.success).toBe(false);
  });
  it("real store claims once and verifies durable metadata using locked SELECTs, not a mocked adapter", async () => {
    const h = transactionalDb(), store = createCallBookingQuoteStore(h.db), raw = canonical();
    const prepared = await store.prepare(CALL, raw, SENDER);
    expect(prepared.created).toBe(true); expect(receiptState(h).phase).toBe("prepared");
    const claims = await Promise.all([store.claimSend(prepared.receipt, "Synthetic full SMS"), createCallBookingQuoteStore(h.db).claimSend(prepared.receipt, "Synthetic full SMS")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const completed = await store.finish(claims.find(Boolean)!, "sent", "synthetic-provider-ID", null);
    expect(completed.providerMessageId).toBe("synthetic-provider-ID");
    expect(await store.claimSend(prepared.receipt, "Do not resend")).toBeNull();
    expect(h.queries.filter(q => q.sql.includes("activeDedupKey") && q.sql.startsWith("SELECT")).every(q => q.sql.endsWith("FOR UPDATE"))).toBe(true);
    expect(h.queries.filter(q => q.sql.startsWith("UPDATE"))).toHaveLength(2);
  });
  it("actual store rejects finishing an unclaimed or already-finished receipt", async () => {
    const h = transactionalDb(), store = createCallBookingQuoteStore(h.db), prepared = await store.prepare(CALL, canonical(), SENDER);
    await expect(store.finish(prepared.receipt, "sent", "invented", null)).rejects.toThrow("CONFLICT");
    const claimed = (await store.claimSend(prepared.receipt, "Synthetic SMS"))!; await store.finish(claimed, "sent", "actual-ID", null);
    await expect(store.finish(claimed, "sent", "invented", null)).rejects.toThrow("CONFLICT");
    expect(receiptState(h).providerMessageId).toBe("actual-ID");
  });
  it("recognizes exact call receipts after restart without suppressing unrelated calls", async () => {
    const h = transactionalDb(); await createCallBookingQuoteStore(h.db).prepare(CALL, canonical(), SENDER);
    expect(await hasCallBookingQuoteAttempt(h.db, CALL)).toBe(true); expect(await hasCallBookingQuoteAttempt(h.db, "different-call")).toBe(false);
  });
});


describe("failed canonical quote attempt cannot trigger old generic fallback", () => {
  it("retains only the verified call marker when required facts are missing", async () => {
    const h = harness(), raw = input(); delete raw.requestedLocalTime;
    expect((await h.run(request(raw))).code).toBe("INCOMPLETE_QUOTE");
    expect(await hasCallBookingQuoteAttempt(h.db, CALL)).toBe(true);
    expect(receipts(h)).toEqual([]); expect(h.state().funnels).toEqual([]); expect(h.send).not.toHaveBeenCalled();
  });
  it("rejects an earlier time today without substituting an old generic SMS", async () => {
    const h = harness(); const raw = { ...input(), requestedLocalDate: "2026-11-17", requestedLocalTime: "00:01" };
    expect((await h.run(request(raw))).code).toBe("PAST_REQUESTED_TIME");
    expect(await hasCallBookingQuoteAttempt(h.db, CALL)).toBe(true);
    expect(h.send).not.toHaveBeenCalled(); expect(h.state().funnels).toEqual([]);
  });
});


describe("real saved-quote receipt feeds the existing call-task follow-up", () => {
  const source = () => ({ providerCallId: CALL, voiceCallId: 77, sessionId: null, callerPhone: PHONE, callerName: "Synthetic customer", receivedAt: NOW.getTime(), transcript: "Customer: Please send my deep-cleaning booking link.", customerTurns: ["Please send my deep-cleaning booking link."], recordingUrl: null, callbackTaskIds: [], callbackRequests: [] });
  it("reads the persisted private quote receipt and creates an uncompleted task plan with caller evidence", async () => {
    const h = harness(); expect((await h.run(request())).success).toBe(true);
    expect(await hasSavedCallBookingQuote(h.db, CALL)).toBe(true);
    expect(await hasSavedCallBookingQuote(h.db, "different-call")).toBe(false);
    const task = await withCallBookingQuoteTask({ hasSavedQuote: id => hasSavedCallBookingQuote(h.db, id), generate: async () => null })(source());
    expect(task).toEqual({ title: "Follow up on cleaning booking link", items: [{ title: "Review the customer's booking-link completion", evidenceQuote: source().customerTurns[0] }] });
    expect(h.state().funnels[0].stage).toBe("lead"); expect(task).not.toHaveProperty("completedAt");
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("does not mistake the no-link attempt marker for a saved booking quote", async () => {
    const h = harness(); const raw = input(); delete raw.requestedLocalTime;
    expect((await h.run(request(raw))).success).toBe(false);
    expect(await hasCallBookingQuoteAttempt(h.db, CALL)).toBe(true);
    expect(await hasSavedCallBookingQuote(h.db, CALL)).toBe(false);
    expect(await withCallBookingQuoteTask({ hasSavedQuote: id => hasSavedCallBookingQuote(h.db, id), generate: async () => null })(source())).toBeNull();
    expect(h.send).not.toHaveBeenCalled();
  });
  it("preserves the requested follow-up after an uncertain SMS outcome without another send", async () => {
    const h = harness(); h.send.mockRejectedValueOnce(new Error("Unknown provider outcome"));
    expect((await h.run(request())).success).toBe(false);
    const task = await withCallBookingQuoteTask({ hasSavedQuote: id => hasSavedCallBookingQuote(h.db, id), generate: async () => null })(source());
    expect(task?.title).toBe("Follow up on cleaning booking link");
    expect(receiptState(h).phase).toBe("unknown"); expect(h.send).toHaveBeenCalledTimes(1);
  });
});


describe("preview-only incomplete call never falls back to legacy quote/SMS", () => {
  it("marks a verified incomplete preview without creating a link or texting", async () => {
    const h = harness(); const result = await h.run({ ...request({ pricing: { bedrooms: 2 } }), name: "getBookingQuote" });
    expect(result.success).toBe(false); expect(result.code).toBe("INCOMPLETE_QUOTE");
    expect(await hasCallBookingQuoteAttempt(h.db, CALL)).toBe(true);
    expect(await hasSavedCallBookingQuote(h.db, CALL)).toBe(false); expectNoEffects(h);
  });
  it("does not mark a preview from an unverified assistant/call", async () => {
    const h = harness(); h.readCall.mockResolvedValue({ ...verifiedCall(), assistantId: "other-assistant" });
    expect((await h.run({ ...request({}), name: "getBookingQuote" })).code).toBe("UNVERIFIED_CUSTOMER_CALL");
    expect(markers(h)).toEqual([]); expectNoEffects(h);
  });
  it("asks for a missing service address without creating a quote link or SMS", async () => {
    const h = harness(); const raw = input(); delete raw.address;
    expect(await h.run(request(raw))).toMatchObject({ success: false, code: "INCOMPLETE_QUOTE", missing: ["address"] });
    expectNoEffects(h);
  });
});
