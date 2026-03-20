/**
 * CampaignApprovalPage — Admin review queue for Always-On SMS batches.
 *
 * The daily cron (10 AM ET Mon–Sat) generates pending batches instead of
 * sending SMS directly. This page lets the admin:
 *   1. See each pending batch with a preview of the first 5 personalized messages
 *   2. Approve → SMS sends immediately to all recipients
 *   3. Reject → enrollments stay PENDING for the next day
 *
 * Also shows a history table of past batches (approved, rejected, sent).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
  MessageSquare,
  RefreshCw,
  ClipboardCheck,
  Clock,
  Users,
  Eye,
  Send,
  Ban,
  Zap,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  PlayCircle,
} from "lucide-react";
import { toast } from "sonner";
import AdminHeader from "@/components/AdminHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecipientPreviewItem {
  enrollmentId: number;
  phone: string;
  firstName: string | null;
  name: string | null;
  message: string;
}

interface CampaignBatch {
  id: number;
  groupId: number;
  groupType: string;
  groupName: string;
  messageTemplate: string;
  enrollmentIds: number[];
  recipientCount: number;
  recipientPreview: RecipientPreviewItem[];
  status: "pending" | "approved" | "rejected" | "sent";
  reviewedBy: string | null;
  rejectionReason: string | null;
  sentCount: number;
  failedCount: number;
  reviewedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(date: Date | string): string {
  const d = new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function formatDateTime(date: Date | string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }) + " ET";
}

function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return phone.slice(0, -4).replace(/\d/g, "•") + phone.slice(-4);
}

function statusBadge(status: CampaignBatch["status"]) {
  switch (status) {
    case "pending":
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">Pending Review</Badge>;
    case "approved":
      return <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">Approved</Badge>;
    case "sent":
      return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Sent</Badge>;
    case "rejected":
      return <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Rejected</Badge>;
  }
}

// ─── Pending Batch Card ───────────────────────────────────────────────────────

function PendingBatchCard({
  batch,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: {
  batch: CampaignBatch;
  onApprove: (batchId: number) => void;
  onReject: (batchId: number) => void;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);

  return (
    <div className="bg-white rounded-xl border-2 border-amber-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-amber-50 px-5 py-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white rounded-lg border border-amber-200 shadow-sm">
            <Zap className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 text-sm">{batch.groupName}</h3>
              <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs capitalize">
                {batch.groupType.replace(/-/g, " ")}
              </Badge>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Generated {timeAgo(batch.createdAt)} · {batch.recipientCount} recipients
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white rounded-lg px-3 py-1.5 border border-amber-200">
            <Users className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-sm font-bold text-amber-700">{batch.recipientCount}</span>
            <span className="text-xs text-gray-500">recipients</span>
          </div>
        </div>
      </div>

      {/* Message template */}
      <div className="px-5 py-3 border-b border-gray-100">
        <button
          onClick={() => setShowTemplate(!showTemplate)}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          {showTemplate ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Message Template
        </button>
        {showTemplate && (
          <div className="mt-2 bg-gray-50 rounded-lg px-4 py-3 border border-gray-200">
            <p className="text-xs text-gray-700 leading-relaxed font-mono whitespace-pre-wrap">
              {batch.messageTemplate}
            </p>
          </div>
        )}
      </div>

      {/* Recipient preview */}
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-gray-400" />
            Message Preview (first {Math.min(5, batch.recipientPreview.length)} of {batch.recipientCount})
          </h4>
          {batch.recipientCount > 5 && (
            <span className="text-xs text-gray-400">+{batch.recipientCount - 5} more recipients</span>
          )}
        </div>

        <div className="space-y-2">
          {(showAll ? batch.recipientPreview : batch.recipientPreview.slice(0, 3)).map((item, i) => (
            <div key={item.enrollmentId} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-gray-200 text-gray-600 text-xs flex items-center justify-center font-medium">
                    {i + 1}
                  </span>
                  <span className="text-xs font-medium text-gray-700">
                    {item.name ?? item.firstName ?? "Unknown"}
                  </span>
                  <span className="text-xs text-gray-400">{maskPhone(item.phone)}</span>
                </div>
              </div>
              <div className="bg-white rounded-lg px-3 py-2 border border-gray-200">
                <p className="text-xs text-gray-700 leading-relaxed">{item.message}</p>
              </div>
            </div>
          ))}

          {batch.recipientPreview.length > 3 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full text-xs text-blue-600 hover:text-blue-800 py-1 font-medium"
            >
              Show {batch.recipientPreview.length - 3} more previews
            </button>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          Approving will immediately send SMS to all {batch.recipientCount} recipients.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReject(batch.id)}
            disabled={isApproving || isRejecting}
            className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            {isRejecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
            Reject
          </Button>
          <Button
            size="sm"
            onClick={() => onApprove(batch.id)}
            disabled={isApproving || isRejecting}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isApproving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Approve & Send
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── History Row ──────────────────────────────────────────────────────────────

function HistoryRow({ batch }: { batch: CampaignBatch }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <TableCell className="w-8 py-2.5">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
        </TableCell>
        <TableCell className="py-2.5">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-gray-800">{batch.groupName}</span>
            <span className="text-xs text-gray-400 capitalize">{batch.groupType.replace(/-/g, " ")}</span>
          </div>
        </TableCell>
        <TableCell className="py-2.5">{statusBadge(batch.status)}</TableCell>
        <TableCell className="py-2.5 text-xs text-gray-600">
          {batch.recipientCount} recipients
        </TableCell>
        <TableCell className="py-2.5 text-xs text-gray-500 whitespace-nowrap">
          {formatDateTime(batch.createdAt)}
        </TableCell>
        <TableCell className="py-2.5 text-xs text-gray-500 whitespace-nowrap">
          {batch.reviewedBy ?? "—"}
        </TableCell>
        <TableCell className="py-2.5 text-right">
          {batch.status === "sent" ? (
            <span className="text-xs font-semibold text-emerald-600">{batch.sentCount} sent</span>
          ) : batch.status === "rejected" ? (
            <span className="text-xs text-red-500">Rejected</span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-gray-50 border-t-0">
          <TableCell colSpan={7} className="py-3 px-8">
            <div className="space-y-2">
              {batch.rejectionReason && (
                <div>
                  <p className="text-xs font-semibold text-red-600 mb-1">Rejection Reason</p>
                  <p className="text-xs text-red-700 bg-red-50 rounded px-3 py-2 border border-red-100">
                    {batch.rejectionReason}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">Message Template</p>
                <p className="text-xs text-gray-700 bg-white rounded px-3 py-2 border border-gray-200 font-mono whitespace-pre-wrap">
                  {batch.messageTemplate}
                </p>
              </div>
              {batch.recipientPreview.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1.5">Sample Messages</p>
                  <div className="space-y-1.5">
                    {batch.recipientPreview.slice(0, 3).map((item) => (
                      <div key={item.enrollmentId} className="bg-white rounded px-3 py-2 border border-gray-200 text-xs text-gray-700">
                        <span className="font-medium text-gray-500">{item.name ?? item.firstName ?? "?"} ({maskPhone(item.phone)}): </span>
                        {item.message}
                      </div>
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

// ─── Reject Dialog ────────────────────────────────────────────────────────────

function RejectDialog({
  batchId,
  batchName,
  open,
  onClose,
  onConfirm,
  isPending,
}: {
  batchId: number | null;
  batchName: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <XCircle className="w-5 h-5" />
            Reject Batch
          </DialogTitle>
          <DialogDescription>
            Rejecting <strong>{batchName}</strong> will keep all recipients in the PENDING queue for tomorrow's batch. No SMS will be sent.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label className="text-xs font-medium text-gray-700 block mb-1.5">
            Reason (optional)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Message needs revision, wrong timing..."
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none"
            rows={3}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onConfirm(reason)}
            disabled={isPending}
            className="border-red-200 text-red-600 hover:bg-red-50"
          >
            {isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Ban className="w-3.5 h-3.5 mr-1.5" />}
            Confirm Rejection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CampaignApprovalPage() {
  const [rejectDialog, setRejectDialog] = useState<{ batchId: number; batchName: string } | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data: pendingBatches, isLoading: pendingLoading, refetch: refetchPending } =
    trpc.campaignApproval.getPendingBatches.useQuery(undefined, {
      refetchInterval: 60_000,
    });

  const { data: recentBatches, isLoading: historyLoading, refetch: refetchHistory } =
    trpc.campaignApproval.getRecentBatches.useQuery({ limit: 30 }, {
      refetchInterval: 60_000,
    });

  const approveMutation = trpc.campaignApproval.approveBatch.useMutation({
    onSuccess: (result) => {
      toast.success(`Batch approved — ${result.sent} SMS sent${result.failed > 0 ? `, ${result.failed} failed` : ""}`);
      setApprovingId(null);
      refetchPending();
      refetchHistory();
    },
    onError: (err) => {
      toast.error(`Approval failed: ${err.message}`);
      setApprovingId(null);
    },
  });

  const rejectMutation = trpc.campaignApproval.rejectBatch.useMutation({
    onSuccess: () => {
      toast.success("Batch rejected — recipients remain in queue for tomorrow");
      setRejectDialog(null);
      refetchPending();
      refetchHistory();
    },
    onError: (err) => {
      toast.error(`Rejection failed: ${err.message}`);
    },
  });

  const generateMutation = trpc.campaignApproval.generateBatch.useMutation({
    onSuccess: (results) => {
      if (results.length === 0) {
        toast.info("No batches generated — all groups are inactive or have no pending enrollments");
      } else {
        const total = results.reduce((sum, r) => sum + r.recipientCount, 0);
        toast.success(`Generated ${results.length} batch(es) — ${total} recipients ready for review`);
        refetchPending();
        refetchHistory();
      }
    },
    onError: (err) => {
      toast.error(`Batch generation failed: ${err.message}`);
    },
  });

  const handleApprove = (batchId: number) => {
    setApprovingId(batchId);
    approveMutation.mutate({ batchId });
  };

  const handleRejectConfirm = (reason: string) => {
    if (!rejectDialog) return;
    rejectMutation.mutate({ batchId: rejectDialog.batchId, reason: reason || undefined });
  };

  const handleRefresh = () => {
    refetchPending();
    refetchHistory();
    toast.success("Refreshed");
  };

  const isLoading = pendingLoading || historyLoading;
  const hasPending = (pendingBatches?.length ?? 0) > 0;

  return (
    <div className="hj-theme min-h-screen" style={{ backgroundColor: "#F7F7F7" }}>
      <AdminHeader activeTab="campaign-approval" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Page title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-[#000000]" />
              Campaign Approvals
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Review and approve Always-On SMS batches before they go out
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="gap-1.5 text-xs"
              title="Manually trigger batch generation for all active groups"
            >
              {generateMutation.isPending ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <PlayCircle className="w-3.5 h-3.5" />
              )}
              Generate Batches
            </Button>
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
        </div>

        {/* Pending batches */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Pending Review</h2>
            {hasPending && (
              <span className="bg-amber-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {pendingBatches!.length}
              </span>
            )}
          </div>

          {pendingLoading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="rounded-xl border-2 border-gray-200 bg-gray-50 h-48 animate-pulse" />
              ))}
            </div>
          ) : !hasPending ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700">All caught up</p>
              <p className="text-xs text-gray-400 mt-1">
                No batches are waiting for review. The next batch will be generated at 10 AM ET on the next weekday.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                You can also click <strong>Generate Batches</strong> above to manually trigger batch creation for testing.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {(pendingBatches as CampaignBatch[]).map((batch) => (
                <PendingBatchCard
                  key={batch.id}
                  batch={batch}
                  onApprove={handleApprove}
                  onReject={(batchId) => setRejectDialog({ batchId, batchName: batch.groupName })}
                  isApproving={approvingId === batch.id && approveMutation.isPending}
                  isRejecting={rejectDialog?.batchId === batch.id && rejectMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>

        {/* History */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Batch History</h2>
          </div>

          {historyLoading ? (
            <div className="p-8 text-center text-sm text-gray-400 animate-pulse">Loading history…</div>
          ) : !recentBatches || recentBatches.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No batch history yet.</p>
              <p className="text-xs text-gray-400 mt-1">
                Batches will appear here once the cron generates them or you trigger them manually.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50/50">
                  <TableHead className="w-8" />
                  <TableHead className="text-xs font-semibold text-gray-600">Group</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600">Status</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600">Recipients</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600">Created</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600">Reviewed By</TableHead>
                  <TableHead className="text-xs font-semibold text-gray-600 text-right">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recentBatches as CampaignBatch[]).map((batch) => (
                  <HistoryRow key={batch.id} batch={batch} />
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Info box */}
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
          <h3 className="text-xs font-semibold text-blue-800 mb-1.5 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            How Campaign Approval Works
          </h3>
          <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
            <li>Every weekday at 10 AM ET, the system generates a pending batch for each active Always-On group.</li>
            <li>You receive a notification and can review the exact recipient list and personalized messages here.</li>
            <li>Approving sends SMS immediately to all recipients and creates conversation sessions.</li>
            <li>Rejecting keeps recipients in the PENDING queue — they'll be included in tomorrow's batch.</li>
            <li>Phone numbers are partially masked in the preview for privacy.</li>
          </ul>
        </div>
      </main>

      {/* Reject dialog */}
      <RejectDialog
        batchId={rejectDialog?.batchId ?? null}
        batchName={rejectDialog?.batchName ?? ""}
        open={!!rejectDialog}
        onClose={() => setRejectDialog(null)}
        onConfirm={handleRejectConfirm}
        isPending={rejectMutation.isPending}
      />
    </div>
  );
}
