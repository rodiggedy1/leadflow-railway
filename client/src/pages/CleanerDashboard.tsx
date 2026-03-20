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
import { useState, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Camera, Star, AlertTriangle, CheckCircle2, Clock, MapPin,
  DollarSign, User, ChevronLeft, ChevronRight, Upload, Loader2,
  CalendarDays, TrendingUp, RefreshCw, List, Users, KeyRound, ExternalLink,
  X, ZoomIn, Images
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

// ── Photo Upload Component ────────────────────────────────────────────────────

function PhotoUploadButton({
  job,
  onSuccess,
}: {
  job: {
    id: number;
    cleanerAssignment: { id: number; cleanerProfileId: number; photoSubmitted: number | null } | null;
    photos: Array<{ id: number; photoUrl: string; filename: string | null }>;
  };
  onSuccess: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
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
    const file = e.target.files?.[0];
    if (!file || !job.cleanerAssignment) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large", { description: "Max 10MB per photo." });
      return;
    }
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        await upload.mutateAsync({
          cleanerJobId: job.cleanerAssignment!.id,
          completedJobId: job.id,
          cleanerProfileId: job.cleanerAssignment!.cleanerProfileId,
          filename: file.name,
          mimeType: file.type,
          base64Data: base64,
        });
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setUploading(false);
    }
  };

  const hasPhoto = job.photos.length > 0 || job.cleanerAssignment?.photoSubmitted === 1;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (hasPhoto) {
    const photos = job.photos;
    const currentPhoto = lightboxIndex !== null ? photos[lightboxIndex] : null;

    return (
      <>
        {/* Thumbnail grid */}
        {photos.length > 0 ? (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Images className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs font-medium text-emerald-700">{photos.length} photo{photos.length !== 1 ? 's' : ''} submitted</span>
            </div>
            <div className={`grid gap-1.5 ${photos.length === 1 ? 'grid-cols-1' : photos.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {photos.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setLightboxIndex(i)}
                  className="relative group rounded-lg overflow-hidden border border-slate-200 hover:border-emerald-400 transition-all aspect-square"
                >
                  <img
                    src={p.photoUrl}
                    alt={p.filename ?? `Photo ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                    <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
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
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
        disabled={uploading || !job.cleanerAssignment}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
        {uploading ? "Uploading..." : "Upload photo"}
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
    streakBonus: string | null;
    customerRating: number | null;
    missedSomething: number | null;
    photoSubmitted: number;
    flagged: number;
    adminNotes: string | null;
  };
  photos: Array<{ id: number; photoUrl: string; filename: string | null }>;
};

function JobCard({ job, onRefetch }: { job: JobRow; onRefetch: () => void }) {
  const rating = job.cleanerAssignment?.customerRating ?? null;
  const hasMissed = job.cleanerAssignment?.missedSomething === 1;
  const isLowRating = rating !== null && rating <= 3;
  const isFlagged = isLowRating || hasMissed;
  const serviceTime = formatServiceTime(job.serviceDateTime);

  return (
    <Card className={`transition-all ${isFlagged ? "border-red-200 bg-red-50/30 dark:bg-red-950/10" : ""}`}>
      <CardContent className="py-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          {/* Left: Job info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Service time badge — prominent */}
              {serviceTime && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold bg-primary/10 text-primary rounded-full px-2 py-0.5">
                  <Clock className="w-3 h-3" />
                  {serviceTime}
                </span>
              )}
              <span className="font-semibold text-sm">{job.name ?? "Unknown customer"}</span>
              {isFlagged && (
                <Badge variant="destructive" className="text-xs gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Flagged
                </Badge>
              )}
              {rating !== null && !isFlagged && <RatingBadge rating={rating} />}
            </div>

            <div className="mt-1.5 space-y-1">
              {job.address && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate">{job.address}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                {job.serviceType && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {job.serviceType}
                  </span>
                )}
                {job.lastBookingPrice && (
                  <span className="flex items-center gap-1 text-emerald-600 font-medium">
                    <DollarSign className="w-3 h-3" />
                    ${job.lastBookingPrice} job revenue
                  </span>
                )}
                {job.bookingStatus && (
                  <span className="capitalize text-muted-foreground/70">{job.bookingStatus}</span>
                )}
              </div>
            </div>

            {/* Rating — only shown once a rating has been received */}
            {(rating !== null || hasMissed) && (
              <div className="mt-2">
                <RatingStars rating={rating} />
                {hasMissed && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Customer reported something was missed
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Right: Cleaner + pay + photo */}
          <div className="flex flex-col gap-2 sm:items-end sm:min-w-[200px]">
            {/* Cleaner assignment */}
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              {job.cleanerAssignment ? (
                <span className="text-sm font-medium">{job.cleanerAssignment.cleanerName}</span>
              ) : (
                <CleanerAssignSelector
                  jobId={job.id}
                  currentCleanerProfileId={null}
                  onAssigned={onRefetch}
                />
              )}
            </div>

            {/* Base pay */}
            {job.cleanerAssignment?.basePay && (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <DollarSign className="w-3 h-3" />
                Base pay: <span className="font-semibold text-foreground">${parseFloat(job.cleanerAssignment.basePay).toFixed(2)}</span>
                {job.cleanerAssignment.payPercent && (
                  <span className="text-muted-foreground/60">({parseFloat(job.cleanerAssignment.payPercent)}%)</span>
                )}
              </div>
            )}

            {/* Pay adjustments */}
            {job.cleanerAssignment && (
              <div className="text-xs space-y-0.5">
                {rating === 5 && (
                  <p className="text-emerald-600">+$10 five-star bonus</p>
                )}
                {rating !== null && rating <= 3 && (
                  <p className="text-red-500">-$20 low rating deduction</p>
                )}
                {hasMissed && (
                  <p className="text-red-500">-$20 complaint deduction</p>
                )}
              </div>
            )}

            {/* Photo upload */}
            {job.cleanerAssignment ? (
              <PhotoUploadButton
                job={job}
                onSuccess={onRefetch}
              />
            ) : (
              <Button variant="outline" size="sm" disabled className="gap-1.5 text-xs opacity-50">
                <Upload className="w-3.5 h-3.5" />
                Assign cleaner first
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Pay Summary Card ──────────────────────────────────────────────────────────

function PaySummarySection({ date, onSetPassword }: { date: string; onSetPassword: (id: number, name: string) => void }) {
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
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Weekly Pay Summary
            <span className="text-xs font-normal text-muted-foreground ml-1">
              ({weekFrom} – {weekTo})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No jobs recorded for this week yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Weekly Pay Summary
          <span className="text-xs font-normal text-muted-foreground ml-1">
            ({weekFrom} – {weekTo})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stats.map((s) => (
            <div key={s.cleanerProfileId} className="p-3 rounded-lg bg-muted/40 border">
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
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type ViewMode = "by-time" | "by-cleaner";

export default function CleanerDashboard() {
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
    { refetchOnWindowFocus: true, refetchInterval: 15_000 }
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
      record[key].push(job);
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
    <>
    <div className="min-h-screen bg-background">
      <AdminHeader activeTab="quality" />

      {/* Date navigation + controls */}
      <div className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-sm text-muted-foreground">Cleaner Quality Dashboard</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Date nav */}
            <Button variant="ghost" size="icon" onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-1.5 text-sm font-medium min-w-[180px] justify-center">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              {formatDisplayDate(selectedDate)}
            </div>
            <Button variant="ghost" size="icon" onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setSelectedDate(formatDate(new Date()))}
            >
              Today
            </Button>

            {/* View mode toggle */}
            <div className="flex items-center rounded-lg border bg-muted/40 p-0.5 gap-0.5">
              <Button
                variant={viewMode === "by-time" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs gap-1.5 px-2.5"
                onClick={() => setViewMode("by-time")}
              >
                <List className="w-3 h-3" />
                By Time
              </Button>
              <Button
                variant={viewMode === "by-cleaner" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs gap-1.5 px-2.5"
                onClick={() => setViewMode("by-cleaner")}
              >
                <Users className="w-3 h-3" />
                By Cleaner
              </Button>
            </div>

            {/* Sync */}
            <Button
              variant="default"
              size="sm"
              className="text-xs gap-1.5"
              disabled={syncJobs.isPending}
              onClick={() => syncJobs.mutate({ date: selectedDate })}
            >
              {syncJobs.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {syncJobs.isPending ? "Syncing…" : "Sync from Launch27"}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Rating SMS Queue — always shown when there are any items today (pending, approved, sent, skipped) */}
        {pendingList && pendingList.length > 0 && (
          <Card className={`border-amber-200 ${pendingSms && (pendingSms.pending > 0 || pendingSms.approved > 0) ? 'bg-amber-50 dark:bg-amber-950/20' : 'bg-muted/30'}`}>
            <CardContent className="py-4">
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
            </CardContent>
          </Card>
        )}

        {/* Jobs section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-base">
              {isLoading
                ? "Loading jobs…"
                : `${totalJobs} job${totalJobs !== 1 ? "s" : ""} on ${formatDisplayDate(selectedDate)}`}
            </h2>
            {!isLoading && totalJobs > 0 && viewMode === "by-cleaner" && (
              <span className="text-xs text-muted-foreground">{cleanerGroups.length} team{cleanerGroups.length !== 1 ? "s" : ""}</span>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : !jobs || jobs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <CalendarDays className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No jobs found for this date.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Run the nightly sync or select a different date.
                </p>
              </CardContent>
            </Card>
          ) : viewMode === "by-time" ? (
            /* ── By Time view ── */
            <div className="space-y-3">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} onRefetch={refetch} />
              ))}
            </div>
          ) : (
            /* ── By Cleaner view ── */
            <div className="space-y-6">
              {cleanerGroups.map(([cleanerName, groupJobs]) => {
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

                return (
                  <div key={cleanerName}>
                    {/* Cleaner group header */}
                    <div className="flex items-center justify-between mb-2 px-1">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-primary" />
                        <span className="font-semibold text-sm">{cleanerName}</span>
                        <Badge variant="secondary" className="text-xs">{groupJobs.length} job{groupJobs.length !== 1 ? "s" : ""}</Badge>
                        {flaggedCount > 0 && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {flaggedCount} flagged
                          </Badge>
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
  );
}
