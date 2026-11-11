import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), notify: vi.fn(), broadcast: vi.fn(), refresh: vi.fn(), stripe: { webhooks: { constructEvent: vi.fn() }, customers: { create: vi.fn(), retrieve: vi.fn() }, setupIntents: { create: vi.fn(), retrieve: vi.fn() }, paymentMethods: { retrieve: vi.fn() }, paymentIntents: { create: vi.fn(), retrieve: vi.fn(), cancel: vi.fn() } } }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./stripeClient", () => ({ getStripeClient: () => mocks.stripe }));
vi.mock("./_core/env", () => ({ ENV: { stripeWebhookSecret: "mock-only" } }));
vi.mock("./payableInvoiceRoutes", () => ({ isPayableInvoiceEvent: () => false, registerPayableInvoiceRoutes: vi.fn(), reconcilePayableInvoiceEvent: vi.fn() }));
vi.mock("./bookingCompletionNotifications", () => ({ sendBookingCompletionNotifications: mocks.notify }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: mocks.broadcast }));
vi.mock("./cleanerPortalUpdates", () => ({ broadcastCleanerPortalJobsChanged: mocks.refresh }));
vi.mock("./bookingLifecycleService", () => ({ syncNativeBookingPaymentState: vi.fn(async () => undefined) }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC, TRPCError } = await import("@trpc/server");
  const t = initTRPC.context<{ agent?: { agentId: number; agentName: string } }>().create();
  return { router: t.router, bookingsAgentProcedure: t.procedure.use(({ ctx, next }) => { if (!ctx.agent) throw new TRPCError({ code: "UNAUTHORIZED" }); return next({ ctx: { agent: ctx.agent } }); }) };
});
type Column = { table: string; field: string };
type Row = Record<string, any>;
type Table = { name: string };
vi.mock("../drizzle/schema", () => {
  const table = (name: string) => new Proxy({ name }, { get: (target, field: string) => field === "name" ? target.name : { table: name, field } });
  return { bookings: table("booking"), bookingFunnelRecords: table("funnel"), bookingPaymentProfiles: table("profile"), bookingSeries: table("series"), bookingCashAppPayments: table("cash"), stripeCustomers: table("customer"), stripeWebhookEvents: table("event"), cashAppPaymentTokens: table("cashToken"), paymentAuthorizations: table("authorization") };
});
vi.mock("drizzle-orm", () => ({ eq: (column: Column, value: unknown) => ({ column, value }), and: (...conditions: unknown[]) => conditions, desc: (column: Column) => column, sql: (_strings: unknown, column: Column) => ({ increment: column }) }));

import { internalExactBookingRouter, internalExactPrepareInputSchema } from "./internalExactBookingRouter";
import { calculatePublicBookingPrice, PUBLIC_BOOKING_PRICING_VERSION } from "../shared/publicBookingPricing";
import { finalizeCanonicalBooking, finalizeCanonicalCardOnFile, startCanonicalCardSetup } from "./bookingPaymentEngine";
import { markCashAppPaymentUnavailable, settleSucceededCashAppPayment } from "./bookingCashAppEngine";
import { lockInternalExactBooking } from "./internalExactBookingMarker";
import { registerStripeWebhookRoute } from "./stripeWebhookRoute";

class MemoryDb {
  state: Record<string, Row[]> = { booking: [], funnel: [], profile: [], series: [], cash: [], customer: [], event: [], cashToken: [], authorization: [] };
  locks: string[] = [];
  commits = 0;
  depth = 0;
  failOn: string | undefined;
  beforeLock: (() => void) | undefined;
  transaction = async (callback: (tx: any) => Promise<any>): Promise<any> => {
    const before = structuredClone(this.state);
    this.depth++;
    try { const result = await callback(this); this.commits++; return result; }
    catch (error) { this.state = before; throw error; }
    finally { this.depth--; }
  };
  matches(row: Row, condition: any): boolean { return !condition || (Array.isArray(condition) ? condition.every(c => this.matches(row, c)) : row[condition.column.field] === condition.value); }
  select = (fields?: Record<string, Column>) => {
    const db = this; let table: Table; let condition: any; let count = Infinity; let locked = false;
    const chain = {
      from(value: Table) { table = value; return chain; }, where(value: any) { condition = value; return chain; }, limit(value: number) { count = value; return chain; }, orderBy() { return chain; }, for(value: string) { expect(value).toBe("update"); locked = true; return chain; },
      async then(resolve: any, reject: any) { try {
        if (locked) { expect(db.depth).toBeGreaterThan(0); db.beforeLock?.(); db.beforeLock = undefined; db.locks.push(table.name); }
        let rows = db.state[table.name].filter(row => db.matches(row, condition)).slice(0, count);
        if (fields) rows = rows.map(row => Object.fromEntries(Object.entries(fields).map(([key, col]) => [key, row[col.field]])));
        return resolve(structuredClone(rows));
      } catch (error) { return reject(error); } },
    }; return chain;
  };
  insert = (table: Table) => {
    const db = this;
    return { values(values: Row) {
      const execute = async () => {
        if (db.failOn === table.name) throw new Error("Injected persistence failure");
        if (table.name === "booking" && db.state.booking.some(row => row.idempotencyKey === values.idempotencyKey)) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
        const defaults = table.name === "profile" ? { stripeCustomerId: null, stripeSetupIntentId: null, stripePaymentMethodId: null, stripePaymentIntentId: null, cardBrand: null, cardLast4: null, consentAcceptedAt: null, authorizedAt: null, capturedAt: null } : table.name === "booking" ? { homeType: null } : {};
        const id = db.state[table.name].length + 1;
        db.state[table.name].push({ id, ...defaults, ...structuredClone(values) }); return Object.assign([{ insertId: id }], { insertId: id });
      };
      return { then: (resolve: any, reject: any) => execute().then(resolve, reject), onDuplicateKeyUpdate: async () => execute() };
    } };
  };
  update = (table: Table) => ({ set: (values: Row) => ({ where: async (condition: any) => {
    if (this.failOn === table.name) throw new Error("Injected mutation failure");
    const rows = this.state[table.name].filter(row => this.matches(row, condition));
    rows.forEach(row => Object.entries(values).forEach(([key, value]) => { row[key] = value && typeof value === "object" && "increment" in value ? row[value.increment.field] + 1 : structuredClone(value); }));
    return [{ affectedRows: rows.length }];
  } }) });
}
let db: MemoryDb;
const agent = { agentId: 7, agentName: "Authenticated Staff" };
const caller = () => internalExactBookingRouter.createCaller({ agent });
function input(method: "card" | "cashapp" | "invoice" = "card", customPriceCents: number | undefined = 32123, recurrence: "one-time" | "weekly" | "biweekly" | "monthly" = "weekly") {
  const pricing = { pricingMode: "home" as const, serviceId: "deep" as const, bedrooms: 2, bathrooms: 2, homeType: "Condo" as const, condition: 7, maidCount: 1, hourCount: 3, extras: [{ id: "inside-oven", quantity: 1 }], recurrence, ...(customPriceCents === undefined ? {} : { customPriceCents }), arrivalPreference: { mode: "flexible" as const, startLocalTime: "08:30", endLocalTime: "17:00" } };
  return { idempotencyKey: "a1111111-1111-4111-8111-111111111111", paymentMethod: method, withoutPayment: method === "invoice", companyNotes: null,
    booking: { surface: "popup" as const, customer: { fullName: "Test Customer", phone: "202-555-0123", email: "test@example.com" }, service: { serviceId: pricing.serviceId, bedrooms: 2, bathrooms: 2, extras: pricing.extras, specialRequestNotes: [] }, address: "123 Main Street", requestedSchedule: { localDate: "2037-02-15", localTime: "08:30" }, recurrence, acceptedPricing: { version: PUBLIC_BOOKING_PRICING_VERSION, totalCents: calculatePublicBookingPrice(pricing).firstCleaningTotalCents }, pricing } };
}
function intent(id = "pi_cash", status = "succeeded") { return { id, status, amount: db.state.booking[0].firstCleaningTotalCents, currency: "usd", payment_method: "pm_cash", client_secret: "pi_secret", metadata: { bookingId: "1", bookingPaymentProfileId: "1", operation: "cash_app_first_cleaning", paymentMethod: "cashapp", internalExactForm: "1" } }; }
async function savedCard() {
  await caller().prepare(input()); await caller().startSetup({ bookingId: 1 });
  await caller().confirmSetup({ bookingId: 1, paymentMethodId: "pm_card", consentAccepted: true, deferConfirmation: true });
}
beforeEach(() => {
  vi.clearAllMocks(); db = new MemoryDb(); mocks.getDb.mockResolvedValue(db);
  mocks.notify.mockImplementation(async () => { expect(db.depth).toBe(0); });
  mocks.stripe.customers.create.mockResolvedValue({ id: "cus_staff" }); mocks.stripe.customers.retrieve.mockResolvedValue({ id: "cus_staff" });
  mocks.stripe.setupIntents.create.mockResolvedValue({ id: "seti_staff", client_secret: "seti_secret" });
  mocks.stripe.setupIntents.retrieve.mockResolvedValue({ id: "seti_staff", status: "succeeded", customer: "cus_staff", payment_method: "pm_card", metadata: { bookingId: "1", bookingPaymentProfileId: "1" } });
  mocks.stripe.paymentMethods.retrieve.mockImplementation(async id => id === "pm_cash" ? { id, type: "cashapp" } : { id, type: "card", customer: "cus_staff", card: { brand: "visa", last4: "4242", exp_month: 1, exp_year: 2040 } });
  mocks.stripe.paymentIntents.create.mockImplementation(async () => intent("pi_cash", "requires_action"));
  mocks.stripe.paymentIntents.retrieve.mockImplementation(async () => intent()); mocks.stripe.paymentIntents.cancel.mockImplementation(async () => intent("pi_cash", "canceled"));
});

describe("staff exact native preparation", () => {
  it("authenticates every operation and requires strict arrival and correct initial mode", async () => {
    const noAgent = internalExactBookingRouter.createCaller({});
    await expect(noAgent.prepare(input())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const operation of ["startSetup", "finalize", "prepareCashApp"] as const) await expect(noAgent[operation]({ bookingId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const operation of ["settleCashApp", "abandonCashApp"] as const) await expect(noAgent[operation]({ bookingId: 1, paymentIntentId: "pi_x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(noAgent.confirmSetup({ bookingId: 1, paymentMethodId: "pm_x", consentAccepted: true, deferConfirmation: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const missing = input() as any; delete missing.booking.pricing.arrivalPreference;
    expect(internalExactPrepareInputSchema.safeParse(missing).success).toBe(false);
    expect(internalExactPrepareInputSchema.safeParse({ ...input(), withoutPayment: true }).success).toBe(false);
    expect(internalExactPrepareInputSchema.safeParse({ ...input(), additionalServices: [] }).success).toBe(false);
  });
  it.each(["card", "cashapp"] as const)("creates native/funnel/profile/series once for %s, exact amount and attribution, no completion notification", async method => {
    const result = await caller().prepare(input(method));
    expect(result).toMatchObject({ bookingId: 1, stage: "payment_incomplete", paymentStatus: "not_started", totalCents: 32123, created: true, unpaid: false });
    expect(db.state.booking[0]).toMatchObject({ homeType: "Condo", source: "popup", status: "pending_payment", paymentMethod: method, bookedByAgentId: 7, bookedByAgentName: agent.agentName });
    expect(db.state.funnel[0]).toMatchObject({ source: "internal", bookingId: 1, stage: "payment_incomplete" });
    expect(db.state.profile[0]).toMatchObject({ bookingId: 1, funnelRecordId: 1, paymentStatus: "not_started" });
    expect(db.state.series[0].firstCleaningTotalCents).toBe(32123);
    expect(db.state.funnel[0].priceSnapshot).toEqual(db.state.booking[0].priceSnapshot);
    expect(db.state.booking[0].priceSnapshot.input.internalExactForm).toBeUndefined();
    expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.stripe.setupIntents.create).not.toHaveBeenCalled(); expect(mocks.stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it("completes invoice explicitly unpaid without any card/Cash App/provider call, with effects after commit", async () => {
    expect(await caller().prepare(input("invoice"))).toMatchObject({ unpaid: true, stage: "booked", paymentStatus: "not_started" });
    expect(db.state.booking[0]).toMatchObject({ status: "needs_attention", paymentMethod: "invoice", paymentStatus: "not_started" });
    expect(db.state.profile[0].paymentStatus).toBe("not_started"); expect(mocks.notify).toHaveBeenCalledTimes(1);
    await expect(caller().finalize({ bookingId: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller().startSetup({ bookingId: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller().prepareCashApp({ bookingId: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    for (const group of Object.values(mocks.stripe)) for (const fn of Object.values(group)) expect(fn).not.toHaveBeenCalled();
  });
  it.each([1, 32123, 1_000_000])("keeps final-first cents %i across native/funnel/snapshot/series and future total unchanged", async cents => {
    const draft = input("card", cents); const base = calculatePublicBookingPrice({ ...draft.booking.pricing, customPriceCents: undefined });
    await caller().prepare(draft);
    const booking = db.state.booking[0]; expect(booking.firstCleaningTotalCents).toBe(cents); expect(booking.priceSnapshot.breakdown.firstCleaningTotalCents).toBe(cents);
    expect(booking.priceSnapshot.breakdown.arrivalDiscountCents).toBe(0); expect(booking.futureVisitTotalCents).toBe(base.futureVisitTotalCents);
    expect(db.state.funnel[0].firstCleaningTotalCents).toBe(cents); expect(db.state.series[0].firstCleaningTotalCents).toBe(cents);
  });
  it.each([0, -1, 1_000_001, 1.5])("rejects invalid override %s", value => { const draft = input(); draft.booking.pricing.customPriceCents = value; expect(internalExactPrepareInputSchema.safeParse(draft).success).toBe(false); });
  it("preserves public no-override arrival discount and no recurring series for one time", async () => {
    const draft = input("card", undefined, "one-time"); delete draft.booking.pricing.customPriceCents; draft.booking.acceptedPricing.totalCents = calculatePublicBookingPrice(draft.booking.pricing).firstCleaningTotalCents;
    const result = await caller().prepare(draft); expect(result.totalCents).toBe(draft.booking.acceptedPricing.totalCents);
    expect(db.state.booking[0].priceSnapshot.breakdown.arrivalDiscountPercent).toBe(10); expect(db.state.series).toHaveLength(0);
  });
  it("rolls back all native/funnel/profile/series writes and effects on failure", async () => {
    db.failOn = "profile"; await expect(caller().prepare(input("invoice"))).rejects.toThrow("Injected");
    expect(Object.values(db.state).every(rows => rows.length === 0)).toBe(true); expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("replays stored totals/stage without duplicate writes or effects and rejects changes to mode/details/creator/snapshot", async () => {
    const first = await caller().prepare(input()); const before = structuredClone(db.state);
    expect(await caller().prepare(input())).toMatchObject({ ...first, created: false }); expect(db.state).toEqual(before); expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await expect(caller().prepare(input("invoice"))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller().prepare({ ...input(), companyNotes: "changed" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(internalExactBookingRouter.createCaller({ agent: { agentId: 8, agentName: "Other" } }).prepare(input())).rejects.toMatchObject({ code: "CONFLICT" });
    db.state.booking[0].priceSnapshot.breakdown.firstCleaningTotalCents++;
    await expect(caller().prepare(input())).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("real canonical card setup/deferred confirmation/finalization", () => {
  it("saves verified card with consent deferred, then finalizes once with after-commit effects", async () => {
    await savedCard(); expect(db.state.booking[0]).toMatchObject({ status: "pending_payment", paymentStatus: "card_on_file" });
    expect(db.state.funnel[0].stage).toBe("payment_incomplete"); expect(db.state.profile[0].consentAcceptedAt).toBeTruthy(); expect(mocks.notify).not.toHaveBeenCalled();
    await caller().finalize({ bookingId: 1 }); expect(db.state.booking[0].status).toBe("needs_attention"); expect(db.state.funnel[0].stage).toBe("booked"); expect(mocks.notify).toHaveBeenCalledTimes(1);
    await caller().finalize({ bookingId: 1 }); expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(await caller().startSetup({ bookingId: 1 })).toMatchObject({ alreadyComplete: true, clientSecret: null, portalAccessCode: null, directPortalSessionReady: false });
    expect(db.locks).toEqual(expect.arrayContaining(["booking", "profile", "funnel", "series"]));
  });
  it("requires explicit deferred consent and rejects wrong provider wallet/customer/native metadata", async () => {
    await caller().prepare(input()); await caller().startSetup({ bookingId: 1 });
    await expect(caller().confirmSetup({ bookingId: 1, paymentMethodId: "pm_card", consentAccepted: false, deferConfirmation: true } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().confirmSetup({ bookingId: 1, paymentMethodId: "pm_card", consentAccepted: true, deferConfirmation: false } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().confirmSetup({ bookingId: 1, paymentMethodId: "pm_card", consentAccepted: true, deferConfirmation: true, wallet: "apple_pay" })).rejects.toMatchObject({ code: "CONFLICT" });
    mocks.stripe.setupIntents.retrieve.mockResolvedValueOnce({ status: "succeeded", customer: "cus_staff", payment_method: "pm_card", metadata: { bookingId: "2", bookingPaymentProfileId: "1" } });
    await expect(caller().confirmSetup({ bookingId: 1, paymentMethodId: "pm_card", consentAccepted: true, deferConfirmation: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state.profile[0].paymentStatus).toBe("setup_pending"); expect(mocks.notify).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "completed", "expired"])("rejects late %s mutations inside the finalizer transaction", async status => {
    await savedCard(); const before = structuredClone(db.state); db.beforeLock = () => { db.state.booking[0].status = status; };
    await expect(finalizeCanonicalBooking(db as any, { bookingId: 1, funnelId: 1, internalExact: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state).toEqual(before); expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("rejects profile/funnel binding tampering and operational assignment, never finalizes an unverified profile", async () => {
    await caller().prepare(input()); await expect(finalizeCanonicalBooking(db as any, { bookingId: 1, funnelId: 1, internalExact: true })).rejects.toMatchObject({ code: "CONFLICT" });
    db.state.profile[0].funnelRecordId = 9; await expect(caller().startSetup({ bookingId: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    db.state.profile[0].funnelRecordId = 1; db.state.booking[0].assignmentStatus = "assigned"; await expect(caller().startSetup({ bookingId: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.stripe.setupIntents.create).not.toHaveBeenCalled();
  });
  it("rejects cancellation after provider preparation at the engine's actual transaction", async () => {
    await caller().prepare(input()); const profile = structuredClone(db.state.profile[0]);
    mocks.stripe.setupIntents.create.mockImplementation(async () => { db.state.booking[0].status = "cancelled"; return { id: "seti_staff", client_secret: "secret" }; });
    await expect(startCanonicalCardSetup(db as any, { bookingId: 1, customerName: "Test Customer", profile: profile as any, internalExact: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state.booking[0].status).toBe("cancelled"); expect(db.state.profile[0].stripeSetupIntentId).toBeNull(); expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe("real Cash App checkout, settlement, return/webhook safety", () => {
  it("returns real engine checkout/opaque token, exact cents, and settles once with captured state after commit", async () => {
    await caller().prepare(input("cashapp")); const checkout = await caller().prepareCashApp({ bookingId: 1 });
    expect(checkout).toMatchObject({ bookingId: 1, paymentIntentId: "pi_cash", clientSecret: "pi_secret", totalCents: 32123 }); expect(checkout.returnToken).toMatch(/^[a-f0-9-]{36}$/);
    expect(mocks.stripe.paymentIntents.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 32123, payment_method_types: ["cashapp"] }), expect.anything()); expect(mocks.notify).not.toHaveBeenCalled();
    expect(await caller().settleCashApp({ bookingId: 1, paymentIntentId: "pi_cash" })).toMatchObject({ completedNow: true, totalCents: 32123, paymentMethod: "cashapp" });
    expect(db.state.booking[0]).toMatchObject({ status: "needs_attention", paymentMethod: "cashapp", paymentStatus: "captured" }); expect(db.state.profile[0].stripePaymentMethodId).toBeNull(); expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(await settleSucceededCashAppPayment(db as any, intent() as any)).toMatchObject({ completedNow: false }); expect(mocks.notify).toHaveBeenCalledTimes(1);
    await expect(caller().prepareCashApp({ bookingId: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects another booking/profile intent before provider retrieval", async () => {
    await caller().prepare(input("cashapp")); await caller().prepareCashApp({ bookingId: 1 }); mocks.stripe.paymentIntents.retrieve.mockClear();
    await expect(caller().settleCashApp({ bookingId: 1, paymentIntentId: "pi_other" })).rejects.toMatchObject({ code: "CONFLICT" }); expect(mocks.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    db.state.cash[0].bookingPaymentProfileId = 9;
    await expect(caller().settleCashApp({ bookingId: 1, paymentIntentId: "pi_cash" })).rejects.toMatchObject({ code: "CONFLICT" }); expect(mocks.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "completed", "expired"])("shared webhook/return settlement cannot resurrect %s", async status => {
    await caller().prepare(input("cashapp")); await caller().prepareCashApp({ bookingId: 1 }); db.state.booking[0].status = status;
    await expect(settleSucceededCashAppPayment(db as any, intent() as any)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state.booking[0].status).toBe(status); expect(db.state.cash[0].status).toBe("pending"); expect(mocks.notify).not.toHaveBeenCalled();
    await markCashAppPaymentUnavailable(db as any, intent("pi_cash", "canceled") as any, "cancelled"); expect(db.state.booking[0].status).toBe(status); expect(db.state.cash[0].status).toBe("pending");
  });
  it("does not rewind captured state on a late failure and supports safe same-booking Cash App-to-card handoff", async () => {
    await caller().prepare(input("cashapp")); await caller().prepareCashApp({ bookingId: 1 });
    mocks.stripe.paymentIntents.retrieve.mockResolvedValueOnce(intent("pi_cash", "requires_action"));
    expect(await caller().abandonCashApp({ bookingId: 1, paymentIntentId: "pi_cash" })).toMatchObject({ abandoned: true });
    expect(db.state.booking[0]).toMatchObject({ status: "pending_payment", paymentMethod: "card", paymentStatus: "not_started" }); expect(db.state.cash[0].status).toBe("cancelled");
    await caller().startSetup({ bookingId: 1 }); await caller().confirmSetup({ bookingId: 1, paymentMethodId: "pm_card", consentAccepted: true, deferConfirmation: true }); await caller().finalize({ bookingId: 1 });
    expect(db.state.booking).toHaveLength(1); expect(db.state.booking[0].firstCleaningTotalCents).toBe(32123); expect(db.state.booking[0].priceSnapshot.internalExactForm.paymentMethod).toBe("cashapp");
  });
  it("ignores unavailable after capture without resetting native/profile payment state", async () => {
    await caller().prepare(input("cashapp")); await caller().prepareCashApp({ bookingId: 1 }); await caller().settleCashApp({ bookingId: 1, paymentIntentId: "pi_cash" });
    const before = structuredClone(db.state); await markCashAppPaymentUnavailable(db as any, intent("pi_cash", "canceled") as any, "cancelled"); expect(db.state).toEqual(before);
  });
  it("locks latest Cash App ledger and rejects stale paid/pending mismatches", async () => {
    await caller().prepare(input("cashapp")); await caller().prepareCashApp({ bookingId: 1 }); db.state.cash[0].status = "cancelled";
    await expect(settleSucceededCashAppPayment(db as any, intent() as any)).rejects.toMatchObject({ code: "CONFLICT" }); expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("failure webhook keeps a confirmable intent bound until explicit verified cancellation, then allows card handoff", async () => {
    await caller().prepare(input("cashapp")); await caller().prepareCashApp({ bookingId: 1 });
    await markCashAppPaymentUnavailable(db as any, intent("pi_cash", "requires_payment_method") as any, "failed");
    expect(db.state.cash[0].status).toBe("pending"); expect(db.state.profile[0].stripePaymentIntentId).toBe("pi_cash");
    await expect(caller().startSetup({ bookingId: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    mocks.stripe.paymentIntents.retrieve.mockResolvedValueOnce(intent("pi_cash", "requires_payment_method"));
    await caller().abandonCashApp({ bookingId: 1, paymentIntentId: "pi_cash" }); expect(mocks.stripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_cash");
    expect(db.state.cash[0].status).toBe("cancelled"); await caller().startSetup({ bookingId: 1 });
    expect(db.state.booking).toHaveLength(1); expect(db.state.booking[0].priceSnapshot.internalExactForm.paymentMethod).toBe("cashapp");
  });
  it("repeated safe abandonment is read-only without provider calls or state rewind", async () => {
    await caller().prepare(input("cashapp")); await caller().prepareCashApp({ bookingId: 1 });
    mocks.stripe.paymentIntents.retrieve.mockResolvedValueOnce(intent("pi_cash", "requires_action"));
    await caller().abandonCashApp({ bookingId: 1, paymentIntentId: "pi_cash" }); const before = structuredClone(db.state);
    mocks.stripe.paymentIntents.retrieve.mockClear(); mocks.stripe.paymentIntents.cancel.mockClear();
    expect(await caller().abandonCashApp({ bookingId: 1, paymentIntentId: "pi_cash" })).toMatchObject({ abandoned: true, alreadySucceeded: false });
    expect(db.state).toEqual(before); expect(mocks.stripe.paymentIntents.retrieve).not.toHaveBeenCalled(); expect(mocks.stripe.paymentIntents.cancel).not.toHaveBeenCalled();
  });
});

it("new marker-only SetupIntent webhook gate is read-only and generic path is not used", async () => {
  await caller().prepare(input()); await caller().startSetup({ bookingId: 1 });
  const before = structuredClone(db.state);
  await db.transaction(tx => lockInternalExactBooking(tx, 1, "webhook", { required: true, profileId: 1 }));
  expect(db.state).toEqual(before); expect(mocks.notify).not.toHaveBeenCalled();
});

it.each(["apple_pay", "google_pay"] as const)("persists %s only after real canonical wallet verification", async wallet => {
  await caller().prepare(input()); await caller().startSetup({ bookingId: 1 });
  mocks.stripe.paymentMethods.retrieve.mockResolvedValueOnce({ id: "pm_card", type: "card", customer: "cus_staff", card: { brand: "visa", last4: "4242", exp_month: 1, exp_year: 2040, wallet: { type: wallet } } });
  await caller().confirmSetup({ bookingId: 1, paymentMethodId: "pm_card", consentAccepted: true, deferConfirmation: true, wallet });
  expect(db.state.booking[0].paymentMethod).toBe(wallet); expect(db.state.booking[0].status).toBe("pending_payment"); expect(mocks.notify).not.toHaveBeenCalled();
});

it("rejects changed SetupIntent identity under the actual confirmation transaction", async () => {
  await caller().prepare(input()); await caller().startSetup({ bookingId: 1 });
  const profile = structuredClone(db.state.profile[0]); db.state.profile[0].stripeSetupIntentId = "seti_replaced";
  await expect(finalizeCanonicalCardOnFile(db as any, { bookingId: 1, profileId: 1, profileVersion: profile.version, funnelId: 1, stripeCustomerId: "cus_staff", customerName: "Test Customer", customerPhone: db.state.booking[0].customerPhone, paymentMethod: { id: "pm_card", brand: "visa", last4: "4242", exp_month: 1, exp_year: 2040 }, deferConfirmation: true, internalExactSetupIntentId: "seti_staff" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(db.state.profile[0].paymentStatus).toBe("setup_pending"); expect(mocks.notify).not.toHaveBeenCalled();
});

describe("actual signed webhook new-marker gate", () => {
  async function deliver(type: string, object: Row) {
    let handler: any;
    registerStripeWebhookRoute({ post: (_path: string, _raw: unknown, fn: unknown) => { handler = fn; } } as any);
    mocks.stripe.webhooks.constructEvent.mockReturnValue({ id: `evt_${db.state.event.length}`, type, data: { object } });
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await handler({ header: () => "mock-signature", body: Buffer.from("mock-only") }, response);
    return response;
  }
  it("SetupIntent success cannot save card, notify or book before explicit staff confirm/finalize", async () => {
    await caller().prepare(input()); await caller().startSetup({ bookingId: 1 });
    const before = structuredClone(db.state.booking[0]); mocks.stripe.paymentMethods.retrieve.mockClear();
    const res = await deliver("setup_intent.succeeded", { object: "setup_intent", id: "seti_staff", status: "succeeded", payment_method: "pm_card", customer: "cus_staff", metadata: { bookingId: "1", bookingPaymentProfileId: "1" } });
    expect(res.status).toHaveBeenCalledWith(200); expect(db.state.event[0].status).toBe("processed"); expect(db.state.booking[0]).toEqual(before);
    expect(db.state.profile[0].paymentStatus).toBe("setup_pending"); expect(db.state.funnel[0].stage).toBe("payment_incomplete"); expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.stripe.paymentMethods.retrieve).not.toHaveBeenCalled();
  });
  it("late SetupIntent failure/cancellation cannot rewind saved or cancelled native state", async () => {
    await savedCard(); await caller().finalize({ bookingId: 1 }); db.state.booking[0].status = "cancelled";
    const before = structuredClone(db.state.booking[0]); const profile = structuredClone(db.state.profile[0]);
    for (const type of ["setup_intent.setup_failed", "setup_intent.canceled", "setup_intent.succeeded"]) {
      const res = await deliver(type, { object: "setup_intent", id: "seti_staff", payment_method: "pm_card", metadata: { bookingId: "1", bookingPaymentProfileId: "1" } });
      expect(res.status).toHaveBeenCalledWith(200);
    }
    expect(db.state.booking[0]).toEqual(before); expect(db.state.profile[0]).toEqual(profile); expect(mocks.notify).toHaveBeenCalledTimes(1);
  });
});
