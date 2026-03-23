/**
 * DayBoard — Visual operations timeline for a single service day.
 *
 * Architecture:
 *   - Pure presentational component: receives jobs[] from parent (FieldManagement).
 *   - No tRPC calls inside — data flows down, events flow up.
 *   - Time axis: 7 AM – 9 PM ET (840 minutes). Each minute = 1 unit of board width.
 *   - Cleaner swim lanes: one row per unique cleaner, sorted by first job start time.
 *   - Job blocks: positioned by serviceDateTime, width by estimated duration.
 *   - Now-line: updates every 30 seconds via useEffect interval.
 *   - SMS health strip: one dot per timeline event, positioned on the time axis.
 *   - Detail panel: slide-in sheet on job block click, shows full timeline.
 *
 * Performance:
 *   - useMemo for lane grouping and position calculations (only recomputes on jobs change).
 *   - requestAnimationFrame for now-line position updates.
 *   - No layout thrash: all positions are CSS left/width percentages.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  X,
  Clock,
  MapPin,
  User,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MessageSquare,
  Phone,
  Car,
  Zap,
  Activity,
  ChevronRight,
  Home,
  Loader2,
  Send,
  ChevronDown,
  ChevronUp,
  PlayCircle,
  Mic,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  delayMinutes: number | null;
  issueNote: string | null;
  updatedAt: Date | null;
  stepsFired: number;
  stepsSuccess: number;
  totalSteps: number;
  timeline: TimelineEvent[];
  bookingStatus: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** Board time range: 7 AM to 9 PM ET */
const BOARD_START_HOUR = 7;   // 7 AM
const BOARD_END_HOUR   = 21;  // 9 PM
const BOARD_MINUTES    = (BOARD_END_HOUR - BOARD_START_HOUR) * 60; // 840

/** Hour labels shown on the time axis */
const HOUR_LABELS = Array.from({ length: BOARD_END_HOUR - BOARD_START_HOUR + 1 }, (_, i) => {
  const h = BOARD_START_HOUR + i;
  if (h === 12) return "12 PM";
  if (h < 12)  return `${h} AM`;
  return `${h - 12} PM`;
});

/** Estimated job duration in minutes based on service type + bedrooms */
function estimateDuration(serviceType: string | null, bedrooms: number | null): number {
  const br = bedrooms ?? 2;
  const type = (serviceType ?? "").toLowerCase();
  if (type.includes("deep") || type.includes("move"))  return Math.max(120, 60 + br * 45);
  if (type.includes("standard") || type.includes("recurring")) return Math.max(90, 45 + br * 30);
  return 90 + br * 20; // fallback
}

/** Parse serviceDateTime string ("2026-03-23 14:00:00") to ET minutes-from-board-start */
function parseToMinutes(serviceDateTime: string | null): number | null {
  if (!serviceDateTime) return null;
  try {
    // Parse ISO 8601 (e.g. "2026-03-23T12:30:00Z") and convert to ET
    const date = new Date(serviceDateTime);
    if (isNaN(date.getTime())) return null;
    const etStr = date.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const [h, m] = etStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return (h - BOARD_START_HOUR) * 60 + m;
  } catch {
    return null;
  }
}

/** Current ET time as minutes from board start */
function nowMinutes(): number {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false });
  const [h, m] = etStr.split(":").map(Number);
  return (h - BOARD_START_HOUR) * 60 + m;
}

/** Convert minutes-from-board-start to a percentage of board width */
function toPercent(minutes: number): number {
  return Math.max(0, Math.min(100, (minutes / BOARD_MINUTES) * 100));
}

// ─── Status config ────────────────────────────────────────────────────────────

type StatusConfig = {
  bg: string;
  border: string;
  text: string;
  dot: string;
  label: string;
  icon: React.ReactNode;
  pulse?: boolean;
  /** Tailwind classes for the pill badge inside the job block */
  badgeClass: string;
};

const STATUS_CONFIG: Record<string, StatusConfig> = {
  not_started: {
    bg: "bg-slate-100",
    border: "border-slate-300",
    text: "text-slate-600",
    dot: "bg-slate-400",
    label: "Not Started",
    icon: <Clock className="w-3 h-3" />,
    badgeClass: "bg-slate-200 text-slate-600",
  },
  on_the_way: {
    bg: "bg-blue-50",
    border: "border-blue-300",
    text: "text-blue-700",
    dot: "bg-blue-500",
    label: "On the Way",
    icon: <Car className="w-3 h-3" />,
    pulse: true,
    badgeClass: "bg-blue-100 text-blue-700",
  },
  in_progress: {
    bg: "bg-emerald-50",
    border: "border-emerald-400",
    text: "text-emerald-800",
    dot: "bg-emerald-500",
    label: "In Progress",
    icon: <Zap className="w-3 h-3" />,
    pulse: true,
    badgeClass: "bg-emerald-100 text-emerald-700",
  },
  running_late: {
    bg: "bg-amber-50",
    border: "border-amber-400",
    text: "text-amber-800",
    dot: "bg-amber-500",
    label: "Running Late",
    icon: <AlertTriangle className="w-3 h-3" />,
    pulse: true,
    badgeClass: "bg-amber-100 text-amber-700",
  },
  issue_at_property: {
    bg: "bg-rose-50",
    border: "border-rose-400",
    text: "text-rose-800",
    dot: "bg-rose-500",
    label: "Issue",
    icon: <XCircle className="w-3 h-3" />,
    pulse: true,
    badgeClass: "bg-rose-100 text-rose-700",
  },
  completed: {
    bg: "bg-green-50",
    border: "border-green-300",
    text: "text-green-800",
    dot: "bg-green-500",
    label: "Completed",
    icon: <CheckCircle2 className="w-3 h-3" />,
    badgeClass: "bg-green-100 text-green-700",
  },
  no_show: {
    bg: "bg-rose-50",
    border: "border-rose-300",
    text: "text-rose-700",
    dot: "bg-rose-400",
    label: "No Show",
    icon: <XCircle className="w-3 h-3" />,
    badgeClass: "bg-rose-100 text-rose-600",
  },
};

function getStatusConfig(status: string | null): StatusConfig {
  return STATUS_CONFIG[status ?? "not_started"] ?? STATUS_CONFIG.not_started;
}

// ─── SMS health dot config ────────────────────────────────────────────────────

const SMS_DOT_CONFIG: Record<string, { color: string; label: string }> = {
  sent:    { color: "bg-emerald-500", label: "Sent" },
  failed:  { color: "bg-rose-500",    label: "Failed" },
  pending: { color: "bg-amber-400",   label: "Pending" },
  skipped: { color: "bg-slate-300",   label: "Skipped" },
};

// ─── Timeline event icon helper ───────────────────────────────────────────────

function eventIcon(type: string) {
  switch (type) {
    case "sms":           return <MessageSquare className="w-3.5 h-3.5" />;
    case "call":          return <Phone className="w-3.5 h-3.5" />;
    case "status_change": return <Activity className="w-3.5 h-3.5" />;
    default:              return <Zap className="w-3.5 h-3.5" />;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Thin vertical "now" line that tracks current ET time */
function NowLine({ boardDate }: { boardDate: string }) {
  const [pos, setPos] = useState<number | null>(null);

  useEffect(() => {
    const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (boardDate !== todayET) { setPos(null); return; }

    const update = () => {
      const m = nowMinutes();
      if (m < 0 || m > BOARD_MINUTES) { setPos(null); return; }
      setPos(toPercent(m));
    };

    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [boardDate]);

  if (pos === null) return null;

  return (
    <div
      className="absolute top-0 bottom-0 z-20 pointer-events-none"
      style={{ left: `${pos}%` }}
    >
      {/* Needle */}
      <div className="absolute top-0 w-px h-full bg-rose-500 opacity-80" />
      {/* Top cap */}
      <div className="absolute -top-1 -translate-x-1/2 w-2 h-2 rounded-full bg-rose-500 shadow-sm" />
    </div>
  );
}

/** A single job block on the swim lane */
function JobBlock({
  job,
  onClick,
  isSelected,
}: {
  job: Job;
  onClick: (job: Job) => void;
  isSelected: boolean;
}) {
  const startMin = parseToMinutes(job.serviceDateTime);
  if (startMin === null || startMin > BOARD_MINUTES || startMin < -30) return null;

  const duration = estimateDuration(job.serviceType, job.bedrooms);
  const clampedStart = Math.max(0, startMin);
  const clampedEnd   = Math.min(BOARD_MINUTES, startMin + duration);
  const widthPct  = toPercent(clampedEnd - clampedStart);
  const leftPct   = toPercent(clampedStart);

  const sc = getStatusConfig(job.jobStatus);
  const hasIssue = job.jobStatus === "issue_at_property" || job.jobStatus === "no_show";
  const isActive = job.jobStatus === "in_progress" || job.jobStatus === "on_the_way" || job.jobStatus === "running_late";

  const smsHealth = job.stepsSuccess / Math.max(job.totalSteps, 1);
  const smsColor = smsHealth >= 0.8 ? "bg-emerald-400" : smsHealth >= 0.4 ? "bg-amber-400" : "bg-rose-400";

  const shortName = (job.customerName ?? "Client").split(" ")[0];
  const shortAddr = (job.jobAddress ?? "").split(",")[0];

  return (
    <button
      onClick={() => onClick(job)}
      className={`
        absolute top-1 bottom-1 rounded-lg border transition-all duration-150 text-left overflow-hidden
        focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-blue-500
        ${sc.bg} ${sc.border} ${sc.text}
        ${isSelected ? "ring-2 ring-blue-500 ring-offset-1 shadow-md z-10" : "hover:shadow-md hover:z-10 hover:-translate-y-px"}
        ${isActive && sc.pulse ? "shadow-sm" : ""}
        ${hasIssue ? "animate-pulse-slow" : ""}
      `}
      style={{ left: `${leftPct}%`, width: `calc(${widthPct}% - 4px)`, minWidth: "48px" }}
      title={`${job.customerName} — ${job.jobAddress}`}
    >
      {/* Active pulse ring */}
      {isActive && (
        <span className="absolute inset-0 rounded-lg ring-1 ring-inset ring-current opacity-20 animate-ping pointer-events-none" />
      )}

      {/* SMS health bar at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/5">
        <div
          className={`h-full ${smsColor} transition-all duration-500`}
          style={{ width: `${smsHealth * 100}%` }}
        />
      </div>

      {/* Three-zone layout: name (top) → address (middle) → badge (bottom-pinned) */}
      <div className="absolute inset-0 flex flex-col px-2 pt-1.5 pb-1 overflow-hidden">
        {/* Zone 1: Customer name + status icon */}
        <div className="flex items-center gap-1 min-w-0 shrink-0">
          <span className="shrink-0 opacity-60">{sc.icon}</span>
          <span className="text-xs font-semibold truncate leading-tight">{shortName}</span>
        </div>
        {/* Zone 2: Address — only when block is wide enough, fills remaining space */}
        {widthPct > 8 && (
          <span className="text-[10px] opacity-55 truncate leading-tight mt-0.5 shrink-0">{shortAddr}</span>
        )}
        {/* Zone 3: Status badge — spacer pushes it to the bottom */}
        <div className="flex-1" />
        {widthPct > 12 && (
          <span
            className={`inline-flex items-center self-start gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide shrink-0 ${sc.badgeClass}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} shrink-0`} />
            {sc.label}
          </span>
        )}
      </div>
    </button>
  );
}

/** One cleaner swim lane row */
function SwimLane({
  cleanerName,
  jobs,
  selectedJobId,
  onJobClick,
}: {
  cleanerName: string;
  jobs: Job[];
  selectedJobId: number | null;
  onJobClick: (job: Job) => void;
}) {
  return (
    <div className="flex items-stretch border-b border-slate-100 last:border-b-0 group">
      {/* Lane label */}
      <div className="w-28 shrink-0 flex items-center px-3 py-2 border-r border-slate-100 bg-white group-hover:bg-slate-50/50 transition-colors">
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-semibold text-slate-700 truncate leading-tight">{cleanerName}</span>
          <span className="text-[10px] text-slate-400 leading-tight">{jobs.length} job{jobs.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Timeline area */}
      <div className="flex-1 relative" style={{ height: "72px" }}>
        {/* Hour grid lines */}
        {HOUR_LABELS.map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-slate-100"
            style={{ left: `${(i / (HOUR_LABELS.length - 1)) * 100}%` }}
          />
        ))}

        {jobs.map((job) => (
          <JobBlock
            key={job.id}
            job={job}
            onClick={onJobClick}
            isSelected={selectedJobId === job.id}
          />
        ))}
      </div>
    </div>
  );
}

/** SMS health strip — one dot per timeline event across all jobs */
function SmsHealthStrip({ jobs }: { jobs: Job[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  const dots = useMemo(() => {
    const result: Array<{
      id: string;
      leftPct: number;
      status: string;
      label: string;
      detail: string;
    }> = [];

    for (const job of jobs) {
      for (const event of job.timeline) {
        if (!event.timestamp) continue;
        const at = event.timestamp;
        const etStr = new Date(at).toLocaleString("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        const etTime = new Date(at).toLocaleString("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "numeric",
          hour12: false,
        });
        const [h, m] = etTime.split(":").map(Number);
        const minutes = (h - BOARD_START_HOUR) * 60 + m;
        if (minutes < 0 || minutes > BOARD_MINUTES) continue;

        result.push({
          id: `${job.id}-${event.step}`,
          leftPct: toPercent(minutes),
          status: event.status,
          label: event.label,
          detail: `${job.customerName ?? "Client"} · ${etStr}`,
        });
      }
    }
    return result;
  }, [jobs]);

  if (dots.length === 0) return null;

  return (
    <div className="relative mt-3 px-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">SMS Activity</span>
        <div className="flex items-center gap-2 ml-auto">
          {Object.entries(SMS_DOT_CONFIG).map(([status, cfg]) => (
            <div key={status} className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${cfg.color}`} />
              <span className="text-[10px] text-slate-400">{cfg.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Strip */}
      <div className="relative h-8 bg-slate-50 border border-slate-100 rounded-lg overflow-visible">
        {/* Hour grid */}
        {HOUR_LABELS.map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-slate-100"
            style={{ left: `${(i / (HOUR_LABELS.length - 1)) * 100}%` }}
          />
        ))}

        {dots.map((dot) => {
          const cfg = SMS_DOT_CONFIG[dot.status] ?? SMS_DOT_CONFIG.skipped;
          return (
            <button
              key={dot.id}
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full ${cfg.color} hover:scale-150 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
              style={{ left: `${dot.leftPct}%` }}
              onMouseEnter={(e) => {
                const rect = (e.target as HTMLElement).getBoundingClientRect();
                setTooltip({ x: rect.left + rect.width / 2, y: rect.top - 8, text: `${dot.label} · ${dot.detail}` });
              }}
              onMouseLeave={() => setTooltip(null)}
              title={`${dot.label} · ${dot.detail}`}
            />
          );
        })}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-slate-900 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-xl -translate-x-1/2 -translate-y-full whitespace-nowrap"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

// ─── Field mgmt call outcome colours (mirrors AllCalls.tsx) ─────────────────
const FM_CALL_OUTCOME_COLORS: Record<string, string> = {
  answered:  "bg-emerald-100 text-emerald-700",
  voicemail: "bg-blue-100 text-blue-700",
  no_answer: "bg-gray-100 text-gray-500",
};

function formatDurationFM(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Slide-in detail panel for a selected job */
function DetailPanel({ job, onClose, onConfirmAssignment }: { job: Job; onClose: () => void; onConfirmAssignment?: (jobId: number) => void }) {
  const sc = getStatusConfig(job.jobStatus);
  const [activeTab, setActiveTab] = useState<"timeline" | "messages" | "calls">("timeline");
  const [replyBody, setReplyBody] = useState("");
  const [replyTo, setReplyTo] = useState<"client" | "cleaner">("client");
  const [transcriptOpen, setTranscriptOpen] = useState<Record<number, boolean>>({});

  // Fetch messages and calls only when those tabs are active
  const { data: messages, isLoading: messagesLoading, refetch: refetchMessages } = trpc.fieldMgmt.getJobMessages.useQuery(
    { cleanerJobId: job.id },
    { enabled: activeTab === "messages" }
  );
  const { data: calls, isLoading: callsLoading } = trpc.fieldMgmt.getJobCalls.useQuery(
    { cleanerJobId: job.id },
    { enabled: activeTab === "calls" }
  );

  const sendSms = trpc.fieldMgmt.sendJobSms.useMutation({
    onSuccess: () => {
      setReplyBody("");
      void refetchMessages();
    },
  });

  const voiceAlertMutation = trpc.fieldMgmt.voiceAlertCleaner.useMutation({
    onSuccess: () => toast.success("Voice alert call placed to cleaner"),
    onError: (err: { message?: string }) => toast.error(err.message || "Failed to place call"),
  });

  const replyPhone = replyTo === "client" ? (job.customerPhone ?? "") : (job.cleanerPhone ?? "");


  const startTime = job.serviceDateTime
    ? (() => {
        try {
          // Handle both "2026-03-23 09:00:00" and "2026-03-23T09:00:00Z" formats
          const d = new Date(job.serviceDateTime);
          if (!isNaN(d.getTime())) {
            return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
          }
          // Fallback: manual split on space or T
          const timePart = job.serviceDateTime.split(/[ T]/)[1];
          if (!timePart) return "—";
          const [h, m] = timePart.split(":").map(Number);
          if (isNaN(h) || isNaN(m)) return "—";
          const ampm = h >= 12 ? "PM" : "AM";
          const h12 = h % 12 || 12;
          return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
        } catch { return "—"; }
      })()
    : "—";

  const duration = estimateDuration(job.serviceType, job.bedrooms);
  const durationLabel = duration >= 60 ? `${Math.floor(duration / 60)}h ${duration % 60 > 0 ? `${duration % 60}m` : ""}`.trim() : `${duration}m`;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-slate-100 shrink-0">
        <div className="flex-1 min-w-0 pr-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${sc.bg} ${sc.border} ${sc.text}`}>
              {sc.icon}
              {sc.label}
            </span>
          </div>
          <h3 className="text-base font-semibold text-slate-900 truncate">{job.customerName ?? "Client"}</h3>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{job.jobAddress ?? "—"}</p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Meta row */}
      <div className="grid grid-cols-3 gap-px bg-slate-100 border-b border-slate-100 shrink-0">
        {[
          { icon: <Clock className="w-3.5 h-3.5" />, label: "Start", value: startTime },
          { icon: <Home className="w-3.5 h-3.5" />, label: "Duration", value: durationLabel },
          { icon: <User className="w-3.5 h-3.5" />, label: "Cleaner", value: job.cleanerName?.split(" ")[0] ?? "—" },
        ].map(({ icon, label, value }) => (
          <div key={label} className="bg-white px-3 py-2.5 flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-slate-400">{icon}<span className="text-[10px] uppercase tracking-wide font-medium">{label}</span></div>
            <span className="text-sm font-semibold text-slate-800">{value}</span>
          </div>
        ))}
      </div>

      {/* Service info */}
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-500">Service</p>
          <p className="text-sm text-slate-800 font-medium truncate">{job.serviceType ?? "—"}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
          {job.bedrooms != null && <span>{job.bedrooms} BR</span>}
          {job.bathrooms != null && <span>{job.bathrooms} BA</span>}
        </div>
      </div>

      {/* SMS progress */}
      <div className="px-5 py-3 border-b border-slate-100 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-500">SMS Steps</span>
          <span className="text-xs font-semibold text-slate-700">{job.stepsSuccess}/{job.totalSteps}</span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${(job.stepsSuccess / Math.max(job.totalSteps, 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Unconfirmed assignment banner */}
      {job.bookingStatus === "new" && (
        <div className="mx-5 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg shrink-0">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-800">Unconfirmed in Launch27</p>
              <p className="text-[11px] text-amber-700 mt-0.5">Booking status is &ldquo;new&rdquo; — automation may skip this job. Confirm to enable pre-job reminders.</p>
            </div>
          </div>
          {onConfirmAssignment && (
            <button
              onClick={() => onConfirmAssignment(job.id)}
              className="mt-2 w-full text-xs font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg px-3 py-1.5 transition-colors"
            >
              Confirm Assignment
            </button>
          )}
        </div>
      )}

      {/* Issue note */}
      {job.issueNote && (
        <div className="mx-5 mt-3 p-3 bg-rose-50 border border-rose-100 rounded-lg shrink-0">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500 mt-0.5 shrink-0" />
            <p className="text-xs text-rose-700">{job.issueNote}</p>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="px-5 py-3 border-b border-slate-100 shrink-0">
        <button
          onClick={() => voiceAlertMutation.mutate({ cleanerJobId: job.id })}
          disabled={voiceAlertMutation.isPending}
          className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl px-3 py-2 transition-colors disabled:opacity-50"
        >
          {voiceAlertMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Phone className="w-3.5 h-3.5" />
          )}
          Voice Alert Cleaner
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 shrink-0">
        {(["timeline", "messages", "calls"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 text-xs font-semibold capitalize transition-colors ${
              activeTab === tab
                ? "text-slate-900 border-b-2 border-slate-900 -mb-px"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Timeline tab ── */}
        {activeTab === "timeline" && (
          <div className="px-5 py-4">
            {job.timeline.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">No events yet</p>
              </div>
            ) : (
              <div className="space-y-0">
                {job.timeline.map((event, idx) => {
                  const isLast = idx === job.timeline.length - 1;
                  const statusDot =
                    event.status === "sent"    ? "bg-emerald-500" :
                    event.status === "failed"  ? "bg-rose-500" :
                    event.status === "pending" ? "bg-amber-400" :
                    "bg-slate-300";
                  const timeStr = event.timestamp
                    ? new Date(event.timestamp).toLocaleTimeString("en-US", {
                        timeZone: "America/New_York",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })
                    : null;
                  return (
                    <div key={idx} className="flex gap-3 group">
                      <div className="flex flex-col items-center pt-1">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
                        {!isLast && <div className="w-px flex-1 bg-slate-100 mt-1" />}
                      </div>
                      <div className={`flex-1 pb-4 ${isLast ? "pb-0" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-slate-400 shrink-0">{eventIcon(event.type)}</span>
                            <span className="text-xs font-medium text-slate-700 truncate">{event.label}</span>
                          </div>
                          {timeStr && (
                            <span className="text-[10px] text-slate-400 shrink-0 font-mono">{timeStr}</span>
                          )}
                        </div>
                        {event.detail && (
                          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed line-clamp-3">{event.detail}</p>
                        )}
                        {event.status === "failed" && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-600 bg-rose-50 border border-rose-100 rounded-full px-1.5 py-0.5 mt-1">
                            <XCircle className="w-2.5 h-2.5" /> Failed
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Messages tab ── */}
        {activeTab === "messages" && (
          <div className="flex flex-col h-full">
            {/* Thread */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {messagesLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>
              ) : !messages || messages.length === 0 ? (
                <div className="text-center py-8">
                  <MessageSquare className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">No messages yet</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={`${msg.direction}-${msg.id}`}
                    className={`flex ${
                      msg.direction === "outbound" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                        msg.direction === "outbound"
                          ? "bg-slate-900 text-white rounded-br-sm"
                          : "bg-slate-100 text-slate-800 rounded-bl-sm"
                      }`}
                    >
                      <p className="font-medium opacity-60 text-[10px] mb-0.5">
                        {msg.direction === "outbound" ? msg.label.replace(/_/g, " ") : msg.label}
                      </p>
                      <p>{msg.body}</p>
                      <p className={`text-[10px] mt-1 ${
                        msg.direction === "outbound" ? "text-slate-300" : "text-slate-400"
                      }`}>
                        {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("en-US", {
                          hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York"
                        }) : ""}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Reply compose box */}
            <div className="border-t border-slate-100 p-3 shrink-0">
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setReplyTo("client")}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full transition-colors ${
                    replyTo === "client" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  Client
                </button>
                <button
                  onClick={() => setReplyTo("cleaner")}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full transition-colors ${
                    replyTo === "cleaner" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  Cleaner
                </button>
                <span className="text-[10px] text-slate-400 self-center ml-1">
                  {replyTo === "client" ? (job.customerPhone ?? "no phone") : (job.cleanerPhone ?? "no phone on file")}
                </span>
              </div>
              <div className="flex gap-2">
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Type a message..."
                  rows={2}
                  className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <button
                  disabled={!replyBody.trim() || !replyPhone || sendSms.isPending}
                  onClick={() => {
                    if (!replyBody.trim() || !replyPhone) return;
                    sendSms.mutate({ cleanerJobId: job.id, to: replyPhone, body: replyBody.trim() });
                  }}
                  className="shrink-0 w-9 h-9 self-end rounded-xl bg-slate-900 text-white flex items-center justify-center disabled:opacity-40 hover:bg-slate-700 transition-colors"
                >
                  {sendSms.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </button>
              </div>

            </div>
          </div>
        )}

        {/* ── Calls tab ── */}
        {activeTab === "calls" && (
          <div className="px-4 py-3 space-y-3">
            {callsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>
            ) : !calls || calls.length === 0 ? (
              <div className="text-center py-8">
                <Phone className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">No calls recorded for this job</p>
              </div>
            ) : (
              calls.map((call) => {
                const colorClass = FM_CALL_OUTCOME_COLORS[call.outcome ?? "no_answer"] ?? "bg-gray-100 text-gray-600";
                const dur = call.durationSeconds ? formatDurationFM(call.durationSeconds) : null;
                const isOpen = transcriptOpen[call.id] ?? false;
                return (
                  <div key={call.id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                        <Mic className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-slate-800">{call.step?.replace(/_/g, " ") ?? "Call"}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colorClass}`}>
                            {(call.outcome ?? "no_answer").replace(/_/g, " ")}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400">
                          {call.createdAt && (
                            <span>{new Date(call.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                          )}
                          {dur && (
                            <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{dur}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {call.summary && (
                      <p className="text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2 leading-relaxed">{call.summary}</p>
                    )}
                    {call.recordingUrl && (
                      <div className="flex items-center gap-3 rounded-xl px-3 py-2 bg-slate-50 border border-slate-100">
                        <a href={call.recordingUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-slate-700 shrink-0">
                          <PlayCircle className="w-4 h-4" /> Listen
                        </a>
                        <audio src={call.recordingUrl} controls className="flex-1 h-7 min-w-0" />
                      </div>
                    )}
                    {call.transcript && (
                      <div>
                        <button
                          onClick={() => setTranscriptOpen((prev) => ({ ...prev, [call.id]: !isOpen }))}
                          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 font-medium"
                        >
                          {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {isOpen ? "Hide transcript" : "View transcript"}
                        </button>
                        {isOpen && (
                          <div className="mt-1.5 text-[11px] text-slate-500 bg-slate-50 rounded-xl px-3 py-2.5 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                            {call.transcript}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function BoardSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Time axis */}
      <div className="flex ml-28 mb-2 gap-0">
        {HOUR_LABELS.map((_, i) => (
          <div key={i} className="flex-1 h-3 bg-slate-100 rounded" style={{ marginRight: i < HOUR_LABELS.length - 1 ? "2px" : 0 }} />
        ))}
      </div>
      {/* Lanes */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center border-b border-slate-100 py-2 gap-3">
          <div className="w-28 shrink-0 h-8 bg-slate-100 rounded-lg" />
          <div className="flex-1 h-10 bg-slate-100 rounded-lg" style={{ width: `${40 + i * 15}%` }} />
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function BoardEmpty({ date }: { date: string }) {
  const label = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Calendar className="w-8 h-8 text-slate-300" />
      </div>
      <p className="text-sm font-semibold text-slate-600 mb-1">No jobs on {label}</p>
      <p className="text-xs text-slate-400">Jobs will appear here once synced from Launch27.</p>
    </div>
  );
}

// ─── Main DayBoard component ──────────────────────────────────────────────────

export type DayBoardProps = {
  jobs: Job[];
  isLoading: boolean;
  date: string;
  onDateChange: (date: string) => void;
  isFetching?: boolean;
  onConfirmAssignment?: (jobId: number) => void;
};

export default function DayBoard({ jobs, isLoading, date, onDateChange, isFetching, onConfirmAssignment }: DayBoardProps) {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Close panel on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedJob(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleJobClick = useCallback((job: Job) => {
    setSelectedJob((prev) => prev?.id === job.id ? null : job);
  }, []);

  // Split active vs removed jobs
  const activeJobs = useMemo(() => jobs.filter(j => j.bookingStatus !== "rescheduled" && j.bookingStatus !== "cancelled"), [jobs]);
  const removedJobs = useMemo(() => jobs.filter(j => j.bookingStatus === "rescheduled" || j.bookingStatus === "cancelled"), [jobs]);

  // Group active jobs by cleaner, sorted by first job start time
  const lanes = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of activeJobs) {
      const key = job.cleanerName ?? job.teamName ?? "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    }
    // Sort lanes by earliest job start time
    return Array.from(map.entries()).sort(([, aJobs], [, bJobs]) => {
      const aMin = Math.min(...aJobs.map(j => parseToMinutes(j.serviceDateTime) ?? 9999));
      const bMin = Math.min(...bJobs.map(j => parseToMinutes(j.serviceDateTime) ?? 9999));
      return aMin - bMin;
    });
  }, [activeJobs]);

  // Summary stats (active jobs only)
  const stats = useMemo(() => {
    const total = activeJobs.length;
    const active = activeJobs.filter(j => j.jobStatus === "in_progress" || j.jobStatus === "on_the_way").length;
    const issues = activeJobs.filter(j => j.jobStatus === "issue_at_property" || j.jobStatus === "no_show").length;
    const done   = activeJobs.filter(j => j.jobStatus === "completed").length;
    const smsFailed = activeJobs.reduce((acc, j) => acc + j.timeline.filter(e => e.status === "failed").length, 0);
    return { total, active, issues, done, smsFailed };
  }, [activeJobs]);

  return (
    <div className="flex gap-0 h-full">
      {/* ── Board area ── */}
      <div className={`flex-1 min-w-0 transition-all duration-300 ${selectedJob ? "mr-80" : ""}`}>
        {/* Controls */}
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {isFetching && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
          </div>

          {/* Stats pills */}
          {!isLoading && jobs.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <StatPill label="Total" value={stats.total} color="text-slate-600 bg-slate-100" />
              {stats.active > 0  && <StatPill label="Active"  value={stats.active}  color="text-emerald-700 bg-emerald-50 border border-emerald-200" pulse />}
              {stats.issues > 0  && <StatPill label="Issues"  value={stats.issues}  color="text-rose-700 bg-rose-50 border border-rose-200" />}
              {stats.done > 0    && <StatPill label="Done"    value={stats.done}    color="text-slate-500 bg-slate-50 border border-slate-200" />}
              {stats.smsFailed > 0 && <StatPill label="SMS Failed" value={stats.smsFailed} color="text-rose-700 bg-rose-50 border border-rose-200" />}
            </div>
          )}
        </div>

        {isLoading ? (
          <BoardSkeleton />
        ) : jobs.length === 0 ? (
          <BoardEmpty date={date} />
        ) : (
          <>
            {/* Active jobs board */}
            {activeJobs.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" ref={boardRef}>
                {/* Time axis header */}
                <div className="flex border-b border-slate-100 bg-slate-50/80">
                  <div className="w-28 shrink-0 border-r border-slate-100 px-3 py-2">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Cleaner</span>
                  </div>
                  <div className="flex-1 relative">
                    <div className="flex">
                      {HOUR_LABELS.map((label, i) => (
                        <div
                          key={i}
                          className="flex-1 text-[10px] text-slate-400 font-medium py-2 text-center first:text-left first:pl-1 last:text-right last:pr-1"
                        >
                          {label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Swim lanes + now line */}
                <div className="relative">
                  <NowLine boardDate={date} />
                  {lanes.map(([cleanerName, laneJobs]) => (
                    <SwimLane
                      key={cleanerName}
                      cleanerName={cleanerName}
                      jobs={laneJobs}
                      selectedJobId={selectedJob?.id ?? null}
                      onJobClick={handleJobClick}
                    />
                  ))}
                </div>

                {/* SMS health strip */}
                <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50/50">
                  <SmsHealthStrip jobs={activeJobs} />
                </div>
              </div>
            )}

            {/* Removed from schedule section */}
            {removedJobs.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <XCircle className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Removed from Schedule ({removedJobs.length})
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl divide-y divide-slate-100 opacity-70">
                  {removedJobs.map(job => {
                    const isRescheduled = job.bookingStatus === "rescheduled";
                    const startTime = job.serviceDateTime
                      ? (() => {
                          const d = new Date(job.serviceDateTime);
                          return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
                        })()
                      : null;
                    return (
                      <div
                        key={job.id}
                        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-100/60 transition-colors"
                        onClick={() => handleJobClick(job)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-500 line-through truncate">
                              {job.customerName ?? "Client"}
                            </span>
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                              isRescheduled
                                ? "bg-amber-100 text-amber-700 border border-amber-200"
                                : "bg-slate-200 text-slate-500 border border-slate-300"
                            }`}>
                              {isRescheduled ? "Rescheduled" : "Cancelled"}
                            </span>
                          </div>
                          {job.jobAddress && (
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">{job.jobAddress.split(",")[0]}</p>
                          )}
                        </div>
                        {startTime && (
                          <span className="text-[11px] text-slate-400 shrink-0">{startTime}</span>
                        )}
                        <span className="text-[11px] text-slate-400 shrink-0">{job.cleanerName?.split(" ")[0] ?? "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Status legend */}
        {!isLoading && jobs.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mt-3 px-1">
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <span className="text-[10px] text-slate-500">{cfg.label}</span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-400">
              <div className="w-8 h-1 rounded-full bg-gradient-to-r from-emerald-400 to-rose-400" />
              SMS health bar
            </div>
          </div>
        )}
      </div>

      {/* ── Detail panel ── */}
      {selectedJob && (
        <div
          className="fixed right-0 bottom-0 w-80 bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col overflow-hidden"
          style={{ top: "var(--admin-header-height, 120px)", animation: "slideInRight 150ms ease-out" }}
        >
          <DetailPanel job={selectedJob} onClose={() => setSelectedJob(null)} onConfirmAssignment={onConfirmAssignment} />
        </div>
      )}

      {/* Backdrop — click anywhere outside panel to close */}
      {selectedJob && (
        <div
          className="fixed inset-0 bg-black/10 z-40"
          onClick={() => setSelectedJob(null)}
        />
      )}
    </div>
  );
}

// ─── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({ label, value, color, pulse }: { label: string; value: number; color: string; pulse?: boolean }) {
  return (
    <div className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 ${color}`}>
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {value} {label}
    </div>
  );
}

// ─── Missing lucide icon alias ────────────────────────────────────────────────

function Calendar(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
