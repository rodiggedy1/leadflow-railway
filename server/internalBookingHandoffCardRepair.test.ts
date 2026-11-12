import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), broadcast: vi.fn(), send: vi.fn(), notify: vi.fn(),
  env: { stripeSecretKey: "sk_test_offline_only_not_a_real_key", isPreviewMode: false, openPhoneCsNumberId: "cs-offline" },
  stripe: { customers: { create: vi.fn(), retrieve: vi.fn() }, setupIntents: { create: vi.fn(), retrieve: vi.fn() }, paymentMethods: { retrieve: vi.fn() }, paymentIntents: { create: vi.fn(), retrieve: vi.fn() } },
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./stripeClient", () => ({ getStripeClient: () => mocks.stripe }));
vi.mock("./_core/env", () => ({ ENV: mocks.env }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: mocks.broadcast }));
vi.mock("./openphone", () => ({ sendSms: mocks.send }));
vi.mock("./bookingCompletionNotifications", () => ({ sendBookingCompletionNotifications: mocks.notify }));
vi.mock("./customerPortalService", () => ({ createCanonicalBookingPortalHandoff: vi.fn() }));
vi.mock("./stripeCardListReconciliation", () => ({ reconcileMissingStripeCustomerCards: vi.fn() }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC, TRPCError } = await import("@trpc/server");
  const t = initTRPC.context<{ agent?: { agentId: number; agentName: string } }>().create();
  const staff = t.procedure.use(({ ctx, next }) => {
    if (!ctx.agent) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { agent: ctx.agent } });
  });
  return { router: t.router, agentProcedure: staff, publicProcedure: t.procedure };
});

type Row = Record<string, any>;
type Column = { table: string; field: string };
const tableNames = ["bookings", "bookingPaymentProfiles", "bookingFunnelRecords", "bookingSeries", "cardAuthTokens", "cashAppPaymentTokens", "bookingCashAppPayments", "stripeCustomers", "paymentAuthorizations", "leadflowJobs", "agents", "customerPortalServiceRequests"];
vi.mock("../drizzle/schema", () => {
  const names = ["bookings", "bookingPaymentProfiles", "bookingFunnelRecords", "bookingSeries", "cardAuthTokens", "cashAppPaymentTokens", "bookingCashAppPayments", "stripeCustomers", "paymentAuthorizations", "leadflowJobs", "agents", "customerPortalServiceRequests"];
  return Object.fromEntries(names.map(name => [name, new Proxy({ name }, { get: (target, field: string) => field === "name" ? target.name : { table: name, field } })]));
});
vi.mock("drizzle-orm", () => ({
  eq: (column: Column, value: unknown) => ({ column, value }),
  and: (...items: unknown[]) => ({ and: items }), or: (...items: unknown[]) => ({ or: items }),
  desc: (column: Column) => ({ desc: column }), gt: (column: Column, value: unknown) => ({ column, gt: value }),
  inArray: (column: Column, values: unknown[]) => ({ column, values }),
  like: (column: Column, value: string) => ({ column, prefix: value.slice(0, -1) }),
  sql: (strings: TemplateStringsArray, ...values: any[]) => strings.join("").includes("+ 1") ? { increment: values[0] } : { text: strings.join("?"), values },
}));

import { stripeRouter } from "./stripeRouter";
import { bookingPaymentAdminRouter } from "./bookingPaymentAdminRouter";
import { markInternalExactPrepared } from "./internalExactBookingMarker";
import { calculatePublicBookingPrice, createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICING_VERSION } from "../shared/publicBookingPricing";

/** Offline transactional store. Ordinary writes return mysql2 tuples; returningId maps to [{id}]. */
class MemoryDb {
  state: Record<string, Row[]> = Object.fromEntries(tableNames.map(name => [name, []]));
  depth = 0;
  trace: string[] = [];
  failOn?: string;
  nextAuthorizationId = 91;
  invoiceClaims: Row[] = [];
  manualPayments: Row[] = [];
  execute = async (query: { text: string; values: unknown[] }) => {
    expect(this.depth).toBeGreaterThan(0);
    expect(query.text).toContain("LIMIT 1 FOR UPDATE");
    const invoice = query.text.includes("FROM payable_invoice_lines");
    const manual = query.text.includes("FROM payable_invoice_manual_payments");
    expect(invoice || manual).toBe(true);
    this.trace.push(invoice ? "claim:invoice" : "claim:manual");
    const rows = invoice ? this.invoiceClaims : this.manualPayments;
    return [structuredClone(rows.filter(row => row.occurrenceKey === query.values[0]).slice(0, 1))];
  };
  transaction = async (work: (tx: MemoryDb) => Promise<any>) => {
    const before = structuredClone(this.state);
    this.depth++;
    try {
      const result = await work(this);
      this.trace.push("commit");
      return result;
    } catch (error) {
      this.state = before;
      this.trace.push("rollback");
      throw error;
    } finally { this.depth--; }
  };
  matches(row: Row, c: any): boolean {
    if (!c) return true;
    if (c.and) return c.and.every((item: any) => this.matches(row, item));
    if (c.or) return c.or.some((item: any) => this.matches(row, item));
    const value = row[c.column.field];
    if (c.prefix) return typeof value === "string" && value.startsWith(c.prefix);
    if (c.values) return c.values.includes(value);
    if ("gt" in c) return value > c.gt;
    return value === c.value;
  }
  select = (fields?: Record<string, Column>) => {
    let table: any, condition: any, count = Infinity;
    const query = {
      from(t: any) { table = t; return query; }, where(c: any) { condition = c; return query; },
      limit(n: number) { count = n; return query; }, orderBy() { return query; },
      for: () => { expect(this.depth).toBeGreaterThan(0); return query; },
      then: async (resolve: any, reject: any) => {
        try {
          this.trace.push(`read:${table.name}`);
          let rows = this.state[table.name].filter(row => this.matches(row, condition)).slice(0, count);
          if (fields) rows = rows.map(row => Object.fromEntries(Object.entries(fields).map(([key, col]) => [key, row[col.field]])));
          return resolve(structuredClone(rows));
        } catch (error) { return reject(error); }
      },
    };
    return query;
  };
  insert = (table: any) => ({ values: (values: Row) => {
    const execute = async () => {
      this.trace.push(`insert:${table.name}`);
      if (this.failOn === table.name) throw new Error("injected persistence failure");
      const id = table.name === "paymentAuthorizations" ? this.nextAuthorizationId++ : this.state[table.name].length + 1;
      this.state[table.name].push({ id, ...structuredClone(values) });
      return [{ insertId: id, affectedRows: 1 }, []];
    };
    return {
      then: (resolve: any, reject: any) => execute().then(resolve, reject),
      $returningId: async () => { const result = await execute(); return [{ id: (result[0] as any).insertId }]; },
      onDuplicateKeyUpdate: async ({ set }: any) => {
        const row = this.state[table.name].find(row => row.phone === values.phone);
        if (row) { this.trace.push(`update:${table.name}`); Object.assign(row, structuredClone(set)); }
        else await execute();
      },
    };
  } });
  update = (table: any) => ({ set: (values: Row) => ({ where: async (condition: any) => {
    this.trace.push(`update:${table.name}`);
    if (this.failOn === table.name) throw new Error("injected mutation failure");
    const rows = this.state[table.name].filter(row => this.matches(row, condition));
    for (const row of rows) for (const [key, value] of Object.entries(values)) {
      row[key] = value && typeof value === "object" && "increment" in value ? row[value.increment.field] + 1 : structuredClone(value);
    }
    return [{ affectedRows: rows.length }, []];
  } }) });
}

const requestId = "d432d702-5ff4-4f0a-97ab-a9602716ef28";
let db: MemoryDb;
let setupIntent: any;
let paymentMethod: any;
const staffContext = { agent: { agentId: 7, agentName: "Staff" } };
const staff = () => bookingPaymentAdminRouter.createCaller(staffContext);
const publicCard = () => stripeRouter.createCaller({});
function fixture() {
  const input = { pricingMode: "home" as const, serviceId: "deep" as const, bedrooms: 2, bathrooms: 2, homeType: "Condo" as const, condition: 7, maidCount: 1, hourCount: 3, extras: [], recurrence: "one-time" as const, customPriceCents: 32123, arrivalPreference: { mode: "flexible" as const, startLocalTime: "08:30", endLocalTime: "17:00" } };
  const price = calculatePublicBookingPrice(input);
  const booking = markInternalExactPrepared({ id: 1, publicBookingNumber: "BK-1", idempotencyKey: requestId, commandHash: "a".repeat(64), source: "popup", status: "needs_attention", assignmentStatus: "unassigned", availabilityStatus: "requested", recurringIntentStatus: null, customerName: "Saved Customer", customerPhone: "+12025550123", customerEmail: "saved@example.test", serviceId: "deep", serviceName: "Deep Cleaning", bedrooms: 2, bathrooms: 2, homeType: "Condo", extras: [], specialRequestNotes: [], address: "123 Main Street", requestedLocalDate: "2037-02-15", requestedLocalTime: "08:30", requestedTimeZone: "America/New_York", requestedStartAt: 2118231000000, recurrence: "one-time", pricingVersion: PUBLIC_BOOKING_PRICING_VERSION, firstCleaningTotalCents: price.firstCleaningTotalCents, futureVisitTotalCents: price.futureVisitTotalCents, priceSnapshot: createPublicBookingPriceSnapshot(input), companyNotes: null, paymentMethod: "invoice", paymentStatus: "not_started", bookedByAgentId: 7, bookedByAgentName: "Staff", expiresAt: null } as any, { paymentMethod: "invoice", withoutPayment: true, companyNotes: null }, staffContext.agent);
  db.state.bookings = [booking];
  db.state.bookingFunnelRecords = [{ ...booking, id: 2, bookingId: 1, source: "internal", stage: "booked", version: 1 }];
  db.state.bookingPaymentProfiles = [{ id: 3, bookingId: 1, funnelRecordId: 2, version: 1, paymentStatus: "not_started", stripeCustomerId: null, stripeSetupIntentId: null, stripePaymentMethodId: null, stripePaymentIntentId: null, consentVersion: null, consentText: null, consentAcceptedAt: null, capturedAt: null, authorizedAt: null }];
  db.state.leadflowJobs = [{ id: 4, bookingId: 1, bookingStatus: "unassigned", hasStripeCard: 0 }];
  db.state.agents = [{ id: 7, isActive: 1 }];
}
async function prepare() {
  const link = await staff().handoff.create({ bookingId: 1, method: "card", requestId, expectedAmountCents: db.state.bookings[0].firstCleaningTotalCents, confirmed: true });
  await publicCard().getCardAuthToken({ token: link.token });
  await publicCard().createSetupIntent({ token: link.token });
  setupIntent.status = "succeeded";
  setupIntent.payment_method = "pm_exact";
  return link;
}
const writes = () => db.trace.filter(item => /^(insert|update):/.test(item));
beforeEach(() => {
  vi.clearAllMocks();
  db = new MemoryDb(); fixture();
  mocks.getDb.mockResolvedValue(db);
  paymentMethod = { id: "pm_exact", type: "card", customer: "cus_exact", card: { brand: "visa", last4: "4242", exp_month: 2, exp_year: 2040 } };
  mocks.stripe.customers.create.mockResolvedValue({ id: "cus_exact" });
  mocks.stripe.customers.retrieve.mockResolvedValue({ id: "cus_exact" });
  mocks.stripe.setupIntents.create.mockImplementation(async params => setupIntent = { id: "seti_exact", status: "requires_payment_method", client_secret: "offline_secret", ...params });
  mocks.stripe.setupIntents.retrieve.mockImplementation(async () => setupIntent);
  mocks.stripe.paymentMethods.retrieve.mockImplementation(async () => paymentMethod);
  mocks.broadcast.mockImplementation(() => { expect(db.depth).toBe(0); db.trace.push("broadcast"); });
  mocks.stripe.paymentIntents.create.mockImplementation(async params => {
    expect(db.depth).toBe(0);
    expect(db.state.paymentAuthorizations).toContainEqual(expect.objectContaining({ id: 91, status: "pending_card", bookingPaymentProfileId: 3 }));
    return { id: "pi_hold", status: "requires_capture", ...params };
  });
});

describe("marked card native payment-method repair — offline real router chain", () => {
  it.each([undefined, "apple_pay", "google_pay", "link"])("uses actual Stripe card wallet %s, preserves operational/consent state, broadcasts only after commit", async wallet => {
    const link = await prepare();
    paymentMethod.card.wallet = wallet ? { type: wallet } : undefined;
    const native = structuredClone(db.state.bookings[0]);
    db.trace = [];
    await publicCard().confirmCardSaved({ token: link.token, paymentMethodId: "pm_exact" });
    const method = wallet === "apple_pay" || wallet === "google_pay" ? wallet : "card";
    expect(db.state.bookings[0]).toMatchObject({ paymentMethod: method, paymentStatus: "card_on_file", status: native.status, assignmentStatus: native.assignmentStatus, requestedLocalDate: native.requestedLocalDate, recurrence: native.recurrence, firstCleaningTotalCents: native.firstCleaningTotalCents, priceSnapshot: native.priceSnapshot });
    expect(db.state.bookingPaymentProfiles[0]).toMatchObject({ bookingId: 1, version: 2, stripeCustomerId: "cus_exact", stripePaymentMethodId: "pm_exact", paymentStatus: "card_on_file", consentAcceptedAt: null, consentText: null, consentVersion: null });
    expect(db.state.bookingFunnelRecords[0]).toMatchObject({ bookingId: 1, stripePaymentMethodId: "pm_exact", stage: "booked" });
    expect(db.state.leadflowJobs[0]).toMatchObject({ bookingId: 1, bookingStatus: "unassigned", hasStripeCard: 1, paymentLast4: "4242" });
    expect(db.state.cardAuthTokens[0].used).toBe(1);
    expect(db.trace.slice(-2)).toEqual(["commit", "broadcast"]);
    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    expect(mocks.broadcast).toHaveBeenCalledWith("booking_funnel_update");
    expect(mocks.stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each(["captured", "paid", "authorized"])("preserves existing %s payment method/status on completion and replay", async status => {
    const link = await prepare();
    db.state.bookings[0].paymentMethod = "cashapp";
    db.state.bookings[0].paymentStatus = db.state.bookingPaymentProfiles[0].paymentStatus = status;
    await publicCard().confirmCardSaved({ token: link.token, paymentMethodId: "pm_exact" });
    expect(db.state.bookings[0]).toMatchObject({ paymentMethod: "cashapp", paymentStatus: status });
    expect(db.state.bookingPaymentProfiles[0]).toMatchObject({ paymentStatus: status, version: 2 });
    db.trace = []; mocks.broadcast.mockClear();
    await publicCard().confirmCardSaved({ token: link.token, paymentMethodId: "pm_exact" });
    expect(writes()).toEqual([]); expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it.each(["invoice", "cashapp"])("repairs matching used-token %s discriminator without profile/token/version rewrites; further replay is write-free", async oldMethod => {
    const link = await prepare();
    await publicCard().confirmCardSaved({ token: link.token, paymentMethodId: "pm_exact" });
    db.state.bookings[0].paymentMethod = oldMethod;
    const profile = structuredClone(db.state.bookingPaymentProfiles[0]);
    const token = structuredClone(db.state.cardAuthTokens[0]);
    db.trace = []; mocks.broadcast.mockClear();
    await publicCard().confirmCardSaved({ token: link.token, paymentMethodId: "pm_exact" });
    expect(db.state.bookings[0].paymentMethod).toBe("card");
    expect(db.state.bookingPaymentProfiles[0]).toEqual(profile);
    expect(db.state.cardAuthTokens[0]).toEqual(token);
    expect(writes()).toEqual(["update:bookings", "update:leadflowJobs"]);
    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    db.trace = []; mocks.broadcast.mockClear();
    await publicCard().confirmCardSaved({ token: link.token, paymentMethodId: "pm_exact" });
    expect(writes()).toEqual([]); expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it.each(["si-customer", "pm-customer", "pm-id"])("rejects wrong %s proof before any write or broadcast", async wrong => {
    const link = await prepare();
    if (wrong === "si-customer") setupIntent.customer = "cus_other";
    if (wrong === "pm-customer") paymentMethod.customer = "cus_other";
    const before = structuredClone(db.state); db.trace = [];
    await expect(publicCard().confirmCardSaved({ token: link.token, paymentMethodId: wrong === "pm-id" ? "pm_other" : "pm_exact" })).rejects.toThrow();
    expect(db.state).toEqual(before); expect(writes()).toEqual([]);
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("rolls back all completion writes and never broadcasts on transaction failure", async () => {
    const link = await prepare(); const before = structuredClone(db.state);
    db.failOn = "cardAuthTokens"; db.trace = [];
    await expect(publicCard().confirmCardSaved({ token: link.token, paymentMethodId: "pm_exact" })).rejects.toThrow("injected mutation failure");
    expect(db.state).toEqual(before); expect(db.trace.at(-1)).toBe("rollback");
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it.each(["invoice", "manual"] as const)("verified handoff card cannot bypass an existing Production %s payment owner", async owner => {
    const link = await prepare();
    await publicCard().confirmCardSaved({ token: link.token, paymentMethodId: "pm_exact" });
    const occurrenceKey = `booking:1:first:${db.state.bookings[0].requestedLocalDate}`;
    if (owner === "invoice") db.invoiceClaims = [{ id: 1, invoiceId: 9, occurrenceKey }];
    else db.manualPayments = [{ occurrenceKey }];
    const before = structuredClone(db.state);
    await expect(staff().placeHold({ bookingId: 1, confirmed: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.state).toEqual(before);
    expect(mocks.stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("unpaid -> verified card -> real getForBooking/placeHold uses only the exact booking profile and actual returned attempt ID", async () => {
    const link = await prepare();
    const otherBooking = { ...structuredClone(db.state.bookings[0]), id: 8, publicBookingNumber: "BK-OTHER" };
    const otherProfile = { ...structuredClone(db.state.bookingPaymentProfiles[0]), id: 9, bookingId: 8, stripeCustomerId: "cus_other", stripePaymentMethodId: "pm_other", paymentStatus: "card_on_file" };
    db.state.bookings.push(otherBooking); db.state.bookingPaymentProfiles.push(otherProfile);
    db.state.stripeCustomers.push({ id: 10, phone: otherBooking.customerPhone, stripeCustomerId: "cus_phone_borrow", stripePaymentMethodId: "pm_phone_borrow" });
    await publicCard().confirmCardSaved({ token: link.token, paymentMethodId: "pm_exact" });
    const native = db.state.bookings[0];
    expect(native.paymentMethod === "cashapp" || native.paymentMethod === "invoice").toBe(false);
    // Confirm the actual protected CRM source retains that method gate and existing placeHold controls.
    const workspace = readFileSync(new URL("../client/src/components/NativeBookingsWorkspace.tsx", import.meta.url), "utf8");
    expect(workspace).toContain(') : active.paymentMethod === "cashapp" ? (');
    expect(workspace).toContain(') : active.paymentMethod === "invoice" ? (');
    expect(workspace).toContain("<BookingPaymentActions");
    const detail = await staff().getForBooking({ bookingId: 1 });
    expect(detail.profile).toMatchObject({ id: 3, bookingId: 1, stripePaymentMethodId: "pm_exact", consentAcceptedAt: null });
    expect(detail.authorizations).toEqual([]);
    expect(mocks.stripe.paymentIntents.create).not.toHaveBeenCalled();
    const held = await staff().placeHold({ bookingId: 1, confirmed: true });
    expect(held).toMatchObject({ authorizationId: 91, paymentStatus: "authorized" });
    expect(mocks.stripe.paymentIntents.create).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_exact", payment_method: "pm_exact", amount: native.firstCleaningTotalCents, capture_method: "manual", off_session: true, metadata: expect.objectContaining({ bookingId: "1", bookingPaymentProfileId: "3", leadflowAuthorizationAttemptId: "91" }) }), { idempotencyKey: "leadflow:booking:1:authorization:v2" });
    expect(db.state.paymentAuthorizations[0]).toMatchObject({ id: 91, bookingPaymentProfileId: 3, stripePaymentMethodId: "pm_exact", status: "authorized" });
    expect(db.state.bookingPaymentProfiles[1]).toEqual(otherProfile);
    expect(db.state.bookings[1]).toEqual(otherBooking);
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
    await expect(staff().placeHold({ bookingId: 1, confirmed: true })).rejects.toThrow();
    expect(mocks.stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
  });
});
