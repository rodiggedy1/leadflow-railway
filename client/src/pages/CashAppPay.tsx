import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "wouter";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CheckCircle2, Clock3, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./cashapp-pay.css";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function CashAppCheckout({ token, amountCents }: { token: string; amountCents: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setSubmitted(true);
    setError(null);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/cashapp-pay/${token}?complete=1` },
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? "Cash App could not complete the payment.");
      setSubmitted(false);
    }
  }

  return (
    <form onSubmit={submit} className="cashapp-form">
      <div className="cashapp-method-label"><ShieldCheck size={16} /> Secure Cash App Pay checkout</div>
      <PaymentElement options={{ layout: "accordion" }} />
      {error && <div className="cashapp-error" role="alert">{error}</div>}
      <button className="cashapp-submit" type="submit" disabled={!stripe || !elements || submitted}>
        {submitted ? <><Loader2 size={17} className="spin" /> Opening Cash App…</> : <>Pay {money(amountCents)} with Cash App</>}
      </button>
      <p className="cashapp-secure"><LockKeyhole size={13} /> Payment details are securely handled by Stripe.</p>
    </form>
  );
}

export default function CashAppPay() {
  const { token = "" } = useParams<{ token: string }>();
  const complete = new URLSearchParams(window.location.search).get("complete") === "1";
  const link = trpc.cashApp.getLink.useQuery({ token }, { enabled: Boolean(token) });
  const status = trpc.cashApp.getStatus.useQuery({ token }, { enabled: Boolean(token) && complete, refetchInterval: complete ? 2000 : false });
  const createIntent = trpc.cashApp.createPaymentIntent.useMutation();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentStarted, setIntentStarted] = useState(false);

  useEffect(() => {
    if (!link.data || complete || clientSecret || intentStarted || createIntent.isPending) return;
    setIntentStarted(true);
    createIntent.mutate({ token }, { onSuccess: (data) => setClientSecret(data.clientSecret) });
  }, [link.data, complete, clientSecret, intentStarted, createIntent.isPending, token]);

  if (complete) {
    const paid = status.data?.status === "paid";
    return <main className="cashapp-shell"><section className="cashapp-card cashapp-success"><div className="cashapp-success-icon">{paid ? <CheckCircle2 size={42} /> : <Loader2 size={38} className="spin" />}</div><h1>{paid ? "Payment received" : "Confirming your payment"}</h1><p>{paid ? "Thank you. Your Cash App payment has been confirmed securely by Stripe." : "Stripe is confirming your Cash App payment. This page will update automatically."}</p><div className="cashapp-badge">Maids in Black · Secure payment</div></section></main>;
  }
  if (link.isLoading || createIntent.isPending) return <main className="cashapp-shell"><section className="cashapp-card cashapp-loading"><Loader2 size={28} className="spin" /><p>Preparing your secure payment…</p></section></main>;
  if (link.error || createIntent.error || !link.data) return <main className="cashapp-shell"><section className="cashapp-card"><div className="cashapp-alert"><Clock3 size={22} /><h1>Payment link unavailable</h1><p>{link.error?.message ?? createIntent.error?.message ?? "This link is no longer available."}</p></div></section></main>;

  return <main className="cashapp-shell"><div className="cashapp-brand"><span className="cashapp-mark">M</span><span>MAIDS IN BLACK</span></div><section className="cashapp-card"><div className="cashapp-eyebrow">Secure payment request</div><h1>{link.data.customerName ? `Hi ${link.data.customerName.split(" ")[0]},` : "Complete your payment"}</h1><p className="cashapp-intro">Your payment is securely processed through Stripe using Cash App Pay.</p><div className="cashapp-summary"><div><span>{link.data.description}</span><small>Amount due</small></div><strong>{money(link.data.amountCents)}</strong></div>{clientSecret && <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#111827", borderRadius: "14px", fontFamily: "Inter, system-ui, sans-serif" } } }}><CashAppCheckout token={token} amountCents={link.data.amountCents} /></Elements>}<p className="cashapp-expiry">This secure link expires {new Date(link.data.expiresAt).toLocaleDateString()}.</p></section><div className="cashapp-trust"><span><ShieldCheck size={15} /> Secure checkout</span><span><LockKeyhole size={15} /> Stripe protected</span></div></main>;
}
