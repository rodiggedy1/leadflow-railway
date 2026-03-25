/**
 * CleanerPortal — /cleaner
 *
 * Individual cleaner portal. Login with phone + password.
 * Shows today's jobs (with date browsing), pay breakdown, ratings, photo upload, mark complete.
 */
import { useState, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Camera, Star, CheckCircle2, Clock, MapPin, DollarSign,
  ChevronLeft, ChevronRight, Upload, Loader2, LogOut, User,
  CalendarDays, TrendingUp, ImageIcon, CheckCheck, AlertCircle
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = trpc.cleaner.login.useMutation({
    onSuccess: () => {
      toast.success("Welcome back!");
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
          <CardTitle className="text-white text-xl">Cleaner Portal</CardTitle>
          <p className="text-slate-400 text-sm">Maids in Black</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-slate-300 text-sm font-medium block mb-1.5">Email</label>
            <Input
              type="email"
              placeholder="cleaner@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-emerald-500"
              autoFocus
              onKeyDown={e => e.key === "Enter" && loginMutation.mutate({ email: email.trim(), password })}
            />
          </div>
          <div>
            <label className="text-slate-300 text-sm font-medium block mb-1.5">Password</label>
            <Input
              type="password"
              placeholder="••••••••"
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
  { key: "on_the_way",       label: "On the Way",       color: "bg-blue-600/30 text-blue-300 border-blue-600/40",     activeColor: "bg-blue-600 text-white" },
  { key: "in_progress",      label: "In Progress",      color: "bg-amber-600/30 text-amber-300 border-amber-600/40",  activeColor: "bg-amber-500 text-white" },
  { key: "running_late",     label: "Running Late",     color: "bg-orange-600/30 text-orange-300 border-orange-600/40", activeColor: "bg-orange-500 text-white" },
  { key: "issue_at_property",label: "Issue at Property",color: "bg-red-600/30 text-red-300 border-red-600/40",       activeColor: "bg-red-600 text-white" },
] as const;

function JobCard({ job, onPhotoUploaded, onMarkedComplete, onStatusUpdated, payRules }: {
  job: Job;
  onPhotoUploaded: () => void;
  onMarkedComplete: () => void;
  onStatusUpdated: () => void;
  payRules?: { fiveStarBonus: number; lowRatingDeduction: number; photoBonus: number; noPhotoPenalty: number; streakBonus: number; streakTarget: number; recleanPenalty: number } | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [completing, setCompleting] = useState(false);
  const [showPhotos, setShowPhotos] = useState(true);
  const [showIssueInput, setShowIssueInput] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const [showEtaPicker, setShowEtaPicker] = useState(false);
  const [etaPickerFor, setEtaPickerFor] = useState<"on_the_way" | "running_late" | null>(null);

  const ETA_OPTIONS = [
    { label: "30 minutes", value: "30 minutes" },
    { label: "1 hour",     value: "1 hour" },
    { label: "1 hr 30 min", value: "1 hr 30 min" },
    { label: "2 hours",    value: "2 hours" },
    { label: "Don't know", value: "Don't know" },
  ];

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
    setCompleting(true);
    completeMutation.mutate({ cleanerJobId: job.id });
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
  // Custom pay rules applied by admin (e.g. Google Review bonus, Late penalty)
  const customRules = job.customRules ?? [];
  const customRulesTotal = customRules.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  // Always recalculate display total from components — stored finalPay may be stale
  // (e.g. set before photoAdjustment column existed). DB finalPay is for payroll records only.
  const finalPay = basePay + ratingAdj + photoAdj + streakBonus + manualAdj + recleanAdj + customRulesTotal;
  const isPayFinalized = job.ratingAdjustment != null; // pay is finalized once rating is processed

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
            <Badge className="bg-emerald-600/30 text-emerald-300 border-emerald-600/40 text-xs">
              <CheckCheck className="w-3 h-3 mr-1" />Complete
            </Badge>
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

        {/* Pay breakdown */}
        <div className="bg-slate-900/60 rounded-xl p-4 space-y-0">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-3">Pay Breakdown</p>

          {/* Base pay */}
          <div className="flex justify-between items-start py-2 border-b border-slate-800">
            <div>
              <p className="text-slate-200 text-sm font-medium">Base Pay</p>
              <p className="text-slate-500 text-xs mt-0.5">{job.serviceType ?? "Cleaning service"}</p>
            </div>
            <span className="text-white font-semibold text-sm">{formatCurrency(job.basePay)}</span>
          </div>

          {/* Rating bonus/penalty */}
          {(() => {
            const rating = job.customerRating;
            const isMissed = job.missedSomething === 1;
            const isBonus = ratingAdj > 0;
            const isPenalty = ratingAdj < 0;

            // No rating yet — show pending with rules
            if (rating === null && !isMissed && ratingAdj === 0) {
              return (
                <div className="flex justify-between items-start py-2 border-b border-slate-800">
                  <div>
                    <p className="text-slate-400 text-sm font-medium">Rating Bonus</p>
                    <p className="text-slate-500 text-xs mt-0.5"><span style={{color: '#34d399'}}>+${payRules?.fiveStarBonus ?? 10}</span> for 5 stars · <span style={{color: '#f87171'}}>-${payRules?.lowRatingDeduction ?? 20}</span> for 3 stars or below</p>
                  </div>
                  <span className="text-slate-500 text-xs italic">Pending</span>
                </div>
              );
            }

            // Rating received — show result
            let label = "Rating";
            let reason = "";
            if (rating === 5 && !isMissed) {
              label = "5-Star Rating Bonus";
              reason = "Perfect score — keep it up!";
            } else if (isMissed) {
              label = "Rating Penalty";
              reason = "Customer reported an issue";
            } else if (rating !== null && rating <= 3) {
              label = "Rating Penalty";
              reason = `${rating}-star rating`;
            } else if (rating !== null) {
              label = `${rating}-Star Rating`;
              reason = "No bonus or penalty at this level";
            }

            return (
              <div className="flex justify-between items-start py-2 border-b border-slate-800">
                <div>
                  <p className={`text-sm font-medium ${isBonus ? "text-emerald-300" : isPenalty ? "text-red-300" : "text-slate-200"}`}>{label}</p>
                  {reason && <p className="text-slate-500 text-xs mt-0.5">{reason}</p>}
                </div>
                <span className={`font-semibold text-sm ${isBonus ? "text-emerald-400" : isPenalty ? "text-red-400" : "text-slate-400"}`}>
                  {isBonus ? "+" : ""}{ratingAdj !== 0 ? formatCurrency(ratingAdj.toFixed(2)) : "—"}
                </span>
              </div>
            );
          })()}

          {/* Photo bonus/penalty */}
          <div className="flex justify-between items-start py-2 border-b border-slate-800">
            <div>
              <p className={`text-sm font-medium ${hasPhoto ? "text-emerald-300" : photoPending ? "text-slate-400" : "text-red-300"}`}>
                {hasPhoto ? "Photo Bonus" : "No Photo Penalty"}
              </p>
              <p className="text-slate-500 text-xs mt-0.5">
                {hasPhoto ? "Completion photo uploaded" : <>Upload a photo to earn <span style={{color: '#34d399'}}>+${payRules?.photoBonus ?? 5}</span> and avoid <span style={{color: '#f87171'}}>-${payRules?.noPhotoPenalty ?? 10}</span></>}
              </p>
            </div>
            {photoPending ? (
              <span className="text-slate-500 text-xs italic">Pending</span>
            ) : (
              <span className={`font-semibold text-sm ${hasPhoto ? "text-emerald-400" : "text-red-400"}`}>
                {hasPhoto ? "+" : ""}{formatCurrency(photoAdj.toFixed(2))}
              </span>
            )}
          </div>

          {/* Reclean penalty */}
          <div className="flex justify-between items-start py-2 border-b border-slate-800">
            <div>
              <p className={`text-sm font-medium ${job.recleanPenalty != null ? "text-red-300" : "text-slate-400"}`}>
                Poor Service / Reclean
              </p>
              <p className="text-slate-500 text-xs mt-0.5"><span style={{color: '#f87171'}}>-${payRules?.recleanPenalty ?? 30}</span> if job requires a reclean</p>
            </div>
            {recleanPending ? (
              <span className="text-slate-500 text-xs italic">Pending</span>
            ) : (
              <span className="font-semibold text-sm text-red-400">
                {formatCurrency(recleanAdj.toFixed(2))}
              </span>
            )}
          </div>

          {/* Streak bonus */}
          {streakBonus > 0 ? (
            <div className="flex justify-between items-start py-2 border-b border-slate-800">
              <div>
                <p className="text-emerald-300 text-sm font-medium">Streak Bonus</p>
                <p className="text-slate-500 text-xs mt-0.5">10 clean jobs in a row — amazing work!</p>
              </div>
              <span className="text-emerald-400 font-semibold text-sm">+{formatCurrency(job.streakBonus)}</span>
            </div>
          ) : (
            <div className="flex justify-between items-start py-2 border-b border-slate-800">
              <div>
                <p className="text-slate-400 text-sm font-medium">Streak Bonus</p>
                <p className="text-slate-500 text-xs mt-0.5"><span style={{color: '#34d399'}}>+${payRules?.streakBonus ?? 50}</span> for {payRules?.streakTarget ?? 10} clean jobs with no issues</p>
              </div>
              <span className="text-slate-500 text-xs italic">Not earned</span>
            </div>
          )}

          {/* Manual adjustment — only shown if set by admin */}
          {manualAdj !== 0 && (
            <div className="flex justify-between items-start py-2 border-b border-slate-800">
              <div>
                <p className={`text-sm font-medium ${manualAdj > 0 ? "text-emerald-300" : "text-red-300"}`}>
                  {manualAdj > 0 ? "Adjustment (Bonus)" : "Adjustment (Deduction)"}
                </p>
                {job.manualAdjustmentNote && (
                  <p className="text-slate-500 text-xs mt-0.5">{job.manualAdjustmentNote}</p>
                )}
              </div>
              <span className={`font-semibold text-sm ${manualAdj > 0 ? "text-emerald-400" : "text-red-400"}`}>
                {manualAdj > 0 ? "+" : ""}{formatCurrency(manualAdj.toFixed(2))}
              </span>
            </div>
          )}

          {/* Custom pay rules applied by admin */}
          {customRules.map(rule => {
            const amt = parseFloat(rule.amount) || 0;
            const isBonus = amt > 0;
            return (
              <div key={rule.id} className="flex justify-between items-start py-2 border-b border-slate-800">
                <div>
                  <p className={`text-sm font-medium ${isBonus ? "text-emerald-300" : "text-red-300"}`}>
                    {rule.label}
                  </p>
                  <p className="text-slate-500 text-xs mt-0.5">{isBonus ? "Bonus" : "Deduction"} applied by manager</p>
                </div>
                <span className={`font-semibold text-sm ${isBonus ? "text-emerald-400" : "text-red-400"}`}>
                  {isBonus ? "+" : ""}{formatCurrency(amt.toFixed(2))}
                </span>
              </div>
            );
          })}

          {/* Final total */}
          <div className="flex justify-between items-center pt-3 mt-1">
            <div>
              <span className="text-white font-bold text-base">Total Pay</span>
              {!isPayFinalized && (
                <p className="text-slate-500 text-xs mt-0.5">Preview — final once rated</p>
              )}
            </div>
            <span className={`font-bold text-xl ${finalPay >= basePay ? "text-emerald-400" : "text-red-400"}`}>
              {formatCurrency(finalPay.toFixed(2))}
            </span>
          </div>
        </div>

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
                      // Toggle picker open/closed; re-tap on active status also reopens it
                      const alreadyOpen = showEtaPicker && etaPickerFor === s.key;
                      setShowEtaPicker(!alreadyOpen);
                      setEtaPickerFor(alreadyOpen ? null : s.key as "on_the_way" | "running_late");
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
          {/* ETA picker for On the Way / Running Late */}
          {showEtaPicker && etaPickerFor && (
            <div className={`mt-2 p-3 rounded-xl space-y-2 border ${
              etaPickerFor === "on_the_way"
                ? "bg-blue-950/30 border-blue-700/40"
                : "bg-orange-950/30 border-orange-700/40"
            }`}>
              <p className={`text-xs font-semibold uppercase tracking-widest ${
                etaPickerFor === "on_the_way" ? "text-blue-300" : "text-orange-300"
              }`}>
                {job.jobStatus === etaPickerFor && job.issueNote ? "Update ETA" : "When will you arrive?"}
              </p>
              <div className="flex flex-wrap gap-2">
                {ETA_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      statusMutation.mutate({ cleanerJobId: job.id, status: etaPickerFor, etaLabel: opt.value });
                      setShowEtaPicker(false);
                      setEtaPickerFor(null);
                    }}
                    disabled={statusMutation.isPending}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50 ${
                      etaPickerFor === "on_the_way"
                        ? "bg-blue-900/40 text-blue-200 border-blue-700/50 hover:bg-blue-800/60"
                        : "bg-orange-900/40 text-orange-200 border-orange-700/50 hover:bg-orange-800/60"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Issue note input */}
          {showIssueInput && (
            <div className="flex gap-2 mt-1">
              <Input
                placeholder="Describe the issue (optional)"
                value={issueNote}
                onChange={e => setIssueNote(e.target.value)}
                className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 text-sm h-8"
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    statusMutation.mutate({ cleanerJobId: job.id, status: "issue_at_property", issueNote: issueNote || undefined });
                    setShowIssueInput(false);
                  }
                }}
              />
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-500 text-white h-8 px-3 text-xs shrink-0"
                onClick={() => {
                  statusMutation.mutate({ cleanerJobId: job.id, status: "issue_at_property", issueNote: issueNote || undefined });
                  setShowIssueInput(false);
                }}
                disabled={statusMutation.isPending}
              >
                Report
              </Button>
            </div>
          )}
          {(job.jobStatus === "on_the_way" || job.jobStatus === "running_late") && (
            <p className={`text-xs rounded px-2 py-1 border ${
              job.jobStatus === "on_the_way"
                ? "text-blue-300 bg-blue-900/20 border-blue-700/30"
                : "text-orange-300 bg-orange-900/20 border-orange-700/30"
            }`}>
              {job.etaTimestamp
                ? `Arrives ~${new Date(job.etaTimestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
                : job.issueNote === "Don't know" ? "ETA unknown" : null
              }
            </p>
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
          {!isFinalized && <p className="text-slate-600 text-xs">Preview</p>}
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

export default function CleanerPortal() {
  const [date, setDate] = useState(getTodayET);
  const [activeTab, setActiveTab] = useState<"today" | "week">("today");
  const utils = trpc.useUtils();

  const meQuery = trpc.cleaner.me.useQuery(undefined, { retry: false });
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

  const logoutMutation = trpc.cleaner.logout.useMutation({
    onSuccess: () => utils.cleaner.me.invalidate(),
  });

  const refetch = () => {
    utils.cleaner.myJobs.invalidate({ date });
    utils.cleaner.myJobsRange.invalidate();
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
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Maids in Black</p>
          <h1 className="text-white font-semibold text-base leading-tight">{cleaner.name}</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-white"
          onClick={() => logoutMutation.mutate()}
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </header>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
        {/* Earnings summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-400 text-xs font-medium">Today</span>
            </div>
            <p className="text-emerald-400 text-2xl font-bold">${todayEarnings.toFixed(2)}</p>
            <p className="text-slate-500 text-xs mt-0.5">{jobs.length} job{jobs.length !== 1 ? "s" : ""} · {completedToday} done</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span className="text-slate-400 text-xs font-medium">This Week</span>
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
            <span className="text-white font-medium">{avgRating.toFixed(1)} avg today</span>
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
            Today
          </button>
          <button
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "week" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
            onClick={() => setActiveTab("week")}
          >
            This Week
          </button>
        </div>

        {activeTab === "week" ? (
          /* ── This Week View ── */
          <div className="space-y-4">
            {/* Weekly grand total */}
            <div className="bg-gradient-to-r from-blue-900/40 to-slate-800 rounded-xl p-4 border border-blue-700/30">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-1">Week Total</p>
              <p className="text-blue-400 text-3xl font-bold">${weekEarnings.toFixed(2)}</p>
              <p className="text-slate-500 text-xs mt-1">
                {formatDate(weekStart)} – {formatDate(weekEnd)}
              </p>
            </div>

            {/* How Your Pay Works */}
            {payRules && (
              <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-3">How Your Pay Works</p>
                <div className="space-y-2">
                  {([
                    { label: "5-Star Rating", value: `+$${payRules.fiveStarBonus}`, color: "text-emerald-400" },
                    { label: "Completion Photo", value: `+$${payRules.photoBonus}`, color: "text-emerald-400" },
                    { label: `Streak Bonus (every ${payRules.streakTarget} jobs)`, value: `+$${payRules.streakBonus}`, color: "text-emerald-400" },
                    { label: "Low Rating (\u22643 stars)", value: `-$${payRules.lowRatingDeduction}`, color: "text-red-400" },
                    { label: "No Photo", value: `-$${payRules.noPhotoPenalty}`, color: "text-red-400" },
                    { label: "Reclean / Poor Service", value: `-$${payRules.recleanPenalty}`, color: "text-red-400" },
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
                <p className="text-slate-600 text-xs mt-3">Bonuses and deductions are applied automatically when your job is rated.</p>
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
                        <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-700/30 px-1.5 py-0.5 rounded-full">Today</span>
                      )}
                    </div>
                    <span className={`font-bold text-sm ${dayTotal > 0 ? "text-emerald-400" : "text-slate-500"}`}>
                      {dayJobs.length > 0 ? `$${dayTotal.toFixed(2)}` : "—"}
                    </span>
                  </div>

                  {/* Job rows */}
                  {dayJobs.length === 0 ? (
                    <p className="text-slate-600 text-xs px-4 py-3">No jobs</p>
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
            <p className="text-white font-semibold">{isToday ? "Today" : formatDate(date)}</p>
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
            Jump to Today
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
            <p className="text-slate-400 font-medium">No jobs scheduled</p>
            <p className="text-slate-600 text-sm mt-1">for {formatDate(date)}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                onPhotoUploaded={refetch}
                onMarkedComplete={refetch}
                onStatusUpdated={refetch}
                payRules={payRules}
              />
            ))}

            {/* Removed / rescheduled jobs — stripped card */}
            {removedJobs.length > 0 && (
              <div className="space-y-2">
                <p className="text-slate-600 text-xs font-semibold uppercase tracking-widest px-1">Removed from Schedule</p>
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
                        {isRescheduled ? "Rescheduled" : "Cancelled"}
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
  );
}
