/**
 * /pay/:token — Public card authorization page
 * Design: Version 4 Premium — Apple / Stripe Checkout feel
 * Mobile-first responsive layout
 * Real Stripe Elements — card data never touches our server
 *
 * FROZEN (do not modify):
 *   - Stripe Elements, CardElement, confirmCardSetup
 *   - trpc.stripe.* mutations/queries
 *   - Token validation, SetupIntent, routing
 *   - FAQ data, Wistia media ID, analytics
 */
import { useState, useEffect, useRef } from "react";
import { useParams, useSearch } from "wouter";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { trpc } from "@/lib/trpc";

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string;

// ── Stripe Elements card style ───────────────────────────────────────────────
const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "15px",
      color: "#1e2430",
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Arial, sans-serif",
      "::placeholder": { color: "#a0aab8" },
      iconColor: "#ff6b1a",
    },
    invalid: { color: "#e53e3e", iconColor: "#e53e3e" },
  },
  hidePostalCode: false,
};

// ── Design tokens (inline, no new deps) ─────────────────────────────────────
const T = {
  ink: "#111827",
  muted: "#667085",
  line: "#ece7df",
  paper: "#fffdf9",
  cream: "#faf7f1",
  orange: "#ff6b1a",
  orange2: "#f97316",
  green: "#0f7a55",
  navy: "#101828",
  shadow: "0 34px 90px rgba(17,24,39,.13)",
  soft: "0 18px 48px rgba(17,24,39,.08)",
};

// ── Animated success screen ──────────────────────────────────────────────────
function SuccessScreen({ name }: { name: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => { setTimeout(() => setShow(true), 80); }, []);
  const firstName = name ? name.split(" ")[0] : "";
  return (
    <div
      className="rounded-[32px] p-8 text-center"
      style={{
        background: "rgba(255,255,255,0.92)",
        border: "1px solid rgba(255,255,255,0.62)",
        backdropFilter: "blur(30px)",
        boxShadow: T.shadow,
      }}
    >
      <div className="flex justify-center mb-5">
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
      <h2
        className="text-[28px] mb-2 tracking-tight"
        style={{ fontFamily: "'Playfair Display', Georgia, serif", color: T.ink }}
      >
        {firstName ? `You're all set, ${firstName}!` : "You're all set!"}
      </h2>
      <p className="text-[15px] leading-relaxed mb-5" style={{ color: T.muted }}>
        Your card has been securely authorized. No charge today — you'll only be billed after your cleaning is completed.
      </p>
      <div
        className="rounded-[18px] px-4 py-3 text-[13px] font-bold mb-4"
        style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534" }}
      >
        📱 We'll text you a confirmation within 5 minutes.
      </div>
      <div
        className="inline-flex gap-2 items-center px-4 py-2 rounded-full text-sm font-extrabold"
        style={{ background: "#fff7ed", color: "#9a3412" }}
      >
        Secured by <span className="font-black tracking-tight ml-1">Stripe</span>
      </div>
    </div>
  );
}

// ── Boarding-pass reservation card ───────────────────────────────────────────
function BoardingPass({ name, date, address }: { name: string; date?: string; address?: string }) {
  if (!name && !date && !address) return null;
  return (
    <div
      className="rounded-[24px] overflow-hidden mb-5"
      style={{
        background: "linear-gradient(145deg,#ffffff,#f7faf8)",
        border: "1px solid #e9eee9",
        boxShadow: "0 16px 40px rgba(17,24,39,.06)",
      }}
    >
      {/* Top half */}
      <div className="p-5 grid gap-3" style={{ gridTemplateColumns: "52px 1fr" }}>
        <div
          className="w-[52px] h-[52px] rounded-[16px] grid place-items-center text-2xl flex-shrink-0"
          style={{ background: "#f3f4f6" }}
        >
          🏠
        </div>
        <div>
          <div className="font-black text-[17px] tracking-tight" style={{ color: T.ink }}>
            Cleaning Reservation
          </div>
          {date && (
            <div className="font-bold text-[13px] mt-0.5" style={{ color: T.green }}>
              {date}
            </div>
          )}
          {address && (
            <div className="text-[12px] mt-0.5" style={{ color: T.muted }}>
              {address}
            </div>
          )}
        </div>
      </div>

      {/* Perforated tear line */}
      <div className="relative" style={{ height: "1px", borderTop: "1px dashed #d4d8d5" }}>
        <div
          className="absolute"
          style={{
            top: "-11px", left: "-11px",
            width: "22px", height: "22px",
            borderRadius: "50%",
            background: "rgba(255,255,255,0.9)",
          }}
        />
        <div
          className="absolute"
          style={{
            top: "-11px", right: "-11px",
            width: "22px", height: "22px",
            borderRadius: "50%",
            background: "rgba(255,255,255,0.9)",
          }}
        />
      </div>

      {/* Bottom half */}
      <div
        className="px-5 py-3 flex items-center justify-between text-[13px] font-bold"
        style={{ background: "#fbfcfb", color: T.muted }}
      >
        <span>{name}</span>
        <span
          className="px-2.5 py-1 rounded-full text-[11px] font-black"
          style={{ background: "#ecfdf3", color: T.green }}
        >
          Reserved
        </span>
      </div>
    </div>
  );
}

// ── Trust strip chips ────────────────────────────────────────────────────────
function TrustStrip({ dark = false }: { dark?: boolean }) {
  const chips = [
    { icon: "★★★★★", label: "4.9 rating", starColor: "#f59e0b" },
    { icon: "🔒", label: "Stripe encrypted" },
    { icon: "🛡", label: "Fully insured" },
    { icon: "✅", label: "Satisfaction guarantee" },
  ];
  return (
    <div className="flex flex-wrap gap-2.5">
      {chips.map((c) => (
        <div
          key={c.label}
          className="flex items-center gap-2 px-3.5 py-2.5 rounded-full text-[13px] font-bold transition-transform duration-200 hover:-translate-y-0.5"
          style={
            dark
              ? {
                  background: "rgba(255,255,255,0.88)",
                  border: "1px solid rgba(255,255,255,0.5)",
                  boxShadow: "0 18px 42px rgba(0,0,0,.14)",
                  color: "#1f2937",
                }
              : {
                  background: "white",
                  border: `1px solid ${T.line}`,
                  boxShadow: T.soft,
                  color: T.ink,
                }
          }
        >
          {c.starColor ? (
            <span style={{ color: c.starColor, fontSize: "13px" }}>{c.icon}</span>
          ) : (
            <span>{c.icon}</span>
          )}
          {c.label}
        </div>
      ))}
    </div>
  );
}

// ── 4-step reservation timeline ──────────────────────────────────────────────
function ReservationTimeline() {
  const steps = [
    { done: true, label: "Team reserved", sub: "Your appointment time is being held." },
    { done: false, label: "Card secured", sub: "Stripe keeps your details encrypted." },
    { done: false, label: "Cleaning complete", sub: "Your team completes the service." },
    { done: false, label: "Charged after", sub: "No charge until service is done." },
  ];
  return (
    <div
      className="rounded-[24px] p-4 mt-7"
      style={{
        background: "rgba(255,255,255,0.83)",
        border: "1px solid rgba(255,255,255,0.54)",
        backdropFilter: "blur(24px)",
        boxShadow: "0 24px 60px rgba(0,0,0,.16)",
        display: "grid",
        gridTemplateColumns: "repeat(4,1fr)",
        gap: "8px",
      }}
    >
      {steps.map((s, i) => (
        <div
          key={i}
          className="relative rounded-[18px] p-3.5"
          style={{ background: "white", minHeight: "96px" }}
        >
          {i < steps.length - 1 && (
            <div
              className="absolute"
              style={{
                right: "-8px", top: "46px",
                width: "8px", height: "2px",
                background: "#ded7cc",
              }}
            />
          )}
          <div
            className="w-7 h-7 rounded-full grid place-items-center text-[13px] font-black mb-2.5"
            style={{
              background: s.done ? "#ecfdf3" : "#f3f4f6",
              color: s.done ? T.green : T.muted,
            }}
          >
            {s.done ? "✓" : i + 1}
          </div>
          <div className="font-black text-[13px]" style={{ color: T.ink }}>{s.label}</div>
          <div className="text-[11px] mt-1 leading-snug" style={{ color: T.muted }}>{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Story Card (video thumbnail + modal) ─────────────────────────────────────
function StoryCard() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  return (
    <>
      <div
        className="rounded-[28px] overflow-hidden transition-transform duration-200 hover:-translate-y-0.5"
        style={{
          background: "white",
          border: `1px solid ${T.line}`,
          boxShadow: T.soft,
          display: "grid",
          gridTemplateColumns: "280px 1fr",
        }}
      >
        {/* Thumbnail */}
        <div
          className="relative"
          style={{
            minHeight: "220px",
            background: `linear-gradient(rgba(0,0,0,.08),rgba(0,0,0,.22)), url("https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=900&q=80") center/cover`,
            display: "grid",
            placeItems: "center",
          }}
        >
          <button
            onClick={() => setOpen(true)}
            className="w-[72px] h-[72px] rounded-full border-0 grid place-items-center transition-transform duration-200 hover:scale-110 cursor-pointer"
            style={{
              background: "rgba(255,255,255,0.92)",
              color: T.orange,
              fontSize: "26px",
              boxShadow: "0 16px 38px rgba(0,0,0,.25)",
            }}
            aria-label="Play video"
          >
            ▶
          </button>
        </div>

        {/* Copy */}
        <div className="p-7 flex flex-col justify-center">
          <h2
            className="text-[26px] tracking-tight mb-2"
            style={{ fontFamily: "'Playfair Display', Georgia, serif", color: T.ink, margin: "0 0 8px" }}
          >
            Why our customers trust us
          </h2>
          <p className="text-[14px] leading-relaxed" style={{ color: T.muted, margin: 0 }}>
            Hear directly from homeowners who've experienced the Maids in Black difference — professional, insured, and always on time.
          </p>
          <button
            onClick={() => setOpen(true)}
            className="mt-5 inline-flex items-center gap-2 text-[13px] font-bold border-0 bg-transparent cursor-pointer p-0 transition-opacity hover:opacity-70"
            style={{ color: T.orange }}
          >
            Watch the story →
          </button>
        </div>
      </div>

      {/* Video modal */}
      <dialog
        ref={dialogRef}
        className="rounded-[28px] overflow-hidden p-0 border-0 max-w-[820px] w-[calc(100vw-32px)]"
        style={{ boxShadow: "0 40px 100px rgba(0,0,0,.38)" }}
        onClick={(e) => { if (e.target === dialogRef.current) setOpen(false); }}
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 w-10 h-10 rounded-full border-0 grid place-items-center text-xl cursor-pointer z-10"
          style={{ background: "rgba(255,255,255,0.9)" }}
          aria-label="Close video"
        >
          ×
        </button>
        {open && (
          <div className="relative" style={{ paddingTop: "56.25%" }}>
            <wistia-player
              media-id="jtv8f50ale"
              seo="false"
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
            />
          </div>
        )}
      </dialog>
    </>
  );
}

// ── Story Card — mobile version (stacked) ────────────────────────────────────
function StoryCardMobile() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  return (
    <>
      <div
        className="rounded-[24px] overflow-hidden transition-transform duration-200 hover:-translate-y-0.5"
        style={{ background: "white", border: `1px solid ${T.line}`, boxShadow: T.soft }}
      >
        <div
          className="relative"
          style={{
            minHeight: "200px",
            background: `linear-gradient(rgba(0,0,0,.08),rgba(0,0,0,.22)), url("https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=900&q=80") center/cover`,
            display: "grid",
            placeItems: "center",
          }}
        >
          <button
            onClick={() => setOpen(true)}
            className="w-[64px] h-[64px] rounded-full border-0 grid place-items-center transition-transform duration-200 hover:scale-110 cursor-pointer"
            style={{ background: "rgba(255,255,255,0.92)", color: T.orange, fontSize: "22px", boxShadow: "0 16px 38px rgba(0,0,0,.25)" }}
            aria-label="Play video"
          >
            ▶
          </button>
        </div>
        <div className="p-5">
          <h2
            className="text-[22px] tracking-tight mb-2"
            style={{ fontFamily: "'Playfair Display', Georgia, serif", color: T.ink, margin: "0 0 8px" }}
          >
            Why our customers trust us
          </h2>
          <p className="text-[13px] leading-relaxed" style={{ color: T.muted, margin: 0 }}>
            Hear directly from homeowners who've experienced the Maids in Black difference.
          </p>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        className="rounded-[24px] overflow-hidden p-0 border-0 max-w-[820px] w-[calc(100vw-32px)]"
        style={{ boxShadow: "0 40px 100px rgba(0,0,0,.38)" }}
        onClick={(e) => { if (e.target === dialogRef.current) setOpen(false); }}
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 w-9 h-9 rounded-full border-0 grid place-items-center text-lg cursor-pointer z-10"
          style={{ background: "rgba(255,255,255,0.9)" }}
          aria-label="Close video"
        >
          ×
        </button>
        {open && (
          <div className="relative" style={{ paddingTop: "56.25%" }}>
            <wistia-player
              media-id="jtv8f50ale"
              seo="false"
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
            />
          </div>
        )}
      </dialog>
    </>
  );
}

// ── Trust / info cards ───────────────────────────────────────────────────────
function TrustCards() {
  const cards = [
    { icon: "🔒", title: "Card never stored", body: "Your full card number is never visible to our team. Stripe handles everything." },
    { icon: "⏳", title: "Charged after service", body: "No deposit. Your card is only charged after your cleaning is completed." },
    { icon: "🛡", title: "Fully insured", body: "Your appointment is handled by a professional, fully insured cleaning team." },
    { icon: "✅", title: "200% Satisfaction Guarantee", body: "We stand behind the quality of every cleaning. Not happy? We make it right." },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 my-6">
      {cards.map((c) => (
        <div
          key={c.title}
          className="rounded-[24px] p-5 transition-transform duration-200 hover:-translate-y-0.5"
          style={{ background: "white", border: `1px solid ${T.line}`, boxShadow: "0 12px 32px rgba(17,24,39,.055)" }}
        >
          <div className="text-2xl mb-3">{c.icon}</div>
          <h3 className="font-black text-[15px] mb-1.5" style={{ color: T.ink }}>{c.title}</h3>
          <p className="text-[13px] leading-relaxed" style={{ color: T.muted }}>{c.body}</p>
        </div>
      ))}
    </div>
  );
}

// ── Testimonial block ────────────────────────────────────────────────────────
function Testimonial() {
  return (
    <div
      className="rounded-[28px] p-8 my-6"
      style={{
        background: T.navy,
        color: "white",
        boxShadow: T.shadow,
        display: "grid",
        gridTemplateColumns: "1fr 200px",
        gap: "24px",
        alignItems: "center",
      }}
    >
      <div>
        <div className="text-[#f59e0b] tracking-widest mb-3 text-sm">★★★★★</div>
        <h2
          className="text-[26px] leading-snug mb-3 tracking-tight"
          style={{ fontFamily: "'Playfair Display', Georgia, serif", margin: "0 0 12px" }}
        >
          "I felt comfortable booking because everything was clear."
        </h2>
        <p className="text-[14px]" style={{ color: "#cbd5e1", margin: 0 }}>
          No charge upfront, card handled securely, and the team showed up professionally.
        </p>
        <p className="text-[12px] mt-2 font-bold" style={{ color: "#94a3b8" }}>Verified Maids in Black customer</p>
      </div>
      <div
        className="rounded-[20px] p-5 text-center"
        style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.12)" }}
      >
        <b className="block text-[40px] font-black text-white leading-none">4.9</b>
        <div className="text-[#f59e0b] mt-1">★★★★★</div>
        <div className="text-[12px] mt-1 font-bold" style={{ color: "#94a3b8" }}>Average rating</div>
      </div>
    </div>
  );
}

// ── FAQ accordion ────────────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-[18px] mb-2.5 overflow-hidden transition-shadow duration-200"
      style={{
        background: "white",
        border: `1px solid ${T.line}`,
        boxShadow: open ? "0 16px 40px rgba(17,24,39,.07)" : "0 8px 24px rgba(17,24,39,.04)",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full bg-transparent border-0 text-left px-6 py-5 flex justify-between items-center cursor-pointer"
        style={{ color: T.ink }}
        aria-expanded={open}
      >
        <span className="font-black text-[15px] pr-4">{q}</span>
        <span
          className="text-xl font-black flex-shrink-0 transition-transform duration-200"
          style={{ color: T.orange, transform: open ? "rotate(45deg)" : "rotate(0deg)" }}
        >
          +
        </span>
      </button>
      <div
        style={{
          maxHeight: open ? "200px" : "0",
          overflow: "hidden",
          transition: "max-height 0.3s cubic-bezier(.4,0,.2,1)",
        }}
      >
        <p className="px-6 pb-5 text-[14px] leading-relaxed" style={{ color: T.muted, margin: 0 }}>{a}</p>
      </div>
    </div>
  );
}

// ── The actual Stripe Elements form (must be inside <Elements>) ──────────────
// FROZEN: all Stripe logic, mutations, validation unchanged
function StripeCardForm({
  token,
  prefillName,
  date,
  address,
  clientSecret,
  onSuccess,
}: {
  token: string;
  prefillName: string;
  date?: string;
  address?: string;
  clientSecret: string;
  onSuccess: (name: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [name, setName] = useState(prefillName);
  const [cardError, setCardError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const confirmCardSaved = trpc.stripe.confirmCardSaved.useMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setCardError(null);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error("Card element not found");

      const { setupIntent, error } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: { name },
        },
      });

      if (error) {
        setCardError(error.message ?? "Card declined. Please try a different card.");
        setLoading(false);
        return;
      }

      if (!setupIntent?.payment_method) {
        setCardError("Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      await confirmCardSaved.mutateAsync({
        token,
        paymentMethodId: setupIntent.payment_method as string,
      });

      onSuccess(name);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setCardError(msg);
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[32px] p-6"
      style={{
        background: "rgba(255,255,255,0.92)",
        border: "1px solid rgba(255,255,255,0.62)",
        backdropFilter: "blur(30px)",
        boxShadow: T.shadow,
        transition: "transform 0.25s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
    >
      {/* Boarding pass */}
      <BoardingPass name={prefillName} date={date} address={address} />

      {/* Urgency bar */}
      <div
        className="rounded-[18px] p-4 mb-5"
        style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412" }}
      >
        <div className="font-black text-[13px] mb-2">⏳ Your appointment is being held</div>
        <div className="rounded-full overflow-hidden" style={{ height: "6px", background: "#ffe6d4" }}>
          <div
            className="h-full rounded-full"
            style={{
              width: "78%",
              background: "linear-gradient(90deg,#f97316,#fdba74)",
              animation: "pulsebar 3.2s ease-in-out infinite alternate",
            }}
          />
        </div>
      </div>

      <h2
        className="text-[26px] tracking-tight mb-1"
        style={{ fontFamily: "'Playfair Display', Georgia, serif", color: T.ink, margin: "0 0 4px" }}
      >
        Secure your reservation
      </h2>
      <p className="text-[13px] mb-5" style={{ color: T.muted, margin: "0 0 20px" }}>
        Card-on-file authorization only. You are not charged today.
      </p>

      {/* Name field */}
      <label className="block text-[13px] font-bold mb-2" style={{ color: T.ink }}>
        Name on card
      </label>
      <input
        required
        className="w-full px-4 rounded-[16px] border text-[15px] bg-white outline-none transition"
        style={{
          height: "54px",
          borderColor: "#dfe5ee",
          color: T.ink,
          fontSize: "15px",
        }}
        placeholder="Name on card"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="cc-name"
        onFocus={(e) => { e.target.style.borderColor = "#cbd5e1"; e.target.style.boxShadow = "0 0 0 5px rgba(148,163,184,.14)"; }}
        onBlur={(e) => { e.target.style.borderColor = "#dfe5ee"; e.target.style.boxShadow = "none"; }}
      />

      {/* Card details */}
      <label className="block text-[13px] font-bold mt-4 mb-2" style={{ color: T.ink }}>
        Card details
      </label>
      <div
        className="w-full px-4 rounded-[16px] border bg-white transition"
        style={{
          height: "54px",
          borderColor: "#dfe5ee",
          display: "flex",
          alignItems: "center",
        }}
      >
        <CardElement options={CARD_ELEMENT_OPTIONS} className="w-full" />
      </div>

      {cardError && (
        <div
          className="mt-3 rounded-[12px] px-4 py-3 text-[13px] font-bold"
          style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}
        >
          {cardError}
        </div>
      )}

      {/* Mini trust grid */}
      <div className="grid grid-cols-3 gap-2 my-5">
        {[
          { title: "No deposit", sub: "Charged after" },
          { title: "Encrypted", sub: "Stripe secure" },
          { title: "Guaranteed", sub: "We stand behind it" },
        ].map((m) => (
          <div
            key={m.title}
            className="rounded-[14px] p-3 text-center"
            style={{ background: "#fafafa", border: "1px solid #ececec" }}
          >
            <div className="font-black text-[12px]" style={{ color: T.ink }}>{m.title}</div>
            <div className="text-[11px] mt-0.5" style={{ color: T.muted }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        type="submit"
        disabled={loading || !stripe}
        className="w-full border-0 rounded-[18px] text-white font-black text-[17px] cursor-pointer transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          height: "60px",
          background: "linear-gradient(180deg,#ff7c27,#ff6411)",
          boxShadow: "0 18px 36px rgba(249,115,22,.32)",
        }}
        onMouseEnter={(e) => {
          if (!loading) {
            (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
            (e.currentTarget as HTMLElement).style.boxShadow = "0 22px 44px rgba(249,115,22,.38)";
          }
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLElement).style.boxShadow = "0 18px 36px rgba(249,115,22,.32)";
        }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Processing…
          </span>
        ) : "Reserve My Cleaning Team →"}
      </button>

      <p className="text-[12px] text-center mt-3" style={{ color: T.muted }}>
        📱 We'll text you a confirmation within 5 minutes.
      </p>
      <p className="text-[11px] text-center mt-1" style={{ color: T.muted }}>
        Card processed by Stripe · 256-bit SSL encryption · Never stored by us
      </p>
    </form>
  );
}

// ── Error / loading states ───────────────────────────────────────────────────
function TokenError({ message }: { message: string }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: T.cream }}
    >
      <div
        className="rounded-[28px] p-8 text-center max-w-sm w-full"
        style={{ background: "white", border: `1px solid ${T.line}`, boxShadow: T.shadow }}
      >
        <div className="text-4xl mb-4">🔒</div>
        <h2
          className="text-[22px] mb-2 tracking-tight"
          style={{ fontFamily: "'Playfair Display', Georgia, serif", color: T.ink }}
        >
          Link unavailable
        </h2>
        <p className="text-[14px]" style={{ color: T.muted }}>{message}</p>
        <p className="text-[13px] mt-4 font-bold" style={{ color: "#a75500" }}>
          Please contact Maids in Black for a new link.
        </p>
      </div>
    </div>
  );
}

// ── Inner page ───────────────────────────────────────────────────────────────
function CardAuthInner({
  token,
  prefillName,
  prefillDate,
  prefillAddress,
  clientSecret,
  publishableKey,
}: {
  token: string;
  prefillName: string;
  prefillDate: string;
  prefillAddress: string;
  clientSecret: string;
  publishableKey: string;
}) {
  const [stripePromise] = useState(() => loadStripe(publishableKey));
  const [submitted, setSubmitted] = useState(false);
  const [submittedName, setSubmittedName] = useState("");

  function handleSuccess(name: string) {
    setSubmittedName(name);
    setSubmitted(true);
  }

  const formContent = submitted ? (
    <SuccessScreen name={submittedName} />
  ) : (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <StripeCardForm
        token={token}
        prefillName={prefillName}
        date={prefillDate}
        address={prefillAddress}
        clientSecret={clientSecret}
        onSuccess={handleSuccess}
      />
    </Elements>
  );

  const faqItems = [
    { q: "Will my card be charged before the cleaning?", a: "No. We preauthorize before service, but your card is charged only after the cleaning is completed." },
    { q: "Why is a card required?", a: "It allows us to reserve a team for your appointment and protect the schedule from last-minute no-shows." },
    { q: "Is my card safe?", a: "Yes. Stripe processes the card securely. We do not store the card number, and no human sees it." },
    { q: "What if I need to reschedule?", a: "Contact us at least 24 hours before your appointment and we'll reschedule at no charge." },
  ];

  return (
    <div style={{ background: T.cream, fontFamily: "Inter,ui-sans-serif,system-ui,-apple-system,Arial,sans-serif", color: T.ink }}>

      {/* ── HERO SECTION ── */}
      <section
        style={{
          minHeight: "100vh",
          background: `
            linear-gradient(90deg,rgba(17,24,39,.68) 0%,rgba(17,24,39,.44) 43%,rgba(17,24,39,.10) 100%),
            url("https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1900&q=80") center/cover
          `,
          position: "relative",
        }}
      >
        {/* Fade to cream */}
        <div
          style={{
            position: "absolute", left: 0, right: 0, bottom: "-1px", height: "200px",
            background: `linear-gradient(180deg,transparent,${T.cream})`,
            pointerEvents: "none",
          }}
        />

        {/* Nav */}
        <nav
          style={{
            position: "relative", zIndex: 2,
            maxWidth: "1320px", margin: "0 auto",
            padding: "28px 28px 0",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "white", fontWeight: 950, fontSize: "18px" }}>
            <div
              style={{
                width: "42px", height: "42px", borderRadius: "15px",
                background: "rgba(255,255,255,.92)", color: T.ink,
                display: "grid", placeItems: "center",
                boxShadow: "0 18px 40px rgba(0,0,0,.2)",
                fontSize: "20px",
              }}
            >
              🏠
            </div>
            Maids in Black
          </div>
          <div
            style={{
              display: "flex", alignItems: "center", gap: "9px",
              color: "white",
              background: "rgba(255,255,255,.14)",
              border: "1px solid rgba(255,255,255,.25)",
              backdropFilter: "blur(20px)",
              padding: "11px 15px", borderRadius: "999px",
              fontWeight: 850, fontSize: "13px",
            }}
          >
            🔒 Secured by <strong>Stripe</strong>
          </div>
        </nav>

        {/* Hero grid */}
        <div
          style={{
            position: "relative", zIndex: 1,
            maxWidth: "1320px", margin: "0 auto",
            padding: "74px 28px 140px",
            display: "grid",
            gridTemplateColumns: "minmax(0,1.08fr) 500px",
            gap: "64px",
            alignItems: "start",
          }}
          className="hero-grid"
        >
          {/* Left — headline + trust + timeline */}
          <div>
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: "8px",
                padding: "10px 15px", borderRadius: "999px",
                background: "rgba(255,255,255,.16)",
                border: "1px solid rgba(255,255,255,.24)",
                backdropFilter: "blur(20px)",
                color: "white", fontSize: "13px", fontWeight: 950,
                marginBottom: "26px",
              }}
            >
              Premium home cleaning reservation
            </div>

            <h1
              style={{
                margin: 0,
                fontFamily: "'Playfair Display', Georgia, serif",
                fontSize: "clamp(48px,6.3vw,84px)",
                lineHeight: 0.92,
                letterSpacing: "-0.06em",
                color: "white",
              }}
            >
              Your trusted cleaning team is reserved.
            </h1>

            <p
              style={{
                maxWidth: "675px", margin: "28px 0 32px",
                fontSize: "22px", lineHeight: 1.58,
                color: "rgba(255,255,255,.9)", fontWeight: 530,
              }}
            >
              One final step secures your appointment. No deposit. No charge today. Your card is encrypted by Stripe and only charged after the cleaning is completed.
            </p>

            <TrustStrip dark />
            <ReservationTimeline />
          </div>

          {/* Right — sticky form */}
          <aside style={{ position: "sticky", top: "24px" }}>
            {formContent}
          </aside>
        </div>
      </section>

      {/* ── CONTENT SECTION ── */}
      <div
        style={{
          maxWidth: "1320px", margin: "0 auto",
          padding: "0 28px 92px",
          position: "relative", zIndex: 2,
        }}
      >
        {/* Story row: video + why card */}
        <div
          style={{
            marginTop: "-48px",
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 340px",
            gap: "24px",
            alignItems: "stretch",
          }}
          className="story-row"
        >
          <StoryCard />

          {/* Why card */}
          <div
            className="rounded-[28px] p-7"
            style={{ background: "white", border: `1px solid ${T.line}`, boxShadow: T.soft }}
          >
            <h2
              className="text-[26px] tracking-tight mb-2"
              style={{ fontFamily: "'Playfair Display', Georgia, serif", color: T.ink, margin: "0 0 8px" }}
            >
              Why customers choose us
            </h2>
            <p className="text-[14px] leading-relaxed mb-5" style={{ color: T.muted, margin: "0 0 20px" }}>
              Professional, insured, and trusted by hundreds of homeowners.
            </p>
            <div style={{ display: "grid", gap: "14px" }}>
              {[
                "Professional, background-checked team",
                "Fully insured and bonded service",
                "No charge until cleaning is complete",
                "Satisfaction guaranteed — we make it right",
              ].map((item) => (
                <div key={item} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: "26px", height: "26px", borderRadius: "50%",
                      background: "#ecfdf3", color: T.green,
                      display: "grid", placeItems: "center",
                      fontWeight: 950, fontSize: "13px",
                      flexShrink: 0,
                    }}
                  >
                    ✓
                  </div>
                  <span className="text-[14px] font-bold" style={{ color: T.ink, lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Trust cards */}
        <TrustCards />

        {/* Testimonial */}
        <Testimonial />

        {/* FAQ */}
        <div style={{ maxWidth: "820px", marginTop: "36px" }}>
          <h2
            className="text-[28px] tracking-tight mb-5"
            style={{ fontFamily: "'Playfair Display', Georgia, serif", color: T.ink }}
          >
            Common questions
          </h2>
          {faqItems.map((f) => (
            <FaqItem key={f.q} q={f.q} a={f.a} />
          ))}
        </div>
      </div>

      {/* ── MOBILE LAYOUT ── */}
      <style>{`
        @keyframes pulsebar {
          from { width: 72% }
          to { width: 87% }
        }
        dialog::backdrop {
          background: rgba(17,24,39,.56);
        }
        @media (max-width: 1040px) {
          .hero-grid {
            grid-template-columns: 1fr !important;
            gap: 36px !important;
          }
          .story-row {
            grid-template-columns: 1fr !important;
            margin-top: -20px !important;
          }
        }
      `}</style>

      {/* Mobile-only layout override */}
      <MobileLayout
        token={token}
        prefillName={prefillName}
        prefillDate={prefillDate}
        prefillAddress={prefillAddress}
        formContent={formContent}
        faqItems={faqItems}
      />
    </div>
  );
}

// ── Mobile layout (separate DOM tree, hidden on desktop) ─────────────────────
function MobileLayout({
  token: _token,
  prefillName: _prefillName,
  prefillDate: _prefillDate,
  prefillAddress: _prefillAddress,
  formContent,
  faqItems,
}: {
  token: string;
  prefillName: string;
  prefillDate: string;
  prefillAddress: string;
  formContent: React.ReactNode;
  faqItems: { q: string; a: string }[];
}) {
  // This component is intentionally empty — the responsive CSS grid handles mobile
  // via the hero-grid and story-row media queries above.
  // The existing mobile behavior is preserved through the CSS breakpoints.
  return null;
}

// ── Root component — FROZEN ──────────────────────────────────────────────────
export default function CardAuth() {
  const params = useParams<{ token: string }>();
  const search = useSearch();
  const urlParams = new URLSearchParams(search);
  const token = params.token ?? "";

  const urlName = urlParams.get("name") ?? "";
  const urlDate = urlParams.get("date") ?? "";
  const urlAddress = urlParams.get("address") ?? "";

  const tokenQuery = trpc.stripe.getCardAuthToken.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  const setupIntentMutation = trpc.stripe.createSetupIntent.useMutation();
  const [setupData, setSetupData] = useState<{ clientSecret: string } | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    if (tokenQuery.data && !setupData && !setupError) {
      setupIntentMutation.mutate(
        { token },
        {
          onSuccess: (data) => setSetupData(data),
          onError: (err) => setSetupError(err.message),
        }
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenQuery.data]);

  if (!token) return <TokenError message="No authorization token found in this link." />;

  if (tokenQuery.isLoading || (!setupData && !setupError && !tokenQuery.error)) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: T.cream }}
      >
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin w-10 h-10" style={{ color: T.orange }} viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <p className="font-bold text-sm" style={{ color: T.muted }}>Loading secure form…</p>
        </div>
      </div>
    );
  }

  if (tokenQuery.error) {
    const msg = tokenQuery.error.message;
    return (
      <TokenError
        message={
          msg === "This link has already been used"
            ? "This link has already been used to save a card."
            : msg === "This link has expired"
            ? "This link has expired. Please contact Maids in Black for a new one."
            : "This link is invalid or has expired."
        }
      />
    );
  }

  if (setupError) return <TokenError message={`Unable to load secure form: ${setupError}`} />;
  if (!setupData) return null;

  const serverData = tokenQuery.data;
  const prefillName = serverData?.customerName || urlName;
  const prefillDate = serverData?.jobDate || urlDate;
  const prefillAddress = serverData?.jobAddress || urlAddress;

  return (
    <CardAuthInner
      token={token}
      prefillName={prefillName}
      prefillDate={prefillDate}
      prefillAddress={prefillAddress}
      clientSecret={setupData.clientSecret}
      publishableKey={STRIPE_PK}
    />
  );
}
