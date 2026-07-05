/**
 * CleanerPortalV2 — /portal-v2
 *
 * Step-through job runner for cleaners. One action at a time.
 * Uses mock data for UI review — real data wiring comes next.
 *
 * Design: Dark navy (#0f172a / #1e293b), green CTA (#22c55e), white text.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2, MapPin, CheckCircle2, Camera, Star, ChevronLeft, ChevronRight, X, AlertTriangle, Navigation } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type StepType =
  | "navigate"
  | "arrived"
  | "greet"
  | "before_photos"
  | "checklist_item"
  | "photo_objective"
  | "walk_through"
  | "next_job"
  | "signoff";

interface Step {
  id: string;
  type: StepType;
  label: string;         // top badge: "NEXT REQUIRED ACTION" | "MANUAL CHECKPOINT" | etc.
  emoji: string;
  title: string;
  description: string;
  whyItMatters?: string;
  ctaText: string;
  aiCoach?: string;
  badge?: string;        // e.g. "+$5 Bonus", "Protect 18-job streak"
}

interface MockJob {
  id: number;
  customerName: string;
  address: string;
  time: string;
  jobIndex: number;
  totalJobs: number;
  fiveStarChance: number;
  steps: Step[];
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

const MOCK_JOB: MockJob = {
  id: 1001,
  customerName: "Jennifer Smith",
  address: "Alexandria, VA",
  time: "2:00 PM",
  jobIndex: 2,
  totalJobs: 3,
  fiveStarChance: 84,
  steps: [
    {
      id: "navigate",
      type: "navigate",
      label: "NEXT REQUIRED ACTION",
      emoji: "🚗",
      title: "Start Navigation",
      description: "Leave now. You'll arrive a few minutes early and the customer will get an automatic on-my-way text.",
      whyItMatters: "Being early protects the review before the cleaning even begins.",
      ctaText: "START NAVIGATION",
    },
    {
      id: "arrived",
      type: "arrived",
      label: "MANUAL CHECKPOINT",
      emoji: "📍",
      title: "Tap When Arrived",
      description: "When you're parked and at the home, tap arrived. This replaces GPS and tells operations you're on site.",
      whyItMatters: "Manual arrival keeps the day accurate even without location tracking.",
      ctaText: "I'VE ARRIVED",
    },
    {
      id: "greet",
      type: "greet",
      label: "NEXT REQUIRED ACTION",
      emoji: "👋",
      title: "Greet Customer",
      description: "Introduce yourself, confirm the requested rooms, and ask if there are priority areas.",
      whyItMatters: "A strong greeting reduces complaints because expectations are clear before cleaning starts.",
      ctaText: "CUSTOMER GREETED",
    },
    {
      id: "before_photos",
      type: "before_photos",
      label: "NEXT REQUIRED ACTION",
      emoji: "📷",
      title: "Take Before Photos",
      description: "Photograph kitchen, bathroom, and any problem areas before cleaning starts.",
      whyItMatters: "Before photos protect the team and make the after photos more impressive.",
      ctaText: "BEFORE PHOTOS DONE",
    },
    {
      id: "checklist_oven",
      type: "checklist_item",
      label: "NEXT REQUIRED ACTION",
      emoji: "🧽",
      title: "Clean Kitchen Add-ons",
      description: "This customer paid for inside oven and cabinets. Complete those before moving on.",
      whyItMatters: "Paid add-ons are the easiest place to create a complaint if missed.",
      ctaText: "KITCHEN ADD-ONS DONE",
    },
    {
      id: "photo_kitchen",
      type: "photo_objective",
      label: "YOUR NEXT OBJECTIVE",
      emoji: "📸",
      title: "Photograph Kitchen Sink",
      description: "The sink is the last unverified room.",
      aiCoach: "Take a close-up of the sink and counters before leaving the kitchen.",
      badge: "+$5 Bonus",
      ctaText: "Complete Objective",
    },
    {
      id: "walk_through",
      type: "walk_through",
      label: "YOUR NEXT OBJECTIVE",
      emoji: "😊",
      title: "Walk Customer Through Home",
      description: "This is the biggest predictor of 5-star reviews.",
      aiCoach: "Ask: 'Is there anything you'd like us to touch up while we're here?'",
      badge: "Protect 18-job streak",
      ctaText: "Complete Objective",
    },
    {
      id: "next_job",
      type: "next_job",
      label: "YOUR NEXT OBJECTIVE",
      emoji: "🚀",
      title: "Start Mission #2",
      description: "Everything is complete. Time for the next customer.",
      aiCoach: "Jennifer Smith is ready for you.",
      badge: "Next Job Unlocked",
      ctaText: "Start Mission #2 →",
    },
    {
      id: "signoff",
      type: "signoff",
      label: "FINAL STEP",
      emoji: "✍️",
      title: "Customer Sign-off",
      description: "Walk the home together before finishing.",
      ctaText: "COMPLETE SIGN-OFF",
    },
  ],
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round((current / total) * 100);
  return (
    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
      <div
        className="h-full bg-emerald-400 rounded-full transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function JobHeader({ job, stepIndex, totalSteps }: { job: MockJob; stepIndex: number; totalSteps: number }) {
  return (
    <div className="px-4 pt-5 pb-3 bg-slate-900">
      <h1 className="text-2xl font-black text-white leading-tight">
        Leave for {job.customerName}
      </h1>
      <p className="text-slate-400 text-sm mt-0.5">
        Job {job.jobIndex} of {job.totalJobs} · {job.time} · {job.address}
      </p>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="bg-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-black text-white">{job.fiveStarChance}%</div>
          <div className="text-xs text-slate-400 mt-0.5">5⭐ chance</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-black text-white">$42</div>
          <div className="text-xs text-slate-400 mt-0.5">bonus</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-black text-white">{stepIndex + 1}/{totalSteps}</div>
          <div className="text-xs text-slate-400 mt-0.5">step</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <ProgressBar current={stepIndex + 1} total={totalSteps} />
      </div>
    </div>
  );
}

function NavigateStepCard({ step, onComplete, jobAddress }: { step: Step; onComplete: () => void; jobAddress: string }) {
  const [gpsState, setGpsState] = useState<"idle" | "fetching" | "ready" | "error">("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [etaEnabled, setEtaEnabled] = useState(false);
  // After user taps START NAVIGATION, show the pulsing "I've Arrived" CTA
  const [hasLaunched, setHasLaunched] = useState(false);
  // When user returns from maps (tab becomes visible again), pulse the arrived button
  const [returnedFromMaps, setReturnedFromMaps] = useState(false);

  const etaQuery = trpc.cleaner.getDriveEta.useQuery(
    { originLat: coords?.lat ?? 0, originLng: coords?.lng ?? 0, destination: jobAddress },
    { enabled: etaEnabled && !!coords, retry: false, throwOnError: false }
  );

  // Request GPS on mount
  useEffect(() => {
    setGpsState("fetching");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsState("ready");
        setEtaEnabled(true);
      },
      () => setGpsState("error"),
      { timeout: 8000, maximumAge: 60000 }
    );
  }, []);

  // Detect when user returns from maps app (tab/page becomes visible again)
  useEffect(() => {
    if (!hasLaunched) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        setReturnedFromMaps(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    // Also handle focus event for desktop/PWA
    window.addEventListener("focus", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [hasLaunched]);

  const eta = etaQuery.data;
  const hasEta = eta?.ok;

  const handleNavigate = () => {
    const dest = encodeURIComponent(jobAddress);
    const url = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      ? `maps://maps.apple.com/?daddr=${dest}&dirflg=d`
      : `https://maps.google.com/?daddr=${dest}&travelmode=driving`;
    window.open(url, "_blank");
    setHasLaunched(true);
    // On desktop (new tab), visibilitychange won't fire — set returnedFromMaps after a short delay
    setTimeout(() => setReturnedFromMaps(true), 1500);
  };

  // ── Phase: before navigation launched ─────────────────────────────────────
  if (!hasLaunched) {
    return (
      <div className="mx-4 mt-4 bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden shadow-xl">
        <div className="pt-5 pb-1 text-center">
          <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">{step.label}</span>
        </div>
        <div className="text-center text-5xl mt-3 mb-2 leading-none">{step.emoji}</div>
        <h2 className="text-center text-3xl font-black text-white px-6 leading-tight">{step.title}</h2>

        {/* Address pill */}
        <div className="mx-4 mt-4 bg-slate-900/80 border border-slate-700/40 rounded-xl px-4 py-3 flex items-center gap-3">
          <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-white font-semibold text-sm flex-1 truncate">{jobAddress}</span>
        </div>

        {/* ETA display */}
        <div className="mx-4 mt-3 bg-slate-900/60 border border-slate-700/30 rounded-xl p-4 min-h-[64px] flex items-center justify-center">
          {gpsState === "fetching" || (gpsState === "ready" && etaQuery.isLoading) ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Calculating drive time...</span>
            </div>
          ) : hasEta ? (
            <div className="flex items-center justify-between w-full">
              <div>
                <div className="text-2xl font-black text-white">{eta.durationText}</div>
                <div className="text-slate-400 text-xs mt-0.5">estimated drive</div>
              </div>
              <div className="text-right">
                <div className="text-emerald-400 font-black text-xl">{eta.etaText}</div>
                <div className="text-slate-400 text-xs mt-0.5">arrive by</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-500">
              <MapPin className="w-4 h-4" />
              <span className="text-sm">Tap to get directions</span>
            </div>
          )}
        </div>

        {step.whyItMatters && (
          <div className="mx-4 mt-3 bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
            <p className="text-blue-400 font-bold text-sm">Why this matters</p>
            <p className="text-slate-300 text-sm mt-1 leading-relaxed">{step.whyItMatters}</p>
          </div>
        )}

        <div className="px-4 mt-5 pb-5">
          <button
            onClick={handleNavigate}
            className="w-full bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white font-black text-lg uppercase tracking-wide py-5 rounded-2xl border-2 border-emerald-400/30 shadow-lg shadow-emerald-900/40 transition-all flex items-center justify-center gap-3"
          >
            <Navigation className="w-6 h-6" />
            {step.ctaText}
          </button>
          <p className="text-center text-slate-500 text-xs mt-3">
            Opens Google Maps · Come back when you arrive
          </p>
        </div>
      </div>
    );
  }

  // ── Phase: navigation launched — waiting for arrival ───────────────────────
  return (
    <div className="mx-4 mt-4 overflow-hidden shadow-xl">
      {/* En route card */}
      <div className="bg-slate-800/80 border border-slate-700/50 rounded-2xl mb-3">
        <div className="pt-4 pb-1 text-center">
          <span className="text-xs font-bold tracking-widest text-blue-400 uppercase">🚗 En Route</span>
        </div>
        <div className="text-center text-5xl mt-2 mb-2 leading-none">🗺️</div>
        <h2 className="text-center text-2xl font-black text-white px-6 leading-tight">Heading to {jobAddress.split(",")[0]}</h2>

        {/* ETA reminder */}
        {hasEta && (
          <div className="mx-4 mt-3 bg-blue-900/20 border border-blue-700/30 rounded-xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-blue-300 text-sm font-semibold">ETA {eta.etaText}</span>
            </div>
            <span className="text-slate-400 text-sm">{eta.durationText} drive</span>
          </div>
        )}

        {/* Re-open maps */}
        <div className="px-4 mt-3 mb-4">
          <button
            onClick={handleNavigate}
            className="w-full bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-slate-300 font-semibold text-sm py-3 rounded-xl border border-slate-600/50 transition-all flex items-center justify-center gap-2"
          >
            <Navigation className="w-4 h-4" />
            Re-open Maps
          </button>
        </div>
      </div>

      {/* Arrived CTA — pulses when user returns from maps */}
      <button
        onClick={onComplete}
        className={cn(
          "w-full bg-emerald-500 text-white font-black text-xl uppercase tracking-wide py-6 rounded-2xl border-2 border-emerald-400/40 shadow-xl shadow-emerald-900/50 transition-all flex items-center justify-center gap-3",
          returnedFromMaps
            ? "animate-pulse hover:animate-none hover:bg-emerald-400 active:bg-emerald-600 scale-[1.02]"
            : "opacity-70 hover:opacity-100 hover:bg-emerald-400 active:bg-emerald-600"
        )}
      >
        <CheckCircle2 className="w-7 h-7" />
        I've Arrived
      </button>
      {returnedFromMaps && (
        <p className="text-center text-emerald-400 text-sm font-semibold mt-2 animate-pulse">
          ✓ Tap to confirm you're on site
        </p>
      )}
      {!returnedFromMaps && (
        <p className="text-center text-slate-500 text-xs mt-2">
          Tap when you're parked and at the door
        </p>
      )}
    </div>
  );
}

function StepCard({ step, onComplete, jobAddress }: { step: Step; onComplete: () => void; jobAddress: string }) {
  const [loading, setLoading] = useState(false);

  // Navigate step gets its own special card with ETA
  if (step.type === "navigate") {
    return <NavigateStepCard step={step} onComplete={onComplete} jobAddress={jobAddress} />;
  }

  const handleCta = useCallback(async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    setLoading(false);
    onComplete();
  }, [onComplete]);

  return (
    <div className="mx-4 mt-4 bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden shadow-xl">
      {/* Label */}
      <div className="pt-5 pb-1 text-center">
        <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">
          {step.label}
        </span>
      </div>

      {/* Emoji */}
      <div className="text-center text-5xl mt-3 mb-2 leading-none">
        {step.emoji}
      </div>

      {/* Title */}
      <h2 className="text-center text-3xl font-black text-white px-6 leading-tight">
        {step.title}
      </h2>

      {/* Description */}
      <p className="text-center text-slate-300 text-base px-6 mt-3 leading-relaxed">
        {step.description}
      </p>

      {/* Badge (bonus / streak) */}
      {step.badge && (
        <div className="flex justify-center mt-3">
          <span className="bg-emerald-900/60 border border-emerald-700/50 text-emerald-400 text-sm font-semibold px-4 py-1.5 rounded-full">
            {step.badge}
          </span>
        </div>
      )}

      {/* Why it matters */}
      {step.whyItMatters && (
        <div className="mx-4 mt-4 bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
          <p className="text-blue-400 font-bold text-sm">Why this matters</p>
          <p className="text-slate-300 text-sm mt-1 leading-relaxed">{step.whyItMatters}</p>
        </div>
      )}

      {/* AI Coach */}
      {step.aiCoach && (
        <div className="mx-4 mt-4 bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
          <p className="text-white font-bold text-sm mb-1">🤖 AI Coach</p>
          <p className="text-slate-300 text-sm leading-relaxed">{step.aiCoach}</p>
        </div>
      )}

      {/* CTA Button */}
      <div className="px-4 mt-5 mb-2">
        <button
          onClick={handleCta}
          disabled={loading}
          className="w-full bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white font-black text-base uppercase tracking-wide py-4 rounded-2xl border-2 border-emerald-400/30 shadow-lg transition-all disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {step.ctaText}
        </button>
      </div>

      {/* Footer hint */}
      <p className="text-center text-slate-500 text-xs pb-5 mt-2 px-6">
        No dashboard. No scrolling. Finish this action to get the next one.
      </p>
    </div>
  );
}

function SignoffCard({ onComplete }: { onComplete: (result: { satisfaction: string; notes: string; signature: string }) => void }) {
  const [satisfaction, setSatisfaction] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  // Signature canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    lastPos.current = getPos(e);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    if (!pos || !lastPos.current) return;
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.stroke();
    lastPos.current = pos;
  };

  const stopDraw = () => { isDrawing.current = false; lastPos.current = null; };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleSubmit = async () => {
    if (!satisfaction) return;
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    const sig = canvasRef.current?.toDataURL() ?? "";
    setLoading(false);
    onComplete({ satisfaction, notes, signature: sig });
  };

  const options = [
    { value: "great", label: "😍 Everything looks great" },
    { value: "touchup", label: "🛠️ Needs one touch-up" },
    { value: "issue", label: "⚠️ Major issue" },
  ];

  return (
    <div className="mx-4 mt-4 bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden shadow-xl">
      <div className="pt-5 pb-1 text-center">
        <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">FINAL STEP</span>
      </div>
      <h2 className="text-center text-2xl font-black text-white px-6 mt-2">Customer Sign-off</h2>
      <p className="text-center text-slate-400 text-sm px-6 mt-1">Walk the home together before finishing.</p>

      {/* Satisfaction */}
      <div className="mx-4 mt-5 bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
        <p className="text-white font-semibold text-sm mb-3">How did everything look?</p>
        <div className="space-y-2">
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => setSatisfaction(o.value)}
              className={cn(
                "w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-all",
                satisfaction === o.value
                  ? "bg-emerald-900/60 border-emerald-500 text-white"
                  : "bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-400"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Customer Notes */}
      <div className="mx-4 mt-3 bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
        <p className="text-white font-semibold text-sm mb-2">Customer Notes</p>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Optional notes..."
          rows={3}
          className="w-full bg-slate-800 border border-blue-500/50 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 resize-none focus:outline-none focus:border-blue-400"
        />
      </div>

      {/* Signature */}
      <div className="mx-4 mt-3 bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
        <p className="text-white font-semibold text-sm mb-2">Signature</p>
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="w-full bg-white rounded-lg cursor-crosshair touch-none"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />
        <button
          onClick={clearCanvas}
          className="w-full mt-2 bg-emerald-500 hover:bg-emerald-400 text-white font-bold py-3 rounded-xl transition-all"
        >
          Clear Signature
        </button>
      </div>

      {/* Submit */}
      <div className="px-4 mt-4 mb-5">
        <button
          onClick={handleSubmit}
          disabled={!satisfaction || loading}
          className="w-full bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white font-black text-base uppercase tracking-wide py-4 rounded-2xl border-2 border-emerald-400/30 shadow-lg transition-all disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          COMPLETE SIGN-OFF
        </button>
      </div>
    </div>
  );
}

function CompletedScreen({ job }: { job: MockJob }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 px-6 text-center">
      <div className="text-6xl mb-4">🎉</div>
      <h1 className="text-3xl font-black text-white">Job Complete!</h1>
      <p className="text-slate-400 mt-2 text-base">
        {job.customerName} has been signed off. Great work!
      </p>
      <div className="mt-6 bg-slate-800 rounded-2xl p-5 w-full max-w-sm">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
          <div className="text-left">
            <p className="text-white font-bold text-sm">All steps complete</p>
            <p className="text-slate-400 text-xs mt-0.5">Customer signed off · Photos submitted</p>
          </div>
        </div>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="mt-6 bg-slate-700 hover:bg-slate-600 text-white font-semibold px-8 py-3 rounded-xl transition-all"
      >
        Back to Schedule
      </button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CleanerPortalV2() {
  const job = MOCK_JOB;
  const [stepIndex, setStepIndex] = useState(0);
  const [completed, setCompleted] = useState(false);

  const currentStep = job.steps[stepIndex];
  const isSignoff = currentStep?.type === "signoff";

  const advance = useCallback(() => {
    if (stepIndex < job.steps.length - 1) {
      setStepIndex(i => i + 1);
    } else {
      setCompleted(true);
    }
  }, [stepIndex, job.steps.length]);

  if (completed) return <CompletedScreen job={job} />;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center">
      {/* Mobile-width shell */}
      <div className="w-full max-w-[430px] min-h-screen bg-slate-900 flex flex-col relative">
        {/* Header */}
        <JobHeader job={job} stepIndex={stepIndex} totalSteps={job.steps.length} />

        {/* Step card */}
        <div className="flex-1 pb-10">
          {isSignoff ? (
            <SignoffCard onComplete={() => setCompleted(true)} />
          ) : (
            currentStep && <StepCard step={currentStep} onComplete={advance} jobAddress={job.address} />
          )}
        </div>

        {/* Dev nav (remove before production) */}
        <div className="fixed bottom-4 right-4 flex gap-2 opacity-30 hover:opacity-100 transition-opacity z-50">
          <button
            onClick={() => setStepIndex(i => Math.max(0, i - 1))}
            className="bg-slate-700 text-white p-2 rounded-lg"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="bg-slate-700 text-white px-3 py-2 rounded-lg text-xs font-mono">
            {stepIndex + 1}/{job.steps.length}
          </span>
          <button
            onClick={() => setStepIndex(i => Math.min(job.steps.length - 1, i + 1))}
            className="bg-slate-700 text-white p-2 rounded-lg"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
