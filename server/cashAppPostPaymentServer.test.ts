import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), broadcast: vi.fn(), send: vi.fn(), notify: vi.fn(),
  env: { stripeSecretKey: "sk_test_offline_only_not_a_real_key" },
  stripe: { paymentIntents: { create: vi.fn(), retrieve: vi.fn() }, paymentMethods: { retrieve: vi.fn() } },
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./stripeClient", () => ({ getStripeClient: () => mocks.stripe }));
vi.mock("./_core/env", () => ({ ENV: mocks.env }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: mocks.broadcast }));
vi.mock("./openphone", () => ({ sendSms: mocks.send }));
vi.mock("./bookingCompletionNotifications", () => ({ sendBookingCompletionNotifications: mocks.notify }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.context<{}>().create();
  return { router: t.router, publicProcedure: t.procedure, agentProcedure: t.procedure };
});
// Only the unrelated nested public-booking router is replaced; top-level Cash
// App procedures, persisted capability checks and reconciliation execute for real.
vi.mock("./bookingCashAppRouter", async () => {
  const { router } = await import("./_core/trpc");
  return { bookingCashAppRouter: router({}) };
});
type Row = Record<string, any>;
type Column = { table: string; field: string };
const names = ["bookings", "bookingPaymentProfiles", "bookingFunnelRecords", "bookingSeries", "cardAuthTokens", "cashAppPaymentTokens", "bookingCashAppPayments", "stripeWebhookEvents", "paymentAuthorizations", "leadflowJobs", "invoice", "manual"];
vi.mock("../drizzle/schema", () => {
  const tables = ["bookings", "bookingPaymentProfiles", "bookingFunnelRecords", "bookingSeries", "cardAuthTokens", "cashAppPaymentTokens", "bookingCashAppPayments", "stripeWebhookEvents", "paymentAuthorizations", "leadflowJobs"];
  return Object.fromEntries(tables.map(name => [name, new Proxy({ name }, { get: (target, field: string) => field === "name" ? target.name : { table: name, field } })]));
});
vi.mock("drizzle-orm", () => ({
  eq: (column: Column, value: unknown) => ({ column, value }), and: (...conditions: unknown[]) => conditions,
  like: (column: Column, value: string) => ({ column, prefix: value.slice(0, -1) }),
  sql: (strings: TemplateStringsArray, ...values: any[]) => strings.join("").includes("+ 1") ? { increment: values[0] } : { text: strings.join("?"), values },
}));
import { cashAppRouter } from "./cashAppRouter";
import { issueHandoffToken } from "./internalBookingHandoffToken";
import { markInternalExactPrepared } from "./internalExactBookingMarker";
import { processSignedInternalHandoffEvent } from "./internalBookingHandoffWebhook";
import { reconcileInternalHandoffCash } from "./internalBookingHandoffCash";
import { calculatePublicBookingPrice, createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICING_VERSION } from "../shared/publicBookingPricing";

/** Existing handoff MemoryDb conventions: exact lookup, locked reads, mysql tuples,
 * optional collection claims and rollback snapshots; no real DB/provider access. */
class MemoryDb {
  state: Record<string, Row[]> = Object.fromEntries(names.map(name => [name, []]));
  depth = 0; trace: string[] = []; writes: { table: string; values: Row }[] = [];
  failOn?: string; failMethod = false; caseAlias = false; onLock?: () => void;
  transaction = async (work: any): Promise<any> => {
    const before = structuredClone(this.state); this.depth++;
    try { const result = await work(this); this.trace.push("commit"); return result; }
    catch (error) { this.state = before; this.trace.push("rollback"); throw error; }
    finally { this.depth--; }
  };
  matches(row: Row, c: any): boolean {
    if (!c) return true;
    if (Array.isArray(c)) return c.every(item => this.matches(row, item));
    if (c.prefix) return row[c.column.field].startsWith(c.prefix);
    const value = row[c.column.field];
    return this.caseAlias && c.column.field === "token" ? value.toLowerCase() === c.value.toLowerCase() : value === c.value;
  }
  select = (fields?: Record<string, Column>) => {
    let table: any, condition: any, count = Infinity, lock = false;
    const query = {
      from(t: any) { table = t; return query; }, where(c: any) { condition = c; return query; }, limit(n: number) { count = n; return query; },
      for: () => { expect(this.depth).toBeGreaterThan(0); lock = true; return query; },
      then: async (resolve: any, reject: any) => {
        try {
          this.trace.push(`${lock ? "lock" : "read"}:${table.name}`);
          if (lock && table.name === "bookings" && this.onLock) { const hook = this.onLock; this.onLock = undefined; hook(); }
          let rows = this.state[table.name].filter(row => this.matches(row, condition)).slice(0, count);
          if (fields) rows = rows.map(row => Object.fromEntries(Object.entries(fields).map(([key, col]) => [key, row[col.field]])));
          return resolve(structuredClone(rows));
        } catch (error) { return reject(error); }
      },
    }; return query;
  };
  execute = async (query: any) => {
    if (query.text.includes("information_schema.tables")) return [[{ tableName: "payable_invoice_lines" }, { tableName: "payable_invoice_manual_payments" }]];
    expect(this.depth).toBeGreaterThan(0); this.trace.push("claim-lock");
    return [structuredClone(query.text.includes("manual_payments") ? this.state.manual : this.state.invoice)];
  };
  insert = (table: any) => ({ values: async (values: Row) => {
    this.trace.push(`insert:${table.name}`);
    if (this.failOn === table.name) throw new Error("injected persistence failure");
    const key = table.name === "stripeWebhookEvents" ? "stripeEventId" : table.name === "bookingCashAppPayments" ? "stripePaymentIntentId" : null;
    if (key && this.state[table.name].some(row => row[key] === values[key])) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
    const id = this.state[table.name].length + 1; this.state[table.name].push({ id, ...structuredClone(values) });
    return [{ insertId: id, affectedRows: 1 }, []];
  } });
  update = (table: any) => ({ set: (values: Row) => ({ where: async (condition: any) => {
    this.trace.push(`update:${table.name}`); this.writes.push({ table: table.name, values: structuredClone(values) });
    if (this.failOn === table.name || (this.failMethod && values.paymentMethod === "cashapp")) throw new Error("injected mutation failure");
    const rows = this.state[table.name].filter(row => this.matches(row, condition));
    rows.forEach(row => Object.entries(values).forEach(([key, value]) => { row[key] = value && typeof value === "object" && "increment" in value ? row[value.increment.field] + 1 : structuredClone(value); }));
    return [{ affectedRows: rows.length }, []];
  } }) });
}
const requestId = "d432d702-5ff4-4f0a-97ab-a9602716ef28";
let db: MemoryDb, token: string, intent: any, method: any;
const caller = () => cashAppRouter.createCaller({});
const confirm = () => caller().confirmPayment({ token });
const signed = (id = "evt_exact") => ({ id, type: "payment_intent.succeeded", data: { object: { object: "payment_intent", ...structuredClone(intent) } } } as any);
function fixture() {
  const input = { pricingMode: "home" as const, serviceId: "deep" as const, bedrooms: 2, bathrooms: 2, homeType: "Condo" as const, condition: 7, maidCount: 1, hourCount: 3, extras: [], recurrence: "one-time" as const, customPriceCents: 32123, arrivalPreference: { mode: "flexible" as const, startLocalTime: "08:30", endLocalTime: "17:00" } };
  const price = calculatePublicBookingPrice(input);
  const booking = markInternalExactPrepared({ id: 1, publicBookingNumber: "BK-1", idempotencyKey: requestId, commandHash: "a".repeat(64), source: "popup", status: "confirmed", assignmentStatus: "assigned", availabilityStatus: "confirmed", recurringIntentStatus: null, customerName: "Saved Customer", customerPhone: "+12025550123", customerEmail: "saved@example.test", serviceId: "deep", serviceName: "Deep Cleaning", bedrooms: 2, bathrooms: 2, homeType: "Condo", extras: [], specialRequestNotes: [], address: "123 Main Street", requestedLocalDate: "2037-02-15", requestedLocalTime: "08:30", requestedTimeZone: "America/New_York", requestedStartAt: 2118231000000, recurrence: "one-time", pricingVersion: PUBLIC_BOOKING_PRICING_VERSION, firstCleaningTotalCents: price.firstCleaningTotalCents, futureVisitTotalCents: price.futureVisitTotalCents, priceSnapshot: createPublicBookingPriceSnapshot(input), companyNotes: null, paymentMethod: "invoice", paymentStatus: "not_started", bookedByAgentId: 7, bookedByAgentName: "Staff", expiresAt: null, updatedAt: new Date() } as any, { paymentMethod: "invoice", withoutPayment: true, companyNotes: null }, { agentId: 7, agentName: "Staff" });
  db.state.bookings = [booking];
  db.state.bookingFunnelRecords = [{ ...booking, id: 2, bookingId: 1, source: "internal", stage: "booked", version: 1 }];
  db.state.bookingPaymentProfiles = [{ id: 3, bookingId: 1, funnelRecordId: 2, version: 1, paymentStatus: "not_started", stripePaymentIntentId: null, stripeSetupIntentId: null, stripePaymentMethodId: null, capturedAt: null, authorizedAt: null, updatedAt: new Date() }];
  db.state.leadflowJobs = [{ id: 4, bookingId: 1, bookingStatus: "assigned", hasStripeCard: 0 }];
  token = issueHandoffToken("cashapp", { bookingId: 1, profileId: 3, version: 1, date: booking.requestedLocalDate }, requestId);
  db.state.cashAppPaymentTokens = [{ id: 5, token, customerName: booking.customerName, customerPhone: booking.customerPhone, amountCents: price.firstCleaningTotalCents, description: "Saved first cleaning", status: "open", stripePaymentIntentId: null, paidAt: null, expiresAt: Date.now() + 10000 }];
}
async function prepare() {
  await caller().createPaymentIntent({ token });
  intent.status = "succeeded"; intent.amount_received = intent.amount; intent.payment_method = "pm_cash";
  db.trace = []; db.writes = []; mocks.broadcast.mockClear();
}
const paymentState = () => structuredClone(Object.fromEntries(Object.entries(db.state).filter(([key]) => key !== "stripeWebhookEvents")));
const expectNoChargeOrMessages = () => {
  expect(mocks.stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
  expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
};
beforeEach(() => {
  vi.clearAllMocks(); db = new MemoryDb(); fixture(); mocks.getDb.mockResolvedValue(db);
  method = { id: "pm_cash", type: "cashapp" };
  mocks.stripe.paymentIntents.create.mockImplementation(async params => {
    expect(db.depth).toBe(0); expect(db.state.bookingPaymentProfiles[0].paymentStatus).toBe("charge_pending");
    return intent = { id: "pi_exact", client_secret: "offline_secret", status: "requires_payment_method", ...params };
  });
  mocks.stripe.paymentIntents.retrieve.mockImplementation(async id => { expect(id).toBe("pi_exact"); return structuredClone(intent); });
  mocks.stripe.paymentMethods.retrieve.mockImplementation(async () => structuredClone(method));
  mocks.broadcast.mockImplementation(() => {
    // Signed dispatch has an independent event-ledger transaction; the booking
    // reconciliation transaction must already have committed before refresh.
    expect(db.trace.at(-1)).toBe("commit");
    expect(db.state.bookings[0]).toMatchObject({ paymentMethod: "cashapp", paymentStatus: "captured" });
    db.trace.push("broadcast");
  });
});

describe("Cash App persisted-token post-payment — actual router / real reconcile", () => {
  it("is one public mutation, token-only, and settles exact stored PI without a second charge or operational changes", async () => {
    expect(cashAppRouter._def.procedures.confirmPayment._def.type).toBe("mutation");
    await prepare(); const native = structuredClone(db.state.bookings[0]); const jobs = structuredClone(db.state.leadflowJobs); const funnel = structuredClone(db.state.bookingFunnelRecords);
    expect(await confirm()).toEqual({ status: "paid", amountCents: native.firstCleaningTotalCents, description: "Saved first cleaning" });
    expect(db.depth).toBe(0); expect(db.state.bookings[0]).toEqual({ ...native, paymentStatus: "captured", paymentMethod: "cashapp", updatedAt: expect.any(Date) });
    expect(db.state.bookingPaymentProfiles[0]).toMatchObject({ bookingId: 1, version: 1, stripePaymentIntentId: "pi_exact", paymentStatus: "captured" });
    expect(db.state.bookingCashAppPayments[0]).toMatchObject({ status: "paid", stripePaymentIntentId: "pi_exact" });
    expect(db.state.leadflowJobs).toEqual(jobs); expect(db.state.bookingFunnelRecords).toEqual(funnel);
    expect(db.trace.indexOf("lock:bookings")).toBeLessThan(db.trace.indexOf("claim-lock"));
    expect(mocks.broadcast).toHaveBeenCalledOnce(); expect(mocks.broadcast).toHaveBeenCalledWith("booking_funnel_update");
    expect(mocks.stripe.paymentIntents.retrieve.mock.calls.map(args => args[0])).toEqual(["pi_exact", "pi_exact"]);
    expectNoChargeOrMessages();
  });
  it.each(["bookingId", "paymentIntentId", "stripePaymentIntentId", "amountCents", "status"])("rejects caller-controlled %s rather than trusting it", async key => {
    await prepare(); const before = paymentState(); mocks.stripe.paymentIntents.retrieve.mockClear();
    await expect(caller().confirmPayment({ token, [key]: key.includes("Id") ? "pi_other" : "paid" } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.stripe.paymentIntents.retrieve).not.toHaveBeenCalled(); expect(paymentState()).toEqual(before); expect(mocks.broadcast).not.toHaveBeenCalled(); expectNoChargeOrMessages();
  });
  it.each(["a".repeat(64), "hc1_" + "A".repeat(43), "hp1_bad", "HP1_" + "A".repeat(43)])("rejects legacy/card/malformed token %s", async wrong => {
    await expect(caller().confirmPayment({ token: wrong })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.stripe.paymentIntents.retrieve).not.toHaveBeenCalled(); expect(mocks.stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it("rejects unpersisted or database-collation aliased canonical tokens before decoding target lookup/provider", async () => {
    const wrong = token.slice(0, -1) + (token.endsWith("A") ? "Q" : "A");
    await expect(caller().confirmPayment({ token: wrong })).rejects.toMatchObject({ code: "CONFLICT" });
    db.caseAlias = true; const alias = "hp1_" + token.slice(4).toUpperCase(); db.trace = [];
    await expect(caller().confirmPayment({ token: alias })).rejects.toThrow("Invalid payment link");
    expect(db.trace).toEqual(["read:cashAppPaymentTokens"]); expect(mocks.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
  it("missing durable PI fails review without reconstructing/creating any intent", async () => {
    const before = paymentState();
    await expect(confirm()).rejects.toThrow("No durable Cash App payment");
    expect(paymentState()).toEqual(before); expect(mocks.stripe.paymentIntents.create).not.toHaveBeenCalled(); expect(mocks.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
  it.each(["processing", "requires_action", "requires_payment_method"])("server %s is not paid regardless of browser success", async status => {
    await prepare(); intent.status = status;
    expect(await confirm()).toMatchObject({ status: "payment_started" });
    expect(db.state.bookings[0]).toMatchObject({ paymentStatus: "charge_pending", paymentMethod: "invoice" });
    expect(db.state.bookingCashAppPayments[0].status).toBe("pending"); expect(mocks.broadcast).not.toHaveBeenCalled(); expectNoChargeOrMessages();
  });
  it.each(["id", "amount", "received", "currency", "method-types", "method-id", "method-type", "missing-method", "token", "booking", "profile", "version", "date", "metadata-amount", "metadata-method", "purpose"])("rejects wrong provider %s proof without writes or refresh", async wrong => {
    await prepare(); const before = paymentState();
    if (wrong === "id") intent.id = "pi_other";
    if (wrong === "amount") intent.amount++;
    if (wrong === "received") intent.amount_received--;
    if (wrong === "currency") intent.currency = "cad";
    if (wrong === "method-types") intent.payment_method_types = ["cashapp", "card"];
    if (wrong === "method-id") method.id = "pm_other";
    if (wrong === "method-type") method.type = "card";
    if (wrong === "missing-method") intent.payment_method = null;
    const metadata = { token: "cashAppPaymentToken", booking: "bookingId", profile: "bookingPaymentProfileId", version: "handoffReviewVersion", date: "handoffDate", "metadata-amount": "handoffAmountCents", "metadata-method": "paymentMethod", purpose: "internalBookingHandoff" };
    if (wrong in metadata) intent.metadata[metadata[wrong as keyof typeof metadata]] = "wrong";
    await expect(confirm()).rejects.toThrow(); expect(paymentState()).toEqual(before); expect(db.writes).toEqual([]); expect(mocks.broadcast).not.toHaveBeenCalled(); expectNoChargeOrMessages();
  });
  it.each(["customer", "name", "amount", "version", "profile-pi", "payment-owner", "invoice", "manual", "card-hold", "booking-paid"])("retains durable %s ownership/binding guards", async wrong => {
    await prepare();
    if (wrong === "customer") db.state.cashAppPaymentTokens[0].customerPhone = "+12025550999";
    if (wrong === "name") db.state.cashAppPaymentTokens[0].customerName = "Other";
    if (wrong === "amount") db.state.cashAppPaymentTokens[0].amountCents++;
    if (wrong === "version") db.state.bookingPaymentProfiles[0].version++;
    if (wrong === "profile-pi") db.state.bookingPaymentProfiles[0].stripePaymentIntentId = "pi_other";
    if (wrong === "payment-owner") db.state.bookingCashAppPayments[0].bookingPaymentProfileId = 99;
    if (wrong === "invoice" || wrong === "manual") db.state[wrong].push({ invoiceId: 99 });
    if (wrong === "card-hold") db.state.paymentAuthorizations.push({ bookingPaymentProfileId: 3, status: "authorized", stripePaymentIntentId: "pi_hold" });
    if (wrong === "booking-paid") db.state.bookings[0].paymentStatus = "captured";
    const before = paymentState(); await expect(confirm()).rejects.toThrow(); expect(paymentState()).toEqual(before); expect(mocks.broadcast).not.toHaveBeenCalled(); expectNoChargeOrMessages();
  });
  it("rechecks locked capability and PI ownership after provider lookup, rolling back drift", async () => {
    await prepare(); const before = paymentState(); db.onLock = () => { db.state.cashAppPaymentTokens[0].stripePaymentIntentId = "pi_other"; };
    await expect(confirm()).rejects.toThrow(); expect(paymentState()).toEqual(before); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it.each(["browser-first", "webhook-first"])("%s plus webhook/retry is idempotent with one charge and one refresh", async order => {
    await prepare();
    if (order === "webhook-first") await processSignedInternalHandoffEvent(db as any, signed()); else await confirm();
    const before = paymentState();
    await confirm(); await processSignedInternalHandoffEvent(db as any, signed()); await confirm();
    expect(paymentState()).toEqual(before); expect(db.state.bookingCashAppPayments).toHaveLength(1); expect(mocks.broadcast).toHaveBeenCalledOnce(); expectNoChargeOrMessages();
  });
  it("expired paid previous-version replay repairs only Cash App discriminator; further replay writes nothing", async () => {
    await prepare(); await confirm();
    db.state.bookings[0].paymentMethod = "invoice"; db.state.cashAppPaymentTokens[0].expiresAt = 1; db.state.bookingPaymentProfiles[0].version = 2;
    const before = paymentState(); db.trace = []; db.writes = []; mocks.broadcast.mockClear();
    expect(await confirm()).toMatchObject({ status: "paid" });
    expect(db.writes).toEqual([{ table: "bookings", values: { paymentMethod: "cashapp" } }]);
    before.bookings[0].paymentMethod = "cashapp"; expect(paymentState()).toEqual(before); expect(mocks.broadcast).toHaveBeenCalledOnce();
    db.writes = []; mocks.broadcast.mockClear(); await confirm(); expect(db.writes).toEqual([]); expect(mocks.broadcast).not.toHaveBeenCalled(); expectNoChargeOrMessages();
  });
  it.each(["processing", "wrong-profile", "not-captured"])("paid replay never changes method without verified succeeded captured booking (%s)", async wrong => {
    await prepare(); await confirm(); db.state.bookings[0].paymentMethod = "invoice";
    if (wrong === "processing") intent.status = "processing";
    if (wrong === "wrong-profile") db.state.bookingPaymentProfiles[0].stripePaymentIntentId = "pi_other";
    if (wrong === "not-captured") db.state.bookings[0].paymentStatus = "authorized";
    const before = paymentState(); db.writes = []; mocks.broadcast.mockClear();
    if (wrong === "wrong-profile") await expect(confirm()).rejects.toThrow(); else await confirm();
    expect(paymentState()).toEqual(before); expect(db.writes).toEqual([]); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it.each(["bookingCashAppPayments", "cashAppPaymentTokens", "bookingPaymentProfiles", "bookings", "method"])("failure at %s rolls back all settlement/method writes and never broadcasts; retry settles once", async fail => {
    await prepare(); const before = paymentState(); if (fail === "method") db.failMethod = true; else db.failOn = fail;
    await expect(confirm()).rejects.toThrow("injected"); expect(paymentState()).toEqual(before); expect(db.trace.at(-1)).toBe("rollback"); expect(mocks.broadcast).not.toHaveBeenCalled();
    db.failMethod = false; db.failOn = undefined; expect(await confirm()).toMatchObject({ status: "paid" }); expect(mocks.broadcast).toHaveBeenCalledOnce(); expectNoChargeOrMessages();
  });
  it("provider transport failure makes no write or replacement charge and is retryable", async () => {
    await prepare(); const before = paymentState(); mocks.stripe.paymentIntents.retrieve.mockRejectedValueOnce(new Error("offline timeout"));
    await expect(confirm()).rejects.toThrow("offline timeout"); expect(paymentState()).toEqual(before); expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(await confirm()).toMatchObject({ status: "paid" }); expectNoChargeOrMessages();
  });
  it("getStatus remains DB-only even with provider succeeded, then reflects stored paid after confirmation", async () => {
    await prepare(); const before = paymentState(); mocks.stripe.paymentIntents.retrieve.mockClear();
    expect(await caller().getStatus({ token })).toMatchObject({ status: "payment_started" });
    expect(paymentState()).toEqual(before); expect(db.writes).toEqual([]); expect(mocks.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    await confirm(); expect(await caller().getStatus({ token })).toMatchObject({ status: "paid" });
  });
  it("late pending webhook cannot undo captured or fabricate another method refresh", async () => {
    await prepare(); await confirm(); const before = paymentState(); const old = structuredClone(intent); old.status = "processing";
    mocks.broadcast.mockClear(); await reconcileInternalHandoffCash(db as any, old);
    expect(paymentState()).toEqual(before); expect(mocks.broadcast).not.toHaveBeenCalled(); expectNoChargeOrMessages();
  });
});

describe("exact legacy source preservation", () => {
  const base = "fffbf1127384bb941fa03145187e5449007205af";
  const original = (file: string) => execFileSync("git", ["show", `${base}:server/${file}.ts`], { encoding: "utf8" });
  const current = (file: string) => readFileSync(new URL(`./${file}.ts`, import.meta.url), "utf8");
  it("keeps every existing Cash App router procedure and original confirm/create input bytes unchanged", () => {
    const source = current("cashAppRouter");
    const added = source.slice(source.indexOf("  confirmPayment:"), source.indexOf("  createPaymentIntent:"));
    const restored = source.replace('import { confirmInternalHandoffCash } from "./internalBookingHandoffCash";\n', "").replace(added, "");
    expect(restored).toBe(original("cashAppRouter"));
    expect(added).toContain('.strict()'); expect(added).not.toMatch(/bookingId|paymentIntentId|amountCents|status:/);
  });
  it("preserves cash create-intent helper and shared context/card/save-card/public-booking files byte-for-byte", () => {
    const start = "export async function createInternalHandoffCashIntent";
    const old = original("internalBookingHandoffCash"); const now = current("internalBookingHandoffCash");
    expect(now.slice(now.indexOf(start), now.indexOf("export async function confirmInternalHandoffCash"))).toBe(old.slice(old.indexOf(start), old.indexOf("/** Called only after")));
    for (const file of ["internalBookingHandoffContext", "internalBookingHandoffCard", "stripeRouter", "bookingCashAppRouter", "bookingPaymentAdminRouter", "internalBookingHandoffToken", "internalBookingHandoffWebhook"]) expect(current(file)).toBe(original(file));
  });
});
