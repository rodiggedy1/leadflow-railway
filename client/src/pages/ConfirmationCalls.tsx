/**
 * ConfirmationCalls — /admin/confirmation-calls
 *
 * Dispatcher selects a date, checks off jobs, and fires all selected calls
 * with a single "Call All Selected" button. Each card shows inline results
 * (chips, summary, recording) once the call completes.
 *
 * Test mode: enter a phone number override so all calls go to that number.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { Button } from "@/components/ui/button";
import {
  Phone,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  PhoneMissed,
  ChevronDown,
  ChevronUp,
  FlaskConical,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
}

function formatTime(dt: string | null | undefined): string {
  if (!dt) return "—";
  const d = new Date(dt);
  return isNaN(d.getTime()) ? dt : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDuration(s: number | null | undefined): string {
  if (!s) return "";
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CallStatus = "pending" | "fired" | "completed" | "failed" | "no_answer";

type ConfirmationCall = {
  id: number;
  status: CallStatus;
  vapiCallId: string | null;
  recordingUrl: string | null;
  summary: string | null;
  durationSeconds: number | null;
  endedReason: string | null;
  firedAt: number | null;
};

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
  confirmationCall: ConfirmationCall | null;
};

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CallStatus }) {
  const cfg: Record<CallStatus, { label: string; cls: string; icon: React.ReactNode }> = {
    pending:   { label: "Not Called",  cls: "bg-gray-100 text-gray-500",                  icon: <Phone className="w-3 h-3" /> },
    fired:     { label: "Calling…",    cls: "bg-blue-100 text-blue-700 animate-pulse",    icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { label: "Completed",   cls: "bg-emerald-100 text-emerald-700",             icon: <CheckCircle2 className="w-3 h-3" /> },
    failed:    { label: "Failed",      cls: "bg-red-100 text-red-700",                    icon: <XCircle className="w-3 h-3" /> },
    no_answer: { label: "No Answer",   cls: "bg-amber-100 text-amber-700",                icon: <PhoneMissed className="w-3 h-3" /> },
  };
  const { label, cls, icon } = cfg[status] ?? cfg.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {icon}{label}
    </span>
  );
}

// ── Flexibility chips ─────────────────────────────────────────────────────────

function FlexibilityChips({ summary, status }: { summary: string | null | undefined; status: CallStatus }) {
  if (!summary || status === "pending" || status === "fired") return null;
  const s = summary.toLowerCase();

  if (s.includes("cancel") || s.includes("reschedul")) {
    return (
      <div className="flex flex-wrap gap-1 mt-1.5">
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">❌ Cancel/Reschedule</span>
      </div>
    );
  }

  const chips: React.ReactNode[] = [];
  if (s.includes("exact time") || s.includes("exact arrival") || s.includes("specific time")) {
    chips.push(<span key="exact" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">⏰ Exact Time</span>);
  } else if (s.includes("anytime") || s.includes("any time") || s.includes("flexible anytime") || s.includes("very flexible")) {
    chips.push(<span key="flex" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">🟢 Flexible</span>);
  } else if (s.includes("hour") && (s.includes("flexible") || s.includes("ok") || s.includes("fine"))) {
    chips.push(<span key="hour" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">🕐 ~1hr Flex</span>);
  } else if (s.includes("flexible")) {
    chips.push(<span key="flex2" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">🟢 Flexible</span>);
  }
  if (s.includes("lockbox") || s.includes("lock box")) chips.push(<span key="lb" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">🔑 Lockbox</span>);
  if (s.includes("wfh") || s.includes("work from home") || s.includes("will be home")) chips.push(<span key="wfh" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">🏠 WFH</span>);
  if (s.includes("baby") || s.includes("infant") || s.includes("nap")) chips.push(<span key="baby" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-pink-100 text-pink-700 font-medium">👶 Baby Sleeping</span>);
  if (s.includes("dog") || s.includes("pet") || s.includes("cat")) chips.push(<span key="pet" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">🐶 Pet Home</span>);
  if (s.includes("text") || s.includes("sms") || s.includes("message first")) chips.push(<span key="txt" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium">📞 Text First</span>);

  if (chips.length === 0) return null;
  return <div className="flex flex-wrap gap-1 mt-1.5">{chips}</div>;
}

// ── Job card ──────────────────────────────────────────────────────────────────

function JobCard({
  job,
  selected,
  onToggle,
}: {
  job: Job;
  selected: boolean;
  onToggle: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cc = job.confirmationCall;
  const status: CallStatus = cc?.status ?? "pending";
  const hasResult = status !== "pending" && status !== "fired";

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${
        selected ? "border-[#E8735A] ring-1 ring-[#E8735A]/30" : "border-gray-200"
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Checkbox */}
        <div className="flex-shrink-0 pt-0.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(job.id)}
            className="w-4 h-4 rounded accent-[#E8735A] cursor-pointer"
          />
        </div>

        {/* Time + team */}
        <div className="flex-shrink-0 w-16 text-center">
          <div className="text-sm font-bold text-gray-900">{formatTime(job.serviceDateTime)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{job.teamName ?? "—"}</div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-gray-900 text-sm">{job.customerName ?? "Unknown"}</div>
              <div className="text-xs text-gray-500 truncate mt-0.5">{job.jobAddress ?? "—"}</div>
              <div className="text-xs text-gray-400 mt-0.5">{job.serviceType ?? "—"}</div>
            </div>
            <StatusBadge status={status} />
          </div>

          {/* Chips from summary */}
          {cc?.summary && <FlexibilityChips summary={cc.summary} status={status} />}

          {/* Duration + ended reason */}
          {cc && hasResult && (
            <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
              {cc.durationSeconds ? <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDuration(cc.durationSeconds)}</span> : null}
              {cc.endedReason && <span>{cc.endedReason}</span>}
            </div>
          )}

          {/* Expand for summary + recording */}
          {cc && (cc.summary || cc.recordingUrl) && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="mt-1.5 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Hide details" : "Show details"}
            </button>
          )}
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

const TEST_NUMBER = "3029816191"; // override: all calls go here in test mode

export default function ConfirmationCalls() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  const [date, setDate] = useState(todayLocal);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [testMode, setTestMode] = useState(false);
  const [testPhone, setTestPhone] = useState(TEST_NUMBER);
  const [firingIds, setFiringIds] = useState<Set<number>>(new Set());
  const [pollingActive, setPollingActive] = useState(false);

  const { data: jobs, isLoading, refetch, isFetching } = trpc.confirmationCalls.getJobsForDay.useQuery(
    { date },
    {
      staleTime: 20_000,
      refetchInterval: pollingActive ? 6_000 : false,
    }
  );

  // Stop polling once all fired jobs have a terminal status
  useEffect(() => {
    if (!jobs || !pollingActive) return;
    const stillFiring = jobs.some(j => j.confirmationCall?.status === "fired");
    if (!stillFiring) {
      setPollingActive(false);
      setFiringIds(new Set());
    }
  }, [jobs, pollingActive]);

  // Reset selection when date changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [date]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(Array.from(prev));
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!jobs) return;
    const uncalled = jobs.filter(j => !j.confirmationCall || j.confirmationCall.status === "pending");
    setSelectedIds(new Set(uncalled.map(j => j.id)));
  }, [jobs]);

  const clearAll = useCallback(() => setSelectedIds(new Set()), []);

  const placeCall = trpc.confirmationCalls.placeCall.useMutation();

  // Fire all selected calls sequentially with a small delay to avoid rate limits
  const handleCallAll = useCallback(async () => {
    if (!jobs || selectedIds.size === 0) return;
    const toCall = jobs.filter(j => selectedIds.has(j.id));
    if (toCall.length === 0) return;

    const newFiring = new Set(Array.from(firingIds));
    for (const job of toCall) {
      newFiring.add(job.id);
    }
    setFiringIds(newFiring);
    setPollingActive(true);
    setSelectedIds(new Set());

    for (const job of toCall) {
      const phone = testMode
        ? testPhone.replace(/\D/g, "")
        : (job.customerPhone ?? "");
      if (!phone) continue;
      try {
        await placeCall.mutateAsync({
          cleanerJobId: job.id,
          jobDate: date,
          clientName: job.customerName ?? "Client",
          calledPhone: phone,
        });
      } catch (err) {
        console.error(`[ConfirmationCalls] Failed to place call for job ${job.id}:`, err);
      }
      // Small delay between calls
      await new Promise(r => setTimeout(r, 800));
    }
    // Trigger an immediate refresh
    refetch();
  }, [jobs, selectedIds, testMode, testPhone, date, placeCall, firingIds, refetch]);

  const totalJobs = jobs?.length ?? 0;
  const calledCount = jobs?.filter(j => j.confirmationCall && j.confirmationCall.status !== "pending").length ?? 0;
  const pendingJobs = jobs?.filter(j => !j.confirmationCall || j.confirmationCall.status === "pending") ?? [];
  const allPendingSelected = pendingJobs.length > 0 && pendingJobs.every(j => selectedIds.has(j.id));

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
              onClick={() => setDate(d => addDays(d, -1))}
              className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 text-center">
              <div className="font-semibold text-gray-900 text-sm">{formatDisplayDate(date)}</div>
              {date === todayLocal() && <div className="text-xs text-[#E8735A] font-medium">Today</div>}
            </div>
            <button
              onClick={() => setDate(d => addDays(d, 1))}
              className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Test mode toggle */}
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <FlaskConical className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <label className="flex items-center gap-2 cursor-pointer flex-1">
              <input
                type="checkbox"
                checked={testMode}
                onChange={e => setTestMode(e.target.checked)}
                className="w-4 h-4 rounded accent-amber-500"
              />
              <span className="text-sm font-medium text-amber-800">Test mode — redirect all calls to:</span>
            </label>
            <input
              type="tel"
              value={testPhone}
              onChange={e => setTestPhone(e.target.value)}
              disabled={!testMode}
              placeholder="3029816191"
              className="w-36 text-sm border border-amber-300 rounded-lg px-2 py-1 bg-white disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
          </div>

          {/* Stats + bulk actions */}
          {totalJobs > 0 && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <span>{totalJobs} job{totalJobs !== 1 ? "s" : ""}</span>
                <span>•</span>
                <span className="text-emerald-600 font-medium">{calledCount} called</span>
                <span>•</span>
                <span>{totalJobs - calledCount} remaining</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={allPendingSelected ? clearAll : selectAll}
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                >
                  {allPendingSelected ? "Deselect all" : "Select all uncalled"}
                </button>
              </div>
            </div>
          )}

          {/* Call All Selected button */}
          {selectedIds.size > 0 && (
            <div className="sticky top-0 z-10 py-2">
              <Button
                onClick={handleCallAll}
                disabled={placeCall.isPending || pollingActive}
                className="w-full gap-2 bg-[#E8735A] hover:bg-[#d4634c] text-white font-semibold shadow-lg"
                size="lg"
              >
                {placeCall.isPending || pollingActive ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Phone className="w-4 h-4" />
                )}
                {placeCall.isPending || pollingActive
                  ? "Placing calls…"
                  : `Call ${selectedIds.size} selected job${selectedIds.size !== 1 ? "s" : ""}${testMode ? " (TEST)" : ""}`}
              </Button>
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
              {jobs.map(job => (
                <JobCard
                  key={job.id}
                  job={job as Job}
                  selected={selectedIds.has(job.id)}
                  onToggle={toggleSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminPageGuard>
  );
}
