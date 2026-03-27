/**
 * JobTracker — public customer-facing job tracker page.
 *
 * Accessed via /track/:token — no login required.
 * Shows real-time job status, team info, ETA, and a full 5-step AI review flow.
 *
 * Review flow steps:
 *   1. Rating hook — 5-star tap with "$50 tip to your team" incentive
 *   2. Chip selection — quick-tap labels + optional free text
 *   3. AI draft generation — 3 personalized review options
 *   4. Pick + edit — inline editing of chosen draft
 *   5. 1-tap copy + auto-open Google review page
 *
 * Design: Uber-dark, mobile-first, full-screen immersive.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";

// ── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_REVIEW_URL = "https://tinyurl.com/26rjz5jn";

const REVIEW_CHIPS = [
  "On time",
  "Super thorough",
  "Friendly team",
  "Great attention to detail",
  "Spotless results",
  "Went above & beyond",
  "Easy to communicate with",
  "Would book again",
];

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
  bgAccent: string;
}

type StatusConfigFn = (firstName: string) => StatusConfig;

const STATUS_CONFIG_FN: Record<string, StatusConfigFn> = {
  scheduled: (name) => ({
    label: `Hi ${name}! You're confirmed for today`,
    sublabel: "Your team is getting ready",
    emoji: "📋",
    color: "text-blue-400",
    glow: "shadow-blue-500/20",
    bgAccent: "from-blue-500/10",
    step: 0,
  }),
  on_the_way: (name) => ({
    label: `${name}, your team is on the way!`,
    sublabel: "They're heading to you now",
    emoji: "🚗",
    color: "text-amber-400",
    glow: "shadow-amber-500/20",
    bgAccent: "from-amber-500/10",
    step: 1,
  }),
  arrived: (name) => ({
    label: `${name}, your team has arrived!`,
    sublabel: "Your team is at the door",
    emoji: "🏠",
    color: "text-orange-400",
    glow: "shadow-orange-500/20",
    bgAccent: "from-orange-500/10",
    step: 2,
  }),
  in_progress: (name) => ({
    label: `${name}, cleaning is in progress`,
    sublabel: "Your home is being taken care of",
    emoji: "🧹",
    color: "text-emerald-400",
    glow: "shadow-emerald-500/20",
    bgAccent: "from-emerald-500/10",
    step: 3,
  }),
  completed: (name) => ({
    label: `All done, ${name}! ✨`,
    sublabel: "Your home is sparkling clean",
    emoji: "✨",
    color: "text-emerald-300",
    glow: "shadow-emerald-400/30",
    bgAccent: "from-emerald-500/15",
    step: 4,
  }),
  issue_at_property: (name) => ({
    label: `${name}, heads up`,
    sublabel: "Your team noted an issue",
    emoji: "⚠️",
    color: "text-red-400",
    glow: "shadow-red-500/20",
    bgAccent: "from-red-500/10",
    step: 2,
  }),
};

const STEPS = [
  { key: "scheduled", label: "Confirmed", emoji: "📋" },
  { key: "on_the_way", label: "On the Way", emoji: "🚗" },
  { key: "arrived", label: "Arrived", emoji: "🏠" },
  { key: "in_progress", label: "Cleaning", emoji: "🧹" },
  { key: "completed", label: "Done", emoji: "✅" },
];

// ── Confetti ─────────────────────────────────────────────────────────────────

function Confetti() {
  const colors = ["#10b981", "#f59e0b", "#6366f1", "#ec4899", "#ffffff"];
  const pieces = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    color: colors[i % colors.length]!,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 0.8}s`,
    size: Math.random() * 6 + 5,
    duration: `${Math.random() * 1.5 + 1.5}s`,
  }));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="absolute top-0 animate-bounce"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: Math.random() > 0.5 ? "50%" : "2px",
            animationDelay: p.delay,
            animationDuration: p.duration,
            transform: `rotate(${Math.random() * 360}deg)`,
          }}
        />
      ))}
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
    return <span className="text-amber-400 font-semibold">~{diffMin} min away</span>;
  }

  const eta = new Date(etaTimestamp);
  return (
    <span className="text-amber-400 font-semibold">
      ETA {eta.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
    </span>
  );
}

// ── Review Flow ──────────────────────────────────────────────────────────────

type ReviewStep =
  | "rating"       // Step 1: tap stars
  | "chips"        // Step 2: chip selection
  | "generating"   // Step 3: AI generating drafts
  | "pick"         // Step 4: pick a draft
  | "edit"         // Step 4b: edit selected draft
  | "done";        // Step 5: copied + opened

function ReviewFlow({
  token,
  firstName,
  existingRating,
}: {
  token: string;
  firstName: string;
  existingRating: number | null | undefined;
}) {
  const [step, setStep] = useState<ReviewStep>(existingRating ? "done" : "rating");
  const [hovered, setHovered] = useState(0);
  const [rating, setRating] = useState(existingRating ?? 0);
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [drafts, setDrafts] = useState<string[]>([]);
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const [editedDraft, setEditedDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submitRating = trpc.tracker.submitRating.useMutation();
  const generateDrafts = trpc.tracker.generateReviewDrafts.useMutation();
  const recordAction = trpc.tracker.recordReviewAction.useMutation();

  const handleStarTap = (star: number) => {
    setRating(star);
    submitRating.mutate({ token, rating: star });
    if (star === 5) {
      // Go to review flow for 5-star
      setTimeout(() => setStep("chips"), 400);
    } else {
      // For lower ratings, just thank them
      setTimeout(() => setStep("done"), 400);
    }
  };

  const toggleChip = (chip: string) => {
    setSelectedChips((prev) =>
      prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]
    );
  };

  const handleGenerateDrafts = useCallback(async () => {
    setStep("generating");
    try {
      const result = await generateDrafts.mutateAsync({
        token,
        chips: selectedChips,
        freeText: freeText || undefined,
      });
      setDrafts(result.drafts);
      setStep("pick");
    } catch {
      // Fallback: go to done if AI fails completely
      setStep("done");
    }
  }, [token, selectedChips, freeText, generateDrafts]);

  const handlePickDraft = (index: number) => {
    setPickedIndex(index);
    setEditedDraft(drafts[index] ?? "");
    recordAction.mutate({ token, draftPicked: index + 1 });
    setStep("edit");
  };

  const handleCopyAndOpen = async () => {
    const textToCopy = editedDraft || (pickedIndex !== null ? drafts[pickedIndex] ?? "" : "");
    try {
      await navigator.clipboard.writeText(textToCopy);
    } catch {
      // Clipboard API blocked — show text for manual copy
    }
    recordAction.mutate({ token, copied: true });
    setCopied(true);
    setShowConfetti(true);
    setStep("done");
    // Open Google review page
    setTimeout(() => {
      window.open(GOOGLE_REVIEW_URL, "_blank");
    }, 600);
  };

  // ── Step 1: Rating ──────────────────────────────────────────────────────────
  if (step === "rating") {
    return (
      <div className="text-center">
        {/* Incentive hook */}
        <div className="mb-5 px-2">
          <div className="inline-flex items-center gap-2 bg-emerald-500/15 border border-emerald-500/30 rounded-full px-4 py-1.5 mb-4">
            <span className="text-emerald-400 text-xs font-semibold tracking-wide">
              💰 A 5-star review gets your team a $50 tip
            </span>
          </div>
          <p className="text-white/70 text-sm font-medium">
            How did {firstName}'s team do today?
          </p>
        </div>

        {/* Stars */}
        <div className="flex justify-center gap-3 mb-4">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onMouseEnter={() => setHovered(star)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => handleStarTap(star)}
              disabled={submitRating.isPending}
              className={`text-5xl transition-all duration-150 select-none cursor-pointer leading-none
                ${star <= (hovered || rating)
                  ? "text-amber-400 scale-110 drop-shadow-[0_0_12px_rgba(251,191,36,0.7)]"
                  : "text-white/15"
                }`}
            >
              ★
            </button>
          ))}
        </div>

        {(hovered || rating) > 0 && (
          <p className="text-amber-400 text-sm font-semibold mb-2 transition-all">
            {["", "Poor", "Fair", "Good", "Great", "Amazing! 🌟"][hovered || rating]}
          </p>
        )}

        <p className="text-white/30 text-xs mt-3">Tap a star to rate</p>
      </div>
    );
  }

  // ── Step 2: Chip selection ──────────────────────────────────────────────────
  if (step === "chips") {
    return (
      <div>
        <div className="text-center mb-5">
          <div className="text-3xl mb-2">🌟</div>
          <p className="text-white font-bold text-base">Amazing! What stood out?</p>
          <p className="text-white/50 text-xs mt-1">Pick all that apply — we'll write your review</p>
        </div>

        {/* Chips */}
        <div className="flex flex-wrap gap-2 mb-4 justify-center">
          {REVIEW_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => toggleChip(chip)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 border
                ${selectedChips.includes(chip)
                  ? "bg-emerald-500 border-emerald-400 text-white scale-105"
                  : "bg-white/5 border-white/15 text-white/60 hover:border-white/30 hover:text-white/80"
                }`}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Optional free text */}
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="Anything else you want to mention? (optional)"
          rows={2}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/25 text-xs resize-none focus:outline-none focus:border-emerald-500/50 transition-colors mb-4"
        />

        <button
          onClick={handleGenerateDrafts}
          disabled={selectedChips.length === 0 && !freeText.trim()}
          className="w-full py-3.5 rounded-xl font-bold text-sm tracking-wide transition-all
            bg-gradient-to-r from-emerald-500 to-emerald-400 text-black
            hover:from-emerald-400 hover:to-emerald-300 active:scale-95
            disabled:opacity-40 disabled:cursor-not-allowed
            shadow-lg shadow-emerald-500/25"
        >
          ✨ Write My Review
        </button>

        <button
          onClick={() => setStep("done")}
          className="w-full mt-2 py-2 text-xs text-white/25 hover:text-white/50 transition-colors"
        >
          Skip for now
        </button>
      </div>
    );
  }

  // ── Step 3: Generating ──────────────────────────────────────────────────────
  if (step === "generating") {
    return (
      <div className="text-center py-8">
        <div className="relative inline-flex items-center justify-center mb-5">
          <div className="w-14 h-14 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin" />
          <span className="absolute text-2xl">✨</span>
        </div>
        <p className="text-white font-semibold text-sm">Crafting your review...</p>
        <p className="text-white/40 text-xs mt-1">Personalizing 3 options just for you</p>
      </div>
    );
  }

  // ── Step 4: Pick a draft ────────────────────────────────────────────────────
  if (step === "pick") {
    return (
      <div>
        <div className="text-center mb-4">
          <p className="text-white font-bold text-sm">Pick a review to share</p>
          <p className="text-white/40 text-xs mt-1">Tap one to customize it</p>
        </div>

        <div className="space-y-3">
          {drafts.map((draft, i) => (
            <button
              key={i}
              onClick={() => handlePickDraft(i)}
              className="w-full text-left bg-white/5 hover:bg-white/10 border border-white/10 hover:border-emerald-500/40 rounded-xl p-4 transition-all duration-150 active:scale-[0.98]"
            >
              <div className="flex items-start gap-3">
                <span className="text-white/30 text-xs font-bold mt-0.5 shrink-0">#{i + 1}</span>
                <p className="text-white/80 text-xs leading-relaxed">{draft}</p>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={() => setStep("chips")}
          className="w-full mt-3 py-2 text-xs text-white/25 hover:text-white/50 transition-colors"
        >
          ← Start over
        </button>
      </div>
    );
  }

  // ── Step 4b: Edit ───────────────────────────────────────────────────────────
  if (step === "edit") {
    return (
      <div>
        <div className="text-center mb-4">
          <p className="text-white font-bold text-sm">Edit if you'd like</p>
          <p className="text-white/40 text-xs mt-1">Then copy it and paste into Google</p>
        </div>

        <textarea
          ref={textareaRef}
          value={editedDraft}
          onChange={(e) => setEditedDraft(e.target.value)}
          rows={5}
          autoFocus
          className="w-full bg-white/5 border border-white/15 focus:border-emerald-500/60 rounded-xl px-4 py-3 text-white text-xs leading-relaxed resize-none focus:outline-none transition-colors mb-4"
        />

        <button
          onClick={handleCopyAndOpen}
          className="w-full py-4 rounded-xl font-bold text-sm tracking-wide transition-all
            bg-gradient-to-r from-emerald-500 to-emerald-400 text-black
            hover:from-emerald-400 hover:to-emerald-300 active:scale-95
            shadow-xl shadow-emerald-500/30 flex items-center justify-center gap-2"
        >
          <span>📋</span>
          Copy & Open Google Reviews
        </button>

        <button
          onClick={() => setStep("pick")}
          className="w-full mt-2 py-2 text-xs text-white/25 hover:text-white/50 transition-colors"
        >
          ← Choose a different draft
        </button>
      </div>
    );
  }

  // ── Step 5: Done ────────────────────────────────────────────────────────────
  if (step === "done") {
    const wasHighRating = rating >= 4;
    const wasFiveStar = rating === 5;

    if (wasFiveStar && copied) {
      return (
        <div className="text-center py-4 relative">
          {showConfetti && <Confetti />}
          <div className="text-5xl mb-3">🎉</div>
          <p className="text-white font-bold text-base mb-1">You're amazing, {firstName}!</p>
          <p className="text-white/60 text-xs mb-4 leading-relaxed">
            Your review is copied — just paste it into Google.<br />
            Your team will get that $50 tip. Thank you! 🖤
          </p>
          <a
            href={GOOGLE_REVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            🔗 Open Google Reviews again
          </a>
        </div>
      );
    }

    if (wasFiveStar) {
      return (
        <div className="text-center py-4">
          <div className="text-4xl mb-3">🌟</div>
          <p className="text-white font-bold text-base mb-1">Thank you, {firstName}!</p>
          <p className="text-white/50 text-xs mb-4 leading-relaxed">
            We'd love a Google review — it means the world to the team.
          </p>
          <button
            onClick={() => setStep("chips")}
            className="w-full py-3.5 rounded-xl font-bold text-sm
              bg-gradient-to-r from-emerald-500 to-emerald-400 text-black
              hover:from-emerald-400 hover:to-emerald-300 active:scale-95
              shadow-lg shadow-emerald-500/25 transition-all"
          >
            ✨ Write a Google Review
          </button>
          <p className="text-white/25 text-xs mt-2">Takes 30 seconds · $50 tip to your team</p>
        </div>
      );
    }

    return (
      <div className="text-center py-4">
        <div className="text-4xl mb-3">🙏</div>
        <p className="text-white font-semibold text-base">
          {wasHighRating ? `Thank you, ${firstName}!` : "Thanks for the feedback"}
        </p>
        <p className="text-white/40 text-xs mt-2">
          {wasHighRating
            ? "We're glad you had a great experience. See you next time! 🖤"
            : "We appreciate your honesty. Our team will follow up shortly."}
        </p>
        {!wasHighRating && (
          <button
            onClick={() => {
              setRating(0);
              setStep("rating");
            }}
            className="mt-4 text-xs text-white/30 hover:text-white/60 underline underline-offset-2 transition-colors"
          >
            Change rating
          </button>
        )}
      </div>
    );
  }

  return null;
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

  // Show a clear message for rescheduled or cancelled appointments
  if (job.bookingStatus === "rescheduled" || job.bookingStatus === "cancelled") {
    const isRescheduled = job.bookingStatus === "rescheduled";
    const firstName = job.customerName?.split(" ")[0] ?? "there";
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white font-sans flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full text-center space-y-5">
          <div className="text-5xl mb-2">{isRescheduled ? "📅" : "❌"}</div>
          <h1 className="text-xl font-bold text-white">
            {isRescheduled
              ? `Hi ${firstName}, your appointment has been rescheduled`
              : `Hi ${firstName}, your appointment has been cancelled`}
          </h1>
          <p className="text-white/50 text-sm leading-relaxed">
            {isRescheduled
              ? "This booking was moved to a new date or time. You'll receive a new confirmation when it's scheduled."
              : "This booking has been cancelled. Please contact us if you have any questions."}
          </p>
          <a
            href="tel:+12028885362"
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/10 text-white text-sm font-medium px-5 py-3 rounded-xl transition-colors"
          >
            📞 Call Maids in Black
          </a>
        </div>
      </div>
    );
  }

  const statusKey = (job.jobStatus as string) ?? "scheduled";
  const firstName = job.customerName?.split(" ")[0] ?? "there";
  const configFn = STATUS_CONFIG_FN[statusKey] ?? STATUS_CONFIG_FN["scheduled"]!;
  const config = configFn(firstName);
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
  const isOnTheWay = statusKey === "on_the_way" || statusKey === "running_late";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans flex flex-col">

      {/* ── Map Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative h-52 overflow-hidden flex-shrink-0">
        <img
          src={DC_MAP_URL}
          alt="Washington DC"
          className={`w-full h-full object-cover transition-all duration-1000 ${
            isOnTheWay ? "opacity-70 scale-105" : "opacity-50"
          }`}
        />
        {/* Dark gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-[#0a0a0a]" />

        {/* Pulsing location pin */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            <div
              className={`w-5 h-5 rounded-full shadow-2xl ${config.glow} shadow-lg`}
              style={{ backgroundColor: isComplete ? "#10b981" : isOnTheWay ? "#f59e0b" : "#ffffff" }}
            />
            {isOnTheWay && (
              <>
                <div className="absolute inset-0 rounded-full bg-amber-400/50 animate-ping" />
                <div
                  className="absolute -inset-3 rounded-full bg-amber-400/15 animate-ping"
                  style={{ animationDelay: "0.3s" }}
                />
              </>
            )}
            {isComplete && (
              <div className="absolute inset-0 rounded-full bg-emerald-400/50 animate-ping" />
            )}
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
          <div className="flex items-center gap-1.5 bg-black/30 backdrop-blur-sm rounded-full px-2.5 py-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-white/60 text-[10px] font-medium">Live</span>
          </div>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 pb-10 -mt-2 space-y-3 max-w-md mx-auto w-full">

        {/* ── Celebratory Completed Banner ─────────────────────────────────── */}
        {isComplete && (
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-transparent border border-emerald-500/25 p-5 text-center">
            <div className="text-4xl mb-2">🎊</div>
            <p className="text-emerald-300 font-bold text-lg">All done, {firstName}!</p>
            <p className="text-white/60 text-sm mt-1">Your home is sparkling clean ✨</p>
          </div>
        )}

        {/* ── Status Card ──────────────────────────────────────────────────── */}
        {!isComplete && (
          <div
            className={`bg-gradient-to-br ${config.bgAccent} to-transparent bg-[#141414] rounded-2xl p-5 border border-white/5 shadow-xl ${config.glow} shadow-lg`}
          >
            <div className="flex items-start gap-4">
              <div className="text-3xl leading-none mt-0.5">{config.emoji}</div>
              <div className="flex-1 min-w-0">
                <p className={`text-base font-bold ${config.color} leading-snug`}>{config.label}</p>
                <p className="text-white/50 text-sm mt-0.5">{config.sublabel}</p>
                {job.etaTimestamp && isOnTheWay && (
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
        )}

        {/* ── Progress Steps ────────────────────────────────────────────────── */}
        {statusKey !== "issue_at_property" && (
          <div className="bg-[#141414] rounded-2xl px-5 py-4 border border-white/5">
            <div className="flex items-start justify-between relative">
              {/* Connector line background */}
              <div className="absolute left-5 right-5 top-5 h-0.5 bg-white/8" />
              {/* Connector line progress */}
              <div
                className="absolute left-5 top-5 h-0.5 bg-emerald-500/70 transition-all duration-700"
                style={{
                  width: `calc(${(currentStep / (STEPS.length - 1)) * 100}% - ${currentStep === 0 ? 0 : 10}px)`,
                }}
              />

              {STEPS.map((step, idx) => {
                const done = idx < currentStep;
                const active = idx === currentStep;
                const isLast = idx === STEPS.length - 1;
                return (
                  <div key={step.key} className="flex flex-col items-center gap-1.5 z-10" style={{ flex: 1 }}>
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-base font-bold transition-all duration-300 border-2
                        ${done || (active && isLast)
                          ? "bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/30"
                          : active
                          ? `bg-[#1a1a1a] border-white/50 ring-2 ring-white/10`
                          : "bg-[#141414] border-white/8 text-white/20"
                        }`}
                    >
                      {done || (active && isLast) ? "✓" : step.emoji}
                    </div>
                    <span
                      className={`text-[9px] font-semibold tracking-wide text-center leading-tight ${
                        active ? "text-white" : done ? "text-white/50" : "text-white/20"
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

        {/* ── Team Highlight ────────────────────────────────────────────────── */}
        <div className="bg-[#141414] rounded-2xl p-4 border border-white/5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-2xl shrink-0 border border-white/8">
            👥
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white/40 text-[10px] font-semibold tracking-widest uppercase mb-0.5">
              Your Team Today
            </p>
            <p className="text-white font-bold text-base truncate">{teamDisplay}</p>
          </div>
          <div className="shrink-0">
            <a
              href="tel:+12028885362"
              className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-white/60 text-xs font-medium transition-colors"
            >
              📞 Call
            </a>
          </div>
        </div>

        {/* ── Job Details ───────────────────────────────────────────────────── */}
        <div className="bg-[#141414] rounded-2xl p-4 border border-white/5 space-y-3">
          <h3 className="text-white/30 text-[10px] font-semibold tracking-widest uppercase">
            Appointment Details
          </h3>

          <div className="space-y-2.5">
            {jobDateDisplay && (
              <div className="flex items-center gap-3">
                <span className="text-base w-6 text-center shrink-0">📅</span>
                <div>
                  <p className="text-white/35 text-[10px]">Date</p>
                  <p className="text-white/90 font-semibold text-sm">{jobDateDisplay}</p>
                </div>
              </div>
            )}

            {serviceTime && (
              <div className="flex items-center gap-3">
                <span className="text-base w-6 text-center shrink-0">🕐</span>
                <div>
                  <p className="text-white/35 text-[10px]">Scheduled Time</p>
                  <p className="text-white/90 font-semibold text-sm">{serviceTime}</p>
                </div>
              </div>
            )}

            {job.jobAddress && (
              <div className="flex items-start gap-3">
                <span className="text-base w-6 text-center shrink-0 mt-0.5">📍</span>
                <div className="min-w-0">
                  <p className="text-white/35 text-[10px]">Address</p>
                  <p className="text-white/90 font-semibold text-sm">{job.jobAddress}</p>
                </div>
              </div>
            )}

            {job.serviceType && (
              <div className="flex items-center gap-3">
                <span className="text-base w-6 text-center shrink-0">🧽</span>
                <div>
                  <p className="text-white/35 text-[10px]">Service</p>
                  <p className="text-white/90 font-semibold text-sm">{job.serviceType}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Review / Rating Card ──────────────────────────────────────────── */}
        <div className="bg-[#141414] rounded-2xl p-5 border border-white/5">
          <ReviewFlow
            token={token}
            firstName={firstName}
            existingRating={job.customerRating}
          />
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="text-center pt-1 pb-4">
          <p className="text-white/20 text-xs">
            Questions?{" "}
            <a href="tel:+12028885362" className="text-white/40 underline underline-offset-2">
              Text or call (202) 888-5362
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
