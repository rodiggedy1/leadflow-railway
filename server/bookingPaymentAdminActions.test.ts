import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("manual booking payment actions", () => {
  it("exposes only staff-authorized hold, capture, cancellation, and direct-charge actions", () => {
    const source = read("server/bookingPaymentAdminRouter.ts");
    for (const action of ["getForBooking", "placeHold", "captureHold", "cancelHold", "chargeSavedCard"]) expect(source).toContain(`${action}: agentProcedure`);
    expect(source).toContain("confirmed: z.literal(true)");
    expect(source).toContain('capture_method: "manual"');
    expect(source).toContain("paymentIntents.capture");
    expect(source).toContain("paymentIntents.cancel");
    expect(source).toContain("paymentIntents.create");
  });

  it("uses the booking-bound saved card and locked booking total without phone customer lookup", () => {
    const source = read("server/bookingPaymentAdminRouter.ts");
    expect(source).toContain("bookingPaymentProfiles.bookingId");
    expect(source).toContain("booking.firstCleaningTotalCents");
    expect(source).toContain("bookingPaymentMetadata(booking.id, profile.id)");
    expect(source).not.toContain("stripeCustomers");
    expect(source).not.toMatch(/where\(eq\([^\n]*customerPhone/);
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
    expect(workspace).toContain("<BookingPaymentActions bookingId={active.id}");
    expect(workspace).toContain('active.source === "booking"');
    expect(workspace).toContain("funnelLeads.filter((lead) => !lead.bookingId)");
    expect(workspace).toContain("refreshBookingAndFunnelQueries");
    expect(workspace).toContain("void listQuery.refetch()");
  });
});
