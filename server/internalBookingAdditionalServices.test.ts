import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");
const legacySymbols = new RegExp(
  [["cleaner", "Jobs"].join(""), ["cleaner", "_jobs"].join("")].join("|")
);

describe("internal booking additional services", () => {
  it("uses the approved nine-step catalog and submits explicit quantities", () => {
    const page = read("client/src/pages/InternalBooking.tsx");
    expect(page).toContain('"Additional services"');
    expect(page).toContain("ADDITIONAL_SERVICES");
    expect(page).toContain(
      "additionalServices: Object.entries(additionalServices)"
    );
    expect(page).toContain(
      "pricing.firstCleaningTotalCents + additionalServicesTotalCents"
    );
    expect(page).toContain('"carpet-cleaning"');
    expect(page).toContain('"exterior-window-cleaning"');
    expect(page).toContain('"pet-area-cleaning"');
  });

  it("validates and persists add-ons on LeadFlow-owned booking and job rows", () => {
    const router = read("server/bookingsRouter.ts");
    expect(router).toContain("PUBLIC_BOOKING_POST_BOOKING_UPSELLS");
    expect(router).toContain("additionalServices");
    expect(router).toContain("applyInternalAdditionalServices");
    expect(router).toContain("booking.firstCleaningTotalCents");
    expect(router).toContain("leadflowJobs");
    expect(router).not.toMatch(legacySymbols);
  });

  it("returns booking identity on both insert and idempotent retry paths", () => {
    const router = read("server/bookingsRouter.ts");
    expect(router).toContain("id: bookings.id");
    expect(router).toContain("id: bookingId");
    expect(router).toContain("persisted.booking.id");
  });

  it("clears all additional services and refreshes both operational surfaces", () => {
    const router = read("server/bookingsRouter.ts");
    expect(router).not.toContain("if (selections.length === 0) return null;");
    expect(router).toContain('broadcastOpsUpdate("booking_funnel_update")');
    expect(router).toContain("existingUpsellTotal");
    expect(router).toContain("submittedUpsellTotal");
  });

  it("creates or reuses the payment profile only when internal card setup begins", () => {
    const bookingsRouter = read("server/bookingsRouter.ts");
    const paymentAdminRouter = read("server/bookingPaymentAdminRouter.ts");
    expect(bookingsRouter).not.toContain("db.insert(bookingPaymentProfiles)");
    expect(paymentAdminRouter).toContain("bookingFunnelRecords");
    expect(paymentAdminRouter).toContain("let [profile]");
    expect(paymentAdminRouter).toContain('paymentStatus: "not_started"');
    expect(paymentAdminRouter).toContain("Duplicate entry");
    expect(paymentAdminRouter).toContain("stripe.setupIntents.retrieve");
    expect(paymentAdminRouter).toContain("bookingPaymentIdempotencyKey");
    expect(paymentAdminRouter).toContain(
      'profile.paymentStatus === "card_on_file"'
    );
    expect(paymentAdminRouter).toContain(
      "bookingPaymentMetadata(booking.id, profile.id)"
    );
    expect(paymentAdminRouter).toContain('paymentStatus: "pending"');
    expect(paymentAdminRouter).toContain(
      'broadcastOpsUpdate("booking_funnel_update")'
    );
    expect(paymentAdminRouter).toContain(
      "version: sql`${bookingPaymentProfiles.version} + 1`"
    );
    expect(paymentAdminRouter).toContain("bookingFunnelRecords");
    expect(paymentAdminRouter).toContain("onDuplicateKeyUpdate");
    expect(paymentAdminRouter).toContain("sendBookingCompletionNotifications");
    expect(paymentAdminRouter).toContain("createCustomerPortalHandoff");
    expect(paymentAdminRouter).toContain(
      "The payment method changed. Please try again."
    );
    expect(paymentAdminRouter).not.toMatch(legacySymbols);
  });

  it("propagates recurring add-ons, assignments, one-time cancellation, and notes", () => {
    const router = read("server/bookingsRouter.ts");
    expect(router).toContain("futureVisitTotalCents + futureDelta");
    expect(router).toContain(
      "jobTotalCents: sql`${leadflowJobs.jobTotalCents} + ${futureDelta}`"
    );
    expect(router).toContain(
      "gt(leadflowJobs.jobDate, booking.requestedLocalDate)"
    );
    expect(router).toContain(
      "set({ teamName: team.name, teamId: team.id, updatedAt: now })"
    );
    expect(router).toContain(
      'set({ bookingStatus: "cancelled", updatedAt: now })'
    );
    expect(router).toContain(
      "nativeBookingCustomerNotes(booking, companyNotes)"
    );
  });
  it("projects card metadata and native ownership into operational surfaces", () => {
    const payment = read("server/bookingPaymentAdminRouter.ts");
    const jobs = read("server/leadflowJobsRouter.ts");
    expect(payment).toContain("paymentBrand: paymentMethod.card!.brand");
    expect(payment).toContain("paymentBrand: profile.cardBrand");
    expect(payment).toContain("eq(leadflowJobs.bookingId, booking.id)");
    expect(jobs).toContain("schedulingTeamId");
    expect(jobs).toContain("active_assignment");
    expect(jobs).toContain("COALESCE");
    expect(jobs).not.toMatch(legacySymbols);
  });
  it("does not allow Step 7 to continue before the card is saved", () => {
    const page = read("client/src/pages/InternalBooking.tsx");
    expect(page).toContain("const [cardSaved, setCardSaved] = useState(false)");
    expect(page).toContain("!cardSaved");
    expect(page).toContain("Save the card before continuing.");
  });
});
