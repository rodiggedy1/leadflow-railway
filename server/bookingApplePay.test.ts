import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("public booking delayed wallet card-on-file", () => {
  it("uses Stripe's native Express Checkout UI for Apple Pay and Google Pay but confirms the canonical SetupIntent", () => {
    const component = read("client/src/components/BookingApplePayCheckout.tsx");
    const book = read("client/src/pages/Book.tsx");
    expect(component).toContain("ExpressCheckoutElement");
    expect(component).toContain('type Wallet = "apple_pay" | "google_pay"');
    expect(component).toContain('mode: "setup"');
    expect(component).toContain('setupFutureUsage: "off_session"');
    expect(component).toContain('allowedPaymentMethodTypes: ["card"]');
    expect(component).toContain("stripe.confirmSetup");
    expect(component).toContain("return_url: window.location.href");
    expect(component).toContain("trpc.bookingPayments.startSetup.useMutation");
    expect(component).toContain("trpc.bookingPayments.confirmSetup.useMutation");
    expect(component).not.toContain("confirmPayment");
    expect(component).not.toContain("PaymentIntent");
    expect(book).toContain("<BookingWalletCardOnFileCheckout");
    expect(book).toContain('wallet="apple_pay"');
    expect(book).toContain('wallet="google_pay"');
    expect(book).toContain("Apple Pay is securely saved at booking and charged once the cleaning is completed.");
    expect(book).toContain("Google Pay is securely saved at booking and charged once the cleaning is completed.");
  });

  it("does not include the retired immediate Apple Pay ledger or router", () => {
    const schema = read("drizzle/schema.ts");
    const webhook = read("server/stripeWebhookRoute.ts");
    const router = read("server/routers.ts");
    expect(schema).not.toContain("booking_apple_pay_payments");
    expect(webhook).not.toContain("apple_pay_first_cleaning");
    expect(router).not.toContain("bookingApplePayRouter");
  });
});
