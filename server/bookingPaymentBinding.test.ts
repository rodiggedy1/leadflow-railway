import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("booking-bound Stripe setup adapter", () => {
  it("accepts only the existing signed funnel identity and never looks up a payer by phone", () => {
    const source = read("server/bookingPaymentRouter.ts");
    expect(source).toContain("verifyBookingFunnelMutationToken");
    expect(source).toContain("publicFunnelNumber");
    expect(source).toContain("mutationToken");
    expect(source).not.toContain("stripeCustomers");
    expect(source).not.toMatch(/where\(eq\([^\n]*customerPhone/);
    expect(source).toContain("bookingPaymentMetadata(target.bookingId, target.profile.id)");
  });

  it("promotes only a reserved funnel to an existing native pending-payment booking", () => {
    const source = read("server/bookingPaymentRouter.ts");
    expect(source).toContain('record.stage !== "payment_incomplete"');
    expect(source).toContain('status: "pending_payment"');
    expect(source).toContain('paymentStatus: "not_started"');
    expect(source).toContain('bookingId, updatedAt: new Date()');
  });

  it("uses a SetupIntent to save the card and does not auto-confirm or charge the booking", () => {
    const source = read("server/bookingPaymentRouter.ts");
    expect(source).toContain('usage: "off_session"');
    expect(source).toContain('paymentStatus: "setup_pending"');
    expect(source).toContain('status: "needs_attention", paymentStatus: "card_on_file"');
    expect(source).not.toContain('status: "confirmed"');
    expect(source).not.toContain("paymentIntents.create");
    expect(source).not.toContain("paymentIntents.capture");
    expect(source).not.toContain("paymentIntents.cancel");
  });

  it("requires server-side Stripe ownership and metadata verification before accepting saved-card metadata", () => {
    const source = read("server/bookingPaymentRouter.ts");
    expect(source).toContain("setupIntent.status !== \"succeeded\"");
    expect(source).toContain("setupIntent.payment_method !== input.paymentMethodId");
    expect(source).toContain("setupIntent.customer !== profile.stripeCustomerId");
    expect(source).toContain("metadata.bookingId !== String(record.bookingId)");
    expect(source).toContain("metadata.bookingPaymentProfileId !== String(profile.id)");
    expect(source).toContain("paymentMethod.customer !== profile.stripeCustomerId");
  });
});
