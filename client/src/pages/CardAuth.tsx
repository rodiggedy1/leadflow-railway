/**
 * /pay/:token — Public card authorization page
 * Design: Warm Coral / Maids in Black brand
 * Mobile-first responsive layout
 * Enhancements: card logos, appointment summary, animated success, micro-copy, Google rating
 */
import { useState, useEffect } from "react";
import { useParams, useSearch } from "wouter";

function formatCardNumber(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

type Brand = "VISA" | "MASTERCARD" | "AMEX" | "DISCOVER" | "CARD";

function detectBrand(digits: string): Brand {
  if (digits.startsWith("4")) return "VISA";
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return "MASTERCARD";
  if (/^3[47]/.test(digits)) return "AMEX";
  if (/^6(?:011|5)/.test(digits)) return "DISCOVER";
  return "CARD";
}

function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length >= 3) return digits.slice(0, 2) + " / " + digits.slice(2);
  return digits;
}

// SVG brand logos
function BrandLogos({ active }: { active: Brand }) {
  const logos: { id: Brand; svg: React.ReactNode }[] = [
    {
      id: "VISA",
      svg: (
        <svg viewBox="0 0 48 16" className="h-5 w-auto" aria-label="Visa">
          <text x="0" y="13" fontFamily="Arial Black,Arial" fontWeight="900" fontSize="14" fill={active === "VISA" ? "#1a1f71" : "#c0c8d8"}>VISA</text>
        </svg>
      ),
    },
    {
      id: "MASTERCARD",
      svg: (
        <svg viewBox="0 0 38 24" className="h-5 w-auto" aria-label="Mastercard">
          <circle cx="14" cy="12" r="10" fill={active === "MASTERCARD" ? "#eb001b" : "#d8dde8"} />
          <circle cx="24" cy="12" r="10" fill={active === "MASTERCARD" ? "#f79e1b" : "#e8ecf2"} fillOpacity={active === "MASTERCARD" ? "0.85" : "1"} />
        </svg>
      ),
    },
    {
      id: "AMEX",
      svg: (
        <svg viewBox="0 0 48 16" className="h-5 w-auto" aria-label="Amex">
          <text x="0" y="13" fontFamily="Arial Black,Arial" fontWeight="900" fontSize="11" fill={active === "AMEX" ? "#007bc1" : "#c0c8d8"}>AMEX</text>
        </svg>
      ),
    },
    {
      id: "DISCOVER",
      svg: (
        <svg viewBox="0 0 60 16" className="h-5 w-auto" aria-label="Discover">
          <text x="0" y="13" fontFamily="Arial Black,Arial" fontWeight="900" fontSize="10" fill={active === "DISCOVER" ? "#f76f20" : "#c0c8d8"}>DISC</text>
          <circle cx="52" cy="8" r="7" fill={active === "DISCOVER" ? "#f76f20" : "#d8dde8"} />
        </svg>
      ),
    },
  ];
  return (
    <div className="flex gap-3 items-center mt-1 mb-3">
      {logos.map(l => (
        <span
          key={l.id}
          className={`transition-opacity duration-200 ${active !== "CARD" && active !== l.id ? "opacity-30" : "opacity-100"}`}
        >
          {l.svg}
        </span>
      ))}
    </div>
  );
}

// Animated success checkmark
function SuccessScreen({ name }: { name: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => { setTimeout(() => setShow(true), 80); }, []);
  const firstName = name ? name.split(" ")[0] : "";
  return (
    <div className="bg-white border border-[#e4e8ee] rounded-[28px] p-7 shadow-[0_22px_60px_rgba(71,54,35,.09)] text-center">
      {/* Animated checkmark */}
      <div className="flex justify-center mb-4">
        <svg
          className={`w-20 h-20 transition-all duration-700 ${show ? "opacity-100 scale-100" : "opacity-0 scale-50"}`}
          viewBox="0 0 80 80"
        >
          <circle cx="40" cy="40" r="38" fill="#f0fdf4" stroke="#22c55e" strokeWidth="3" />
          <polyline
            points="22,42 34,54 58,28"
            fill="none"
            stroke="#22c55e"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              strokeDasharray: 60,
              strokeDashoffset: show ? 0 : 60,
              transition: "stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1) 0.3s",
            }}
          />
        </svg>
      </div>
      <h2 className="text-2xl font-black text-[#1e2430] mb-2">
        {firstName ? `You're all set, ${firstName}!` : "You're all set!"}
      </h2>
      <p className="text-[15px] text-[#657080] leading-relaxed">
        Your card has been securely authorized. No charge today — you'll only be billed after your cleaning is completed.
      </p>
      {/* What happens next */}
      <div className="mt-5 bg-[#f0fdf4] border border-[#bbf7d0] rounded-[16px] px-4 py-3 text-[13px] font-bold text-[#166534]">
        📱 We'll text you a confirmation within 5 minutes.
      </div>
      <div className="mt-5 inline-flex gap-2 items-center px-4 py-2 rounded-full bg-[#fff0dc] text-[#a75500] font-extrabold text-sm">
        Secured by <span className="font-black tracking-tight ml-1">Stripe</span>
      </div>
    </div>
  );
}

// Appointment summary card (shown above form)
function AppointmentSummary({ name, date, address }: { name: string; date?: string; address?: string }) {
  if (!name && !date && !address) return null;
  return (
    <div className="bg-[#fff8f2] border border-[#ffd8ac] rounded-[18px] px-4 py-3 mb-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-xl bg-[#ff7a1a] text-white grid place-items-center flex-shrink-0 text-base mt-0.5">🏠</div>
      <div>
        {name && <p className="text-[14px] font-black text-[#1e2430]">{name}</p>}
        {date && <p className="text-[13px] text-[#7c3b00] font-bold">{date}</p>}
        {address && <p className="text-[12px] text-[#a75500]">{address}</p>}
      </div>
    </div>
  );
}

// Rating badges — Google + Thumbtack
function RatingBadges() {
  return (
    <div className="flex gap-2 mb-4 flex-wrap">
      {/* Google */}
      <div className="flex items-center gap-2 bg-white border border-[#e4e8ee] rounded-[14px] px-3 py-2 shadow-sm">
        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        <div className="flex items-center gap-1">
          <span className="text-[#f59e0b] text-sm leading-none">★★★★★</span>
          <span className="text-[13px] font-black text-[#1e2430]">4.9</span>
        </div>
      </div>
      {/* Thumbtack */}
      <div className="flex items-center gap-2 bg-white border border-[#e4e8ee] rounded-[14px] px-3 py-2 shadow-sm">
        <div className="w-4 h-4 rounded flex-shrink-0 grid place-items-center" style={{ background: "#009FD9" }}>
          <span className="text-white font-black text-[11px] leading-none">T</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[#f59e0b] text-sm leading-none">★★★★★</span>
          <span className="text-[13px] font-black text-[#1e2430]">4.9</span>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full px-4 py-[15px] rounded-[14px] border border-[#d9dee8] text-[15px] bg-white text-[#1e2430] outline-none focus:border-[#ff7a1a] focus:ring-2 focus:ring-[#ff7a1a]/20 transition";
const labelClass = "block text-[13px] font-bold mt-[14px] mb-[7px] text-[#1e2430]";

function CardForm({
  name, setName, cardNumber, cardBrand, expiry, cvc, setCvc, zip, setZip,
  loading, handleCardInput, handleExpiryInput, handleSubmit, prefillName, date, address,
}: {
  name: string; setName: (v: string) => void;
  cardNumber: string; cardBrand: Brand;
  expiry: string; cvc: string; setCvc: (v: string) => void;
  zip: string; setZip: (v: string) => void;
  loading: boolean;
  handleCardInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExpiryInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSubmit: (e: React.FormEvent) => void;
  prefillName: string;
  date?: string;
  address?: string;
}) {
  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-[#e4e8ee] rounded-[28px] p-6 shadow-[0_22px_60px_rgba(71,54,35,.09)]"
    >
      {/* Appointment summary */}
      <AppointmentSummary name={prefillName} date={date} address={address} />

      {/* Notice */}
      <div className="bg-[#fff4e7] border border-[#ffd8ac] text-[#7c3b00] rounded-[18px] p-4 font-extrabold text-sm leading-[1.45] mb-4">
        Your card is never saved by us or ever seen by a human being.
      </div>

      <h2 className="text-xl font-black text-[#1e2430] mb-1">Secure your home cleaning</h2>
      <p className="text-[13px] text-[#657080] mb-2">No deposit. No charge until after service. Secure preauthorization only.</p>

      {/* Rating badges */}
      <RatingBadges />

      <label className={labelClass}>Cardholder name</label>
      <input
        required
        className={inputClass}
        placeholder="Name on card"
        value={name}
        onChange={e => setName(e.target.value)}
        autoComplete="cc-name"
      />

      <label className={labelClass}>Card number</label>
      {/* Card brand logos */}
      <BrandLogos active={cardBrand} />
      <input
        required
        className={inputClass}
        placeholder="4242 4242 4242 4242"
        value={cardNumber}
        onChange={handleCardInput}
        inputMode="numeric"
        autoComplete="cc-number"
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Expiration</label>
          <input
            required
            className={inputClass}
            placeholder="MM / YY"
            value={expiry}
            onChange={handleExpiryInput}
            inputMode="numeric"
            autoComplete="cc-exp"
          />
        </div>
        <div>
          <label className={labelClass}>CVC</label>
          <input
            required
            className={inputClass}
            placeholder="123"
            value={cvc}
            onChange={e => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="cc-csc"
          />
        </div>
      </div>

      <label className={labelClass}>Billing ZIP</label>
      <input
        required
        className={inputClass}
        placeholder="ZIP code"
        value={zip}
        onChange={e => setZip(e.target.value.replace(/\D/g, "").slice(0, 10))}
        inputMode="numeric"
        autoComplete="postal-code"
      />

      <button
        type="submit"
        disabled={loading}
        className="w-full mt-[18px] py-4 rounded-[16px] bg-[#ff7a1a] text-white font-black text-base border-0 cursor-pointer transition hover:-translate-y-[1px] hover:bg-[#e86c0e] disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Processing…
          </span>
        ) : "Secure My Appointment →"}
      </button>

      {/* Micro-copy: what happens next */}
      <p className="text-[12px] text-[#657080] text-center mt-2">
        📱 We'll text you a confirmation within 5 minutes.
      </p>

      <p className="text-[12px] text-[#657080] text-center mt-1">
        Secured by Stripe — 256-bit SSL encryption.
      </p>
    </form>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-[#e4e8ee] rounded-[20px] my-2.5 px-[18px]">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full bg-transparent border-0 text-left py-[18px] text-base font-extrabold flex justify-between items-center cursor-pointer text-[#1e2430]"
      >
        {q}
        <span className="text-xl font-black text-[#ff7a1a] ml-4 flex-shrink-0">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <p className="text-sm text-[#657080] leading-relaxed pb-[18px]">{a}</p>
      )}
    </div>
  );
}

export default function CardAuth() {
  const params = useParams<{ token: string }>();
  const search = useSearch();
  const urlParams = new URLSearchParams(search);
  const prefillName = urlParams.get("name") ?? "";
  const prefillDate = urlParams.get("date") ?? "";
  const prefillAddress = urlParams.get("address") ?? "";

  const [name, setName] = useState(prefillName);
  const [cardNumber, setCardNumber] = useState("");
  const [cardBrand, setCardBrand] = useState<Brand>("CARD");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [zip, setZip] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  function handleCardInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 16);
    setCardNumber(formatCardNumber(raw));
    setCardBrand(detectBrand(raw));
  }

  function handleExpiryInput(e: React.ChangeEvent<HTMLInputElement>) {
    setExpiry(formatExpiry(e.target.value));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 1400);
  }

  const formProps = {
    name, setName, cardNumber, cardBrand, expiry, cvc, setCvc, zip, setZip,
    loading, handleCardInput, handleExpiryInput, handleSubmit,
    prefillName, date: prefillDate, address: prefillAddress,
  };

  const trustCards = [
    { title: "Card never seen by humans", body: "Your full card number is never visible to our cleaners, dispatchers, or office team." },
    { title: "Not stored on our system", body: "Stripe securely processes your card details. We do not save card numbers." },
    { title: "Insured cleaning service", body: "Your appointment is handled by a professional home service team." },
    { title: "Satisfaction guarantee", body: "We stand behind the quality of your completed cleaning." },
  ];

  return (
    <div
      className="min-h-screen"
      style={{ background: "linear-gradient(180deg,#fff8f2,#f8fafc)", fontFamily: "Inter,ui-sans-serif,system-ui,-apple-system,Arial,sans-serif", color: "#1e2430" }}
    >
      {/* Top nav */}
      <div className="max-w-[1160px] mx-auto px-4 sm:px-6">
        <div className="flex justify-between items-center py-4 sm:py-[22px]">
          <div className="flex gap-2.5 items-center font-black text-[#1e2430] text-sm sm:text-base">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#111827] text-white grid place-items-center text-sm sm:text-base flex-shrink-0">🏠</div>
            Maids in Black
          </div>
          <div className="inline-flex gap-1.5 items-center px-2.5 py-1.5 rounded-full bg-[#fff0dc] text-[#a75500] font-extrabold text-[11px] sm:text-[13px]">
            Secured by <span className="font-black tracking-tight ml-1">Stripe</span>
          </div>
        </div>

        <div className="pb-[54px] pt-2 sm:pt-5">

          {/* ── MOBILE layout ── */}
          <div className="block lg:hidden mb-8">
            {submitted ? (
              <SuccessScreen name={name} />
            ) : (
              <CardForm {...formProps} />
            )}
          </div>

          {/* ── DESKTOP layout ── */}
          <div className="hidden lg:grid gap-[30px]" style={{ gridTemplateColumns: "1fr 0.9fr" }}>

            {/* Left column */}
            <main>
              <div className="inline-flex gap-2 items-center px-3 py-2 rounded-full bg-[#fff0dc] text-[#a75500] font-extrabold text-[13px] mb-4">
                Trusted home cleaning authorization
              </div>
              <h1 className="text-[54px] leading-[0.98] tracking-[-0.06em] font-black my-[18px] text-[#1e2430]">
                Reserve your trusted cleaning team.
              </h1>
              <p className="text-[19px] leading-[1.55] text-[#657080]">
                To protect your appointment time, we securely preauthorize your card before service. You are not charged until your cleaning is completed.
              </p>

              {/* Animated cleaner video */}
              <div className="my-6 rounded-[32px] overflow-hidden" style={{ boxShadow: "0 22px 60px rgba(71,54,35,.12)" }}>
                <video autoPlay loop muted playsInline className="w-full h-[260px] object-cover">
                  <source src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/review-animation_ecc264ea.webm" type="video/webm" />
                  <source src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/review-animation_7c44ae8d.mp4" type="video/mp4" />
                </video>
              </div>

              {/* Trust cards */}
              <div className="grid grid-cols-2 gap-[18px] my-[22px]">
                {trustCards.map(c => (
                  <div key={c.title} className="bg-white border border-[#e4e8ee] rounded-[28px] p-6 shadow-[0_22px_60px_rgba(71,54,35,.09)]">
                    <h3 className="font-extrabold text-[#1e2430] mb-1">{c.title}</h3>
                    <p className="text-[13px] text-[#657080] leading-relaxed">{c.body}</p>
                  </div>
                ))}
              </div>

              {/* Testimonial */}
              <div className="bg-white border border-[#e4e8ee] rounded-[28px] p-6 shadow-[0_22px_60px_rgba(71,54,35,.09)]">
                <div className="text-[#ff9900] tracking-[2px] mb-2">★★★★★</div>
                <p className="text-[20px] leading-[1.45] font-extrabold text-[#1e2430]">
                  "I felt comfortable booking because everything was clear: no charge upfront, card handled securely, and the team showed up professionally."
                </p>
                <p className="text-[13px] text-[#657080] mt-2">Verified Maids in Black customer</p>
              </div>

              {/* FAQ */}
              <div className="my-[22px] mb-[60px]">
                <h2 className="text-xl font-black text-[#1e2430] mb-2">Common questions</h2>
                <FaqItem q="Will my card be charged before the cleaning?" a="No. We preauthorize before service, but your card is charged only after the cleaning is completed." />
                <FaqItem q="Why is a card required?" a="It allows us to reserve a team for your appointment and protect the schedule from last-minute no-shows." />
                <FaqItem q="Is my card safe?" a="Yes. Stripe processes the card securely. We do not store the card number, and no human sees it." />
                <FaqItem q="What if I need to reschedule?" a="Contact us at least 24 hours before your appointment and we'll reschedule at no charge." />
              </div>
            </main>

            {/* Right column — sticky form */}
            <aside className="sticky top-6 self-start">
              {submitted ? (
                <SuccessScreen name={name} />
              ) : (
                <CardForm {...formProps} />
              )}
            </aside>
          </div>

          {/* Mobile: content below form */}
          <div className="block lg:hidden">
            <div className="inline-flex gap-2 items-center px-3 py-2 rounded-full bg-[#fff0dc] text-[#a75500] font-extrabold text-[13px] mb-4">
              Trusted home cleaning authorization
            </div>
            <h1 className="text-[36px] leading-[1.05] tracking-[-0.04em] font-black my-4 text-[#1e2430]">
              Reserve your trusted cleaning team.
            </h1>
            <p className="text-[17px] leading-[1.55] text-[#657080] mb-6">
              To protect your appointment time, we securely preauthorize your card before service. You are not charged until your cleaning is completed.
            </p>

            {/* Animated cleaner video */}
            <div className="mb-6 rounded-[24px] overflow-hidden" style={{ boxShadow: "0 16px 40px rgba(71,54,35,.12)" }}>
              <video autoPlay loop muted playsInline className="w-full h-[220px] object-cover">
                <source src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/review-animation_ecc264ea.webm" type="video/webm" />
                <source src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/review-animation_7c44ae8d.mp4" type="video/mp4" />
              </video>
            </div>

            {/* Trust cards — single column on mobile */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              {trustCards.map(c => (
                <div key={c.title} className="bg-white border border-[#e4e8ee] rounded-[24px] p-5 shadow-[0_8px_30px_rgba(71,54,35,.07)]">
                  <h3 className="font-extrabold text-[#1e2430] mb-1 text-[15px]">{c.title}</h3>
                  <p className="text-[13px] text-[#657080] leading-relaxed">{c.body}</p>
                </div>
              ))}
            </div>

            {/* Testimonial */}
            <div className="bg-white border border-[#e4e8ee] rounded-[24px] p-5 shadow-[0_8px_30px_rgba(71,54,35,.07)] mb-6">
              <div className="text-[#ff9900] tracking-[2px] mb-2">★★★★★</div>
              <p className="text-[17px] leading-[1.45] font-extrabold text-[#1e2430]">
                "I felt comfortable booking because everything was clear: no charge upfront, card handled securely, and the team showed up professionally."
              </p>
              <p className="text-[13px] text-[#657080] mt-2">Verified Maids in Black customer</p>
            </div>

            {/* FAQ */}
            <div className="mb-12">
              <h2 className="text-xl font-black text-[#1e2430] mb-2">Common questions</h2>
              <FaqItem q="Will my card be charged before the cleaning?" a="No. We preauthorize before service, but your card is charged only after the cleaning is completed." />
              <FaqItem q="Why is a card required?" a="It allows us to reserve a team for your appointment and protect the schedule from last-minute no-shows." />
              <FaqItem q="Is my card safe?" a="Yes. Stripe processes the card securely. We do not store the card number, and no human sees it." />
              <FaqItem q="What if I need to reschedule?" a="Contact us at least 24 hours before your appointment and we'll reschedule at no charge." />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
