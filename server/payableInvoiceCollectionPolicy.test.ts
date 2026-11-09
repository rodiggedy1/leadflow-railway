import { describe, expect, it } from "vitest";
import { invoiceOccurrence, observedCollectionReason, validServiceStatus } from "./payableInvoiceCollectionPolicy";

describe("invoice collection observations", () => {
  it("accepts only exact stable positive occurrence identities", () => {
    expect(invoiceOccurrence("job:12")).toEqual({ kind: "job", id: 12 });
    expect(invoiceOccurrence("booking:3:first:2026-11-02")).toEqual({ kind: "booking", id: 3, date: "2026-11-02" });
    for (const invalid of ["job:0", "job:01", "job:12:other", "booking:3:first:2026-02-30", "owner@example.test", "job:9007199254740993"]) expect(() => invoiceOccurrence(invalid)).toThrow();
  });
  it.each(["captured", "paid", "succeeded", "charged", "payment_charged"])("excludes observed %s payments", status => {
    expect(observedCollectionReason({ status })).toMatch(/captured or charged/);
  });
  it.each(["pending", "pending_card", "authorization_pending", "authorized", "capture_pending", "charge_pending", "processing", "requires_capture", "action_required"])("excludes %s collector reservations", status => {
    expect(observedCollectionReason({ status })).toMatch(/pending payment or authorized/);
  });
  it("checks capture timestamps even if the displayed status was overwritten", () => {
    expect(observedCollectionReason({ status: "failed", capturedAt: 1 })).toMatch(/captured/);
    expect(observedCollectionReason({ status: "cancelled", paidAt: 1 })).toMatch(/captured/);
    expect(observedCollectionReason({ status: "not_started", paymentChargedAt: 1 })).toMatch(/captured/);
  });
  it("never uses a local clock to release unresolved intent/hold ownership", () => {
    expect(observedCollectionReason({ status: "authorized", authorizedAt: 1 })).toMatch(/authorized/);
    expect(observedCollectionReason({ status: "not_started", stripePaymentIntentId: "pi_observed" })).toMatch(/unresolved/);
  });
  it("does not mistake a saved card or failed/cancelled intent for payment", () => {
    for (const paymentStatus of ["not_started", "card_on_file", "setup_pending"]) expect(observedCollectionReason({ paymentStatus })).toBeNull();
    for (const status of ["failed", "expired", "cancelled"]) expect(observedCollectionReason({ status, stripePaymentIntentId: "pi_cancelled", authorizedAt: 1 })).toBeNull();
  });
  it("keeps blank status invalid instead of fabricating unpaid state", () => {
    expect(observedCollectionReason({ status: "" })).toMatch(/no valid status/);
    expect(validServiceStatus("")).toBe(false);
    expect(validServiceStatus("completed")).toBe(true);
    expect(validServiceStatus("cancelled")).toBe(false);
  });
});
