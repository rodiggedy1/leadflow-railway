import { useEffect, useRef, useState } from "react";
import {
  Elements,
  ExpressCheckoutElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { PublicBookingPricingInput } from "@shared/publicBookingPricing";

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePublishableKey
  ? loadStripe(stripePublishableKey)
  : null;

const APPLE_PAY_ONLY_OPTIONS = {
  buttonHeight: 44,
  buttonTheme: { applePay: "black" as const },
  buttonType: { applePay: "book" as const },
  layout: { maxColumns: 1, maxRows: 1, overflow: "never" as const },
  paymentMethodOrder: ["apple_pay"],
  paymentMethods: {
    applePay: "always" as const,
    amazonPay: "never" as const,
    googlePay: "never" as const,
    klarna: "never" as const,
    link: "never" as const,
    paypal: "never" as const,
  },
};

type ApplePayQuoteInput = {
  pricing: PublicBookingPricingInput;
  acceptedPricing: { version: "public-book-v2"; totalCents: number };
};

type Props = {
  quote: ApplePayQuoteInput;
  active: boolean;
  onAvailabilityChange: (available: boolean) => void;
  onPrepareReservation: () => Promise<{
    publicFunnelNumber: string;
    mutationToken: string;
  } | null>;
  onPaid: (totalCents: number) => void;
  onBusyChange: (busy: boolean) => void;
};

function ApplePayElement({
  active,
  reservation,
  totalCents,
  onAvailabilityChange,
  onPaid,
  onBusyChange,
}: {
  active: boolean;
  reservation: Props["onPrepareReservation"];
  totalCents: number;
  onAvailabilityChange: Props["onAvailabilityChange"];
  onPaid: Props["onPaid"];
  onBusyChange: Props["onBusyChange"];
}) {
  const stripe = useStripe();
  const elements = useElements();
  const prepare = trpc.bookingApplePay.prepare.useMutation();
  const settle = trpc.bookingApplePay.settle.useMutation();
  const abandon = trpc.bookingApplePay.abandon.useMutation();
  const [error, setError] = useState("");
  const paymentIntentRef = useRef<{
    publicFunnelNumber: string;
    mutationToken: string;
    paymentIntentId: string;
  } | null>(null);
  const settlingRef = useRef(false);

  useEffect(() => {
    if (active || !paymentIntentRef.current) return;
    const pending = paymentIntentRef.current;
    paymentIntentRef.current = null;
    void abandon.mutateAsync(pending).catch(() => {
      // The server and Stripe still own reconciliation if an in-flight wallet
      // confirmation wins this client-side selection change.
    });
  }, [abandon, active]);

  const setAvailable = (available: boolean) => {
    onAvailabilityChange(available);
  };

  const fail = (message: string) => {
    setError(message);
    onBusyChange(false);
  };

  const confirm = async (event: {
    expressPaymentType: string;
    paymentFailed: (payload?: { message?: string; reason?: "fail" }) => void;
  }) => {
    if (event.expressPaymentType !== "apple_pay") {
      event.paymentFailed({ reason: "fail", message: "Apple Pay is required." });
      return;
    }
    if (settlingRef.current || !stripe || !elements) {
      event.paymentFailed({ reason: "fail", message: "Apple Pay is still loading." });
      return;
    }
    settlingRef.current = true;
    onBusyChange(true);
    setError("");
    try {
      const submitted = await elements.submit();
      if (submitted.error) throw new Error(submitted.error.message);
      const funnel = await reservation();
      if (!funnel) throw new Error("Complete your booking details before paying with Apple Pay.");
      const prepared = await prepare.mutateAsync(funnel);
      if (prepared.totalCents !== totalCents) {
        throw new Error("The quoted price changed. Please review your booking before paying.");
      }
      paymentIntentRef.current = {
        ...funnel,
        paymentIntentId: prepared.paymentIntentId,
      };
      const confirmed = await stripe.confirmPayment({
        elements,
        clientSecret: prepared.clientSecret,
        redirect: "if_required",
      });
      if (confirmed.error) throw new Error(confirmed.error.message);
      if (confirmed.paymentIntent?.status !== "succeeded") {
        throw new Error("Apple Pay needs another confirmation. Please try again.");
      }
      const result = await settle.mutateAsync(paymentIntentRef.current);
      paymentIntentRef.current = null;
      onPaid(result.totalCents);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Apple Pay could not be completed. Please try again or use your card on file.";
      event.paymentFailed({ reason: "fail", message });
      fail(message);
    } finally {
      settlingRef.current = false;
      onBusyChange(false);
    }
  };

  return (
    <div
      className={`literal-book-apple-pay-element${active ? " is-active" : ""}`}
      aria-hidden={!active}
    >
      <ExpressCheckoutElement
        options={APPLE_PAY_ONLY_OPTIONS}
        onReady={event => setAvailable(event.availablePaymentMethods?.applePay === true)}
        onAvailablePaymentMethodsChange={event =>
          setAvailable(event.paymentMethods?.applePay?.available === true)
        }
        onConfirm={event => void confirm(event)}
        onCancel={() => {
          onBusyChange(false);
        }}
        onLoadError={() => setAvailable(false)}
      />
      {active && error ? (
        <p className="literal-book-apple-pay-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Apple Pay is intentionally a separate Elements tree from the card-on-file
 * form. The card subtree remains mounted while this native wallet UI appears.
 */
export function BookingApplePayCheckout({
  quote,
  active,
  onAvailabilityChange,
  onPrepareReservation,
  onPaid,
  onBusyChange,
}: Props) {
  const quoteMutation = trpc.bookingApplePay.quote.useMutation();
  const [walletTotal, setWalletTotal] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    setWalletTotal(null);
    onAvailabilityChange(false);
    void quoteMutation
      .mutateAsync({
        ...quote,
        pricing: {
          ...quote.pricing,
          extras: quote.pricing.extras.map(extra => ({
            id: extra.id,
            quantity: extra.quantity,
          })),
        },
      })
      .then(result => {
        if (current) setWalletTotal(result.totalCents);
      })
      .catch(() => {
        if (current) onAvailabilityChange(false);
      });
    return () => {
      current = false;
    };
  }, [onAvailabilityChange, quote]);

  if (!stripePromise || walletTotal === null) {
    return (
      <span className="literal-book-apple-pay-probe" aria-hidden="true">
        <Loader2 />
      </span>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{ mode: "payment", amount: walletTotal, currency: "usd" }}
    >
      <ApplePayElement
        active={active}
        reservation={onPrepareReservation}
        totalCents={walletTotal}
        onAvailabilityChange={onAvailabilityChange}
        onPaid={onPaid}
        onBusyChange={onBusyChange}
      />
    </Elements>
  );
}
