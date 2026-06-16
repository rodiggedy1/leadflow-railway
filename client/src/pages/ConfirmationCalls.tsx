/**
 * ConfirmationCalls — /admin/confirmation-calls
 *
 * Two tabs:
 *  • Dispatch — select jobs, fire bulk calls
 *  • Results  — AI-structured outcome cards with always-visible summary + inline audio
 */
import { useState, useEffect, useCallback } from "react";
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
  ClipboardList,
  Send,
  Mic,
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
  aiOutcome: string | null;
  aiFlexibility: string | null;
  aiNotes: string | null;
  aiOutcomeLabel: string | null;
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
    pending:   { label: "Not Called",  cls: "bg-gray-100 text-gray-500",               icon: <Phone className="w-3 h-3" /> },
    fired:     { label: "Calling…",    cls: "bg-blue-100 text-blue-700 animate-pulse", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { label: "Completed",   cls: "bg-emerald-100 text-emerald-700",          icon: <CheckCircle2 className="w-3 h-3" /> },
    failed:    { label: "Failed",      cls: "bg-red-100 text-red-700",                 icon: <XCircle className="w-3 h-3" /> },
    no_answer: { label: "No Answer",   cls: "bg-amber-100 text-amber-700",             icon: <PhoneMissed className="w-3 h-3" /> },
  };
  const { label, cls, icon } = cfg[status] ?? cfg.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {icon}{label}
    </span>
  );
}

// ── AI Outcome badge ──────────────────────────────────────────────────────────

function OutcomeBadge({ outcome, label }: { outcome: string | null; label: string | null }) {
  if (!outcome || !label) return null;
  const cfg: Record<string, { bg: string; text: string; border: string }> = {
    confirmed:  { bg: "bg-emerald-50",  text: "text-emerald-800", border: "border-emerald-200" },
    reschedule: { bg: "bg-amber-50",    text: "text-amber-800",   border: "border-amber-200" },
    cancel:     { bg: "bg-red-50",      text: "text-red-800",     border: "border-red-200" },
    no_answer:  { bg: "bg-gray-50",     text: "text-gray-600",    border: "border-gray-200" },
    voicemail:  { bg: "bg-purple-50",   text: "text-purple-800",  border: "border-purple-200" },
    unknown:    { bg: "bg-gray-50",     text: "text-gray-500",    border: "border-gray-200" },
  };
  const style = cfg[outcome] ?? cfg.unknown;
  return (
    <span className={`inline-flex items-center text-sm font-semibold px-3 py-1 rounded-full border ${style.bg} ${style.text} ${style.border}`}>
      {label}
    </span>
  );
}

// ── AI Chips ──────────────────────────────────────────────────────────────────

function AiChips({ cc }: { cc: ConfirmationCall }) {
  const chips: React.ReactNode[] = [];

  // Flexibility chip — from AI field first, fallback to regex
  const flex = cc.aiFlexibility;
  if (flex === "exact") {
    chips.push(<span key="flex" className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-orange-100 text-orange-800 font-medium border border-orange-200">⏰ Exact Time</span>);
  } else if (flex === "one_hour") {
    chips.push(<span key="flex" className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 font-medium border border-blue-200">🕐 ~1hr Window</span>);
  } else if (flex === "anytime") {
    chips.push(<span key="flex" className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-medium border border-emerald-200">🟢 Flexible</span>);
  }

  // Notes chips — from AI field
  let notes: string[] = [];
  if (cc.aiNotes) {
    try { notes = JSON.parse(cc.aiNotes); } catch { /* ignore */ }
  }

  const noteIconMap: Record<string, string> = {
    "dog": "🐶", "pet": "🐾", "cat": "🐱",
    "lockbox": "🔑", "lock box": "🔑",
    "wfh": "🏠", "work from home": "🏠", "will be home": "🏠",
    "baby": "👶", "infant": "👶", "nap": "👶",
    "text first": "📱", "wants text": "📱", "text before": "📱",
    "gate": "🚪", "gate code": "🚪",
    "alarm": "🔔",
  };

  for (const note of notes) {
    const lower = note.toLowerCase();
    let icon = "📌";
    for (const [key, val] of Object.entries(noteIconMap)) {
      if (lower.includes(key)) { icon = val; break; }
    }
    chips.push(
      <span key={note} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium border border-slate-200">
        {icon} {note}
      </span>
    );
  }

  if (chips.length === 0) return null;
  return <div className="flex flex-wrap gap-1.5">{chips}</div>;
}

// ── Dispatch job card ─────────────────────────────────────────────────────────

function DispatchCard({ job, selected, onToggle }: { job: Job; selected: boolean; onToggle: (id: number) => void }) {
  const cc = job.confirmationCall;
  const status: CallStatus = cc?.status ?? "pending";

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${selected ? "border-[#E8735A] ring-1 ring-[#E8735A]/30" : "border-gray-200"}`}>
      <div className="flex items-center gap-3 p-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(job.id)}
          className="w-4 h-4 rounded accent-[#E8735A] cursor-pointer flex-shrink-0"
        />
        <div className="flex-shrink-0 w-14 text-center">
          <div className="text-sm font-bold text-gray-900">{formatTime(job.serviceDateTime)}</div>
          <div className="text-[10px] text-gray-400 leading-tight">{job.teamName ?? "—"}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 text-sm">{job.customerName ?? "Unknown"}</div>
          <div className="text-xs text-gray-500 truncate">{job.jobAddress ?? "—"}</div>
          <div className="text-xs text-gray-400">{job.serviceType ?? "—"}</div>
        </div>
        <StatusBadge status={status} />
      </div>
    </div>
  );
}

// ── Results card (world-class) ────────────────────────────────────────────────

function ResultCard({ job }: { job: Job }) {
  const cc = job.confirmationCall!;
  const status: CallStatus = cc.status;

  // Outcome color accent for left border
  const accentColor =
    cc.aiOutcome === "confirmed" ? "#10b981" :
    cc.aiOutcome === "reschedule" ? "#f59e0b" :
    cc.aiOutcome === "cancel" ? "#ef4444" :
    cc.aiOutcome === "voicemail" ? "#8b5cf6" :
    status === "no_answer" ? "#9ca3af" :
    status === "failed" ? "#ef4444" :
    "#10b981";

  return (
    <div
      className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
      style={{ borderLeft: `4px solid ${accentColor}` }}
    >
      {/* ── Top row: time/team + name/address + outcome badge ── */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <div className="flex-shrink-0 w-14 text-center">
          <div className="text-sm font-bold text-gray-900">{formatTime(job.serviceDateTime)}</div>
          <div className="text-[10px] text-gray-400 leading-tight mt-0.5">{job.teamName ?? "—"}</div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="font-semibold text-gray-900 text-sm leading-tight">{job.customerName ?? "Unknown"}</div>
              <div className="text-xs text-gray-500 mt-0.5 truncate">{job.jobAddress ?? "—"}</div>
            </div>
            {/* AI outcome label takes priority over generic status badge */}
            {cc.aiOutcomeLabel ? (
              <OutcomeBadge outcome={cc.aiOutcome} label={cc.aiOutcomeLabel} />
            ) : (
              <StatusBadge status={status} />
            )}
          </div>
        </div>
      </div>

      {/* ── AI chips row ── */}
      {(cc.aiFlexibility || cc.aiNotes) && (
        <div className="px-4 pb-3">
          <AiChips cc={cc} />
        </div>
      )}

      {/* ── Summary (always visible) ── */}
      {cc.summary && (
        <div className="px-4 pb-3">
          <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100">
            {cc.summary}
          </p>
        </div>
      )}

      {/* ── Audio player (always visible if recording exists) ── */}
      {cc.recordingUrl && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
            <Mic className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <audio controls src={cc.recordingUrl} className="flex-1 h-7" style={{ minWidth: 0 }} />
            {cc.durationSeconds ? (
              <span className="text-xs text-slate-400 flex-shrink-0 flex items-center gap-1">
                <Clock className="w-3 h-3" />{formatDuration(cc.durationSeconds)}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Footer: duration only (no recording) ── */}
      {!cc.recordingUrl && cc.durationSeconds ? (
        <div className="px-4 pb-3 flex items-center gap-1 text-xs text-gray-400">
          <Clock className="w-3 h-3" />{formatDuration(cc.durationSeconds)}
        </div>
      ) : null}
    </div>
  );
}

// ── Results summary bar ───────────────────────────────────────────────────────

function ResultsSummaryBar({ jobs }: { jobs: Job[] }) {
  const confirmed  = jobs.filter(j => j.confirmationCall?.aiOutcome === "confirmed" || (j.confirmationCall?.status === "completed" && !j.confirmationCall?.aiOutcome)).length;
  const reschedule = jobs.filter(j => j.confirmationCall?.aiOutcome === "reschedule").length;
  const cancel     = jobs.filter(j => j.confirmationCall?.aiOutcome === "cancel").length;
  const noAnswer   = jobs.filter(j => j.confirmationCall?.status === "no_answer").length;
  const inFlight   = jobs.filter(j => j.confirmationCall?.status === "fired").length;
  const failed     = jobs.filter(j => j.confirmationCall?.status === "failed").length;

  const parts: string[] = [];
  if (confirmed)  parts.push(`${confirmed} confirmed`);
  if (reschedule) parts.push(`${reschedule} reschedule`);
  if (cancel)     parts.push(`${cancel} cancel`);
  if (noAnswer)   parts.push(`${noAnswer} no answer`);
  if (failed)     parts.push(`${failed} failed`);
  if (inFlight)   parts.push(`${inFlight} in progress`);

  return (
    <div className="flex gap-2 flex-wrap">
      {confirmed > 0 && (
        <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-sm font-medium border border-emerald-200">
          ✅ {confirmed} Confirmed
        </span>
      )}
      {reschedule > 0 && (
        <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-sm font-medium border border-amber-200">
          🔄 {reschedule} Reschedule
        </span>
      )}
      {cancel > 0 && (
        <span className="px-3 py-1 rounded-full bg-red-100 text-red-800 text-sm font-medium border border-red-200">
          ❌ {cancel} Cancel
        </span>
      )}
      {noAnswer > 0 && (
        <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm font-medium border border-gray-200">
          📵 {noAnswer} No Answer
        </span>
      )}
      {failed > 0 && (
        <span className="px-3 py-1 rounded-full bg-red-50 text-red-700 text-sm font-medium border border-red-200">
          ✗ {failed} Failed
        </span>
      )}
      {inFlight > 0 && (
        <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-sm font-medium border border-blue-200 animate-pulse">
          📞 {inFlight} In Progress
        </span>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConfirmationCalls() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  const [date, setDate] = useState(todayLocal);
  const [activeTab, setActiveTab] = useState<"dispatch" | "results">("dispatch");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pollingActive, setPollingActive] = useState(false);
  const [isFiringBatch, setIsFiringBatch] = useState(false);

  const { data: jobs, isLoading, refetch, isFetching } = trpc.confirmationCalls.getJobsForDay.useQuery(
    { date },
    { staleTime: 20_000, refetchInterval: pollingActive ? 6_000 : false }
  );

  // Stop polling once all in-flight calls settle
  useEffect(() => {
    if (!jobs || !pollingActive) return;
    const stillFiring = jobs.some(j => j.confirmationCall?.status === "fired");
    if (!stillFiring) {
      setPollingActive(false);
      setIsFiringBatch(false);
    }
  }, [jobs, pollingActive]);

  // Reset selection on date change
  useEffect(() => { setSelectedIds(new Set()); }, [date]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(Array.from(prev));
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const pendingJobs = (jobs ?? []).filter(j => !j.confirmationCall || j.confirmationCall.status === "pending");
  const allPendingSelected = pendingJobs.length > 0 && pendingJobs.every(j => selectedIds.has(j.id));

  const selectAll = useCallback(() => setSelectedIds(new Set(pendingJobs.map(j => j.id))), [pendingJobs]);
  const clearAll = useCallback(() => setSelectedIds(new Set()), []);

  const placeCall = trpc.confirmationCalls.placeCall.useMutation();

  const handleCallAll = useCallback(async () => {
    if (!jobs || selectedIds.size === 0) return;
    const toCall = jobs.filter(j => selectedIds.has(j.id));
    if (toCall.length === 0) return;

    setIsFiringBatch(true);
    setPollingActive(true);
    setSelectedIds(new Set());

    for (const job of toCall) {
      const phone = job.customerPhone ?? "";
      if (!phone) continue;
      try {
        await placeCall.mutateAsync({
          cleanerJobId: job.id,
          jobDate: date,
          clientName: job.customerName ?? "Client",
          calledPhone: phone,
        });
      } catch (err) {
        console.error(`[ConfirmationCalls] Failed for job ${job.id}:`, err);
      }
      await new Promise(r => setTimeout(r, 800));
    }
    refetch();
  }, [jobs, selectedIds, date, placeCall, refetch]);

  const calledJobs = (jobs ?? []).filter(j => j.confirmationCall && j.confirmationCall.status !== "pending");
  const totalJobs = jobs?.length ?? 0;
  const calledCount = calledJobs.length;

  return (
    <AdminPageGuard pageId="confirmation-calls">
      <div className="min-h-screen" style={{ backgroundColor: "#F7F7F7" }}>
        <AdminHeader
          activeTab="confirmation-calls"
          pagePermissions={pagePermissions}
          isAdmin={isAdmin}
          rightExtra={
            <button onClick={() => refetch()} disabled={isFetching} className="text-gray-400 hover:text-gray-600 disabled:opacity-40" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          }
        />

        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          {/* Header */}
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Phone className="w-5 h-5 text-[#E8735A]" />
              Confirmation Calls
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">AI calls clients to confirm appointments and capture arrival flexibility.</p>
          </div>

          {/* Date nav */}
          <div className="flex items-center gap-3">
            <button onClick={() => setDate(d => addDays(d, -1))} className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 text-center">
              <div className="font-semibold text-gray-900 text-sm">{formatDisplayDate(date)}</div>
              {date === todayLocal() && <div className="text-xs text-[#E8735A] font-medium">Today</div>}
            </div>
            <button onClick={() => setDate(d => addDays(d, 1))} className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-200 rounded-xl p-1">
            <button
              onClick={() => setActiveTab("dispatch")}
              className={`flex-1 flex items-center justify-center gap-2 text-sm font-medium py-2 rounded-lg transition-all ${
                activeTab === "dispatch" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              Dispatch
              {pendingJobs.length > 0 && (
                <span className="bg-[#E8735A] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {pendingJobs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("results")}
              className={`flex-1 flex items-center justify-center gap-2 text-sm font-medium py-2 rounded-lg transition-all ${
                activeTab === "results" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Results
              {calledCount > 0 && (
                <span className="bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {calledCount}
                </span>
              )}
            </button>
          </div>

          {/* ── DISPATCH TAB ── */}
          {activeTab === "dispatch" && (
            <div className="space-y-4">
              {/* Stats + select all */}
              {totalJobs > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-gray-500">
                    {totalJobs} job{totalJobs !== 1 ? "s" : ""} · <span className="text-emerald-600 font-medium">{calledCount} called</span> · {totalJobs - calledCount} remaining
                  </div>
                  <button
                    onClick={allPendingSelected ? clearAll : selectAll}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    {allPendingSelected ? "Deselect all" : "Select all uncalled"}
                  </button>
                </div>
              )}

              {/* Sticky call button */}
              {selectedIds.size > 0 && (
                <div className="sticky top-0 z-10 py-1">
                  <Button
                    onClick={handleCallAll}
                    disabled={isFiringBatch || pollingActive}
                    className="w-full gap-2 bg-[#E8735A] hover:bg-[#d4634c] text-white font-semibold shadow-lg"
                    size="lg"
                  >
                    {isFiringBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                    {isFiringBatch
                      ? "Placing calls…"
                      : `Call ${selectedIds.size} selected`}
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
                <div className="space-y-2">
                  {jobs.map(job => (
                    <DispatchCard
                      key={job.id}
                      job={job as Job}
                      selected={selectedIds.has(job.id)}
                      onToggle={toggleSelect}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── RESULTS TAB ── */}
          {activeTab === "results" && (
            <div className="space-y-3">
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : calledJobs.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No calls completed yet for this day.</p>
                  <p className="text-xs mt-1">Go to Dispatch to place calls.</p>
                </div>
              ) : (
                <>
                  {/* AI-aware summary bar */}
                  <ResultsSummaryBar jobs={calledJobs} />

                  {/* Result cards */}
                  <div className="space-y-3">
                    {calledJobs.map(job => (
                      <ResultCard key={job.id} job={job as Job} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminPageGuard>
  );
}
