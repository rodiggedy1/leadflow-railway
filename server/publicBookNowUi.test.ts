import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("public Book Now UI contract", () => {
  const appSource = read("client/src/App.tsx");
  const pageSource = read("client/src/pages/BookNow.tsx");
  const cssSource = read("client/src/pages/book-now.css");

  it("adds a separate lazy public /book-now route without replacing the working /book route", () => {
    expect(appSource).toContain('const Book = lazy(() => import("./pages/Book"))');
    expect(appSource).toContain('const BookNow = lazy(() => import("./pages/BookNow"))');
    expect(appSource).toContain('<Route path={"/book"} component={Book} />');
    expect(appSource).toContain('<Route path={"/book-now"} component={BookNow} />');
  });

  it("uses the existing public widget configuration and authoritative shared pricing contracts", () => {
    expect(pageSource).toContain("trpc.bookings.getPublicWidgetConfig.useQuery");
    expect(pageSource).toContain("parseBookingWidgetDraft");
    expect(pageSource).toContain("calculateBookingWidgetPrice");
    expect(pageSource).toContain("calculateBookingWidgetRecurringPrice");
    expect(pageSource).toContain("BOOKING_WIDGET_PRICED_EXTRAS.map");
    expect(pageSource).toContain("BOOKING_WIDGET_RECURRING_OPTIONS.map");
    expect(pageSource).toContain("config.services.map");
  });

  it("creates one guarded lead identity after valid name and phone capture", () => {
    expect(pageSource).toContain("trpc.bookingFunnel.begin.useMutation");
    expect(pageSource).toContain("trpc.bookingFunnel.update.useMutation");
    expect(pageSource).toContain("bookingAttemptIdRef");
    expect(pageSource).toContain("leadCapturePromiseRef");
    expect(pageSource).toContain('validateBookingWidgetIntakeField("fullName", fullName)');
    expect(pageSource).toContain('validateBookingWidgetIntakeField("phone", phone)');
    expect(pageSource).toContain('source: "book-page"');
    expect(pageSource).toContain("rememberFunnelRecord(current)");
    expect(pageSource).toContain("initialSnapshotSavedRef");
    expect(pageSource).toContain("onBlur={() => void saveLeadContactIfReady()}");
    expect(pageSource).toContain("if (leadCapturePromiseRef.current) return leadCapturePromiseRef.current");
  });

  it("advances the same token-bound record to payment incomplete before showing the card step", () => {
    expect(pageSource).toContain("trpc.bookingFunnel.reserve.useMutation");
    expect(pageSource).toContain("publicFunnelNumber: current.publicFunnelNumber");
    expect(pageSource).toContain("mutationToken: current.mutationToken");
    expect(pageSource).toContain("expectedVersion: current.version");
    expect(pageSource).toContain('current.stage === "lead"');
    expect(pageSource).toContain("await reserveFunnelMutation.mutateAsync(input)");
    expect(pageSource.indexOf("await reserveFunnelMutation.mutateAsync(input)")).toBeLessThan(pageSource.indexOf("setStep(4)"));
    expect(pageSource).toContain('validateBookingWidgetIntakeField("email", email)');
    expect(pageSource).toContain('address.trim().length >= 5');
    expect(pageSource).toContain("customerEmail: email.trim() || null");
    expect(pageSource).toContain("requestedLocalDate: date.iso");
    expect(pageSource).toContain("requestedLocalTime: timeLabelTo24Hour(time)");
    expect(pageSource).toContain("firstCleaningTotalCents: Math.round(priceBreakdown.total * 100)");
    expect(pageSource).toContain("disabled={(step === 3 && funnelMutationPending)");
    expect(pageSource).toContain("bookingAttemptIdRef.current = createBookingAttemptId()");
  });

  it("keeps Stripe and final native booking creation out of this slice", () => {
    expect(pageSource).not.toContain("bookings.prepare");
    expect(pageSource).not.toContain("stripe.createSetupIntent");
    expect(pageSource).not.toContain("stripe.confirmCardSaved");
    expect(pageSource).not.toContain("confirmCardSetup");
    expect(pageSource).not.toContain("stripe.confirm");
    expect(pageSource).toContain("UI preview only.");
    expect(pageSource).toContain("No card data is collected or stored.");
    expect(pageSource).toContain("<input disabled");
  });

  it("preserves the supplied four-step composition and live summary interaction", () => {
    expect(pageSource).toContain("STEP {step} OF 4");
    expect(pageSource).toContain("BUILD YOUR CLEANING");
    expect(pageSource).toContain("YOUR APPOINTMENT");
    expect(pageSource).toContain("YOUR DETAILS");
    expect(pageSource).toContain("SECURE YOUR APPOINTMENT");
    expect(pageSource).toContain("book-now-summary-list");
    expect(pageSource).toContain("book-now-appointment-preview");
    expect(pageSource).toContain("book-now-confirmation-card");
  });

  it("preserves the supplied desktop geometry and responsive single-column behavior", () => {
    expect(cssSource).toContain("width:min(1180px,100%)");
    expect(cssSource).toContain("grid-template-columns:minmax(0,1fr) 355px");
    expect(cssSource).toContain("border-radius:22px");
    expect(cssSource).toContain("position:sticky;top:20px");
    expect(cssSource).toContain("@media(max-width:850px)");
    expect(cssSource).toContain(".book-now-layout{grid-template-columns:1fr}");
    expect(cssSource).toContain("@media(max-width:560px)");
  });

  it("uses a readable typography scale across the public booking flow without changing geometry", () => {
    expect(cssSource).toContain("Readable public booking typography");
    expect(cssSource).toContain(".book-now-step-heading p{font-size:14px;line-height:1.5}");
    expect(cssSource).toContain(".book-now-service-card strong{font-size:13px}");
    expect(cssSource).toContain(".book-now-service-card p{font-size:10px;line-height:1.5}");
    expect(cssSource).toContain(".book-now-extra-toggle strong,.book-now-extra-toggle small{font-size:10px}");
    expect(cssSource).toContain(".book-now-step-actions button{font-size:12px}");
    expect(cssSource).toContain(".book-now-summary-list div,.book-now-summary-total,.book-now-future-summary{font-size:11px}");
    expect(cssSource).toContain(".book-now-time-choice,.book-now-frequency-card{font-size:11px}");
    expect(cssSource).toContain(".book-now-form-grid input,.book-now-form-grid textarea,.book-now-stripe-shell input{font-size:12px}");
    expect(cssSource).toContain(".book-now-confirmation-card>p{font-size:13px;line-height:1.5}");
  });

  it("does not hardcode a fabricated customer rating, review count, or testimonial", () => {
    expect(pageSource).not.toMatch(/2,100|4\.9 from|customer review|testimonial/i);
  });
});
