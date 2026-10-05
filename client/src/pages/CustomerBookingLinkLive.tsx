import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { BookingPaymentCheckout } from "@/components/BookingPaymentCheckout";
import { calculatePublicBookingPrice } from "@shared/publicBookingPricing";
import teamPhoto from "../assets/book-now-review/maids-in-black-team-shirt-index2.jpg";
import testimonialPhoto from "../assets/book-now-review/SmilingHomeInteriorSelfie.png";
import "./customer-booking-link-review.css";
import "./booking-flow-review.css";

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

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(`${value}T12:00:00`)) : "your selected date";
const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(`2026-01-01T${value}:00`)) : "your selected time";
const dollars = (cents: number | null) => `$${Math.round((cents ?? 0) / 100).toLocaleString()}`;
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
const addDays = (value: string, amount: number) => { const d = new Date(`${value}T12:00:00`); d.setDate(d.getDate() + amount); return d.toISOString().slice(0, 10); };
const timeLabel = (value: string) => value === "08:30" ? "8:30 AM" : value === "13:00" ? "1:00 PM" : formatTime(value);

type Recurrence = "one-time" | "biweekly" | "monthly";

export default function CustomerBookingLinkLive() {
  const { token = "" } = useParams<{ token: string }>();
  const quote = trpc.bookingFunnel.getCustomerLink.useQuery({ token }, { enabled: Boolean(token) });
  const submit = trpc.bookingFunnel.submitCustomerLink.useMutation();
  const finalize = trpc.bookingPayments.finalize.useMutation();
  const data = quote.data;
  const [step, setStep] = useState<"booking" | "details" | "payment" | "success">("booking");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [holdSeconds, setHoldSeconds] = useState(10 * 60);
  const [recurrence, setRecurrence] = useState<Recurrence>("one-time");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [bookingId, setBookingId] = useState<number | null>(null);
  const bookingAttemptIdRef = useRef(crypto.randomUUID());
  const autoPrepareStartedRef = useRef(false);
  const pricing = data?.priceSnapshot && typeof data.priceSnapshot === "object" ? (data.priceSnapshot as { input: { pricingMode: "home" | "hourly"; serviceId: "standard" | "deep" | "moveout"; bedrooms: number; bathrooms: number; homeType: "House" | "Apartment" | "Townhome" | "Condo"; condition: number; maidCount: number; hourCount: number; extras: { id: string; quantity: number }[]; recurrence: "one-time" | "weekly" | "biweekly" | "monthly" } }).input : null;
  const [showChat, setShowChat] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setSelectedDate(current => current || data.requestedLocalDate || tomorrow());
    setSelectedTime(current => current || data.requestedLocalTime || "10:30");
    setCustomDate(current => current || data.requestedLocalDate || tomorrow());
    setName(current => current || data.customerName || "");
    setPhone(current => current || data.customerPhone || "");
    setEmail(current => current || data.customerEmail || "");
    setAddress(current => current || data.address || "");
  }, [data]);

  useEffect(() => {
    if (step === "details") window.scrollTo(0, 0);
  }, [step]);

  useEffect(() => {
    if (step !== "details" || holdSeconds <= 0) return;
    const timer = window.setInterval(() => setHoldSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [step, holdSeconds]);

  useEffect(() => {
    if (step !== "details" || !data || !pricing || bookingId || autoPrepareStartedRef.current) return;
    if (!name.trim() || !phone.trim() || !email.trim() || !address.trim() || !selectedDate || !selectedTime) return;
    autoPrepareStartedRef.current = true;
    setError(null);
    void submit.mutateAsync({ token, idempotencyKey: bookingAttemptIdRef.current, customerName: name, customerPhone: phone, customerEmail: email, address, requestedLocalDate: selectedDate, requestedLocalTime: selectedTime, recurrence, pricing: { ...pricing, recurrence }, additionalServices: [] }).then(result => {
      if (!result.bookingId || !data.mutationToken) throw new Error("We could not prepare secure card entry. Please try again.");
      setBookingId(result.bookingId);
    }).catch(cause => {
      autoPrepareStartedRef.current = false;
      setError(cause instanceof Error ? cause.message : "We could not prepare secure card entry. Please try again.");
    });
  }, [step, data, pricing, bookingId, name, phone, email, address, selectedDate, selectedTime, recurrence, token, submit]);

  const firstName = (name || data?.customerName || "there").split(/\s+/)[0];
  const serviceName = data?.serviceName || "Cleaning";
  const baseDate = data?.requestedLocalDate || tomorrow();
  const dateOptions = [0, 1, 2].map(offset => addDays(baseDate, offset));
  const dateLabels = dateOptions.map(date => ({ date, label: formatDate(date), detail: date === baseDate ? "Reserved for you" : date === dateOptions[1] ? "2 teams available" : "1 opening" }));
  const requestedTime = data?.requestedLocalTime || "10:30";
  const timeOptions = Array.from(new Set([requestedTime, "13:00"]));
  const recurringPrices = pricing ? {
    biweekly: calculatePublicBookingPrice({ ...pricing, recurrence: "biweekly" }),
    monthly: calculatePublicBookingPrice({ ...pricing, recurrence: "monthly" }),
  } : null;
  const biweeklyPrice = recurringPrices?.biweekly.futureVisitTotalCents ?? data?.firstCleaningTotalCents ?? 0;
  const monthlyPrice = recurringPrices?.monthly.futureVisitTotalCents ?? data?.firstCleaningTotalCents ?? 0;
  const biweeklySavings = Math.max(0, (data?.firstCleaningTotalCents ?? 0) - biweeklyPrice);
  const monthlySavings = Math.max(0, (data?.firstCleaningTotalCents ?? 0) - monthlyPrice);
  const submitDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!data || !pricing) return;
    setError(null);
    try {
      const result = await submit.mutateAsync({ token, idempotencyKey: crypto.randomUUID(), customerName: name, customerPhone: phone, customerEmail: email, address, requestedLocalDate: selectedDate, requestedLocalTime: selectedTime, recurrence, pricing: { ...pricing, recurrence }, additionalServices: [] });
      if (!result.bookingId || !data.mutationToken) throw new Error("We could not prepare secure card entry. Please try again.");
      setBookingId(result.bookingId);
      setStep("details");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not reserve this cleaning. Please try again.");
    }
  };

  if (quote.isLoading) return <main className="customer-link-page"><section className="customer-link-shell"><div className="customer-link-content"><p>Loading your personalized quote…</p></div></section></main>;
  if (quote.error || !data) return <main className="customer-link-page"><section className="customer-link-shell"><div className="customer-link-content"><h1>This link is unavailable</h1><p>{quote.error?.message ?? "Please ask your Maids in Black representative for a new link."}</p></div></section></main>;

  return <main className="customer-link-page">
    <div className="customer-link-simple-header"><a className="customer-link-simple-brand" href="https://maidsinblack.com">Maids in Black</a><div className="customer-link-simple-secure">🔒 Secure booking</div></div>
    <section className="customer-link-shell"><div className={`customer-link-content customer-link-step-${step}`}>
      {step === "success" ? <section className="customer-link-success"><div className="customer-link-success-mark">✓</div><div className="customer-link-eyebrow">You're booked</div><h1>Consider it handled.</h1><p>Your cleaning is reserved for <b>{formatDate(selectedDate)} at {formatTime(selectedTime)}</b>. A confirmation text has been sent.</p><div className="customer-link-booking-summary"><h3>Your booking</h3><div><span>Name</span><b>{name}</b></div><div><span>Address</span><b>{address}</b></div><div><span>Service</span><b>{serviceName}</b></div><div><span>Home</span><b>{data.bedrooms} bedrooms · {data.bathrooms} bathrooms</b></div><div><span>Date &amp; time</span><b>{formatDate(selectedDate)} · {formatTime(selectedTime)}</b></div><div><span>First cleaning</span><b>{dollars(data.firstCleaningTotalCents)}</b></div><div><span>Frequency</span><b>{recurrence === "one-time" ? "One time" : recurrence === "biweekly" ? "Every 2 weeks" : "Every 4 weeks"}</b></div></div><div className="customer-link-contact-box"><b>Need anything?</b><div>Call or text Maids in Black anytime at <a href="tel:2028885362">202-888-5362</a>.</div></div></section> : <>
        {step === "booking" && <><div className="customer-link-heading"><p className="customer-link-eyebrow">Almost there</p><h1>Hi {firstName} <span aria-hidden="true">👋</span><br />Let’s get you booked.</h1><p>We’ve already filled in the details you gave us. Just choose a time.</p></div><div className="customer-link-video-wrap"><WistiaPlayer /><p className="customer-link-video-caption">See how we work — 60 seconds</p></div><div className="customer-link-rating"><span>★★★★★</span><b>4.9 on Google</b><em>· Trusted by local homeowners</em></div><div className="customer-link-summary" aria-label="Booking summary"><span>{serviceName}</span><span>{data.bedrooms} bedrooms</span><span>{data.bathrooms} bathrooms</span><strong>{dollars(data.firstCleaningTotalCents)}</strong></div><div className="customer-link-benefits"><span>✓ Supplies included</span><span>✓ Background-checked team</span><span>✓ Insured</span><span>✓ Satisfaction guaranteed</span></div></>}
        {step === "booking" ? <><div className="customer-link-section-heading"><h2>When should we come?</h2><p>Madison found these openings for you.</p></div><div className="customer-link-options customer-link-date-options">{dateLabels.map(({ date, label, detail }) => <button key={date} type="button" className={`customer-link-option ${selectedDate === date ? "is-selected" : ""}`} onClick={() => setSelectedDate(date)}><b>{label}</b><small>{detail}</small></button>)}</div><div className="customer-link-date-picker"><label htmlFor="customer-link-custom-date">Or choose another date</label><input id="customer-link-custom-date" type="date" min={tomorrow()} value={customDate} onChange={event => { setCustomDate(event.target.value); setSelectedDate(event.target.value); }} /><small>Tap the calendar to pick any available date.</small></div><div className="customer-link-section-heading customer-link-time-heading"><h2>Choose a time</h2><p>The team arrives within the arrival window you select.</p></div><div className="customer-link-options customer-link-time-options">{timeOptions.map(time => <button key={time} type="button" className={`customer-link-option ${selectedTime === time ? "is-selected" : ""}`} onClick={() => setSelectedTime(time)}><b>{timeLabel(time)}</b><small>{time === requestedTime ? "Morning" : "Afternoon"}</small><em>{time === requestedTime ? "1 team left" : "Available"}</em></button>)}</div><div className="customer-link-confidence"><b>Your home is in good hands.</b><span>✓ Vetted, background-checked cleaning teams<br />✓ Fully insured<br />✓ Not happy? Tell us and we'll make it right.<br />✓ Plans change? Reschedule easily.</span></div><div className="customer-link-testimonial"><img className="customer-link-testimonial-avatar" src={testimonialPhoto} alt="Amber C." /><div><div className="customer-link-testimonial-stars">★★★★★</div><p>“Our home has never looked and smelled so clean.”</p><small>— Amber C. · Google review</small></div></div><img className="customer-link-team-photo" src={teamPhoto} alt="Professional Maids in Black cleaning team" /><p className="customer-link-photo-caption">Professional Maids in Black cleaning team</p><button type="button" className="customer-link-primary" onClick={() => setStep("details")}>Continue <span>→</span></button></> : <form className="customer-link-details" onSubmit={submitDetails}><div className={`customer-link-hold-banner ${holdSeconds === 0 ? "is-expired" : ""}`}><div><b>We’re holding this time for you</b><span>We’re saving your time so you can finish booking.</span></div><strong>{String(Math.floor(holdSeconds / 60)).padStart(2, "0")}:{String(holdSeconds % 60).padStart(2, "0")}</strong></div><div className="customer-link-final-heading"><p className="customer-link-eyebrow">Final step</p><h1>Reserve your cleaning.</h1></div><p className="customer-link-chosen"><b>{formatDate(selectedDate)} · {formatTime(selectedTime)}</b><br />{serviceName} · {data.bedrooms} bed · {data.bathrooms} bath</p><div className="customer-link-price">{dollars(data.firstCleaningTotalCents)}</div><div className="customer-link-label">Save on future cleanings <small>(optional)</small></div><p className="customer-link-plan-intro">Your first cleaning stays {dollars(data.firstCleaningTotalCents)}. Your discount starts with your next cleaning.</p><div className="customer-link-plans"><button type="button" className={recurrence === "one-time" ? "is-selected" : ""} onClick={() => setRecurrence("one-time")}><span><input type="radio" checked={recurrence === "one-time"} readOnly /> <b>One time</b></span><b>{dollars(data.firstCleaningTotalCents)}</b><small>No recurring schedule</small></button><button type="button" className={recurrence === "biweekly" ? "is-selected" : ""} onClick={() => setRecurrence("biweekly")}><span><input type="radio" checked={recurrence === "biweekly"} readOnly /> <b>Every 2 weeks</b> <em>BEST VALUE</em></span><b>{dollars(biweeklyPrice)}/clean</b><strong>Save {dollars(biweeklySavings)} each cleaning · {dollars(biweeklySavings * 26)}/year</strong><small>✓ Your preferred schedule stays reserved<br />✓ No need to rebook every time</small></button><button type="button" className={recurrence === "monthly" ? "is-selected" : ""} onClick={() => setRecurrence("monthly")}><span><input type="radio" checked={recurrence === "monthly"} readOnly /> <b>Every 4 weeks</b></span><b>{dollars(monthlyPrice)}/clean</b><strong>Save {dollars(monthlySavings)} each cleaning</strong></button></div><div className="customer-link-quote customer-link-recurring-quote"><div className="customer-link-testimonial-stars">★★★★★</div><p>“We started with one cleaning and now use them every two weeks. It's one less thing to think about.”</p><small>— Recent recurring customer · Google review</small></div><div className="customer-link-field"><label>Name</label><input value={name} onChange={event => setName(event.target.value)} placeholder="Your name" autoComplete="name" required /></div><div className="customer-link-field"><label>Phone</label><input value={phone} onChange={event => setPhone(event.target.value)} placeholder="302-981-6191" autoComplete="tel" inputMode="tel" required /></div><div className="customer-link-field"><label>Email</label><input value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" type="email" required /></div><div className="customer-link-field"><label>Address</label><input value={address} onChange={event => setAddress(event.target.value)} placeholder="Street address" autoComplete="street-address" required /></div>{bookingId && data.mutationToken && <div className="customer-link-inline-payment"><BookingPaymentCheckout publicFunnelNumber={data.token} mutationToken={data.mutationToken} customerName={name} amountCents={data.firstCleaningTotalCents ?? 0} directCardEntry deferConfirmation onComplete={async () => { await finalize.mutateAsync({ publicFunnelNumber: data.token, mutationToken: data.mutationToken }); setStep("success"); }} /></div>}<div className="customer-link-next"><b>What happens next?</b><div>✓ You'll get an immediate confirmation text<br />✓ We'll send reminders before your cleaning<br />✓ Your team arrives for your scheduled appointment</div></div><div className="customer-link-trust"><b><span>★★★★★</span> 4.9 on Google</b><br />Background-checked teams · Insured · Satisfaction guaranteed<br />Securely processed by Stripe · We don't store your card details</div>{error && <p role="alert">{error}</p>}{!bookingId && <button type="submit" className="customer-link-primary" disabled={submit.isPending}>Continue to secure card —</button>}<div className="customer-link-plan-note">{recurrence === "biweekly" ? "Every 2 weeks selected" : recurrence === "monthly" ? "Every 4 weeks selected" : ""}</div><button type="button" className="customer-link-back-button" onClick={() => setStep("booking")}>← Change time</button><div className="customer-link-help">Have a question before booking? <button type="button" onClick={() => setShowChat(value => !value)}>Text Madison</button>{showChat && <div className="customer-link-chat">Hi {firstName}! I'm Madison 👋 Your {dollars(data.firstCleaningTotalCents)} {serviceName.toLowerCase()} and selected time are ready to reserve. What can I help with before you book?</div>}</div></form>}
      </>}
    </div></section>
  </main>;
}
