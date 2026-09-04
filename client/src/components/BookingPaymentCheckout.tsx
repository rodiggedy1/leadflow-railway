import { useState } from "react";
import { Elements, CardElement } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CreditCard, LockKeyhole, ShieldCheck } from "lucide-react";
import { BOOKING_PAYMENT_CONSENT_TEXT } from "@shared/bookingPayment";
import { trpc } from "@/lib/trpc";
import { CARD_ELEMENT_OPTIONS, useStripeCardSetup } from "./useStripeCardSetup";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

type BookingPaymentCheckoutProps = {
  publicFunnelNumber: string;
  mutationToken: string;
  customerName: string;
  amountCents: number;
  savedCard?: { brand: string | null; last4: string } | null;
  onComplete: (result: { bookingId: number; cardBrand: string; cardLast4: string; portalAccessCode?: string | null; directPortalSessionReady?: boolean }) => void;
};

type SetupFormProps = {
  clientSecret: string;
  customerName: string;
  onConfirm: (paymentMethodId: string) => Promise<void>;
};

function ExistingCardSetupForm({ clientSecret, customerName, onConfirm }: SetupFormProps) {
  const { stripeReady, name, setName, cardError, loading, handleSubmit } = useStripeCardSetup({
    clientSecret,
    prefillName: customerName,
    onSetupSucceeded: async (paymentMethodId) => onConfirm(paymentMethodId),
  });
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="grid gap-1.5 text-[11px] font-bold text-[#3a3c41]">
        Name on card
        <input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="cc-name" className="h-11 rounded-xl border border-[#d7d8dc] bg-white px-3 text-[13px] text-[#3a3c41] outline-none focus:border-[#ff684c] focus:ring-2 focus:ring-[#ff684c]/20" />
      </label>
      <label className="grid gap-1.5 text-[11px] font-bold text-[#3a3c41]">
        Card details
        <span className="flex h-11 items-center rounded-xl border border-[#d7d8dc] bg-white px-3"><CardElement options={CARD_ELEMENT_OPTIONS} className="w-full" /></span>
      </label>
      {cardError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{cardError}</p>}
      <button type="submit" disabled={loading || !stripeReady} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff684c] px-4 py-3 text-[12px] font-extrabold text-white transition hover:bg-[#e9573e] disabled:cursor-wait disabled:opacity-60">
        <LockKeyhole className="h-4 w-4" />{loading ? "Saving secure card…" : "Save card to reserve →"}
      </button>
    </form>
  );
}

/** Booking adapter around the established Stripe Elements + confirmCardSetup collection path. */
export function BookingPaymentCheckout({ publicFunnelNumber, mutationToken, customerName, amountCents, savedCard, onComplete }: BookingPaymentCheckoutProps) {
  const startSetup = trpc.bookingPayments.startSetup.useMutation();
  const confirmSetup = trpc.bookingPayments.confirmSetup.useMutation();
  const reuseSavedCard = trpc.bookingPayments.reuseSavedCard.useMutation();
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [paymentChoice, setPaymentChoice] = useState<"saved" | "new">(savedCard ? "saved" : "new");

  const beginCardCollection = async () => {
    if (!consentAccepted) return;
    setCheckoutError("");
    try {
      const result = await startSetup.mutateAsync({ publicFunnelNumber, mutationToken, consentAccepted: true });
      if (result.alreadyComplete) {
        onComplete({ bookingId: result.bookingId, cardBrand: "Card", cardLast4: "saved", portalAccessCode: result.portalAccessCode, directPortalSessionReady: result.directPortalSessionReady });
        return;
      }
      setClientSecret(result.clientSecret);
    } catch (error: unknown) {
      setCheckoutError(error instanceof Error ? error.message : "We could not prepare secure card entry. Please try again.");
    }
  };

  const completeCardCollection = async (paymentMethodId: string) => {
    const result = await confirmSetup.mutateAsync({ publicFunnelNumber, mutationToken, paymentMethodId });
    onComplete(result);
  };

  const reserveWithSavedCard = async () => {
    setCheckoutError("");
    try {
      const result = await reuseSavedCard.mutateAsync({ publicFunnelNumber, mutationToken });
      onComplete(result);
    } catch (error: unknown) {
      setCheckoutError(error instanceof Error ? error.message : "We could not use your saved card. Please add a new card.");
    }
  };

  return (
    <div className="rounded-[20px] border border-[#e4e5e7] bg-white p-4 shadow-[0_14px_36px_rgba(22,20,33,0.08)] sm:p-5">
      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#fff1ed] text-[#e9573e]"><CreditCard className="h-4.5 w-4.5" /></span><div><h3 className="text-[15px] font-extrabold text-[#3a3c41]">Secure card on file</h3><p className="mt-0.5 text-[10px] text-[#6f7279]">${(amountCents / 100).toFixed(0)} after service · Stripe secure</p></div></div>
      <div className="mt-4 flex gap-3 rounded-xl border border-[#cfe9df] bg-[#f3fbf7] p-3 text-[10px] leading-5 text-[#41695a]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#168d61]" /><p>Add a card to reserve your cleaning. You won’t be charged until after service. Your payment information is securely handled by Stripe and is never stored on our servers.</p></div>
      {savedCard && !clientSecret && <div className="mt-4 grid gap-2" role="radiogroup" aria-label="Payment method"><button type="button" role="radio" aria-checked={paymentChoice === "saved"} onClick={() => setPaymentChoice("saved")} className={`rounded-xl border p-3 text-left ${paymentChoice === "saved" ? "border-[#ff684c] bg-[#fff7f4] ring-2 ring-[#ff684c]/10" : "border-[#e4e5e7] bg-white"}`}><strong className="block text-[12px] text-[#3a3c41]">Use {savedCard.brand ? `${savedCard.brand} ` : "card "}ending in {savedCard.last4}</strong><span className="mt-1 block text-[10px] text-[#6f7279]">Selected by default · no charge today</span></button><button type="button" role="radio" aria-checked={paymentChoice === "new"} onClick={() => setPaymentChoice("new")} className={`rounded-xl border p-3 text-left ${paymentChoice === "new" ? "border-[#ff684c] bg-[#fff7f4] ring-2 ring-[#ff684c]/10" : "border-[#e4e5e7] bg-white"}`}><strong className="block text-[12px] text-[#3a3c41]">Add a new card</strong><span className="mt-1 block text-[10px] text-[#6f7279]">Use a different payment method for this rebook</span></button></div>}
      {!clientSecret ? <div className="mt-4 space-y-3">{paymentChoice === "saved" && savedCard ? <button type="button" onClick={() => void reserveWithSavedCard()} disabled={reuseSavedCard.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff684c] px-4 py-3 text-[12px] font-extrabold text-white transition hover:bg-[#e9573e] disabled:cursor-not-allowed disabled:opacity-50"><LockKeyhole className="h-4 w-4" />{reuseSavedCard.isPending ? "Reserving with saved card…" : `Reserve with card ending in ${savedCard.last4} →`}</button> : <><label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-[#f8f7f5] p-3 text-[10px] leading-5 text-[#5f6168]"><input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff684c]" /><span>{BOOKING_PAYMENT_CONSENT_TEXT}</span></label><button type="button" onClick={() => void beginCardCollection()} disabled={!consentAccepted || startSetup.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff684c] px-4 py-3 text-[12px] font-extrabold text-white transition hover:bg-[#e9573e] disabled:cursor-not-allowed disabled:opacity-50"><LockKeyhole className="h-4 w-4" />{startSetup.isPending ? "Preparing secure card entry…" : "Continue to secure card entry →"}</button></>}</div> : <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}><div className="mt-4"><ExistingCardSetupForm clientSecret={clientSecret} customerName={customerName} onConfirm={completeCardCollection} /></div></Elements>}
      {checkoutError && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{checkoutError}</p>}
    </div>
  );
}
