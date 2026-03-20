/**
 * SyncHealthPage — Daily automation health monitor for Maids in Black
 *
 * Shows:
 *  - Status cards for each cron job (Launch27 Sync, Always-On SMS)
 *  - Last run time, record counts, duration
 *  - Color-coded status (green = success, yellow = partial/skipped, red = error)
 *  - Run history table with expandable details
 *  - Manual trigger button for the nightly sync
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  MinusCircle,
  RefreshCw,
  Activity,
  Database,
  MessageSquare,
  Clock,
  ChevronDown,
  ChevronRight,
  Zap,
  Send,
  CheckCircle,
  AlertTriangle,
  Play,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import AdminHeader from "@/components/AdminHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

type SyncStatus = "success" | "partial" | "error" | "skipped";

interface SyncRun {
  id: number;
  runType: "launch27-sync" | "always-on-send";
  status: SyncStatus;
  message: string | null;
  errorDetail: string | null;
  recordsInserted: number | null;
  recordsSkipped: number | null;
  smsSent: number | null;
  smsFailed: number | null;
  groupBreakdown: Record<string, { sent: number; failed: number }> | null;
  enrollmentBreakdown: Record<string, number> | null;
  targetDate: string | null;
  durationMs: number | null;
  startedAt: Date;
  completedAt: Date | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusIcon(status: SyncStatus, size = "w-5 h-5") {
  if (status === "success") return <CheckCircle2 className={`${size} text-emerald-500`} />;
  if (status === "partial") return <AlertCircle className={`${size} text-amber-500`} />;
  if (status === "error") return <XCircle className={`${size} text-red-500`} />;
  return <MinusCircle className={`${size} text-gray-400`} />;
}

function statusBadge(status: SyncStatus) {
  if (status === "success")
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Success</Badge>;
  if (status === "partial")
    return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">Partial</Badge>;
  if (status === "error")
    return <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Error</Badge>;
  return <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs">Skipped</Badge>;
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function timeAgo(date: Date | string): string {
  const d = new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }) + " ET";
}

// ─── Status Card ──────────────────────────────────────────────────────────────

function StatusCard({
  title,
  icon,
  latestRun,
  streak,
  recentRuns,
  schedule,
}: {
  title: string;
  icon: React.ReactNode;
  latestRun: SyncRun | null;
  streak: number;
  recentRuns: (SyncRun | null)[];
  schedule: string;
}) {
  const status = latestRun?.status ?? "skipped";
  const cardBorderColor =
    status === "success"
      ? "border-emerald-200"
      : status === "error"
      ? "border-red-200"
      : status === "partial"
      ? "border-amber-200"
      : "border-gray-200";

  const cardBg =
    status === "success"
      ? "bg-emerald-50/40"
      : status === "error"
      ? "bg-red-50/40"
      : status === "partial"
      ? "bg-amber-50/40"
      : "bg-gray-50/40";

  return (
    <div className={`rounded-xl border-2 ${cardBorderColor} ${cardBg} p-5 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-white rounded-lg shadow-sm border border-gray-100">
            {icon}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
            <p className="text-xs text-gray-500">{schedule}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {latestRun && statusIcon(status)}
          {latestRun ? statusBadge(status) : (
            <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-xs">No runs yet</Badge>
          )}
        </div>
      </div>

      {/* Stats row */}
      {latestRun ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-white rounded-lg p-2.5 border border-gray-100">
            <p className="text-xs text-gray-500 mb-0.5">Last Run</p>
            <p className="text-xs font-semibold text-gray-800">{timeAgo(latestRun.startedAt)}</p>
          </div>
          <div className="bg-white rounded-lg p-2.5 border border-gray-100">
            <p className="text-xs text-gray-500 mb-0.5">Duration</p>
            <p className="text-xs font-semibold text-gray-800">{formatDuration(latestRun.durationMs)}</p>
          </div>
          <div className="bg-white rounded-lg p-2.5 border border-gray-100">
            <p className="text-xs text-gray-500 mb-0.5">Streak</p>
            <p className="text-xs font-semibold text-gray-800">{streak} ✓</p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg p-3 border border-gray-100 text-center">
          <p className="text-xs text-gray-400">Waiting for first run…</p>
        </div>
      )}

      {/* Key metrics */}
      {latestRun && latestRun.runType === "launch27-sync" && (
        <div className="flex gap-2">
          <div className="flex-1 bg-white rounded-lg p-2.5 border border-gray-100 text-center">
            <p className="text-lg font-bold text-emerald-600">{latestRun.recordsInserted ?? 0}</p>
            <p className="text-xs text-gray-500">Inserted</p>
          </div>
          <div className="flex-1 bg-white rounded-lg p-2.5 border border-gray-100 text-center">
            <p className="text-lg font-bold text-gray-500">{latestRun.recordsSkipped ?? 0}</p>
            <p className="text-xs text-gray-500">Skipped</p>
          </div>
          {latestRun.enrollmentBreakdown && Object.keys(latestRun.enrollmentBreakdown).length > 0 && (
            <div className="flex-1 bg-white rounded-lg p-2.5 border border-gray-100 text-center">
              <p className="text-lg font-bold text-blue-600">
                {Object.values(latestRun.enrollmentBreakdown).reduce((a, b) => a + b, 0)}
              </p>
              <p className="text-xs text-gray-500">Enrolled</p>
            </div>
          )}
        </div>
      )}

      {latestRun && latestRun.runType === "always-on-send" && (
        <div className="flex gap-2">
          <div className="flex-1 bg-white rounded-lg p-2.5 border border-gray-100 text-center">
            <p className="text-lg font-bold text-emerald-600">{latestRun.smsSent ?? 0}</p>
            <p className="text-xs text-gray-500">Sent</p>
          </div>
          <div className="flex-1 bg-white rounded-lg p-2.5 border border-gray-100 text-center">
            <p className="text-lg font-bold text-red-500">{latestRun.smsFailed ?? 0}</p>
            <p className="text-xs text-gray-500">Failed</p>
          </div>
          {latestRun.groupBreakdown && (
            <div className="flex-1 bg-white rounded-lg p-2.5 border border-gray-100 text-center">
              <p className="text-lg font-bold text-blue-600">
                {Object.keys(latestRun.groupBreakdown).filter(k => (latestRun.groupBreakdown![k].sent ?? 0) > 0).length}
              </p>
              <p className="text-xs text-gray-500">Groups</p>
            </div>
          )}
        </div>
      )}

      {/* Message */}
      {latestRun?.message && (
        <p className="text-xs text-gray-600 bg-white rounded-lg px-3 py-2 border border-gray-100 leading-relaxed">
          {latestRun.message}
        </p>
      )}

      {/* Error detail */}
      {latestRun?.errorDetail && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100 font-mono leading-relaxed">
          {latestRun.errorDetail}
        </p>
      )}

      {/* Mini sparkline — last 14 runs */}
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-gray-400 shrink-0">Last 14:</p>
        <div className="flex gap-0.5 items-center">
          {recentRuns.slice(0, 14).reverse().map((run, i) => {
            if (!run) return <div key={i} className="w-2 h-2 rounded-sm bg-gray-100" />;
            const color =
              run.status === "success" ? "bg-emerald-400"
              : run.status === "error" ? "bg-red-400"
              : run.status === "partial" ? "bg-amber-400"
              : "bg-gray-300";
            return (
              <div
                key={i}
                className={`w-2 h-4 rounded-sm ${color}`}
                title={`${formatDateTime(run.startedAt)} — ${run.status}`}
              />
            );
          })}
          {recentRuns.length === 0 && (
            <span className="text-xs text-gray-400 italic">No history yet</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Run History Row ──────────────────────────────────────────────────────────

function RunRow({ run }: { run: SyncRun }) {
  const [open, setOpen] = useState(false);
  const hasDetails =
    run.errorDetail ||
    (run.groupBreakdown && Object.keys(run.groupBreakdown).length > 0) ||
    (run.enrollmentBreakdown && Object.keys(run.enrollmentBreakdown).length > 0);

  return (
    <>
      <TableRow
        className={`cursor-pointer hover:bg-gray-50 transition-colors ${hasDetails ? "" : "cursor-default"}`}
        onClick={() => hasDetails && setOpen(!open)}
      >
          <TableCell className="w-8 py-2.5">
            {hasDetails ? (
              open ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
            ) : null}
          </TableCell>
          <TableCell className="py-2.5">
            <div className="flex items-center gap-1.5">
              {run.runType === "launch27-sync" ? (
                <Database className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              ) : (
                <MessageSquare className="w-3.5 h-3.5 text-purple-500 shrink-0" />
              )}
              <span className="text-xs font-medium text-gray-700">
                {run.runType === "launch27-sync" ? "Launch27 Sync" : "Always-On SMS"}
              </span>
            </div>
          </TableCell>
          <TableCell className="py-2.5">{statusBadge(run.status)}</TableCell>
          <TableCell className="py-2.5 text-xs text-gray-600 max-w-xs truncate">
            {run.message ?? "—"}
          </TableCell>
          <TableCell className="py-2.5 text-xs text-gray-500 whitespace-nowrap">
            {formatDateTime(run.startedAt)}
          </TableCell>
          <TableCell className="py-2.5 text-xs text-gray-500 text-right">
            {formatDuration(run.durationMs)}
          </TableCell>
        </TableRow>
      {hasDetails && open && (
          <TableRow className="bg-gray-50 border-t-0">
            <TableCell colSpan={6} className="py-3 px-8">
              <div className="space-y-2">
                {run.errorDetail && (
                  <div>
                    <p className="text-xs font-semibold text-red-600 mb-1">Error Detail</p>
                    <pre className="text-xs text-red-700 bg-red-50 rounded p-2 border border-red-100 whitespace-pre-wrap font-mono">
                      {run.errorDetail}
                    </pre>
                  </div>
                )}
                {run.groupBreakdown && Object.keys(run.groupBreakdown).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1.5">Group Breakdown</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(run.groupBreakdown).map(([group, counts]) => (
                        <div key={group} className="bg-white rounded-lg px-3 py-1.5 border border-gray-200 text-xs">
                          <span className="font-medium text-gray-700 capitalize">{group.replace(/-/g, " ")}</span>
                          <span className="text-gray-400 mx-1">·</span>
                          <span className="text-emerald-600">{counts.sent} sent</span>
                          {counts.failed > 0 && (
                            <>
                              <span className="text-gray-400 mx-1">·</span>
                              <span className="text-red-500">{counts.failed} failed</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {run.enrollmentBreakdown && Object.keys(run.enrollmentBreakdown).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1.5">Always-On Enrollments</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(run.enrollmentBreakdown).map(([group, count]) => (
                        count > 0 && (
                          <div key={group} className="bg-white rounded-lg px-3 py-1.5 border border-gray-200 text-xs">
                            <span className="font-medium text-gray-700 capitalize">{group.replace(/-/g, " ")}</span>
                            <span className="text-gray-400 mx-1">·</span>
                            <span className="text-blue-600">{count} enrolled</span>
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TableCell>
          </TableRow>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SyncHealthPage() {
  const [triggerDate, setTriggerDate] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"all" | "launch27-sync" | "always-on-send">("all");

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = trpc.syncHealth.getSummary.useQuery(undefined, {
    refetchInterval: 60_000, // auto-refresh every minute
  });

  const { data: recentRuns, isLoading: runsLoading, refetch: refetchRuns } = trpc.syncHealth.getRecentRuns.useQuery(
    {
      limit: 50,
      runType: historyFilter === "all" ? undefined : historyFilter,
    },
    { refetchInterval: 60_000 }
  );

  const triggerSync = trpc.syncHealth.triggerSync.useMutation({
    onSuccess: (result) => {
      toast.success(`Sync complete: ${result.inserted} inserted, ${result.skipped} skipped`);
      refetchSummary();
      refetchRuns();
    },
    onError: (err) => {
      toast.error(`Sync failed: ${err.message}`);
    },
  });

  const handleRefresh = () => {
    refetchSummary();
    refetchRuns();
    toast.success("Refreshed");
  };

  const isLoading = summaryLoading || runsLoading;

  return (
    <div className="hj-theme min-h-screen" style={{ backgroundColor: "#F7F7F7" }}>
      <AdminHeader activeTab="always-on" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Page title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Activity className="w-5 h-5 text-[#000000]" />
              Sync Health
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Monitor nightly automation runs — Launch27 import and Always-On SMS sends
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Status cards */}
        {summaryLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-xl border-2 border-gray-200 bg-gray-50 p-5 h-48 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatusCard
              title="Launch27 Nightly Sync"
              icon={<Database className="w-4 h-4 text-blue-600" />}
              latestRun={summary?.launch27 as SyncRun | null ?? null}
              streak={summary?.launch27Streak ?? 0}
              recentRuns={(summary?.launch27Recent ?? []) as (SyncRun | null)[]}
              schedule="Every night at 10 PM ET"
            />
            <StatusCard
              title="Always-On SMS Send"
              icon={<MessageSquare className="w-4 h-4 text-purple-600" />}
              latestRun={summary?.alwaysOn as SyncRun | null ?? null}
              streak={summary?.alwaysOnStreak ?? 0}
              recentRuns={(summary?.alwaysOnRecent ?? []) as (SyncRun | null)[]}
              schedule="Mon–Sat at 10 AM ET"
            />
          </div>
        )}

        {/* Manual trigger */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                <Play className="w-4 h-4 text-[#000000]" />
                Manual Sync Trigger
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Run the Launch27 sync for a specific date. Leave blank to sync yesterday.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={triggerDate}
                onChange={(e) => setTriggerDate(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#000000]/30 focus:border-[#000000]"
                max={new Date().toISOString().slice(0, 10)}
              />
              <Button
                size="sm"
                onClick={() => triggerSync.mutate({ date: triggerDate || undefined })}
                disabled={triggerSync.isPending}
                className="gap-1.5 bg-[#000000] hover:bg-[#333333] text-white"
              >
                {triggerSync.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                {triggerSync.isPending ? "Running…" : "Run Sync"}
              </Button>
            </div>
          </div>
        </div>

        {/* Run history */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-gray-500" />
              Run History
            </h2>
            <div className="flex gap-1">
              {(["all", "launch27-sync", "always-on-send"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setHistoryFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    historyFilter === f
                      ? "bg-[#000000] text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {f === "all" ? "All" : f === "launch27-sync" ? "Sync" : "SMS"}
                </button>
              ))}
            </div>
          </div>

          {runsLoading ? (
            <div className="p-8 text-center text-sm text-gray-400 animate-pulse">Loading run history…</div>
          ) : !recentRuns || recentRuns.length === 0 ? (
            <div className="p-8 text-center">
              <Activity className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No runs recorded yet.</p>
              <p className="text-xs text-gray-400 mt-1">
                Runs will appear here after the first nightly sync or SMS send.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50">
                  <TableHead className="w-8" />
                  <TableHead className="text-xs font-semibold text-gray-600">Job</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600">Status</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600">Summary</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600">Time (ET)</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600 text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recentRuns as SyncRun[]).map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
          <span className="font-medium text-gray-600">Status legend:</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Success — completed without errors</span>
          <span className="flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 text-amber-500" /> Partial — completed with some failures</span>
          <span className="flex items-center gap-1"><XCircle className="w-3.5 h-3.5 text-red-500" /> Error — failed with an exception</span>
          <span className="flex items-center gap-1"><MinusCircle className="w-3.5 h-3.5 text-gray-400" /> Skipped — nothing to do</span>
        </div>
      </main>
    </div>
  );
}
