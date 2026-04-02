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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Calendar,
  UserCheck,
  Megaphone,
  XCircle,
  Eye,
  BarChart2,
  TrendingDown,
  Star,
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
  messageHistory?: string | null;
  lastActivityAt: Date | string | null;
  lastActivityText: string | null;
  lastActivityType: "sms" | "call" | null;
  createdAt: Date | string;
  reactivationLastPrice?: number | null;
  reactivationDiscountPct?: number | null;
  followUpDate?: string | null;
  lostReason?: string | null;
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
    label: "New Leads",
    stages: ["WIDGET_SIZING", "TIME_PREF", "QUOTE_SENT", "CONFIRMATION", "ADDRESS", "SLOT_CHOICE", "REACTIVATION"],
    targetStage: "QUOTE_SENT",
    accentColor: "#6366f1",
    badgeBg: "bg-indigo-100 text-indigo-700",
    emptyIcon: <Sparkles className="w-6 h-6 text-indigo-300" />,
    emptyTitle: "No new leads yet",
    emptySubtitle: "New form submissions will appear here",
  },
  {
    id: "quoted",
    label: "Quoted",
    stages: ["AVAILABILITY"],
    targetStage: "AVAILABILITY",
    accentColor: "#f59e0b",
    badgeBg: "bg-amber-100 text-amber-700",
    emptyIcon: <Clock className="w-6 h-6 text-amber-300" />,
    emptyTitle: "No quoted leads",
    emptySubtitle: "Leads waiting on availability show here",
  },
  {
    id: "follow_up",
    label: "Follow Up",
    stages: ["CALL_SCHEDULED", "DONE", "UNHANDLED", "FOLLOW_UP_SCHEDULED", "FUTURE_BOOKING"],
    targetStage: "FOLLOW_UP_SCHEDULED",
    accentColor: "#8b5cf6",
    badgeBg: "bg-violet-100 text-violet-700",
    emptyIcon: <CalendarCheck className="w-6 h-6 text-violet-300" />,
    emptyTitle: "Nothing to follow up",
    emptySubtitle: "Great — no leads are waiting on you",
  },
  {
    id: "booked",
    label: "Booked",
    stages: ["BOOKED"],
    targetStage: "BOOKED",
    accentColor: "#10b981",
    badgeBg: "bg-emerald-100 text-emerald-700",
    emptyIcon: <UserCheck className="w-6 h-6 text-emerald-300" />,
    emptyTitle: "No bookings yet",
    emptySubtitle: "Drag a lead here or use the Book button",
  },
];

const STAGE_TO_COLUMN: Record<string, string> = {};
KANBAN_COLUMNS.forEach(col => {
  col.stages.forEach(s => { STAGE_TO_COLUMN[s] = col.id; });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if this lead came from a campaign blast (not an organic form/widget/voice submission) */
function isCampaignLead(lead: LeadRow): boolean {
  const src = lead.leadSource ?? "";
  return (
    src.startsWith("campaign:") ||
    src === "reactivation" ||
    src === "command-center" ||
    src.startsWith("always-on")
  );
}

/** Returns true if the lead has at least one inbound (role:"user") message */
function hasReplied(lead: LeadRow): boolean {
  if (!lead.messageHistory) return false;
  try {
    const msgs: { role: string }[] = JSON.parse(lead.messageHistory);
    return msgs.some(m => m.role === "user");
  } catch {
    return false;
  }
}

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

function computeTotal(quotedPrice: string | null, _extras: string | null, reactivationLastPrice?: number | null): number {
  const base = quotedPrice ? parseInt(quotedPrice, 10) : 0;
  const parsed = isNaN(base) ? 0 : base;
  // Campaign leads have quotedPrice="0" but reactivationLastPrice is the actual amount
  if (parsed === 0 && reactivationLastPrice) return reactivationLastPrice;
  return parsed;
}

/** Maps a campaign ID slug to a human-readable label */
function campaignLabel(campaignId: string): string {
  const map: Record<string, string> = {
    tomorrow_slots: "Tomorrow Campaign",
    reactivation: "Reactivation",
    quote_followup: "Quote Follow-up",
    always_on: "Always-On",
  };
  if (map[campaignId]) return map[campaignId];
  // Fallback: title-case the slug
  return campaignId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) + " Campaign";
}

function getSourceInfo(source: string | null): { label: string; icon: React.ReactNode; isCampaign?: boolean } {
  if (!source) return { label: "form", icon: <Globe className="w-2.5 h-2.5" /> };
  if (source === "widget") return { label: "widget", icon: <Globe className="w-2.5 h-2.5" /> };
  if (source === "voice") return { label: "voice", icon: <Mic className="w-2.5 h-2.5" /> };
  if (source === "bark") return { label: "bark", icon: <MessageSquare className="w-2.5 h-2.5" /> };
  if (source === "thumbtack") return { label: "Thumbtack", icon: <MessageSquare className="w-2.5 h-2.5" /> };
  if (source === "thumbtack-sms") return { label: "Thumbtack Opportunity", icon: <MessageSquare className="w-2.5 h-2.5" /> };
  // Campaign blast sources: campaign:{id}
  if (source.startsWith("campaign:")) {
    const id = source.replace("campaign:", "");
    return { label: campaignLabel(id), icon: <Megaphone className="w-2.5 h-2.5" />, isCampaign: true };
  }
  // Legacy reactivation / always-on
  if (source === "reactivation") return { label: "Reactivation", icon: <Megaphone className="w-2.5 h-2.5" />, isCampaign: true };
  if (source.startsWith("always-on")) return { label: "Always-On", icon: <Megaphone className="w-2.5 h-2.5" />, isCampaign: true };
  if (source === "command-center") return { label: "Campaign", icon: <Megaphone className="w-2.5 h-2.5" />, isCampaign: true };
  if (source === "review_rebooking") return { label: "Review", icon: <Star className="w-2.5 h-2.5" /> };
  return { label: "form", icon: <Globe className="w-2.5 h-2.5" /> };
}

// ── Lead Card ─────────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  isDragging = false,
  onClick,
  onMoveToBooked,
  onMarkAsLost,
  onRestoreFromLost,
  animationDelay = 0,
}: {
  lead: LeadRow;
  isDragging?: boolean;
  onClick?: () => void;
  onMoveToBooked?: () => void;
  onMarkAsLost?: () => void;
  onRestoreFromLost?: () => void;
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
  const { label: srcLabel, icon: srcIcon, isCampaign } = getSourceInfo(lead.leadSource);

  // For campaign leads with no quoted price yet, show their last booking amount
  const lastBookingPrice = (total === 0 && isCampaign && lead.reactivationLastPrice)
    ? lead.reactivationLastPrice
    : null;

  // Urgency glow — based on idle time since last activity (or creation if no activity)
  const activityDate = lead.lastActivityAt ?? lead.createdAt;
  const idleMs = activityDate ? Date.now() - new Date(activityDate).getTime() : 0;
  const isOverdue48h = lead.stage !== "BOOKED" && idleMs > 48 * 60 * 60 * 1000;
  const isOverdue24h = lead.stage !== "BOOKED" && !isOverdue48h && idleMs > 24 * 60 * 60 * 1000;
  const showUrgency = isOverdue24h || isOverdue48h;
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
      className={`group bg-white rounded-xl border cursor-grab active:cursor-grabbing select-none relative shadow-sm ${
        isOverdue48h ? "border-red-300" :
        isOverdue24h ? "border-amber-300" :
        "border-gray-100"
      } ${
        isDragging ? "opacity-40 shadow-lg" : "hover:shadow-md hover:border-gray-300"
      }`}
      onClick={(e) => {
        if (isCurrentlyDragging) return;
        if ((e as unknown as MouseEvent & { _wasDrag?: boolean })._wasDrag) return;
        onClick?.();
      }}
    >
      {/* Urgency left-border accent bar */}
      {showUrgency && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl ${
            isOverdue48h ? "bg-red-400" : "bg-amber-400"
          }`}
        />
      )}

      <div className="p-3 flex flex-col gap-2">
        {/* Row 1: avatar + name/service + menu */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white leading-none"
              style={{ backgroundColor: avatarColor }}
            >
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{displayName}</p>
              <p className="text-xs text-gray-400 leading-tight truncate">{lead.serviceType ?? "—"}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex-shrink-0 p-1 rounded hover:bg-gray-100 transition-colors"
                onClick={e => e.stopPropagation()}
              >
                <MoreHorizontal className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onClick={e => { e.stopPropagation(); onClick?.(); }}
                className="gap-2 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {lead.stage === "LOST" ? (
                <DropdownMenuItem
                  onClick={e => { e.stopPropagation(); onRestoreFromLost?.(); }}
                  className="gap-2 cursor-pointer text-emerald-600 focus:text-emerald-600 focus:bg-emerald-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Restore Lead
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={e => { e.stopPropagation(); onMarkAsLost?.(); }}
                  className="gap-2 cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Mark as Lost
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Row 2: price + optional follow-up date pill + optional Book button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {total > 0 ? (
              <span className="text-base font-bold leading-none" style={{ color: "#16a34a" }}>${total}</span>
            ) : lastBookingPrice ? (
              <span className="text-base font-bold leading-none text-purple-600">${lastBookingPrice}</span>
            ) : (
              <span className="text-sm text-gray-300 font-medium leading-none">—</span>
            )}
            {lead.stage === "FOLLOW_UP_SCHEDULED" && lead.followUpDate && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                <Calendar className="w-2.5 h-2.5" />
                {new Date(lead.followUpDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
          {isQuoted && onMoveToBooked && (
            <button
              onClick={e => { e.stopPropagation(); onMoveToBooked(); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 flex-shrink-0"
            >
              <CheckCircle2 className="w-2.5 h-2.5" />
              Book
            </button>
          )}
        </div>

        {/* Row 3: source badge + review rebooking badge + time ago + call icon */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full ${
                isCampaign
                  ? "bg-purple-100 text-purple-600 font-semibold"
                  : "text-gray-400"
              }`}
            >
              {srcIcon}
              {srcLabel}
            </span>
            {lead.leadSource === "review_rebooking" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">
                <Star className="w-2.5 h-2.5" />
                Review Reply
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lead.leadPhone && (
              <a
                href={`openphone://call?to=${lead.leadPhone}`}
                onClick={e => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                title={`Call ${lead.leadPhone}`}
              >
                <Phone className="w-3 h-3 text-gray-400 hover:text-gray-700" />
              </a>
            )}
            <span className="text-[11px] text-gray-400">{timeAgo(lead.lastActivityAt ?? lead.createdAt)}</span>
          </div>
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
  onMarkAsLost,
  onRestoreFromLost,
}: {
  column: KanbanColumn;
  leads: LeadRow[];
  isOver: boolean;
  onCardClick: (lead: LeadRow) => void;
  justDraggedRef: React.RefObject<boolean>;
  onMoveToBooked?: (lead: LeadRow) => void;
  onMarkAsLost?: (lead: LeadRow) => void;
  onRestoreFromLost?: (lead: LeadRow) => void;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });

  // Total value for this column
  const columnTotal = leads.reduce((sum, l) => sum + computeTotal(l.quotedPrice, l.extras, l.reactivationLastPrice), 0);

  return (
    <div className="flex flex-col flex-1 min-w-[240px] max-w-[300px]">
      {/* Column panel */}
      <div
        className="flex flex-col flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
        style={{ borderTop: `3px solid ${column.accentColor}` }}
      >
        {/* Column header */}
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-gray-800">{column.label}</span>
            <div className="flex items-center gap-2">
              {columnTotal > 0 && (
                <span className="text-xs font-semibold text-gray-400">
                  ${columnTotal.toLocaleString()}
                </span>
              )}
              <span className={`text-xs font-bold min-w-[22px] h-[22px] px-1.5 rounded-full flex items-center justify-center ${column.badgeBg}`}>
                {leads.length}
              </span>
            </div>
          </div>
        </div>

        {/* Drop zone — independently scrollable */}
        <div
          ref={setNodeRef}
          className="flex flex-col gap-2 overflow-y-auto transition-colors duration-150 p-3"
          style={{
            minHeight: 200,
            maxHeight: "calc(100vh - 280px)",
            backgroundColor: isOver ? "#f0fdf4" : "transparent",
          }}
        >
          {leads.length === 0 ? (
            <div
              className="flex flex-col items-center justify-start rounded-xl border-2 border-dashed min-h-[120px] gap-2 px-4 pt-6 pb-6"
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
                onMarkAsLost={onMarkAsLost ? () => onMarkAsLost(lead) : undefined}
                onRestoreFromLost={onRestoreFromLost ? () => onRestoreFromLost(lead) : undefined}
              />
            ))
          )}
        </div>
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
  const revenueToday = bookedToday.reduce((s, l) => s + computeTotal(l.quotedPrice, l.extras, l.reactivationLastPrice), 0);

  const stats = [
    { value: todayLeads.length, label: "LEADS TODAY" },
    { value: bookedToday.length, label: "BOOKED TODAY" },
    { value: `$${revenueToday.toLocaleString()}`, label: "REVENUE TODAY", accent: true },
  ];

  return (
    <div className="mt-5 bg-white rounded-2xl shadow-sm border border-gray-200 grid grid-cols-3 divide-x divide-gray-100 overflow-hidden">
      {stats.map(s => (
        <div key={s.label} className="flex flex-col items-center py-4 px-4">
          <span
            className="text-2xl font-black tabular-nums"
            style={{ color: s.accent ? "#059669" : "#111827", letterSpacing: "-0.03em" }}
          >
            {s.value}
          </span>
          <span className="text-[10px] font-semibold tracking-wide text-gray-400 mt-1 uppercase">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Lost Reasons Panel ───────────────────────────────────────────────────────

const LOST_REASON_LABELS: Record<string, string> = {
  price: "Price",
  timing: "Timing",
  no_response: "No Response",
  competitor: "Competitor",
  other: "Other",
};

const LOST_REASON_COLORS: Record<string, string> = {
  price: "#ef4444",
  timing: "#f97316",
  no_response: "#6b7280",
  competitor: "#8b5cf6",
  other: "#94a3b8",
};

function LostReasonsPanel({ leads }: { leads: LeadRow[] }) {
  const lostLeads = leads.filter(l => l.stage === "LOST");
  const total = lostLeads.length;

  const counts = lostLeads.reduce<Record<string, number>>((acc, l) => {
    const key = l.lostReason ?? "other";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  if (total === 0) {
    return (
      <div className="mb-4 bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex items-center gap-3">
        <TrendingDown className="w-5 h-5 text-amber-400 shrink-0" />
        <p className="text-sm text-amber-700 font-medium">No lost leads yet — reasons will appear here once you mark leads as lost.</p>
      </div>
    );
  }

  return (
    <div className="mb-4 bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingDown className="w-4 h-4 text-amber-600" />
        <span className="text-xs font-bold tracking-widest text-amber-700 uppercase">Lost Reasons — {total} lead{total !== 1 ? "s" : ""}</span>
      </div>
      <div className="space-y-2">
        {sorted.map(([reason, count]) => {
          const pct = Math.round((count / total) * 100);
          const color = LOST_REASON_COLORS[reason] ?? "#94a3b8";
          const label = LOST_REASON_LABELS[reason] ?? reason;
          return (
            <div key={reason} className="flex items-center gap-3">
              <span className="w-24 text-xs font-semibold text-gray-600 shrink-0">{label}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <span className="text-xs font-bold tabular-nums" style={{ color }}>{count} <span className="text-gray-400 font-normal">({pct}%)</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Board ────────────────────────────────────────────────────────────────

type KanbanBoardProps = {
  leads: LeadRow[];
  onCardClick: (lead: LeadRow) => void;
  onStageChange?: ((id: number, newStage: string) => void) | (() => void);
  dateFilter?: "today" | "week" | "month";
};

export default function KanbanBoard({ leads, onCardClick, onStageChange, dateFilter: externalDateFilter }: KanbanBoardProps) {
  const updateStageQuick = trpc.leads.adminUpdateStage.useMutation();
  const utilsQuick = trpc.useUtils();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const justDraggedRef = useRef(false);
  const [showLost, setShowLost] = useState(false);
  const [showLostReasons, setShowLostReasons] = useState(false);
  const [lostPickerLead, setLostPickerLead] = useState<LeadRow | null>(null);

  const updateStage = trpc.leads.adminUpdateStage.useMutation();
  const markAsLostMutation = trpc.leads.markAsLost.useMutation();
  const restoreFromLostMutation = trpc.leads.restoreFromLost.useMutation();
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

  function handleRestoreFromLost(lead: LeadRow) {
    setLocalStages(prev => ({ ...prev, [lead.id]: "FOLLOW_UP_SCHEDULED" }));
    restoreFromLostMutation.mutate(
      { sessionId: lead.id },
      {
        onSuccess: () => {
          utils.leads.list.invalidate();
          onStageChange?.(lead.id, "FOLLOW_UP_SCHEDULED");
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

  function handleMarkAsLost(lead: LeadRow) {
    // Open the reason picker instead of immediately marking as lost
    setLostPickerLead(lead);
  }

  function confirmMarkAsLost(lead: LeadRow, reason: "price" | "timing" | "no_response" | "competitor" | "other") {
    setLostPickerLead(null);
    setLocalStages(prev => ({ ...prev, [lead.id]: "LOST" }));
    markAsLostMutation.mutate(
      { sessionId: lead.id, lostReason: reason },
      {
        onSuccess: () => {
          utils.leads.list.invalidate();
          onStageChange?.(lead.id, "LOST");
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

  const columnLeads = useMemo(() => {
    const map: Record<string, LeadRow[]> = {};
    KANBAN_COLUMNS.forEach(col => { map[col.id] = []; });
    // Separate LOST bucket
    // NOTE: Use effectiveLeads (not filteredLeads) so leads created before the
    // current date-filter window still appear in the pipeline after being dragged.
    const lostLeads: LeadRow[] = [];
    effectiveLeads.forEach(lead => {
      if (lead.stage === "LOST") {
        lostLeads.push(lead);
        return;
      }
      const colId = STAGE_TO_COLUMN[lead.stage];
      if (colId) {
        map[colId].push(lead);
      }
    });
    // When showLost is on, surface lost leads in a virtual "lost" bucket
    if (showLost) {
      map["lost"] = lostLeads;
    }
    return map as Record<string, LeadRow[]>;
  }, [effectiveLeads, showLost]);

  const lostCount = useMemo(() =>
    effectiveLeads.filter(l => l.stage === "LOST").length,
    [effectiveLeads]
  );

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
    <div className="min-h-screen bg-gray-50 -mx-6 -mb-6 mt-4 px-6 pt-6 pb-6">
      {/* Toolbar row */}
      <div className="mb-4">
        <div className="flex justify-end gap-2">
          {/* Show Lost toggle + Lost Reasons analytics */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLostReasons(v => !v)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                showLostReasons
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              Lost Reasons
            </button>
            <button
              onClick={() => setShowLost(v => !v)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                showLost
                  ? "bg-red-50 border-red-200 text-red-600"
                  : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
              }`}
            >
              <XCircle className="w-3.5 h-3.5" />
              {showLost ? "Hide Lost" : `Show Lost${lostCount > 0 ? ` (${lostCount})` : ""}`}
            </button>
          </div>
        </div>
      </div>

      {/* Lost Reasons analytics panel */}
      {showLostReasons && <LostReasonsPanel leads={effectiveLeads} />}

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
                onMarkAsLost={handleMarkAsLost}
                onRestoreFromLost={handleRestoreFromLost}
              />
            ))}
            {/* Lost column — only rendered when showLost is toggled on */}
            {showLost && (
              <KanbanColumnView
                key="lost"
                column={{
                  id: "lost",
                  label: "LOST",
                  stages: ["LOST"],
                  targetStage: "LOST",
                  accentColor: "#ef4444",
                  badgeBg: "bg-red-100 text-red-600",
                  emptyIcon: <XCircle className="w-6 h-6 text-red-200" />,
                  emptyTitle: "No lost leads",
                  emptySubtitle: "Leads marked as lost will appear here",
                }}
                leads={columnLeads["lost"] ?? []}
                isOver={false}
                onCardClick={onCardClick}
                justDraggedRef={justDraggedRef}
                onRestoreFromLost={handleRestoreFromLost}
              />
            )}
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

      {/* Lost Reason Picker Modal — rendered outside the bg-gray-50 wrapper so it overlays correctly */}
      {lostPickerLead && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setLostPickerLead(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 w-80 max-w-[90vw]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-bold text-gray-800">Mark as Lost</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Why is <span className="font-semibold text-gray-700">{lostPickerLead.leadName ?? lostPickerLead.leadPhone}</span> not moving forward?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "price" as const, label: "Price", color: "#ef4444", bg: "bg-red-50 hover:bg-red-100 border-red-200" },
                { key: "timing" as const, label: "Timing", color: "#f97316", bg: "bg-orange-50 hover:bg-orange-100 border-orange-200" },
                { key: "no_response" as const, label: "No Response", color: "#6b7280", bg: "bg-gray-50 hover:bg-gray-100 border-gray-200" },
                { key: "competitor" as const, label: "Competitor", color: "#8b5cf6", bg: "bg-violet-50 hover:bg-violet-100 border-violet-200" },
              ]).map(r => (
                <button
                  key={r.key}
                  onClick={() => confirmMarkAsLost(lostPickerLead, r.key)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${r.bg}`}
                  style={{ color: r.color }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => confirmMarkAsLost(lostPickerLead, "other")}
              className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-500 transition-colors"
            >
              Other
            </button>
            <button
              onClick={() => setLostPickerLead(null)}
              className="mt-2 w-full text-xs text-gray-400 hover:text-gray-600 transition-colors py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
