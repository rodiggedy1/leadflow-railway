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
import { useAgentPermissions } from "@/hooks/useAgentPermissions";

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
        style={{ color: "#000000" }}
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
            style={daysBack === r.days ? { background: "#000000" } : {}}
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
              <CardHeader className="pb-2 text-center w-full">
                <CardTitle className="text-base font-semibold text-gray-700 flex items-center justify-center gap-2">
                  <Smile className="w-4 h-4" style={{ color: "#000000" }} />
                  Customer Happiness Score
                </CardTitle>
                <CardDescription className="text-xs text-center">
                  % of replied customers who were positive
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center w-full relative">
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
                  <TrendingUp className="w-4 h-4" style={{ color: "#000000" }} />
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
                      stroke="#000000"
                      strokeWidth={2.5}
                      dot={{ fill: "#000000", r: 4 }}
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
                  <BarChart2 className="w-4 h-4" style={{ color: "#000000" }} />
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
                    <Award className="w-4 h-4" style={{ color: "#000000" }} />
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
          style={{ background: "#000000" }}
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
      <Card className="border-2" style={{ borderColor: "#00000020" }}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "#FFF0EC" }}
              >
                <CloudDownload className="w-4 h-4" style={{ color: "#000000" }} />
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
                style={{ background: "#000000" }}
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
        style={{ background: "#F7F7F7", borderColor: "#E5E5E5", color: "#0D0D0D" }}
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
            style={{ background: "#F7F7F7" }}
          >
            <CheckCircle2 className="w-8 h-8" style={{ color: "#000000" }} />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No batches yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Upload your first completed jobs CSV to get started.
          </p>
          <Button
            onClick={() => fileInputRef.current?.click()}
            style={{ background: "#000000" }}
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
                      style={{ color: "#000000" }}
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
                      <div className="text-2xl font-bold" style={{ color: "#000000" }}>
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
                          style={{ width: `${responseRate}%`, background: "#000000" }}
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

// ─── Conversations tab ───────────────────────────────────────────────────────
const SENTIMENT_CONFIG: Record<string, { label: string; bg: string; text: string; border: string; icon: React.ReactNode }> = {
  confirmed: { label: "Review Left", bg: "bg-green-50", text: "text-green-700", border: "border-green-200", icon: <Award className="w-3.5 h-3.5" /> },
  positive:  { label: "Happy",       bg: "bg-blue-50",  text: "text-blue-700",  border: "border-blue-200",  icon: <ThumbsUp className="w-3.5 h-3.5" /> },
  negative:  { label: "Unhappy",     bg: "bg-red-50",   text: "text-red-600",   border: "border-red-200",   icon: <ThumbsDown className="w-3.5 h-3.5" /> },
  pending:   { label: "No Reply",    bg: "bg-gray-50",  text: "text-gray-500",  border: "border-gray-200",  icon: <Clock className="w-3.5 h-3.5" /> },
};

type Conversation = {
  id: number;
  leadPhone: string;
  leadName: string;
  stage: string;
  sentiment: string;
  lastCustomerReply: string | null;
  lastReplyAt: number | null;
  createdAt: Date;
  updatedAt: Date;
  isTest: boolean;
  messages: Array<{ role: string; content: string; ts: number }>;
  replyCount: number;
};

function SmsThread({ messages }: { messages: Array<{ role: string; content: string; ts: number }> }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 bg-gray-50 rounded-b-xl border-t" style={{ borderColor: "#E5E5E5" }}>
      {messages.map((m, i) => (
        <div key={i} className={`flex ${m.role === "assistant" ? "justify-start" : "justify-end"}`}>
          <div
            className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
              m.role === "assistant"
                ? "bg-white border text-gray-800 rounded-tl-sm"
                : "text-white rounded-tr-sm"
            }`}
            style={m.role === "user" ? { backgroundColor: "#000000" } : { borderColor: "#E5E5E5" }}
          >
            {m.content}
            <div className={`text-[10px] mt-1 ${m.role === "assistant" ? "text-gray-400" : "text-orange-100"}`}>
              {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConversationCard({ c }: { c: Conversation }) {
  const [expanded, setExpanded] = useState(false);
  const sentCfg = SENTIMENT_CONFIG[c.sentiment] ?? SENTIMENT_CONFIG.pending;
  const hasReplies = c.replyCount > 0;

  return (
    <div className="rounded-xl border bg-white overflow-hidden transition-shadow hover:shadow-sm" style={{ borderColor: "#E5E5E5" }}>
      {/* Header row */}
      <button
        className="w-full text-left px-4 py-3.5 flex items-center gap-3"
        onClick={() => hasReplies && setExpanded(e => !e)}
        style={{ cursor: hasReplies ? "pointer" : "default" }}
      >
        {/* Avatar */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
          style={{ backgroundColor: "#000000" }}
        >
          {(c.leadName?.[0] ?? "?").toUpperCase()}
        </div>

        {/* Name + preview */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 text-sm">{c.leadName}</span>
            {c.isTest && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">TEST</span>
            )}
            <span className="text-xs text-gray-400">{c.leadPhone}</span>
          </div>
          <p className="text-xs text-gray-500 truncate mt-0.5">
            {c.lastCustomerReply
              ? <span className="text-gray-700">"{c.lastCustomerReply}"</span>
              : <span className="italic text-gray-400">No reply yet</span>}
          </p>
        </div>

        {/* Right side: sentiment + meta */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${sentCfg.bg} ${sentCfg.text} ${sentCfg.border}`}>
            {sentCfg.icon}
            {sentCfg.label}
          </span>
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            {hasReplies && (
              <span className="flex items-center gap-0.5">
                <MessageCircle className="w-3 h-3" />
                {c.replyCount} {c.replyCount === 1 ? "reply" : "replies"}
              </span>
            )}
            <span>{new Date(c.createdAt).toLocaleDateString()}</span>
            {hasReplies && (
              <ChevronLeft
                className={`w-3.5 h-3.5 transition-transform ${expanded ? "-rotate-90" : "rotate-180"}`}
              />
            )}
          </div>
        </div>
      </button>

      {/* Expandable SMS thread */}
      {expanded && hasReplies && <SmsThread messages={c.messages} />}
    </div>
  );
}

function ConversationsTab() {
  const { data: conversations, isLoading, refetch } = trpc.completedJobs.conversations.useQuery();
  const [filter, setFilter] = useState<"all" | "confirmed" | "positive" | "negative" | "pending">("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!conversations) return [];
    return conversations.filter(c => {
      // "Happy" filter shows both positive and confirmed — both are happy customers
      const matchFilter = filter === "all" ||
        (filter === "positive" ? (c.sentiment === "positive" || c.sentiment === "confirmed") : c.sentiment === filter);
      const matchSearch = !search ||
        c.leadName.toLowerCase().includes(search.toLowerCase()) ||
        c.leadPhone.includes(search) ||
        (c.lastCustomerReply ?? "").toLowerCase().includes(search.toLowerCase());
      return matchFilter && matchSearch;
    });
  }, [conversations, filter, search]);

  // Count by sentiment
  // "Happy" includes both positive (sent Google link) AND confirmed (left a review) — both are happy customers
  const counts = useMemo(() => {
    if (!conversations) return { all: 0, confirmed: 0, positive: 0, negative: 0, pending: 0 };
    return {
      all: conversations.length,
      confirmed: conversations.filter(c => c.sentiment === "confirmed").length,
      positive: conversations.filter(c => c.sentiment === "positive" || c.sentiment === "confirmed").length,
      negative: conversations.filter(c => c.sentiment === "negative").length,
      pending: conversations.filter(c => c.sentiment === "pending").length,
    };
  }, [conversations]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading responses…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        {/* Sentiment filter pills */}
        <div className="flex flex-wrap gap-1.5">
          {(["all", "confirmed", "positive", "negative", "pending"] as const).map(f => {
            const cfg = f === "all" ? null : SENTIMENT_CONFIG[f];
            const count = counts[f];
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                  filter === f
                    ? cfg ? `${cfg.bg} ${cfg.text} ${cfg.border}` : "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                }`}
              >
                {cfg?.icon}
                {f === "all" ? "All" : cfg?.label}
                <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                  filter === f ? "bg-white/30" : "bg-gray-100 text-gray-500"
                }`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Search + refresh */}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Search name, phone, reply…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 w-52 focus:outline-none focus:ring-1"
            style={{ borderColor: "#E5E5E5", focusRingColor: "#000000" } as React.CSSProperties}
          />
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg border text-gray-400 hover:text-gray-600 transition-colors"
            style={{ borderColor: "#E5E5E5" }}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Conversation cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
          {conversations?.length === 0 ? (
            <>
              <p className="text-sm">No review conversations yet.</p>
              <p className="text-xs mt-1">Use Test Send in the Batches tab to try the full flow.</p>
            </>
          ) : (
            <p className="text-sm">No conversations match your filter.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => <ConversationCard key={c.id} c={c as Conversation} />)}
        </div>
      )}
    </div>
  );
}

// ─── Test Send card ─────────────────────────────────────────────────────────
function TestSendCard() {
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [sent, setSent] = useState<{ message: string; sentTo: string } | null>(null);

  const sendTest = trpc.completedJobs.sendTest.useMutation({
    onSuccess: (result) => {
      setSent({ message: result.message, sentTo: result.sentTo });
      toast.success(`✅ Test review SMS sent to ${result.sentTo}`);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleSend = () => {
    if (!phone.trim()) {
      toast.error("Please enter a phone number.");
      return;
    }
    setSent(null);
    sendTest.mutate({ testPhone: phone.trim(), firstName: firstName.trim() || "there" });
  };

  return (
    <Card style={{ borderColor: "#E8E0F0", background: "#FDFCFF" }}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="w-4 h-4" style={{ color: "#7C3AED" }} />
          Send a Test Review SMS
        </CardTitle>
        <CardDescription>
          Send yourself a real review request SMS to experience the full AI conversation flow end-to-end.
          Reply to the SMS and the AI will respond exactly as it would for a real customer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="tel"
            placeholder="Phone number (e.g. 202-555-1234)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="flex-1 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{ borderColor: "#D8D0E8" }}
          />
          <input
            type="text"
            placeholder="First name (optional)"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-40 border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{ borderColor: "#D8D0E8" }}
          />
          <Button
            onClick={handleSend}
            disabled={sendTest.isPending || !phone.trim()}
            style={{ background: "#7C3AED" }}
            className="flex-shrink-0"
          >
            {sendTest.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin mr-1.5" />
            ) : (
              <Send className="w-4 h-4 mr-1.5" />
            )}
            {sendTest.isPending ? "Sending…" : "Send Test"}
          </Button>
        </div>

        {sent && (
          <div
            className="rounded-lg border p-4 space-y-2"
            style={{ background: "#F5F0FF", borderColor: "#C4B5FD" }}
          >
            <p className="text-xs font-semibold text-purple-700 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Sent to {sent.sentTo}
            </p>
            <p className="text-sm text-gray-700 italic">"…{sent.message.slice(0, 120)}{sent.message.length > 120 ? "…" : ""}"</p>
            <p className="text-xs text-gray-500">
              Reply to the SMS on your phone — the AI will respond in real time. Check the <strong>Conversations</strong> tab to see the session.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Approval card ────────────────────────────────────────────────────────────
function ApprovalCard() {
  const utils = trpc.useUtils();
  const { data: pending, isLoading } = trpc.completedJobs.pendingApproval.useQuery();
  const [showConfirm, setShowConfirm] = useState(false);

  const approveMutation = trpc.completedJobs.approveDailyBatch.useMutation({
    onSuccess: (result) => {
      if (result.sent > 0) {
        toast.success(`✅ Sent ${result.sent} review SMS for ${pending?.date ?? "yesterday"}'s jobs.`);
      } else {
        toast.info("No eligible jobs to send for yesterday.");
      }
      setShowConfirm(false);
      utils.completedJobs.pendingApproval.invalidate();
      utils.completedJobs.conversations.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      setShowConfirm(false);
    },
  });

  if (isLoading) return null;

  const count = pending?.count ?? 0;
  const date = pending?.date ?? "";

  if (count === 0) {
    return (
      <div
        className="rounded-lg border p-4 text-sm flex items-center gap-3"
        style={{ background: "#F9FFF9", borderColor: "#BBF7D0", color: "#166534" }}
      >
        <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
        <span>No review SMS pending for today. Yesterday's batch has already been sent or there were no jobs.</span>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border p-5 space-y-4"
      style={{ background: "#F7F7F7", borderColor: "#E5E5E5" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Send className="w-4 h-4" style={{ color: "#000000" }} />
            Review SMS Ready for Approval
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            <strong>{count} customers</strong> from <strong>{date}</strong>'s jobs are ready to receive a review request SMS.
            Review the list below and click <strong>Approve & Send</strong> to send them.
          </p>
        </div>
        {!showConfirm ? (
          <Button
            onClick={() => setShowConfirm(true)}
            style={{ background: "#000000" }}
            className="flex-shrink-0"
          >
            <Send className="w-4 h-4 mr-1.5" />
            Approve & Send
          </Button>
        ) : (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm text-gray-600">Send to {count} customers?</span>
            <Button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              style={{ background: "#000000" }}
              size="sm"
            >
              {approveMutation.isPending ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              )}
              Confirm
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfirm(false)}
              disabled={approveMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Preview list */}
      {pending?.jobs && pending.jobs.length > 0 && (
        <div className="rounded border overflow-hidden" style={{ borderColor: "#E5E5E5" }}>
          <Table>
            <TableHeader>
              <TableRow style={{ background: "#FFF0EB" }}>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Phone</TableHead>
                <TableHead className="text-xs">Service</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.jobs.slice(0, 10).map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="text-sm">{j.name ?? j.firstName ?? "—"}</TableCell>
                  <TableCell className="text-sm text-gray-500">{j.phone}</TableCell>
                  <TableCell className="text-sm text-gray-500">{j.serviceType ?? "—"}</TableCell>
                </TableRow>
              ))}
              {pending.jobs.length > 10 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-xs text-center text-gray-400 py-2">
                    + {pending.jobs.length - 10} more customers
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type ReviewTab = "analytics" | "conversations" | "batches";

export default function CompletedJobs() {
  const [activeTab, setActiveTab] = useState<ReviewTab>("analytics");
  const { isAdmin } = useAgentPermissions();

  return (
    <div className="hj-theme min-h-screen" style={{ backgroundColor: "#F7F7F7" }}>
      <AdminHeader activeTab="completed-jobs" isAdmin={isAdmin} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Page header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <a
              href="/admin/command-center"
              className="text-sm font-medium hover:underline"
              style={{ color: "#000000" }}
            >
              ← Back to Admin
            </a>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Star className="w-6 h-6" style={{ color: "#000000" }} />
            Reviews
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Customer happiness analytics and review request management.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-6 border-b" style={{ borderColor: "#E5E5E5" }}>
          {(["analytics", "conversations", "batches"] as ReviewTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize"
              style={
                activeTab === tab
                  ? { borderColor: "#000000", color: "#000000" }
                  : { borderColor: "transparent", color: "#6b7280" }
              }
            >
              {tab === "analytics" ? "📊 Analytics" : tab === "conversations" ? "💬 Conversations" : "📋 Batches"}
            </button>
          ))}
        </div>

        {activeTab === "analytics" && <AnalyticsTab />}
        {activeTab === "conversations" && <ConversationsTab />}
        {activeTab === "batches" && (
          <div className="space-y-6">
            <TestSendCard />
            <ApprovalCard />
            <BatchesTab />
          </div>
        )}
      </div>
    </div>
  );
}
