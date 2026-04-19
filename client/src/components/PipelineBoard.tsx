import { useState, useMemo, useEffect } from "react";
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
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";

// ── Stage grouping ────────────────────────────────────────────────────────────

const NEW_STAGES = new Set([
  "QUOTE_SENT", "AVAILABILITY", "SLOT_CHOICE", "ADDRESS",
  "CONFIRMATION", "CALL_SCHEDULED", "DONE", "UNHANDLED", "WIDGET_SIZING",
]);
const QUOTED_STAGES = new Set(["QUOTE_SENT", "AVAILABILITY", "SLOT_CHOICE"]);
const FOLLOW_STAGES = new Set(["FOLLOW_UP_SCHEDULED", "VOICEMAIL"]);
const BOOKED_STAGES = new Set(["BOOKED"]);

function stageToColumn(stage: string): string {
  if (BOOKED_STAGES.has(stage)) return "booked";
  if (FOLLOW_STAGES.has(stage)) return "follow";
  if (QUOTED_STAGES.has(stage)) return "quoted";
  if (NEW_STAGES.has(stage)) return "new";
  return "new";
}

// Column → valid DB stage for agentUpdateStage mutation
const COLUMN_TO_STAGE: Record<string, string | null> = {
  new: null, // mid-conversation stages — cannot write back
  quoted: null,
  follow: "FOLLOW_UP_SCHEDULED",
  booked: "BOOKED",
};

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
  new: {
    chip: "bg-blue-50 text-blue-700 border-blue-200",
    rail: "bg-blue-500",
    dot: "bg-blue-500",
    label: "New",
    icon: Inbox,
  },
  warm: {
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    rail: "bg-amber-500",
    dot: "bg-amber-500",
    label: "Warm",
    icon: Clock3,
  },
  hot: {
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rail: "bg-emerald-500",
    dot: "bg-emerald-500",
    label: "Hot",
    icon: Flame,
  },
  risk: {
    chip: "bg-rose-50 text-rose-700 border-rose-200",
    rail: "bg-rose-500",
    dot: "bg-rose-500",
    label: "At Risk",
    icon: AlertCircle,
  },
  booked: {
    chip: "bg-violet-50 text-violet-700 border-violet-200",
    rail: "bg-violet-500",
    dot: "bg-violet-500",
    label: "Booked",
    icon: CheckCircle2,
  },
};

const columnMeta: Record<string, { title: string; subtitle: string; accent: string; hint: string }> = {
  new: {
    title: "New Leads",
    subtitle: "Fastest response wins",
    accent: "from-blue-500/20 to-cyan-500/10",
    hint: "Respond fast",
  },
  quoted: {
    title: "Quoted",
    subtitle: "Quotes cooling down",
    accent: "from-emerald-500/20 to-lime-500/10",
    hint: "Nurture now",
  },
  follow: {
    title: "Follow Up",
    subtitle: "Revenue at risk",
    accent: "from-amber-500/20 to-orange-500/10",
    hint: "Re-engage",
  },
  booked: {
    title: "Booked",
    subtitle: "Jobs ready to run",
    accent: "from-violet-500/20 to-fuchsia-500/10",
    hint: "Confirm jobs",
  },
};

const dateViews = ["Today", "This Week", "This Month", "Custom"];
const tabs = [
  { key: "pipeline", label: "Pipeline View" },
  { key: "flow", label: "Flow Mode" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatTile({ label, value, change, icon: Icon }: { label: string; value: string | number; change: string; icon: React.ElementType }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-[0_1px_2px_rgba(16,24,40,.04),0_12px_32px_rgba(16,24,40,.06)] backdrop-blur">
      <div className="mb-3 flex items-center justify-between text-slate-500">
        <span className="text-xs font-medium uppercase tracking-[0.14em]">{label}</span>
        <div className="rounded-xl bg-slate-100 p-2">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
        <div className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          {change}
        </div>
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
        active
          ? "border-slate-900 bg-slate-900 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

function DraggableLeadCard({ lead, isSelected, onSelect, onMove, isDragging }: {
  lead: any;
  isSelected: boolean;
  onSelect: (l: any) => void;
  onMove: (l: any, target: string) => void;
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: lead.id });
  const style = stateStyles[lead.state] ?? stateStyles.new;
  const StateIcon = style.icon;

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(isDragging && "opacity-40")}
    >
      <motion.button
        layout
        whileHover={{ y: -3, scale: 1.01 }}
        whileTap={{ scale: 0.995 }}
        onClick={() => onSelect(lead)}
        className={cn(
          "group relative w-full overflow-hidden rounded-[22px] border bg-white p-0 text-left shadow-[0_1px_2px_rgba(16,24,40,.04),0_10px_28px_rgba(16,24,40,.06)] transition-all",
          isSelected ? "border-slate-900 ring-2 ring-slate-900/5" : "border-slate-200 hover:border-slate-300"
        )}
        {...listeners}
        {...attributes}
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
            <button className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" onClick={e => e.stopPropagation()}>
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
      </motion.button>
    </div>
  );
}

function DroppableColumn({ type, leads, totalValue, selectedLead, onSelect, onMove, activeId }: {
  type: string;
  leads: any[];
  totalValue: number;
  selectedLead: any;
  onSelect: (l: any) => void;
  onMove: (l: any, target: string) => void;
  activeId: number | null;
}) {
  const meta = columnMeta[type];
  const { setNodeRef, isOver } = useDroppable({ id: type });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-w-[220px] flex-1 rounded-[28px] border bg-white/70 p-3 shadow-[0_1px_2px_rgba(16,24,40,.03),0_10px_30px_rgba(16,24,40,.04)] backdrop-blur transition-colors",
        isOver ? "border-slate-400 bg-slate-50/80" : "border-slate-200/80"
      )}
    >
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

      <div className="space-y-3">
        <AnimatePresence>
          {leads.map((lead) => (
            <DraggableLeadCard
              key={lead.id}
              lead={lead}
              isSelected={selectedLead?.id === lead.id}
              onSelect={onSelect}
              onMove={onMove}
              isDragging={activeId === lead.id}
            />
          ))}
        </AnimatePresence>
      </div>
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
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", style.chip)}>
              {style.label}
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-500">{lead.service}{lead.address ? ` • ${lead.address}` : ""}</div>
        </div>
        <button onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
          <X className="h-4 w-4" />
        </button>
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
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Zap className="h-4 w-4" />
          Recommended Actions
        </div>
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
        <span className={cn("inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-semibold", style.chip)}>
          {style.label}
        </span>
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
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Last Contact</div>
              <div className="mt-2 text-sm font-medium">{lead.lastContact}</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Source</div>
              <div className="mt-2 text-sm font-medium">{lead.source}</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Property</div>
              <div className="mt-2 text-sm font-medium">{lead.beds > 0 ? `${lead.beds} bd / ${lead.baths} ba` : "—"}</div>
            </div>
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

  // Optimistic local overrides: sessionId → column key
  const [columnOverrides, setColumnOverrides] = useState<Record<number, string>>({});

  const { data: sessions, isLoading } = trpc.leads.list.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const updateStageMutation = trpc.leads.agentUpdateStage.useMutation();

  // Map sessions → grouped columns
  const data = useMemo(() => {
    const groups: Record<string, any[]> = { new: [], quoted: [], follow: [], booked: [] };
    if (!sessions) return groups;
    // Exclude COLD, LOST, NOT_INTERESTED, review/hiring/cs stages from pipeline
    const excluded = new Set([
      "COLD", "LOST", "NOT_INTERESTED", "REVIEW_REQUESTED", "REVIEW_DONE",
      "REVIEW_REBOOKING_REQUESTED", "REVIEW_REBOOKING_DONE", "QUALITY_RATING_REQUESTED",
      "QUALITY_MISSED_FOLLOWUP", "QUALITY_RATING_DONE", "INTERVIEW_LINK_SENT",
      "INTERVIEW_NUDGE_1", "INTERVIEW_NUDGE_2", "INTERVIEW_LINK_DONE",
      "OPEN", "HIRING_OUTBOUND", "REACTIVATION", "REACTIVATION_TIME",
    ]);
    for (const s of sessions) {
      if (excluded.has(s.stage)) continue;
      const lead = sessionToLead(s);
      const col = columnOverrides[s.id] ?? stageToColumn(s.stage);
      if (groups[col]) groups[col].push(lead);
    }
    return groups;
  }, [sessions, columnOverrides]);

  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    const next: Record<string, any[]> = {};
    (Object.entries(data) as [string, any[]][]).forEach(([key, leads]) => {
      next[key] = leads.filter(
        (lead: any) =>
          lead.name.toLowerCase().includes(q) ||
          lead.service.toLowerCase().includes(q) ||
          (lead.source ?? "").toLowerCase().includes(q) ||
          (lead.address ?? "").toLowerCase().includes(q)
      );
    });
    return next;
  }, [data, search]);

  const totals = useMemo(() => {
    const leads = Object.values(filteredData).flat();
    const pipeline = leads.reduce((sum: number, lead: any) => sum + lead.price, 0);
    const booked = (filteredData.booked ?? []).reduce((sum: number, lead: any) => sum + lead.price, 0);
    const quoted = (filteredData.quoted ?? []).length;
    return { leadCount: leads.length, pipeline, booked, quoted };
  }, [filteredData]);

  const columnTotals = useMemo(() => {
    const next: Record<string, number> = {};
    Object.entries(filteredData).forEach(([key, leads]: [string, any]) => {
      next[key] = (leads as any[]).reduce((sum: number, lead: any) => sum + lead.price, 0);
    });
    return next;
  }, [filteredData]);

  const allLeads = useMemo(() => Object.values(data).flat(), [data]);
  const priorityQueue = useMemo(() => [...allLeads].sort((a: any, b: any) => b.price - a.price), [allLeads]);
  const currentFlowLead = priorityQueue[flowIndex % Math.max(priorityQueue.length, 1)];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const moveLead = (lead: any, target: string) => {
    // Optimistic update
    setColumnOverrides(prev => ({ ...prev, [lead.id]: target }));
    setSelectedLead({ ...lead, state: target === "booked" ? "booked" : target === "follow" ? "risk" : target === "quoted" ? "hot" : "new" });
    setIsPanelOpen(true);
    setPanelMode("lead");

    // Write to DB if target has a valid stage
    const targetStage = COLUMN_TO_STAGE[target];
    if (targetStage) {
      updateStageMutation.mutate(
        { sessionId: lead.id, stage: targetStage as any },
        {
          onError: () => {
            // Rollback on error
            setColumnOverrides(prev => {
              const next = { ...prev };
              delete next[lead.id];
              return next;
            });
          },
        }
      );
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const targetCol = over.id as string;
    const lead = allLeads.find((l: any) => l.id === active.id);
    if (!lead) return;
    const currentCol = columnOverrides[lead.id] ?? stageToColumn(lead.stage);
    if (currentCol === targetCol) return;
    moveLead(lead, targetCol);
  };

  const openLeadPanel = (lead: any) => {
    setSelectedLead(lead);
    setPanelMode("lead");
    setIsPanelOpen(true);
  };

  const openActionsPanel = () => {
    setPanelMode("actions");
    setIsPanelOpen(true);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsPanelOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeLead = activeId ? allLeads.find((l: any) => l.id === activeId) : null;

  return (
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
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Live
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
                <button
                  key={item}
                  onClick={() => setSelectedDate(item)}
                  className={cn(
                    "rounded-2xl px-4 py-2.5 text-sm font-medium transition-all",
                    selectedDate === item ? "bg-slate-900 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {item}
                </button>
              ))}
              <button className="rounded-2xl border border-slate-200 bg-white p-2.5 text-slate-500 hover:bg-slate-50">
                <CalendarDays className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* View toggle */}
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setView(tab.key)}
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-medium transition-all",
                    view === tab.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {tab.label}
                </button>
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
                  <button
                    onClick={openActionsPanel}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
                  >
                    <Zap className="h-4 w-4" />
                    Actions Needed
                  </button>
                </div>

                <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                  <div className="flex gap-4 overflow-x-auto pb-1">
                    {(["new", "quoted", "follow", "booked"] as const).map((key) => (
                      <DroppableColumn
                        key={key}
                        type={key}
                        leads={filteredData[key] ?? []}
                        totalValue={columnTotals[key] ?? 0}
                        selectedLead={selectedLead}
                        onSelect={openLeadPanel}
                        onMove={moveLead}
                        activeId={activeId}
                      />
                    ))}
                  </div>
                  <DragOverlay>
                    {activeLead ? (
                      <div className="w-[220px] rounded-[22px] border border-slate-900 bg-white p-3 pl-4 shadow-2xl opacity-95">
                        <div className="text-[13px] font-semibold text-slate-900">{activeLead.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{activeLead.service}</div>
                        <div className="mt-2 text-[20px] font-semibold text-slate-950">{activeLead.price > 0 ? `$${activeLead.price}` : "—"}</div>
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              </div>

              <AnimatePresence>
                {isPanelOpen ? (
                  <>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsPanelOpen(false)}
                      className="absolute inset-0 z-20 rounded-[32px] bg-slate-950/[0.18] backdrop-blur-[2px]"
                    />
                    <motion.div
                      initial={{ opacity: 0, x: 40 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 40 }}
                      transition={{ type: "spring", stiffness: 320, damping: 30 }}
                      className="absolute right-4 top-4 z-30 w-[420px] max-w-[calc(100%-2rem)]"
                    >
                      {panelMode === "actions" ? (
                        <div className="space-y-4">
                          <div className="rounded-[28px] border border-slate-200 bg-slate-950 p-5 text-white shadow-[0_1px_2px_rgba(16,24,40,.04),0_18px_40px_rgba(16,24,40,.12)]">
                            <div className="mb-4 flex items-center justify-between">
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Next Actions</div>
                                <div className="mt-1 text-xl font-semibold tracking-tight">What should happen now</div>
                              </div>
                              <button onClick={() => setIsPanelOpen(false)} className="rounded-xl border border-white/10 p-2 text-slate-300 hover:bg-white/10">
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="space-y-3">
                              {(filteredData.new ?? []).slice(0, 3).map((lead: any) => (
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
  );
}
