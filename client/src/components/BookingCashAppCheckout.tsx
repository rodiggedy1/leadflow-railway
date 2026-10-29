import { useEffect, useRef, useState, type FormEvent } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePublishableKey
  ? loadStripe(stripePublishableKey)
  : null;

type Reservation = {
  publicFunnelNumber: string;
  mutationToken: string;
};

type PreparedCashAppPayment = Reservation & {
  bookingId: number;
  paymentIntentId: string;
  clientSecret: string;
  returnToken: string;
  totalCents: number;
};

type Props = {
  active: boolean;
  totalCents: number;
  onPrepareReservation: () => Promise<Reservation | null>;
  onBusyChange: (busy: boolean) => void;
};

function money(cents: number) {
  return `$${Math.round(cents / 100)}`;
}

function CashAppPaymentForm({
  prepared,
  onBusyChange,
}: {
  prepared: PreparedCashAppPayment;
  onBusyChange: (busy: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError("");
    onBusyChange(true);
    try {
      const submitted = await elements.submit();
      if (submitted.error) throw new Error(submitted.error.message);
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/book?cashapp_return=${encodeURIComponent(prepared.returnToken)}`,
        },
        redirect: "always",
      });
      if (result.error) throw new Error(result.error.message);
      // Cash App normally redirects. This covers a Stripe test flow that finishes
      // synchronously without a browser redirect.
      window.location.assign(
        `/book?cashapp_return=${encodeURIComponent(prepared.returnToken)}`
      );
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Cash App could not be completed. Please try again or choose another method.";
      setError(message);
      setSubmitting(false);
      onBusyChange(false);
    }
  }

  return (
    <form className="literal-book-cashapp-form" onSubmit={submit}>
      <PaymentElement options={{ layout: "accordion" }} />
      {error ? <p className="literal-book-cashapp-error" role="alert">{error}</p> : null}
      <button
        className="literal-book-cashapp-submit"
        type="submit"
        disabled={!stripe || !elements || submitting}
      >
        {submitting ? <><Loader2 className="animate-spin" /> Opening Cash App…</> : <>Pay {money(prepared.totalCents)} with Cash App</>}
      </button>
      <p>Securely processed by Stripe. Cash App charges your first cleaning today.</p>
    </form>
  );
}

/**
 * A separate Cash App Elements tree. It starts a canonical, server-priced booking
 * payment only after the customer asks to continue with Cash App; the provider then
 * returns the customer to /book, where Stripe webhook/client reconciliation shows the
 * existing final thank-you screen exactly once.
 */
export function BookingCashAppCheckout({
  active,
  totalCents,
  onPrepareReservation,
  onBusyChange,
}: Props) {
  const prepare = trpc.cashApp.booking.prepare.useMutation();
  const abandon = trpc.cashApp.booking.abandon.useMutation();
  const [prepared, setPrepared] = useState<PreparedCashAppPayment | null>(null);
  const [error, setError] = useState("");
  const preparingRef = useRef(false);

  useEffect(() => {
    if (active || !prepared) return;
    const pending = prepared;
    setPrepared(null);
    void abandon.mutateAsync(pending).catch(() => {
      // Stripe webhooks remain authoritative if a provider confirmation wins.
    });
  }, [abandon, active, prepared]);

  async function beginCashApp() {
    if (preparingRef.current || prepared) return;
    preparingRef.current = true;
    onBusyChange(true);
    setError("");
    try {
      const funnel = await onPrepareReservation();
      if (!funnel) {
        throw new Error("Complete your booking details before paying with Cash App.");
      }
      const result = await prepare.mutateAsync(funnel);
      if (result.totalCents !== totalCents) {
        throw new Error("The quoted price changed. Please review your booking before paying.");
      }
      setPrepared({ ...funnel, ...result });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Cash App could not be prepared. Please try again or choose another method."
      );
    } finally {
      preparingRef.current = false;
      onBusyChange(false);
    }
  }

  if (!stripePromise) {
    return <p className="literal-book-cashapp-error" role="alert">Cash App checkout is temporarily unavailable. Please use Card on file.</p>;
  }

  if (!prepared) {
    return (
      <div className="literal-book-cashapp-start">
        <button
          type="button"
          className="literal-book-cashapp-submit"
          onClick={() => void beginCashApp()}
          disabled={!active || prepare.isPending}
        >
          {prepare.isPending ? <><Loader2 className="animate-spin" /> Preparing Cash App…</> : <>Continue with Cash App · {money(totalCents)}</>}
        </button>
        {error ? <p className="literal-book-cashapp-error" role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: prepared.clientSecret,
        appearance: {
          theme: "stripe",
          variables: { borderRadius: "14px" },
        },
      }}
    >
      <CashAppPaymentForm prepared={prepared} onBusyChange={onBusyChange} />
    </Elements>
  );
}
