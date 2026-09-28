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
    expect(paymentRouter).toContain('stage: "booked"');
    expect(paymentRouter).toContain("bookingAlreadyExisted");
    expect(paymentRouter).toContain("eq(bookingSeries.bookingId, bookingId)");
    expect(checkout).toContain("trpc.bookingPayments.startSetup.useMutation");
    expect(checkout).toContain("trpc.bookingPayments.confirmSetup.useMutation");
  });

  it("opens Stripe card entry directly on the public payment step", () => {
    expect(page).toContain("directCardEntry");
    expect(checkout).toMatch(/if\s*\(\s*!directCardEntry\s*\|\|/);
    expect(checkout).toContain("PremiumCardSetupForm");
    expect(checkout).toContain("PremiumCardReviewForm");
    expect(checkout).toContain("booking-card-acceptance");
    expect(checkout).not.toContain("Try secure card entry again");
    expect(checkout).toContain("authorizationCopy");
    expect(page).not.toContain("booking-payment-timing");
    expect(page).not.toContain("booking-payment-security");
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
