/**
 * KanbanBoard — Pipeline view for the admin dashboard.
 *
 * 6 columns: New → Quote Sent → Follow Up → Availability → Booked → Lost
 * Each column shows lead count + total pipeline value.
 * Cards are draggable between columns; dropping fires adminUpdateStage.
 */
import { useState, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { trpc } from "@/lib/trpc";
import { Phone, Clock, DollarSign, User, GripVertical } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type LeadRow = {
  id: number;
  leadName: string | null;
  leadPhone: string;
  stage: string;
  quotedPrice: string | null;
  extras: string | null;
  serviceType: string | null;
  assignedAgentName: string | null;
  leadSource: string | null;
  lastActivityAt: Date | string | null;
  lastActivityText: string | null;
  lastActivityType: "sms" | "call" | null;
  createdAt: Date | string;
};

// ── Kanban column definitions ─────────────────────────────────────────────────

type KanbanColumn = {
  id: string;
  label: string;
  stages: string[];          // DB stage values that map to this column
  targetStage: string;       // Stage to set when a card is dropped here
  accent: string;            // Tailwind border-top color class
  headerBg: string;
  countBg: string;
};

const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    id: "new",
    label: "New",
    // Fresh leads that haven't received a quote yet
    stages: ["WIDGET_SIZING", "TIME_PREF"],
    targetStage: "WIDGET_SIZING",
    accent: "border-t-slate-400",
    headerBg: "bg-slate-50",
    countBg: "bg-slate-200 text-slate-700",
  },
  {
    id: "quote_sent",
    label: "Quote Sent",
    // Quote has been sent, waiting on response
    stages: ["QUOTE_SENT", "CONFIRMATION", "ADDRESS", "SLOT_CHOICE"],
    targetStage: "QUOTE_SENT",
    accent: "border-t-blue-400",
    headerBg: "bg-blue-50",
    countBg: "bg-blue-100 text-blue-700",
  },
  {
    id: "follow_up",
    label: "Follow Up",
    // Active conversation, needs human nurturing
    stages: ["CALL_SCHEDULED", "DONE", "UNHANDLED", "FOLLOW_UP_SCHEDULED", "FUTURE_BOOKING"],
    targetStage: "FOLLOW_UP_SCHEDULED",
    accent: "border-t-amber-400",
    headerBg: "bg-amber-50",
    countBg: "bg-amber-100 text-amber-700",
  },
  {
    id: "availability",
    label: "Availability",
    // Hot — asking about dates/times, ready to schedule
    stages: ["AVAILABILITY"],
    targetStage: "AVAILABILITY",
    accent: "border-t-orange-400",
    headerBg: "bg-orange-50",
    countBg: "bg-orange-100 text-orange-700",
  },
  {
    id: "booked",
    label: "Booked",
    stages: ["BOOKED"],
    targetStage: "BOOKED",
    accent: "border-t-emerald-500",
    headerBg: "bg-emerald-50",
    countBg: "bg-emerald-100 text-emerald-700",
  },
  {
    id: "lost",
    label: "Lost",
    stages: ["NOT_INTERESTED"],
    targetStage: "NOT_INTERESTED",
    accent: "border-t-gray-400",
    headerBg: "bg-gray-50",
    countBg: "bg-gray-200 text-gray-600",
  },
];

// Map every DB stage to a column id for quick lookup
const STAGE_TO_COLUMN: Record<string, string> = {};
KANBAN_COLUMNS.forEach(col => {
  col.stages.forEach(s => {
    STAGE_TO_COLUMN[s] = col.id;
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(date: Date | string | null): string {
  if (!date) return "";
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

function computeTotal(quotedPrice: string | null, extras: string | null): number {
  if (!quotedPrice) return 0;
  const base = parseInt(quotedPrice, 10);
  if (isNaN(base)) return 0;
  if (!extras) return base;
  try {
    const keys: string[] = JSON.parse(extras);
    // Simple sum: each extra is $20 (matches the app's EXTRAS_LIST pricing)
    // The real calculateExtrasTotal is server-side; we approximate here for display
    return base;
  } catch {
    return base;
  }
}

function formatMoney(cents: number): string {
  if (cents === 0) return "—";
  return `$${cents.toLocaleString()}`;
}

function sourceBadge(source: string | null): string {
  if (!source) return "Form";
  if (source.startsWith("always-on")) return "Always-On";
  if (source === "widget") return "Widget";
  if (source === "reactivation") return "Campaign";
  if (source === "voice") return "Voice";
  return "Form";
}

// ── Draggable card ────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  isDragging = false,
  onClick,
}: {
  lead: LeadRow;
  isDragging?: boolean;
  onClick?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: String(lead.id),
    data: { lead },
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  const total = computeTotal(lead.quotedPrice, lead.extras);
  const src = sourceBadge(lead.leadSource);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded-xl border shadow-sm p-3 cursor-pointer select-none transition-all ${
        isDragging ? "opacity-40" : "hover:shadow-md hover:border-orange-200"
      }`}
      onClick={onClick}
    >
      {/* Drag handle + name row */}
      <div className="flex items-start gap-2">
        <div
          {...attributes}
          {...listeners}
          className="mt-0.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0"
          onClick={e => e.stopPropagation()}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-sm font-semibold text-gray-900 truncate">
              {lead.leadName ?? "Unknown"}
            </span>
            {total > 0 && (
              <span className="text-sm font-bold text-orange-600 flex-shrink-0">
                ${total}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <Phone className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-500 truncate">{lead.leadPhone}</span>
          </div>
        </div>
      </div>

      {/* Service type */}
      {lead.serviceType && (
        <p className="text-xs text-gray-500 mt-1.5 truncate pl-5">{lead.serviceType}</p>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between mt-2 pl-5">
        <div className="flex items-center gap-2">
          {/* Source badge */}
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
            {src}
          </span>
          {/* Agent */}
          {lead.assignedAgentName && (
            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
              <User className="w-2.5 h-2.5" />
              {lead.assignedAgentName.split(" ")[0]}
            </span>
          )}
        </div>
        {/* Time ago */}
        {lead.lastActivityAt && (
          <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" />
            {timeAgo(lead.lastActivityAt)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Droppable column ──────────────────────────────────────────────────────────

function KanbanColumn({
  column,
  leads,
  isOver,
  onCardClick,
}: {
  column: KanbanColumn;
  leads: LeadRow[];
  isOver: boolean;
  onCardClick: (lead: LeadRow) => void;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });

  const totalValue = leads.reduce((sum, l) => sum + computeTotal(l.quotedPrice, l.extras), 0);

  return (
    <div className="flex flex-col min-w-[220px] w-[220px] flex-shrink-0">
      {/* Column header */}
      <div className={`rounded-t-xl border border-b-0 px-3 py-2.5 ${column.headerBg} border-t-4 ${column.accent}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">{column.label}</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${column.countBg}`}>
            {leads.length}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <DollarSign className="w-3 h-3 text-gray-400" />
          <span className="text-xs text-gray-500 font-medium">
            {totalValue > 0 ? `$${totalValue.toLocaleString()} pipeline` : "no quotes yet"}
          </span>
        </div>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`flex-1 rounded-b-xl border border-t-0 p-2 flex flex-col gap-2 min-h-[400px] transition-colors ${
          isOver ? "bg-orange-50 border-orange-300" : "bg-gray-50 border-gray-200"
        }`}
      >
        {leads.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-gray-300 text-center">Drop leads here</p>
          </div>
        )}
        {leads.map(lead => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onClick={() => onCardClick(lead)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main board ────────────────────────────────────────────────────────────────

type KanbanBoardProps = {
  leads: LeadRow[];
  onCardClick: (lead: LeadRow) => void;
  onStageChange?: (id: number, newStage: string) => void;
};

export default function KanbanBoard({ leads, onCardClick, onStageChange }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const updateStage = trpc.leads.adminUpdateStage.useMutation();
  const utils = trpc.useUtils();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Optimistically track local stage overrides so the board updates instantly
  const [localStages, setLocalStages] = useState<Record<number, string>>({});

  const effectiveLeads = useMemo(() =>
    leads.map(l => localStages[l.id] ? { ...l, stage: localStages[l.id] } : l),
    [leads, localStages]
  );

  // Group leads by column
  const columnLeads = useMemo(() => {
    const map: Record<string, LeadRow[]> = {};
    KANBAN_COLUMNS.forEach(col => { map[col.id] = []; });
    effectiveLeads.forEach(lead => {
      const colId = STAGE_TO_COLUMN[lead.stage] ?? "follow_up";
      map[colId].push(lead);
    });
    return map;
  }, [effectiveLeads]);

  const activeLead = useMemo(() =>
    activeId ? effectiveLeads.find(l => String(l.id) === activeId) ?? null : null,
    [activeId, effectiveLeads]
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: { over: { id: string } | null }) {
    setOverId(event.over?.id ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setOverId(null);

    if (!over) return;
    const leadId = Number(active.id);
    const targetCol = KANBAN_COLUMNS.find(c => c.id === over.id);
    if (!targetCol) return;

    const currentLead = effectiveLeads.find(l => l.id === leadId);
    if (!currentLead) return;

    // Don't update if already in the right column
    const currentColId = STAGE_TO_COLUMN[currentLead.stage] ?? "follow_up";
    if (currentColId === targetCol.id) return;

    // Optimistic update
    setLocalStages(prev => ({ ...prev, [leadId]: targetCol.targetStage }));

    updateStage.mutate(
      { sessionId: leadId, stage: targetCol.targetStage as Parameters<typeof updateStage.mutate>[0]['stage'] },
      {
        onSuccess: () => {
          utils.leads.list.invalidate();
          onStageChange?.(leadId, targetCol.targetStage);
        },
        onError: () => {
          // Roll back optimistic update
          setLocalStages(prev => {
            const next = { ...prev };
            delete next[leadId];
            return next;
          });
        },
      }
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver as never}
      onDragEnd={handleDragEnd}
    >
      {/* Horizontal scroll container */}
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-3 min-w-max">
          {KANBAN_COLUMNS.map(col => (
            <KanbanColumn
              key={col.id}
              column={col}
              leads={columnLeads[col.id] ?? []}
              isOver={overId === col.id}
              onCardClick={onCardClick}
            />
          ))}
        </div>
      </div>

      {/* Drag overlay — ghost card while dragging */}
      <DragOverlay>
        {activeLead ? (
          <div className="rotate-2 opacity-95 shadow-xl">
            <LeadCard lead={activeLead} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
