import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("booking-bound Stripe setup adapter", () => {
  it("accepts only the existing signed funnel identity and never looks up a payer by phone", () => {
    const source = read("server/bookingPaymentRouter.ts");
    const target = read("server/bookingPaymentTargetService.ts");
    expect(target).toContain("verifyBookingFunnelMutationToken");
    expect(source).toContain("publicFunnelNumber");
    expect(source).toContain("mutationToken");
    expect(source).not.toContain("stripeCustomers");
    expect(source).not.toMatch(/where\(eq\([^\n]*customerPhone/);
    expect(target).not.toMatch(/where\(eq\([^\n]*customerPhone/);
  });

  it("promotes only a reserved funnel to an existing native pending-payment booking", () => {
    const source = read("server/bookingPaymentTargetService.ts");
    expect(source).toContain('record.stage !== "payment_incomplete"');
    expect(source).toContain('initialBookingStatus: "pending_payment"');
    expect(source).toContain("persistCanonicalBooking(db, built.prepared");
    expect(source).toContain("bookingPaymentProfiles.bookingId, persisted.bookingId");
  });

  it("uses a SetupIntent to save the card and does not auto-confirm or charge the booking", () => {
    const source = read("server/bookingPaymentRouter.ts");
    const engine = read("server/bookingPaymentEngine.ts");
    expect(engine).toContain('usage: "off_session"');
    expect(engine).toContain('paymentStatus: "setup_pending"');
    expect(engine).toContain('status: input.deferConfirmation ? "pending_payment" : "needs_attention", paymentStatus: "card_on_file"');
    expect(source).not.toContain('status: "confirmed"');
    expect(source).not.toContain("paymentIntents.create");
    expect(source).not.toContain("paymentIntents.capture");
    expect(source).not.toContain("paymentIntents.cancel");
  });

  it("requires server-side Stripe ownership and metadata verification before accepting saved-card metadata", () => {
    const verification = read("server/bookingPaymentVerification.ts");
    expect(verification).toContain("setupIntent.status !== \"succeeded\"");
    expect(verification).toContain("setupIntent.payment_method !== input.paymentMethodId");
    expect(verification).toContain("setupIntent.customer !== input.stripeCustomerId");
    expect(verification).toContain("metadata.bookingId !== String(input.bookingId)");
    expect(verification).toContain("metadata.bookingPaymentProfileId !== String(input.bookingPaymentProfileId)");
    expect(verification).toContain("paymentMethod.customer !== input.stripeCustomerId");
  });
});
