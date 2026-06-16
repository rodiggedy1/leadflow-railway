/**
 * MissedCalls — /admin/missed-calls
 *
 * Displays all missed inbound OpenPhone calls with:
 *  - Filter tabs: Pending / All / Resolved
 *  - Per-row: caller phone, time ago, which line, SMS sent badge
 *  - Mark Called Back button with optional note dialog
 *  - Undo Called Back button on resolved rows
 *  - Live updates via SSE (missed_call event bumps the list)
 */
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useOpsStream } from "@/hooks/useOpsStream";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  PhoneMissed,
  CheckCircle2,
  RotateCcw,
  MessageSquare,
  RefreshCw,
  Phone,
  Clock,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────
type FilterTab = "pending" | "all" | "resolved";

interface MissedCallRow {
  id: number;
  callerPhone: string;
  phoneNumberLabel: string;
  calledAt: Date;
  smsSent: number;
  smsSentAt: Date | null;
  calledBack: number;
  calledBackAt: Date | null;
  calledBackByAgentName: string | null;
  notes: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

const LINE_COLORS: Record<string, string> = {
  Main: "bg-blue-100 text-blue-700",
  CS: "bg-purple-100 text-purple-700",
  Bark: "bg-orange-100 text-orange-700",
  Unknown: "bg-gray-100 text-gray-600",
};

// ── Mark Called Back Dialog ────────────────────────────────────────────────────
interface MarkDialogProps {
  row: MissedCallRow;
  agentName: string;
  onClose: () => void;
  onSuccess: () => void;
}

function MarkCalledBackDialog({ row, agentName, onClose, onSuccess }: MarkDialogProps) {
  const [notes, setNotes] = useState("");
  const markMutation = trpc.missedCalls.markCalledBack.useMutation({
    onSuccess: () => {
      toast.success("Marked as called back");
      onSuccess();
      onClose();
    },
    onError: (err) => {
      toast.error(`Failed: ${err.message}`);
    },
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Mark as Called Back
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Phone className="w-4 h-4" />
            <span className="font-medium">{formatPhone(row.callerPhone)}</span>
            <span className="text-gray-400">·</span>
            <span>{row.phoneNumberLabel} line</span>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Left voicemail, scheduled a quote..."
              className="resize-none"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={markMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => markMutation.mutate({ id: row.id, agentName, notes: notes || undefined })}
            disabled={markMutation.isPending}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {markMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mr-2" />
            )}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Row Card ──────────────────────────────────────────────────────────────────
interface RowCardProps {
  row: MissedCallRow;
  agentName: string;
  onRefetch: () => void;
}

function MissedCallCard({ row, agentName, onRefetch }: RowCardProps) {
  const [showMarkDialog, setShowMarkDialog] = useState(false);
  const undoMutation = trpc.missedCalls.undoCalledBack.useMutation({
    onSuccess: () => {
      toast.success("Marked as pending");
      onRefetch();
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const isResolved = row.calledBack === 1;
  const lineColor = LINE_COLORS[row.phoneNumberLabel] ?? LINE_COLORS.Unknown;

  return (
    <>
      <div
        className={`bg-white rounded-xl border shadow-sm p-4 transition-all ${
          isResolved ? "opacity-60" : "hover:shadow-md"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          {/* Left: icon + info */}
          <div className="flex items-start gap-3 min-w-0">
            <div className={`mt-0.5 flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
              isResolved ? "bg-green-100" : "bg-red-100"
            }`}>
              {isResolved ? (
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              ) : (
                <PhoneMissed className="w-5 h-5 text-red-500" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900 text-sm">
                  {formatPhone(row.callerPhone)}
                </span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${lineColor}`}>
                  {row.phoneNumberLabel}
                </span>
                {row.smsSent === 1 && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    SMS sent
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-gray-500">
                <Clock className="w-3 h-3" />
                <span>{timeAgo(row.calledAt)}</span>
                <span className="text-gray-300">·</span>
                <span>{new Date(row.calledAt).toLocaleString()}</span>
              </div>

              {isResolved && (row.calledBackByAgentName || row.notes) && (
                <div className="mt-1.5 text-xs text-gray-500 space-y-0.5">
                  {row.calledBackByAgentName && (
                    <div>Called back by <span className="font-medium text-gray-700">{row.calledBackByAgentName}</span>
                      {row.calledBackAt && <span> · {timeAgo(row.calledBackAt)}</span>}
                    </div>
                  )}
                  {row.notes && (
                    <div className="italic text-gray-400">"{row.notes}"</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: action button */}
          <div className="flex-shrink-0">
            {isResolved ? (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 px-2.5 text-gray-500"
                onClick={() => undoMutation.mutate({ id: row.id })}
                disabled={undoMutation.isPending}
              >
                {undoMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3 mr-1" />
                )}
                Undo
              </Button>
            ) : (
              <Button
                size="sm"
                className="text-xs h-7 px-3 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => setShowMarkDialog(true)}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Called Back
              </Button>
            )}
          </div>
        </div>
      </div>

      {showMarkDialog && (
        <MarkCalledBackDialog
          row={row}
          agentName={agentName}
          onClose={() => setShowMarkDialog(false)}
          onSuccess={onRefetch}
        />
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MissedCalls() {
  const [filter, setFilter] = useState<FilterTab>("pending");
  const { user } = useAuth();
  const agentName = user?.name ?? "Agent";

  const { data: rows = [], isLoading, refetch } = trpc.missedCalls.listMissedCalls.useQuery(
    { filter, limit: 100, offset: 0 },
    { staleTime: 30_000, refetchInterval: 60_000, retry: false, throwOnError: false }
  );

  const { data: countData, refetch: refetchCount } = trpc.missedCalls.getPendingCount.useQuery(
    undefined,
    { staleTime: 30_000, refetchInterval: 60_000, retry: false, throwOnError: false }
  );
  const pendingCount = countData?.count ?? 0;

  // Live updates via SSE
  const handleRefetch = useCallback(() => {
    refetch();
    refetchCount();
  }, [refetch, refetchCount]);

  useOpsStream({
    onMissedCall: () => handleRefetch(),
  });

  const TABS: { id: FilterTab; label: string }[] = [
    { id: "pending", label: `Pending${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
    { id: "all", label: "All" },
    { id: "resolved", label: "Resolved" },
  ];

  return (
    <AdminPageGuard pageId="missed-calls">
      <div className="min-h-screen bg-gray-50">
        <AdminHeader activeTab="missed-calls" />

        <div className="max-w-3xl mx-auto px-4 py-8">
          {/* Page header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                <PhoneMissed className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Missed Calls</h1>
                <p className="text-sm text-gray-500">Inbound calls that weren't answered</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefetch}
              disabled={isLoading}
              className="gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 bg-white border rounded-lg p-1 mb-5 w-fit shadow-sm">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  filter === tab.id
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                <PhoneMissed className="w-7 h-7 text-gray-400" />
              </div>
              <p className="text-gray-500 font-medium">
                {filter === "pending" ? "No pending missed calls" :
                 filter === "resolved" ? "No resolved calls yet" :
                 "No missed calls recorded"}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {filter === "pending" ? "All caught up!" : "Missed calls will appear here automatically"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {(rows as MissedCallRow[]).map((row) => (
                <MissedCallCard
                  key={row.id}
                  row={row}
                  agentName={agentName}
                  onRefetch={handleRefetch}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminPageGuard>
  );
}
