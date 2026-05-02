/**
 * Apply — Public-facing multi-step cleaner application form
 * Steps: Welcome → Basic Info → Requirements → Specialties → Photo → Video → Thank You
 * World-class design: clean white layout, green accent, soft shadows, MIB brand feel.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Home,
  User,
  CheckSquare,
  Grid,
  Camera,
  Video,
  MapPin,
  Mail,
  Phone,
  ChevronRight,
  CloudUpload,
  Sparkles,
  CheckCircle2,
  PhoneCall,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = "welcome" | "basic-info" | "requirements" | "specialties" | "bio" | "video" | "done";

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  streetAddress: string;
  apt: string;
  city: string;
  state: string;
  zip: string;
  hasCleaning: boolean | null;
  hasBankAccount: boolean | null;
  isAuthorized: boolean | null;
  consentBackground: boolean | null;
  experience: string;
  specialties: string[];
  bioPhoto: File | null;
  videoFile: File | null;
}

const STEPS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: "welcome", label: "Welcome", icon: <Home size={16} /> },
  { id: "basic-info", label: "Basic Info", icon: <User size={16} /> },
  { id: "requirements", label: "Requirements", icon: <CheckSquare size={16} /> },
  { id: "specialties", label: "Specialties", icon: <Grid size={16} /> },
  { id: "bio", label: "Photo", icon: <Camera size={16} /> },
  { id: "video", label: "Video", icon: <Video size={16} /> },
  { id: "done", label: "address", icon: <MapPin size={16} /> },
];

const STEP_ORDER: Step[] = ["welcome", "basic-info", "requirements", "specialties", "bio", "video", "done"];

const SPECIALTIES = [
  "Pro Residential Cleaning",
  "Commercial Cleaning",
  "Hotel Cleaning",
  "Move in/Move Out",
  "Office Cleaning",
  "Post Construction",
  "Window Cleaning",
  "Airbnb Cleaning",
  "Eco-Friendly Cleaning",
  "Medical Facility Cleaning",
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const GREEN = "#16a34a";
const GREEN_LIGHT = "#f0fdf4";
const GREEN_MID = "#dcfce7";
const ACCENT = "#2563eb";

function stepIndex(step: Step) {
  return STEP_ORDER.indexOf(step);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function YesNoField({
  question,
  value,
  onChange,
}: {
  question: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="mb-6">
      <p className="text-sm font-medium text-gray-700 mb-2">{question}</p>
      <div className="grid grid-cols-2 gap-3">
        {[true, false].map(opt => (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            className="h-14 rounded-xl border text-sm font-semibold transition-all"
            style={
              value === opt
                ? { borderColor: GREEN, backgroundColor: GREEN_LIGHT, color: GREEN }
                : { borderColor: "#e5e7eb", backgroundColor: "#fff", color: "#111827" }
            }
          >
            {opt ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </div>
  );
}

function InputField({
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  icon,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>
        )}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full h-12 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
          style={{ paddingLeft: icon ? 36 : 14, paddingRight: 14 }}
        />
      </div>
    </div>
  );
}

// ── Step screens ───────────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const DARK_BG = "#0a0f1e";
  const DARK_CARD = "#0f1e3a";
  const DARK_CARD_INNER = "#162240";
  const DARK_BORDER = "rgba(255,255,255,0.08)";
  const RIGHT_BG = "#0d1e3b";
  const RIGHT_BORDER = "rgba(99,179,237,0.12)";  // subtle blue tint
  const BRAND_GREEN = GREEN;

  return (
    <div
      className="w-full flex flex-col"
      style={{ backgroundColor: DARK_BG, minHeight: "100vh" }}
    >
      {/* ── Top bar ── */}
      <style>{`
        @keyframes blink-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .blink-dot { animation: blink-dot 1.4s ease-in-out infinite; }
      `}</style>
      <header
        className="flex items-center justify-between px-4 sm:px-8 shrink-0"
        style={{
          height: 60,
          backgroundColor: "#0e1628",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        {/* Left: logo + brand */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-white text-xs tracking-tight shrink-0"
            style={{ backgroundColor: BRAND_GREEN, boxShadow: `0 0 12px rgba(22,163,74,0.5)` }}
          >
            MIB
          </div>
          <div className="flex flex-col leading-none min-w-0">
            <span className="text-white text-sm font-bold tracking-wide truncate">Maids in Black</span>
            <span className="hidden sm:block text-gray-500 text-xs mt-0.5">Washington DC · MD · VA</span>
          </div>
        </div>

        {/* Center: now hiring pill — hidden on small screens */}
        <div
          className="hidden sm:flex items-center gap-2 px-4 py-1.5 rounded-full"
          style={{ backgroundColor: "rgba(22,163,74,0.12)", border: "1px solid rgba(22,163,74,0.25)" }}
        >
          <span
            className="blink-dot w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: BRAND_GREEN, boxShadow: `0 0 6px ${BRAND_GREEN}` }}
          />
          <span className="text-xs font-bold tracking-widest uppercase" style={{ color: BRAND_GREEN }}>Now Hiring</span>
        </div>

        {/* Right: positions available — hidden on small screens */}
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-gray-500">Positions available:</span>
          <span className="text-xs font-bold text-white">DC · MD · VA</span>
        </div>

        {/* Mobile-only compact badge */}
        <div
          className="flex sm:hidden items-center gap-1.5 px-3 py-1 rounded-full shrink-0"
          style={{ backgroundColor: "rgba(22,163,74,0.12)", border: "1px solid rgba(22,163,74,0.25)" }}
        >
          <span
            className="blink-dot w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: BRAND_GREEN }}
          />
          <span className="text-xs font-bold" style={{ color: BRAND_GREEN }}>Now Hiring</span>
        </div>
      </header>

      {/* ── Two-column body — fills remaining viewport height ── */}
      <div
        className="flex-1 flex flex-col lg:flex-row mx-auto w-full"
        style={{ maxWidth: "1200px", minHeight: "calc(100vh - 56px)" }}
      >
        {/* ── LEFT: video + copy ── */}
        <div
          className="flex-1 flex flex-col justify-center px-6 py-6 lg:px-10"
        >
          {/* Wistia video — large, dominant */}
          <div
            className="rounded-2xl overflow-hidden w-full"
            style={{
              aspectRatio: "16/9",
              boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
              marginBottom: "24px",
            }}
          >
            <style>{`wistia-player[media-id='hwmi77abbz']:not(:defined){background:center/contain no-repeat url('https://fast.wistia.com/embed/medias/hwmi77abbz/swatch');display:block;filter:blur(5px);padding-top:56.25%;}`}</style>
            {/* @ts-ignore */}
            <wistia-player
              media-id="hwmi77abbz"
              seo="false"
              aspect="1.7777777777777777"
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          </div>

          {/* Mobile-only CTA — right under the video so users don't have to scroll */}
          <button
            onClick={onNext}
            className="lg:hidden w-full flex items-center justify-center gap-2 rounded-xl text-white font-bold text-base transition-all active:scale-[0.98] mb-5"
            style={{
              backgroundColor: BRAND_GREEN,
              height: 52,
              boxShadow: `0 4px 20px rgba(22,163,74,0.4)`,
            }}
          >
            Get Started
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </button>

          {/* Hiring badge */}
          <div className="flex items-center gap-2 mb-3">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: BRAND_GREEN }}
            />
            <span className="text-xs font-bold tracking-widest text-gray-400 uppercase">Now Hiring · DC · MD · VA</span>
          </div>

          {/* Headline — display-size, always visible */}
          <h1 className="font-black text-white leading-none mb-3" style={{ fontSize: "clamp(2.8rem, 5.5vw, 5rem)", letterSpacing: "-0.02em" }}>
            Earn{" "}
            <span style={{ color: BRAND_GREEN }}>$22–$40/hr.</span>
            <br />
            Join the Elite.
          </h1>
          <p className="text-gray-400 leading-relaxed" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1rem)", maxWidth: "520px" }}>
            DC's highest-rated cleaning company. Work on your terms.<br />
            Get paid every week.
          </p>

          {/* Perks row */}
          <div className="flex flex-wrap gap-3 mt-6">
            {[
              { emoji: "💰", label: "Weekly Pay" },
              { emoji: "📅", label: "Flexible Schedule" },
              { emoji: "🌟", label: "Premium Clients" },
            ].map(p => (
              <div
                key={p.label}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-gray-300"
                style={{ backgroundColor: DARK_CARD_INNER, border: `1px solid ${RIGHT_BORDER}` }}
              >
                <span>{p.emoji}</span>
                <span>{p.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT: AI badge + CTA card ── */}
        <div
          className="w-full lg:w-[460px] xl:w-[480px] shrink-0 flex flex-col justify-start px-8 lg:px-10"
          style={{ borderLeft: `1px solid ${RIGHT_BORDER}`, backgroundColor: RIGHT_BG, paddingTop: "24px", paddingBottom: "24px", backgroundImage: "radial-gradient(ellipse at 80% 0%, rgba(37,99,235,0.08) 0%, transparent 60%)" }}
        >
          {/* AI Interview badge */}
          <div
            className="rounded-2xl p-5 mb-6 flex items-center gap-3"
            style={{ backgroundColor: DARK_CARD_INNER, border: `1px solid ${RIGHT_BORDER}` }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: "rgba(22,163,74,0.15)", border: `1px solid rgba(22,163,74,0.3)` }}
            >
              <span className="text-xl">🎤</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: BRAND_GREEN }}
                />
                <span className="text-sm font-bold text-white">AI Interview Included</span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                Apply now → Interview with Taylor (AI) · Takes ~5 min · Works on any phone
              </p>
            </div>
            <span
              className="text-xs font-bold px-2.5 py-1.5 rounded-lg shrink-0"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              FREE
            </span>
          </div>

          {/* Step label */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold tracking-widest" style={{ color: BRAND_GREEN }}>STEP 1 OF 3</span>
              <span className="text-xs text-gray-500">·</span>
              <span className="text-xs font-bold tracking-widest text-gray-500">CONTACT &amp; INFO</span>
            </div>
            <div className="h-0.5 rounded-full w-full" style={{ backgroundColor: DARK_BORDER }}>
              <div className="h-full rounded-full w-1/3" style={{ backgroundColor: BRAND_GREEN }} />
            </div>
          </div>

          {/* Card */}
          <div
            className="rounded-2xl p-7"
            style={{
              backgroundColor: DARK_CARD,
              border: `1px solid ${RIGHT_BORDER}`,
              boxShadow: "0 12px 48px rgba(0,0,0,0.7), inset 0 1px 0 rgba(99,179,237,0.08)",
              backgroundImage: "radial-gradient(ellipse at 50% 0%, rgba(37,99,235,0.05) 0%, transparent 70%)",
            }}
          >
            <h2 className="text-2xl font-extrabold text-white mb-1" style={{ letterSpacing: "-0.02em" }}>Join the area's top cleaning team.</h2>
            <p className="text-sm mb-5 leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>
              Takes about 4 minutes.
            </p>

            {/* What to expect */}
            <div className="flex flex-col gap-3 mb-7">
              {[
                { icon: "✅", text: "Basic contact info" },
                { icon: "📋", text: "Work requirements" },
                { icon: "🎤", text: "Quick AI interview" },
              ].map(item => (
                <div key={item.text} className="flex items-center gap-3">
                  <span className="text-base leading-none">{item.icon}</span>
                  <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>{item.text}</span>
                </div>
              ))}
            </div>

            {/* Earnings callout */}
            <div className="rounded-xl px-4 py-3 mb-5" style={{ background: "rgba(255,255,255,0.08)" }}>
              <p className="text-sm font-semibold text-white">Cleaners in your city earn over <span className="font-extrabold">$1,000/week</span></p>
            </div>

            {/* CTA */}
            <button
              onClick={onNext}
              className="w-full flex items-center justify-center gap-2 rounded-xl text-white font-bold text-base transition-all active:scale-[0.98]"
              style={{ backgroundColor: BRAND_GREEN, height: 54, boxShadow: `0 0 0 0 rgba(22,163,74,0), 0 6px 20px rgba(22,163,74,0.45)` }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#15803d"; e.currentTarget.style.boxShadow = "0 0 0 4px rgba(22,163,74,0.2), 0 6px 20px rgba(22,163,74,0.5)"; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = BRAND_GREEN; e.currentTarget.style.boxShadow = "0 0 0 0 rgba(22,163,74,0), 0 6px 20px rgba(22,163,74,0.45)"; }}
            >
              Get Started
              <ChevronRight size={18} />
            </button>

            <p className="text-center text-xs mt-3" style={{ color: "rgba(255,255,255,0.3)" }}>Free · No commitment · Takes 5–10 min</p>
          </div>
        </div>
      </div>

      {/* ── BELOW FOLD SECTIONS ── */}
      <div style={{ backgroundColor: DARK_BG }}>

        {/* Stats bar */}
        <div style={{ borderTop: `1px solid ${DARK_BORDER}`, borderBottom: `1px solid ${DARK_BORDER}` }}>
          <div className="mx-auto grid grid-cols-2 lg:grid-cols-4" style={{ maxWidth: "1200px" }}>
            {[
              { value: "$22–$40", label: "PER HOUR" },
              { value: "Flexible", label: "SCHEDULE" },
              { value: "1 Week", label: "TO FIRST JOB" },
              { value: "100%", label: "TIPS KEPT" },
            ].map((s, i) => (
              <div
                key={s.label}
                className="flex flex-col px-8 py-7"
                style={{ borderRight: i < 3 ? `1px solid ${DARK_BORDER}` : "none" }}
              >
                <span className="text-white font-black text-2xl" style={{ letterSpacing: "-0.02em" }}>{s.value}</span>
                <span className="text-xs font-bold tracking-widest mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Benefits grid */}
        <div className="mx-auto px-6 lg:px-10 py-20" style={{ maxWidth: "1200px" }}>
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-black text-white mb-3" style={{ letterSpacing: "-0.02em" }}>Why cleaners choose Maids in Black</h2>
            <p style={{ color: "rgba(255,255,255,0.45)" }} className="text-base">DC's highest-paying cleaning company — because we hire the best.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: "💰", title: "Weekly Pay + 100% Tips", desc: "Get paid every Friday. Keep every dollar your clients tip." },
              { icon: "📅", title: "Flexible Schedule", desc: "Full-time or part-time. You pick your days and hours." },
              { icon: "🚀", title: "Career Growth", desc: "Advance from cleaner to team lead. We promote from within." },
              { icon: "🛡️", title: "Fully Insured", desc: "You're covered on every job. Peace of mind guaranteed." },
              { icon: "🏆", title: "Top-Rated Company", desc: "Work for DC's highest-rated cleaning company. Our reputation means better clients, better tips, and steady work year-round." },
              { icon: "⭐", title: "Elite Team", desc: "Join the highest-rated cleaning team in DC, MD & VA." },
            ].map(b => (
              <div
                key={b.title}
                className="rounded-2xl p-6"
                style={{ backgroundColor: "#0d1829", border: `1px solid ${DARK_BORDER}` }}
              >
                <span className="text-2xl mb-4 block">{b.icon}</span>
                <h3 className="text-white font-bold text-base mb-2">{b.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>{b.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Testimonials */}
        <div style={{ borderTop: `1px solid ${DARK_BORDER}` }}>
          <div className="mx-auto px-6 lg:px-10 py-20" style={{ maxWidth: "1200px" }}>
            <div className="text-center mb-12">
              <div className="flex items-center justify-center gap-1 mb-3">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} width="18" height="18" viewBox="0 0 18 18" fill="#16a34a"><path d="M9 1l2.39 4.84L17 6.76l-4 3.9.94 5.5L9 13.77l-4.94 2.39.94-5.5-4-3.9 5.61-.92z"/></svg>
                ))}
              </div>
              <p className="text-sm font-bold tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>What our cleaners say</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {[
                {
                  img: "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/A06747B3-2B59-4267-8357-C332DA7A7571_cd71156d.webp",
                  quote: "I've been with Maids in Black for 2 years. The pay is consistent, clients are respectful, and I set my own hours around my kids' schedule.",
                  name: "Maria T.",
                  role: "Cleaner · DC · 2 years",
                },
                {
                  img: "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/C8318EE9-85A1-41E5-810D-2DFA74C8C778_b5d06308.webp",
                  quote: "I was skeptical about the AI interview but it took literally 5 minutes from my phone. Had my first job within a week. Best decision I made.",
                  name: "Jennifer S.",
                  role: "Cleaner · Maryland · 1 year",
                },
                {
                  img: "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/IMG_05-04-2025-17-15-05_92176c9c.webp",
                  quote: "The tips alone make this worth it. Clients are premium — they actually appreciate the work. I keep every dollar and get paid every Friday.",
                  name: "Aisha K.",
                  role: "Team Lead · Virginia · 3 years",
                },
              ].map(t => (
                <div
                  key={t.name}
                  className="relative rounded-2xl overflow-hidden"
                  style={{ aspectRatio: "3/4", border: `1px solid ${DARK_BORDER}` }}
                >
                  {/* Photo fills the full card */}
                  <img
                    src={t.img}
                    alt={t.name}
                    className="absolute inset-0 w-full h-full object-cover object-top"
                  />
                  {/* Dark gradient overlay at bottom */}
                  <div
                    className="absolute inset-0"
                    style={{ background: "linear-gradient(to top, rgba(5,10,20,0.95) 0%, rgba(5,10,20,0.6) 45%, transparent 75%)" }}
                  />
                  {/* Quote + name pinned to bottom */}
                  <div className="absolute bottom-0 left-0 right-0 p-6">
                    <div className="flex gap-0.5 mb-3">
                      {[...Array(5)].map((_, i) => (
                        <svg key={i} width="13" height="13" viewBox="0 0 18 18" fill="#16a34a"><path d="M9 1l2.39 4.84L17 6.76l-4 3.9.94 5.5L9 13.77l-4.94 2.39.94-5.5-4-3.9 5.61-.92z"/></svg>
                      ))}
                    </div>
                    <p className="text-sm leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.85)" }}>
                      &ldquo;{t.quote}&rdquo;
                    </p>
                    <div>
                      <p className="text-sm font-bold text-white">{t.name}</p>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>{t.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* FAQ */}
        <FaqSection darkBg={DARK_BG} darkBorder={DARK_BORDER} />

        {/* Final CTA */}
        <div
          className="py-20 px-6 text-center"
          style={{ borderTop: `1px solid ${DARK_BORDER}` }}
        >
          <h2 className="text-3xl lg:text-4xl font-black text-white mb-3" style={{ letterSpacing: "-0.02em" }}>Ready to join the team?</h2>
          <p className="mb-8 text-base" style={{ color: "rgba(255,255,255,0.45)" }}>Takes 5–10 minutes. Start earning within a week.</p>
          <button
            onClick={onNext}
            className="inline-flex items-center gap-2 rounded-xl text-white font-bold text-base px-10 transition-all active:scale-[0.98]"
            style={{ backgroundColor: BRAND_GREEN, height: 56, boxShadow: "0 6px 24px rgba(22,163,74,0.45)" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#15803d")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = BRAND_GREEN)}
          >
            Apply Now
            <ChevronRight size={20} />
          </button>
          <p className="text-xs mt-4" style={{ color: "rgba(255,255,255,0.25)" }}>Free · No commitment · Positions in DC · MD · VA</p>
        </div>

      </div>
    </div>
  );
}

function FaqSection({ darkBg, darkBorder }: { darkBg: string; darkBorder: string }) {
  const [open, setOpen] = React.useState<number | null>(null);
  const faqs = [
    { q: "Do I need my own car?", a: "A car is preferred but not required. Many of our jobs are accessible by public transit across DC, MD, and VA. Having a car does open up more job opportunities and higher-paying routes." },
    { q: "What does the AI interview involve?", a: "It's a 5-minute phone call with Taylor, our AI interviewer. Taylor will ask a few basic questions about your experience and availability. You can do it from any phone, right now." },
    { q: "How quickly will I hear back?", a: "Most applicants receive a decision within 24–48 hours. If selected, you can be on your first job within 1 week of completing onboarding." },
    { q: "Do I need to bring my own supplies?", a: "Yes. Cleaners are expected to bring their own professional cleaning supplies and equipment to each job. This ensures you use products you trust and are comfortable with." },
    { q: "What's the pay like?", a: "Cleaners earn $22–$40/hr depending on job type and experience. You keep 100% of your tips. Pay is deposited every Friday." },
    { q: "Can I set my own schedule?", a: "Yes. You choose which days and hours you work. Full-time and part-time positions are available. Minimum commitment is 2 days per week." },
  ];
  return (
    <div style={{ borderTop: `1px solid ${darkBorder}` }}>
      <div className="mx-auto px-6 lg:px-10 py-20" style={{ maxWidth: "800px" }}>
        <h2 className="text-3xl lg:text-4xl font-black text-white text-center mb-12" style={{ letterSpacing: "-0.02em" }}>Common questions</h2>
        <div className="flex flex-col">
          {faqs.map((faq, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${darkBorder}` }}>
              <button
                className="w-full flex items-center justify-between py-5 text-left"
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span className="text-base font-semibold text-white pr-4">{faq.q}</span>
                <span
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-transform"
                  style={{ color: "rgba(255,255,255,0.4)", transform: open === i ? "rotate(45deg)" : "none", transition: "transform 0.2s" }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                </span>
              </button>
              {open === i && (
                <p className="pb-5 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{faq.a}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BasicInfoStep({
  data,
  onChange,
  onNext,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  onNext: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const formatPhone = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0,3)}-${digits.slice(3)}`;
    return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!data.firstName.trim()) e.firstName = "First name is required";
    if (!data.lastName.trim()) e.lastName = "Last name is required";
    if (!data.phone.trim()) e.phone = "Phone number is required";
    return e;
  };

  const handleContinue = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length === 0) onNext();
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Tell us about yourself</h2>
      <p className="text-sm text-gray-400 mb-8">Basic contact and address information</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <InputField
            label="First Name *"
            placeholder="Enter your first name"
            value={data.firstName}
            onChange={v => { onChange({ firstName: v }); setErrors(p => ({ ...p, firstName: "" })); }}
          />
          {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>}
        </div>
        <div>
          <InputField
            label="Last Name *"
            placeholder="Enter your last name"
            value={data.lastName}
            onChange={v => { onChange({ lastName: v }); setErrors(p => ({ ...p, lastName: "" })); }}
          />
          {errors.lastName && <p className="text-xs text-red-500 mt-1">{errors.lastName}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <InputField
          label="Email Address"
          placeholder="Enter your email"
          type="email"
          value={data.email}
          onChange={v => onChange({ email: v })}
          icon={<Mail size={15} />}
        />
        <div>
          <InputField
            label="Phone Number *"
            placeholder="302-123-4567"
            type="tel"
            value={data.phone}
            onChange={v => { onChange({ phone: formatPhone(v) }); setErrors(p => ({ ...p, phone: "" })); }}
            icon={<Phone size={15} />}
          />
          {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
        </div>
      </div>

      <div className="mb-1">
        <h3 className="text-base font-bold text-gray-900 mb-4">Address</h3>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-4 mb-4">
          <InputField
            label="Street Address"
            placeholder="123 Main St"
            value={data.streetAddress}
            onChange={v => onChange({ streetAddress: v })}
          />
          <InputField
            label="Apt/Suite"
            placeholder="Apt 4B"
            value={data.apt}
            onChange={v => onChange({ apt: v })}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <InputField
            label="City"
            placeholder="Phoenix"
            value={data.city}
            onChange={v => onChange({ city: v })}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">State/Province</label>
            <select
              value={data.state}
              onChange={e => onChange({ state: e.target.value })}
              className="w-full h-12 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 outline-none px-3 transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Select</option>
              {US_STATES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <InputField
            label="ZIP/Postal Code"
            placeholder="e.g., 85001"
            value={data.zip}
            onChange={v => onChange({ zip: v })}
          />
        </div>
      </div>

      <div className="flex justify-end mt-8">
        <button
          onClick={handleContinue}
          className="w-full sm:w-auto flex items-center justify-center gap-2 h-12 px-7 rounded-2xl text-white font-semibold text-sm transition-all hover:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          Continue <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function RequirementsStep({
  data,
  onChange,
  onNext,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  onNext: () => void;
}) {
  const [showError, setShowError] = useState(false);

  const answeredCount = [data.hasCleaning, data.hasBankAccount, data.isAuthorized, data.consentBackground]
    .filter(v => v !== null).length;

  const handleContinue = () => {
    if (answeredCount < 1) {
      setShowError(true);
      return;
    }
    setShowError(false);
    onNext();
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Requirements</h2>
      <p className="text-sm text-gray-400 mb-8">Please answer all questions honestly</p>

      <YesNoField
        question="Do you have professional cleaning experience?"
        value={data.hasCleaning}
        onChange={v => { onChange({ hasCleaning: v }); setShowError(false); }}
      />
      <YesNoField
        question="Do you have a bank account for direct deposit?"
        value={data.hasBankAccount}
        onChange={v => { onChange({ hasBankAccount: v }); setShowError(false); }}
      />
      <YesNoField
        question="Are you legally authorized to work in the United States?"
        value={data.isAuthorized}
        onChange={v => { onChange({ isAuthorized: v }); setShowError(false); }}
      />
      <YesNoField
        question="Do you consent to a background check?"
        value={data.consentBackground}
        onChange={v => { onChange({ consentBackground: v }); setShowError(false); }}
      />

      {showError && (
        <div className="mb-4 p-3 rounded-xl text-sm text-red-700 bg-red-50 border border-red-200">
          Please answer at least one question before continuing.
        </div>
      )}

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tell us about your professional cleaning experience
        </label>
        <textarea
          rows={4}
          placeholder="Describe your experience, types of properties cleaned, years of experience..."
          value={data.experience}
          onChange={e => onChange({ experience: e.target.value })}
          className="w-full rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 p-3 outline-none resize-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div className="flex justify-end mt-8">
        <button
          onClick={handleContinue}
          className="w-full sm:w-auto flex items-center justify-center gap-2 h-12 px-7 rounded-2xl text-white font-semibold text-sm transition-all hover:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          Continue <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function SpecialtiesStep({
  data,
  onChange,
  onNext,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  onNext: () => void;
}) {
  const toggle = (s: string) => {
    const next = data.specialties.includes(s)
      ? data.specialties.filter(x => x !== s)
      : [...data.specialties, s];
    onChange({ specialties: next });
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Specialties</h2>
      <p className="text-sm text-gray-400 mb-2">Select all that apply</p>

      {/* Selection counter */}
      <div className="flex items-center gap-2 mb-6">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
            style={{
              backgroundColor: data.specialties.length > i ? GREEN : "#e5e7eb",
              color: data.specialties.length > i ? "#fff" : "#9ca3af",
            }}
          >
            {i + 1}
          </div>
        ))}
        <span className="text-sm text-gray-400">{data.specialties.length}/3+ selected</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        {SPECIALTIES.map(s => {
          const selected = data.specialties.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className="h-14 rounded-xl border text-sm font-medium text-left px-4 transition-all"
              style={
                selected
                  ? { borderColor: GREEN, backgroundColor: GREEN_LIGHT, color: GREEN, fontWeight: 600 }
                  : { borderColor: "#e5e7eb", backgroundColor: "#fff", color: "#111827" }
              }
            >
              {s}
            </button>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="w-full sm:w-auto flex items-center justify-center gap-2 h-12 px-7 rounded-2xl text-white font-semibold text-sm transition-all hover:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          Continue <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function BioStep({
  data,
  onChange,
  onNext,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  onNext: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFile = (file: File) => {
    onChange({ bioPhoto: file });
    const reader = new FileReader();
    reader.onload = e => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Your Photo</h2>
      <p className="text-sm text-gray-400 mb-8">Upload a professional photo — this helps clients connect with you</p>

      <div className="flex flex-col items-center mb-8">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative rounded-full flex items-center justify-center transition-all hover:opacity-90 group"
          style={{
            width: 200,
            height: 200,
            border: `2px dashed ${preview ? GREEN : "#d1d5db"}`,
            backgroundColor: preview ? "transparent" : "#f9fafb",
            overflow: "hidden",
          }}
        >
          {preview ? (
            <img src={preview} alt="Bio" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <CloudUpload size={36} color="#9ca3af" />
              <span className="text-sm text-gray-400 font-medium">Click to upload</span>
              <span className="text-xs text-gray-300">JPG, PNG up to 10MB</span>
            </div>
          )}
          {preview && (
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-white text-sm font-medium">Change photo</span>
            </div>
          )}
        </button>

        {preview && (
          <p className="mt-3 text-sm font-medium" style={{ color: GREEN }}>
            ✓ Photo uploaded
          </p>
        )}
      </div>

      <div
        className="rounded-2xl p-4 mb-8 flex gap-3"
        style={{ backgroundColor: GREEN_LIGHT, border: `1px solid ${GREEN_MID}` }}
      >
        <Sparkles size={18} color={GREEN} className="shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-gray-800 mb-1">Tips for a great photo</p>
          <ul className="text-xs text-gray-500 space-y-1">
            <li>• Use good lighting — natural light works best</li>
            <li>• Wear professional attire (uniform if you have one)</li>
            <li>• Smile and look directly at the camera</li>
          </ul>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="w-full sm:w-auto flex items-center justify-center gap-2 h-12 px-7 rounded-2xl text-white font-semibold text-sm transition-all hover:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          Continue <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

type RecordState = "idle" | "countdown" | "recording" | "preview" | "uploading";

function VideoStep({
  onSubmit,
  onSkip,
  isSubmitting,
}: {
  onSubmit: (videoUrl?: string) => void;
  onSkip: () => void;
  isSubmitting: boolean;
}) {
  const [recState, setRecState] = useState<RecordState>("idle");
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0); // seconds recorded
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null); // local blob URL for preview
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null); // S3 URL after upload

  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const playbackVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const MAX_SECONDS = 120;

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopStream();
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  async function startCountdown() {
    setUploadError(null);
    setRecordedUrl(null);
    setUploadedUrl(null);
    setElapsed(0);
    setCountdown(3);
    setRecState("countdown");

    // Request camera+mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        liveVideoRef.current.muted = true;
        liveVideoRef.current.play().catch(() => {});
      }
    } catch {
      setUploadError("Camera/microphone access denied. Please allow permissions and try again.");
      setRecState("idle");
      return;
    }

    let c = 3;
    const cdTimer = setInterval(() => {
      c -= 1;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(cdTimer);
        beginRecording();
      }
    }, 1000);
  }

  function beginRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "";
    const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = handleRecordingStop;
    recorder.start(250);
    recorderRef.current = recorder;
    setRecState("recording");
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(prev => {
        if (prev + 1 >= MAX_SECONDS) {
          stopRecording();
          return prev + 1;
        }
        return prev + 1;
      });
    }, 1000);
  }

  function stopRecording() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    recorderRef.current?.stop();
  }

  function handleRecordingStop() {
    stopStream();
    const blob = new Blob(chunksRef.current, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    setRecordedUrl(url);
    setRecState("preview");
    if (playbackVideoRef.current) {
      playbackVideoRef.current.src = url;
    }
  }

  function reRecord() {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
    setUploadedUrl(null);
    setElapsed(0);
    setRecState("idle");
  }

  async function handleSubmitWithVideo() {
    if (!recordedUrl) { onSubmit(undefined); return; }
    setUploadError(null);
    setRecState("uploading");
    try {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const res = await fetch("/api/upload/video", {
        method: "POST",
        headers: { "Content-Type": "video/webm" },
        body: blob,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      setUploadedUrl(url);
      onSubmit(url);
    } catch (err: any) {
      setUploadError(err.message || "Upload failed. Please try again.");
      setRecState("preview");
    }
  }

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const remaining = MAX_SECONDS - elapsed;

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Video Interview</h2>
      <p className="text-sm text-gray-400 mb-6">Answer the question below on camera — up to 2 minutes</p>

      {/* Question card */}
      <div
        className="rounded-2xl p-5 mb-5"
        style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
          >
            <Sparkles size={18} color="#fff" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Interview Question</p>
            <p className="text-xs text-gray-400">Take up to 2 minutes to answer</p>
          </div>
        </div>
        <div className="border-l-4 pl-4" style={{ borderColor: "#7c3aed" }}>
          <p className="text-sm font-semibold text-gray-800 leading-relaxed">
            Tell us why you want to work as a professional cleaner and what makes you stand out from other applicants.
          </p>
        </div>
      </div>

      {/* Camera / playback area */}
      <div
        className="relative rounded-2xl overflow-hidden mb-4"
        style={{
          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
          aspectRatio: "16/9",
        }}
      >
        {/* Live preview (idle / countdown / recording) */}
        <video
          ref={liveVideoRef}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ display: recState === "preview" || recState === "uploading" ? "none" : "block" }}
          playsInline
          muted
        />

        {/* Playback */}
        <video
          ref={playbackVideoRef}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ display: recState === "preview" || recState === "uploading" ? "block" : "none" }}
          controls
          playsInline
        />

        {/* Idle overlay */}
        {recState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-3"
              style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
            >
              <Camera size={28} color="rgba(255,255,255,0.7)" />
            </div>
            <p className="text-white text-sm font-semibold">Ready to record?</p>
            <p className="text-white/50 text-xs mt-1">Your camera will activate when you click Start</p>
          </div>
        )}

        {/* Countdown overlay */}
        {recState === "countdown" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
            <p className="text-white/70 text-sm mb-2 font-medium">Recording in…</p>
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
            >
              <span className="text-white text-4xl font-bold">{countdown}</span>
            </div>
          </div>
        )}

        {/* Recording HUD */}
        {recState === "recording" && (
          <>
            <div
              className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ backgroundColor: "rgba(220,38,38,0.85)" }}
            >
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-white text-xs font-semibold">REC</span>
            </div>
            <div
              className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
            >
              <span className="text-white text-xs font-semibold">{fmtTime(remaining)} left</span>
            </div>
          </>
        )}

        {/* Uploading overlay */}
        {recState === "uploading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <Loader2 size={36} color="#fff" className="animate-spin mb-3" />
            <p className="text-white text-sm font-semibold">Uploading your video…</p>
          </div>
        )}
      </div>

      {/* Error */}
      {uploadError && (
        <div className="mb-4 p-3 rounded-xl text-sm text-red-700 bg-red-50 border border-red-200">{uploadError}</div>
      )}

      {/* Controls */}
      <div className="flex flex-col gap-3 mb-6">
        {(recState === "idle") && (
          <button
            onClick={startCountdown}
            className="w-full h-12 rounded-2xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
          >
            <Camera size={16} /> Start Recording
          </button>
        )}
        {recState === "recording" && (
          <button
            onClick={stopRecording}
            className="w-full h-12 rounded-2xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90"
            style={{ backgroundColor: "#dc2626" }}
          >
            <span className="w-3 h-3 rounded bg-white" /> Stop Recording
          </button>
        )}
        {recState === "preview" && (
          <button
            onClick={reRecord}
            className="w-full h-12 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90"
            style={{ border: "1.5px solid #e5e7eb", backgroundColor: "#fff", color: "#374151" }}
          >
            <Video size={16} /> Re-record
          </button>
        )}
        <p className="text-center text-xs text-gray-400">Ensure your camera and microphone permissions are enabled</p>
      </div>

      {/* Submit row */}
      <div className="flex justify-between items-center">
        <button
          onClick={handleSubmitWithVideo}
          disabled={isSubmitting || recState === "uploading" || recState === "recording" || recState === "countdown"}
          className="flex items-center gap-2 h-12 px-7 rounded-2xl text-white font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: ACCENT }}
        >
          {(isSubmitting || recState === "uploading") ? (
            <><Loader2 size={16} className="animate-spin" /> Submitting…</>
          ) : (
            <>Submit Application <ChevronRight size={16} /></>
          )}
        </button>
        <button
          onClick={() => onSubmit(undefined)}
          disabled={isSubmitting || recState === "uploading"}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
        >
          Skip video
        </button>
      </div>
    </div>
  );
}

function ThankYouStep({ candidateId }: { candidateId: number | null }) {
  // In preview mode (?step=done with no real candidateId), use a placeholder so the page renders fully
  const isPreview = !candidateId && new URLSearchParams(window.location.search).get("step") === "done";
  const interviewUrl = candidateId ? `/interview/${candidateId}` : (isPreview ? "#" : null);

  const questions = [
    "Tell us about your cleaning experience",
    "What does a great clean mean to you?",
    "How do you handle client requests?",
    "What days are you available?",
    "When can you start?",
  ];

  const whyReasons = [
    "Highest intent moment — you just applied",
    "Zero friction — no waiting around",
    "Can move you to the front faster",
    "Feels like the next step, not extra work",
  ];

  const hiringSteps = [
    { icon: <CheckCircle2 size={18} />, label: "Application submitted", sub: "Completed", done: true },
    { icon: <Camera size={18} />, label: "Supplies photo", sub: "Do this now", done: false, cta: true },
    { icon: <PhoneCall size={18} />, label: "AI interview", sub: "Comes next", done: false },
    { icon: <Phone size={18} />, label: "Real interview", sub: "Comes next", done: false },
  ];

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: "#f4f6f9" }}>
      <div className="max-w-6xl mx-auto px-4 py-10 md:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">

          {/* ── Left column ── */}
          <div className="flex flex-col gap-6">

            {/* Header card */}
            <div className="bg-white rounded-2xl p-8 md:p-10" style={{ border: "1px solid #e5e7eb", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              {/* Badge + step */}
              <div className="flex items-center gap-3 mb-6">
                <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full" style={{ backgroundColor: "#dcfce7", color: "#16a34a", border: "1px solid #bbf7d0" }}>
                  <CheckCircle2 size={13} /> Application received
                </span>
                <span className="text-sm text-gray-400">Step 2 of 4</span>
              </div>

              {/* Headline */}
              <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 leading-tight mb-3">You're in! One last thing.</h1>
              <h2 className="text-2xl md:text-3xl font-extrabold leading-tight mb-4" style={{ color: "#94a3b8" }}>Send us a photo of your<br />cleaning supplies.</h2>
              <p className="text-gray-500 text-base mb-6 max-w-lg">Before your interview, we need to see your supplies. It takes 30 seconds and helps us fast-track your application.</p>

              {/* Wistia video — inline under headline */}
              <div className="rounded-2xl overflow-hidden mb-8" style={{ border: "1px solid #e5e7eb" }}>
                {/* Replace WISTIA_VIDEO_ID with your real Wistia video ID */}
                <div className="relative w-full" style={{ paddingBottom: "56.25%", backgroundColor: "#f1f5f9" }}>
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: "#e2e8f0" }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M8 5.14v14l11-7-11-7z" fill="#94a3b8" />
                      </svg>
                    </div>
                    <p className="text-sm text-gray-400 font-medium">Video placeholder</p>
                    <p className="text-xs text-gray-300">Replace with Wistia embed</p>
                  </div>
                </div>
              </div>

              {/* CTAs */}
              <div className="flex flex-wrap gap-3 mb-10">
                {interviewUrl ? (
                  <a
                    href={interviewUrl}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl text-white font-semibold text-sm transition-opacity hover:opacity-90"
                    style={{ backgroundColor: "#0f172a" }}
                  >
                    <span className="w-5 h-5 rounded-full border-2 border-white flex items-center justify-center">
                      <span className="w-2 h-2 rounded-full bg-white" />
                    </span>
                    Start 2-minute interview
                  </a>
                ) : (
                  <button
                    disabled
                    className="flex items-center gap-2 px-6 py-3 rounded-xl text-white font-semibold text-sm opacity-60 cursor-not-allowed"
                    style={{ backgroundColor: "#0f172a" }}
                  >
                    <Loader2 size={15} className="animate-spin" />
                    Preparing interview...
                  </button>
                )}
                <button
                  className="px-6 py-3 rounded-xl text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100"
                  style={{ border: "1.5px solid #e5e7eb", backgroundColor: "#fff" }}
                  onClick={() => {
                    toast.success("Interview link sent! Check your messages when you're ready.");
                  }}
                >
                  Do it later by text
                </button>
              </div>

              {/* Supplies upload CTA */}
              <div className="rounded-2xl p-5 mb-6" style={{ backgroundColor: "#fffbeb", border: "1.5px solid #fde68a" }}>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#fef3c7" }}>
                    <Camera size={20} style={{ color: "#d97706" }} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900 text-sm mb-1">📸 Upload a photo of your cleaning supplies</p>
                    <p className="text-xs text-gray-500 mb-3">Mop, vacuum, cleaning products — whatever you use. A quick phone photo is fine.</p>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={interviewUrl || "#"}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white font-semibold text-sm transition-opacity hover:opacity-90"
                        style={{ backgroundColor: "#d97706" }}
                      >
                        <Camera size={14} /> Upload photo now
                      </a>
                      <button
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100"
                        style={{ border: "1.5px solid #e5e7eb", backgroundColor: "#fff" }}
                        onClick={() => toast.success("Text us your supplies photo anytime — we'll link it to your application.")}
                      >
                        Text it instead
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { stat: "30 seconds", sub: "Super quick" },
                  { stat: "Any phone", sub: "Just snap a pic" },
                  { stat: "Reviewed today", sub: "Faster decisions" },
                ].map(({ stat, sub }) => (
                  <div key={stat} className="rounded-xl p-4" style={{ border: "1px solid #e5e7eb", backgroundColor: "#fafafa" }}>
                    <p className="font-bold text-gray-900 text-sm">{stat}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Hiring path card */}
            <div className="bg-white rounded-2xl p-6 md:p-8" style={{ border: "1px solid #e5e7eb", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">What happens next</p>
                  <p className="font-bold text-gray-900 text-lg">Your hiring path</p>
                </div>
                <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ backgroundColor: "#eff6ff", color: "#3b82f6" }}>Waiting to start</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {hiringSteps.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-4 flex flex-col gap-2"
                    style={{
                      border: s.done ? `1.5px solid #bbf7d0` : s.cta ? `1.5px solid #e2e8f0` : `1px solid #e5e7eb`,
                      backgroundColor: s.done ? "#f0fdf4" : "#fafafa",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span style={{ color: s.done ? "#16a34a" : "#94a3b8" }}>{s.icon}</span>
                      {i < hiringSteps.length - 1 && <ChevronRight size={14} style={{ color: "#cbd5e1" }} />}
                    </div>
                    <p className="text-sm font-semibold text-gray-800 leading-tight">{s.label}</p>
                    <p className="text-xs" style={{ color: s.done ? "#16a34a" : s.cta ? "#3b82f6" : "#94a3b8" }}>{s.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right column ── */}
          <div className="flex flex-col gap-6">

            {/* Why do this now */}
            <div className="bg-white rounded-2xl p-6" style={{ border: "1px solid #e5e7eb", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              <div className="flex items-start gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#f1f5f9" }}>
                  <Sparkles size={17} style={{ color: "#64748b" }} />
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">Why do this now?</p>
                  <p className="text-xs text-gray-400 mt-0.5">Best time to complete it is right after applying.</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {whyReasons.map((r) => (
                  <div key={r} className="flex items-start gap-2.5 py-2.5" style={{ borderTop: "1px solid #f1f5f9" }}>
                    <span style={{ color: "#94a3b8", marginTop: 1 }}>★</span>
                    <span className="text-sm text-gray-700">{r}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Interview preview */}
            <div className="bg-white rounded-2xl p-6" style={{ border: "1px solid #e5e7eb", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              <div className="flex items-center justify-between mb-1">
                <p className="font-bold text-gray-900 text-sm">Interview preview</p>
                <span className="text-xs text-gray-400">~2 min</span>
              </div>
              <p className="text-xs text-gray-400 mb-4">Simple, mobile-friendly, and short.</p>
              <div className="flex flex-col gap-2">
                {questions.map((q, i) => (
                  <div key={i} className="rounded-xl p-3.5" style={{ border: "1px solid #e5e7eb", backgroundColor: "#fafafa" }}>
                    <p className="text-xs font-semibold text-gray-400 mb-1">QUESTION {i + 1}</p>
                    <p className="text-sm text-gray-800 font-medium">{q}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Apply() {
  const initialStep: Step = new URLSearchParams(window.location.search).get("step") as Step || "welcome";
  const [step, setStep] = useState<Step>(initialStep);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [newCandidateId, setNewCandidateId] = useState<number | null>(null);

  const submitMutation = trpc.hiring.submitApplication.useMutation({
    onSuccess: (data) => { setNewCandidateId(data?.id ?? null); setStep("done"); },
    onError: (err) => setSubmitError(err.message || "Something went wrong. Please try again."),
  });

  const handleSubmit = async (videoUrl?: string) => {
    setSubmitError(null);
    // Upload bio photo if present
    let bioPhotoUrl: string | undefined;
    if (formData.bioPhoto) {
      try {
        const res = await fetch("/api/upload/video", {
          method: "POST",
          headers: { "Content-Type": formData.bioPhoto.type || "image/jpeg" },
          body: formData.bioPhoto,
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          bioPhotoUrl = data.url;
        }
      } catch {
        // Non-fatal: submit without photo
      }
    }
    submitMutation.mutate({
      firstName: formData.firstName || "Applicant",
      lastName: formData.lastName || "",
      email: formData.email || undefined,
      phone: formData.phone || "0000000000",
      streetAddress: formData.streetAddress || undefined,
      apt: formData.apt || undefined,
      city: formData.city || undefined,
      state: formData.state || undefined,
      zip: formData.zip || undefined,
      hasCleaning: formData.hasCleaning,
      hasBankAccount: formData.hasBankAccount,
      isAuthorized: formData.isAuthorized,
      consentBackground: formData.consentBackground,
      experience: formData.experience || undefined,
      specialties: formData.specialties,
      videoUrl: videoUrl || undefined,
      bioPhotoUrl: bioPhotoUrl || undefined,
    });
  };

  const [formData, setFormData] = useState<FormData>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    streetAddress: "",
    apt: "",
    city: "",
    state: "",
    zip: "",
    hasCleaning: null,
    hasBankAccount: null,
    isAuthorized: null,
    consentBackground: null,
    experience: "",
    specialties: [],
    bioPhoto: null,
    videoFile: null,
  });

  const patch = (p: Partial<FormData>) => setFormData(prev => ({ ...prev, ...p }));
  const next = () => {
    const idx = stepIndex(step);
    if (idx < STEP_ORDER.length - 1) setStep(STEP_ORDER[idx + 1]);
  };

  const isDone = step === "done";
  const currentIdx = stepIndex(step);

  const progressPct = Math.round((currentIdx / (STEP_ORDER.length - 1)) * 100);
  const visibleSteps = STEPS.filter(s => s.id !== "done");

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ backgroundColor: "#f8fafc" }}>

      {/* ── Mobile top progress bar (hidden on md+) ── */}
      {!isDone && step !== "welcome" && (
        <div
          className="md:hidden sticky top-0 z-20 px-4 py-3"
          style={{ backgroundColor: "#fff", borderBottom: "1px solid #f1f5f9" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: GREEN }}
              >
                <span className="text-white text-xs font-bold">MIB</span>
              </div>
              <span className="text-sm font-semibold text-gray-800">
                {STEPS.find(s => s.id === step)?.label ?? "Apply"}
              </span>
            </div>
            <span className="text-xs font-semibold" style={{ color: GREEN }}>
              Step {currentIdx + 1} / {visibleSteps.length}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, backgroundColor: GREEN }}
            />
          </div>
          {/* Dot indicators */}
          <div className="flex items-center justify-center gap-1.5 mt-2">
            {visibleSteps.map((s, i) => (
              <button
                key={s.id}
                onClick={() => i < currentIdx && setStep(s.id)}
                className="rounded-full transition-all"
                style={{
                  width: s.id === step ? 20 : 8,
                  height: 8,
                  backgroundColor: i < currentIdx ? GREEN : s.id === step ? ACCENT : "#e5e7eb",
                  cursor: i < currentIdx ? "pointer" : "default",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Left sidebar nav (hidden on mobile, shown on md+) ── */}
      {!isDone && step !== "welcome" && (
        <aside
          className="hidden md:flex w-60 shrink-0 flex-col py-8 px-4"
          style={{ backgroundColor: "#fff", borderRight: "1px solid #f1f5f9" }}
        >
          {/* Logo */}
          <div className="flex items-center gap-2 px-2 mb-10">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: GREEN }}
            >
              <span className="text-white text-xs font-bold">MIB</span>
            </div>
            <span className="text-sm font-semibold text-gray-800">Apply Now</span>
          </div>

          <nav className="space-y-1">
            {visibleSteps.map((s, i) => {
              const isActive = s.id === step;
              const isCompleted = i < currentIdx;
              return (
                <button
                  key={s.id}
                  onClick={() => isCompleted && setStep(s.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
                  style={
                    isActive
                      ? { backgroundColor: "#eff6ff", color: ACCENT }
                      : isCompleted
                      ? { color: GREEN, cursor: "pointer" }
                      : { color: "#9ca3af", cursor: "default" }
                  }
                >
                  <span
                    className="flex items-center justify-center w-5 h-5"
                    style={{ color: isActive ? ACCENT : isCompleted ? GREEN : "#9ca3af" }}
                  >
                    {isCompleted ? <CheckCircle2 size={16} /> : s.icon}
                  </span>
                  {s.label}
                </button>
              );
            })}
          </nav>

          {/* Progress bar */}
          <div className="mt-auto px-2">
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Progress</span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%`, backgroundColor: GREEN }}
              />
            </div>
          </div>
        </aside>
      )}

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        <div className={isDone || step === "welcome" ? "w-full" : "max-w-3xl mx-auto px-4 py-6 sm:px-6 md:px-10 md:py-10"}>
          {step === "welcome" && <WelcomeStep onNext={next} />}
          {step === "basic-info" && <BasicInfoStep data={formData} onChange={patch} onNext={next} />}
          {step === "requirements" && <RequirementsStep data={formData} onChange={patch} onNext={next} />}
          {step === "specialties" && <SpecialtiesStep data={formData} onChange={patch} onNext={next} />}
          {step === "bio" && <BioStep data={formData} onChange={patch} onNext={next} />}
          {submitError && (
            <div className="mb-4 p-3 rounded-xl text-sm text-red-700 bg-red-50 border border-red-200">{submitError}</div>
          )}
          {step === "video" && <VideoStep onSubmit={handleSubmit} onSkip={() => handleSubmit(undefined)} isSubmitting={submitMutation.isPending} />}
          {step === "done" && <ThankYouStep candidateId={newCandidateId} />}
        </div>
      </main>
    </div>
  );
}

