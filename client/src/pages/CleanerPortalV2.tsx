/**
 * CleanerPortalV2 — /portal-v2
 *
 * Step-through job runner for cleaners. One action at a time.
 * Wired to real data via trpc.cleaner.getMyJobsToday.
 *
 * Design: Dark navy (#0f172a / #1e293b), green CTA (#22c55e), white text.
 */
import { useState, useRef, useCallback, useEffect, useMemo, createContext, useContext } from "react";
import { Loader2, MapPin, CheckCircle2, Camera, ChevronLeft, ChevronRight, Navigation, CalendarDays, Calendar, FileText, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { EXTRAS_LIST } from "@shared/extras";


// ── Language Picker ───────────────────────────────────────────────────────────
function LanguagePicker() {
  const { t, i18n: i18nInst } = useTranslation();
  const updateLang = trpc.cleaner.updateLanguage.useMutation({ throwOnError: false });
  const current = i18nInst.language as 'en' | 'es' | 'pt';
  const langs: { code: 'en' | 'es' | 'pt'; label: string }[] = [
    { code: 'en', label: t('lang.en') },
    { code: 'es', label: t('lang.es') },
    { code: 'pt', label: t('lang.pt') },
  ];
  const handleChange = (code: 'en' | 'es' | 'pt') => {
    i18nInst.changeLanguage(code);
    updateLang.mutate({ language: code });
  };
  return (
    <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1">
      {langs.map(l => (
        <button
          key={l.code}
          onClick={() => handleChange(l.code)}
          className={cn(
            'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all',
            current === l.code
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-400 hover:text-white'
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}


// ── Notes Popup ──────────────────────────────────────────────────────────────

function NotesPopup({ customerNotes, staffNotes, onClose }: { customerNotes: string | null; staffNotes: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const hasNotes = !!(customerNotes?.trim() || staffNotes?.trim());
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-[430px] bg-slate-900 rounded-t-3xl px-5 pt-5 pb-10 space-y-4 border-t border-slate-700"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-1" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-yellow-400" />
            <h2 className="text-white font-bold text-base">{t('v2.notes.title')}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1"><X className="w-5 h-5" /></button>
        </div>
        {!hasNotes && <p className="text-slate-500 text-sm text-center py-4">{t('v2.notes.empty')}</p>}
        {customerNotes?.trim() && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">{t('v2.notes.customerLabel')}</p>
            <div className="bg-blue-950/50 border border-blue-800/40 rounded-xl px-4 py-3">
              <p className="text-slate-200 text-sm whitespace-pre-wrap leading-relaxed">{customerNotes.trim()}</p>
            </div>
          </div>
        )}
        {staffNotes?.trim() && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">{t('v2.notes.staffLabel')}</p>
            <div className="bg-amber-950/40 border border-amber-800/40 rounded-xl px-4 py-3">
              <p className="text-slate-200 text-sm whitespace-pre-wrap leading-relaxed">{staffNotes.trim()}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


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
  jobDate: string;               // YYYY-MM-DD in ET, used for date label display
  serviceDateTime: string;
  bathrooms: number;
  extras: string[];             // extra keys from booking
  checklistItems: Array<{ text: string; checked: boolean }>;
  bookingStatus: string;
  jobStatus: string;
  jobIndex: number;
  totalJobsToday: number;
  basePay: number | null;
  customerNotes: string | null;
  staffNotes: string | null;
}

// ── Extras that require a dedicated photo step ────────────────────────────────

const PHYSICAL_EXTRAS_PHOTO_KEYS = new Set([
  "clean_inside_oven",
  "clean_inside_empty_fridge",
  "clean_inside_full_fridge",
  "clean_inside_microwave",
  "clean_inside_cabinets",
  "clean_interior_windows",
  "clean_finished_basement",
  "wipe_walls",
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

// ── Location Context ────────────────────────────────────────────────────────
/**
 * LocationProvider owns geolocation permission for the entire portal session.
 * Child components never call getCurrentPosition directly — they call requestLocation()
 * which fires a fresh fetch at the moment it's needed (e.g. when the cleaner taps
 * "Start Navigation"). Permission is requested once; subsequent calls reuse the
 * browser's granted state without re-prompting.
 */
type LocationState = {
  permissionState: "unknown" | "granted" | "denied" | "unavailable";
  requestLocation: () => Promise<{ lat: number; lng: number } | null>;
};

const LocationContext = createContext<LocationState>({
  permissionState: "unknown",
  requestLocation: async () => null,
});

function LocationProvider({ children }: { children: React.ReactNode }) {
  const [permissionState, setPermissionState] = useState<LocationState["permissionState"]>("unknown");

  // Check permission state on mount (no prompt — just query)
  useEffect(() => {
    if (!navigator?.permissions) return;
    navigator.permissions.query({ name: "geolocation" }).then((result) => {
      if (result.state === "granted") setPermissionState("granted");
      else if (result.state === "denied") setPermissionState("denied");
      result.onchange = () => {
        if (result.state === "granted") setPermissionState("granted");
        else if (result.state === "denied") setPermissionState("denied");
      };
    }).catch(() => {});
  }, []);

  const requestLocation = useCallback((): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator?.geolocation) {
        setPermissionState("unavailable");
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setPermissionState("granted");
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          setPermissionState("denied");
          resolve(null);
        },
        { timeout: 8000, maximumAge: 0 }
      );
    });
  }, []);

  return (
    <LocationContext.Provider value={{ permissionState, requestLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

function useLocation() {
  return useContext(LocationContext);
}

// ── Navigate Step Card ───────────────────────────────────────────────────────
function NavigateStepCard({ step, onComplete, jobAddress, cleanerJobId, jobStartTime, customerName }: { step: Step; onComplete: () => void; jobAddress: string; cleanerJobId: number | null; jobStartTime: string; customerName: string }) {
  const { t } = useTranslation();
  const { requestLocation } = useLocation();
  const [gpsState, setGpsState] = useState<"idle" | "fetching" | "ready" | "error">("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [etaEnabled, setEtaEnabled] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
  // Location is fetched inside handleNavigate at tap time — never on mount.
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
  const utils = trpc.useUtils();
    /** Opens maps + fires on_the_way SMS. Only called on the FIRST launch. */
  const handleNavigate = useCallback(async () => {
    const dest = encodeURIComponent(jobAddress);
    const url = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      ? `maps://maps.apple.com/?daddr=${dest}&dirflg=d`
      : `https://maps.google.com/?daddr=${dest}&travelmode=driving`;
    // 1. Launch maps immediately — don't block the user on GPS
    window.open(url, "_blank");
    setHasLaunched(true);
    try { sessionStorage.setItem(LAUNCHED_KEY, '1'); } catch {}
    setTimeout(() => setReturnedFromMaps(true), 1500);
    // 2. Fetch fresh GPS coords (user-gesture triggered — no auto-prompt on mount)
    const freshCoords = await requestLocation();
    if (freshCoords) {
      setCoords(freshCoords);
      setGpsState("ready");
    } else {
      setGpsState("error");
    }
    // 3. Resolve ETA imperatively before firing the status mutation.
    let etaTimestampOverride: number | undefined;
    let etaLabel: string | undefined;
    if (freshCoords) {
      try {
        const etaData = await utils.cleaner.getDriveEta.fetch({
          originLat: freshCoords.lat,
          originLng: freshCoords.lng,
          destination: jobAddress,
        });
        if (etaData?.ok && etaData.durationSeconds) {
          etaTimestampOverride = Date.now() + etaData.durationSeconds * 1000;
          etaLabel = etaData.durationText ?? undefined;
          setEtaEnabled(true);
        }
      } catch {
        // ETA fetch failed — fall through to scheduled time fallback
      }
    }
    if (!etaTimestampOverride) {
      const fallbackTs = parseJobTime(jobStartTime);
      if (fallbackTs) {
        etaTimestampOverride = fallbackTs;
        etaLabel = jobStartTime;
      }
    }
    // 4. Fire on_the_way — ETA is fully resolved before this call
    if (cleanerJobId) {
      statusMutation.mutate({ cleanerJobId, status: "on_the_way", etaTimestampOverride, etaLabel });
    }
  }, [jobAddress, cleanerJobId, jobStartTime, requestLocation, utils, statusMutation, LAUNCHED_KEY]);

  /** Re-opens maps ONLY — no SMS, no status mutation. Safe to call multiple times. */
  const handleReopenMaps = useCallback(() => {
    const dest = encodeURIComponent(jobAddress);
    const url = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      ? `maps://maps.apple.com/?daddr=${dest}&dirflg=d`
      : `https://maps.google.com/?daddr=${dest}&travelmode=driving`;
    window.open(url, "_blank");
    setTimeout(() => setReturnedFromMaps(true), 1500);
  }, [jobAddress]);

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
              <span className="text-xs">{t('v2.nav.gettingEta')}</span>
            </div>
          )}
          {gpsState === "ready" && hasEta && (
            <div className="text-right">
              <div className="text-emerald-400 font-black text-sm">{eta.etaText}</div>
              <div className="text-slate-400 text-xs mt-0.5">{t('v2.nav.arriveBy')}</div>
            </div>
          )}
          {(gpsState === "error" || (gpsState === "ready" && !hasEta)) && (
            <div className="flex items-center gap-2 text-slate-500">
              <span className="text-xs">{t('v2.nav.tapForDirections')}</span>
            </div>
          )}
        </div>
        {step.whyItMatters && (
          <div className="mx-4 mt-3 bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
            <p className="text-blue-400 font-bold text-sm">{t('v2.step.whyItMatters')}</p>
            <p className="text-slate-300 text-sm mt-1 leading-relaxed">{step.whyItMatters}</p>
          </div>
        )}
        <div className="px-4 mt-5 pb-5">
          <button
            onClick={() => setShowConfirm(true)}
            className="w-full bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white font-black text-lg uppercase tracking-wide py-5 rounded-2xl border-2 border-emerald-400/30 shadow-lg shadow-emerald-900/40 transition-all flex items-center justify-center gap-3"
          >
            <Navigation className="w-6 h-6" />
            {step.ctaText}
          </button>
          <p className="text-center text-slate-500 text-xs mt-3">
            {t('v2.nav.opensMaps')}
          </p>
        </div>
        {/* Confirmation bottom sheet */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowConfirm(false)}>
            <div className="absolute inset-0 bg-black/60" />
            <div
              className="relative w-full max-w-lg bg-slate-800 border border-slate-700 rounded-t-3xl px-6 pt-6 pb-10 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* Handle */}
              <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-5" />
              <div className="text-center text-4xl mb-3">📱</div>
              <h3 className="text-white text-xl font-black text-center leading-tight">
                {t('v2.nav.confirmTitle', { name: customerName })}
              </h3>
              <p className="text-slate-400 text-sm text-center mt-3 leading-relaxed">
                {t('v2.nav.confirmDesc')}
              </p>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-4 rounded-2xl bg-slate-700 text-slate-300 font-bold text-base border border-slate-600 active:bg-slate-600 transition-all"
                >
                  {t('v2.common.cancel')}
                </button>
                <button
                  onClick={() => { setShowConfirm(false); handleNavigate(); }}
                  className="flex-1 py-4 rounded-2xl bg-emerald-500 text-white font-black text-base shadow-lg shadow-emerald-900/40 active:bg-emerald-600 transition-all"
                >
                  {t('v2.nav.confirmCta')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  // ── Phase: navigation launched — waiting for arrival ───────────────────────
  return (
    <div className="mx-4 mt-4 overflow-hidden shadow-xl">
      {/* En route card */}
      <div className="bg-slate-800/80 border border-slate-700/50 rounded-2xl mb-3">
        <div className="pt-4 pb-1 text-center">
          <span className="text-xs font-bold tracking-widest text-blue-400 uppercase">🚗 {t('v2.nav.enRoute')}</span>
        </div>
        <div className="text-center text-5xl mt-2 mb-2 leading-none">🗺️</div>
        <h2 className="text-center text-2xl font-black text-white px-6 leading-tight">{t('v2.nav.headingTo', { address: jobAddress.split(",")[0] })}</h2>
        {/* ETA reminder — show GPS ETA if available, else show scheduled start time */}
        <div className="mx-4 mt-3 bg-blue-900/20 border border-blue-700/30 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-blue-300 text-sm font-semibold">
              {hasEta ? `ETA ${eta.etaText}` : `${t('v2.nav.scheduled')} ${jobStartTime}`}
            </span>
          </div>
          {hasEta
            ? <span className="text-slate-400 text-sm">{eta.durationText} {t('v2.nav.drive')}</span>
            : <span className="text-slate-500 text-xs">{t('v2.nav.gpsUnavailable')}</span>
          }
        </div>
        {/* Re-open maps — opens maps only, does NOT re-fire on_the_way SMS */}
        <div className="px-4 mt-3 mb-4">
          <button
            onClick={handleReopenMaps}
            className="w-full bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-slate-300 font-semibold text-sm py-3 rounded-xl border border-slate-600/50 transition-all flex items-center justify-center gap-2"
          >
            <Navigation className="w-4 h-4" />
            {t('v2.nav.reopenMaps')}
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
        {t('v2.nav.arrived')}
      </button>
      {returnedFromMaps && (
        <p className="text-center text-emerald-400 text-sm font-semibold mt-2 animate-pulse">
          {t('v2.nav.arrivedHint')}
        </p>
      )}
      {!returnedFromMaps && (
        <p className="text-center text-slate-500 text-xs mt-2">
          {t('v2.nav.arrivedSubhint')}
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
  const { t } = useTranslation();
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
          <p className="text-blue-400 font-bold text-sm">{t('v2.step.whyItMatters')}</p>
          <p className="text-slate-300 text-sm mt-1 leading-relaxed">{step.whyItMatters}</p>
        </div>
      )}
      {/* Photo grid */}
      {photos.length > 0 && (
        <div className="mx-4 mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">
              {t('v2.photo.uploaded', { count: photos.length })}
            </span>
            {photos.length >= 10 && <span className="text-emerald-400 text-xs font-bold">{t('v2.photo.bonusEarned')}</span>}
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
              <p className="text-amber-500 text-[10px] mt-0.5">{photos.length}/10 — {10 - photos.length} {t('v2.photo.moreForBonus')}</p>
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
              {t('v2.photo.uploading', { current: uploadProgress.current, total: uploadProgress.total })}
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
          {uploading
            ? t('v2.photo.uploadingProgress', { current: uploadProgress?.current ?? '', total: uploadProgress?.total ?? '' })
            : photos.length > 0 ? t('v2.photo.addMore') : t('v2.photo.openCamera')}
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
          {canAdvance ? step.ctaText : t('v2.photo.uploadFirst')}
        </button>
      </div>
      <p className="text-center text-slate-500 text-xs pb-5 mt-1 px-6">
        {canAdvance
          ? t('v2.photo.readyHint', { count: photos.length })
          : t('v2.photo.takeFirst')}
      </p>
    </div>
  );
}

function StepCard({ step, onComplete, jobAddress, cleanerJobId, completedJobId, jobStartTime, customerName }: { step: Step; onComplete: () => void; jobAddress: string; cleanerJobId: number | null; completedJobId: number; jobStartTime: string; customerName: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  // MUST be before any conditional return — React hooks rules
  const handleCta = useCallback(() => {
    setLoading(true);
    setTimeout(() => { setLoading(false); onComplete(); }, 400);
  }, [onComplete]);
  // Navigate step gets its own special card with ETA
  if (step.type === "navigate") {
    return <NavigateStepCard step={step} onComplete={onComplete} jobAddress={jobAddress} cleanerJobId={cleanerJobId} jobStartTime={jobStartTime} customerName={customerName} />;
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
          <p className="text-blue-400 font-bold text-sm">{t('v2.step.whyItMatters')}</p>
          <p className="text-slate-300 text-sm mt-1 leading-relaxed">{step.whyItMatters}</p>
        </div>
      )}
      {/* AI Coach */}
      {step.aiCoach && (
        <div className="mx-4 mt-4 bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
          <p className="text-white font-bold text-sm mb-1">{t('v2.step.aiCoach')}</p>
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
        {t('v2.step.footerHint')}
      </p>
    </div>
  );
}

function SignoffCard({ onComplete, cleanerJobId }: { onComplete: (result: { satisfaction: string; notes: string; signature: string }) => void; cleanerJobId: number | null }) {
  const { t } = useTranslation();
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
    { value: "great", label: t('v2.signoff.optionGreat') },
    { value: "touchup", label: t('v2.signoff.optionTouchup') },
    { value: "issue", label: t('v2.signoff.optionIssue') },
  ];

  return (
    <div className="mx-4 mt-4 bg-slate-800/80 border border-slate-700/50 rounded-2xl overflow-hidden shadow-xl">
      <div className="pt-5 pb-1 text-center">
        <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">{t('v2.signoff.label')}</span>
      </div>
      <h2 className="text-center text-2xl font-black text-white px-6 mt-2">{t('v2.signoff.title')}</h2>
      <p className="text-center text-slate-400 text-sm px-6 mt-1">{t('v2.signoff.subtitle')}</p>

      {/* Satisfaction */}
      <div className="mx-4 mt-5 bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
        <p className="text-white font-semibold text-sm mb-3">{t('v2.signoff.howDidItLook')}</p>
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
        <p className="text-white font-semibold text-sm mb-2">{t('v2.signoff.customerNotesLabel')}</p>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={t('v2.signoff.notesPlaceholder')}
          rows={3}
          className="w-full bg-slate-800 border border-blue-500/50 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 resize-none focus:outline-none focus:border-blue-400"
        />
      </div>

      {/* Signature */}
      <div className="mx-4 mt-3 bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
        <p className="text-white font-semibold text-sm mb-2">{t('v2.signoff.signatureLabel')}</p>
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
          {t('v2.signoff.clearSignature')}
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
          {t('v2.signoff.completeCta')}
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
          {t('v2.signoff.notHome')}
        </button>
      </div>
    </div>
  );
}

function CompletedScreen({ customerName, onNextJob, nextJobName, onBackToSchedule }: {
  customerName: string;
  onNextJob?: () => void;
  nextJobName?: string;
  onBackToSchedule?: () => void;
}) {
  const { t } = useTranslation();
  const isLastJob = !onNextJob;
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 px-6 text-center">
      <div className="text-6xl mb-4">{isLastJob ? '🏁' : '🎉'}</div>
      <h1 className="text-3xl font-black text-white">
        {isLastJob ? t('v2.completed.lastJobDone') : t('v2.completed.jobComplete')}
      </h1>
      {isLastJob && (
        <p className="text-emerald-400 font-semibold mt-1 text-sm">{t('v2.completed.allMissions')}</p>
      )}
      <p className="text-slate-400 mt-2 text-base">
        {t('v2.completed.signedOff', { name: customerName })}
      </p>
      <div className="mt-6 bg-slate-800 rounded-2xl p-5 w-full max-w-sm">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
          <div className="text-left">
            <p className="text-white font-bold text-sm">{t('v2.completed.allSteps')}</p>
            <p className="text-slate-400 text-xs mt-0.5">{t('v2.completed.photosSubmitted')}</p>
          </div>
        </div>
      </div>
      {onNextJob ? (
        <button
          onClick={onNextJob}
          className="mt-6 w-full max-w-sm bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white font-black text-lg py-4 rounded-2xl shadow-lg shadow-emerald-900/40 transition-all"
        >
          {t('v2.completed.nextMission')}{nextJobName ? ` ${nextJobName}` : ''}
        </button>
      ) : (
        <button
          onClick={onBackToSchedule ?? (() => window.location.reload())}
          className="mt-6 w-full max-w-sm bg-slate-700 hover:bg-slate-600 text-white font-semibold px-8 py-4 rounded-2xl transition-all"
        >
          {t('v2.completed.viewSummary')}
        </button>
      )}
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

function JobRunner({ job, onNextJob, nextJobName, onBackToSchedule }: { job: PortalJob; onNextJob?: () => void; nextJobName?: string; onBackToSchedule?: () => void }) {
  const { t } = useTranslation();
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

  const hasNotes = !!(job.customerNotes?.trim() || job.staffNotes?.trim());
  const [notesOpen, setNotesOpen] = useState(false);

  // markComplete mutation — fires when sign-off is submitted
  const utils = trpc.useUtils();
  const markCompleteMutation = trpc.cleaner.markComplete.useMutation({
    throwOnError: false,
    onSettled: () => {
      utils.cleaner.getMyJobsToday.invalidate();
    },
  });

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

  if (completed) return <CompletedScreen customerName={job.customerName} onNextJob={onNextJob} nextJobName={nextJobName} onBackToSchedule={onBackToSchedule} />;

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
                key={currentStep.id}
                step={currentStep}
                onComplete={advance}
                jobAddress={job.address}
                cleanerJobId={job.cleanerJobId}
                completedJobId={job.completedJobId}
                jobStartTime={job.time}
                customerName={job.customerName}
              />
            )
          )}
        </div>
        {/* Sticky Notes button — only shown when job has notes */}
        {hasNotes && (
          <button
            onClick={() => setNotesOpen(true)}
            className="fixed bottom-20 left-4 z-40 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/50 text-xs font-bold shadow-lg animate-pulse hover:animate-none hover:bg-yellow-500/30 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            {t('v2.common.notes')}
          </button>
        )}
        {notesOpen && <NotesPopup customerNotes={job.customerNotes} staffNotes={job.staffNotes} onClose={() => setNotesOpen(false)} />}
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


// ── Weekly Schedule Prompt ───────────────────────────────────────────────────
/**
 * Full-screen weekly schedule confirmation shown on login if the cleaner
 * hasn't yet submitted today. Blocks back-button navigation to ensure completion.
 * Ported verbatim from CleanerPortal.tsx.
 */
function WeeklySchedulePrompt({
  open,
  cleanerName,
  onSubmitted,
}: {
  open: boolean;
  cleanerName: string;
  onSubmitted: () => void;
}) {
  const { t, i18n: i18nInst } = useTranslation();
  const DAYS = ['sun','mon','tue','wed','thu','fri','sat'] as const;
  type Day = typeof DAYS[number];

  const getDayLabel = (d: Day) => t(`v2.day.${d}`);

  const weekDates = useMemo(() => {
    const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const et = new Date(etStr);
    const day = et.getDay();
    const sunday = new Date(et);
    sunday.setDate(et.getDate() - day);
    if (day === 6) sunday.setDate(sunday.getDate() + 7);
    return DAYS.map((d, i) => {
      const dt = new Date(sunday);
      dt.setDate(sunday.getDate() + i);
      return { key: d, date: dt };
    });
  }, []);

  const [schedule, setSchedule] = useState<Record<Day, boolean>>({ mon:false, tue:false, wed:false, thu:false, fri:false, sat:false, sun:false });
  const [seeded, setSeeded] = useState(false);
  const [step, setStep] = useState<'schedule' | 'note' | 'confirmed'>('schedule');
  const [note, setNote] = useState('');

  const savedScheduleQuery = trpc.cleaner.getMyTeamSchedule.useQuery(undefined, {
    enabled: open && !seeded,
    retry: false,
    throwOnError: false,
  });
  useEffect(() => {
    if (seeded) return;
    const s = savedScheduleQuery.data?.schedule;
    if (!s) return;
    setSchedule({ mon: s.mon === 1, tue: s.tue === 1, wed: s.wed === 1, thu: s.thu === 1, fri: s.fri === 1, sat: s.sat === 1, sun: s.sun === 1 });
    setSeeded(true);
  }, [savedScheduleQuery.data, seeded]);

  const submitWeeklySchedule = trpc.cleaner.submitWeeklySchedule.useMutation({
    onSuccess: () => { setStep('confirmed'); setTimeout(onSubmitted, 2000); },
    onError: (err) => toast.error(`Submission failed: ${err.message}`),
  });

  const toggleDay = (day: Day) => setSchedule(s => ({ ...s, [day]: !s[day] }));
  const handleConfirmSchedule = () => setStep('note');
  const handleFinalSubmit = () => {
    submitWeeklySchedule.mutate({ mon: schedule.mon?1:0, tue: schedule.tue?1:0, wed: schedule.wed?1:0, thu: schedule.thu?1:0, fri: schedule.fri?1:0, sat: schedule.sat?1:0, sun: schedule.sun?1:0, note: note.trim() || null });
  };

  const workingCount = DAYS.filter(d => schedule[d]).length;
  const weekStart = weekDates[0].date;
  const weekEnd = weekDates[6].date;
  const fmtShort = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekRange = `${fmtShort(weekStart)} – ${fmtShort(weekEnd)}`;
  const firstName = cleanerName.split(' ')[0];

  // Block back-button navigation while prompt is open
  useEffect(() => {
    if (!open) return;
    window.history.pushState({ weeklyPrompt: true }, '');
    const onPopState = (e: PopStateEvent) => {
      if (e.state?.weeklyPrompt) return;
      window.history.pushState({ weeklyPrompt: true }, '');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto flex flex-col px-4 pt-6 pb-6 max-w-lg mx-auto w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {step === 'schedule' && (
          <div className="space-y-6">
            <div className="text-center space-y-1.5">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-900/50 border border-emerald-700/50 mb-2">
                <CalendarDays className="w-7 h-7 text-emerald-400" />
              </div>
              <h2 className="text-white text-2xl font-bold leading-tight">
                {t('v2.schedule.confirmTitle')}
              </h2>
              <p className="text-slate-400 text-sm">
                {t('v2.schedule.confirmSubtitle', { name: firstName })}
              </p>
            </div>
            <div className="flex items-center justify-between bg-slate-800/60 rounded-xl px-4 py-2.5 border border-slate-700/50">
              <span className="text-slate-300 text-sm font-semibold">{t('v2.schedule.thisWeek')}</span>
              <div className="flex items-center gap-1.5 text-slate-400 text-sm">
                <Calendar className="w-3.5 h-3.5" />
                <span>{weekRange}</span>
              </div>
            </div>
            <div className="space-y-2">
              {weekDates.map(({ key, date }) => {
                const isWorking = schedule[key];
                const dayNum = date.getDate();
                const monthShort = date.toLocaleDateString('en-US', { month: 'short' });
                return (
                  <div key={key} className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-slate-800/60 border border-slate-700/50 select-none">
                    <div>
                      <p className={`font-semibold text-base leading-tight ${isWorking ? 'text-white' : 'text-slate-300'}`}>{getDayLabel(key)}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{monthShort} {dayNum}</p>
                    </div>
                    <div className="flex items-center bg-slate-800 rounded-full p-0.5 border border-slate-700">
                      <button onClick={e => { e.stopPropagation(); if (isWorking) toggleDay(key); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${!isWorking ? 'bg-slate-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>
                        {!isWorking && <CheckCircle2 className="w-3.5 h-3.5" />}
                        <span>{t('v2.schedule.notWorking')}</span>
                      </button>
                      <button onClick={e => { e.stopPropagation(); if (!isWorking) toggleDay(key); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${isWorking ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/40' : 'text-slate-500 hover:text-slate-300'}`}>
                        {isWorking && <CheckCircle2 className="w-3.5 h-3.5" />}
                        <span>{t('v2.schedule.working')}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/40 rounded-xl border border-slate-700/40">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <p className="text-slate-300 text-sm">
                {workingCount === 0
                  ? t('v2.schedule.noDaysSelected')
                  : t('v2.schedule.workingDays', { count: workingCount })}
              </p>
            </div>
            <Button className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold py-4 text-base h-auto rounded-2xl shadow-lg shadow-emerald-900/30 transition-all" onClick={handleConfirmSchedule}>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {t('v2.schedule.confirmBtn')}
            </Button>
          </div>
        )}
        {step === 'note' && (
          <div className="space-y-6">
            <div className="text-center space-y-1.5">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-900/50 border border-blue-700/50 mb-2">
                <span className="text-2xl">📝</span>
              </div>
              <h2 className="text-white text-2xl font-bold">
                {t('v2.schedule.anyNotes')}
              </h2>
              <p className="text-slate-400 text-sm">
                {t('v2.schedule.anyNotesSubtitle')}
              </p>
            </div>
            <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 px-4 py-3 space-y-1">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">{t('v2.schedule.yourSchedule')}</p>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map(d => (
                  <span key={d} className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${schedule[d] ? 'bg-emerald-900/40 border-emerald-600/60 text-emerald-300' : 'bg-slate-700/40 border-slate-600/40 text-slate-500'}`}>
                    {getDayLabel(d).slice(0, 3)}
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={t('v2.schedule.notePlaceholder')} rows={4} maxLength={500} className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3.5 py-3 text-white placeholder:text-slate-500 text-sm resize-none focus:outline-none focus:border-blue-500 transition-colors" autoFocus />
              <p className="text-slate-600 text-xs text-right">{note.length}/500</p>
            </div>
            <div className="space-y-3">
              <Button className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 text-base h-auto rounded-2xl" onClick={handleFinalSubmit} disabled={submitWeeklySchedule.isPending}>
                {submitWeeklySchedule.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                {t('v2.schedule.submit')}
              </Button>
              <button onClick={() => setStep('schedule')} className="w-full text-slate-500 text-sm hover:text-slate-300 py-2 transition-colors">
                ← {t('v2.common.back')}
              </button>
            </div>
          </div>
        )}
        {step === 'confirmed' && (
          <div className="flex-1 flex flex-col items-center justify-center space-y-6 text-center py-12">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-900/50 border-2 border-emerald-500">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            </div>
            <div className="space-y-2">
              <h2 className="text-white text-2xl font-bold">{t('v2.schedule.allSet')}</h2>
              <p className="text-slate-400 text-base">{t('v2.schedule.recorded')}</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {DAYS.map(d => (
                <span key={d} className={`text-sm font-semibold px-3 py-1.5 rounded-full ${schedule[d] ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-500'}`}>
                  {getDayLabel(d).slice(0, 3)}
                </span>
              ))}
            </div>
            <p className="text-slate-500 text-sm">{t('v2.schedule.haveGreatDay')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Day Briefing Screen ─────────────────────────────────────────────────────
type WeekJob = {
  cleanerJobId: number;
  customerName: string;
  address: string;
  time: string;
  jobDate: string;
  dateLabel: string;
  bathrooms: number;
  extras: string[];
  jobStatus: string;
  bookingStatus: string;
  basePay: number | null;
  customerNotes: string | null;
  staffNotes: string | null;
};

function formatWeekJobDate(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function WeekJobCard({ job, onNotesClick }: { job: WeekJob; onNotesClick?: () => void }) {
  const { t } = useTranslation();
  const isDone = job.jobStatus === 'completed' || job.bookingStatus === 'completed';
  return (
    <div className={['rounded-2xl px-4 py-4 space-y-2', isDone ? 'bg-slate-800/40 border border-slate-700/30 opacity-60' : 'bg-slate-800/70 border border-slate-700/60'].join(' ')}>
      <div className="flex items-center gap-2">
        {isDone
          ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          : <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-0.5" />}
        <span className={['font-bold text-sm leading-tight', isDone ? 'text-slate-500 line-through' : 'text-white'].join(' ')}>{job.customerName}</span>
        {isDone && <span className="ml-auto text-emerald-500 text-xs font-semibold">{t('v2.common.done')}</span>}
      </div>
      <div className="flex items-center gap-1.5 text-slate-400 text-xs pl-4">
        {job.jobDate && <span className={isDone ? 'text-slate-500' : 'text-slate-400'}>{formatWeekJobDate(job.jobDate)}</span>}
        {job.jobDate && <span className="text-slate-600">·</span>}
        <span className={isDone ? 'text-slate-500' : 'text-emerald-400 font-semibold'}>{job.time}</span>
        <span className="text-slate-600">·</span>
        <span className="truncate">{job.address}</span>
        {job.basePay != null && <><span className="text-slate-600">·</span><span className={isDone ? 'text-slate-500' : 'text-teal-400 font-semibold'}>${job.basePay.toFixed(2)}</span></>}
      </div>
      {!isDone && (job.extras ?? []).includes('move_in_move_out') && (
        <div className="pl-4">
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-300 border border-amber-700/50 font-semibold">{t('v2.common.moveInOut')}</span>
        </div>
      )}
      {!isDone && (job.customerNotes?.trim() || job.staffNotes?.trim()) && (
        <div className="pl-4">
          <button
            onClick={onNotesClick}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-yellow-900/40 text-yellow-300 border border-yellow-700/50 font-semibold animate-pulse hover:animate-none hover:bg-yellow-800/60 transition-colors"
          >
            <FileText className="w-3 h-3" />
            {t('v2.common.notes')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Shown after the schedule prompt (or on first load if already submitted).
 * Gives the cleaner a quick overview of today's jobs before they start.
 * Tabs: Today | Tomorrow | This Week
 */
function DayBriefing({
  jobs,
  cleanerName,
  onStart,
  onJobSelect,
}: {
  jobs: PortalJob[];
  cleanerName: string;
  onStart: () => void;
  onJobSelect?: (idx: number) => void;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'today' | 'tomorrow' | 'week'>('today');
  const [notesJob, setNotesJob] = useState<{ customerNotes: string | null; staffNotes: string | null } | null>(null);
  const weekQuery = trpc.cleaner.getMyJobsWeek.useQuery(undefined, { staleTime: 60_000, throwOnError: false });
  const weekJobs = weekQuery.data ?? [];
  const tomorrowJobs = weekJobs.filter(j => j.dateLabel === 'tomorrow');
  const otherWeekJobs = weekJobs.filter(j => j.dateLabel === 'week');
  const firstName = cleanerName.split(' ')[0];
  const hourET = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }));
  const greetingKey = hourET < 12 ? 'v2.greeting.morning' : hourET < 17 ? 'v2.greeting.afternoon' : 'v2.greeting.evening';
  // Format a YYYY-MM-DD string as "Monday, July 6th" in ET
  const formatJobDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d); // local midnight — no timezone shift needed for display
    return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  };
  // Today's date label shown in the header (e.g. "Monday, July 6th")
  const todayDateLabel = formatJobDate(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date())
      .replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2')
  );
  const completedCount = jobs.filter(j => j.jobStatus === 'completed' || j.bookingStatus === 'completed').length;
  const allDone = completedCount === jobs.length && jobs.length > 0;
  const firstIncompleteIdx = jobs.findIndex(j => j.jobStatus !== 'completed' && j.bookingStatus !== 'completed');
  const tabs: { id: 'today' | 'tomorrow' | 'week'; label: string; count: number }[] = [
    { id: 'today', label: t('v2.briefing.tabToday'), count: jobs.length },
    { id: 'tomorrow', label: t('v2.briefing.tabTomorrow'), count: tomorrowJobs.length },
    { id: 'week', label: t('v2.briefing.tabWeek'), count: otherWeekJobs.length },
  ];
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col px-4 pt-8 pb-8 max-w-lg mx-auto w-full">
      {/* Header */}
      <div className="text-center mb-6 space-y-1">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-900/50 border border-emerald-700/50">
            <span className="text-xl">{allDone ? '🏁' : '🧹'}</span>
          </div>
          <LanguagePicker />
        </div>
        <h1 className="text-white text-xl font-black">
          {allDone ? t('v2.briefing.greatWork', { name: firstName }) : t(greetingKey, { name: firstName })}
        </h1>
        <p className="text-slate-400 text-sm">
          {allDone
            ? t('v2.briefing.allMissionsComplete')
            : completedCount > 0
              ? t('v2.briefing.progressCount', { done: completedCount, total: jobs.length })
              : jobs.length === 1 ? t('v2.briefing.oneMission') : t('v2.briefing.missionCount', { count: jobs.length })}
        </p>
        {todayDateLabel && (
          <p className="text-slate-500 text-xs mt-1">{todayDateLabel}</p>
        )}
      </div>
      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1 mb-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'flex-1 py-2 rounded-lg text-sm font-semibold transition-all',
              activeTab === tab.id
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-white',
            ].join(' ')}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={['ml-1 text-xs', activeTab === tab.id ? 'text-emerald-200' : 'text-slate-500'].join(' ')}>
                ({tab.count})
              </span>
            )}
          </button>
        ))}
      </div>
      {/* Tab content */}
      <div className="space-y-3 flex-1 overflow-y-auto">
        {activeTab === 'today' && (
          jobs.length === 0
            ? <p className="text-slate-500 text-sm text-center py-8">{t('v2.briefing.noJobsToday')}</p>
            : jobs.map((job, idx) => {
                const isDone = job.jobStatus === 'completed' || job.bookingStatus === 'completed';
                return (
                  <div
                    key={job.cleanerJobId}
                    onClick={() => { if (!isDone && onJobSelect) { onJobSelect(idx); onStart(); } }}
                    className={[
                      'rounded-2xl px-4 py-4 space-y-2 transition-all',
                      isDone
                        ? 'bg-slate-800/40 border border-slate-700/30 opacity-60'
                        : 'bg-slate-800/70 border border-slate-700/60 active:scale-[0.98] cursor-pointer',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-2">
                      {isDone ? (
                        <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
                      ) : (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-black shrink-0">{idx + 1}</span>
                      )}
                      <span className={['font-bold text-base leading-tight', isDone ? 'text-slate-500 line-through' : 'text-white'].join(' ')}>{job.customerName}</span>
                      {isDone && <span className="ml-auto text-emerald-500 text-xs font-semibold">{t('v2.common.done')}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-400 text-sm pl-8">
                      {job.jobDate && <span className={isDone ? 'text-slate-500' : 'text-slate-400'}>{formatJobDate(job.jobDate)}</span>}
                      {job.jobDate && <span className="text-slate-600">·</span>}
                      <span className={isDone ? 'text-slate-500' : 'text-emerald-400 font-semibold'}>{job.time}</span>
                      <span className="text-slate-600">·</span>
                      <span className="truncate">{job.address}</span>
                      {job.basePay != null && <><span className="text-slate-600">·</span><span className={isDone ? 'text-slate-500' : 'text-teal-400 font-semibold'}>${job.basePay.toFixed(2)}</span></>}
                    </div>
                    {!isDone && (job.bathrooms > 0 || (job.extras?.length ?? 0) > 0) && (
                      <div className="flex flex-wrap gap-1.5 pl-8">
                        {job.bathrooms > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 border border-slate-600/50">{job.bathrooms} bath{job.bathrooms !== 1 ? 's' : ''}</span>}
                        {(job.extras ?? []).includes('move_in_move_out') && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-300 border border-amber-700/50 font-semibold">{t('v2.common.moveInOut')}</span>}
                        {(job.extras ?? []).filter(e => e !== 'move_in_move_out').map(e => <span key={e} className="text-xs px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 border border-blue-700/40">{e.replace(/_/g, ' ')}</span>)}
                      </div>
                    )}
                    {!isDone && (job.customerNotes?.trim() || job.staffNotes?.trim()) && (
                      <div className="pl-8">
                        <button
                          onClick={e => { e.stopPropagation(); setNotesJob({ customerNotes: job.customerNotes, staffNotes: job.staffNotes }); }}
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-yellow-900/40 text-yellow-300 border border-yellow-700/50 font-semibold animate-pulse hover:animate-none hover:bg-yellow-800/60 transition-colors"
                        >
                          <FileText className="w-3 h-3" />
                          {t('v2.common.notes')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
        )}
        {activeTab === 'tomorrow' && (
          tomorrowJobs.length === 0
            ? <p className="text-slate-500 text-sm text-center py-8">{t('v2.briefing.noJobsTomorrow')}</p>
            : tomorrowJobs.map(job => <WeekJobCard key={job.cleanerJobId} job={job} onNotesClick={() => setNotesJob({ customerNotes: job.customerNotes, staffNotes: job.staffNotes })} />)
        )}
        {activeTab === 'week' && (
          otherWeekJobs.length === 0
            ? <p className="text-slate-500 text-sm text-center py-8">{t('v2.briefing.noJobsWeek')}</p>
            : otherWeekJobs.map(job => <WeekJobCard key={job.cleanerJobId} job={job} onNotesClick={() => setNotesJob({ customerNotes: job.customerNotes, staffNotes: job.staffNotes })} />)
        )}
      </div>
      {/* Notes popup */}
      {notesJob && <NotesPopup customerNotes={notesJob.customerNotes} staffNotes={notesJob.staffNotes} onClose={() => setNotesJob(null)} />}
      {/* CTA — only on Today tab */}
      {activeTab === 'today' && !allDone && jobs.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => { if (firstIncompleteIdx >= 0 && onJobSelect) onJobSelect(firstIncompleteIdx); onStart(); }}
            className="w-full bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white font-black text-lg py-4 rounded-2xl shadow-lg shadow-emerald-900/40 transition-all"
          >
            {completedCount > 0 ? t('v2.briefing.continue') : t('v2.briefing.letsGo')}
          </button>
          {completedCount === 0 && firstIncompleteIdx >= 0 && (
            <p className="text-center text-slate-600 text-xs mt-3">{t('v2.briefing.startingWith', { n: firstIncompleteIdx + 1 })}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
function CleanerPortalV2Inner() {
  const { t } = useTranslation();
  // Auth guard — check session before loading jobs.
  // Only redirect to /cleaner on an explicit UNAUTHORIZED error (expired/missing cookie).
  // Transient network failures during deploys must NOT redirect — show an error state instead.
  const meQuery = trpc.cleaner.me.useQuery(undefined, { retry: 1, throwOnError: false });

  // Sync language from DB once meQuery resolves
  useEffect(() => {
    if (!meQuery.data?.language) return;
    const lang = meQuery.data.language as string;
    if (['en', 'es', 'pt'].includes(lang) && i18n.language !== lang) {
      i18n.changeLanguage(lang);
    }
  }, [meQuery.data?.language]);

  // Portal data — includes tomorrowAvailability.submitted to gate the schedule prompt
  const portalDataQuery = trpc.cleaner.portalData.useQuery(undefined, {
    enabled: meQuery.data != null,
    staleTime: 5 * 60 * 1000,
    throwOnError: false,
  });

  const { data: jobs, isLoading, error } = trpc.cleaner.getMyJobsToday.useQuery(undefined, {
    enabled: meQuery.data != null, // only run once session is confirmed
    retry: 1,
    throwOnError: false,
  });

  // Track which job index we're on (for multi-job days)
  // Initialize to the first non-completed job so re-opening the portal after completing
  // job 1 starts on job 2 (not job 1 again).
  const [activeJobIdx, setActiveJobIdx] = useState(() => {
    // We don't have jobs yet at init time — start at 0 and correct once jobs load
    return 0;
  });
  // Once jobs load, jump to the first incomplete job
  const [hasAutoAdvanced, setHasAutoAdvanced] = useState(false);
  useEffect(() => {
    if (!jobs || hasAutoAdvanced) return;
    const firstIncomplete = jobs.findIndex(
      j => j.jobStatus !== 'completed' && j.bookingStatus !== 'completed'
    );
    if (firstIncomplete > 0) setActiveJobIdx(firstIncomplete);
    setHasAutoAdvanced(true);
  }, [jobs, hasAutoAdvanced]);

  // Show weekly schedule prompt if not yet submitted today
  const [showSchedulePrompt, setShowSchedulePrompt] = useState(false);
  // Show day briefing screen before starting jobs
  const [showBriefing, setShowBriefing] = useState(true);

  useEffect(() => {
    if (!meQuery.data) return;
    if (portalDataQuery.isLoading || portalDataQuery.data === undefined) return;
    if (portalDataQuery.data.tomorrowAvailability?.submitted) return; // already done
    setShowSchedulePrompt(true);
  }, [meQuery.data, portalDataQuery.data, portalDataQuery.isLoading]);

  // Session loading
  if (meQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">{t('v2.loading.session')}</p>
      </div>
    );
  }

  // Not authenticated — redirect to /cleaner if:
  // 1. Explicit UNAUTHORIZED error (cookie expired/missing)
  // 2. meQuery resolved with null data (no session at all)
  const isUnauthorized = meQuery.isError &&
    (meQuery.error?.message?.includes("10001") || meQuery.error?.message?.includes("UNAUTHORIZED"));
  const hasNoSession = !meQuery.isLoading && !meQuery.isError && !meQuery.data;

  if (isUnauthorized || hasNoSession) {
    window.location.replace("/cleaner");
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">{t('v2.loading.redirecting')}</p>
      </div>
    );
  }

  if (meQuery.isError && !isUnauthorized) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-slate-300 text-center">{t('v2.error.connection')}</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-emerald-500 text-white font-bold px-6 py-3 rounded-xl"
        >
          {t('v2.error.retry')}
        </button>
      </div>
    );
  }

  // Jobs loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">{t('v2.loading.jobs')}</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="text-2xl font-black text-white">{t('v2.error.couldNotLoad')}</h1>
        <p className="text-slate-400 mt-2 text-sm">{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold px-8 py-3 rounded-xl transition-all"
        >
          {t('v2.error.retry')}
        </button>
      </div>
    );
  }

  // NOTE: The "no jobs" full-screen block has been intentionally removed.
  // DayBriefing handles the empty Today tab inline with a "No jobs today" message.

  const activeJob = jobs![activeJobIdx] ?? jobs![0];

  // Render the active job runner
  // Key on cleanerJobId so state resets when switching jobs
  return (
    <>
      {/* Weekly schedule prompt — fullscreen takeover, shown once per day if not yet submitted */}
      <WeeklySchedulePrompt
        open={showSchedulePrompt}
        cleanerName={meQuery.data?.name ?? ""}
        onSubmitted={() => {
          setShowSchedulePrompt(false);
          portalDataQuery.refetch();
          // After schedule prompt, show the day briefing
          setShowBriefing(true);
        }}
      />
      {/* Day briefing — shown after schedule prompt or on first load if already submitted */}
      {!showSchedulePrompt && showBriefing && (
        <DayBriefing
          jobs={jobs ?? []}
          cleanerName={meQuery.data?.name ?? ""}
          onStart={() => setShowBriefing(false)}
          onJobSelect={(idx) => setActiveJobIdx(idx)}
        />
      )}
      {/* Job runner — shown after briefing is dismissed */}
      {!showSchedulePrompt && !showBriefing && jobs && jobs.length > 0 && (
        <JobRunner
          key={activeJob.cleanerJobId}
          job={activeJob}
          onNextJob={activeJobIdx < jobs.length - 1 ? () => setActiveJobIdx(i => i + 1) : undefined}
          nextJobName={jobs[activeJobIdx + 1]?.customerName}
          onBackToSchedule={() => setShowBriefing(true)}
        />
      )}
    </>
  );
}

// Wrap with LocationProvider so permission is owned at the top level
const CleanerPortalV2WithLocation = function CleanerPortalV2WithLocation() {
  return (
    <LocationProvider>
      <CleanerPortalV2Inner />
    </LocationProvider>
  );
};
export { CleanerPortalV2WithLocation as default };
