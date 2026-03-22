/**
 * KanbanBoard — Pipeline view for the admin dashboard.
 *
 * 4 columns: New Leads → Quoted → Follow Up → Booked
 * Design: light mode, inspired by the provided screenshot.
 * - Column headers with colored bottom underline + count badge + total value
 * - Cards: name, service, price (green), source badge + time ago
 * - Staggered card entrance animations on load
 * - Better per-column empty states
 * - Drag-and-drop between columns
 */
import { useState, useMemo, useRef, useEffect } from "react";
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
import {
  Phone,
  Globe,
  MessageSquare,
  Mic,
  MoreHorizontal,
  CheckCircle2,
  Sparkles,
  Clock,
  CalendarCheck,
  UserCheck,
} from "lucide-react";

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
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptySubtitle: string;
};

const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    id: "new_leads",
    label: "NEW LEADS",
    stages: ["WIDGET_SIZING", "TIME_PREF", "QUOTE_SENT", "CONFIRMATION", "ADDRESS", "SLOT_CHOICE"],
    targetStage: "QUOTE_SENT",
    accentColor: "#AAFF00",
    badgeBg: "bg-[#AAFF00] text-black",
    emptyIcon: <Sparkles className="w-6 h-6 text-lime-300" />,
    emptyTitle: "No new leads yet",
    emptySubtitle: "New form submissions will appear here",
  },
  {
    id: "quoted",
    label: "QUOTED",
    stages: ["AVAILABILITY"],
    targetStage: "AVAILABILITY",
    accentColor: "#d1d5db",
    badgeBg: "bg-gray-200 text-gray-700",
    emptyIcon: <Clock className="w-6 h-6 text-gray-300" />,
    emptyTitle: "No quoted leads",
    emptySubtitle: "Leads waiting on availability show here",
  },
  {
    id: "follow_up",
    label: "FOLLOW UP",
    stages: ["CALL_SCHEDULED", "DONE", "UNHANDLED", "FOLLOW_UP_SCHEDULED", "FUTURE_BOOKING"],
    targetStage: "FOLLOW_UP_SCHEDULED",
    accentColor: "#AAFF00",
    badgeBg: "bg-[#AAFF00] text-black",
    emptyIcon: <CalendarCheck className="w-6 h-6 text-lime-300" />,
    emptyTitle: "Nothing to follow up",
    emptySubtitle: "Great — no leads are waiting on you",
  },
  {
    id: "booked",
    label: "BOOKED",
    stages: ["BOOKED"],
    targetStage: "BOOKED",
    accentColor: "#AAFF00",
    badgeBg: "bg-[#AAFF00] text-black",
    emptyIcon: <UserCheck className="w-6 h-6 text-lime-300" />,
    emptyTitle: "No bookings yet",
    emptySubtitle: "Drag a lead here or use the Book button",
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
  if (!source) return { label: "form", icon: <Globe className="w-2.5 h-2.5" /> };
  if (source === "widget") return { label: "widget", icon: <Globe className="w-2.5 h-2.5" /> };
  if (source === "voice") return { label: "voice", icon: <Mic className="w-2.5 h-2.5" /> };
  if (source === "reactivation" || source.startsWith("always-on")) return { label: "sms", icon: <MessageSquare className="w-2.5 h-2.5" /> };
  return { label: "form", icon: <Globe className="w-2.5 h-2.5" /> };
}

// ── Lead Card ─────────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  isDragging = false,
  onClick,
  onMoveToBooked,
  animationDelay = 0,
}: {
  lead: LeadRow;
  isDragging?: boolean;
  onClick?: () => void;
  onMoveToBooked?: () => void;
  animationDelay?: number;
}) {
  const [visible, setVisible] = useState(false);
  const isQuoted = lead.stage === "AVAILABILITY";
  const { attributes, listeners, setNodeRef, transform, isDragging: isCurrentlyDragging } = useDraggable({
    id: String(lead.id),
    data: { lead },
  });

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), animationDelay);
    return () => clearTimeout(t);
  }, [animationDelay]);

  const style: React.CSSProperties = {
    ...(transform ? { transform: CSS.Translate.toString(transform) } : {}),
    opacity: visible ? 1 : 0,
    translate: visible ? "none" : "0 12px",
    transition: isDragging ? "none" : "opacity 0.25s ease, translate 0.25s ease",
  };

  const total = computeTotal(lead.quotedPrice, lead.extras);
  const { label: srcLabel, icon: srcIcon } = getSourceInfo(lead.leadSource);
  const firstName = lead.leadName?.split(" ")[0] ?? "Unknown";
  const lastName = lead.leadName?.split(" ").slice(1).join(" ");
  const displayName = lastName ? `${firstName} ${lastName[0]}.` : firstName;

  // Initials avatar color — deterministic from name
  const avatarColors = [
    "#6366f1", "#8b5cf6", "#ec4899", "#f97316",
    "#14b8a6", "#0ea5e9", "#84cc16", "#f59e0b",
  ];
  const initials = (lead.leadName ?? "?")
    .split(" ")
    .map(w => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const colorIdx = (lead.leadName ?? "").charCodeAt(0) % avatarColors.length;
  const avatarColor = avatarColors[colorIdx];

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group bg-white rounded-xl border border-gray-200 p-3.5 cursor-grab active:cursor-grabbing select-none flex flex-col h-[130px] ${
        isDragging ? "opacity-40 shadow-lg" : "hover:shadow-md hover:border-gray-300"
      }`}
      onClick={(e) => {
        if (isCurrentlyDragging) return;
        if ((e as unknown as MouseEvent & { _wasDrag?: boolean })._wasDrag) return;
        onClick?.();
      }}
    >
      {/* Top row: avatar + name + menu */}
      <div className="flex items-start justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* Initials avatar */}
          <div
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white leading-none"
            style={{ backgroundColor: avatarColor }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{displayName}</p>
            {lead.serviceType && (
              <p className="text-xs text-gray-400 mt-0.5 truncate">{lead.serviceType}</p>
            )}
          </div>
        </div>
        <button
          className="flex-shrink-0 p-0.5 rounded hover:bg-gray-100 transition-colors"
          onClick={e => { e.stopPropagation(); onClick?.(); }}
          title="View details"
        >
          <MoreHorizontal className="w-3.5 h-3.5 text-gray-400" />
        </button>
      </div>

      {/* Price row */}
      <div className="flex items-center justify-between flex-1 mt-1">
        {total > 0 ? (
          <span className="text-base font-bold" style={{ color: "#16a34a" }}>${total}</span>
        ) : (
          <span className="text-sm text-gray-300 font-medium">—</span>
        )}
        {/* Quick Book button for Quoted leads */}
        {isQuoted && onMoveToBooked && (
          <button
            onClick={e => { e.stopPropagation(); onMoveToBooked(); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
            title="Mark as Booked"
          >
            <CheckCircle2 className="w-2.5 h-2.5" />
            Book
          </button>
        )}
      </div>

      {/* Footer: source + time */}
      <div className="flex items-center justify-between flex-shrink-0">
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 font-medium">
          {srcIcon}
          {srcLabel}
        </span>
        <div className="flex items-center gap-2">
          {lead.leadPhone && (
            <a
              href={`tel:${lead.leadPhone}`}
              onClick={e => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              title={`Call ${lead.leadPhone}`}
            >
              <Phone className="w-3 h-3 text-gray-400 hover:text-gray-700" />
            </a>
          )}
          {lead.lastActivityAt && (
            <span className="text-[11px] text-gray-400">{timeAgo(lead.lastActivityAt)}</span>
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

  // Total value for this column
  const columnTotal = leads.reduce((sum, l) => sum + computeTotal(l.quotedPrice, l.extras), 0);

  return (
    <div className="flex flex-col flex-1 min-w-[220px] max-w-[300px]">
      {/* Column header */}
      <div className="mb-3">
        {/* Separator line above */}
        <div className="h-px mb-3" style={{ backgroundColor: column.accentColor }} />
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold tracking-widest text-gray-500 uppercase">{column.label}</span>
          <div className="flex items-center gap-1.5">
            {/* Total value badge */}
            {columnTotal > 0 && (
              <span className="text-[11px] font-semibold text-gray-400">
                ${columnTotal.toLocaleString()}
              </span>
            )}
            {/* Count badge */}
            <span className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${column.badgeBg}`}>
              {leads.length}
            </span>
          </div>
        </div>
        {/* Colored underline */}
        <div className="h-0.5 rounded-full" style={{ backgroundColor: column.accentColor }} />
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className="flex-1 flex flex-col gap-2.5 min-h-[400px] rounded-xl transition-colors duration-150 p-1"
        style={{
          backgroundColor: isOver ? "#f0fdf4" : "transparent",
        }}
      >
        {leads.length === 0 ? (
          <div
            className="flex-1 flex flex-col items-center justify-center rounded-xl border-2 border-dashed min-h-[160px] gap-2 px-4"
            style={{ borderColor: isOver ? "#86efac" : "#e5e7eb" }}
          >
            {isOver ? (
              <p className="text-xs text-emerald-500 font-semibold">Drop here</p>
            ) : (
              <>
                {column.emptyIcon}
                <p className="text-xs font-semibold text-gray-400 text-center leading-snug">{column.emptyTitle}</p>
                <p className="text-[11px] text-gray-300 text-center leading-snug">{column.emptySubtitle}</p>
              </>
            )}
          </div>
        ) : (
          leads.map((lead, idx) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              animationDelay={idx * 50}
              onClick={() => {
                if (justDraggedRef.current) return;
                onCardClick(lead);
              }}
              onMoveToBooked={onMoveToBooked ? () => onMoveToBooked(lead) : undefined}
            />
          ))
        )}
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
    { value: todayLeads.length, label: "LEADS TODAY" },
    { value: bookedToday.length, label: "BOOKED TODAY" },
    { value: `$${revenueToday.toLocaleString()}`, label: "REVENUE TODAY", accent: true },
  ];

  return (
    <div className="mt-6 border-t border-gray-100 pt-5 grid grid-cols-3 divide-x divide-gray-100">
      {stats.map(s => (
        <div key={s.label} className="flex flex-col items-center py-3 px-4">
          <span
            className="text-3xl font-black tabular-nums"
            style={{ color: s.accent ? "#16a34a" : "#111827", letterSpacing: "-0.03em" }}
          >
            {s.value}
          </span>
          <span className="text-[10px] font-bold tracking-widest text-gray-400 mt-1 uppercase">{s.label}</span>
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
  dateFilter?: "today" | "week" | "month";
};

export default function KanbanBoard({ leads, onCardClick, onStageChange, dateFilter: externalDateFilter }: KanbanBoardProps) {
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

  const filteredLeads = useMemo(() => {
    const df = externalDateFilter ?? "today";
    const cutoff = new Date();
    if (df === "today") {
      cutoff.setHours(0, 0, 0, 0);
    } else if (df === "week") {
      cutoff.setDate(cutoff.getDate() - 7);
      cutoff.setHours(0, 0, 0, 0);
    } else {
      cutoff.setDate(cutoff.getDate() - 30);
      cutoff.setHours(0, 0, 0, 0);
    }
    return effectiveLeads.filter(l => new Date(l.createdAt) >= cutoff);
  }, [effectiveLeads, externalDateFilter]);

  const columnLeads = useMemo(() => {
    const map: Record<string, LeadRow[]> = {};
    KANBAN_COLUMNS.forEach(col => { map[col.id] = []; });
    filteredLeads.forEach(lead => {
      const colId = STAGE_TO_COLUMN[lead.stage];
      if (colId) {
        map[colId].push(lead);
      }
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

  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver as never}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-4 min-w-max">
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
