import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import teamPhoto from "../assets/book-now-review/maids-in-black-team-shirt-index2.jpg";
import "./customer-booking-link-review.css";

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
const weekdayLabel = (value: string) => new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(`${value}T12:00:00`));
const timeLabel = (value: string) => value === "08:30" ? "8:30 AM" : value === "10:30" ? "10:30 AM" : value === "12:30" ? "12:30 PM" : value === "13:00" ? "1:00 PM" : value === "13:30" ? "1:30 PM" : value === "14:30" ? "2:30 PM" : value === "16:30" ? "4:30 PM" : formatTime(value);

export default function CustomerBookingLinkLive() {
  const { token = "" } = useParams<{ token: string }>();
  const quote = trpc.bookingFunnel.getCustomerLink.useQuery({ token }, { enabled: Boolean(token) });
  const submit = trpc.bookingFunnel.submitCustomerLink.useMutation();
  const data = quote.data;
  const [step, setStep] = useState<"booking" | "details" | "success">("booking");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [holdSeconds, setHoldSeconds] = useState(10 * 60);
  const [recurrence, setRecurrence] = useState<"one-time" | "weekly" | "biweekly" | "monthly">("one-time");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
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
    setRecurrence(current => current === "one-time" ? (data.recurrence as typeof current || "one-time") : current);
  }, [data]);

  useEffect(() => {
    if (step !== "details" || holdSeconds <= 0) return;
    const timer = window.setInterval(() => setHoldSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [step, holdSeconds]);

  const pricing = data?.priceSnapshot && typeof data.priceSnapshot === "object" ? (data.priceSnapshot as { input: { pricingMode: "home" | "hourly"; serviceId: "standard" | "deep" | "moveout"; bedrooms: number; bathrooms: number; homeType: "House" | "Apartment" | "Townhome" | "Condo"; condition: number; maidCount: number; hourCount: number; extras: { id: string; quantity: number }[]; recurrence: "one-time" | "weekly" | "biweekly" | "monthly" } }).input : null;
  const firstName = (name || data?.customerName || "there").split(/\s+/)[0];
  const serviceName = data?.serviceName || "Cleaning";
  const baseDate = data?.requestedLocalDate || tomorrow();
  const dateOptions = [0, 1, 2].map((offset) => addDays(baseDate, offset));
  const dateLabels = dateOptions.map((date, index) => ({ date, label: index === 0 ? "Tomorrow" : weekdayLabel(date), detail: index === 0 ? "2 teams available" : index === 1 ? "4 openings" : "3 openings" }));
  const requestedTime = data?.requestedLocalTime || "10:30";
  const timeOptions = Array.from(new Set([requestedTime, "13:00"]));
  const submitDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!data || !pricing) return;
    setError(null);
    try {
      await submit.mutateAsync({ token, idempotencyKey: crypto.randomUUID(), customerName: name, customerPhone: phone, customerEmail: email, address, requestedLocalDate: selectedDate, requestedLocalTime: selectedTime, recurrence, pricing: { ...pricing, recurrence }, additionalServices: [] });
      setStep("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not reserve this cleaning. Please try again.");
    }
  };

  if (quote.isLoading) return <main className="customer-link-page"><section className="customer-link-shell"><div className="customer-link-content"><p>Loading your personalized quote…</p></div></section></main>;
  if (quote.error || !data) return <main className="customer-link-page"><section className="customer-link-shell"><div className="customer-link-content"><h1>This link is unavailable</h1><p>{quote.error?.message ?? "Please ask your Maids in Black representative for a new link."}</p></div></section></main>;

  return <main className="customer-link-page">
    <div className="customer-link-simple-header"><a className="customer-link-simple-brand" href="https://maidsinblack.com">Maids in Black</a><div className="customer-link-simple-secure">🔒 Secure booking</div></div>
    <section className="customer-link-shell"><div className={`customer-link-content customer-link-step-${step}`}>
      {step === "success" ? <section className="customer-link-success"><div className="customer-link-success-mark">✓</div><div className="customer-link-eyebrow">You're booked</div><h1>Consider it handled.</h1><p>Your cleaning is reserved for <b>{formatDate(selectedDate)} at {formatTime(selectedTime)}</b>. A confirmation text has been sent.</p><div className="customer-link-booking-summary"><h3>Your booking</h3><div><span>Name</span><b>{name}</b></div><div><span>Address</span><b>{address}</b></div><div><span>Service</span><b>{serviceName}</b></div><div><span>Home</span><b>{data.bedrooms} bedrooms · {data.bathrooms} bathrooms</b></div><div><span>Date &amp; time</span><b>{formatDate(selectedDate)} · {formatTime(selectedTime)}</b></div><div><span>First cleaning</span><b>{dollars(data.firstCleaningTotalCents)}</b></div><div><span>Frequency</span><b>{recurrence === "one-time" ? "One time" : recurrence}</b></div></div><div className="customer-link-contact-box"><b>Need anything?</b><div>Call or text Maids in Black anytime at <a href="tel:2028885362">202-888-5362</a>.</div></div></section> : <>
        {step === "booking" && <><div className="customer-link-heading"><p className="customer-link-eyebrow">Almost there</p><h1>Hi {firstName} <span aria-hidden="true">👋</span><br />Let’s get you booked.</h1><p>We’ve already filled in the details you gave us. Just choose a time.</p></div><div className="customer-link-video-wrap"><WistiaPlayer /><p className="customer-link-video-caption">See how we work — 60 seconds</p></div><div className="customer-link-rating"><span>★★★★★</span><b>4.9 on Google</b><em>· Trusted by local homeowners</em></div><div className="customer-link-summary" aria-label="Booking summary"><span>{serviceName}</span><span>{data.bedrooms} bedrooms</span><span>{data.bathrooms} bathrooms</span><strong>{dollars(data.firstCleaningTotalCents)}</strong></div><div className="customer-link-benefits"><span>✓ Supplies included</span><span>✓ Background-checked team</span><span>✓ Insured</span><span>✓ Satisfaction guaranteed</span></div></>}
        {step === "booking" ? <><div className="customer-link-section-heading"><h2>When should we come?</h2><p>Madison found this opening for you.</p></div><div className="customer-link-options customer-link-date-options">{dateLabels.map(({ date, label, detail }) => <button key={date} type="button" className={`customer-link-option ${selectedDate === date ? "is-selected" : ""}`} onClick={() => setSelectedDate(date)}><b>{label}</b><small>{detail}</small></button>)}</div><div className="customer-link-date-picker"><label htmlFor="customer-link-custom-date">Or choose another date</label><input id="customer-link-custom-date" type="date" min={tomorrow()} value={customDate} onChange={event => { setCustomDate(event.target.value); setSelectedDate(event.target.value); }} /><small>Tap the calendar to choose another available date.</small></div><div className="customer-link-section-heading customer-link-time-heading"><h2>Choose a time</h2><p>The team arrives within the arrival window you select.</p></div><div className="customer-link-options customer-link-time-options">{timeOptions.map((time) => <button key={time} type="button" className={`customer-link-option ${selectedTime === time ? "is-selected" : ""}`} onClick={() => setSelectedTime(time)}><b>{timeLabel(time)}</b><small>{time === requestedTime ? "Reserved window" : "Arrival window"}</small><em>{time === requestedTime ? "Reserved for you" : "Available"}</em></button>)}</div><div className="customer-link-confidence"><b>Your home is in good hands.</b><span>✓ Vetted, background-checked cleaning teams<br />✓ Fully insured<br />✓ Not happy? Tell us and we'll make it right.<br />✓ Plans change? Reschedule easily.</span></div><div className="customer-link-confidence"><b>You don't need to be home.</b><span>Leave entry instructions and we'll handle the rest.</span></div><div className="customer-link-testimonial"><div className="customer-link-testimonial-avatar">AC</div><div><div className="customer-link-testimonial-stars">★★★★★</div><p>“Our home has never looked and smelled so clean.”</p><small>— Amber C. · Google review</small></div></div><img className="customer-link-team-photo" src={teamPhoto} alt="Professional Maids in Black cleaning team" /><p className="customer-link-photo-caption">Professional Maids in Black cleaning team</p><button type="button" className="customer-link-primary" onClick={() => setStep("details")}>Continue <span>→</span></button></> : <form className="customer-link-details" onSubmit={submitDetails}><div className={`customer-link-hold-banner ${holdSeconds === 0 ? "is-expired" : ""}`}><div><b>We’re holding this time for you</b><span>We’re saving your time so you can finish booking.</span></div><strong>{String(Math.floor(holdSeconds / 60)).padStart(2, "0")}:{String(holdSeconds % 60).padStart(2, "0")}</strong></div><div className="customer-link-final-heading"><p className="customer-link-eyebrow">Final step</p><h1>Reserve your cleaning.</h1></div><p className="customer-link-chosen"><b>{formatDate(selectedDate)} · {formatTime(selectedTime)}</b><br />{serviceName} · {data.bedrooms} bed · {data.bathrooms} bath</p><div className="customer-link-price">{dollars(data.firstCleaningTotalCents)}</div><div className="customer-link-label">Save on future cleanings <small>(optional)</small></div><p className="customer-link-plan-intro">Your first cleaning stays {dollars(data.firstCleaningTotalCents)}. Your discount starts with your next cleaning.</p><div className="customer-link-plans">{(["one-time", "biweekly", "monthly"] as const).map(plan => <button key={plan} type="button" className={recurrence === plan ? "is-selected" : ""} onClick={() => setRecurrence(plan)}><span><input type="radio" checked={recurrence === plan} readOnly /> <b>{plan === "one-time" ? "One time" : plan === "biweekly" ? "Every 2 weeks" : "Every 4 weeks"}</b></span><small>{plan === "one-time" ? "No recurring schedule" : "Save on future cleanings"}</small></button>)}</div><div className="customer-link-field"><label>Name</label><input value={name} onChange={event => setName(event.target.value)} required /></div><div className="customer-link-field"><label>Phone</label><input value={phone} onChange={event => setPhone(event.target.value)} required /></div><div className="customer-link-field"><label>Email</label><input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></div><div className="customer-link-field"><label>Service address</label><input value={address} onChange={event => setAddress(event.target.value)} required /></div><div className="customer-link-notice"><span>🔒</span><div><b>You won't be charged today.</b><small>Nothing is charged until your cleaning is complete.</small></div></div>{error && <p role="alert">{error}</p>}<button type="submit" className="customer-link-primary" disabled={submit.isPending}>Reserve my cleaning — {dollars(data.firstCleaningTotalCents)}</button><button type="button" className="customer-link-back-button" onClick={() => setStep("booking")}>← Change time</button></form>}
      </>}
    </div></section>
  </main>;
}
