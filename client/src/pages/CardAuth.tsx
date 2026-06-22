/**
 * /pay/:token — Public card authorization page
 * Design: Warm Coral / Maids in Black brand
 * Mobile-first responsive layout
 * UI-only for now; Stripe integration wired in next phase
 */
import { useState } from "react";
import { useParams, useSearch } from "wouter";

function formatCardNumber(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

function detectBrand(digits: string): string {
  if (digits.startsWith("4")) return "VISA";
  if (digits.startsWith("5")) return "MASTERCARD";
  if (digits.startsWith("3")) return "AMEX";
  return "CARD";
}

function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length >= 3) return digits.slice(0, 2) + " / " + digits.slice(2);
  return digits;
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

const inputClass =
  "w-full px-4 py-[15px] rounded-[14px] border border-[#d9dee8] text-[15px] bg-white text-[#1e2430] outline-none focus:border-[#ff7a1a] focus:ring-2 focus:ring-[#ff7a1a]/20 transition";
const labelClass = "block text-[13px] font-bold mt-[14px] mb-[7px] text-[#1e2430]";

function CardForm({
  name, setName, cardNumber, cardBrand, expiry, cvc, setCvc, zip, setZip,
  loading, handleCardInput, handleExpiryInput, handleSubmit,
}: {
  name: string; setName: (v: string) => void;
  cardNumber: string; cardBrand: string;
  expiry: string; cvc: string; setCvc: (v: string) => void;
  zip: string; setZip: (v: string) => void;
  loading: boolean;
  handleCardInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExpiryInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-[#e4e8ee] rounded-[28px] p-6 shadow-[0_22px_60px_rgba(71,54,35,.09)]"
    >
      {/* Notice */}
      <div className="bg-[#fff4e7] border border-[#ffd8ac] text-[#7c3b00] rounded-[18px] p-4 font-extrabold text-sm leading-[1.45] mb-4">
        Your card is never saved by us or ever seen by a human being.
      </div>

      <h2 className="text-xl font-black text-[#1e2430] mb-1">Secure your home cleaning</h2>
      <p className="text-[13px] text-[#657080] mb-2">No deposit. No charge until after service. Secure preauthorization only.</p>

      <label className={labelClass}>Cardholder name</label>
      <input
        required
        className={inputClass}
        placeholder="Name on card"
        value={name}
        onChange={e => setName(e.target.value)}
        autoComplete="cc-name"
      />

      <label className={labelClass}>
        Card number{" "}
        <span className="text-[11px] font-black tracking-[.1em] text-[#ff7a1a] ml-1">{cardBrand}</span>
      </label>
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
        ) : "Secure My Appointment"}
      </button>

      <p className="text-[12px] text-[#657080] text-center mt-3">
        Powered by Stripe secure payment processing.
      </p>
    </form>
  );
}

export default function CardAuth() {
  const params = useParams<{ token: string }>();
  const search = useSearch();
  const urlParams = new URLSearchParams(search);
  const prefillName = urlParams.get("name") ?? "";

  const [name, setName] = useState(prefillName);
  const [cardNumber, setCardNumber] = useState("");
  const [cardBrand, setCardBrand] = useState("CARD");
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
            Secure <span className="hidden sm:inline">payment powered by</span> <span className="font-black tracking-tight">stripe</span>
          </div>
        </div>

        {/* On mobile: form first (above the fold), then content below */}
        {/* On desktop: left content + right sticky form side by side */}
        <div className="pb-[54px] pt-2 sm:pt-5">

          {/* Mobile: form at top */}
          <div className="block lg:hidden mb-8">
            {submitted ? (
              <div className="bg-white border border-[#e4e8ee] rounded-[28px] p-7 shadow-[0_22px_60px_rgba(71,54,35,.09)] text-center">
                <div className="text-[56px] mb-2">✅</div>
                <h2 className="text-2xl font-black text-[#1e2430] mt-2 mb-1">Your booking is confirmed!</h2>
                <p className="text-[15px] text-[#657080] leading-relaxed mt-2">
                  Thank you{name ? `, ${name.split(" ")[0]}` : ""}! Your card has been securely authorized.
                  <br /><br />
                  No charge today — your card will only be processed after your cleaning is completed. We look forward to seeing you soon! 🏠✨
                </p>
                <div className="mt-6 inline-flex gap-2 items-center px-4 py-2 rounded-full bg-[#fff0dc] text-[#a75500] font-extrabold text-sm">
                  Powered by <span className="font-black tracking-tight">stripe</span>
                </div>
              </div>
            ) : (
              <CardForm
                name={name} setName={setName}
                cardNumber={cardNumber} cardBrand={cardBrand}
                expiry={expiry} cvc={cvc} setCvc={setCvc}
                zip={zip} setZip={setZip}
                loading={loading}
                handleCardInput={handleCardInput}
                handleExpiryInput={handleExpiryInput}
                handleSubmit={handleSubmit}
              />
            )}
          </div>

          {/* Desktop: 2-column grid */}
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
                {[
                  { title: "Card never seen by humans", body: "Your full card number is never visible to our cleaners, dispatchers, or office team." },
                  { title: "Not stored on our system", body: "Stripe securely processes your card details. We do not save card numbers." },
                  { title: "Insured cleaning service", body: "Your appointment is handled by a professional home service team." },
                  { title: "Satisfaction guarantee", body: "We stand behind the quality of your completed cleaning." },
                ].map(c => (
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
                <div className="bg-white border border-[#e4e8ee] rounded-[28px] p-7 shadow-[0_22px_60px_rgba(71,54,35,.09)] text-center">
                  <div className="text-[56px] mb-2">✅</div>
                  <h2 className="text-2xl font-black text-[#1e2430] mt-2 mb-1">Your booking is confirmed!</h2>
                  <p className="text-[15px] text-[#657080] leading-relaxed mt-2">
                    Thank you{name ? `, ${name.split(" ")[0]}` : ""}! Your card has been securely authorized.
                    <br /><br />
                    No charge today — your card will only be processed after your cleaning is completed. We look forward to seeing you soon! 🏠✨
                  </p>
                  <div className="mt-6 inline-flex gap-2 items-center px-4 py-2 rounded-full bg-[#fff0dc] text-[#a75500] font-extrabold text-sm">
                    Powered by <span className="font-black tracking-tight">stripe</span>
                  </div>
                </div>
              ) : (
                <CardForm
                  name={name} setName={setName}
                  cardNumber={cardNumber} cardBrand={cardBrand}
                  expiry={expiry} cvc={cvc} setCvc={setCvc}
                  zip={zip} setZip={setZip}
                  loading={loading}
                  handleCardInput={handleCardInput}
                  handleExpiryInput={handleExpiryInput}
                  handleSubmit={handleSubmit}
                />
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
              {[
                { title: "Card never seen by humans", body: "Your full card number is never visible to our cleaners, dispatchers, or office team." },
                { title: "Not stored on our system", body: "Stripe securely processes your card details. We do not save card numbers." },
                { title: "Insured cleaning service", body: "Your appointment is handled by a professional home service team." },
                { title: "Satisfaction guarantee", body: "We stand behind the quality of your completed cleaning." },
              ].map(c => (
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
