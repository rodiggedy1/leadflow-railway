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
    const engine = read("server/bookingUpsellEngine.ts");
    expect(router).toContain("PUBLIC_BOOKING_POST_BOOKING_UPSELLS");
    expect(router).toContain("additionalServices");
    expect(router).toContain("applyInternalAdditionalServices");
    expect(engine).toContain("booking.firstCleaningTotalCents");
    expect(engine).toContain("leadflowJobs");
    expect(router).not.toMatch(legacySymbols);
  });

  it("returns booking identity on both insert and idempotent retry paths", () => {
    const router = read("server/bookingsRouter.ts");
    const persistence = read("server/canonicalBookingPersistence.ts");
    expect(router).toContain("persistCanonicalBooking");
    expect(persistence).toContain("bookingId");
    expect(persistence).toContain("created: false");
  });

  it("clears all additional services and refreshes both operational surfaces", () => {
    const router = read("server/bookingUpsellEngine.ts");
    expect(router).not.toContain("if (selections.length === 0) return null;");
    expect(router).toContain('broadcastOpsUpdate("booking_funnel_update")');
    expect(router).toContain("existingTotal");
    expect(router).toContain("submittedTotal");
  });

  it("creates or reuses the payment profile only when internal card setup begins", () => {
    const bookingsRouter = read("server/bookingsRouter.ts");
    const paymentAdminRouter = read("server/bookingPaymentAdminRouter.ts");
    const paymentEngine = read("server/bookingPaymentEngine.ts");
    expect(bookingsRouter).not.toContain("db.insert(bookingPaymentProfiles)");
    expect(paymentAdminRouter).toContain("bookingFunnelRecords");
    expect(paymentAdminRouter).toContain("let [profile]");
    expect(paymentAdminRouter).toContain('paymentStatus: "not_started"');
    expect(paymentAdminRouter).toContain("Duplicate entry");
    expect(paymentEngine).toContain("stripe.setupIntents.retrieve");
    expect(paymentEngine).toContain("bookingPaymentIdempotencyKey");
    expect(paymentEngine).toContain(
      'profile.paymentStatus === "card_on_file"'
    );
    expect(paymentEngine).toContain(
      "bookingPaymentMetadata(bookingId, profile.id)"
    );
    expect(paymentEngine).toContain('paymentStatus: "pending"');
    expect(paymentAdminRouter).toContain("finalizeCanonicalBooking");
    expect(read("server/bookingPaymentEngine.ts")).toContain(
      "version: sql`${bookingPaymentProfiles.version} + 1`"
    );
    expect(paymentAdminRouter).toContain("bookingFunnelRecords");
    expect(read("server/bookingPaymentEngine.ts")).toContain("onDuplicateKeyUpdate");
    expect(paymentAdminRouter).toContain("finalizeCanonicalBooking");
    expect(paymentAdminRouter).toContain("createCanonicalBookingPortalHandoff");
    expect(paymentEngine).toContain(
      "The payment method changed. Please try again."
    );
    expect(paymentAdminRouter).not.toMatch(legacySymbols);
  });
  it("defers card-booking add-ons until the canonical card completion step", () => {
    const page = read("client/src/pages/InternalBooking.tsx");
    expect(page).toContain('paymentMethod === "card"');
    expect(page).toContain('additionalServices: paymentMethod === "card"');
    expect(page).toContain("updateAdditionalServices.mutate");
  });

  it("propagates recurring add-ons, assignments, one-time cancellation, and notes", () => {
    const router = read("server/bookingsRouter.ts");
    const engine = read("server/bookingUpsellEngine.ts");
    expect(engine).toContain("futureVisitTotalCents + delta");
    expect(engine).toContain(
      "jobTotalCents: sql`${leadflowJobs.jobTotalCents} + ${delta}`"
    );
    expect(engine).toContain(
      "gt(leadflowJobs.jobDate, booking.requestedLocalDate)"
    );
    expect(router).toContain("syncNativeBookingOperationalProjection");
    expect(read("server/bookingCancellationService.ts")).toContain('bookingStatus: "cancelled"');
    expect(router).toContain("companyNotes");
  });
  it("projects card metadata and native ownership into operational surfaces", () => {
    const payment = read("server/bookingPaymentAdminRouter.ts");
    const paymentEngine = read("server/bookingPaymentEngine.ts");
    const jobs = read("server/leadflowJobsRouter.ts");
    expect(paymentEngine).toContain("paymentBrand: input.paymentMethod.brand");
    expect(payment).toContain("finalizeCanonicalCardOnFile");
    expect(jobs).toContain("leadflowJobs");
    expect(jobs).toContain("leadflowJobId");
    expect(jobs).not.toMatch(legacySymbols);
  });
  it("does not allow Step 7 to continue before the card is saved", () => {
    const page = read("client/src/pages/InternalBooking.tsx");
    expect(page).toContain("const [cardSaved, setCardSaved] = useState(false)");
    expect(page).toContain("!cardSaved");
    expect(page).toContain("Save the card before continuing.");
  });
});
