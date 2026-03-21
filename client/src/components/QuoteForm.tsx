/**
 * QuoteForm Component
 * Design: Warm Coral Hospitality — Playfair Display headlines, DM Sans body
 * Colors: Coral #E8603C, Warm bg #FFF8F5, Input bg #FFF0EC
 * Features: Staggered entrance, coral focus rings, success state with bounce animation
 * Backend: tRPC quotes.submit → OpenPhone SMS
 * Office Cleaning: swaps bedroom/bathroom for square footage selector
 * Extras: Optional step 2 with 20 add-on cards (icon + name, no pricing)
 */

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ── Static Testimonial ───────────────────────────────────────────────────────

function TrustStrip() {
  return (
    <div
      className="rounded-xl px-4 py-3 mb-4 flex items-start gap-3"
      style={{
        background: "linear-gradient(135deg, #FFF8F5 0%, #FFF0EC 100%)",
        border: "1px solid #F5D5C8",
      }}
    >
      <span className="text-lg shrink-0 mt-0.5">🏆</span>
      <div className="min-w-0">
        <p
          className="text-sm font-medium leading-snug"
          style={{ color: "#3D1F14", fontFamily: "'DM Sans', sans-serif" }}
        >
          Satisfaction Guaranteed — Every Clean
        </p>
        <p
          className="text-xs mt-0.5"
          style={{ color: "#9A7060", fontFamily: "'DM Sans', sans-serif" }}
        >
          Not satisfied? We re-clean free within 24 hours — no hassle
        </p>
      </div>
    </div>
  );
}

const SERVICE_TYPES = [
  "Standard Cleaning",
  "Deep Cleaning",
  "Move-In / Move-Out Cleaning",
  "Post-Construction Cleaning",
  "Office Cleaning",
];

const BEDROOM_OPTIONS = [
  "Studio",
  "1 Bedroom",
  "2 Bedrooms",
  "3 Bedrooms",
  "4 Bedrooms",
  "5 Bedrooms",
  "6 Bedrooms",
  "7 Bedrooms",
  "7+ Bedrooms",
];

const BATHROOM_OPTIONS = [
  "1 Bathroom",
  "1.5 Bathrooms",
  "2 Bathrooms",
  "2.5 Bathrooms",
  "3 Bathrooms",
  "3.5 Bathrooms",
  "4 Bathrooms",
  "4+ Bathrooms",
];

// Square footage ranges for office cleaning
const SQFT_OPTIONS = [
  "Under 500 sq ft",
  "500–1,000 sq ft",
  "1,000–2,000 sq ft",
  "2,000–3,000 sq ft",
  "3,000–5,000 sq ft",
  "5,000–10,000 sq ft",
  "10,000+ sq ft",
];

// EXTRAS_LIST is imported from shared/extras — prices are kept server-side only (not shown in the form UI)
import { EXTRAS_LIST } from "@shared/extras";
export { EXTRAS_LIST };

interface FormData {
  name: string;
  email: string;
  phone: string;
  serviceType: string;
  bedrooms: string;
  bathrooms: string;
  squareFootage: string;
}

const INITIAL_FORM: FormData = {
  name: "",
  email: "",
  phone: "",
  serviceType: "Standard Cleaning",
  bedrooms: "1 Bedroom",
  bathrooms: "1 Bathroom",
  squareFootage: "500–1,000 sq ft",
};

function StarRating() {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          className="animate-star"
          style={{ animationDelay: `${500 + i * 80}ms` }}
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="#F5A623"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
      <span
        className="animate-fade-slide-up delay-7 ml-1 text-sm font-semibold"
        style={{ color: "#8A6040", fontFamily: "'DM Sans', sans-serif" }}
      >
        5 Stars
      </span>
    </div>
  );
}

const MADISON_PHOTO = "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/madison-headshot-v3-Ky5x7Vzm5HBzWn6As5hsPv.webp";

function SuccessState({ name, smsSent }: { name: string; smsSent: boolean }) {
  const firstName = name ? name.split(" ")[0] : "";
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 text-center animate-fade-slide-up delay-0">
      {/* Checkmark badge */}
      <div
        className="animate-success w-14 h-14 rounded-full flex items-center justify-center mb-6"
        style={{ background: "linear-gradient(135deg, #E8603C 0%, #D44E2A 100%)", boxShadow: "0 4px 16px rgba(232,96,60,0.35)" }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h2
        className="text-2xl font-bold mb-2"
        style={{ fontFamily: "'Playfair Display', serif", color: "#2D2D2D" }}
      >
        {firstName ? `You're all set, ${firstName}!` : "You're all set!"}
      </h2>
      {smsSent && (
        <p className="text-sm mb-6" style={{ color: "#B07060", fontFamily: "'DM Sans', sans-serif" }}>
          Check your phone — your custom quote was just texted to you.
        </p>
      )}

      {/* Divider */}
      <div className="h-px w-12 mx-auto mb-6" style={{ background: "linear-gradient(90deg, transparent, #E8603C, transparent)" }} />

      {/* Madison card */}
      <div
        className="flex items-center gap-4 rounded-2xl px-5 py-4 mb-5 w-full max-w-sm text-left"
        style={{
          background: "linear-gradient(135deg, #FFF5F2 0%, #FDE8E0 100%)",
          border: "1px solid rgba(232,96,60,0.18)",
          boxShadow: "0 2px 12px rgba(232,96,60,0.10)",
        }}
      >
        {/* Photo */}
        <div className="shrink-0">
          <img
            src={MADISON_PHOTO}
            alt="Madison from Maids in Black"
            className="w-16 h-16 rounded-full object-cover object-top"
            style={{ border: "2.5px solid #E8603C", boxShadow: "0 2px 8px rgba(232,96,60,0.25)" }}
          />
        </div>
        {/* Text */}
        <div>
          <p
            className="text-xs font-semibold tracking-widest uppercase mb-0.5"
            style={{ color: "#E8603C", fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.12em" }}
          >
            Your Specialist
          </p>
          <p
            className="text-base font-bold leading-tight"
            style={{ fontFamily: "'Playfair Display', serif", color: "#2D2D2D" }}
          >
            Madison
          </p>
          <p
            className="text-xs mt-0.5"
            style={{ color: "#7A5A4A", fontFamily: "'DM Sans', sans-serif" }}
          >
            Maids in Black · Washington DC
          </p>
        </div>
      </div>

      {/* Call expectation message */}
      <div
        className="rounded-xl px-5 py-4 w-full max-w-sm"
        style={{
          background: "rgba(232,96,60,0.07)",
          border: "1px solid rgba(232,96,60,0.15)",
        }}
      >
        <div className="flex items-start gap-3">
          <span className="text-lg mt-0.5">📞</span>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "#5A3A2A", fontFamily: "'DM Sans', sans-serif" }}
          >
            <span className="font-semibold" style={{ color: "#2D2D2D" }}>Expect a text/call from Madison shortly.</span>
            {" "}She'll confirm your booking details and answer any questions you have.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Extras Step ──────────────────────────────────────────────────────────────

interface ExtrasStepProps {
  selectedExtras: string[];
  onToggle: (key: string) => void;
  onBack: () => void;
  onContinue: () => void;
  isSubmitting: boolean;
}

function ExtrasStep({ selectedExtras, onToggle, onBack, onContinue, isSubmitting }: ExtrasStepProps) {
  return (
    <div className="animate-fade-slide-up delay-0">
      {/* Header */}
      <div className="text-center mb-6">
        <p
          className="text-xs font-semibold tracking-widest uppercase mb-3"
          style={{ color: "#E8603C", fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.15em" }}
        >
          Optional Add-Ons
        </p>
        <h2
          className="text-2xl sm:text-3xl font-bold leading-tight mb-2"
          style={{ fontFamily: "'Playfair Display', serif", color: "#1E1E1E" }}
        >
          Any Extras?
        </h2>
        <p
          className="text-sm leading-relaxed max-w-md mx-auto"
          style={{ color: "#7A5A4A", fontFamily: "'DM Sans', sans-serif" }}
        >
          Select any additional services you'd like included. These are optional — skip if none apply.
        </p>
      </div>

      {/* Divider */}
      <div
        className="h-px w-16 mx-auto mb-6"
        style={{ background: "linear-gradient(90deg, transparent, #E8603C, transparent)" }}
      />

      {/* Extras grid */}
      <div
        className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-6 max-h-80 overflow-y-auto pr-1"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#E8603C #FFF0EC" }}
      >
        {EXTRAS_LIST.map((extra) => {
          const isSelected = selectedExtras.includes(extra.key);
          return (
            <button
              key={extra.key}
              type="button"
              onClick={() => onToggle(extra.key)}
              className="flex flex-col items-center gap-2 rounded-xl p-3 transition-all duration-150 focus:outline-none"
              style={{
                background: isSelected
                  ? "linear-gradient(135deg, #FFF0EC 0%, #FFE4DC 100%)"
                  : "#FAFAFA",
                border: isSelected
                  ? "2px solid #E8603C"
                  : "2px solid #F0E8E4",
                boxShadow: isSelected
                  ? "0 2px 10px rgba(232,96,60,0.18)"
                  : "0 1px 4px rgba(0,0,0,0.05)",
                cursor: "pointer",
              }}
            >
              <div className="w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center"
                style={{ background: "#FFF8F5" }}>
                <img
                  src={extra.icon}
                  alt={extra.label}
                  className="w-10 h-10 object-contain"
                  loading="lazy"
                />
              </div>
              <span
                className="text-center leading-tight"
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "0.65rem",
                  color: isSelected ? "#C04020" : "#5A4A44",
                  fontWeight: isSelected ? 600 : 400,
                  lineHeight: "1.2",
                }}
              >
                {extra.label}
              </span>
              {isSelected && (
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ background: "#E8603C", marginTop: "-4px" }}
                >
                  <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                    <polyline points="2 6 5 9 10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected count badge */}
      {selectedExtras.length > 0 && (
        <div className="flex items-center justify-center mb-4">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{
              background: "rgba(232,96,60,0.10)",
              color: "#C04020",
              fontFamily: "'DM Sans', sans-serif",
              border: "1px solid rgba(232,96,60,0.20)",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <polyline points="2 6 5 9 10 3" stroke="#C04020" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {selectedExtras.length} extra{selectedExtras.length !== 1 ? "s" : ""} selected
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-150"
          style={{
            background: "transparent",
            border: "2px solid #E8D0C8",
            color: "#7A5A4A",
            fontFamily: "'DM Sans', sans-serif",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={isSubmitting}
          className="flex-2 py-3 px-6 rounded-xl text-sm font-semibold transition-all duration-150"
          style={{
            background: isSubmitting
              ? "#E8A090"
              : "linear-gradient(135deg, #E8603C 0%, #D44E2A 100%)",
            color: "white",
            fontFamily: "'DM Sans', sans-serif",
            cursor: isSubmitting ? "not-allowed" : "pointer",
            boxShadow: isSubmitting ? "none" : "0 4px 14px rgba(232,96,60,0.35)",
            flex: 2,
          }}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
              Sending your request...
            </span>
          ) : selectedExtras.length > 0 ? (
            `Get My Quote with ${selectedExtras.length} Extra${selectedExtras.length !== 1 ? "s" : ""}`
          ) : (
            "Get My Instant Quote →"
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Exit-Intent Modal ────────────────────────────────────────────────────────

function ExitIntentModal({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(61,31,20,0.60)", backdropFilter: "blur(6px)" }}
      onClick={onStay}
    >
      <div
        className="relative w-full max-w-xl rounded-2xl overflow-hidden flex flex-col sm:flex-row"
        style={{
          background: "#FFFFFF",
          boxShadow: "0 32px 80px rgba(180,80,40,0.28), 0 4px 20px rgba(0,0,0,0.12)",
          minHeight: "320px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left — Madison photo panel */}
        <div
          className="relative sm:w-2/5 w-full h-48 sm:h-auto shrink-0 overflow-hidden"
          style={{ background: "#F5D5C8" }}
        >
          <img
            src={MADISON_PHOTO}
            alt="Madison"
            className="w-full h-full object-cover object-top"
          />
          {/* Name badge overlay */}
          <div
            className="absolute bottom-3 left-3 right-3 rounded-lg px-3 py-2"
            style={{ background: "rgba(255,255,255,0.88)", backdropFilter: "blur(4px)" }}
          >
            <p className="text-sm font-bold leading-tight" style={{ color: "#3D1F14", fontFamily: "'DM Sans', sans-serif" }}>Madison</p>
            <p className="text-xs" style={{ color: "#9A7060", fontFamily: "'DM Sans', sans-serif" }}>Cleaning Coordinator</p>
          </div>
        </div>

        {/* Right — text + CTAs */}
        <div className="flex flex-col justify-center px-6 py-7 sm:px-7">
          {/* Coral accent */}
          <div
            className="w-8 h-1 rounded-full mb-4"
            style={{ background: "linear-gradient(90deg, #E8603C, #F0A090)" }}
          />

          <p
            className="text-xl font-bold leading-snug mb-2"
            style={{ color: "#3D1F14", fontFamily: "'Playfair Display', serif" }}
          >
            Wait — your quote is almost ready!
          </p>
          <p
            className="text-sm leading-relaxed mb-6"
            style={{ color: "#6B4033", fontFamily: "'DM Sans', sans-serif" }}
          >
            It only takes 30 more seconds. I'll personally text you a custom price for your home — no commitment needed.
          </p>

          <button
            onClick={onStay}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white mb-3 transition-opacity hover:opacity-90"
            style={{
              background: "linear-gradient(135deg, #E8603C 0%, #D44E2A 100%)",
              boxShadow: "0 4px 14px rgba(232,96,60,0.35)",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Get My Price →
          </button>
          <button
            onClick={onLeave}
            className="w-full py-1.5 text-xs text-center transition-colors hover:opacity-60"
            style={{ color: "#9A7060", fontFamily: "'DM Sans', sans-serif" }}
          >
            No thanks, I'll pass
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

// ── UTM capture helper ───────────────────────────────────────────────────────
/** Map a referrer hostname to { source, medium } */
function inferFromReferrer(): { utmSource?: string; utmMedium?: string } {
  try {
    if (!document.referrer) return {};
    const host = new URL(document.referrer).hostname.replace(/^www\./, "");
    if (host.includes("google"))   return { utmSource: "google",    utmMedium: "organic" };
    if (host.includes("bing"))     return { utmSource: "bing",      utmMedium: "organic" };
    if (host.includes("yahoo"))    return { utmSource: "yahoo",     utmMedium: "organic" };
    if (host.includes("facebook") || host.includes("fb.com"))
                                   return { utmSource: "facebook",  utmMedium: "social" };
    if (host.includes("instagram")) return { utmSource: "instagram", utmMedium: "social" };
    if (host.includes("twitter") || host.includes("t.co") || host.includes("x.com"))
                                   return { utmSource: "twitter",   utmMedium: "social" };
    if (host.includes("tiktok"))   return { utmSource: "tiktok",    utmMedium: "social" };
    if (host.includes("linkedin")) return { utmSource: "linkedin",  utmMedium: "social" };
    if (host.includes("youtube"))  return { utmSource: "youtube",   utmMedium: "social" };
    if (host.includes("yelp"))     return { utmSource: "yelp",      utmMedium: "referral" };
    if (host.includes("nextdoor")) return { utmSource: "nextdoor",  utmMedium: "referral" };
    // Any other known referrer — mark as referral with the domain as source
    if (host) return { utmSource: host, utmMedium: "referral" };
  } catch (_) {}
  return {};
}

function captureUtms() {
  const p = new URLSearchParams(window.location.search);
  const utmSource  = p.get("utm_source")   ?? undefined;
  const utmMedium  = p.get("utm_medium")   ?? undefined;
  const utmCampaign = p.get("utm_campaign") ?? undefined;
  const utmContent = p.get("utm_content")  ?? undefined;
  const gclid      = p.get("gclid")        ?? undefined;

  // If explicit UTMs are present, use them as-is
  if (utmSource) {
    return { utmSource, utmMedium, utmCampaign, utmContent, gclid };
  }

  // gclid without utm_source → Google Ads with auto-tagging
  if (gclid) {
    return { utmSource: "google", utmMedium: "cpc", utmCampaign, utmContent, gclid };
  }

  // Fall back to referrer inference
  const inferred = inferFromReferrer();
  return {
    utmSource:  inferred.utmSource,
    utmMedium:  inferred.utmMedium,
    utmCampaign,
    utmContent,
    gclid,
  };
}

export default function QuoteForm() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [step, setStep] = useState<"form" | "extras">("form");
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [showExitModal, setShowExitModal] = useState(false);
  const exitShownRef = useRef(false);
  // Capture UTMs once on mount
  const utmsRef = useRef(captureUtms());

  const isOffice = form.serviceType === "Office Cleaning";

  // True when all three required text fields pass their validation rules
  const isFormReady =
    form.name.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) &&
    form.phone.replace(/\D/g, "").length === 10;

  // Exit-intent: fire once when mouse leaves the top of the viewport, only if not submitted
  useEffect(() => {
    const handleMouseLeave = (e: MouseEvent) => {
      if (submitted) return;
      if (exitShownRef.current) return;
      if (e.clientY <= 10) {
        exitShownRef.current = true;
        setShowExitModal(true);
      }
    };
    document.addEventListener("mouseleave", handleMouseLeave);
    return () => document.removeEventListener("mouseleave", handleMouseLeave);
  }, [submitted]);

  // Track this page visit once per browser session
  const trackPageView = trpc.leads.trackPageView.useMutation();
  useEffect(() => {
    const SK_KEY = "_lf_sk";
    let sessionKey = sessionStorage.getItem(SK_KEY);
    if (!sessionKey) {
      sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SK_KEY, sessionKey);
    }
    const sk = sessionKey;
    const utms = utmsRef.current;
    const mountedAt = Date.now();

    // Bot-filtering: only count a visit after BOTH conditions are met:
    // 1. At least 8 seconds have passed (bots load and leave instantly)
    // 2. The user has moved their mouse or touched the screen (bots never interact)
    // We also record the exact elapsed time so the server can apply its own threshold.
    let timerFired = false;
    let interacted = false;
    let fired = false;

    function maybeTrack() {
      if (fired || !timerFired || !interacted) return;
      fired = true;
      const timeOnPage = Math.round((Date.now() - mountedAt) / 1000);
      trackPageView.mutate({
        sessionKey: sk,
        utmSource: utms.utmSource,
        utmMedium: utms.utmMedium,
        utmCampaign: utms.utmCampaign,
        timeOnPage,
      });
    }

    // Raise minimum timer to 8 seconds — real humans read the form before interacting.
    // Bots that execute JS rarely wait this long.
    const timer = setTimeout(() => {
      timerFired = true;
      maybeTrack();
    }, 8000);

    function onInteract() {
      interacted = true;
      maybeTrack();
    }

    window.addEventListener("mousemove", onInteract, { once: true, passive: true });
    window.addEventListener("touchstart", onInteract, { once: true, passive: true });
    window.addEventListener("keydown",    onInteract, { once: true, passive: true });
    window.addEventListener("scroll",     onInteract, { once: true, passive: true });

    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", onInteract);
      window.removeEventListener("touchstart", onInteract);
      window.removeEventListener("keydown",    onInteract);
      window.removeEventListener("scroll",     onInteract);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitMutation = trpc.quotes.submit.useMutation({
    onSuccess: (data) => {
      setSmsSent(data.smsSent);
      setSubmitted(true);
      // Fire conversion event to Manus Analytics
      try {
        const utms = utmsRef.current;
        (window as any).umami?.track("quote_submitted", {
          source: utms.utmSource ?? "direct",
          medium: utms.utmMedium ?? "(none)",
          campaign: utms.utmCampaign ?? "(none)",
        });
      } catch (_) {}
      if (!data.smsSent) {
        toast.warning("Quote received! We'll follow up shortly.");
      }
    },
    onError: (err) => {
      toast.error(err.message || "Something went wrong. Please try again.");
    },
  });

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};
    if (!form.name.trim()) newErrors.name = "Name is required";
    if (!form.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = "Enter a valid email";
    }
    if (!form.phone.trim()) {
      newErrors.phone = "Phone number is required";
    } else if (!/^\+?[\d\s\-().]{7,}$/.test(form.phone)) {
      newErrors.phone = "Enter a valid phone number";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const formatPhoneNumber = (raw: string): string => {
    // Strip all non-digits first
    let digits = raw.replace(/\D/g, "");
    // Strip leading country code: if 11 digits starting with 1 (e.g. autofill "+1 401-688-8007" → "14016888007"), remove the leading 1
    if (digits.length === 11 && digits.startsWith("1")) {
      digits = digits.slice(1);
    }
    digits = digits.slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const handleChange = (field: keyof FormData, value: string) => {
    const formatted = field === "phone" ? formatPhoneNumber(value) : value;
    setForm((prev) => ({ ...prev, [field]: formatted }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const toggleExtra = (key: string) => {
    setSelectedExtras((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  // Step 1: validate form → advance to extras step
  const handleFormNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setStep("extras");
  };

  // Step 2: submit with extras
  const handleFinalSubmit = () => {
    const payload = {
      name: form.name,
      email: form.email,
      phone: form.phone,
      serviceType: form.serviceType,
      bedrooms: isOffice ? form.squareFootage : form.bedrooms,
      bathrooms: isOffice ? "N/A" : form.bathrooms,
      extras: selectedExtras,
      // UTM attribution
      ...utmsRef.current,
    };
    submitMutation.mutate(payload);
  };

  const isSubmitting = submitMutation.isPending;

  return (
    <div
      className="w-full min-h-screen flex flex-col items-center justify-center p-4 sm:p-8"
      style={{
        backgroundImage: `url(https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/quote-form-bg-CanHy7qWKMuuprbsFjqUZ3.webp)`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#FFF8F5",
      }}
    >
      {/* Exit-intent modal — only shown if form not submitted */}
      {showExitModal && (
        <ExitIntentModal
          onStay={() => setShowExitModal(false)}
          onLeave={() => { window.location.href = "https://maidsinblack.com"; }}
        />
      )}

      {/* Back link */}
      <div className="w-full max-w-2xl mb-3">
        <a
          href="https://maidsinblack.com"
          className="inline-flex items-center gap-1 text-xs text-white/60 hover:text-white/90 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          Back to Maidsinblack
        </a>
      </div>

      {/* Card — logo + badges integrated into header band */}
      <div
        className="w-full max-w-2xl bg-white rounded-2xl overflow-hidden"
        style={{
          boxShadow: "0 8px 40px rgba(180, 80, 40, 0.12), 0 2px 12px rgba(0,0,0,0.06)",
        }}
      >
        {/* Integrated brand + trust header band */}
        <div
          className="px-6 py-5"
          style={{ background: "linear-gradient(135deg, #FFF8F5 0%, #FFF0EC 100%)", borderBottom: "1px solid #F5D5C8" }}
        >
          {/* Logo row — wordmark only, no image with duplicate badges */}
          <div className="flex justify-center mb-4">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 32 32" className="w-8 h-8" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="10" r="6" stroke="#1E1E1E" strokeWidth="1.8" fill="none"/>
                <path d="M10 10 Q10 6 16 6 Q22 6 22 10" stroke="#1E1E1E" strokeWidth="1.8" fill="none"/>
                <path d="M8 28 C8 20 24 20 24 28" stroke="#1E1E1E" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
                <rect x="12" y="14" width="8" height="4" rx="1" stroke="#1E1E1E" strokeWidth="1.4" fill="none"/>
              </svg>
              <span className="font-bold text-xl tracking-tight" style={{ color: "#1E1E1E", fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.02em" }}>maids in black</span>
            </div>
          </div>
          {/* Trust badges row */}
          <div className="flex items-center justify-center gap-4 flex-wrap">
            {/* BBB */}
            <div className="flex items-center gap-1.5">
              <div className="rounded px-2 py-0.5 text-white text-xs font-bold" style={{ background: "#003087", fontSize: "10px" }}>BBB</div>
              <span className="text-xs font-medium" style={{ color: "#3D1F14" }}>Accredited</span>
            </div>
            {/* Divider */}
            <div className="w-px h-4" style={{ background: "#E8C8B8" }} />
            {/* Google */}
            <div className="flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span className="text-xs font-medium" style={{ color: "#3D1F14" }}>4.8 ★ (172)</span>
            </div>
            {/* Divider */}
            <div className="w-px h-4" style={{ background: "#E8C8B8" }} />
            {/* Trustpilot */}
            <div className="flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="#00B67A" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
              </svg>
              <span className="text-xs font-medium" style={{ color: "#3D1F14" }}>5.0 Trustpilot</span>
            </div>
          </div>
        </div>

        <div className="px-8 pt-8 pb-10 sm:px-10 sm:pt-10">
          {submitted ? (
            <SuccessState name={form.name} smsSent={smsSent} />
          ) : step === "extras" ? (
            <ExtrasStep
              selectedExtras={selectedExtras}
              onToggle={toggleExtra}
              onBack={() => setStep("form")}
              onContinue={handleFinalSubmit}
              isSubmitting={isSubmitting}
            />
          ) : (
            <>
              {/* Header */}
              <div className="text-center mb-8 animate-fade-slide-up delay-0">
                <p
                  className="text-xs font-semibold tracking-widest uppercase mb-3"
                  style={{ color: "#E8603C", fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.15em" }}
                >
                  Request a Quote
                </p>
                <h1
                  className="text-3xl sm:text-4xl font-bold leading-tight mb-3"
                  style={{ fontFamily: "'Playfair Display', serif", color: "#1E1E1E" }}
                >
                  {isOffice ? "Office Cleaning Quote" : "Maid Service Quote"}
                  <br />
                  <span style={{ color: "#E8603C" }}>Washington DC</span>
                </h1>
                <p
                  className="text-sm sm:text-base leading-relaxed max-w-md mx-auto"
                  style={{ color: "#7A5A4A", fontFamily: "'DM Sans', sans-serif" }}
                >
                  Serving the Entire DC Metro Area (DC/MD/VA). Fill out the form below for an instant custom quote — we'll text you right away.
                </p>
              </div>

              {/* Divider */}
              <div
                className="animate-fade-slide-up delay-1 h-px w-16 mx-auto mb-8"
                style={{ background: "linear-gradient(90deg, transparent, #E8603C, transparent)" }}
              />

              {/* Form */}
              <form onSubmit={handleFormNext} noValidate>
                {/* Row 1: Name + Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  {/* Name field with live validation */}
                  <div className="animate-fade-slide-up delay-2">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Name"
                        value={form.name}
                        onChange={(e) => handleChange("name", e.target.value)}
                        autoComplete="given-name"
                        className="quote-input"
                        style={{
                          paddingRight: "36px",
                          ...(errors.name
                            ? { borderColor: "#E8603C", boxShadow: "0 0 0 3px rgba(232,96,60,0.15)" }
                            : form.name.trim().length > 0
                            ? { borderColor: "#22C55E", boxShadow: "0 0 0 3px rgba(34,197,94,0.12)" }
                            : {}),
                        }}
                      />
                      {!errors.name && form.name.trim().length > 0 && (
                        <span
                          key={form.name.trim()}
                          className="pointer-events-none absolute right-3 top-1/2 animate-checkmark-pop"
                          aria-label="Name entered"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="8" cy="8" r="8" fill="#22C55E" />
                            <polyline points="4.5,8.5 7,11 11.5,5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                        </span>
                      )}
                    </div>
                    {errors.name && (
                      <p className="mt-1 text-xs" style={{ color: "#E8603C", fontFamily: "'DM Sans', sans-serif" }}>
                        {errors.name}
                      </p>
                    )}
                  </div>
                  {/* Email field with live validation */}
                  <div className="animate-fade-slide-up delay-2">
                    <div className="relative">
                      <input
                        type="email"
                        placeholder="Email"
                        value={form.email}
                        onChange={(e) => handleChange("email", e.target.value)}
                        autoComplete="email"
                        className="quote-input"
                        style={{
                          paddingRight: "36px",
                          ...(errors.email
                            ? { borderColor: "#E8603C", boxShadow: "0 0 0 3px rgba(232,96,60,0.15)" }
                            : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)
                            ? { borderColor: "#22C55E", boxShadow: "0 0 0 3px rgba(34,197,94,0.12)" }
                            : {}),
                        }}
                      />
                      {!errors.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && (
                        <span
                          key={form.email}
                          className="pointer-events-none absolute right-3 top-1/2 animate-checkmark-pop"
                          aria-label="Valid email"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="8" cy="8" r="8" fill="#22C55E" />
                            <polyline points="4.5,8.5 7,11 11.5,5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                        </span>
                      )}
                    </div>
                    {errors.email && (
                      <p className="mt-1 text-xs" style={{ color: "#E8603C", fontFamily: "'DM Sans', sans-serif" }}>
                        {errors.email}
                      </p>
                    )}
                  </div>
                </div>

                {/* Row 2: Phone + Service Type */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div className="animate-fade-slide-up delay-3">
                    <div className="relative">
                      <input
                        type="tel"
                        placeholder="Phone (e.g. 202-555-1234)"
                        value={form.phone}
                        onChange={(e) => handleChange("phone", e.target.value)}
                        autoComplete="tel-national"
                        className="quote-input"
                        style={{
                          paddingRight: "36px",
                          ...(errors.phone
                            ? { borderColor: "#E8603C", boxShadow: "0 0 0 3px rgba(232,96,60,0.15)" }
                            : form.phone.replace(/\D/g, "").length === 10
                            ? { borderColor: "#22C55E", boxShadow: "0 0 0 3px rgba(34,197,94,0.12)" }
                            : {}),
                        }}
                      />
                      {/* Green checkmark — appears once exactly 10 digits are entered */}
                      {!errors.phone && form.phone.replace(/\D/g, "").length === 10 && (
                        <span
                          key={form.phone}
                          className="pointer-events-none absolute right-3 top-1/2 animate-checkmark-pop"
                          aria-label="Valid phone number"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="8" cy="8" r="8" fill="#22C55E" />
                            <polyline points="4.5,8.5 7,11 11.5,5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                        </span>
                      )}
                    </div>
                    {errors.phone && (
                      <p className="mt-1 text-xs" style={{ color: "#E8603C", fontFamily: "'DM Sans', sans-serif" }}>
                        {errors.phone}
                      </p>
                    )}
                  </div>
                  <div className="animate-fade-slide-up delay-3 quote-select-wrapper">
                    <select
                      value={form.serviceType}
                      onChange={(e) => handleChange("serviceType", e.target.value)}
                      className="quote-input"
                      style={{ paddingRight: "40px" }}
                    >
                      {SERVICE_TYPES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 3: Bedrooms + Bathrooms  OR  Square Footage (for Office Cleaning) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  {isOffice ? (
                    /* Full-width square footage selector */
                    <div className="animate-fade-slide-up delay-4 quote-select-wrapper sm:col-span-2">
                      <select
                        value={form.squareFootage}
                        onChange={(e) => handleChange("squareFootage", e.target.value)}
                        className="quote-input"
                        style={{ paddingRight: "40px" }}
                      >
                        {SQFT_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <>
                      <div className="animate-fade-slide-up delay-4 quote-select-wrapper">
                        <select
                          value={form.bedrooms}
                          onChange={(e) => handleChange("bedrooms", e.target.value)}
                          className="quote-input"
                          style={{ paddingRight: "40px" }}
                        >
                          {BEDROOM_OPTIONS.map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </div>
                      <div className="animate-fade-slide-up delay-4 quote-select-wrapper">
                        <select
                          value={form.bathrooms}
                          onChange={(e) => handleChange("bathrooms", e.target.value)}
                          className="quote-input"
                          style={{ paddingRight: "40px" }}
                        >
                          {BATHROOM_OPTIONS.map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </div>

                {/* Trust Strip — rotates every 4s above the CTA */}
                <div className="animate-fade-slide-up delay-5">
                  <TrustStrip />
                </div>

                {/* CTA Button — advances to extras step */}
                <div className="animate-fade-slide-up delay-5 mb-6">
                  <button
                    type="submit"
                    className={isFormReady ? "quote-cta quote-cta-ready" : "quote-cta"}
                  >
                    Get My Instant Quote →
                  </button>
                </div>

                {/* Stars */}
                <div className="animate-fade-slide-up delay-6 mb-4">
                  <StarRating />
                </div>

                {/* Social Proof — Testimonial + Review Grid */}
                <div className="animate-fade-slide-up delay-6 mt-6 mb-2">
                  {/* Divider */}
                  <div className="h-px w-full mb-6" style={{ background: "linear-gradient(90deg, transparent, #E8D0C8, transparent)" }} />

                  {/* Scrolling Reviews Carousel — moved here for higher impact */}
                  <p className="text-center text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "#9A7060" }}>What Our Customers Say</p>
                  <div className="overflow-hidden mb-6" style={{ maskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)" }}>
                    <div
                      className="flex gap-4"
                      style={{ animation: "reviewScroll 28s linear infinite", width: "max-content" }}
                    >
                      {[
                        { avatar: "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/latoya-p-avatar-XLBYUXc3KuciStnRnix296.webp", name: "Latoya P", text: "After trying out Handybook and a few of the cleaners on Groupon, I hired MIB again after being disappointed with the caliber of other cleaning services. Pricey? Yes. ", bold: "Worth every penny? Yes." },
                        { avatar: "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/justin-c-avatar-jBUe9mH22ypGjBhpawoe4Q.webp", name: "Justin C", text: "I let Maids In Black come and do a full cleaning job on my house, and ", bold: "damn was I ever impressed with the results.", after: " I can totally see myself using them again." },
                        { avatar: "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/erin-t-avatar-7wr4kHbfK7GSQFeojTRXVV.webp", name: "Erin T", text: "This company is so awesome! I've had them clean my house at least 5 or 6 times. They've ", bold: "always been on time", after: " and will call when they're nearby." },
                        { avatar: "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/bonnie-p-avatar-HWhWZqQnnS6gGAVjrfhomP.webp", name: "Bonnie P", text: "I've been using MIB for about a year and my experience has been very similar to other reviewers'. The office ", bold: "customer service is tremendous." },
                        // duplicate set for seamless loop
                        { avatar: "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/latoya-p-avatar-XLBYUXc3KuciStnRnix296.webp", name: "Latoya P", text: "After trying out Handybook and a few of the cleaners on Groupon, I hired MIB again after being disappointed with the caliber of other cleaning services. Pricey? Yes. ", bold: "Worth every penny? Yes." },
                        { avatar: "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/justin-c-avatar-jBUe9mH22ypGjBhpawoe4Q.webp", name: "Justin C", text: "I let Maids In Black come and do a full cleaning job on my house, and ", bold: "damn was I ever impressed with the results.", after: " I can totally see myself using them again." },
                        { avatar: "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/erin-t-avatar-7wr4kHbfK7GSQFeojTRXVV.webp", name: "Erin T", text: "This company is so awesome! I've had them clean my house at least 5 or 6 times. They've ", bold: "always been on time", after: " and will call when they're nearby." },
                        { avatar: "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/bonnie-p-avatar-HWhWZqQnnS6gGAVjrfhomP.webp", name: "Bonnie P", text: "I've been using MIB for about a year and my experience has been very similar to other reviewers'. The office ", bold: "customer service is tremendous." },
                      ].map((r, i) => (
                        <div key={i} className="flex-shrink-0 rounded-xl p-4 text-left" style={{ width: "260px", background: "#FFF8F5", border: "1px solid #F0D8CC" }}>
                          <div className="flex items-center gap-2 mb-2">
                            <img src={r.avatar} alt={r.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" style={{ border: "2px solid #F0C8B8" }} />
                            <div>
                              <p className="text-xs font-bold" style={{ color: "#E8603C" }}>{r.name}</p>
                              <div className="flex gap-0.5">{[1,2,3,4,5].map(s => <span key={s} className="text-amber-400 text-xs">★</span>)}</div>
                            </div>
                          </div>
                          <p className="text-xs leading-relaxed" style={{ color: "#3A2A20" }}>&ldquo;{r.text}<strong>{r.bold}</strong>{r.after ?? ""}&rdquo;</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="h-px w-full mb-6" style={{ background: "linear-gradient(90deg, transparent, #E8D0C8, transparent)" }} />

                  {/* Review platform grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Google */}
                    <div className="rounded-xl border p-3 text-center" style={{ borderColor: "#E0E0E0" }}>
                      <div className="flex justify-center mb-1">
                        <svg viewBox="0 0 24 24" className="w-7 h-7" xmlns="http://www.w3.org/2000/svg">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                      </div>
                      <div className="flex justify-center gap-0.5 mb-1">
                        {[1,2,3,4,5].map(s => <span key={s} className="text-amber-400 text-xs">★</span>)}
                      </div>
                      <p className="text-xs font-semibold" style={{ color: "#1E1E1E" }}>4.8/5 from 172 Reviews</p>
                    </div>

                    {/* Facebook */}
                    <div className="rounded-xl border p-3 text-center" style={{ borderColor: "#E0E0E0" }}>
                      <div className="flex justify-center mb-1">
                        <svg viewBox="0 0 24 24" className="w-7 h-7" fill="#1877F2" xmlns="http://www.w3.org/2000/svg">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                        </svg>
                      </div>
                      <div className="flex justify-center gap-0.5 mb-1">
                        {[1,2,3,4,5].map(s => <span key={s} className="text-blue-500 text-xs">★</span>)}
                      </div>
                      <p className="text-xs font-semibold" style={{ color: "#1E1E1E" }}>28 Five Star Reviews</p>
                    </div>

                    {/* Angi */}
                    <div className="rounded-xl border p-3 text-center" style={{ borderColor: "#E0E0E0" }}>
                      <div className="flex justify-center mb-1">
                        <span className="font-bold text-lg" style={{ color: "#FF6153", fontFamily: "Georgia, serif", fontStyle: "italic" }}>Angi</span>
                      </div>
                      <div className="flex justify-center gap-0.5 mb-1">
                        {[1,2,3,4,5].map(s => <span key={s} className="text-amber-400 text-xs">★</span>)}
                      </div>
                      <p className="text-xs font-semibold" style={{ color: "#1E1E1E" }}>23 Five Star Reviews</p>
                    </div>

                    {/* Yelp */}
                    <div className="rounded-xl border p-3 text-center" style={{ borderColor: "#E0E0E0" }}>
                      <div className="flex justify-center mb-1">
                        <span className="font-bold text-lg" style={{ color: "#D32323" }}>yelp<span style={{ color: "#D32323" }}>✱</span></span>
                      </div>
                      <div className="flex justify-center gap-0.5 mb-1">
                        {[1,2,3,4,5].map(s => <span key={s} className="text-amber-400 text-xs">★</span>)}
                      </div>
                      <p className="text-xs font-semibold" style={{ color: "#1E1E1E" }}>20 Five Star Reviews</p>
                    </div>
                  </div>
                </div>

              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
