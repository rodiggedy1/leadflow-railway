import { useEffect, useRef, useState } from "react";
import { BedDouble, House, ShowerHead } from "lucide-react";
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
const timeOfDayLabel = (value: string) => {
  const normalized = value.trim().toUpperCase();
  const match = normalized.match(/^(\d{1,2})(?::\d{2})?\s*(AM|PM)?$/);
  if (!match) return "Morning";
  const hour = Number(match[1]);
  const hour24 = match[2] === "PM" ? (hour === 12 ? 12 : hour + 12) : match[2] === "AM" ? (hour === 12 ? 0 : hour) : hour;
  return hour24 >= 12 ? "Afternoon" : "Morning";
};

type Recurrence = "one-time" | "biweekly" | "monthly";

export default function CustomerBookingLinkLive() {
  const { token = "" } = useParams<{ token: string }>();
  const quote = trpc.bookingFunnel.getCustomerLink.useQuery({ token }, { enabled: Boolean(token) });
  const submit = trpc.bookingFunnel.submitCustomerLink.useMutation();
  const updateQuote = trpc.bookingFunnel.updateCustomerLink.useMutation();
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
  const [detailsReady, setDetailsReady] = useState(false);
  const bookingAttemptIdRef = useRef(crypto.randomUUID());
  const pricing = data?.priceSnapshot && typeof data.priceSnapshot === "object" ? (data.priceSnapshot as { input: { pricingMode: "home" | "hourly"; serviceId: "standard" | "deep" | "moveout"; bedrooms: number; bathrooms: number; homeType: "House" | "Apartment" | "Townhome" | "Condo"; condition: number; maidCount: number; hourCount: number; extras: { id: string; quantity: number }[]; recurrence: "one-time" | "weekly" | "biweekly" | "monthly"; customPriceCents?: number } }).input : null;
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
    setBookingId(current => current ?? data.bookingId ?? null);
  }, [data]);

  useEffect(() => {
    if (step === "details") window.scrollTo(0, 0);
  }, [step]);

  useEffect(() => {
    if (step !== "details" || holdSeconds <= 0) return;
    const timer = window.setInterval(() => setHoldSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [step, holdSeconds]);

  const firstName = (name || data?.customerName || "there").split(/\s+/)[0];
  const serviceName = data?.serviceName || "Cleaning";
  const displayServiceName = serviceName.replace(/\s+Cleaning$/i, "");
  const finalQuotePriceCents = data?.firstCleaningTotalCents ?? 0;
  const crossedOutQuotePriceCents = Math.round(finalQuotePriceCents / 0.81);
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
  const changeRecurrence = async (next: Recurrence) => {
    const previous = recurrence;
    setRecurrence(next);
    if (!bookingId || !data?.mutationToken || previous === next) return;
    try {
      await updateQuote.mutateAsync({ token, mutationToken: data.mutationToken, recurrence: next });
    } catch (cause) {
      setRecurrence(previous);
      setError(cause instanceof Error ? cause.message : "We could not update your recurring preference. Please try again.");
    }
  };
  const submitDetails = async () => {
    if (!data || !pricing) return;
    const nameValue = document.querySelector<HTMLInputElement>('input[autocomplete="name"]')?.value ?? name;
    const phoneValue = document.querySelector<HTMLInputElement>('input[autocomplete="tel"]')?.value ?? phone;
    const emailValue = document.querySelector<HTMLInputElement>('input[autocomplete="email"]')?.value ?? email;
    const addressValue = document.querySelector<HTMLInputElement>('input[autocomplete="street-address"]')?.value ?? address;
    setName(nameValue);
    setPhone(phoneValue);
    setEmail(emailValue);
    setAddress(addressValue);
    if (!nameValue.trim() || !phoneValue.trim() || !emailValue.trim() || !addressValue.trim()) {
      setError("Please complete your name, phone, email, and service address.");
      return;
    }
    setError(null);
    try {
      const result = await submit.mutateAsync({ token, idempotencyKey: bookingAttemptIdRef.current, customerName: nameValue, customerPhone: phoneValue, customerEmail: emailValue, address: addressValue, requestedLocalDate: selectedDate, requestedLocalTime: selectedTime, recurrence, pricing: { ...pricing, recurrence }, additionalServices: [] });
      if (!result.bookingId || !data.mutationToken) throw new Error("We could not prepare secure card entry. Please try again.");
      setBookingId(result.bookingId);
      setDetailsReady(true);
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
        {step === "booking" && <><div className="customer-link-heading"><p className="customer-link-eyebrow">Almost there</p><h1>Hi {firstName} <span aria-hidden="true">👋</span><br />Let’s get you booked.</h1><p>We’ve already filled in the details you gave us. Just choose a time.</p></div><div className="customer-link-video-wrap"><WistiaPlayer /><p className="customer-link-video-caption">See how we work — 60 seconds</p></div><div className="customer-link-rating"><span>★★★★★</span><b>4.9 on Google</b><em>· Trusted by local homeowners</em></div><section className="customer-link-generated-offer" aria-label="Generated quote summary"><div className="customer-link-generated-details"><span className="customer-link-generated-badge">Most Popular</span><h2>{displayServiceName}</h2><p>{data.bedrooms} bedrooms <b aria-hidden="true">•</b> {data.bathrooms} bathrooms</p><div className="customer-link-generated-features"><span><BedDouble aria-hidden="true" size={28} strokeWidth={1.7} /> {data.bedrooms} beds</span><span><ShowerHead aria-hidden="true" size={28} strokeWidth={1.7} /> {data.bathrooms} baths</span><span><House aria-hidden="true" size={28} strokeWidth={1.7} /> {displayServiceName} clean</span></div></div><div className="customer-link-generated-price"><div><s>{dollars(crossedOutQuotePriceCents)}</s><b>Save 19%</b></div><strong>{dollars(finalQuotePriceCents)}</strong><span>Limited time price</span></div></section><div className="customer-link-benefits"><span>✓ Supplies included</span><span>✓ Background-checked team</span><span>✓ Insured</span><span>✓ Satisfaction guaranteed</span></div></>}
        {step === "booking" ? <><div className="customer-link-section-heading"><h2>When should we come?</h2><p>Madison found these openings for you.</p></div><div className="customer-link-options customer-link-date-options">{dateLabels.map(({ date, label, detail }, index) => <button key={date} type="button" className={`customer-link-option ${selectedDate === date ? "is-selected" : ""}`} onClick={() => setSelectedDate(date)}>{index === 0 && <span className="customer-link-option-badge">★ Best option</span>}<b>{label}</b><small>{detail}</small></button>)}</div><div className="customer-link-date-picker"><label htmlFor="customer-link-custom-date">Or choose another date</label><input id="customer-link-custom-date" type="date" min={tomorrow()} value={customDate} onClick={event => event.currentTarget.showPicker?.()} onChange={event => { setCustomDate(event.target.value); setSelectedDate(event.target.value); }} /><small>Tap the calendar to pick any available date.</small></div><div className="customer-link-section-heading customer-link-time-heading"><h2>Choose a time</h2></div><div className="customer-link-options customer-link-time-options">{timeOptions.map(time => <button key={time} type="button" className={`customer-link-option ${selectedTime === time ? "is-selected" : ""}`} onClick={() => setSelectedTime(time)}><b>{timeLabel(time)}</b><small>{timeOfDayLabel(time)}</small><em>{time === requestedTime ? "1 team left" : "Available"}</em></button>)}</div><div className="customer-link-confidence"><b>Your home is in good hands.</b><span>✓ Vetted, background-checked cleaning teams<br />✓ Fully insured<br />✓ Not happy? Tell us and we'll make it right.<br />✓ Plans change? Reschedule easily.</span></div><div className="customer-link-testimonial"><img className="customer-link-testimonial-avatar" src={testimonialPhoto} alt="Amber C." /><div><div className="customer-link-testimonial-stars">★★★★★</div><p>“Our home has never looked and smelled so clean.”</p><small>— Amber C. · Google review</small></div></div><img className="customer-link-team-photo" src={teamPhoto} alt="Professional Maids in Black cleaning team" /><p className="customer-link-photo-caption">Professional Maids in Black cleaning team</p><button type="button" className="customer-link-primary" onPointerDown={event => { event.preventDefault(); setStep("details"); }} onClick={event => { event.preventDefault(); setStep("details"); }}>Continue <span>→</span></button></> : <div className="customer-link-details"><div className={`customer-link-hold-banner ${holdSeconds === 0 ? "is-expired" : ""}`}><div><b>We’re holding this time for you</b><span>We’re saving your time so you can finish booking.</span></div><strong>{String(Math.floor(holdSeconds / 60)).padStart(2, "0")}:{String(holdSeconds % 60).padStart(2, "0")}</strong></div><div className="customer-link-final-heading"><p className="customer-link-eyebrow">Final step</p><h1>Reserve your cleaning.</h1></div><p className="customer-link-chosen"><b>{formatDate(selectedDate)} · {formatTime(selectedTime)}</b><br />{serviceName} · {data.bedrooms} bed · {data.bathrooms} bath</p><div className="customer-link-price">{dollars(data.firstCleaningTotalCents)}</div><div className="customer-link-label">Save on future cleanings <small>(optional)</small></div><p className="customer-link-plan-intro">Your first cleaning stays {dollars(data.firstCleaningTotalCents)}. Your discount starts with your next cleaning.</p><div className="customer-link-plans"><button type="button" className={recurrence === "one-time" ? "is-selected" : ""} onClick={() => void changeRecurrence("one-time")}><span><input type="radio" checked={recurrence === "one-time"} readOnly /> <b>One time</b></span><b>{dollars(data.firstCleaningTotalCents)}</b><small>No recurring schedule</small></button><button type="button" className={recurrence === "biweekly" ? "is-selected" : ""} onClick={() => void changeRecurrence("biweekly")}><span><input type="radio" checked={recurrence === "biweekly"} readOnly /> <b>Every 2 weeks</b> <em>BEST VALUE</em></span><b>{dollars(biweeklyPrice)}/clean</b><strong>Save {dollars(biweeklySavings)} each cleaning · {dollars(biweeklySavings * 26)}/year</strong><small>✓ Your preferred schedule stays reserved<br />✓ No need to rebook every time</small></button><button type="button" className={recurrence === "monthly" ? "is-selected" : ""} onClick={() => void changeRecurrence("monthly")}><span><input type="radio" checked={recurrence === "monthly"} readOnly /> <b>Every 4 weeks</b></span><b>{dollars(monthlyPrice)}/clean</b><strong>Save {dollars(monthlySavings)} each cleaning</strong></button></div><div className="customer-link-quote customer-link-recurring-quote"><div className="customer-link-testimonial-stars">★★★★★</div><p>“We started with one cleaning and now use them every two weeks. It's one less thing to think about.”</p><small>— Recent recurring customer · Google review</small></div><div className="customer-link-field"><label>Name</label><input value={name} onChange={event => setName(event.target.value)} onInput={event => setName(event.currentTarget.value)} placeholder="Your name" autoComplete="name" required /></div><div className="customer-link-field"><label>Phone</label><input value={phone} onChange={event => setPhone(event.target.value)} onInput={event => setPhone(event.currentTarget.value)} placeholder="302-981-6191" autoComplete="tel" inputMode="tel" required /></div><div className="customer-link-field"><label>Email</label><input value={email} onChange={event => setEmail(event.target.value)} onInput={event => setEmail(event.currentTarget.value)} placeholder="you@example.com" autoComplete="email" type="email" required /></div><div className="customer-link-field"><label>Address</label><input value={address} onChange={event => setAddress(event.target.value)} onInput={event => setAddress(event.currentTarget.value)} placeholder="Street address" autoComplete="street-address" required /></div>{data.mutationToken && <><div className="customer-link-notice"><span>🔒</span><div><b>You won't be charged today.</b><small>Your card securely reserves your appointment. Payment is processed after your cleaning is completed.</small></div></div><div className="customer-link-inline-payment"><BookingPaymentCheckout publicFunnelNumber={data.token} mutationToken={data.mutationToken} customerName={name} amountCents={data.firstCleaningTotalCents ?? 0} directCardEntry deferConfirmation setupReady={detailsReady} onCreateBooking={submitDetails} creatingBooking={submit.isPending} onComplete={async () => { await finalize.mutateAsync({ publicFunnelNumber: data.token, mutationToken: data.mutationToken }); setStep("success"); }} /></div></>}<div className="customer-link-next"><b>What happens next?</b><div>✓ You'll get an immediate confirmation text<br />✓ We'll send reminders before your cleaning<br />✓ Your team arrives for your scheduled appointment</div></div><div className="customer-link-trust"><b><span>★★★★★</span> 4.9 on Google</b><br />Background-checked teams · Insured · Satisfaction guaranteed<br />Securely processed by Stripe · We don't store your card details</div>{error && <p role="alert">{error}</p>}<div className="customer-link-plan-note">{recurrence === "biweekly" ? "Every 2 weeks selected" : recurrence === "monthly" ? "Every 4 weeks selected" : ""}</div><button type="button" className="customer-link-back-button" onClick={() => setStep("booking")}>← Change time</button><div className="customer-link-help">Have a question before booking? <button type="button" className="customer-link-help" onClick={() => setShowChat(value => !value)}>Text Madison</button>{showChat && <div className="customer-link-chat">Hi {firstName} I'm Madison 👋 Your {dollars(data.firstCleaningTotalCents)} {serviceName.toLowerCase()} and selected time are ready to reserve. What can I help with before you book?</div>}</div></div>}
      </>}
    </div></section>
  </main>;
}
