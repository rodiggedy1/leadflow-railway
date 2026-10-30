import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("booking wallet provenance in CRM", () => {
  it("labels delayed Apple Pay and Google Pay saved cards in both native booking views", () => {
    const workspace = read("client/src/components/NativeBookingsWorkspace.tsx");
    const crm = read("client/src/pages/BookingsCRMExactLive.tsx");

    expect(workspace).toContain('value === "google_pay"');
    expect(workspace).toContain('row.paymentMethod === "apple_pay" || row.paymentMethod === "google_pay"');
    expect(workspace).toContain("`${labelPaymentMethod(row.paymentMethod)} card on file");
    expect(crm).toContain('value === "google_pay" ? "Google Pay"');
    expect(crm).toContain('row.paymentMethod === "apple_pay" || row.paymentMethod === "google_pay"');
    expect(crm).toContain("`${labelPaymentMethod(row.paymentMethod)} card on file");
  });

  it("keeps verified wallet cards in the existing saved-card action path", () => {
    const actions = read("client/src/components/BookingPaymentActions.tsx");

    expect(actions).toContain('paymentStatus === "card_on_file"');
    expect(actions).toContain("function savedWalletLabel");
    expect(actions).toContain('paymentMethod === "apple_pay"');
    expect(actions).toContain('paymentMethod === "google_pay"');
    expect(actions).toContain("`${walletLabel} card on file");
    expect(actions).toContain("placeHold.mutate({ bookingId, confirmed: true })");
    expect(actions).toContain("chargeCard.mutate({ bookingId, confirmed: true })");
    expect(actions).not.toContain("walletPayment");
  });

  it("retains separate historical immediate-payment labels", () => {
    const actions = read("client/src/components/BookingPaymentActions.tsx");

    expect(actions).toContain('paymentStatus === "captured"');
    expect(actions).toContain('paymentMethod === "apple_pay" && paymentStatus === "captured"');
    expect(actions).toContain('paymentMethod === "google_pay" && paymentStatus === "captured"');
    expect(actions).toContain('paymentMethod === "cashapp"');
    expect(actions).toContain("Apple Pay · paid");
    expect(actions).toContain("Google Pay · paid");
    expect(actions).toContain("Cash App · paid");
  });
});
