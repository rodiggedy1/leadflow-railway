import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("approved eight-step public booking flow", () => {
  const page = read("client/src/pages/Book.tsx");
  const pricing = read("shared/publicBookingPricing.ts");
  const paymentRouter = read("server/bookingPaymentRouter.ts");
  const paymentEngine = read("server/bookingPaymentEngine.ts");
  const upsellEngine = read("server/bookingUpsellEngine.ts");
  const persistence = read("server/canonicalBookingPersistence.ts");
  const checkout = read("client/src/components/BookingPaymentCheckout.tsx");

  it("uses the review canvas on /book while leaving /book-now available", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('<Route path={"/book"} component={Book} />');
    expect(app).toContain('<Route path={"/book-now"} component={BookNow} />');
    expect(page).toContain("STEP {step} OF 8");
    expect(page).toContain("booking-review-page booking-live-page");
    expect(page).not.toContain("VISUAL REVIEW ONLY");
  });

  it("uses the approved versioned pricing model rather than the legacy widget model", () => {
    expect(page).toContain("PUBLIC_BOOKING_PRICING_VERSION");
    expect(page).toContain("calculatePublicBookingPrice");
    expect(pricing).toContain(
      'PUBLIC_BOOKING_PRICING_VERSION = "public-book-v2"'
    );
    expect(pricing).toContain("PUBLIC_BOOKING_HOURLY_RATE = 70");
    expect(pricing).toContain(
      "PUBLIC_BOOKING_CONDITION_ADJUSTMENT_PER_LEVEL = 0.1"
    );
    expect(pricing).toContain("futureVisitBaseTotalCents");
    expect(pricing).toContain('input.recurrence === "one-time"');
  });

  it("reuses the guarded funnel, Stripe setup, and booking-series lifecycle", () => {
    expect(page).toContain("trpc.bookingFunnel.begin.useMutation");
    expect(page).toContain("trpc.bookingFunnel.reserve.useMutation");
    expect(page).toContain("trpc.bookingPayments.finalize.useMutation");
    expect(page).toContain("<BookingPaymentCheckout");
    expect(page).toContain("deferConfirmation");
    expect(paymentRouter).toContain("buildPreparedPublicBooking");
    expect(paymentRouter).toContain("PUBLIC_BOOKING_PRICING_VERSION");
    expect(paymentRouter).toContain("finalize: publicProcedure");
    expect(paymentEngine).toContain('stage: "booked"');
    expect(persistence).toContain("persistCanonicalBooking");
    expect(persistence).toContain("createOrUpdateSeries");
    expect(paymentEngine).toContain("finalizeCanonicalCardOnFile");
    expect(checkout).toContain("trpc.bookingPayments.startSetup.useMutation");
    expect(checkout).toContain("trpc.bookingPayments.confirmSetup.useMutation");
  });

  it("opens Stripe card entry directly on the public payment step", () => {
    expect(page).toContain("directCardEntry");
    expect(page).toContain("<PublicBookingCardSetupBeforeReservation");
    expect(page).toContain("const showCardEntry = phase === 6 || phase === 7;");
    expect(page).not.toContain("Continue to secure card setup →");
    expect(checkout).toMatch(/if\s*\(\s*!directCardEntry\s*\|\|/);
    expect(checkout).toContain("PremiumCardSetupForm");
    expect(checkout).toContain("<InternalCardSetupForm");
    expect(checkout).toContain("onPrepareReservation");
    expect(checkout).toContain("booking-card-acceptance");
    expect(checkout).toContain("Secure card entry is temporarily unavailable");
    expect(checkout).not.toContain("PremiumCardReviewForm");
    expect(checkout).not.toContain("Card acceptance form preview");
    expect(page).not.toContain("literal-book-card-preview");
    expect(checkout).toContain("authorizationCopy");
    expect(page).not.toContain("booking-payment-timing");
    expect(page).not.toContain("booking-payment-security");
  });

  it("finalizes the booking immediately after Stripe confirms the card", () => {
    const literalCheckoutController = page.slice(
      page.indexOf("const finalizeConfirmedCard = async () =>"),
      page.indexOf(
        '  return (\n    <main className="booking-review-page booking-live-page">'
      )
    );
    expect(literalCheckoutController).toMatch(
      /const finalizeConfirmedCard = async \(\) => \{[\s\S]*finalizeBookingMutation\.mutateAsync\([\s\S]*setComplete\(true\);/
    );
    expect(literalCheckoutController).not.toMatch(
      /const finalizeConfirmedCard = async \(\) => \{\s*if \(step === 8\)/
    );
    expect(literalCheckoutController).toMatch(
      /onCardReady=\{\(brand, last4\) => \{[\s\S]*setCardOnFile\(true\);[\s\S]*void finalizeConfirmedCard\(\);[\s\S]*\}\}/
    );
    expect(literalCheckoutController).not.toContain(
      "onReviewBooking={() => setStep(8)}"
    );
    expect(literalCheckoutController).not.toContain("Review booking →");
  });

  it("keeps the active literal checkout out of the obsolete Phase 8 review state", () => {
    const literalPageFive = page.slice(
      page.indexOf("function LiteralPageFive("),
      page.indexOf("\nfunction formatPhoneInput(")
    );
    expect(literalPageFive).toContain("phase: 6 | 7;");
    expect(literalPageFive).not.toContain("showFinalReview");
    expect(literalPageFive).not.toContain("Review booking →");
    expect(literalPageFive).not.toContain("onFinalize");
    expect(literalPageFive).toContain("cardOnFile && formError");
    expect(literalPageFive).toContain("onRetryFinalization");
    expect(literalPageFive).toContain("Try confirming booking →");
  });

  it("takes a completed booking directly to the thank-you presentation without a tip preview or post-booking add-on UI", () => {
    expect(page).toContain("literal-book-page-six");
    expect(page).toContain('"Confirmation"');
    expect(page).toContain("literal-book-thankyou");
    expect(page).not.toContain("literal-book-tip-v2");
    expect(page).not.toContain(
      "Tipping is not collected or recorded in this booking flow."
    );
    expect(page).not.toContain("No tip, thanks — I&apos;m all set");
    expect(page).not.toContain("POST_BOOKING_UPSELLS");
    expect(page).not.toContain("booking-upsell-modal");
    expect(page).not.toContain("booking-upsell-estimate");
    expect(page).not.toContain("addPostBookingUpsells.useMutation");
  });

  it("keeps the existing server-only additional-services contract intact", () => {
    expect(read("shared/canonicalBookingCatalog.ts")).toContain(
      "CANONICAL_POST_BOOKING_UPSELLS"
    );
    expect(paymentRouter).toContain("addPostBookingUpsells: publicProcedure");
    expect(upsellEngine).toContain("PUBLIC_BOOKING_POST_BOOKING_UPSELLS");
    expect(upsellEngine).toContain("firstCleaningTotalCents");
    expect(upsellEngine).toContain("eq(leadflowJobs.bookingId, bookingId)");
    expect(upsellEngine).toContain("broadcastCleanerPortalJobsChanged");
  });

  it("keeps the public booking path separate from protected legacy systems", () => {
    const changed = [page, pricing, paymentRouter, checkout].join("\n");
    const protectedReferences = [
      ["launch", "27"].join(""),
      ["cleaner", "_jobs"].join(""),
      ["cleaner", "Jobs"].join(""),
    ];
    for (const protectedReference of protectedReferences) {
      expect(changed.toLowerCase()).not.toContain(
        protectedReference.toLowerCase()
      );
    }
  });
});
