/**
 * CampaignReviewScreen — Stage 5.5
 *
 * Full-screen campaign review experience. Replaces the ReviewAudienceModal dialog.
 * Three-panel layout:
 *   Left  (35%) — Campaign summary + exclusion breakdown
 *   Center (45%) — Recipient table with search/sort/skip/undo
 *   Right  (20%) — SMS preview + message editor + test SMS + approval checklist
 *
 * Approval checklist gates the Approve button:
 *   ☐ I reviewed the audience
 *   ☐ I reviewed the SMS
 *   ☐ I sent a test message
 *   ☐ I understand N customers will receive this SMS
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X, ShieldCheck, CheckCircle2, Lock, LockOpen, Loader2, Search,
  ChevronUp, ChevronDown, Users, UserX, RotateCcw, Send, Phone,
  MessageSquare, AlertTriangle, Ban, Clock, Star, DollarSign,
  ChevronLeft, ChevronRight, Smartphone, Pencil, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlannerResult {
  summary: {
    matchedCustomers: number;
    excludedCustomers: number;
    estimatedRevenue: number;
    estimatedBookings: number;
    estimatedReplies: number;
    averageTicket: number;
    qualityScore: number;
    qualityGrade: "A" | "B" | "C" | "D" | "F";
  };
  stats: {
    avgDaysSinceLastBooking: number;
    avgLastBookingPrice: number;
    avgBookingCount: number;
    recurringPercent: number;
  };
  exclusionBreakdown: {
    stopOptOut: number;
    invalidPhone: number;
    openComplaint: number;
    recentlyTexted: number;
    activeRecurring: number;
    duplicate: number;
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  campaignId: number | null;
  campaignName: string;
  campaignStatus: string | null;
  frozenCount: number;
  messageTemplate: string;
  plannerResult: PlannerResult | null;
  onApprove: () => void;
  isApproving: boolean;
  onUnfreeze: () => void;
  isUnfreezing: boolean;
  onCountChange: (n: number) => void;
  onMessageChange: (msg: string) => void;
}

// ─── Quality grade helpers ────────────────────────────────────────────────────

function gradeColor(grade: string) {
  if (grade === "A") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (grade === "B") return "bg-blue-100 text-blue-700 border-blue-200";
  if (grade === "C") return "bg-amber-100 text-amber-700 border-amber-200";
  if (grade === "D") return "bg-orange-100 text-orange-700 border-orange-200";
  return "bg-red-100 text-red-700 border-red-200";
}

function maskPhone(phone: string) {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) {
    return `(${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-••••`;
  }
  return phone.slice(0, 3) + "••••";
}

// ─── Phone mockup ─────────────────────────────────────────────────────────────

function PhoneMockup({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-full max-w-[200px] bg-gray-900 rounded-[28px] p-2 shadow-xl border border-gray-700">
        {/* Notch */}
        <div className="flex justify-center mb-1">
          <div className="w-16 h-1.5 bg-gray-700 rounded-full" />
        </div>
        {/* Screen */}
        <div className="bg-gray-100 rounded-[20px] min-h-[220px] p-3 flex flex-col gap-2">
          {/* Status bar */}
          <div className="flex justify-between items-center mb-1">
            <span className="text-[9px] text-gray-500 font-semibold">Messages</span>
            <Smartphone className="w-2.5 h-2.5 text-gray-400" />
          </div>
          {/* Message bubble */}
          <div className="bg-gray-200 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[90%] self-start">
            <p className="text-[10px] text-gray-800 leading-relaxed whitespace-pre-wrap break-words">{message || "Your message will appear here…"}</p>
          </div>
          {/* Timestamp */}
          <span className="text-[8px] text-gray-400 self-start ml-1">Delivered</span>
        </div>
        {/* Home bar */}
        <div className="flex justify-center mt-1">
          <div className="w-12 h-1 bg-gray-600 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CampaignReviewScreen({
  open, onClose, campaignId, campaignName, campaignStatus, frozenCount,
  messageTemplate, plannerResult, onApprove, isApproving, onUnfreeze,
  isUnfreezing, onCountChange, onMessageChange,
}: Props) {
  const utils = trpc.useUtils();
  const isFrozen = campaignStatus === "FROZEN";
  const isCompleted = campaignStatus === "COMPLETED";

  // ── Recipient table state ──────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "phone" | "lastService" | "lastPrice">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showSkipped, setShowSkipped] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<(typeof recipientData.items)[0] | null>(null);
  const [undoQueue, setUndoQueue] = useState<Set<number>>(new Set());
  const PAGE_SIZE = 20;

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // ── Message editor state ───────────────────────────────────────────────────
  const [localMessage, setLocalMessage] = useState(messageTemplate);
  const [editingMessage, setEditingMessage] = useState(false);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setLocalMessage(messageTemplate); }, [messageTemplate]);

  const handleMessageChange = (val: string) => {
    setLocalMessage(val);
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      onMessageChange(val);
    }, 500);
  };

  // ── Test SMS state ─────────────────────────────────────────────────────────
  const [testPhone, setTestPhone] = useState("");
  const [testFirstName, setTestFirstName] = useState("");
  const [testSent, setTestSent] = useState(false);

  // ── Approval checklist ─────────────────────────────────────────────────────
  const [checklist, setChecklist] = useState({
    reviewedAudience: false,
    reviewedSms: false,
    sentTest: false,
    understands: false,
  });
  const allChecked = Object.values(checklist).every(Boolean);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: recipientData, isFetching } = trpc.smsCampaign.listRecipients.useQuery(
    {
      campaignId: campaignId!,
      page,
      pageSize: PAGE_SIZE,
      search: debouncedSearch || undefined,
      sortBy,
      sortDir,
      showSkipped,
    },
    { enabled: open && campaignId !== null, keepPreviousData: true }
  ) as { data: { items: Array<{ id: number; snapshotFirstName?: string | null; snapshotName?: string | null; phone: string; phoneNormalized: string; snapshotLastService?: string | null; snapshotLastPrice?: number | null; personalizedMessage: string; status: string; skipReason?: string | null; completedJobId: number }>, total: number, page: number, pageSize: number, manuallyExcludedCount: number }, isFetching: boolean };

  const totalPages = recipientData ? Math.ceil(recipientData.total / PAGE_SIZE) : 1;
  const manuallyExcluded = recipientData?.manuallyExcludedCount ?? 0;

  // ── Mutations ──────────────────────────────────────────────────────────────
  const skipMutation = trpc.smsCampaign.skipRecipient.useMutation({
    onSuccess: (_, vars) => {
      setUndoQueue((q) => new Set([...q, vars.recipientId]));
      utils.smsCampaign.listRecipients.invalidate({ campaignId: campaignId! });
      onCountChange(Math.max(0, frozenCount - 1));
      // Auto-clear undo after 8s
      setTimeout(() => setUndoQueue((q) => { const n = new Set(q); n.delete(vars.recipientId); return n; }), 8000);
    },
    onError: (err) => toast.error(err.message),
  });

  const unskipMutation = trpc.smsCampaign.unskipRecipient.useMutation({
    onSuccess: (_, vars) => {
      setUndoQueue((q) => { const n = new Set(q); n.delete(vars.recipientId); return n; });
      utils.smsCampaign.listRecipients.invalidate({ campaignId: campaignId! });
      onCountChange(frozenCount + 1);
    },
    onError: (err) => toast.error(err.message),
  });

  const markBookedMutation = trpc.smsCampaign.markBooked.useMutation({
    onSuccess: () => {
      utils.smsCampaign.listRecipients.invalidate({ campaignId: campaignId! });
      utils.smsCampaign.listCampaigns.invalidate();
      toast.success("Marked as booked ✓");
    },
    onError: (err) => toast.error(err.message),
  });

  const unmarkBookedMutation = trpc.smsCampaign.unmarkBooked.useMutation({
    onSuccess: () => {
      utils.smsCampaign.listRecipients.invalidate({ campaignId: campaignId! });
      utils.smsCampaign.listCampaigns.invalidate();
      toast.success("Booking mark removed");
    },
    onError: (err) => toast.error(err.message),
  });

  const testSmsMutation = trpc.smsCampaign.sendTestSms.useMutation({
    onSuccess: () => {
      setTestSent(true);
      setChecklist((c) => ({ ...c, sentTest: true }));
      toast.success(`Test SMS sent to ${testPhone}`);
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Personalized preview for selected recipient ────────────────────────────
  const previewName = (selectedRecipient?.snapshotFirstName ?? testFirstName) || "Customer";
  const previewMessage = localMessage
    .replace(/\{\{first_name\}\}/gi, previewName)
    .replace(/\{\{name\}\}/gi, previewName);

  // ── Sort toggle ────────────────────────────────────────────────────────────
  const toggleSort = useCallback((col: typeof sortBy) => {
    if (sortBy === col) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
    setPage(1);
  }, [sortBy]);

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return <ChevronUp className="w-3 h-3 text-gray-300" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3 text-indigo-500" /> : <ChevronDown className="w-3 h-3 text-indigo-500" />;
  };

  if (!open || !campaignId) return null;

  const planner = plannerResult;

  // ─── Status header ─────────────────────────────────────────────────────────
  const statusSteps = ["DRAFT", "FROZEN", "APPROVED", "READY TO SEND"];
  const currentStepIdx = campaignStatus === "FROZEN" ? 1 : campaignStatus === "APPROVED" ? 2 : 0;

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col overflow-hidden">
      {/* ── Top header ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <button
          onClick={onClose}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          title="Close review"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="text-base font-black text-gray-900 truncate">{campaignName}</h1>
          <p className="text-xs text-gray-400">Campaign Review · {frozenCount} recipients frozen</p>
        </div>

        {/* Status pipeline */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {statusSteps.map((step, i) => (
            <div key={step} className="flex items-center gap-1">
              <span className={[
                "px-2.5 py-1 rounded-full text-xs font-black border",
                i === currentStepIdx
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : i < currentStepIdx
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-gray-100 text-gray-400 border-gray-200"
              ].join(" ")}>
                {i < currentStepIdx && <CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />}
                {step}
              </span>
              {i < statusSteps.length - 1 && <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" />}
            </div>
          ))}
        </div>

        {/* Unfreeze button */}
        {isFrozen && (
          <Button
            variant="outline"
            size="sm"
            onClick={onUnfreeze}
            disabled={isUnfreezing}
            className="rounded-xl font-bold border-orange-300 text-orange-700 hover:bg-orange-50 flex-shrink-0"
          >
            {isUnfreezing
              ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Unfreezing…</span>
              : <span className="flex items-center gap-1.5"><LockOpen className="w-3.5 h-3.5" />Unfreeze</span>}
          </Button>
        )}
      </div>

      {/* ── Three-panel body ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT PANEL: Campaign Summary (35%) ──────────────────────────── */}
        <div className="w-[35%] flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto p-5 space-y-5">

          {/* Campaign summary stats */}
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3">Campaign Summary</h2>
            <div className="space-y-2">
              <SummaryRow label="Campaign" value={campaignName} bold />
              <SummaryRow label="Status" value={
                <span className={["px-2 py-0.5 rounded-full text-xs font-black border",
                  isFrozen ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                ].join(" ")}>{campaignStatus}</span>
              } />
              <SummaryRow label="Frozen Recipients" value={frozenCount.toLocaleString()} bold />
              {manuallyExcluded > 0 && (
                <SummaryRow label="Manually Excluded" value={
                  <span className="text-orange-600 font-bold">{manuallyExcluded} excluded</span>
                } />
              )}
              {planner && (
                <>
                  <SummaryRow label="Expected Replies" value={planner.summary.estimatedReplies.toLocaleString()} />
                  <SummaryRow label="Expected Bookings" value={planner.summary.estimatedBookings.toLocaleString()} />
                  <SummaryRow label="Estimated Revenue" value={`$${planner.summary.estimatedRevenue.toLocaleString()}`} />
                  <SummaryRow label="Average Ticket" value={`$${planner.summary.averageTicket}`} />
                  <SummaryRow label="Avg Days Since Booking" value={`${Math.round(planner.stats.avgDaysSinceLastBooking)} days`} />
                  <SummaryRow label="Former Recurring %" value={`${Math.round(planner.stats.recurringPercent)}%`} />
                  <SummaryRow label="Quality Score" value={
                    <span className={["px-2 py-0.5 rounded-full text-xs font-black border", gradeColor(planner.summary.qualityGrade)].join(" ")}>
                      {planner.summary.qualityGrade} · {planner.summary.qualityScore}/100
                    </span>
                  } />
                </>
              )}
            </div>
          </div>

          {/* Exclusion breakdown */}
          {planner && (
            <div>
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3">Exclusion Breakdown</h2>
              <div className="space-y-1.5">
                <ExclusionRow label="STOP / Opt-out" count={planner.exclusionBreakdown.stopOptOut} color="red" />
                <ExclusionRow label="Complaints" count={planner.exclusionBreakdown.openComplaint} color="orange" />
                <ExclusionRow label="Recently Contacted" count={planner.exclusionBreakdown.recentlyTexted} color="amber" />
                <ExclusionRow label="Invalid Phone" count={planner.exclusionBreakdown.invalidPhone} color="gray" />
                <ExclusionRow label="Duplicate" count={planner.exclusionBreakdown.duplicate} color="gray" />
                {manuallyExcluded > 0 && (
                  <ExclusionRow label="Manual Exclusions" count={manuallyExcluded} color="orange" />
                )}
              </div>
            </div>
          )}

          {/* Recipient inspector */}
          {selectedRecipient && (
            <div className="border border-indigo-200 rounded-2xl p-4 bg-indigo-50">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-black uppercase tracking-widest text-indigo-500">Inspector</h2>
                <button onClick={() => setSelectedRecipient(null)} className="text-indigo-300 hover:text-indigo-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-1.5">
                <SummaryRow label="Name" value={selectedRecipient.snapshotName ?? "—"} bold />
                <SummaryRow label="Phone" value={maskPhone(selectedRecipient.phone)} />
                <SummaryRow label="Last Service" value={selectedRecipient.snapshotLastService ?? "—"} />
                <SummaryRow label="Last Price" value={selectedRecipient.snapshotLastPrice !== null ? `$${selectedRecipient.snapshotLastPrice}` : "—"} />
                <SummaryRow label="Status" value={
                  <span className={["px-2 py-0.5 rounded-full text-xs font-bold",
                    selectedRecipient.status === "SKIPPED" ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700"
                  ].join(" ")}>{selectedRecipient.status}</span>
                } />
              </div>
              {/* Personalized message preview */}
              <div className="mt-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-1">Will Receive</p>
                <p className="text-xs text-gray-700 bg-white rounded-xl p-2 border border-indigo-100 leading-relaxed">
                  {selectedRecipient.personalizedMessage}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── CENTER PANEL: Recipient Table (45%) ─────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          {/* Table toolbar */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or phone…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showSkipped}
                onChange={(e) => { setShowSkipped(e.target.checked); setPage(1); }}
                className="rounded"
              />
              Show excluded
            </label>
            <span className="text-xs text-gray-400 ml-auto">
              {isFetching ? "Updating…" : `${recipientData?.total ?? 0} recipients`}
              {manuallyExcluded > 0 && <span className="ml-2 text-orange-500 font-semibold">· {manuallyExcluded} excluded</span>}
            </span>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-white z-10 border-b border-gray-200">
                <tr>
                  <th className="text-left py-2.5 px-3 text-xs font-black uppercase tracking-widest text-gray-400 w-8">#</th>
                  <SortableHeader label="Name" col="name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <SortableHeader label="Phone" col="phone" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <SortableHeader label="Last Service" col="lastService" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <SortableHeader label="Ticket" col="lastPrice" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <th className="text-left py-2.5 px-3 text-xs font-black uppercase tracking-widest text-gray-400">Status</th>
                  {(isFrozen || isCompleted) && <th className="py-2.5 px-3 w-16" />}
                </tr>
              </thead>
              <tbody>
                {!recipientData && isFetching ? (
                  <tr><td colSpan={7} className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin text-gray-300 mx-auto" /></td></tr>
                ) : recipientData?.items.length === 0 ? (
                  <tr><td colSpan={7} className="py-16 text-center text-gray-400 text-sm">No recipients found</td></tr>
                ) : recipientData?.items.map((r, idx) => {
                  const isSkipped = r.status === "SKIPPED";
                  const isBooked = r.status === "BOOKED";
                  const isSent = r.status === "SENT";
                  const justSkipped = undoQueue.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedRecipient(r)}
                      className={[
                        "border-b border-gray-50 cursor-pointer transition-colors",
                        isSkipped ? "opacity-40 bg-orange-50 hover:bg-orange-100" :
                        isBooked ? "bg-emerald-50 hover:bg-emerald-100" :
                        "hover:bg-indigo-50",
                        selectedRecipient?.id === r.id ? "bg-indigo-50 border-l-2 border-l-indigo-400" : "",
                      ].join(" ")}
                    >
                      <td className="py-2 px-3 text-gray-400 font-mono text-xs">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="py-2 px-3 font-semibold text-gray-900 max-w-[140px] truncate">
                        {r.snapshotName ?? "—"}
                      </td>
                      <td className="py-2 px-3 text-gray-500 font-mono text-xs">{maskPhone(r.phone)}</td>
                      <td className="py-2 px-3 text-gray-500 text-xs max-w-[120px] truncate">{r.snapshotLastService ?? "—"}</td>
                      <td className="py-2 px-3 text-gray-500 text-xs">{r.snapshotLastPrice !== null ? `$${r.snapshotLastPrice}` : "—"}</td>
                      <td className="py-2 px-3">
                        {isSkipped ? (
                          <span className="text-[10px] font-bold text-orange-500 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full">Excluded</span>
                        ) : isBooked ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-1.5 py-0.5 rounded-full">✓ Booked</span>
                        ) : isSent ? (
                          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">Sent</span>
                        ) : (
                          <span className="text-[10px] font-bold text-gray-500 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full">Pending</span>
                        )}
                      </td>
                      {isFrozen && (
                        <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                          {isSkipped ? (
                            <button
                              onClick={() => unskipMutation.mutate({ campaignId: campaignId!, recipientId: r.id })}
                              disabled={unskipMutation.isPending}
                              className="p-1 rounded-lg text-orange-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                              title="Undo exclusion"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => skipMutation.mutate({ campaignId: campaignId!, recipientId: r.id })}
                              disabled={skipMutation.isPending}
                              className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Exclude from campaign"
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      )}
                      {isCompleted && (
                        <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                          {isBooked ? (
                            <button
                              onClick={() => unmarkBookedMutation.mutate({ campaignId: campaignId!, recipientId: r.id })}
                              disabled={unmarkBookedMutation.isPending}
                              className="p-1 rounded-lg text-emerald-500 hover:text-gray-500 hover:bg-gray-50 transition-colors"
                              title="Undo booking mark"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          ) : isSent ? (
                            <button
                              onClick={() => markBookedMutation.mutate({ campaignId: campaignId!, recipientId: r.id })}
                              disabled={markBookedMutation.isPending}
                              className="p-1 rounded-lg text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                              title="Mark as booked"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-white">
              <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg h-7 px-2">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-lg h-7 px-2">
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL: SMS Preview + Checklist (20%) ──────────────────── */}
        <div className="w-[22%] flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto flex flex-col">

          {/* SMS Preview */}
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5" />
              SMS Preview
              {selectedRecipient && (
                <span className="ml-1 text-indigo-500 font-bold normal-case">
                  · {selectedRecipient.snapshotFirstName ?? selectedRecipient.snapshotName?.split(" ")[0] ?? "Customer"}
                </span>
              )}
            </h2>
            <PhoneMockup message={previewMessage} />
          </div>

          {/* Message editor */}
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                <Pencil className="w-3.5 h-3.5" />
                Message
              </h2>
              <span className="text-[10px] text-gray-400">{localMessage.length}/160</span>
            </div>
            <Textarea
              value={localMessage}
              onChange={(e) => handleMessageChange(e.target.value)}
              rows={5}
              className="text-xs rounded-xl border-gray-200 resize-none focus:border-indigo-400"
              placeholder="Your SMS message…"
            />
            <p className="text-[10px] text-gray-400 mt-1">Auto-saves · Use {"{{first_name}}"} for personalization</p>
          </div>

          {/* Test SMS */}
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" />
              Test SMS
              {testSent && <span className="ml-1 text-emerald-500">✓ Sent</span>}
            </h2>
            <div className="space-y-2">
              <input
                value={testFirstName}
                onChange={(e) => setTestFirstName(e.target.value)}
                placeholder="First name (for preview)"
                className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-xl outline-none focus:border-indigo-400"
              />
              <input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="Phone number"
                className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-xl outline-none focus:border-indigo-400"
              />
              <Button
                size="sm"
                onClick={() => testSmsMutation.mutate({ campaignId: campaignId!, testPhone, testFirstName })}
                disabled={testSmsMutation.isPending || !testPhone.trim() || !testFirstName.trim()}
                className="w-full rounded-xl font-bold text-xs h-8 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {testSmsMutation.isPending
                  ? <span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Sending…</span>
                  : <span className="flex items-center gap-1.5"><Send className="w-3 h-3" />Send Test</span>}
              </Button>
            </div>
          </div>

          {/* Approval checklist */}
          {isFrozen && (
            <div className="p-4 flex-1">
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Approval Checklist
              </h2>
              <div className="space-y-2.5 mb-4">
                <ChecklistItem
                  checked={checklist.reviewedAudience}
                  onChange={(v) => setChecklist((c) => ({ ...c, reviewedAudience: v }))}
                  label="I reviewed the audience"
                />
                <ChecklistItem
                  checked={checklist.reviewedSms}
                  onChange={(v) => setChecklist((c) => ({ ...c, reviewedSms: v }))}
                  label="I reviewed the SMS message"
                />
                <ChecklistItem
                  checked={checklist.sentTest}
                  onChange={(v) => setChecklist((c) => ({ ...c, sentTest: v }))}
                  label="I sent a test message"
                />
                <ChecklistItem
                  checked={checklist.understands}
                  onChange={(v) => setChecklist((c) => ({ ...c, understands: v }))}
                  label={`I understand ${frozenCount} customers will receive this SMS`}
                />
              </div>

              <Button
                onClick={onApprove}
                disabled={!allChecked || isApproving || frozenCount === 0}
                className={[
                  "w-full rounded-xl font-black h-10 transition-all",
                  allChecked && frozenCount > 0
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                ].join(" ")}
              >
                {isApproving
                  ? <span className="flex items-center gap-1.5 justify-center"><Loader2 className="w-4 h-4 animate-spin" />Approving…</span>
                  : <span className="flex items-center gap-1.5 justify-center"><CheckCircle2 className="w-4 h-4" />Approve {frozenCount} Recipients</span>}
              </Button>

              {!allChecked && (
                <p className="text-[10px] text-gray-400 text-center mt-2">Complete all 4 checks to approve</p>
              )}
            </div>
          )}

          {/* Already approved state */}
          {!isFrozen && campaignStatus === "APPROVED" && (
            <div className="p-4 flex-1 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="font-black text-gray-900">Campaign Approved</p>
                <p className="text-xs text-gray-400 mt-0.5">Ready to send {frozenCount} messages</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryRow({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-gray-50">
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <span className={["text-xs text-right", bold ? "font-black text-gray-900" : "text-gray-700"].join(" ")}>
        {value}
      </span>
    </div>
  );
}

function ExclusionRow({ label, count, color }: { label: string; count: number; color: "red" | "orange" | "amber" | "gray" }) {
  const colors = {
    red: "bg-red-100 text-red-700",
    orange: "bg-orange-100 text-orange-700",
    amber: "bg-amber-100 text-amber-700",
    gray: "bg-gray-100 text-gray-600",
  };
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-gray-600">{label}</span>
      <span className={["text-xs font-black px-2 py-0.5 rounded-full", colors[color]].join(" ")}>
        {count}
      </span>
    </div>
  );
}

function SortableHeader({
  label, col, sortBy, sortDir, onSort,
}: {
  label: string;
  col: "name" | "phone" | "lastService" | "lastPrice";
  sortBy: string;
  sortDir: string;
  onSort: (col: "name" | "phone" | "lastService" | "lastPrice") => void;
}) {
  return (
    <th
      className="text-left py-2.5 px-3 text-xs font-black uppercase tracking-widest text-gray-400 cursor-pointer hover:text-gray-600 select-none"
      onClick={() => onSort(col)}
    >
      <span className="flex items-center gap-1">
        {label}
        {sortBy === col
          ? sortDir === "asc" ? <ChevronUp className="w-3 h-3 text-indigo-500" /> : <ChevronDown className="w-3 h-3 text-indigo-500" />
          : <ChevronUp className="w-3 h-3 text-gray-200" />}
      </span>
    </th>
  );
}

function ChecklistItem({
  checked, onChange, label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer group">
      <div
        className={[
          "w-4 h-4 rounded flex-shrink-0 mt-0.5 border-2 flex items-center justify-center transition-all",
          checked ? "bg-emerald-500 border-emerald-500" : "border-gray-300 group-hover:border-indigo-400",
        ].join(" ")}
        onClick={() => onChange(!checked)}
      >
        {checked && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
      </div>
      <span className={["text-xs leading-relaxed", checked ? "text-gray-500 line-through" : "text-gray-700"].join(" ")}>
        {label}
      </span>
    </label>
  );
}
