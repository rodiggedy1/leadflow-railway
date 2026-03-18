/**
 * AgentDashboard — Personal workspace for each sales agent.
 * Uses email + password auth — no Manus account required.
 */
import { useState, useMemo, useEffect, useRef } from "react";
import SmsComposeBox from "@/components/SmsComposeBox";
import AgentNotificationBell from "@/components/AgentNotificationBell";
import MessageDateSeparator, { formatMsgDate, isDifferentDay } from "@/components/MessageDateSeparator";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { calculateExtrasTotal } from "@shared/extras";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Card, CardContent } from "@/components/ui/card";
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
  MessageSquare,
  LogIn,
  Loader2,
  XCircle,
  Send,
  Bot,
  BotOff,
} from "lucide-react";

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────

function computeTotalQuote(quotedPrice: string | null, extrasJson: string | null): string | null {
  if (!quotedPrice) return null;
  const base = parseInt(quotedPrice, 10);
  if (isNaN(base)) return quotedPrice;
  if (!extrasJson) return quotedPrice;
  let keys: string[] = [];
  try { keys = JSON.parse(extrasJson); } catch { return quotedPrice; }
  if (!keys.length) return quotedPrice;
  const total = base + calculateExtrasTotal(keys);
  return String(total);
}

// ── Types ─────────────────────────────────────────────────────────────────────────────────

type Session = {
  id: number;
  leadPhone: string;
  leadName: string | null;
  stage: string;
  quotedPrice: string | null;
  serviceType: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  extras: string | null;
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
  bookedAmount: number | null;
  internalNotes: string | null;
  aiMode: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type CallOutcome = "ANSWERED" | "NO_ANSWER" | "VOICEMAIL" | "BUSY" | "BOOKED" | "CALLBACK";

const OUTCOME_OPTIONS: { value: CallOutcome; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "ANSWERED",  label: "Answered",       icon: <PhoneCall className="w-4 h-4" />, color: "#16a34a" },
  { value: "NO_ANSWER", label: "No Answer",       icon: <PhoneMissed className="w-4 h-4" />, color: "#d97706" },
  { value: "VOICEMAIL", label: "Left Voicemail",  icon: <Phone className="w-4 h-4" />, color: "#7c3aed" },
  { value: "BUSY",      label: "Busy",            icon: <PhoneOff className="w-4 h-4" />, color: "#dc2626" },
  { value: "BOOKED",    label: "Booked!",         icon: <CheckCircle2 className="w-4 h-4" />, color: "#E8603C" },
  { value: "CALLBACK",  label: "Call Back Later", icon: <Clock className="w-4 h-4" />, color: "#0891b2" },
];

const STAGE_LABELS: Record<string, string> = {
  WIDGET_SIZING:  "Sizing",
  QUOTE_SENT:     "Quote Sent",
  AVAILABILITY:   "Availability",
  SLOT_CHOICE:    "Slot Choice",
  ADDRESS:        "Address",
  CONFIRMATION:   "Confirmation",
  CALL_SCHEDULED: "Call Scheduled",
  DONE:           "Done",
  UNHANDLED:      "Needs Review",
  BOOKED:         "Booked ✔",
  NOT_INTERESTED: "Not Interested",
};
const STAGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  WIDGET_SIZING:  { bg: "#ede9fe", text: "#7c3aed", border: "#ddd6fe" },
  QUOTE_SENT:     { bg: "#dbeafe", text: "#1d4ed8", border: "#bfdbfe" },
  AVAILABILITY:   { bg: "#fef3c7", text: "#92400e", border: "#fde68a" },
  SLOT_CHOICE:    { bg: "#ffedd5", text: "#9a3412", border: "#fed7aa" },
  ADDRESS:        { bg: "#f3e8ff", text: "#6b21a8", border: "#e9d5ff" },
  CONFIRMATION:   { bg: "#ccfbf1", text: "#134e4a", border: "#99f6e4" },
  CALL_SCHEDULED: { bg: "#e0e7ff", text: "#1e3a5f", border: "#c7d2fe" },
  DONE:           { bg: "#dcfce7", text: "#14532d", border: "#bbf7d0" },
  UNHANDLED:      { bg: "#fee2e2", text: "#991b1b", border: "#fecaca" },
  BOOKED:         { bg: "#bbf7d0", text: "#14532d", border: "#4ade80" },
  NOT_INTERESTED: { bg: "#f3f4f6", text: "#6b7280", border: "#d1d5db" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(date: Date | string | null): string {
  if (!date) return "—";
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return phone;
}

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

// ── Login Form ────────────────────────────────────────────────────────────────

function AgentLoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = trpc.agents.login.useMutation({
    onSuccess: (data) => {
      toast.success(`Welcome back, ${data.agent.name}!`);
      onSuccess();
    },
    onError: (err) => toast.error(err.message || "Login failed"),
  });

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#FFF8F5" }}>
      <div className="bg-white rounded-2xl border shadow-lg p-8 max-w-sm w-full mx-4" style={{ borderColor: "#F0D8D0" }}>
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
            style={{ backgroundColor: "#E8603C" }}>
            <User className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Agent Login</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to access your leads workspace</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email || !password) return;
            loginMutation.mutate({ email: email.trim(), password });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="agent-email">Email</Label>
            <Input
              id="agent-email"
              type="email"
              placeholder="agent@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              disabled={loginMutation.isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-password">Password</Label>
            <Input
              id="agent-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loginMutation.isPending}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={loginMutation.isPending || !email || !password}
            style={{ backgroundColor: "#E8603C", color: "white" }}
          >
            {loginMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…</>
            ) : (
              <><LogIn className="w-4 h-4 mr-2" /> Sign In</>
            )}
          </Button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-4">
          Contact your admin if you need access or forgot your password.
        </p>
      </div>
    </div>
  );
}

// ── Log Call Dialog ───────────────────────────────────────────────────────────

function LogCallDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const [outcome, setOutcome] = useState<CallOutcome>("ANSWERED");
  const [notes, setNotes] = useState("");
  const utils = trpc.useUtils();

  const logCall = trpc.agents.logCall.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      toast.success(`Call logged: ${OUTCOME_OPTIONS.find(o => o.value === outcome)?.label}`);
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
              placeholder="What happened on the call?"
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

// ── Conversation Drawer ───────────────────────────────────────────────────────

/** Collapsible internal notes panel — saves vertical space in the agent drawer */
function AgentNotesSection({
  session,
  notes,
  setNotes,
  loadedNotes,
  notesSaved,
  updateNotes,
}: {
  session: Session;
  notes: string;
  setNotes: (v: string) => void;
  loadedNotes: string;
  notesSaved: boolean;
  updateNotes: ReturnType<typeof trpc.agents.updateNotes.useMutation>;
}) {
  const [open, setOpen] = useState(false);
  const currentNotes = notes !== "" ? notes : loadedNotes;
  return (
    <div className="border-t" style={{ borderColor: "#F0D8D0" }}>
      <button
        type="button"
        className="w-full flex items-center justify-between px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-orange-50 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <span className="flex items-center gap-1.5">
          Internal Notes
          {currentNotes && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />}
        </span>
        <span className="text-gray-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="px-5 pb-3">
          <Textarea
            placeholder="e.g. Left voicemail, price objection, follow up Friday..."
            value={currentNotes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="resize-none text-sm"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-400">Visible to agents and admins only</span>
            <div className="flex items-center gap-2">
              {notesSaved && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => updateNotes.mutate({ sessionId: session.id, notes: currentNotes })}
                disabled={updateNotes.isPending}
              >
                {updateNotes.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save Notes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConversationDrawer({
  session,
  onClose,
  currentAgentId,
}: {
  session: Session;
  onClose: () => void;
  currentAgentId: number;
}) {
  let messages: { role: string; content: string }[] = [];
  try { messages = JSON.parse(session.messageHistory || "[]"); } catch { messages = []; }

  const utils = trpc.useUtils();

  // Assign fallback timestamps to messages that don't have one.
  // Spread them evenly between createdAt and updatedAt so separators always fire.
  function withFallbackTs(
    msgs: { role: string; content: string; ts?: number }[],
    createdAt: Date | string,
    updatedAt: Date | string
  ) {
    if (msgs.length === 0) return msgs;
    const start = new Date(createdAt).getTime();
    const end = new Date(updatedAt).getTime();
    const span = Math.max(end - start, 0);
    return msgs.map((m, i) => ({
      ...m,
      ts: m.ts ?? Math.round(start + (span * i) / Math.max(msgs.length - 1, 1)),
    }));
  }

  // Reply / send message
  const [replyText, setReplyText] = useState("");
  const [localMessages, setLocalMessages] = useState<{ role: string; content: string; ts?: number }[]>(
    withFallbackTs(messages, session.createdAt, session.updatedAt)
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-refresh conversation every 5s
  const { data: freshSession } = trpc.leads.list.useQuery(undefined, {
    refetchInterval: 5000,
    select: (sessions) => sessions.find(s => s.id === session.id),
  });

  useEffect(() => {
    if (freshSession?.messageHistory) {
      try {
        const fresh = JSON.parse(freshSession.messageHistory);
        setLocalMessages(withFallbackTs(fresh, session.createdAt, freshSession.updatedAt ?? session.updatedAt));
      } catch { /* ignore */ }
    }
  }, [freshSession?.messageHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages]);

  const sendMessageMutation = trpc.leads.sendMessage.useMutation({
    onSuccess: (_, vars) => {
      setLocalMessages(prev => [...prev, { role: "assistant", content: vars.message, ts: Date.now() }]);
      setReplyText("");
    },
    onError: (err) => toast.error(err.message),
  });

  const setAiModeMutation = trpc.leads.setAiMode.useMutation({
    onSuccess: (_, vars) => {
      utils.leads.list.invalidate();
      toast.success(vars.aiMode === 1 ? "AI auto-reply enabled" : "Manual mode — you’re in control");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSend = () => {
    const text = replyText.trim();
    if (!text) return;
    sendMessageMutation.mutate({ sessionId: session.id, message: text });
  };

  // Claim / release
  const claimLead = trpc.agents.claimLead.useMutation({
    onSuccess: () => { utils.leads.list.invalidate(); toast.success("Lead claimed!"); },
    onError: (err) => toast.error(err.message),
  });
  const unclaimLead = trpc.agents.unclaimLead.useMutation({
    onSuccess: () => { utils.leads.list.invalidate(); toast.success("Lead released"); },
    onError: (err) => toast.error(err.message),
  });

  const isMine = session.assignedAgentId === currentAgentId;
  const isUnassigned = !session.assignedAgentId;

  // Booked amount editing (shown when lead is booked)
  const [bookedAmountInput, setBookedAmountInput] = useState(
    session.bookedAmount !== null && session.bookedAmount !== undefined
      ? String(session.bookedAmount)
      : ""
  );
  const [bookedAmountSaved, setBookedAmountSaved] = useState(false);
  const setBookedAmountMutation = trpc.agents.setBookedAmount.useMutation({
    onSuccess: (_, vars) => {
      utils.leads.list.invalidate();
      setBookedAmountSaved(true);
      setTimeout(() => setBookedAmountSaved(false), 2000);
      toast.success(vars.bookedAmount === null ? "Booked amount cleared" : `Booked amount set to $${vars.bookedAmount}`);
    },
    onError: (err) => toast.error(err.message),
  });

  // Internal notes
  const { data: notesData } = trpc.agents.getNotes.useQuery({ sessionId: session.id });
  const [notes, setNotes] = useState(notesData?.notes ?? "");
  const [notesSaved, setNotesSaved] = useState(false);
  const updateNotes = trpc.agents.updateNotes.useMutation({
    onSuccess: () => { setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000); },
    onError: (err) => toast.error(err.message),
  });

  // Sync notes when data loads
  const { data: callLogs = [] } = trpc.agents.getCallLogs.useQuery({ sessionId: session.id });

  // Keep local notes in sync with fetched data
  const loadedNotes = notesData?.notes ?? "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Wide two-column modal: left = conversation, right = details */}
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-4xl h-[92vh] sm:max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Shared header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0" style={{ borderColor: "#F0D8D0" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ backgroundColor: "#E8603C" }}>
              {(session.leadName ?? "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 leading-tight">{session.leadName ?? formatPhone(session.leadPhone)}</h3>
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-500">{formatPhone(session.leadPhone)}</p>
                <a
                  href={`tel:${session.leadPhone}`}
                  title={`Call ${formatPhone(session.leadPhone)}`}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors"
                  style={{ backgroundColor: "#E8603C", color: "white" }}
                  onClick={e => e.stopPropagation()}
                >
                  <Phone className="w-2.5 h-2.5" />
                  Call
                </a>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StageBadge stage={session.stage} />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-lg leading-none">×</button>
          </div>
        </div>

        {/* ── Two-column body ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* LEFT: full-height conversation + compose */}
          <div className="flex flex-col flex-1 min-w-0 border-r" style={{ borderColor: "#F0D8D0" }}>
            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 bg-gray-50">
              {localMessages.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No messages yet</p>
              ) : (
                localMessages.map((msg, i) => {
                  const isOutbound = msg.role === "assistant";
                  const prevTs = i > 0 ? localMessages[i - 1]?.ts : undefined;
                  const curTs = msg.ts;
                  // Show a day separator whenever the calendar day changes (ts is always set now via fallback)
                  const showSeparator = curTs != null && (
                    i === 0 || (prevTs != null ? isDifferentDay(prevTs, curTs) : true)
                  );
                  // Small time label shown below each bubble (e.g. "2:34 PM")
                  const timeLabel = curTs != null
                    ? new Date(curTs).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                    : null;
                  return (
                    <div key={i}>
                      {showSeparator && curTs != null && (
                        <MessageDateSeparator label={formatMsgDate(curTs)} />
                      )}
                      <div className={`flex flex-col mb-3 ${isOutbound ? "items-end" : "items-start"}`}>
                        <div
                          className="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words"
                          style={
                            isOutbound
                              ? { backgroundColor: "#E8603C", color: "white", borderBottomRightRadius: "4px" }
                              : { backgroundColor: "#ffffff", color: "#111827", borderBottomLeftRadius: "4px", border: "1px solid #e5e7eb" }
                          }
                        >
                          {msg.content}
                        </div>
                        {timeLabel && (
                          <span className="text-[10px] text-gray-400 mt-0.5 px-1">{timeLabel}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Compose box */}
            <div className="px-5 pt-2.5 pb-3 border-t bg-white shrink-0" style={{ borderColor: "#F0D8D0" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs">
                  {session.aiMode === 1
                    ? <span className="flex items-center gap-1 text-green-600 font-medium"><Bot className="w-3.5 h-3.5" />AI is handling replies</span>
                    : <span className="flex items-center gap-1 text-amber-600 font-medium"><BotOff className="w-3.5 h-3.5" />Manual mode — you're in control</span>
                  }
                </span>
                <button
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    session.aiMode === 1
                      ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                      : "border-green-300 text-green-700 hover:bg-green-50"
                  }`}
                  onClick={() => setAiModeMutation.mutate({ sessionId: session.id, aiMode: session.aiMode === 1 ? 0 : 1 })}
                  disabled={setAiModeMutation.isPending}
                >
                  {session.aiMode === 1 ? "Take over" : "Hand back to AI"}
                </button>
              </div>
              <SmsComposeBox
                value={replyText}
                onChange={setReplyText}
                onSend={handleSend}
                isSending={sendMessageMutation.isPending}
                placeholder="Write a message..."
              />
            </div>
          </div>

          {/* RIGHT: lead details panel */}
          <div className="w-72 shrink-0 flex flex-col overflow-y-auto bg-white">

            {/* Lead info */}
            <div className="px-4 py-4 border-b" style={{ borderColor: "#F0D8D0" }}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Lead Details</p>
              <div className="space-y-2 text-sm">
                {session.quotedPrice && (() => {
                  const total = computeTotalQuote(session.quotedPrice, session.extras);
                  const hasExtras = total !== session.quotedPrice;
                  return (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Quote</span>
                      <span className="font-semibold" style={{ color: "#E8603C" }}>
                        ${total}{hasExtras && <span className="ml-1 text-xs text-gray-400">(+extras)</span>}
                      </span>
                    </div>
                  );
                })()}
                {session.serviceType && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Service</span>
                    <span className="font-medium text-right max-w-[55%] truncate">{session.serviceType}</span>
                  </div>
                )}
                {session.selectedSlot && (
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-500 shrink-0">Slot</span>
                    <span className="font-medium text-right text-xs">{session.selectedSlot}</span>
                  </div>
                )}
                {session.address && (
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-500 shrink-0">Address</span>
                    <span className="font-medium text-right text-xs leading-snug">{session.address}</span>
                  </div>
                )}
                {session.extras && (() => {
                  let extrasArr: string[] = [];
                  try { extrasArr = JSON.parse(session.extras); } catch { extrasArr = []; }
                  return extrasArr.length > 0 ? (
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-500 shrink-0">Add-ons</span>
                      <span className="font-medium text-right text-xs">{extrasArr.map(k => k.replace(/_/g, " ")).join(", ")}</span>
                    </div>
                  ) : null;
                })()}
                {session.isBooked === 1 && (
                  <div className="pt-1">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                      ✓ Booked{session.bookedByAgentName ? ` by ${session.bookedByAgentName}` : ""}
                    </span>
                  </div>
                )}
                {session.assignedAgentName && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Agent</span>
                    <span className="font-medium">{session.assignedAgentName}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Claim / Release */}
            {!session.isBooked && (
              <div className="px-4 py-3 border-b" style={{ backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }}>
                <p className="text-xs text-blue-700 mb-2">
                  {isMine
                    ? <span className="font-medium">You own this lead</span>
                    : isUnassigned
                    ? <span>This lead is <b>unassigned</b></span>
                    : <span>Assigned to <b>{session.assignedAgentName}</b></span>}
                </p>
                <div className="flex gap-1.5">
                  {isMine ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50 bg-white w-full"
                      onClick={() => unclaimLead.mutate({ sessionId: session.id })}
                      disabled={unclaimLead.isPending}
                    >
                      <UserX className="w-3 h-3" /> Release Lead
                    </Button>
                  ) : isUnassigned ? (
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs gap-1 text-white w-full"
                      style={{ backgroundColor: "#E8603C" }}
                      onClick={() => claimLead.mutate({ sessionId: session.id })}
                      disabled={claimLead.isPending}
                    >
                      <UserCheck className="w-3 h-3" /> Claim Lead
                    </Button>
                  ) : null}
                </div>
              </div>
            )}

            {/* Booked Amount */}
            {session.isBooked === 1 && (
              <div className="px-4 py-3 border-b" style={{ borderColor: "#bbf7d0", backgroundColor: "#f0fdf4" }}>
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Booked Amount</p>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                    <Input
                      type="number"
                      min={0}
                      placeholder={computeTotalQuote(session.quotedPrice, session.extras) ?? "0"}
                      value={bookedAmountInput}
                      onChange={e => setBookedAmountInput(e.target.value)}
                      className="pl-5 h-8 text-xs bg-white"
                    />
                  </div>
                  {bookedAmountSaved && <span className="text-xs text-green-600 font-medium shrink-0">✓</span>}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 text-xs shrink-0 bg-white"
                    disabled={setBookedAmountMutation.isPending}
                    onClick={() => {
                      const val = bookedAmountInput.trim();
                      const parsed = val === "" ? null : parseInt(val, 10);
                      if (val !== "" && (isNaN(parsed!) || parsed! < 0)) {
                        toast.error("Enter a valid dollar amount");
                        return;
                      }
                      setBookedAmountMutation.mutate({ sessionId: session.id, bookedAmount: parsed });
                    }}
                  >
                    {setBookedAmountMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                  </Button>
                </div>
                <p className="text-xs text-green-600 mt-1">
                  {session.bookedAmount !== null && session.bookedAmount !== undefined
                    ? `Override: $${session.bookedAmount}`
                    : `Using quote: $${computeTotalQuote(session.quotedPrice, session.extras) ?? "0"}`
                  }
                </p>
              </div>
            )}

            {/* Call History */}
            {callLogs.length > 0 && (
              <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: "#F0D8D0" }}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                  <PhoneCall className="w-3.5 h-3.5" /> Call History
                </p>
                {callLogs.map(log => {
                  const opt = OUTCOME_OPTIONS.find(o => o.value === log.outcome);
                  return (
                    <div key={log.id} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100 text-xs">
                      <span style={{ color: opt?.color ?? "#374151", marginTop: 1 }}>{opt?.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between">
                          <span className="font-semibold" style={{ color: opt?.color }}>{opt?.label ?? log.outcome}</span>
                          <span className="text-gray-400">{timeAgo(log.calledAt)}</span>
                        </div>
                        <p className="text-gray-500">by {log.agentName}</p>
                        {log.notes && <p className="text-gray-700 mt-0.5">{log.notes}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Internal Notes */}
            <div className="px-4 py-3 flex-1">
              <AgentNotesSection
                session={session}
                notes={notes}
                setNotes={setNotes}
                loadedNotes={loadedNotes}
                notesSaved={notesSaved}
                updateNotes={updateNotes}
              />
            </div>

            {/* Close button */}
            <div className="px-4 pb-4 shrink-0">
              <Button variant="outline" size="sm" className="w-full" onClick={onClose}>Close</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Lead Card ─────────────────────────────────────────────────────────────────

function LeadCard({
  session,
  currentAgentId,
  onRefresh,
}: {
  session: Session;
  currentAgentId: number;
  onRefresh: () => void;
}) {
  const utils = trpc.useUtils();
  const [showLogCall, setShowLogCall] = useState(false);
  const [showConversation, setShowConversation] = useState(false);

  const claimLead = trpc.agents.claimLead.useMutation({
    onSuccess: () => { utils.leads.list.invalidate(); toast.success("Lead claimed!"); },
    onError: (err) => toast.error(err.message),
  });
  const unclaimLead = trpc.agents.unclaimLead.useMutation({
    onSuccess: () => { utils.leads.list.invalidate(); toast.success("Lead released"); },
    onError: (err) => toast.error(err.message),
  });
  const markBooked = trpc.agents.markBooked.useMutation({
    onSuccess: () => { utils.leads.list.invalidate(); toast.success("Marked as booked!"); },
    onError: (err) => toast.error(err.message),
  });
  const markNotInterested = trpc.agents.markNotInterested.useMutation({
    onSuccess: () => { utils.leads.list.invalidate(); toast.success("Marked as not interested"); },
    onError: (err) => toast.error(err.message),
  });

  const isMine = session.assignedAgentId === currentAgentId;
  const isBooked = session.isBooked === 1;
  const isNotInterested = session.stage === "NOT_INTERESTED";

  // Stage → left border color
  const stageBorderColor = (() => {
    if (isBooked) return "#16a34a";
    if (isNotInterested) return "#9ca3af";
    const c = STAGE_COLORS[session.stage];
    return c ? c.border : "#F0D8D0";
  })();

  const totalPrice = session.quotedPrice ? computeTotalQuote(session.quotedPrice, session.extras) : null;

  return (
    <>
      <div
        className="relative bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
        style={{ opacity: isNotInterested ? 0.65 : 1 }}
      >
        {/* Left stage accent bar */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
          style={{ backgroundColor: stageBorderColor }}
        />

        <div className="pl-4 pr-4 pt-3.5 pb-3">
          {/* ── Row 1: Name + Price ── */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-bold text-gray-900 text-[15px] leading-tight truncate">
                {session.leadName ?? "Unknown"}
              </span>
              <StageBadge stage={session.stage} />
              {isBooked && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700 border border-green-200">
                  <CheckCircle2 className="w-3 h-3" /> Booked
                </span>
              )}
            </div>
            {totalPrice && (
              <span className="text-base font-bold shrink-0" style={{ color: "#E8603C" }}>
                ${totalPrice}
              </span>
            )}
          </div>

          {/* ── Row 2: Phone + Meta ── */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 mb-2">
            <a
              href={`tel:${session.leadPhone}`}
              className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-[#E8603C] transition-colors"
              onClick={e => e.stopPropagation()}
            >
              <Phone className="w-3 h-3" />
              {formatPhone(session.leadPhone)}
            </a>
            {session.serviceType && <span className="text-gray-400">·</span>}
            {session.serviceType && <span>{session.serviceType}</span>}
            {session.selectedSlot && <span className="text-gray-400">·</span>}
            {session.selectedSlot && <span>📅 {session.selectedSlot}</span>}
            {session.lastCalledAt && (
              <>
                <span className="text-gray-400">·</span>
                <span>Called {timeAgo(session.lastCalledAt)}{session.lastCalledByAgentName ? ` by ${session.lastCalledByAgentName}` : ""}</span>
              </>
            )}
            {session.assignedAgentName && !isMine && (
              <>
                <span className="text-gray-400">·</span>
                <span className="text-blue-600 font-medium">{session.assignedAgentName}</span>
              </>
            )}
            {isBooked && session.bookedByAgentName && (
              <>
                <span className="text-gray-400">·</span>
                <span className="text-green-700 font-medium">Booked by {session.bookedByAgentName}</span>
              </>
            )}
          </div>

          {/* ── Notes preview ── */}
          {session.internalNotes && (
            <div className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 mb-2.5">
              <span className="shrink-0 mt-px">📝</span>
              <span className="line-clamp-2">{session.internalNotes}</span>
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Primary CTA */}
            {!isBooked && (
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity disabled:opacity-60"
                style={{ backgroundColor: "#16a34a" }}
                onClick={() => markBooked.mutate({ sessionId: session.id })}
                disabled={markBooked.isPending}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mark Booked
              </button>
            )}

            {/* Ghost secondaries */}
            <button
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors"
              onClick={() => setShowConversation(true)}
            >
              <MessageSquare className="w-3 h-3" /> Details
            </button>

            {!isBooked && (
              <button
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors"
                onClick={() => setShowLogCall(true)}
              >
                <PhoneCall className="w-3 h-3" /> Log Call
              </button>
            )}

            {!isBooked && (
              isMine ? (
                <button
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-60"
                  onClick={() => unclaimLead.mutate({ sessionId: session.id })}
                  disabled={unclaimLead.isPending}
                >
                  <UserX className="w-3 h-3" /> Release
                </button>
              ) : !session.assignedAgentId ? (
                <button
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors disabled:opacity-60"
                  onClick={() => claimLead.mutate({ sessionId: session.id })}
                  disabled={claimLead.isPending}
                >
                  <UserCheck className="w-3 h-3" /> Claim
                </button>
              ) : null
            )}

            {/* Not Interested — far right, muted */}
            {!isBooked && !isNotInterested && (
              <button
                className="ml-auto inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-60"
                onClick={() => markNotInterested.mutate({ sessionId: session.id })}
                disabled={markNotInterested.isPending}
                title="Mark as not interested"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {showLogCall && (
        <LogCallDialog session={session} onClose={() => setShowLogCall(false)} />
      )}
      {showConversation && (
        <ConversationDrawer session={session} onClose={() => setShowConversation(false)} currentAgentId={currentAgentId} />
      )}
    </>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

type ViewMode = "all" | "my" | "unassigned" | "booked";

export default function AgentDashboard() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "all">("all");

  // Compute dateFrom/dateTo from dateRange
  const { dateFrom, dateTo } = useMemo(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (dateRange === "today") {
      const today = fmt(now);
      return { dateFrom: today, dateTo: today };
    }
    if (dateRange === "week") {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay()); // Sunday
      return { dateFrom: fmt(start), dateTo: fmt(now) };
    }
    if (dateRange === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateFrom: fmt(start), dateTo: fmt(now) };
    }
    return { dateFrom: undefined, dateTo: undefined };
  }, [dateRange]);

  // Agent session
  const { data: agentMe, isLoading: agentLoading, refetch: refetchMe } = trpc.agents.me.useQuery(undefined, {
    retry: false,
  });

  const logoutMutation = trpc.agents.logout.useMutation({
    onSuccess: () => {
      utils.agents.me.invalidate();
      toast.success("Signed out");
    },
  });

  // Personal stats
  const { data: myStats } = trpc.agents.myStats.useQuery(
    { dateFrom, dateTo },
    { enabled: !!agentMe }
  );

  // Leads
  const { data: allSessions = [], isLoading, refetch, isFetching } = trpc.leads.list.useQuery(
    { dateFrom, dateTo },
    {
      enabled: !!agentMe,
      refetchInterval: 30_000,
    }
  );

  const filtered = useMemo(() => {
    return (allSessions as Session[]).filter(s => {
      if (viewMode === "my" && s.assignedAgentId !== agentMe?.id) return false;
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
  }, [allSessions, viewMode, stageFilter, search, agentMe?.id]);

  const myCount = (allSessions as Session[]).filter(s => s.assignedAgentId === agentMe?.id).length;
  const unassignedCount = (allSessions as Session[]).filter(s => !s.assignedAgentId).length;
  const bookedCount = (allSessions as Session[]).filter(s => s.isBooked === 1).length;

  // Loading state
  if (agentLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#FFF8F5" }}>
        <RefreshCw className="w-6 h-6 animate-spin" style={{ color: "#E8603C" }} />
      </div>
    );
  }

  // Not logged in → show login form
  if (!agentMe) {
    return <AgentLoginForm onSuccess={() => refetchMe()} />;
  }

  const VIEW_TABS: { value: ViewMode; label: string; count: number }[] = [
    { value: "all",        label: "All Leads",  count: (allSessions as Session[]).length },
    { value: "my",         label: "My Leads",   count: myCount },
    { value: "unassigned", label: "Unassigned", count: unassignedCount },
    { value: "booked",     label: "Booked",     count: bookedCount },
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
                Signed in as <span className="font-medium text-gray-700">{agentMe.name}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <AgentNotificationBell />
            <Button variant="ghost" size="sm" onClick={() => logoutMutation.mutate()} className="gap-1.5 text-gray-500">
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
        {/* Personal performance stats bar */}
        {myStats && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              {
                label: "Jobs Booked",
                value: myStats.bookedCount,
                display: String(myStats.bookedCount),
                icon: "✓",
                color: "#16a34a",
                bg: "#f0fdf4",
                border: "#bbf7d0",
              },
              {
                label: "Revenue",
                value: myStats.bookedRevenue,
                display: `$${myStats.bookedRevenue.toLocaleString()}`,
                icon: "$",
                color: "#E8603C",
                bg: "#fff8f5",
                border: "#F0D8D0",
              },
              {
                label: "Conversion",
                value: myStats.conversionRate,
                display: `${myStats.conversionRate}%`,
                icon: "↗",
                color: "#7c3aed",
                bg: "#faf5ff",
                border: "#e9d5ff",
              },
            ].map(stat => (
              <div
                key={stat.label}
                className="rounded-xl px-4 py-3 border flex flex-col gap-0.5"
                style={{ backgroundColor: stat.bg, borderColor: stat.border }}
              >
                <span className="text-xs font-medium" style={{ color: stat.color }}>
                  {stat.icon} {stat.label}
                </span>
                <span className="text-xl font-bold text-gray-900 leading-tight">{stat.display}</span>
                <span className="text-xs text-gray-400">{myStats.leadsAssigned} assigned</span>
              </div>
            ))}
          </div>
        )}

        {/* Date filter chips */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-0.5">
          {(["all", "today", "week", "month"] as const).map(range => {
            const labels: Record<string, string> = { all: "All Time", today: "Today", week: "This Week", month: "This Month" };
            const active = dateRange === range;
            return (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className="px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors"
                style={active
                  ? { backgroundColor: "#E8603C", color: "#fff", borderColor: "#E8603C" }
                  : { backgroundColor: "#fff", color: "#6b7280", borderColor: "#e5e7eb" }
                }
              >
                {labels[range]}
              </button>
            );
          })}
        </div>

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
                currentAgentId={agentMe.id}
                onRefresh={() => refetch()}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
