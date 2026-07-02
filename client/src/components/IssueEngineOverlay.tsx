/**
 * IssueEngineOverlay — two-column issue management overlay.
 * Left: issue list with severity badges + status chips.
 * Right: selected issue detail with timeline, owner, waiting-on, and actions.
 */
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCheck, Plus, ChevronRight, Clock, User, AlertTriangle, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type IssueStatus = "open" | "waiting" | "resolved";
type IssueSeverity = "critical" | "high" | "medium" | "low";
type IssueType =
  | "late_team" | "refund_request" | "angry_customer" | "no_show"
  | "access_problem" | "payment_problem" | "reschedule_needed"
  | "broken_item" | "manager_review" | "internal_task" | "other";

interface IssueRow {
  id: number;
  title: string;
  issueType: IssueType;
  severity: IssueSeverity;
  status: IssueStatus;
  ownerName: string | null;
  waitingOn: string | null;
  notes: string | null;
  relatedSessionId: number | null;
  relatedJobId: number | null;
  createdByName: string;
  lastActivityAt: number;
  createdAt: Date;
  resolvedAt: number | null;
}

interface TimelineRow {
  id: number;
  issueId: number;
  event: string;
  actor: string;
  createdAt: Date;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  late_team: "🚗 Team Late",
  refund_request: "💰 Refund",
  angry_customer: "😡 Angry Customer",
  no_show: "🚫 No Show",
  access_problem: "🔑 Access Problem",
  payment_problem: "💳 Payment Problem",
  reschedule_needed: "📅 Reschedule",
  broken_item: "🔨 Broken Item",
  manager_review: "👔 Manager Review",
  internal_task: "📋 Internal Task",
  other: "📌 Other",
};

const SEVERITY_COLORS: Record<IssueSeverity, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
};

const STATUS_COLORS: Record<IssueStatus, string> = {
  open: "bg-red-50 text-red-600",
  waiting: "bg-amber-50 text-amber-600",
  resolved: "bg-emerald-50 text-emerald-600",
};

function timeAgo(ts: number | Date): string {
  const ms = typeof ts === "number" ? ts : ts.getTime();
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function IssueListItem({
  issue,
  selected,
  onClick,
}: {
  issue: IssueRow;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3.5 rounded-2xl mb-2 border transition-all",
        selected
          ? "bg-white border-orange-200 shadow-md"
          : "bg-transparent border-transparent hover:bg-white/70 hover:border-slate-200"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800 truncate">{ISSUE_TYPE_LABELS[issue.issueType]}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{issue.title}</p>
        </div>
        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 capitalize", SEVERITY_COLORS[issue.severity])}>
          {issue.severity}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize", STATUS_COLORS[issue.status])}>
          {issue.status}
        </span>
        <span className="text-[10px] text-slate-400">{timeAgo(issue.lastActivityAt)}</span>
        {issue.ownerName && (
          <span className="text-[10px] text-slate-400 ml-auto truncate">👤 {issue.ownerName}</span>
        )}
      </div>
    </button>
  );
}

function TimelineFeed({ events }: { events: TimelineRow[] }) {
  return (
    <div className="space-y-3">
      {events.map((e) => (
        <div key={e.id} className="flex gap-3">
          <div className="mt-1.5 w-2 h-2 rounded-full bg-orange-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-700">{e.event}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {e.actor} · {timeAgo(e.createdAt)}
            </p>
          </div>
        </div>
      ))}
      {events.length === 0 && (
        <p className="text-xs text-slate-400 italic">No timeline events yet.</p>
      )}
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────

interface IssueEngineOverlayProps {
  open: boolean;
  onClose: () => void;
  callerName: string;
}

export function IssueEngineOverlay({ open, onClose, callerName }: IssueEngineOverlayProps) {
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<"open" | "waiting" | "resolved" | "all">("open");
  const [noteInput, setNoteInput] = useState("");

  // Queries
  const { data: issues = [], isLoading } = trpc.opsChat.listIssues.useQuery(
    { status: statusFilter },
    { enabled: open, refetchInterval: 15_000 }
  );
  const { data: selectedIssue, isLoading: detailLoading } = trpc.opsChat.getIssue.useQuery(
    { id: selectedId! },
    { enabled: open && selectedId !== null, refetchInterval: 10_000 }
  );

  // Auto-select first issue when list loads
  const handleIssueClick = useCallback((id: number) => {
    setSelectedId(id);
    setNoteInput("");
  }, []);

  // Mutations
  const resolveMutation = trpc.opsChat.resolveIssueEngine.useMutation({
    onSuccess: () => {
      toast.success("Issue resolved");
      utils.opsChat.listIssues.invalidate();
      utils.opsChat.countOpenIssues.invalidate();
      if (selectedId) utils.opsChat.getIssue.invalidate({ id: selectedId });
    },
    onError: (e) => toast.error("Failed to resolve", { description: e.message }),
  });
  const reopenMutation = trpc.opsChat.reopenIssue.useMutation({
    onSuccess: () => {
      toast.success("Issue reopened");
      utils.opsChat.listIssues.invalidate();
      utils.opsChat.countOpenIssues.invalidate();
      if (selectedId) utils.opsChat.getIssue.invalidate({ id: selectedId });
    },
    onError: (e) => toast.error("Failed to reopen", { description: e.message }),
  });
  const addEventMutation = trpc.opsChat.addIssueTimelineEvent.useMutation({
    onSuccess: () => {
      setNoteInput("");
      if (selectedId) utils.opsChat.getIssue.invalidate({ id: selectedId });
      utils.opsChat.listIssues.invalidate();
    },
    onError: (e) => toast.error("Failed to add note", { description: e.message }),
  });
  const updateMutation = trpc.opsChat.updateIssue.useMutation({
    onSuccess: () => {
      if (selectedId) utils.opsChat.getIssue.invalidate({ id: selectedId });
      utils.opsChat.listIssues.invalidate();
    },
  });

  const issue = selectedIssue as (IssueRow & { timeline: TimelineRow[] }) | null | undefined;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl w-full p-0 overflow-hidden rounded-3xl" style={{ maxHeight: "85vh" }}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Flame className="h-5 w-5 text-orange-500" />
            <DialogTitle className="text-lg font-black text-slate-900">Issue Engine</DialogTitle>
            <div className="flex gap-1.5">
              {(["open", "waiting", "resolved", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setSelectedId(null); }}
                  className={cn(
                    "text-[11px] font-semibold px-3 py-1 rounded-full capitalize transition-all",
                    statusFilter === s
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="grid overflow-hidden" style={{ gridTemplateColumns: "280px 1fr", height: "calc(85vh - 73px)" }}>
          {/* Left: Issue list */}
          <div className="bg-slate-50 border-r border-slate-100 p-3 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            {isLoading ? (
              <div className="flex justify-center pt-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
            ) : issues.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <CheckCheck className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium">No {statusFilter === "all" ? "" : statusFilter} issues</p>
              </div>
            ) : (
              (issues as IssueRow[]).map((iss) => (
                <IssueListItem
                  key={iss.id}
                  issue={iss}
                  selected={selectedId === iss.id}
                  onClick={() => handleIssueClick(iss.id)}
                />
              ))
            )}
          </div>

          {/* Right: Detail panel */}
          <div className="flex flex-col overflow-hidden bg-white">
            {!selectedId ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 text-slate-400">
                <ChevronRight className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium">Select an issue to view details</p>
              </div>
            ) : detailLoading ? (
              <div className="flex justify-center pt-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
            ) : !issue ? (
              <div className="flex justify-center pt-12 text-slate-400 text-sm">Issue not found</div>
            ) : (
              <div className="flex-1 overflow-y-auto px-6 py-5" style={{ scrollbarWidth: "none" }}>
                {/* Title */}
                <p className="text-[10px] tracking-[.25em] uppercase text-slate-400 font-bold">Current Focus</p>
                <h2 className="text-2xl font-black text-slate-900 mt-1 leading-tight">{issue.title}</h2>
                <p className="text-sm text-slate-500 mt-1">{ISSUE_TYPE_LABELS[issue.issueType]}</p>

                {/* Meta cards */}
                <div className="grid grid-cols-3 gap-3 mt-5">
                  <div className="p-3.5 rounded-2xl bg-slate-50">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide flex items-center gap-1"><User className="h-3 w-3" /> Owner</p>
                    <p className="font-bold text-slate-800 mt-1 text-sm">{issue.ownerName ?? "Unassigned"}</p>
                    <button
                      onClick={() => updateMutation.mutate({ id: issue.id, ownerName: callerName, actorName: callerName })}
                      className="text-[10px] text-blue-500 hover:underline mt-1"
                    >
                      {issue.ownerName === callerName ? "✓ You" : "Claim"}
                    </button>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-50">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide flex items-center gap-1"><Clock className="h-3 w-3" /> Waiting On</p>
                    <p className="font-bold text-slate-800 mt-1 text-sm">{issue.waitingOn ?? "—"}</p>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {["Customer", "Office", "Cleaner"].map((w) => (
                        <button
                          key={w}
                          onClick={() => updateMutation.mutate({ id: issue.id, waitingOn: w, actorName: callerName })}
                          className={cn(
                            "text-[9px] font-semibold px-1.5 py-0.5 rounded-full border transition-all",
                            issue.waitingOn === w
                              ? "bg-slate-900 text-white border-slate-900"
                              : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                          )}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-50">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Severity</p>
                    <p className={cn("font-bold mt-1 text-sm capitalize px-2 py-0.5 rounded-full inline-block", SEVERITY_COLORS[issue.severity])}>{issue.severity}</p>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {(["low", "medium", "high", "critical"] as IssueSeverity[]).map((s) => (
                        <button
                          key={s}
                          onClick={() => updateMutation.mutate({ id: issue.id, severity: s, actorName: callerName })}
                          className={cn(
                            "text-[9px] font-semibold px-1.5 py-0.5 rounded-full border transition-all capitalize",
                            issue.severity === s
                              ? "bg-slate-900 text-white border-slate-900"
                              : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Notes */}
                {issue.notes && (
                  <div className="mt-4 p-3.5 rounded-2xl bg-amber-50 border border-amber-100">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 mb-1">Notes</p>
                    <p className="text-sm text-slate-700">{issue.notes}</p>
                  </div>
                )}

                {/* Timeline */}
                <div className="mt-6">
                  <p className="font-bold text-slate-800 mb-3 text-sm">Timeline</p>
                  <TimelineFeed events={issue.timeline ?? []} />
                </div>

                {/* Add note */}
                <div className="mt-5 flex gap-2">
                  <Input
                    placeholder="Add a timeline note…"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && noteInput.trim()) {
                        e.preventDefault();
                        addEventMutation.mutate({ issueId: issue.id, event: noteInput.trim(), actor: callerName });
                      }
                    }}
                    className="flex-1 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!noteInput.trim() || addEventMutation.isPending}
                    onClick={() => addEventMutation.mutate({ issueId: issue.id, event: noteInput.trim(), actor: callerName })}
                  >
                    {addEventMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  </Button>
                </div>

                {/* Actions */}
                <div className="mt-5 flex gap-2 flex-wrap">
                  {issue.status !== "resolved" ? (
                    <Button
                      className="bg-emerald-600 text-white hover:bg-emerald-700 rounded-full"
                      size="sm"
                      disabled={resolveMutation.isPending}
                      onClick={() => resolveMutation.mutate({ id: issue.id, actorName: callerName })}
                    >
                      {resolveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : "✓ "}
                      Resolve
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      disabled={reopenMutation.isPending}
                      onClick={() => reopenMutation.mutate({ id: issue.id, actorName: callerName })}
                    >
                      Reopen
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => updateMutation.mutate({ id: issue.id, ownerName: callerName, actorName: callerName })}
                  >
                    Assign to Me
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Issue Modal ────────────────────────────────────────────────────────

interface CreateIssueModalProps {
  open: boolean;
  onClose: () => void;
  callerName: string;
  defaultTitle?: string;
}

export function CreateIssueModal({ open, onClose, callerName, defaultTitle = "" }: CreateIssueModalProps) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(defaultTitle);
  const [issueType, setIssueType] = useState<IssueType>("other");
  const [severity, setSeverity] = useState<IssueSeverity>("medium");
  const [notes, setNotes] = useState("");

  const createMutation = trpc.opsChat.createIssue.useMutation({
    onSuccess: () => {
      toast.success("Issue created");
      utils.opsChat.listIssues.invalidate();
      utils.opsChat.countOpenIssues.invalidate();
      setTitle(""); setIssueType("other"); setSeverity("medium"); setNotes("");
      onClose();
    },
    onError: (e) => toast.error("Failed to create issue", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-500" />
            Create Issue
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <Input
            placeholder="Issue title (required)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <Select value={issueType} onValueChange={(v) => setIssueType(v as IssueType)}>
            <SelectTrigger>
              <SelectValue placeholder="Issue type" />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(ISSUE_TYPE_LABELS) as [IssueType, string][]).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={(v) => setSeverity(v as IssueSeverity)}>
            <SelectTrigger>
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-orange-500 text-white hover:bg-orange-600"
            disabled={!title.trim() || createMutation.isPending}
            onClick={() =>
              createMutation.mutate({
                title: title.trim(),
                issueType,
                severity,
                notes: notes.trim() || undefined,
                createdByName: callerName,
              })
            }
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Flame className="h-4 w-4 mr-2" />}
            Create Issue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Active Issues Pill ────────────────────────────────────────────────────────

interface ActiveIssuesPillProps {
  onClick: () => void;
}

export function ActiveIssuesPill({ onClick }: ActiveIssuesPillProps) {
  const { data: count = 0 } = trpc.opsChat.countOpenIssues.useQuery(
    undefined,
    { refetchInterval: 30_000 }
  );

  if (count === 0) return null;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 bg-white border border-slate-200 rounded-full px-3.5 py-1.5 font-bold text-sm shadow-sm hover:border-orange-300 hover:shadow-md transition-all shrink-0"
    >
      <Flame className="h-4 w-4 text-orange-500" />
      <span className="text-slate-800">{count} Active {count === 1 ? "Issue" : "Issues"}</span>
    </button>
  );
}
