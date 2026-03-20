/**
 * CleanerDashboard — /cleaner
 *
 * Shows today's jobs for all cleaners (admin-facing view until cleaner auth is built).
 * Features:
 *  - Date picker to browse any day's jobs
 *  - Per-job card: customer name, address, service type, revenue, cleaner assignment
 *  - Customer rating badge (once received)
 *  - Photo upload per job (completion photo)
 *  - Weekly pay summary per cleaner
 */
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Camera, Star, AlertTriangle, CheckCircle2, Clock, MapPin,
  DollarSign, User, ChevronLeft, ChevronRight, Upload, Loader2,
  CalendarDays, TrendingUp, RefreshCw
} from "lucide-react";

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

function RatingStars({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-muted-foreground text-sm">Awaiting rating</span>;
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

  if (hasPhoto) {
    return (
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50">
            <CheckCircle2 className="w-4 h-4" />
            Photo submitted
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Completion Photos</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {job.photos.map((p) => (
              <a key={p.id} href={p.photoUrl} target="_blank" rel="noopener noreferrer">
                <img src={p.photoUrl} alt={p.filename ?? "photo"} className="rounded-lg w-full h-40 object-cover border hover:opacity-90 transition-opacity" />
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
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

// ── Pay Summary Card ──────────────────────────────────────────────────────────

function PaySummarySection({ date }: { date: string }) {
  // Calculate week range (Mon–Sun) containing the selected date
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0=Sun
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
            <div key={s.cleanerProfileId} className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border">
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
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CleanerDashboard() {
  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));
  const { data: jobs, isLoading, refetch } = trpc.quality.getJobsForDate.useQuery(
    { date: selectedDate },
    { refetchOnWindowFocus: false }
  );

  const { data: pendingSms } = trpc.quality.ratingSmsQueueSummary.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const approveAll = trpc.quality.approveAllRatingSms.useMutation({
    onSuccess: () => {
      toast.success("Rating SMS messages approved");
      refetchPending();
    },
  });

  const skipSms = trpc.quality.skipRatingSms.useMutation({
    onSuccess: () => toast("SMS skipped"),
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

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader activeTab="quality" />
      {/* Date navigation */}
      <div className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-sm text-muted-foreground">Cleaner Quality Dashboard</h2>
          <div className="flex items-center gap-2">
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
              className="ml-2 text-xs"
              onClick={() => setSelectedDate(formatDate(new Date()))}
            >
              Today
            </Button>
            <Button
              variant="default"
              size="sm"
              className="ml-1 text-xs gap-1.5"
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

        {/* Rating SMS Approval Banner */}
        {pendingSms && pendingSms.pending > 0 && (
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">
                      {pendingSms.pending} rating SMS{pendingSms.pending !== 1 ? "es" : ""} pending approval
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Will be sent at 7 PM ET today if approved. {pendingSms.approved} already approved.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">Review</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Pending Rating SMS</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3 mt-2">
                        {(pendingList ?? []).map((item) => (
                          <div key={item.id} className="p-3 rounded-lg border bg-card">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-medium text-sm">{item.customerFirstName ?? item.customerPhone}</p>
                                <p className="text-xs text-muted-foreground">{item.customerPhone}</p>
                <p className="text-xs text-muted-foreground">{item.customerFirstName ?? ""}</p>
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
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="text-xs h-7"
                                  onClick={() => {
                                    // approve handled by approveAll button
                                  }}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-xs h-7 text-muted-foreground"
                                  onClick={() => skipSms.mutate({ id: item.id })}
                                >
                                  Skip
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button
                    size="sm"
                    className="bg-amber-500 hover:bg-amber-600 text-white"
                    onClick={() => approveAll.mutate()}
                    disabled={approveAll.isPending}
                  >
                    {approveAll.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Approve All"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Jobs List */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-base">
              {isLoading ? "Loading jobs…" : `${jobs?.length ?? 0} job${jobs?.length !== 1 ? "s" : ""} on ${formatDisplayDate(selectedDate)}`}
            </h2>
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
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => {
                const rating = job.cleanerAssignment?.customerRating ?? null;
                const hasMissed = job.cleanerAssignment?.missedSomething === 1;
                const isLowRating = rating !== null && rating <= 3;
                const isFlagged = isLowRating || hasMissed;

                return (
                  <Card key={job.id} className={`transition-all ${isFlagged ? "border-red-200 bg-red-50/30 dark:bg-red-950/10" : ""}`}>
                    <CardContent className="py-4">
                      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                        {/* Left: Job info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
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
                            </div>
                          </div>

                          {/* Rating */}
                          <div className="mt-2">
                            <RatingStars rating={rating} />
                            {hasMissed && (
                              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Customer reported something was missed
                              </p>
                            )}
                          </div>
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
                                onAssigned={() => refetch()}
                              />
                            )}
                          </div>

                          {/* Base pay */}
                          {job.cleanerAssignment?.basePay && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />
                              Base pay: <span className="font-semibold text-foreground">${parseFloat(job.cleanerAssignment.basePay).toFixed(2)}</span>
                              {job.cleanerAssignment.payPercent && (
                                <span className="text-muted-foreground/60">({parseFloat(job.cleanerAssignment.payPercent) * 100}%)</span>
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
                              onSuccess={() => refetch()}
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
              })}
            </div>
          )}
        </div>

        {/* Weekly Pay Summary */}
        <PaySummarySection date={selectedDate} />
      </div>
    </div>
  );
}
