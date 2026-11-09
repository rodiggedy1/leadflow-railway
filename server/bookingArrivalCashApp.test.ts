import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), stripe: vi.fn(), retrieve: vi.fn(), createIntent: vi.fn(), settle: vi.fn(), abandon: vi.fn(), markUnavailable: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "arrival-offline-secret" } }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.context<Record<string, unknown>>().create();
  return { router: t.router, publicProcedure: t.procedure };
});
vi.mock("./stripeClient", () => ({ getStripeClient: mocks.stripe }));
vi.mock("./bookingCashAppEngine", () => ({
  createOrReuseCashAppPaymentIntent: mocks.createIntent, settleSucceededCashAppPayment: mocks.settle,
  abandonCashAppPayment: mocks.abandon, markCashAppPaymentUnavailable: mocks.markUnavailable,
}));
vi.mock("../drizzle/schema", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, field: string) => field === "name" ? target.name : { table: name, field },
  });
  return {
    bookingFunnelRecords: table("funnel"), bookings: table("booking"), bookingSeries: table("series"),
    bookingPaymentProfiles: table("profile"), bookingCashAppPayments: table("cashapp"),
  };
});
vi.mock("drizzle-orm", () => ({
  eq: (column: Column, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => conditions,
  desc: (column: Column) => column,
}));

import { bookingCashAppRouter } from "./bookingCashAppRouter";
import { ensurePublicBookingPaymentTarget } from "./bookingPaymentTargetService";
import { persistCanonicalBooking } from "./canonicalBookingPersistence";
import { createBookingFunnelMutationToken } from "./bookingFunnelService";
import { buildPreparedCanonicalBooking, buildPreparedNativeBooking } from "./bookingsService";
import { createBookingArrivalPreference } from "../shared/bookingArrival";
import { createPublicBookingPriceSnapshot, getPublicBookingArrivalPreference, PUBLIC_BOOKING_PRICING_VERSION, type PublicBookingPricingInput } from "../shared/publicBookingPricing";
import { NATIVE_BOOKING_PRICING_VERSION } from "../shared/booking";

type Column = { table: string; field: string };
type Row = Record<string, any>;
type Table = { name: string };
type Condition = { column: Column; value: unknown };
class MemoryDb {
  state: Record<string, Row[]> = { funnel: [], booking: [], series: [], profile: [], cashapp: [] };
  writes: Array<{ table: string; values: Row }> = [];
  select(fields?: Record<string, Column>) {
    let table: Table;
    let condition: Condition;
    let count = Infinity;
    const chain = {
      from(value: Table) { table = value; return chain; },
      where(value: Condition) { condition = value; return chain; },
      limit(value: number) { count = value; return chain; },
      orderBy() { return chain; }, for() { return chain; },
      then: async (resolve: (rows: Row[]) => unknown) => {
        let rows = this.state[table.name].filter(row => !condition || row[condition.column.field] === condition.value).slice(0, count);
        if (fields) rows = rows.map(row => Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[column.field]])));
        return resolve(structuredClone(rows));
      },
    };
    return chain;
  }
  insert(table: Table) {
    return { values: async (values: Row) => {
      this.writes.push({ table: table.name, values: structuredClone(values) });
      const rows = this.state[table.name];
      const id = rows.length + 1;
      rows.push({ id, ...structuredClone(values) });
      return [{ insertId: id }];
    } };
  }
  update(table: Table) {
    return { set: (values: Row) => ({ where: async (condition: Condition) => {
      this.writes.push({ table: table.name, values: structuredClone(values) });
      this.state[table.name].filter(row => row[condition.column.field] === condition.value).forEach(row => Object.assign(row, structuredClone(values)));
      return [{ affectedRows: 1 }];
    } }) };
  }
  transaction = async (callback: (tx: MemoryDb) => Promise<unknown>) => callback(this);
}

const base: PublicBookingPricingInput = {
  pricingMode: "home", serviceId: "standard", bedrooms: 1, bathrooms: 1,
  homeType: "House", condition: 6, maidCount: 2, hourCount: 2,
  extras: [{ id: "inside-fridge", quantity: 2 }], recurrence: "biweekly",
};
const uuid = "11111111-1111-4111-8111-111111111111";
const preferences = [undefined, createBookingArrivalPreference("flexible"), createBookingArrivalPreference("preferred", "morning"), createBookingArrivalPreference("preferred", "afternoon"), createBookingArrivalPreference("exact", undefined, "16:30")];
function funnel(pricing: PublicBookingPricingInput): Row {
  const snapshot = createPublicBookingPriceSnapshot(pricing);
  return {
    id: 41, publicFunnelNumber: "arrival-offline-funnel", idempotencyKey: uuid,
    source: "book-page", stage: "payment_incomplete", bookingId: null,
    customerName: "Arrival Customer", customerPhone: "2025550182", customerEmail: "arrival@example.com",
    serviceId: pricing.serviceId, serviceName: snapshot.serviceName, bedrooms: pricing.bedrooms, bathrooms: pricing.bathrooms,
    extras: pricing.extras, specialRequestNotes: [], address: "123 Main Street",
    requestedLocalDate: "2027-01-10", requestedLocalTime: pricing.arrivalPreference?.startLocalTime ?? "11:00",
    requestedTimeZone: "America/New_York", recurrence: pricing.recurrence,
    pricingVersion: PUBLIC_BOOKING_PRICING_VERSION, firstCleaningTotalCents: snapshot.breakdown.firstCleaningTotalCents,
    futureVisitTotalCents: snapshot.breakdown.futureVisitTotalCents, priceSnapshot: JSON.parse(JSON.stringify(snapshot)), version: 1,
  };
}
const token = () => createBookingFunnelMutationToken("arrival-offline-secret", "arrival-offline-funnel", uuid);
const caller = () => bookingCashAppRouter.createCaller({});
let db: MemoryDb;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 10, 1));
  db = new MemoryDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.stripe.mockReturnValue({ paymentIntents: { retrieve: mocks.retrieve } });
  mocks.retrieve.mockResolvedValue({ id: "pi_offline", status: "processing" });
  mocks.createIntent.mockImplementation(async (_db, input) => ({ amountCents: input.amountCents, bookingId: input.bookingId }));
});
afterEach(() => vi.restoreAllMocks());

describe("Cash App uses the real canonical arrival quote with offline external boundaries", () => {
  it.each(preferences)("accepts real $mode discounted quote and rejects stale/tampered accepted amount", async arrivalPreference => {
    const pricing = { ...base, ...(arrivalPreference ? { arrivalPreference } : {}) };
    const snapshot = createPublicBookingPriceSnapshot(pricing);
    expect(await caller().quote({ pricing, acceptedPricing: { version: PUBLIC_BOOKING_PRICING_VERSION, totalCents: snapshot.breakdown.firstCleaningTotalCents } })).toEqual({ totalCents: snapshot.breakdown.firstCleaningTotalCents, currency: "usd" });
    await expect(caller().quote({ pricing, acceptedPricing: { version: PUBLIC_BOOKING_PRICING_VERSION, totalCents: 1 } })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.stripe).not.toHaveBeenCalled();
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });

  it("rejects tampered preference boundaries at the real router validator", async () => {
    const pricing = { ...base, arrivalPreference: { mode: "exact" as const, startLocalTime: "16:30", endLocalTime: "17:00" } };
    await expect(caller().quote({ pricing, acceptedPricing: { version: PUBLIC_BOOKING_PRICING_VERSION, totalCents: 29800 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each(preferences)("rehydrates $mode snapshot input into native persistence and exact returned target amount", async arrivalPreference => {
    const pricing = { ...base, ...(arrivalPreference ? { arrivalPreference } : {}) };
    const record = funnel(pricing);
    record.priceSnapshot.breakdown.firstCleaningTotalCents = 1;
    db.state.funnel = [record];
    const target = await ensurePublicBookingPaymentTarget(record as any);
    const snapshot = createPublicBookingPriceSnapshot(pricing);
    expect(target).toMatchObject({ bookingId: 1, totalCents: snapshot.breakdown.firstCleaningTotalCents });
    expect(db.state.booking[0].priceSnapshot).toEqual(snapshot);
    expect(db.state.booking[0]).toMatchObject({ requestedLocalTime: arrivalPreference?.startLocalTime ?? "11:00", firstCleaningTotalCents: snapshot.breakdown.firstCleaningTotalCents, futureVisitTotalCents: snapshot.breakdown.futureVisitTotalCents });
    expect(db.state.series[0]).toMatchObject({ anchorLocalTime: arrivalPreference?.startLocalTime ?? "11:00", firstCleaningTotalCents: snapshot.breakdown.firstCleaningTotalCents, futureVisitTotalCents: snapshot.breakdown.futureVisitTotalCents });
    expect(getPublicBookingArrivalPreference(db.state.booking[0].priceSnapshot)).toEqual(arrivalPreference);
    const prepared = await caller().prepare({ publicFunnelNumber: record.publicFunnelNumber, mutationToken: token() });
    expect(prepared).toMatchObject({ amountCents: snapshot.breakdown.firstCleaningTotalCents, bookingId: 1 });
    expect(mocks.createIntent.mock.calls[0][1].amountCents).toBe(db.state.booking[0].firstCleaningTotalCents);
    expect(mocks.stripe).not.toHaveBeenCalled();
  });

  it("rejects missing public snapshot or wrong accepted amount without native writes", async () => {
    for (const tamper of [(record: Row) => { record.priceSnapshot = null; }, (record: Row) => { record.firstCleaningTotalCents = 1; }]) {
      db = new MemoryDb();
      mocks.getDb.mockResolvedValue(db);
      const record = funnel({ ...base, arrivalPreference: preferences[1] });
      tamper(record);
      db.state.funnel = [record];
      await expect(ensurePublicBookingPaymentTarget(record as any)).rejects.toThrow();
      expect(db.writes).toHaveLength(0);
      expect(db.state.booking).toHaveLength(0);
    }
  });

  it("preserves legacy native/widget quotes with no public snapshot or arrival preference", async () => {
    const nativeInput = {
      idempotencyKey: uuid, surface: "full_page" as const,
      customer: { fullName: "Legacy Native", phone: "2025550182", email: "legacy@example.com" },
      service: { serviceId: "deep" as const, bedrooms: 2, bathrooms: 2, extras: [{ id: "inside-fridge", quantity: 1 }], specialRequestNotes: [] },
      address: "123 Main Street", requestedSchedule: { localDate: "2027-01-10", localTime: "11:00" }, recurrence: "weekly" as const,
      acceptedPricing: { version: NATIVE_BOOKING_PRICING_VERSION, totalCents: 34100 },
    };
    const built = buildPreparedNativeBooking(nativeInput, { nowMs: Date.now(), timeZone: "America/New_York" });
    if (built.type !== "ready") throw new Error("Expected native fixture");
    const record = { ...funnel(base), ...built.prepared, id: 41, idempotencyKey: uuid, publicFunnelNumber: "arrival-offline-funnel", source: "widget-popup", stage: "payment_incomplete", bookingId: null, priceSnapshot: null };
    db.state.funnel = [record];
    const target = await ensurePublicBookingPaymentTarget(record as any);
    expect(target.totalCents).toBe(34100);
    expect(db.state.booking[0].requestedLocalTime).toBe("11:00");
    expect(db.state.booking[0].priceSnapshot).toEqual(built.prepared.priceSnapshot);
    expect(getPublicBookingArrivalPreference(db.state.booking[0].priceSnapshot)).toBeUndefined();
  });

  it("existing JSON native/funnel insert and update paths retain real mode, period and window without extra columns", async () => {
    for (const arrivalPreference of preferences.slice(1)) {
      const pricing = { ...base, arrivalPreference };
      const snapshot = createPublicBookingPriceSnapshot(pricing);
      const built = buildPreparedCanonicalBooking({
        idempotencyKey: uuid, surface: "full_page", customer: { fullName: "Arrival Customer", phone: "2025550182", email: "arrival@example.com" },
        service: { serviceId: base.serviceId, bedrooms: base.bedrooms, bathrooms: base.bathrooms, extras: [...base.extras], specialRequestNotes: [] },
        address: "123 Main Street", requestedSchedule: { localDate: "2027-01-10", localTime: "11:00" }, recurrence: base.recurrence,
        pricing, acceptedPricing: { version: PUBLIC_BOOKING_PRICING_VERSION, totalCents: snapshot.breakdown.firstCleaningTotalCents },
      }, { nowMs: Date.now(), timeZone: "America/New_York" });
      if (built.type !== "ready") throw new Error("Expected public fixture");
      const memory = new MemoryDb();
      const inserted = await persistCanonicalBooking(memory as any, built.prepared);
      expect(memory.state.booking[0].priceSnapshot.input.arrivalPreference).toEqual(arrivalPreference);
      expect(memory.state.funnel[0].priceSnapshot.input.arrivalPreference).toEqual(arrivalPreference);
      expect(memory.state.series[0].futureVisitTotalCents).toBe(snapshot.breakdown.futureVisitTotalCents);
      const updated = await persistCanonicalBooking(memory as any, built.prepared, { funnelRecordId: inserted.funnelRecordId });
      expect(updated.created).toBe(false);
      expect(memory.state.booking).toHaveLength(1);
      expect(memory.state.booking[0].priceSnapshot).toEqual(snapshot);
      for (const write of memory.writes) {
        expect(write.values).not.toHaveProperty("arrivalPreference");
        expect(write.values).not.toHaveProperty("arrivalMode");
        expect(write.values).not.toHaveProperty("arrivalEndLocalTime");
      }
    }
  });

  it("returnStatus uses native first/future values, and the safe reader never fabricates a window", async () => {
    const pricing = { ...base, arrivalPreference: createBookingArrivalPreference("preferred", "afternoon") };
    const record = funnel(pricing);
    db.state.funnel = [record];
    await ensurePublicBookingPaymentTarget(record as any);
    Object.assign(db.state.booking[0], { paymentStatus: "captured", paymentMethod: "cashapp" });
    db.state.cashapp = [{ returnToken: "22222222-2222-4222-8222-222222222222", stripePaymentIntentId: "pi_offline", bookingId: 1 }];
    const result = await caller().returnStatus({ returnToken: "22222222-2222-4222-8222-222222222222" });
    expect(result.booking).toMatchObject({ firstCleaningTotalCents: db.state.booking[0].firstCleaningTotalCents, futureVisitTotalCents: db.state.booking[0].futureVisitTotalCents, requestedLocalTime: "12:00" });
    expect(result.booking).toHaveProperty("arrivalPreference", pricing.arrivalPreference);
    expect(getPublicBookingArrivalPreference(db.state.booking[0].priceSnapshot)).toEqual(pricing.arrivalPreference);
    db.state.booking[0].priceSnapshot = createPublicBookingPriceSnapshot(base);
    const legacyResult = await caller().returnStatus({ returnToken: "22222222-2222-4222-8222-222222222222" });
    expect(legacyResult.booking).not.toHaveProperty("arrivalPreference");
    for (const value of [null, {}, { version: "booking-widget-v1" }, createPublicBookingPriceSnapshot(base), { ...record.priceSnapshot, input: { ...pricing, arrivalPreference: { ...pricing.arrivalPreference, endLocalTime: "23:00" } } }]) {
      expect(getPublicBookingArrivalPreference(value)).toBeUndefined();
    }
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.markUnavailable).not.toHaveBeenCalled();
  });
});
