/**
 * WelcomePage — personalized customer welcome page
 * Route: /welcome/:firstName?beds=2&baths=1&type=Standard&price=239&extras=oven,fridge
 *
 * Exact design match to maidsquote-eydicein.manus.space/welcome/:firstName
 * with an added quote details card showing price and service info.
 *
 * Fonts: Playfair Display + Montserrat (loaded in index.html)
 * Accent: #E8651A (ember orange)
 * Background: #010202
 */

import { useParams, useSearch } from "wouter";
import { Phone, MessageSquare, Star, ShieldCheck, Sparkles, MapPin, Calendar, Mail, CheckCircle, Clock, Users } from "lucide-react";

const EMBER = "#E8651A";
const TEAM_PHOTO = "/manus-storage/mib-team-photo_5222cdf7.webp";
const WISTIA_ID = "bzlt49ipk1";

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
    <div className="flex gap-4">
      <div className="shrink-0 flex flex-col items-center gap-2">
        <div className="w-10 h-10 rounded-full flex items-center justify-center border" style={{ borderColor: "rgba(255,255,255,0.15)", backgroundColor: "#141414" }}>
          <span style={{ color: EMBER }}>{icon}</span>
        </div>
        <span className="font-sans text-xs font-bold" style={{ color: "rgba(232,101,26,0.5)" }}>{num}</span>
      </div>
      <div className="pb-8">
        <p className="font-sans font-semibold text-white text-sm mb-1">{title}</p>
        <p className="font-sans text-white/60 text-xs leading-relaxed">{desc}</p>
      </div>
    </div>
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
  const extrasRaw = params.get("extras");
  const extras = extrasRaw ? extrasRaw.split(",").filter(Boolean) : [];

  const displayName = decodeURIComponent(firstName);
  const upperName = displayName.toUpperCase();
  const hasQuote = !!(beds || baths || price);

  return (
    <div className="min-h-screen font-sans" style={{ backgroundColor: "#010202", color: "#f1eeeb" }}>
      {/* Inject fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Montserrat:wght@300;400;500;600;700&display=swap');
        .font-serif-display { font-family: 'Playfair Display', serif; }
        .font-sans { font-family: 'Montserrat', sans-serif; }
      `}</style>

      {/* ── Hero: Wistia video background ── */}
      <section className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: "16/9", maxHeight: "520px" }}>
        {/* Wistia embed */}
        <div className="absolute inset-0 w-full h-full">
          <script src={`https://fast.wistia.com/embed/medias/${WISTIA_ID}.jsonp`} async />
          <script src="https://fast.wistia.com/assets/external/E-v1.js" async />
          <div
            className="wistia_embed wistia_async_bzlt49ipk1 videoFoam=true autoPlay=true muted=true loop=true controlsVisibleOnLoad=false playButton=false"
            style={{ height: "100%", width: "100%", position: "absolute", inset: 0 }}
          />
        </div>

        {/* Gradient overlays */}
        <div className="absolute inset-0 pointer-events-none z-10" style={{ background: "linear-gradient(rgba(10,10,10,0.45) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 55%, rgba(10,10,10,0.85) 85%, rgb(10,10,10) 100%)" }} />
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(rgba(0,0,0,0) 50%, rgb(10,10,10) 100%)" }} />

        {/* Hero text overlay */}
        <div className="absolute bottom-0 left-0 right-0 z-20 text-center pb-8 px-4">
          <p className="font-sans text-xs tracking-[0.3em] uppercase font-medium mb-2" style={{ color: EMBER }}>Professional Cleaning</p>
          <h1 className="font-serif-display text-4xl md:text-5xl font-bold text-white mb-2">Maids in Black</h1>
          <p className="font-sans text-sm text-white/60 tracking-wide">
            Prepared for <span className="text-white font-semibold">{displayName}</span>
          </p>
        </div>
      </section>

      {/* ── Dashed divider ── */}
      <div className="w-full" style={{ borderTop: "1px dashed rgba(232,101,26,0.4)" }} />

      {/* ── Main content ── */}
      <div className="max-w-2xl mx-auto px-4 py-10 flex flex-col gap-10">

        {/* ── Hello card ── */}
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

        {/* ── Quote details card (only shown when price params present) ── */}
        {hasQuote && (
          <div className="rounded-2xl px-6 md:px-8 py-8 border" style={{ backgroundColor: "#141414", borderColor: `rgba(232,101,26,0.3)` }}>
            <Label>Your Quote</Label>
            <div className="flex flex-col gap-3">
              {beds && baths && (
                <div className="flex items-center justify-between">
                  <span className="font-sans text-white/60 text-sm">Property</span>
                  <span className="font-sans text-white font-semibold text-sm">{beds} bed / {baths} bath</span>
                </div>
              )}
              {serviceType && (
                <div className="flex items-center justify-between">
                  <span className="font-sans text-white/60 text-sm">Service type</span>
                  <span className="font-sans text-white font-semibold text-sm">{decodeURIComponent(serviceType)}</span>
                </div>
              )}
              {extras.length > 0 && (
                <div className="flex items-start justify-between gap-4">
                  <span className="font-sans text-white/60 text-sm shrink-0">Extras</span>
                  <span className="font-sans text-white font-semibold text-sm text-right">{extras.map(e => e.replace(/-/g, " ")).join(", ")}</span>
                </div>
              )}
              {price && (
                <>
                  <div className="border-t my-1" style={{ borderColor: "rgba(255,255,255,0.1)" }} />
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-white/60 text-sm">Estimated total</span>
                    <span className="font-serif-display text-2xl font-bold" style={{ color: EMBER }}>${price}</span>
                  </div>
                </>
              )}
            </div>
            <p className="font-sans text-white/40 text-xs mt-4">
              * Final price confirmed at booking. Ready to lock in your spot? Call or text us below.
            </p>
          </div>
        )}

        {/* ── Team photo ── */}
        <div className="relative overflow-hidden rounded-2xl">
          <img
            src={TEAM_PHOTO}
            alt="Maids in Black team member"
            className="w-full object-cover"
            style={{ maxHeight: "400px" }}
          />
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(rgba(0,0,0,0) 50%, rgb(10,10,10) 100%)" }} />
          <div className="absolute bottom-0 left-0 right-0 p-5">
            <p className="font-serif-display text-white font-semibold text-lg">Real people. Real results.</p>
            <p className="font-sans text-white/60 text-xs mt-1">Your Maids in Black team, ready to work.</p>
          </div>
        </div>

        {/* ── Why Choose Us ── */}
        <div>
          <Label>Why Choose Us</Label>
          <h2 className="font-serif-display text-2xl md:text-3xl font-bold text-white mb-2">
            Why folks love us, {displayName}
          </h2>
          <p className="font-sans text-white/60 text-sm mb-6">Here's what our clients say keeps them coming back.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FeatureCard
              icon={<Star className="w-4 h-4" />}
              title="Top-Rated Service"
              desc="Consistently 5-star reviews from clients across the DC area."
            />
            <FeatureCard
              icon={<ShieldCheck className="w-4 h-4" />}
              title="Vetted & Insured"
              desc="Every cleaner is background-checked and fully insured for your peace of mind."
            />
            <FeatureCard
              icon={<Sparkles className="w-4 h-4" />}
              title="Premium Products"
              desc="We use professional-grade, eco-friendly cleaning products — safe for kids and pets."
            />
            <FeatureCard
              icon={<MapPin className="w-4 h-4" />}
              title="Live Tracking"
              desc="Know exactly when your cleaner is on the way with our real-time tracking link."
            />
          </div>
        </div>

        {/* ── What Happens Next ── */}
        <div className="rounded-2xl px-6 md:px-8 py-8 border" style={{ backgroundColor: "#141414", borderColor: "rgba(255,255,255,0.1)" }}>
          <Label>What Happens Next</Label>
          <h2 className="font-serif-display text-2xl md:text-3xl font-bold text-white mb-8">
            Your Journey to Clean
          </h2>
          <div className="flex flex-col">
            <StepItem
              num="01"
              icon={<Calendar className="w-4 h-4" />}
              title="Book Your Service"
              desc="Just give us your name, phone, and email — we handle everything else. No lengthy forms, no back-and-forth. We'll confirm your date and get a card on file to secure your spot."
            />
            <StepItem
              num="02"
              icon={<Mail className="w-4 h-4" />}
              title="Confirmation Email"
              desc="Once you're booked, you'll receive a confirmation email with all the details — date, time window, and what to expect. Everything in one place so there are no surprises."
            />
            <StepItem
              num="03"
              icon={<MapPin className="w-4 h-4" />}
              title="Live Tracking on the Day"
              desc="On the morning of your service, we'll send you a link so you can follow your team in real time — see when they're on the way, get live ETAs, and know the exact moment they arrive."
            />
            <StepItem
              num="04"
              icon={<CheckCircle className="w-4 h-4" />}
              title="Team Arrives & Does a Great Job"
              desc="Your Maids in Black team shows up on time, fully equipped, and ready to work. We treat your home with care and attention to detail — leaving every room spotless from top to bottom."
            />
            <StepItem
              num="05"
              icon={<Clock className="w-4 h-4" />}
              title="7 Days a Week Customer Support"
              desc="We're available 7 days a week — so whenever you need us, we're here. Whether you have a question before your service, need a touch-up after, or just want to rebook, reach us any day of the week."
            />
          </div>
        </div>

        {/* ── CTA ── */}
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
            <a
              href="tel:2028885362"
              className="flex items-center justify-center gap-2 font-sans font-semibold text-sm px-6 py-3 rounded-xl text-white transition-all active:scale-95"
              style={{ backgroundColor: EMBER }}
            >
              <Phone className="w-4 h-4" /> Call Us
            </a>
            <a
              href="sms:2028885362"
              className="flex items-center justify-center gap-2 font-sans font-semibold text-sm px-6 py-3 rounded-xl text-white transition-all active:scale-95"
              style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
            >
              <MessageSquare className="w-4 h-4" /> Text Us
            </a>
          </div>
          <p className="font-sans text-white/40 text-sm mt-4">(202) 888-5362</p>
        </div>

      </div>

      {/* ── Footer ── */}
      <footer className="text-center py-8 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <p className="font-serif-display text-white font-semibold text-lg">Maids in Black</p>
        <p className="font-sans text-white/40 text-xs uppercase tracking-[0.2em] mt-1">Professional Cleaning Services</p>
      </footer>
    </div>
  );
}
