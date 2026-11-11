import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const base = "7120deaac50e8bdf9f231517131bc5318d6e64ea";
const schemas = Object.fromEntries(["bookingCashAppPayments", "bookingFunnelRecords", "bookingPaymentProfiles", "bookings", "stripeCustomers"].map(name => [name, new Proxy({ name }, { get: (target, field: string) => field === "name" ? name : `${name}.${field}` })]));

async function execute(source: string, operation: string, scenario: string) {
  const trace: unknown[] = [];
  const profile = { id: 2, bookingId: 1, version: 3, paymentStatus: "not_started", stripeCustomerId: null, stripeSetupIntentId: null, stripePaymentIntentId: "pi_test", cardBrand: "visa", cardLast4: "4242" };
  if (scenario === "saved") Object.assign(profile, { paymentStatus: "card_on_file" });
  if (scenario === "existing_setup") Object.assign(profile, { stripeCustomerId: "cus_test", stripeSetupIntentId: "seti_test" });
  const payment = { id: 4, bookingId: 1, bookingPaymentProfileId: 2, stripePaymentIntentId: "pi_test", amountCents: 32123, currency: "usd", status: "pending", returnToken: "return_test", attempt: 3 };
  const booking = { id: 1, firstCleaningTotalCents: 32123, priceSnapshot: {} };
  const funnel = { id: 5, stage: "payment_incomplete" };
  const intent = { id: "pi_test", client_secret: "pi_secret", status: operation === "settleSucceededCashAppPayment" ? "succeeded" : scenario === "abandon_canceled" ? "canceled" : scenario === "abandon_failed" ? "requires_payment_method" : "requires_action", amount: 32123, currency: "usd", payment_method: "pm_cash", metadata: { bookingId: "1", bookingPaymentProfileId: "2", operation: "cash_app_first_cleaning", paymentMethod: "cashapp" } };
  const stripeMethod = (name: string, result: unknown) => async (...args: unknown[]) => { trace.push([name, ...args]); return result; };
  const stripe = {
    customers: { create: stripeMethod("customer.create", { id: "cus_test" }), retrieve: stripeMethod("customer.retrieve", { id: "cus_test" }) },
    setupIntents: { create: stripeMethod("setup.create", { id: "seti_test", client_secret: "seti_secret" }), retrieve: stripeMethod("setup.retrieve", { id: "seti_test", client_secret: "seti_secret", status: "requires_payment_method" }) },
    paymentIntents: { create: stripeMethod("intent.create", intent), retrieve: stripeMethod("intent.retrieve", intent), cancel: stripeMethod("intent.cancel", { ...intent, status: "canceled" }) },
    paymentMethods: { retrieve: stripeMethod("method.retrieve", { id: "pm_cash", type: "cashapp" }) },
  };
  const db: any = {
    transaction: async (callback: (tx: any) => Promise<unknown>) => { trace.push(["transaction.begin"]); const result = await callback(db); trace.push(["transaction.commit"]); return result; },
    select: () => {
      let table: any; let filter: unknown; let limit: unknown;
      const chain = { from(value: any) { table = value; return chain; }, where(value: unknown) { filter = value; return chain; }, limit(value: unknown) { limit = value; return chain; }, async then(resolve: (value: unknown) => unknown) {
        trace.push(["select", table.name, filter, limit]);
        const rows = table.name === "bookingCashAppPayments" ? (scenario === "fresh" ? [] : [payment]) : table.name === "bookingPaymentProfiles" ? [profile] : table.name === "bookings" ? [booking] : table.name === "bookingFunnelRecords" ? [funnel] : [];
        return resolve(rows);
      } }; return chain;
    },
    update: (table: any) => ({ set: (values: unknown) => ({ where: async (filter: unknown) => { trace.push(["update", table.name, values, filter]); return [{ affectedRows: 1 }]; } }) }),
    insert: (table: any) => ({ values: (values: unknown) => { const write = () => { trace.push(["insert", table.name, values]); return [{ affectedRows: 1 }]; }; return { then: (resolve: (value: unknown) => unknown) => resolve(write()), onDuplicateKeyUpdate: async (options: unknown) => { trace.push(["upsert", options]); return write(); } }; } }),
  };
  class FixedDate extends Date { constructor(...args: any[]) { super(args.length ? args[0] : 1893456000000); } static now() { return 1893456000000; } }
  const modules: Record<string, unknown> = {
    "node:crypto": { randomUUID: () => "opaque-test-return-token" },
    "drizzle-orm": { and: (...values: unknown[]) => ["and", ...values], eq: (...values: unknown[]) => ["eq", ...values], sql: (strings: TemplateStringsArray, ...values: unknown[]) => ["sql", [...strings], ...values] },
    "@trpc/server": { TRPCError: class extends Error {} },
    "../drizzle/schema": schemas,
    "../shared/bookingPayment": { BOOKING_PAYMENT_CONSENT_TEXT: "consent", BOOKING_PAYMENT_CONSENT_VERSION: "version" },
    "./bookingLifecycleService": { syncNativeBookingPaymentState: async (_tx: unknown, input: unknown) => { trace.push(["projection", input]); } },
    "./bookingPaymentService": { bookingPaymentMetadata: (bookingId: number, profileId: number) => ({ bookingId: String(bookingId), bookingPaymentProfileId: String(profileId) }), bookingPaymentIdempotencyKey: (...args: unknown[]) => args.join(":") },
    "./stripeClient": { getStripeClient: () => stripe },
    "./sseBroadcast": { broadcastOpsUpdate: (event: unknown) => { trace.push(["broadcast", event]); } },
    "./bookingCompletionNotifications": { sendBookingCompletionNotifications: async (id: unknown) => { trace.push(["notification", id]); } },
    "./internalExactBookingMarker": { hasInternalExactMarker: (snapshot: any) => !!snapshot?.internalExactForm, lockInternalExactBooking: async () => { throw new Error("Public path entered the internal guard"); }, exactConflict: () => { throw new Error("Public path entered internal conflict logic"); } },
  };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: Record<string, (...args: any[]) => Promise<unknown>> = {};
  const context = { exports, require: (name: string) => { if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`); return modules[name]; }, Date: FixedDate, console: { error: () => undefined } };
  vm.runInNewContext(output, context);
  const setupInput = { bookingId: 1, customerName: "Test Customer", profile };
  const cashInput = { bookingId: 1, funnelId: 5, profile, amountCents: 32123, publicBookingNumber: "MIB-TEST" };
  const cardInput = { bookingId: 1, profileId: 2, profileVersion: 3, funnelId: 5, stripeCustomerId: "cus_test", customerName: "Test Customer", customerPhone: "+12025550123", paymentMethod: { id: "pm_card", brand: "visa", last4: "4242", exp_month: 1, exp_year: 2040 }, deferConfirmation: true };
  let result: unknown;
  if (operation === "startCanonicalCardSetup") result = await exports[operation](db, setupInput);
  else if (operation === "finalizeCanonicalCardOnFile") result = await exports[operation](db, cardInput);
  else if (operation === "finalizeCanonicalBooking") result = await exports[operation](db, { bookingId: 1, funnelId: 5 });
  else if (operation === "createOrReuseCashAppPaymentIntent") result = await exports[operation](db, cashInput);
  else if (operation === "settleSucceededCashAppPayment") result = await exports[operation](db, intent);
  else if (operation === "markCashAppPaymentUnavailable") result = await exports[operation](db, intent, "failed");
  else result = await exports[operation](db, { bookingId: 1, paymentIntentId: "pi_test" });
  return JSON.parse(JSON.stringify({ result, trace }));
}

describe("public payment execution preservation", () => {
  it.each([
    ["bookingPaymentEngine.ts", "startCanonicalCardSetup", "fresh"],
    ["bookingPaymentEngine.ts", "startCanonicalCardSetup", "saved"],
    ["bookingPaymentEngine.ts", "startCanonicalCardSetup", "existing_setup"],
    ["bookingPaymentEngine.ts", "finalizeCanonicalCardOnFile", "fresh"],
    ["bookingPaymentEngine.ts", "finalizeCanonicalBooking", "fresh"],
    ["bookingCashAppEngine.ts", "createOrReuseCashAppPaymentIntent", "fresh"],
    ["bookingCashAppEngine.ts", "createOrReuseCashAppPaymentIntent", "existing"],
    ["bookingCashAppEngine.ts", "settleSucceededCashAppPayment", "existing"],
    ["bookingCashAppEngine.ts", "markCashAppPaymentUnavailable", "existing"],
    ["bookingCashAppEngine.ts", "abandonCashAppPayment", "abandon_failed"],
    ["bookingCashAppEngine.ts", "abandonCashAppPayment", "abandon_canceled"],
  ])("preserves %s %s %s query/provider/effect/result trace exactly", async (file, operation, scenario) => {
    const old = execFileSync("git", ["show", `${base}:server/${file}`], { cwd: root, encoding: "utf8" });
    const current = fs.readFileSync(path.join(root, "server", file), "utf8");
    expect(await execute(current, operation, scenario)).toEqual(await execute(old, operation, scenario));
  });
});
