import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("manual booking payment actions", () => {
  it("exposes only staff-authorized hold, capture, cancellation, and direct-charge actions", () => {
    const source = read("server/bookingPaymentAdminRouter.ts");
    const engine = read("server/bookingPaymentActionsEngine.ts");
    for (const action of ["getForBooking", "placeHold", "captureHold", "cancelHold", "chargeSavedCard"]) expect(source).toContain(`${action}: agentProcedure`);
    expect(source).toContain("confirmed: z.literal(true)");
    expect(engine).toContain('capture_method: "manual"');
    expect(engine).toContain("paymentIntents.capture");
    expect(engine).toContain("paymentIntents.cancel");
    expect(engine).toContain("paymentIntents.create");
  });

  it("uses the booking-bound saved card and locked booking total without phone customer lookup", () => {
    const source = read("server/bookingPaymentAdminRouter.ts");
    const engine = read("server/bookingPaymentActionsEngine.ts");
    expect(source).toContain("bookingPaymentProfiles.bookingId");
    expect(source).toContain("booking.firstCleaningTotalCents");
    expect(engine).toContain("bookingPaymentMetadata(input.bookingId, input.profileId)");
    expect(source).not.toMatch(/where\(eq\([^\n]*customerPhone/);
  });

  it("keeps the native booking payment status aligned with the payment profile lifecycle", () => {
    const source = read("server/bookingPaymentAdminRouter.ts");
    const engine = read("server/bookingPaymentActionsEngine.ts");
    const lifecycle = read("server/bookingLifecycleService.ts");
    expect(source).toContain('paymentStatus: "authorized"');
    expect(source).toContain('paymentStatus: "captured"');
    expect(source).toContain('paymentStatus: "card_on_file"');
    expect(source).toContain('paymentStatus: "failed"');
    expect(engine).toContain("amount_to_capture: amountCents");
    expect(source).toContain("syncNativeBookingPaymentState");
    expect(lifecycle).toContain("nativeBookingHasCard");
  });

  it("uses canonical booking finalization after internal card confirmation", () => {
    const source = read("server/bookingPaymentAdminRouter.ts");
    expect(source).toContain("finalizeCanonicalCardOnFile");
    expect(source).toContain("finalizeCanonicalBooking");
    expect(source).toContain("if (setup.alreadyComplete)");
    expect(source.indexOf("finalizeCanonicalCardOnFile")).toBeLessThan(
      source.indexOf("finalizeCanonicalBooking(db")
    );
  });

  it("adds no automatic timing or eligibility rule and requires a local confirm before every action", () => {
    const source = read("server/bookingPaymentAdminRouter.ts");
    const ui = read("client/src/components/BookingPaymentActions.tsx");
    expect(source).not.toContain("HOLD_WINDOW");
    expect(source).not.toContain("holdEligible");
    expect(source).not.toContain("automaticHold");
    expect(ui).toContain("window.confirm");
    expect(ui).toContain("placeHold.mutate({ bookingId, confirmed: true })");
    expect(ui).toContain("captureHold.mutate({ bookingId, confirmed: true })");
    expect(ui).toContain("cancelHold.mutate({ bookingId, confirmed: true })");
    expect(ui).toContain("chargeCard.mutate({ bookingId, confirmed: true })");
  });

  it("shows the manual controls only on the native booking detail and refreshes the linked booking after an event", () => {
    const workspace = read("client/src/components/NativeBookingsWorkspace.tsx");
    expect(workspace).toContain("BookingPaymentActions");
    expect(workspace).toContain('active.source === "booking"');
    expect(workspace).toContain('active.source === "booking"');
    expect(workspace).toContain("refreshBookingAndFunnelQueries");
    expect(workspace).toContain("void listQuery.refetch()");
  });
});
