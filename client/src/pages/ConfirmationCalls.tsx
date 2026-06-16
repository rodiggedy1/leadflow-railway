/**
 * ConfirmationCalls — /admin/confirmation-calls
 *
 * Dispatcher selects a date, sees all jobs for that day, and fires
 * AI outbound confirmation calls via VAPI. Each job card shows:
 *   - Client name + phone
 *   - Service time + type
 *   - Team name
 *   - Arrival flexibility chips (populated from call outcome)
 *   - Call status badge
 *   - "Call" button (disabled while a call is in-flight or already fired)
 */
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  PhoneOff,
  PhoneMissed,
  PlayCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function formatTime(serviceDateTime: string | null | undefined): string {
  if (!serviceDateTime) return "—";
  const d = new Date(serviceDateTime);
  if (isNaN(d.getTime())) return serviceDateTime;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

type CallStatus = "pending" | "fired" | "completed" | "failed" | "no_answer";

function StatusBadge({ status }: { status: CallStatus }) {
  const map: Record<CallStatus, { label: string; className: string; icon: React.ReactNode }> = {
    pending:   { label: "Not Called",  className: "bg-gray-100 text-gray-500",    icon: <Phone className="w-3 h-3" /> },
    fired:     { label: "Calling…",    className: "bg-blue-100 text-blue-700 animate-pulse", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { label: "Completed",   className: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 className="w-3 h-3" /> },
    failed:    { label: "Failed",      className: "bg-red-100 text-red-700",      icon: <XCircle className="w-3 h-3" /> },
    no_answer: { label: "No Answer",   className: "bg-amber-100 text-amber-700",  icon: <PhoneMissed className="w-3 h-3" /> },
  };
  const cfg = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.className}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ── Flexibility chips derived from call summary ───────────────────────────────

/**
 * Parses the VAPI call summary to extract flexibility chips.
 * The AI is instructed to note the client's arrival flexibility.
 * We do simple keyword matching on the summary text.
 */
function FlexibilityChips({ summary, status }: { summary: string | null | undefined; status: CallStatus }) {
  if (!summary || status === "pending" || status === "fired") return null;

  const s = summary.toLowerCase();

  // Cancellation / reschedule
  if (s.includes("cancel") || s.includes("reschedul")) {
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
          ❌ Cancel/Reschedule
        </span>
      </div>
    );
  }

  const chips: React.ReactNode[] = [];

  // Arrival flexibility
  if (s.includes("exact time") || s.includes("exact arrival") || s.includes("needs exact") || s.includes("specific time")) {
    chips.push(<span key="exact" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">⏰ Exact Time</span>);
  } else if (s.includes("anytime") || s.includes("any time") || s.includes("very flexible") || s.includes("flexible anytime")) {
    chips.push(<span key="flex" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">🟢 Flexible</span>);
  } else if (s.includes("hour") && (s.includes("flexible") || s.includes("ok") || s.includes("fine"))) {
    chips.push(<span key="hour" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">🕐 ~1hr Flex</span>);
  } else if (s.includes("flexible")) {
    chips.push(<span key="flex2" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">🟢 Flexible</span>);
  }

  // Access method
  if (s.includes("lockbox") || s.includes("lock box")) {
    chips.push(<span key="lockbox" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">🔑 Lockbox</span>);
  }
  if (s.includes("wfh") || s.includes("work from home") || s.includes("home all day") || s.includes("will be home")) {
    chips.push(<span key="wfh" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">🏠 WFH</span>);
  }

  // Special notes
  if (s.includes("baby") || s.includes("infant") || s.includes("nap")) {
    chips.push(<span key="baby" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-pink-100 text-pink-700 font-medium">👶 Baby Sleeping</span>);
  }
  if (s.includes("dog") || s.includes("pet") || s.includes("cat")) {
    chips.push(<span key="pet" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">🐶 Pet Home</span>);
  }
  if (s.includes("text") || s.includes("sms") || s.includes("message first")) {
    chips.push(<span key="text" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium">📞 Text First</span>);
  }

  if (chips.length === 0) return null;
  return <div className="flex flex-wrap gap-1 mt-1">{chips}</div>;
}

// ── Job card ──────────────────────────────────────────────────────────────────

type Job = {
  id: number;
  customerName: string | null;
  customerPhone: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
  serviceType: string | null;
  teamName: string | null;
  bookingStatus: string | null;
  jobStatus: string | null;
  confirmationCall: {
    id: number;
    status: CallStatus;
    vapiCallId: string | null;
    recordingUrl: string | null;
    summary: string | null;
    durationSeconds: number | null;
    endedReason: string | null;
    firedAt: number | null;
  } | null;
};

function JobCard({
  job,
  jobDate,
  onCallPlaced,
}: {
  job: Job;
  jobDate: string;
  onCallPlaced: (jobId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [calling, setCalling] = useState(false);

  const placeCall = trpc.confirmationCalls.placeCall.useMutation({
    onSuccess: () => {
      setCalling(false);
      onCallPlaced(job.id);
    },
    onError: (err) => {
      setCalling(false);
      alert(`Call failed: ${err.message}`);
    },
  });

  const callStatus: CallStatus = job.confirmationCall?.status ?? "pending";
  const hasBeenCalled = callStatus !== "pending";
  const isInFlight = callStatus === "fired" || calling;
  const canCall = !!job.customerPhone && !isInFlight;

  function handleCall() {
    if (!job.customerPhone) return;
    setCalling(true);
    placeCall.mutate({
      cleanerJobId: job.id,
      jobDate,
      clientName: job.customerName ?? "Client",
      calledPhone: job.customerPhone,
    });
  }

  const cc = job.confirmationCall;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Main row */}
      <div className="flex items-start gap-3 p-4">
        {/* Time column */}
        <div className="flex-shrink-0 w-16 text-center">
          <div className="text-sm font-bold text-gray-900">{formatTime(job.serviceDateTime)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{job.teamName ?? "—"}</div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-gray-900 text-sm">{job.customerName ?? "Unknown"}</div>
              <div className="text-xs text-gray-500 mt-0.5 truncate">{job.jobAddress ?? "—"}</div>
              <div className="text-xs text-gray-400 mt-0.5">{job.serviceType ?? "—"}</div>
            </div>
            <StatusBadge status={callStatus} />
          </div>

          {/* Flexibility chips from summary */}
          {cc?.summary && (
            <FlexibilityChips summary={cc.summary} status={callStatus} />
          )}

          {/* Duration + ended reason */}
          {cc && callStatus !== "pending" && (
            <div className="flex items-center gap-2 mt-1.5">
              {cc.durationSeconds ? (
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDuration(cc.durationSeconds)}
                </span>
              ) : null}
              {cc.endedReason && (
                <span className="text-xs text-gray-400">{cc.endedReason}</span>
              )}
            </div>
          )}

          {/* Expand/collapse for summary + recording */}
          {cc && (cc.summary || cc.recordingUrl) && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Hide details" : "Show details"}
            </button>
          )}
        </div>

        {/* Call button */}
        <div className="flex-shrink-0">
          <Button
            size="sm"
            onClick={handleCall}
            disabled={!canCall || calling || placeCall.isPending}
            className={`gap-1.5 text-xs ${
              hasBeenCalled
                ? "bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200"
                : "bg-[#E8735A] hover:bg-[#d4634c] text-white"
            }`}
            variant="ghost"
          >
            {isInFlight ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Phone className="w-3.5 h-3.5" />
            )}
            {isInFlight ? "Calling…" : hasBeenCalled ? "Re-call" : "Call"}
          </Button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && cc && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-2">
          {cc.summary && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Summary</div>
              <p className="text-sm text-gray-700 leading-relaxed">{cc.summary}</p>
            </div>
          )}
          {cc.recordingUrl && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Recording</div>
              <audio controls src={cc.recordingUrl} className="w-full h-8" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConfirmationCalls() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  const [date, setDate] = useState(todayLocal);
  // Track which job IDs need their status polled (fired state)
  const [pollingJobIds, setPollingJobIds] = useState<Set<number>>(new Set());

  const { data: jobs, isLoading, refetch, isFetching } = trpc.confirmationCalls.getJobsForDay.useQuery(
    { date },
    { staleTime: 30_000, refetchInterval: pollingJobIds.size > 0 ? 8_000 : false }
  );

  // When a call is placed, add the job to the polling set
  const handleCallPlaced = useCallback((jobId: number) => {
    setPollingJobIds((prev) => new Set(Array.from(prev).concat(jobId)));
  }, []);

  // Remove jobs from polling set once they leave the "fired" state
  useEffect(() => {
    if (!jobs) return;
    setPollingJobIds((prev) => {
      const next = new Set<number>();
      for (const id of Array.from(prev)) {
        const job = jobs.find((j) => j.id === id);
        if (job?.confirmationCall?.status === "fired") {
          next.add(id); // still in-flight
        }
        // else: completed/failed/no_answer — stop polling
      }
      return next;
    });
  }, [jobs]);

  const totalJobs = jobs?.length ?? 0;
  const calledCount = jobs?.filter((j) => j.confirmationCall && j.confirmationCall.status !== "pending").length ?? 0;

  return (
    <AdminPageGuard pageId="confirmation-calls">
      <div className="min-h-screen" style={{ backgroundColor: "#F7F7F7" }}>
        <AdminHeader
          activeTab="confirmation-calls"
          pagePermissions={pagePermissions}
          isAdmin={isAdmin}
          rightExtra={
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          }
        />

        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          {/* Page header */}
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Phone className="w-5 h-5 text-[#E8735A]" />
              Confirmation Calls
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              AI calls clients to confirm tomorrow's appointments and capture arrival flexibility.
            </p>
          </div>

          {/* Date nav */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDate((d) => addDays(d, -1))}
              className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 text-center">
              <div className="font-semibold text-gray-900 text-sm">{formatDisplayDate(date)}</div>
              {date === todayLocal() && (
                <div className="text-xs text-[#E8735A] font-medium">Today</div>
              )}
            </div>
            <button
              onClick={() => setDate((d) => addDays(d, 1))}
              className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Stats bar */}
          {totalJobs > 0 && (
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>{totalJobs} job{totalJobs !== 1 ? "s" : ""}</span>
              <span>•</span>
              <span className="text-emerald-600 font-medium">{calledCount} called</span>
              <span>•</span>
              <span>{totalJobs - calledCount} remaining</span>
            </div>
          )}

          {/* Job list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : !jobs || jobs.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Phone className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No jobs scheduled for this day.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job as Job}
                  jobDate={date}
                  onCallPlaced={handleCallPlaced}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminPageGuard>
  );
}
