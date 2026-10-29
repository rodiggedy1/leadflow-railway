import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("public booking Apple Pay immediate payment", () => {
  it("creates an Apple-Pay-only PaymentIntent for the server-authoritative first-cleaning total without saving a reusable wallet credential", () => {
    const engine = read("server/bookingApplePayEngine.ts");
    const router = read("server/bookingApplePayRouter.ts");
    expect(engine).toContain('const APPLE_PAY_OPERATION = "apple_pay_first_cleaning"');
    expect(engine).toContain("stripe.paymentIntents.create(");
    expect(engine).toContain("amount: input.amountCents");
    expect(engine).toContain('currency: "usd"');
    expect(engine).toContain('payment_method_types: ["card"]');
    expect(engine).toContain('wallet: "apple_pay"');
    expect(engine).not.toContain("setupIntents.create");
    expect(engine).not.toContain("setup_future_usage");
    expect(engine).not.toContain("customers.create");
    expect(router).toContain("createPublicBookingPriceSnapshot(input.pricing)");
    expect(router).toContain("ensurePublicBookingPaymentTarget(record)");
    expect(router).toContain("amountCents: target.totalCents");
  });

  it("ties settlement to the existing booking and profile, validates the Stripe wallet, then finalizes exactly once", () => {
    const engine = read("server/bookingApplePayEngine.ts");
    expect(engine).toContain("intent.metadata.bookingId !== String(payment.bookingId)");
    expect(engine).toContain("intent.metadata.bookingPaymentProfileId !==");
    expect(engine).toContain('paymentMethod.card.wallet?.type !== "apple_pay"');
    expect(engine).toContain('status: "paid"');
    expect(engine).toContain('paymentStatus: "captured"');
    expect(engine).toContain('paymentMethod: "apple_pay"');
    expect(engine).toContain('set({ stage: "booked", updatedAt: now })');
    expect(engine).toContain("sendBookingCompletionNotifications(payment.bookingId)");
    expect(engine).toContain('payment.status === "paid" && funnel.stage === "booked"');
  });

  it("handles client-before-webhook and webhook-before-client ordering through the same idempotent settlement function", () => {
    const router = read("server/bookingApplePayRouter.ts");
    const webhook = read("server/stripeWebhookRoute.ts");
    expect(router).toContain("settleSucceededApplePayPayment(db, intent)");
    expect(webhook).toContain("settleSucceededApplePayPayment(db, object)");
    expect(webhook.indexOf('object.metadata?.operation === "apple_pay_first_cleaning"')).toBeLessThan(webhook.indexOf("const bound = await findBoundProfile(object)"));
  });

  it("records a durable additive ledger with unique intent, idempotency, and booking-attempt keys", () => {
    const schema = read("drizzle/schema.ts");
    const manifest = JSON.parse(read("server/versioned-migrations/manifest.json"));
    const migration = manifest.migrations.find((entry: { id: string }) => entry.id === "0070_create_booking_apple_pay_payments");
    expect(schema).toContain('mysqlTable("booking_apple_pay_payments"');
    expect(schema).toContain('uniqueIndex("uq_booking_apple_pay_payment_intent")');
    expect(schema).toContain('uniqueIndex("uq_booking_apple_pay_idempotency")');
    expect(schema).toContain('uniqueIndex("uq_booking_apple_pay_booking_attempt")');
    expect(migration).toBeDefined();
    const sql = read(`server/versioned-migrations/${migration.sqlFile}`);
    expect(migration.sha256).toBe(createHash("sha256").update(sql).digest("hex"));
    expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
  });

  it("keeps historical immediate Apple Pay reconciliation intact while new Apple Pay and Google Pay selections use canonical delayed card setup", () => {
    const component = read("client/src/components/BookingApplePayCheckout.tsx");
    const book = read("client/src/pages/Book.tsx");
    const card = read("client/src/components/BookingPaymentCheckout.tsx");
    expect(component).toContain("ExpressCheckoutElement");
    expect(component).toContain('type Wallet = "apple_pay" | "google_pay"');
    expect(component).toContain('mode: "setup"');
    expect(component).toContain('setupFutureUsage: "off_session"');
    expect(component).toContain("stripe.confirmSetup");
    expect(component).toContain("return_url: window.location.href");
    expect(component).toContain("trpc.bookingPayments.startSetup.useMutation");
    expect(component).toContain("trpc.bookingPayments.confirmSetup.useMutation");
    expect(component).toContain("deferredPaymentRequest");
    expect(component).not.toContain("trpc.bookingApplePay.prepare.useMutation");
    expect(component).not.toContain("stripe.confirmPayment");
    expect(component).toContain('layout: { maxColumns: 1, maxRows: 1, overflow: "auto" as const }');
    expect(component).not.toContain('maxRows: 1, overflow: "never"');
    expect(component).toContain("onAvailablePaymentMethodsChange");
    expect(component).toContain("available === true");
    expect(component).toContain("onLoadError={event =>");
    expect(component).toContain("could not initialize: ${event.error.message}");
    expect(component).not.toContain("ApplePaySession");
    expect(component).not.toContain("qr");
    expect(book).toContain("<PublicBookingCardSetupBeforeReservation");
    expect(book).toContain("<BookingWalletCardOnFileCheckout");
    expect(book).toContain('selectedPaymentMethod, setSelectedPaymentMethod');
    expect(book).toContain('onClick={() => onPaymentMethodChange("apple_pay")}');
    expect(book).toContain('onClick={() => onPaymentMethodChange("google_pay")}');
    expect(book).toContain("Apple Pay is not available in this browser or Wallet.");
    expect(book).toContain("Google Pay is not available in this browser or Wallet.");
    expect(book).toContain("Apple Pay is securely saved at booking and charged once the cleaning is completed.");
    expect(book).toContain("Google Pay is securely saved at booking and charged once the cleaning is completed.");
    expect(book).not.toContain("Apple Pay charged today");
    expect(card).toContain("InternalCardSetupForm");
  });
});
