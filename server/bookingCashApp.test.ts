import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("public booking Cash App immediate payment", () => {
  it("creates a Cash App PaymentIntent for the server-authoritative first-booking total without saving a reusable credential", () => {
    const engine = read("server/bookingCashAppEngine.ts");
    const router = read("server/bookingCashAppRouter.ts");
    expect(engine).toContain('const CASH_APP_OPERATION = "cash_app_first_cleaning"');
    expect(engine).toContain("stripe.paymentIntents.create(");
    expect(engine).toContain("amount: input.amountCents");
    expect(engine).toContain('currency: "usd"');
    expect(engine).toContain('payment_method_types: ["cashapp"]');
    expect(engine).toContain('paymentMethod: "cashapp"');
    expect(engine).not.toContain("setupIntents.create");
    expect(engine).not.toContain("setup_future_usage");
    expect(engine).not.toContain("customers.create");
    expect(router).toContain("ensurePublicBookingPaymentTarget(record)");
    expect(router).toContain("amountCents: target.totalCents");
  });

  it("leaves Cash App available for every booking frequency with no invented recurrence gate", () => {
    const router = read("server/bookingCashAppRouter.ts");
    const book = read("client/src/pages/Book.tsx");
    expect(router).not.toContain('booking.recurrence !== "one-time"');
    expect(router).not.toContain("one-time bookings only");
    expect(book).toContain('onClick={() => onPaymentMethodChange("cashapp")}');
    expect(book).toContain("Pay with Cash App");
  });

  it("ties settlement to the existing booking and profile, validates Cash App, and completes once", () => {
    const engine = read("server/bookingCashAppEngine.ts");
    expect(engine).toContain("intent.metadata.bookingId !== String(payment.bookingId)");
    expect(engine).toContain("intent.metadata.bookingPaymentProfileId !==");
    expect(engine).toContain('paymentMethod.type !== "cashapp"');
    expect(engine).toContain('status: "paid"');
    expect(engine).toContain('paymentStatus: "captured"');
    expect(engine).toContain('paymentMethod: "cashapp"');
    expect(engine).toContain('set({ stage: "booked", updatedAt: now })');
    expect(engine).toContain("sendBookingCompletionNotifications(payment.bookingId)");
    expect(engine).toContain('payment.status === "paid" && funnel.stage === "booked"');
  });

  it("uses the same idempotent settlement from both the return page and signed Stripe webhooks", () => {
    const router = read("server/bookingCashAppRouter.ts");
    const webhook = read("server/stripeWebhookRoute.ts");
    expect(router).toContain("returnStatus: publicProcedure");
    expect(router).toContain("settleSucceededCashAppPayment(db, intent)");
    expect(webhook).toContain("settleSucceededCashAppPayment(db, object)");
    expect(webhook.indexOf('object.metadata?.operation === "cash_app_first_cleaning"')).toBeLessThan(
      webhook.indexOf("const bound = await findBoundProfile(object)")
    );
  });

  it("records an additive durable ledger and an opaque return capability", () => {
    const schema = read("drizzle/schema.ts");
    const manifest = JSON.parse(read("server/versioned-migrations/manifest.json"));
    const migration = manifest.migrations.find(
      (entry: { id: string }) => entry.id === "0071_create_booking_cash_app_payments"
    );
    expect(schema).toContain('mysqlTable("booking_cash_app_payments"');
    expect(schema).toContain('uniqueIndex("uq_booking_cash_app_payment_intent")');
    expect(schema).toContain('uniqueIndex("uq_booking_cash_app_idempotency")');
    expect(schema).toContain('uniqueIndex("uq_booking_cash_app_return_token")');
    expect(migration).toBeDefined();
    const sql = read(`server/versioned-migrations/${migration.sqlFile}`);
    expect(migration.sha256).toBe(createHash("sha256").update(sql).digest("hex"));
    expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
  });

  it("keeps Card on file and Apple Pay available while Cash App starts Stripe's native flow from its selection", () => {
    const component = read("client/src/components/BookingCashAppCheckout.tsx");
    const book = read("client/src/pages/Book.tsx");
    const engine = read("server/bookingCashAppEngine.ts");
    const card = read("client/src/components/BookingPaymentCheckout.tsx");
    const cashRouter = read("server/cashAppRouter.ts");
    expect(component).toContain("stripe.confirmCashappPayment");
    expect(engine).toContain('payment_method_types: ["cashapp"]');
    expect(component).toContain("return_url:");
    expect(component).toContain("trpc.cashApp.booking.prepare.useMutation");
    expect(component).toContain("trpc.cashApp.booking.settle.useMutation");
    expect(component).not.toContain("PaymentElement");
    expect(component).not.toContain("Continue with Cash App");
    expect(component).not.toContain("generateLink");
    expect(book).toContain("<PublicBookingCardSetupBeforeReservation");
    expect(book).toContain("<BookingApplePayCheckout");
    expect(book).toContain("<BookingCashAppCheckout");
    expect(book).toContain('"card" | "apple_pay" | "cashapp" | null');
    expect(book).toContain('selectedPaymentMethod === "cashapp" ? " is-open" : ""');
    expect(book).toContain("onCashAppPaid={totalCents =>");
    expect(book).toContain('onPaid={onCashAppPaid}');
    expect(book).toContain('className="literal-book-cashapp-return"');
    expect(book).toContain("123 Google reviews");
    expect(cashRouter).toContain("booking: bookingCashAppRouter");
    expect(cashRouter).toContain("generateLink: agentProcedure");
    expect(card).toContain("InternalCardSetupForm");
  });
});
