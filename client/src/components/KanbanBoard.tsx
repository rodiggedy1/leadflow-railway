/**
 * KanbanBoard — Pipeline view for the admin dashboard.
 *
 * Design matches the provided reference screenshot (light mode):
 * - "Lead Pipeline" heading + "Live" pulsing badge
 * - Today / This Week / This Month filter pills (top-right)
 * - 4 columns: New Leads → Quoted → Follow Up → Booked
 * - Column headers: uppercase tracking-widest, colored bottom underline, round count badge
 * - Cards: white bg, name bold top-left, "..." top-right, service type subtitle,
 *   green price bottom-left, source icon + time bottom-right
 * - Stats bar at bottom: Leads Today / Booked Today / Revenue Today
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
import { Globe, MessageSquare, Mic, MoreHorizontal, CheckCircle2, Phone } from "lucide-react";

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
  accentColor: string;
  badgeBg: string;
  badgeText: string;
};

const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    id: "new_leads",
    label: "NEW LEADS",
    stages: ["WIDGET_SIZING", "TIME_PREF", "QUOTE_SENT", "CONFIRMATION", "ADDRESS", "SLOT_CHOICE"],
    targetStage: "QUOTE_SENT",
    accentColor: "#84cc16",   // lime-500
    badgeBg: "#84cc16",
    badgeText: "#000",
  },
  {
    id: "quoted",
    label: "QUOTED",
    stages: ["AVAILABILITY"],
    targetStage: "AVAILABILITY",
    accentColor: "#d1d5db",   // gray-300
    badgeBg: "#e5e7eb",
    badgeText: "#374151",
  },
  {
    id: "follow_up",
    label: "FOLLOW UP",
    stages: ["CALL_SCHEDULED", "DONE", "UNHANDLED", "FOLLOW_UP_SCHEDULED", "FUTURE_BOOKING"],
    targetStage: "FOLLOW_UP_SCHEDULED",
    accentColor: "#84cc16",
    badgeBg: "#84cc16",
    badgeText: "#000",
  },
  {
    id: "booked",
    label: "BOOKED",
    stages: ["BOOKED"],
    targetStage: "BOOKED",
    accentColor: "#84cc16",
    badgeBg: "#84cc16",
    badgeText: "#000",
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
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function computeTotal(quotedPrice: string | null, _extras: string | null): number {
  if (!quotedPrice) return 0;
  const base = parseInt(quotedPrice, 10);
  return isNaN(base) ? 0 : base;
}

function getSourceInfo(source: string | null): { label: string; icon: React.ReactNode } {
  if (!source) return { label: "form", icon: <Globe className="w-3 h-3" /> };
  if (source === "widget") return { label: "widget", icon: <Globe className="w-3 h-3" /> };
  if (source === "voice") return { label: "voice", icon: <Mic className="w-3 h-3" /> };
  if (source === "reactivation" || source.startsWith("always-on"))
    return { label: "sms", icon: <MessageSquare className="w-3 h-3" /> };
  return { label: "form", icon: <Globe className="w-3 h-3" /> };
}

function formatName(name: string | null): string {
  if (!name) return "Unknown";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// ── Lead Card ─────────────────────────────────────────────────────────────────

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
  const isQuoted = lead.stage === "AVAILABILITY";
  const { attributes, listeners, setNodeRef, transform, isDragging: isCurrentlyDragging } = useDraggable({
    id: String(lead.id),
    data: { lead },
  });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const total = computeTotal(lead.quotedPrice, lead.extras);
  const { label: srcLabel, icon: srcIcon } = getSourceInfo(lead.leadSource);
  const activityAt = lead.lastActivityAt ?? lead.createdAt;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative bg-white rounded-xl border border-gray-200 p-3.5 cursor-grab active:cursor-grabbing select-none transition-all ${
        isDragging ? "opacity-40 shadow-xl" : "hover:shadow-md hover:border-gray-300"
      }`}
      onClick={(e) => {
        if (isCurrentlyDragging) return;
        if ((e as unknown as MouseEvent & { _wasDrag?: boolean })._wasDrag) return;
        onClick?.();
      }}
    >
      {/* Top row: name + "..." */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-bold text-gray-900 leading-tight truncate">
          {formatName(lead.leadName)}
        </span>
        <button
          className="flex-shrink-0 p-0.5 rounded hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100"
          onClick={e => { e.stopPropagation(); onClick?.(); }}
          title="View details"
        >
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-400" />
        </button>
      </div>

      {/* Service type */}
      {lead.serviceType && (
        <p className="text-xs text-gray-400 mb-3 truncate">{lead.serviceType}</p>
      )}
      {!lead.serviceType && <div className="mb-3" />}

      {/* Bottom row: price left, source + time right */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {total > 0 ? (
            <span className="text-sm font-bold" style={{ color: "#16a34a" }}>${total}</span>
          ) : (
            <span className="text-sm text-gray-300">—</span>
          )}
          {isQuoted && onMoveToBooked && (
            <button
              onClick={e => { e.stopPropagation(); onMoveToBooked(); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
              title="Mark as Booked"
            >
              <CheckCircle2 className="w-2.5 h-2.5" />
              Book
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`tel:${lead.leadPhone}`}
            onClick={e => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            title={`Call ${lead.leadPhone}`}
          >
            <Phone className="w-3 h-3 text-gray-400 hover:text-gray-700" />
          </a>
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
            {srcIcon}
            {srcLabel}
          </span>
          {activityAt && (
            <span className="text-[11px] text-gray-400">{timeAgo(activityAt)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Droppable Column ──────────────────────────────────────────────────────────

function KanbanColumnView({
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

  return (
    <div className="flex flex-col flex-1 min-w-[230px] max-w-[320px]">
      {/* Column header */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[11px] font-bold tracking-widest text-gray-500 uppercase">{column.label}</span>
          <span
            className="text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: column.badgeBg, color: column.badgeText }}
          >
            {leads.length}
          </span>
        </div>
        {/* Colored underline */}
        <div className="h-[2px] rounded-full" style={{ backgroundColor: column.accentColor }} />
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className="flex-1 flex flex-col gap-2.5 min-h-[380px] rounded-xl transition-colors duration-150"
        style={{ backgroundColor: isOver ? "#f0fdf4" : "transparent" }}
      >
        {leads.length === 0 && (
          <div
            className="flex-1 flex items-center justify-center rounded-xl border-2 border-dashed min-h-[100px] transition-colors"
            style={{ borderColor: isOver ? "#86efac" : "#e5e7eb" }}
          >
            <p className="text-xs font-medium" style={{ color: isOver ? "#16a34a" : "#d1d5db" }}>
              {isOver ? "Drop here" : "No leads"}
            </p>
          </div>
        )}

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

        {leads.length > 0 && isOver && (
          <div className="flex items-center justify-center py-2 rounded-xl border-2 border-dashed border-green-300">
            <p className="text-xs text-green-500 font-medium">Drop here</p>
          </div>
        )}

        {/* + Add lead placeholder */}
        <button
          className="w-full mt-1 py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-xs text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors font-medium"
          onClick={() => {}}
          title="Feature coming soon"
        >
          + Add lead
        </button>
      </div>
    </div>
  );
}

// ── Stats Bar ─────────────────────────────────────────────────────────────────

function StatsBar({ leads }: { leads: LeadRow[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayLeads = leads.filter(l => new Date(l.createdAt) >= today);
  const bookedToday = todayLeads.filter(l => STAGE_TO_COLUMN[l.stage] === "booked");
  const revenueToday = bookedToday.reduce((s, l) => s + computeTotal(l.quotedPrice, l.extras), 0);

  const stats = [
    { value: todayLeads.length.toString(), label: "LEADS TODAY" },
    { value: bookedToday.length.toString(), label: "BOOKED TODAY" },
    { value: `$${revenueToday.toLocaleString()}`, label: "REVENUE TODAY", green: true },
  ];

  return (
    <div className="mt-6 border-t border-gray-100 pt-1 grid grid-cols-3 divide-x divide-gray-100">
      {stats.map(s => (
        <div key={s.label} className="flex flex-col items-center py-5">
          <span
            className="text-4xl font-black tabular-nums"
            style={{ color: s.green ? "#16a34a" : "#111827", letterSpacing: "-0.03em" }}
          >
            {s.value}
          </span>
          <span className="text-[10px] font-bold tracking-widest text-gray-400 mt-1.5 uppercase">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Board ────────────────────────────────────────────────────────────────

type KanbanBoardProps = {
  leads: LeadRow[];
  onCardClick: (lead: LeadRow) => void;
  onStageChange?: (id: number, newStage: string) => void;
};

type DateFilter = "today" | "week" | "month";

export default function KanbanBoard({ leads, onCardClick, onStageChange }: KanbanBoardProps) {
  const updateStageQuick = trpc.leads.adminUpdateStage.useMutation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
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

  // Filter leads by date
  const filteredLeads = useMemo(() => {
    const now = new Date();
    const cutoff = new Date();
    if (dateFilter === "today") {
      cutoff.setHours(0, 0, 0, 0);
    } else if (dateFilter === "week") {
      cutoff.setDate(now.getDate() - 7);
      cutoff.setHours(0, 0, 0, 0);
    } else {
      cutoff.setDate(now.getDate() - 30);
      cutoff.setHours(0, 0, 0, 0);
    }
    return effectiveLeads.filter(l => new Date(l.createdAt) >= cutoff);
  }, [effectiveLeads, dateFilter]);

  const columnLeads = useMemo(() => {
    const map: Record<string, LeadRow[]> = {};
    KANBAN_COLUMNS.forEach(col => { map[col.id] = []; });
    filteredLeads.forEach(lead => {
      const colId = STAGE_TO_COLUMN[lead.stage];
      if (colId) map[colId].push(lead);
      // Dead/cold leads not shown
    });
    return map;
  }, [filteredLeads]);

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

    const currentColId = STAGE_TO_COLUMN[currentLead.stage];
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

  const filterLabels: { key: DateFilter; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
  ];

  return (
    <div>
      {/* Pipeline header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-900 tracking-tight">Lead Pipeline</h2>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-lime-400 text-black">
            <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
            Live
          </span>
        </div>
        {/* Date filter pills */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          {filterLabels.map(f => (
            <button
              key={f.key}
              onClick={() => setDateFilter(f.key)}
              className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
              style={
                dateFilter === f.key
                  ? { backgroundColor: "#84cc16", color: "#000" }
                  : { backgroundColor: "transparent", color: "#6b7280" }
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver as never}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-5 min-w-max">
            {KANBAN_COLUMNS.map(col => (
              <KanbanColumnView
                key={col.id}
                column={col}
                leads={columnLeads[col.id] ?? []}
                isOver={overId === col.id}
                onCardClick={onCardClick}
                justDraggedRef={justDraggedRef}
                onMoveToBooked={col.id === "quoted" ? handleMoveToBooked : undefined}
              />
            ))}
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeLead ? (
            <div className="rotate-1 opacity-95 shadow-2xl scale-105">
              <LeadCard lead={activeLead} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <StatsBar leads={effectiveLeads} />
    </div>
  );
}
