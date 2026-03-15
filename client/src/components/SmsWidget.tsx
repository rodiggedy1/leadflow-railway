/**
 * SmsWidget — floating SMS chat widget for Maids in Black.
 *
 * Behaviour:
 * - A floating button sits in the bottom-right corner at all times.
 * - The panel auto-opens after 10 seconds (once per session).
 * - Clicking the button toggles the panel open/closed.
 * - On submit: creates a lead, texts admin + lead, shows success state.
 */
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, X, MessageCircle, CheckCircle2 } from "lucide-react";

// ── Phone formatter ────────────────────────────────────────────────────────────
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// ── UTM capture (same helper as QuoteForm) ─────────────────────────────────────
function captureUtms() {
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get("utm_source") ?? undefined,
    utmMedium: params.get("utm_medium") ?? undefined,
    utmCampaign: params.get("utm_campaign") ?? undefined,
    utmContent: params.get("utm_content") ?? undefined,
    gclid: params.get("gclid") ?? undefined,
  };
}

// ── Current time label ─────────────────────────────────────────────────────────
function timeLabel() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function SmsWidget() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTime] = useState(timeLabel);
  const autoOpened = useRef(false);

  // Auto-open after 10 seconds (once per session)
  useEffect(() => {
    const already = sessionStorage.getItem("mib_widget_opened");
    if (already) return;
    const timer = setTimeout(() => {
      if (!autoOpened.current) {
        autoOpened.current = true;
        setOpen(true);
        sessionStorage.setItem("mib_widget_opened", "1");
      }
    }, 10_000);
    return () => clearTimeout(timer);
  }, []);

  const submitMutation = trpc.quotes.submitWidgetLead.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) => setError(err.message ?? "Something went wrong. Please try again."),
  });

  function handleToggle() {
    setOpen((v) => !v);
    if (!sessionStorage.getItem("mib_widget_opened")) {
      sessionStorage.setItem("mib_widget_opened", "1");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!consent) {
      setError("Please check the consent box to continue.");
      return;
    }
    const utms = captureUtms();
    submitMutation.mutate({ name: name.trim(), phone, ...utms });
  }

  const firstName = name.trim().split(" ")[0] || "there";
  const isLoading = submitMutation.isPending;

  return (
    <>
      {/* ── Floating panel ───────────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed bottom-24 right-4 z-50 w-[340px] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          style={{ maxHeight: "calc(100vh - 120px)" }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4 py-3"
            style={{ background: "linear-gradient(135deg, #E8735A 0%, #C9563D 100%)" }}
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg"
                style={{ background: "rgba(255,255,255,0.25)" }}
              >
                M
              </div>
              <span
                className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white"
                style={{ background: "#22C55E" }}
              />
            </div>
            {/* Title */}
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-tight">Maids in Black</p>
              <p className="text-white/80 text-xs">We'll text you immediately!</p>
            </div>
            {/* Close */}
            <button
              onClick={() => setOpen(false)}
              className="text-white/80 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
              aria-label="Close widget"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="bg-white flex-1 overflow-y-auto">
            {!submitted ? (
              <div className="p-4 flex flex-col gap-4">
                {/* Welcome bubble */}
                <div className="flex flex-col gap-1">
                  <div
                    className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 max-w-[90%]"
                    style={{ background: "#F3F4F6" }}
                  >
                    👋 Hi! Drop your name and number below and we'll text you right away with availability and pricing.
                  </div>
                  <span className="text-xs text-gray-400 pl-1">{sentTime}</span>
                </div>

                {/* Response time badge */}
                <div className="flex items-center gap-1.5 text-xs text-gray-500 justify-end">
                  <span className="text-green-500">⏱</span>
                  Average response time: <span className="text-green-600 font-semibold">&lt;1 min</span>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                  <input
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#E8735A] focus:ring-2 focus:ring-[#E8735A]/20 transition-all placeholder:text-gray-400"
                  />
                  <input
                    type="tel"
                    placeholder="Phone number"
                    value={phone}
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                    required
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#E8735A] focus:ring-2 focus:ring-[#E8735A]/20 transition-all placeholder:text-gray-400"
                  />

                  {/* Consent */}
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-0.5 flex-shrink-0 accent-[#E8735A]"
                    />
                    <span className="text-[11px] text-gray-500 leading-relaxed">
                      I consent to receive SMS messages from Maids in Black at the number provided about cleaning services, estimates, scheduling, and follow-ups. Message frequency varies. Std message &amp; data rates may apply. Reply STOP to opt out.
                    </span>
                  </label>

                  {error && (
                    <p className="text-xs text-red-500 text-center">{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading || !name.trim() || phone.replace(/\D/g, "").length < 10}
                    className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(135deg, #E8735A 0%, #C9563D 100%)" }}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Sending…
                      </>
                    ) : (
                      "Text Me Now →"
                    )}
                  </button>
                </form>
              </div>
            ) : (
              /* ── Success state ─────────────────────────────────────────── */
              <div className="p-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <div
                    className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 max-w-[90%]"
                    style={{ background: "#F3F4F6" }}
                  >
                    <div className="flex items-start gap-2">
                      <CheckCircle2 size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
                      <span>
                        Thank you, <strong>{firstName}</strong>! 🎉 Check your phone — we just texted you. We'll be in touch shortly!
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 pl-1">{timeLabel()}</span>
                </div>
                <p className="text-xs text-gray-400 text-center">
                  Didn't get a text? Make sure your number is correct or call us directly.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-white border-t border-gray-100 py-2 text-center">
            <span className="text-[10px] text-gray-400">Powered by Maids in Black LeadFlow</span>
          </div>
        </div>
      )}

      {/* ── Floating trigger button ───────────────────────────────────────────── */}
      <button
        onClick={handleToggle}
        aria-label={open ? "Close chat widget" : "Chat with us"}
        className="fixed bottom-4 right-4 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        style={{ background: "linear-gradient(135deg, #E8735A 0%, #C9563D 100%)" }}
      >
        {open ? (
          <X size={22} className="text-white" />
        ) : (
          <MessageCircle size={22} className="text-white" />
        )}
        {/* Pulse ring when closed */}
        {!open && (
          <span
            className="absolute inset-0 rounded-full animate-ping opacity-30"
            style={{ background: "#E8735A" }}
          />
        )}
      </button>
    </>
  );
}
