import { useCallback, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { BookingWalletCardOnFileCheckout } from "./BookingApplePayCheckout";
import { InternalBookingCheckoutProvider, type InternalBookingCheckoutTransport } from "./BookingCheckoutTransport";

/** The existing wallet component and existing card-token APIs, connected only by this adapter. */
export default function ApplePayCardAuth({ token, bookingId, publicBookingNumber, customerName, amountCents, requestedStartAt }: {
  token: string;
  bookingId: number;
  publicBookingNumber: string;
  customerName: string;
  amountCents: number;
  requestedStartAt: number;
}) {
  const setup = trpc.stripe.createSetupIntent.useMutation();
  const confirm = trpc.stripe.confirmCardSaved.useMutation();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ cardBrand: string; cardLast4: string } | null>(null);
  const deferredPaymentDate = useMemo(() => new Date(requestedStartAt), [requestedStartAt]);
  const reservation = useMemo(() => ({ kind: "internal" as const, bookingId, publicBookingNumber }), [bookingId, publicBookingNumber]);
  const prepare = useCallback(async () => reservation, [reservation]);
  const transport = useMemo<InternalBookingCheckoutTransport>(() => ({
    async startSetup(input) {
      if (input.bookingId !== bookingId) throw new Error("The saved booking could not be verified.");
      const result = await setup.mutateAsync({ token });
      return { bookingId, alreadyComplete: false, clientSecret: result.clientSecret, setupIntentId: null };
    },
    async confirmSetup(input) {
      if (input.bookingId !== bookingId || input.wallet !== "apple_pay") throw new Error("The saved booking could not be verified.");
      const result = await confirm.mutateAsync({ token, paymentMethodId: input.paymentMethodId });
      if (result.success !== true) throw new Error("Card saving was not confirmed. Please try again.");
      return { bookingId, cardBrand: result.cardBrand, cardLast4: result.cardLast4 };
    },
    async prepareCashApp() { throw new Error("This link saves a card only."); },
    async settleCashApp() { throw new Error("This link saves a card only."); },
    async abandonCashApp() { throw new Error("This link saves a card only."); },
  }), [bookingId, token, setup.mutateAsync, confirm.mutateAsync]);

  if (saved) return <section role="status"><h2>Your card is saved</h2><p>{saved.cardBrand} ending {saved.cardLast4} is on file for your existing booking. No charge was made through this link.</p></section>;
  return <section aria-label="Save a card with Apple Pay" aria-busy={busy}>
    <h2>Save your card with Apple Pay</h2>
    <p>Secure card-on-file authorization only. No charge today. Your existing cleaning booking is unchanged.</p>
    <InternalBookingCheckoutProvider value={transport}>
      <BookingWalletCardOnFileCheckout wallet="apple_pay" active customerName={customerName} deferredAmountCents={amountCents} deferredPaymentDate={deferredPaymentDate} onAvailabilityChange={setAvailable} onPrepareReservation={prepare} onComplete={setSaved} onBusyChange={setBusy} />
    </InternalBookingCheckoutProvider>
    {!available && <p role="status">Apple Pay requires a compatible browser and an eligible card in Wallet. You can use the <a href={`/pay/${encodeURIComponent(token)}`}>same secure link to enter a card instead</a>.</p>}
  </section>;
}
