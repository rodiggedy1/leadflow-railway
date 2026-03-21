/**
 * JobTracker — public customer-facing job tracker page.
 *
 * Accessed via /track/:token — no login required.
 * Shows real-time job status, team info, ETA, and a star rating form.
 *
 * Design: Uber-dark, mobile-first, full-screen immersive.
 */

import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";

// ── Status config ────────────────────────────────────────────────────────────

type JobStatus =
  | "scheduled"
  | "on_the_way"
  | "arrived"
  | "in_progress"
  | "completed"
  | "issue_at_property"
  | null
  | undefined;

interface StatusConfig {
  label: string;
  sublabel: string;
  emoji: string;
  color: string;
  glow: string;
  step: number;
}

type StatusConfigFn = (firstName: string) => StatusConfig;

const STATUS_CONFIG_FN: Record<string, StatusConfigFn> = {
  scheduled: (name) => ({
    label: `Hi ${name}! You're confirmed for today`,
    sublabel: "Your team is getting ready",
    emoji: "📋",
    color: "text-blue-400",
    glow: "shadow-blue-500/30",
    step: 0,
  }),
  on_the_way: (name) => ({
    label: `${name}, your team is on the way!`,
    sublabel: "They're heading to you now",
    emoji: "🚗",
    color: "text-amber-400",
    glow: "shadow-amber-500/30",
    step: 1,
  }),
  arrived: (name) => ({
    label: `${name}, your team has arrived!`,
    sublabel: "Your team is at the door",
    emoji: "🏠",
    color: "text-orange-400",
    glow: "shadow-orange-500/30",
    step: 2,
  }),
  in_progress: (name) => ({
    label: `${name}, cleaning is in progress`,
    sublabel: "Your home is being taken care of",
    emoji: "🧹",
    color: "text-emerald-400",
    glow: "shadow-emerald-500/30",
    step: 3,
  }),
  completed: (name) => ({
    label: `All done, ${name}!`,
    sublabel: "Your home is sparkling clean ✨",
    emoji: "✨",
    color: "text-emerald-300",
    glow: "shadow-emerald-400/40",
    step: 4,
  }),
  issue_at_property: (name) => ({
    label: `${name}, heads up`,
    sublabel: "Your team noted an issue",
    emoji: "⚠️",
    color: "text-red-400",
    glow: "shadow-red-500/30",
    step: 2,
  }),
};

// Keep a static fallback for cases where firstName isn't available yet
const STATUS_CONFIG: Record<string, StatusConfig> = Object.fromEntries(
  Object.entries(STATUS_CONFIG_FN).map(([k, fn]) => [k, fn("there")])
);

const STEPS = [
  { key: "scheduled", label: "Confirmed" },
  { key: "on_the_way", label: "On the Way" },
  { key: "arrived", label: "Arrived" },
  { key: "in_progress", label: "Cleaning" },
  { key: "completed", label: "Done" },
];

// ── Star Rating Component ────────────────────────────────────────────────────

function StarRating({
  token,
  existingRating,
}: {
  token: string;
  existingRating: number | null | undefined;
}) {
  const [hovered, setHovered] = useState(0);
  const [selected, setSelected] = useState(existingRating ?? 0);
  const [submitted, setSubmitted] = useState(!!existingRating);
  const [lastSubmitted, setLastSubmitted] = useState(existingRating ?? 0);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);

  const submitRating = trpc.tracker.submitRating.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setLastSubmitted(selected);
      setShowComment(false);
      setComment("");
    },
  });

  const handleStarClick = (star: number) => {
    setSelected(star);
    if (star >= 4) {
      // Auto-submit for high ratings — no friction
      submitRating.mutate({ token, rating: star });
    } else {
      // Show comment box for lower ratings to capture feedback
      setShowComment(true);
    }
  };

  const handleSubmit = () => {
    if (!selected) return;
    submitRating.mutate({ token, rating: selected, comment: comment || undefined });
  };

  if (submitted) {
    return (
      <div className="text-center py-6">
        <div className="text-4xl mb-3">🙏</div>
        <p className="text-white font-semibold text-lg">Thank you for your feedback!</p>
        <p className="text-white/50 text-sm mt-1">Your rating helps us improve.</p>
        <div className="flex justify-center gap-1 mt-4">
          {[1, 2, 3, 4, 5].map((s) => (
            <span
              key={s}
              className={`text-2xl transition-all ${
                s <= lastSubmitted ? "opacity-100" : "opacity-20"
              }`}
            >
              ★
            </span>
          ))}
        </div>
        <button
          className="mt-4 text-xs text-white/30 hover:text-white/60 underline underline-offset-2 transition-colors"
          onClick={() => {
            setSubmitted(false);
            setShowComment(false);
            setComment("");
          }}
        >
          Change rating
        </button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <p className="text-white/70 text-sm mb-4 font-medium tracking-wide uppercase">
        How was your clean?
      </p>

      {/* Stars */}
      <div className="flex justify-center gap-2 mb-4">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => handleStarClick(star)}
            className={`text-4xl transition-all duration-150 select-none cursor-pointer
              ${star <= (hovered || selected)
                ? "text-amber-400 scale-110 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                : "text-white/20"
              }`}
          >
            ★
          </button>
        ))}
      </div>

      {/* Star label */}
      {(hovered || selected) > 0 && (
        <p className="text-amber-400 text-sm font-medium mb-4 transition-all">
          {["", "Poor", "Fair", "Good", "Great", "Amazing!"][hovered || selected]}
        </p>
      )}

      {/* Comment box */}
      {showComment && (
        <div className="mt-2 space-y-3">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Any comments? (optional)"
            rows={3}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/30 text-sm resize-none focus:outline-none focus:border-amber-400/60 transition-colors"
          />
          <button
            onClick={handleSubmit}
            disabled={submitRating.isPending || !selected}
            className="w-full py-3 rounded-xl font-semibold text-sm tracking-wide transition-all
              bg-amber-400 text-black hover:bg-amber-300 active:scale-95
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitRating.isPending ? "Submitting..." : "Submit Rating"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── ETA Display ──────────────────────────────────────────────────────────────

function ETADisplay({ etaTimestamp }: { etaTimestamp: number | null | undefined }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!etaTimestamp) return null;

  const diffMs = etaTimestamp - now;
  if (diffMs <= 0) return <span className="text-emerald-400 font-semibold">Arriving now</span>;

  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 60) {
    return (
      <span className="text-amber-400 font-semibold">
        ~{diffMin} min away
      </span>
    );
  }

  const eta = new Date(etaTimestamp);
  return (
    <span className="text-amber-400 font-semibold">
      ETA {eta.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
    </span>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

const DC_MAP_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/dc-night-landmarks_cb3aa568.jpg";

export default function JobTracker() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";

  // Poll every 30 seconds for live status updates
  const { data: job, isLoading, error } = trpc.tracker.getJob.useQuery(
    { token },
    {
      enabled: !!token,
      refetchInterval: 30_000,
      staleTime: 20_000,
    }
  );

  if (!token) {
    return <ErrorScreen message="Invalid tracker link." />;
  }

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (error || !job) {
    return <ErrorScreen message="This tracker link is invalid or has expired." />;
  }

  const statusKey = (job.jobStatus as string) ?? "scheduled";
  const firstName = job.customerName?.split(" ")[0] ?? "there";
  const configFn = STATUS_CONFIG_FN[statusKey] ?? STATUS_CONFIG_FN.scheduled;
  const config = configFn!(firstName);
  const currentStep = config.step;
  const teamDisplay = job.teamName ?? job.cleanerName ?? "Your Team";

  const serviceTime = job.serviceDateTime
    ? new Date(job.serviceDateTime).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      })
    : null;

  const jobDateDisplay = job.jobDate
    ? new Date(job.jobDate + "T12:00:00").toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : null;

  const isComplete = statusKey === "completed";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans flex flex-col">
      {/* ── Map Hero ────────────────────────────────────────────────────── */}
      <div className="relative h-52 overflow-hidden flex-shrink-0">
        <img
          src={DC_MAP_URL}
          alt="Washington DC"
          className="w-full h-full object-cover opacity-60"
        />
        {/* Dark gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-[#0a0a0a]" />

        {/* Pulsing location pin */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            <div className={`w-5 h-5 rounded-full bg-white shadow-lg ${config.glow} shadow-2xl`} />
            <div className="absolute inset-0 rounded-full bg-white/40 animate-ping" />
          </div>
        </div>

        {/* Logo / brand */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/10 backdrop-blur-sm flex items-center justify-center text-sm">
              🧹
            </div>
            <span className="text-white/80 text-sm font-semibold tracking-wide">
              Maids in Black
            </span>
          </div>
          <div className="text-white/40 text-xs">Live Tracker</div>
        </div>
      </div>

      {/* ── Main Content Card ────────────────────────────────────────────── */}
      <div className="flex-1 px-4 pb-8 -mt-2 space-y-4 max-w-md mx-auto w-full">

        {/* Status Card */}
        <div className={`bg-[#141414] rounded-2xl p-5 border border-white/5 shadow-2xl ${config.glow} shadow-lg`}>
          <div className="flex items-start gap-4">
            <div className="text-3xl leading-none mt-0.5">{config.emoji}</div>
            <div className="flex-1 min-w-0">
              <p className={`text-lg font-bold ${config.color}`}>{config.label}</p>
              <p className="text-white/50 text-sm mt-0.5">{config.sublabel}</p>
              {job.etaTimestamp && statusKey === "on_the_way" && (
                <p className="text-sm mt-2">
                  <ETADisplay etaTimestamp={job.etaTimestamp} />
                </p>
              )}
              {job.issueNote && statusKey === "issue_at_property" && (
                <p className="text-red-300/80 text-xs mt-2 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
                  {job.issueNote}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Progress Steps */}
        {statusKey !== "issue_at_property" && (
          <div className="bg-[#141414] rounded-2xl p-5 border border-white/5">
            <div className="flex items-center justify-between relative">
              {/* Connector line */}
              <div className="absolute left-0 right-0 top-4 h-0.5 bg-white/10 mx-8" />
              <div
                className="absolute left-0 top-4 h-0.5 bg-emerald-500/60 mx-8 transition-all duration-700"
                style={{ width: `${(currentStep / (STEPS.length - 1)) * 100}%` }}
              />

              {STEPS.map((step, idx) => {
                const done = idx < currentStep;
                const active = idx === currentStep;
                return (
                  <div key={step.key} className="flex flex-col items-center gap-1.5 z-10">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300
                        ${done || (active && config.step === 4)
                          ? "bg-emerald-500 text-white"
                          : active
                          ? `bg-white/10 border-2 border-white/60 ${config.color} ring-2 ring-white/20`
                          : "bg-white/5 text-white/20 border border-white/10"
                        }`}
                    >
                      {done || (active && config.step === 4) ? "✓" : idx + 1}
                    </div>
                    <span
                      className={`text-[10px] font-medium tracking-wide ${
                        active ? "text-white" : done ? "text-white/60" : "text-white/20"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Job Details */}
        <div className="bg-[#141414] rounded-2xl p-5 border border-white/5 space-y-4">
          <h3 className="text-white/40 text-xs font-semibold tracking-widest uppercase">
            Your Appointment
          </h3>

          <div className="space-y-3">
            {/* Team */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-base flex-shrink-0">
                👥
              </div>
              <div>
                <p className="text-white/40 text-xs">Team</p>
                <p className="text-white font-semibold text-sm">{teamDisplay}</p>
              </div>
            </div>

            {/* Date */}
            {jobDateDisplay && (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-base flex-shrink-0">
                  📅
                </div>
                <div>
                  <p className="text-white/40 text-xs">Date</p>
                  <p className="text-white font-semibold text-sm">{jobDateDisplay}</p>
                </div>
              </div>
            )}

            {/* Time */}
            {serviceTime && (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-base flex-shrink-0">
                  🕐
                </div>
                <div>
                  <p className="text-white/40 text-xs">Scheduled Time</p>
                  <p className="text-white font-semibold text-sm">{serviceTime}</p>
                </div>
              </div>
            )}

            {/* Address */}
            {job.jobAddress && (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-base flex-shrink-0">
                  📍
                </div>
                <div className="min-w-0">
                  <p className="text-white/40 text-xs">Address</p>
                  <p className="text-white font-semibold text-sm truncate">{job.jobAddress}</p>
                </div>
              </div>
            )}

            {/* Service type */}
            {job.serviceType && (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-base flex-shrink-0">
                  🧽
                </div>
                <div>
                  <p className="text-white/40 text-xs">Service</p>
                  <p className="text-white font-semibold text-sm">{job.serviceType}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Rating Card — show after completed, or always for engagement */}
        {(isComplete || true) && (
          <div className="bg-[#141414] rounded-2xl p-5 border border-white/5">
            <StarRating token={token} existingRating={job.customerRating} />
          </div>
        )}

        {/* Footer */}
        <div className="text-center pt-2 pb-4">
          <p className="text-white/20 text-xs">
            Questions? Text us at{" "}
            <a href="tel:+12028885362" className="text-white/40 underline">
              (202) 888-5362
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Loading & Error Screens ──────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center gap-4">
      <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-white/60 animate-spin" />
      <p className="text-white/40 text-sm">Loading your tracker...</p>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="text-4xl">🔍</div>
      <p className="text-white font-semibold">Tracker Not Found</p>
      <p className="text-white/40 text-sm">{message}</p>
      <p className="text-white/20 text-xs mt-4">
        Need help?{" "}
        <a href="tel:+12028885362" className="text-white/40 underline">
          Call us
        </a>
      </p>
    </div>
  );
}
