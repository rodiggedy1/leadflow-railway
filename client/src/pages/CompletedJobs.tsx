/**
 * CompletedJobs.tsx
 * Admin page for the post-cleaning review request flow.
 *
 * Features:
 *  - CSV upload (same format as bookings CSV)
 *  - Batch list with aggregate stats
 *  - Batch detail view with per-contact status
 *  - "Send Now" button to trigger pending review SMS immediately
 */
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import MessageFlowPanel from "@/components/MessageFlowPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  ChevronLeft,
  Send,
  RefreshCw,
  Star,
  ThumbsUp,
  ThumbsDown,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

// ─── Status badge helpers ─────────────────────────────────────────────────────
const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode; color: string }
> = {
  PENDING: {
    label: "Pending",
    variant: "secondary",
    icon: <Clock className="w-3 h-3" />,
    color: "text-gray-500",
  },
  SENT: {
    label: "SMS Sent",
    variant: "outline",
    icon: <Send className="w-3 h-3" />,
    color: "text-blue-600",
  },
  REPLIED_POSITIVE: {
    label: "Positive",
    variant: "default",
    icon: <ThumbsUp className="w-3 h-3" />,
    color: "text-green-600",
  },
  REPLIED_NEGATIVE: {
    label: "Negative",
    variant: "destructive",
    icon: <ThumbsDown className="w-3 h-3" />,
    color: "text-red-600",
  },
  REVIEW_CONFIRMED: {
    label: "Review Left",
    variant: "default",
    icon: <Star className="w-3 h-3" />,
    color: "text-yellow-600",
  },
  OPTED_OUT: {
    label: "Opted Out",
    variant: "secondary",
    icon: <XCircle className="w-3 h-3" />,
    color: "text-gray-400",
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    variant: "secondary" as const,
    icon: <AlertCircle className="w-3 h-3" />,
    color: "text-gray-500",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}
      style={{
        background:
          status === "REPLIED_POSITIVE" || status === "REVIEW_CONFIRMED"
            ? "#f0fdf4"
            : status === "REPLIED_NEGATIVE"
            ? "#fef2f2"
            : status === "SENT"
            ? "#eff6ff"
            : "#f9fafb",
        borderColor:
          status === "REPLIED_POSITIVE" || status === "REVIEW_CONFIRMED"
            ? "#bbf7d0"
            : status === "REPLIED_NEGATIVE"
            ? "#fecaca"
            : status === "SENT"
            ? "#bfdbfe"
            : "#e5e7eb",
      }}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ─── Batch detail view ────────────────────────────────────────────────────────
function BatchDetail({ batchId, onBack }: { batchId: number; onBack: () => void }) {
  const { data: contacts, isLoading, refetch } = trpc.completedJobs.getBatchContacts.useQuery({ batchId });

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ChevronLeft className="w-4 h-4" />
          Back to Batches
        </Button>
        <h2 className="text-lg font-semibold text-gray-900">Batch #{batchId} — Contacts</h2>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="ml-auto gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading contacts…</div>
      ) : !contacts?.length ? (
        <div className="text-center py-12 text-gray-400">No contacts in this batch.</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Job Date</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SMS Sent</TableHead>
                  <TableHead>Replied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                    <TableCell>{c.jobDate ?? "—"}</TableCell>
                    <TableCell>{c.serviceType ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {c.smsSentAt ? new Date(c.smsSentAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {c.repliedAt ? new Date(c.repliedAt).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function CompletedJobs() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [jobDateOverride, setJobDateOverride] = useState<string>("");

  const { data: batches, isLoading, refetch } = trpc.completedJobs.listBatches.useQuery();

  const uploadMutation = trpc.completedJobs.upload.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Batch uploaded — ${result.count} contacts added. SMS will be sent 24h after the job date.`);
        refetch();
        setSelectedBatchId(result.batchId);
      } else {
        toast.error(result.error ?? "Unknown error");
      }
      setUploading(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setUploading(false);
    },
  });

  const sendNowMutation = trpc.completedJobs.sendPendingNow.useMutation({
    onSuccess: (result) => {
      if (result.sent > 0) {
        toast.success(`Sent ${result.sent} review request SMS.`);
      } else {
        toast.info("No pending SMS — all contacts are either already sent or not yet 24h past job date.");
      }
      refetch();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const csvText = await file.text();
    uploadMutation.mutate({
      csvText,
      filename: file.name,
      jobDate: jobDateOverride || undefined,
    });
    // Reset input so same file can be re-uploaded
    e.target.value = "";
  };

  if (selectedBatchId !== null) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <BatchDetail batchId={selectedBatchId} onBack={() => setSelectedBatchId(null)} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <a
              href="/admin"
              className="text-sm font-medium hover:underline"
              style={{ color: "#E8603C" }}
            >
              ← Back to Admin
            </a>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Completed Jobs</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Upload completed job CSVs to automatically send review request SMS 24 hours after each cleaning.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendNowMutation.mutate()}
            disabled={sendNowMutation.isPending}
            className="gap-1.5"
          >
            {sendNowMutation.isPending ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            Send Pending Now
          </Button>
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-1.5"
            style={{ background: "#E8603C" }}
          >
            {uploading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            Upload CSV
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* Info banner */}
      <div
        className="rounded-lg border p-4 mb-6 text-sm"
        style={{ background: "#FFF8F6", borderColor: "#F0D8D0", color: "#7c3a2a" }}
      >
        <strong>How it works:</strong> Upload a CSV with completed jobs (Phone, Date, First Name, Last Name, Full Name, Frequency columns).
        The system waits 24 hours after the job date, then sends a friendly feedback SMS. Positive replies receive a Google review link
        with a 10% discount offer. Negative replies are flagged for manual follow-up. When a customer confirms they left a review,
        they're automatically added as a reactivation contact with 10% off their next booking.
      </div>

      {/* Optional job date override */}
      <div className="flex items-center gap-3 mb-6">
        <label className="text-sm font-medium text-gray-700">Job date override (optional):</label>
        <input
          type="date"
          value={jobDateOverride}
          onChange={(e) => setJobDateOverride(e.target.value)}
          className="text-sm border rounded px-2 py-1"
          style={{ borderColor: "#e5e7eb" }}
        />
        {jobDateOverride && (
          <button
            onClick={() => setJobDateOverride("")}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
        <span className="text-xs text-gray-400">
          Leave blank to use each row's Date column. Set this to override all rows in the upload.
        </span>
      </div>

      {/* Batch list */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading batches…</div>
      ) : !batches?.length ? (
        <div className="text-center py-16">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: "#FFF8F6" }}
          >
            <CheckCircle2 className="w-8 h-8" style={{ color: "#E8603C" }} />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No batches yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Upload your first completed jobs CSV to get started.
          </p>
          <Button
            onClick={() => fileInputRef.current?.click()}
            style={{ background: "#E8603C" }}
            className="gap-1.5"
          >
            <Upload className="w-4 h-4" />
            Upload CSV
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {batches.map((batch) => {
            const responseRate =
              batch.sentCount > 0
                ? Math.round(
                    ((batch.positiveCount + batch.negativeCount + batch.reviewConfirmedCount) /
                      batch.sentCount) *
                      100
                  )
                : 0;
            const reviewRate =
              batch.sentCount > 0
                ? Math.round((batch.reviewConfirmedCount / batch.sentCount) * 100)
                : 0;

            return (
              <Card
                key={batch.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setSelectedBatchId(batch.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold text-gray-900">
                        {batch.filename}
                      </CardTitle>
                      <CardDescription className="mt-0.5">
                        Job date: {batch.jobDate ?? "—"} · Uploaded{" "}
                        {new Date(batch.uploadedAt).toLocaleDateString()}
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs gap-1"
                      style={{ color: "#E8603C" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedBatchId(batch.id);
                      }}
                    >
                      View contacts →
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-900">{batch.totalCount}</div>
                      <div className="text-xs text-gray-500 mt-0.5">Total</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">{batch.sentCount}</div>
                      <div className="text-xs text-gray-500 mt-0.5">SMS Sent</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">{batch.positiveCount}</div>
                      <div className="text-xs text-gray-500 mt-0.5">Positive</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-500">{batch.negativeCount}</div>
                      <div className="text-xs text-gray-500 mt-0.5">Negative</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-yellow-500">
                        {batch.reviewConfirmedCount}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">Reviews</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold" style={{ color: "#E8603C" }}>
                        {reviewRate}%
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">Review Rate</div>
                    </div>
                  </div>
                  {batch.sentCount > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Response rate</span>
                        <span>{responseRate}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            width: `${responseRate}%`,
                            background: "#E8603C",
                          }}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Post-Sale Review Message Flow */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Review Request Message Flow
          </CardTitle>
          <CardDescription>
            The full SMS sequence sent to completed job customers. Click <strong>Edit</strong> on any message to update the copy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MessageFlowPanel flowType="review" />
        </CardContent>
      </Card>
    </div>
  );
}
