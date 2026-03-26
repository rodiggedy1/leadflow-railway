/**
 * ControlTowerTab — Ops overview for Field Management.
 *
 * Layout:
 *   - 4 metric cards (live, attention, completed, messages)
 *   - Day board: per-job timeline lanes with event dots
 *   - Right sidebar: attention queue + selected-job detail panel
 *
 * Data: wired to fieldMgmt.getJobsForDay (same query as BoardTab / LogTab).
 * The component maps real DB fields to the display shape used in the prototype.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Filter,
  MapPin,
  MessageSquare,
  Phone,
  ShieldAlert,
  Sparkles,
  Users,
  Car,
  Home,
  BellRing,
  CircleDot,
  PlayCircle,
  TimerReset,
  ArrowRight,
  XCircle,
  ClipboardList,
  Search,
  RefreshCw,
  Loader2,
  Calendar,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type TimelineEvent = {
  id: string;
  logId?: number;
  type: "sms_cleaner" | "sms_client" | "call" | "cs_alert" | "status_change";
  status: "sent" | "failed" | "pending" | "status_change";
  timestamp: Date;
  label: string;
  detail?: string;
  recipient?: string;
  success: boolean;
  errorDetail?: string;
  step?: string;
};

type Job = {
  id: number;
  cleanerName: string | null;
  teamName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  cleanerPhone: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
  serviceType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  jobStatus: string | null;
  bookingStatus: string | null;
  trackerToken: string | null;
  delayMinutes: number | null;
  issueNote: string | null;
  updatedAt: Date;
  createdAt: Date;
  stepsFired: number;
  stepsSuccess: number;
  totalSteps: number;
  timeline: TimelineEvent[];
};

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; tone: string; barColor: string; riskLevel: "high" | "medium" | "low" }> = {
  not_started:       { label: "Scheduled",        tone: "bg-slate-100 text-slate-700 border-slate-200",   barColor: "bg-slate-400",   riskLevel: "low" },
  on_the_way:        { label: "En Route",          tone: "bg-sky-100 text-sky-700 border-sky-200",         barColor: "bg-sky-500",     riskLevel: "low" },
  arrived:           { label: "Arrived",           tone: "bg-indigo-100 text-indigo-700 border-indigo-200",barColor: "bg-indigo-500",  riskLevel: "low" },
  in_progress:       { label: "In Progress",       tone: "bg-violet-100 text-violet-700 border-violet-200",barColor: "bg-violet-500",  riskLevel: "low" },
  running_late:      { label: "Running Late",      tone: "bg-amber-100 text-amber-700 border-amber-200",   barColor: "bg-amber-500",   riskLevel: "medium" },
  completed:         { label: "Completed",         tone: "bg-emerald-100 text-emerald-700 border-emerald-200", barColor: "bg-emerald-500", riskLevel: "low" },
  issue_at_property: { label: "Issue",             tone: "bg-rose-100 text-rose-700 border-rose-200",      barColor: "bg-rose-500",    riskLevel: "high" },
  no_show:           { label: "No Show",           tone: "bg-rose-100 text-rose-700 border-rose-200",      barColor: "bg-rose-500",    riskLevel: "high" },
};

function getStatusCfg(jobStatus: string | null) {
  return STATUS_CONFIG[jobStatus ?? "not_started"] ?? STATUS_CONFIG.not_started;
}

// ── Risk derivation ───────────────────────────────────────────────────────────

function deriveRisk(job: Job): "high" | "medium" | "low" {
  const statusRisk = getStatusCfg(job.jobStatus).riskLevel;
  if (statusRisk === "high") return "high";
  const failedSteps = job.stepsFired - job.stepsSuccess;
  if (failedSteps >= 2 || (job.delayMinutes ?? 0) > 15) return "high";
  if (failedSteps >= 1 || (job.delayMinutes ?? 0) > 5) return "medium";
  return statusRisk;
}

const RISK_CONFIG = {
  high:   { label: "Needs attention", tone: "bg-rose-50 text-rose-700 border-rose-200",   dot: "bg-rose-500" },
  medium: { label: "Watch",           tone: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  low:    { label: "Healthy",         tone: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
};

// ── Time helpers ──────────────────────────────────────────────────────────────

/** Parse "HH:MM AM/PM" or ISO datetime string → minutes since midnight */
function toMinutes(input: string | null | undefined): number {
  if (!input) return 9 * 60; // default 9 AM
  // ISO datetime: "2026-03-23T14:30:00.000Z" or "2026-03-23 14:30:00"
  if (input.includes("T") || (input.includes("-") && input.includes(":"))) {
    const d = new Date(input);
    if (!isNaN(d.getTime())) {
      // Convert UTC to Eastern Time (UTC-4 in EDT, UTC-5 in EST)
      const etOffset = -4; // EDT
      const etHour = (d.getUTCHours() + etOffset + 24) % 24;
      return etHour * 60 + d.getUTCMinutes();
    }
  }
  // "10:30 AM" format
  const parts = input.trim().split(" ");
  const [rawHour, rawMin] = (parts[0] || "9:00").split(":").map(Number);
  const suffix = parts[1] ?? "AM";
  let hour = rawHour;
  if (suffix === "PM" && hour !== 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  return hour * 60 + (rawMin || 0);
}

/** Format a Date or ISO string to "H:MM AM/PM" in Eastern Time */
function formatTime(ts: Date | string | null | undefined): string {
  if (!ts) return "";
  const d = typeof ts === "string" ? new Date(ts) : ts;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

/** Compute left% and width% for a job bar on the 8AM–6PM timeline */
const TIMELINE_START = 8 * 60;
const TIMELINE_END   = 18 * 60;
const TIMELINE_SPAN  = TIMELINE_END - TIMELINE_START;

function barPosition(startMin: number, durationMin: number) {
  const left  = Math.max(0, ((startMin - TIMELINE_START) / TIMELINE_SPAN) * 100);
  const width = Math.max(5, (durationMin / TIMELINE_SPAN) * 100);
  return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` };
}

function eventDotPosition(ts: Date | string | null | undefined): string {
  if (!ts) return "0%";
  const d = typeof ts === "string" ? new Date(ts) : ts;
  if (isNaN(d.getTime())) return "0%";
  const etOffset = -4;
  const etHour = (d.getUTCHours() + etOffset + 24) % 24;
  const mins = etHour * 60 + d.getUTCMinutes();
  const pct = ((mins - TIMELINE_START) / TIMELINE_SPAN) * 100;
  return `${Math.max(0, Math.min(100, pct))}%`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: number; sub: string }) {
  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
            <div className="mt-1 text-sm text-slate-500">{sub}</div>
          </div>
          <div className="rounded-2xl bg-slate-100 p-3">
            <Icon className="h-5 w-5 text-slate-700" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DayLane({ job, selected, onSelect }: { job: Job; selected: boolean; onSelect: (id: number) => void }) {
  const sc = getStatusCfg(job.jobStatus);
  const risk = deriveRisk(job);
  const rc = RISK_CONFIG[risk];
  const failedSteps = job.stepsFired - job.stepsSuccess;

  // Estimate job duration: 2 hours default if no end time available
  const startMin = toMinutes(job.serviceDateTime);
  const durationMin = 120; // 2h default; could be derived from bedrooms/bathrooms
  const pos = barPosition(startMin, durationMin);

  return (
    <button
      onClick={() => onSelect(job.id)}
      className={cn(
        "group relative w-full rounded-3xl border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md",
        selected ? "border-slate-900 shadow-md" : "border-slate-200"
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className={cn("h-2.5 w-2.5 rounded-full", rc.dot)} />
            <span className="font-semibold text-slate-900">{job.teamName ?? job.cleanerName ?? "Unknown"}</span>
            <Badge variant="outline" className={cn("rounded-full text-xs", sc.tone)}>{sc.label}</Badge>
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {job.customerName} · {formatTime(job.serviceDateTime)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-slate-900">{job.cleanerName ?? "—"}</div>
          <div className="text-xs text-slate-500">{job.jobAddress?.split(",")[0] ?? ""}</div>
        </div>
      </div>

      {/* Timeline bar */}
      <div className="relative h-12 rounded-2xl bg-slate-100 overflow-hidden">
        {/* Hour tick marks */}
        {[8,9,10,11,12,13,14,15,16,17].map(h => (
          <div
            key={h}
            className="absolute top-0 bottom-0 w-px bg-slate-200"
            style={{ left: `${((h * 60 - TIMELINE_START) / TIMELINE_SPAN) * 100}%` }}
          />
        ))}
        {/* Job bar */}
        <div
          className={cn("absolute top-2 h-8 rounded-2xl px-2 py-1.5 text-xs font-medium text-white shadow-sm truncate", sc.barColor)}
          style={pos}
        >
          {job.jobAddress?.split(",")[0] ?? job.customerName ?? "Job"}
        </div>
        {/* Event dots */}
        {job.timeline.map((event, idx) => (
          <div
            key={idx}
            className={cn(
              "absolute top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white shadow-sm",
              event.status === "failed"        ? "bg-rose-500"    :
              event.status === "sent"          ? "bg-emerald-500" :
              event.status === "pending"       ? "bg-amber-400"   :
              event.status === "status_change" ? "bg-violet-500"  : "bg-slate-400"
            )}
            style={{ left: eventDotPosition(event.timestamp) }}
            title={`${formatTime(event.timestamp)} — ${event.label}`}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <div className="flex items-center gap-3 text-slate-500">
          <span>{job.stepsSuccess} sent</span>
          <span className={failedSteps > 0 ? "text-rose-600" : "text-slate-400"}>{failedSteps} failed</span>
          <span>{job.stepsSuccess}/{job.totalSteps} steps</span>
        </div>
        <div className={cn("font-medium", risk === "high" ? "text-rose-600" : risk === "medium" ? "text-amber-600" : "text-emerald-600")}>
          {rc.label}
        </div>
      </div>
    </button>
  );
}

// ── Event type styling ────────────────────────────────────────────────────────

const EVENT_STYLE: Record<string, { label: string; chip: string }> = {
  sms_cleaner:   { label: "SMS → Cleaner", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  sms_client:    { label: "SMS → Client",  chip: "bg-sky-50 text-sky-700 border-sky-200" },
  call:          { label: "Call",          chip: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  cs_alert:      { label: "CS Alert",      chip: "bg-rose-50 text-rose-700 border-rose-200" },
  status_change: { label: "Status",        chip: "bg-violet-50 text-violet-700 border-violet-200" },
};

function getEventStyle(type: string) {
  return EVENT_STYLE[type] ?? { label: type, chip: "bg-slate-50 text-slate-700 border-slate-200" };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ControlTowerTab() {
  const today = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD
  }, []);

  const [date, setDate] = useState(today);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  // SMS drawer state
  const [smsDrawer, setSmsDrawer] = useState<{ open: boolean; jobId: number | null; to: string; toName: string; recipientType: "client" | "cleaner" }>({
    open: false, jobId: null, to: "", toName: "", recipientType: "client",
  });
  const [replyBody, setReplyBody] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: jobs = [], isLoading, isFetching, refetch } = trpc.fieldMgmt.getJobsForDay.useQuery(
    { date },
    { staleTime: 30_000, refetchInterval: 60_000, refetchIntervalInBackground: false, retry: false, throwOnError: false }
  );

  const retryMutation = trpc.fieldMgmt.retryStep.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Retry sent to ${result.recipientPhone}`);
      } else {
        toast.error(`Retry failed: ${result.errorDetail ?? "unknown error"}`);
      }
      refetch();
    },
    onError: (err) => toast.error(err.message || "Retry failed"),
  });

  // ── SMS drawer queries ────────────────────────────────────────────────────
  const { data: drawerMessages = [], isLoading: drawerMessagesLoading, refetch: refetchDrawerMessages } = trpc.fieldMgmt.getJobMessages.useQuery(
    { cleanerJobId: smsDrawer.jobId! },
    { enabled: smsDrawer.open && smsDrawer.jobId !== null }
  );

  const sendJobSms = trpc.fieldMgmt.sendJobSms.useMutation({
    onSuccess: () => {
      setReplyBody("");
      void refetchDrawerMessages();
    },
    onError: (err) => toast.error(err.message || "Failed to send"),
  });

  const utils = trpc.useUtils();
  const voiceAlertMutation = trpc.fieldMgmt.voiceAlertCleaner.useMutation({
    onSuccess: () => {
      toast.success("Voice alert call placed to cleaner — recording will appear below once the call ends");
      // Refresh call records after a short delay to pick up the new row
      setTimeout(() => {
        if (selectedJob) utils.fieldMgmt.getJobCalls.invalidate({ cleanerJobId: selectedJob.id });
      }, 3000);
    },
    onError: (err) => toast.error(err.message || "Failed to place call"),
  });

  // Fetch call records for the selected job (includes recording URLs once available)
  // Uses selectedId (state) instead of selectedJob (useMemo below) to avoid hoisting issues
  const { data: jobCalls = [], refetch: refetchJobCalls } = trpc.fieldMgmt.getJobCalls.useQuery(
    { cleanerJobId: selectedId ?? 0 },
    { enabled: selectedId !== null, refetchInterval: 15000 } // poll every 15s so recording appears automatically
  );

  // Auto-scroll messages to bottom
  useEffect(() => {
    if (smsDrawer.open) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [drawerMessages, smsDrawer.open]);

  // ── Derived data ────────────────────────────────────────────────────────────

  // Exclude rescheduled/cancelled from active operations views
  const activeJobs = useMemo(() => jobs.filter(j => j.bookingStatus !== "rescheduled" && j.bookingStatus !== "cancelled"), [jobs]);

  const filteredJobs = useMemo(() => {
    return activeJobs.filter((job) => {
      const text = [job.teamName, job.cleanerName, job.customerName, job.jobAddress].join(" ").toLowerCase();
      const textMatch = text.includes(query.toLowerCase());
      const failedSteps = job.stepsFired - job.stepsSuccess;
      const risk = deriveRisk(job);
      const filterMatch =
        filter === "all"        ? true :
        filter === "attention"  ? (risk === "high" || failedSteps > 0) :
        filter === "en_route"   ? (job.jobStatus === "on_the_way") :
        filter === "in_progress"? (job.jobStatus === "in_progress" || job.jobStatus === "arrived") :
        filter === "completed"  ? (job.jobStatus === "completed") :
        filter === "scheduled"  ? (!job.jobStatus) :
        true;
      return textMatch && filterMatch;
    });
  }, [activeJobs, query, filter]);

  const selectedJob = useMemo(() => {
    if (selectedId !== null) {
      return filteredJobs.find(j => j.id === selectedId) ?? activeJobs.find(j => j.id === selectedId) ?? filteredJobs[0] ?? null;
    }
    return filteredJobs[0] ?? null;
  }, [selectedId, filteredJobs, activeJobs]);

  const totals = useMemo(() => ({
    live:      activeJobs.filter(j => j.jobStatus === "in_progress" || j.jobStatus === "on_the_way" || j.jobStatus === "arrived").length,
    attention: activeJobs.filter(j => deriveRisk(j) === "high").length,
    completed: activeJobs.filter(j => j.jobStatus === "completed").length,
    messages:  activeJobs.reduce((acc, j) => acc + j.stepsSuccess, 0),
  }), [activeJobs]);

  const urgent = useMemo(() =>
    activeJobs
      .filter(j => deriveRisk(j) === "high" || (j.stepsFired - j.stepsSuccess) > 0 || (j.delayMinutes ?? 0) > 5)
      .sort((a, b) => {
        const aFailed = a.stepsFired - a.stepsSuccess;
        const bFailed = b.stepsFired - b.stepsSuccess;
        return (bFailed + (b.delayMinutes ?? 0)) - (aFailed + (a.delayMinutes ?? 0));
      }),
  [activeJobs]);

  const handleSelect = useCallback((id: number) => setSelectedId(id), []);

  // ── First failed step for retry button ─────────────────────────────────────
  const firstFailedEvent = selectedJob?.timeline.find(e => e.status === "failed" && e.logId != null);

  // ── Hour marks for timeline header ─────────────────────────────────────────
  const hourMarks = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-sky-600">
              <Sparkles className="h-4 w-4" />
              Ops Control Tower
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              A visual way to run the day across all cleaning jobs
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Every team on one lane, every automation as a dot, and every problem surfaced before it turns into a bad review.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Date picker */}
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="h-10 rounded-2xl border border-slate-200 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <Button
              variant="outline"
              className="rounded-2xl px-4"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={PlayCircle}  label="Live jobs now"      value={totals.live}      sub="Teams actively driving or cleaning" />
        <MetricCard icon={ShieldAlert} label="Needs attention"    value={totals.attention} sub="Failures, delays, or risky jobs" />
        <MetricCard icon={CheckCircle2}label="Completed today"    value={totals.completed} sub="Finished and ready for follow-up" />
        <MetricCard icon={MessageSquare} label="Messages sent"    value={totals.messages}  sub="All automations delivered today" />
      </div>

      {/* Main grid: day board + sidebar */}
      <div className="grid gap-6 xl:grid-cols-[1.7fr_.9fr]">
        {/* Day board */}
        <Card className="rounded-[32px] border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <CardTitle className="text-xl">Day board</CardTitle>
                <div className="mt-1 text-sm text-slate-500">
                  Every job in one timeline — catch misses, late starts, and communication gaps fast.
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search team, client, address..."
                    className="h-10 rounded-2xl border-slate-200 pl-9 sm:w-64"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    ["all",         "All"],
                    ["attention",   "Needs attention"],
                    ["scheduled",   "Scheduled"],
                    ["en_route",    "En route"],
                    ["in_progress", "In progress"],
                    ["completed",   "Completed"],
                  ] as const).map(([key, label]) => (
                    <Button
                      key={key}
                      variant={filter === key ? "default" : "outline"}
                      size="sm"
                      onClick={() => setFilter(key)}
                      className="rounded-2xl"
                    >
                      <Filter className="mr-1.5 h-3.5 w-3.5" /> {label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredJobs.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
                {jobs.length === 0 ? "No jobs found for this date." : "No jobs match the current filter."}
              </div>
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                {/* Hour header */}
                <div className="mb-3 grid text-xs font-medium text-slate-500" style={{ gridTemplateColumns: `repeat(${hourMarks.length}, 1fr)` }}>
                  {hourMarks.map(h => (
                    <div key={h}>{h <= 12 ? `${h}:00` : `${h - 12}:00`} {h < 12 ? "AM" : "PM"}</div>
                  ))}
                </div>
                <div className="space-y-3">
                  {filteredJobs.map(job => (
                    <DayLane
                      key={job.id}
                      job={job}
                      selected={job.id === selectedJob?.id}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Attention queue */}
          <Card className="rounded-[32px] border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl">Attention queue</CardTitle>
            </CardHeader>
            <CardContent>
              {urgent.length === 0 ? (
                <div className="rounded-2xl bg-emerald-50 p-4 text-center text-sm text-emerald-700">
                  All jobs healthy — nothing needs attention right now.
                </div>
              ) : (
                <div className="space-y-3">
                  {urgent.map(job => {
                    const risk = deriveRisk(job);
                    const rc = RISK_CONFIG[risk];
                    const failedSteps = job.stepsFired - job.stepsSuccess;
                    return (
                      <button
                        key={job.id}
                        onClick={() => handleSelect(job.id)}
                        className={cn(
                          "w-full rounded-3xl border p-4 text-left transition hover:shadow-sm",
                          selectedJob?.id === job.id ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-slate-900">{job.teamName ?? job.cleanerName ?? "Unknown"}</div>
                            <div className="mt-1 text-sm text-slate-500">{job.customerName} · {formatTime(job.serviceDateTime)}</div>
                          </div>
                          <Badge variant="outline" className={cn("rounded-full text-xs shrink-0", rc.tone)}>{rc.label}</Badge>
                        </div>
                        <div className="mt-3 flex items-center gap-3 text-sm">
                          <span className={failedSteps > 0 ? "text-rose-600" : "text-slate-500"}>{failedSteps} failed</span>
                          <span className={(job.delayMinutes ?? 0) > 0 ? "text-amber-600" : "text-slate-500"}>
                            {job.delayMinutes ?? 0} min late
                          </span>
                          {job.issueNote && (
                            <span className="text-slate-500 truncate">{job.issueNote}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Selected job detail */}
          {selectedJob && (
            <Card className="rounded-[32px] border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-xl">Selected job</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Job summary */}
                <div className="rounded-3xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className={cn("h-2.5 w-2.5 rounded-full", RISK_CONFIG[deriveRisk(selectedJob)].dot)} />
                        <div className="text-xl font-semibold text-slate-900">{selectedJob.teamName ?? selectedJob.cleanerName ?? "Unknown"}</div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-500">
                        <div className="flex items-center gap-1.5"><Users className="h-4 w-4" /> {selectedJob.cleanerName ?? "—"}</div>
                        <div className="flex items-center gap-1.5"><Home className="h-4 w-4" /> {selectedJob.customerName ?? "—"}</div>
                        <div className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {selectedJob.jobAddress ?? "—"}</div>
                        <div className="flex items-center gap-1.5"><Clock3 className="h-4 w-4" /> {formatTime(selectedJob.serviceDateTime)}</div>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("rounded-full text-xs shrink-0", getStatusCfg(selectedJob.jobStatus).tone)}>
                      {getStatusCfg(selectedJob.jobStatus).label}
                    </Badge>
                  </div>

                  {/* Stats grid */}
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Progress</div>
                      <div className="mt-1 text-lg font-semibold">{selectedJob.stepsSuccess}/{selectedJob.totalSteps}</div>
                      <Progress className="mt-2 h-2" value={(selectedJob.stepsSuccess / Math.max(selectedJob.totalSteps, 1)) * 100} />
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Failures</div>
                      <div className={cn("mt-1 text-lg font-semibold", (selectedJob.stepsFired - selectedJob.stepsSuccess) > 0 ? "text-rose-600" : "text-slate-900")}>
                        {selectedJob.stepsFired - selectedJob.stepsSuccess}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">SMS/call steps that failed</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Delay</div>
                      <div className={cn("mt-1 text-lg font-semibold", (selectedJob.delayMinutes ?? 0) > 0 ? "text-amber-600" : "text-slate-900")}>
                        {selectedJob.delayMinutes ?? 0}m
                      </div>
                      <div className="mt-1 text-xs text-slate-500">Minutes behind schedule</div>
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="rounded-3xl border border-slate-200 p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-slate-500">Communication + workflow timeline</div>
                      <div className="text-base font-semibold text-slate-900">What happened on this job</div>
                    </div>
                    <div className="text-sm text-slate-500">
                      {selectedJob.stepsSuccess} sent ·{" "}
                      <span className={(selectedJob.stepsFired - selectedJob.stepsSuccess) > 0 ? "text-rose-600" : ""}>
                        {selectedJob.stepsFired - selectedJob.stepsSuccess} failed
                      </span>
                    </div>
                  </div>

                  {selectedJob.timeline.length === 0 ? (
                    <div className="text-sm text-slate-400 text-center py-4">No automation events yet for this job.</div>
                  ) : (
                    <div className="space-y-4 max-h-72 overflow-y-auto">
                      {selectedJob.timeline.map((event, index) => {
                        const es = getEventStyle(event.type);
                        return (
                          <div key={event.id} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className={cn(
                                "mt-1 h-3.5 w-3.5 rounded-full shrink-0",
                                event.status === "failed"        ? "bg-rose-500"    :
                                event.status === "sent"          ? "bg-emerald-500" :
                                event.status === "pending"       ? "bg-amber-400"   :
                                event.status === "status_change" ? "bg-violet-500"  : "bg-slate-400"
                              )} />
                              {index !== selectedJob.timeline.length - 1 && (
                                <div className="mt-1 h-full w-px bg-slate-200" />
                              )}
                            </div>
                            <div className="flex-1 rounded-2xl bg-slate-50 p-3 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className={cn("rounded-full text-xs", es.chip)}>{es.label}</Badge>
                                <span className="font-medium text-slate-900 text-sm">{event.label}</span>
                                <Badge variant="outline" className={cn(
                                  "rounded-full text-xs",
                                  event.status === "failed"        ? "border-rose-200 bg-rose-50 text-rose-700"       :
                                  event.status === "sent"          ? "border-emerald-200 bg-emerald-50 text-emerald-700":
                                  event.status === "pending"       ? "border-amber-200 bg-amber-50 text-amber-700"    :
                                  event.status === "status_change" ? "border-violet-200 bg-violet-50 text-violet-700" :
                                  "border-slate-200 bg-slate-50 text-slate-700"
                                )}>
                                  {event.status}
                                </Badge>
                                <span className="ml-auto text-xs text-slate-500 shrink-0">{formatTime(event.timestamp)}</span>
                              </div>
                              {event.errorDetail && (
                                <div className="mt-1.5 text-xs text-rose-600">{event.errorDetail}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Voice Alert Call Recordings */}
                {jobCalls.length > 0 && (
                  <div className="rounded-3xl border border-slate-200 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-slate-500">Voice alert calls</div>
                        <div className="text-base font-semibold text-slate-900">Call recordings &amp; outcomes</div>
                      </div>
                      <button
                        onClick={() => refetchJobCalls()}
                        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                      >
                        <RefreshCw className="h-3 w-3" /> Refresh
                      </button>
                    </div>
                    <div className="space-y-3">
                      {jobCalls.map((call) => {
                        const outcomeColor =
                          call.outcome === "answered"  ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                          call.outcome === "voicemail" ? "bg-amber-50 border-amber-200 text-amber-700" :
                          call.outcome === "no_answer" ? "bg-rose-50 border-rose-200 text-rose-700" :
                          "bg-slate-50 border-slate-200 text-slate-700";
                        const outcomeIcon =
                          call.outcome === "answered"  ? "✅" :
                          call.outcome === "voicemail" ? "📩" :
                          call.outcome === "no_answer" ? "❌" : "⏳";
                        const durationLabel = call.durationSeconds > 0
                          ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s`
                          : null;
                        const calledAt = call.createdAt ? new Date(call.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "";
                        return (
                          <div key={call.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <Phone className="h-3.5 w-3.5 text-slate-400" />
                              <span className="text-xs font-medium text-slate-700">{call.step === "manual_voice_alert" ? "Manual Voice Alert" : call.step}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${outcomeColor}`}>
                                {outcomeIcon} {call.outcome.replace("_", " ")}
                              </span>
                              {durationLabel && (
                                <span className="text-xs text-slate-400">{durationLabel}</span>
                              )}
                              <span className="ml-auto text-xs text-slate-400">{calledAt}</span>
                            </div>
                            {call.recordingUrl ? (
                              <div className="mt-1">
                                <p className="text-xs text-slate-500 mb-1">Recording</p>
                                <audio
                                  controls
                                  src={call.recordingUrl}
                                  className="w-full h-8"
                                  style={{ borderRadius: "8px" }}
                                />
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 mt-1">
                                <Loader2 className="h-3 w-3 animate-spin text-slate-300" />
                                <span className="text-xs text-slate-400">Recording will appear here once the call ends</span>
                              </div>
                            )}
                            {call.summary && (
                              <div className="mt-2 text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2">
                                <span className="font-medium text-slate-500">Summary: </span>{call.summary}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-3">
                  {selectedJob.customerPhone && (
                    <Button
                      className="h-12 rounded-2xl"
                      onClick={() => window.open(`tel:${selectedJob.customerPhone}`, "_self")}
                    >
                      <Phone className="mr-2 h-4 w-4" /> Call client
                    </Button>
                  )}
                  {selectedJob.customerPhone && (
                    <Button
                      variant="outline"
                      className="h-12 rounded-2xl"
                      onClick={() => setSmsDrawer({ open: true, jobId: selectedJob.id, to: selectedJob.customerPhone!, toName: selectedJob.customerName ?? "Client", recipientType: "client" })}
                    >
                      <MessageSquare className="mr-2 h-4 w-4" /> Text client
                    </Button>
                  )}
                  {selectedJob.cleanerPhone && (
                    <Button
                      variant="outline"
                      className="h-12 rounded-2xl"
                      onClick={() => setSmsDrawer({ open: true, jobId: selectedJob.id, to: selectedJob.cleanerPhone!, toName: selectedJob.cleanerName ?? selectedJob.teamName ?? "Cleaner", recipientType: "cleaner" })}
                    >
                      <MessageSquare className="mr-2 h-4 w-4" /> Text cleaner
                    </Button>
                  )}
                  {firstFailedEvent?.logId != null && (
                    <Button
                      variant="outline"
                      className="h-12 rounded-2xl"
                      disabled={retryMutation.isPending}
                      onClick={() => retryMutation.mutate({ logId: firstFailedEvent.logId! })}
                    >
                      {retryMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <TimerReset className="mr-2 h-4 w-4" />
                      )}
                      Retry failed step
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="h-12 rounded-2xl border-amber-300 text-amber-700 hover:bg-amber-50"
                    disabled={voiceAlertMutation.isPending}
                    onClick={() => voiceAlertMutation.mutate({ cleanerJobId: selectedJob.id })}
                  >
                    {voiceAlertMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Phone className="mr-2 h-4 w-4" />
                    )}
                    Voice Alert Cleaner
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-2xl"
                    onClick={() => refetch()}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Why this works section */}
      <Card className="rounded-[32px] border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Why this works better than a single-job timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl bg-slate-50 p-5">
              <div className="flex items-center gap-2 text-base font-semibold text-slate-900"><CircleDot className="h-4 w-4" /> One lane per team</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">You stop hunting through cards. The whole day becomes scan-friendly, like dispatch software.</p>
            </div>
            <div className="rounded-3xl bg-slate-50 p-5">
              <div className="flex items-center gap-2 text-base font-semibold text-slate-900"><AlertTriangle className="h-4 w-4" /> Failures show as red dots</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">One glance tells you where automations did not fire, where teams are late, and where a bad client experience is forming.</p>
            </div>
            <div className="rounded-3xl bg-slate-50 p-5">
              <div className="flex items-center gap-2 text-base font-semibold text-slate-900"><ArrowRight className="h-4 w-4" /> Click lane → act fast</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">Selecting a lane opens the exact communication trail plus quick buttons to call, resend, or re-run the workflow.</p>
            </div>
          </div>
        </CardContent>
      </Card>
      {/* SMS Chat Drawer */}
      <Sheet open={smsDrawer.open} onOpenChange={(o) => setSmsDrawer(prev => ({ ...prev, open: o }))}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
          <SheetHeader className="px-5 pt-5 pb-3 border-b shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              {smsDrawer.toName}
              <span className="text-sm font-normal text-slate-500">{smsDrawer.to}</span>
            </SheetTitle>
          </SheetHeader>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {drawerMessagesLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            )}
            {!drawerMessagesLoading && drawerMessages.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-8">No messages yet</div>
            )}
            {drawerMessages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                  msg.direction === "outbound"
                    ? "ml-auto bg-slate-900 text-white rounded-br-sm"
                    : "mr-auto bg-slate-100 text-slate-900 rounded-bl-sm"
                )}
              >
                <div>{msg.body}</div>
                <div className={cn("text-xs mt-1", msg.direction === "outbound" ? "text-slate-400" : "text-slate-500")}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {msg.direction === "inbound" && (
                    <span className="ml-1 font-medium">· {msg.phone}</span>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Compose */}
          <div className="px-5 py-4 border-t shrink-0">
            <div className="flex gap-2">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && replyBody.trim()) {
                    e.preventDefault();
                    sendJobSms.mutate({ cleanerJobId: smsDrawer.jobId!, to: smsDrawer.to, body: replyBody.trim() });
                  }
                }}
                placeholder={`Message ${smsDrawer.toName}…`}
                rows={2}
                className="flex-1 resize-none rounded-2xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
              <Button
                className="rounded-2xl px-4 self-end"
                disabled={!replyBody.trim() || sendJobSms.isPending}
                onClick={() => sendJobSms.mutate({ cleanerJobId: smsDrawer.jobId!, to: smsDrawer.to, body: replyBody.trim() })}
              >
                {sendJobSms.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Press Enter to send · Shift+Enter for new line</p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
