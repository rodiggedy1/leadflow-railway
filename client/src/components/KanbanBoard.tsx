/**
 * KanbanBoard — Pipeline view for the admin dashboard.
 *
 * 5 columns: Quote Sent → Follow Up → Availability → Booked → Lost
 * Each column shows lead count + total pipeline value.
 * Cards are draggable between columns; dropping fires adminUpdateStage.
 *
 * World-class polish:
 * - Drag handle hidden until card hover
 * - Empty state centered vertically with dashed border drop zone
 * - Colored top border per column (already present, kept)
 * - Improved card visual hierarchy: price is prominent, metadata is subtle
 * - Drop zone uses a neutral highlight (no coral)
 */
import { useState, useMemo, useRef } from "react";
import type React from "react";
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
import { Phone, Clock, GripVertical, ArrowDownToLine, CheckCircle2, TrendingUp, DollarSign } from "lucide-react";

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
  stages: string[];
  targetStage: string;
  accentClass: string;       // Tailwind border-top color class
  accentHex: string;         // Hex for drop zone tint
  headerBg: string;
  countBg: string;
};

const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    id: "quote_sent",
    label: "Quote Sent",
    stages: ["WIDGET_SIZING", "TIME_PREF", "QUOTE_SENT", "CONFIRMATION", "ADDRESS", "SLOT_CHOICE"],
    targetStage: "QUOTE_SENT",
    accentClass: "border-t-blue-400",
    accentHex: "#eff6ff",
    headerBg: "bg-blue-50/60",
    countBg: "bg-blue-100 text-blue-700",
  },
  {
    id: "follow_up",
    label: "Follow Up",
    stages: ["CALL_SCHEDULED", "DONE", "UNHANDLED", "FOLLOW_UP_SCHEDULED", "FUTURE_BOOKING"],
    targetStage: "FOLLOW_UP_SCHEDULED",
    accentClass: "border-t-amber-400",
    accentHex: "#fffbeb",
    headerBg: "bg-amber-50/60",
    countBg: "bg-amber-100 text-amber-700",
  },
  {
    id: "availability",
    label: "Availability",
    stages: ["AVAILABILITY"],
    targetStage: "AVAILABILITY",
    accentClass: "border-t-orange-400",
    accentHex: "#fff7ed",
    headerBg: "bg-orange-50/60",
    countBg: "bg-orange-100 text-orange-700",
  },
  {
    id: "booked",
    label: "Booked",
    stages: ["BOOKED"],
    targetStage: "BOOKED",
    accentClass: "border-t-emerald-500",
    accentHex: "#f0fdf4",
    headerBg: "bg-emerald-50/60",
    countBg: "bg-emerald-100 text-emerald-700",
  },
  {
    id: "lost",
    label: "Lost",
    stages: ["NOT_INTERESTED"],
    targetStage: "NOT_INTERESTED",
    accentClass: "border-t-gray-400",
    accentHex: "#f9fafb",
    headerBg: "bg-gray-50/60",
    countBg: "bg-gray-200 text-gray-600",
  },
];

const STAGE_TO_COLUMN: Record<string, string> = {};
KANBAN_COLUMNS.forEach(col => {
  col.stages.forEach(s => { STAGE_TO_COLUMN[s] = col.id; });
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

function computeTotal(quotedPrice: string | null, _extras: string | null): number {
  if (!quotedPrice) return 0;
  const base = parseInt(quotedPrice, 10);
  return isNaN(base) ? 0 : base;
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
  onMoveToBooked,
}: {
  lead: LeadRow;
  isDragging?: boolean;
  onClick?: () => void;
  onMoveToBooked?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isAvailability = lead.stage === "AVAILABILITY";
  const { attributes, listeners, setNodeRef, transform, isDragging: isCurrentlyDragging } = useDraggable({
    id: String(lead.id),
    data: { lead },
  });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const total = computeTotal(lead.quotedPrice, lead.extras);
  const src = sourceBadge(lead.leadSource);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group bg-white rounded-xl border border-gray-200 p-3 cursor-grab active:cursor-grabbing select-none transition-all ${
        isDragging ? "opacity-40 shadow-md" : "hover:shadow-md hover:border-gray-300"
      }`}
      onClick={(e) => {
        if (isCurrentlyDragging) return;
        if ((e as unknown as MouseEvent & { _wasDrag?: boolean })._wasDrag) return;
        onClick?.();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Top row: grip (hover only) + name + price */}
      <div className="flex items-start gap-1.5">
        {/* Drag handle — only visible on hover */}
        <div className={`mt-0.5 flex-shrink-0 transition-opacity duration-150 ${hovered ? "opacity-40" : "opacity-0"}`}>
          <GripVertical className="w-3.5 h-3.5 text-gray-400" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Name + price */}
          <div className="flex items-baseline justify-between gap-1">
            <span className="text-sm font-semibold text-gray-900 truncate leading-tight">
              {lead.leadName ?? "Unknown"}
            </span>
            {total > 0 && (
              <span className="text-base font-bold text-gray-900 flex-shrink-0 tabular-nums">
                ${total}
              </span>
            )}
          </div>

          {/* Phone / call button */}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {hovered ? (
              <a
                href={`tel:${lead.leadPhone}`}
                onClick={e => e.stopPropagation()}
                title={`Call ${lead.leadPhone}`}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-900 text-white hover:bg-gray-700 transition-colors"
              >
                <Phone className="w-2.5 h-2.5" />
                Call
              </a>
            ) : (
              <span className="text-xs text-gray-400 truncate">{lead.leadPhone}</span>
            )}
            {/* Move to Booked — only for Availability leads, only on hover */}
            {hovered && isAvailability && onMoveToBooked && (
              <button
                onClick={e => { e.stopPropagation(); onMoveToBooked(); }}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                title="Mark as Booked"
              >
                <CheckCircle2 className="w-2.5 h-2.5" />
                Book
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Service type */}
      {lead.serviceType && (
        <p className="text-xs text-gray-500 mt-1.5 truncate pl-5">{lead.serviceType}</p>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between mt-2 pl-5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
            {src}
          </span>
          {lead.assignedAgentName && (
            <span className="text-[10px] text-gray-400 truncate max-w-[60px]">
              {lead.assignedAgentName.split(" ")[0]}
            </span>
          )}
        </div>
        {lead.lastActivityAt && (
          <span className="text-[10px] text-gray-400 flex items-center gap-0.5 flex-shrink-0">
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
  justDraggedRef,
  onMoveToBooked,
}: {
  column: KanbanColumn;
  leads: LeadRow[];
  isOver: boolean;
  onCardClick: (lead: LeadRow) => void;
  justDraggedRef: React.RefObject<boolean>;
  onMoveToBooked?: (lead: LeadRow) => void;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });

  const totalValue = leads.reduce((sum, l) => sum + computeTotal(l.quotedPrice, l.extras), 0);
  const isEmpty = leads.length === 0;

  return (
    <div className="flex flex-col min-w-[230px] w-[230px] flex-shrink-0">
      {/* Column header */}
      <div
        className={`rounded-t-xl border border-b-0 px-3 py-2.5 ${column.headerBg} border-t-4 ${column.accentClass}`}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">{column.label}</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${column.countBg}`}>
            {leads.length}
          </span>
        </div>
        <p className="text-xs text-gray-400 font-medium mt-0.5">
          {totalValue > 0 ? `$${totalValue.toLocaleString()} pipeline` : "no quotes yet"}
        </p>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className="flex-1 rounded-b-xl border border-t-0 p-2 flex flex-col gap-2 min-h-[420px] transition-colors duration-150"
        style={{
          backgroundColor: isOver ? column.accentHex : "#f9fafb",
          borderColor: isOver ? "#d1d5db" : "#e5e7eb",
          borderStyle: isEmpty && !isOver ? "dashed" : "solid",
        }}
      >
        {/* Empty state — centered vertically */}
        {isEmpty && (
          <div className="flex-1 flex flex-col items-center justify-center gap-1.5 py-8">
            <ArrowDownToLine
              className={`w-5 h-5 transition-opacity ${isOver ? "opacity-60 text-gray-500" : "opacity-20 text-gray-400"}`}
            />
            <p className={`text-xs text-center transition-opacity ${isOver ? "opacity-70 text-gray-600 font-medium" : "opacity-40 text-gray-400"}`}>
              {isOver ? "Release to move here" : "No leads yet"}
            </p>
          </div>
        )}

        {/* Cards */}
        {leads.map(lead => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onClick={() => {
              if (justDraggedRef.current) return;
              onCardClick(lead);
            }}
            onMoveToBooked={onMoveToBooked ? () => onMoveToBooked(lead) : undefined}
          />
        ))}

        {/* Drop hint at bottom when column has cards and is being hovered */}
        {!isEmpty && isOver && (
          <div className="flex items-center justify-center py-2 rounded-lg border border-dashed border-gray-300">
            <p className="text-xs text-gray-400 font-medium">Drop here</p>
          </div>
        )}
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

// ── Pipeline summary bar ──────────────────────────────────────────────────────

function PipelineSummary({ leads }: { leads: LeadRow[] }) {
  const totalLeads = leads.length;
  const totalPipeline = leads.reduce((s, l) => s + computeTotal(l.quotedPrice, l.extras), 0);
  const bookedLeads = leads.filter(l => STAGE_TO_COLUMN[l.stage] === "booked");
  const bookedRevenue = bookedLeads.reduce((s, l) => s + computeTotal(l.quotedPrice, l.extras), 0);
  const availabilityCount = leads.filter(l => STAGE_TO_COLUMN[l.stage] === "availability").length;

  return (
    <div className="flex items-center gap-4 px-1 pb-3 flex-wrap">
      <div className="flex items-center gap-1.5 text-sm text-gray-600">
        <TrendingUp className="w-4 h-4 text-gray-400" />
        <span className="font-semibold text-gray-900">{totalLeads}</span>
        <span>leads</span>
      </div>
      <span className="text-gray-200">·</span>
      <div className="flex items-center gap-1.5 text-sm text-gray-600">
        <DollarSign className="w-4 h-4 text-gray-400" />
        <span className="font-semibold text-gray-900">${totalPipeline.toLocaleString()}</span>
        <span>total pipeline</span>
      </div>
      {bookedRevenue > 0 && (
        <>
          <span className="text-gray-200">·</span>
          <div className="flex items-center gap-1.5 text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="font-semibold text-emerald-700">${bookedRevenue.toLocaleString()}</span>
            <span className="text-gray-500">booked</span>
          </div>
        </>
      )}
      {availabilityCount > 0 && (
        <>
          <span className="text-gray-200">·</span>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-orange-100 text-orange-600 text-[10px] font-bold">{availabilityCount}</span>
            <span className="text-gray-500">checking availability</span>
          </div>
        </>
      )}
    </div>
  );
}

export default function KanbanBoard({ leads, onCardClick, onStageChange }: KanbanBoardProps) {
  const updateStageQuick = trpc.leads.adminUpdateStage.useMutation();
  const utilsQuick = trpc.useUtils();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const justDraggedRef = useRef(false);

  const updateStage = trpc.leads.adminUpdateStage.useMutation();
  const utils = trpc.useUtils();

  function handleMoveToBooked(lead: LeadRow) {
    setLocalStages(prev => ({ ...prev, [lead.id]: "BOOKED" }));
    updateStageQuick.mutate(
      { sessionId: lead.id, stage: "BOOKED" },
      {
        onSuccess: () => {
          utils.leads.list.invalidate();
          onStageChange?.(lead.id, "BOOKED");
        },
        onError: () => {
          setLocalStages(prev => {
            const next = { ...prev };
            delete next[lead.id];
            return next;
          });
        },
      }
    );
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const [localStages, setLocalStages] = useState<Record<number, string>>({});

  const effectiveLeads = useMemo(() =>
    leads.map(l => localStages[l.id] ? { ...l, stage: localStages[l.id] } : l),
    [leads, localStages]
  );

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

    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 200);

    if (!over) return;
    const leadId = Number(active.id);
    const targetCol = KANBAN_COLUMNS.find(c => c.id === over.id);
    if (!targetCol) return;

    const currentLead = effectiveLeads.find(l => l.id === leadId);
    if (!currentLead) return;

    const currentColId = STAGE_TO_COLUMN[currentLead.stage] ?? "follow_up";
    if (currentColId === targetCol.id) return;

    setLocalStages(prev => ({ ...prev, [leadId]: targetCol.targetStage }));

    updateStage.mutate(
      { sessionId: leadId, stage: targetCol.targetStage as Parameters<typeof updateStage.mutate>[0]['stage'] },
      {
        onSuccess: () => {
          utils.leads.list.invalidate();
          onStageChange?.(leadId, targetCol.targetStage);
        },
        onError: () => {
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
    <>
    <PipelineSummary leads={effectiveLeads} />
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver as never}
      onDragEnd={handleDragEnd}
    >
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-3 min-w-max">
          {KANBAN_COLUMNS.map(col => (
            <KanbanColumn
              key={col.id}
              column={col}
              leads={columnLeads[col.id] ?? []}
              isOver={overId === col.id}
              onCardClick={onCardClick}
              justDraggedRef={justDraggedRef}
              onMoveToBooked={col.id === "availability" ? handleMoveToBooked : undefined}
            />
          ))}
        </div>
      </div>

      {/* Drag overlay — ghost card while dragging */}
      <DragOverlay>
        {activeLead ? (
          <div className="rotate-1 opacity-95 shadow-2xl scale-105">
            <LeadCard lead={activeLead} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
    </>
  );
}
