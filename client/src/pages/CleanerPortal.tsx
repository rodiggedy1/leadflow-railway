/**
 * CleanerPortal — /cleaner
 *
 * Individual cleaner portal. Login with phone + password.
 * Shows today's jobs (with date browsing), pay breakdown, ratings, photo upload, mark complete.
 */
import { useState, useRef, useCallback } from "react";
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
  streakBonus: string | null;
  finalPay: string | null;
  customerRating: number | null;
  missedSomething: number | null;
  photoSubmitted: number;
  customerNotes: string | null;
  photos: { id: number; photoUrl: string; filename: string | null }[];
};

function JobCard({ job, onPhotoUploaded, onMarkedComplete }: {
  job: Job;
  onPhotoUploaded: () => void;
  onMarkedComplete: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);

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

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Photo must be under 8MB");
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({
        cleanerJobId: job.id,
        completedJobId: job.completedJobId,
        filename: file.name,
        mimeType: file.type,
        dataBase64: base64,
      });
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  }, [job.id, job.completedJobId, uploadMutation]);

  const isComplete = job.bookingStatus === "completed";
  const basePay = parseFloat(job.basePay ?? "0") || 0;
  const ratingAdj = parseFloat(job.ratingAdjustment ?? "0") || 0;
  const streakBonus = parseFloat(job.streakBonus ?? "0") || 0;
  const finalPay = parseFloat(job.finalPay ?? "0") || (basePay + ratingAdj + streakBonus);

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
            <p className="text-amber-300 text-xs font-medium mb-1">Customer Notes</p>
            <p className="text-amber-200 text-sm">{job.customerNotes}</p>
          </div>
        )}

        {/* Pay breakdown */}
        <div className="bg-slate-900/60 rounded-lg p-3 space-y-1.5">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2">Pay Breakdown</p>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Base Pay</span>
            <span className="text-white font-medium">{formatCurrency(job.basePay)}</span>
          </div>
          {ratingAdj !== 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Rating Adjustment</span>
              <span className={ratingAdj > 0 ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>
                {ratingAdj > 0 ? "+" : ""}{formatCurrency(job.ratingAdjustment)}
              </span>
            </div>
          )}
          {streakBonus > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Streak Bonus</span>
              <span className="text-emerald-400 font-medium">+{formatCurrency(job.streakBonus)}</span>
            </div>
          )}
          <div className="border-t border-slate-700 pt-1.5 flex justify-between">
            <span className="text-white font-semibold text-sm">Total Pay</span>
            <span className="text-emerald-400 font-bold text-base">{formatCurrency(finalPay.toFixed(2))}</span>
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
              {showPhotos ? " (hide)" : " (show)"}
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

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
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
            {uploading ? "Uploading…" : "Add Photo"}
          </Button>
          {!isComplete && (
            <Button
              size="sm"
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
              onClick={() => { setCompleting(true); completeMutation.mutate({ cleanerJobId: job.id }); }}
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

// ── Main Portal ───────────────────────────────────────────────────────────────

export default function CleanerPortal() {
  const [date, setDate] = useState(getTodayET);
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

  const logoutMutation = trpc.cleaner.logout.useMutation({
    onSuccess: () => utils.cleaner.me.invalidate(),
  });

  const refetch = () => {
    utils.cleaner.myJobs.invalidate({ date });
    utils.cleaner.myJobsRange.invalidate();
  };

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
  const jobs = (jobsQuery.data ?? []) as Job[];
  const weekJobs = weekQuery.data ?? [];

  // Earnings summary
  const todayEarnings = jobs.reduce((sum, j) => {
    const fp = parseFloat(j.finalPay ?? "0") || (parseFloat(j.basePay ?? "0") + parseFloat(j.ratingAdjustment ?? "0") + parseFloat(j.streakBonus ?? "0"));
    return sum + (isNaN(fp) ? 0 : fp);
  }, 0);

  const weekEarnings = weekJobs.reduce((sum, j) => {
    const fp = parseFloat(j.finalPay ?? "0") || (parseFloat(j.basePay ?? "0") + parseFloat(j.ratingAdjustment ?? "0") + parseFloat(j.streakBonus ?? "0"));
    return sum + (isNaN(fp) ? 0 : fp);
  }, 0);

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
        ) : jobs.length === 0 ? (
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
