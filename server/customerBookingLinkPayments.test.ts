import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const compact = (text: string) => text.replace(/\s+/g, "");

const book = read("client/src/pages/Book.tsx");
const page = read("client/src/pages/CustomerBookingLinkLive.tsx");
const options = read(
  "client/src/components/CustomerBookingLinkPaymentOptions.tsx"
);
const card = read("client/src/components/BookingPaymentCheckout.tsx");
const wallet = read("client/src/components/BookingApplePayCheckout.tsx");
const cash = read("client/src/components/BookingCashAppCheckout.tsx");

describe("customer booking links reuse the current /book payment types", () => {
  it("copies the complete four-option markup from /book without reinterpretation", () => {
    const start = book.indexOf(
      '<section className="literal-book-payment-heading">'
    );
    const end = book.indexOf("\n            </>\n          )}", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(compact(options)).toContain(compact(book.slice(start, end)));
    expect(
      options.indexOf('aria-label="Card on file payment method"')
    ).toBeLessThan(options.indexOf("<strong>Apple Pay</strong>"));
    expect(options.indexOf("<strong>Apple Pay</strong>")).toBeLessThan(
      options.indexOf("<strong>Pay with Cash App</strong>")
    );
    expect(options.indexOf("<strong>Pay with Cash App</strong>")).toBeLessThan(
      options.indexOf("<strong>Google Pay</strong>")
    );
    expect(options).toContain("useState<PaymentMethod | null>(null)");
  });

  it("mounts the same real card adapter before reservation instead of the broken readiness gate", () => {
    expect(page).toContain("<CustomerBookingLinkPaymentOptions");
    expect(page).not.toContain("detailsReady");
    expect(page).not.toContain("setupReady=");
    expect(page).not.toContain("<BookingPaymentCheckout");
    expect(options).toContain("<PublicBookingCardSetupBeforeReservation");
    expect(options).toContain("onPrepareReservation={onPrepareReservation}");
    const adapter = card.slice(
      card.indexOf("export function PublicBookingCardSetupBeforeReservation"),
      card.indexOf("export function BookingPaymentCheckout")
    );
    expect(adapter).toContain("<InternalCardSetupForm");
    expect(adapter).toContain("clientSecret={clientSecret}");
    expect(adapter).toContain("await onPrepareReservation()");
    expect(adapter).toContain("deferConfirmation: true");
  });

  it("retains quote submission and signed funnel identity, and returns null on invalid details", () => {
    expect(page).toContain("trpc.bookingFunnel.submitCustomerLink.useMutation");
    expect(page).toContain("idempotencyKey: bookingAttemptIdRef.current");
    expect(page).toContain(
      "const reservation = { publicFunnelNumber: data.token, mutationToken: data.mutationToken }"
    );
    expect(page).toContain("reservationRef.current = reservation");
    expect(page).toContain("return reservation");
    expect(page).toContain("return null");
    expect(page).toContain("await finalize.mutateAsync(reservation)");
    expect(page).toContain('if (data.stage === "booked") setStep("success")');
    expect(page).not.toContain("bookingFunnel.begin");
  });

  it("reuses deferred Apple Pay and Google Pay setup, not immediate wallet charges", () => {
    expect(options.match(/<BookingWalletCardOnFileCheckout/g)).toHaveLength(2);
    expect(wallet).toContain('mode: "setup"');
    expect(wallet).toContain('setupFutureUsage: "off_session"');
    expect(wallet).toContain("deferredPaymentRequest");
    expect(wallet).toContain("deferConfirmation: true");
    expect(wallet).toContain("stripe.confirmSetup(");
    expect(wallet).not.toContain("stripe.confirmPayment(");
    expect(options).toContain('onWalletReady("apple_pay"');
    expect(options).toContain('onWalletReady("google_pay"');
  });

  it("reuses Cash App immediate payment and cancellation before switching, without adding eligibility logic", () => {
    expect(options).toContain("<BookingCashAppCheckout");
    expect(options).toContain("setCashAppExitRequest(method)");
    expect(options).toContain("onExited={onCashAppExited}");
    expect(options).toContain("onPaid={onCashAppPaid}");
    expect(cash).toContain("stripe.confirmCashappPayment");
    expect(cash).toContain("trpc.cashApp.booking.abandon.useMutation");
    expect(options).not.toContain("recurrence");
    expect(page).not.toContain("You won't be charged today");
  });

  it("confirms once after card save and permits finalization retry without another card submission", () => {
    expect(options).toContain("setCardOnFile(true)");
    expect(options).toContain("await onFinalizeCard()");
    expect(options).toContain("cardOnFile && formError");
    expect(options).toContain("Try confirming booking");
  });

  it("reuses /book's actual thank-you component with the same saved-wallet and paid-Cash-App summaries", () => {
    expect(book).toContain("export function BookingSuccess(");
    expect(page).toContain('import { BookingSuccess, timeLabelTo24Hour } from "./Book"');
    expect(page).toContain("return <BookingSuccess");
    expect(page).not.toContain('className="customer-link-success"');
    expect(options).toContain("onPaymentSaved(`${brand} ending in ${last4}`)");
    expect(options).toContain('wallet === "apple_pay" ? "Apple Pay" : "Google Pay"');
    expect(page).toContain("Cash App · ${dollars(totalCents)} paid today");
    expect(page).toContain('data.paymentStatus === "captured"');
  });

  it("hydrates recurring quote state and reads persisted completion data without another booking submit", () => {
    expect(page).toContain("setRecurrence(data.recurrence as Recurrence)");
    expect(page).toContain('data.stage === "booked" ? data.recurrence : recurrence');
    expect(page).toContain('data.stage === "booked" ? data.futureVisitTotalCents : futureTotal');
    expect(page).toContain('step === "details" || step === "success"');
  });

  it("keeps an exited Cash App start guarded until inactive instead of restarting while a new method is selected", () => {
    const exit = cash.slice(cash.indexOf("const completeExit"), cash.indexOf("const abandonPrepared"));
    expect(exit).toContain("startingRef.current = true");
    expect(exit).not.toContain("startingRef.current = false");
    const inactive = cash.slice(cash.indexOf("if (active) return"), cash.indexOf("if (!active || preparedRef.current"));
    expect(inactive).toContain("startingRef.current = false");
  });

  it("scopes copied styles only to the payment section and never changes page width", () => {
    const styles = read(
      "client/src/components/customer-booking-link-payment-options.css"
    );
    expect(styles).toContain(
      ".customer-link-payment-options .literal-book-card-choice"
    );
    expect(styles).toContain(".literal-book-card-detail:not(.is-open)");
    expect(styles).not.toContain(".customer-link-shell");
    expect(styles).not.toContain(".customer-link-content");
    expect(styles).not.toContain(".literal-book-shell");
    expect(styles).not.toContain(".literal-book-page-five");
  });
});
