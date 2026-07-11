/**
 * LeadsInbox — Revenue Workspace
 *
 * Architecture:
 *   - Phone is the canonical customer identity. No session IDs in the UI.
 *   - Left panel: one row per customer via leads.listWorkspace
 *   - Center: full chronological timeline via leads.getTimeline(phone)
 *   - Reply: leads.sendWorkspaceMessage(phone, message) — backend resolves session
 *   - Real-time: useOpsStream invalidates listWorkspace + getTimeline on lead_update
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  Phone,
  Search,
  Send,
  Zap,
  Clock,
  User,
  ChevronRight,
  Radio,
  Inbox,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkspaceSummary = {
  phone: string;
  customerName: string | null;
  lastMessage: string | null;
  lastMessageAt: number | null;
  unreadCount: number;
  stage: string | null;
  needsAttention: boolean;
  assignedAgentName: string | null;
  leadSource: string | null;
};

type TimelineMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
  mediaUrls?: string[];
  sessionSource?: string;
};

type CampaignEvent = {
  id: string;
  type: "campaign";
  campaignName: string;
  message: string;
  ts: number;
  status: string;
};

type CallEvent = {
  id: string;
  type: "call";
  duration: number | null;
  recordingUrl: string | null;
  ts: number;
};

// ─── Left Panel: Lead List ────────────────────────────────────────────────────

function LeadListItem({
  summary,
  selected,
  onClick,
}: {
  summary: WorkspaceSummary;
  selected: boolean;
  onClick: () => void;
}) {
  const displayName = summary.customerName || formatPhone(summary.phone);
  const hasUnread = summary.unreadCount > 0;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 border-b border-white/5 transition-colors ${
        selected
          ? "bg-white/10 border-l-2 border-l-blue-400"
          : "hover:bg-white/5 border-l-2 border-l-transparent"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 mt-0.5">
          {displayName[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={`text-sm truncate ${hasUnread ? "font-semibold text-white" : "font-medium text-white/80"}`}>
              {displayName}
            </span>
            <span className="text-[10px] text-white/40 flex-shrink-0">
              {timeAgo(summary.lastMessageAt)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1 mt-0.5">
            <p className={`text-xs truncate ${hasUnread ? "text-white/70" : "text-white/40"}`}>
              {summary.lastMessage ?? "No messages yet"}
            </p>
            {hasUnread && (
              <span className="flex-shrink-0 w-4 h-4 rounded-full bg-blue-500 text-white text-[9px] flex items-center justify-center font-bold">
                {summary.unreadCount > 9 ? "9+" : summary.unreadCount}
              </span>
            )}
          </div>
          {summary.leadSource && (
            <span className="text-[9px] text-white/30 mt-0.5 block">
              via {summary.leadSource}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Center Panel: Timeline Events ───────────────────────────────────────────

function TimelineEventBubble({ event }: { event: CampaignEvent | CallEvent }) {
  if (event.type === "campaign") {
    return (
      <div className="flex justify-center my-3">
        <div className="bg-purple-900/40 border border-purple-500/30 rounded-lg px-4 py-2 max-w-sm text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Radio className="w-3 h-3 text-purple-400" />
            <span className="text-xs font-medium text-purple-300">Campaign: {event.campaignName}</span>
          </div>
          <p className="text-xs text-white/60 leading-relaxed">{event.message}</p>
          <span className="text-[10px] text-white/30 mt-1 block">{formatTime(event.ts)}</span>
        </div>
      </div>
    );
  }
  if (event.type === "call") {
    return (
      <div className="flex justify-center my-3">
        <div className="bg-green-900/30 border border-green-500/20 rounded-lg px-4 py-2 flex items-center gap-2">
          <Phone className="w-3 h-3 text-green-400" />
          <span className="text-xs text-green-300">
            Call {event.duration ? `· ${Math.round(event.duration / 60)}m` : ""}
          </span>
          <span className="text-[10px] text-white/30">{formatTime(event.ts)}</span>
        </div>
      </div>
    );
  }
  return null;
}

function MessageBubble({ msg }: { msg: TimelineMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-start" : "justify-end"} mb-2`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 ${
          isUser
            ? "bg-white/10 text-white/90 rounded-tl-sm"
            : "bg-blue-600 text-white rounded-tr-sm"
        }`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
        {msg.mediaUrls?.map((url, i) => (
          <img key={i} src={url} alt="media" className="mt-1.5 rounded-lg max-w-full max-h-48 object-cover" />
        ))}
        <span className="text-[10px] opacity-50 mt-1 block text-right">{formatTime(msg.ts)}</span>
      </div>
    </div>
  );
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-white/10" />
      <span className="text-[10px] text-white/30 font-medium">{label}</span>
      <div className="flex-1 h-px bg-white/10" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LeadsInbox() {
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: workspaceList = [], isLoading: listLoading } = trpc.leads.listWorkspace.useQuery(
    { mode: "active" },
    { refetchInterval: 30000 }
  );

  const { data: timeline, isLoading: timelineLoading } = trpc.leads.getTimeline.useQuery(
    { phone: selectedPhone! },
    { enabled: !!selectedPhone, refetchInterval: 15000 }
  );

  const sendMutation = trpc.leads.sendWorkspaceMessage.useMutation({
    onSuccess: () => {
      utils.leads.getTimeline.invalidate({ phone: selectedPhone! });
      utils.leads.listWorkspace.invalidate();
    },
  });

  // ── Real-time updates ─────────────────────────────────────────────────────
  const handleLeadUpdate = useCallback(() => {
    utils.leads.listWorkspace.invalidate();
    if (selectedPhone) {
      utils.leads.getTimeline.invalidate({ phone: selectedPhone });
    }
  }, [utils, selectedPhone]);

  useOpsStream({ onLeadUpdate: handleLeadUpdate });

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timeline?.messages]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = (workspaceList as WorkspaceSummary[]).filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (s.customerName ?? "").toLowerCase().includes(q) ||
      s.phone.includes(q) ||
      (s.lastMessage ?? "").toLowerCase().includes(q)
    );
  });

  // ── Send handler ──────────────────────────────────────────────────────────
  const handleSend = () => {
    if (!selectedPhone || !message.trim()) return;
    sendMutation.mutate({ phone: selectedPhone, message: message.trim() });
    setMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Build merged timeline ─────────────────────────────────────────────────
  type TimelineItem =
    | { kind: "message"; data: TimelineMessage; ts: number }
    | { kind: "campaign"; data: CampaignEvent; ts: number }
    | { kind: "call"; data: CallEvent; ts: number }
    | { kind: "date"; label: string; ts: number };

  const timelineItems: TimelineItem[] = [];

  if (timeline) {
    const allEvents: TimelineItem[] = [
      ...timeline.messages.map((m: TimelineMessage) => ({ kind: "message" as const, data: m, ts: m.ts })),
      ...timeline.campaigns.map((c: CampaignEvent) => ({ kind: "campaign" as const, data: c, ts: c.ts })),
      ...timeline.calls.map((c: CallEvent) => ({ kind: "call" as const, data: c, ts: c.ts })),
    ].sort((a, b) => a.ts - b.ts);

    let lastDate = "";
    for (const item of allEvents) {
      const dateLabel = formatDate(item.ts);
      if (dateLabel !== lastDate) {
        timelineItems.push({ kind: "date", label: dateLabel, ts: item.ts - 1 });
        lastDate = dateLabel;
      }
      timelineItems.push(item);
    }
  }

  const selectedSummary = (workspaceList as WorkspaceSummary[]).find((s) => s.phone === selectedPhone);
  const displayName = selectedSummary?.customerName || (selectedPhone ? formatPhone(selectedPhone) : "");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full bg-[#0f1117] text-white overflow-hidden">

      {/* ── Left Panel: Lead List ─────────────────────────────────────────── */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-white/10 bg-[#111318]">
        <div className="px-3 py-3 border-b border-white/10">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Inbox className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-white">Revenue Workspace</span>
            </div>
            {workspaceList.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-white/10 text-white/60 border-0">
                {workspaceList.length}
              </Badge>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
              className="pl-7 h-7 text-xs bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-blue-500/50"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {listLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <MessageSquare className="w-8 h-8 text-white/20 mb-2" />
              <p className="text-xs text-white/40">
                {search ? "No matches found" : "No active leads"}
              </p>
            </div>
          ) : (
            filtered.map((s) => (
              <LeadListItem
                key={s.phone}
                summary={s}
                selected={s.phone === selectedPhone}
                onClick={() => setSelectedPhone(s.phone)}
              />
            ))
          )}
        </ScrollArea>
      </div>

      {/* ── Center Panel: Conversation ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedPhone ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
            <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center">
              <MessageSquare className="w-7 h-7 text-white/20" />
            </div>
            <div>
              <p className="text-sm font-medium text-white/60">Select a lead</p>
              <p className="text-xs text-white/30 mt-1">Pick a conversation from the left to get started</p>
            </div>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3 bg-[#111318]">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                {displayName[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{displayName}</p>
                <p className="text-xs text-white/40">{formatPhone(selectedPhone)}</p>
              </div>
              {selectedSummary?.stage && (
                <Badge className="text-[10px] bg-white/10 text-white/60 border-0">
                  {selectedSummary.stage.replace(/_/g, " ")}
                </Badge>
              )}
            </div>

            <ScrollArea className="flex-1 px-4 py-3">
              {timelineLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                </div>
              ) : timelineItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-xs text-white/30">No messages yet</p>
                </div>
              ) : (
                timelineItems.map((item, i) => {
                  if (item.kind === "date") {
                    return <DateDivider key={`date-${i}`} label={item.label} />;
                  }
                  if (item.kind === "message") {
                    return <MessageBubble key={item.data.id} msg={item.data} />;
                  }
                  if (item.kind === "campaign" || item.kind === "call") {
                    return <TimelineEventBubble key={item.data.id} event={item.data} />;
                  }
                  return null;
                })
              )}
              <div ref={bottomRef} />
            </ScrollArea>

            <div className="px-4 py-3 border-t border-white/10 bg-[#111318]">
              <div className="flex gap-2 items-end">
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                  className="flex-1 min-h-[40px] max-h-32 resize-none text-sm bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-blue-500/50"
                  rows={1}
                />
                <Button
                  onClick={handleSend}
                  disabled={!message.trim() || sendMutation.isPending}
                  size="sm"
                  className="h-10 w-10 p-0 bg-blue-600 hover:bg-blue-700 flex-shrink-0"
                >
                  {sendMutation.isPending ? (
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
              {sendMutation.isError && (
                <p className="text-xs text-red-400 mt-1">{sendMutation.error.message}</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Right Panel: Customer Snapshot ───────────────────────────────── */}
      {selectedPhone && selectedSummary && (
        <div className="w-64 flex-shrink-0 border-l border-white/10 bg-[#111318] flex flex-col overflow-y-auto">
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">Customer</p>
          </div>
          <div className="px-4 py-4 space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-white/40" />
                <span className="text-sm text-white font-medium">
                  {selectedSummary.customerName ?? "Unknown"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-white/40" />
                <span className="text-xs text-white/60">{formatPhone(selectedPhone)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="bg-white/5 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider">Stage</span>
                  <ChevronRight className="w-3 h-3 text-white/20" />
                </div>
                <p className="text-sm text-white font-medium">
                  {selectedSummary.stage?.replace(/_/g, " ") ?? "—"}
                </p>
              </div>

              {selectedSummary.assignedAgentName && (
                <div className="bg-white/5 rounded-lg p-3">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Agent</span>
                  <p className="text-sm text-white">{selectedSummary.assignedAgentName}</p>
                </div>
              )}

              {selectedSummary.leadSource && (
                <div className="bg-white/5 rounded-lg p-3">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Source</span>
                  <p className="text-sm text-white">{selectedSummary.leadSource}</p>
                </div>
              )}

              {timeline && timeline.campaigns.length > 0 && (
                <div className="bg-purple-900/30 border border-purple-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="w-3 h-3 text-purple-400" />
                    <span className="text-[10px] text-purple-300 uppercase tracking-wider">Campaigns</span>
                  </div>
                  <p className="text-sm text-white">{timeline.campaigns.length} sent</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    Last: {timeAgo(timeline.campaigns[timeline.campaigns.length - 1]?.ts)}
                  </p>
                </div>
              )}

              {timeline && timeline.calls.length > 0 && (
                <div className="bg-green-900/20 border border-green-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Phone className="w-3 h-3 text-green-400" />
                    <span className="text-[10px] text-green-300 uppercase tracking-wider">Calls</span>
                  </div>
                  <p className="text-sm text-white">{timeline.calls.length} recorded</p>
                </div>
              )}

              <div className="bg-white/5 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="w-3 h-3 text-white/40" />
                  <span className="text-[10px] text-white/40 uppercase tracking-wider">Last Activity</span>
                </div>
                <p className="text-xs text-white/60">{timeAgo(selectedSummary.lastMessageAt)}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
