import { useCallback, useEffect, useRef, useState } from "react";
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

type ExitDestination = "card" | "apple_pay" | "google_pay" | null;

type Props = {
  active: boolean;
  totalCents: number;
  exitRequest: Exclude<ExitDestination, null> | null;
  onPrepareReservation: () => Promise<Reservation | null>;
  onBusyChange: (busy: boolean) => void;
  onPaid: (totalCents: number) => void;
  onExited: (destination: ExitDestination, notice?: string) => void;
};

/**
 * Cash App has no customer-entered booking fields. Selecting it starts Stripe's
 * native Cash App authorization. If the customer cancels or switches payment
 * methods, the existing booking-bound abandon procedure releases only the
 * pending Cash App intent before the alternative method becomes available.
 */
export function BookingCashAppCheckout({
  active,
  totalCents,
  exitRequest,
  onPrepareReservation,
  onBusyChange,
  onPaid,
  onExited,
}: Props) {
  const prepare = trpc.cashApp.booking.prepare.useMutation();
  const settle = trpc.cashApp.booking.settle.useMutation();
  const abandon = trpc.cashApp.booking.abandon.useMutation();
  const [prepared, setPrepared] = useState<PreparedCashAppPayment | null>(null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const preparedRef = useRef<PreparedCashAppPayment | null>(null);
  const startingRef = useRef(false);
  const cancellingRef = useRef(false);
  const exitRef = useRef<{ destination: ExitDestination } | null>(null);

  const settleSucceeded = useCallback(
    async (payment: PreparedCashAppPayment) => {
      await settle.mutateAsync({
        publicFunnelNumber: payment.publicFunnelNumber,
        mutationToken: payment.mutationToken,
        paymentIntentId: payment.paymentIntentId,
      });
      preparedRef.current = null;
      setPrepared(null);
      onBusyChange(false);
      onPaid(payment.totalCents);
    },
    [onBusyChange, onPaid, settle]
  );

  const completeExit = useCallback(
    (destination: ExitDestination, notice?: string) => {
      preparedRef.current = null;
      setPrepared(null);
      startingRef.current = false;
      cancellingRef.current = false;
      exitRef.current = null;
      setCancelling(false);
      onBusyChange(false);
      onExited(destination, notice);
    },
    [onBusyChange, onExited]
  );

  const abandonPrepared = useCallback(
    async (payment: PreparedCashAppPayment, destination: ExitDestination) => {
      if (cancellingRef.current) return;
      cancellingRef.current = true;
      setCancelling(true);
      setError("");
      try {
        const result = await abandon.mutateAsync(payment);
        if ("alreadySucceeded" in result && result.alreadySucceeded) {
          await settleSucceeded(payment);
          return;
        }
        if (!result.abandoned) {
          throw new Error("Cash App is still confirming. Please try Cancel Cash App again.");
        }
        completeExit(
          destination,
          destination === null
            ? "Cash App wasn’t completed. Choose another payment method."
            : undefined
        );
      } catch (cause) {
        cancellingRef.current = false;
        setCancelling(false);
        setError(
          cause instanceof Error
            ? cause.message
            : "Cash App could not be cancelled. Please try Cancel Cash App again."
        );
      }
    },
    [abandon, completeExit, settleSucceeded]
  );

  const requestExit = useCallback(
    (destination: ExitDestination) => {
      if (cancellingRef.current || exitRef.current) return;
      exitRef.current = { destination };
      setCancelling(true);
      setError("");
      const payment = preparedRef.current;
      if (payment) void abandonPrepared(payment, destination);
    },
    [abandonPrepared]
  );

  useEffect(() => {
    if (exitRequest === null) return;
    requestExit(exitRequest);
  }, [exitRequest, requestExit]);

  useEffect(() => {
    if (active) return;
    startingRef.current = false;
    cancellingRef.current = false;
    exitRef.current = null;
    setPrepared(null);
    preparedRef.current = null;
    setError("");
    setCancelling(false);
  }, [active]);

  useEffect(() => {
    if (!active || preparedRef.current || startingRef.current) return;
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
        const pending: PreparedCashAppPayment = { ...funnel, ...payment };
        preparedRef.current = pending;
        setPrepared(pending);

        if (exitRef.current) {
          await abandonPrepared(pending, exitRef.current.destination);
          return;
        }

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
          await settleSucceeded(pending);
          return;
        }
        setError("Cash App wasn’t completed. Cancel Cash App or choose another payment method.");
      } catch (cause) {
        const exit = exitRef.current;
        if (exit) {
          if (!preparedRef.current) completeExit(exit.destination);
          return;
        }
        setError(
          cause instanceof Error
            ? cause.message
            : "Cash App could not be completed. Choose another payment method."
        );
        if (!preparedRef.current) onBusyChange(false);
      }
    })();
  }, [
    abandonPrepared,
    active,
    completeExit,
    onBusyChange,
    onPrepareReservation,
    prepare,
    requestExit,
    settleSucceeded,
    totalCents,
  ]);

  if (!active) return null;
  return (
    <div className="literal-book-cashapp-pending" role="status">
      {cancelling ? (
        <>
          <Loader2 className="animate-spin" /> Canceling Cash App…
        </>
      ) : (
        <>
          <Loader2 className="animate-spin" /> Opening secure Cash App…
        </>
      )}
      <button
        type="button"
        className="literal-book-cashapp-cancel"
        onClick={() => requestExit(null)}
        disabled={cancelling}
      >
        Cancel Cash App
      </button>
      {error ? <p className="literal-book-cashapp-error" role="alert">{error}</p> : null}
    </div>
  );
}
