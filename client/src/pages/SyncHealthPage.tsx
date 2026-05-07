/**
 * SyncHealthPage — Daily automation health monitor for Maids in Black
 *
 * Shows:
 *  - Cron heartbeat panel: last-ran time per job (even no-ops)
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
  Play,
  Heart,
  Timer,
  Zap,
  AlertTriangle,
  Inbox,
  WifiOff,
  ShieldCheck,
  RotateCcw,
  PhoneIncoming,
  List,
} from "lucide-react";
import { toast } from "sonner";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";

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

interface CronHeartbeat {
  jobName: string;
  resultSummary: string | null;
  didWork: number;
  ranAt: Date;
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
  if (d.getTime() === 0) return "Never";
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function formatDateTime(date: Date | string): string {
  const d = new Date(date);
  if (d.getTime() === 0) return "Never";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }) + " ET";
}

// ─── Heartbeat Panel ──────────────────────────────────────────────────────────

const JOB_META: Record<string, { label: string; schedule: string; icon: React.ReactNode }> = {
  "nightly-sync": {
    label: "Launch27 Sync",
    schedule: "12:00 PM ET daily",
    icon: <Database className="w-4 h-4 text-blue-500" />,
  },
  "always-on-send": {
    label: "Always-On SMS",
    schedule: "10 AM ET Mon–Sat",
    icon: <MessageSquare className="w-4 h-4 text-purple-500" />,
  },
  "silence-followup": {
    label: "Silence Follow-Up",
    schedule: "Every 5 minutes",
    icon: <Timer className="w-4 h-4 text-amber-500" />,
  },
  "scheduled-followup": {
    label: "Scheduled Follow-Up",
    schedule: "9 AM ET daily",
    icon: <Zap className="w-4 h-4 text-emerald-500" />,
  },
  "tomorrow-sync": {
    label: "Tomorrow's Schedule",
    schedule: "9 PM ET daily",
    icon: <Database className="w-4 h-4 text-indigo-500" />,
  },
  "today-sync": {
    label: "Today's Schedule",
    schedule: "Every hour 7 AM–8 PM ET",
    icon: <Database className="w-4 h-4 text-teal-500" />,
  },
};

function HeartbeatCard({ hb }: { hb: CronHeartbeat }) {
  const meta = JOB_META[hb.jobName] ?? { label: hb.jobName, schedule: "—", icon: <Activity className="w-4 h-4 text-gray-400" /> };
  const neverRan = new Date(hb.ranAt).getTime() === 0;
  const isRecent = !neverRan && (Date.now() - new Date(hb.ranAt).getTime()) < 10 * 60 * 1000; // within 10 min
  const isStale = !neverRan && (Date.now() - new Date(hb.ranAt).getTime()) > 25 * 60 * 60 * 1000; // > 25 hours (daily jobs)

  let dotColor = "bg-emerald-400";
  if (neverRan) dotColor = "bg-gray-300";
  else if (isStale && hb.jobName !== "silence-followup") dotColor = "bg-amber-400";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gray-50 rounded-lg border border-gray-100">
            {meta.icon}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-800">{meta.label}</p>
            <p className="text-xs text-gray-400">{meta.schedule}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${dotColor} ${isRecent ? "animate-pulse" : ""}`} />
          {neverRan ? (
            <span className="text-xs text-gray-400 font-medium">Never ran</span>
          ) : (
            <span className="text-xs font-semibold text-gray-700">{timeAgo(hb.ranAt)}</span>
          )}
        </div>
      </div>

      {!neverRan && (
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <p className="text-xs text-gray-500 leading-relaxed">
            <span className="font-medium text-gray-600">Last result: </span>
            {hb.resultSummary ?? "—"}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(hb.ranAt)}</p>
        </div>
      )}

      {neverRan && (
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 text-center">
          <p className="text-xs text-gray-400 italic">Waiting for first tick…</p>
        </div>
      )}
    </div>
  );
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
            <p className="text-lg font-bold text-gray-400">{latestRun.recordsSkipped ?? 0}</p>
            <p className="text-xs text-gray-500">Skipped</p>
          </div>
        </div>
      )}

      {latestRun && latestRun.runType === "always-on-send" && (
        <div className="flex gap-2">
          <div className="flex-1 bg-white rounded-lg p-2.5 border border-gray-100 text-center">
            <p className="text-lg font-bold text-purple-600">{latestRun.smsSent ?? 0}</p>
            <p className="text-xs text-gray-500">SMS Sent</p>
          </div>
          <div className="flex-1 bg-white rounded-lg p-2.5 border border-gray-100 text-center">
            <p className="text-lg font-bold text-red-400">{latestRun.smsFailed ?? 0}</p>
            <p className="text-xs text-gray-500">Failed</p>
          </div>
        </div>
      )}

      {/* Message */}
      {latestRun?.message && (
        <p className="text-xs text-gray-500 italic bg-white rounded-lg px-3 py-2 border border-gray-100">
          {latestRun.message}
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

// ─── Silent Sessions Panel ──────────────────────────────────────────────────

type SilentSession = {
  id: number;
  name: string;
  phone: string;
  stage: string;
  totalSent: number;
  totalReceived: number;
  spanDays: number;
  lastActivity: string;
  severity: 'high' | 'medium' | 'low';
};

function SilentSessionsPanel() {
  const [loaded, setLoaded] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<number | null>(null);

  const { data, isLoading, refetch } = trpc.leads.detectSilentSessions.useQuery(undefined, {
    enabled: loaded,
    staleTime: 5 * 60 * 1000,
  });

  const reconcile = trpc.leads.reconcileSessionMessages.useMutation({
    onSuccess: (result, vars) => {
      toast.success(`Reconciled: +${result.added} messages added (total ${result.total})`);
      setReconcilingId(null);
      refetch();
    },
    onError: (err) => {
      toast.error(`Reconcile failed: ${err.message}`);
      setReconcilingId(null);
    },
  });

  const severityColor = (s: string) =>
    s === 'high' ? 'bg-red-100 text-red-700 border-red-200' :
    s === 'medium' ? 'bg-amber-100 text-amber-700 border-amber-200' :
    'bg-gray-100 text-gray-600 border-gray-200';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-red-500" />
          <h2 className="text-sm font-semibold text-gray-900">Webhook Gap Detection</h2>
          <span className="text-xs text-gray-400">Sessions with many outbound messages but very few inbound replies</span>
        </div>
        {!loaded ? (
          <Button size="sm" variant="outline" onClick={() => setLoaded(true)} className="gap-1.5 text-xs">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            Run Detection
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading} className="gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        )}
      </div>

      {!loaded && (
        <div className="px-5 py-8 text-center">
          <Inbox className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Click "Run Detection" to scan all sessions for missing inbound messages.</p>
          <p className="text-xs text-gray-400 mt-1">This scans all sessions — may take a few seconds.</p>
        </div>
      )}

      {loaded && isLoading && (
        <div className="px-5 py-8 text-center">
          <RefreshCw className="w-6 h-6 text-gray-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Scanning sessions…</p>
        </div>
      )}

      {loaded && !isLoading && data && (
        <>
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">{data.total} affected sessions found</span>
            {data.total > 0 && (
              <>
                <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">{data.sessions.filter((s: SilentSession) => s.severity === 'high').length} high</Badge>
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">{data.sessions.filter((s: SilentSession) => s.severity === 'medium').length} medium</Badge>
                <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs">{data.sessions.filter((s: SilentSession) => s.severity === 'low').length} low</Badge>
              </>
            )}
          </div>
          {data.total === 0 ? (
            <div className="px-5 py-8 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600 font-medium">All clear — no webhook gaps detected.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50">
                  <TableHead className="text-xs font-semibold text-gray-600">Client</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600">Phone</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600">Stage</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600 text-center">Sent</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600 text-center">Received</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600 text-center">Span</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600">Last Activity</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600">Severity</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.sessions as SilentSession[]).map((s) => (
                  <TableRow key={s.id} className="hover:bg-gray-50/50">
                    <TableCell className="text-sm font-medium text-gray-900">{s.name || '(no name)'}</TableCell>
                    <TableCell className="text-xs text-gray-500 font-mono">{s.phone}</TableCell>
                    <TableCell className="text-xs text-gray-500">{s.stage}</TableCell>
                    <TableCell className="text-xs text-center font-semibold text-gray-700">{s.totalSent}</TableCell>
                    <TableCell className="text-xs text-center">
                      <span className={`font-semibold ${s.totalReceived === 0 ? 'text-red-600' : 'text-amber-600'}`}>{s.totalReceived}</span>
                    </TableCell>
                    <TableCell className="text-xs text-center text-gray-500">{s.spanDays}d</TableCell>
                    <TableCell className="text-xs text-gray-500">{s.lastActivity}</TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${severityColor(s.severity)}`}>{s.severity}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 px-2.5"
                        disabled={reconcilingId === s.id}
                        onClick={() => {
                          setReconcilingId(s.id);
                          reconcile.mutate({ sessionId: s.id, phone: s.phone });
                        }}
                      >
                        {reconcilingId === s.id ? (
                          <><RefreshCw className="w-3 h-3 animate-spin mr-1" />Syncing…</>
                        ) : (
                          'Reconcile'
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}

// ─── Message Integrity Panel ─────────────────────────────────────────────────

interface IntegrityRow {
  id: number;
  sessionId: number;
  leadName: string | null;
  leadPhone: string;
  dbCount: number;
  openphoneCount: number;
  delta: number;
  checkedAt: number | null;
  firstDetectedAt: number | null;
  reconciled: number;
}

function MessageIntegrityPanel() {
  const [running, setRunning] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<number | null>(null);

  const { data, isLoading, refetch } = trpc.leads.getIntegrityResults.useQuery(undefined, {
    staleTime: 2 * 60 * 1000,
  });

  const runCheck = trpc.leads.runIntegrityCheck.useMutation({
    onMutate: () => setRunning(true),
    onSuccess: (result) => {
      toast.success(`Integrity check done — ${result.checked} checked, ${result.gaps} gaps found`);
      setRunning(false);
      refetch();
    },
    onError: (err) => {
      toast.error(`Check failed: ${err.message}`);
      setRunning(false);
    },
  });

  const reconcile = trpc.leads.reconcileSessionMessages.useMutation({
    onSuccess: (result, vars) => {
      toast.success(`Reconciled: +${result.added} messages added (total ${result.total})`);
      setReconcilingId(null);
      refetch();
    },
    onError: (err) => {
      toast.error(`Reconcile failed: ${err.message}`);
      setReconcilingId(null);
    },
  });

  const rows = (data ?? []) as IntegrityRow[];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-500" />
          <h2 className="text-sm font-semibold text-gray-900">Message Integrity</h2>
          <span className="text-xs text-gray-400">Sessions where OpenPhone has more messages than the DB (last 7 days)</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading} className="gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => runCheck.mutate()} disabled={running} className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white">
            <ShieldCheck className={`w-3.5 h-3.5 ${running ? 'animate-pulse' : ''}`} />
            {running ? 'Checking…' : 'Run Check Now'}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="px-5 py-8 text-center">
          <RefreshCw className="w-6 h-6 text-gray-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Loading integrity results…</p>
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="px-5 py-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600 font-medium">All clear — no message gaps detected.</p>
          <p className="text-xs text-gray-400 mt-1">Run the check to scan sessions active in the last 24 hours.</p>
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">{rows.length} session{rows.length !== 1 ? 's' : ''} with gaps</span>
            <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">{rows.filter(r => r.delta >= 5).length} high (&ge;5 missing)</Badge>
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">{rows.filter(r => r.delta >= 2 && r.delta < 5).length} medium</Badge>
            <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs">{rows.filter(r => r.delta === 1).length} low</Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50">
                <TableHead className="text-xs font-semibold text-gray-600">Client</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600">Phone</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 text-center">DB (7d)</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 text-center">OpenPhone (7d)</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 text-center">Gap</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600">First Detected</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-gray-50/50">
                  <TableCell className="text-sm font-medium text-gray-900">{row.leadName ?? '—'}</TableCell>
                  <TableCell className="text-sm text-gray-600 font-mono">{row.leadPhone}</TableCell>
                  <TableCell className="text-sm text-center text-gray-700">{row.dbCount}</TableCell>
                  <TableCell className="text-sm text-center text-gray-700">{row.openphoneCount}</TableCell>
                  <TableCell className="text-center">
                    <Badge className={`text-xs ${
                      row.delta >= 5 ? 'bg-red-100 text-red-700 border-red-200' :
                      row.delta >= 2 ? 'bg-amber-100 text-amber-700 border-amber-200' :
                      'bg-gray-100 text-gray-600 border-gray-200'
                    }`}>+{row.delta}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {row.firstDetectedAt ? new Date(row.firstDetectedAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reconcilingId === row.sessionId}
                      onClick={() => {
                        setReconcilingId(row.sessionId);
                        reconcile.mutate({ sessionId: row.sessionId, phone: row.leadPhone });
                      }}
                      className="text-xs gap-1"
                    >
                      {reconcilingId === row.sessionId ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      Reconcile
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

// ─── Webhook Event Log Panel ────────────────────────────────────────────────────────────────────────────────────

const EVENT_TYPE_COLORS: Record<string, string> = {
  'message.received': 'bg-blue-100 text-blue-700 border-blue-200',
  'message.delivered': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'message.delivery.updated': 'bg-teal-100 text-teal-700 border-teal-200',
  'call.recording.completed': 'bg-purple-100 text-purple-700 border-purple-200',
  'call.transcript.completed': 'bg-indigo-100 text-indigo-700 border-indigo-200',
  'call.completed': 'bg-gray-100 text-gray-600 border-gray-200',
  'call.ringing': 'bg-amber-100 text-amber-700 border-amber-200',
  'call.answered': 'bg-orange-100 text-orange-700 border-orange-200',
};

interface WebhookEvent {
  id: number;
  source: string;
  eventType: string;
  eventId: string | null;
  fromPhone: string | null;
  toPhone: string | null;
  processed: number;
  processedAt: number | null;
  sessionId: number | null;
  errorMessage: string | null;
  createdAt: Date | string | null;
}

function WebhookEventLogPanel() {
  const [eventTypeFilter, setEventTypeFilter] = useState<string | undefined>(undefined);
  const [replayingId, setReplayingId] = useState<number | null>(null);

  const { data, isLoading, refetch } = trpc.leads.getWebhookEvents.useQuery(
    { limit: 100, eventType: eventTypeFilter },
    { staleTime: 30_000 }
  );

  const replay = trpc.leads.replayWebhookEvent.useMutation({
    onSuccess: (_result, vars) => {
      toast.success(`Event #${vars.eventId} replayed successfully`);
      setReplayingId(null);
      refetch();
    },
    onError: (err, vars) => {
      toast.error(`Replay failed: ${err.message}`);
      setReplayingId(null);
    },
  });

  const events = (data ?? []) as WebhookEvent[];

  const EVENT_TYPES = ['message.received', 'message.delivered', 'call.recording.completed', 'call.transcript.completed', 'call.completed'];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <List className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Webhook Event Log</h2>
          <span className="text-xs text-gray-400">Every raw OpenPhone event, logged before processing</span>
          {events.length > 0 && (
            <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs">{events.length} events</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            <button
              onClick={() => setEventTypeFilter(undefined)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                !eventTypeFilter ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >All</button>
            {EVENT_TYPES.map(et => (
              <button
                key={et}
                onClick={() => setEventTypeFilter(et === eventTypeFilter ? undefined : et)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  eventTypeFilter === et ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >{et.replace('message.', 'msg.').replace('call.', 'call.')}</button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading} className="gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="px-5 py-8 text-center">
          <RefreshCw className="w-6 h-6 text-gray-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Loading webhook events…</p>
        </div>
      )}

      {!isLoading && events.length === 0 && (
        <div className="px-5 py-8 text-center">
          <PhoneIncoming className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-600 font-medium">No webhook events logged yet.</p>
          <p className="text-xs text-gray-400 mt-1">Events will appear here as OpenPhone sends webhooks. The log captures every event before processing.</p>
        </div>
      )}

      {!isLoading && events.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50/50">
              <TableHead className="text-xs font-semibold text-gray-600 w-12">#</TableHead>
              <TableHead className="text-xs font-semibold text-gray-600">Event Type</TableHead>
              <TableHead className="text-xs font-semibold text-gray-600">From</TableHead>
              <TableHead className="text-xs font-semibold text-gray-600">To</TableHead>
              <TableHead className="text-xs font-semibold text-gray-600 text-center">Status</TableHead>
              <TableHead className="text-xs font-semibold text-gray-600">Received</TableHead>
              <TableHead className="text-xs font-semibold text-gray-600 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((ev) => (
              <TableRow key={ev.id} className={`hover:bg-gray-50/50 ${ev.errorMessage ? 'bg-red-50/30' : ''}`}>
                <TableCell className="text-xs text-gray-400 font-mono">{ev.id}</TableCell>
                <TableCell>
                  <Badge className={`text-xs ${EVENT_TYPE_COLORS[ev.eventType] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                    {ev.eventType}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-gray-600 font-mono">{ev.fromPhone ?? '—'}</TableCell>
                <TableCell className="text-xs text-gray-600 font-mono">{ev.toPhone ?? '—'}</TableCell>
                <TableCell className="text-center">
                  {ev.errorMessage ? (
                    <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Error</Badge>
                  ) : ev.processed ? (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Processed</Badge>
                  ) : (
                    <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-xs">Logged</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-gray-500">{ev.createdAt ? timeAgo(ev.createdAt) : '—'}</TableCell>
                <TableCell className="text-right">
                  {ev.eventType === 'message.received' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 px-2.5 gap-1"
                      disabled={replayingId === ev.id}
                      onClick={() => {
                        setReplayingId(ev.id);
                        replay.mutate({ eventId: ev.id });
                      }}
                    >
                      {replayingId === ev.id ? (
                        <><RefreshCw className="w-3 h-3 animate-spin" />Replaying…</>
                      ) : (
                        <><RotateCcw className="w-3 h-3" />Replay</>
                      )}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────────────────────────

export default function SyncHealthPage() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  const [triggerDate, setTriggerDate] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"all" | "launch27-sync" | "always-on-send">("all");

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = trpc.syncHealth.getSummary.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const { data: recentRuns, isLoading: runsLoading, refetch: refetchRuns } = trpc.syncHealth.getRecentRuns.useQuery(
    {
      limit: 50,
      runType: historyFilter === "all" ? undefined : historyFilter,
    },
    { refetchInterval: 60_000 }
  );

  const { data: heartbeats, isLoading: heartbeatsLoading, refetch: refetchHeartbeats } = trpc.syncHealth.getHeartbeats.useQuery(undefined, {
    refetchInterval: 30_000, // refresh every 30s so silence-followup ticks are visible
  });

  const triggerSync = trpc.syncHealth.triggerSync.useMutation({
    onSuccess: (result) => {
      toast.success(`Sync complete: ${result.inserted} inserted, ${result.skipped} skipped`);
      refetchSummary();
      refetchRuns();
      refetchHeartbeats();
    },
    onError: (err) => {
      toast.error(`Sync failed: ${err.message}`);
    },
  });

  const handleRefresh = () => {
    refetchSummary();
    refetchRuns();
    refetchHeartbeats();
    toast.success("Refreshed");
  };

  const isLoading = summaryLoading || runsLoading || heartbeatsLoading;

  return (
    <AdminPageGuard pageId="always-on">
    <div className="hj-theme min-h-screen" style={{ backgroundColor: "#F7F7F7" }}>
      <AdminHeader activeTab="always-on" pagePermissions={pagePermissions} isAdmin={isAdmin} />

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

        {/* ── Cron Heartbeats ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
            <Heart className="w-4 h-4 text-rose-500" />
            <h2 className="text-sm font-semibold text-gray-900">Cron Heartbeats</h2>
            <span className="text-xs text-gray-400 ml-1">— last tick per job, even if nothing was sent</span>
          </div>
          {heartbeatsLoading ? (
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              {[0,1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          ) : (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {(["nightly-sync", "tomorrow-sync", "today-sync", "always-on-send", "silence-followup", "scheduled-followup"]).map((jobName) => {
                const hb = (heartbeats as CronHeartbeat[] | undefined)?.find(h => h.jobName === jobName) ?? {
                  jobName,
                  resultSummary: null,
                  didWork: 0,
                  ranAt: new Date(0),
                };
                return <HeartbeatCard key={jobName} hb={hb} />;
              })}
            </div>
          )}
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
              schedule="Every day at 12:00 PM ET"
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

        {/* ── Silent Sessions Panel ── */}
        <SilentSessionsPanel />
        {/* ── Message Integrity Panel ── */}
        <MessageIntegrityPanel />
        {/* ── Webhook Event Log ── */}
        <WebhookEventLogPanel />
      </main>
    </div>
    </AdminPageGuard>
  );
}
