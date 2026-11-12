import { useEffect, useRef, useState, type FormEvent } from "react";
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
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: `${window.location.origin}/cashapp-pay/${token}?complete=1` },
        redirect: "if_required",
      });
      if (result.error) {
        setError(result.error.message ?? "Cash App could not complete the payment.");
        setSubmitted(false);
      } else if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing") {
        // QR approval can complete without a redirect. Reuse the same return
        // screen; only server verification below can declare the booking paid.
        window.location.replace(`${window.location.origin}/cashapp-pay/${token}?complete=1`);
      } else {
        setError("Cash App has not confirmed this payment. Check Cash App before retrying.");
        setSubmitted(false);
      }
    } catch {
      setError("Cash App could not confirm the payment here. Check Cash App before retrying.");
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

  const confirmPayment = trpc.cashApp.confirmPayment.useMutation();
  const [confirmation, setConfirmation] = useState<{ token: string; status: string } | null>(null);
  const [confirmationError, setConfirmationError] = useState(false);
  const checkPaymentRef = useRef<(() => void) | null>(null);
  const serverPaidRef = useRef(false);
  serverPaidRef.current = status.data?.status === "paid";

  useEffect(() => {
    // Ordinary Cash App links keep their existing status/webhook path.
    if (!complete || !token.startsWith("hp1_") || serverPaidRef.current) return;
    let active = true;
    let inFlight = false;
    let attempts = 0;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delays = [2000, 5000, 10000];
    const check = async () => {
      if (!active || inFlight || finished || serverPaidRef.current) return;
      inFlight = true;
      if (timer) clearTimeout(timer);
      setConfirmationError(false);
      try {
        // The token identifies the already-created intent. No browser-supplied
        // amount, booking ID, intent ID or SDK status is accepted as payment proof.
        const result = await confirmPayment.mutateAsync({ token });
        if (!active) return;
        setConfirmation({ token, status: result.status });
        finished = result.status === "paid" || result.status === "cancelled";
        if (!finished && attempts < delays.length) timer = setTimeout(() => void check(), delays[attempts++]);
      } catch {
        if (active) setConfirmationError(true);
      } finally {
        inFlight = false;
      }
    };
    const retry = () => { if (!inFlight) { attempts = 0; void check(); } };
    checkPaymentRef.current = retry;
    const onFocus = () => retry();
    window.addEventListener("focus", onFocus);
    void check();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      if (checkPaymentRef.current === retry) checkPaymentRef.current = null;
    };
  }, [complete, token, confirmPayment.mutateAsync]);

  useEffect(() => {
    if (!link.data || complete || clientSecret || intentStarted || createIntent.isPending) return;
    setIntentStarted(true);
    createIntent.mutate({ token }, { onSuccess: (data) => setClientSecret(data.clientSecret) });
  }, [link.data, complete, clientSecret, intentStarted, createIntent.isPending, token]);

  if (complete) {
    const confirmedStatus = confirmation?.token === token ? confirmation.status : null;
    const paid = status.data?.status === "paid" || confirmedStatus === "paid";
    const cancelled = !paid && (status.data?.status === "cancelled" || confirmedStatus === "cancelled");
    return <main className="cashapp-shell"><section className="cashapp-card cashapp-success"><div className="cashapp-success-icon">{paid ? <CheckCircle2 size={42} /> : cancelled ? <Clock3 size={38} /> : <Loader2 size={38} className="spin" />}</div><h1>{paid ? "Payment received" : cancelled ? "Payment canceled" : "Confirming your payment"}</h1><p>{paid ? "Thank you. Your Cash App payment has been confirmed securely by Stripe." : cancelled ? "Stripe reports that this Cash App payment was canceled." : "Stripe is confirming your Cash App payment. This page will update automatically."}</p>{!paid && !cancelled && token.startsWith("hp1_") && <><p>Already approved in Cash App? Do not pay again. Check this existing payment below.</p>{(confirmationError || status.error) && <div className="cashapp-error" role="alert">We could not verify your payment here yet. Checking again will not charge you again.</div>}<button className="cashapp-submit" type="button" disabled={confirmPayment.isPending} onClick={() => checkPaymentRef.current?.()}>{confirmPayment.isPending ? "Checking payment…" : "Check payment status"}</button></>}<div className="cashapp-badge">Maids in Black · Secure payment</div></section></main>;
  }
  if (link.isLoading || createIntent.isPending) return <main className="cashapp-shell"><section className="cashapp-card cashapp-loading"><Loader2 size={28} className="spin" /><p>Preparing your secure payment…</p></section></main>;
  if (link.error || createIntent.error || !link.data) return <main className="cashapp-shell"><section className="cashapp-card"><div className="cashapp-alert"><Clock3 size={22} /><h1>Payment link unavailable</h1><p>{link.error?.message ?? createIntent.error?.message ?? "This link is no longer available."}</p></div></section></main>;

  return <main className="cashapp-shell"><div className="cashapp-brand"><span className="cashapp-mark">M</span><span>MAIDS IN BLACK</span></div><section className="cashapp-card"><div className="cashapp-eyebrow">Secure payment request</div><h1>{link.data.customerName ? `Hi ${link.data.customerName.split(" ")[0]},` : "Complete your payment"}</h1><p className="cashapp-intro">Your payment is securely processed through Stripe using Cash App Pay.</p><div className="cashapp-summary"><div><span>{link.data.description}</span><small>Amount due</small></div><strong>{money(link.data.amountCents)}</strong></div>{clientSecret && <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#111827", borderRadius: "14px", fontFamily: "Inter, system-ui, sans-serif" } } }}><CashAppCheckout token={token} amountCents={link.data.amountCents} /></Elements>}<p className="cashapp-expiry">This secure link expires {new Date(link.data.expiresAt).toLocaleDateString()}.</p></section><div className="cashapp-trust"><span><ShieldCheck size={15} /> Secure checkout</span><span><LockKeyhole size={15} /> Stripe protected</span></div></main>;
}
