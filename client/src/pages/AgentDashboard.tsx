/**
 * AgentDashboard — Personal workspace for each sales agent
 *
 * Features:
 * - Manus OAuth login gate (agents must be logged in)
 * - View all leads (unassigned + own) and claim them
 * - Log call attempts with outcome + notes
 * - Mark leads as booked
 * - See full conversation history per lead
 */
import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Phone,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  User,
  CheckCircle2,
  Clock,
  Search,
  LogOut,
  RefreshCw,
  UserCheck,
  UserX,
  X,
  MessageSquare,
  DollarSign,
  MapPin,
  Calendar,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Session = {
  id: number;
  leadPhone: string;
  leadName: string | null;
  stage: string;
  quotedPrice: string | null;
  serviceType: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  selectedSlot: string | null;
  address: string | null;
  messageHistory: string;
  assignedAgentId: number | null;
  assignedAgentName: string | null;
  lastCalledAt: Date | string | null;
  lastCalledByAgentName: string | null;
  isBooked: number;
  bookedAt: Date | string | null;
  bookedByAgentName: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type CallOutcome = "ANSWERED" | "NO_ANSWER" | "VOICEMAIL" | "BUSY" | "BOOKED" | "CALLBACK";

const OUTCOME_OPTIONS: { value: CallOutcome; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "ANSWERED",  label: "Answered",         icon: <PhoneCall className="w-4 h-4" />, color: "#16a34a" },
  { value: "NO_ANSWER", label: "No Answer",         icon: <PhoneMissed className="w-4 h-4" />, color: "#d97706" },
  { value: "VOICEMAIL", label: "Left Voicemail",    icon: <Phone className="w-4 h-4" />, color: "#7c3aed" },
  { value: "BUSY",      label: "Busy",              icon: <PhoneOff className="w-4 h-4" />, color: "#dc2626" },
  { value: "BOOKED",    label: "Booked!",           icon: <CheckCircle2 className="w-4 h-4" />, color: "#E8603C" },
  { value: "CALLBACK",  label: "Call Back Later",   icon: <Clock className="w-4 h-4" />, color: "#0891b2" },
];

const STAGE_LABELS: Record<string, string> = {
  QUOTE_SENT:    "Quote Sent",
  AVAILABILITY:  "Availability",
  SLOT_CHOICE:   "Slot Choice",
  ADDRESS:       "Address",
  CONFIRMATION:  "Confirmation",
  CALL_SCHEDULED:"Call Scheduled",
  DONE:          "Done",
  UNHANDLED:     "Needs Review",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(date: Date | string | null): string {
  if (!date) return "—";
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return phone;
}

// ── Stage badge ───────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  QUOTE_SENT:    { bg: "#dbeafe", text: "#1d4ed8", border: "#bfdbfe" },
  AVAILABILITY:  { bg: "#fef3c7", text: "#92400e", border: "#fde68a" },
  SLOT_CHOICE:   { bg: "#ffedd5", text: "#9a3412", border: "#fed7aa" },
  ADDRESS:       { bg: "#f3e8ff", text: "#6b21a8", border: "#e9d5ff" },
  CONFIRMATION:  { bg: "#ccfbf1", text: "#134e4a", border: "#99f6e4" },
  CALL_SCHEDULED:{ bg: "#e0e7ff", text: "#1e3a5f", border: "#c7d2fe" },
  DONE:          { bg: "#dcfce7", text: "#14532d", border: "#bbf7d0" },
  UNHANDLED:     { bg: "#fee2e2", text: "#991b1b", border: "#fecaca" },
};

function StageBadge({ stage }: { stage: string }) {
  const c = STAGE_COLORS[stage] ?? { bg: "#f3f4f6", text: "#374151", border: "#e5e7eb" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border"
      style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
    >
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}

// ── Log Call Dialog ───────────────────────────────────────────────────────────

function LogCallDialog({
  session,
  onClose,
  onSuccess,
}: {
  session: Session;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [outcome, setOutcome] = useState<CallOutcome>("ANSWERED");
  const [notes, setNotes] = useState("");
  const utils = trpc.useUtils();

  const logCall = trpc.agents.logCall.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      utils.agents.myLeads.invalidate();
      toast.success(`Call logged: ${OUTCOME_OPTIONS.find(o => o.value === outcome)?.label}`);
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PhoneCall className="w-5 h-5" style={{ color: "#E8603C" }} />
            Log Call — {session.leadName ?? formatPhone(session.leadPhone)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Call Outcome</label>
            <div className="grid grid-cols-2 gap-2">
              {OUTCOME_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setOutcome(opt.value)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all"
                  style={
                    outcome === opt.value
                      ? { backgroundColor: opt.color, color: "white", borderColor: opt.color }
                      : { backgroundColor: "white", color: "#374151", borderColor: "#e5e7eb" }
                  }
                >
                  <span style={{ color: outcome === opt.value ? "white" : opt.color }}>{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Notes (optional)</label>
            <Textarea
              placeholder="What happened on the call? Any follow-up needed?"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => logCall.mutate({ sessionId: session.id, outcome, notes: notes || undefined })}
            disabled={logCall.isPending}
            style={{ backgroundColor: "#E8603C", color: "white" }}
          >
            {logCall.isPending ? "Saving…" : "Save Call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Call History Dialog ───────────────────────────────────────────────────────

function CallHistoryDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const { data: logs = [], isLoading } = trpc.agents.getCallLogs.useQuery({ sessionId: session.id });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Call History — {session.leadName ?? formatPhone(session.leadPhone)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 max-h-80 overflow-y-auto py-2">
          {isLoading ? (
            <p className="text-center text-gray-400 py-6">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="text-center text-gray-400 py-6">No calls logged yet</p>
          ) : (
            logs.map(log => {
              const opt = OUTCOME_OPTIONS.find(o => o.value === log.outcome);
              return (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <span style={{ color: opt?.color ?? "#374151", marginTop: 2 }}>{opt?.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold" style={{ color: opt?.color }}>{opt?.label ?? log.outcome}</span>
                      <span className="text-xs text-gray-400">{timeAgo(log.calledAt)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">by {log.agentName}</p>
                    {log.notes && <p className="text-sm text-gray-700 mt-1">{log.notes}</p>}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Conversation Drawer ───────────────────────────────────────────────────────

function ConversationDrawer({ session, onClose }: { session: Session; onClose: () => void }) {
  let messages: { role: string; content: string }[] = [];
  try { messages = JSON.parse(session.messageHistory || "[]"); } catch { messages = []; }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="font-semibold text-gray-900">{session.leadName ?? "Unknown Lead"}</h2>
            <p className="text-sm text-gray-500">{formatPhone(session.leadPhone)}</p>
          </div>
          <div className="flex items-center gap-2">
            <StageBadge stage={session.stage} />
            <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">No messages yet</p>
          ) : messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                style={msg.role === "user"
                  ? { backgroundColor: "#E8603C", color: "white", borderBottomRightRadius: 4 }
                  : { backgroundColor: "#f3f4f6", color: "#1f2937", borderBottomLeftRadius: 4 }}
              >
                {msg.content}
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t text-xs text-gray-400 flex justify-between">
          <span>Started {timeAgo(session.createdAt)}</span>
          <span>Updated {timeAgo(session.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Lead Card ─────────────────────────────────────────────────────────────────

function LeadCard({
  session,
  currentUserId,
  currentUserRole,
  onRefresh,
}: {
  session: Session;
  currentUserId: number;
  currentUserRole: string;
  onRefresh: () => void;
}) {
  const [showLogCall, setShowLogCall] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showConversation, setShowConversation] = useState(false);
  const utils = trpc.useUtils();

  const isMyLead = session.assignedAgentId === currentUserId;
  const isClaimed = Boolean(session.assignedAgentId);
  const isAdmin = currentUserRole === "admin";
  const isBooked = session.isBooked === 1;

  const claimLead = trpc.agents.claimLead.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      utils.agents.myLeads.invalidate();
      toast.success("Lead claimed — assigned to you.");
      onRefresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const unclaimLead = trpc.agents.unclaimLead.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      utils.agents.myLeads.invalidate();
      toast.success("Lead released — now unassigned.");
      onRefresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const markBooked = trpc.agents.markBooked.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      utils.agents.myLeads.invalidate();
      toast.success("🎉 Lead marked as booked!");
      onRefresh();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <div
        className="bg-white rounded-2xl border p-4 flex flex-col gap-3 shadow-sm transition-shadow hover:shadow-md"
        style={{
          borderColor: isBooked ? "#bbf7d0" : isMyLead ? "#fed7aa" : "#F0D8D0",
          borderWidth: isBooked || isMyLead ? "2px" : "1px",
        }}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 text-sm">
                {session.leadName ?? "Unknown"}
              </span>
              <StageBadge stage={session.stage} />
              {isBooked && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200">
                  <CheckCircle2 className="w-3 h-3" /> Booked
                  {session.bookedByAgentName && ` · ${session.bookedByAgentName}`}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
              <Phone className="w-3 h-3" /> {formatPhone(session.leadPhone)}
            </p>
          </div>
          {session.quotedPrice && (
            <span className="font-bold text-sm flex items-center gap-0.5 shrink-0" style={{ color: "#E8603C" }}>
              <DollarSign className="w-3.5 h-3.5" />{session.quotedPrice}
            </span>
          )}
        </div>

        {/* Service info */}
        <div className="flex flex-wrap gap-3 text-xs text-gray-600">
          {session.serviceType && (
            <span>
              <span className="text-gray-400">Service:</span> {session.serviceType}
              {session.bedrooms && ` · ${session.bedrooms} bd / ${session.bathrooms} ba`}
            </span>
          )}
          {session.selectedSlot && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3 text-gray-400" /> {session.selectedSlot}
            </span>
          )}
          {session.address && (
            <span className="flex items-center gap-1 truncate max-w-full">
              <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
              <span className="truncate">{session.address}</span>
            </span>
          )}
        </div>

        {/* Agent + call status */}
        <div className="flex flex-wrap gap-2 text-xs">
          {isClaimed ? (
            <span className="flex items-center gap-1 text-orange-700 bg-orange-50 px-2 py-1 rounded-lg border border-orange-100">
              <UserCheck className="w-3 h-3" />
              {isMyLead ? "Assigned to you" : `Assigned to ${session.assignedAgentName}`}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-gray-400 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
              <User className="w-3 h-3" /> Unassigned
            </span>
          )}
          {session.lastCalledAt && (
            <span className="flex items-center gap-1 text-gray-500 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
              <Clock className="w-3 h-3" />
              Last called {timeAgo(session.lastCalledAt)}
              {session.lastCalledByAgentName && ` by ${session.lastCalledByAgentName}`}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
          {!isClaimed && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs"
              onClick={() => claimLead.mutate({ sessionId: session.id })}
              disabled={claimLead.isPending}>
              <UserCheck className="w-3.5 h-3.5" style={{ color: "#E8603C" }} /> Claim
            </Button>
          )}
          {(isMyLead || isAdmin) && isClaimed && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs text-gray-500"
              onClick={() => unclaimLead.mutate({ sessionId: session.id })}
              disabled={unclaimLead.isPending}>
              <UserX className="w-3.5 h-3.5" /> Release
            </Button>
          )}
          {(isMyLead || isAdmin) && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs"
              onClick={() => setShowLogCall(true)}
              style={{ color: "#E8603C", borderColor: "#E8603C" }}>
              <PhoneCall className="w-3.5 h-3.5" /> Log Call
            </Button>
          )}
          {(isMyLead || isAdmin) && !isBooked && (
            <Button size="sm" className="gap-1.5 text-xs"
              onClick={() => markBooked.mutate({ sessionId: session.id })}
              disabled={markBooked.isPending}
              style={{ backgroundColor: "#16a34a", color: "white" }}>
              <CheckCircle2 className="w-3.5 h-3.5" /> Mark Booked
            </Button>
          )}
          <Button size="sm" variant="ghost" className="gap-1.5 text-xs text-gray-500 ml-auto"
            onClick={() => setShowHistory(true)}>
            <Clock className="w-3.5 h-3.5" /> Calls
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5 text-xs text-gray-500"
            onClick={() => setShowConversation(true)}>
            <MessageSquare className="w-3.5 h-3.5" /> SMS
          </Button>
        </div>
      </div>

      {showLogCall && (
        <LogCallDialog session={session} onClose={() => setShowLogCall(false)} onSuccess={onRefresh} />
      )}
      {showHistory && (
        <CallHistoryDialog session={session} onClose={() => setShowHistory(false)} />
      )}
      {showConversation && (
        <ConversationDrawer session={session} onClose={() => setShowConversation(false)} />
      )}
    </>
  );
}

// ── Login Gate ────────────────────────────────────────────────────────────────

function LoginGate() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#FFF8F5" }}>
      <div className="bg-white rounded-2xl border shadow-lg p-8 max-w-sm w-full mx-4 text-center" style={{ borderColor: "#F0D8D0" }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: "#E8603C" }}>
          <User className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Agent Login</h1>
        <p className="text-gray-500 text-sm mb-6">
          Sign in with your Manus account to access the agent workspace.
        </p>
        <Button
          className="w-full"
          style={{ backgroundColor: "#E8603C", color: "white" }}
          onClick={() => { window.location.href = getLoginUrl(); }}
        >
          Sign In to Continue
        </Button>
      </div>
    </div>
  );
}

// ── Main Agent Dashboard ──────────────────────────────────────────────────────

type ViewMode = "my" | "all" | "unassigned" | "booked";

export default function AgentDashboard() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [stageFilter, setStageFilter] = useState("all");

  const {
    data: allSessions = [],
    isLoading,
    refetch,
    isFetching,
  } = trpc.leads.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  const filtered = useMemo(() => {
    return allSessions.filter(s => {
      if (viewMode === "my" && s.assignedAgentId !== user?.id) return false;
      if (viewMode === "unassigned" && s.assignedAgentId !== null) return false;
      if (viewMode === "booked" && s.isBooked !== 1) return false;
      if (stageFilter !== "all" && s.stage !== stageFilter) return false;
      const q = search.toLowerCase();
      if (q) {
        const match =
          (s.leadName ?? "").toLowerCase().includes(q) ||
          s.leadPhone.includes(q) ||
          (s.serviceType ?? "").toLowerCase().includes(q) ||
          (s.assignedAgentName ?? "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [allSessions, viewMode, stageFilter, search, user?.id]);

  const myCount = allSessions.filter(s => s.assignedAgentId === user?.id).length;
  const unassignedCount = allSessions.filter(s => !s.assignedAgentId).length;
  const bookedCount = allSessions.filter(s => s.isBooked === 1).length;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#FFF8F5" }}>
        <RefreshCw className="w-6 h-6 animate-spin" style={{ color: "#E8603C" }} />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <LoginGate />;
  }

  const VIEW_TABS: { value: ViewMode; label: string; count: number }[] = [
    { value: "all",        label: "All Leads",   count: allSessions.length },
    { value: "my",         label: "My Leads",    count: myCount },
    { value: "unassigned", label: "Unassigned",  count: unassignedCount },
    { value: "booked",     label: "Booked",      count: bookedCount },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#FFF8F5" }}>
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-40" style={{ borderColor: "#F0D8D0" }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: "#E8603C" }}>
              <span className="text-white text-sm font-bold">M</span>
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 leading-tight">Agent Workspace</h1>
              <p className="text-xs text-gray-500">
                Signed in as <span className="font-medium text-gray-700">{user.name ?? user.email ?? "Agent"}</span>
                {user.role === "admin" && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-semibold">Admin</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={logout} className="gap-1.5 text-gray-500">
              <LogOut className="w-3.5 h-3.5" /> Sign Out
            </Button>
          </div>
        </div>

        {/* View tabs */}
        <div className="max-w-4xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {VIEW_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setViewMode(tab.value)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
              style={
                viewMode === tab.value
                  ? { borderColor: "#E8603C", color: "#E8603C" }
                  : { borderColor: "transparent", color: "#6b7280" }
              }
            >
              {tab.label}
              <span
                className="text-xs px-1.5 py-0.5 rounded-full font-semibold"
                style={
                  viewMode === tab.value
                    ? { backgroundColor: "#FFF0EC", color: "#E8603C" }
                    : { backgroundColor: "#f3f4f6", color: "#9ca3af" }
                }
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5">
        {/* Search + stage filter */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search name, phone, service, agent…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-white"
            />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-44 bg-white">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {Object.entries(STAGE_LABELS).map(([val, label]) => (
                <SelectItem key={val} value={val}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-gray-500 self-center shrink-0">
            {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Lead cards */}
        {isLoading ? (
          <div className="py-20 text-center text-gray-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3" style={{ color: "#E8603C" }} />
            Loading leads…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-gray-400">
            <div className="text-4xl mb-3">📋</div>
            <p className="font-medium text-gray-600">No leads found</p>
            <p className="text-sm mt-1">
              {viewMode === "my"
                ? "You haven't claimed any leads yet. Switch to 'All Leads' to find one."
                : "Try adjusting your filters."}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map(session => (
              <LeadCard
                key={session.id}
                session={session as Session}
                currentUserId={user.id}
                currentUserRole={user.role}
                onRefresh={() => refetch()}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
