/**
 * LeadOps — Revenue Radar
 * Lead Ops subpage inside OpsChat.
 * Layer 1: Real lead list from leads.listForLeadOps
 * Layer 3: Claim, Send, Book, Close, Follow-up, Assign mutations wired
 */
import React, { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Bell,
  Phone,
  MessageSquare,
  Send,
  Sparkles,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Users,
  UserPlus,
  ShieldCheck,
  Target,
  Timer,
  ArrowUpRight,
  Bot,
  ClipboardList,
  Plus,
  Loader2,
  X,
  CalendarClock,
  UserCheck,
  ChevronDown,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type RealLead = {
  id: number;
  name: string;
  phone: string;
  source: string;
  sourceRaw: string;
  service: string;
  bedrooms: string;
  bathrooms: string;
  stage: string;
  status: "unclaimed" | "awaiting_reply" | "replied" | "follow_up" | "booked";
  filterTag: "Hot" | "Follow-up" | "Booked";
  estimatedValue: number;
  confidence: number;
  ageMs: number;
  assignedAgentId: number | null;
  assignedAgentName: string | null;
  lastOutboundAt: number | null;
  lastInboundAt: number | null;
  lastCalledAt: number | null;
  lastCalledByAgentName: string | null;
  createdAt: Date | string;
  aiMode: number | string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatLastTouch(lead: RealLead): string {
  if (lead.lastInboundAt) {
    const ago = Date.now() - lead.lastInboundAt;
    return `Customer replied ${formatAge(ago)} ago`;
  }
  if (lead.lastOutboundAt) {
    const ago = Date.now() - lead.lastOutboundAt;
    return `Outreach sent ${formatAge(ago)} ago`;
  }
  return "No outreach yet";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({
  status,
  claimedAt,
  onClaim,
  isClaiming,
}: {
  status: RealLead["status"];
  claimedAt?: number | null;
  onClaim?: (e: React.MouseEvent) => void;
  isClaiming?: boolean;
}) {
  const styles: Record<RealLead["status"], string> = {
    unclaimed:      "bg-rose-50 text-rose-700 border-rose-200",
    awaiting_reply: "bg-amber-50 text-amber-700 border-amber-200",
    replied:        "bg-blue-50 text-blue-700 border-blue-200",
    follow_up:      "bg-slate-50 text-slate-700 border-slate-200",
    booked:         "bg-emerald-50 text-emerald-700 border-emerald-200",
  };

  // Claimed pill — show agent name + time
  if (status !== "unclaimed" && claimedAt) {
    const mins = Math.floor((Date.now() - claimedAt) / 60_000);
    const label = mins < 1 ? "Claimed just now" : `Claimed ${mins}m ago`;
    return (
      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
        {label}
      </span>
    );
  }

  // Clickable "Needs claim" pill
  if (status === "unclaimed" && onClaim) {
    return (
      <button
        onClick={onClaim}
        disabled={isClaiming}
        className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100 active:scale-95 transition disabled:opacity-50"
      >
        {isClaiming ? "Claiming…" : "Needs claim"}
      </button>
    );
  }

  const labels: Record<RealLead["status"], string> = {
    unclaimed:      "Needs claim",
    awaiting_reply: "Reply due",
    replied:        "New reply",
    follow_up:      "Follow-up",
    booked:         "Booked",
  };
  return (
    <span className={cn("rounded-full border px-2.5 py-1 text-xs font-bold", styles[status])}>
      {labels[status]}
    </span>
  );
}

function LeadCard({
  lead,
  active,
  onClick,
  onClaim,
  claimedAt,
  isClaiming,
}: {
  lead: RealLead;
  active: boolean;
  onClick: (l: RealLead) => void;
  onClaim?: (e: React.MouseEvent) => void;
  claimedAt?: number | null;
  isClaiming?: boolean;
}) {
  const isCritical = lead.status === "unclaimed" && lead.ageMs < 120_000;
  return (
    <motion.button
      layout
      onClick={() => onClick(lead)}
      whileHover={{ y: -2 }}
      className={cn(
        "w-full text-left rounded-3xl border p-4 transition shadow-sm",
        active
          ? "border-slate-900 bg-white shadow-xl"
          : isCritical
          ? "border-rose-200 bg-rose-50/70"
          : "border-slate-200 bg-white hover:shadow-lg"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isCritical && <Flame className="h-4 w-4 text-rose-500 shrink-0" />}
            <h3 className="truncate text-base font-black text-slate-950">{lead.name}</h3>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-500">{lead.service}</p>
        </div>
        <StatusPill status={lead.status} onClaim={onClaim} claimedAt={claimedAt} isClaiming={isClaiming} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl bg-white/80 p-3 border border-slate-100">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Age</div>
          <div className={cn("mt-1 font-black", isCritical ? "text-rose-600" : "text-slate-900")}>
            {formatAge(lead.ageMs)}
          </div>
        </div>
        <div className="rounded-2xl bg-white/80 p-3 border border-slate-100">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Value</div>
          <div className="mt-1 font-black text-slate-900">${lead.estimatedValue}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-2xl bg-slate-950 px-3 py-2 text-white">
        <div className="text-xs font-semibold opacity-70">{lead.source}</div>
        <div className="text-xs font-bold">{lead.confidence}% close fit</div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
        <Users className="h-4 w-4 shrink-0" />
        <span className="truncate">{lead.assignedAgentName ?? "Unassigned"}</span>
      </div>
      {lead.lastCalledAt && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-violet-600 font-semibold">
          <Phone className="h-3 w-3" />
          <span>Called {formatAge(Date.now() - lead.lastCalledAt)} ago{lead.lastCalledByAgentName ? ` · ${lead.lastCalledByAgentName}` : ""}</span>
        </div>
      )}
    </motion.button>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="rounded-2xl bg-slate-100 p-2">
          <Icon className="h-5 w-5 text-slate-700" />
        </div>
        <ArrowUpRight className="h-4 w-4 text-slate-400" />
      </div>
      <div className="mt-4 text-3xl font-black tracking-tight text-slate-950">{value}</div>
      <div className="mt-1 text-sm font-semibold text-slate-500">{label}</div>
      <div className="mt-2 text-xs text-slate-400">{sub}</div>
    </div>
  );
}

// ── Follow-up modal ───────────────────────────────────────────────────────────

function FollowUpModal({
  sessionId,
  onClose,
  onSuccess,
}: {
  sessionId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [date, setDate] = useState("");
  const [message, setMessage] = useState(
    "Hi, just circling back on this. We have some availability and would love to get you scheduled!"
  );
  const setFollowUp = trpc.leads.adminSetFollowUp.useMutation({
    onSuccess: () => {
      toast.success("Follow-up scheduled");
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black">Schedule Follow-up</h3>
          <button onClick={onClose} className="rounded-xl p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500">Follow-up Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="h-24 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
            />
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-200 py-2.5 text-sm font-bold hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            disabled={!date || setFollowUp.isPending}
            onClick={() =>
              setFollowUp.mutate({ sessionId, followUpDate: date, followUpMessage: message })
            }
            className="flex-1 rounded-2xl bg-slate-950 py-2.5 text-sm font-black text-white disabled:opacity-50"
          >
            {setFollowUp.isPending ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : (
              "Schedule"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Assign modal ──────────────────────────────────────────────────────────────

function AssignModal({
  sessionId,
  onClose,
  onSuccess,
}: {
  sessionId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { data: agentList = [] } = trpc.agents.list.useQuery();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const assignAgent = trpc.leads.adminAssignAgent.useMutation({
    onSuccess: () => {
      toast.success("Lead assigned");
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const activeAgents = agentList.filter((a) => a.isActive);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black">Assign Lead</h3>
          <button onClick={onClose} className="rounded-xl p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {activeAgents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setSelectedId(agent.id)}
              className={cn(
                "w-full rounded-2xl border px-4 py-3 text-left text-sm font-bold transition",
                selectedId === agent.id
                  ? "border-slate-900 bg-slate-950 text-white"
                  : "border-slate-200 hover:bg-slate-50"
              )}
            >
              {agent.name}
            </button>
          ))}
        </div>
        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-200 py-2.5 text-sm font-bold hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            disabled={selectedId === null || assignAgent.isPending}
            onClick={() => assignAgent.mutate({ sessionId, agentId: selectedId })}
            className="flex-1 rounded-2xl bg-slate-950 py-2.5 text-sm font-black text-white disabled:opacity-50"
          >
            {assignAgent.isPending ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : (
              "Assign"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LeadOps() {
  const [activeLead, setActiveLead] = useState<RealLead | null>(null);
  const [filterTab, setFilterTab] = useState<"Hot" | "Follow-up" | "Booked">("Hot");
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState("");
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  // Track when each lead was claimed (client-side, keyed by sessionId)
  const [claimedAtMap, setClaimedAtMap] = useState<Record<number, number>>({});
  // Time range for Live Team stats
  const [teamRange, setTeamRange] = useState<'today' | 'week' | 'month' | 'all'>('today');
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [addLeadForm, setAddLeadForm] = useState({ name: "", phone: "", email: "", serviceType: "Standard Cleaning", source: "phone" as "yelp"|"google"|"thumbtack"|"bark"|"phone"|"other", notes: "", amount: "" });

  const utils = trpc.useUtils();

  const { data: leads = [], isLoading, error } = trpc.leads.listForLeadOps.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // Layer 4: real Live Team data
  const { data: teamActivity = [] } = trpc.leads.getTeamActivity.useQuery({ range: teamRange }, {
    refetchInterval: 30_000,
  });

  // Layer 2: real conversation thread for the active lead
  const { data: activeSession, isLoading: isLoadingConvo } = trpc.leads.getById.useQuery(
    { id: activeLead?.id ?? 0 },
    { enabled: !!activeLead, refetchInterval: 15_000 }
  );

  // Parse messageHistory into typed messages
  type ConvoMsg = { role: string; content: string; ts?: number };
  const convoMessages = React.useMemo<ConvoMsg[]>(() => {
    if (!activeSession?.messageHistory) return [];
    try {
      return JSON.parse(activeSession.messageHistory) as ConvoMsg[];
    } catch {
      return [];
    }
  }, [activeSession?.messageHistory]);

  // Set first lead as active once data loads; also sync activeLead from server
  // after mutations (book, close, claim) so status/filterTag stay current.
  // NOTE: leads is the FULL unfiltered list — always search it regardless of filterTab.
  React.useEffect(() => {
    if (leads.length === 0) return;
    if (!activeLead) {
      setActiveLead(leads[0]);
      setComposer(buildDraft(leads[0]));
    } else {
      // Sync the active lead's fields from the freshly-fetched full list
      const updated = leads.find((l) => l.id === activeLead.id);
      if (updated) {
        // Always overwrite — any field may have changed (status, filterTag, assignedAgentId, etc.)
        if (
          updated.status !== activeLead.status ||
          updated.filterTag !== activeLead.filterTag ||
          updated.assignedAgentId !== activeLead.assignedAgentId ||
          updated.assignedAgentName !== activeLead.assignedAgentName
        ) {
          setActiveLead(updated);
        }
      }
    }
  }, [leads]); // intentionally omit activeLead to avoid loop

  // Auto-scroll conversation to bottom when messages update
  React.useEffect(() => {
    const el = document.getElementById("lead-convo-scroll");
    if (el) el.scrollTop = el.scrollHeight;
  }, [convoMessages.length]);

  // Layer 5: AI Next Best Action
  const { data: nba, isLoading: isLoadingNba, refetch: refetchNba } = trpc.leads.getNextBestAction.useQuery(
    { sessionId: activeLead?.id ?? 0 },
    { enabled: !!activeLead, staleTime: 60_000 }
  );

  function buildDraft(lead: RealLead): string {
    return `Hi ${lead.name.split(" ")[0]}, this is Madison from Maids in Black 👋 I just saw your ${lead.source} request and would love to help with ${lead.service}. What day works best for you?`;
  }

  const refreshLeads = useCallback(() => {
    utils.leads.listForLeadOps.invalidate();
  }, [utils]);

  // Subscribe to SSE so claims/updates made in CommandChat (or by another agent)
  // reflect instantly in Lead Ops without waiting for the 30s poll cycle.
  useOpsStream({
    onLeadUpdate: () => {
      utils.leads.listForLeadOps.invalidate();
      utils.leads.getTeamActivity.invalidate();
    },
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const claimMutation = trpc.agents.claimLead.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Lead claimed ✓");
      // Record claim time so the pill shows "Claimed Xm ago"
      setClaimedAtMap((prev) => ({ ...prev, [variables.sessionId]: Date.now() }));
      refreshLeads();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendMutation = trpc.leads.sendMessage.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Message sent ✓");
      setComposer("");
      // Refresh the conversation thread immediately
      utils.leads.getById.invalidate({ id: variables.sessionId });
      refreshLeads();
      // Scroll conversation to bottom
      setTimeout(() => {
        const el = document.getElementById("lead-convo-scroll");
        if (el) el.scrollTop = el.scrollHeight;
      }, 200);
    },
    onError: (e) => toast.error(e.message),
  });

  const bookMutation = trpc.leads.agentUpdateStage.useMutation({
    onSuccess: () => {
      toast.success("Lead marked as booked 🎉");
      refreshLeads();
      // Refresh Live Team panel so bookedToday count updates
      utils.leads.getTeamActivity.invalidate();
      // Refresh CommandChat today's bookings number
      utils.leads.stats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const closeMutation = trpc.leads.agentUpdateStage.useMutation({
    onSuccess: () => {
      toast.success("Lead closed");
      refreshLeads();
    },
    onError: (e) => toast.error(e.message),
  });

  const createManualMutation = trpc.leads.createManual.useMutation({
    onSuccess: (result) => {
      toast.success("Lead added and claimed!");
      setShowAddLeadModal(false);
      setAddLeadForm({ name: "", phone: "", email: "", serviceType: "Standard Cleaning", source: "phone", notes: "", amount: "" });
      refreshLeads();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAddLead = () => {
    if (!addLeadForm.name.trim() || !addLeadForm.phone.trim()) {
      toast.error("Name and phone are required");
      return;
    }
    createManualMutation.mutate({
      name: addLeadForm.name.trim(),
      phone: addLeadForm.phone.trim(),
      email: addLeadForm.email.trim() || undefined,
      serviceType: addLeadForm.serviceType || "Standard Cleaning",
      source: addLeadForm.source,
      notes: addLeadForm.notes.trim() || undefined,
      amount: addLeadForm.amount ? parseInt(addLeadForm.amount, 10) : undefined,
    });
  };

  const handleClaim = () => {
    if (!activeLead) return;
    claimMutation.mutate({ sessionId: activeLead.id });
  };

  const handleClaimFromCard = (lead: RealLead) => (e: React.MouseEvent) => {
    e.stopPropagation(); // don't also select the card
    claimMutation.mutate({ sessionId: lead.id });
    // Also select the lead so the detail panel opens
    setActiveLead(lead);
    setComposer(buildDraft(lead));
  };

  const handleSend = () => {
    if (!activeLead || !composer.trim()) return;
    sendMutation.mutate({ sessionId: activeLead.id, message: composer.trim() });
  };

  const handleBook = () => {
    if (!activeLead) return;
    bookMutation.mutate({ sessionId: activeLead.id, stage: "BOOKED" });
  };

  const handleClose = () => {
    if (!activeLead) return;
    closeMutation.mutate({ sessionId: activeLead.id, stage: "LOST" });
  };

  const handleSelectLead = (lead: RealLead) => {
    setActiveLead(lead);
    setComposer(buildDraft(lead));
  };

  // ── Derived data ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = leads.filter((l) => l.filterTag === filterTab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.phone.includes(q) ||
          l.service.toLowerCase().includes(q) ||
          l.source.toLowerCase().includes(q)
      );
    }
    return list;
  }, [leads, filterTab, search]);

  const unclaimedCount = leads.filter((l) => l.status === "unclaimed").length;
  const bookedCount    = leads.filter((l) => l.status === "booked").length;
  const bookedRevenue  = leads.filter((l) => l.status === "booked").reduce((s, l) => s + l.estimatedValue, 0);
  const closeRate      = leads.length > 0 ? Math.round((bookedCount / leads.length) * 100) : 0;

  const isSending  = sendMutation.isPending;
  const isClaiming = claimMutation.isPending;
  const isBooking  = bookMutation.isPending;
  const isClosing  = closeMutation.isPending;
  const anyPending = isSending || isClaiming || isBooking || isClosing;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {showFollowUpModal && activeLead && (
        <FollowUpModal
          sessionId={activeLead.id}
          onClose={() => setShowFollowUpModal(false)}
          onSuccess={refreshLeads}
        />
      )}
      {showAssignModal && activeLead && (
        <AssignModal
          sessionId={activeLead.id}
          onClose={() => setShowAssignModal(false)}
          onSuccess={refreshLeads}
        />
      )}

      {/* ── Add Lead Modal ──────────────────────────────────────────────── */}
      {showAddLeadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-black">Add Lead Manually</h2>
              <button onClick={() => setShowAddLeadModal(false)} className="rounded-full p-1.5 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-500">Name *</label>
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                    placeholder="Jane Smith"
                    value={addLeadForm.name}
                    onChange={e => setAddLeadForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-500">Phone *</label>
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                    placeholder="+1 555 000 0000"
                    value={addLeadForm.phone}
                    onChange={e => setAddLeadForm(f => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">Email</label>
                <input
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                  placeholder="jane@example.com"
                  value={addLeadForm.email}
                  onChange={e => setAddLeadForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-500">Service</label>
                  <select
                    className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-white"
                    value={addLeadForm.serviceType}
                    onChange={e => setAddLeadForm(f => ({ ...f, serviceType: e.target.value }))}
                  >
                    <option>Standard Cleaning</option>
                    <option>Deep Cleaning</option>
                    <option>Move In/Out Cleaning</option>
                    <option>Post Construction</option>
                    <option>Recurring Cleaning</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-500">Source</label>
                  <select
                    className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 bg-white"
                    value={addLeadForm.source}
                    onChange={e => setAddLeadForm(f => ({ ...f, source: e.target.value as any }))}
                  >
                    <option value="phone">Phone</option>
                    <option value="yelp">Yelp</option>
                    <option value="google">Google</option>
                    <option value="thumbtack">Thumbtack</option>
                    <option value="bark">Bark</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">Estimated Value ($)</label>
                <input
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                  placeholder="289"
                  type="number"
                  value={addLeadForm.amount}
                  onChange={e => setAddLeadForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">Notes</label>
                <textarea
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 resize-none"
                  placeholder="Any context about this lead..."
                  rows={2}
                  value={addLeadForm.notes}
                  onChange={e => setAddLeadForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setShowAddLeadModal(false)}
                className="flex-1 rounded-2xl border border-slate-200 py-2.5 text-sm font-bold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddLead}
                disabled={createManualMutation.isPending}
                className="flex-1 rounded-2xl bg-slate-950 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {createManualMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Add & Claim Lead
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex h-full overflow-hidden bg-slate-100 text-slate-950">
        {/* ── Left panel: lead list ─────────────────────────────────────── */}
        <aside className="w-[340px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Lead Ops</p>
              <h1 className="mt-0.5 text-2xl font-black tracking-tight">Revenue Radar</h1>
            </div>
            <button className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm hover:bg-slate-50">
              <Bell className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-4 rounded-3xl border border-slate-200 bg-slate-50 p-1.5">
            <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2.5 shadow-sm">
              <Search className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                placeholder="Search leads, phones, services"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2.5">
            <MetricCard icon={AlertTriangle} label="Unclaimed"    value={String(unclaimedCount)} sub="Last 7 days" />
            <MetricCard icon={Timer}         label="Avg Response" value="—"                       sub="Coming soon" />
            <MetricCard icon={CheckCircle2}  label="Booked"       value={String(bookedCount)}     sub={`$${bookedRevenue.toLocaleString()} revenue`} />
            <MetricCard icon={Target}        label="Close Rate"   value={`${closeRate}%`}          sub="Last 7 days" />
          </div>

          <div className="mb-3 flex rounded-2xl bg-slate-100 p-1">
            {(["Hot", "Follow-up", "Booked"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setFilterTab(item)}
                className={cn(
                  "flex-1 rounded-xl px-3 py-2 text-sm font-bold transition",
                  filterTab === item ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-900"
                )}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="space-y-3 pb-6">
            {isLoading && (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
            {error && (
              <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">
                Failed to load leads. Please refresh.
              </div>
            )}
            {!isLoading && !error && filtered.length === 0 && (
              <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400">
                No {filterTab.toLowerCase()} leads in the last 7 days.
              </div>
            )}
            {filtered.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                active={activeLead?.id === lead.id}
                onClick={handleSelectLead}
                onClaim={lead.status === "unclaimed" ? handleClaimFromCard(lead) : undefined}
                claimedAt={claimedAtMap[lead.id] ?? null}
                isClaiming={claimMutation.isPending && claimMutation.variables?.sessionId === lead.id}
              />
            ))}
          </div>
        </aside>

        {/* ── Center + right: lead detail ───────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {!activeLead ? (
            <div className="flex flex-1 items-center justify-center text-slate-400">
              {isLoading ? <Loader2 className="h-8 w-8 animate-spin" /> : "Select a lead to view details"}
            </div>
          ) : (
            <>
              {/* Detail header */}
              <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-lg font-black text-white">
                    {activeLead.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-black tracking-tight">{activeLead.name}</h2>
                      <StatusPill status={activeLead.status} />
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-slate-500">
                      {activeLead.service} • {activeLead.bedrooms}bd / {activeLead.bathrooms}ba • {activeLead.source}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {activeLead.status === "unclaimed" && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-right">
                      <div className="text-[10px] font-black uppercase tracking-wide text-rose-400">Age</div>
                      <div className="text-lg font-black text-rose-600">{formatAge(activeLead.ageMs)}</div>
                    </div>
                  )}
                  <button
                    onClick={() => window.open(`tel:${activeLead.phone}`)}
                    className="flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 font-black text-white shadow-lg hover:scale-[1.02] text-sm"
                  >
                    <Phone className="h-4 w-4" /> Call
                  </button>
                  <button
                    onClick={() => document.getElementById("lead-composer")?.focus()}
                    className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 font-black shadow-sm hover:bg-slate-50 text-sm"
                  >
                    <MessageSquare className="h-4 w-4" /> Text
                  </button>
                  <button
                    onClick={() => setShowAddLeadModal(true)}
                    className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold shadow-sm hover:bg-slate-50"
                  >
                    <UserPlus className="h-4 w-4" /> Add Lead
                  </button>
                </div>
              </header>

              {/* Detail body */}
              <div className="grid min-h-0 flex-1 grid-cols-[1fr_340px] overflow-hidden">
                <section className="overflow-y-auto p-5">
                  {/* Quick Actions — top row, always visible */}
                  <div className="mb-5 grid grid-cols-6 gap-2">
                    {/* Claim */}
                    <button
                      onClick={handleClaim}
                      disabled={isClaiming || activeLead.status === "booked"}
                      className="flex items-center justify-center gap-2 rounded-3xl bg-slate-950 px-4 py-3.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40 transition shadow-sm"
                    >
                      {isClaiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                      Claim
                    </button>

                    {/* Quote — placeholder */}
                    <button
                      onClick={() => {}}
                      className="flex items-center justify-center gap-2 rounded-3xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-black hover:bg-slate-50 transition shadow-sm"
                    >
                      <FileText className="h-4 w-4" />
                      Quote
                    </button>

                    {/* Book */}
                    <button
                      onClick={handleBook}
                      disabled={isBooking || activeLead.status === "booked"}
                      className="flex items-center justify-center gap-2 rounded-3xl bg-emerald-600 px-4 py-3.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-40 transition shadow-sm"
                    >
                      {isBooking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Book
                    </button>

                    {/* Follow-up */}
                    <button
                      onClick={() => setShowFollowUpModal(true)}
                      disabled={anyPending}
                      className="flex items-center justify-center gap-2 rounded-3xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-black hover:bg-slate-50 disabled:opacity-40 transition shadow-sm"
                    >
                      <CalendarClock className="h-4 w-4" />
                      Follow-up
                    </button>

                    {/* Assign */}
                    <button
                      onClick={() => setShowAssignModal(true)}
                      disabled={anyPending}
                      className="flex items-center justify-center gap-2 rounded-3xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-black hover:bg-slate-50 disabled:opacity-40 transition shadow-sm"
                    >
                      <Users className="h-4 w-4" />
                      Assign
                    </button>

                    {/* Close */}
                    <button
                      onClick={handleClose}
                      disabled={isClosing || activeLead.status === "booked"}
                      className="flex items-center justify-center gap-2 rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm font-black text-rose-700 hover:bg-rose-100 disabled:opacity-40 transition shadow-sm"
                    >
                      {isClosing ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                      Close
                    </button>
                  </div>

                  {/* AI Next Best Action */}
                  <div className="mb-5 rounded-[28px] bg-[#071026] p-5 text-white shadow-2xl">
                    <div className="mb-4 flex items-start justify-between">
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.28em] text-white/50">
                          <Sparkles className="h-3.5 w-3.5" /> AI Next Best Action
                        </div>
                        {isLoadingNba ? (
                          <div className="flex items-center gap-2 py-1">
                            <Loader2 className="h-4 w-4 animate-spin text-white/40" />
                            <span className="text-sm text-white/40">Analyzing conversation…</span>
                          </div>
                        ) : (
                          <>
                            <h3 className="text-2xl font-black">
                              {nba?.headline ??
                                (activeLead.status === "unclaimed"
                                  ? "Claim + text in under 60 seconds"
                                  : activeLead.status === "replied"
                                  ? "Customer replied — respond now"
                                  : "Continue the conversation")}
                            </h3>
                            <p className="mt-2 max-w-xl text-sm leading-6 text-white/70">
                              {nba?.body ??
                                (activeLead.status === "unclaimed"
                                  ? "This lead has no owner yet. Send the first text now."
                                  : "Keep the conversation moving to convert this lead.")}
                            </p>
                            {nba?.suggestedReply && (
                              <button
                                onClick={() => setComposer(nba.suggestedReply)}
                                className="mt-3 flex items-center gap-1.5 rounded-2xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/20 transition"
                              >
                                <Send className="h-3 w-3" /> Use suggested reply
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      <button
                        onClick={() => refetchNba()}
                        disabled={isLoadingNba}
                        className="ml-3 mt-1 rounded-2xl border border-white/10 bg-white/5 p-2 hover:bg-white/10 transition disabled:opacity-40"
                        title="Refresh AI suggestion"
                      >
                        <Sparkles className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <button
                        onClick={() => window.open(`tel:${activeLead.phone}`)}
                        className={cn(
                          "rounded-3xl border p-4 text-left transition",
                          nba?.action === "call"
                            ? "border-violet-400/40 bg-violet-500/20 ring-1 ring-violet-400/30"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        )}
                      >
                        <Phone className="mb-3 h-5 w-5" />
                        <div className="font-black text-sm">Calling Now</div>
                        <p className="mt-1 text-xs text-white/60">
                          {activeLead.lastCalledAt
                            ? `Last called ${formatAge(Date.now() - activeLead.lastCalledAt)} ago`
                            : "Best for high-intent leads."}
                        </p>
                      </button>
                      <button
                        onClick={() => { document.getElementById("lead-composer")?.focus(); if (nba?.suggestedReply) setComposer(nba.suggestedReply); }}
                        className={cn(
                          "rounded-3xl border p-4 text-left transition",
                          nba?.action === "text"
                            ? "border-emerald-400/40 bg-emerald-500/20 ring-1 ring-emerald-400/30"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        )}
                      >
                        <Send className="mb-3 h-5 w-5" />
                        <div className="font-black text-sm">Send AI Text</div>
                        <p className="mt-1 text-xs text-white/60">AI reply loaded in composer.</p>
                      </button>
                      <button className={cn(
                        "rounded-3xl border p-4 text-left transition",
                        nba?.action === "quote"
                          ? "border-amber-400/40 bg-amber-500/20 ring-1 ring-amber-400/30"
                          : "border-white/10 bg-white/5 hover:bg-white/10"
                      )}>
                        <ClipboardList className="mb-3 h-5 w-5" />
                        <div className="font-black text-sm">Create Quote</div>
                        <p className="mt-1 text-xs text-white/60">Use property details and source data.</p>
                      </button>
                    </div>
                  </div>

                  {/* Conversation + detail cards — stacked */}
                  <div className="flex flex-col gap-4">
                    {/* Conversation */}
                    <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-200 p-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-black">Lead Conversation</h3>
                          <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                            <Radio className="h-3 w-3" /> Live
                          </div>
                        </div>
                      </div>

                      {/* Message thread */}
                      <div className="max-h-[420px] overflow-y-auto space-y-3 p-4" id="lead-convo-scroll">
                        {isLoadingConvo ? (
                          <div className="flex justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                          </div>
                        ) : convoMessages.length === 0 ? (
                          <div className="rounded-3xl bg-slate-50 p-4">
                            <div className="mb-1 text-xs font-bold text-slate-400">{activeLead.source} request</div>
                            <p className="text-sm leading-6 text-slate-600">
                              {activeLead.service} • {activeLead.bedrooms} bed / {activeLead.bathrooms} bath
                            </p>
                            <p className="mt-2 text-xs text-slate-400">No messages yet — send the first text below.</p>
                          </div>
                        ) : (
                          convoMessages.map((msg, i) => {
                            const isUser = msg.role === "user";
                            const isSystem = msg.role === "system";
                            if (isSystem) return null;
                            const timeLabel = msg.ts
                              ? new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                              : null;
                            return (
                              <div
                                key={i}
                                className={cn(
                                  "max-w-[82%]",
                                  isUser ? "mr-auto" : "ml-auto"
                                )}
                              >
                                <div
                                  className={cn(
                                    "rounded-3xl p-4 text-sm leading-6",
                                    isUser
                                      ? "rounded-tl-md bg-slate-100 text-slate-800"
                                      : "rounded-tr-md bg-slate-950 text-white"
                                  )}
                                >
                                  {msg.content}
                                </div>
                                {timeLabel && (
                                  <div className={cn(
                                    "mt-1 text-[10px] text-slate-400",
                                    isUser ? "text-left" : "text-right"
                                  )}>
                                    {isUser ? activeLead.name.split(" ")[0] : "Agent"} · {timeLabel}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="border-t border-slate-200 p-4">
                        <textarea
                          id="lead-composer"
                          value={composer}
                          onChange={(e) => setComposer(e.target.value)}
                          className="h-24 w-full resize-none rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-slate-400"
                        />
                        <div className="mt-3 flex items-center justify-between">
                          <div className="flex gap-2">
                            <button className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold hover:bg-slate-50">
                              <Bot className="mr-1.5 inline h-3.5 w-3.5" />Rewrite
                            </button>
                            <button className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold hover:bg-slate-50">Add urgency</button>
                            <button className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold hover:bg-slate-50">Softer tone</button>
                          </div>
                          <button
                            onClick={handleSend}
                            disabled={isSending || !composer.trim()}
                            className="flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 font-black text-white text-sm disabled:opacity-50"
                          >
                            {isSending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Send className="h-4 w-4" /> Send
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>


                    {/* Lead details + escalation row */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                        <h3 className="mb-3 text-base font-black">Lead Details</h3>
                        {[
                          ["Phone",      activeLead.phone],
                          ["Property",   `${activeLead.bedrooms} bed / ${activeLead.bathrooms} bath`],
                          ["Stage",      activeLead.stage],
                          ["Last touch", formatLastTouch(activeLead)],
                        ].map(([k, v]) => (
                          <div key={k} className="mb-2.5 flex flex-col gap-0.5 text-sm">
                            <span className="font-bold text-slate-400">{k}</span>
                            <span className="font-semibold">{v}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-col gap-3">
                        <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-4 shadow-sm">
                          <div className="mb-2 flex items-center gap-2 text-amber-700">
                            <AlertTriangle className="h-4 w-4" />
                            <h3 className="font-black text-sm">Escalation Rule</h3>
                          </div>
                          <p className="text-xs leading-5 text-amber-800">
                            If not claimed in 60 seconds, notify manager and trigger auto-text.
                          </p>
                          <button className="mt-3 rounded-2xl bg-amber-600 px-3 py-1.5 text-xs font-black text-white">
                            Enable auto-response
                          </button>
                        </div>

                        {/* Assign + Close row */}
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setShowAssignModal(true)}
                            disabled={anyPending}
                            className="flex items-center justify-center gap-1.5 rounded-2xl bg-slate-100 px-3 py-2.5 text-xs font-black hover:bg-slate-200 disabled:opacity-40 transition"
                          >
                            <Users className="h-3.5 w-3.5" />
                            Assign
                          </button>
                          <button
                            onClick={handleClose}
                            disabled={isClosing || activeLead.status === "booked"}
                            className="flex items-center justify-center gap-1.5 rounded-2xl bg-rose-50 px-3 py-2.5 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:opacity-40 transition"
                          >
                            {isClosing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                            Close
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Right panel: Live Team (Layer 4 — real data) */}
                <aside className="overflow-y-auto border-l border-slate-200 bg-white p-4">
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Sales Floor</p>
                        <h3 className="mt-0.5 text-xl font-black">Live Team</h3>
                      </div>
                      <span className="text-[10px] font-bold text-slate-400">
                        {teamActivity.filter((a) => a.isOnline).length} online
                      </span>
                    </div>
                    {/* Compact time-range switcher */}
                    <div className="flex gap-1">
                      {(['today', 'week', 'month', 'all'] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => setTeamRange(r)}
                          className={cn(
                            "flex-1 rounded-xl py-1 text-[10px] font-black uppercase tracking-wide transition-colors",
                            teamRange === r
                              ? "bg-slate-950 text-white"
                              : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                          )}
                        >
                          {r === 'today' ? 'Today' : r === 'week' ? 'Wk' : r === 'month' ? 'Mo' : 'All'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mb-5 space-y-3">
                    {teamActivity.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4 text-center">No active agents</p>
                    ) : (
                      teamActivity.map((member) => {
                        const initials = member.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
                        const stateColor =
                          member.state === "On call" ? "text-violet-600" :
                          member.state === "Available" ? "text-emerald-600" :
                          member.state === "Offline" ? "text-slate-400" :
                          "text-amber-600";
                        const dotColor =
                          member.state === "On call" ? "bg-violet-500" :
                          member.state === "Available" ? "bg-emerald-500" :
                          member.state === "Offline" ? "bg-slate-300" :
                          "bg-amber-400";
                        return (
                          <div key={member.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex items-center gap-3">
                              {member.profilePhotoUrl ? (
                                <img
                                  src={member.profilePhotoUrl}
                                  alt={member.name}
                                  className="h-10 w-10 rounded-2xl object-cover"
                                />
                              ) : (
                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-200 font-black text-sm text-slate-600">
                                  {initials}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <h4 className="font-black text-sm truncate">{member.name}</h4>
                                  <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", dotColor)} />
                                </div>
                                <p className={cn("truncate text-xs font-semibold", stateColor)}>{member.state}</p>
                              </div>
                            </div>
                            <div className="mt-3 grid grid-cols-4 gap-1.5 text-xs">
                              <div className="rounded-2xl bg-white p-2.5">
                                <div className="font-black">{member.claimedCount ?? member.claimedToday}</div>
                                <div className="text-slate-400">claimed</div>
                              </div>
                              <div className="rounded-2xl bg-white p-2.5">
                                <div className="font-black">{member.bookedCount ?? member.bookedToday}</div>
                                <div className="text-slate-400">booked</div>
                                {(member.bookedRevenue ?? 0) > 0 && (
                                  <div className="text-[10px] font-bold text-emerald-600 leading-tight mt-0.5">
                                    ${(member.bookedRevenue ?? 0).toLocaleString()}
                                  </div>
                                )}
                              </div>
                              <div className="rounded-2xl bg-white p-2.5">
                                <div className={cn(
                                  "font-black",
                                  member.conversionRate !== null && member.conversionRate >= 50
                                    ? "text-emerald-600"
                                    : member.conversionRate !== null && member.conversionRate >= 25
                                    ? "text-amber-600"
                                    : "text-slate-900"
                                )}>
                                  {member.conversionRate !== null ? `${member.conversionRate}%` : "—"}
                                </div>
                                <div className="text-slate-400">conv.</div>
                              </div>
                              <div className="rounded-2xl bg-white p-2.5">
                                <div className="font-black">{member.avgResponseLabel}</div>
                                <div className="text-slate-400">avg resp</div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="rounded-[28px] bg-slate-950 p-4 text-white shadow-2xl">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-black">Today</h3>
                      <ShieldCheck className="h-5 w-5 text-emerald-300" />
                    </div>
                    <div className="space-y-3">
                      {[
                        ["Unclaimed", `${unclaimedCount}`, Math.min(unclaimedCount * 10, 100)],
                        ["Booked",    `${bookedCount}`,    Math.min(bookedCount * 10, 100)],
                        ["Close rate",`${closeRate}%`,     closeRate],
                      ].map(([label, pct, width]) => (
                        <div key={label as string}>
                          <div className="mb-1.5 flex justify-between text-xs">
                            <span>{label}</span>
                            <span className="font-black">{pct}</span>
                          </div>
                          <div className="h-2.5 rounded-full bg-white/10">
                            <div className="h-2.5 rounded-full bg-white" style={{ width: `${width}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                    <h3 className="mb-3 font-black">Today's Bookers</h3>
                    {teamActivity.filter((a) => a.bookedToday > 0).length === 0 ? (
                      <p className="text-xs text-slate-400">No bookings yet today</p>
                    ) : (
                      <div className="space-y-2">
                        {teamActivity
                          .filter((a) => a.bookedToday > 0)
                          .sort((a, b) => b.bookedToday - a.bookedToday)
                          .map((a) => (
                            <div key={a.id} className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-700">{a.name}</span>
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                                {a.bookedToday} booked
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
