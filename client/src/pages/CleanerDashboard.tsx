/**
 * CleanerDashboard — /admin/quality
 *
 * Shows today's jobs for all cleaners (admin-facing view until cleaner auth is built).
 * Features:
 *  - Date picker to browse any day's jobs
 *  - Per-job card: customer name, address, service type, revenue, cleaner assignment
 *  - Service time displayed prominently on each card
 *  - View toggle: "By Time" (chronological) vs "By Cleaner" (grouped by team)
 *  - Customer rating badge (once received)
 *  - Photo upload per job (completion photo)
 *  - Weekly pay summary per cleaner
 */
import { useState, useRef, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Camera, Star, AlertTriangle, CheckCircle2, Clock, MapPin,
  DollarSign, User, ChevronLeft, ChevronRight, Upload, Loader2,
  CalendarDays, TrendingUp, RefreshCw, List, Users, KeyRound, ExternalLink,
  X, ZoomIn, Images, Pencil, Link2, Search, AlertCircle, CheckCircle, GitMerge
} from "lucide-react";
import { Input } from "@/components/ui/input";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return formatDate(date);
}

/** Format an ISO datetime string to a short local time, e.g. "9:30 AM" */
function formatServiceTime(serviceDateTime: string | null): string | null {
  if (!serviceDateTime) return null;
  try {
    const d = new Date(serviceDateTime);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return null;
  }
}

function RatingStars({ rating }: { rating: number | null }) {
  if (rating === null) return null;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`w-4 h-4 ${s <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
      <span className="ml-1 text-sm font-medium">{rating}/5</span>
    </div>
  );
}

function RatingBadge({ rating }: { rating: number | null }) {
  if (rating === null) return null;
  if (rating === 5) return <Badge className="bg-emerald-500 text-white text-xs">5★ Excellent</Badge>;
  if (rating === 4) return <Badge className="bg-green-500 text-white text-xs">4★ Good</Badge>;
  if (rating === 3) return <Badge className="bg-yellow-500 text-white text-xs">3★ Average</Badge>;
  if (rating <= 2) return <Badge className="bg-red-500 text-white text-xs">{rating}★ Poor</Badge>;
  return null;
}

function formatEtaTime(ts: number | null | undefined): string | null {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

// A palette of distinct, readable accent colors for cleaner identification.
// Colors are chosen to be visually distinct and work on both light/dark backgrounds.
const CLEANER_ACCENT_PALETTE = [
  { border: "border-l-teal-400",    bg: "" },
  { border: "border-l-violet-400",  bg: "" },
  { border: "border-l-sky-400",     bg: "" },
  { border: "border-l-rose-400",    bg: "" },
  { border: "border-l-emerald-400", bg: "" },
  { border: "border-l-amber-400",   bg: "" },
  { border: "border-l-fuchsia-400", bg: "" },
  { border: "border-l-cyan-400",    bg: "" },
  { border: "border-l-orange-400",  bg: "" },
  { border: "border-l-indigo-400",  bg: "" },
];

/** Returns a stable accent color for a given cleaner profile ID */
function cleanerAccentBorder(cleanerProfileId: number | null | undefined): string {
  if (!cleanerProfileId) return "border-l-muted-foreground/20";
  const idx = cleanerProfileId % CLEANER_ACCENT_PALETTE.length;
  return CLEANER_ACCENT_PALETTE[idx].border;
}

function JobStatusBadge({ status, issueNote, etaTimestamp }: { status: string | null; issueNote?: string | null; etaTimestamp?: number | null }) {
  if (!status) return null;
  const configs: Record<string, { label: string; className: string }> = {
    on_the_way:        { label: "On the Way",        className: "bg-blue-100 text-blue-700 border-blue-200" },
    in_progress:       { label: "In Progress",       className: "bg-amber-100 text-amber-700 border-amber-200" },
    running_late:      { label: "⏰ Running Late",    className: "bg-orange-100 text-orange-700 border-orange-200" },
    issue_at_property: { label: "🚨 Issue",           className: "bg-red-100 text-red-700 border-red-200" },
    completed:         { label: "✓ Completed",        className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  };
  const cfg = configs[status];
  if (!cfg) return null;

  const etaTime = formatEtaTime(etaTimestamp);

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2 py-0.5 ${cfg.className}`}>
      {cfg.label}
      {status === "issue_at_property" && issueNote && (
        <span className="text-red-600 font-normal">: {issueNote}</span>
      )}
      {(status === "on_the_way" || status === "running_late") && (
        <span className={`font-normal ${status === "on_the_way" ? "text-blue-600" : "text-orange-600"}`}>
          {etaTime ? `· ~${etaTime}` : issueNote === "Don't know" ? "· ETA unknown" : null}
        </span>
      )}
    </span>
  );
}

// ── Photo Upload Component ────────────────────────────────────────────────────

function PhotoUploadButton({
  job,
  onSuccess,
}: {
  job: {
    id: number;
    cleanerAssignment: { id: number; cleanerProfileId: number; photoSubmitted: number | null } | null;
    photos: Array<{ id: number; photoUrl: string; thumbnailUrl: string | null; filename: string | null }>;
  };
  onSuccess: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const upload = trpc.quality.uploadJobPhoto.useMutation({
    onSuccess: () => {
      toast.success("Photo uploaded", { description: "Completion photo saved successfully." });
      onSuccess();
    },
    onError: (err) => {
      toast.error("Upload failed", { description: err.message });
    },
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0 || !job.cleanerAssignment) return;

    const oversized = files.filter(f => f.size > 10 * 1024 * 1024);
    if (oversized.length > 0) {
      toast.error("File too large", { description: `${oversized.length} photo(s) exceed 10MB and were skipped.` });
    }
    const valid = files.filter(f => f.size <= 10 * 1024 * 1024);
    if (valid.length === 0) return;

    setUploading(true);
    setUploadProgress({ current: 0, total: valid.length });
    try {
      // Upload all selected photos sequentially
      for (let i = 0; i < valid.length; i++) {
        setUploadProgress({ current: i + 1, total: valid.length });
        await new Promise<void>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const base64 = (reader.result as string).split(",")[1];
              await upload.mutateAsync({
                cleanerJobId: job.cleanerAssignment!.id,
                completedJobId: job.id,
                cleanerProfileId: job.cleanerAssignment!.cleanerProfileId,
                filename: valid[i].name,
                mimeType: valid[i].type,
                base64Data: base64,
              });
              resolve();
            } catch (err) {
              reject(err);
            }
          };
          reader.readAsDataURL(valid[i]);
        });
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
      e.target.value = "";
    }
  };

  const hasPhoto = job.photos.length > 0 || job.cleanerAssignment?.photoSubmitted === 1;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (hasPhoto) {
    const photos = job.photos;
    const currentPhoto = lightboxIndex !== null ? photos[lightboxIndex] : null;

    return (
      <>
        {/* Thumbnail strip — max 5 visible + overflow chip */}
        {photos.length > 0 ? (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Images className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs font-medium text-emerald-700">{photos.length} photo{photos.length !== 1 ? 's' : ''} submitted</span>
            </div>
            <div className="flex items-center gap-1.5">
              {photos.slice(0, 5).map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setLightboxIndex(i)}
                  className="relative group w-12 h-12 rounded-md overflow-hidden border border-slate-200 hover:border-emerald-400 transition-all flex-shrink-0"
                >
                  <img
                    src={p.thumbnailUrl ?? p.photoUrl}
                    alt={p.filename ?? `Photo ${i + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                    width={48}
                    height={48}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                    <ZoomIn className="w-3 h-3 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
              {photos.length > 5 && (
                <button
                  onClick={() => setLightboxIndex(5)}
                  className="w-12 h-12 rounded-md border border-slate-200 bg-slate-100 hover:bg-slate-200 transition-all flex-shrink-0 flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="text-xs font-bold text-slate-600">+{photos.length - 5}</span>
                  <span className="text-[9px] text-slate-400 leading-none">more</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-emerald-600">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-xs font-medium">Photo submitted</span>
          </div>
        )}

        {/* Lightbox */}
        {lightboxIndex !== null && currentPhoto && (
          <div
            className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
            onClick={() => setLightboxIndex(null)}
          >
            <button
              className="absolute top-4 right-4 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-all"
              onClick={() => setLightboxIndex(null)}
            >
              <X className="w-6 h-6" />
            </button>
            {photos.length > 1 && (
              <>
                <button
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-all"
                  onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex - 1 + photos.length) % photos.length); }}
                >
                  <ChevronLeft className="w-8 h-8" />
                </button>
                <button
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-all"
                  onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex + 1) % photos.length); }}
                >
                  <ChevronRight className="w-8 h-8" />
                </button>
              </>
            )}
            <div className="max-w-4xl max-h-[90vh] px-16" onClick={(e) => e.stopPropagation()}>
              <img
                src={currentPhoto.photoUrl}
                alt={currentPhoto.filename ?? `Photo ${lightboxIndex + 1}`}
                className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              />
              {photos.length > 1 && (
                <p className="text-center text-white/50 text-sm mt-3">{lightboxIndex + 1} / {photos.length}</p>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFile} />
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
        disabled={uploading || !job.cleanerAssignment}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
        {uploading
          ? uploadProgress && uploadProgress.total > 1
            ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}…`
            : "Uploading..."
          : "Upload photo"}
      </Button>
    </>
  );
}

// ── Cleaner Assignment Selector ───────────────────────────────────────────────

function CleanerAssignSelector({
  jobId,
  currentCleanerProfileId,
  onAssigned,
}: {
  jobId: number;
  currentCleanerProfileId: number | null;
  onAssigned: () => void;
}) {
  const { data: cleaners } = trpc.quality.listCleaners.useQuery();
  const assign = trpc.quality.assignCleaner.useMutation({
    onSuccess: () => {
      toast.success("Cleaner assigned");
      onAssigned();
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  return (
    <Select
      value={currentCleanerProfileId ? String(currentCleanerProfileId) : ""}
      onValueChange={(val) => {
        if (!val) return;
        assign.mutate({ completedJobId: jobId, cleanerProfileId: Number(val) });
      }}
    >
      <SelectTrigger className="h-8 text-sm w-44">
        <SelectValue placeholder="Assign cleaner…" />
      </SelectTrigger>
      <SelectContent>
        {(cleaners ?? []).map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Job Card ──────────────────────────────────────────────────────────────────

type JobRow = {
  id: number;
  name: string | null;
  address: string | null;
  serviceType: string | null;
  lastBookingPrice: number | null;
  jobDate: string;
  serviceDateTime: string | null;
  bookingStatus: string | null;
  bookingId: number | null;
  trackerToken: string | null;
  customerPhone: string | null;
  cleanerAssignment: {
    id: number;
    completedJobId: number;
    cleanerProfileId: number;
    cleanerName: string;
    teamName: string | null;
    basePay: string | null;
    payPercent: string | null;
    finalPay: string | null;
    ratingAdjustment: string | null;
    photoAdjustment: string | null;
    streakBonus: string | null;
    customerRating: number | null;
    missedSomething: number | null;
    photoSubmitted: number;
    flagged: number;
    adminNotes: string | null;
    jobStatus: string | null;
    issueNote: string | null;
    etaTimestamp: number | null;
    manualAdjustment: string | null;
    manualAdjustmentNote: string | null;
    recleanPenalty: string | null;
    googleReviewBonus: string | null;
    customerNotes: string | null;
    staffNotes: string | null;
    checklistItems: Array<{ text: string; checked: boolean }> | null;
    appliedCustomRules: Array<{ id: number; customPayRuleId: number; appliedLabel: string; appliedAmount: string; appliedType: string }>;
  };
  photos: Array<{ id: number; photoUrl: string; thumbnailUrl: string | null; filename: string | null }>;
};

// ── Unified Pay Breakdown Panel ─────────────────────────────────────────────
/**
 * PayBreakdownPanel — shows every pay line item for a job and lets the admin
 * toggle / edit each one inline. Replaces ManualAdjustButton, RecleanPenaltyButton,
 * and CustomRulesButton with a single cohesive UI.
 */
function PayBreakdownPanel({ job, onRefetch }: { job: JobRow; onRefetch: () => void }) {
  const [open, setOpen] = useState(false);
  const cleanerJobId = job.cleanerAssignment?.id;
  // Manual adjustment inline edit state
  const [editingManual, setEditingManual] = useState(false);
  const [manualAmount, setManualAmount] = useState("");
  const [manualNote, setManualNote] = useState("");

  const rulesQuery = trpc.quality.getJobCustomRules.useQuery(
    { cleanerJobId: cleanerJobId! },
    { enabled: open && !!cleanerJobId }
  );
  const payRulesQuery = trpc.settings.getPayRules.useQuery(undefined, { enabled: open });

  const applyRule = trpc.quality.applyCustomRule.useMutation({
    onSuccess: () => { rulesQuery.refetch(); onRefetch(); },
    onError: (err) => toast.error("Failed", { description: err.message }),
  });
  const removeRule = trpc.quality.removeCustomRule.useMutation({
    onSuccess: () => { rulesQuery.refetch(); onRefetch(); },
    onError: (err) => toast.error("Failed", { description: err.message }),
  });
  const setReclean = trpc.quality.setRecleanPenalty.useMutation({
    onSuccess: () => onRefetch(),
    onError: (err) => toast.error("Failed", { description: err.message }),
  });
  const setGoogleReview = trpc.quality.setGoogleReviewBonus.useMutation({
    onSuccess: () => onRefetch(),
    onError: (err) => toast.error("Failed", { description: err.message }),
  });
  const setAdj = trpc.quality.setManualAdjustment.useMutation({
    onSuccess: () => { setEditingManual(false); onRefetch(); },
    onError: (err) => toast.error("Failed", { description: err.message }),
  });
  const overrideRating = trpc.quality.overrideRatingAdj.useMutation({
    onSuccess: () => onRefetch(),
    onError: (err) => toast.error("Failed", { description: err.message }),
  });
  const overridePhoto = trpc.quality.overridePhotoAdj.useMutation({
    onSuccess: () => onRefetch(),
    onError: (err) => toast.error("Failed", { description: err.message }),
  });
  const overrideStreak = trpc.quality.overrideStreakBonus.useMutation({
    onSuccess: () => onRefetch(),
    onError: (err) => toast.error("Failed", { description: err.message }),
  });

  if (!job.cleanerAssignment) return null;
  const ca = job.cleanerAssignment;

  const appliedIds = new Set((rulesQuery.data?.applied ?? []).map((r) => r.customPayRuleId));
  const allActive = rulesQuery.data?.allActive ?? [];
  const hasReclean = ca.recleanPenalty != null;
  const hasGoogleReview = ca.googleReviewBonus != null;

  // Compute net pay from all line items
  const base = parseFloat(ca.basePay ?? "0");
  const ratingAdj = parseFloat(ca.ratingAdjustment ?? "0");
  // Pay rules from Settings (fall back to defaults if not loaded yet)
  const payRules = payRulesQuery.data;
  const photoBonusAmt = payRules?.photoBonus ?? 5;
  const noPhotoPenaltyAmt = payRules?.noPhotoPenalty ?? 10;
  const recleanPenaltyAmt = payRules?.recleanPenalty ?? 30;
  const googleReviewBonusAmt = payRules?.googleReviewBonus ?? 50;
  // Photo adj is now always in DB (applied on upload). Fall back to computed value for safety.
  const photoAdj = ca.photoAdjustment != null
    ? parseFloat(ca.photoAdjustment)
    : (ca.photoSubmitted ? photoBonusAmt : -noPhotoPenaltyAmt);
  const streak = parseFloat(ca.streakBonus ?? "0");
  const manual = parseFloat(ca.manualAdjustment ?? "0");
  const reclean = hasReclean ? parseFloat(ca.recleanPenalty ?? "0") : 0;
  const googleReview = hasGoogleReview ? parseFloat(ca.googleReviewBonus ?? "0") : 0;
  const customTotal = (ca.appliedCustomRules ?? []).reduce(
    (s, r) => s + (r.appliedType === "bonus" ? 1 : -1) * parseFloat(r.appliedAmount),
    0
  );
  const netPay = base + ratingAdj + photoAdj + streak + manual + reclean + googleReview + customTotal;

  const hasAnyAdjustment = ratingAdj !== 0 || photoAdj !== 0 || streak !== 0 || manual !== 0 || hasReclean || hasGoogleReview || (ca.appliedCustomRules?.length ?? 0) > 0;

  // Helper: a single toggleable/editable row in the breakdown
  function PayRow({
    label, amount, color, locked, onToggle, toggled, pending, dimmed, note,
  }: {
    label: string;
    amount: number;
    color: string;
    locked?: boolean;
    onToggle?: () => void;
    toggled?: boolean;
    pending?: boolean;
    dimmed?: boolean;
    note?: string;
  }) {
    const sign = amount >= 0 ? "+" : "";
    return (
      <div className={`flex items-center justify-between gap-2 py-1.5 px-2 rounded-md ${
        locked ? "" : "hover:bg-gray-50 cursor-pointer"
      } ${pending ? "opacity-50" : ""} ${dimmed ? "opacity-50" : ""}`}
        onClick={locked ? undefined : onToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          {!locked && (
            <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
              toggled ? "border-gray-600 bg-gray-600" : "border-gray-300"
            }`}>
              {toggled && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
            </div>
          )}
          {locked && <div className="w-3.5 h-3.5 shrink-0" />}
          <div className="min-w-0">
            <span className="text-sm text-gray-700 truncate block">{label}</span>
            {note && <span className="text-xs text-gray-400">{note}</span>}
          </div>
        </div>
        <span className={`text-sm font-semibold shrink-0 ${color}`}>
          {dimmed && amount === 0 ? "—" : amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `+$${amount.toFixed(2)}`}
        </span>
      </div>
    );
  }

  const handleOpenPanel = () => {
    setEditingManual(false);
    setManualAmount(ca.manualAdjustment ?? "");
    setManualNote(ca.manualAdjustmentNote ?? "");
    setOpen(true);
  };

  const handleSaveManual = () => {
    const parsed = parseFloat(manualAmount);
    if (manualAmount && isNaN(parsed)) {
      toast.error("Invalid amount — enter a number like 10 or -15");
      return;
    }
    setAdj.mutate({
      cleanerJobId: cleanerJobId!,
      amount: manualAmount ? parsed.toFixed(2) : null,
      note: manualNote.trim() || null,
    });
  };

  return (
    <>
      {/* Trigger button on the card */}
      <Button
        variant="outline"
        size="sm"
        className={`gap-1.5 text-xs h-7 px-2 ${
          hasAnyAdjustment
            ? "border-blue-400/60 text-blue-600 hover:bg-blue-50"
            : "border-gray-300 text-gray-500 hover:bg-gray-50"
        }`}
        onClick={handleOpenPanel}
      >
        <DollarSign className="w-3 h-3" />
        Pay Breakdown
      </Button>

      {/* Panel dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Pay Breakdown</DialogTitle>
            <p className="text-xs text-gray-500">{ca.cleanerName} — {job.name ?? job.address}</p>
          </DialogHeader>

          <div className="space-y-0.5 py-1">
            {/* Base pay — always shown, locked */}
            <div className="flex items-center justify-between gap-2 py-1.5 px-2">
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 shrink-0" />
                <span className="text-sm font-medium text-gray-800">Base pay</span>
                {ca.payPercent && (
                  <span className="text-xs text-gray-400">({parseFloat(ca.payPercent)}%)</span>
                )}
              </div>
              <span className="text-sm font-semibold text-gray-800">${base.toFixed(2)}</span>
            </div>

            {/* Divider */}
            <div className="border-t border-dashed border-gray-200 my-1" />

            {/* Rating adjustment — toggleable */}
            <PayRow
              label={
                ratingAdj > 0 ? "5-star bonus"
                : ratingAdj < 0
                  ? (ca.missedSomething ? "Complaint deduction" : "Low rating deduction")
                  : "Rating bonus / deduction"
              }
              amount={ratingAdj}
              color={ratingAdj > 0 ? "text-emerald-600" : ratingAdj < 0 ? "text-red-500" : "text-gray-400"}
              toggled={ratingAdj !== 0}
              pending={overrideRating.isPending}
              dimmed={ratingAdj === 0}
              note={ratingAdj === 0 ? "Pending customer rating" : undefined}
              onToggle={() => {
                if (ratingAdj !== 0) {
                  // Remove it (zero out)
                  overrideRating.mutate({ cleanerJobId: cleanerJobId!, amount: null });
                } else {
                  toast.info("Rating adjustment is set automatically when a rating arrives.");
                }
              }}
            />

            {/* Photo adjustment — toggleable */}
            <PayRow
              label={photoAdj >= 0 ? "Completion photo bonus" : "No photo penalty"}
              amount={photoAdj}
              color={photoAdj > 0 ? "text-emerald-600" : photoAdj < 0 ? "text-red-500" : "text-gray-400"}
              toggled={photoAdj !== 0}
              pending={overridePhoto.isPending}
              dimmed={false}
              onToggle={() => {
                // Toggle: if currently applied (non-zero), remove it; otherwise restore the auto-calculated value
                if (photoAdj !== 0) {
                  overridePhoto.mutate({ cleanerJobId: cleanerJobId!, amount: null });
                } else {
                  // Re-apply based on whether photos were submitted
                  overridePhoto.mutate({ cleanerJobId: cleanerJobId!, amount: ca.photoSubmitted ? photoBonusAmt : -noPhotoPenaltyAmt });
                }
              }}
            />

            {/* Streak bonus — toggleable */}
            <PayRow
              label="Streak bonus"
              amount={streak}
              color={streak > 0 ? "text-emerald-600" : "text-gray-400"}
              toggled={streak > 0}
              pending={overrideStreak.isPending}
              dimmed={streak === 0}
              note={streak === 0 ? `Earned every ${payRules?.streakTarget ?? 10} consecutive jobs` : undefined}
              onToggle={() => {
                if (streak > 0) {
                  overrideStreak.mutate({ cleanerJobId: cleanerJobId!, amount: null });
                } else {
                  toast.info("Streak bonus is set automatically when streak milestone is reached.");
                }
              }}
            />

            {/* Reclean penalty — always shown, toggleable */}
            <PayRow
              label="Reclean penalty"
              amount={hasReclean ? reclean : -recleanPenaltyAmt}
              color={hasReclean ? "text-red-500" : "text-gray-400"}
              toggled={hasReclean}
              pending={setReclean.isPending}
              dimmed={!hasReclean}
              onToggle={() => setReclean.mutate({ cleanerJobId: cleanerJobId!, apply: !hasReclean })}
            />
            {/* Custom rules — each toggleable */}
            {rulesQuery.isLoading && open && (
              <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
            )}
            {allActive.map((rule) => {
              const isApplied = appliedIds.has(rule.id);
              const isPending = applyRule.isPending || removeRule.isPending;
              return (
                <PayRow
                  key={rule.id}
                  label={rule.label}
                  amount={(rule.type === "bonus" ? 1 : -1) * parseFloat(rule.amount)}
                  color={rule.type === "bonus" ? "text-purple-600" : "text-red-500"}
                  toggled={isApplied}
                  pending={isPending}
                  onToggle={() => {
                    if (isApplied) removeRule.mutate({ cleanerJobId: cleanerJobId!, customPayRuleId: rule.id });
                    else applyRule.mutate({ cleanerJobId: cleanerJobId!, customPayRuleId: rule.id });
                  }}
                />
              );
            })}

            {/* Manual adjustment — editable inline */}
            <div className="border-t border-dashed border-gray-200 my-1" />
            {!editingManual ? (
              <div
                className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md hover:bg-gray-50 cursor-pointer"
                onClick={() => { setEditingManual(true); setManualAmount(ca.manualAdjustment ?? ""); setManualNote(ca.manualAdjustmentNote ?? ""); }}
              >
                <div className="flex items-center gap-2">
                  <Pencil className="w-3 h-3 text-gray-400" />
                  <span className="text-sm text-gray-600">
                    {ca.manualAdjustment ? (
                      <>
                        Manual adj
                        {ca.manualAdjustmentNote && <span className="text-gray-400"> ({ca.manualAdjustmentNote})</span>}
                      </>
                    ) : (
                      <span className="text-gray-400 italic">Add manual adjustment…</span>
                    )}
                  </span>
                </div>
                {ca.manualAdjustment && (
                  <span className={`text-sm font-semibold ${
                    parseFloat(ca.manualAdjustment) >= 0 ? "text-emerald-600" : "text-red-500"
                  }`}>
                    {parseFloat(ca.manualAdjustment) >= 0 ? "+" : ""}${parseFloat(ca.manualAdjustment).toFixed(2)}
                  </span>
                )}
              </div>
            ) : (
              <div className="px-2 py-2 space-y-2">
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Amount (e.g. 10 or -15)"
                    value={manualAmount}
                    onChange={e => setManualAmount(e.target.value)}
                    className="h-7 text-xs"
                    autoFocus
                  />
                  <Button size="sm" className="h-7 text-xs px-2" onClick={handleSaveManual} disabled={setAdj.isPending}>
                    {setAdj.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setEditingManual(false)}>✕</Button>
                </div>
                <Input
                  placeholder="Reason (shown to cleaner)"
                  value={manualNote}
                  onChange={e => setManualNote(e.target.value)}
                  className="h-7 text-xs"
                  onKeyDown={e => e.key === "Enter" && handleSaveManual()}
                />
              </div>
            )}
          </div>

          {/* Net pay total */}
          <div className="border-t border-gray-200 pt-3 flex items-center justify-between px-2">
            <span className="text-sm font-semibold text-gray-800">Net pay</span>
            <span className="text-lg font-bold text-gray-900">${netPay.toFixed(2)}</span>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UncompleteButton({ job, onRefetch }: { job: JobRow; onRefetch: () => void }) {
  const isCompleted = job.bookingStatus === "completed";
  const uncomplete = trpc.quality.uncompleteJob.useMutation({
    onSuccess: () => {
      toast.success("Job reopened — cleaner can now upload photos");
      onRefetch();
    },
    onError: (err: { message: string }) => toast.error("Failed", { description: err.message }),
  });

  if (!job.cleanerAssignment || !isCompleted) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-xs h-7 px-2 border-slate-500/50 text-slate-400 hover:bg-slate-700/40"
      onClick={() => uncomplete.mutate({ cleanerJobId: job.cleanerAssignment!.id })}
      disabled={uncomplete.isPending}
    >
      {uncomplete.isPending ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <>↩ Reopen for Photos</>
      )}
    </Button>
  );
}

function SendTrackerLinkButton({ job }: { job: JobRow }) {
  const [sent, setSent] = useState(false);
  const [resending, setResending] = useState(false);
  const send = trpc.tracker.sendSingleLink.useMutation({
    onSuccess: () => {
      setSent(true);
      setResending(false);
      toast.success("Tracker link sent", { description: `Sent to ${job.customerPhone ?? "customer"}` });
    },
    onError: (err) => {
      setResending(false);
      toast.error("Failed to send", { description: err.message });
    },
  });

  const getLink = trpc.tracker.getTrackerLink.useMutation({
    onSuccess: (data) => {
      navigator.clipboard.writeText(data.trackerUrl).then(() => {
        toast.success("Copied!", { description: data.trackerUrl });
      });
    },
    onError: (err) => {
      toast.error("Failed to get link", { description: err.message });
    },
  });

  if (!job.customerPhone) {
    // No phone — still allow copy
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs border-slate-300 text-slate-600 hover:bg-slate-50"
        disabled={getLink.isPending}
        onClick={() => getLink.mutate({ cleanerJobId: job.id })}
      >
        {getLink.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
        {getLink.isPending ? "Getting..." : "Copy Tracker Link"}
      </Button>
    );
  }

  if (sent && !resending) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-xs text-emerald-600">
          <CheckCircle2 className="w-3 h-3" />
          Tracker Sent
        </span>
        <button
          className="text-xs text-sky-500 hover:text-sky-700 underline underline-offset-2 transition-colors"
          onClick={() => { setResending(true); send.mutate({ cleanerJobId: job.id }); }}
        >
          Resend
        </button>
        <button
          className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2 transition-colors"
          onClick={() => getLink.mutate({ cleanerJobId: job.id })}
        >
          {getLink.isPending ? "Copying..." : "Copy link"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs border-sky-300 text-sky-600 hover:bg-sky-50"
        disabled={send.isPending}
        onClick={() => send.mutate({ cleanerJobId: job.id })}
      >
        {send.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
        {send.isPending ? "Sending..." : "Send Tracker Link"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs border-slate-300 text-slate-600 hover:bg-slate-50"
        disabled={getLink.isPending}
        onClick={() => getLink.mutate({ cleanerJobId: job.id })}
      >
        {getLink.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
        {getLink.isPending ? "Copying..." : "Copy Link"}
      </Button>
    </div>
  );
}

function JobCard({ job, onRefetch }: { job: JobRow; onRefetch: () => void }) {
  const rating = job.cleanerAssignment?.customerRating ?? null;
  const hasMissed = job.cleanerAssignment?.missedSomething === 1;
  const isLowRating = rating !== null && rating <= 3;
  const isFlagged = isLowRating || hasMissed;
  const serviceTime = formatServiceTime(job.serviceDateTime);

  // Collapsible notes/checklist — open by default only when flagged
  const [notesOpen, setNotesOpen] = useState(isFlagged);
  const [checklistOpen, setChecklistOpen] = useState(isFlagged);

  // ETA alert: re-evaluate every 30s so cards update live
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const etaTs = job.cleanerAssignment?.etaTimestamp ?? null;
  const isEtaStatus = job.cleanerAssignment?.jobStatus === "on_the_way" || job.cleanerAssignment?.jobStatus === "running_late";
  const etaOverdue   = isEtaStatus && etaTs !== null && now > etaTs;
  const etaDueSoon   = isEtaStatus && etaTs !== null && !etaOverdue && (etaTs - now) <= 10 * 60 * 1000;

  const accentBorder = cleanerAccentBorder(job.cleanerAssignment?.cleanerProfileId);

  const cardClass = etaOverdue
    ? `rounded-xl border-l-4 border-l-red-500 border-t border-r border-b border-red-200 bg-red-50 shadow-sm ring-1 ring-red-200`
    : etaDueSoon
    ? `rounded-xl border-l-4 border-l-amber-500 border-t border-r border-b border-amber-200 bg-amber-50 shadow-sm ring-1 ring-amber-200`
    : isFlagged
    ? `rounded-xl border-l-4 ${accentBorder} border-t border-r border-b border-red-200 bg-red-50/60 shadow-sm`
    : job.cleanerAssignment
    ? `rounded-xl border-l-4 ${accentBorder} border-t border-r border-b border-gray-200 bg-white shadow-sm`
    : "rounded-xl border border-gray-200 bg-white shadow-sm";

  return (
    <div className={`transition-all ${cardClass}`}>
      <div className="p-5">

        {/* ── Row 1: Header — time · name · status badges ── */}
        <div className="flex items-center gap-2.5 flex-wrap mb-3">
          {serviceTime && (
            <span className="inline-flex items-center gap-1 text-xs font-bold bg-gray-900 text-white rounded-full px-2.5 py-1">
              <Clock className="w-3 h-3" />
              {serviceTime}
            </span>
          )}
          <span className="font-bold text-base text-gray-900">{job.name ?? "Unknown customer"}</span>
          <JobStatusBadge
            status={job.cleanerAssignment?.jobStatus ?? null}
            issueNote={job.cleanerAssignment?.issueNote}
            etaTimestamp={job.cleanerAssignment?.etaTimestamp}
          />
          {isFlagged && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
              <AlertTriangle className="w-3 h-3" />
              Flagged
            </span>
          )}
          {rating !== null && !isFlagged && <RatingBadge rating={rating} />}
          {etaOverdue && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-500 text-white rounded-full px-2 py-0.5 animate-pulse">
              <AlertTriangle className="w-3 h-3" />
              Overdue
            </span>
          )}
          {etaDueSoon && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-500 text-white rounded-full px-2 py-0.5">
              <Clock className="w-3 h-3" />
              Due Soon
            </span>
          )}
        </div>

        {/* ── Row 2: Body — left info + right pay/actions ── */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">

          {/* Left: address, service details, rating, notes */}
          <div className="flex-1 min-w-0 space-y-2">
            {job.address && (
              <div className="flex items-center gap-1.5 text-sm text-gray-600">
                <MapPin className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span className="truncate">{job.address}</span>
              </div>
            )}

            <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
              {job.serviceType && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-gray-400" />
                  {job.serviceType}
                </span>
              )}
              {job.lastBookingPrice && (
                <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                  <DollarSign className="w-3 h-3" />
                  ${job.lastBookingPrice} revenue
                </span>
              )}
              {job.bookingStatus && (
                <span className="capitalize text-gray-400">{job.bookingStatus}</span>
              )}
            </div>

            {/* Rating stars */}
            {(rating !== null || hasMissed) && (
              <div>
                <RatingStars rating={rating} />
                {hasMissed && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Customer reported something was missed
                  </p>
                )}
              </div>
            )}

            {/* Notes — collapsible */}
            {(job.cleanerAssignment?.customerNotes || job.cleanerAssignment?.staffNotes) && (
              <div>
                <button
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
                  onClick={() => setNotesOpen(o => !o)}
                >
                  <ChevronRight className={`w-3 h-3 transition-transform ${notesOpen ? "rotate-90" : ""}`} />
                  Notes
                  {!notesOpen && (
                    <span className="ml-1 text-gray-300">
                      {[job.cleanerAssignment?.customerNotes && "customer", job.cleanerAssignment?.staffNotes && "staff"].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
                {notesOpen && (
                  <div className="mt-2 space-y-1.5">
                    {job.cleanerAssignment?.customerNotes && (
                      <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
                        <p className="text-xs font-semibold text-blue-700 mb-0.5">Customer Notes</p>
                        <p className="text-xs text-blue-800 whitespace-pre-wrap">{job.cleanerAssignment.customerNotes}</p>
                      </div>
                    )}
                    {job.cleanerAssignment?.staffNotes && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                        <p className="text-xs font-semibold text-amber-700 mb-0.5">Staff Notes</p>
                        <p className="text-xs text-amber-800 whitespace-pre-wrap">{job.cleanerAssignment.staffNotes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Checklist — collapsible */}
            {job.cleanerAssignment?.checklistItems && job.cleanerAssignment.checklistItems.length > 0 && (() => {
              const items = job.cleanerAssignment!.checklistItems!;
              const done = items.filter(i => i.checked).length;
              const allDone = done === items.length;
              return (
                <div>
                  <button
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
                    onClick={() => setChecklistOpen(o => !o)}
                  >
                    <ChevronRight className={`w-3 h-3 transition-transform ${checklistOpen ? "rotate-90" : ""}`} />
                    Checklist
                    <span className={`ml-1 font-medium ${
                      allDone ? "text-emerald-600" : "text-amber-600"
                    }`}>{done}/{items.length}</span>
                    {allDone && <span className="ml-1 text-emerald-600">✓ complete</span>}
                  </button>
                  {checklistOpen && (
                    <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 space-y-1">
                      {items.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-1.5">
                          <span className={`mt-0.5 shrink-0 w-3 h-3 rounded border flex items-center justify-center text-[9px] ${
                            item.checked
                              ? "bg-emerald-500 border-emerald-500 text-white"
                              : "border-gray-300"
                          }`}>
                            {item.checked && "✓"}
                          </span>
                          <span className={`text-xs leading-snug ${
                            item.checked ? "text-gray-400 line-through" : "text-gray-700"
                          }`}>{item.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Right: cleaner name + pay block, then action buttons at bottom */}
          <div className="flex flex-col gap-3 sm:items-end sm:min-w-[220px]">

            {/* Cleaner + pay info block */}
            <div className="sm:text-right">
              {job.cleanerAssignment ? (
                <>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cleanerAccentBorder(job.cleanerAssignment.cleanerProfileId).replace("border-l-", "bg-")}`} />
                    <span className="text-sm font-semibold text-gray-900">{job.cleanerAssignment.cleanerName}</span>
                  </div>
                  {job.cleanerAssignment.basePay && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      Base pay: <span className="font-semibold text-gray-800">${parseFloat(job.cleanerAssignment.basePay).toFixed(2)}</span>
                      {job.cleanerAssignment.payPercent && (
                        <span className="text-gray-400 ml-1">({parseFloat(job.cleanerAssignment.payPercent)}%)</span>
                      )}
                    </p>
                  )}
                  {/* Pay adjustments */}
                  <div className="text-xs mt-1 space-y-0.5">
                    {rating === 5 && <p className="text-emerald-600">+$10 five-star bonus</p>}
                    {rating !== null && rating <= 3 && <p className="text-red-500">-$20 low rating deduction</p>}
                    {hasMissed && <p className="text-red-500">-$20 complaint deduction</p>}
                    {job.cleanerAssignment.manualAdjustment && (
                      <p className={parseFloat(job.cleanerAssignment.manualAdjustment) >= 0 ? "text-emerald-600" : "text-red-500"}>
                        {parseFloat(job.cleanerAssignment.manualAdjustment) >= 0 ? "+" : ""}${parseFloat(job.cleanerAssignment.manualAdjustment).toFixed(2)}
                        {job.cleanerAssignment.manualAdjustmentNote && (
                          <span className="text-gray-400"> ({job.cleanerAssignment.manualAdjustmentNote})</span>
                        )}
                      </p>
                    )}
                    {/* Applied custom rules */}
                    {job.cleanerAssignment.appliedCustomRules?.map((r) => (
                      <p key={r.id} className={r.appliedType === "bonus" ? "text-purple-600" : "text-red-500"}>
                        {r.appliedType === "bonus" ? "+" : "-"}${parseFloat(r.appliedAmount).toFixed(2)}
                        <span className="text-gray-400"> ({r.appliedLabel})</span>
                      </p>
                    ))}
                  </div>
                </>
              ) : (
                <CleanerAssignSelector
                  jobId={job.id}
                  currentCleanerProfileId={null}
                  onAssigned={onRefetch}
                />
              )}
            </div>

            {/* Photo upload section */}
            {job.cleanerAssignment ? (
              <PhotoUploadButton job={job} onSuccess={onRefetch} />
            ) : (
              <Button variant="outline" size="sm" disabled className="gap-1.5 text-xs opacity-40">
                <Upload className="w-3.5 h-3.5" />
                Assign cleaner first
              </Button>
            )}

            {/* Action buttons row — grouped at bottom */}
            <div className="flex items-center gap-2 flex-wrap sm:justify-end">
              {job.cleanerAssignment && <PayBreakdownPanel job={job} onRefetch={onRefetch} />}
              <UncompleteButton job={job} onRefetch={onRefetch} />
              <SendTrackerLinkButton job={job} />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pay Summary Card ──────────────────────────────────────────────────────────

function PaySummarySection({ date, onSetPassword }: { date: string; onSetPassword: (id: number, name: string) => void }) {
  const [sendingMagicFor, setSendingMagicFor] = useState<number | null>(null);
  const sendMagicLinkMutation = trpc.cleaner.sendMagicLink.useMutation({
    onSuccess: (data) => {
      toast.success(`Login link sent to ${data.phone}`);
      setSendingMagicFor(null);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to send login link");
      setSendingMagicFor(null);
    },
  });
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(y, m - 1, d + mondayOffset);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const weekFrom = formatDate(monday);
  const weekTo = formatDate(sunday);

  const { data: stats } = trpc.quality.cleanerStats.useQuery({ from: weekFrom, to: weekTo });

  if (!stats || stats.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gray-400" />
            Weekly Pay Summary
            <span className="text-xs font-normal text-gray-400 ml-1">
              ({weekFrom} – {weekTo})
            </span>
          </h3>
        </div>
        <div className="p-4">
          <p className="text-sm text-gray-400">No jobs recorded for this week yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-400" />
          Weekly Pay Summary
          <span className="text-xs font-normal text-gray-400 ml-1">
            ({weekFrom} – {weekTo})
          </span>
        </h3>
      </div>
      <div className="p-4">
        <div className="space-y-3">
          {stats.map((s) => (
            <div key={s.cleanerProfileId} className="p-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{s.cleanerName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.totalJobs} job{s.totalJobs !== 1 ? "s" : ""} · avg rating{" "}
                    {s.avgRating !== null ? `${s.avgRating.toFixed(1)}★` : "N/A"} ·{" "}
                    {Math.round((s.photoSubmissionRate ?? 0) * s.totalJobs)}/{s.totalJobs} photos
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-base text-primary">
                    ${(s.totalFinalPay ?? 0).toFixed(2)}
                  </p>
                  {(s.totalAdjustments ?? 0) !== 0 && (
                    <p className={`text-xs ${(s.totalAdjustments ?? 0) > 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {(s.totalAdjustments ?? 0) > 0 ? "+" : ""}${(s.totalAdjustments ?? 0).toFixed(2)} adj
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => onSetPassword(s.cleanerProfileId, s.cleanerName)}
                >
                  <KeyRound className="w-3 h-3" /> Set PW
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                  onClick={() => {
                    setSendingMagicFor(s.cleanerProfileId);
                    sendMagicLinkMutation.mutate({
                      cleanerProfileId: s.cleanerProfileId,
                      origin: window.location.origin,
                    });
                  }}
                  disabled={sendingMagicFor === s.cleanerProfileId && sendMagicLinkMutation.isPending}
                  title="Send a one-tap login link via SMS"
                >
                  {sendingMagicFor === s.cleanerProfileId && sendMagicLinkMutation.isPending
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Link2 className="w-3 h-3" />}
                  {" "}Send Link
                </Button>
                <a
                  href="/cleaner"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  Portal
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Unlinked Teams Section ──────────────────────────────────────────────────
/**
 * Shows all ghost profiles (no email/password — created by sync when L27 team
 * title didn't match any real cleaner profile). Allows merging each ghost into
 * the correct real profile, which re-points all affected jobs and permanently
 * links the L27 team ID so future syncs never create a ghost again.
 */
function UnlinkedTeamsSection() {
  const { data, isLoading, refetch } = trpc.quality.listGhostProfiles.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const merge = trpc.quality.mergeGhostProfile.useMutation({
    onSuccess: (res) => {
      toast.success(res.message);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const [pendingMerge, setPendingMerge] = useState<{ ghostId: number; realId: number; ghostName: string; realName: string } | null>(null);
  const [selectedReal, setSelectedReal] = useState<Record<number, number>>({});

  const ghosts = data?.ghosts ?? [];
  const allRealProfileNames = data?.allRealProfileNames ?? [];

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardHeader><CardTitle className="flex items-center gap-2"><GitMerge className="w-5 h-5" /> Unlinked Teams</CardTitle></CardHeader>
        <CardContent><div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div></CardContent>
      </Card>
    );
  }

  if (ghosts.length === 0) {
    return (
      <Card className="mb-6">
        <CardHeader><CardTitle className="flex items-center gap-2"><GitMerge className="w-5 h-5" /> Unlinked Teams</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm">No unlinked teams — all L27 teams are mapped to real cleaner profiles.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="mb-6 border-orange-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-700">
            <AlertTriangle className="w-5 h-5" />
            Unlinked Teams ({ghosts.length})
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            These Launch27 teams have no matching cleaner profile login. Jobs assigned to them are
            <span className="font-semibold text-red-600"> invisible in the cleaner portal</span>.
            Merge each ghost into the correct real profile to fix affected jobs.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {ghosts.map((ghost) => {
            const realId = selectedReal[ghost.id];
            const realProfile = ghost.candidates.find(c => c.id === realId);
            return (
              <div key={ghost.id} className="border rounded-lg p-4 bg-orange-50">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive" className="text-xs">Ghost</Badge>
                      <span className="font-medium">{ghost.name}</span>
                      {ghost.launch27TeamId && (
                        <span className="text-xs text-muted-foreground">L27 team id={ghost.launch27TeamId}</span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium text-red-600">{ghost.jobCount} job(s)</span> invisible in portal
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {ghost.candidates.length > 0 ? (
                      <>
                        <Select
                          value={realId ? String(realId) : ""}
                          onValueChange={(v) => setSelectedReal(prev => ({ ...prev, [ghost.id]: parseInt(v, 10) }))}
                        >
                          <SelectTrigger className="w-52 text-sm">
                            <SelectValue placeholder="Select real profile..." />
                          </SelectTrigger>
                          <SelectContent>
                            {ghost.candidates.map(c => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.name} ({c.email})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          disabled={!realId || merge.isPending}
                          onClick={() => {
                            if (!realId || !realProfile) return;
                            setPendingMerge({ ghostId: ghost.id, realId, ghostName: ghost.name, realName: realProfile.name });
                          }}
                        >
                          <GitMerge className="w-4 h-4 mr-1" /> Merge
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No matching real profile found — check names</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Debug: show all real profiles so we can identify name mismatches */}
      {allRealProfileNames.length > 0 && (
        <details className="mb-4">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Debug: {allRealProfileNames.length} real profiles with logins (expand to see names for mapping)
          </summary>
          <div className="mt-2 border rounded p-3 bg-muted/30 text-xs font-mono space-y-1 max-h-48 overflow-y-auto">
            {allRealProfileNames.map(r => (
              <div key={r.id} className="flex gap-2">
                <span className="text-muted-foreground w-8 shrink-0">#{r.id}</span>
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground">{r.email}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Merge confirmation dialog */}
      <Dialog open={!!pendingMerge} onOpenChange={(open) => { if (!open) setPendingMerge(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Merge</DialogTitle>
          </DialogHeader>
          {pendingMerge && (
            <div className="space-y-3 text-sm">
              <p>This will permanently:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Re-point all jobs from <span className="font-medium text-red-600">{pendingMerge.ghostName}</span> (ghost) to <span className="font-medium text-green-700">{pendingMerge.realName}</span></li>
                <li>Copy the L27 team ID to the real profile (prevents future ghosts)</li>
                <li>Delete the ghost profile row</li>
              </ul>
              <p className="text-muted-foreground">This cannot be undone. Affected jobs will immediately become visible in the cleaner portal.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingMerge(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={merge.isPending}
              onClick={() => {
                if (!pendingMerge) return;
                merge.mutate({ ghostId: pendingMerge.ghostId, realId: pendingMerge.realId });
                setPendingMerge(null);
              }}
            >
              {merge.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Confirm Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Portal Diagnostic Section ────────────────────────────────────────────────
/**
 * Diagnostic tool: traces a job from L27 booking → cleaner_jobs → cleaner_profile
 * → portal visibility. Proves whether a ghost profile is causing a job to be
 * invisible in the cleaner portal.
 */
function PortalDiagnosticSection() {
  const [bookingId, setBookingId] = useState("");
  const [date, setDate] = useState("");
  const [enabled, setEnabled] = useState(false);

  const { data, isFetching, error } = trpc.quality.traceJob.useQuery(
    { bookingId: bookingId ? parseInt(bookingId, 10) : undefined, date: date || undefined },
    { enabled, refetchOnWindowFocus: false }
  );

  function runTrace() {
    if (!bookingId && !date) { toast.error("Enter a Booking ID or date"); return; }
    setEnabled(false);
    setTimeout(() => setEnabled(true), 50);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Search className="w-4 h-4 text-gray-400" />
          Portal Diagnostic — Trace Job Visibility
          <span className="text-xs font-normal text-gray-400 ml-1">Prove why a job is missing from the cleaner portal</span>
        </h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Launch27 Booking ID</label>
            <Input
              value={bookingId}
              onChange={e => { setBookingId(e.target.value); setDate(""); }}
              placeholder="e.g. 123456"
              className="h-8 text-sm"
            />
          </div>
          <div className="text-xs text-muted-foreground pb-2">or</div>
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Date (all jobs)</label>
            <Input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setBookingId(""); }}
              className="h-8 text-sm"
            />
          </div>
          <Button
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={runTrace}
            disabled={isFetching}
            style={{ backgroundColor: "#E8603C", color: "white" }}
          >
            {isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            Trace
          </Button>
        </div>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 rounded p-2">{error.message}</div>
        )}

        {data && (
          <div className="space-y-2">
            <div className={`text-xs font-medium px-2 py-1.5 rounded flex items-center gap-1.5 ${
              data.found ? "bg-gray-100 text-gray-700" : "bg-amber-50 text-amber-700"
            }`}>
              {data.found ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <AlertCircle className="w-3.5 h-3.5" />}
              {data.found ? data.summary : data.message}
            </div>

            {data.jobs?.map((job) => (
              <div key={job.cleanerJobId} className={`rounded-lg border p-3 text-xs space-y-1.5 ${
                job.portalWouldReturn ? "border-green-200 bg-green-50" :
                job.profile?.isGhost ? "border-red-200 bg-red-50" :
                "border-amber-200 bg-amber-50"
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-sm">{job.customerName ?? "Unknown"} — {job.jobDate}</div>
                  {job.portalWouldReturn ? (
                    <Badge className="text-xs bg-green-100 text-green-700 border-green-200">Portal OK</Badge>
                  ) : job.profile?.isGhost ? (
                    <Badge className="text-xs bg-red-100 text-red-700 border-red-200">Ghost Profile</Badge>
                  ) : (
                    <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">No Login</Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                  <span>Booking ID: <span className="font-mono text-gray-900">{job.bookingId ?? "—"}</span></span>
                  <span>Team: <span className="text-gray-900">{job.teamName ?? "—"}</span> (L27 ID: {job.teamId ?? "—"})</span>
                  <span>cleaner_job.id: <span className="font-mono text-gray-900">{job.cleanerJobId}</span></span>
                  <span>cleanerProfileId: <span className="font-mono text-gray-900">{job.cleanerProfileId}</span></span>
                  {job.profile && (
                    <>
                      <span>Profile name: <span className="text-gray-900">{job.profile.name}</span></span>
                      <span>Profile email: <span className="text-gray-900">{job.profile.email ?? "NONE"}</span></span>
                    </>
                  )}
                </div>
                <div className={`font-mono text-xs mt-1 px-2 py-1 rounded ${
                  job.portalWouldReturn ? "bg-green-100 text-green-800" :
                  job.profile?.isGhost ? "bg-red-100 text-red-800" :
                  "bg-amber-100 text-amber-800"
                }`}>
                  {job.diagnosis}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Cleaner Profiles Section ─────────────────────────────────────────────────
/**
 * Inline editor for cleaner profiles — lets admin set phone, email, pay %.
 * Phone numbers are required for SMS steps (arrived_checkin, mid_job_nudge, etc.).
 */
function CleanerProfilesSection() {
  const { data: cleaners, refetch } = trpc.quality.listCleaners.useQuery();
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", payPercent: "", language: "en" as "en" | "es" | "pt" });
  const utils = trpc.useUtils();

  const updateCleaner = trpc.quality.updateCleaner.useMutation({
    onSuccess: () => {
      toast.success("Profile updated");
      setEditId(null);
      refetch();
      utils.quality.listCleaners.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function startEdit(c: { id: number; name: string; phone: string | null; email: string | null; payPercent: string | null }) {
    setEditId(c.id);
    setForm({
      name: c.name,
      phone: c.phone ?? "",
      email: c.email ?? "",
      payPercent: c.payPercent ?? "",
      language: ((c as any).language ?? "en") as "en" | "es" | "pt",
    });
  }

  function saveEdit() {
    if (!editId) return;
    updateCleaner.mutate({
      id: editId,
      name: form.name || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      payPercent: form.payPercent || undefined,
      language: form.language,
    });
  }

  if (!cleaners || cleaners.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-400" />
          Cleaner Profiles
          <span className="text-xs font-normal text-gray-400 ml-1">Phone numbers required for SMS steps</span>
        </h3>
      </div>
      <div className="p-4">
        <div className="space-y-2">
          {cleaners.map((c) => {
            const hasPhone = !!c.phone;
            const isEditing = editId === c.id;
            return (
              <div key={c.id} className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
                        <Input
                          value={form.name}
                          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Phone (SMS)</label>
                        <Input
                          value={form.phone}
                          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                          placeholder="+12025551234"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Email (portal login)</label>
                        <Input
                          type="email"
                          value={form.email}
                          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                          placeholder="cleaner@example.com"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Pay % (e.g. 45)</label>
                        <Input
                          value={form.payPercent}
                          onChange={e => setForm(f => ({ ...f, payPercent: e.target.value }))}
                          placeholder="45"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Portal Language</label>
                        <select
                          value={form.language}
                          onChange={e => setForm(f => ({ ...f, language: e.target.value as "en" | "es" | "pt" }))}
                          className="h-8 text-sm w-full rounded-md border border-input bg-background px-3 py-1"
                        >
                          <option value="en">🇺🇸 English</option>
                          <option value="es">🇪🇸 Español</option>
                          <option value="pt">🇧🇷 Português</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs"
                        onClick={saveEdit}
                        disabled={updateCleaner.isPending}
                        style={{ backgroundColor: "#E8603C", color: "white" }}
                      >
                        {updateCleaner.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                        Save
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => setEditId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{c.name}</p>
                        {!hasPhone && (
                          <Badge variant="outline" className="text-xs border-amber-400 text-amber-600 bg-amber-50">
                            No phone
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {c.phone ? c.phone : "—"} · {c.email ?? "no email"} · {c.payPercent ? `${c.payPercent}% pay` : "pay % not set"} · {(c as any).language === "es" ? "🇪🇸 Español" : (c as any).language === "pt" ? "🇧🇷 Português" : "🇺🇸 English"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => startEdit(c)}
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type ViewMode = "by-time" | "by-cleaner";

export default function CleanerDashboard() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));
  const [viewMode, setViewMode] = useState<ViewMode>("by-time");
  const [resetTarget, setResetTarget] = useState<{ id: number; name: string } | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [resetEmail, setResetEmail] = useState("");

  const resetPasswordMutation = trpc.cleaner.setPassword.useMutation({
    onSuccess: () => {
      toast.success(`Password set for ${resetTarget?.name}`);
      setResetTarget(null);
      setResetPw("");
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: jobs, isLoading, refetch } = trpc.quality.getJobsForDate.useQuery(
    { date: selectedDate },
    { refetchOnWindowFocus: true, refetchInterval: 30_000 }
  );


  const { data: pendingSms } = trpc.quality.ratingSmsQueueSummary.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const utils = trpc.useUtils();

  const approveAll = trpc.quality.approveAllRatingSms.useMutation({
    onSuccess: () => {
      toast.success("Rating SMS messages approved — click \"Send Now\" to deliver immediately");
      utils.quality.ratingSmsQueueSummary.invalidate();
      refetchPending();
    },
  });

  const sendNow = trpc.quality.sendApprovedRatingSmsNow.useMutation({
    onSuccess: (result) => {
      if (result.sent > 0) {
        toast.success(`${result.sent} SMS sent successfully!`, {
          description: result.failed > 0 ? `${result.failed} failed` : undefined,
        });
      } else if (result.failed > 0) {
        toast.error(`Failed to send ${result.failed} SMS`);
      } else {
        toast("No approved SMS to send — approve them first");
      }
      utils.quality.ratingSmsQueueSummary.invalidate();
      refetchPending();
    },
    onError: (err) => toast.error("Send failed", { description: err.message }),
  });

  const skipSms = trpc.quality.skipRatingSms.useMutation({
    onSuccess: () => {
      toast("SMS skipped");
      utils.quality.ratingSmsQueueSummary.invalidate();
      refetchPending();
    },
  });

  const requeueSms = trpc.quality.requeueRatingSms.useMutation({
    onSuccess: () => {
      toast.success("Re-queued — approve and send again");
      utils.quality.ratingSmsQueueSummary.invalidate();
      refetchPending();
    },
    onError: (err) => toast.error("Re-queue failed", { description: err.message }),
  });

  const { data: pendingList, refetch: refetchPending } = trpc.quality.listPendingRatingSms.useQuery();

  const syncJobs = trpc.quality.syncTodayJobs.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Sync complete: ${result.jobsCreated} new, ${result.jobsUpdated} updated`,
        { description: result.errors.length > 0 ? `${result.errors.length} error(s): ${result.errors[0]}` : `${result.bookingsFetched} bookings fetched from Launch27` }
      );
      refetch();
    },
    onError: (err) => toast.error("Sync failed", { description: err.message }),
  });

  // Group jobs by cleaner for the "by-cleaner" view, sorted by service time within each group
  const cleanerGroups = useMemo((): [string, JobRow[]][] => {
    if (!jobs || jobs.length === 0) return [];
    const record: Record<string, JobRow[]> = {};
    for (const job of jobs) {
      const key = job.cleanerAssignment?.cleanerName ?? "Unassigned";
      if (!record[key]) record[key] = [];
      record[key].push(job as unknown as JobRow);
    }
    // Sort each group by serviceDateTime
    Object.values(record).forEach((group) => {
      group.sort((a: JobRow, b: JobRow) => (a.serviceDateTime ?? "").localeCompare(b.serviceDateTime ?? ""));
    });
    // Sort groups: Unassigned last, rest alphabetical
    return Object.entries(record).sort(([a]: [string, JobRow[]], [b]: [string, JobRow[]]) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    });
  }, [jobs]);

  const totalJobs = jobs?.length ?? 0;

  return (
    <AdminPageGuard pageId="quality">
    <>
    <div className="min-h-screen bg-gray-50">
      <AdminHeader activeTab="quality" pagePermissions={pagePermissions} isAdmin={isAdmin} />

      {/* Date navigation + controls */}
      <div className="border-b bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          {/* Date nav */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 min-w-[190px] justify-center">
              <CalendarDays className="w-4 h-4 text-gray-400" />
              {formatDisplayDate(selectedDate)}
            </div>
            <button
              onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSelectedDate(formatDate(new Date()))}
              className="ml-1 text-xs font-medium text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1 bg-white hover:bg-gray-50 transition-colors"
            >
              Today
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setViewMode("by-time")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  viewMode === "by-time"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <List className="w-3 h-3" />
                By Time
              </button>
              <button
                onClick={() => setViewMode("by-cleaner")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  viewMode === "by-cleaner"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <Users className="w-3 h-3" />
                By Cleaner
              </button>
            </div>

            {/* Sync */}
            <button
              disabled={syncJobs.isPending}
              onClick={() => syncJobs.mutate({ date: selectedDate })}
              className="flex items-center gap-1.5 text-xs font-medium bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
            >
              {syncJobs.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {syncJobs.isPending ? "Syncing…" : "Sync from Launch27"}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
          <p className="text-gray-500 mt-1 text-sm">Daily job schedule, cleaner assignments, photos, and ratings.</p>
        </div>

        {/* Summary bar — job count + revenue total */}
        {!isLoading && jobs && jobs.length > 0 && (() => {
          const totalRevenue = jobs.reduce((sum, j) => sum + (j.lastBookingPrice ?? 0), 0);
          const withPhotos = jobs.filter(j => j.photos.length > 0).length;
          const withRating = jobs.filter(j => j.cleanerAssignment?.customerRating !== null && j.cleanerAssignment?.customerRating !== undefined).length;
          const flagged = jobs.filter(j => (j.cleanerAssignment?.customerRating ?? 5) <= 3 || j.cleanerAssignment?.missedSomething === 1).length;
          return (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-white border border-gray-200 text-gray-700 rounded-full px-3 py-1 shadow-sm">
                <CalendarDays className="w-3.5 h-3.5 text-gray-400" />
                {totalJobs} job{totalJobs !== 1 ? "s" : ""}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full px-3 py-1">
                <DollarSign className="w-3.5 h-3.5" />
                ${totalRevenue.toFixed(0)} revenue
              </span>
              {withPhotos > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-blue-50 border border-blue-200 text-blue-700 rounded-full px-3 py-1">
                  <Camera className="w-3.5 h-3.5" />
                  {withPhotos} with photos
                </span>
              )}
              {withRating > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-3 py-1">
                  <Star className="w-3.5 h-3.5" />
                  {withRating} rated
                </span>
              )}
              {flagged > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-red-50 border border-red-200 text-red-600 rounded-full px-3 py-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {flagged} flagged
                </span>
              )}
            </div>
          );
        })()}

        {/* Skeleton loading state */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 animate-pulse">
                <div className="flex gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <div className="h-5 w-16 bg-gray-100 rounded-full" />
                      <div className="h-5 w-32 bg-gray-100 rounded" />
                    </div>
                    <div className="h-4 w-48 bg-gray-100 rounded" />
                    <div className="h-4 w-24 bg-gray-100 rounded" />
                  </div>
                  <div className="space-y-2 items-end flex flex-col">
                    <div className="h-5 w-24 bg-gray-100 rounded" />
                    <div className="h-5 w-16 bg-gray-100 rounded" />
                    <div className="h-7 w-24 bg-gray-100 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rating SMS Queue — always shown when there are any items today (pending, approved, sent, skipped) */}
        {pendingList && pendingList.length > 0 && (
          <div className={`rounded-xl border shadow-sm p-4 ${pendingSms && (pendingSms.pending > 0 || pendingSms.approved > 0) ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
            <div className="py-0">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className={`w-5 h-5 shrink-0 ${pendingSms && (pendingSms.pending > 0 || pendingSms.approved > 0) ? 'text-amber-500' : 'text-muted-foreground'}`} />
                  <div>
                    <p className="font-medium text-sm">
                      {pendingSms && pendingSms.pending > 0 && (
                        <span>{pendingSms.pending} rating SMS{pendingSms.pending !== 1 ? "es" : ""} pending approval</span>
                      )}
                      {pendingSms && pendingSms.pending > 0 && pendingSms.approved > 0 && " · "}
                      {pendingSms && pendingSms.approved > 0 && (
                        <span className="text-emerald-700">{pendingSms.approved} approved, ready to send</span>
                      )}
                      {pendingSms && pendingSms.pending === 0 && pendingSms.approved === 0 && (
                        <span className="text-muted-foreground">Rating SMS sent today — re-queue to resend</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Approve first, then click <strong>Send Now</strong> to deliver immediately (or wait for 7 PM ET cron).
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">Review</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Rating SMS Queue</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3 mt-2">
                        {(pendingList ?? []).map((item) => (
                          <div key={item.id} className="p-3 rounded-lg border bg-card">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-medium text-sm">{item.customerFirstName ?? item.customerPhone}</p>
                                <p className="text-xs text-muted-foreground">{item.customerPhone}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Cleaner: {item.cleanerName ?? "Unassigned"} · {item.jobDate}
                                </p>
                              </div>
                              <Badge variant={item.status === "approved" ? "default" : "secondary"} className="text-xs">
                                {item.status}
                              </Badge>
                            </div>
                            {item.status === "pending" && (
                              <div className="flex gap-2 mt-2">
                                <Button size="sm" variant="default" className="text-xs h-7"
                                  onClick={() => approveAll.mutate()}
                                >
                                  Approve
                                </Button>
                                <Button size="sm" variant="ghost" className="text-xs h-7 text-muted-foreground"
                                  onClick={() => skipSms.mutate({ id: item.id })}
                                >
                                  Skip
                                </Button>
                              </div>
                            )}
                            {(item.status === "sent" || item.status === "skipped") && (
                              <div className="flex gap-2 mt-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7 gap-1"
                                  onClick={() => requeueSms.mutate({ id: item.id })}
                                  disabled={requeueSms.isPending}
                                >
                                  {requeueSms.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                  Re-queue
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </DialogContent>
                  </Dialog>
                  {(pendingSms?.pending ?? 0) > 0 && (
                    <Button
                      size="sm"
                      className="bg-amber-500 hover:bg-amber-600 text-white"
                      onClick={() => approveAll.mutate()}
                      disabled={approveAll.isPending}
                    >
                      {approveAll.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Approve All"}
                    </Button>
                  )}
                  {(pendingSms?.approved ?? 0) > 0 && (
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                      onClick={() => sendNow.mutate()}
                      disabled={sendNow.isPending}
                    >
                      {sendNow.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      {sendNow.isPending ? "Sending…" : `Send Now (${pendingSms?.approved ?? 0})`}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Jobs section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-sm text-gray-500">
              {isLoading
                ? "Loading jobs…"
                : `${totalJobs} job${totalJobs !== 1 ? "s" : ""} on ${formatDisplayDate(selectedDate)}`}
            </h2>
            {!isLoading && totalJobs > 0 && viewMode === "by-cleaner" && (
              <span className="text-xs text-gray-400">{cleanerGroups.length} team{cleanerGroups.length !== 1 ? "s" : ""}</span>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 rounded-xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : !jobs || jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white">
              <div className="py-12 text-center">
                <CalendarDays className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No jobs found for this date.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Run the nightly sync or select a different date.
                </p>
              </div>
            </div>
          ) : viewMode === "by-time" ? (
            /* ── By Time view ── */
            <div className="space-y-3">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job as unknown as JobRow} onRefetch={refetch} />
              ))}
            </div>
          ) : (
            /* ── By Cleaner view ── */
            <div className="space-y-6">
              {cleanerGroups.map(([cleanerName, groupJobs]) => {
                const groupCleanerProfileId = groupJobs[0]?.cleanerAssignment?.cleanerProfileId ?? null;
                const groupAccentBorder = cleanerAccentBorder(groupCleanerProfileId);
                // Convert border class to bg class for the dot (border-l-teal-400 → bg-teal-400)
                const dotBgClass = groupAccentBorder.replace("border-l-", "bg-");
                const totalRevenue = groupJobs.reduce((sum, j) => sum + (j.lastBookingPrice ?? 0), 0);
                const totalBasePay = groupJobs.reduce((sum, j) => {
                  const bp = j.cleanerAssignment?.basePay ? parseFloat(j.cleanerAssignment.basePay) : 0;
                  return sum + bp;
                }, 0);
                const payPercent = groupJobs[0]?.cleanerAssignment?.payPercent;
                const flaggedCount = groupJobs.filter((j) => {
                  const r = j.cleanerAssignment?.customerRating ?? null;
                  return (r !== null && r <= 3) || j.cleanerAssignment?.missedSomething === 1;
                }).length;
                const ratedJobs = groupJobs.filter(j => j.cleanerAssignment?.customerRating !== null && j.cleanerAssignment?.customerRating !== undefined);
                const avgRating = ratedJobs.length > 0
                  ? ratedJobs.reduce((sum, j) => sum + (j.cleanerAssignment?.customerRating ?? 0), 0) / ratedJobs.length
                  : null;
                const photosSubmitted = groupJobs.filter(j => j.photos.length > 0 || j.cleanerAssignment?.photoSubmitted === 1).length;

                return (
                  <div key={cleanerName}>
                    {/* Cleaner group header */}
                    <div className="flex items-center justify-between mb-2 px-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`w-3 h-3 rounded-full shrink-0 ${dotBgClass}`} />
                        <span className="font-semibold text-sm">{cleanerName}</span>
                        <Badge variant="secondary" className="text-xs">{groupJobs.length} job{groupJobs.length !== 1 ? "s" : ""}</Badge>
                        {flaggedCount > 0 && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {flaggedCount} flagged
                          </Badge>
                        )}
                        {avgRating !== null && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 font-medium">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            {avgRating.toFixed(1)}
                          </span>
                        )}
                        {photosSubmitted > 0 && (
                          <span className="text-xs text-blue-600">
                            {photosSubmitted}/{groupJobs.length} photos
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {payPercent && (
                          <span className="text-muted-foreground/70">{parseFloat(payPercent)}% rate</span>
                        )}
                        <span className="text-emerald-600 font-medium">${totalRevenue.toFixed(0)} revenue</span>
                        <span className="font-semibold text-foreground">${totalBasePay.toFixed(2)} base pay</span>
                      </div>
                    </div>
                    {/* Jobs in this group */}
                    <div className="space-y-2 pl-2 border-l-2 border-primary/20">
                      {groupJobs.map((job) => (
                        <JobCard key={job.id} job={job} onRefetch={refetch} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Weekly Pay Summary */}
        <PaySummarySection date={selectedDate} onSetPassword={(id, name) => { setResetTarget({ id, name }); setResetPw(""); setResetEmail(""); }} />

        {/* Unlinked Teams — ghost profiles with no login, jobs invisible in portal */}
        <UnlinkedTeamsSection />

        {/* Portal Diagnostic — trace job visibility, prove ghost profile root cause */}
        <PortalDiagnosticSection />

        {/* Cleaner Profiles (phone numbers, email, pay %) */}
        <CleanerProfilesSection />
      </div>
    </div>

    {/* Set Password Dialog */}
    <Dialog open={!!resetTarget} onOpenChange={() => { setResetTarget(null); setResetEmail(""); setResetPw(""); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Set Portal Access — {resetTarget?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <label className="text-sm font-medium block">Email</label>
            <Input type="email" placeholder="cleaner@example.com" value={resetEmail} onChange={e => setResetEmail(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium block">Password</label>
            <Input type="password" placeholder="Min 6 characters" value={resetPw} onChange={e => setResetPw(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Cleaner logs in at <code className="text-xs bg-muted px-1 rounded">/cleaner</code> with this email and password.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setResetTarget(null); setResetEmail(""); setResetPw(""); }}>Cancel</Button>
          <Button
            onClick={() => resetTarget && resetPasswordMutation.mutate({ cleanerProfileId: resetTarget.id, email: resetEmail.trim(), password: resetPw })}
            disabled={resetPasswordMutation.isPending || resetPw.length < 6 || !resetEmail.includes("@")}
            style={{ backgroundColor: "#E8603C", color: "white" }}
          >
            {resetPasswordMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Save & Enable Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
    </AdminPageGuard>
  );
}
