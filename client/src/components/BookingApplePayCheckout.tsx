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
import { BOOKING_PAYMENT_CONSENT_TEXT } from "@shared/bookingPayment";

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePublishableKey
  ? loadStripe(stripePublishableKey)
  : null;

type Reservation = {
  publicFunnelNumber: string;
  mutationToken: string;
};

type Wallet = "apple_pay" | "google_pay";

type Props = {
  wallet: Wallet;
  active: boolean;
  customerName: string;
  deferredAmountCents: number;
  deferredPaymentDate: Date;
  onAvailabilityChange: (available: boolean) => void;
  onPrepareReservation: () => Promise<Reservation | null>;
  onComplete: (result: {
    cardBrand: string;
    cardLast4: string;
  }) => void;
  onBusyChange: (busy: boolean) => void;
};

export const walletDetails = {
  apple_pay: {
    label: "Apple Pay",
    unavailable:
      "Apple Pay is not available in this browser or Wallet. You can use Card on file or Google Pay instead.",
  },
  google_pay: {
    label: "Google Pay",
    unavailable:
      "Google Pay is not available in this browser or Wallet. You can use Card on file or Apple Pay instead.",
  },
} as const;

function walletOptions(
  wallet: Wallet,
  deferredAmountCents: number,
  deferredPaymentDate: Date
) {
  return {
    buttonHeight: 44,
    buttonTheme: {
      applePay: "black" as const,
      googlePay: "black" as const,
    },
    buttonType: {
      applePay: "book" as const,
      googlePay: "book" as const,
    },
    layout: { maxColumns: 1, maxRows: 1, overflow: "auto" as const },
    paymentMethodOrder: [wallet],
    paymentMethods: {
      applePay: wallet === "apple_pay" ? ("always" as const) : ("never" as const),
      amazonPay: "never" as const,
      googlePay: wallet === "google_pay" ? ("always" as const) : ("never" as const),
      klarna: "never" as const,
      link: "never" as const,
      paypal: "never" as const,
    },
    ...(wallet === "apple_pay"
      ? {
          applePay: {
            deferredPaymentRequest: {
              paymentDescription: "Maids in Black cleaning service",
              managementURL: "https://maidsinblack.com/",
              deferredBilling: {
                amount: deferredAmountCents,
                label: "Cleaning service",
                deferredPaymentDate,
              },
            },
          },
        }
      : {}),
  };
}

function WalletCardOnFileElement({
  wallet,
  active,
  customerName,
  deferredAmountCents,
  deferredPaymentDate,
  onAvailabilityChange,
  onPrepareReservation,
  onComplete,
  onBusyChange,
}: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const startSetup = trpc.bookingPayments.startSetup.useMutation();
  const confirmSetup = trpc.bookingPayments.confirmSetup.useMutation();
  const [error, setError] = useState("");
  const confirmingRef = useRef(false);
  const details = walletDetails[wallet];

  useEffect(() => {
    if (active) return;
    confirmingRef.current = false;
    onBusyChange(false);
  }, [active, onBusyChange]);

  const fail = (
    event: { paymentFailed: (payload?: { message?: string; reason?: "fail" }) => void },
    message: string
  ) => {
    event.paymentFailed({ reason: "fail", message });
    setError(message);
    onBusyChange(false);
  };

  const confirm = async (event: {
    expressPaymentType: string;
    paymentFailed: (payload?: { message?: string; reason?: "fail" }) => void;
  }) => {
    if (event.expressPaymentType !== wallet) {
      fail(event, `${details.label} is required.`);
      return;
    }
    if (confirmingRef.current || !stripe || !elements) {
      fail(event, `${details.label} is still loading. Please try again.`);
      return;
    }
    confirmingRef.current = true;
    onBusyChange(true);
    setError("");
    try {
      const submitted = await elements.submit();
      if (submitted.error) throw new Error(submitted.error.message);
      const reservation = await onPrepareReservation();
      if (!reservation) {
        throw new Error("Complete your booking details before saving this payment method.");
      }
      const setup = await startSetup.mutateAsync(reservation);
      if (!setup.clientSecret) {
        throw new Error("We could not prepare secure payment setup. Please try again.");
      }
      const confirmed = await stripe.confirmSetup({
        elements,
        clientSecret: setup.clientSecret,
        confirmParams: {
          return_url: window.location.href,
          payment_method_data: {
            billing_details: { name: customerName },
          },
        },
        redirect: "if_required",
      });
      if (confirmed.error) throw new Error(confirmed.error.message);
      const paymentMethodId = confirmed.setupIntent?.payment_method;
      if (typeof paymentMethodId !== "string") {
        throw new Error("Secure payment setup did not return a card. Please try again.");
      }
      const result = await confirmSetup.mutateAsync({
        ...reservation,
        paymentMethodId,
        consentAccepted: true,
        deferConfirmation: true,
      });
      onComplete({
        cardBrand: result.cardBrand,
        cardLast4: result.cardLast4,
      });
    } catch (cause) {
      fail(
        event,
        cause instanceof Error
          ? cause.message
          : `${details.label} could not be saved. Please try again or use Card on file.`
      );
    } finally {
      confirmingRef.current = false;
      onBusyChange(false);
    }
  };

  return (
    <div
      className={`literal-book-wallet-element${active ? " is-active" : ""}`}
      aria-hidden={!active}
    >
      <ExpressCheckoutElement
        options={walletOptions(wallet, deferredAmountCents, deferredPaymentDate)}
        onReady={event =>
          onAvailabilityChange(
            wallet === "apple_pay"
              ? event.availablePaymentMethods?.applePay === true
              : event.availablePaymentMethods?.googlePay === true
          )
        }
        onAvailablePaymentMethodsChange={event =>
          onAvailabilityChange(
            wallet === "apple_pay"
              ? event.paymentMethods?.applePay?.available === true
              : event.paymentMethods?.googlePay?.available === true
          )
        }
        onConfirm={event => void confirm(event)}
        onCancel={() => onBusyChange(false)}
        onLoadError={event => {
          onAvailabilityChange(false);
          setError(`${details.label} could not initialize: ${event.error.message}`);
        }}
      />
      {active && error ? (
        <p className="literal-book-wallet-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Native wallet setup uses the same existing SetupIntent, payment-method
 * verification, and canonical finalization as Card on file.
 */
export function BookingWalletCardOnFileCheckout(props: Props) {
  const [ready, setReady] = useState(false);
  const details = walletDetails[props.wallet];

  useEffect(() => {
    setReady(false);
    props.onAvailabilityChange(false);
    const timeout = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(timeout);
  }, [props.onAvailabilityChange, props.wallet]);

  if (!stripePromise || !ready) {
    return (
      <span className="literal-book-wallet-probe" aria-hidden="true">
        <Loader2 />
      </span>
    );
  }

  return (
    <>
      <Elements
        stripe={stripePromise}
        options={{
          mode: "setup",
          currency: "usd",
          setupFutureUsage: "off_session",
        }}
      >
        <WalletCardOnFileElement {...props} />
      </Elements>
      {props.active ? (
        <p className="literal-book-wallet-consent">
          {`By selecting ${details.label}, ${BOOKING_PAYMENT_CONSENT_TEXT.replace("I authorize", "you authorize").replace("My card", "your card").replace("I may", "you may")}`}
        </p>
      ) : null}
    </>
  );
}
