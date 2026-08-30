import { useEffect, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CreditCard, Loader2, Lock, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "pk_test_placeholder");
type SavedCard = { cardBrand: string; cardLast4: string; cardExpMonth: number; cardExpYear: number };

function CardSetupForm({ token, fullName, totalCents, onSuccess }: { token: string; fullName: string; totalCents: number; onSuccess: (card: SavedCard) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const confirmSaved = trpc.stripe.confirmCardSaved.useMutation();
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!stripe || !elements || !complete || submitting) return;
    setSubmitting(true); setError("");
    try {
      const result = await stripe.confirmSetup({ elements, confirmParams: { return_url: window.location.href, payment_method_data: { billing_details: { name: fullName } } }, redirect: "if_required" });
      if (result.error) throw new Error(result.error.message || "Unable to save this card.");
      const paymentMethodId = typeof result.setupIntent?.payment_method === "string" ? result.setupIntent.payment_method : result.setupIntent?.payment_method?.id;
      if (!paymentMethodId) throw new Error("Stripe did not return a payment method.");
      onSuccess(await confirmSaved.mutateAsync({ token, paymentMethodId }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save this card. Please try again."); }
    finally { setSubmitting(false); }
  };
  return <div className="p-5"><div className="flex items-center justify-between gap-3"><div className="text-[13px] font-extrabold text-[#3a3c41]">Payment</div><div className="flex items-center gap-1.5 text-[10px] font-bold text-[#6f7279]"><Lock className="h-3.5 w-3.5" /> Secure payment by Stripe</div></div><div className="mt-3 flex items-start gap-3 rounded-xl border border-[#cfe9df] bg-[#f3fbf7] p-3.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-white text-[#168d61] shadow-sm"><ShieldCheck className="h-4 w-4" /></span><p className="text-[10px] leading-5 text-[#41695a]">Add a card to reserve your cleaning. You won’t be charged until after service. Your payment information is securely handled by Stripe and is never stored on our servers.</p></div><div className="mt-4 rounded-xl border border-[#d7d8dc] bg-white px-4 py-4 shadow-sm"><PaymentElement onChange={(event) => setComplete(event.complete)} options={{ layout: "tabs" }} /></div>{error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] text-red-700">{error}</p>}<p className="mt-4 text-[10px] leading-5 text-[#6f7279]">Your card is securely kept on file. The first cleaning total is ${(totalCents / 100).toFixed(0)}, charged only after service.</p><button type="button" onClick={() => void submit()} disabled={!stripe || !complete || submitting} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff684c] px-4 py-3.5 text-[12px] font-bold text-white transition hover:bg-[#e9573e] disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving card…</> : <><CreditCard className="h-4 w-4" /> Confirm &amp; book — ${(totalCents / 100).toFixed(0)}</>}</button></div>;
}

export default function BookingStripeCardForm({ token, fullName, totalCents, onSuccess }: { token: string; fullName: string; totalCents: number; onSuccess: (card: SavedCard) => void }) {
  const setup = trpc.stripe.createSetupIntent.useMutation();
  const [clientSecret, setClientSecret] = useState("");
  useEffect(() => { setClientSecret(""); setup.mutate({ token }, { onSuccess: (result) => setClientSecret(result.clientSecret) }); }, [token]);
  if (setup.error) return <div role="alert" className="m-5 rounded-xl border border-red-200 bg-red-50 p-4 text-[11px] text-red-700">{setup.error.message}</div>;
  if (!clientSecret) return <div className="flex items-center justify-center gap-2 p-8 text-[11px] font-bold text-[#6f7279]"><Loader2 className="h-4 w-4 animate-spin" /> Preparing secure card fields…</div>;
  return <Elements stripe={stripePromise} options={{ clientSecret }}><CardSetupForm token={token} fullName={fullName} totalCents={totalCents} onSuccess={onSuccess} /></Elements>;
}
