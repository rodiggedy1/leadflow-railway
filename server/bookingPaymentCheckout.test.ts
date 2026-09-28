import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("shared booking Stripe checkout", () => {
  it("extracts the existing CardElement and confirmCardSetup path into one reusable hook", () => {
    const hook = read("client/src/components/useStripeCardSetup.ts");
    const cardAuth = read("client/src/pages/CardAuth.tsx");
    expect(hook).toContain("CardElement");
    expect(hook).toContain("stripe.confirmCardSetup(clientSecret");
    expect(hook).toContain("raw card data");
    expect(cardAuth).toContain("useStripeCardSetup");
    expect(cardAuth).toContain("trpc.stripe.confirmCardSaved.useMutation");
  });

  it("uses the same extracted checkout in both customer booking surfaces", () => {
    const checkout = read("client/src/components/BookingPaymentCheckout.tsx");
    const widget = read("client/src/components/BookingWidgetConfigPanel.tsx");
    const bookNow = read("client/src/pages/BookNow.tsx");
    expect(checkout).toContain("trpc.bookingPayments.startSetup.useMutation");
    expect(checkout).toContain("trpc.bookingPayments.confirmSetup.useMutation");
    expect(checkout).toContain("<ExistingCardSetupForm");
    expect(widget).toContain("<BookingPaymentCheckout");
    expect(bookNow).toContain("<BookingPaymentCheckout");
    expect(bookNow).not.toContain("Preview saved-card state");
    expect(bookNow).not.toContain("UI preview only.");
  });

  it("requires explicit consent and never moves customer checkout into a charge or automatic hold", () => {
    const checkout = read("client/src/components/BookingPaymentCheckout.tsx");
    const adapter = read("server/bookingPaymentRouter.ts");
    expect(checkout).toContain("consentAccepted");
    expect(checkout).toContain("BOOKING_PAYMENT_CONSENT_TEXT");
    expect(adapter).not.toContain("paymentIntents.create");
    expect(adapter).not.toContain("paymentIntents.capture");
    expect(adapter).not.toContain("paymentIntents.cancel");
    expect(adapter).toMatch(
      /status:\s*"needs_attention",\s*paymentStatus:\s*"card_on_file"/
    );
  });

  it("confirms a real booking by first name without availability-review or UI-preview language", () => {
    const widget = read("client/src/components/BookingWidgetConfigPanel.tsx");
    const book = read("client/src/pages/Book.tsx");
    expect(widget).toContain(
      "You&apos;re booked, {firstNameFromFullName(demo.fullName)}!"
    );
    expect(widget).not.toContain("awaiting availability review");
    expect(book).toContain("You’re booked!");
    expect(book).toMatch(
      /You won’t be charged until after your\s+service is completed\./
    );
    expect(book).not.toContain("VISUAL REVIEW ONLY");
    expect(book).not.toContain("awaiting availability review");
  });
});
