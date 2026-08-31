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

  it("records and de-duplicates provider events before reconciling only an existing bound profile", () => {
    const webhook = read("server/stripeWebhookRoute.ts");
    expect(webhook).toContain("stripeWebhookEvents");
    expect(webhook).toContain("isDuplicateEntry(error)");
    expect(webhook).toContain('return res.status(200).json({ received: true, duplicate: true })');
    expect(webhook).toContain("bookingPaymentProfiles.id, profileId");
    expect(webhook).toContain("bookingPaymentProfiles.bookingId, bookingId");
    expect(webhook).toContain("if (!profile) return null");
    expect(webhook).toContain("if (!booking) return null");
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
});
