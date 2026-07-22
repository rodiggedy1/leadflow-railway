/**
 * IssueEngineOverlay — two-column issue management overlay.
 * Design matches the mockup: clean white bg, left list with emoji+title+subtitle,
 * right panel with large title, Assignee/WaitingOn/Severity cards, orange dot
 * timeline, warm beige AI Recommendation block, Open Chat / Assign / Resolve buttons.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCheck, Flame, X, ChevronDown, User, Search, Calendar, Users, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getCustomerAvatarUrl, getTeamAvatarUrl } from "@/lib/customerAvatar";

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

// ── Waiting Toggle ───────────────────────────────────────────────────────────

const WAITING_PARTIES = ["Customer", "Office", "Cleaner"] as const;
type WaitingParty = typeof WAITING_PARTIES[number];

function WaitingToggle({
  waitingOn,
  onSet,
  onClear,
}: {
  waitingOn: string | null;
  onSet: (party: WaitingParty) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isWaiting = !!waitingOn;

  const partyColor: Record<WaitingParty, string> = {
    Customer: "text-orange-600",
    Office:   "text-blue-600",
    Cleaner:  "text-emerald-600",
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          if (isWaiting) { onClear(); } else { setOpen(v => !v); }
        }}
        className={cn(
          "flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold border transition-colors",
          isWaiting
            ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
            : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
        )}
        title={isWaiting ? `Waiting on ${waitingOn} — click to clear` : "Mark as waiting"}
      >
        <Clock className="h-3.5 w-3.5" />
        {isWaiting ? (
          <span>Waiting · <span className={cn("font-bold", partyColor[waitingOn as WaitingParty] ?? "text-amber-700")}>{waitingOn}</span></span>
        ) : (
          "Waiting"
        )}
      </button>

      {/* Party picker dropdown */}
      {open && !isWaiting && (
        <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden min-w-[130px]">
          {WAITING_PARTIES.map((party) => (
            <button
              key={party}
              onClick={() => { onSet(party); setOpen(false); }}
              className={cn(
                "w-full text-left px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 transition-colors",
                partyColor[party]
              )}
            >
              {party}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Right detail panel ─────────────────────────────────────────────────────────

function DetailPanel({
  issue,
  callerName,
  agentPhotoMap,
  agentList,
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
  agentList: AgentEntry[];
  onResolve: () => void;
  onReopen: () => void;
  resolving: boolean;
  reopening: boolean;
  onUpdate: (fields: Partial<{ ownerName: string | null; waitingOn: string | null; severity: IssueSeverity }>) => void;
  onAddNote: (note: string) => void;
}) {
  const [noteInput, setNoteInput] = useState("");
  const meta = ISSUE_TYPE_META[issue.issueType];

  return (
    <div className="flex-1 overflow-y-auto px-8 py-7" style={{ scrollbarWidth: "none" }}>
      {/* Header row: label + resolve button */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] tracking-[.2em] uppercase text-slate-400 font-semibold">Current Focus</p>
          <h2 className="text-3xl font-black text-slate-900 mt-1 leading-tight">{issue.title}</h2>
          <p className="text-sm text-slate-500 mt-1">{timeAgo(issue.lastActivityAt)}</p>
        </div>
        <div className="shrink-0 pt-1 flex items-center gap-2">
          {/* Waiting toggle — only shown for non-resolved issues */}
          {issue.status !== "resolved" && (
            <WaitingToggle
              waitingOn={issue.waitingOn}
              onSet={(party) => onUpdate({ waitingOn: party })}
              onClear={() => onUpdate({ waitingOn: null })}
            />
          )}
          {issue.status !== "resolved" ? (
            <button
              onClick={onResolve}
              disabled={resolving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
              {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
              Resolve
            </button>
          ) : (
            <button
              onClick={onReopen}
              disabled={reopening}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50"
            >
              Reopen
            </button>
          )}
        </div>
      </div>

      {/* Context + Notes block — shown at top */}
      {issue.notes && (() => {
          const raw = issue.notes ?? "";
          const lines = raw.split("\n");
          const customerLine = lines.find(l => l.startsWith("Customer:"));
          const teamLine = lines.find(l => l.startsWith("Team:"));
          const dateLine = lines.find(l => l.startsWith("Service date:"));
          const userNotes = lines.filter(l =>
            !l.startsWith("Customer:") && !l.startsWith("Team:") && !l.startsWith("Service date:")
          ).join("\n").trim();
          const custMatch = customerLine?.match(/^Customer:\s*(.+?)\s*\(([^)]+)\)$/);
          const custName = custMatch?.[1] ?? customerLine?.replace("Customer:", "").trim();
          const custPhone = custMatch?.[2] ?? null;
          const teamMatch = teamLine?.match(/^Team:\s*(.+?)(?:\s*\(([^)]+)\))?$/);
          const teamName = teamMatch?.[1] ?? null;
          const teamPhone = teamMatch?.[2] ?? null;
          const serviceDate = dateLine?.replace("Service date:", "").trim() ?? null;
          const hasContext = !!(custName || teamName || serviceDate);
          const custInitials = custName ? custName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() : "?";
          const custHue = custPhone ? Math.abs(custPhone.split("").reduce((a: number, c: string) => a + c.charCodeAt(0), 0)) % 360 : 200;
          const custAvatarUrl = custPhone && custName ? getCustomerAvatarUrl(custPhone, custName) : null;
          if (!hasContext && !userNotes) return null;
          return (
            <div className="mt-4 rounded-2xl p-4" style={{ background: "linear-gradient(135deg, #fef9f0 0%, #fef3e2 100%)", border: "1px solid #fde8c0" }}>
              <p className="text-xs font-bold tracking-[.15em] uppercase text-orange-500 mb-3">Context</p>
              {hasContext && (
                <div className="rounded-xl overflow-hidden border border-orange-100 mb-3" style={{ background: "rgba(255,255,255,0.7)" }}>
                  {custName && (
                    <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: teamName || serviceDate ? "1px solid rgba(253,232,192,0.6)" : "none" }}>
                      <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-white font-bold text-sm" style={{ background: custAvatarUrl ? undefined : `hsl(${custHue}, 55%, 52%)` }}>
                        {custAvatarUrl ? <img src={custAvatarUrl} alt={custName} className="w-full h-full object-cover" /> : custInitials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 leading-none mb-0.5">{custName}</p>
                        {custPhone && <p className="text-[11px] font-mono text-slate-500">{custPhone.replace(/^\+1/, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}</p>}
                      </div>
                    </div>
                  )}
                  {teamName && (
                    <div className="flex items-center gap-3 px-4 py-3" style={{ background: "rgba(99,102,241,0.05)", borderBottom: serviceDate ? "1px solid rgba(253,232,192,0.6)" : "none" }}>
                      <img src={getTeamAvatarUrl()} alt="MIB" className="w-9 h-9 rounded-full object-cover shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest leading-none mb-0.5">Assigned Team</p>
                        <p className="text-sm font-bold text-slate-900 leading-none mb-0.5">{teamName}</p>
                        {teamPhone && <p className="text-[11px] font-mono text-slate-500">{teamPhone.replace(/^\+1/, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}</p>}
                      </div>
                    </div>
                  )}
                  {serviceDate && (
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                        <Calendar className="h-4 w-4 text-orange-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-bold text-orange-400 uppercase tracking-widest leading-none mb-0.5">Date of Service</p>
                        <p className="text-sm font-bold text-slate-900">{serviceDate}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {userNotes && <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{userNotes}</p>}
            </div>
          );
      })()}

      {/* Meta cards row */}
      <div className="grid grid-cols-3 gap-3 mt-6">
        {/* Assignee */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-[10px] font-bold tracking-[.14em] uppercase text-slate-400 mb-2.5">Assignee</p>
          <AssigneeDropdown
            ownerName={issue.ownerName}
            agentList={agentList}
            agentPhotoMap={agentPhotoMap}
            onSelect={(name) => onUpdate({ ownerName: name ?? undefined })}
          />
        </div>

        {/* Waiting On */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-[10px] font-bold tracking-[.14em] uppercase text-slate-400 mb-2.5">Waiting On</p>
          <div className="grid grid-cols-3 bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {(["Customer", "Office", "Cleaner"] as const).map((w) => {
              const isActive = issue.waitingOn === w;
              const activeClass =
                w === "Customer" ? "bg-white text-orange-600 shadow-sm" :
                w === "Office"   ? "bg-white text-blue-600 shadow-sm" :
                                   "bg-white text-emerald-600 shadow-sm";
              return (
                <button
                  key={w}
                  onClick={() => onUpdate({ waitingOn: w })}
                  className={cn(
                    "py-1.5 rounded-md text-[10px] font-bold text-center transition-all",
                    isActive ? activeClass : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  {w}
                </button>
              );
            })}
          </div>
        </div>

        {/* Severity */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <p className="text-[10px] font-bold tracking-[.14em] uppercase text-slate-400 mb-2.5">Severity</p>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              { key: "critical" as IssueSeverity, label: "Critical", dot: "bg-red-500",    active: "bg-red-50 border-red-200 text-red-600",       inactive: "border-slate-200 text-slate-400" },
              { key: "high"     as IssueSeverity, label: "High",     dot: "bg-orange-500", active: "bg-orange-50 border-orange-200 text-orange-600", inactive: "border-slate-200 text-slate-400" },
              { key: "medium"   as IssueSeverity, label: "Medium",   dot: "bg-yellow-500", active: "bg-yellow-50 border-yellow-200 text-yellow-700", inactive: "border-slate-200 text-slate-400" },
              { key: "low"      as IssueSeverity, label: "Low",      dot: "bg-slate-400",  active: "bg-slate-100 border-slate-300 text-slate-600",  inactive: "border-slate-200 text-slate-400" },
            ]).map(({ key, label, dot, active, inactive }) => (
              <button
                key={key}
                onClick={() => onUpdate({ severity: key })}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10px] font-bold transition-all",
                  issue.severity === key ? active : inactive
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dot)} />
                {label}
              </button>
            ))}
          </div>
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


    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────

interface AgentEntry { id: number; name: string; photoUrl: string | null; }

interface IssueEngineOverlayProps {
  open: boolean;
  onClose: () => void;
  callerName: string;
  agentPhotoMap?: Record<string, string | null>;
  agentList?: AgentEntry[];
  initialIssueId?: number | null;
}

// ── Assignee Dropdown ─────────────────────────────────────────────────────────

function AssigneeDropdown({
  ownerName,
  agentList,
  agentPhotoMap,
  onSelect,
}: {
  ownerName: string | null;
  agentList: AgentEntry[];
  agentPhotoMap: Record<string, string | null>;
  onSelect: (name: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const photoUrl = ownerName ? (agentPhotoMap[ownerName] ?? null) : null;
  const initial = ownerName ? ownerName.charAt(0).toUpperCase() : null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-sm text-left",
          "bg-white border-slate-200 hover:border-slate-300",
          open && "border-orange-400 ring-2 ring-orange-100"
        )}
      >
        {ownerName ? (
          photoUrl ? (
            <img src={photoUrl} alt={ownerName} className="w-5 h-5 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center shrink-0">
              <span className="text-white text-[9px] font-bold">{initial}</span>
            </div>
          )
        ) : (
          <div className="w-5 h-5 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
            <User className="w-3 h-3 text-slate-500" />
          </div>
        )}
        <span className={cn("flex-1 truncate font-semibold text-[12px]", ownerName ? "text-slate-800" : "text-slate-400")}>
          {ownerName ?? "Unassigned"}
        </span>
        <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          <div className="overflow-y-auto" style={{ maxHeight: 220, scrollbarWidth: "none" }}>
            {/* Unassign option */}
            <button
              type="button"
              onClick={() => { onSelect(null); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 transition-colors text-sm",
                !ownerName && "bg-orange-50"
              )}
            >
              <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                <User className="w-3.5 h-3.5 text-slate-500" />
              </div>
              <span className={cn("font-medium text-[12px]", !ownerName ? "text-orange-600" : "text-slate-500")}>Unassigned</span>
              {!ownerName && <span className="ml-auto text-orange-500 text-xs">✓</span>}
            </button>
            {agentList.map(agent => {
              const photo = agentPhotoMap[agent.name] ?? null;
              const isSelected = ownerName === agent.name;
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => { onSelect(agent.name); setOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 transition-colors text-sm",
                    isSelected && "bg-orange-50"
                  )}
                >
                  {photo ? (
                    <img src={photo} alt={agent.name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center shrink-0">
                      <span className="text-white text-[9px] font-bold">{agent.name.charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                  <span className={cn("font-semibold text-[12px]", isSelected ? "text-orange-600" : "text-slate-800")}>{agent.name}</span>
                  {isSelected && <span className="ml-auto text-orange-500 text-xs">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function IssueEngineOverlay({ open, onClose, callerName, agentPhotoMap = {}, agentList = [], initialIssueId }: IssueEngineOverlayProps) {
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

  // When overlay opens with an initialIssueId, pre-select it and show all statuses so it's visible
  useEffect(() => {
    if (open && initialIssueId) {
      setSelectedId(initialIssueId);
      setStatusFilter("all");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialIssueId]);

  // Auto-select first issue when list loads (only if no issue is selected yet)
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
                agentList={agentList}
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
  onIssueCreated?: (meta: { issueId: number; issueTitle: string; typeLabel: string; severity: string; notes: string | null }) => void;
}

// ── Customer search result type (matches searchCustomers return shape) ─────────
type CustomerSearchResult = {
  phone: string;
  name: string;
  email: string | null;
  address: string | null;
  frequency: string | null;
  lastJobDate: string | null;
  ltv: number;
  totalCleans: number;
  isVip: boolean;
  city: string;
  teamName?: string | null;
  teamPhone?: string | null;
};

function formatServiceDate(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  return dateStr;
}

export function CreateIssueModal({ open, onClose, callerName, defaultTitle = "", onIssueCreated }: CreateIssueModalProps) {
  const utils = trpc.useUtils();

  // ── Customer search state ──────────────────────────────────────────────────
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: searchResults, isFetching: isSearching } = trpc.opsChat.searchCustomers.useQuery(
    { query: customerQuery },
    { enabled: customerQuery.length >= 2 && !selectedCustomer, staleTime: 30_000 }
  );

  const customers: CustomerSearchResult[] = (searchResults as any)?.customers ?? [];

  // ── Issue fields ───────────────────────────────────────────────────────────
  const [title, setTitle] = useState(defaultTitle);
  const [issueType, setIssueType] = useState<IssueType>("other");
  const [severity, setSeverity] = useState<IssueSeverity>("medium");
  const [notes, setNotes] = useState("");

  // Reset on open
  useEffect(() => {
    if (open) {
      setCustomerQuery("");
      setSelectedCustomer(null);
      setShowDropdown(false);
      setTitle(defaultTitle);
      setIssueType("other");
      setSeverity("medium");
      setNotes("");
    }
  }, [open, defaultTitle]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectCustomer(c: CustomerSearchResult) {
    setSelectedCustomer(c);
    setCustomerQuery(c.name);
    setShowDropdown(false);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerQuery("");
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  const createMutation = trpc.opsChat.createIssue.useMutation({
    onSuccess: (data) => {
      toast.success("Issue created");
      utils.opsChat.listIssues.invalidate();
      utils.opsChat.countOpenIssues.invalidate();
      // Build enriched title if customer selected
      const finalTitle = title.trim();
      onIssueCreated?.({
        issueId: data.id,
        issueTitle: finalTitle,
        typeLabel: ISSUE_TYPE_META[issueType]?.label ?? issueType,
        severity,
        notes: notes.trim() || null,
      });
      setTitle(""); setIssueType("other"); setSeverity("medium"); setNotes("");
      setSelectedCustomer(null); setCustomerQuery("");
      onClose();
    },
    onError: (e) => toast.error("Failed to create issue", { description: e.message }),
  });

  const severityConfig = {
    low:      { color: "bg-slate-100 text-slate-600 border-slate-200",      dot: "bg-slate-400" },
    medium:   { color: "bg-amber-50 text-amber-700 border-amber-200",       dot: "bg-amber-400" },
    high:     { color: "bg-orange-50 text-orange-700 border-orange-200",    dot: "bg-orange-500" },
    critical: { color: "bg-red-50 text-red-700 border-red-200",             dot: "bg-red-500" },
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg rounded-2xl p-0 overflow-hidden" style={{ fontFamily: "Inter, sans-serif" }}>
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center">
              <Flame className="h-4 w-4 text-orange-500" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 leading-tight">Create Issue</h2>
              <p className="text-[11px] text-slate-400">Track and resolve service problems</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 space-y-5 max-h-[70vh] overflow-y-auto">

          {/* ── Section 1: WHO IS THIS ABOUT? ─────────────────────────────── */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Who is this about?</p>

            {/* Customer search input */}
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={customerQuery}
                  onChange={(e) => {
                    setCustomerQuery(e.target.value);
                    if (selectedCustomer) setSelectedCustomer(null);
                    setShowDropdown(true);
                  }}
                  onFocus={() => { if (customerQuery.length >= 2) setShowDropdown(true); }}
                  placeholder="Type customer name, phone, address, or booking…"
                  className="w-full pl-8 pr-8 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 transition-all"
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 animate-spin" />
                )}
                {customerQuery && !isSearching && (
                  <button onClick={clearCustomer} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Dropdown */}
              {showDropdown && customers.length > 0 && !selectedCustomer && (
                <div ref={dropdownRef} className="absolute z-50 mt-1 w-full bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden">
                  {customers.slice(0, 6).map((c) => {
                    const avatarUrl = getCustomerAvatarUrl(c.phone, c.name);
                    const initials = c.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                    const hue = Math.abs(c.phone.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0)) % 360;
                    return (
                      <button
                        key={c.phone}
                        onMouseDown={(e) => { e.preventDefault(); selectCustomer(c); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-orange-50 transition-colors text-left"
                      >
                        {/* Avatar */}
                        <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-white text-xs font-bold" style={{ background: avatarUrl ? undefined : `hsl(${hue},55%,55%)` }}>
                          {avatarUrl ? <img src={avatarUrl} alt={c.name} className="w-full h-full object-cover" /> : initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-slate-900 truncate">{c.name}</span>
                            {c.isVip && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">VIP</span>}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">{c.phone}{c.city ? ` · ${c.city}` : ""}</div>
                        </div>
                        {c.teamName && (
                          <div className="shrink-0 flex items-center gap-1">
                            <div className="w-5 h-5 rounded-full overflow-hidden">
                              <img src={getTeamAvatarUrl()} alt="team" className="w-full h-full object-cover" />
                            </div>
                            <span className="text-[10px] text-slate-500 max-w-[80px] truncate">{c.teamName.replace(/^Team\s+/i, "")}</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Auto-filled context cards — shown after customer selected */}
            {selectedCustomer && (
              <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50/60 overflow-hidden">
                {/* Customer row */}
                <div className="flex items-center gap-3 px-3 py-2.5 border-b border-orange-100">
                  {(() => {
                    const avatarUrl = getCustomerAvatarUrl(selectedCustomer.phone, selectedCustomer.name);
                    const initials = selectedCustomer.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                    const hue = Math.abs(selectedCustomer.phone.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0)) % 360;
                    return (
                      <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-white text-xs font-bold" style={{ background: avatarUrl ? undefined : `hsl(${hue},55%,55%)` }}>
                        {avatarUrl ? <img src={avatarUrl} alt={selectedCustomer.name} className="w-full h-full object-cover" /> : initials}
                      </div>
                    );
                  })()}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-slate-900">{selectedCustomer.name}</span>
                      {selectedCustomer.isVip && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">VIP</span>}
                    </div>
                    <span className="text-[11px] text-slate-500">{selectedCustomer.phone}</span>
                  </div>
                  <button onClick={clearCustomer} className="text-slate-400 hover:text-slate-600 transition-colors shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* Team row */}
                {selectedCustomer.teamName && (
                  <div className="flex items-center gap-3 px-3 py-2 border-b border-orange-100">
                    <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                      <img src={getTeamAvatarUrl()} alt="team" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-black text-orange-500 uppercase tracking-wide">Assigned Team</p>
                      <p className="text-sm font-semibold text-slate-800 truncate">{selectedCustomer.teamName}</p>
                    </div>
                    {selectedCustomer.teamPhone && (
                      <span className="text-[11px] text-slate-400 shrink-0">{selectedCustomer.teamPhone}</span>
                    )}
                  </div>
                )}
                {/* Service date row */}
                {selectedCustomer.lastJobDate && (
                  <div className="flex items-center gap-3 px-3 py-2">
                    <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                      <Calendar className="h-3.5 w-3.5 text-orange-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-black text-orange-500 uppercase tracking-wide">Date of Service</p>
                      <p className="text-sm font-semibold text-slate-800">{formatServiceDate(selectedCustomer.lastJobDate)}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Section 2: WHAT'S THE ISSUE? ──────────────────────────────── */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">What&apos;s the issue?</p>
            <div className="space-y-2.5">
              {/* Issue type grid */}
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.entries(ISSUE_TYPE_META) as [IssueType, { emoji: string; label: string }][]).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setIssueType(k)}
                    className={cn(
                      "flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl border text-center transition-all",
                      issueType === k
                        ? "border-orange-400 bg-orange-50 text-orange-700 shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    )}
                  >
                    <span className="text-base">{v.emoji}</span>
                    <span className="text-[10px] font-semibold leading-tight">{v.label}</span>
                  </button>
                ))}
              </div>

              {/* Title */}
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`Issue title — e.g. "${ISSUE_TYPE_META[issueType]?.label} for ${selectedCustomer?.name?.split(" ")[0] ?? "customer"}"`}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 transition-all"
              />

              {/* Severity */}
              <div className="flex gap-1.5">
                {(["low", "medium", "high", "critical"] as IssueSeverity[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSeverity(s)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs font-semibold capitalize transition-all",
                      severity === s ? severityConfig[s].color + " shadow-sm" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    )}
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full", severity === s ? severityConfig[s].dot : "bg-slate-300")} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Section 3: NOTES ──────────────────────────────────────────── */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Notes</p>
            <Textarea
              placeholder="Add details, refund amount, customer expectation, or what needs follow-up…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="resize-none rounded-xl text-sm"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full border border-slate-200 text-slate-600 text-sm font-semibold hover:border-slate-400 transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!title.trim() || createMutation.isPending}
            onClick={() => {
              const notesWithContext = [
                selectedCustomer ? `Customer: ${selectedCustomer.name} (${selectedCustomer.phone})` : null,
                selectedCustomer?.teamName ? `Team: ${selectedCustomer.teamName}${selectedCustomer.teamPhone ? ` (${selectedCustomer.teamPhone})` : ""}` : null,
                selectedCustomer?.lastJobDate ? `Service date: ${formatServiceDate(selectedCustomer.lastJobDate)}` : null,
                notes.trim() || null,
              ].filter(Boolean).join("\n");
              createMutation.mutate({
                title: title.trim(),
                issueType,
                severity,
                notes: notesWithContext || undefined,
                createdByName: callerName,
                ownerName: callerName,
              });
            }}
            className="px-5 py-2 rounded-full bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-3.5 w-3.5 text-orange-400" />}
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

const PILL_TYPE_LABELS: Record<string, string> = {
  late_team: "Late Team",
  refund_request: "Refund",
  angry_customer: "Angry",
  no_show: "No Show",
  access_problem: "Access",
  payment_problem: "Payment",
  reschedule_needed: "Reschedule",
  broken_item: "Broken Item",
  manager_review: "Review",
  internal_task: "Task",
  other: "Issue",
};

export function ActiveIssuesPill({ onClick }: ActiveIssuesPillProps) {
  const { data } = trpc.opsChat.countOpenIssues.useQuery(
    undefined,
    { refetchInterval: false }
  );

  const count: number = (data as any)?.count ?? (typeof data === "number" ? data : 0);
  const latestTitle: string | null = (data as any)?.latestTitle ?? null;
  const latestType: string | null = (data as any)?.latestType ?? null;

  if (count === 0) return null;

  return (
    <button
      onClick={onClick}
      className="issue-pill relative flex items-center gap-1.5 bg-white border border-slate-200 rounded-2xl px-4 py-2 shadow-sm shrink-0 overflow-hidden"
    >
      <span className="live-dot" />
      <span className="text-[16px]">🔥</span>
      <span className="text-slate-900 font-black text-sm">Issues {count}</span>
    </button>
  );
}
