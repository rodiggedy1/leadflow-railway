import { proxyRecordingUrl } from "@/lib/utils";
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  PhoneOff,
  PhoneMissed,
  Voicemail,
  Search,
  ChevronLeft,
  ChevronRight,
  Play,
  FileText,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Calendar,
  User,
  MapPin,
  Clock,
} from "lucide-react";

// ── Step label map ────────────────────────────────────────────────────────────
const STEP_LABELS: Record<string, string> = {
  checkin_call_attempt_1: "Check-In Call #1",
  checkin_call_attempt_2: "Check-In Call #2",
  checkin_call_attempt_3: "Check-In Call #3",
  checkin_call_t30_attempt_1: "T-30 Check-In Call #1",
  checkin_call_t30_attempt_2: "T-30 Check-In Call #2",
  checkin_call_t30_attempt_3: "T-30 Check-In Call #3",
  schedule_escalation: "Schedule Escalation",
  noshow_call: "No-Show CS Call",
  post_start_call_1: "Post-Start Call #1",
  post_start_call_2: "Post-Start Call #2",
  confirmation_call: "Confirmation Call",
  client_status_inquiry: "Client Status Inquiry",
  ai_matrix_customer: "AI Matrix Customer",
  manual_voice_alert: "Manual Voice Alert",
  call_command_center: "Command Center Call",
  client_running_late_call: "Running Late Call",
  exception_call: "Escalation Call",
};

function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? step.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Outcome badge ─────────────────────────────────────────────────────────────
function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === "answered") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        <Phone className="w-3 h-3" /> Answered
      </span>
    );
  }
  if (outcome === "voicemail") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        <Voicemail className="w-3 h-3" /> Voicemail
      </span>
    );
  }
  if (outcome === "no_answer") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        <PhoneMissed className="w-3 h-3" /> No Answer
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
      <PhoneOff className="w-3 h-3" /> {outcome}
    </span>
  );
}

// ── Expandable call card ──────────────────────────────────────────────────────
type CallRow = {
  id: number;
  cleanerJobId: number;
  step: string;
  calledPhone: string;
  outcome: string;
  durationSeconds: number;
  transcript: string | null;
  summary: string | null;
  endedReason: string | null;
  recordingUrl: string | null;
  smsFollowupSent: number;
  smsFollowupBody: string | null;
  smsReply: string | null;
  smsConfirmed: number;
  createdAt: Date;
  customerName: string | null;
  customerPhone: string | null;
  jobAddress: string | null;
  jobDate: string | null;
  serviceDateTime: string | null;
  cleanerName: string | null;
  teamName: string | null;
  serviceType: string | null;
};

function CallCard({ call }: { call: CallRow }) {
  const [expanded, setExpanded] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const time = new Date(call.createdAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
  const date = new Date(call.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });

  const duration = call.durationSeconds > 0
    ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s`
    : null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-gray-300 transition-colors">
      {/* Header row */}
      <button
        className="w-full text-left px-4 py-3 flex items-start gap-3"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Call type icon */}
        <div className="mt-0.5 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
          <Phone className="w-4 h-4 text-slate-500" />
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900">
              {call.customerName ?? call.calledPhone}
            </span>
            <OutcomeBadge outcome={call.outcome} />
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {stepLabel(call.step)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
            {call.jobAddress && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {call.jobAddress}
              </span>
            )}
            {call.cleanerName && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {call.cleanerName}
              </span>
            )}
            {duration && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {duration}
              </span>
            )}
          </div>
        </div>

        {/* Date/time */}
        <div className="text-right shrink-0">
          <div className="text-xs font-medium text-gray-700">{time}</div>
          <div className="text-xs text-gray-400">{date}</div>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3 bg-gray-50">
          {/* Recording */}
          {call.recordingUrl && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1">
                <Play className="w-3 h-3" /> Recording
              </div>
              <audio
                ref={audioRef}
                controls
                src={proxyRecordingUrl(call.recordingUrl)!}
                className="w-full h-9 rounded-lg"
              />
            </div>
          )}

          {/* Summary */}
          {call.summary && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                <FileText className="w-3 h-3" /> Summary
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{call.summary}</p>
            </div>
          )}

          {/* Transcript */}
          {call.transcript && (
            <details className="group">
              <summary className="text-xs font-medium text-gray-500 cursor-pointer flex items-center gap-1 select-none">
                <FileText className="w-3 h-3" /> Full Transcript
                <span className="text-gray-400 ml-1 group-open:hidden">(click to expand)</span>
              </summary>
              <pre className="mt-2 text-xs text-gray-600 whitespace-pre-wrap font-sans leading-relaxed bg-white border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                {call.transcript}
              </pre>
            </details>
          )}

          {/* SMS Followup */}
          {call.smsFollowupSent === 1 && call.smsFollowupBody && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> SMS Followup Sent
              </div>
              <p className="text-sm text-gray-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                {call.smsFollowupBody}
              </p>
              {call.smsReply && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                    {call.smsConfirmed === 1
                      ? <CheckCircle2 className="w-3 h-3 text-green-500" />
                      : <XCircle className="w-3 h-3 text-gray-400" />}
                    Customer Reply {call.smsConfirmed === 1 ? "(Confirmed)" : ""}
                  </div>
                  <p className="text-sm text-gray-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                    {call.smsReply}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Job details row */}
          <div className="flex flex-wrap gap-3 text-xs text-gray-500 pt-1 border-t border-gray-200">
            {call.jobDate && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Job date: {call.jobDate}
              </span>
            )}
            {call.serviceType && (
              <span>Type: {call.serviceType}</span>
            )}
            {call.teamName && (
              <span>Team: {call.teamName}</span>
            )}
            {call.endedReason && (
              <span>Ended: {call.endedReason}</span>
            )}
            <span>Call ID: #{call.id}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CleanerCalls() {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);

  const { data, isLoading } = trpc.fieldMgmt.getCleanerCalls.useQuery(
    {
      search: search || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      pageSize: 50,
    },
    { keepPreviousData: true }
  );

  const calls = data?.calls ?? [];
  const hasMore = data?.hasMore ?? false;

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(0);
  }

  function handleDateFrom(e: React.ChangeEvent<HTMLInputElement>) {
    setDateFrom(e.target.value);
    setPage(0);
  }

  function handleDateTo(e: React.ChangeEvent<HTMLInputElement>) {
    setDateTo(e.target.value);
    setPage(0);
  }

  return (
    <AdminPageGuard>
      <div className="min-h-screen bg-[#f6f5f2]">
        <AdminHeader />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          {/* Page title */}
          <div className="mb-5">
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Phone className="w-5 h-5 text-slate-500" />
              Cleaner Calls
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              All automated calls placed to cleaners and clients
            </p>
          </div>

          {/* Filters */}
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs font-medium text-gray-500 block mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  placeholder="Customer, cleaner, or phone…"
                  value={search}
                  onChange={handleSearch}
                  className="pl-8 h-8 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={handleDateFrom}
                className="h-8 text-sm w-36"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">To</label>
              <Input
                type="date"
                value={dateTo}
                onChange={handleDateTo}
                className="h-8 text-sm w-36"
              />
            </div>
            {(search || dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-gray-500"
                onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setPage(0); }}
              >
                Clear
              </Button>
            )}
          </div>

          {/* Results */}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-xl h-16 animate-pulse" />
              ))}
            </div>
          ) : calls.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Phone className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No calls found</p>
            </div>
          ) : (
            <>
              <div className="text-xs text-gray-400 mb-2 px-1">
                {calls.length} call{calls.length !== 1 ? "s" : ""}{hasMore ? "+" : ""} shown
              </div>
              <div className="space-y-2">
                {calls.map(call => (
                  <CallCard key={call.id} call={call as CallRow} />
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  className="gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </Button>
                <span className="text-xs text-gray-500">Page {page + 1}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasMore}
                  onClick={() => setPage(p => p + 1)}
                  className="gap-1"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </>
          )}
        </main>
      </div>
    </AdminPageGuard>
  );
}
