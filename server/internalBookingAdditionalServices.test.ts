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
  it("uses the requested exact public three-screen form and submits canonical extra quantities without a separate add-on catalog", () => {
    const page = read("client/src/pages/InternalBooking.tsx");
    const form = read("client/src/components/internal-booking/InternalPublicBook.tsx");
    const api = read("client/src/components/internal-booking/InternalExactBookingApi.ts");
    expect(page).toContain("InternalBookingWrapper");
    expect(form).toContain("ApprovedBookFirstPage");
    expect(form).toContain("ApprovedBookSecondPage");
    expect(form).toContain("ApprovedBookPayment");
    expect(form).not.toContain("ADDITIONAL_SERVICES");
    expect(api).toContain("createCanonicalPricingInput");
    expect(api).toContain("createCanonicalBookingInput");
    expect(api).not.toContain("additionalServices");
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
  it("does not run additional-service mutations from the exact-public internal form", () => {
    const form = read("client/src/components/internal-booking/InternalPublicBook.tsx");
    const native = read("server/internalExactBookingService.ts");
    expect(form).not.toContain("updateAdditionalServices.mutate");
    expect(native).not.toContain("applyInternalAdditionalServices");
    expect(form).toContain("internalBooking.finalizeCard()");
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
  it("retains verified card completion/retry and a distinct explicitly unpaid action on the copied payment screen", () => {
    const form = read("client/src/components/internal-booking/InternalPublicBook.tsx");
    expect(form).toContain("const [cardOnFile, setCardOnFile] = useState(false)");
    expect(form).toContain("await internalBooking.finalizeCard()");
    expect(form).toContain("setCardOnFile(true)");
    expect(form).toContain("onRetryFinalization={() => void finalizeConfirmedCard()}");
    expect(form).toContain("await prepareLockedBooking(true)");
    expect(form).toContain('setCardLabel("No payment collected · booking remains unpaid")');
  });
});
