/**
 * LeadsInbox — Revenue Workspace / Lead Journey
 * Purpose-built CS-style inbox for lead conversion.
 * Layout: dark rail + lead list (lanes/filters) + conversation thread + right panel
 *
 * Data: wired to real tRPC procedures (listWorkspace, getTimeline, sendWorkspaceMessage)
 * UI: exact original design — zero layout changes from the approved mock
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Phone,
  RefreshCw,
  Pencil,
  CheckCircle2,
  Send,
  Flame,
  Calendar,
  DollarSign,
  RotateCcw,
  Zap,
  Clock,
  Star,
  TrendingUp,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Users,
  Target,
  Sparkles,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Loader2,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";

// ── Types ─────────────────────────────────────────────────────────────────────

type Lane = "all" | "needs-me" | "ready-to-book" | "needs-price" | "reactivation" | "resolved";
type LeadFilter = "all" | "unread" | "campaign-reply";

type LeadTag = {
  label: string;
  color: "purple" | "orange" | "blue" | "green" | "gray" | "rose";
};

// Shape returned by listWorkspace
type WorkspaceSummary = {
  phone: string;
  sessionId: number;
  customerName: string | null;
  lastMessage: string | null;
  lastMessageAt: number | null;
  unreadCount: number;
  stage: string | null;
  isResolved: boolean;
  isBooked: boolean;
  bookedAmount: number | null;
  needsAttention: boolean;
  assignedAgentName: string | null;
  leadSource: string | null;
  createdAt: string | Date;
};

// Shape returned by getTimeline
type TimelineMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
  mediaUrls?: string[];
  sessionSource?: string;
};

type TimelineCampaign = {
  id: string;
  type: "campaign";
  campaignName: string;
  message: string | null;
  ts: number;
  status: string | null;
};

type TimelineCall = {
  id: string;
  type: "call";
  duration: number | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  direction: string | null;
  callerPhone: string | null;
  transcript: string | null;
  callDebrief: string | null;
  status: string | null;
  ts: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const TAG_STYLES: Record<LeadTag["color"], string> = {
  purple: "bg-violet-50 text-violet-700 border-violet-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  gray: "bg-slate-100 text-slate-600 border-slate-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
};

function MomentumBar({ value }: { value: number }) {
  const color =
    value >= 80
      ? "from-emerald-500 to-emerald-400"
      : value >= 60
      ? "from-violet-500 to-orange-400"
      : "from-slate-400 to-slate-300";
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1.5">
      <div
        className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-500`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function formatTs(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString();
}

function getInitials(name: string | null | undefined, phone: string): string {
  if (!name) return phone.slice(-2);
  const parts = name.trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function sourceToTag(source: string | null): LeadTag | null {
  if (!source) return null;
  if (source.startsWith("campaign:") || source.startsWith("always-on")) return { label: "Campaign", color: "purple" };
  if (source === "reactivation") return { label: "Reactivation", color: "orange" };
  if (source === "inbound-sms") return { label: "Inbound SMS", color: "blue" };
  if (source === "email") return { label: "Email lead", color: "green" };
  if (source === "quote-form") return { label: "Quote form", color: "green" };
  if (source === "command-center") return { label: "Outreach", color: "gray" };
  return { label: source, color: "gray" };
}

function stageToLane(stage: string | null): Lane {
  if (!stage) return "needs-me";
  const s = stage.toLowerCase();
  if (s === "resolved") return "resolved";
  if (s.includes("quote") || s.includes("price")) return "needs-price";
  if (s.includes("book") || s.includes("scheduled")) return "ready-to-book";
  if (s.includes("reactivat") || s.includes("rebooking")) return "reactivation";
  return "needs-me";
}

// Merge timeline messages + campaign events + calls into one sorted array
type TimelineEvent =
  | (TimelineMessage & { _type: "message" })
  | (TimelineCampaign & { _type: "campaign" })
  | (TimelineCall & { _type: "call" });

function buildTimeline(
  messages: TimelineMessage[],
  campaigns: TimelineCampaign[],
  calls: TimelineCall[]
): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...messages.map((m) => ({ ...m, _type: "message" as const })),
    ...campaigns.map((c) => ({ ...c, _type: "campaign" as const })),
    ...calls.map((c) => ({ ...c, _type: "call" as const })),
  ];
  return events.sort((a, b) => a.ts - b.ts);
}

// ── Lanes config ──────────────────────────────────────────────────────────────

const LANE_CONFIG: { id: Lane; label: string; emoji: string }[] = [
  { id: "needs-me", label: "Needs Me", emoji: "🔥" },
  { id: "ready-to-book", label: "Ready to Book", emoji: "📅" },
  { id: "needs-price", label: "Needs Price", emoji: "💸" },
  { id: "reactivation", label: "Reactivation", emoji: "🔁" },
  { id: "resolved", label: "Resolved", emoji: "✅" },
];

// ── Main Component ────────────────────────────────────────────────────────────

interface LeadsInboxProps {
  rail?: React.ReactNode;
  /** When set, auto-selects the conversation for this session ID on mount */
  initialSessionId?: number | null;
}

export default function LeadsInbox({ rail, initialSessionId }: LeadsInboxProps) {
  const [activeLane, setActiveLane] = useState<Lane>("all");
  const [activeFilter, setActiveFilter] = useState<LeadFilter>("all");
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  // Track which session we've already resolved so we don't re-resolve on re-renders
  const resolvedSessionRef = useRef<number | null>(null);
  const [composerText, setComposerText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const journeyRef = useRef<HTMLDivElement>(null);
  // Call recording playback state
  const [expandedCallIds, setExpandedCallIds] = useState<Set<string>>(new Set());
  const toggleCallExpanded = (id: string) =>
    setExpandedCallIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const callAudioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  // ── Data fetching ──────────────────────────────────────────────────────────

  const utils = trpc.useUtils();

  const { data: workspace = [], isLoading: workspaceLoading } =
    trpc.leads.listWorkspace.useQuery(undefined, {
      refetchInterval: 30_000,
    });

  const { data: timeline, isLoading: timelineLoading } =
    trpc.leads.getTimeline.useQuery(
      { phone: selectedPhone! },
      { enabled: !!selectedPhone, refetchInterval: 15_000, placeholderData: (prev: any) => prev }
    );

  // Real-time updates via SSE
  const handleLeadUpdate = useCallback(() => {
    utils.leads.listWorkspace.invalidate();
    if (selectedPhone) {
      utils.leads.getTimeline.invalidate({ phone: selectedPhone });
    }
  }, [utils, selectedPhone]);

  useOpsStream({ onLeadUpdate: handleLeadUpdate });

  // Send message mutation
  const sendMsg = trpc.leads.sendWorkspaceMessage.useMutation({
    onSuccess: () => {
      if (selectedPhone) {
        utils.leads.getTimeline.invalidate({ phone: selectedPhone });
      }
      setComposerText("");
    },
  });

  // Resolve initialSessionId → phone and select it
  const { data: resolvedPhone } = trpc.leads.getPhoneBySessionId.useQuery(
    { sessionId: initialSessionId! },
    { enabled: !!initialSessionId, staleTime: Infinity }
  );

  useEffect(() => {
    if (resolvedPhone && initialSessionId && resolvedSessionRef.current !== initialSessionId) {
      resolvedSessionRef.current = initialSessionId;
      setSelectedPhone(resolvedPhone);
    }
  }, [resolvedPhone, initialSessionId]);

  // Auto-select first lead when workspace loads (only if no initialSessionId)
  useEffect(() => {
    if (!selectedPhone && workspace.length > 0 && !initialSessionId) {
      setSelectedPhone(workspace[0].phone);
    }
  }, [workspace, selectedPhone, initialSessionId]);

  // Scroll to bottom on new timeline events
  useEffect(() => {
    if (journeyRef.current) {
      journeyRef.current.scrollTop = journeyRef.current.scrollHeight;
    }
  }, [timeline?.messages?.length]);

  // ── Derived data ───────────────────────────────────────────────────────────

  const selectedSummary: WorkspaceSummary | null =
    workspace.find((w) => w.phone === selectedPhone) ?? null;

  // Filter list by lane + filter chip + search
  const filteredLeads = workspace.filter((lead) => {
    const lane = stageToLane(lead.stage);
    // Resolved leads only appear in the resolved lane — never in active lanes
    if (lane === "resolved" && activeLane !== "resolved") return false;
    if (activeLane === "resolved" && lane !== "resolved") return false;
    // "all" shows every non-resolved lead; specific lanes filter by lane
    if (activeLane !== "all" && activeLane !== "resolved" && lane !== activeLane) return false;
    // Sub-filters (unread, campaign-reply) are ignored when All is active
    if (activeLane !== "all") {
      if (activeFilter === "unread" && lead.unreadCount === 0) return false;
      if (activeFilter === "campaign-reply") {
        const src = lead.leadSource ?? "";
        if (!src.startsWith("campaign:") && !src.startsWith("always-on") && src !== "reactivation") return false;
      }
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = (lead.customerName ?? "").toLowerCase();
      const phone = lead.phone.toLowerCase();
      const msg = (lead.lastMessage ?? "").toLowerCase();
      if (!name.includes(q) && !phone.includes(q) && !msg.includes(q)) return false;
    }
    return true;
  });

  // Lane counts
  const laneCounts: Record<Lane, number> = {
    "all": workspace.filter((l) => stageToLane(l.stage) !== "resolved").length,
    "needs-me": workspace.filter((l) => stageToLane(l.stage) === "needs-me").length,
    "ready-to-book": workspace.filter((l) => stageToLane(l.stage) === "ready-to-book").length,
    "needs-price": workspace.filter((l) => stageToLane(l.stage) === "needs-price").length,
    "reactivation": workspace.filter((l) => stageToLane(l.stage) === "reactivation").length,
    "resolved": workspace.filter((l) => stageToLane(l.stage) === "resolved").length,
  };

  const unreadCount = workspace.reduce((sum, l) => sum + l.unreadCount, 0);

  // Timeline events merged and sorted
  const timelineEvents: TimelineEvent[] = timeline
    ? buildTimeline(timeline.messages, timeline.campaigns, timeline.calls)
    : [];

  // ── Resolve / Reopen ─────────────────────────────────────────────────────
  const [resolvingPhone, setResolvingPhone] = useState<string | null>(null);

  const resolveLeadChat = trpc.leads.resolveLeadChat.useMutation({
    onMutate: ({ phone, resolve }) => {
      // Optimistic: immediately update isResolved + stage in workspace cache
      utils.leads.listWorkspace.setData(undefined, (old) => {
        if (!old) return old;
        return old.map((w) =>
          w.phone === phone
            ? { ...w, isResolved: resolve, stage: resolve ? 'RESOLVED' : 'UNHANDLED' }
            : w
        );
      });
    },
    onSuccess: (_data, { phone, resolve }) => {
      setResolvingPhone(phone);
      window.setTimeout(() => {
        setResolvingPhone(null);
        // If we just resolved the selected lead, deselect it after animation
        if (resolve && selectedPhone === phone) setSelectedPhone(null);
        utils.leads.listWorkspace.invalidate();
      }, 800);
    },
    onError: () => {
      // Roll back optimistic update on error
      utils.leads.listWorkspace.invalidate();
    },
  });

  // Mark as booked
  const [showBookModal, setShowBookModal] = React.useState(false);
  const [bookAmountInput, setBookAmountInput] = React.useState("");
  const [isBooking, setIsBooking] = React.useState(false);
  const { data: agentMe } = trpc.agents.me.useQuery();
  const markBookedMutation = trpc.agents.markBooked.useMutation();
  const setBookedAmountMutation = trpc.agents.setBookedAmount.useMutation();
  const announceBookingMutation = trpc.opsChat.announceBooking.useMutation();
  const markUnbookedMutation = trpc.agents.markUnbooked.useMutation({
    onSuccess: () => {
      utils.leads.listWorkspace.invalidate();
      utils.leads.stats?.invalidate?.();
      toast.success("Booking removed — lead reopened");
    },
    onError: (err) => toast.error(err.message),
  });

  async function handleMarkBooked() {
    if (!selectedSummary || isBooking) return;
    const sessionId = selectedSummary.sessionId;
    const amountRaw = bookAmountInput.trim().replace(/[^0-9.]/g, "");
    const amount = amountRaw ? Math.round(parseFloat(amountRaw)) : null;
    setIsBooking(true);
    try {
      await markBookedMutation.mutateAsync({ sessionId });
      if (amount !== null && !isNaN(amount) && amount > 0) {
        await setBookedAmountMutation.mutateAsync({ sessionId, bookedAmount: amount });
      }
      // Announce booking in command channel to trigger celebration
      const authorName = agentMe?.name ?? "Agent";
      const personName = selectedSummary.name || selectedSummary.phone;
      const amountStr = amount !== null && !isNaN(amount) && amount > 0 ? `$${amount}` : undefined;
      await announceBookingMutation.mutateAsync({
        channel: "command",
        personName,
        amount: amountStr,
        authorName,
      });
      utils.leads.listWorkspace.invalidate();
      utils.leads.stats?.invalidate?.();
      toast.success("Lead marked as booked! 🎉");
      setShowBookModal(false);
      setBookAmountInput("");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to mark as booked");
    } finally {
      setIsBooking(false);
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handlePickLead(phone: string) {
    setSelectedPhone(phone);
    setComposerText("");
  }

  function handleSend() {
    if (!composerText.trim() || !selectedPhone) return;
    sendMsg.mutate({ phone: selectedPhone, message: composerText });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="h-full overflow-hidden flex leads-inbox-scope"
      style={{
        color: "#101828",
        background: "transparent",
        padding: "20px",
        gap: "16px",
      }}
    >
      {/* ── Rail ── */}
      {rail && <div className="shrink-0">{rail}</div>}

      {/* ── Left: Lead List ── */}
      <Card
        className="rounded-[28px] overflow-hidden flex flex-col h-full py-0 gap-0 shrink-0"
        style={{
          width: 340,
          background: "#FCFCFD",
          border: "1px solid rgba(16,24,40,.06)",
          boxShadow: "0 10px 28px rgba(15,23,42,.05)",
        }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 shrink-0">
          <p className="text-[10px] font-black tracking-[.22em] uppercase text-slate-400 mb-1">
            Revenue Workspace
          </p>
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">
              Lead Journey
            </h1>
            {workspaceLoading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
            {!workspaceLoading && workspace.length > 0 && (
              <span className="text-xs font-black text-slate-400">{workspace.length}</span>
            )}
          </div>
          {/* Search */}
          <div className="flex items-center gap-2 h-10 border border-slate-200 rounded-2xl px-3 text-slate-400 text-sm font-semibold bg-white">
            <Search className="w-3.5 h-3.5 shrink-0" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search leads, campaigns…"
              className="flex-1 bg-transparent outline-none text-slate-700 placeholder:text-slate-400 text-sm font-semibold"
            />
          </div>
        </div>

        {/* Lanes */}
        <div className="grid grid-cols-2 gap-2 px-4 pb-3 shrink-0">
          {LANE_CONFIG.map((lane) => (
            <button
              key={lane.id}
              onClick={() => { setActiveLane(lane.id); if (lane.id === "all") setActiveFilter("all"); }}
              className={cn(
                "border rounded-[18px] p-3 text-left font-black text-sm cursor-pointer transition-all",
                activeLane === lane.id
                  ? "bg-blue-50 border-blue-200 text-slate-900"
                  : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
              )}
            >
              <span className="text-base">{lane.emoji}</span>{" "}
              {lane.label}
              <span className="block text-slate-500 font-semibold text-[11px] mt-0.5">
                {laneCounts[lane.id]} leads
              </span>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto shrink-0 scrollbar-none">
          {(
            [
              { id: "all" as LeadFilter, label: "All" },
              { id: "unread" as LeadFilter, label: "Unread", count: unreadCount },
              { id: "campaign-reply" as LeadFilter, label: "Campaign reply" },
            ] as { id: LeadFilter; label: string; count?: number }[]
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={cn(
                "border rounded-full px-3 py-1.5 text-[12px] font-black whitespace-nowrap transition-all",
                activeFilter === f.id
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
              )}
            >
              {f.label}
              {f.count ? ` ${f.count}` : ""}
            </button>
          ))}
        </div>

        {/* Lead List */}
        <ScrollArea className="flex-1 min-h-0 px-3 pb-4">
          {workspaceLoading && (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm font-semibold">Loading leads…</span>
            </div>
          )}
          {!workspaceLoading && filteredLeads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <MessageSquare className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm font-semibold">No leads found</p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {filteredLeads.map((lead) => {
              const tag = sourceToTag(lead.leadSource);
              const initials = getInitials(lead.customerName, lead.phone);
              const displayName = lead.customerName ?? lead.phone;
              return (
                <button
                  key={lead.phone}
                  onClick={() => handlePickLead(lead.phone)}
                  className={cn(
                    "w-full text-left p-4 rounded-[20px] border transition-all",
                    resolvingPhone === lead.phone && "opacity-0 scale-95 pointer-events-none",
                    lead.isResolved && resolvingPhone !== lead.phone && "opacity-60",
                    selectedPhone === lead.phone
                      ? "bg-white border-l-4 border-l-orange-400 border-orange-200 shadow-md"
                      : "bg-transparent border-transparent hover:bg-white hover:border-slate-200 hover:shadow-sm"
                  )}
                  style={{ transition: "opacity 0.4s, transform 0.4s" }}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-black text-sm text-slate-900 flex items-center gap-1.5">
                      {displayName}
                      {lead.unreadCount > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
                      )}
                    </span>
                    <span className="text-[11px] text-slate-400 font-bold shrink-0 ml-2">
                      {formatTs(lead.lastMessageAt)}
                    </span>
                  </div>
                  <p className="text-[13px] text-slate-500 mb-2 line-clamp-1">
                    {lead.lastMessage ?? "No messages yet"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {tag && (
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[11px] font-black border",
                          TAG_STYLES[tag.color]
                        )}
                      >
                        {tag.label}
                      </span>
                    )}
                    {lead.isResolved && (
                      <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-black border", TAG_STYLES.green)}>
                        ✓ Resolved
                      </span>
                    )}
                    {lead.needsAttention && (
                      <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-black border", TAG_STYLES.orange)}>
                        Needs attention
                      </span>
                    )}
                    {lead.assignedAgentName && (
                      <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-black border", TAG_STYLES.gray)}>
                        {lead.assignedAgentName}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </Card>

      {/* ── Center: Conversation Thread ── */}
      <Card
        className="rounded-[28px] overflow-hidden flex flex-col h-full py-0 gap-0 flex-1 min-w-0"
        style={{
          background: "linear-gradient(180deg,#FCFCFD 0%,#F8F9FC 100%)",
          border: "1px solid rgba(16,24,40,.06)",
          boxShadow: "0 8px 24px rgba(15,23,42,.05)",
        }}
      >
        {!selectedSummary ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <MessageSquare className="w-10 h-10 mb-3 opacity-30" />
            <p className="font-semibold text-sm">Select a lead</p>
            <p className="text-xs mt-1">Pick a conversation from the left to get started</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div
              className="flex items-center justify-between px-6 shrink-0"
              style={{ height: 80, borderBottom: "1px solid #e7eaf0" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-sm shrink-0"
                  style={{ background: "linear-gradient(135deg,#ff8a34,#ff4f81)" }}
                >
                  {getInitials(selectedSummary.customerName, selectedSummary.phone)}
                </div>
                <div>
                  <h2 className="font-black text-lg text-slate-900 leading-tight">
                    {selectedSummary.customerName ?? selectedSummary.phone}
                  </h2>
                  <p className="text-[13px] text-slate-500">
                    {(() => {
                      // Show the most recent campaign name that drove this conversation
                      const latestCampaign = timeline?.campaigns
                        ? [...timeline.campaigns].sort((a, b) => b.ts - a.ts)[0]
                        : null;
                      if (latestCampaign?.campaignName) {
                        return `${latestCampaign.campaignName} · Campaign reply`;
                      }
                      // Fallback to source label
                      const src = selectedSummary.leadSource ?? "";
                      if (src.startsWith("campaign:")) return src.replace(/^campaign:/, "").replace(/-/g, " ") + " · Campaign reply";
                      if (src.startsWith("always-on")) return "Always-on · Campaign reply";
                      if (src === "reactivation") return "Reactivation campaign";
                      if (src === "inbound-sms") return "Inbound SMS";
                      if (src === "email") return "Email lead";
                      if (src === "quote-form") return "Quote form";
                      if (src === "command-center") return "Outreach";
                      if (src === "review_rebooking") return "Review rebooking";
                      return src || "Direct";
                    })()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="w-10 h-10 border border-slate-200 rounded-[14px] bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50 transition">
                  <Phone className="w-4 h-4" />
                </button>
                <button
                  onClick={() => utils.leads.getTimeline.invalidate({ phone: selectedSummary.phone })}
                  className="w-10 h-10 border border-slate-200 rounded-[14px] bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50 transition"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  title={selectedSummary.isResolved ? 'Reopen conversation' : 'Resolve conversation'}
                  disabled={resolveLeadChat.isPending}
                  onClick={() => resolveLeadChat.mutate({ phone: selectedSummary.phone, resolve: !selectedSummary.isResolved })}
                  className={cn(
                    "w-10 h-10 border rounded-[14px] flex items-center justify-center transition",
                    selectedSummary.isResolved
                      ? "bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100"
                      : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                  )}
                >
                  <CheckCircle2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Attention Banner — only if flagged */}
            {selectedSummary.needsAttention && (
              <div
                className="flex items-center gap-3 px-5 py-3 shrink-0"
                style={{ background: "linear-gradient(90deg,#fbf8ff,#fff)", borderBottom: "1px solid #eee" }}
              >
                <span className={cn("px-2.5 py-1 rounded-full text-[11px] font-black border shrink-0", TAG_STYLES.orange)}>
                  Needs attention
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-slate-900 leading-tight">Follow up with this lead</p>
                  <p className="text-[12px] text-slate-500 mt-0.5">This lead has been flagged for attention</p>
                </div>
              </div>
            )}

            {/* Journey / Messages */}
            <div
              ref={journeyRef}
              className="flex-1 min-h-0 overflow-y-auto px-6 py-5"
              style={{ background: "linear-gradient(180deg,#fcfcfd,#f8fafc)" }}
            >
              {timelineLoading && (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-sm font-semibold">Loading conversation…</span>
                </div>
              )}
              <div className="flex flex-col gap-4">
                <AnimatePresence initial={false}>
                  {timelineEvents.map((event) => {
                    if (event._type === "campaign") {
                      return (
                        <motion.div
                          key={event.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.18 }}
                          className="flex gap-3"
                        >
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5 z-10 bg-violet-100 text-violet-700">
                            ✦
                          </div>
                          <div className="flex-1 border rounded-[18px] px-4 py-3 bg-violet-50 border-violet-100">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-[10px] font-black tracking-widest uppercase text-slate-400">Campaign</span>
                              <span className="text-[10px] font-black tracking-widest uppercase text-slate-400">{formatTs(event.ts)}</span>
                            </div>
                            <p className="font-black text-sm text-violet-800 mb-1">{event.campaignName}</p>
                            {event.message && (
                              <p className="text-sm leading-relaxed text-slate-600">{event.message}</p>
                            )}
                            {event.status && (
                              <span className={cn("mt-2 inline-block px-2 py-0.5 rounded-full text-[10px] font-black border", TAG_STYLES.purple)}>
                                {event.status}
                              </span>
                            )}
                          </div>
                        </motion.div>
                      );
                    }

                    if (event._type === "call") {
                      const rec = event as TimelineCall & { _type: "call" };
                      const durationSeconds = rec.durationSeconds ?? rec.duration ?? null;
                      const durationStr = durationSeconds
                        ? durationSeconds >= 60
                          ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`
                          : `${durationSeconds}s`
                        : "";
                      const callTime = new Date(rec.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                      let debriefParsed: { grade?: string; wentWell?: string; improve?: string; nextLine?: string; summary?: string } | null = null;
                      try { if (rec.callDebrief) debriefParsed = JSON.parse(rec.callDebrief); } catch { /* ignore */ }
                      const summary = debriefParsed?.summary || debriefParsed?.wentWell || null;
                      const grade = debriefParsed?.grade?.toUpperCase() ?? null;
                      const gradeColor: Record<string, string> = { A: "bg-emerald-500", B: "bg-blue-500", C: "bg-amber-500", D: "bg-orange-500", F: "bg-red-500" };
                      const gradeBg = grade ? (gradeColor[grade] ?? "bg-slate-500") : null;
                      const hasRecording = !!(rec.recordingUrl && !(rec.recordingUrl).includes("synthetic-backfill"));
                      type TranscriptTurn = { identifier: string; content: string; start?: number };
                      let transcriptTurns: TranscriptTurn[] = [];
                      try { if (rec.transcript) transcriptTurns = JSON.parse(rec.transcript); } catch { /* ignore */ }
                      const isExpanded = expandedCallIds.has(rec.id);
                      const isPlaying = playingCallId === rec.id;
                      const isInbound = rec.direction === "incoming";
                      const waveHeights = [3,5,8,12,16,20,14,18,22,16,10,14,20,24,18,12,16,20,14,8,12,18,22,16,10,6,10,14,18,12,8,5];
                      return (
                        <motion.div
                          key={rec.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.18 }}
                          className="flex justify-start"
                        >
                          <div className="max-w-[72%] min-w-[220px]">
                            {/* Compact bubble */}
                            <div
                              className={`rounded-2xl px-3 py-2.5 cursor-pointer select-none transition-all duration-150 ${
                                isInbound
                                  ? "bg-blue-50 border border-blue-100 hover:bg-blue-100"
                                  : "bg-slate-100 border border-slate-200 hover:bg-slate-200"
                              }`}
                              onClick={() => toggleCallExpanded(rec.id)}
                            >
                              <div className="flex items-center gap-2.5">
                                {/* Play/Pause */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!hasRecording) return;
                                    const audio = callAudioRefs.current[rec.id];
                                    if (!audio) return;
                                    if (isPlaying) {
                                      audio.pause();
                                      setPlayingCallId(null);
                                    } else {
                                      Object.entries(callAudioRefs.current).forEach(([id, el]) => {
                                        if (id !== rec.id && el) el.pause();
                                      });
                                      audio.play();
                                      setPlayingCallId(rec.id);
                                    }
                                  }}
                                  className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                                    hasRecording
                                      ? isInbound
                                        ? "bg-blue-500 hover:bg-blue-600 text-white"
                                        : "bg-slate-600 hover:bg-slate-700 text-white"
                                      : "bg-slate-300 text-slate-400 cursor-not-allowed"
                                  }`}
                                >
                                  {isPlaying
                                    ? <Pause className="h-3.5 w-3.5" />
                                    : <Play className="h-3.5 w-3.5 ml-0.5" />}
                                </button>
                                {/* Waveform */}
                                <div className="flex items-center gap-[2px] flex-1 h-7">
                                  {waveHeights.map((h, wi) => (
                                    <div
                                      key={wi}
                                      className={`rounded-full w-[3px] transition-all ${
                                        isInbound ? "bg-blue-400" : "bg-slate-400"
                                      }`}
                                      style={{ height: `${h}px` }}
                                    />
                                  ))}
                                </div>
                                {/* Duration + chevron */}
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className={`text-[11px] font-medium tabular-nums ${
                                    isInbound ? "text-blue-600" : "text-slate-500"
                                  }`}>
                                    {durationStr || "0:00"}
                                  </span>
                                  {isExpanded
                                    ? <ChevronUp className={`h-3.5 w-3.5 ${isInbound ? "text-blue-400" : "text-slate-400"}`} />
                                    : <ChevronDown className={`h-3.5 w-3.5 ${isInbound ? "text-blue-400" : "text-slate-400"}`} />}
                                </div>
                              </div>
                              {/* Hidden audio */}
                              {hasRecording && (
                                <audio
                                  ref={(el) => { callAudioRefs.current[rec.id] = el; }}
                                  src={rec.recordingUrl!}
                                  onEnded={() => setPlayingCallId(null)}
                                  onPause={() => { if (playingCallId === rec.id) setPlayingCallId(null); }}
                                  className="hidden"
                                />
                              )}
                            </div>
                            {/* Expanded detail panel */}
                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: "auto" }}
                                  exit={{ opacity: 0, height: 0 }}
                                  transition={{ duration: 0.18, ease: "easeOut" }}
                                  className="overflow-hidden"
                                >
                                  <div className={`mt-1 rounded-xl border px-3 py-2.5 ${
                                    isInbound ? "bg-blue-50 border-blue-100" : "bg-slate-50 border-slate-200"
                                  }`}>
                                    <div className="flex items-center gap-2 mb-2">
                                      <Phone className={`h-3 w-3 shrink-0 ${isInbound ? "text-blue-500" : "text-slate-500"}`} />
                                      <span className="text-xs font-medium text-slate-700">
                                        {isInbound ? "Inbound" : "Outbound"} call{rec.callerPhone ? ` · ${rec.callerPhone}` : ""}
                                      </span>
                                      {rec.status === "no-answer" && (
                                        <span className="text-[10px] text-red-500 font-medium">No answer</span>
                                      )}
                                      {grade && gradeBg && (
                                        <span className={`ml-auto inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white ${gradeBg}`}>
                                          {grade}
                                        </span>
                                      )}
                                      <span className="ml-auto text-[10px] text-slate-400">{callTime}</span>
                                    </div>
                                    {summary && (
                                      <p className="text-xs text-slate-600 leading-relaxed mb-2 border-t border-slate-100 pt-2">{summary}</p>
                                    )}
                                    {!hasRecording && (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5 mb-1.5">
                                        <Phone className="h-2.5 w-2.5" /> No recording
                                      </span>
                                    )}
                                    {transcriptTurns.length > 0 && (
                                      <details className="mt-1">
                                        <summary className={`cursor-pointer text-[10px] font-semibold uppercase tracking-widest select-none ${
                                          isInbound ? "text-blue-600 hover:text-blue-800" : "text-violet-600 hover:text-violet-800"
                                        }`}>
                                          ▶ Transcript ({transcriptTurns.length} turns)
                                        </summary>
                                        <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                          {transcriptTurns.map((turn, ti) => (
                                            <div key={ti} className="text-xs">
                                              <span className={`font-semibold mr-1 ${
                                                turn.identifier?.toLowerCase().includes("agent") || turn.identifier?.toLowerCase().includes("assistant")
                                                  ? isInbound ? "text-blue-600" : "text-violet-600"
                                                  : "text-slate-500"
                                              }`}>
                                                {turn.identifier}:
                                              </span>
                                              <span className="text-slate-600">{turn.content}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </details>
                                    )}
                                    {!summary && !hasRecording && transcriptTurns.length === 0 && (
                                      <p className="text-xs text-slate-400 italic">No details available yet</p>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                            <p className="text-[10px] text-slate-400 mt-1 ml-1">{callTime}</p>
                          </div>
                        </motion.div>
                      );
                    }

                    // Regular message
                    const msg = event as TimelineMessage & { _type: "message" };
                    const isCampaignMsg = msg.role === "assistant" && (
                      msg.sessionSource?.startsWith("campaign:") ||
                      msg.sessionSource?.startsWith("always-on") ||
                      msg.sessionSource === "reactivation" ||
                      msg.sessionSource === "command-center"
                    );
                    // Campaign-sourced assistant messages → render as purple campaign bubble
                    if (isCampaignMsg) {
                      const srcLabel = msg.sessionSource?.startsWith("campaign:")
                        ? msg.sessionSource.replace(/^campaign:/, "").replace(/-/g, " ")
                        : msg.sessionSource?.startsWith("always-on")
                        ? "Always-on campaign"
                        : msg.sessionSource === "reactivation"
                        ? "Reactivation campaign"
                        : "Outreach campaign";
                      return (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.18 }}
                          className="flex gap-3"
                        >
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5 z-10 bg-violet-100 text-violet-700">
                            ✦
                          </div>
                          <div className="flex-1 border rounded-[18px] px-4 py-3 bg-violet-50 border-violet-100">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-[10px] font-black tracking-widest uppercase text-slate-400">Campaign</span>
                              <span className="text-[10px] font-black tracking-widest uppercase text-slate-400">{formatTs(msg.ts)}</span>
                            </div>
                            <p className="font-black text-sm text-violet-800 mb-1">{srcLabel}</p>
                            <p className="text-sm leading-relaxed text-slate-600">{msg.content}</p>
                          </div>
                        </motion.div>
                      );
                    }
                    const isAgent = msg.role === "assistant";
                    const isSystem = msg.role === "system";
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                        className="flex gap-3"
                      >
                        <div
                          className={cn(
                            "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5 z-10",
                            isAgent ? "bg-slate-900 text-white" : isSystem ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
                          )}
                        >
                          {isAgent ? "A" : isSystem ? "!" : "C"}
                        </div>
                        <div
                          className={cn(
                            "flex-1 border rounded-[18px] px-4 py-3",
                            isAgent
                              ? "bg-slate-900 border-slate-900 text-white max-w-[72%] ml-auto"
                              : isSystem
                              ? "bg-orange-50 border-orange-200"
                              : "bg-white border-slate-200"
                          )}
                        >
                          <div className="flex justify-between items-center mb-1">
                            <span className={cn("text-[10px] font-black tracking-widest uppercase", isAgent ? "text-slate-400" : "text-slate-400")}>
                              {isAgent ? "Agent" : isSystem ? "System" : "Customer"}
                            </span>
                            <span className="text-[10px] font-black tracking-widest uppercase text-slate-400">
                              {formatTs(msg.ts)}
                            </span>
                          </div>
                          <p className={cn("text-sm leading-relaxed", isAgent ? "text-white" : "text-slate-600")}>
                            {msg.content}
                          </p>
                          {msg.mediaUrls && msg.mediaUrls.length > 0 && (
                            <div className="flex gap-2 mt-2 flex-wrap">
                              {msg.mediaUrls.map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                  <img src={url} alt="media" className="max-w-[160px] rounded-xl border border-slate-200" />
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>

            {/* Composer */}
            <div
              className="shrink-0 px-5 py-4"
              style={{ borderTop: "1px solid #e7eaf0", background: "#fff" }}
            >
              <div className="flex gap-3">
                <textarea
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
                  }}
                  placeholder="Type a message…"
                  className="flex-1 h-16 border border-slate-200 rounded-[18px] px-4 py-3 text-sm resize-none font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100 transition"
                />
                <button
                  onClick={handleSend}
                  disabled={sendMsg.isPending || !composerText.trim()}
                  className="shrink-0 px-5 rounded-full font-black text-sm text-white transition hover:opacity-90 active:scale-95 disabled:opacity-50"
                  style={{ background: "#ff6b1a" }}
                >
                  {sendMsg.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send →"}
                </button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* ── Right: Context Panel ── */}
      <Card
        className="rounded-[28px] overflow-hidden flex flex-col h-full py-0 gap-0 shrink-0"
        style={{
          width: 300,
          background: "#FCFCFD",
          border: "1px solid rgba(16,24,40,.06)",
          boxShadow: "0 10px 28px rgba(15,23,42,.05)",
        }}
      >
        <ScrollArea className="flex-1 min-h-0 p-5">
          {!selectedSummary ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Target className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm font-semibold">Select a lead</p>
            </div>
          ) : (
            <>
              {/* Next Best Action */}
              <p className="text-[10px] font-black tracking-[.22em] uppercase text-slate-400 mb-3">
                Next Best Action
              </p>
              <div
                className="rounded-[20px] p-4 mb-4"
                style={{ background: "#101828", border: "1px solid #101828" }}
              >
                <span className={cn("px-2.5 py-1 rounded-full text-[11px] font-black border mb-3 inline-block", TAG_STYLES.orange)}>
                  Recommended
                </span>
                <h3 className="font-black text-white text-sm leading-snug mb-2">
                  {selectedSummary.needsAttention ? "Follow up now" : "Engage this lead"}
                </h3>
                <p className="text-[13px] text-slate-400 leading-relaxed mb-3">
                  {selectedSummary.lastMessage
                    ? `Last message: "${selectedSummary.lastMessage.slice(0, 80)}${selectedSummary.lastMessage.length > 80 ? "…" : ""}"`
                    : "Start a conversation with this lead."}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="col-span-2 border-0 rounded-[14px] py-2.5 font-black text-sm text-white transition hover:opacity-90"
                    style={{ background: selectedSummary?.isBooked ? "#16a34a" : "#ff6b1a" }}
                    onClick={() => {
                      if (!selectedSummary) return;
                      if (selectedSummary.isBooked) {
                        markUnbookedMutation.mutate({ sessionId: selectedSummary.sessionId });
                      } else {
                        setShowBookModal(true);
                      }
                    }}
                    disabled={markUnbookedMutation.isPending || isBooking}
                  >
                    {selectedSummary?.isBooked
                      ? (markUnbookedMutation.isPending ? "Removing…" : `✓ Booked${selectedSummary.bookedAmount ? ` · $${selectedSummary.bookedAmount}` : ""} — Undo`)
                      : "Mark as Booked"}
                  </button>
                  <button className="border border-white/20 rounded-[14px] py-2 font-black text-xs text-white/80 hover:bg-white/10 transition">
                    Call now
                  </button>
                  <button className="border border-white/20 rounded-[14px] py-2 font-black text-xs text-white/80 hover:bg-white/10 transition">
                    Follow-up
                  </button>
                </div>

                {/* Mark as Booked modal */}
                {showBookModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBookModal(false)}>
                    <div className="bg-white rounded-2xl p-6 w-72 shadow-xl" onClick={e => e.stopPropagation()}>
                      <h3 className="font-black text-slate-900 text-base mb-1">Mark as Booked</h3>
                      <p className="text-slate-500 text-sm mb-4">Enter the booked revenue amount (optional)</p>
                      <div className="relative mb-4">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                        <input
                          type="number"
                          min="0"
                          placeholder="0"
                          value={bookAmountInput}
                          onChange={e => setBookAmountInput(e.target.value)}
                          className="w-full border border-slate-200 rounded-xl pl-7 pr-3 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') handleMarkBooked(); }}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="flex-1 border border-slate-200 rounded-xl py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 transition"
                          onClick={() => { setShowBookModal(false); setBookAmountInput(""); }}
                        >Cancel</button>
                        <button
                          className="flex-1 rounded-xl py-2 text-sm font-black text-white transition hover:opacity-90"
                          style={{ background: "#ff6b1a" }}
                          onClick={handleMarkBooked}
                          disabled={isBooking}
                        >{isBooking ? "Saving…" : "Confirm"}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Lead Snapshot */}
              <p className="text-[10px] font-black tracking-[.22em] uppercase text-slate-400 mb-3">
                Lead Snapshot
              </p>
              <div className="border border-slate-200 rounded-[20px] p-4 mb-4 bg-white">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Phone", value: selectedSummary.phone },
                    { label: "Stage", value: selectedSummary.stage ?? "New" },
                    { label: "Source", value: selectedSummary.leadSource ?? "Direct" },
                    {
                      label: "Last activity",
                      value: selectedSummary.lastMessageAt
                        ? formatTs(selectedSummary.lastMessageAt)
                        : "—",
                    },
                  ].map((m) => (
                    <div key={m.label} className="border border-slate-100 rounded-[14px] p-2.5 bg-slate-50/50">
                      <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                        {m.label}
                      </span>
                      <b className="block mt-1 text-sm font-black text-slate-900 truncate" title={m.value}>
                        {m.value}
                      </b>
                    </div>
                  ))}
                </div>
              </div>

              {/* Campaign Context — if from campaign */}
              {selectedSummary.leadSource && (selectedSummary.leadSource.startsWith("campaign:") || selectedSummary.leadSource.startsWith("always-on") || selectedSummary.leadSource === "reactivation") && (
                <>
                  <p className="text-[10px] font-black tracking-[.22em] uppercase text-slate-400 mb-3">
                    Campaign Context
                  </p>
                  <div className="border rounded-[20px] p-4 mb-4" style={{ background: "#faf7ff", borderColor: "#e9d5ff" }}>
                    <p className="text-[10px] font-black tracking-[.22em] uppercase text-violet-500 mb-1">
                      Source Journey
                    </p>
                    <h3 className="font-black text-slate-900 text-sm mb-1">
                      {selectedSummary.leadSource.replace(/^campaign:/, "").replace(/-/g, " ")}
                    </h3>
                    <p className="text-[13px] text-slate-500">
                      {selectedSummary.leadSource.startsWith("always-on") ? "Always-on" : "Campaign"} · last active {formatTs(selectedSummary.lastMessageAt)}
                    </p>
                  </div>
                </>
              )}

              {/* Customer Intelligence */}
              <p className="text-[10px] font-black tracking-[.22em] uppercase text-slate-400 mb-3">
                Customer Intelligence
              </p>
              <div className="border border-slate-200 rounded-[20px] p-4 bg-white">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Unread", value: String(selectedSummary.unreadCount) },
                    { label: "Assigned", value: selectedSummary.assignedAgentName ?? "Unassigned" },
                    { label: "Needs attn", value: selectedSummary.needsAttention ? "Yes" : "No" },
                    { label: "Timeline", value: `${timelineEvents.length} events` },
                  ].map((m) => (
                    <div key={m.label} className="border border-slate-100 rounded-[14px] p-2.5 bg-slate-50/50">
                      <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                        {m.label}
                      </span>
                      <b className="block mt-1 text-sm font-black text-slate-900">
                        {m.value}
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}
