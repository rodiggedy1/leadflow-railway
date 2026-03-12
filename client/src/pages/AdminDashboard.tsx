/**
 * AdminDashboard — Leads funnel monitor for Maids in Black
 *
 * Shows all conversation sessions with stage badges, lead details,
 * quoted prices, selected slots, addresses, and time elapsed.
 * Supports date range filtering and stage filtering.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw,
  Search,
  Phone,
  User,
  DollarSign,
  Clock,
  MapPin,
  Calendar,
  X,
} from "lucide-react";

// ── Stage configuration ────────────────────────────────────────────────────────

type Stage =
  | "QUOTE_SENT"
  | "AVAILABILITY"
  | "SLOT_CHOICE"
  | "ADDRESS"
  | "CONFIRMATION"
  | "CALL_SCHEDULED"
  | "DONE"
  | "UNHANDLED";

const STAGE_CONFIG: Record<
  Stage,
  { label: string; textColor: string; bgColor: string; borderColor: string; order: number }
> = {
  QUOTE_SENT: {
    label: "Quote Sent",
    textColor: "#1d4ed8",
    bgColor: "#dbeafe",
    borderColor: "#bfdbfe",
    order: 1,
  },
  AVAILABILITY: {
    label: "Availability",
    textColor: "#92400e",
    bgColor: "#fef3c7",
    borderColor: "#fde68a",
    order: 2,
  },
  SLOT_CHOICE: {
    label: "Slot Choice",
    textColor: "#9a3412",
    bgColor: "#ffedd5",
    borderColor: "#fed7aa",
    order: 3,
  },
  ADDRESS: {
    label: "Address",
    textColor: "#6b21a8",
    bgColor: "#f3e8ff",
    borderColor: "#e9d5ff",
    order: 4,
  },
  CONFIRMATION: {
    label: "Confirmation",
    textColor: "#134e4a",
    bgColor: "#ccfbf1",
    borderColor: "#99f6e4",
    order: 5,
  },
  CALL_SCHEDULED: {
    label: "Call Scheduled",
    textColor: "#1e3a5f",
    bgColor: "#e0e7ff",
    borderColor: "#c7d2fe",
    order: 6,
  },
  DONE: {
    label: "Done",
    textColor: "#14532d",
    bgColor: "#dcfce7",
    borderColor: "#bbf7d0",
    order: 7,
  },
  UNHANDLED: {
    label: "Needs Review",
    textColor: "#991b1b",
    bgColor: "#fee2e2",
    borderColor: "#fecaca",
    order: 8,
  },
};

const ALL_STAGES = (Object.keys(STAGE_CONFIG) as Stage[]).sort(
  (a, b) => STAGE_CONFIG[a].order - STAGE_CONFIG[b].order
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(date: Date | string): string {
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

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function toLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Funnel stats bar ──────────────────────────────────────────────────────────

function FunnelStats({
  byStage,
  total,
  onStageClick,
  activeStage,
}: {
  byStage: Record<string, number>;
  total: number;
  onStageClick: (stage: string) => void;
  activeStage: string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-6">
      {ALL_STAGES.map(stage => {
        const cfg = STAGE_CONFIG[stage];
        const count = byStage[stage] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isActive = activeStage === stage;
        const hasLeads = count > 0;

        return (
          <button
            key={stage}
            onClick={() => onStageClick(isActive ? "all" : stage)}
            className="rounded-xl border p-3 flex flex-col gap-1 text-left transition-all hover:shadow-md focus:outline-none"
            style={{
              backgroundColor: hasLeads ? cfg.bgColor : "#f9fafb",
              borderColor: isActive ? cfg.textColor : hasLeads ? cfg.borderColor : "#e5e7eb",
              borderWidth: isActive ? "2px" : "1px",
              opacity: hasLeads ? 1 : 0.55,
              boxShadow: isActive ? `0 0 0 3px ${cfg.borderColor}` : undefined,
            }}
          >
            <span
              className="text-xs font-semibold uppercase tracking-wide leading-tight"
              style={{ color: hasLeads ? cfg.textColor : "#9ca3af" }}
            >
              {cfg.label}
            </span>
            <span
              className="text-2xl font-bold"
              style={{ color: hasLeads ? cfg.textColor : "#d1d5db" }}
            >
              {count}
            </span>
            <span className="text-xs" style={{ color: hasLeads ? cfg.textColor : "#9ca3af", opacity: 0.7 }}>
              {pct}%
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Stage badge ───────────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: string }) {
  const cfg = STAGE_CONFIG[stage as Stage] ?? {
    label: stage,
    textColor: "#374151",
    bgColor: "#f3f4f6",
    borderColor: "#e5e7eb",
  };
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border"
      style={{
        backgroundColor: cfg.bgColor,
        borderColor: cfg.borderColor,
        color: cfg.textColor,
      }}
    >
      {cfg.label}
    </span>
  );
}

// ── Conversation history drawer ───────────────────────────────────────────────

function ConversationDrawer({
  session,
  onClose,
}: {
  session: {
    leadName: string | null;
    leadPhone: string;
    stage: string;
    messageHistory: string;
    selectedSlot: string | null;
    address: string | null;
    quotedPrice: string | null;
    serviceType: string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  };
  onClose: () => void;
}) {
  let messages: { role: string; content: string }[] = [];
  try {
    messages = JSON.parse(session.messageHistory || "[]");
  } catch {
    messages = [];
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="font-semibold text-gray-900">
              {session.leadName ?? "Unknown Lead"}
            </h2>
            <p className="text-sm text-gray-500">{formatPhone(session.leadPhone)}</p>
          </div>
          <div className="flex items-center gap-2">
            <StageBadge stage={session.stage} />
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Details */}
        <div className="px-4 py-3 bg-gray-50 border-b grid grid-cols-2 gap-2 text-sm">
          {session.quotedPrice && (
            <div>
              <span className="text-gray-500">Quote:</span>{" "}
              <span className="font-semibold" style={{ color: "#E8603C" }}>${session.quotedPrice}</span>
            </div>
          )}
          {session.serviceType && (
            <div>
              <span className="text-gray-500">Service:</span>{" "}
              <span className="font-medium">{session.serviceType}</span>
            </div>
          )}
          {session.selectedSlot && (
            <div className="col-span-2">
              <span className="text-gray-500">Slot:</span>{" "}
              <span className="font-medium">{session.selectedSlot}</span>
            </div>
          )}
          {session.address && (
            <div className="col-span-2">
              <span className="text-gray-500">Address:</span>{" "}
              <span className="font-medium">{session.address}</span>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">No messages yet</p>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                  style={
                    msg.role === "user"
                      ? { backgroundColor: "#E8603C", color: "white", borderBottomRightRadius: "4px" }
                      : { backgroundColor: "#f3f4f6", color: "#1f2937", borderBottomLeftRadius: "4px" }
                  }
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t text-xs text-gray-400 flex justify-between">
          <span>Started {timeAgo(session.createdAt)}</span>
          <span>Updated {timeAgo(session.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Date filter bar ───────────────────────────────────────────────────────────

type DatePreset = "today" | "yesterday" | "last7" | "last30" | "custom" | "all";

function getPresetDates(preset: DatePreset): { from: string; to: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (preset === "today") {
    return { from: toLocalDateInput(today), to: toLocalDateInput(today) };
  }
  if (preset === "yesterday") {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { from: toLocalDateInput(y), to: toLocalDateInput(y) };
  }
  if (preset === "last7") {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from: toLocalDateInput(from), to: toLocalDateInput(today) };
  }
  if (preset === "last30") {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { from: toLocalDateInput(from), to: toLocalDateInput(today) };
  }
  return null;
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedSession, setSelectedSession] = useState<null | {
    leadName: string | null;
    leadPhone: string;
    stage: string;
    messageHistory: string;
    selectedSlot: string | null;
    address: string | null;
    quotedPrice: string | null;
    serviceType: string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  }>(null);

  // Compute the active date range to send to the backend
  const dateRange = useMemo(() => {
    if (datePreset === "all") return { dateFrom: undefined, dateTo: undefined };
    if (datePreset === "custom") {
      return { dateFrom: customFrom || undefined, dateTo: customTo || undefined };
    }
    const preset = getPresetDates(datePreset);
    return preset ? { dateFrom: preset.from, dateTo: preset.to } : { dateFrom: undefined, dateTo: undefined };
  }, [datePreset, customFrom, customTo]);

  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    refetch,
    isFetching,
  } = trpc.leads.list.useQuery(dateRange, { refetchInterval: 30000 });

  const { data: stats } = trpc.leads.stats.useQuery(dateRange, {
    refetchInterval: 30000,
  });

  const filtered = useMemo(() => {
    return sessions.filter(s => {
      const matchesStage = stageFilter === "all" || s.stage === stageFilter;
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        (s.leadName ?? "").toLowerCase().includes(q) ||
        s.leadPhone.includes(q) ||
        (s.serviceType ?? "").toLowerCase().includes(q) ||
        (s.address ?? "").toLowerCase().includes(q);
      return matchesStage && matchesSearch;
    });
  }, [sessions, stageFilter, search]);

  const unhandledCount = stats?.byStage?.["UNHANDLED"] ?? 0;

  const DATE_PRESETS: { value: DatePreset; label: string }[] = [
    { value: "all", label: "All time" },
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "last7", label: "Last 7 days" },
    { value: "last30", label: "Last 30 days" },
    { value: "custom", label: "Custom range" },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#FFF8F5" }}>
      {/* Top bar */}
      <header className="bg-white border-b sticky top-0 z-40" style={{ borderColor: "#F0D8D0" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: "#E8603C" }}
            >
              <span className="text-white text-sm font-bold">M</span>
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 text-lg leading-tight">
                Maids in Black
              </h1>
              <p className="text-xs text-gray-500">Leads Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {unhandledCount > 0 && (
              <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 border border-red-200 text-xs font-semibold px-3 py-1.5 rounded-full">
                ⚠ {unhandledCount} need{unhandledCount === 1 ? "s" : ""} review
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Summary + date filter row */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{stats?.total ?? 0}</span>
            <span className="text-gray-500 text-sm">leads</span>
          </div>

          {/* Date preset selector */}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {DATE_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => setDatePreset(p.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                style={
                  datePreset === p.value
                    ? { backgroundColor: "#E8603C", color: "white", borderColor: "#E8603C" }
                    : { backgroundColor: "white", color: "#6b7280", borderColor: "#e5e7eb" }
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom date range inputs */}
        {datePreset === "custom" && (
          <div className="flex items-center gap-3 mb-5 bg-white rounded-xl border p-3" style={{ borderColor: "#F0D8D0" }}>
            <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-sm text-gray-600">From</label>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2"
                style={{ borderColor: "#e5e7eb" }}
              />
              <label className="text-sm text-gray-600">To</label>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2"
                style={{ borderColor: "#e5e7eb" }}
              />
              {(customFrom || customTo) && (
                <button
                  onClick={() => { setCustomFrom(""); setCustomTo(""); }}
                  className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Funnel stats — clicking a card filters the table */}
        {stats && (
          <FunnelStats
            byStage={stats.byStage}
            total={stats.total}
            onStageClick={stage => setStageFilter(stage)}
            activeStage={stageFilter}
          />
        )}

        {/* Search + stage filter */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search name, phone, service…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-white"
            />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-48 bg-white">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {ALL_STAGES.map(stage => (
                <SelectItem key={stage} value={stage}>
                  {STAGE_CONFIG[stage].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {stageFilter !== "all" && (
            <button
              onClick={() => setStageFilter("all")}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 self-center"
            >
              <X className="w-3 h-3" /> Clear filter
            </button>
          )}
          <span className="text-sm text-gray-500 self-center">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border overflow-hidden shadow-sm" style={{ borderColor: "#F0D8D0" }}>
          {sessionsLoading ? (
            <div className="py-20 text-center text-gray-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3" style={{ color: "#E8603C" }} />
              Loading leads…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-gray-400">
              <div className="text-4xl mb-3">📋</div>
              <p className="font-medium text-gray-600">No leads found</p>
              <p className="text-sm mt-1">
                {sessions.length === 0
                  ? "Leads will appear here once the form is submitted."
                  : "Try adjusting your filters."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="font-semibold text-gray-700 w-44">Lead</TableHead>
                    <TableHead className="font-semibold text-gray-700">Service</TableHead>
                    <TableHead className="font-semibold text-gray-700 w-28">Quote</TableHead>
                    <TableHead className="font-semibold text-gray-700 w-36">Stage</TableHead>
                    <TableHead className="font-semibold text-gray-700">Slot / Address</TableHead>
                    <TableHead className="font-semibold text-gray-700 w-28">Updated</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(session => (
                    <TableRow
                      key={session.id}
                      className="cursor-pointer transition-colors"
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedSession(session)}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#FFF8F5")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "")}
                    >
                      {/* Lead */}
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-gray-900 text-sm flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            {session.leadName ?? "—"}
                          </span>
                          <span className="text-xs text-gray-500 flex items-center gap-1.5">
                            <Phone className="w-3 h-3 text-gray-300 shrink-0" />
                            {formatPhone(session.leadPhone)}
                          </span>
                        </div>
                      </TableCell>

                      {/* Service */}
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm text-gray-800">
                            {session.serviceType ?? "—"}
                          </span>
                          {session.serviceType !== "Office Cleaning" ? (
                            <span className="text-xs text-gray-400">
                              {session.bedrooms} bd / {session.bathrooms} ba
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">
                              {session.bedrooms} sqft
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Quote */}
                      <TableCell>
                        {session.quotedPrice ? (
                          <span className="font-semibold flex items-center gap-1" style={{ color: "#E8603C" }}>
                            <DollarSign className="w-3.5 h-3.5" />
                            {session.quotedPrice}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-sm">—</span>
                        )}
                      </TableCell>

                      {/* Stage */}
                      <TableCell>
                        <StageBadge stage={session.stage} />
                      </TableCell>

                      {/* Slot / Address */}
                      <TableCell>
                        <div className="flex flex-col gap-0.5 max-w-[200px]">
                          {session.selectedSlot && (
                            <span className="text-xs text-gray-700 flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-gray-400 shrink-0" />
                              {session.selectedSlot}
                            </span>
                          )}
                          {session.address && (
                            <span className="text-xs text-gray-500 flex items-center gap-1 truncate">
                              <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
                              <span className="truncate">{session.address}</span>
                            </span>
                          )}
                          {!session.selectedSlot && !session.address && (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </div>
                      </TableCell>

                      {/* Updated */}
                      <TableCell>
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {timeAgo(session.updatedAt)}
                        </span>
                      </TableCell>

                      {/* Action */}
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs hover:bg-orange-50"
                          style={{ color: "#E8603C" }}
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedSession(session);
                          }}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-4 text-center">
          Auto-refreshes every 30 seconds · Click any row or stage card to filter · Click a stage card again to clear
        </p>
      </main>

      {/* Conversation drawer */}
      {selectedSession && (
        <ConversationDrawer
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}
