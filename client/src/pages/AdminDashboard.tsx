/**
 * AdminDashboard — Leads funnel monitor for Maids in Black
 *
 * Shows all conversation sessions with stage badges, lead details,
 * quoted prices, selected slots, addresses, and time elapsed.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
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
import { RefreshCw, Search, Phone, User, Home, DollarSign, Clock, MapPin, Calendar } from "lucide-react";

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
  { label: string; color: string; bg: string; order: number; description: string }
> = {
  QUOTE_SENT: {
    label: "Quote Sent",
    color: "text-blue-700",
    bg: "bg-blue-100 border-blue-200",
    order: 1,
    description: "Quote delivered, awaiting reply",
  },
  AVAILABILITY: {
    label: "Availability",
    color: "text-amber-700",
    bg: "bg-amber-100 border-amber-200",
    order: 2,
    description: "Asked about availability",
  },
  SLOT_CHOICE: {
    label: "Slot Choice",
    color: "text-orange-700",
    bg: "bg-orange-100 border-orange-200",
    order: 3,
    description: "Offered time slots",
  },
  ADDRESS: {
    label: "Address",
    color: "text-purple-700",
    bg: "bg-purple-100 border-purple-200",
    order: 4,
    description: "Collecting address",
  },
  CONFIRMATION: {
    label: "Confirmation",
    color: "text-teal-700",
    bg: "bg-teal-100 border-teal-200",
    order: 5,
    description: "Booking confirmed",
  },
  CALL_SCHEDULED: {
    label: "Call Scheduled",
    color: "text-indigo-700",
    bg: "bg-indigo-100 border-indigo-200",
    order: 6,
    description: "Call requested",
  },
  DONE: {
    label: "Done",
    color: "text-green-700",
    bg: "bg-green-100 border-green-200",
    order: 7,
    description: "Conversation complete",
  },
  UNHANDLED: {
    label: "Needs Review",
    color: "text-red-700",
    bg: "bg-red-100 border-red-200",
    order: 8,
    description: "AI couldn't parse reply",
  },
};

const ALL_STAGES = Object.keys(STAGE_CONFIG) as Stage[];

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

// ── Funnel stats bar ──────────────────────────────────────────────────────────

function FunnelStats({ byStage, total }: { byStage: Record<string, number>; total: number }) {
  const stages: Stage[] = [
    "QUOTE_SENT",
    "AVAILABILITY",
    "SLOT_CHOICE",
    "ADDRESS",
    "CONFIRMATION",
    "CALL_SCHEDULED",
    "DONE",
    "UNHANDLED",
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
      {stages.map(stage => {
        const cfg = STAGE_CONFIG[stage];
        const count = byStage[stage] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div
            key={stage}
            className={`rounded-xl border p-3 flex flex-col gap-1 ${cfg.bg}`}
          >
            <span className={`text-xs font-semibold uppercase tracking-wide ${cfg.color}`}>
              {cfg.label}
            </span>
            <span className={`text-2xl font-bold ${cfg.color}`}>{count}</span>
            <span className="text-xs text-gray-500">{pct}% of total</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Stage badge ───────────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: string }) {
  const cfg = STAGE_CONFIG[stage as Stage] ?? {
    label: stage,
    color: "text-gray-700",
    bg: "bg-gray-100 border-gray-200",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cfg.bg} ${cfg.color}`}
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm">
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
              ✕
            </Button>
          </div>
        </div>

        {/* Details */}
        <div className="px-4 py-3 bg-gray-50 border-b grid grid-cols-2 gap-2 text-sm">
          {session.quotedPrice && (
            <div>
              <span className="text-gray-500">Quote:</span>{" "}
              <span className="font-semibold text-coral">${session.quotedPrice}</span>
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
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-coral text-white rounded-br-sm"
                      : "bg-gray-100 text-gray-800 rounded-bl-sm"
                  }`}
                  style={msg.role === "user" ? { backgroundColor: "#E8603C" } : {}}
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

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
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

  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    refetch,
    isFetching,
  } = trpc.leads.list.useQuery(undefined, { refetchInterval: 30000 });

  const { data: stats } = trpc.leads.stats.useQuery(undefined, {
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

  return (
    <div className="min-h-screen bg-[#FFF8F5]">
      {/* Top bar */}
      <header className="bg-white border-b border-[#F0D8D0] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#E8603C] flex items-center justify-center">
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
        {/* Summary */}
        <div className="mb-4 flex items-center gap-2">
          <span className="text-2xl font-bold text-gray-900">{stats?.total ?? 0}</span>
          <span className="text-gray-500 text-sm">total leads</span>
        </div>

        {/* Funnel stats */}
        {stats && <FunnelStats byStage={stats.byStage} total={stats.total} />}

        {/* Filters */}
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
          <span className="text-sm text-gray-500 self-center">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-[#F0D8D0] overflow-hidden shadow-sm">
          {sessionsLoading ? (
            <div className="py-20 text-center text-gray-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-[#E8603C]" />
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
                    <TableHead className="font-semibold text-gray-700 w-40">Lead</TableHead>
                    <TableHead className="font-semibold text-gray-700">Service</TableHead>
                    <TableHead className="font-semibold text-gray-700 w-28">Quote</TableHead>
                    <TableHead className="font-semibold text-gray-700 w-36">Stage</TableHead>
                    <TableHead className="font-semibold text-gray-700">Slot / Address</TableHead>
                    <TableHead className="font-semibold text-gray-700 w-28">Updated</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(session => (
                    <TableRow
                      key={session.id}
                      className="hover:bg-[#FFF8F5] cursor-pointer transition-colors"
                      onClick={() => setSelectedSession(session)}
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
                          <span className="font-semibold text-[#E8603C] flex items-center gap-1">
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
                          className="text-[#E8603C] hover:text-[#C94A28] hover:bg-[#FFF0EC] text-xs"
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
          Auto-refreshes every 30 seconds · Click any row to view conversation history
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
