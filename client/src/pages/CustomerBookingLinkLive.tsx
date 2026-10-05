import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import teamPhoto from "../assets/book-now-review/maids-in-black-team-shirt-index2.jpg";
import "./customer-booking-link-review.css";

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(`${value}T12:00:00`)) : "your selected date";
const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(`2026-01-01T${value}:00`)) : "your selected time";
const dollars = (cents: number | null) => `$${Math.round((cents ?? 0) / 100).toLocaleString()}`;

function WistiaPlayer() {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || container.querySelector("wistia-player")) return;
    const player = document.createElement("wistia-player");
    player.setAttribute("media-id", "bzlt49ipk1");
    player.setAttribute("seo", "false");
    player.setAttribute("aspect", "1.7777777777777777");
    player.style.display = "block";
    player.style.width = "100%";
    container.appendChild(player);
  }, []);
  return <div ref={containerRef} className="customer-link-video" />;
}

export default function CustomerBookingLinkLive() {
  const { token = "" } = useParams<{ token: string }>();
  const quote = trpc.bookingFunnel.getCustomerLink.useQuery({ token }, { enabled: Boolean(token) });
  const submit = trpc.bookingFunnel.submitCustomerLink.useMutation();
  const [step, setStep] = useState<"booking" | "details" | "success">("booking");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [recurrence, setRecurrence] = useState<"one-time" | "weekly" | "biweekly" | "monthly">("one-time");
  const [error, setError] = useState<string | null>(null);
  const data = quote.data;
  const firstName = (name || data?.customerName || "there").split(/\s+/)[0];
  const effectiveName = name || data?.customerName || "";
  const effectivePhone = phone || data?.customerPhone || "";
  const effectiveEmail = email || data?.customerEmail || "";
  const effectiveAddress = address || data?.address || "";
  const pricing = data?.priceSnapshot && typeof data.priceSnapshot === "object" ? (data.priceSnapshot as { input: { pricingMode: "home" | "hourly"; serviceId: "standard" | "deep" | "moveout"; bedrooms: number; bathrooms: number; homeType: "House" | "Apartment" | "Townhome" | "Condo"; condition: number; maidCount: number; hourCount: number; extras: { id: string; quantity: number }[]; recurrence: "one-time" | "weekly" | "biweekly" | "monthly" } }).input : null;
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!data || !pricing) return;
    setError(null);
    try {
      await submit.mutateAsync({ token, idempotencyKey: crypto.randomUUID(), customerName: effectiveName, customerPhone: effectivePhone, customerEmail: effectiveEmail, address: effectiveAddress, requestedLocalDate: data.requestedLocalDate ?? "", requestedLocalTime: data.requestedLocalTime ?? "", recurrence, pricing: { ...pricing, recurrence }, additionalServices: [] });
      setStep("success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We could not reserve this cleaning. Please try again."); }
  };
  if (quote.isLoading) return <main className="customer-link-page"><section className="customer-link-shell"><div className="customer-link-content"><p>Loading your personalized quote…</p></div></section></main>;
  if (quote.error || !data) return <main className="customer-link-page"><section className="customer-link-shell"><div className="customer-link-content"><h1>This link is unavailable</h1><p>{quote.error?.message ?? "Please ask your Maids in Black representative for a new link."}</p></div></section></main>;
  return <main className="customer-link-page"><div className="customer-link-simple-header"><a className="customer-link-simple-brand" href="https://maidsinblack.com">Maids in Black</a><div className="customer-link-simple-secure">🔒 Secure booking</div></div><section className="customer-link-shell"><div className={`customer-link-content customer-link-step-${step}`}>
    {step === "success" ? <section className="customer-link-success"><div className="customer-link-success-mark">✓</div><div className="customer-link-eyebrow">You're booked</div><h1>Consider it handled.</h1><p>Your cleaning is reserved for <b>{formatDate(data.requestedLocalDate)} at {formatTime(data.requestedLocalTime)}</b>.</p><div className="customer-link-booking-summary"><h3>Your booking</h3><div><span>Name</span><b>{effectiveName}</b></div><div><span>Address</span><b>{effectiveAddress}</b></div><div><span>Service</span><b>{data.serviceName}</b></div><div><span>Home</span><b>{data.bedrooms} bedrooms · {data.bathrooms} bathrooms</b></div><div><span>First cleaning</span><b>{dollars(data.firstCleaningTotalCents)}</b></div></div></section> : step === "booking" ? <>
      <div className="customer-link-heading"><p className="customer-link-eyebrow">Almost there</p><h1>Hi {firstName} <span aria-hidden="true">👋</span><br />Let’s get you booked.</h1><p>We’ve already filled in the details you gave us. Just choose a time.</p></div><div className="customer-link-video-wrap"><WistiaPlayer /><p className="customer-link-video-caption">See how we work — 60 seconds</p></div><div className="customer-link-rating"><span>★★★★★</span><b>4.9 on Google</b><em>· Trusted by local homeowners</em></div><div className="customer-link-summary"><span>{data.serviceName}</span><span>{data.bedrooms} bedrooms</span><span>{data.bathrooms} bathrooms</span><strong>{dollars(data.firstCleaningTotalCents)}</strong></div><div className="customer-link-benefits"><span>✓ Supplies included</span><span>✓ Background-checked team</span><span>✓ Insured</span><span>✓ Satisfaction guaranteed</span></div><div className="customer-link-section-heading"><h2>Your reserved opening</h2><p>Madison found this opening for you.</p></div><div className="customer-link-options customer-link-date-options"><button type="button" className="customer-link-option is-selected"><b>{formatDate(data.requestedLocalDate)}</b><small>Reserved for you</small></button></div><div className="customer-link-options customer-link-time-options"><button type="button" className="customer-link-option is-selected"><b>{formatTime(data.requestedLocalTime)}</b><small>Arrival window</small><em>Available</em></button></div><div className="customer-link-confidence"><b>Your home is in good hands.</b><span>✓ Vetted, background-checked cleaning teams<br />✓ Fully insured<br />✓ Not happy? Tell us and we'll make it right.</span></div><div className="customer-link-testimonial"><div className="customer-link-testimonial-avatar">AC</div><div><div className="customer-link-testimonial-stars">★★★★★</div><p>“Our home has never looked and smelled so clean.”</p><small>— Amber C. · Google review</small></div></div><img className="customer-link-team-photo" src={teamPhoto} alt="Professional Maids in Black cleaning team" /><p className="customer-link-photo-caption">Professional Maids in Black cleaning team</p><button type="button" className="customer-link-primary" onClick={() => setStep("details")}>Continue <span>→</span></button>
    </> : <form className="customer-link-details" onSubmit={handleSubmit}><div className="customer-link-final-heading"><p className="customer-link-eyebrow">Final step</p><h1>Reserve your cleaning.</h1></div><p className="customer-link-chosen"><b>{formatDate(data.requestedLocalDate)} · {formatTime(data.requestedLocalTime)}</b><br />{data.serviceName} · {data.bedrooms} bed · {data.bathrooms} bath</p><div className="customer-link-price">{dollars(data.firstCleaningTotalCents)}</div><div className="customer-link-label">Save on future cleanings <small>(optional)</small></div><div className="customer-link-plans">{(["one-time", "biweekly", "monthly"] as const).map(plan => <button key={plan} type="button" className={recurrence === plan ? "is-selected" : ""} onClick={() => setRecurrence(plan)}><span><input type="radio" checked={recurrence === plan} readOnly /> <b>{plan === "one-time" ? "One time" : plan === "biweekly" ? "Every 2 weeks" : "Every 4 weeks"}</b></span><small>{plan === "one-time" ? "No recurring schedule" : "Save on future cleanings"}</small></button>)}</div><div className="customer-link-field"><label>Name</label><input value={effectiveName} onChange={e => setName(e.target.value)} required /></div><div className="customer-link-field"><label>Phone</label><input value={effectivePhone} onChange={e => setPhone(e.target.value)} required /></div><div className="customer-link-field"><label>Email</label><input type="email" value={effectiveEmail} onChange={e => setEmail(e.target.value)} required /></div><div className="customer-link-field"><label>Service address</label><input value={effectiveAddress} onChange={e => setAddress(e.target.value)} required /></div><div className="customer-link-notice"><span>🔒</span><div><b>You won't be charged today.</b><small>Nothing is charged until your cleaning is complete.</small></div></div>{error && <p role="alert">{error}</p>}<button type="submit" className="customer-link-primary" disabled={submit.isPending}>Reserve my cleaning — {dollars(data.firstCleaningTotalCents)}</button><button type="button" className="customer-link-back-button" onClick={() => setStep("booking")}>← Change time</button></form>}
  </div></section></main>;
}
