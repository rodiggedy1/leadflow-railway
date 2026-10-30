import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("booking Stripe webhook route", () => {
  it("registers a raw-body signed endpoint before the JSON parser", () => {
    const bootstrap = read("server/_core/index.ts");
    const webhook = read("server/stripeWebhookRoute.ts");
    expect(webhook).toContain('app.post("/api/stripe/webhook", express.raw');
    expect(webhook).toContain("webhooks.constructEvent(req.body, signature, ENV.stripeWebhookSecret)");
    expect(bootstrap.indexOf("registerStripeWebhookRoute(app)")).toBeLessThan(bootstrap.indexOf("app.use(express.json"));
  });

  it("records and de-duplicates provider events before reconciling an existing bound profile or an existing Apple Pay attempt", () => {
    const webhook = read("server/stripeWebhookRoute.ts");
    expect(webhook).toContain("stripeWebhookEvents");
    expect(webhook).toContain("isDuplicateEntry(error)");
    expect(webhook).toContain('return res.status(200).json({ received: true, duplicate: true })');
    expect(webhook).toContain("bookingPaymentProfiles.id, profileId");
    expect(webhook).toContain("bookingPaymentProfiles.bookingId, bookingId");
    expect(webhook).toContain("if (!profile) return null");
    expect(webhook).toContain("if (!booking) return null");
    expect(webhook).toContain('object.metadata?.operation === "apple_pay_first_cleaning"');
    expect(webhook).toContain("settleSucceededApplePayPayment(db, object)");
    expect(webhook).toContain("markApplePayPaymentUnavailable(db, object");
    expect(webhook).not.toContain("insert(bookings)");
    expect(webhook).not.toContain("insert(bookingPaymentProfiles)");
    expect(webhook).not.toContain("customers.create");
  });

  it("reconciles provider status without placing a hold, capture, or charge", () => {
    const webhook = read("server/stripeWebhookRoute.ts");
    expect(webhook).toContain("setup_intent.succeeded");
    expect(webhook).toContain("payment_intent.amount_capturable_updated");
    expect(webhook).toContain("payment_intent.succeeded");
    expect(webhook).toContain("payment_intent.payment_failed");
    expect(webhook).not.toContain("paymentIntents.create");
    expect(webhook).not.toContain("paymentIntents.capture");
    expect(webhook).not.toContain("paymentIntents.cancel");
  });

  it("mirrors a verified booking card into the existing Cards on File source", () => {
    const webhook = read("server/stripeWebhookRoute.ts");
    expect(webhook).toContain("stripeCustomers");
    expect(webhook).toContain("paymentMethods.retrieve(paymentMethodId)");
    expect(webhook).toContain("paymentMethod.customer !== bound.profile.stripeCustomerId");
    expect(webhook).toContain("await tx.insert(stripeCustomers).values({");
    expect(webhook).toContain("phone: bound.booking.customerPhone");
    expect(webhook).toContain("stripePaymentMethodId: paymentMethod.id");
    expect(webhook).toContain("onDuplicateKeyUpdate({ set:");
  });

  it("can promote only a marked existing pending authorization after a signed manual-capture event", () => {
    const webhook = read("server/stripeWebhookRoute.ts");
    expect(webhook).toContain("promoteMarkedPendingAuthorization");
    expect(webhook).toContain('object.metadata?.leadflowAuthorizationAttempt !== "v1"');
    expect(webhook).toContain('eq(paymentAuthorizations.status, "pending")');
    expect(webhook).toContain("object.amount_capturable === pending.amountCents");
    expect(webhook).toContain("object.metadata.customerPhone !== pending.customerPhone");
    expect(webhook).toContain("status: \"authorized\"");
    expect(webhook).not.toContain("tx.insert(paymentAuthorizations)");
  });
});
