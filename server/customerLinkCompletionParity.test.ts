import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMER_PORTAL_COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";

type Row = Record<string, any>;
type Column = { table: string; field: string };
type Table = { name: string };
type Condition = { column: Column; value: unknown } | Condition[];

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), ensureAccount: vi.fn(), handoff: vi.fn(), savedCard: vi.fn(),
  verifyToken: vi.fn(), paymentTarget: vi.fn(), verifySetup: vi.fn(), stripe: vi.fn(),
  broadcast: vi.fn(), syncPayment: vi.fn(), sendSms: vi.fn(),
  notificationJobs: [] as Promise<void>[],
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "completion-parity-test-secret" } }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.context<Record<string, unknown>>().create();
  return { router: t.router, publicProcedure: t.procedure };
});
vi.mock("../drizzle/schema", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, field: string) => field === "name" ? target.name : { table: name, field },
  });
  return {
    bookingFunnelRecords: table("funnel"), bookingPaymentProfiles: table("profile"),
    bookings: table("booking"), stripeCustomers: table("stripeCustomer"),
    bookingNotificationDeliveries: table("delivery"), opsChatMessages: table("message"),
  };
});
vi.mock("drizzle-orm", () => ({
  eq: (column: Column, value: unknown) => ({ column, value }),
  and: (...conditions: Condition[]) => conditions,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));
vi.mock("./customerPortalService", () => ({
  ensureCustomerPortalAccount: mocks.ensureAccount,
  createCanonicalBookingPortalHandoff: mocks.handoff,
}));
vi.mock("./customerPortalPaymentService", () => ({ getCustomerPortalSavedCard: mocks.savedCard }));
vi.mock("./bookingPaymentTargetService", () => ({
  ensurePublicBookingPaymentTarget: mocks.paymentTarget,
  verifyPublicBookingFunnelToken: mocks.verifyToken,
}));
vi.mock("./bookingPaymentVerification", () => ({ verifyCanonicalCardSetup: mocks.verifySetup }));
vi.mock("./stripeClient", () => ({ getStripeClient: mocks.stripe }));
vi.mock("./bookingLifecycleService", () => ({ syncNativeBookingPaymentState: mocks.syncPayment }));
vi.mock("./bookingUpsellEngine", () => ({
  applyCanonicalAdditionalServices: vi.fn(), BookingUpsellInputError: class extends Error {},
}));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: mocks.broadcast }));
vi.mock("./openphone", () => ({ sendSms: mocks.sendSms }));
vi.mock("./bookingCompletionNotifications", async importOriginal => {
  const actual = await importOriginal<typeof import("./bookingCompletionNotifications")>();
  return {
    ...actual,
    sendBookingCompletionNotifications: (bookingId: number) => {
      const job = actual.sendBookingCompletionNotifications(bookingId);
      mocks.notificationJobs.push(job);
      return job;
    },
  };
});

import { bookingPaymentRouter } from "./bookingPaymentRouter";
import { verifyCustomerPortalSession } from "./_core/customerPortalAuth";

// Real router, canonical card/finalization engine, JWT/cookie helpers and shared
// notification claims execute. No database, Stripe API or SMS provider is used.
class MemoryDb {
  state: Record<string, Row[]> = {
    funnel: [], profile: [], booking: [], stripeCustomer: [], delivery: [], message: [],
  };
  writes: Array<{ table: string; values: Row }> = [];
  private matches(row: Row, condition?: Condition): boolean {
    if (!condition) return true;
    return Array.isArray(condition)
      ? condition.every(part => this.matches(row, part))
      : row[condition.column.field] === condition.value;
  }
  select() {
    let table: Table;
    let condition: Condition;
    const chain = {
      from(value: Table) { table = value; return chain; },
      where(value: Condition) { condition = value; return chain; },
      limit: async (count: number) => structuredClone(this.state[table.name].filter(row => this.matches(row, condition)).slice(0, count)),
    };
    return chain;
  }
  update(table: Table) {
    return { set: (values: Row) => ({ where: async (condition: Condition) => {
      this.writes.push({ table: table.name, values: structuredClone(values) });
      const rows = this.state[table.name].filter(row => this.matches(row, condition));
      rows.forEach(row => {
        for (const [field, value] of Object.entries(values)) {
          row[field] = field === "version" && value && typeof value === "object" && "strings" in value
            ? row[field] + 1 : structuredClone(value);
        }
      });
      return [{ affectedRows: rows.length }];
    } }) };
  }
  insert(table: Table) {
    return { values: (values: Row) => {
      const insert = async () => {
        const rows = this.state[table.name];
        if (table.name === "delivery" && rows.some(row => row.bookingId === values.bookingId && row.channel === values.channel)) {
          throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
        }
        this.writes.push({ table: table.name, values: structuredClone(values) });
        const id = rows.length + 1;
        rows.push({ id, ...structuredClone(values) });
        return [{ insertId: id }];
      };
      return {
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => insert().then(resolve, reject),
        onDuplicateKeyUpdate: async () => insert(),
      };
    } };
  }
  transaction = async (callback: (tx: MemoryDb) => Promise<unknown>) => callback(this);
}

const input = { publicFunnelNumber: "mib-parity-test", mutationToken: "signed-funnel-token" };
const account = { id: 91, customerName: "Portal Customer", customerPhone: "+12025550123" };
const paymentMethod = {
  id: "pm_verified", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
};
const fullPageSources = ["book-page", "customer-booking-link", "madison-quote"];
let db: MemoryDb;
function fixture(source: string, paymentStatus = "setup_pending") {
  db.state.funnel = [{
    id: 41, source, publicFunnelNumber: input.publicFunnelNumber,
    idempotencyKey: "original-funnel-identity", bookingId: 7, stage: "payment_incomplete",
    customerName: "Submitted Customer", customerPhone: "+12025550123", customerEmail: "customer@example.com",
  }];
  db.state.profile = [{
    id: 17, bookingId: 7, funnelRecordId: 41, version: 1, paymentStatus,
    stripeCustomerId: "cus_existing", stripeSetupIntentId: "seti_existing",
    cardBrand: "visa", cardLast4: "4242",
  }];
  db.state.booking = [{
    id: 7, publicBookingNumber: "MIB-7", idempotencyKey: "original-booking-identity",
    source: "full_page", status: "pending_payment", paymentStatus, paymentMethod: "card",
    customerName: "Submitted Customer", customerPhone: "+12025550123", address: "123 Main Street",
    serviceName: "Deep Cleaning", bedrooms: 2, bathrooms: 2, extras: [],
    requestedLocalDate: "2027-02-15", requestedLocalTime: "14:30", firstCleaningTotalCents: 32123,
    bookedByAgentId: 9, bookedByAgentName: "Original Agent",
  }];
}
function context() {
  return { req: { protocol: "https", headers: {} as Record<string, string> }, res: { cookie: vi.fn() } };
}
function caller(ctx = context()) { return bookingPaymentRouter.createCaller(ctx); }
async function expectDirectCookie(ctx: ReturnType<typeof context>) {
  expect(mocks.ensureAccount).toHaveBeenCalledWith(db, {
    customerName: "Submitted Customer", customerPhone: "+12025550123", customerEmail: "customer@example.com",
  });
  expect(ctx.res.cookie).toHaveBeenCalledWith(CUSTOMER_PORTAL_COOKIE_NAME, expect.any(String), {
    httpOnly: true, path: "/", sameSite: "none", secure: true, maxAge: ONE_YEAR_MS,
  });
  const token = ctx.res.cookie.mock.calls.at(-1)![1];
  await expect(verifyCustomerPortalSession(token)).resolves.toEqual({
    accountId: account.id, customerName: account.customerName, customerPhone: account.customerPhone,
  });
  expect(mocks.handoff).not.toHaveBeenCalled();
}
async function authenticatedContext() {
  const ctx = context();
  await caller(ctx).startSetup(input);
  ctx.req.headers.cookie = `${CUSTOMER_PORTAL_COOKIE_NAME}=${ctx.res.cookie.mock.calls[0][1]}`;
  ctx.res.cookie.mockClear();
  mocks.ensureAccount.mockClear();
  return ctx;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.notificationJobs.length = 0;
  db = new MemoryDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.ensureAccount.mockResolvedValue(account);
  mocks.handoff.mockResolvedValue("existing-handoff-code");
  mocks.stripe.mockReturnValue({});
  mocks.verifySetup.mockResolvedValue(paymentMethod);
  mocks.paymentTarget.mockImplementation(async () => ({
    bookingId: 7, customerName: "Submitted Customer", profile: structuredClone(db.state.profile[0]),
  }));
  mocks.savedCard.mockResolvedValue({
    stripeCustomerId: "cus_saved", stripePaymentMethodId: "pm_saved", brand: "visa",
    last4: "4242", expMonth: 12, expYear: 2030,
  });
  mocks.sendSms.mockResolvedValue({ success: true, messageId: "sms_mock" });
});
afterEach(async () => {
  await Promise.all(mocks.notificationJobs);
  vi.restoreAllMocks();
});

describe("customer-link direct completion parity with /book", () => {
  it.each(fullPageSources)("sets the same signed cookie for %s already-saved card setup", async source => {
    fixture(source, "card_on_file");
    const ctx = context();
    await expect(caller(ctx).startSetup(input)).resolves.toMatchObject({
      alreadyComplete: true, bookingId: 7, directPortalSessionReady: true, portalAccessCode: null,
    });
    await expectDirectCookie(ctx);
    expect(mocks.stripe).not.toHaveBeenCalled();
    expect(db.state.funnel[0].source).toBe(source);
  });

  it.each(fullPageSources.flatMap(source => [undefined, "apple_pay", "google_pay"].map(wallet => ({ source, wallet }))))(
    "sets the same direct cookie for $source verified $wallet card and preserves deferred confirmation",
    async ({ source, wallet }) => {
      fixture(source);
      const ctx = context();
      const result = await caller(ctx).confirmSetup({
        ...input, paymentMethodId: paymentMethod.id, wallet: wallet as "apple_pay" | "google_pay" | undefined,
        consentAccepted: true, deferConfirmation: true,
      });
      expect(result).toMatchObject({
        bookingId: 7, paymentStatus: "card_on_file", directPortalSessionReady: true,
        portalAccessCode: null, finalizationRequired: true, cardBrand: "visa", cardLast4: "4242",
      });
      expect(mocks.verifySetup).toHaveBeenCalledWith({}, expect.objectContaining({
        bookingId: 7, bookingPaymentProfileId: 17, setupIntentId: "seti_existing", wallet,
      }));
      await expectDirectCookie(ctx);
      expect(db.state.booking[0]).toMatchObject({ status: "pending_payment", paymentMethod: wallet ?? "card", paymentStatus: "card_on_file" });
      expect(db.state.funnel[0]).toMatchObject({ source, stage: "payment_incomplete" });
      expect(mocks.notificationJobs).toHaveLength(0);
      expect(mocks.sendSms).not.toHaveBeenCalled();
    },
  );

  it.each(fullPageSources.flatMap(source => [false, true].map(alreadySaved => ({ source, alreadySaved }))))(
    "sets the same direct cookie for $source saved-card reuse (alreadySaved=$alreadySaved)",
    async ({ source, alreadySaved }) => {
      fixture(source, "card_on_file");
      const ctx = await authenticatedContext();
      if (!alreadySaved) db.state.profile[0].paymentStatus = "setup_pending";
      const result = await caller(ctx).reuseSavedCard({ ...input, deferConfirmation: true });
      expect(result).toMatchObject({ bookingId: 7, paymentStatus: "card_on_file", directPortalSessionReady: true, finalizationRequired: true });
      await expectDirectCookie(ctx);
      expect(mocks.savedCard).toHaveBeenCalledTimes(alreadySaved ? 0 : 1);
      expect(db.state.booking).toHaveLength(1);
      expect(db.state.funnel[0].source).toBe(source);
      expect(mocks.notificationJobs).toHaveLength(0);
    },
  );

  it.each(fullPageSources)("finalizes %s through shared engine with one four-channel delivery across retries", async source => {
    fixture(source, "card_on_file");
    db.state.booking[0].paymentMethod = "apple_pay";
    const ctx = context();
    const first = await caller(ctx).finalize(input);
    await Promise.all(mocks.notificationJobs);
    const second = await caller(ctx).finalize(input);
    await Promise.all(mocks.notificationJobs);
    expect(first).toEqual(second);
    expect(second).toMatchObject({ bookingId: 7, paymentStatus: "card_on_file", directPortalSessionReady: true });
    await expectDirectCookie(ctx);
    expect(db.state.booking).toHaveLength(1);
    expect(db.state.profile).toHaveLength(1);
    expect(db.state.funnel).toHaveLength(1);
    expect(db.state.booking[0]).toMatchObject({ id: 7, source: "full_page", idempotencyKey: "original-booking-identity", status: "needs_attention", paymentMethod: "apple_pay" });
    expect(db.state.funnel[0]).toMatchObject({ source, stage: "booked", idempotencyKey: "original-funnel-identity" });
    expect(mocks.notificationJobs).toHaveLength(2);
    expect(mocks.sendSms).toHaveBeenCalledTimes(3);
    expect(mocks.sendSms.mock.calls.map(([message]) => message.to)).toEqual(["+12025550123", "+12028885362", "+13029816191"]);
    expect(db.state.message).toHaveLength(1);
    expect(JSON.parse(db.state.message[0].metadata)).toMatchObject({ bookingId: 7, bookedByAgentId: 9, bookedByAgentName: "Original Agent" });
    expect(db.state.delivery).toHaveLength(4);
    expect(db.state.delivery.every(delivery => delivery.status === "sent")).toBe(true);
    expect(mocks.stripe).not.toHaveBeenCalled();
  });

  it.each(["startSetup", "confirmSetup"] as const)("preserves widget %s handoff without a direct cookie", async action => {
    fixture("widget-popup", action === "startSetup" ? "card_on_file" : "setup_pending");
    const ctx = context();
    const result = action === "startSetup"
      ? await caller(ctx).startSetup(input)
      : await caller(ctx).confirmSetup({ ...input, paymentMethodId: paymentMethod.id, consentAccepted: true, deferConfirmation: true });
    expect(result).toMatchObject({ directPortalSessionReady: false, portalAccessCode: "existing-handoff-code" });
    expect(mocks.ensureAccount).not.toHaveBeenCalled();
    expect(ctx.res.cookie).not.toHaveBeenCalled();
    expect(mocks.handoff).toHaveBeenCalledWith(db, {
      customerName: "Submitted Customer", customerPhone: "+12025550123", customerEmail: "customer@example.com",
    });
    expect(db.state.funnel[0].source).toBe("widget-popup");
  });

  it.each(["customer-booking-link", "madison-quote"])("preserves %s existing handoff fallback if direct-session creation fails", async source => {
    fixture(source);
    mocks.ensureAccount.mockRejectedValue(new Error("Account unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = context();
    await expect(caller(ctx).confirmSetup({ ...input, paymentMethodId: paymentMethod.id, consentAccepted: true, deferConfirmation: true })).resolves.toMatchObject({
      paymentStatus: "card_on_file", directPortalSessionReady: false, portalAccessCode: "existing-handoff-code",
    });
    expect(ctx.res.cookie).not.toHaveBeenCalled();
    expect(mocks.handoff).toHaveBeenCalledTimes(1);
    expect(db.state.booking[0].paymentStatus).toBe("card_on_file");
  });

  it("preserves /book's lack of a handoff when direct-session creation fails", async () => {
    fixture("book-page", "card_on_file");
    mocks.ensureAccount.mockRejectedValue(new Error("Account unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = context();
    await expect(caller(ctx).startSetup(input)).resolves.toMatchObject({ directPortalSessionReady: false, portalAccessCode: null });
    expect(ctx.res.cookie).not.toHaveBeenCalled();
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it("never establishes portal access when verified card setup fails", async () => {
    fixture("customer-booking-link");
    mocks.verifySetup.mockRejectedValue(new Error("Setup verification failed"));
    const ctx = context();
    await expect(caller(ctx).confirmSetup({ ...input, paymentMethodId: paymentMethod.id, consentAccepted: true })).rejects.toThrow("Setup verification failed");
    expect(mocks.ensureAccount).not.toHaveBeenCalled();
    expect(mocks.handoff).not.toHaveBeenCalled();
    expect(ctx.res.cookie).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });

  it("does not finalize a captured Cash App profile through the card completion route", async () => {
    fixture("customer-booking-link", "captured");
    db.state.booking[0].paymentMethod = "cashapp";
    const before = structuredClone(db.state);
    const ctx = context();
    await expect(caller(ctx).finalize(input)).rejects.toThrow("Add a card before confirming your booking.");
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(0);
    expect(mocks.ensureAccount).not.toHaveBeenCalled();
    expect(ctx.res.cookie).not.toHaveBeenCalled();
    expect(mocks.notificationJobs).toHaveLength(0);
  });
});

describe("quote workspace native payment summary", () => {
  const workspace = readFileSync(resolve(import.meta.dirname, "../client/src/components/NativeBookingsWorkspace.tsx"), "utf8");
  const compact = (source: string) => source.replace(/\s+/g, "");

  it("uses bound native Cash App status/method for quote rows without changing the source filter", () => {
    const quoteRows = workspace.slice(workspace.indexOf("const quoteRows ="), workspace.indexOf("const inProgressFunnelRows ="));
    expect(compact(quoteRows)).toContain('.filter(lead=>lead.source==="customer-booking-link")');
    expect(compact(quoteRows)).toContain('paymentMethod:(lead.paymentMethodasWorkspaceRow["paymentMethod"])??"card"');
    expect(compact(quoteRows)).toContain('paymentStatus:lead.paymentStatus??(lead.paymentLast4?"card_on_file":"not_started")');
    const unrelatedFunnels = workspace.slice(workspace.indexOf("const funnelRows ="), workspace.indexOf("const quoteRows ="));
    expect(unrelatedFunnels).toContain('paymentStatus: lead.paymentLast4 ? "card_on_file" : "not_started"');
    expect(unrelatedFunnels).not.toContain("lead.paymentMethod");
    expect(unrelatedFunnels).not.toContain("lead.paymentStatus");
  });

  it("uses the same summary only for selected customer-link quotes, preserving other selected funnels", () => {
    const detail = workspace.slice(workspace.indexOf("if (selectedFunnelId !== null && funnelDetailQuery.data)"), workspace.indexOf("return rows.find(row => row.key === activeKey)"));
    expect(compact(detail)).toContain('paymentStatus:lead.paymentLast4?"card_on_file":"not_started",...(lead.source==="customer-booking-link"?{paymentMethod:(lead.paymentMethodasWorkspaceRow["paymentMethod"])??"card",paymentStatus:lead.paymentStatus??(lead.paymentLast4?"card_on_file":"not_started"),}:{}),');
  });
});
