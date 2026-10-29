import { useEffect, useRef, useState } from "react";
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
  onPaid: (totalCents: number) => void;
};

/**
 * Cash App has no customer-entered booking fields. Once its row is selected,
 * prepare the server-priced intent and invoke Stripe's native Cash App flow in
 * that same user action. Stripe displays the desktop QR code or redirects to
 * the Cash App mobile app as appropriate.
 */
export function BookingCashAppCheckout({
  active,
  totalCents,
  onPrepareReservation,
  onBusyChange,
  onPaid,
}: Props) {
  const prepare = trpc.cashApp.booking.prepare.useMutation();
  const settle = trpc.cashApp.booking.settle.useMutation();
  const abandon = trpc.cashApp.booking.abandon.useMutation();
  const [prepared, setPrepared] = useState<PreparedCashAppPayment | null>(null);
  const [error, setError] = useState("");
  const startingRef = useRef(false);

  useEffect(() => {
    if (active) return;
    startingRef.current = false;
    setError("");
    if (!prepared) return;
    const pending = prepared;
    setPrepared(null);
    void abandon.mutateAsync(pending).catch(() => {
      // Stripe webhooks remain authoritative if a provider confirmation wins.
    });
  }, [abandon, active, prepared]);

  useEffect(() => {
    if (!active || prepared || startingRef.current) return;
    if (!stripePromise) {
      setError("Cash App checkout is temporarily unavailable. Please use Card on file.");
      return;
    }
    startingRef.current = true;
    onBusyChange(true);
    setError("");

    void (async () => {
      try {
        const funnel = await onPrepareReservation();
        if (!funnel) {
          throw new Error("Complete your booking details before paying with Cash App.");
        }
        const payment = await prepare.mutateAsync(funnel);
        if (payment.totalCents !== totalCents) {
          throw new Error("The quoted price changed. Please review your booking before paying.");
        }
        setPrepared({ ...funnel, ...payment });

        const stripe = await stripePromise;
        if (!stripe) {
          throw new Error("Cash App checkout is temporarily unavailable. Please use Card on file.");
        }
        const result = await stripe.confirmCashappPayment(payment.clientSecret, {
          payment_method: {},
          return_url: `${window.location.origin}/book?cashapp_return=${encodeURIComponent(payment.returnToken)}`,
        });
        if (result.error) throw new Error(result.error.message);
        if (result.paymentIntent?.status === "succeeded") {
          await settle.mutateAsync({
            publicFunnelNumber: funnel.publicFunnelNumber,
            mutationToken: funnel.mutationToken,
            paymentIntentId: payment.paymentIntentId,
          });
          onBusyChange(false);
          onPaid(payment.totalCents);
          return;
        }
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Cash App could not be completed. Please choose another method."
        );
        onBusyChange(false);
      }
    })();
  }, [active, onBusyChange, onPaid, onPrepareReservation, prepare, prepared, settle, totalCents]);

  if (!active) return null;
  if (error) return <p className="literal-book-cashapp-error" role="alert">{error}</p>;
  return (
    <p className="literal-book-cashapp-pending" role="status">
      <Loader2 className="animate-spin" /> Opening secure Cash App…
    </p>
  );
}
