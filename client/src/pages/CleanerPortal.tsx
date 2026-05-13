/**
 * CleanerPortal — /cleaner
 *
 * Individual cleaner portal. Login with phone + password.
 * Shows today's jobs (with date browsing), pay breakdown, ratings, photo upload, mark complete.
 */
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Camera, Star, CheckCircle2, Clock, MapPin, DollarSign,
  ChevronLeft, ChevronRight, Upload, Loader2, LogOut, User,
  CalendarDays, TrendingUp, ImageIcon, CheckCheck, AlertCircle, AlertTriangle, X
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });
}

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return dt.toLocaleDateString("en-CA");
}

function formatCurrency(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
    });
  } catch { return ""; }
}

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-muted-foreground text-sm">No rating yet</span>;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`w-4 h-4 ${i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
      <span className="ml-1 text-sm font-medium">{rating}/5</span>
    </div>
  );
}

// ── Login Form ────────────────────────────────────────────────────────────────

function LoginForm({ onLogin }: { onLogin: () => void }) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = trpc.cleaner.login.useMutation({
    onSuccess: () => {
      toast.success(t("login.welcome"));
      onLogin();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm bg-slate-800 border-slate-700 shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-14 h-14 bg-emerald-500/20 rounded-full flex items-center justify-center mb-3">
            <User className="w-7 h-7 text-emerald-400" />
          </div>
          <CardTitle className="text-white text-xl">{t("login.title")}</CardTitle>
          <p className="text-slate-400 text-sm">{t("login.subtitle")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-slate-300 text-sm font-medium block mb-1.5">{t("login.email")}</label>
            <Input
              type="email"
              placeholder={t("login.emailPlaceholder")}
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-emerald-500"
              autoFocus
              onKeyDown={e => e.key === "Enter" && loginMutation.mutate({ email: email.trim(), password })}
            />
          </div>
          <div>
            <label className="text-slate-300 text-sm font-medium block mb-1.5">{t("login.password")}</label>
            <Input
              type="password"
              placeholder={t("login.passwordPlaceholder")}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-emerald-500"
              onKeyDown={e => e.key === "Enter" && loginMutation.mutate({ email: email.trim(), password })}
            />
          </div>
          <Button
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            onClick={() => loginMutation.mutate({ email: email.trim(), password })}
            disabled={loginMutation.isPending || !email || !password}
          >
            {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Sign In
          </Button>
          <p className="text-center text-slate-500 text-xs">
            Contact your manager if you need access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Job Card ──────────────────────────────────────────────────────────────────

type Job = {
  id: number;
  completedJobId: number;
  cleanerProfileId: number;
  customerName: string | null;
  jobAddress: string | null;
  serviceType: string | null;
  serviceDateTime: string | null;
  bookingStatus: string | null;
  jobRevenue: string | null;
  basePay: string | null;
  ratingAdjustment: string | null;
  photoAdjustment: string | null;
  streakBonus: string | null;
  finalPay: string | null;
  customerRating: number | null;
  missedSomething: number | null;
  photoSubmitted: number;
  customerNotes: string | null;
  staffNotes: string | null;
  photos: { id: number; photoUrl: string; filename: string | null }[];
  jobStatus: string | null;
  issueNote: string | null;
  etaTimestamp: number | null;
  manualAdjustment: string | null;
  manualAdjustmentNote: string | null;
  recleanPenalty: string | null;
  checklistItems: Array<{ text: string; checked: boolean }> | null;
  customRules?: Array<{ id: number; label: string; amount: string; type: string }>;
};

const JOB_STATUSES = [
  { key: "on_the_way",       label: "On the Way",              color: "bg-blue-600/30 text-blue-300 border-blue-600/40",     activeColor: "bg-blue-600 text-white" },
  { key: "in_progress",      label: "In Progress",             color: "bg-amber-600/30 text-amber-300 border-amber-600/40",  activeColor: "bg-amber-500 text-white" },
  { key: "finishing_up",     label: "Finishing Up",            color: "bg-teal-600/30 text-teal-300 border-teal-600/40",     activeColor: "bg-teal-600 text-white" },
  { key: "wrapping_up",      label: "Finishing Previous Job",  color: "bg-violet-600/30 text-violet-300 border-violet-600/40", activeColor: "bg-violet-600 text-white" },
  { key: "running_late",     label: "Running Late",            color: "bg-orange-600/30 text-orange-300 border-orange-600/40", activeColor: "bg-orange-500 text-white" },
  { key: "issue_at_property",label: "Issue at Property",       color: "bg-red-600/30 text-red-300 border-red-600/40",       activeColor: "bg-red-600 text-white" },
] as const;

function PayoutRulesModal({ open, onClose, payRules, activeCustomRules, cleanerName }: {
  open: boolean;
  onClose: () => void;
  payRules?: { fiveStarBonus: number; lowRatingDeduction: number; photoBonus: number; noPhotoPenalty: number; streakBonus: number; streakTarget: number; recleanPenalty: number } | null;
  activeCustomRules?: Array<{ id: number; label: string; type: string; amount: string; description: string | null }>;
  cleanerName?: string;
}) {
  const { t } = useTranslation();
  const rules = [
    {
      title: "Base Pay",
      color: "teal",
      items: [
        { label: "Base pay", desc: "You earn this just by completing the job. It's locked in the moment you're assigned.", positive: true },
      ],
    },
    {
      title: "Rating Bonus / Penalty",
      color: "yellow",
      items: [
        { label: `+$${payRules?.fiveStarBonus ?? 10} — 5-star rating`, desc: "Customer gives you a perfect score. Keep communication high and leave the home spotless.", positive: true },
        { label: `No change — 4-star rating`, desc: "Good job, no bonus or penalty at this level.", positive: null },
        { label: `-$${payRules?.lowRatingDeduction ?? 20} — 3 stars or below`, desc: "Customer reports an issue or gives a low score. Avoid by double-checking your work before leaving.", positive: false },
      ],
    },
    {
      title: "Photo Bonus / Penalty",
      color: "blue",
      items: [
        { label: `+$${payRules?.photoBonus ?? 5} — Photos uploaded`, desc: "Upload at least one after-photo before marking the job complete. Takes 30 seconds and earns you extra.", positive: true },
        { label: `-$${payRules?.noPhotoPenalty ?? 10} — No photos`, desc: "If you mark complete without uploading photos, this deduction applies automatically.", positive: false },
      ],
    },
    {
      title: "Reclean Deduction",
      color: "red",
      items: [
        { label: `-$${payRules?.recleanPenalty ?? 30} — Job requires a reclean`, desc: "If the customer reports a serious issue and a reclean is needed, this is applied. Avoid by doing a thorough walkthrough before leaving.", positive: false },
      ],
    },
    {
      title: "Streak Bonus",
      color: "purple",
      items: [
        { label: `+$${payRules?.streakBonus ?? 50} — ${payRules?.streakTarget ?? 10} clean jobs in a row`, desc: `Complete ${payRules?.streakTarget ?? 10} consecutive jobs with no complaints and a rating of 4+ to unlock this bonus. Your streak resets if you get a complaint or low rating.`, positive: true },
      ],
    },
  ];

  const customBonuses = (activeCustomRules ?? []).filter(r => r.type === "bonus");
  const customDeductions = (activeCustomRules ?? []).filter(r => r.type === "deduction");

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white text-base font-bold">Payout Rules</DialogTitle>
        </DialogHeader>
        <p className="text-slate-400 text-xs -mt-2 mb-4">
          {cleanerName ? (
            <>Here’s how your pay works, <span className="text-white font-semibold">{cleanerName.split(" ")[0]}</span>. No surprises.</>
          ) : (
            "Here’s exactly how your pay is calculated — no surprises."
          )}
        </p>
        <div className="space-y-5">
          {rules.map(section => (
            <div key={section.title}>
              <p className="text-slate-300 text-xs font-semibold uppercase tracking-widest mb-2">{section.title}</p>
              <div className="space-y-2">
                {section.items.map((item, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <span className={`mt-0.5 shrink-0 text-sm font-bold ${
                      item.positive === true ? "text-emerald-400" : item.positive === false ? "text-red-400" : "text-slate-400"
                    }`}>{item.positive === true ? "+" : item.positive === false ? "−" : "○"}</span>
                    <div>
                      <p className={`text-sm font-semibold ${
                        item.positive === true ? "text-emerald-300" : item.positive === false ? "text-red-300" : "text-slate-300"
                      }`}>{item.label}</p>
                      <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {(customBonuses.length > 0 || customDeductions.length > 0) && (
            <div>
              <p className="text-slate-300 text-xs font-semibold uppercase tracking-widest mb-2">{t("job.specialRules")}</p>
              <div className="space-y-2">
                {customBonuses.map(r => (
                  <div key={r.id} className="flex gap-3 items-start">
                    <span className="mt-0.5 shrink-0 text-sm font-bold text-emerald-400">+</span>
                    <div>
                      <p className="text-sm font-semibold text-emerald-300">{r.label} (+${parseFloat(r.amount).toFixed(2)})</p>
                      {r.description && <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">{r.description}</p>}
                    </div>
                  </div>
                ))}
                {customDeductions.map(r => (
                  <div key={r.id} className="flex gap-3 items-start">
                    <span className="mt-0.5 shrink-0 text-sm font-bold text-red-400">−</span>
                    <div>
                      <p className="text-sm font-semibold text-red-300">{r.label} (-${parseFloat(r.amount).toFixed(2)})</p>
                      {r.description && <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">{r.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Tips section */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4">
            <p className="text-slate-300 text-xs font-semibold uppercase tracking-widest mb-3">{t("payRules.tipsTitle")}</p>
            <div className="space-y-3">
              <div className="flex gap-3 items-start">
                <span className="text-emerald-400 text-base shrink-0">📸</span>
                <div>
                  <p className="text-slate-200 text-sm font-semibold">{t("payRules.tip1Title")}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{t("payRules.tip1Desc", { amount: payRules?.photoBonus ?? 5 })}</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="text-emerald-400 text-base shrink-0">🗣️</span>
                <div>
                  <p className="text-slate-200 text-sm font-semibold">Ask the customer if everything looks good</p>
                  <p className="text-slate-500 text-xs mt-0.5">A quick check-in before you leave gives the customer a chance to flag anything small — so it doesn’t turn into a complaint or reclean.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="text-emerald-400 text-base shrink-0">⭐</span>
                <div>
                  <p className="text-slate-200 text-sm font-semibold">{t("payRules.tip3Title")}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{t("payRules.tip3Desc", { amount: payRules?.streakBonus ?? 50 })}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function JobCard({ job, allJobs, onPhotoUploaded, onMarkedComplete, onStatusUpdated, payRules, activeCustomRules, streakInfo, cleanerName }: {
  job: Job;
  allJobs: Job[];
  onPhotoUploaded: () => void;
  onMarkedComplete: () => void;
  onStatusUpdated: () => void;
  payRules?: { fiveStarBonus: number; lowRatingDeduction: number; photoBonus: number; noPhotoPenalty: number; streakBonus: number; streakTarget: number; recleanPenalty: number; googleReviewBonus?: number } | null;
  activeCustomRules?: Array<{ id: number; label: string; type: string; amount: string; description: string | null }>;
  streakInfo?: { currentStreak: number; bestStreak: number } | null;
  cleanerName?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showPayoutRules, setShowPayoutRules] = useState(false);
  const [showBonusDetails, setShowBonusDetails] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const { t } = useTranslation();
  const [completing, setCompleting] = useState(false);
  const [showPhotos, setShowPhotos] = useState(true);
  const [showIssueInput, setShowIssueInput] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const [showEtaPicker, setShowEtaPicker] = useState(false);
  const [etaPickerFor, setEtaPickerFor] = useState<"on_the_way" | "running_late" | null>(null);
  // ETA modal — full blocking popup
  const [showEtaModal, setShowEtaModal] = useState(false);
  const [etaModalFor, setEtaModalFor] = useState<"on_the_way" | "running_late" | null>(null);
  // When opened from the post-complete "Next Job" CTA, fire the mutation for this job id instead of job.id
  const [nextJobEtaTarget, setNextJobEtaTarget] = useState<{ id: number; customerName: string | null } | null>(null);
  // Custom exact-time ETA input ("HH:MM" in 24h format from <input type="time">)
  const [customEtaTime, setCustomEtaTime] = useState<string>("");
  // Returns "HH:MM" for 1 hour from now in device local time
  function defaultEtaTime(): string {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const ETA_OPTIONS = [
    { label: "30 min",      value: "30 minutes" },
    { label: "1 hour",     value: "1 hour" },
    { label: "1 hr 30 min", value: "1 hr 30 min" },
    { label: "2 hours",    value: "2 hours" },
  ];

  // Confirm-complete modal state
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  // Post-complete "What's Next" modal
  const [showPostComplete, setShowPostComplete] = useState(false);

  const statusMutation = trpc.cleaner.updateJobStatus.useMutation({
    onSuccess: () => { onStatusUpdated(); },
    onError: (err) => toast.error(err.message),
  });

  const uploadMutation = trpc.cleaner.uploadPhoto.useMutation({
    onSuccess: () => {
      toast.success("Photo uploaded!");
      onPhotoUploaded();
    },
    onError: (err) => toast.error(`Upload failed: ${err.message}`),
    onSettled: () => setUploading(false),
  });

  const completeMutation = trpc.cleaner.markComplete.useMutation({
    onSuccess: () => {
      toast.success("Job marked complete!");
      onMarkedComplete();
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => setCompleting(false),
  });

  const [uncompleting, setUncompleting] = useState(false);
  const uncompleteMutation = trpc.cleaner.uncompleteJob.useMutation({
    onSuccess: () => {
      toast.success("Completion undone — job is back in progress.");
      onStatusUpdated();
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => setUncompleting(false),
  });

  const toggleChecklistMutation = trpc.cleaner.toggleChecklistItem.useMutation({
    onError: (err) => toast.error(`Failed to save: ${err.message}`),
  });

  // Checklist gating: all items must be checked before Mark Complete
  const checklist = job.checklistItems ?? null;
  const hasChecklist = checklist !== null && checklist.length > 0;
  const allChecked = hasChecklist ? checklist.every(item => item.checked) : true;

  const handleMarkComplete = () => {
    if (!allChecked) {
      toast.warning("Please check off all checklist items before marking complete.");
      return;
    }
    // Show confirmation modal (which also checks for photos)
    setShowCompleteConfirm(true);
  };

  const confirmMarkComplete = () => {
    setShowCompleteConfirm(false);
    setCompleting(true);
    completeMutation.mutate({ cleanerJobId: job.id }, {
      onSuccess: () => { setShowPostComplete(true); },
    });
  };

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const oversized = files.filter(f => f.size > 8 * 1024 * 1024);
    if (oversized.length > 0) {
      toast.error(`${oversized.length} photo(s) exceed 8MB and were skipped`);
    }
    const valid = files.filter(f => f.size <= 8 * 1024 * 1024);
    if (valid.length === 0) return;

    setUploading(true);
    setUploadProgress({ current: 0, total: valid.length });
    // Upload all selected photos sequentially
    for (let i = 0; i < valid.length; i++) {
      setUploadProgress({ current: i + 1, total: valid.length });
      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          uploadMutation.mutate(
            {
              cleanerJobId: job.id,
              completedJobId: job.completedJobId,
              filename: valid[i].name,
              mimeType: valid[i].type,
              dataBase64: base64,
            },
            { onSettled: () => resolve() }
          );
        };
        reader.readAsDataURL(valid[i]);
      });
    }
    setUploadProgress(null);
    // Reset input so same files can be re-selected
    e.target.value = "";
  }, [job.id, job.completedJobId, uploadMutation]);

  const isComplete = job.bookingStatus === "completed";
  const basePay = parseFloat(job.basePay ?? "0") || 0;
  const ratingAdj = parseFloat(job.ratingAdjustment ?? "0") || 0;
  // photoAdjustment is written to DB by the server when rating is finalized or photo is uploaded
  // If not yet in DB (job not yet rated), calculate client-side for preview
  const hasPhoto = job.photoSubmitted === 1 || (job.photos?.length ?? 0) > 0;
  // Photo adj: only apply to total when job is completed (photoAdjustment written to DB) or photo already submitted
  // While job is pending and no photo yet, show as Pending — don't deduct from displayed total
  const photoAdjFromDB = job.photoAdjustment != null ? parseFloat(job.photoAdjustment) : null;
  const photoAdj = photoAdjFromDB ?? (hasPhoto ? 5 : 0); // 0 = not yet applied (pending)
  const photoPending = !isComplete && photoAdjFromDB === null && !hasPhoto; // show as Pending
  const streakBonus = parseFloat(job.streakBonus ?? "0") || 0;
  const manualAdj = parseFloat(job.manualAdjustment ?? "0") || 0;
  const recleanAdj = job.recleanPenalty != null ? parseFloat(job.recleanPenalty) : 0;
  const recleanPending = !isComplete && job.recleanPenalty === null; // show as Pending until job completed
  // Active custom pay rules — shown on every job (e.g. Google Review bonus, Late penalty)
  const shownCustomRules = activeCustomRules ?? [];
  // Always recalculate display total from components — stored finalPay may be stale
  const finalPay = basePay + ratingAdj + photoAdj + streakBonus + manualAdj + recleanAdj;
  const isPayFinalized = job.ratingAdjustment != null; // pay is finalized once rating is processed

  // ── 4-tile summary calculations ──────────────────────────────────────────
  // BASE PAY tile: just the base
  const summaryBasePay = basePay;
  // LIKELY PAY: basePay + photoBonus + fiveStarBonus (best-case standard bonuses, no streak/manual/reclean)
  const photoBonus = payRules?.photoBonus ?? 5;
  const fiveStarBonus = payRules?.fiveStarBonus ?? 10;
  const summaryLikelyPay = basePay + photoBonus + fiveStarBonus;
  // POTENTIAL EARNINGS: likely pay + all active custom bonus rules
  const customBonusTotal = shownCustomRules
    .filter(r => r.type === "bonus")
    .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const summaryPotentialPay = summaryLikelyPay + customBonusTotal;
  // RISK FLOOR: base + no-photo penalty + low-rating penalty + reclean penalty + custom deductions
  const noPhotoPenalty = payRules?.noPhotoPenalty ?? 10;
  const lowRatingDeduction = payRules?.lowRatingDeduction ?? 20;
  const recleanPenaltyAmt = payRules?.recleanPenalty ?? 30;
  const customDeductionTotal = shownCustomRules
    .filter(r => r.type === "deduction")
    .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const summaryRiskFloor = basePay - noPhotoPenalty - lowRatingDeduction - recleanPenaltyAmt - customDeductionTotal + manualAdj;
  // Streak progress
  const streakTarget = payRules?.streakTarget ?? 10;
  const currentStreak = streakInfo?.currentStreak ?? 0;
  const streakProgress = Math.min(currentStreak, streakTarget);
  const streakRemaining = Math.max(0, streakTarget - currentStreak);

  return (
    <Card className={`bg-slate-800 border-slate-700 overflow-hidden transition-all ${isComplete ? "opacity-80" : ""}`}>
      {/* Header bar */}
      <div className={`px-4 py-2 flex items-center justify-between ${isComplete ? "bg-emerald-900/40" : "bg-slate-700/50"}`}>
        <div className="flex items-center gap-2">
          {job.serviceDateTime && (
            <span className="flex items-center gap-1 text-slate-300 text-sm font-medium">
              <Clock className="w-3.5 h-3.5" />
              {formatTime(job.serviceDateTime)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isComplete && (
            <>
              <Badge className="bg-emerald-600/30 text-emerald-300 border-emerald-600/40 text-xs">
                <CheckCheck className="w-3 h-3 mr-1" />Complete
              </Badge>
              <button
                className="text-slate-500 hover:text-amber-400 transition-colors text-xs underline underline-offset-2 disabled:opacity-40"
                onClick={() => {
                  if (window.confirm("Undo completion? The job will go back to In Progress.")) {
                    setUncompleting(true);
                    uncompleteMutation.mutate({ cleanerJobId: job.id });
                  }
                }}
                disabled={uncompleting}
                title="Undo completion"
              >
                {uncompleting ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Undo"}
              </button>
            </>
          )}
          {job.photoSubmitted === 1 && (
            <Badge className="bg-blue-600/30 text-blue-300 border-blue-600/40 text-xs">
              <ImageIcon className="w-3 h-3 mr-1" />Photo
            </Badge>
          )}
        </div>
      </div>

      <CardContent className="p-4 space-y-4">
        {/* Customer + address */}
        <div>
          <p className="text-white font-semibold text-base">{job.customerName ?? "Customer"}</p>
          {job.jobAddress && (
            <p className="text-slate-400 text-sm flex items-start gap-1 mt-0.5">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {job.jobAddress}
            </p>
          )}
          {job.serviceType && (
            <p className="text-slate-400 text-sm mt-0.5">{job.serviceType}</p>
          )}
        </div>

        {/* Customer notes */}
        {job.customerNotes && (
          <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3">
            <p className="text-amber-300 text-xs font-medium mb-1">📋 Customer Notes</p>
            <p className="text-amber-200 text-sm whitespace-pre-wrap">{job.customerNotes}</p>
          </div>
        )}

        {/* Staff notes */}
        {job.staffNotes && (
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3">
            <p className="text-blue-300 text-xs font-medium mb-1">🗒️ Staff Notes</p>
            <p className="text-blue-200 text-sm whitespace-pre-wrap">{job.staffNotes}</p>
          </div>
        )}

        {/* Amber warning: no photo uploaded and job is active */}
        {!isComplete && !hasPhoto && (
          <div className="bg-amber-900/20 border border-amber-600/40 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-amber-400 text-sm">⚠</span>
            <p className="text-amber-300 text-xs">
              Upload photos to earn <span style={{color: '#34d399'}}>+${payRules?.photoBonus ?? 5}</span> and avoid <span style={{color: '#f87171'}}>-${payRules?.noPhotoPenalty ?? 10}</span> penalty
            </p>
          </div>
        )}

        {/* AI Checklist */}
        {hasChecklist && (
          <div className="bg-slate-900/80 border border-slate-600 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-300 text-xs font-semibold uppercase tracking-wider">✅ Job Checklist</p>
              <span className="text-xs text-slate-500">{checklist!.filter(i => i.checked).length}/{checklist!.length} done</span>
            </div>
            <div className="space-y-2">
              {checklist!.map((item, idx) => (
                <button
                  key={idx}
                  className={`w-full flex items-start gap-2.5 text-left rounded-md px-2 py-1.5 transition-colors ${
                    item.checked
                      ? "bg-emerald-900/20 border border-emerald-700/30"
                      : "bg-slate-800 border border-slate-700 hover:border-slate-500"
                  }`}
                  onClick={() => {
                    toggleChecklistMutation.mutate({
                      jobId: job.id,
                      itemIndex: idx,
                      checked: !item.checked,
                    });
                    // Optimistic update via onStatusUpdated refetch
                    onStatusUpdated();
                  }}
                >
                  <span className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center text-xs ${
                    item.checked
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : "border-slate-500 bg-transparent"
                  }`}>
                    {item.checked && "✓"}
                  </span>
                  <span className={`text-sm leading-snug ${
                    item.checked ? "text-emerald-300 line-through opacity-70" : "text-slate-200"
                  }`}>
                    {item.text}
                  </span>
                </button>
              ))}
            </div>
            {!allChecked && (
              <p className="text-amber-400 text-xs mt-2 flex items-center gap-1">
                ⚠️ Complete all items above before marking the job done
              </p>
            )}
          </div>
        )}

        {/* Pay Summary — redesigned */}
        <div className="rounded-xl overflow-hidden border border-slate-700/60">
          {/* Header */}
          <div className="bg-slate-900 px-4 pt-4 pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest mb-1">Pay Summary</p>
                <p className="text-white font-bold text-lg leading-tight">Know exactly what this job can pay</p>
                <p className="text-slate-400 text-xs mt-1">Cleaner-friendly breakdown with guaranteed pay, upside, and any deductions that could reduce final payout.</p>
              </div>
              <button
                onClick={() => setShowPayoutRules(true)}
                className="shrink-0 mt-1 text-[11px] font-semibold text-slate-300 border border-slate-600 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:border-slate-500 transition-colors whitespace-nowrap"
              >
                View payout rules
              </button>
            </div>
          </div>
          <PayoutRulesModal
            open={showPayoutRules}
            onClose={() => setShowPayoutRules(false)}
            payRules={payRules}
            activeCustomRules={activeCustomRules}
            cleanerName={cleanerName}
          />

          {/* 4-tile summary row */}
          <div className="grid grid-cols-2 gap-2 px-3 py-3 bg-slate-900/80">
            {/* Base Pay */}
            <div className="rounded-xl p-3 border border-teal-700/40 bg-teal-900/20">
              <p className="text-teal-400 text-[10px] font-semibold uppercase tracking-widest mb-1">Base Pay</p>
              <p className="text-teal-300 font-bold text-xl">{formatCurrency(summaryBasePay.toFixed(2))}</p>
              <p className="text-slate-400 text-[11px] mt-1">What you have locked in</p>
            </div>
            {/* Likely Pay */}
            <div className="rounded-xl p-3 border border-slate-600/40 bg-slate-800/60">
              <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-widest mb-1">Likely Pay</p>
              <p className="text-white font-bold text-xl">{formatCurrency(summaryLikelyPay.toFixed(2))}</p>
              <p className="text-slate-400 text-[11px] mt-1">Best-case: 5 stars + photo bonus</p>
            </div>
            {/* Potential Earnings */}
            <div className="rounded-xl p-3 border border-purple-700/40 bg-purple-900/20">
              <p className="text-purple-400 text-[10px] font-semibold uppercase tracking-widest mb-1">Potential Earnings</p>
              <p className="text-purple-300 font-bold text-xl">{formatCurrency(summaryPotentialPay.toFixed(2))}</p>
              <p className="text-slate-400 text-[11px] mt-1">Including all available bonuses</p>
            </div>
            {/* Risk Floor */}
            <div className="rounded-xl p-3 border border-red-800/40 bg-red-900/20">
              <p className="text-red-400 text-[10px] font-semibold uppercase tracking-widest mb-1">Risk Floor</p>
              <p className="text-red-300 font-bold text-xl">{formatCurrency(Math.max(0, summaryRiskFloor).toFixed(2))}</p>
              <p className="text-slate-400 text-[11px] mt-1">If penalties hit</p>
            </div>
          </div>

          {/* See bonus details toggle */}
          <button
            onClick={() => setShowBonusDetails(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-slate-400 hover:text-slate-200 text-xs font-semibold transition-colors border-t border-slate-800/60"
          >
            <span>{showBonusDetails ? "Hide bonus details ↑" : "See bonus details ↓"}</span>
          </button>

          {/* Detailed line items — collapsible */}
          {showBonusDetails && <div className="bg-slate-900/40 divide-y divide-slate-800/60">

          {/* Base pay row */}
          <div className="flex justify-between items-start px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-slate-100 text-sm font-semibold">Base Pay</p>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-900/50 text-teal-300 border border-teal-700/40">Standard</span>
              </div>
              <p className="text-slate-500 text-xs mt-0.5">{job.serviceType ?? "Cleaning service"}</p>
              <p className="text-slate-600 text-xs">Base pay for completing this job</p>
            </div>
            <span className="text-white font-bold text-base">{formatCurrency(summaryBasePay.toFixed(2))}</span>
          </div>

          {/* Rating Bonus row */}
          {(() => {
            const rating = job.customerRating;
            const isMissed = job.missedSomething === 1;
            const isBonus = ratingAdj > 0;
            const isPenalty = ratingAdj < 0;
            const isPending = rating === null && !isMissed && ratingAdj === 0;

            let label = "Rating Bonus";
            let reason = `+$${payRules?.fiveStarBonus ?? 10} for 5 stars · -$${payRules?.lowRatingDeduction ?? 20} for 3 stars or below`;
            let badge = <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-600">Pending</span>;
            let amountEl = <span className="text-slate-400 text-sm font-semibold">${payRules?.fiveStarBonus ?? 10}.00</span>;
            let downsideEl = <span className="text-red-400 text-xs">Downside -${payRules?.lowRatingDeduction ?? 20}.00</span>;

            if (!isPending) {
              if (rating === 5 && !isMissed) {
                label = "5-Star Rating Bonus";
                reason = "Perfect score — keep it up!";
              } else if (isMissed || (rating !== null && rating <= 3)) {
                label = "Rating Penalty";
                reason = isMissed ? "Customer reported an issue" : `${rating}-star rating`;
              } else if (rating !== null) {
                label = `${rating}-Star Rating`;
                reason = "No bonus or penalty at this level";
              }
              badge = isBonus
                ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300 border border-emerald-700/40">Earned</span>
                : isPenalty
                  ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-900/50 text-red-300 border border-red-700/40">Applied</span>
                  : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-600">No change</span>;
              amountEl = <span className={`text-sm font-semibold ${isBonus ? "text-emerald-400" : isPenalty ? "text-red-400" : "text-slate-400"}`}>{isBonus ? "+" : ""}{ratingAdj !== 0 ? formatCurrency(ratingAdj.toFixed(2)) : "—"}</span>;
              downsideEl = <></>;
            }

            return (
              <div className="flex justify-between items-start px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">{badge}<p className="text-slate-100 text-sm font-semibold">{label}</p></div>
                  <p className="text-slate-500 text-xs mt-0.5">{reason}</p>
                  <p className="text-slate-600 text-xs">Final after customer rating</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  {amountEl}
                  <div>{downsideEl}</div>
                </div>
              </div>
            );
          })()}

          {/* Photo Bonus row */}
          {(() => {
            const isPending = photoPending;
            const isEarned = hasPhoto && photoAdjFromDB !== null;
            const isActionNeeded = !hasPhoto && !isComplete;
            const isPenaltyApplied = !hasPhoto && isComplete;
            const badge = isEarned
              ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300 border border-emerald-700/40">Earned</span>
              : isPenaltyApplied
                ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-900/50 text-red-300 border border-red-700/40">Applied</span>
                : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-900/50 text-amber-300 border border-amber-700/40">Action needed</span>;
            return (
              <div className="flex justify-between items-start px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">{badge}<p className="text-slate-100 text-sm font-semibold">{hasPhoto ? "Photo Bonus" : "Photo Bonus"}</p></div>
                  <p className="text-slate-500 text-xs mt-0.5">+${payRules?.photoBonus ?? 5} when after photos are uploaded · -${payRules?.noPhotoPenalty ?? 10} if missing</p>
                  <p className="text-slate-600 text-xs">Upload photos before marking complete</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  {isPending ? (
                    <span className="text-slate-400 text-sm font-semibold">${payRules?.photoBonus ?? 5}.00</span>
                  ) : (
                    <span className={`text-sm font-semibold ${hasPhoto ? "text-emerald-400" : "text-red-400"}`}>{hasPhoto ? "+" : ""}{formatCurrency(photoAdj.toFixed(2))}</span>
                  )}
                  {!hasPhoto && !isComplete && <div><span className="text-red-400 text-xs">Downside -${payRules?.noPhotoPenalty ?? 10}.00</span></div>}
                </div>
              </div>
            );
          })()}

          {/* Reclean Deduction row */}
          {(() => {
            const isApplied = job.recleanPenalty != null;
            const badge = isApplied
              ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-900/50 text-red-300 border border-red-700/40">Applied</span>
              : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-600">Pending</span>;
            return (
              <div className="flex justify-between items-start px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">{badge}<p className="text-slate-100 text-sm font-semibold">Reclean Deduction</p></div>
                  <p className="text-slate-500 text-xs mt-0.5">-${payRules?.recleanPenalty ?? 30} if the job requires a reclean</p>
                  <p className="text-slate-600 text-xs">Avoided when there are no issues</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  {recleanPending ? (
                    <span className="text-red-400 text-sm font-semibold">-${payRules?.recleanPenalty ?? 30}.00</span>
                  ) : (
                    <span className="text-red-400 text-sm font-semibold">{formatCurrency(recleanAdj.toFixed(2))}</span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Streak Bonus row */}
          {(() => {
            const isEarned = streakBonus > 0;
            const badge = isEarned
              ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300 border border-emerald-700/40">Earned</span>
              : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-600">{t("job.locked")}</span>;
            return (
              <div className="flex justify-between items-start px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">{badge}<p className="text-slate-100 text-sm font-semibold">Streak Bonus</p></div>
                  <p className="text-slate-500 text-xs mt-0.5">+${payRules?.streakBonus ?? 50} after {streakTarget} clean jobs with no issues</p>
                  {!isEarned && streakRemaining > 0 && (
                    <p className="text-slate-500 text-xs">{streakRemaining !== 1 ? t("job.streakProgressPlural", { current: streakRemaining }) : t("job.streakProgress", { current: streakRemaining })}</p>
                  )}
                  {/* Progress bar */}
                  {!isEarned && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                        <span>{t("job.progress")}</span>
                        <span>{streakProgress} / {streakTarget} jobs</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all"
                          style={{ width: `${(streakProgress / streakTarget) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 ml-3">
                  <span className={`text-sm font-semibold ${isEarned ? "text-emerald-400" : "text-slate-400"}`}>
                    {isEarned ? "+" : ""}{formatCurrency((payRules?.streakBonus ?? 50).toString())}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Manual adjustment — only shown if set by admin */}
          {manualAdj !== 0 && (
            <div className="flex justify-between items-start px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                    manualAdj > 0 ? "bg-emerald-900/50 text-emerald-300 border-emerald-700/40" : "bg-red-900/50 text-red-300 border-red-700/40"
                  }`}>Applied</span>
                  <p className="text-slate-100 text-sm font-semibold">{manualAdj > 0 ? t("job.manualBonus") : t("job.manualDeduction")}</p>
                </div>
                {job.manualAdjustmentNote && (
                  <p className="text-slate-500 text-xs mt-0.5">{job.manualAdjustmentNote}</p>
                )}
              </div>
              <span className={`font-semibold text-sm shrink-0 ml-3 ${manualAdj > 0 ? "text-emerald-400" : "text-red-400"}`}>
                {manualAdj > 0 ? "+" : ""}{formatCurrency(manualAdj.toFixed(2))}
              </span>
            </div>
          )}

          {/* Active custom pay rules — shown on every job */}
          {shownCustomRules.map(rule => {
            const isBonus = rule.type === "bonus";
            const amt = parseFloat(rule.amount) || 0;
            return (
              <div key={rule.id} className="flex justify-between items-start px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                      isBonus ? "bg-emerald-900/50 text-emerald-300 border-emerald-700/40" : "bg-red-900/50 text-red-300 border-red-700/40"
                    }`}>{isBonus ? t("job.available") : t("job.risk")}</span>
                    <p className="text-slate-100 text-sm font-semibold">{rule.label}</p>
                  </div>
                  {rule.description && (
                    <p className="text-slate-500 text-xs mt-0.5">{rule.description}</p>
                  )}
                </div>
                <span className={`font-semibold text-sm shrink-0 ml-3 ${isBonus ? "text-emerald-400" : "text-red-400"}`}>
                  {isBonus ? "+" : "-"}{formatCurrency(amt.toFixed(2))}
                </span>
              </div>
            );
          })}

          {/* Final total */}
          <div className="flex justify-between items-center px-4 py-4 bg-slate-900/60">
            <div>
              <span className="text-white font-bold text-base">Total Pay</span>
              {!isPayFinalized && (
                <p className="text-slate-500 text-xs mt-0.5">{t("job.previewFinal")}</p>
              )}
            </div>
            <span className={`font-bold text-xl ${finalPay >= basePay ? "text-emerald-400" : "text-red-400"}`}>
              {formatCurrency(finalPay.toFixed(2))}
            </span>
          </div>
          </div>}{/* end divide-y / showBonusDetails */}
        </div>{/* end outer card */}

        {/* Rating */}
        <div className="flex items-center gap-2">
          <StarRating rating={job.customerRating} />
          {job.missedSomething === 1 && (
            <Badge className="bg-red-900/30 text-red-300 border-red-700/30 text-xs ml-auto">
              <AlertCircle className="w-3 h-3 mr-1" />Complaint
            </Badge>
          )}
        </div>

        {/* Photos */}
        {job.photos.length > 0 && (
          <div>
            <button
              className="text-slate-400 text-xs flex items-center gap-1 hover:text-slate-200 transition-colors"
              onClick={() => setShowPhotos(v => !v)}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              {job.photos.length} photo{job.photos.length !== 1 ? "s" : ""} uploaded
              {showPhotos ? " (tap to hide)" : " (tap to show)"}
            </button>
            {showPhotos && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {job.photos.map(p => (
                  <a key={p.id} href={p.photoUrl} target="_blank" rel="noreferrer">
                    <img
                      src={p.photoUrl}
                      alt={p.filename ?? "Job photo"}
                      className="w-full h-20 object-cover rounded-lg border border-slate-600 hover:opacity-80 transition-opacity"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Job Status Buttons */}
        <div className="space-y-2">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest">Job Status</p>
          <div className="flex flex-wrap gap-1.5">
            {JOB_STATUSES.map(s => {
              const isActive = job.jobStatus === s.key;
              const isPending = statusMutation.isPending && statusMutation.variables?.status === s.key;

              // ── Contextual visibility: finishing_up and wrapping_up are mutually exclusive ──
              if (s.key === "finishing_up") {
                // Only show when this job is currently active (in_progress or arrived)
                const isCurrentlyActive =
                  job.jobStatus === "in_progress" ||
                  job.jobStatus === "arrived" ||
                  job.jobStatus === "finishing_up";
                if (!isCurrentlyActive) return null;
              }
              if (s.key === "wrapping_up") {
                // Only show when this job hasn't started yet AND there's a previous job not yet completed
                const isNotStarted = !job.jobStatus || job.jobStatus === "wrapping_up";
                if (!isNotStarted) return null;
                const sorted = [...allJobs]
                  .filter(j => j.bookingStatus !== "cancelled" && j.bookingStatus !== "rescheduled")
                  .sort((a, b) => (a.serviceDateTime ?? "").localeCompare(b.serviceDateTime ?? ""));
                const myIdx = sorted.findIndex(j => j.id === job.id);
                const prevJob = myIdx > 0 ? sorted[myIdx - 1] : null;
                if (!prevJob || prevJob.bookingStatus === "completed") return null;
              }

              return (
                <button
                  key={s.key}
                  onClick={() => {
                    if (s.key === "issue_at_property") {
                      setShowIssueInput(v => !v);
                      setShowEtaPicker(false);
                      setEtaPickerFor(null);
                      return;
                    }
                    if (s.key === "running_late" || s.key === "on_the_way") {
                      // Open the blocking ETA modal
                      setEtaModalFor(s.key as "on_the_way" | "running_late");
                      setCustomEtaTime(defaultEtaTime());
                      setShowEtaModal(true);
                      setShowIssueInput(false);
                      return;
                    }
                    statusMutation.mutate({ cleanerJobId: job.id, status: s.key });
                  }}
                  disabled={statusMutation.isPending}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                    isActive
                      ? s.activeColor + " border-transparent ring-2 ring-white/30 ring-offset-1 ring-offset-slate-900 scale-105 shadow-lg"
                      : s.color + " opacity-60"
                  } ${statusMutation.isPending ? "opacity-50 cursor-not-allowed" : "hover:opacity-100 cursor-pointer"}`}
                >
                  {isPending ? <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-current animate-pulse inline-block" /> …</span> : (
                    isActive ? <span className="inline-flex items-center gap-1">✓ {s.label}</span> : s.label
                  )}
                </button>
              );
            })}
          </div>
          {/* ETA inline picker removed — now a full blocking modal */}

          {/* Issue note input — note is required before submitting */}
          {showIssueInput && (
            <div className="space-y-1.5 mt-1">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">What's the issue? <span className="text-red-500">*</span></p>
              <div className="flex gap-2">
                <Input
                  placeholder="Describe the issue (required)"
                  value={issueNote}
                  onChange={e => setIssueNote(e.target.value)}
                  className={`bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 text-sm h-8 ${
                    issueNote.trim() === "" ? "border-red-600/60" : "border-slate-600"
                  }`}
                  onKeyDown={e => {
                    if (e.key === "Enter" && issueNote.trim()) {
                      statusMutation.mutate({ cleanerJobId: job.id, status: "issue_at_property", issueNote: issueNote.trim() });
                      setShowIssueInput(false);
                    }
                  }}
                  autoFocus
                />
                <Button
                  size="sm"
                  className="bg-red-600 hover:bg-red-500 text-white h-8 px-3 text-xs shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (!issueNote.trim()) return;
                    statusMutation.mutate({ cleanerJobId: job.id, status: "issue_at_property", issueNote: issueNote.trim() });
                    setShowIssueInput(false);
                  }}
                  disabled={statusMutation.isPending || !issueNote.trim()}
                >
                  Report
                </Button>
              </div>
              {issueNote.trim() === "" && (
                <p className="text-[11px] text-red-400">A description is required to report an issue.</p>
              )}
            </div>
          )}
          {(job.jobStatus === "on_the_way" || job.jobStatus === "running_late") && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className={`text-xs rounded px-2 py-1 border flex-1 ${
                  job.jobStatus === "on_the_way"
                    ? "text-blue-300 bg-blue-900/20 border-blue-700/30"
                    : "text-orange-300 bg-orange-900/20 border-orange-700/30"
                }`}>
                  {job.etaTimestamp
                    ? `Arrives ~${new Date(job.etaTimestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
                    : job.jobStatus === "on_the_way" ? "On the Way" : "Running Late"
                  }
                </p>
                <button
                  onClick={() => {
                    setEtaModalFor(job.jobStatus as "on_the_way" | "running_late");
                    setCustomEtaTime(defaultEtaTime());
                    setShowEtaModal(true);
                  }}
                  className={`text-[11px] font-semibold px-2 py-1 rounded-full border transition-colors cursor-pointer ${
                    job.jobStatus === "on_the_way"
                      ? "text-blue-300 border-blue-600/50 bg-blue-900/30 hover:bg-blue-800/50"
                      : "text-orange-300 border-orange-600/50 bg-orange-900/30 hover:bg-orange-800/50"
                  }`}
                >
                  Update ETA
                </button>
              </div>
              {/* Stale ETA banner — shown when ETA has passed by more than 30 min */}
              {job.etaTimestamp !== null && job.etaTimestamp < Date.now() - 30 * 60 * 1000 && (
                <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-900/30 border border-amber-600/40 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <p className="text-amber-300 text-xs flex-1">ETA has passed — tap <strong>Update ETA</strong> to notify your client.</p>
                </div>
              )}
            </div>
          )}
          {job.jobStatus === "issue_at_property" && job.issueNote && (
            <p className="text-xs rounded px-2 py-1 border text-red-300 bg-red-900/20 border-red-700/30">
              Issue: {job.issueNote}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            variant="outline"
            size="sm"
            className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Camera className="w-3.5 h-3.5 mr-1.5" />}
            {uploading
              ? uploadProgress && uploadProgress.total > 1
                ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}…`
                : "Uploading…"
              : "Add Photo"}
          </Button>
          {!isComplete && (
            <Button
              size="sm"
              className={`flex-1 text-white ${
                !allChecked
                  ? "bg-slate-600 hover:bg-amber-600 cursor-pointer"
                  : "bg-emerald-600 hover:bg-emerald-500"
              }`}
              onClick={handleMarkComplete}
              disabled={completing}
            >
              {completing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
              {completing ? "Saving…" : "Mark Complete"}
            </Button>
          )}
        </div>
      </CardContent>

      {/* ── ETA Selection Modal (blocking — must pick before status fires) ── */}
      <Dialog
        open={showEtaModal}
        onOpenChange={(open) => {
          // Only allow closing via Cancel button — not backdrop click or ESC
          if (!open && statusMutation.isPending) return;
          if (!open) setShowEtaModal(false);
        }}
      >
        <DialogContent
          className="bg-slate-900 border-slate-700 text-white max-w-sm mx-auto rounded-2xl"
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-white text-xl flex items-center gap-2">
              {etaModalFor === "on_the_way" ? (
                <>
                  <span className="text-2xl">🚗</span> On the Way
                </>
              ) : (
                <>
                  <span className="text-2xl">⏰</span> Running Late
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {/* Instruction */}
            <div className={`p-3 rounded-xl border ${
              etaModalFor === "on_the_way"
                ? "bg-blue-950/40 border-blue-600/40"
                : "bg-orange-950/40 border-orange-600/40"
            }`}>
              <p className={`text-sm font-semibold ${
                etaModalFor === "on_the_way" ? "text-blue-200" : "text-orange-200"
              }`}>
                When will you arrive at {nextJobEtaTarget?.customerName ?? job.customerName ?? "your client"}'s home?
              </p>
              <p className={`text-xs mt-1 font-semibold ${
                etaModalFor === "on_the_way" ? "text-blue-400" : "text-orange-400"
              }`}>
                ⚠ Your client will be texted this arrival time immediately. Only select a time you can 100% guarantee.
              </p>
            </div>

             {/* ETA option buttons — large, easy to tap */}
            <div className="grid grid-cols-2 gap-3">
              {ETA_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    if (!etaModalFor) return;
                    const targetId = nextJobEtaTarget?.id ?? job.id;
                    statusMutation.mutate({ cleanerJobId: targetId, status: etaModalFor, etaLabel: opt.value });
                    setShowEtaModal(false);
                    setEtaModalFor(null);
                    setNextJobEtaTarget(null);
                    setCustomEtaTime("");
                  }}
                  disabled={statusMutation.isPending}
                  className={`py-4 rounded-2xl text-sm font-bold border-2 transition-all active:scale-95 disabled:opacity-50 ${
                    etaModalFor === "on_the_way"
                      ? "bg-blue-900/50 text-blue-100 border-blue-600/60 hover:bg-blue-700/60 hover:border-blue-400"
                      : "bg-orange-900/50 text-orange-100 border-orange-600/60 hover:bg-orange-700/60 hover:border-orange-400"
                  }`}
                >
                  {statusMutation.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                    : opt.label
                  }
                </button>
              ))}
            </div>

            {/* Custom exact-time picker */}
            <div className={`p-3 rounded-xl border ${
              etaModalFor === "on_the_way"
                ? "bg-blue-950/30 border-blue-700/40"
                : "bg-orange-950/30 border-orange-700/40"
            }`}>
              <p className="text-xs text-slate-400 mb-2 font-medium">Or enter an exact arrival time:</p>
              <div className="flex gap-2 items-center">
                {/* Compute the current time in HH:MM (device local) for the min attribute */}
                <input
                  type="time"
                  value={customEtaTime}
                  min={(() => {
                    const now = new Date();
                    // Add 1 minute buffer so "now" is never selectable
                    now.setMinutes(now.getMinutes() + 1);
                    const hh = String(now.getHours()).padStart(2, "0");
                    const mm = String(now.getMinutes()).padStart(2, "0");
                    return `${hh}:${mm}`;
                  })()}
                  onChange={e => setCustomEtaTime(e.target.value)}
                  disabled={statusMutation.isPending}
                  className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold bg-slate-800 border text-white
                    focus:outline-none focus:ring-2 disabled:opacity-50
                    ${
                      etaModalFor === "on_the_way"
                        ? "border-blue-600/50 focus:ring-blue-500/40"
                        : "border-orange-600/50 focus:ring-orange-500/40"
                    }`}
                />
                <button
                  disabled={(() => {
                    if (!customEtaTime || statusMutation.isPending) return true;
                    // Disable if the chosen time is in the past or within 1 minute of now
                    const [hh, mm] = customEtaTime.split(":").map(Number);
                    const now = new Date();
                    const chosen = new Date(
                      now.getFullYear(), now.getMonth(), now.getDate(),
                      hh, mm, 0, 0
                    );
                    return chosen.getTime() <= Date.now() + 60_000;
                  })()}
                  onClick={() => {
                    if (!etaModalFor || !customEtaTime) return;
                    // Build the ETA date using the device's local time (which is what the cleaner sees)
                    const [hh, mm] = customEtaTime.split(":").map(Number);
                    const now = new Date();
                    const etaDate = new Date(
                      now.getFullYear(), now.getMonth(), now.getDate(),
                      hh, mm, 0, 0
                    );
                    // Safety check — should never happen because button is disabled for past times,
                    // but guard anyway
                    if (etaDate.getTime() <= Date.now() + 60_000) return;
                    // Format label in the device's local timezone (same timezone the cleaner is in)
                    const label = `at ${etaDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
                    const targetId = nextJobEtaTarget?.id ?? job.id;
                    statusMutation.mutate({
                      cleanerJobId: targetId,
                      status: etaModalFor,
                      etaLabel: label,
                      etaTimestampOverride: etaDate.getTime(),
                    });
                    setShowEtaModal(false);
                    setEtaModalFor(null);
                    setNextJobEtaTarget(null);
                    setCustomEtaTime("");
                  }}
                  className={`px-4 py-2.5 rounded-xl text-sm font-bold border-2 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                    etaModalFor === "on_the_way"
                      ? "bg-blue-700 text-white border-blue-500 hover:bg-blue-600"
                      : "bg-orange-700 text-white border-orange-500 hover:bg-orange-600"
                  }`}
                >
                  {statusMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Set"}
                </button>
              </div>
            </div>

            {/* Cancel */}
            <Button
              variant="outline"
              className="w-full border-slate-600 text-slate-400 hover:bg-slate-800 bg-transparent"
              onClick={() => {
                setShowEtaModal(false);
                setEtaModalFor(null);
                setNextJobEtaTarget(null);
              }}
              disabled={statusMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Mark Complete Confirmation Modal ─────────────────────────────── */}
      <Dialog open={showCompleteConfirm} onOpenChange={setShowCompleteConfirm}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm mx-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-white text-lg flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              Mark Job Complete?
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {/* No photos warning */}
            {job.photos.length === 0 && (
              <div className="flex items-start gap-3 p-3 bg-amber-950/60 border border-amber-600/40 rounded-xl">
                <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-300">No photos uploaded</p>
                  <p className="text-xs text-amber-400/80 mt-0.5">No photo upload will cost you $20 and miss out on making $10 extra. We strongly recommend uploading photos.</p>
                </div>
              </div>
            )}

            {/* Are-you-sure confirmation block — always shown */}
            <div className="flex items-start gap-3 p-3 bg-emerald-950/40 border border-emerald-700/40 rounded-xl">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-300">You are completing: {job.customerName ?? "this job"}</p>
                <p className="text-xs text-emerald-400/80 mt-0.5">Your client will receive a completion text message.</p>
              </div>
            </div>

            {/* Wrong-job guard — only shown when another job is actively in progress */}
            {(() => {
              const activeOther = allJobs.find(
                j => j.id !== job.id &&
                  (j.jobStatus === "in_progress" || j.jobStatus === "finishing_up" || j.jobStatus === "arrived")
              );
              if (!activeOther) return null;
              return (
                <div className="flex items-start gap-3 p-3 bg-red-950/60 border border-red-600/50 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-red-300">Wrong job?</p>
                    <p className="text-xs text-red-400/80 mt-0.5">
                      Your active job appears to be <strong className="text-red-200">{activeOther.customerName ?? "another client"}</strong> — are you sure you're completing the right one?
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Irreversible warning */}
            <div className="flex items-start gap-3 p-3 bg-slate-800 border border-slate-700 rounded-xl">
              <AlertCircle className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">Once marked complete, the job is closed.</p>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              {/* Upload photos first — only shown when no photos */}
              {job.photos.length === 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-amber-600/50 text-amber-300 hover:bg-amber-950/60 bg-transparent"
                  onClick={() => {
                    setShowCompleteConfirm(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <Camera className="w-3.5 h-3.5 mr-1.5" />
                  Upload Photos First
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className={`${job.photos.length === 0 ? "" : "flex-1"} border-slate-600 text-slate-300 hover:bg-slate-800 bg-transparent`}
                onClick={() => setShowCompleteConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
                onClick={confirmMarkComplete}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                {job.photos.length === 0 ? "Complete Anyway" : "Yes, Mark Complete"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Post-completion "What's Next" modal ─────────────────────────── */}
      <Dialog open={showPostComplete} onOpenChange={(open) => { setShowPostComplete(open); if (!open) onMarkedComplete(); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm mx-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-white text-lg flex items-center gap-2">
              <span className="text-2xl">🎉</span>
              Job Complete!
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 pt-1">
            {/* Review ask */}
            <div className="p-4 bg-amber-950/60 border border-amber-500/40 rounded-xl">
              <p className="text-amber-300 font-bold text-sm flex items-center gap-2 mb-1">
                <span className="text-lg">⭐</span>
                Earn an extra $${payRules?.googleReviewBonus ?? 50} — Ask for a 5-star Google review
              </p>
              <p className="text-amber-400/80 text-xs">
                Before you leave, ask the client: <span className="italic text-amber-200">"We'd really appreciate it if you could leave us a quick Google review — it only takes 30 seconds!"</span>
              </p>
            </div>

            {/* Next job CTA — only shown if there are remaining non-completed jobs */}
            {(() => {
              const nextJob = allJobs.find(j => j.id !== job.id && j.bookingStatus !== "completed" && j.bookingStatus !== "cancelled" && j.bookingStatus !== "rescheduled");
              if (!nextJob) return null;
              return (
                <div className="p-4 bg-slate-800 border border-slate-700 rounded-xl">
                  <p className="text-slate-300 font-semibold text-sm mb-1">Next job: {nextJob.customerName ?? "Client"}</p>
                  <p className="text-slate-500 text-xs mb-3">{nextJob.jobAddress ?? ""}</p>
                  <Button
                    size="sm"
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white"
                    onClick={() => {
                      setShowPostComplete(false);
                      // Open the blocking ETA modal targeting the next job
                      setNextJobEtaTarget({ id: nextJob.id, customerName: nextJob.customerName ?? null });
                      setEtaModalFor("on_the_way");
                      setCustomEtaTime(defaultEtaTime());
                      setShowEtaModal(true);
                    }}
                  >
                    {t("postComplete.nextJob")}
                  </Button>
                </div>
              );
            })()}

            <Button
              variant="outline"
              size="sm"
              className="w-full border-slate-600 text-slate-300 hover:bg-slate-800 bg-transparent"
              onClick={() => setShowPostComplete(false)}
            >
              {t("postComplete.done")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── WeekJobRow ───────────────────────────────────────────────────────────────

function WeekJobRow({
  j, fp, isFinalized, photos
}: {
  j: { id: number; customerName: string | null; serviceDateTime: string | null; serviceType: string | null; basePay: string | null; customerRating: number | null };
  fp: number;
  isFinalized: boolean;
  photos: Array<{ id: number; photoUrl: string; filename: string | null }>;
}) {
  const { t } = useTranslation();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const currentPhoto = lightboxIdx !== null ? photos[lightboxIdx] : null;

  return (
    <div className="px-4 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-200 text-sm">{j.customerName ?? "Customer"}</p>
          <p className="text-slate-500 text-xs">
            {j.serviceDateTime ? formatTime(j.serviceDateTime) : ""}
            {j.serviceType ? ` · ${j.serviceType}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-sm font-semibold ${fp >= parseFloat(j.basePay ?? "0") ? "text-emerald-400" : "text-red-400"}`}>
            ${fp.toFixed(2)}
          </p>
          {!isFinalized && <p className="text-slate-600 text-xs">{t("week.preview")}</p>}
          {j.customerRating && (
            <div className="flex items-center gap-0.5 justify-end mt-0.5">
              {[1,2,3,4,5].map(i => (
                <Star key={i} className={`w-3 h-3 ${i <= (j.customerRating ?? 0) ? "fill-amber-400 text-amber-400" : "text-slate-600"}`} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Photo thumbnails */}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {photos.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setLightboxIdx(i)}
              className="relative w-10 h-10 rounded overflow-hidden bg-slate-700 group flex-shrink-0 border border-slate-600 hover:border-blue-400 transition-all"
            >
              <img src={p.photoUrl} alt={p.filename ?? `Photo ${i + 1}`} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <ImageIcon className="w-3 h-3 text-white" />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIdx !== null && currentPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxIdx(null)}
        >
          <button className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl" onClick={() => setLightboxIdx(null)}>✕</button>
          {photos.length > 1 && (
            <button className="absolute left-4 text-white/70 hover:text-white text-2xl" onClick={e => { e.stopPropagation(); setLightboxIdx((lightboxIdx - 1 + photos.length) % photos.length); }}>‹</button>
          )}
          <img src={currentPhoto.photoUrl} alt={currentPhoto.filename ?? "Photo"} className="max-h-[85vh] max-w-full rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
          {photos.length > 1 && (
            <button className="absolute right-4 text-white/70 hover:text-white text-2xl" onClick={e => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % photos.length); }}>›</button>
          )}
          {photos.length > 1 && <p className="absolute bottom-4 text-white/50 text-sm">{lightboxIdx + 1} / {photos.length}</p>}
        </div>
      )}
    </div>
  );
}

// ── Main Portal ───────────────────────────────────────────────────────────────

// ── Morning Availability Prompt ──────────────────────────────────────────────
/**
 * Full-screen morning prompt shown at 7:29 AM ET if the cleaner hasn't yet
 * submitted tomorrow's availability. Blocks back-button navigation.
 */
function MorningAvailabilityPrompt({
  open,
  cleanerName,
  onSubmitted,
}: {
  open: boolean;
  cleanerName: string;
  onSubmitted: () => void;
}) {
  const { t } = useTranslation();
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [maxJobs, setMaxJobs] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [step, setStep] = useState<"greeting" | "availability" | "details" | "confirmed">("greeting");

  const submitCheckin = trpc.cleaner.submitCheckin.useMutation({
    onSuccess: () => {
      setStep("confirmed");
      setTimeout(onSubmitted, 2200);
    },
    onError: (err) => toast.error(`Submission failed: ${err.message}`),
  });

  // Block back-button navigation while prompt is open
  useEffect(() => {
    if (!open) return;
    // Push a dummy history entry so back button hits it first
    window.history.pushState({ morningPrompt: true }, "");
    const onPopState = (e: PopStateEvent) => {
      if (e.state?.morningPrompt) return; // already at our entry
      // User hit back — re-push to keep modal open
      window.history.pushState({ morningPrompt: true }, "");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [open]);

  const handleAvailabilityChoice = (available: boolean) => {
    setIsAvailable(available);
    setStep("details");
  };

  const handleSubmit = () => {
    if (isAvailable === null) return;
    if (isAvailable && maxJobs === null) {
      toast.warning("Please select how many jobs you can do tomorrow.");
      return;
    }
    submitCheckin.mutate({
      isAvailable,
      maxJobs: isAvailable ? maxJobs : null,
      note: note.trim() || null,
    });
  };

  // Time-aware greeting
  const hourET = parseInt(
    new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" })
  );
  const greeting =
    hourET < 10 ? `Good morning, ${cleanerName.split(" ")[0]}! ☀️` :
    hourET < 12 ? `Hey ${cleanerName.split(" ")[0]}, almost lunchtime! 🌤` :
    `Hey ${cleanerName.split(" ")[0]}! 👋`;
  // Compute "tomorrow" label in ET timezone, e.g. "Wednesday, May 14"
  // Uses Intl.DateTimeFormat.formatToParts so the ET date is correct regardless of the cleaner's device timezone
  const _etParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const _etTomorrow = new Date(parseInt(_etParts.find(p => p.type === "year")!.value), parseInt(_etParts.find(p => p.type === "month")!.value) - 1, parseInt(_etParts.find(p => p.type === "day")!.value) + 1);
  const tomorrowLabel = _etTomorrow.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      {/* No header — full immersive experience */}
      <div className="flex-1 overflow-y-auto flex flex-col px-4 py-8 max-w-lg mx-auto w-full">

        {/* ── Step: Greeting ─── */}
        {step === "greeting" && (
          <div className="flex-1 flex flex-col items-center justify-center space-y-6 text-center">
            <div className="text-7xl animate-bounce">🌅</div>
            <div className="space-y-2">
              <h2 className="text-white text-3xl font-bold">{greeting}</h2>
              <p className="text-slate-400 text-base leading-relaxed">
                Before you crush it today —<br />
                let us know if you're working tomorrow<br />
                so we can build your schedule.
              </p>
            </div>
            <Button
              className="w-full max-w-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 text-base h-auto rounded-2xl mt-4"
              onClick={() => setStep("availability")}
            >
              Let's do it →
            </Button>
          </div>
        )}

        {/* ── Step: Availability choice ─── */}
        {step === "availability" && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="text-5xl mb-4">🌅</div>
              <h3 className="text-white text-2xl font-bold">Are you working tomorrow, {tomorrowLabel}?</h3>
              <p className="text-slate-400 text-sm">This helps us plan the schedule.</p>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-8">
              <button
                onClick={() => handleAvailabilityChoice(true)}
                className="flex flex-col items-center gap-3 p-6 bg-emerald-900/40 border-2 border-emerald-600/60 rounded-2xl hover:bg-emerald-900/60 hover:border-emerald-500 transition-all active:scale-95"
              >
                <span className="text-4xl">✅</span>
                <span className="text-emerald-300 font-bold text-lg">Yes</span>
                <span className="text-emerald-500 text-xs text-center">I'm available</span>
              </button>
              <button
                onClick={() => handleAvailabilityChoice(false)}
                className="flex flex-col items-center gap-3 p-6 bg-slate-800 border-2 border-slate-600 rounded-2xl hover:bg-slate-700 hover:border-slate-500 transition-all active:scale-95"
              >
                <span className="text-4xl">❌</span>
                <span className="text-slate-300 font-bold text-lg">No</span>
                <span className="text-slate-500 text-xs text-center">Not available</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Details ─── */}
        {step === "details" && isAvailable === true && (
          <div className="space-y-6">
            <div className="text-center space-y-1">
              <div className="text-4xl mb-3">📋</div>
              <h3 className="text-white text-xl font-bold">How many jobs can you do?</h3>
              <p className="text-slate-400 text-sm">This helps us plan tomorrow's schedule.</p>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(n => (
                <button
                  key={n}
                  onClick={() => setMaxJobs(n === 4 ? 10 : n)}
                  className={`py-5 rounded-2xl border-2 font-bold text-xl transition-all active:scale-95 ${
                    (n === 4 ? maxJobs !== null && maxJobs >= 4 : maxJobs === n)
                      ? "bg-emerald-600 border-emerald-500 text-white"
                      : "bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {n === 4 ? "4+" : n}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <label className="text-slate-300 text-sm font-medium block">{t("morning.noteLabel")}</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t("morning.notePlaceholder")}
                rows={3}
                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white placeholder:text-slate-500 text-sm resize-none focus:outline-none focus:border-emerald-500"
                maxLength={500}
              />
            </div>
            <div className="space-y-3 pt-2">
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 text-base h-auto"
                onClick={handleSubmit}
                disabled={submitCheckin.isPending || maxJobs === null}
              >
                {submitCheckin.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Submit Availability
              </Button>
              <button onClick={() => setStep("availability")} className="w-full text-slate-500 text-sm hover:text-slate-300 py-2">← Back</button>
            </div>
          </div>
        )}

        {step === "details" && isAvailable === false && (
          <div className="space-y-6">
            <div className="text-center space-y-1">
              <div className="text-4xl mb-3">📝</div>
              <h3 className="text-white text-xl font-bold">{t("morning.whyNotTitle")}</h3>
              <p className="text-slate-400 text-sm">{t("morning.whyNotSubtitle")}</p>
            </div>
            <div className="space-y-2">
              <label className="text-slate-300 text-sm font-medium block">{t("morning.reasonLabel")}</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t("morning.reasonPlaceholder")}
                rows={4}
                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white placeholder:text-slate-500 text-sm resize-none focus:outline-none focus:border-blue-500"
                maxLength={500}
              />
            </div>
            <div className="space-y-3 pt-2">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 text-base h-auto"
                onClick={handleSubmit}
                disabled={submitCheckin.isPending}
              >
                {submitCheckin.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Submit
              </Button>
              <button onClick={() => setStep("availability")} className="w-full text-slate-500 text-sm hover:text-slate-300 py-2">← Back</button>
            </div>
          </div>
        )}

        {/* ── Step: Confirmed ─── */}
        {step === "confirmed" && (
          <div className="flex-1 flex flex-col items-center justify-center space-y-6 text-center">
            <div className="text-6xl">🎉</div>
            <h3 className="text-white text-2xl font-bold">You're all set!</h3>
            <p className="text-slate-400 text-base">Your availability has been recorded.<br />Go have a great day!</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── End-of-day Check-in Modal ────────────────────────────────────────────────
type CheckinStep = "availability" | "details" | "confirmed";;

function CheckinModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<CheckinStep>("availability");
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [maxJobs, setMaxJobs] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [submittedData, setSubmittedData] = useState<{ isAvailable: boolean; maxJobs: number | null; note: string } | null>(null);

  const submitCheckin = trpc.cleaner.submitCheckin.useMutation({
    onSuccess: () => {
      setSubmittedData({ isAvailable: isAvailable!, maxJobs, note });
      setStep("confirmed");
    },
    onError: (err) => toast.error(`Check-in failed: ${err.message}`),
  });

  const handleAvailabilityChoice = (available: boolean) => {
    setIsAvailable(available);
    setStep("details");
  };

  const handleSubmit = () => {
    if (isAvailable === null) return;
    if (isAvailable && maxJobs === null) {
      toast.warning("Please select how many jobs you can do tomorrow.");
      return;
    }
    submitCheckin.mutate({
      isAvailable,
      maxJobs: isAvailable ? maxJobs : null,
      note: note.trim() || null,
    });
  };

  // Compute "tomorrow" label in ET timezone, e.g. "Wednesday, May 14"
  const _etPartsCheckin = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const _etTomorrowCheckin = new Date(parseInt(_etPartsCheckin.find(p => p.type === "year")!.value), parseInt(_etPartsCheckin.find(p => p.type === "month")!.value) - 1, parseInt(_etPartsCheckin.find(p => p.type === "day")!.value) + 1);
  const tomorrowLabelCheckin = _etTomorrowCheckin.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">End of Day</p>
          <h2 className="text-white font-semibold text-base leading-tight">Tomorrow's Availability</h2>
        </div>
        {step === "confirmed" && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-lg mx-auto w-full">

        {/* ── Step 1: Availability choice ─── */}
        {step === "availability" && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="text-5xl mb-4">🌙</div>
              <h3 className="text-white text-2xl font-bold">Great work today!</h3>
              <p className="text-slate-400 text-base">Are you working tomorrow, {tomorrowLabelCheckin}?</p>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-8">
              <button
                onClick={() => handleAvailabilityChoice(true)}
                className="flex flex-col items-center gap-3 p-6 bg-emerald-900/40 border-2 border-emerald-600/60 rounded-2xl hover:bg-emerald-900/60 hover:border-emerald-500 transition-all active:scale-95"
              >
                <span className="text-4xl">✅</span>
                <span className="text-emerald-300 font-bold text-lg">Yes</span>
                <span className="text-emerald-500 text-xs text-center">I'm available tomorrow</span>
              </button>
              <button
                onClick={() => handleAvailabilityChoice(false)}
                className="flex flex-col items-center gap-3 p-6 bg-slate-800 border-2 border-slate-600 rounded-2xl hover:bg-slate-700 hover:border-slate-500 transition-all active:scale-95"
              >
                <span className="text-4xl">❌</span>
                <span className="text-slate-300 font-bold text-lg">No</span>
                <span className="text-slate-500 text-xs text-center">I'm not available</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2a: Available — job count + note ─── */}
        {step === "details" && isAvailable === true && (
          <div className="space-y-6">
            <div className="text-center space-y-1">
              <div className="text-4xl mb-3">📋</div>
              <h3 className="text-white text-xl font-bold">How many jobs can you do?</h3>
              <p className="text-slate-400 text-sm">This helps us plan tomorrow's schedule.</p>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(n => (
                <button
                  key={n}
                  onClick={() => setMaxJobs(n === 4 ? 10 : n)}
                  className={`py-5 rounded-2xl border-2 font-bold text-xl transition-all active:scale-95 ${
                    (n === 4 ? maxJobs !== null && maxJobs >= 4 : maxJobs === n)
                      ? "bg-emerald-600 border-emerald-500 text-white"
                      : "bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {n === 4 ? "4+" : n}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-slate-300 text-sm font-medium block">{t("morning.noteLabel")}</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t("morning.notePlaceholder")}
                rows={3}
                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white placeholder:text-slate-500 text-sm resize-none focus:outline-none focus:border-emerald-500"
                maxLength={500}
              />
            </div>

            <div className="space-y-3 pt-2">
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 text-base h-auto"
                onClick={handleSubmit}
                disabled={submitCheckin.isPending || maxJobs === null}
              >
                {submitCheckin.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Submit Availability
              </Button>
              <button
                onClick={() => setStep("availability")}
                className="w-full text-slate-500 text-sm hover:text-slate-300 py-2"
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2b: Not available — reason ─── */}
        {step === "details" && isAvailable === false && (
          <div className="space-y-6">
            <div className="text-center space-y-1">
              <div className="text-4xl mb-3">📝</div>
              <h3 className="text-white text-xl font-bold">{t("morning.whyNotTitle")}</h3>
              <p className="text-slate-400 text-sm">{t("morning.whyNotSubtitle")}</p>
            </div>

            <div className="space-y-2">
              <label className="text-slate-300 text-sm font-medium block">{t("morning.reasonLabel")}</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t("morning.reasonPlaceholder")}
                rows={4}
                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-white placeholder:text-slate-500 text-sm resize-none focus:outline-none focus:border-blue-500"
                maxLength={500}
              />
            </div>

            <div className="space-y-3 pt-2">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 text-base h-auto"
                onClick={handleSubmit}
                disabled={submitCheckin.isPending}
              >
                {submitCheckin.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {t("morning.submit")}
              </Button>
              <button
                onClick={() => setStep("availability")}
                className="w-full text-slate-500 text-sm hover:text-slate-300 py-2"
              >
                {t("morning.back")}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Confirmed ─── */}
        {step === "confirmed" && submittedData && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="text-5xl mb-4">🎉</div>
              <h3 className="text-white text-2xl font-bold">{t("morning.allSet")}</h3>
              <p className="text-slate-400 text-base">{t("morning.submitted")}</p>
            </div>

            {/* Summary */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4 space-y-3">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest">{t("morning.whatYouSubmitted")}</p>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{submittedData.isAvailable ? "✅" : "❌"}</span>
                <div>
                  <p className="text-white font-semibold">
                    {submittedData.isAvailable ? t("morning.availableTomorrow") : t("morning.notAvailableTomorrow")}
                  </p>
                  {submittedData.isAvailable && submittedData.maxJobs !== null && (
                    <p className="text-slate-400 text-sm">
                      Up to {submittedData.maxJobs >= 10 ? "4+" : submittedData.maxJobs} job{submittedData.maxJobs !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              </div>
              {submittedData.note && (
                <div className="pt-1 border-t border-slate-700">
                  <p className="text-slate-500 text-xs mb-1">Note</p>
                  <p className="text-slate-300 text-sm">{submittedData.note}</p>
                </div>
              )}
            </div>

            {/* Cancellation disclaimer */}
            <div className="bg-amber-950/50 border border-amber-700/40 rounded-2xl p-4">
              <p className="text-amber-300 font-semibold text-sm flex items-center gap-2 mb-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Important Reminder
              </p>
              <p className="text-amber-400/80 text-xs leading-relaxed">
                If you said you're available but cancel, this will incur a charge equal to the total cost of all of your cancelled appointments.
              </p>
            </div>

            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 text-base h-auto"
              onClick={onClose}
            >
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Portal ───────────────────────────────────────────────────────────────

export default function CleanerPortal() {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState(getTodayET);
  const [activeTab, setActiveTab] = useState<"today" | "week">("today");
  const [showCheckin, setShowCheckin] = useState(false);
  const [showMorningPrompt, setShowMorningPrompt] = useState(false);
  const utils = trpc.useUtils();

  const meQuery = trpc.cleaner.me.useQuery(undefined, {
    retry: false,
  });

  // Check if this cleaner has already submitted tomorrow's availability
  const availabilityCheckQuery = trpc.cleaner.hasSubmittedTomorrowAvailability.useQuery(
    undefined,
    { enabled: !!meQuery.data }
  );

  // Show morning prompt at 7:29 AM ET if availability not yet submitted
  useEffect(() => {
    if (!meQuery.data) return;
    if (availabilityCheckQuery.isLoading || availabilityCheckQuery.data === undefined) return;
    if (availabilityCheckQuery.data.submitted) return; // already done

    // Check current ET time
    const nowET = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const etDate = new Date(nowET);
    const hours = etDate.getHours();
    const minutes = etDate.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    // Show from 7:29 AM (449 min) through end of day (1439 min)
    const SHOW_FROM = 7 * 60 + 29; // 7:29 AM ET
    if (totalMinutes >= SHOW_FROM) {
      setShowMorningPrompt(true);
    }
  }, [meQuery.data, availabilityCheckQuery.data, availabilityCheckQuery.isLoading]);

  const jobsQuery = trpc.cleaner.myJobs.useQuery(
    { date },
    { enabled: !!meQuery.data }
  );

  // Weekly earnings: Mon–Sun of the current week
  const weekStart = (() => {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const day = dt.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day;
    dt.setDate(dt.getDate() + diff);
    return dt.toLocaleDateString("en-CA");
  })();
  const weekEnd = addDays(weekStart, 6);

  const weekQuery = trpc.cleaner.myJobsRange.useQuery(
    { from: weekStart, to: weekEnd },
    { enabled: !!meQuery.data }
  );

  const payRulesQuery = trpc.cleaner.getPayRules.useQuery();
  const payRules = payRulesQuery.data;
  const activeCustomRulesQuery = trpc.cleaner.getActiveCustomRules.useQuery();
  const activeCustomRules = activeCustomRulesQuery.data ?? [];
  const streakInfoQuery = trpc.cleaner.getStreakInfo.useQuery(undefined, { enabled: !!meQuery.data });
  const streakInfo = streakInfoQuery.data;

  const logoutMutation = trpc.cleaner.logout.useMutation({
    onSuccess: () => utils.cleaner.me.invalidate(),
  });
  const updateLanguageMutation = trpc.cleaner.updateLanguage.useMutation();
  // Sync language from server profile on load
  useEffect(() => {
    const lang = meQuery.data?.language;
    if (lang && ["en", "es", "pt"].includes(lang) && i18n.language !== lang) {
      i18n.changeLanguage(lang);
    }
  }, [meQuery.data?.language]);

  const refetch = () => {
    utils.cleaner.myJobs.invalidate({ date });
    utils.cleaner.myJobsRange.invalidate();
  };

  // Called from JobCard after a job is marked complete.
  // Checks if this was the last active job of the day — if so, shows the check-in modal.
  const handleJobMarkedComplete = (completedJobId: number) => {
    refetch();
    // Only trigger on today's date
    if (date !== getTodayET()) return;
    // Read directly from query data — jobs variable is defined after this function
    const allJobsNow = (jobsQuery.data ?? []) as Job[];
    const activeJobs = allJobsNow.filter(j => j.bookingStatus !== "rescheduled" && j.bookingStatus !== "cancelled");
    const previouslyCompleted = activeJobs.filter(j => j.id !== completedJobId && j.bookingStatus === "completed");
    // Fire on the FIRST job completed (no other jobs were completed before this one)
    // Skip if they already submitted morning availability
    if (activeJobs.length > 0 && previouslyCompleted.length === 0 && !availabilityCheckQuery.data?.submitted) {
      setShowCheckin(true);
    }
  };

  // weekDays must be computed before any early returns (hooks rule)
  const weekJobs0 = weekQuery.data ?? [];
  const weekDays = useMemo(() => {
    const days: { date: string; jobs: typeof weekJobs0 }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      days.push({ date: d, jobs: weekJobs0.filter(j => j.jobDate === d) });
    }
    return days;
  }, [weekJobs0, weekStart]);

  // Not yet loaded
  if (meQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  // Not logged in
  if (!meQuery.data) {
    return <LoginForm onLogin={() => utils.cleaner.me.invalidate()} />;
  }

  const cleaner = meQuery.data;
  const allJobs = (jobsQuery.data ?? []) as Job[];
  // Split: active jobs (show full card) vs removed (show stripped badge card)
  const jobs = allJobs.filter(j => j.bookingStatus !== "rescheduled" && j.bookingStatus !== "cancelled");
  const removedJobs = allJobs.filter(j => j.bookingStatus === "rescheduled" || j.bookingStatus === "cancelled");
  const weekJobs = weekJobs0;

  // Earnings summary — only count active (non-removed) jobs
  // Always sum components directly so photoAdjustment is always included
  const calcJobPay = (j: { basePay?: string | null; ratingAdjustment?: string | null; photoAdjustment?: string | null; photoSubmitted?: number | null; photos?: unknown[]; streakBonus?: string | null; manualAdjustment?: string | null; recleanPenalty?: string | null; bookingStatus?: string | null }) => {
    const base = parseFloat(j.basePay ?? "0") || 0;
    const rating = parseFloat(j.ratingAdjustment ?? "0") || 0;
    const hasPhoto = j.photoSubmitted === 1 || ((j.photos as unknown[])?.length ?? 0) > 0;
    const isComplete = j.bookingStatus === "completed";
    // Only apply photo penalty if job is completed (photoAdjustment set in DB) or photo already uploaded
    const photoFromDB = j.photoAdjustment != null ? parseFloat(j.photoAdjustment) : null;
    const photo = photoFromDB ?? (hasPhoto ? 5 : 0);
    const streak = parseFloat(j.streakBonus ?? "0") || 0;
    const manual = parseFloat(j.manualAdjustment ?? "0") || 0;
    const reclean = j.recleanPenalty != null ? parseFloat(j.recleanPenalty) : 0;
    void isComplete; // used for display logic in JobCard; calcJobPay uses DB values directly
    return base + rating + photo + streak + manual + reclean;
  };
  const todayEarnings = jobs.reduce((sum, j) => sum + calcJobPay(j), 0);
  const weekEarnings = weekJobs.reduce((sum, j) => sum + calcJobPay(j), 0);

  const completedToday = jobs.filter(j => j.bookingStatus === "completed").length;
  const avgRating = jobs.filter(j => j.customerRating).reduce((sum, j, _, arr) => sum + (j.customerRating ?? 0) / arr.length, 0);

  const isToday = date === getTodayET();

  return (
    <>
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{t("header.brand")}</p>
          <h1 className="text-white font-semibold text-base leading-tight">{cleaner.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(["en", "es", "pt"] as const).map(lang => (
              <button
                key={lang}
                onClick={() => {
                  i18n.changeLanguage(lang);
                  updateLanguageMutation.mutate({ language: lang });
                }}
                className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${i18n.language === lang ? "text-white font-bold" : "text-slate-500 hover:text-slate-300"}`}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white"
            onClick={() => logoutMutation.mutate()}
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
       </header>

      {/* Sticky availability reminder banner — shown if not yet submitted and past 7:29 AM ET */}
      {!availabilityCheckQuery.data?.submitted && !showMorningPrompt && (() => {
        const nowET = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
        const etDate = new Date(nowET);
        const totalMinutes = etDate.getHours() * 60 + etDate.getMinutes();
        return totalMinutes >= 7 * 60 + 29;
      })() && (
        <div
          className="bg-amber-600/20 border-b border-amber-500/40 px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-amber-600/30 transition-colors"
          onClick={() => setShowMorningPrompt(true)}
        >
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-base">⚠️</span>
            <span className="text-amber-200 text-sm font-medium">{t("banner.notSubmitted")}</span>
          </div>
          <span className="text-amber-400 text-xs font-semibold">{t("banner.tap")}</span>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
        {/* Earnings summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-400 text-xs font-medium">{t("earnings.today")}</span>
            </div>
            <p className="text-emerald-400 text-2xl font-bold">${todayEarnings.toFixed(2)}</p>
            <p className="text-slate-500 text-xs mt-0.5">{jobs.length} job{jobs.length !== 1 ? "s" : ""} · {completedToday} done</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span className="text-slate-400 text-xs font-medium">{t("earnings.thisWeek")}</span>
            </div>
            <p className="text-blue-400 text-2xl font-bold">${weekEarnings.toFixed(2)}</p>
            <p className="text-slate-500 text-xs mt-0.5">{weekJobs.length} job{weekJobs.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {/* Rating summary (if any rated jobs today) */}
        {avgRating > 0 && (
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 flex items-center gap-3">
            <div className="flex">
              {[1, 2, 3, 4, 5].map(i => (
                <Star key={i} className={`w-4 h-4 ${i <= Math.round(avgRating) ? "fill-amber-400 text-amber-400" : "text-slate-600"}`} />
              ))}
            </div>
            <span className="text-white font-medium">{avgRating.toFixed(1)} {t("earnings.avgToday")}</span>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex bg-slate-800 rounded-xl p-1 border border-slate-700">
          <button
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "today" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
            onClick={() => setActiveTab("today")}
          >
            {t("tabs.today")}
          </button>
          <button
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "week" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
            onClick={() => setActiveTab("week")}
          >
            {t("tabs.thisWeek")}
          </button>
        </div>

        {activeTab === "week" ? (
          /* ── This Week View ── */
          <div className="space-y-4">
            {/* Weekly grand total */}
            <div className="bg-gradient-to-r from-blue-900/40 to-slate-800 rounded-xl p-4 border border-blue-700/30">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-1">{t("week.total")}</p>
              <p className="text-blue-400 text-3xl font-bold">${weekEarnings.toFixed(2)}</p>
              <p className="text-slate-500 text-xs mt-1">
                {formatDate(weekStart)} – {formatDate(weekEnd)}
              </p>
            </div>

            {/* How Your Pay Works */}
            {payRules && (
              <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-3">{t("week.howPayWorks")}</p>
                <div className="space-y-2">
                  {([
                    { label: t("week.fiveStar"), value: `+$${payRules.fiveStarBonus}`, color: "text-emerald-400" },
                    { label: t("week.completionPhoto"), value: `+$${payRules.photoBonus}`, color: "text-emerald-400" },
                    { label: t("week.streakBonus", { n: payRules.streakTarget }), value: `+$${payRules.streakBonus}`, color: "text-emerald-400" },
                    { label: t("week.lowRating"), value: `-$${payRules.lowRatingDeduction}`, color: "text-red-400" },
                    { label: t("week.noPhoto"), value: `-$${payRules.noPhotoPenalty}`, color: "text-red-400" },
                    { label: t("week.reclean"), value: `-$${payRules.recleanPenalty}`, color: "text-red-400" },
                  ] as { label: string; value: string; color: string }[]).map(row => (
                    <div key={row.label} className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">{row.label}</span>
                      <span className={`font-semibold ${row.color}`}>{row.value}</span>
                    </div>
                  ))}
                </div>
                {/* Active custom rules */}
                {activeCustomRules.length > 0 && (
                  <>
                    <div className="border-t border-slate-700/50 my-2" />
                    {activeCustomRules.map(r => (
                      <div key={r.id} className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">{r.label}</span>
                        <span className={`font-semibold ${r.type === "bonus" ? "text-purple-400" : "text-red-400"}`}>
                          {r.type === "bonus" ? "+" : "-"}${parseFloat(r.amount).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </>
                )}
                <p className="text-slate-600 text-xs mt-3">{t("week.bonusesNote")}</p>
              </div>
            )}

            {/* Daily rows */}
            {weekDays.map(({ date: d, jobs: dayJobs }) => {
              const dayTotal = dayJobs.reduce((sum, j) => sum + calcJobPay(j), 0);
              const dayName = new Date(...(d.split("-").map((v, i) => i === 1 ? Number(v) - 1 : Number(v)) as [number, number, number])).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
              const isCurrentDay = d === getTodayET();
              return (
                <div
                  key={d}
                  className={`rounded-xl border ${
                    isCurrentDay ? "bg-slate-800 border-emerald-700/40" : "bg-slate-800/60 border-slate-700/50"
                  }`}
                >
                  {/* Day header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${isCurrentDay ? "text-emerald-300" : "text-slate-200"}`}>
                        {dayName}
                      </span>
                      {isCurrentDay && (
                        <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-700/30 px-1.5 py-0.5 rounded-full">{t("week.todayBadge")}</span>
                      )}
                    </div>
                    <span className={`font-bold text-sm ${dayTotal > 0 ? "text-emerald-400" : "text-slate-500"}`}>
                      {dayJobs.length > 0 ? `$${dayTotal.toFixed(2)}` : "—"}
                    </span>
                  </div>

                  {/* Job rows */}
                  {dayJobs.length === 0 ? (
                    <p className="text-slate-600 text-xs px-4 py-3">{t("week.noJobs")}</p>
                  ) : (
                    <div className="divide-y divide-slate-700/30">
                      {dayJobs.map(j => {
                        const fp = calcJobPay(j);
                        const isFinalized = j.ratingAdjustment != null;
                        const photos = j.photos ?? [];
                        return (
                          <WeekJobRow
                            key={j.id}
                            j={j}
                            fp={fp}
                            isFinalized={isFinalized}
                            photos={photos}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Today View ── */
          <>
        {/* Date navigation */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="border-slate-600 text-slate-300 hover:bg-slate-700 shrink-0"
            onClick={() => setDate(d => addDays(d, -1))}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 text-center">
            <p className="text-white font-semibold">{isToday ? t("date.today") : formatDate(date)}</p>
            {!isToday && <p className="text-slate-500 text-xs">{date}</p>}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="border-slate-600 text-slate-300 hover:bg-slate-700 shrink-0"
            onClick={() => setDate(d => addDays(d, 1))}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Jump to today */}
        {!isToday && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-slate-400 hover:text-white border border-slate-700"
            onClick={() => setDate(getTodayET())}
          >
            <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
            {t("date.jumpToToday")}
          </Button>
        )}

        {/* Job list */}
        {jobsQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
          </div>
        ) : jobs.length === 0 && removedJobs.length === 0 ? (
          <div className="text-center py-12">
            <CalendarDays className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">{t("date.noJobs")}</p>
            <p className="text-slate-600 text-sm mt-1">{t("date.noJobsFor")} {formatDate(date)}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                allJobs={jobs}
                onPhotoUploaded={refetch}
                onMarkedComplete={() => handleJobMarkedComplete(job.id)}
                onStatusUpdated={refetch}
                payRules={payRules}
                activeCustomRules={activeCustomRules}
                streakInfo={streakInfo}
                cleanerName={cleaner.name}
              />
            ))}

            {/* Removed / rescheduled jobs — stripped card */}
            {removedJobs.length > 0 && (
              <div className="space-y-2">
                <p className="text-slate-600 text-xs font-semibold uppercase tracking-widest px-1">{t("removed.header")}</p>
                {removedJobs.map(job => {
                  const isRescheduled = job.bookingStatus === "rescheduled";
                  return (
                    <div
                      key={job.id}
                      className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3 flex items-center justify-between opacity-60"
                    >
                      <div className="min-w-0">
                        <p className="text-slate-400 font-medium text-sm line-through truncate">
                          {job.customerName ?? "Client"}
                        </p>
                        {job.serviceDateTime && (
                          <p className="text-slate-600 text-xs mt-0.5">{formatTime(job.serviceDateTime)}</p>
                        )}
                      </div>
                      <span className={`ml-3 shrink-0 inline-flex items-center text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border ${
                        isRescheduled
                          ? "bg-amber-900/30 text-amber-400 border-amber-700/40"
                          : "bg-slate-700/50 text-slate-500 border-slate-600/40"
                      }`}>
                        {isRescheduled ? t("job.status.rescheduled") : t("job.status.cancelled")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
           </>
        )}
      </div>
    </div>

    {/* End-of-day check-in modal — fullscreen takeover */}
    <CheckinModal open={showCheckin} onClose={() => setShowCheckin(false)} />

    {/* Morning availability prompt — fullscreen, shown at 7:29 AM ET if not yet submitted */}
    <MorningAvailabilityPrompt
      open={showMorningPrompt}
      cleanerName={meQuery.data?.name ?? ""}
      onSubmitted={() => {
        setShowMorningPrompt(false);
        availabilityCheckQuery.refetch();
      }}
    />
    </>
  );
}