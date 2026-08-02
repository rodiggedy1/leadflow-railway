/**
 * WelcomePage — personalized customer welcome page
 * Route: /welcome/:firstName?beds=2&baths=1&type=Standard&price=239&extras=oven,fridge
 */

import { useParams, useSearch } from "wouter";
import { useEffect, useRef, useState } from "react";
import { Phone, MessageSquare, Star, ShieldCheck, Sparkles, MapPin, Calendar, Mail, CheckCircle, Clock } from "lucide-react";
import { EXTRAS_LIST } from "../../../shared/extras";

const EMBER = "#E8651A";
const TEAM_PHOTO = "https://d36hbw14aib5lz.cloudfront.net/310519663254023424/EYDicEiNHjWxiyMLLXmwJP/mib-team-photo_eac8c843.webp?Expires=1785647257&Signature=cTXwptAvTQIV~m~jpe9szBLJO5xymCtNz6-M-P8J4Oa1av22GE-rGb9KGBq0GsoI1iOXM23y~Hdmb4600TmxM9wRwqqVECZ8aculsYh7bKt6RaZs5LTAy3g~DYphsObNzBCj~Lg5V8g3T6AzsF0RluOYtcdWUsVrBBTZG3BdxLShABcLdCvkAZZw1Pnuor6JlPomNrl7c7B~jS5ZKy4nxSY~xMpeCAVE2Ln4Hp5ZDWos2t9Z6-YxiUuGi2XGcFdn5WP1cX89oA8UgOtZgo1yv69-YyduUtzrodWdv7bHgK82OyRILAqHnbhERYs9OIe3X5Cas9SrDoWgSk6RJIyr0w__&Key-Pair-Id=K1MP89RTKNH4J";
const WISTIA_ID = "bzlt49ipk1";

// ── Scroll-reveal hook ──
function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, style: { opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(22px)", transition: "opacity 0.55s ease, transform 0.55s ease" } };
}

function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const { ref, style } = useFadeIn();
  return <div ref={ref} style={{ ...style, transitionDelay: `${delay}ms` }}>{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: EMBER }} className="text-xs tracking-[0.3em] uppercase font-sans font-medium mb-4">
      {children}
    </p>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex gap-4 p-4 rounded-xl border" style={{ backgroundColor: "#141414", borderColor: "rgba(255,255,255,0.1)" }}>
      <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(232,101,26,0.15)" }}>
        <span style={{ color: EMBER }}>{icon}</span>
      </div>
      <div>
        <p className="font-sans font-semibold text-white text-sm mb-1">{title}</p>
        <p className="font-sans text-white/60 text-xs leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function StepItem({ num, icon, title, desc }: { num: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <FadeIn delay={parseInt(num) * 80}>
      <div className="flex gap-4 mb-8">
        <div className="shrink-0 flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-full flex items-center justify-center border" style={{ borderColor: "rgba(255,255,255,0.15)", backgroundColor: "#141414" }}>
            <span style={{ color: EMBER }}>{icon}</span>
          </div>
          <span className="font-sans text-xs font-bold" style={{ color: "rgba(232,101,26,0.5)" }}>{num}</span>
        </div>
        <div className="pt-1">
          <p className="font-sans font-semibold text-white text-sm mb-1">{title}</p>
          <p className="font-sans text-white/60 text-xs leading-relaxed">{desc}</p>
        </div>
      </div>
    </FadeIn>
  );
}

export default function WelcomePage() {
  const { firstName = "there" } = useParams<{ firstName: string }>();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const beds = params.get("beds");
  const baths = params.get("baths");
  const serviceType = params.get("type");
  const price = params.get("price");
  const finalPriceParam = params.get("finalPrice");
  const discountParam = params.get("discount");
  const notesParam = params.get("notes");
  const extrasRaw = params.get("extras");
  const extraKeys = extrasRaw ? extrasRaw.split(",").filter(Boolean) : [];
  // Map raw keys to human-readable labels
  const extras = extraKeys.map(key => {
    const found = EXTRAS_LIST.find(e => e.key === key);
    return found ? found.label : key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  });
  const displayPrice = finalPriceParam ?? price;
  const discount = discountParam ? Number(discountParam) : 0;

  const displayName = decodeURIComponent(firstName);
  const hasQuote = !!(beds || baths || price);

  return (
    <div className="min-h-screen font-sans" style={{ backgroundColor: "#010202", color: "#f1eeeb" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Montserrat:wght@300;400;500;600;700&display=swap');
        .font-serif-display { font-family: 'Playfair Display', serif; }
        .font-sans { font-family: 'Montserrat', sans-serif; }
      `}</style>

      {/* ── Hero: Wistia video centered with black bars + text overlay ── */}
      <section className="relative w-full bg-black">
        <div className="relative mx-auto" style={{ maxWidth: "1100px" }}>
          <div style={{ position: "relative", paddingTop: "56.25%" }}>
            <script src={`https://fast.wistia.com/embed/medias/${WISTIA_ID}.jsonp`} async />
            <script src="https://fast.wistia.com/assets/external/E-v1.js" async />
            <div
              className={`wistia_embed wistia_async_${WISTIA_ID} videoFoam=true`}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
            />
          </div>
          <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: "50%", background: "linear-gradient(rgba(0,0,0,0) 0%, rgba(10,10,10,0.85) 80%, rgb(10,10,10) 100%)" }} />
          <div className="absolute bottom-0 left-0 right-0 z-20 text-center pb-4 md:pb-6 px-4" style={{ bottom: "0" }}>
            <p className="font-sans text-xs tracking-[0.3em] uppercase font-medium mb-1 md:mb-2" style={{ color: EMBER }}>Professional Cleaning</p>
            <h1 className="font-serif-display text-4xl md:text-5xl font-bold text-white mb-1">Maids in Black</h1>
            <p className="font-sans text-xs md:text-sm text-white/60 tracking-wide">
              Prepared for <span className="text-white font-semibold">{displayName}</span>
            </p>
          </div>
        </div>
        <div style={{ height: "40px", background: "linear-gradient(rgb(10,10,10) 0%, rgb(1,2,2) 100%)" }} />
      </section>

      {/* ── Dashed divider ── */}
      <div className="mx-auto" style={{ maxWidth: "1100px", borderTop: "1px dashed rgba(232,101,26,0.4)" }} />

      {/* ── Main content ── */}
      <div className="max-w-2xl mx-auto px-4 py-10 flex flex-col gap-10">

        {/* ── Stats row ── */}
        <FadeIn>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { value: "500+", label: "Homes Cleaned" },
              { value: "5.0 ★", label: "Average Rating" },
              { value: "DC's #1", label: "Rated Service" },
            ].map(({ value, label }) => (
              <div key={label} className="rounded-xl py-4 px-2 border" style={{ backgroundColor: "#141414", borderColor: "rgba(255,255,255,0.08)" }}>
                <p className="font-serif-display text-xl font-bold" style={{ color: EMBER }}>{value}</p>
                <p className="font-sans text-white/50 text-xs mt-1">{label}</p>
              </div>
            ))}
          </div>
        </FadeIn>

        {/* ── Hello card ── */}
        <FadeIn delay={60}>
          <div className="rounded-2xl px-6 md:px-8 py-8 text-center border" style={{ backgroundColor: "#141414", borderColor: "rgba(255,255,255,0.1)" }}>
            <span className="font-sans text-sm font-semibold tracking-[0.15em] uppercase block mb-3" style={{ color: EMBER }}>
              Hello, {displayName} 👋
            </span>
            <h2 className="font-serif-display text-2xl md:text-3xl font-bold text-white mb-3">
              We're excited to take care of your home
            </h2>
            <p className="font-sans text-white/60 text-sm leading-relaxed">
              Maids in Black delivers a premium, stress-free cleaning experience — so you can come home to a spotless space without lifting a finger.
            </p>
          </div>
        </FadeIn>

        {/* ── Quote details card ── */}
        {hasQuote && (
          <FadeIn delay={80}>
            <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: "#141414", borderColor: "rgba(232,101,26,0.3)" }}>
              {/* Header band */}
              <div className="px-7 pt-8 pb-6">
                <p className="font-sans text-xs tracking-[0.25em] uppercase font-semibold mb-3" style={{ color: EMBER }}>Your Custom Quote</p>
                <h2 className="font-serif-display text-2xl md:text-3xl font-bold text-white leading-snug">
                  Hi {displayName},<br />
                  <span className="text-white/70 font-normal text-xl md:text-2xl">here's what we put together for you.</span>
                </h2>
              </div>

              {/* Divider */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }} />

              {/* Line items */}
              <div className="px-7 py-6 flex flex-col gap-4">
                {beds && baths && (
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-white/50 text-sm tracking-wide">🏠 Property</span>
                    <span className="font-sans text-white font-semibold text-sm">{beds} bed / {baths} bath{serviceType ? ` — ${decodeURIComponent(serviceType).replace(" Cleaning", "")}` : ""}</span>
                  </div>
                )}
                {extras.length > 0 && (
                  <div className="flex items-start justify-between gap-6">
                    <span className="font-sans text-white/50 text-sm tracking-wide shrink-0">🧹 Extras</span>
                    <span className="font-sans text-white/80 text-sm text-right">{extras.join(", ")}</span>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-sm tracking-wide" style={{ color: "#4ade80" }}>🎁 Special discount for {displayName}</span>
                    <span className="font-sans text-sm font-semibold" style={{ color: "#4ade80" }}>-${discount}</span>
                  </div>
                )}
                {notesParam && (
                  <div className="flex items-start gap-3 pt-1">
                    <span className="font-sans text-white/40 text-xs italic leading-relaxed">{decodeURIComponent(notesParam)}</span>
                  </div>
                )}
              </div>

              {/* Total band */}
              {displayPrice && (
                <div className="px-7 py-5 flex items-center justify-between" style={{ backgroundColor: "rgba(232,101,26,0.08)", borderTop: "1px solid rgba(232,101,26,0.2)" }}>
                  <span className="font-sans text-white/60 text-sm tracking-widest uppercase">Total</span>
                  <span className="font-serif-display text-3xl font-bold" style={{ color: EMBER }}>${displayPrice}</span>
                </div>
              )}

              {/* CTA */}
              <div className="px-7 pb-7 pt-5">
                <a
                  href="sms:2028885362"
                  className="w-full flex items-center justify-center gap-2 font-sans font-bold text-sm px-5 py-4 rounded-2xl text-white transition-all active:scale-95"
                  style={{ backgroundColor: EMBER }}
                >
                  <MessageSquare className="w-4 h-4" /> Text Us to Lock In This Price
                </a>
                <p className="font-sans text-white/25 text-xs mt-3 text-center">* Final price confirmed at booking.</p>
              </div>
            </div>
          </FadeIn>
        )}

        {/* ── Team photo ── */}
        <FadeIn>
          <div className="relative overflow-hidden rounded-2xl" style={{ minHeight: "180px" }}>
            <img
              src={TEAM_PHOTO}
              alt="Maids in Black team member"
              className="w-full block"
              style={{ objectFit: "cover", objectPosition: "center top", width: "100%", display: "block" }}
            />
            <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(rgba(0,0,0,0) 50%, rgb(10,10,10) 100%)" }} />
            <div className="absolute bottom-0 left-0 right-0 p-5">
              <p className="font-serif-display text-white font-semibold text-lg">Real people. Real results.</p>
              <p className="font-sans text-white/60 text-xs mt-1">Your Maids in Black team, ready to work.</p>
            </div>
          </div>
        </FadeIn>

        {/* ── Real customer review ── */}
        <FadeIn>
          <div className="rounded-2xl px-6 md:px-8 py-7 border relative overflow-hidden" style={{ backgroundColor: "#141414", borderColor: "rgba(255,255,255,0.1)" }}>
            <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-10 blur-2xl" style={{ backgroundColor: EMBER, transform: "translate(30%, -30%)" }} />
            <div className="flex gap-1 mb-3">
              {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-current" style={{ color: EMBER }} />)}
            </div>
            <p className="font-serif-display text-white text-base leading-relaxed mb-4 italic">
              "I've tried a few cleaning services in DC and Maids in Black is on another level. They were on time, thorough, and my apartment looked brand new. The live tracking was a game changer — I knew exactly when they were coming."
            </p>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center font-sans font-bold text-xs text-white" style={{ backgroundColor: EMBER }}>S</div>
              <div>
                <p className="font-sans text-white font-semibold text-sm">Sarah M.</p>
                <p className="font-sans text-white/40 text-xs">Capitol Hill, DC · Verified Customer</p>
              </div>
            </div>
          </div>
        </FadeIn>

        {/* ── What Happens Next ── */}
        <FadeIn>
          <div className="rounded-2xl px-6 md:px-8 py-8 border" style={{ backgroundColor: "#141414", borderColor: "rgba(255,255,255,0.1)" }}>
            <Label>What Happens Next</Label>
            <h2 className="font-serif-display text-2xl md:text-3xl font-bold text-white mb-8">
              Your Journey to Clean
            </h2>
            <div className="flex flex-col">
              <StepItem num="01" icon={<Calendar className="w-4 h-4" />} title="Book Your Service" desc="Just give us your name, phone, and email — we handle everything else. No lengthy forms, no back-and-forth. We'll confirm your date and get a card on file to secure your spot." />
              <StepItem num="02" icon={<Mail className="w-4 h-4" />} title="Confirmation Email" desc="Once you're booked, you'll receive a confirmation email with all the details — date, time window, and what to expect. Everything in one place so there are no surprises." />
              <StepItem num="03" icon={<MapPin className="w-4 h-4" />} title="Live Tracking on the Day" desc="On the morning of your service, we'll send you a link so you can follow your team in real time — see when they're on the way, get live ETAs, and know the exact moment they arrive." />
              <StepItem num="04" icon={<CheckCircle className="w-4 h-4" />} title="Team Arrives & Does a Great Job" desc="Your Maids in Black team shows up on time, fully equipped, and ready to work. We treat your home with care and attention to detail — leaving every room spotless from top to bottom." />
              <StepItem num="05" icon={<Clock className="w-4 h-4" />} title="7 Days a Week Customer Support" desc="We're available 7 days a week — so whenever you need us, we're here. Whether you have a question before your service, need a touch-up after, or just want to rebook, reach us any day of the week." />
            </div>
          </div>
        </FadeIn>

        {/* ── Why Choose Us ── */}
        <FadeIn>
          <div>
            <Label>Why Choose Us</Label>
            <h2 className="font-serif-display text-2xl md:text-3xl font-bold text-white mb-2">
              Why folks love us, {displayName}
            </h2>
            <p className="font-sans text-white/60 text-sm mb-6">Here's what our clients say keeps them coming back.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FeatureCard icon={<Star className="w-4 h-4" />} title="Top-Rated Service" desc="Consistently 5-star reviews from clients across the DC area." />
              <FeatureCard icon={<ShieldCheck className="w-4 h-4" />} title="Vetted & Insured" desc="Every cleaner is background-checked and fully insured for your peace of mind." />
              <FeatureCard icon={<Sparkles className="w-4 h-4" />} title="Premium Products" desc="We use professional-grade, eco-friendly cleaning products — safe for kids and pets." />
              <FeatureCard icon={<MapPin className="w-4 h-4" />} title="Live Tracking" desc="Know exactly when your cleaner is on the way with our real-time tracking link." />
            </div>
          </div>
        </FadeIn>

        {/* ── CTA ── */}
        <FadeIn>
          <div className="rounded-2xl px-6 md:px-8 py-10 text-center border" style={{ backgroundColor: "#141414", borderColor: "rgba(255,255,255,0.1)" }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "rgba(232,101,26,0.15)" }}>
              <Phone className="w-5 h-5" style={{ color: EMBER }} />
            </div>
            <h2 className="font-serif-display text-2xl md:text-3xl font-bold text-white mb-2">
              Ready to get scheduled, {displayName}?
            </h2>
            <p className="font-sans text-white/60 text-sm mb-1">
              All we need is your <strong className="text-white">name, phone, and email</strong> — and we'll take care of the rest.
            </p>
            <p className="font-sans text-sm font-semibold mb-6" style={{ color: EMBER }}>
              No forms to fill out. No stress.
            </p>
            <p className="font-sans text-white/40 text-xs uppercase tracking-[0.2em] mb-4">Reach us directly</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a href="tel:2028885362" className="flex items-center justify-center gap-2 font-sans font-semibold text-sm px-6 py-3 rounded-xl text-white transition-all active:scale-95" style={{ backgroundColor: EMBER }}>
                <Phone className="w-4 h-4" /> Call Us
              </a>
              <a href="sms:2028885362" className="flex items-center justify-center gap-2 font-sans font-semibold text-sm px-6 py-3 rounded-xl text-white transition-all active:scale-95" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
                <MessageSquare className="w-4 h-4" /> Text Us
              </a>
            </div>
            <p className="font-sans text-white/40 text-sm mt-4">(202) 888-5362</p>
          </div>
        </FadeIn>

      </div>

      {/* ── Footer ── */}
      <footer className="text-center py-10 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: "rgba(232,101,26,0.15)" }}>
          <Sparkles className="w-5 h-5" style={{ color: EMBER }} />
        </div>
        <p className="font-serif-display text-white font-bold text-xl">Maids in Black</p>
        <p className="font-sans text-white/40 text-xs uppercase tracking-[0.2em] mt-1">Professional Cleaning Services · DC Area</p>
        <p className="font-sans text-white/30 text-xs mt-3">(202) 888-5362 · Available 7 Days a Week</p>
      </footer>
    </div>
  );
}
