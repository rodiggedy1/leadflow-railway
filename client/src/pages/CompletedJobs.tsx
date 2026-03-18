/**
 * CompletedJobs.tsx  (displayed as "Reviews")
 * Two-tab admin page:
 *  - Analytics: Customer happiness score, trend chart, sentiment breakdown, service type breakdown
 *  - Batches:   CSV upload, Launch27 sync, batch list, send-pending controls
 */
import { useState, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import MessageFlowPanel from "@/components/MessageFlowPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Upload,
  ChevronLeft,
  Send,
  RefreshCw,
  Star,
  ThumbsUp,
  ThumbsDown,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MessageSquare,
  CloudDownload,
  Calendar,
  Repeat,
  Users,
  TrendingUp,
  BarChart2,
  Smile,
  Frown,
  Award,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import AdminHeader from "@/components/AdminHeader";

// ─── Status badge helpers ─────────────────────────────────────────────────────
const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode; color: string }
> = {
  PENDING: {
    label: "Pending",
    variant: "secondary",
    icon: <Clock className="w-3 h-3" />,
    color: "text-gray-500",
  },
  SENT: {
    label: "SMS Sent",
    variant: "outline",
    icon: <Send className="w-3 h-3" />,
    color: "text-blue-600",
  },
  REPLIED_POSITIVE: {
    label: "Positive",
    variant: "default",
    icon: <ThumbsUp className="w-3 h-3" />,
    color: "text-green-600",
  },
  REPLIED_NEGATIVE: {
    label: "Negative",
    variant: "destructive",
    icon: <ThumbsDown className="w-3 h-3" />,
    color: "text-red-600",
  },
  REVIEW_CONFIRMED: {
    label: "Review Left",
    variant: "default",
    icon: <Star className="w-3 h-3" />,
    color: "text-yellow-500",
  },
  OPTED_OUT: {
    label: "Opted Out",
    variant: "outline",
    icon: <XCircle className="w-3 h-3" />,
    color: "text-gray-400",
  },
};

// ─── Batch detail sub-page ────────────────────────────────────────────────────
function BatchDetail({ batchId, onBack }: { batchId: number; onBack: () => void }) {
  const { data: contacts, isLoading } = trpc.completedJobs.getBatchContacts.useQuery({ batchId });

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm font-medium mb-4 hover:underline"
        style={{ color: "#E8603C" }}
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Reviews
      </button>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Batch Contacts</CardTitle>
          <CardDescription>{contacts?.length ?? 0} contacts in this batch</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Job Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Replied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts?.map((c) => {
                  const cfg = STATUS_CONFIG[c.status] ?? {
                    label: c.status,
                    variant: "outline" as const,
                    icon: <AlertCircle className="w-3 h-3" />,
                    color: "text-gray-500",
                  };
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name ?? "—"}</TableCell>
                      <TableCell className="text-gray-500">{c.phone}</TableCell>
                      <TableCell className="text-gray-500">{c.serviceType ?? "—"}</TableCell>
                      <TableCell className="text-gray-500">{c.jobDate ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={cfg.variant} className="gap-1 text-xs">
                          {cfg.icon}
                          {cfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-500 text-xs">
                        {c.repliedAt ? new Date(c.repliedAt).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Happiness Score ring ─────────────────────────────────────────────────────
function HappinessRing({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";
  const label = score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Needs Attention";

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width="140" height="140" className="-rotate-90">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="12" />
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-4xl font-bold text-gray-900">{score}%</span>
        <span className="text-xs font-medium mt-0.5" style={{ color }}>{label}</span>
      </div>
    </div>
  );
}

// ─── Analytics tab ────────────────────────────────────────────────────────────
const DATE_RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "3 months", days: 90 },
  { label: "6 months", days: 180 },
  { label: "All time", days: 365 },
];

function AnalyticsTab() {
  const [daysBack, setDaysBack] = useState(30);
  const { data, isLoading } = trpc.completedJobs.analytics.useQuery({ daysBack });

  const statCards = useMemo(() => {
    if (!data) return [];
    return [
      {
        label: "SMS Sent",
        value: data.smsSent.toLocaleString(),
        icon: <MessageCircle className="w-5 h-5 text-blue-500" />,
        bg: "bg-blue-50",
      },
      {
        label: "Response Rate",
        value: `${data.responseRate}%`,
        icon: <TrendingUp className="w-5 h-5 text-indigo-500" />,
        bg: "bg-indigo-50",
      },
      {
        label: "Google Reviews",
        value: data.googleReviews.toLocaleString(),
        icon: <Star className="w-5 h-5 text-yellow-500" />,
        bg: "bg-yellow-50",
      },
      {
        label: "Unhappy Customers",
        value: data.unhappyCount.toLocaleString(),
        icon: <Frown className="w-5 h-5 text-red-500" />,
        bg: "bg-red-50",
      },
    ];
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading analytics…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-24 text-gray-400">No data available.</div>
    );
  }

  const hasData = data.smsSent > 0;

  return (
    <div className="space-y-6">
      {/* Date range filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-gray-600">Period:</span>
        {DATE_RANGES.map((r) => (
          <button
            key={r.days}
            onClick={() => setDaysBack(r.days)}
            className={`px-3 py-1.5 text-sm rounded-full font-medium transition-colors ${
              daysBack === r.days
                ? "text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
            style={daysBack === r.days ? { background: "#E8603C" } : {}}
          >
            {r.label}
          </button>
        ))}
      </div>

      {!hasData ? (
        <div className="text-center py-20 text-gray-400">
          <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No review SMS have been sent in this period yet.</p>
          <p className="text-xs mt-1">Review requests will appear here after the first batch is sent.</p>
        </div>
      ) : (
        <>
          {/* Hero + stat cards */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Happiness ring */}
            <Card className="lg:col-span-2 flex flex-col items-center justify-center py-8">
              <CardHeader className="pb-2 text-center">
                <CardTitle className="text-base font-semibold text-gray-700 flex items-center justify-center gap-2">
                  <Smile className="w-4 h-4" style={{ color: "#E8603C" }} />
                  Customer Happiness Score
                </CardTitle>
                <CardDescription className="text-xs">
                  % of replied customers who were positive
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center relative">
                <HappinessRing score={data.happinessRate} />
                <p className="text-xs text-gray-500 mt-3 text-center">
                  Based on {data.repliedCount} replies out of {data.smsSent} SMS sent
                </p>
              </CardContent>
            </Card>

            {/* Stat cards 2×2 */}
            <div className="lg:col-span-3 grid grid-cols-2 gap-4">
              {statCards.map((s) => (
                <Card key={s.label} className="flex flex-col justify-between">
                  <CardContent className="pt-5 pb-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${s.bg}`}>
                      {s.icon}
                    </div>
                    <div className="text-3xl font-bold text-gray-900">{s.value}</div>
                    <div className="text-sm text-gray-500 mt-1">{s.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Happiness trend chart */}
          {data.trend.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-gray-700 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" style={{ color: "#E8603C" }} />
                  Happiness Trend
                </CardTitle>
                <CardDescription className="text-xs">Weekly happiness rate over the selected period</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.trend} margin={{ top: 8, right: 16, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      formatter={(v: number) => [`${v}%`, "Happiness"]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="happinessRate"
                      stroke="#E8603C"
                      strokeWidth={2.5}
                      dot={{ fill: "#E8603C", r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Sentiment breakdown + service type side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Sentiment breakdown */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-gray-700 flex items-center gap-2">
                  <BarChart2 className="w-4 h-4" style={{ color: "#E8603C" }} />
                  Sentiment Breakdown
                </CardTitle>
                <CardDescription className="text-xs">How customers responded to the review SMS</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.sentimentBreakdown.map((s) => {
                  const pct = data.smsSent > 0 ? Math.round((s.count / data.smsSent) * 100) : 0;
                  return (
                    <div key={s.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-700">{s.label}</span>
                        <span className="text-gray-500">{s.count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: s.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Service type breakdown */}
            {data.serviceTypeBreakdown.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-gray-700 flex items-center gap-2">
                    <Award className="w-4 h-4" style={{ color: "#E8603C" }} />
                    Happiness by Service Type
                  </CardTitle>
                  <CardDescription className="text-xs">Which service types generate the happiest customers</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart
                      data={data.serviceTypeBreakdown}
                      layout="vertical"
                      margin={{ top: 0, right: 40, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        tick={{ fontSize: 11, fill: "#94a3b8" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <YAxis
                        type="category"
                        dataKey="serviceType"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        width={110}
                      />
                      <Tooltip
                        formatter={(v: number, _: string, props: any) => [
                          `${v}% happiness (${props.payload.replied} replies)`,
                          "Rate",
                        ]}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                      />
                      <Bar dataKey="happinessRate" radius={[0, 4, 4, 0]}>
                        {data.serviceTypeBreakdown.map((entry, idx) => (
                          <Cell
                            key={idx}
                            fill={entry.happinessRate >= 80 ? "#22c55e" : entry.happinessRate >= 60 ? "#f59e0b" : "#ef4444"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Batches tab ──────────────────────────────────────────────────────────────
function BatchesTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [jobDateOverride, setJobDateOverride] = useState<string>("");

  const { data: batches, isLoading, refetch } = trpc.completedJobs.listBatches.useQuery();

  const uploadMutation = trpc.completedJobs.upload.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Batch uploaded — ${result.count} contacts added. SMS will be sent at 10 AM the day after the job date.`);
        refetch();
        setSelectedBatchId(result.batchId);
      } else {
        toast.error(result.error ?? "Unknown error");
      }
      setUploading(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setUploading(false);
    },
  });

  const [syncDate, setSyncDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });

  const { data: lastSync, refetch: refetchLastSync } = trpc.launch27.getLastSync.useQuery();

  const syncMutation = trpc.launch27.syncCompletedJobs.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.inserted > 0
          ? `Synced ${result.inserted} new jobs from Launch27 for ${result.date}. ${result.skipped > 0 ? `${result.skipped} skipped (duplicates/invalid).` : ""}`
          : `No new jobs to sync for ${result.date}. ${result.skipped > 0 ? `${result.skipped} already in system.` : ""}`
      );
      refetch();
      refetchLastSync();
    },
    onError: (err) => {
      toast.error(`Launch27 sync failed: ${err.message}`);
    },
  });

  const sendNowMutation = trpc.completedJobs.sendPendingNow.useMutation({
    onSuccess: (result) => {
      if (result.sent > 0) {
        toast.success(`Sent ${result.sent} review request SMS.`);
      } else {
        toast.info("No pending SMS — all contacts are either already sent or not yet past their job date.");
      }
      refetch();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const csvText = await file.text();
    uploadMutation.mutate({
      csvText,
      filename: file.name,
      jobDate: jobDateOverride || undefined,
    });
    e.target.value = "";
  };

  if (selectedBatchId !== null) {
    return <BatchDetail batchId={selectedBatchId} onBack={() => setSelectedBatchId(null)} />;
  }

  return (
    <div className="space-y-6">
      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => sendNowMutation.mutate()}
          disabled={sendNowMutation.isPending}
          className="gap-1.5"
        >
          {sendNowMutation.isPending ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          Send Pending Now
        </Button>
        <Button
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="gap-1.5"
          style={{ background: "#E8603C" }}
        >
          {uploading ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          Upload CSV
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Launch27 Auto-Sync Card */}
      <Card className="border-2" style={{ borderColor: "#E8603C20" }}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "#FFF0EC" }}
              >
                <CloudDownload className="w-4 h-4" style={{ color: "#E8603C" }} />
              </div>
              <div>
                <CardTitle className="text-base font-semibold text-gray-900">
                  Launch27 Auto-Sync
                </CardTitle>
                <CardDescription className="text-xs mt-0">
                  {lastSync
                    ? `Last sync: ${lastSync.filename.replace("launch27-sync-", "").replace("launch27-auto-", "")} · ${lastSync.totalCount} jobs imported`
                    : "Never synced — click Sync to pull completed bookings"}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full border border-green-200">
                <Repeat className="w-3 h-3" />
                Runs nightly at 10 PM
              </span>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                <input
                  type="date"
                  value={syncDate}
                  onChange={(e) => setSyncDate(e.target.value)}
                  className="text-sm border rounded px-2 py-1 text-gray-700"
                  style={{ borderColor: "#e5e7eb" }}
                />
              </div>
              <Button
                size="sm"
                onClick={() => syncMutation.mutate({ date: syncDate })}
                disabled={syncMutation.isPending}
                className="gap-1.5"
                style={{ background: "#E8603C" }}
              >
                {syncMutation.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudDownload className="w-3.5 h-3.5" />
                )}
                {syncMutation.isPending ? "Syncing…" : "Sync Date"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const dates = Array.from({ length: 7 }, (_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() - 1 - i);
                    return d.toISOString().slice(0, 10);
                  });
                  toast.info(`Starting backfill for ${dates[0]} through ${dates[6]}. This may take a moment.`);
                  dates.forEach((date, idx) => {
                    setTimeout(() => syncMutation.mutate({ date }), idx * 1500);
                  });
                }}
                disabled={syncMutation.isPending}
                className="gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Sync Last 7 Days
              </Button>
            </div>
          </div>
        </CardHeader>
        {syncMutation.data && (
          <CardContent className="pt-0">
            <div
              className="rounded-md px-3 py-2 text-sm"
              style={{ background: syncMutation.data.inserted > 0 ? "#F0FDF4" : "#F9FAFB", color: syncMutation.data.inserted > 0 ? "#166534" : "#6b7280" }}
            >
              {syncMutation.data.message}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Info banner */}
      <div
        className="rounded-lg border p-4 text-sm"
        style={{ background: "#FFF8F6", borderColor: "#F0D8D0", color: "#7c3a2a" }}
      >
        <strong>How it works:</strong> Completed jobs are synced nightly from Launch27 (or uploaded via CSV). Review request SMS are sent at <strong>10 AM the day after each cleaning</strong>. Positive replies receive a Google review link with a 10% discount offer. Negative replies are flagged for manual follow-up.
      </div>

      {/* Optional job date override */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium text-gray-700">Job date override (optional):</label>
        <input
          type="date"
          value={jobDateOverride}
          onChange={(e) => setJobDateOverride(e.target.value)}
          className="text-sm border rounded px-2 py-1"
          style={{ borderColor: "#e5e7eb" }}
        />
        {jobDateOverride && (
          <button
            onClick={() => setJobDateOverride("")}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
        <span className="text-xs text-gray-400">
          Leave blank to use each row's Date column.
        </span>
      </div>

      {/* Batch list */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading batches…</div>
      ) : !batches?.length ? (
        <div className="text-center py-16">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: "#FFF8F6" }}
          >
            <CheckCircle2 className="w-8 h-8" style={{ color: "#E8603C" }} />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No batches yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Upload your first completed jobs CSV to get started.
          </p>
          <Button
            onClick={() => fileInputRef.current?.click()}
            style={{ background: "#E8603C" }}
            className="gap-1.5"
          >
            <Upload className="w-4 h-4" />
            Upload CSV
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {batches.map((batch) => {
            const responseRate =
              batch.sentCount > 0
                ? Math.round(
                    ((batch.positiveCount + batch.negativeCount + batch.reviewConfirmedCount) /
                      batch.sentCount) *
                      100
                  )
                : 0;
            const reviewRate =
              batch.sentCount > 0
                ? Math.round((batch.reviewConfirmedCount / batch.sentCount) * 100)
                : 0;

            return (
              <Card
                key={batch.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setSelectedBatchId(batch.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold text-gray-900">
                        {batch.filename}
                      </CardTitle>
                      <CardDescription className="mt-0.5">
                        Job date: {batch.jobDate ?? "—"} · Uploaded{" "}
                        {new Date(batch.uploadedAt).toLocaleDateString()}
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs gap-1"
                      style={{ color: "#E8603C" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedBatchId(batch.id);
                      }}
                    >
                      View contacts →
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-900">{batch.totalCount}</div>
                      <div className="text-xs text-gray-500 mt-0.5">Total</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">{batch.sentCount}</div>
                      <div className="text-xs text-gray-500 mt-0.5">SMS Sent</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">{batch.positiveCount}</div>
                      <div className="text-xs text-gray-500 mt-0.5">Positive</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-500">{batch.negativeCount}</div>
                      <div className="text-xs text-gray-500 mt-0.5">Negative</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-yellow-500">
                        {batch.reviewConfirmedCount}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">Reviews</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold" style={{ color: "#E8603C" }}>
                        {reviewRate}%
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">Review Rate</div>
                    </div>
                  </div>
                  {batch.sentCount > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Response rate</span>
                        <span>{responseRate}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full"
                          style={{ width: `${responseRate}%`, background: "#E8603C" }}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Review Message Flow */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Review Request Message Flow
          </CardTitle>
          <CardDescription>
            The full SMS sequence sent to completed job customers. Click <strong>Edit</strong> on any message to update the copy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MessageFlowPanel flowType="review" />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type ReviewTab = "analytics" | "batches";

export default function CompletedJobs() {
  const [activeTab, setActiveTab] = useState<ReviewTab>("analytics");

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader activeTab="completed-jobs" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Page header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <a
              href="/admin"
              className="text-sm font-medium hover:underline"
              style={{ color: "#E8603C" }}
            >
              ← Back to Admin
            </a>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Star className="w-6 h-6" style={{ color: "#E8603C" }} />
            Reviews
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Customer happiness analytics and review request management.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-6 border-b" style={{ borderColor: "#F0D8D0" }}>
          {(["analytics", "batches"] as ReviewTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize"
              style={
                activeTab === tab
                  ? { borderColor: "#E8603C", color: "#E8603C" }
                  : { borderColor: "transparent", color: "#6b7280" }
              }
            >
              {tab === "analytics" ? "📊 Analytics" : "📋 Batches"}
            </button>
          ))}
        </div>

        {activeTab === "analytics" ? <AnalyticsTab /> : <BatchesTab />}
      </div>
    </div>
  );
}
