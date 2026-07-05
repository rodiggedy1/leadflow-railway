/**
 * CleanerPortalV2 — /portal-v2
 *
 * Step-through job runner for cleaners. One action at a time.
 * Wired to real data via trpc.cleaner.getMyJobsToday.
 *
 * Design: Dark navy (#0f172a / #1e293b), green CTA (#22c55e), white text.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2, MapPin, CheckCircle2, Camera, ChevronLeft, ChevronRight, Navigation } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { EXTRAS_LIST } from "@shared/extras";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a job start time string like "10:00 AM" into a Unix ms timestamp for today.
 * Used as ETA fallback when GPS is unavailable.
 */
function parseJobTime(timeStr: string): number | null {
  try {
    const now = new Date();
    const [time, meridiem] = timeStr.trim().split(' ');
    const [hoursStr, minutesStr] = time.split(':');
    let hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr ?? '0', 10);
    if (meridiem?.toUpperCase() === 'PM' && hours !== 12) hours += 12;
    if (meridiem?.toUpperCase() === 'AM' && hours === 12) hours = 0;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
    return isNaN(d.getTime()) ? null : d.getTime();
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type StepType =
  | "navigate"
  | "arrived"
  | "greet"
  | "before_photos"
  | "after_photos"
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
  photoType?: "before" | "after" | "general"; // explicit photoType for upload
}

/** Shape returned by trpc.cleaner.getMyJobsToday */
interface PortalJob {
  cleanerJobId: number;
  completedJobId: number;
  customerName: string;
  customerPhone: string;
  address: string;
  time: string;                 // display time, also used as ETA fallback e.g. "10:00 AM"
  serviceDateTime: string;
  bathrooms: number;
  extras: string[];             // extra keys from booking
  checklistItems: Array<{ text: string; checked: boolean }>;
  bookingStatus: string;
  jobIndex: number;
  totalJobsToday: number;
}

// ── Extras that require a dedicated photo step ────────────────────────────────

const PHYSICAL_EXTRAS_PHOTO_KEYS = new Set([
  "clean_inside_oven",
  "clean_inside_empty_fridge",
  "clean_inside_full_fridge",
  "clean_inside_microwave",
  "clean_interior_windows",
  "clean_finished_basement",
  "sweep_garage",
  "balcony_sweep",
  "shed_pool_house",
  "pool_deck",
]);

/** Build the extras label map once from the shared catalog */
const EXTRAS_LABEL: Record<string, string> = Object.fromEntries(
  EXTRAS_LIST.map(e => [e.key, e.label])
);

// ── Dynamic Step Builder ──────────────────────────────────────────────────────

function buildStepsFromJob(job: PortalJob): Step[] {
  const steps: Step[] = [];

  // 1. Navigate
  steps.push({
    id: "navigate",
    type: "navigate",
    label: "NEXT REQUIRED ACTION",
    emoji: "🚗",
    title: "Start Navigation",
    description: "Leave now. You'll arrive a few minutes early and the customer will get an automatic on-my-way text.",
    whyItMatters: "Being early protects the review before the cleaning even begins.",
    ctaText: "START NAVIGATION",
  });

  // 2. Greet
  steps.push({
    id: "greet",
    type: "greet",
    label: "NEXT REQUIRED ACTION",
    emoji: "👋",
    title: "Greet Customer",
    description: "Introduce yourself, confirm the requested rooms, and ask if there are priority areas.",
    whyItMatters: "A strong greeting reduces complaints because expectations are clear before cleaning starts.",
    ctaText: "CUSTOMER GREETED",
  });

  // 3. Before photos
  steps.push({
    id: "before_photos",
    type: "before_photos",
    label: "NEXT REQUIRED ACTION",
    emoji: "📷",
    title: "Take Before Photos",
    description: "Photograph kitchen, bathroom, and any problem areas before cleaning starts.",
    whyItMatters: "Before photos protect the team and make the after photos more impressive.",
    ctaText: "BEFORE PHOTOS DONE",
    photoType: "before",
  });

  // 4. Checklist items (from booking notes / custom checklist)
  for (const item of job.checklistItems) {
    const safeId = item.text.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 30);
    steps.push({
      id: `checklist_${safeId}`,
      type: "checklist_item",
      label: "NEXT REQUIRED ACTION",
      emoji: "🧽",
      title: item.text,
      description: "Complete this checklist item before moving on.",
      whyItMatters: "Paid add-ons are the easiest place to create a complaint if missed.",
      ctaText: "DONE",
    });
  }

  // 5. Bathroom photo steps (one per bathroom)
  for (let i = 1; i <= job.bathrooms; i++) {
    const label = job.bathrooms > 1 ? `Bathroom ${i}` : "Bathroom";
    steps.push({
      id: `bathroom_${i}_photos`,
      type: "photo_objective",
      label: "YOUR NEXT OBJECTIVE",
      emoji: "🚿",
      title: `Photograph ${label}`,
      description: `Take after photos of ${label.toLowerCase()} — toilet, sink, shower/tub, and floor.`,
      aiCoach: "Get a wide shot of the whole room, then close-ups of the toilet and sink.",
      badge: "+$5 Bonus",
      ctaText: "PHOTOS DONE",
      photoType: "after",
    });
  }

  // 6. Kitchen photo step (always)
  steps.push({
    id: "kitchen_photos",
    type: "photo_objective",
    label: "YOUR NEXT OBJECTIVE",
    emoji: "🍳",
    title: "Photograph Kitchen",
    description: "Take after photos of the kitchen — sink, counters, stovetop, and appliances.",
    aiCoach: "Take a close-up of the sink and counters before leaving the kitchen.",
    badge: "+$5 Bonus",
    ctaText: "PHOTOS DONE",
    photoType: "after",
  });

  // 7. Extra-specific photo steps (only for physical extras that need documentation)
  for (const extraKey of job.extras) {
    if (!PHYSICAL_EXTRAS_PHOTO_KEYS.has(extraKey)) continue;
    const label = EXTRAS_LABEL[extraKey] ?? extraKey.replace(/_/g, " ");
    steps.push({
      id: `extra_${extraKey}_photos`,
      type: "photo_objective",
      label: "PAID ADD-ON — PHOTO REQUIRED",
      emoji: "📸",
      title: `Photograph: ${label}`,
      description: `Customer paid for ${label}. Take a clear after photo showing the completed work.`,
      whyItMatters: "Paid add-ons need photo proof — this is the #1 source of complaints when skipped.",
      badge: "Paid Add-on",
      ctaText: "PHOTO DONE",
      photoType: "after",
    });
  }

  // 8. After photos (rest of house)
  steps.push({
    id: "after_photos",
    type: "after_photos",
    label: "NEXT REQUIRED ACTION",
    emoji: "📸",
    title: "Take After Photos",
    description: "Photograph every room you cleaned — bedrooms, living areas, hallways. Aim for 10+ photos total.",
    whyItMatters: "After photos unlock the +$5 bonus and protect the team if a customer claims something was missed.",
    badge: "+$5 Bonus at 10 photos",
    ctaText: "AFTER PHOTOS DONE",
    photoType: "after",
  });

  // 9. Walk through
  steps.push({
    id: "walk_through",
    type: "walk_through",
    label: "YOUR NEXT OBJECTIVE",
    emoji: "😊",
    title: "Walk Customer Through Home",
    description: "This is the biggest predictor of 5-star reviews.",
    aiCoach: "Ask: 'Is there anything you'd like us to touch up while we're here?'",
    ctaText: "WALK-THROUGH DONE",
  });

  // 10. Sign-off
  steps.push({
    id: "signoff",
    type: "signoff",
    label: "FINAL STEP",
    emoji: "✍️",
    title: "Customer Sign-off",
    description: "Walk the home together before finishing.",
    ctaText: "COMPLETE SIGN-OFF",
  });

  // 11. Next job (only if more jobs today)
  if (job.totalJobsToday > 1 && job.jobIndex < job.totalJobsToday) {
    steps.push({
      id: "next_job",
      type: "next_job",
      label: "YOUR NEXT OBJECTIVE",
      emoji: "🚀",
      title: `Start Job #${job.jobIndex + 1}`,
      description: `Everything is complete. Time for the next customer.`,
      badge: "Next Job Unlocked",
      ctaText: `Start Job #${job.jobIndex + 1} →`,
    });
  }

  return steps;
}

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

function JobHeader({ job, stepIndex, totalSteps }: { job: PortalJob; stepIndex: number; totalSteps: number }) {
  return (
    <div className="px-4 pt-5 pb-3 bg-slate-900">
      <h1 className="text-2xl font-black text-white leading-tight">
        Job for {job.customerName}
      </h1>
      <p className="text-slate-400 text-sm mt-0.5">
        Job {job.jobIndex} of {job.totalJobsToday} · {job.time} · {job.address.split(",")[0]}
      </p>
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="bg-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-black text-white">{job.bathrooms}🛁</div>
          <div className="text-xs text-slate-400 mt-0.5">bathrooms</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-black text-white">{job.extras.length > 0 ? `+${job.extras.length}` : "—"}</div>
          <div className="text-xs text-slate-400 mt-0.5">add-ons</div>
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

function NavigateStepCard({ step, onComplete, jobAddress, cleanerJobId, jobStartTime }: { step: Step; onComplete: () => void; jobAddress: string; cleanerJobId: number | null; jobStartTime: string }) {
  const [gpsState, setGpsState] = useState<"idle" | "fetching" | "ready" | "error">("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [etaEnabled, setEtaEnabled] = useState(false);
  // After user taps START NAVIGATION, show the pulsing "I've Arrived" CTA
  const LAUNCHED_KEY = `portal_v2_launched_${cleanerJobId ?? 'mock'}`;
  const [hasLaunched, setHasLaunched] = useState(() => {
    try { return sessionStorage.getItem(LAUNCHED_KEY) === '1'; } catch { return false; }
  });
  // When user returns from maps (tab becomes visible again), pulse the arrived button
  // If hasLaunched is already true on mount (restored from sessionStorage), pulse immediately
  const [returnedFromMaps, setReturnedFromMaps] = useState(() => {
    try { return sessionStorage.getItem(LAUNCHED_KEY) === '1'; } catch { return false; }
  });
  const etaQuery = trpc.cleaner.getDriveEta.useQuery(
    { originLat: coords?.lat ?? 0, originLng: coords?.lng ?? 0, destination: jobAddress },
    { enabled: etaEnabled && !!coords, retry: false, throwOnError: false }
  );
  const statusMutation = trpc.cleaner.updateJobStatus.useMutation({ throwOnError: false });
  // Request GPS on mount
  useEffect(() => {
    if (!navigator?.geolocation) {
      setGpsState("error");
      return;
    }
    setGpsState("fetching");
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setGpsState("ready");
          setEtaEnabled(true);
        },
        () => setGpsState("error"),
        { timeout: 8000, maximumAge: 60000 }
      );
    } catch {
      setGpsState("error");
    }
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
    try { sessionStorage.setItem(LAUNCHED_KEY, '1'); } catch {}
    // On desktop (new tab), visibilitychange won't fire — set returnedFromMaps after a short delay
    setTimeout(() => setReturnedFromMaps(true), 1500);
    // Fire on_the_way status update — sends customer the "on my way" SMS
    if (cleanerJobId) {
      const etaData = etaQuery.data;
      let etaTimestampOverride: number | undefined;
      let etaLabel: string | undefined;
      if (etaData?.ok && etaData.durationSeconds) {
        // GPS worked — use real drive time
        etaTimestampOverride = Date.now() + etaData.durationSeconds * 1000;
        etaLabel = etaData.durationText ?? undefined;
      } else {
        // GPS unavailable — fall back to job scheduled start time so SMS always has a real ETA
        const fallbackTs = parseJobTime(jobStartTime);
        if (fallbackTs) {
          etaTimestampOverride = fallbackTs;
          etaLabel = jobStartTime;
        }
      }
      statusMutation.mutate({ cleanerJobId, status: "on_the_way", etaTimestampOverride, etaLabel });
    }
  };

  // ── Phase: not yet launched — show the navigate CTA ──────────────────────
  if (!hasLaunched) {
    return (
      <div className="mx-4 mt-4 bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden shadow-xl">
        <div className="pt-5 pb-1 text-center">
          <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">{step.label}</span>
        </div>
        <div className="text-center text-5xl mt-3 mb-2 leading-none">{step.emoji}</div>
        <h2 className="text-center text-3xl font-black text-white px-6 leading-tight">{step.title}</h2>
        <p className="text-center text-slate-300 text-base px-6 mt-3 leading-relaxed">{step.description}</p>
        {/* GPS ETA badge */}
        <div className="mx-4 mt-4 bg-slate-900/60 border border-slate-700/40 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-slate-400" />
            <span className="text-slate-300 text-sm font-semibold truncate max-w-[180px]">{jobAddress.split(",")[0]}</span>
          </div>
          {gpsState === "fetching" && (
            <div className="flex items-center gap-1.5 text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-xs">Getting ETA…</span>
            </div>
          )}
          {gpsState === "ready" && hasEta && (
            <div className="text-right">
              <div className="text-emerald-400 font-black text-sm">{eta.etaText}</div>
              <div className="text-slate-400 text-xs mt-0.5">arrive by</div>
            </div>
          )}
          {(gpsState === "error" || (gpsState === "ready" && !hasEta)) && (
            <div className="flex items-center gap-2 text-slate-500">
              <span className="text-xs">Tap to get directions</span>
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
        {/* ETA reminder — show GPS ETA if available, else show scheduled start time */}
        <div className="mx-4 mt-3 bg-blue-900/20 border border-blue-700/30 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-blue-300 text-sm font-semibold">
              {hasEta ? `ETA ${eta.etaText}` : `Scheduled ${jobStartTime}`}
            </span>
          </div>
          {hasEta
            ? <span className="text-slate-400 text-sm">{eta.durationText} drive</span>
            : <span className="text-slate-500 text-xs">GPS unavailable</span>
          }
        </div>
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
        onClick={() => {
          try { sessionStorage.removeItem(LAUNCHED_KEY); } catch {}
          if (cleanerJobId) {
            statusMutation.mutate(
              { cleanerJobId, status: "arrived" },
              { onSuccess: onComplete, onError: onComplete }
            );
          } else {
            onComplete();
          }
        }}
        disabled={statusMutation.isPending}
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

// ── Photo Step Card ───────────────────────────────────────────────────────────
function PhotoStepCard({ step, onComplete, cleanerJobId, completedJobId }: {
  step: Step;
  onComplete: () => void;
  cleanerJobId: number | null;
  completedJobId: number;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [photos, setPhotos] = useState<{ id: number; photoUrl: string; filename: string | null }[]>([]);

  const uploadMutation = trpc.cleaner.uploadPhoto.useMutation({
    throwOnError: false,
    onError: (err) => console.error('Upload failed:', err.message),
  });

  // Determine photoType: use explicit step.photoType, fall back to step.type derivation
  const resolvedPhotoType: "before" | "after" | "general" =
    step.photoType ?? (
      step.type === 'before_photos' ? 'before'
      : step.type === 'after_photos' ? 'after'
      : 'general'
    );

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const oversized = files.filter(f => f.size > 8 * 1024 * 1024);
    const valid = files.filter(f => f.size <= 8 * 1024 * 1024);
    if (oversized.length > 0) alert(`${oversized.length} photo(s) exceed 8MB and were skipped`);
    if (valid.length === 0) return;

    setUploading(true);
    setUploadProgress({ current: 0, total: valid.length });
    for (let i = 0; i < valid.length; i++) {
      setUploadProgress({ current: i + 1, total: valid.length });
      // Show local preview immediately
      const localUrl = URL.createObjectURL(valid[i]);
      setPhotos(prev => [...prev, { id: Date.now() + i, photoUrl: localUrl, filename: valid[i].name }]);

      if (cleanerJobId) {
        // Upload to server in background
        await new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            uploadMutation.mutate(
              {
                cleanerJobId, completedJobId, filename: valid[i].name, mimeType: valid[i].type, dataBase64: base64,
                photoType: resolvedPhotoType,
              },
              { onSettled: () => resolve() }
            );
          };
          reader.readAsDataURL(valid[i]);
        });
      }
    }
    setUploadProgress(null);
    setUploading(false);
    e.target.value = '';
  }, [cleanerJobId, completedJobId, uploadMutation, resolvedPhotoType]);

  const minPhotos = 1;
  const canAdvance = photos.length >= minPhotos;

  return (
    <div className="mx-4 mt-4 bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden shadow-xl">
      {/* Label */}
      <div className="pt-5 pb-1 text-center">
        <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">{step.label}</span>
      </div>
      <div className="text-center text-5xl mt-3 mb-2 leading-none">{step.emoji}</div>
      <h2 className="text-center text-3xl font-black text-white px-6 leading-tight">{step.title}</h2>
      <p className="text-center text-slate-300 text-base px-6 mt-3 leading-relaxed">{step.description}</p>
      {step.whyItMatters && (
        <div className="mx-4 mt-4 bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
          <p className="text-blue-400 font-bold text-sm">Why this matters</p>
          <p className="text-slate-300 text-sm mt-1 leading-relaxed">{step.whyItMatters}</p>
        </div>
      )}
      {/* Photo grid */}
      {photos.length > 0 && (
        <div className="mx-4 mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">{photos.length} photo{photos.length !== 1 ? 's' : ''} uploaded</span>
            {photos.length >= 10 && <span className="text-emerald-400 text-xs font-bold">✓ Bonus earned</span>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {photos.map(p => (
              <a key={p.id} href={p.photoUrl} target="_blank" rel="noreferrer">
                <img src={p.photoUrl} alt={p.filename ?? 'Photo'} className="w-full h-20 object-cover rounded-lg border border-slate-600 hover:opacity-80 transition-opacity" />
              </a>
            ))}
          </div>
          {/* Progress bar toward 10-photo bonus */}
          {photos.length < 10 && (
            <div className="mt-2">
              <div className="w-full bg-slate-700 rounded-full h-1.5">
                <div className="bg-amber-400 h-1.5 rounded-full transition-all" style={{ width: `${Math.min((photos.length / 10) * 100, 100)}%` }} />
              </div>
              <p className="text-amber-500 text-[10px] mt-0.5">{photos.length}/10 — {10 - photos.length} more for +$5 bonus</p>
            </div>
          )}
        </div>
      )}
      {/* Upload + progress */}
      <div className="px-4 mt-4">
        {uploading && uploadProgress && (
          <div className="mb-3 bg-slate-900/60 border border-slate-700/40 rounded-xl px-4 py-3 flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            <span className="text-slate-300 text-sm">
              Uploading {uploadProgress.current}/{uploadProgress.total}...
            </span>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-white font-semibold text-base py-4 rounded-2xl border border-slate-600/50 transition-all disabled:opacity-60 flex items-center justify-center gap-3"
        >
          {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
          {uploading ? `Uploading ${uploadProgress?.current ?? ''}/${uploadProgress?.total ?? ''}...` : photos.length > 0 ? 'Add More Photos' : 'Open Camera / Gallery'}
        </button>
      </div>
      {/* Done CTA — only enabled once at least 1 photo uploaded */}
      <div className="px-4 mt-3 mb-2">
        <button
          onClick={onComplete}
          disabled={!canAdvance || uploading}
          className={cn(
            "w-full font-black text-base uppercase tracking-wide py-4 rounded-2xl border-2 shadow-lg transition-all flex items-center justify-center gap-2",
            canAdvance
              ? "bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white border-emerald-400/30 shadow-emerald-900/40"
              : "bg-slate-700 text-slate-500 border-slate-600/30 cursor-not-allowed"
          )}
        >
          <CheckCircle2 className="w-4 h-4" />
          {canAdvance ? step.ctaText : `Upload at least 1 photo to continue`}
        </button>
      </div>
      <p className="text-center text-slate-500 text-xs pb-5 mt-1 px-6">
        {canAdvance ? `${photos.length} photo${photos.length !== 1 ? 's' : ''} ready · tap done to continue` : 'Take photos first, then tap done'}
      </p>
    </div>
  );
}

function StepCard({ step, onComplete, jobAddress, cleanerJobId, completedJobId, jobStartTime }: { step: Step; onComplete: () => void; jobAddress: string; cleanerJobId: number | null; completedJobId: number; jobStartTime: string }) {
  const [loading, setLoading] = useState(false);
  // MUST be before any conditional return — React hooks rules
  const handleCta = useCallback(() => {
    setLoading(true);
    setTimeout(() => { setLoading(false); onComplete(); }, 400);
  }, [onComplete]);
  // Navigate step gets its own special card with ETA
  if (step.type === "navigate") {
    return <NavigateStepCard step={step} onComplete={onComplete} jobAddress={jobAddress} cleanerJobId={cleanerJobId} jobStartTime={jobStartTime} />;
  }
  // Photo steps get the camera upload card
  if (step.type === 'before_photos' || step.type === 'after_photos' || step.type === 'photo_objective') {
    return <PhotoStepCard step={step} onComplete={onComplete} cleanerJobId={cleanerJobId} completedJobId={completedJobId} />;
  }
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

function SignoffCard({ onComplete, cleanerJobId }: { onComplete: (result: { satisfaction: string; notes: string; signature: string }) => void; cleanerJobId: number | null }) {
  const [satisfaction, setSatisfaction] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const saveSignatureMutation = trpc.cleaner.saveSignature.useMutation({ throwOnError: false });
  const saveNotHomeMutation = trpc.cleaner.saveNotHome.useMutation({ throwOnError: false });

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
    const canvas = canvasRef.current;
    const sig = canvas?.toDataURL("image/png") ?? "";

    // Upload signature + save customer response to DB if we have a real job
    if (cleanerJobId) {
      const base64 = (sig && sig !== "data:,") ? sig.split(",")[1] : undefined;
      await new Promise<void>((resolve) => {
        saveSignatureMutation.mutate(
          {
            cleanerJobId,
            signatureBase64: base64 ?? "",
            customerResponse: satisfaction,
            customerNotes: notes || undefined,
            customerNotHome: false,
          },
          { onSettled: () => resolve() }
        );
      });
    }

    setLoading(false);
    onComplete({ satisfaction, notes, signature: sig });
  };

  const handleNotHome = async () => {
    setLoading(true);
    if (cleanerJobId) {
      await new Promise<void>((resolve) => {
        saveNotHomeMutation.mutate(
          { cleanerJobId },
          { onSettled: () => resolve() }
        );
      });
    }
    setLoading(false);
    onComplete({ satisfaction: "not_home", notes: "", signature: "" });
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
      <div className="px-4 mt-4 mb-2">
        <button
          onClick={handleSubmit}
          disabled={!satisfaction || loading}
          className="w-full bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white font-black text-base uppercase tracking-wide py-4 rounded-2xl border-2 border-emerald-400/30 shadow-lg transition-all disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          COMPLETE SIGN-OFF
        </button>
      </div>

      {/* Customer Not Home bypass */}
      <div className="px-4 mb-5">
        <button
          onClick={handleNotHome}
          disabled={loading}
          className="w-full bg-transparent border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 text-sm py-3 rounded-2xl transition-all flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>🚪</span>}
          Customer not home — skip sign-off
        </button>
      </div>
    </div>
  );
}

function CompletedScreen({ customerName }: { customerName: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 px-6 text-center">
      <div className="text-6xl mb-4">🎉</div>
      <h1 className="text-3xl font-black text-white">Job Complete!</h1>
      <p className="text-slate-400 mt-2 text-base">
        {customerName} has been signed off. Great work!
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
      {/* Dev reset — clears sessionStorage so the portal restarts from step 1 */}
      <button
        onClick={() => { try { sessionStorage.clear(); } catch {} window.location.reload(); }}
        className="mt-3 text-slate-600 text-xs underline"
      >
        Reset (dev)
      </button>
    </div>
  );
}

// ── Single Job Runner ─────────────────────────────────────────────────────────

function JobRunner({ job }: { job: PortalJob }) {
  const steps = buildStepsFromJob(job);

  const SESSION_KEY = `portal_v2_step_${job.cleanerJobId}`;
  const COMPLETED_KEY = `portal_v2_completed_${job.cleanerJobId}`;

  const [stepIndex, setStepIndex] = useState(() => {
    try {
      const saved = parseInt(sessionStorage.getItem(SESSION_KEY) ?? "0", 10) || 0;
      return Math.min(saved, Math.max(0, steps.length - 1));
    } catch { return 0; }
  });

  const [completed, setCompleted] = useState(() => {
    try { return sessionStorage.getItem(COMPLETED_KEY) === "1"; } catch { return false; }
  });

  // markComplete mutation — fires when sign-off is submitted
  const markCompleteMutation = trpc.cleaner.markComplete.useMutation({ throwOnError: false });

  // Persist step index so navigating back from maps restores the right step
  useEffect(() => {
    try { sessionStorage.setItem(SESSION_KEY, String(stepIndex)); } catch {}
  }, [stepIndex, SESSION_KEY]);

  const currentStep = steps[stepIndex];
  const isSignoff = currentStep?.type === "signoff";

  const advance = useCallback(() => {
    setStepIndex(i => {
      if (i < steps.length - 1) return i + 1;
      setCompleted(true);
      return i;
    });
  }, [steps.length]);

  const handleSignoffComplete = useCallback(() => {
    try { sessionStorage.setItem(COMPLETED_KEY, "1"); } catch {}
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    if (job.cleanerJobId) {
      markCompleteMutation.mutate(
        { cleanerJobId: job.cleanerJobId },
        { onSettled: () => setCompleted(true) }
      );
    } else {
      setCompleted(true);
    }
  }, [job.cleanerJobId, markCompleteMutation, SESSION_KEY, COMPLETED_KEY]);

  if (completed) return <CompletedScreen customerName={job.customerName} />;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center">
      <div className="w-full max-w-[430px] min-h-screen bg-slate-900 flex flex-col relative">
        <JobHeader job={job} stepIndex={stepIndex} totalSteps={steps.length} />
        <div className="flex-1 pb-10">
          {isSignoff ? (
            <SignoffCard onComplete={handleSignoffComplete} cleanerJobId={job.cleanerJobId} />
          ) : (
            currentStep && (
              <StepCard
                step={currentStep}
                onComplete={advance}
                jobAddress={job.address}
                cleanerJobId={job.cleanerJobId}
                completedJobId={job.completedJobId}
                jobStartTime={job.time}
              />
            )
          )}
        </div>
        {/* Dev nav — step through for testing */}
        <div className="fixed bottom-4 right-4 flex gap-2 opacity-30 hover:opacity-100 transition-opacity z-50">
          <button
            onClick={() => setStepIndex(i => Math.max(0, i - 1))}
            className="bg-slate-700 text-white p-2 rounded-lg"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="bg-slate-700 text-white px-3 py-2 rounded-lg text-xs font-mono">
            {stepIndex + 1}/{steps.length}
          </span>
          <button
            onClick={() => setStepIndex(i => Math.min(steps.length - 1, i + 1))}
            className="bg-slate-700 text-white p-2 rounded-lg"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CleanerPortalV2() {
  // Auth guard — check session before loading jobs.
  // If the cookie is absent or expired, redirect to /cleaner (which has the login form).
  const meQuery = trpc.cleaner.me.useQuery(undefined, { retry: false, throwOnError: false });

  const { data: jobs, isLoading, error } = trpc.cleaner.getMyJobsToday.useQuery(undefined, {
    enabled: meQuery.data != null, // only run once session is confirmed
    retry: 1,
    throwOnError: false,
  });

  // Track which job index we're on (for multi-job days)
  const [activeJobIdx, setActiveJobIdx] = useState(0);

  // Session loading
  if (meQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    );
  }

  // Not authenticated — send to /cleaner which has the login form
  if (!meQuery.data) {
    window.location.replace("/cleaner");
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Redirecting to login…</p>
      </div>
    );
  }

  // Jobs loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Loading today's jobs…</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="text-2xl font-black text-white">Could not load jobs</h1>
        <p className="text-slate-400 mt-2 text-sm">{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold px-8 py-3 rounded-xl transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  // No jobs today
  if (!jobs || jobs.length === 0) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl mb-4">🌟</div>
        <h1 className="text-2xl font-black text-white">No Jobs Today</h1>
        <p className="text-slate-400 mt-2 text-sm">
          You don't have any jobs scheduled for today. Check back tomorrow!
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 bg-slate-700 hover:bg-slate-600 text-white font-semibold px-8 py-3 rounded-xl transition-all"
        >
          Refresh
        </button>
      </div>
    );
  }

  const activeJob = jobs[activeJobIdx] ?? jobs[0];

  // Render the active job runner
  // Key on cleanerJobId so state resets when switching jobs
  return (
    <JobRunner
      key={activeJob.cleanerJobId}
      job={activeJob}
    />
  );
}
