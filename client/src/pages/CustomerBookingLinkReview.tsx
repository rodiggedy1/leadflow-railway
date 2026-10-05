import { useEffect, useRef, useState } from "react";
import "./customer-booking-link-review.css";
import teamPhoto from "../assets/book-now-review/maids-in-black-team-shirt-index2.jpg";
import testimonialPhoto from "../assets/book-now-review/SmilingHomeInteriorSelfie.png";

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

const dates = [
  { label: "Tomorrow", detail: "2 teams available" },
  { label: "Tuesday", detail: "4 openings" },
  { label: "Wednesday", detail: "3 openings" },
];
const times = [
  { label: "8:30 AM", detail: "Morning", availability: "1 team left" },
  { label: "1:00 PM", detail: "Afternoon", availability: "Available" },
];

export default function CustomerBookingLinkReview() {
  const [selectedDate, setSelectedDate] = useState("Tomorrow");
  const [selectedTime, setSelectedTime] = useState("8:30 AM");
  const [customDate, setCustomDate] = useState("2026-10-05");
  const [holdSeconds, setHoldSeconds] = useState(10 * 60);
  const [recurringPlan, setRecurringPlan] = useState("one-time");
  const [showChat, setShowChat] = useState(false);
  const [step, setStep] = useState<"booking" | "details" | "success">("booking");
  const [name, setName] = useState("Sarah");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("123 Main Street, Washington, DC");
  const [unit, setUnit] = useState("");

  useEffect(() => {
    if (step !== "details" || holdSeconds <= 0) return;
    const timer = window.setInterval(() => setHoldSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [step, holdSeconds]);

  const formatCustomDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return "Tomorrow";
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(new Date(year, month - 1, day));
  };

  const submitDetails = (event: React.FormEvent) => {
    event.preventDefault();
    setStep("success");
  };

  return (
    <main className="customer-link-page">
      <div className="customer-link-simple-header">
        <a className="customer-link-simple-brand" href="https://maidsinblack.com">Maids in Black</a>
        <div className="customer-link-simple-secure">🔒 Secure booking</div>
      </div>
      <section className="customer-link-shell">
        <div className={`customer-link-content customer-link-step-${step}`}>
          {step === "success" ? (
            <section className="customer-link-success">
              <div className="customer-link-success-mark">✓</div>
              <div className="customer-link-eyebrow">You're booked</div>
              <h1>Consider it handled.</h1>
              <p>Your cleaning is reserved for <b>{selectedDate} at {selectedTime}</b>. A confirmation text has been sent.</p>
              <div className="customer-link-booking-summary"><h3>Your booking</h3><div><span>Name</span><b>{name || "Sarah"}</b></div><div><span>Address</span><b>{address || "Address provided at booking"}</b></div><div><span>Service</span><b>Deep Cleaning</b></div><div><span>Home</span><b>3 bedrooms · 2 bathrooms</b></div><div><span>Date &amp; time</span><b>{selectedDate} · {selectedTime}</b></div><div><span>First cleaning</span><b>$369</b></div><div><span>Frequency</span><b>{recurringPlan === "one-time" ? "One time" : recurringPlan === "two-weeks" ? "Every 2 weeks" : "Every 4 weeks"}</b></div></div>
              <div className="customer-link-contact-box"><b>Need anything?</b><div>Call or text Maids in Black anytime at <a href="tel:2028885362">202-888-5362</a>.</div></div>
            </section>
          ) : (
            <>
              {step === "booking" && <>
                <div className="customer-link-heading"><p className="customer-link-eyebrow">Almost there</p><h1>Hi Sarah <span aria-hidden="true">👋</span><br />Let’s get you booked.</h1><p>We’ve already filled in the details you gave us. Just choose a time.</p></div>
                <div className="customer-link-video-wrap"><WistiaPlayer /><p className="customer-link-video-caption">See how we work — 60 seconds</p></div>
                <div className="customer-link-rating"><span>★★★★★</span><b>4.9 on Google</b><em>· Trusted by local homeowners</em></div>
                <div className="customer-link-summary" aria-label="Booking summary"><span>Deep Cleaning</span><span>3 bedrooms</span><span>2 bathrooms</span><strong>$369</strong></div>
                <div className="customer-link-benefits"><span>✓ Supplies included</span><span>✓ Background-checked team</span><span>✓ Insured</span><span>✓ Satisfaction guaranteed</span></div>
              </>}
              {step === "booking" ? (
                <>
                  <div className="customer-link-section-heading"><h2>When should we come?</h2><p>Madison found these openings for you.</p></div>
                  <div className="customer-link-options customer-link-date-options">{dates.map((date) => <button key={date.label} type="button" className={`customer-link-option ${selectedDate === date.label ? "is-selected" : ""}`} onClick={() => setSelectedDate(date.label)}><b>{date.label}</b><small>{date.detail}</small></button>)}</div>
                  <div className="customer-link-date-picker"><label htmlFor="customer-link-custom-date">Or choose another date</label><input id="customer-link-custom-date" type="date" min="2026-10-05" value={customDate} onChange={(event) => { setCustomDate(event.target.value); setSelectedDate(formatCustomDate(event.target.value)); }} /><small>Tap the calendar to choose another available date.</small></div>
                  <div className="customer-link-section-heading customer-link-time-heading"><h2>Choose a time</h2><p>The team arrives within the arrival window you select.</p></div>
                  <div className="customer-link-options customer-link-time-options">{times.map((time) => <button key={time.label} type="button" className={`customer-link-option ${selectedTime === time.label ? "is-selected" : ""}`} onClick={() => setSelectedTime(time.label)}><b>{time.label}</b><small>{time.detail}</small><em>{time.availability}</em></button>)}</div>
                  <div className="customer-link-confidence"><b>Your home is in good hands.</b><span>✓ Vetted, background-checked cleaning teams<br />✓ Fully insured<br />✓ Not happy? Tell us and we'll make it right.<br />✓ Plans change? Reschedule easily.</span></div>
                                    <div className="customer-link-testimonial">
                    <img className="customer-link-testimonial-avatar" src={testimonialPhoto} alt="Amber C." />
                    <div><div className="customer-link-testimonial-stars">★★★★★</div><p>“Our 3 bedroom, 3 bathroom house has never looked and smelled so clean.”</p><small>— Amber C. · Google review</small></div>
                  </div>
                  <img className="customer-link-team-photo" src={teamPhoto} alt="Professional Maids in Black cleaning team" />
                  <p className="customer-link-photo-caption">Professional Maids in Black cleaning team</p>
                  <button type="button" className="customer-link-primary" onClick={() => setStep("details")}>Continue <span>→</span></button>
                </>
              ) : (
                <form className="customer-link-details" onSubmit={submitDetails}>
                  <div className={`customer-link-hold-banner ${holdSeconds === 0 ? "is-expired" : ""}`}><div><b>We’re holding this time for you</b><span>We’re saving your time so you can finish booking.</span></div><strong>{String(Math.floor(holdSeconds / 60)).padStart(2, "0")}:{String(holdSeconds % 60).padStart(2, "0")}</strong></div>
                  <div className="customer-link-final-heading"><p className="customer-link-eyebrow">Final step</p><h1>Reserve your cleaning.</h1></div>
                  <p className="customer-link-chosen"><b>{selectedDate} · {selectedTime}</b><br />Deep Cleaning · 3 bed · 2 bath</p>
                  <div className="customer-link-price">$369</div>
                  <div className="customer-link-label">Save on future cleanings <small>(optional)</small></div>
                  <p className="customer-link-plan-intro">Your first cleaning stays $369. Your discount starts with your next cleaning.</p>
                  <div className="customer-link-plans">
                    <button type="button" className={recurringPlan === "one-time" ? "is-selected" : ""} onClick={() => setRecurringPlan("one-time")}><span><input type="radio" checked={recurringPlan === "one-time"} readOnly /> <b>One time</b></span><b>$369</b><small>No recurring schedule</small></button>
                    <button type="button" className={recurringPlan === "two-weeks" ? "is-selected" : ""} onClick={() => setRecurringPlan("two-weeks")}><span><input type="radio" checked={recurringPlan === "two-weeks"} readOnly /> <b>Every 2 weeks</b> <em>BEST VALUE</em></span><b>$325/clean</b><strong>Save $44 each cleaning · $1,144/year</strong><small>✓ Your preferred schedule stays reserved<br />✓ No need to rebook every time</small></button>
                    <button type="button" className={recurringPlan === "four-weeks" ? "is-selected" : ""} onClick={() => setRecurringPlan("four-weeks")}><span><input type="radio" checked={recurringPlan === "four-weeks"} readOnly /> <b>Every 4 weeks</b></span><b>$345/clean</b><strong>Save $24 each cleaning</strong></button>
                  </div>
                  <div className="customer-link-quote customer-link-recurring-quote"><div className="customer-link-testimonial-stars">★★★★★</div><p>“We started with one cleaning and now use them every two weeks. It's one less thing to think about.”</p><small>— Recent recurring customer · Google review</small></div>
                  <div className="customer-link-field"><label>Name</label><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required /></div>
                  <div className="customer-link-field"><label>Service address</label><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street address" required /></div>
                  <div className="customer-link-field"><label>Apartment / unit (optional)</label><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Apt, suite, unit" /></div>
                  <div className="customer-link-notice"><span>🔒</span><div><b>You won't be charged today.</b><small>Your card securely reserves your appointment. Payment is processed after your cleaning is completed.</small></div></div>
                  <div className="customer-link-field"><label>Card information</label><input placeholder="1234 1234 1234 1234" /></div>
                  <div className="customer-link-card-row"><div className="customer-link-field"><label>Expiration</label><input placeholder="MM / YY" /></div><div className="customer-link-field"><label>CVC</label><input placeholder="CVC" /></div></div>
                  <div className="customer-link-next"><b>What happens next?</b><div>✓ You'll get an immediate confirmation text<br />✓ We'll send reminders before your cleaning<br />✓ Your team arrives for your scheduled appointment</div></div>
                  <div className="customer-link-trust"><b><span>★★★★★</span> 4.9 on Google</b><br />Background-checked teams · Insured · Satisfaction guaranteed<br />Securely processed by Stripe · We don't store your card details</div>
                  <button type="submit" className="customer-link-primary">Reserve my cleaning — $369</button>
                  <div className="customer-link-plan-note">{recurringPlan === "two-weeks" ? "Every 2 weeks selected" : recurringPlan === "four-weeks" ? "Every 4 weeks selected" : ""}</div>
                  <button type="button" className="customer-link-back-button" onClick={() => setStep("booking")}>← Change time</button>
                  <div className="customer-link-help">Have a question before booking? <button type="button" onClick={() => setShowChat((value) => !value)}>Text Madison</button>{showChat && <div className="customer-link-chat">Hi Sarah! I'm Madison 👋 Your $369 deep cleaning and selected time are ready to reserve. What can I help with before you book?</div>}</div>
                </form>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
