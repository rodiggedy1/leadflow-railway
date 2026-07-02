/**
 * IssueEngineOverlay — two-column issue management overlay.
 * Design matches the mockup: clean white bg, left list with emoji+title+subtitle,
 * right panel with large title, Owner/WaitingOn/AIConfidence cards, orange dot
 * timeline, warm beige AI Recommendation block, Open Chat / Assign / Resolve buttons.
 */
import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCheck, Flame, X } from "lucide-react";
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

const ISSUE_TYPE_META: Record<IssueType, { emoji: string; label: string }> = {
  late_team:          { emoji: "🚗", label: "Team Late" },
  refund_request:     { emoji: "💰", label: "Refund" },
  angry_customer:     { emoji: "😡", label: "Angry Client" },
  no_show:            { emoji: "🚫", label: "No Show" },
  access_problem:     { emoji: "🔑", label: "Access" },
  payment_problem:    { emoji: "💳", label: "Payment" },
  reschedule_needed:  { emoji: "📅", label: "Reschedule" },
  broken_item:        { emoji: "📦", label: "Supplies" },
  manager_review:     { emoji: "👔", label: "Manager Review" },
  internal_task:      { emoji: "📋", label: "Internal Task" },
  other:              { emoji: "📌", label: "Other" },
};

function formatTime(ts: number | Date): string {
  const d = typeof ts === "number" ? new Date(ts) : ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(ts: number | Date): string {
  const ms = typeof ts === "number" ? ts : ts.getTime();
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} overdue`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Left list item ─────────────────────────────────────────────────────────────

function IssueListItem({ issue, selected, onClick }: { issue: IssueRow; selected: boolean; onClick: () => void }) {
  const meta = ISSUE_TYPE_META[issue.issueType];
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3.5 rounded-2xl mb-2 border transition-all",
        selected
          ? "bg-white border-orange-200 shadow-sm"
          : "bg-transparent border-transparent hover:bg-white/80"
      )}
    >
      <p className="text-sm font-bold text-slate-900">
        {meta.emoji} {meta.label}
      </p>
      <p className="text-xs text-slate-500 mt-0.5 truncate">{issue.title}</p>
    </button>
  );
}

// ── Right detail panel ─────────────────────────────────────────────────────────

function DetailPanel({
  issue,
  callerName,
  agentPhotoMap,
  onResolve,
  onReopen,
  resolving,
  reopening,
  onUpdate,
  onAddNote,
}: {
  issue: IssueRow & { timeline: TimelineRow[] };
  callerName: string;
  agentPhotoMap: Record<string, string | null>;
  onResolve: () => void;
  onReopen: () => void;
  resolving: boolean;
  reopening: boolean;
  onUpdate: (fields: Partial<{ ownerName: string; waitingOn: string; severity: IssueSeverity }>) => void;
  onAddNote: (note: string) => void;
}) {
  const [noteInput, setNoteInput] = useState("");
  const meta = ISSUE_TYPE_META[issue.issueType];

  return (
    <div className="flex-1 overflow-y-auto px-8 py-7" style={{ scrollbarWidth: "none" }}>
      {/* Current focus label */}
      <p className="text-[11px] tracking-[.2em] uppercase text-slate-400 font-semibold">Current Focus</p>

      {/* Title */}
      <h2 className="text-3xl font-black text-slate-900 mt-1 leading-tight">{issue.title}</h2>
      <p className="text-sm text-slate-500 mt-1">{timeAgo(issue.lastActivityAt)}</p>

      {/* Meta cards row */}
      <div className="grid grid-cols-3 gap-3 mt-6">
        {/* Owner */}
        <div className="border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-2">Owner</p>
          <div className="flex items-center gap-2.5">
            {issue.ownerName && agentPhotoMap[issue.ownerName] ? (
              <img
                src={agentPhotoMap[issue.ownerName]!}
                alt={issue.ownerName}
                className="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-white shadow-sm"
              />
            ) : issue.ownerName ? (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center shrink-0 shadow-sm">
                <span className="text-white text-xs font-bold">{issue.ownerName.charAt(0).toUpperCase()}</span>
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                <span className="text-slate-400 text-xs">?</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="font-bold text-slate-900 text-sm leading-tight">{issue.ownerName ?? "Unassigned"}</p>
              {issue.ownerName !== callerName && (
                <button
                  onClick={() => onUpdate({ ownerName: callerName })}
                  className="text-[11px] text-blue-500 hover:underline"
                >
                  Claim
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Waiting On */}
        <div className="border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">Waiting On</p>
          <p className="font-bold text-slate-900 text-sm">{issue.waitingOn ?? "—"}</p>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {["Customer", "Office", "Cleaner"].map((w) => (
              <button
                key={w}
                onClick={() => onUpdate({ waitingOn: w })}
                className={cn(
                  "text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-all",
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
        {/* AI Confidence — placeholder for Phase 2 */}
        <div className="border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-1">AI Confidence</p>
          <p className="font-bold text-slate-900 text-sm">—</p>
          <p className="text-[10px] text-slate-400 mt-1">Phase 2</p>
        </div>
      </div>

      {/* Timeline */}
      <div className="mt-7">
        <p className="font-bold text-slate-900 mb-4">Timeline</p>
        <div className="space-y-3">
          {(issue.timeline ?? []).map((e) => (
            <div key={e.id} className="flex items-start gap-3">
              <div className="mt-1.5 w-2.5 h-2.5 rounded-full bg-orange-400 shrink-0" />
              <p className="text-sm text-slate-700">
                <span className="font-medium">{formatTime(e.createdAt)}</span>{" "}
                {e.event}
              </p>
            </div>
          ))}
          {(issue.timeline ?? []).length === 0 && (
            <p className="text-xs text-slate-400 italic">No timeline events yet.</p>
          )}
        </div>
      </div>

      {/* Add note input */}
      <div className="flex gap-2 mt-5">
        <Input
          placeholder="Add a note to timeline…"
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && noteInput.trim()) {
              e.preventDefault();
              onAddNote(noteInput.trim());
              setNoteInput("");
            }
          }}
          className="flex-1 text-sm rounded-full border-slate-200"
        />
      </div>

      {/* AI Recommendation block */}
      <div className="mt-6 rounded-2xl p-5" style={{ background: "linear-gradient(135deg, #fef9f0 0%, #fef3e2 100%)", border: "1px solid #fde8c0" }}>
        <p className="text-xs font-bold tracking-[.15em] uppercase text-orange-500 mb-2">AI Recommendation</p>
        <p className="text-sm font-semibold text-slate-900">
          {issue.notes ?? "No recommendation yet — AI detection coming in Phase 2."}
        </p>

        {/* Action buttons */}
        <div className="flex gap-2 mt-4 flex-wrap">
          <button className="px-5 py-2 rounded-full bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 transition-colors">
            Open Chat
          </button>
          <button
            onClick={() => onUpdate({ ownerName: callerName })}
            className="px-5 py-2 rounded-full bg-white border border-slate-200 text-slate-900 text-sm font-semibold hover:border-slate-400 transition-colors"
          >
            Assign
          </button>
          {issue.status !== "resolved" ? (
            <button
              onClick={onResolve}
              disabled={resolving}
              className="px-5 py-2 rounded-full bg-white border border-emerald-300 text-emerald-600 text-sm font-semibold hover:bg-emerald-50 transition-colors disabled:opacity-50"
            >
              {resolving ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}
              Resolve
            </button>
          ) : (
            <button
              onClick={onReopen}
              disabled={reopening}
              className="px-5 py-2 rounded-full bg-white border border-slate-200 text-slate-600 text-sm font-semibold hover:border-slate-400 transition-colors disabled:opacity-50"
            >
              Reopen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────

interface IssueEngineOverlayProps {
  open: boolean;
  onClose: () => void;
  callerName: string;
  agentPhotoMap?: Record<string, string | null>;
}

export function IssueEngineOverlay({ open, onClose, callerName, agentPhotoMap = {} }: IssueEngineOverlayProps) {
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<"open" | "waiting" | "resolved" | "all">("open");

  const { data: issues = [], isLoading } = trpc.opsChat.listIssues.useQuery(
    { status: statusFilter },
    { enabled: open, refetchInterval: 15_000 }
  );
  const { data: selectedIssue, isLoading: detailLoading } = trpc.opsChat.getIssue.useQuery(
    { id: selectedId! },
    { enabled: open && selectedId !== null, refetchInterval: 10_000 }
  );

  // Auto-select first issue when list loads
  useEffect(() => {
    if (issues.length > 0 && selectedId === null) {
      setSelectedId((issues as IssueRow[])[0].id);
    }
  }, [issues, selectedId]);

  const handleIssueClick = useCallback((id: number) => setSelectedId(id), []);

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
      <DialogContent
        className="p-0 overflow-hidden rounded-3xl border-0 shadow-2xl"
        style={{ maxWidth: "860px", width: "90vw", maxHeight: "80vh", background: "#f8f9fb" }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-1.5 rounded-full bg-white/80 hover:bg-white text-slate-400 hover:text-slate-700 transition-colors shadow-sm"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="grid h-full" style={{ gridTemplateColumns: "240px 1fr", minHeight: "500px", maxHeight: "80vh" }}>
          {/* Left: issue list */}
          <div className="bg-[#f0f2f5] rounded-l-3xl p-4 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            {/* Status filter tabs */}
            <div className="flex gap-1 mb-4 flex-wrap">
              {(["open", "waiting", "resolved"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setSelectedId(null); }}
                  className={cn(
                    "text-[10px] font-bold px-2.5 py-1 rounded-full capitalize transition-all",
                    statusFilter === s
                      ? "bg-slate-900 text-white"
                      : "bg-white/60 text-slate-500 hover:bg-white"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="flex justify-center pt-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
            ) : (issues as IssueRow[]).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <CheckCheck className="h-8 w-8 opacity-30" />
                <p className="text-xs font-medium">No {statusFilter} issues</p>
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

          {/* Right: detail */}
          <div className="bg-white rounded-r-3xl overflow-y-auto flex flex-col" style={{ scrollbarWidth: "none" }}>
            {!selectedId ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 text-slate-400 py-20">
                <Flame className="h-8 w-8 opacity-20" />
                <p className="text-sm font-medium">Select an issue</p>
              </div>
            ) : detailLoading ? (
              <div className="flex justify-center pt-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
            ) : !issue ? (
              <div className="flex justify-center pt-12 text-slate-400 text-sm">Issue not found</div>
            ) : (
              <DetailPanel
                issue={issue}
                callerName={callerName}
                agentPhotoMap={agentPhotoMap}
                onResolve={() => resolveMutation.mutate({ id: issue.id, actorName: callerName })}
                onReopen={() => reopenMutation.mutate({ id: issue.id, actorName: callerName })}
                resolving={resolveMutation.isPending}
                reopening={reopenMutation.isPending}
                onUpdate={(fields) => updateMutation.mutate({ id: issue.id, actorName: callerName, ...fields })}
                onAddNote={(note) => addEventMutation.mutate({ issueId: issue.id, event: note, actor: callerName })}
              />
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
      <DialogContent className="max-w-md rounded-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Flame className="h-5 w-5 text-orange-500" />
          <h2 className="text-lg font-black text-slate-900">New Issue</h2>
        </div>
        <div className="space-y-3">
          <Input
            placeholder="Issue title (required)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="rounded-xl"
          />
          <Select value={issueType} onValueChange={(v) => setIssueType(v as IssueType)}>
            <SelectTrigger className="rounded-xl">
              <SelectValue placeholder="Issue type" />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(ISSUE_TYPE_META) as [IssueType, { emoji: string; label: string }][]).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.emoji} {v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={(v) => setSeverity(v as IssueSeverity)}>
            <SelectTrigger className="rounded-xl">
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
            className="resize-none rounded-xl"
          />
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full border border-slate-200 text-slate-600 text-sm font-semibold hover:border-slate-400 transition-colors"
          >
            Cancel
          </button>
          <button
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
            className="px-5 py-2 rounded-full bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}
            Create Issue
          </button>
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

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 bg-white border border-slate-200 rounded-full px-3.5 py-1.5 font-bold text-sm shadow-sm hover:border-orange-300 hover:shadow-md transition-all shrink-0"
    >
      <Flame className="h-4 w-4 text-orange-500" />
      <span className="text-slate-800">{count} {count === 1 ? "Issue" : "Issues"}</span>
    </button>
  );
}
