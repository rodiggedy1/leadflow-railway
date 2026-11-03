import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicBookingPricingInput } from "../shared/publicBookingPricing";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), broadcast: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "handoff-test-secret" } }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.context<Record<string, unknown>>().create();
  return { router: t.router, publicProcedure: t.procedure, bookingsAgentProcedure: t.procedure };
});
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: mocks.broadcast }));
vi.mock("./madisonKnowledgeRetrieval", () => ({ retrieveKnowledge: vi.fn() }));
vi.mock("./bookingLeadCreatedNotifications", () => ({
  sendCustomerPortalLeadCreatedCommandChatCard: vi.fn(),
  sendWidgetLeadCreatedNotifications: vi.fn(),
}));
vi.mock("./_core/customerPortalAuth", () => ({ getCustomerPortalSessionFromRequest: vi.fn() }));
vi.mock("../drizzle/schema", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, field: string) => field === "name" ? target.name : { table: name, field },
  });
  return {
    bookingFunnelRecords: table("funnel"), bookings: table("booking"),
    bookingSeries: table("series"), bookingPaymentProfiles: table("profile"),
  };
});
vi.mock("drizzle-orm", () => ({
  eq: (column: Column, value: unknown) => ({ column, value }),
  inArray: (column: Column, values: unknown[]) => ({ column, values }),
  and: (...conditions: unknown[]) => conditions,
  desc: (column: Column) => column,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

import { bookingFunnelRouter } from "./bookingFunnelRouter";
import { persistCanonicalBooking } from "./canonicalBookingPersistence";
import { ensurePublicBookingPaymentTarget, verifyPublicBookingFunnelToken } from "./bookingPaymentTargetService";
import { createBookingFunnelMutationToken } from "./bookingFunnelService";
import { buildPreparedCanonicalBooking } from "./bookingsService";
import { createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICING_VERSION } from "../shared/publicBookingPricing";
import { submitCustomerBookingLinkInputSchema } from "../shared/bookingFunnel";

// The real router, builders, HMAC helper, payment target, and persistence execute.
// Only external boundaries and the Drizzle query adapter are mocked. Transactions
// acquire the selected funnel row before taking their snapshot and hold the lock
// until commit/rollback; writes outside the transaction are recorded separately.
type Column = { table: string; field: string };
type Row = Record<string, any>;
type State = Record<string, Row[]>;
type Table = { name: string };
type Condition = { column: Column; value?: unknown; values?: unknown[] };
class MemoryDb {
  state: State = { funnel: [], booking: [], series: [], profile: [] };
  writes: Array<{ table: string; values: Row; transactional: boolean }> = [];
  locks: Array<{ table: string; id: unknown }> = [];
  failOn: string | undefined;
  beforeLock: (() => void) | undefined;
  private lockTail = Promise.resolve();
  private adapter(context?: { state?: State; release?: () => void }) {
    const db = this;
    const current = () => context ? (context.state ??= structuredClone(db.state)) : db.state;
    return {
      select(fields?: Record<string, Column>) {
        let table: Table;
        let condition: Condition;
        let locked = false;
        let count = Infinity;
        const chain = {
          from(value: Table) { table = value; return chain; },
          where(value: Condition) { condition = value; return chain; },
          limit(value: number) { count = value; return chain; },
          orderBy() { return chain; },
          for(strength: string) { expect(strength).toBe("update"); locked = true; return chain; },
          async then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) {
            try {
              if (locked) {
                expect(context).toBeDefined();
                if (!context!.release) {
                  const previous = db.lockTail;
                  db.lockTail = new Promise<void>(done => { context!.release = done; });
                  await previous;
                  db.beforeLock?.();
                  db.beforeLock = undefined;
                  context!.state = structuredClone(db.state);
                }
                db.locks.push({ table: table!.name, id: condition!.value });
              }
              let rows = current()[table!.name].filter(row => !condition || (condition.values ? condition.values.includes(row[condition.column.field]) : row[condition.column.field] === condition.value)).slice(0, count);
              if (fields) rows = rows.map(row => Object.fromEntries(Object.entries(fields).map(([key, col]) => [key, row[col.field]])));
              return resolve(structuredClone(rows));
            } catch (error) { return reject(error); }
          },
        };
        return chain;
      },
      insert(table: Table) {
        return { async values(values: Row) {
          db.writes.push({ table: table.name, values: structuredClone(values), transactional: Boolean(context) });
          if (db.failOn === table.name) throw new Error(`Injected ${table.name} failure`);
          const rows = current()[table.name];
          if (table.name === "booking" && rows.some(row => row.idempotencyKey === values.idempotencyKey)) {
            throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
          }
          const id = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
          rows.push({ id, ...structuredClone(values) });
          return [{ insertId: id }];
        } };
      },
      update(table: Table) {
        return { set(values: Row) { return { async where(condition: Condition) {
          db.writes.push({ table: table.name, values: structuredClone(values), transactional: Boolean(context) });
          if (db.failOn === table.name) throw new Error(`Injected ${table.name} failure`);
          const rows = current()[table.name].filter(row => row[condition.column.field] === condition.value);
          rows.forEach(row => Object.assign(row, structuredClone(values)));
          return [{ affectedRows: rows.length }];
        } }; } };
      },
    };
  }
  select = (fields?: Record<string, Column>) => this.adapter().select(fields);
  insert = (table: Table) => this.adapter().insert(table);
  update = (table: Table) => this.adapter().update(table);
  transaction = async (callback: (tx: ReturnType<MemoryDb["adapter"]>) => Promise<any>) => {
    const context: { state?: State; release?: () => void } = {};
    try {
      const result = await callback(this.adapter(context));
      if (context.state) this.state = context.state;
      return result;
    } finally { context.release?.(); }
  };
}

const originalUuid = "a1111111-1111-4111-8111-111111111111";
const browserUuid = "b2222222-2222-4222-8222-222222222222";
const otherBrowserUuid = "c3333333-3333-4333-8333-333333333333";
const pricing: PublicBookingPricingInput = {
  pricingMode: "home", serviceId: "deep", bedrooms: 2, bathrooms: 2,
  homeType: "House", condition: 7, maidCount: 1, hourCount: 3,
  extras: [{ id: "inside-oven", quantity: 1 }], recurrence: "one-time", customPriceCents: 32123,
};
function initialFunnel(source = "customer-booking-link"): Row {
  const snapshot = createPublicBookingPriceSnapshot(pricing);
  return {
    id: 41, publicFunnelNumber: "mib-customer-handoff", idempotencyKey: originalUuid,
    commandHash: "original-lead-command", source, stage: "lead", bookingId: null,
    bookedByAgentId: 7, bookedByAgentName: "Original Agent", customerName: "Original Customer",
    customerPhone: "+12025550123", customerEmail: null, address: null,
    serviceId: pricing.serviceId, serviceName: snapshot.serviceName, bedrooms: pricing.bedrooms,
    bathrooms: pricing.bathrooms, extras: pricing.extras, specialRequestNotes: ["Original approved note"],
    requestedLocalDate: "2027-01-10", requestedLocalTime: "09:00", requestedTimeZone: "America/New_York",
    recurrence: pricing.recurrence, pricingVersion: PUBLIC_BOOKING_PRICING_VERSION,
    firstCleaningTotalCents: snapshot.breakdown.firstCleaningTotalCents,
    futureVisitTotalCents: snapshot.breakdown.futureVisitTotalCents, priceSnapshot: snapshot,
    version: 1, createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-01"),
    stripeCustomerId: null, stripePaymentMethodId: null, paymentBrand: null, paymentLast4: null,
  };
}
function submission(overrides: Row = {}) {
  return submitCustomerBookingLinkInputSchema.parse({
    token: "mib-customer-handoff", idempotencyKey: browserUuid,
    customerName: "  Submitted   Customer  ", customerPhone: "202-555-0123",
    customerEmail: "CUSTOMER@example.com", address: " 123   Main Street ",
    requestedLocalDate: "2027-02-15", requestedLocalTime: "14:30", recurrence: "weekly" as const,
    pricing: { ...pricing, serviceId: "standard", customPriceCents: 1, extras: [] },
    additionalServices: [], ...overrides,
  });
}
const caller = () => bookingFunnelRouter.createCaller({});
const token = () => createBookingFunnelMutationToken("handoff-test-secret", "mib-customer-handoff", originalUuid);
function prepared() {
  const input = submission();
  const approvedPricing = { ...pricing, recurrence: input.recurrence };
  const snapshot = createPublicBookingPriceSnapshot(approvedPricing);
  const built = buildPreparedCanonicalBooking({
    idempotencyKey: originalUuid, surface: "full_page",
    customer: { fullName: input.customerName, phone: input.customerPhone, email: input.customerEmail },
    service: { serviceId: pricing.serviceId, bedrooms: pricing.bedrooms, bathrooms: pricing.bathrooms, extras: [...pricing.extras], specialRequestNotes: [] },
    address: input.address, requestedSchedule: { localDate: input.requestedLocalDate, localTime: input.requestedLocalTime },
    recurrence: input.recurrence, pricing: approvedPricing,
    acceptedPricing: { version: PUBLIC_BOOKING_PRICING_VERSION, totalCents: snapshot.breakdown.firstCleaningTotalCents },
  }, { nowMs: Date.now(), timeZone: "America/New_York" });
  if (built.type !== "ready") throw new Error("Expected prepared fixture");
  return built.prepared;
}
let db: MemoryDb;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-11-03T14:00:00Z").getTime());
  db = new MemoryDb();
  db.state.funnel = [initialFunnel()];
  mocks.getDb.mockResolvedValue(db);
});
afterEach(() => vi.restoreAllMocks());

describe("personalized booking payment handoff", () => {
  it("fills initially missing email/address and atomically syncs the approved complete snapshot to the same funnel", async () => {
    const original = structuredClone(db.state.funnel[0]);
    const result = await caller().submitCustomerLink(submission());
    expect(result).toMatchObject({ bookingId: 1, created: true });
    const funnel = db.state.funnel[0];
    const booking = db.state.booking[0];
    for (const field of ["customerName", "customerPhone", "customerEmail", "address", "serviceId", "serviceName", "bedrooms", "bathrooms", "specialRequestNotes", "requestedLocalDate", "requestedLocalTime", "requestedTimeZone", "recurrence", "pricingVersion", "firstCleaningTotalCents", "futureVisitTotalCents", "priceSnapshot"]) {
      expect(funnel[field]).toEqual(booking[field]);
    }
    expect(funnel).toMatchObject({ customerEmail: "customer@example.com", address: "123 Main Street", stage: "payment_incomplete", bookingId: 1 });
    expect(funnel.extras).toEqual(pricing.extras);
    expect(booking).toMatchObject({ source: "full_page", status: "pending_payment", paymentMethod: "card", idempotencyKey: originalUuid });
    for (const field of ["id", "publicFunnelNumber", "idempotencyKey", "commandHash", "source", "bookedByAgentId", "bookedByAgentName", "createdAt", "version"]) expect(funnel[field]).toEqual(original[field]);
    expect(db.state.profile).toHaveLength(1);
    expect(db.locks[0]).toEqual({ table: "funnel", id: 41 });
    expect(db.writes.every(write => write.transactional)).toBe(true);
    expect(db.writes.filter(write => write.table === "funnel")).toHaveLength(1);
    expect(() => verifyPublicBookingFunnelToken(funnel as any, token())).not.toThrow();
    const target = await ensurePublicBookingPaymentTarget(funnel as any);
    expect(target).toMatchObject({ bookingId: 1, totalCents: 32123, customerName: "Submitted Customer" });
    expect(db.state.booking).toHaveLength(1);
  });

  it("ignores tampered browser pricing and customPrice while rebuilding initial and incomplete retry quotes", async () => {
    await caller().submitCustomerLink(submission());
    await caller().submitCustomerLink(submission({ idempotencyKey: otherBrowserUuid, recurrence: "monthly", pricing: { ...pricing, customPriceCents: 999999, bedrooms: 7 } }));
    const expected = createPublicBookingPriceSnapshot({ ...pricing, recurrence: "monthly" });
    expect(db.state.booking[0]).toMatchObject({ serviceId: "deep", bedrooms: 2, firstCleaningTotalCents: 32123, futureVisitTotalCents: expected.breakdown.futureVisitTotalCents });
    expect(db.state.funnel[0].priceSnapshot).toEqual(expected);
  });

  it("uses the current locked server quote rather than the earlier route-read snapshot", async () => {
    db.beforeLock = () => {
      db.state.funnel[0].priceSnapshot = createPublicBookingPriceSnapshot({ ...pricing, customPriceCents: 45678 });
    };
    await caller().submitCustomerLink(submission());
    expect(db.state.booking[0].firstCleaningTotalCents).toBe(45678);
    expect(db.state.funnel[0].priceSnapshot.input.customPriceCents).toBe(45678);
  });

  it("revalidates incomplete retries and leaves all persisted rows untouched for invalid phone or past schedule", async () => {
    await caller().submitCustomerLink(submission());
    const before = structuredClone(db.state);
    const count = db.writes.length;
    await expect(caller().submitCustomerLink(submission({ customerPhone: "1234567" }))).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Enter a valid US phone number." });
    await expect(caller().submitCustomerLink(submission({ requestedLocalDate: "2026-01-01" }))).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Requested time must be in the future." });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it("updates schedule and recurrence on incomplete replay without changing an existing stored native UUID", async () => {
    await caller().submitCustomerLink(submission());
    db.state.booking[0].idempotencyKey = browserUuid;
    const publicNumber = db.state.booking[0].publicBookingNumber;
    const result = await caller().submitCustomerLink(submission({ idempotencyKey: otherBrowserUuid, requestedLocalDate: "2027-03-01", requestedLocalTime: "11:45", recurrence: "biweekly" }));
    expect(result).toMatchObject({ bookingId: 1, created: false, publicBookingNumber: publicNumber });
    expect(db.state.booking[0]).toMatchObject({ idempotencyKey: browserUuid, requestedLocalDate: "2027-03-01", requestedLocalTime: "11:45", recurrence: "biweekly" });
    expect(db.state.funnel[0]).toMatchObject({ idempotencyKey: originalUuid, requestedLocalDate: "2027-03-01", requestedLocalTime: "11:45", recurrence: "biweekly" });
    expect(db.state.series[0]).toMatchObject({ frequency: "biweekly", anchorLocalDate: "2027-03-01", anchorLocalTime: "11:45" });
  });

  it("repeated and concurrent submits with different browser UUIDs create one native booking and one same-funnel profile", async () => {
    const results = await Promise.all([
      caller().submitCustomerLink(submission()),
      caller().submitCustomerLink(submission({ idempotencyKey: otherBrowserUuid })),
      caller().submitCustomerLink(submission({ idempotencyKey: originalUuid })),
    ]);
    const replay = await caller().submitCustomerLink(submission({ idempotencyKey: otherBrowserUuid }));
    expect(results.map(result => result.bookingId)).toEqual([1, 1, 1]);
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(replay.created).toBe(false);
    expect(db.state.booking).toHaveLength(1);
    expect(db.state.funnel).toHaveLength(1);
    expect(db.state.profile).toHaveLength(1);
    expect(db.state.profile[0]).toMatchObject({ bookingId: 1, funnelRecordId: 41 });
    expect(db.state.booking[0].idempotencyKey).toBe(originalUuid);
    expect(db.locks.filter(lock => lock.table === "funnel")).toHaveLength(4);
  });

  it("returns completed replay before quote rebuilding or any writes", async () => {
    await caller().submitCustomerLink(submission());
    db.state.funnel[0].stage = "booked";
    db.state.funnel[0].priceSnapshot = null;
    const before = structuredClone(db.state);
    const count = db.writes.length;
    await expect(caller().submitCustomerLink(submission({ customerPhone: "1234567", requestedLocalDate: "2020-01-01" }))).resolves.toEqual({ bookingId: 1, publicBookingNumber: null, created: false });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it("rechecks completion after acquiring the funnel lock and performs no writes for a stale incomplete read", async () => {
    await caller().submitCustomerLink(submission());
    const count = db.writes.length;
    db.beforeLock = () => { db.state.funnel[0].stage = "booked"; db.state.booking[0].paymentStatus = "captured"; };
    const result = await caller().submitCustomerLink(submission({ recurrence: "monthly" }));
    expect(result).toMatchObject({ bookingId: 1, created: false });
    expect(db.writes).toHaveLength(count);
    expect(db.state.funnel[0].stage).toBe("booked");
    expect(db.state.booking[0].paymentStatus).toBe("captured");
  });

  it("rejects cancellation observed under the lock after a stale available route read", async () => {
    db.beforeLock = () => { db.state.funnel[0].stage = "cancelled"; };
    await expect(caller().submitCustomerLink(submission())).rejects.toThrow("no longer available");
    expect(db.writes).toHaveLength(0);
    expect(db.state.booking).toHaveLength(0);
  });

  it.each(["cancelled", "unavailable"])("rejects %s funnels without writing", async stage => {
    db.state.funnel[0].stage = stage;
    await expect(caller().submitCustomerLink(submission())).rejects.toThrow(stage === "cancelled" ? "no longer available" : "no longer be changed");
    expect(db.writes).toHaveLength(0);
  });

  it.each(["funnel", "series", "profile"])("rolls back native and funnel changes if the %s write fails", async table => {
    const before = structuredClone(db.state);
    db.failOn = table;
    await expect(caller().submitCustomerLink(submission())).rejects.toThrow(`Injected ${table} failure`);
    expect(db.state).toEqual(before);
    expect(db.writes.some(write => write.table === "booking")).toBe(true);
    expect(db.writes.every(write => write.transactional)).toBe(true);
  });

  it("rolls back an existing booking, funnel snapshot, and series together on failed retry", async () => {
    await caller().submitCustomerLink(submission());
    const before = structuredClone(db.state);
    db.failOn = "series";
    await expect(caller().submitCustomerLink(submission({ recurrence: "monthly", address: "456 Updated Street" }))).rejects.toThrow("Injected series failure");
    expect(db.state).toEqual(before);
  });

  it.each(["apple_pay", "google_pay"])("retains %s provenance and payment profile on incomplete submit and recurrence-only update", async paymentMethod => {
    await caller().submitCustomerLink(submission());
    db.state.booking[0].paymentMethod = paymentMethod;
    db.state.booking[0].paymentStatus = "card_on_file";
    Object.assign(db.state.profile[0], { paymentStatus: db.state.booking[0].paymentStatus, stripeSetupIntentId: "seti_existing", stripePaymentMethodId: "pm_existing", version: 9 });
    Object.assign(db.state.funnel[0], { stripeCustomerId: "cus_existing", stripePaymentMethodId: "pm_existing", paymentBrand: "visa", paymentLast4: "4242" });
    const profile = structuredClone(db.state.profile[0]);
    await caller().submitCustomerLink(submission({ idempotencyKey: otherBrowserUuid, recurrence: "monthly" }));
    await caller().updateCustomerLink({ token: "mib-customer-handoff", mutationToken: token(), recurrence: "biweekly" });
    expect(db.state.booking[0]).toMatchObject({ paymentMethod, paymentStatus: profile.paymentStatus });
    expect(db.state.profile[0]).toEqual(profile);
    expect(db.state.funnel[0]).toMatchObject({ stripeCustomerId: "cus_existing", stripePaymentMethodId: "pm_existing", paymentBrand: "visa", paymentLast4: "4242" });
  });

  it("keeps recurrence-only updates scoped to the latest locked contact and schedule", async () => {
    await caller().submitCustomerLink(submission());
    db.beforeLock = () => {
      for (const table of ["booking", "funnel"]) Object.assign(db.state[table][0], {
        customerName: "Concurrent Submit", customerEmail: "concurrent@example.com", address: "789 Latest Street",
        requestedLocalDate: "2027-04-05", requestedLocalTime: "16:15",
      });
    };
    const result = await caller().updateCustomerLink({ token: "mib-customer-handoff", mutationToken: token(), recurrence: "monthly" });
    expect(result).toEqual({ bookingId: 1, recurrence: "monthly" });
    for (const table of ["booking", "funnel"]) expect(db.state[table][0]).toMatchObject({ customerName: "Concurrent Submit", customerEmail: "concurrent@example.com", address: "789 Latest Street", requestedLocalDate: "2027-04-05", requestedLocalTime: "16:15", recurrence: "monthly" });
    expect(db.writes.filter(write => write.table === "funnel")).toHaveLength(2);
  });

  it("keeps original HMAC binding and completed recurrence-update rejection", async () => {
    await caller().submitCustomerLink(submission());
    const invalid = createBookingFunnelMutationToken("handoff-test-secret", "mib-customer-handoff", browserUuid);
    await expect(caller().updateCustomerLink({ token: "mib-customer-handoff", mutationToken: invalid, recurrence: "monthly" })).rejects.toThrow("Booking record not found");
    const count = db.writes.length;
    db.beforeLock = () => { db.state.funnel[0].stage = "booked"; };
    await expect(caller().updateCustomerLink({ token: "mib-customer-handoff", mutationToken: token(), recurrence: "monthly" })).rejects.toThrow("no longer be changed");
    expect(db.writes).toHaveLength(count);
  });

  it.each(["book-page", "customer-booking-link", "madison-quote", "widget-popup"])("maps %s to its explicit existing payment preparation surface", async source => {
    db.state.funnel = [{ ...initialFunnel(source), stage: "payment_incomplete", customerEmail: "customer@example.com", address: "123 Main Street" }];
    const target = await ensurePublicBookingPaymentTarget(db.state.funnel[0] as any);
    expect(target.bookingId).toBe(1);
    expect(db.state.booking[0].source).toBe(source === "widget-popup" ? "popup" : "full_page");
    expect(db.locks).toHaveLength(["customer-booking-link", "madison-quote"].includes(source) ? 1 : 0);
  });

  it.each(["lead", "payment_incomplete", "booked"])("never resurrects a cancelled native booking behind a %s funnel", async stage => {
    await caller().submitCustomerLink(submission());
    db.state.funnel[0].stage = stage;
    db.state.booking[0].status = "cancelled";
    db.state.series[0].status = "cancelled";
    const before = structuredClone(db.state);
    const count = db.writes.length;
    await expect(caller().submitCustomerLink(submission())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ensurePublicBookingPaymentTarget(db.state.funnel[0] as any)).rejects.toMatchObject({ code: "NOT_FOUND" });
    if (stage === "payment_incomplete") await expect(caller().updateCustomerLink({ token: "mib-customer-handoff", mutationToken: token(), recurrence: "monthly" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it.each(["completed", "expired"])("rejects native %s before any incomplete-funnel write", async status => {
    await caller().submitCustomerLink(submission());
    db.state.booking[0].status = status;
    const before = structuredClone(db.state);
    const count = db.writes.length;
    await expect(caller().submitCustomerLink(submission())).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(ensurePublicBookingPaymentTarget(db.state.funnel[0] as any)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it.each([
    ["confirmed", { status: "confirmed" }, {}],
    ["assigned native status", { status: "assigned" }, {}],
    ["assigned", { assignmentStatus: "assigned" }, {}],
    ["approved availability", { availabilityStatus: "approved" }, {}],
    ["unavailable availability", { availabilityStatus: "unavailable" }, {}],
    ["active native intent", { recurringIntentStatus: "active" }, {}],
    ["active series", {}, { status: "active" }],
    ["paused series", {}, { status: "paused" }],
    ["cancelled series", {}, { status: "cancelled" }],
  ])("preserves %s on identical retry and fails closed for changed details or recurrence", async (_label, bookingPatch, seriesPatch) => {
    await caller().submitCustomerLink(submission());
    Object.assign(db.state.booking[0], bookingPatch);
    Object.assign(db.state.series[0], seriesPatch);
    const before = structuredClone(db.state);
    const count = db.writes.length;
    await expect(caller().submitCustomerLink(submission({ idempotencyKey: otherBrowserUuid }))).resolves.toMatchObject({ bookingId: 1, created: false });
    await expect(caller().submitCustomerLink(submission({ address: "456 Unsafe Reschedule Street" }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller().updateCustomerLink({ token: "mib-customer-handoff", mutationToken: token(), recurrence: "monthly" })).rejects.toMatchObject({ code: "CONFLICT" });
    const target = await ensurePublicBookingPaymentTarget(db.state.funnel[0] as any);
    expect(target).toMatchObject({ bookingId: 1, totalCents: before.booking[0].firstCleaningTotalCents });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it("allows ordinary pending detail retry without rewinding needs_attention or reassigning identity", async () => {
    await caller().submitCustomerLink(submission());
    db.state.booking[0].status = "needs_attention";
    const identity = { id: 1, publicBookingNumber: db.state.booking[0].publicBookingNumber, idempotencyKey: db.state.booking[0].idempotencyKey };
    await caller().submitCustomerLink(submission({ address: "789 Retried Street", requestedLocalTime: "15:45" }));
    expect(db.state.booking[0]).toMatchObject({ ...identity, status: "needs_attention", availabilityStatus: "requested", assignmentStatus: "unassigned", address: "789 Retried Street", requestedLocalTime: "15:45", homeType: "House" });
    expect(db.state.funnel[0]).toMatchObject({ address: "789 Retried Street", requestedLocalTime: "15:45" });
    expect(db.state.profile).toHaveLength(1);
  });

  it.each(["authorized", "captured", "charge_pending", "paid"])("preserves %s provenance and blocks changed payment-bound details", async status => {
    await caller().submitCustomerLink(submission());
    Object.assign(db.state.booking[0], { paymentMethod: status === "charge_pending" || status === "paid" ? "cashapp" : "card", paymentStatus: status });
    Object.assign(db.state.profile[0], { paymentStatus: status, stripePaymentIntentId: "pi_existing", stripeCustomerId: "cus_existing", stripePaymentMethodId: "pm_existing", version: 9 });
    const before = structuredClone(db.state);
    const count = db.writes.length;
    await expect(caller().submitCustomerLink(submission())).resolves.toMatchObject({ bookingId: 1, created: false });
    await expect(caller().submitCustomerLink(submission({ customerName: "Unsafe New Payer", address: "Unsafe New Address" }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller().updateCustomerLink({ token: "mib-customer-handoff", mutationToken: token(), recurrence: "monthly" })).rejects.toMatchObject({ code: "CONFLICT" });
    db.beforeLock = () => { db.state.funnel[0].priceSnapshot = createPublicBookingPriceSnapshot({ ...pricing, recurrence: "weekly", customPriceCents: 45678 }); };
    await expect(caller().submitCustomerLink(submission())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state.booking).toEqual(before.booking);
    expect(db.state.profile).toEqual(before.profile);
    expect(db.state.series).toEqual(before.series);
    expect(db.writes).toHaveLength(count);
    if (status === "charge_pending") {
      const target = await ensurePublicBookingPaymentTarget(db.state.funnel[0] as any);
      expect(target.profile).toEqual(before.profile[0]);
      expect(target.totalCents).toBe(before.booking[0].firstCleaningTotalCents);
    } else await expect(ensurePublicBookingPaymentTarget(db.state.funnel[0] as any)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.writes).toHaveLength(count);
  });

  it.each(["authorized", "captured", "charge_pending"])("uses the locked profile's %s state even if the native payment status is stale", async paymentStatus => {
    await caller().submitCustomerLink(submission());
    db.beforeLock = () => { db.state.profile[0].paymentStatus = paymentStatus; };
    const count = db.writes.length;
    await expect(caller().submitCustomerLink(submission({ recurrence: "monthly" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.writes).toHaveLength(count);
    expect(db.state.booking[0].recurrence).toBe("weekly");
    expect(db.state.profile[0].paymentStatus).toBe(paymentStatus);
  });

  it("blocks a payer identity change while secure setup or saved credentials exist", async () => {
    await caller().submitCustomerLink(submission());
    Object.assign(db.state.profile[0], { paymentStatus: "setup_pending", stripeSetupIntentId: "seti_existing" });
    const before = structuredClone(db.state);
    const count = db.writes.length;
    await expect(caller().submitCustomerLink(submission({ customerPhone: "2025550199" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it.each(["customer-booking-link", "madison-quote"])("rebuilds only the latest locked %s snapshot when no native target exists", async source => {
    db.state.funnel = [{ ...initialFunnel(source), stage: "payment_incomplete", customerEmail: "customer@example.com", address: "123 Main Street" }];
    const stale = structuredClone(db.state.funnel[0]);
    db.beforeLock = () => {
      const snapshot = createPublicBookingPriceSnapshot({ ...pricing, customPriceCents: 45678 });
      Object.assign(db.state.funnel[0], { customerName: "Latest Approved Customer", requestedLocalDate: "2027-04-01", priceSnapshot: snapshot, firstCleaningTotalCents: snapshot.breakdown.firstCleaningTotalCents });
    };
    const target = await ensurePublicBookingPaymentTarget(stale as any);
    expect(target).toMatchObject({ bookingId: 1, totalCents: 45678, customerName: "Latest Approved Customer" });
    expect(db.state.booking[0]).toMatchObject({ firstCleaningTotalCents: 45678, requestedLocalDate: "2027-04-01", customerName: "Latest Approved Customer" });
    expect(db.state.profile).toHaveLength(1);
    expect(db.locks[0]).toEqual({ table: "funnel", id: 41 });
    expect(db.writes.every(write => write.transactional)).toBe(true);
  });

  it("returns the newer exact native target rather than repersisting an earlier handoff snapshot", async () => {
    await caller().submitCustomerLink(submission());
    const stale = structuredClone(db.state.funnel[0]);
    await caller().submitCustomerLink(submission({ customerName: "Newer Submitted Customer", address: "Newer Street", requestedLocalTime: "17:15", recurrence: "monthly" }));
    const before = structuredClone(db.state);
    const count = db.writes.length;
    const target = await ensurePublicBookingPaymentTarget(stale as any);
    expect(target).toMatchObject({ bookingId: 1, customerName: "Newer Submitted Customer", totalCents: before.booking[0].firstCleaningTotalCents, profile: before.profile[0] });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it.each([false, true])("returns the existing successful card target after completion (stale read: %s) with no reset or rebuild", async staleRead => {
    await caller().submitCustomerLink(submission());
    const stale = structuredClone(db.state.funnel[0]);
    Object.assign(db.state.funnel[0], { stage: "booked", priceSnapshot: null, customerEmail: null });
    Object.assign(db.state.booking[0], { status: "confirmed", assignmentStatus: "assigned", availabilityStatus: "confirmed", paymentStatus: "card_on_file" });
    Object.assign(db.state.profile[0], { paymentStatus: "card_on_file", stripePaymentMethodId: "pm_saved", cardBrand: "visa", cardLast4: "4242" });
    db.state.series[0].status = "active";
    const before = structuredClone(db.state);
    const count = db.writes.length;
    const target = await ensurePublicBookingPaymentTarget((staleRead ? stale : db.state.funnel[0]) as any);
    expect(target).toMatchObject({ bookingId: 1, profile: before.profile[0], totalCents: before.booking[0].firstCleaningTotalCents, customerName: before.booking[0].customerName });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it.each(["funnel", "native"])("rejects a stale target after %s cancellation before any writes", async boundary => {
    await caller().submitCustomerLink(submission());
    const stale = structuredClone(db.state.funnel[0]);
    const count = db.writes.length;
    db.beforeLock = () => { if (boundary === "funnel") db.state.funnel[0].stage = "cancelled"; else db.state.booking[0].status = "cancelled"; };
    await expect(ensurePublicBookingPaymentTarget(stale as any)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.writes).toHaveLength(count);
  });

  it("rejects a changed exact funnel identity instead of using a stale payment capability", async () => {
    await caller().submitCustomerLink(submission());
    const stale = structuredClone(db.state.funnel[0]);
    const count = db.writes.length;
    db.beforeLock = () => { db.state.funnel[0].idempotencyKey = otherBrowserUuid; };
    await expect(ensurePublicBookingPaymentTarget(stale as any)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.writes).toHaveLength(count);
  });

  it.each(["missing booking", "foreign profile", "missing profile"])("fails closed for a personalized %s target without repairing unrelated data", async state => {
    await caller().submitCustomerLink(submission());
    if (state === "missing booking") db.state.booking = [];
    if (state === "foreign profile") db.state.profile[0].funnelRecordId = 99;
    if (state === "missing profile") db.state.profile = [];
    const before = structuredClone(db.state);
    const count = db.writes.length;
    await expect(ensurePublicBookingPaymentTarget(db.state.funnel[0] as any)).rejects.toMatchObject({ code: state === "missing booking" ? "NOT_FOUND" : "CONFLICT" });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it("reports invalid scoped payment-target phone as BAD_REQUEST and writes nothing", async () => {
    db.state.funnel = [{ ...initialFunnel(), stage: "payment_incomplete", customerPhone: "1234567", customerEmail: "customer@example.com", address: "123 Main Street" }];
    await expect(ensurePublicBookingPaymentTarget(db.state.funnel[0] as any)).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Enter a valid US phone number." });
    expect(db.writes).toHaveLength(0);
  });

  it.each(["customer-booking-link", "madison-quote"])("serializes completed %s native detail/payment truth without exposing private identity or payment IDs", async source => {
    db.state.funnel[0].source = source;
    await caller().submitCustomerLink(submission());
    Object.assign(db.state.funnel[0], { stage: "booked", recurrence: "one-time", paymentBrand: "visa", paymentLast4: "4242", stripeCustomerId: "cus_private", stripePaymentMethodId: "pm_private" });
    Object.assign(db.state.booking[0], {
      customerName: "Final Native Customer", customerPhone: "+12025550199", customerEmail: "native@example.com",
      address: "Final Native Street", requestedLocalDate: "2027-05-01", requestedLocalTime: "16:15",
      serviceId: "standard", serviceName: "Standard Cleaning", bedrooms: 4, bathrooms: 3, recurrence: "monthly",
      firstCleaningTotalCents: 45678, futureVisitTotalCents: 40123, paymentMethod: "cashapp", paymentStatus: "captured",
      companyNotes: "Internal private company note", stripePaymentIntentId: "pi_private",
    });
    const before = structuredClone(db.state);
    const count = db.writes.length;
    const result = await caller().getCustomerLink({ token: "mib-customer-handoff" });
    expect(result).toMatchObject({
      customerName: "Final Native Customer", customerPhone: "+12025550199", customerEmail: "native@example.com",
      address: "Final Native Street", requestedLocalDate: "2027-05-01", requestedLocalTime: "16:15",
      serviceId: "standard", serviceName: "Standard Cleaning", bedrooms: 4, bathrooms: 3, recurrence: "monthly",
      firstCleaningTotalCents: 45678, futureVisitTotalCents: 40123, paymentMethod: "cashapp", paymentStatus: "captured",
      stage: "booked", bookingId: 1, paymentBrand: "visa", paymentLast4: "4242", mutationToken: token(),
    });
    for (const field of ["idempotencyKey", "commandHash", "stripeCustomerId", "stripePaymentMethodId", "stripePaymentIntentId", "stripeSetupIntentId", "companyNotes", "bookedByAgentId", "bookedByAgentName"]) expect(result).not.toHaveProperty(field);
    const serialized = JSON.stringify(result);
    for (const privateValue of [originalUuid, "cus_private", "pm_private", "pi_private", "Internal private company note"]) expect(serialized).not.toContain(privateValue);
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it("leaves incomplete link display details on the quote while projecting exact native payment state", async () => {
    await caller().submitCustomerLink(submission());
    Object.assign(db.state.booking[0], { customerName: "Native Only Customer", recurrence: "monthly", paymentMethod: "cashapp", paymentStatus: "charge_pending" });
    const count = db.writes.length;
    const result = await caller().getCustomerLink({ token: "mib-customer-handoff" });
    expect(result).toMatchObject({ customerName: "Submitted Customer", recurrence: "weekly", paymentMethod: "cashapp", paymentStatus: "charge_pending" });
    expect(db.writes).toHaveLength(count);
  });

  it.each(["payment_incomplete", "booked"])("rejects a read of cancelled native behind %s without writes", async stage => {
    await caller().submitCustomerLink(submission());
    db.state.funnel[0].stage = stage;
    db.state.booking[0].status = "cancelled";
    const before = structuredClone(db.state);
    const count = db.writes.length;
    await expect(caller().getCustomerLink({ token: "mib-customer-handoff" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it.each(["customer-booking-link", "madison-quote"])("reads bound %s Cash App captured truth in both staff routes without borrowing unbound last4 provenance", async source => {
    db.state.funnel[0].source = source;
    await caller().submitCustomerLink(submission());
    Object.assign(db.state.booking[0], { paymentMethod: "cashapp", paymentStatus: "captured" });
    Object.assign(db.state.funnel[0], { paymentBrand: "visa", paymentLast4: "4242" });
    db.state.funnel.push({ ...initialFunnel(source), id: 42, publicFunnelNumber: "mib-unbound-quote", idempotencyKey: otherBrowserUuid, paymentBrand: "mastercard", paymentLast4: "5555" });
    const before = structuredClone(db.state);
    const count = db.writes.length;
    const list = await caller().list({ limit: 200 });
    expect(list.find(row => row.id === 41)).toMatchObject({ bookingId: 1, paymentMethod: "cashapp", paymentStatus: "captured", paymentBrand: "visa", paymentLast4: "4242" });
    expect(list.find(row => row.id === 42)).toMatchObject({ bookingId: null, paymentMethod: null, paymentStatus: null, paymentBrand: "mastercard", paymentLast4: "5555" });
    expect(await caller().get({ id: 41 })).toMatchObject({ bookingId: 1, paymentMethod: "cashapp", paymentStatus: "captured" });
    expect(await caller().get({ id: 42 })).toMatchObject({ bookingId: null, paymentMethod: null, paymentStatus: null, paymentBrand: "mastercard", paymentLast4: "5555" });
    for (const row of list) { expect(row).not.toHaveProperty("idempotencyKey"); expect(row).not.toHaveProperty("commandHash"); }
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it.each(["book-page", "widget-popup", "internal"])("leaves %s staff quote payment projection unbound rather than borrowing personalized native payments", async source => {
    await caller().submitCustomerLink(submission());
    Object.assign(db.state.booking[0], { paymentMethod: "cashapp", paymentStatus: "captured" });
    db.state.funnel[0].source = source;
    const before = structuredClone(db.state);
    const count = db.writes.length;
    expect((await caller().list({ limit: 200 }))[0]).toMatchObject({ paymentMethod: null, paymentStatus: null });
    expect(await caller().get({ id: 41 })).toMatchObject({ paymentMethod: null, paymentStatus: null });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(count);
  });

  it("leaves non-opt-in persistence locking, funnel snapshots, and paymentMethod update behavior unchanged", async () => {
    await caller().submitCustomerLink(submission());
    db.state.booking[0].paymentMethod = "cashapp";
    const funnelBefore = structuredClone(db.state.funnel[0]);
    db.locks = [];
    await persistCanonicalBooking(db as any, { ...prepared(), address: "999 Default Caller Street" }, { funnelRecordId: 41, paymentMethod: "card" });
    expect(db.state.booking[0]).toMatchObject({ paymentMethod: "card", address: "999 Default Caller Street" });
    expect(db.state.funnel[0]).toEqual(funnelBefore);
    expect(db.locks).toHaveLength(0);
  });
});
