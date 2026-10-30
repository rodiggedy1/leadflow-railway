import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("booking Stripe webhook route", () => {
  it("registers a signed raw-body endpoint and settles only the booking-bound Cash App intent before generic reconciliation", () => {
    const bootstrap = read("server/_core/index.ts");
    const webhook = read("server/stripeWebhookRoute.ts");
    expect(webhook).toContain('app.post("/api/stripe/webhook", express.raw');
    expect(webhook).toContain("webhooks.constructEvent(req.body, signature, ENV.stripeWebhookSecret)");
    expect(bootstrap.indexOf("registerStripeWebhookRoute(app)")).toBeLessThan(bootstrap.indexOf("app.use(express.json"));
    expect(webhook).toContain('object.metadata?.operation === "cash_app_first_cleaning"');
    expect(webhook).toContain("settleSucceededCashAppPayment(db, object)");
    expect(webhook).toContain("markCashAppPaymentUnavailable(db, object");
    expect(webhook.indexOf('object.metadata?.operation === "cash_app_first_cleaning"')).toBeLessThan(webhook.indexOf("const bound = await findBoundProfile(object)"));
    expect(webhook).not.toContain("apple_pay_first_cleaning");
  });

  it("does not create, capture, or cancel payments from a webhook", () => {
    const webhook = read("server/stripeWebhookRoute.ts");
    expect(webhook).not.toContain("paymentIntents.create");
    expect(webhook).not.toContain("paymentIntents.capture");
    expect(webhook).not.toContain("paymentIntents.cancel");
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
