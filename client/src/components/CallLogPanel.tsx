/**
 * CallLogPanel — AI Call Command Center
 *
 * Shows all AI calls fired for a given date.
 * Opened from the toolbar button in SchedulingTab.
 * Features:
 *   - Status badges (pending / fired / completed / failed / no_answer)
 *   - Recording playback (audio player)
 *   - Transcript inline (collapsible)
 *   - Dispatcher notes (editable)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Phone, PhoneCall, PhoneMissed, PhoneOff, Loader2,
  Clock, User, Users, ChevronDown, ChevronUp, FileText,
  CheckCircle2, XCircle, AlertCircle, Volume2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type CallStatus = "pending" | "fired" | "completed" | "failed" | "no_answer";

interface CallLogEntry {
  id: number;
  cleanerJobId: number | null;
  teamName: string | null;
  clientName: string | null;
  calledPhone: string | null;
  calledTarget: "team" | "client";
  templateName: string | null;
  resolvedScript: string;
  status: CallStatus;
  vapiCallId: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  jobDate: string | null;
  firedBy: string | null;
  firedAt: number | null;
  completedAt: number | null;
  durationSeconds: number | null;
  notes: string | null;
  // createdAt removed 2014 server no longer returns Date columns
}

// ── Status helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CallStatus }) {
  const map: Record<CallStatus, { label: string; className: string; icon: React.ReactNode }> = {
    pending:   { label: "Pending",   className: "bg-gray-100 text-gray-600 border-gray-200",   icon: <Clock className="w-3 h-3" /> },
    fired:     { label: "Fired",     className: "bg-blue-100 text-blue-700 border-blue-200",   icon: <PhoneCall className="w-3 h-3" /> },
    completed: { label: "Completed", className: "bg-green-100 text-green-700 border-green-200", icon: <CheckCircle2 className="w-3 h-3" /> },
    failed:    { label: "Failed",    className: "bg-red-100 text-red-700 border-red-200",       icon: <XCircle className="w-3 h-3" /> },
    no_answer: { label: "No Answer", className: "bg-amber-100 text-amber-700 border-amber-200", icon: <PhoneMissed className="w-3 h-3" /> },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${s.className}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

function formatTs(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: "America/New_York",
  });
}

function formatDuration(secs: number | null | undefined): string {
  if (!secs) return "";
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

// ── Call card ─────────────────────────────────────────────────────────────────

function CallCard({ entry, onNotesUpdated }: { entry: CallLogEntry; onNotesUpdated: () => void }) {
  const [showScript, setShowScript] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(entry.notes ?? "");

  const updateCallLog = trpc.calls.updateCallLog.useMutation({
    onSuccess: () => {
      toast.success("Notes saved");
      setEditingNotes(false);
      onNotesUpdated();
    },
    onError: (e) => toast.error(e.message),
  });

  const targetLabel = entry.calledTarget === "team"
    ? (entry.teamName ?? "Team")
    : (entry.clientName ?? "Client");

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-start gap-2">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          entry.calledTarget === "team" ? "bg-indigo-50" : "bg-orange-50"
        }`}>
          {entry.calledTarget === "team"
            ? <Users className="w-3.5 h-3.5 text-indigo-500" />
            : <User className="w-3.5 h-3.5 text-orange-500" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-sm text-gray-900 truncate">{targetLabel}</span>
            <StatusBadge status={entry.status} />
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {entry.templateName ?? "Manual"} · {formatTs(entry.firedAt ?? undefined)}
            {entry.durationSeconds ? ` · ${formatDuration(entry.durationSeconds)}` : ""}
            {entry.firedBy ? ` · by ${entry.firedBy}` : ""}
          </div>
          {entry.calledPhone && (
            <div className="text-xs text-gray-400">{entry.calledPhone}</div>
          )}
        </div>
      </div>

      {/* Recording player */}
      {entry.recordingUrl && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
          <Volume2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
          <audio
            controls
            src={entry.recordingUrl}
            className="flex-1 h-7"
            style={{ minWidth: 0 }}
          />
        </div>
      )}

      {/* Script toggle */}
      <button
        onClick={() => setShowScript(v => !v)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <FileText className="w-3 h-3" />
        Script
        {showScript ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {showScript && (
        <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2.5 leading-relaxed">
          {entry.resolvedScript}
        </div>
      )}

      {/* Transcript toggle */}
      {entry.transcript && (
        <>
          <button
            onClick={() => setShowTranscript(v => !v)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <FileText className="w-3 h-3" />
            Transcript
            {showTranscript ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showTranscript && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2.5 leading-relaxed max-h-40 overflow-y-auto">
              {entry.transcript}
            </div>
          )}
        </>
      )}

      {/* Notes */}
      {editingNotes ? (
        <div className="space-y-1.5">
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="text-xs resize-none"
            placeholder="Add dispatcher notes…"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => updateCallLog.mutate({ callLogId: entry.id, notes })}
              disabled={updateCallLog.isPending}
            >
              {updateCallLog.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs px-2"
              onClick={() => { setNotes(entry.notes ?? ""); setEditingNotes(false); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setEditingNotes(true)}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          {entry.notes ? `📝 ${entry.notes}` : "+ Add note"}
        </button>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface CallLogPanelProps {
  open: boolean;
  onClose: () => void;
  jobDate: string;
}

export default function CallLogPanel({ open, onClose, jobDate }: CallLogPanelProps) {
  const { data: entries = [], refetch, isLoading } = trpc.calls.getCallLog.useQuery(
    { jobDate, limit: 50 },
    { enabled: open, refetchInterval: open ? 15_000 : false }
  );

  const statusCounts = (entries as unknown as CallLogEntry[]).reduce((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-indigo-500" />
            Call Log — {jobDate}
          </SheetTitle>
        </SheetHeader>

        {/* Summary badges */}
        {entries.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {Object.entries(statusCounts).map(([status, count]) => (
              <StatusBadge key={status} status={status as CallStatus} />
            ))}
            <span className="text-xs text-gray-400 self-center">{entries.length} total</span>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                <Phone className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500 font-medium">No calls yet today</p>
              <p className="text-xs text-gray-400 mt-1">Use the ⚠ button on a job card to fire a call</p>
            </div>
          ) : (
            (entries as unknown as CallLogEntry[]).map(entry => (
              <CallCard
                key={entry.id}
                entry={entry}
                onNotesUpdated={() => refetch()}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
