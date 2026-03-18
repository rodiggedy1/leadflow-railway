/**
 * AllCalls — /admin/calls
 * Paginated list of every Vapi AI voice call with recording player,
 * transcript expand, call summary, outcome badge, duration, and date filters.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Mic,
  PlayCircle,
  ChevronDown,
  ChevronUp,
  Phone,
  Clock,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { Link } from "wouter";

const OUTCOME_COLORS: Record<string, string> = {
  booked: "bg-emerald-100 text-emerald-700",
  quote_given: "bg-blue-100 text-blue-700",
  faq_answered: "bg-violet-100 text-violet-700",
  transferred: "bg-orange-100 text-orange-700",
  callback_requested: "bg-yellow-100 text-yellow-700",
  no_action: "bg-gray-100 text-gray-500",
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type DatePreset = "today" | "7d" | "30d" | "all";

const DATE_PRESETS: { label: string; value: DatePreset }[] = [
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "All time", value: "all" },
];

function getDateRange(preset: DatePreset): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  if (preset === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { dateFrom: start.toISOString() };
  }
  if (preset === "7d") {
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return { dateFrom: start.toISOString() };
  }
  if (preset === "30d") {
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return { dateFrom: start.toISOString() };
  }
  return {};
}

type VoiceCall = {
  id: number;
  vapiCallId: string;
  callerPhone: string;
  durationSeconds: number;
  transcript: string | null;
  summary: string | null;
  recordingUrl: string | null;
  outcome: string;
  endedReason: string | null;
  successEvaluation: string | null;
  createdAt: Date;
};

function CallCard({ call }: { call: VoiceCall }) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const durationLabel = call.durationSeconds ? formatDuration(call.durationSeconds) : null;
  const colorClass = OUTCOME_COLORS[call.outcome] ?? "bg-gray-100 text-gray-600";

  return (
    <div className="bg-white rounded-2xl border p-5 space-y-3" style={{ borderColor: "#F0D8D0" }}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#FFF0EB" }}
          >
            <Mic className="w-5 h-5" style={{ color: "#E8603C" }} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">{call.callerPhone}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colorClass}`}>
                {call.outcome.replace(/_/g, " ")}
              </span>
              {call.successEvaluation === "true" && (
                <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-medium">
                  ✓ Successful
                </span>
              )}
              {call.successEvaluation === "false" && (
                <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full font-medium">
                  ✗ Unsuccessful
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(call.createdAt).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              {durationLabel && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {durationLabel}
                </span>
              )}
              {call.endedReason && (
                <span className="text-gray-300">{call.endedReason.replace(/-/g, " ")}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      {call.summary && (
        <p className="text-sm text-gray-600 leading-relaxed bg-gray-50 rounded-xl px-4 py-3">
          {call.summary}
        </p>
      )}

      {/* Recording player */}
      {call.recordingUrl && (
        <div className="flex items-center gap-3 bg-orange-50 rounded-xl px-4 py-2.5">
          <a
            href={call.recordingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm font-medium"
            style={{ color: "#E8603C" }}
          >
            <PlayCircle className="w-5 h-5" />
            Listen to recording
          </a>
          <audio
            src={call.recordingUrl}
            controls
            className="flex-1 h-8 min-w-0"
            style={{ accentColor: "#E8603C" }}
          />
        </div>
      )}

      {/* Transcript toggle */}
      {call.transcript && (
        <div>
          <button
            onClick={() => setTranscriptOpen(!transcriptOpen)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 font-medium"
          >
            {transcriptOpen ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            {transcriptOpen ? "Hide transcript" : "View transcript"}
          </button>
          {transcriptOpen && (
            <div className="mt-2 text-xs text-gray-500 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl px-4 py-3 max-h-64 overflow-y-auto">
              {call.transcript}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 20;

export default function AllCalls() {
  const [page, setPage] = useState(0);
  const [preset, setPreset] = useState<DatePreset>("30d");

  const dateRange = useMemo(() => getDateRange(preset), [preset]);

  const { data, isLoading, refetch, isFetching } = trpc.voice.listCalls.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...dateRange,
  });

  // Reset to page 0 when filter changes
  const handlePresetChange = (p: DatePreset) => {
    setPage(0);
    setPreset(p);
  };

  const calls = (data as { calls: VoiceCall[]; total: number } | undefined)?.calls ?? [];
  const total = (data as { calls: VoiceCall[]; total: number } | undefined)?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#FDF6F3" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center gap-3"
        style={{ borderColor: "#F0D8D0" }}
      >
        <Link href="/admin">
          <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="w-4 h-4" />
            Admin
          </button>
        </Link>
        <span className="text-gray-300">/</span>
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4" style={{ color: "#E8603C" }} />
          <span className="font-semibold text-gray-900">All Voice Calls</span>
          {total > 0 && (
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {total} {total === 1 ? "call" : "calls"}
            </span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto text-gray-400 hover:text-gray-600 disabled:opacity-40"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* Date filter presets */}
        <div className="flex items-center gap-2 flex-wrap">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => handlePresetChange(p.value)}
              className="px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
              style={
                preset === p.value
                  ? { backgroundColor: "#E8603C", color: "#fff" }
                  : { backgroundColor: "#fff", color: "#6b7280", border: "1px solid #F0D8D0" }
              }
            >
              {p.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-6 h-6 animate-spin text-gray-300" />
          </div>
        ) : calls.length === 0 ? (
          <div
            className="bg-white rounded-2xl border p-16 text-center"
            style={{ borderColor: "#F0D8D0" }}
          >
            <Mic className="w-12 h-12 mx-auto mb-3 text-gray-200" />
            <p className="text-gray-500 font-medium">No calls in this period</p>
            <p className="text-sm text-gray-400 mt-1">
              Try a wider date range or check back after Madison takes some calls.
            </p>
          </div>
        ) : (
          <>
            {calls.map((call) => (
              <CallCard key={call.id} call={call} />
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-500">
                  Page {page + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
