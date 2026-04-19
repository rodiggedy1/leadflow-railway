import { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  CalendarDays,
  Phone,
  Sparkles,
  ChevronRight,
  Clock3,
  MessageSquare,
  DollarSign,
  Filter,
  MoreHorizontal,
  AlertCircle,
  CheckCircle2,
  Flame,
  ArrowUpRight,
  PanelRight,
  Zap,
  User,
  X,
  Inbox,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ── Stage grouping ────────────────────────────────────────────────────────────

const QUOTED_STAGES = new Set(["QUOTE_SENT", "AVAILABILITY", "SLOT_CHOICE"]);
const NEW_STAGES = new Set([
  "QUOTE_SENT", "AVAILABILITY", "SLOT_CHOICE", "ADDRESS",
  "CONFIRMATION", "CALL_SCHEDULED", "DONE", "UNHANDLED", "WIDGET_SIZING",
]);
const FOLLOW_STAGES = new Set(["FOLLOW_UP_SCHEDULED", "VOICEMAIL"]);
const BOOKED_STAGES = new Set(["BOOKED"]);

function stageToColumn(stage: string): string {
  if (BOOKED_STAGES.has(stage)) return "booked";
  if (FOLLOW_STAGES.has(stage)) return "follow";
  if (QUOTED_STAGES.has(stage)) return "quoted";
  if (NEW_STAGES.has(stage)) return "new";
  return "new";
}

const COLUMN_TO_STAGE: Record<string, string | null> = {
  new: null,
  quoted: null,
  follow: "FOLLOW_UP_SCHEDULED",
  booked: "BOOKED",
};

const EXCLUDED_STAGES = new Set([
  "COLD", "LOST", "NOT_INTERESTED", "REVIEW_REQUESTED", "REVIEW_DONE",
  "REVIEW_REBOOKING_REQUESTED", "REVIEW_REBOOKING_DONE", "QUALITY_RATING_REQUESTED",
  "QUALITY_MISSED_FOLLOWUP", "QUALITY_RATING_DONE", "INTERVIEW_LINK_SENT",
  "INTERVIEW_NUDGE_1", "INTERVIEW_NUDGE_2", "INTERVIEW_LINK_DONE",
  "OPEN", "HIRING_OUTBOUND", "REACTIVATION", "REACTIVATION_TIME",
]);

// ── Data mapping ──────────────────────────────────────────────────────────────

function timeAgoShort(date: Date | string | null): string {
  if (!date) return "—";
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function deriveState(stage: string, lastActivityAt: Date | null): string {
  if (BOOKED_STAGES.has(stage)) return "booked";
  const ageMs = lastActivityAt ? Date.now() - new Date(lastActivityAt).getTime() : Infinity;
  const ageHrs = ageMs / 3600000;
  if (stage === "UNHANDLED") return "risk";
  if (ageHrs < 0.5) return "hot";
  if (ageHrs < 4) return "warm";
  if (ageHrs > 18) return "risk";
  return "new";
}

function deriveNextAction(stage: string): string {
  const map: Record<string, string> = {
    QUOTE_SENT: "Reply in under 5 min",
    AVAILABILITY: "Confirm availability",
    SLOT_CHOICE: "Lock in a time slot",
    ADDRESS: "Capture address",
    CONFIRMATION: "Send confirmation",
    CALL_SCHEDULED: "Call is scheduled",
    DONE: "Conversation complete",
    UNHANDLED: "Needs human review",
    FOLLOW_UP_SCHEDULED: "Send circle-back SMS",
    VOICEMAIL: "Wait for callback",
    BOOKED: "Send tracking link",
    COLD: "Re-engage manually",
    WIDGET_SIZING: "Qualify and quote",
  };
  return map[stage] ?? "Follow up";
}

function sessionToLead(s: any): any {
  const price = s.quotedPrice ? parseInt(s.quotedPrice, 10) || 0 : 0;
  const lastActivityAt = s.lastActivityAt ?? s.updatedAt ?? null;
  return {
    id: s.id,
    name: s.leadName ?? "Unknown",
    service: s.serviceType ?? "Cleaning",
    price,
    state: deriveState(s.stage, lastActivityAt),
    source: s.leadSource ?? "Form",
    beds: s.bedrooms ?? 0,
    baths: s.bathrooms ?? 0,
    lastContact: s.lastActivityText ?? timeAgoShort(lastActivityAt),
    age: timeAgoShort(s.createdAt),
    nextAction: deriveNextAction(s.stage),
    phone: s.leadPhone ?? "",
    address: s.address ?? "",
    stage: s.stage,
    timeline: [`Lead created ${timeAgoShort(s.createdAt)}`, `Stage: ${s.stage}`],
    note: s.notes ?? "",
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────

const stateStyles: Record<string, { chip: string; rail: string; dot: string; label: string; icon: React.ElementType }> = {
  new: { chip: "bg-blue-50 text-blue-700 border-blue-200", rail: "bg-blue-500", dot: "bg-blue-500", label: "New", icon: Inbox },
  warm: { chip: "bg-amber-50 text-amber-700 border-amber-200", rail: "bg-amber-500", dot: "bg-amber-500", label: "Warm", icon: Clock3 },
  hot: { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", rail: "bg-emerald-500", dot: "bg-emerald-500", label: "Hot", icon: Flame },
  risk: { chip: "bg-rose-50 text-rose-700 border-rose-200", rail: "bg-rose-500", dot: "bg-rose-500", label: "At Risk", icon: AlertCircle },
  booked: { chip: "bg-violet-50 text-violet-700 border-violet-200", rail: "bg-violet-500", dot: "bg-violet-500", label: "Booked", icon: CheckCircle2 },
};

const columnMeta: Record<string, { title: string; subtitle: string; accent: string; hint: string }> = {
  new: { title: "New Leads", subtitle: "Fastest response wins", accent: "from-blue-500/20 to-cyan-500/10", hint: "Respond fast" },
  quoted: { title: "Quoted", subtitle: "Quotes cooling down", accent: "from-emerald-500/20 to-lime-500/10", hint: "Nurture now" },
  follow: { title: "Follow Up", subtitle: "Revenue at risk", accent: "from-amber-500/20 to-orange-500/10", hint: "Re-engage" },
  booked: { title: "Booked", subtitle: "Jobs ready to run", accent: "from-violet-500/20 to-fuchsia-500/10", hint: "Confirm jobs" },
};

const COLUMNS = ["new", "quoted", "follow", "booked"] as const;
type ColumnKey = typeof COLUMNS[number];

const dateViews = ["Today", "This Week", "This Month", "Custom"];
const tabs = [
  { key: "pipeline", label: "Pipeline View" },
  { key: "flow", label: "Flow Mode" },
];

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.4" } } }),
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatTile({ label, value, change, icon: Icon }: { label: string; value: string | number; change: string; icon: React.ElementType }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-[0_1px_2px_rgba(16,24,40,.04),0_12px_32px_rgba(16,24,40,.06)] backdrop-blur">
      <div className="mb-3 flex items-center justify-between text-slate-500">
        <span className="text-xs font-medium uppercase tracking-[0.14em]">{label}</span>
        <div className="rounded-xl bg-slate-100 p-2"><Icon className="h-4 w-4" /></div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
        <div className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{change}</div>
      </div>
    </div>
  );
}

function ControlButton({ children, active = false, icon: Icon, onClick }: { children: React.ReactNode; active?: boolean; icon?: React.ElementType; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all",
        active ? "border-slate-900 bg-slate-900 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

// Sortable card — ghost placeholder stays in original slot while dragging
function SortableLeadCard({ lead, isSelected, onSelect, onMove }: {
  lead: any;
  isSelected: boolean;
  onSelect: (l: any) => void;
  onMove: (l: any, target: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lead.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <LeadCardContent
        lead={lead}
        isSelected={isSelected}
        onSelect={onSelect}
        onMove={onMove}
        dragHandleProps={{ ...listeners, ...attributes }}
      />
    </div>
  );
}

// Pure card UI — used by both SortableLeadCard and DragOverlay
function LeadCardContent({ lead, isSelected, onSelect, onMove, dragHandleProps }: {
  lead: any;
  isSelected: boolean;
  onSelect: (l: any) => void;
  onMove: (l: any, target: string) => void;
  dragHandleProps?: Record<string, any>;
}) {
  const style = stateStyles[lead.state as string] ?? stateStyles.new;
  const StateIcon = style.icon;

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-[22px] border bg-white text-left shadow-[0_1px_2px_rgba(16,24,40,.04),0_10px_28px_rgba(16,24,40,.06)] transition-all cursor-grab active:cursor-grabbing select-none",
        isSelected ? "border-slate-900 ring-2 ring-slate-900/5" : "border-slate-200 hover:border-slate-300 hover:-translate-y-0.5"
      )}
      onClick={() => onSelect(lead)}
      {...dragHandleProps}
    >
      <div className={cn("absolute inset-y-0 left-0 w-1.5", style.rail)} />
      <div className="p-3 pl-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-[13px] font-semibold tracking-tight text-slate-900">{lead.name}</div>
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold", style.chip)}>
                <StateIcon className="h-3 w-3" />
                {style.label}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">{lead.service}</div>
          </div>
          <button
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={e => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[20px] font-semibold tracking-tight text-slate-950">{lead.price > 0 ? `$${lead.price}` : "—"}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              {lead.beds > 0 && <><span>{lead.beds} bd</span><span className="h-1 w-1 rounded-full bg-slate-300" /></>}
              <span>{lead.source}</span>
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 px-2 py-1.5 text-right">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Age</div>
            <div className="text-sm font-semibold text-slate-700">{lead.age}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Next Best Action</div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-slate-700">{lead.nextAction}</div>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500">{lead.lastContact}</div>
          <div className="flex items-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <button
              onClick={(e) => { e.stopPropagation(); onMove(lead, "follow"); }}
              className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Follow
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onMove(lead, "booked"); }}
              className="rounded-xl bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
            >
              Book
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Column({ type, leads, totalValue, selectedLead, onSelect, onMove }: {
  type: string;
  leads: any[];
  totalValue: number;
  selectedLead: any;
  onSelect: (l: any) => void;
  onMove: (l: any, target: string) => void;
}) {
  const meta = columnMeta[type];
  const ids = useMemo(() => leads.map((l) => l.id), [leads]);

  return (
    <div className="min-w-[220px] flex-1 rounded-[28px] border border-slate-200/80 bg-white/70 p-3 shadow-[0_1px_2px_rgba(16,24,40,.03),0_10px_30px_rgba(16,24,40,.04)] backdrop-blur">
      <div className={cn("mb-3 rounded-[24px] border border-slate-200 bg-gradient-to-br p-3", meta.accent)}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{meta.title}</div>
            <div className="mt-1 text-base font-semibold tracking-tight text-slate-950">${totalValue.toLocaleString()}</div>
            <div className="mt-1 text-xs text-slate-600">{leads.length} leads • {meta.subtitle}</div>
          </div>
          <div className="rounded-2xl border border-white/70 bg-white/80 px-2 py-1.5 text-right shadow-sm">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Live</div>
            <div className="text-xs font-semibold text-slate-700">{meta.hint}</div>
          </div>
        </div>
      </div>

      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="min-h-[60px] space-y-3">
          {leads.map((lead) => (
            <SortableLeadCard
              key={lead.id}
              lead={lead}
              isSelected={selectedLead?.id === lead.id}
              onSelect={onSelect}
              onMove={onMove}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function DetailPanel({ lead, onClose, onMove }: { lead: any; onClose: () => void; onMove: (l: any, target: string) => void }) {
  if (!lead) {
    return (
      <div className="flex h-full items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-white/60 p-8 text-center text-slate-500">
        Select a lead to see timeline, next actions, and details.
      </div>
    );
  }
  const style = stateStyles[lead.state] ?? stateStyles.new;

  return (
    <div className="h-full rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04),0_18px_40px_rgba(16,24,40,.08)]">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-xl font-semibold tracking-tight text-slate-950">{lead.name}</div>
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", style.chip)}>{style.label}</span>
          </div>
          <div className="mt-1 text-sm text-slate-500">{lead.service}{lead.address ? ` • ${lead.address}` : ""}</div>
        </div>
        <button onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X className="h-4 w-4" /></button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Estimated Value</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{lead.price > 0 ? `$${lead.price}` : "—"}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Best Move</div>
          <div className="mt-2 text-sm font-medium text-slate-700">{lead.nextAction}</div>
        </div>
      </div>

      <div className="mb-5 rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><Zap className="h-4 w-4" />Recommended Actions</div>
        <div className="grid grid-cols-2 gap-2">
          <button className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800">Reply Now</button>
          <button className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Call Lead</button>
          <button onClick={() => onMove(lead, "follow")} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Move to Follow Up</button>
          <button onClick={() => onMove(lead, "booked")} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 hover:bg-emerald-100">Book Job</button>
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-3 text-sm font-semibold text-slate-800">Timeline</div>
        <div className="space-y-3">
          {lead.timeline.map((item: string, idx: number) => (
            <div key={idx} className="flex items-start gap-3">
              <div className={cn("mt-1 h-2.5 w-2.5 rounded-full", style.dot)} />
              <div className="text-sm text-slate-600">{item}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[24px] border border-slate-200 p-4">
        <div className="mb-3 text-sm font-semibold text-slate-800">Lead Details</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Phone</div>
            <div className="mt-1 font-medium text-slate-700">{lead.phone || "—"}</div>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Property</div>
            <div className="mt-1 font-medium text-slate-700">{lead.beds > 0 ? `${lead.beds} bd / ${lead.baths} ba` : "—"}</div>
          </div>
          {lead.note && (
            <div className="col-span-2 rounded-2xl bg-slate-50 p-3">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Notes</div>
              <div className="mt-1 font-medium text-slate-700">{lead.note}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FlowMode({ lead, onNext, onMove }: { lead: any; onNext: () => void; onMove: (l: any, target: string) => void }) {
  if (!lead) return null;
  const style = stateStyles[lead.state] ?? stateStyles.new;

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,.04),0_18px_40px_rgba(16,24,40,.08)]">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Flow Mode</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">One lead. One decision.</div>
        </div>
        <span className={cn("inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-semibold", style.chip)}>{style.label}</span>
      </div>

      <div className="grid grid-cols-[1.3fr_.7fr] gap-5">
        <div className="rounded-[28px] bg-slate-950 p-6 text-white">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="text-3xl font-semibold tracking-tight">{lead.name}</div>
              <div className="mt-2 text-slate-300">{lead.service}{lead.address ? ` • ${lead.address}` : ""}</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-400">Estimated job</div>
              <div className="text-4xl font-semibold">{lead.price > 0 ? `$${lead.price}` : "—"}</div>
            </div>
          </div>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white/10 p-4"><div className="text-xs uppercase tracking-[0.12em] text-slate-400">Last Contact</div><div className="mt-2 text-sm font-medium">{lead.lastContact}</div></div>
            <div className="rounded-2xl bg-white/10 p-4"><div className="text-xs uppercase tracking-[0.12em] text-slate-400">Source</div><div className="mt-2 text-sm font-medium">{lead.source}</div></div>
            <div className="rounded-2xl bg-white/10 p-4"><div className="text-xs uppercase tracking-[0.12em] text-slate-400">Property</div><div className="mt-2 text-sm font-medium">{lead.beds > 0 ? `${lead.beds} bd / ${lead.baths} ba` : "—"}</div></div>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-xs uppercase tracking-[0.12em] text-slate-400">Recommended move</div>
            <div className="text-xl font-medium">{lead.nextAction}</div>
          </div>
        </div>

        <div className="space-y-3 rounded-[28px] border border-slate-200 bg-slate-50 p-4">
          <button className="w-full rounded-2xl bg-slate-900 px-4 py-4 text-left text-white transition hover:bg-slate-800">
            <div className="text-sm font-semibold">Reply + lock appointment</div>
            <div className="mt-1 text-sm text-slate-300">Send confident SMS and ask 9am or 1pm.</div>
          </button>
          <button onClick={() => onMove(lead, "booked")} className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-left text-emerald-800 transition hover:bg-emerald-100">
            <div className="text-sm font-semibold">Book now</div>
            <div className="mt-1 text-sm text-emerald-700">Move to booked and prep confirmation.</div>
          </button>
          <button onClick={() => onMove(lead, "follow")} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left text-slate-800 transition hover:bg-slate-100">
            <div className="text-sm font-semibold">Defer to follow-up</div>
            <div className="mt-1 text-sm text-slate-500">Queue a timed nudge if not ready.</div>
          </button>
          <button onClick={onNext} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left text-slate-800 transition hover:bg-slate-100">
            <div className="text-sm font-semibold">Next lead</div>
            <div className="mt-1 text-sm text-slate-500">Move fast through your highest-value queue.</div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PipelineBoard() {
  const [selectedDate, setSelectedDate] = useState("Today");
  const [view, setView] = useState("pipeline");
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [flowIndex, setFlowIndex] = useState(0);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState("lead");
  const [activeId, setActiveId] = useState<number | null>(null);

  // Stable snapshot of columns at drag-start — prevents findColumn from reading
  // live state and causing infinite setState loops during drag
  const dragSnapshotRef = useRef<Record<ColumnKey, any[]> | null>(null);

  // Local column state for optimistic DnD
  const [localColumns, setLocalColumns] = useState<Record<ColumnKey, any[]> | null>(null);

  const { data: sessions, isLoading } = trpc.leads.list.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const updateStageMutation = trpc.leads.agentUpdateStage.useMutation();

  const serverColumns = useMemo(() => {
    const groups: Record<ColumnKey, any[]> = { new: [], quoted: [], follow: [], booked: [] };
    if (!sessions) return groups;
    for (const s of sessions) {
      if (EXCLUDED_STAGES.has(s.stage)) continue;
      const lead = sessionToLead(s);
      const col = stageToColumn(s.stage) as ColumnKey;
      groups[col].push(lead);
    }
    return groups;
  }, [sessions]);

  const columns: Record<ColumnKey, any[]> = localColumns ?? serverColumns;

  const filteredColumns = useMemo(() => {
    if (!search.trim()) return columns;
    const q = search.toLowerCase();
    const next: Record<ColumnKey, any[]> = { new: [], quoted: [], follow: [], booked: [] };
    (Object.keys(columns) as ColumnKey[]).forEach((key) => {
      next[key] = columns[key].filter(
        (lead: any) =>
          lead.name.toLowerCase().includes(q) ||
          lead.service.toLowerCase().includes(q) ||
          (lead.source ?? "").toLowerCase().includes(q) ||
          (lead.address ?? "").toLowerCase().includes(q)
      );
    });
    return next;
  }, [columns, search]);

  const totals = useMemo(() => {
    const leads = Object.values(filteredColumns).flat();
    const pipeline = leads.reduce((sum: number, l: any) => sum + l.price, 0);
    const booked = (filteredColumns.booked ?? []).reduce((sum: number, l: any) => sum + l.price, 0);
    const quoted = (filteredColumns.quoted ?? []).length;
    return { leadCount: leads.length, pipeline, booked, quoted };
  }, [filteredColumns]);

  const columnTotals = useMemo(() => {
    const next: Record<string, number> = {};
    (Object.keys(filteredColumns) as ColumnKey[]).forEach((key) => {
      next[key] = filteredColumns[key].reduce((sum: number, l: any) => sum + l.price, 0);
    });
    return next;
  }, [filteredColumns]);

  const allLeads = useMemo(() => Object.values(columns).flat(), [columns]);
  const priorityQueue = useMemo(() => [...allLeads].sort((a: any, b: any) => b.price - a.price), [allLeads]);
  const currentFlowLead = priorityQueue[flowIndex % Math.max(priorityQueue.length, 1)];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Reads from the drag snapshot ref — never from live state — to avoid infinite loops
  function findColumn(id: number): ColumnKey | null {
    const source = dragSnapshotRef.current ?? serverColumns;
    for (const col of COLUMNS) {
      if (source[col].some((l: any) => l.id === id)) return col;
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    const snapshot: Record<ColumnKey, any[]> = {
      new: [...serverColumns.new],
      quoted: [...serverColumns.quoted],
      follow: [...serverColumns.follow],
      booked: [...serverColumns.booked],
    };
    dragSnapshotRef.current = snapshot;
    setActiveId(event.active.id as number);
    setLocalColumns(snapshot);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeLeadId = active.id as number;
    const overId = over.id;

    const overCol = (typeof overId === "string" && COLUMNS.includes(overId as ColumnKey))
      ? (overId as ColumnKey)
      : findColumn(overId as number);

    const activeCol = findColumn(activeLeadId);
    if (!activeCol || !overCol) return;

    setLocalColumns((prev) => {
      if (!prev) return prev;
      const sourceCopy = [...prev[activeCol]];
      const destCopy = activeCol === overCol ? sourceCopy : [...prev[overCol]];

      const activeIdx = sourceCopy.findIndex((l: any) => l.id === activeLeadId);
      if (activeIdx === -1) return prev;

      const activeLead = sourceCopy[activeIdx];

      if (activeCol === overCol) {
        const overIdx = destCopy.findIndex((l: any) => l.id === overId);
        if (overIdx === -1) return prev;
        const reordered = arrayMove(destCopy, activeIdx, overIdx);
        return { ...prev, [activeCol]: reordered };
      } else {
        const newSource = sourceCopy.filter((l: any) => l.id !== activeLeadId);
        const overIdx = destCopy.findIndex((l: any) => l.id === overId);
        const insertAt = overIdx === -1 ? destCopy.length : overIdx;
        const newDest = [...destCopy];
        newDest.splice(insertAt, 0, activeLead);
        return { ...prev, [activeCol]: newSource, [overCol]: newDest };
      }
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const snapshot = dragSnapshotRef.current;
    setActiveId(null);
    dragSnapshotRef.current = null;

    if (!over || !localColumns) {
      setLocalColumns(null);
      return;
    }

    const activeLeadId = active.id as number;
    const overId = over.id;

    // Determine origin column from snapshot (stable)
    let originCol: ColumnKey | null = null;
    if (snapshot) {
      for (const col of COLUMNS) {
        if (snapshot[col].some((l: any) => l.id === activeLeadId)) {
          originCol = col;
          break;
        }
      }
    }

    const overCol = (typeof overId === "string" && COLUMNS.includes(overId as ColumnKey))
      ? (overId as ColumnKey)
      : (() => {
          for (const col of COLUMNS) {
            if (localColumns[col].some((l: any) => l.id === overId)) return col;
          }
          return null;
        })();

    if (originCol && overCol && originCol !== overCol) {
      const targetStage = COLUMN_TO_STAGE[overCol];
      if (targetStage) {
        updateStageMutation.mutate(
          { sessionId: activeLeadId, stage: targetStage as any },
          {
            onError: () => setLocalColumns(null),
            onSuccess: () => setLocalColumns(null),
          }
        );
      } else {
        setLocalColumns(null);
      }
    } else {
      setLocalColumns(null);
    }
  }

  const activeLead = activeId ? allLeads.find((l: any) => l.id === activeId) : null;

  const moveLead = (lead: any, target: string) => {
    const col = target as ColumnKey;
    setLocalColumns((prev) => {
      const base = prev ?? serverColumns;
      const next: Record<ColumnKey, any[]> = { new: [], quoted: [], follow: [], booked: [] };
      for (const c of COLUMNS) {
        next[c] = base[c].filter((l: any) => l.id !== lead.id);
      }
      next[col] = [lead, ...next[col]];
      return next;
    });
    setSelectedLead(lead);
    setIsPanelOpen(true);
    setPanelMode("lead");

    const targetStage = COLUMN_TO_STAGE[col];
    if (targetStage) {
      updateStageMutation.mutate(
        { sessionId: lead.id, stage: targetStage as any },
        {
          onError: () => setLocalColumns(null),
          onSuccess: () => setLocalColumns(null),
        }
      );
    }
  };

  const openLeadPanel = (lead: any) => { setSelectedLead(lead); setPanelMode("lead"); setIsPanelOpen(true); };
  const openActionsPanel = () => { setPanelMode("actions"); setIsPanelOpen(true); };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setIsPanelOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // DndContext is at the outermost level so DragOverlay renders in the root
  // coordinate space — this prevents the overlay from jumping when the page
  // or any ancestor container is scrolled or transformed.
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
        <div className="mx-auto max-w-[1680px] px-12 py-6">
          <div className="rounded-[32px] border border-white/70 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),rgba(248,250,252,0.88))] p-4 shadow-[0_1px_2px_rgba(16,24,40,.04),0_24px_60px_rgba(15,23,42,.08)] backdrop-blur-xl">

            {/* Header */}
            <div className="mb-4 flex items-center justify-between gap-4 border-b border-slate-200/80 px-2 pb-4">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-900/10">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-lg font-semibold tracking-tight">Pipeline</div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />Live
                    </span>
                  </div>
                  <div className="text-sm text-slate-500">Revenue command center for leads, follow-up, and booking.</div>
                </div>
              </div>

              <div className="flex min-w-[420px] flex-1 items-center justify-center px-6">
                <div className="flex w-full max-w-[620px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search leads, jump to customer, find address..."
                    className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                  />
                  <div className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-400">⌘K</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <ControlButton active icon={AlertCircle}>Needs Attention ({totals.leadCount})</ControlButton>
                <ControlButton icon={Phone}>Call Assist</ControlButton>
                <ControlButton icon={PanelRight}>Agent View</ControlButton>
              </div>
            </div>

            {/* Stat tiles */}
            <div className="mb-5 grid grid-cols-4 gap-4">
              <StatTile label="Lead Volume" value={isLoading ? "…" : totals.leadCount} change="+12%" icon={User} />
              <StatTile label="Pipeline Value" value={isLoading ? "…" : `$${totals.pipeline.toLocaleString()}`} change="+18%" icon={DollarSign} />
              <StatTile label="Booked Revenue" value={isLoading ? "…" : `$${totals.booked.toLocaleString()}`} change="+22%" icon={CheckCircle2} />
              <StatTile label="Quotes Out" value={isLoading ? "…" : totals.quoted} change="+9%" icon={MessageSquare} />
            </div>

            {/* Date intelligence bar */}
            <div className="mb-5 flex items-center justify-between gap-4 rounded-[28px] border border-slate-200 bg-white/80 p-4 shadow-sm">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Date Intelligence</div>
                <div className="mt-1 text-sm text-slate-600">Pipeline <span className="font-semibold text-emerald-600">↑ 12%</span> vs last period • Booked <span className="font-semibold text-emerald-600">↑ 22%</span> • Leads <span className="font-semibold text-rose-600">↓ 8%</span></div>
              </div>
              <div className="flex items-center gap-2">
                {dateViews.map((item) => (
                  <button key={item} onClick={() => setSelectedDate(item)} className={cn("rounded-2xl px-4 py-2.5 text-sm font-medium transition-all", selectedDate === item ? "bg-slate-900 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{item}</button>
                ))}
                <button className="rounded-2xl border border-slate-200 bg-white p-2.5 text-slate-500 hover:bg-slate-50"><CalendarDays className="h-4 w-4" /></button>
              </div>
            </div>

            {/* View toggle */}
            <div className="mb-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
                {tabs.map((tab) => (
                  <button key={tab.key} onClick={() => setView(tab.key)} className={cn("rounded-xl px-4 py-2 text-sm font-medium transition-all", view === tab.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50")}>{tab.label}</button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <ControlButton icon={Filter}>Advanced Filters</ControlButton>
                <ControlButton icon={Wand2}>Smart Sort</ControlButton>
              </div>
            </div>

            {view === "pipeline" ? (
              <div className="relative">
                <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-[#fbfcfe] p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Pipeline Board</div>
                      <div className="mt-1 text-sm text-slate-600">Full-width operator view. Click any lead for deep context.</div>
                    </div>
                    <button onClick={openActionsPanel} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800">
                      <Zap className="h-4 w-4" />Actions Needed
                    </button>
                  </div>

                  <div className="flex gap-4 overflow-x-auto pb-1">
                    {COLUMNS.map((key) => (
                      <Column
                        key={key}
                        type={key}
                        leads={filteredColumns[key] ?? []}
                        totalValue={columnTotals[key] ?? 0}
                        selectedLead={selectedLead}
                        onSelect={openLeadPanel}
                        onMove={moveLead}
                      />
                    ))}
                  </div>
                </div>

                <AnimatePresence>
                  {isPanelOpen ? (
                    <>
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsPanelOpen(false)} className="absolute inset-0 z-20 rounded-[32px] bg-slate-950/[0.18] backdrop-blur-[2px]" />
                      <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} transition={{ type: "spring", stiffness: 320, damping: 30 }} className="absolute right-4 top-4 z-30 w-[420px] max-w-[calc(100%-2rem)]">
                        {panelMode === "actions" ? (
                          <div className="space-y-4">
                            <div className="rounded-[28px] border border-slate-200 bg-slate-950 p-5 text-white shadow-[0_1px_2px_rgba(16,24,40,.04),0_18px_40px_rgba(16,24,40,.12)]">
                              <div className="mb-4 flex items-center justify-between">
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Next Actions</div>
                                  <div className="mt-1 text-xl font-semibold tracking-tight">What should happen now</div>
                                </div>
                                <button onClick={() => setIsPanelOpen(false)} className="rounded-xl border border-white/10 p-2 text-slate-300 hover:bg-white/10"><X className="h-4 w-4" /></button>
                              </div>
                              <div className="space-y-3">
                                {(filteredColumns.new ?? []).slice(0, 3).map((lead: any) => (
                                  <button key={lead.id} onClick={() => { setSelectedLead(lead); setPanelMode("lead"); }} className="flex w-full items-center justify-between rounded-2xl bg-white/[0.08] px-4 py-3 text-left hover:bg-white/[0.12]">
                                    <span className="text-sm text-slate-100">{lead.nextAction} — {lead.name}</span>
                                    <ArrowUpRight className="h-4 w-4 text-slate-400" />
                                  </button>
                                ))}
                              </div>
                            </div>
                            <DetailPanel lead={selectedLead} onClose={() => setIsPanelOpen(false)} onMove={moveLead} />
                          </div>
                        ) : (
                          <DetailPanel lead={selectedLead} onClose={() => setIsPanelOpen(false)} onMove={moveLead} />
                        )}
                      </motion.div>
                    </>
                  ) : null}
                </AnimatePresence>
              </div>
            ) : (
              <FlowMode
                lead={currentFlowLead}
                onNext={() => setFlowIndex((i) => (i + 1) % Math.max(priorityQueue.length, 1))}
                onMove={moveLead}
              />
            )}
          </div>
        </div>
      </div>

      {/* DragOverlay renders in root coordinate space — no scroll/transform offset */}
      <DragOverlay dropAnimation={dropAnimation}>
        {activeLead ? (
          <div className="w-[220px] rotate-1 scale-105 cursor-grabbing shadow-2xl">
            <LeadCardContent
              lead={activeLead}
              isSelected={false}
              onSelect={() => {}}
              onMove={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
