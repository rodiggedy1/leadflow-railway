/**
 * AgentDashboard — Personal workspace for each sales agent.
 * Uses email + password auth — no Manus account required.
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useLeadReplyNotifier } from "@/hooks/useLeadReplyNotifier";
import SmsComposeBox from "@/components/SmsComposeBox";
import AgentNotificationBell from "@/components/AgentNotificationBell";
import { FollowUpReminderToast, useTodayFollowUps } from "@/components/FollowUpReminderToast";
import MessageDateSeparator, { formatMsgDate, isDifferentDay } from "@/components/MessageDateSeparator";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { calculateExtrasTotal } from "@shared/extras";
import { ADMIN_PAGES } from "@shared/const";
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
  PhoneIncoming,
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
  Mic,
  PlayCircle,
  RotateCcw,
  Pencil,
  Check,
  X,
  StickyNote,
} from "lucide-react";
import CallGuide from "@/components/CallGuide";
import { useLocation } from "wouter";
import { useOpsChatWindow } from "@/hooks/useOpsChatWindow";

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
  BOOKED:              "Booked ✔",
  NOT_INTERESTED:      "Not Interested",
  FOLLOW_UP_SCHEDULED: "Follow Up 📅",
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
  BOOKED:              { bg: "#bbf7d0", text: "#14532d", border: "#4ade80" },
  NOT_INTERESTED:      { bg: "#f3f4f6", text: "#6b7280", border: "#d1d5db" },
  FOLLOW_UP_SCHEDULED: { bg: "#f5f3ff", text: "#7c3aed", border: "#ddd6fe" },
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
  currentAgentName,
}: {
  session: Session;
  onClose: () => void;
  currentAgentId: number;
  currentAgentName?: string;
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

  // Lead name editing
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(session.leadName ?? "");
  const updateLeadNameMutation = trpc.leads.updateLeadName.useMutation({
    onSuccess: (data) => {
      utils.leads.list.invalidate();
      setEditingName(false);
      // Update local session display via freshSession
      toast.success(`Name set to ${data.leadName}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Phone editing
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState(session.leadPhone ?? "");
  const updateLeadPhoneMutation = trpc.leads.updateLeadPhone.useMutation({
    onSuccess: (data) => {
      utils.leads.list.invalidate();
      setEditingPhone(false);
      toast.success(`Phone updated to ${data.leadPhone}`);
    },
    onError: (e) => toast.error(e.message),
  });

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
      setLocalMessages(prev => [...prev, { role: "assistant", content: vars.message, ts: Date.now(), senderName: currentAgentName ?? "Agent" } as any]);
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
    if (!text || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate({ sessionId: session.id, message: text });
  };

  // Typing presence
  const setTypingMutation = trpc.leads.setTyping.useMutation();
  const handleTypingChange = (isTyping: boolean) => {
    setTypingMutation.mutate({ sessionId: session.id, isTyping });
  };
  const { data: typingData } = trpc.leads.getTyping.useQuery(
    { sessionId: session.id },
    { refetchInterval: 2000 }
  );

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
  // OpenPhone call recordings
  const { data: callRecordings } = trpc.leads.getCallRecordings.useQuery({ sessionId: session.id });

  // Voice calls (Vapi AI)
  const { data: voiceCalls = [] } = trpc.voice.getCallsBySession.useQuery({ sessionId: session.id });

  // Keep local notes in sync with fetched data
  const loadedNotes = notesData?.notes ?? "";

  // AI closing recommendation — same as admin drawer
  const { data: closingRec, isLoading: isLoadingRec, refetch: refetchRec } = trpc.leads.getClosingRecommendation.useQuery(
    { sessionId: session.id },
    { staleTime: 5 * 60 * 1000, retry: 1 }
  );

  // Tabs: conversation | flow
  const [drawerTab, setDrawerTab] = useState<"conversation" | "flow">("conversation");

  // Note input toggle (inline in compose toolbar)
  const [showNoteInput, setShowNoteInput] = useState(false);

  // Apply AI suggestion into compose box
  const applySuggestion = (index: number) => {
    if (index === -1) {
      setReplyText(closingRec?.suggestedMessage ?? "");
    } else {
      const msg = closingRec?.alternativeMessages?.[index];
      setReplyText(msg ?? "");
    }
    setDrawerTab("conversation");
  };

  // Pre-fill compose box with AI suggested message on first load
  useEffect(() => {
    if (closingRec?.suggestedMessage && !replyText) {
      setReplyText(closingRec.suggestedMessage);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closingRec?.suggestedMessage]);

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
              {editingName ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const trimmed = nameInput.trim();
                    if (!trimmed) return;
                    updateLeadNameMutation.mutate({ sessionId: session.id, leadName: trimmed });
                  }}
                >
                  <input
                    autoFocus
                    className="text-sm font-semibold text-gray-900 border-b border-gray-400 bg-transparent outline-none w-36"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") { setEditingName(false); setNameInput(session.leadName ?? ""); } }}
                  />
                  <button type="submit" disabled={updateLeadNameMutation.isPending} className="text-green-600 hover:text-green-700">
                    {updateLeadNameMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  </button>
                  <button type="button" onClick={() => { setEditingName(false); setNameInput(session.leadName ?? ""); }} className="text-gray-400 hover:text-gray-600">
                    <X className="w-3 h-3" />
                  </button>
                </form>
              ) : (
                <button
                  className="flex items-center gap-1 group"
                  onClick={() => { setNameInput(session.leadName ?? ""); setEditingName(true); }}
                  title="Edit name"
                >
                  <h3 className="font-semibold text-gray-900 leading-tight">{session.leadName ?? <span className="text-gray-400 font-normal italic text-xs">No name — tap to add</span>}</h3>
                  <Pencil className="w-2.5 h-2.5 text-gray-300 group-hover:text-gray-500 transition-colors" />
                </button>
              )}
              <div className="flex items-center gap-2">
                {editingPhone ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const trimmed = phoneInput.trim();
                      if (!trimmed) return;
                      updateLeadPhoneMutation.mutate({ sessionId: session.id, leadPhone: trimmed });
                    }}
                  >
                    <input
                      autoFocus
                      className="text-xs text-gray-700 border-b border-gray-400 bg-transparent outline-none w-32"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") { setEditingPhone(false); setPhoneInput(session.leadPhone ?? ""); } }}
                    />
                    <button type="submit" disabled={updateLeadPhoneMutation.isPending} className="text-green-600 hover:text-green-700">
                      {updateLeadPhoneMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    </button>
                    <button type="button" onClick={() => { setEditingPhone(false); setPhoneInput(session.leadPhone ?? ""); }} className="text-gray-400 hover:text-gray-600">
                      <X className="w-3 h-3" />
                    </button>
                  </form>
                ) : (
                  <button
                    className="flex items-center gap-1 group"
                    onClick={() => { setPhoneInput(session.leadPhone ?? ""); setEditingPhone(true); }}
                    title="Edit phone"
                  >
                    <p className="text-xs text-gray-500">{formatPhone(session.leadPhone)}</p>
                    <Pencil className="w-2.5 h-2.5 text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </button>
                )}
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

            {/* ── Tab bar ── */}
            <div className="flex items-center gap-0 px-4 shrink-0 border-b border-gray-100">
              {(["conversation", "flow"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setDrawerTab(tab)}
                  className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                    drawerTab === tab
                      ? "border-orange-400 text-gray-900"
                      : "border-transparent text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {tab === "conversation" ? "Conversation" : "Flow View"}
                </button>
              ))}
            </div>

            {/* ── Persistent note display ── */}
            {(loadedNotes || notes) && !showNoteInput && drawerTab === "conversation" && (
              <div className="mx-4 mt-2 mb-0 flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50/60 border border-amber-100">
                <StickyNote className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                <p className="flex-1 text-xs text-amber-800/80 leading-relaxed whitespace-pre-wrap">{notes || loadedNotes}</p>
                <button
                  onClick={() => setShowNoteInput(true)}
                  className="shrink-0 text-amber-300 hover:text-amber-500 transition-colors mt-0.5"
                  title="Edit note"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* ── CONVERSATION TAB ── */}
            {drawerTab === "conversation" && (
            <div className="flex flex-col flex-1 min-h-0">
            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 bg-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/* AI recommendation strip */}
              <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50/70 border border-orange-100">
                <span className="text-[10px] font-semibold text-orange-400 uppercase tracking-wide shrink-0">AI</span>
                <span className="flex-1 text-xs text-orange-700/80 leading-snug">
                  {isLoadingRec ? (
                    <span className="animate-pulse text-orange-300">Analyzing...</span>
                  ) : closingRec ? (
                    closingRec.objectionSummary
                  ) : (
                    "AI recommendation will appear here"
                  )}
                </span>
                <button
                  onClick={() => refetchRec()}
                  className="shrink-0 text-orange-300 hover:text-orange-500 transition-colors"
                  title="Refresh recommendation"
                >
                  {isLoadingRec ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="text-[11px]">&#8635;</span>}
                </button>
              </div>
              {(() => {
                type AgentTimelineItem =
                  | { kind: "msg"; msg: typeof localMessages[0]; i: number }
                  | { kind: "recording"; rec: NonNullable<typeof callRecordings>[0] };

                const items: AgentTimelineItem[] = [
                  ...localMessages.map((msg, i) => ({ kind: "msg" as const, msg, i })),
                  ...(callRecordings ?? []).map(rec => ({ kind: "recording" as const, rec })),
                ].sort((a, b) => {
                  const tsA = a.kind === "msg" ? (a.msg.ts ?? 0) : new Date(a.rec.callStartedAt ?? 0).getTime();
                  const tsB = b.kind === "msg" ? (b.msg.ts ?? 0) : new Date(b.rec.callStartedAt ?? 0).getTime();
                  return tsA - tsB;
                });

                if (items.length === 0) {
                  return <p className="text-sm text-gray-400 text-center py-6">No messages yet</p>;
                }

                let lastTs: number | undefined;

                return items.map((item, idx) => {
                  if (item.kind === "recording") {
                    const rec = item.rec;
                    const recTs = rec.callStartedAt ? new Date(rec.callStartedAt).getTime() : undefined;
                    const showSep = recTs != null && (lastTs == null || isDifferentDay(lastTs, recTs));
                    if (recTs != null) lastTs = recTs;
                    const timeLabel = recTs ? new Date(recTs).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : null;
                    const mins = rec.durationSeconds ? Math.floor(rec.durationSeconds / 60) : 0;
                    const secs = rec.durationSeconds ? rec.durationSeconds % 60 : 0;
                    const durLabel = rec.durationSeconds ? `${mins}m ${secs}s` : null;
                    // Parse transcript dialogue array
                    type AgentDialogueTurn = { identifier: string; content: string; start: number; end: number };
                    let agentDialogue: AgentDialogueTurn[] = [];
                    if (rec.transcript) {
                      try { agentDialogue = JSON.parse(rec.transcript); } catch { agentDialogue = []; }
                    }
                    const agentSpeakerLabel = (id: string) => {
                      if (!id) return "Unknown";
                      if (id.startsWith("+")) return session.leadName ?? id;
                      return "Staff";
                    };
                    return (
                      <div key={`rec-${rec.id ?? idx}`}>
                        {showSep && recTs != null && <MessageDateSeparator label={formatMsgDate(recTs)} />}
                        <div className="flex justify-center my-2">
                          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm w-full max-w-sm">
                            {/* Header row */}
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                                <PhoneIncoming className="w-3.5 h-3.5 text-blue-500" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-gray-700">
                                  {rec.direction === "outgoing" ? "Outbound call" : "Inbound call"}
                                  {durLabel && <span className="font-normal text-gray-400 ml-1">· {durLabel}</span>}
                                </div>
                                {timeLabel && <div className="text-[11px] text-gray-400">{timeLabel}</div>}
                              </div>
                            </div>
                            {/* Audio player */}
                            {rec.recordingUrl && (
                              <audio
                                controls
                                src={rec.recordingUrl}
                                className="w-full h-8 mb-2"
                                style={{ accentColor: "#E8603C" }}
                              />
                            )}
                            {/* Transcript */}
                            {agentDialogue.length > 0 && (
                              <details className="mt-1">
                                <summary className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide cursor-pointer select-none hover:text-gray-600 transition-colors">
                                  Transcript · {agentDialogue.length} turns
                                </summary>
                                <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                  {agentDialogue.map((turn, ti) => (
                                    <div key={ti} className="flex gap-2">
                                      <span className="text-[10px] font-semibold shrink-0 mt-0.5"
                                        style={{ color: turn.identifier?.startsWith("+") ? "#6b7280" : "#E8603C" }}>
                                        {agentSpeakerLabel(turn.identifier)}
                                      </span>
                                      <span className="text-[11px] text-gray-600 leading-snug">{turn.content}</span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const { msg } = item;
                  const isOutbound = msg.role === "assistant";
                  const curTs = msg.ts;
                  const showSeparator = curTs != null && (lastTs == null || isDifferentDay(lastTs, curTs));
                  if (curTs != null) lastTs = curTs;
                  const timeLabel = curTs != null
                    ? new Date(curTs).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                    : null;
                  const senderName = (msg as any).senderName as string | undefined;
                  const isAiMessage = isOutbound && !senderName;
                  return (
                    <div key={idx}>
                      {showSeparator && curTs != null && (
                        <MessageDateSeparator label={formatMsgDate(curTs)} />
                      )}
                      <div className={`flex mb-3 ${isOutbound ? "justify-end" : "justify-start"}`}>
                        {isAiMessage && (
                          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mr-1.5 mt-0.5" style={{ backgroundColor: "#e0f2fe", border: "1px solid #bae6fd" }}>
                            <span className="text-[11px]">🤖</span>
                          </div>
                        )}
                        <div className="flex flex-col" style={{ maxWidth: "78%" }}>
                          <div
                            className="rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words"
                            style={
                              isOutbound
                                ? { backgroundColor: "#E8603C", color: "white", borderBottomRightRadius: isAiMessage ? "12px" : "4px", borderBottomLeftRadius: isAiMessage ? "4px" : "12px" }
                                : { backgroundColor: "#ffffff", color: "#111827", borderBottomLeftRadius: "4px", border: "1px solid #e5e7eb" }
                            }
                          >
                            {msg.content}
                          </div>
                          <div className={`flex items-center gap-1.5 mt-0.5 px-1 ${isOutbound ? (isAiMessage ? "justify-start" : "justify-end") : "justify-start"}`}>
                            {isOutbound && senderName && (
                              <span className="text-[10px] font-medium text-orange-500">{senderName}</span>
                            )}
                            {timeLabel && (
                              <span className="text-[10px] text-gray-400">{timeLabel}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
              <div ref={messagesEndRef} />
            </div>

            {/* ── AI suggestion pills ── */}
            <div className="shrink-0 border-t border-gray-100 bg-gray-50">
              <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide shrink-0 mr-0.5">AI</span>
                {[
                  { index: -1, label: closingRec?.primaryMove ?? "Primary move" },
                  { index: 0, label: closingRec?.alternativeMoves?.[0] ?? "Alternative 1" },
                  { index: 1, label: closingRec?.alternativeMoves?.[1] ?? "Alternative 2" },
                  { index: 2, label: closingRec?.alternativeMoves?.[2] ?? "Alternative 3" },
                ].map(({ index, label }, i) => {
                  return (
                    <button
                      key={index}
                      onClick={() => applySuggestion(index)}
                      title={label}
                      className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-all whitespace-nowrap ${
                        i === 0
                          ? "border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-100"
                          : "border-gray-200 text-gray-500 bg-white hover:bg-gray-50"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Compose box (admin-style unified toolbar) ── */}
            <div className="mx-4 mb-4 mt-2 rounded-2xl border border-gray-150 bg-white overflow-hidden shrink-0 shadow-sm">
              {typingData?.typingAgentName && (
                <div className="flex items-center gap-2 px-4 pt-2">
                  <span className="inline-flex gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                  <span className="text-xs text-orange-600 font-medium">{typingData.typingAgentName} is typing...</span>
                </div>
              )}
              <textarea
                value={replyText}
                onChange={e => { setReplyText(e.target.value); handleTypingChange(e.target.value.length > 0); }}
                onBlur={() => handleTypingChange(false)}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Type a message..."
                rows={3}
                className="w-full px-4 pt-3 pb-1 text-sm text-gray-800 resize-none outline-none bg-transparent placeholder-gray-300"
              />
              {/* Inline note input */}
              {showNoteInput && (
                <div className="px-4 pb-2 border-t border-gray-100 pt-2">
                  <textarea
                    placeholder="e.g. Left voicemail, price objection, follow up Friday..."
                    value={notes !== "" ? notes : loadedNotes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    className="w-full resize-none text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-300"
                    autoFocus
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-gray-400">Visible to agents and admins only</span>
                    <div className="flex items-center gap-2">
                      {notesSaved && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
                      <button
                        className="h-7 px-3 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                        onClick={() => { updateNotes.mutate({ sessionId: session.id, notes: notes !== "" ? notes : loadedNotes }); setShowNoteInput(false); }}
                        disabled={updateNotes.isPending}
                      >
                        {updateNotes.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Toolbar: note icon + AI toggle + Send */}
              <div className="flex items-center gap-2 px-3 pb-3 pt-1">
                {/* Note icon */}
                <button
                  onClick={() => setShowNoteInput(v => !v)}
                  title={notes || loadedNotes ? "Edit note" : "Add note"}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                    notes || loadedNotes
                      ? "text-amber-500 bg-amber-50 hover:bg-amber-100"
                      : "text-gray-300 hover:text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  <StickyNote className="w-3.5 h-3.5" />
                </button>
                {/* AI toggle */}
                <button
                  onClick={() => setAiModeMutation.mutate({ sessionId: session.id, aiMode: session.aiMode === 1 ? 0 : 1 })}
                  disabled={setAiModeMutation.isPending}
                  title={session.aiMode === 1 ? "AI is handling replies — click to take over" : "AI is paused — click to resume"}
                  className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                    session.aiMode === 1
                      ? "text-green-700 bg-green-50 border-green-200 hover:bg-green-100"
                      : "text-gray-400 bg-white border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <Bot className="w-3.5 h-3.5" />
                  {session.aiMode === 1 ? "AI on" : "AI off"}
                </button>
                <button
                  onClick={handleSend}
                  disabled={!replyText.trim() || sendMessageMutation.isPending}
                  className="ml-auto flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
                  style={{ backgroundColor: "#F97316" }}
                >
                  {sendMessageMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Send &#8594;
                </button>
              </div>
            </div>
            </div>
            )} {/* end conversation tab */}

            {/* ── FLOW VIEW TAB ── */}
            {drawerTab === "flow" && (
              <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4 bg-white">
                {/* Pipeline Stage */}
                {(() => {
                  const pipelineStages = ["Lead In", "Quoted", "In Progress", "Follow-Up", "Re-engage", "Booked"];
                  const stageToIndex: Record<string, number> = {
                    WIDGET_SIZING: 0, QUOTE_SENT: 1, AVAILABILITY: 2, SLOT_CHOICE: 2, ADDRESS: 2,
                    CONFIRMATION: 2, CALL_SCHEDULED: 2, DONE: 2, UNHANDLED: 2,
                    FOLLOW_UP_SCHEDULED: 3, NOT_INTERESTED: 4, BOOKED: 5,
                  };
                  const currentIdx = stageToIndex[session.stage] ?? 0;
                  return (
                    <div className="bg-gray-50 rounded-2xl p-4">
                      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Pipeline Stage</div>
                      <div className="flex items-center gap-1">
                        {pipelineStages.map((stage, idx) => (
                          <div key={stage} className="flex items-center flex-1">
                            <div className={`flex-1 text-center py-2 px-1 rounded-lg text-xs font-medium ${
                              idx === currentIdx ? "bg-gray-900 text-white" :
                              idx < currentIdx ? "bg-orange-100 text-orange-700" :
                              "bg-white text-gray-400 border border-gray-200"
                            }`}>
                              {stage}
                            </div>
                            {idx < pipelineStages.length - 1 && (
                              <div className={`w-3 h-0.5 shrink-0 ${idx < currentIdx ? "bg-orange-300" : "bg-gray-200"}`} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Lead details summary */}
                <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-2">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Lead Summary</div>
                  {session.quotedPrice && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Quote</span>
                      <span className="font-semibold" style={{ color: "#E8603C" }}>${computeTotalQuote(session.quotedPrice, session.extras)}</span>
                    </div>
                  )}
                  {session.serviceType && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Service</span>
                      <span className="font-medium">{session.serviceType}</span>
                    </div>
                  )}
                  {session.selectedSlot && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Slot</span>
                      <span className="font-medium text-xs">{session.selectedSlot}</span>
                    </div>
                  )}
                  {session.address && (
                    <div className="flex justify-between text-sm gap-2">
                      <span className="text-gray-500 shrink-0">Address</span>
                      <span className="font-medium text-xs text-right">{session.address}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Messages</span>
                    <span className="font-medium">{localMessages.length}</span>
                  </div>
                </div>
              </div>
            )}

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
                      onClick={e => { e.stopPropagation(); unclaimLead.mutate({ sessionId: session.id }); }}
                      disabled={unclaimLead.isPending}
                    >
                      <UserX className="w-3 h-3" /> Release Lead
                    </Button>
                  ) : isUnassigned ? (
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs gap-1 text-white w-full"
                      style={{ backgroundColor: "#E8603C" }}
                      onClick={e => { e.stopPropagation(); claimLead.mutate({ sessionId: session.id }); }}
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

            {/* AI Voice Calls (Vapi) */}
            {voiceCalls.length > 0 && (
              <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: "#F0D8D0" }}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                  <Mic className="w-3.5 h-3.5" /> AI Voice Calls ({voiceCalls.length})
                </p>
                {voiceCalls.map((call) => {
                  const outcomeColors: Record<string, string> = {
                    booked: "bg-emerald-100 text-emerald-700",
                    quote_given: "bg-blue-100 text-blue-700",
                    faq_answered: "bg-violet-100 text-violet-700",
                    transferred: "bg-orange-100 text-orange-700",
                    callback_requested: "bg-yellow-100 text-yellow-700",
                    no_action: "bg-gray-100 text-gray-500",
                  };
                  const colorClass = outcomeColors[call.outcome] ?? "bg-gray-100 text-gray-600";
                  const durationMin = Math.floor((call.durationSeconds ?? 0) / 60);
                  const durationSec = (call.durationSeconds ?? 0) % 60;
                  const durationLabel = call.durationSeconds
                    ? `${durationMin}:${String(durationSec).padStart(2, "0")}`
                    : null;
                  return (
                    <div key={call.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Mic className="w-3 h-3 text-gray-400" />
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${colorClass}`}>
                            {call.outcome.replace(/_/g, " ")}
                          </span>
                          {durationLabel && (
                            <span className="text-[10px] text-gray-400">{durationLabel}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-400 shrink-0">
                          {new Date(call.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </span>
                      </div>
                      {call.summary && (
                        <p className="text-xs text-gray-600 leading-relaxed">{call.summary}</p>
                      )}
                      {call.recordingUrl && (
                        <a
                          href={call.recordingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                        >
                          <PlayCircle className="w-3 h-3" />
                          Listen to recording
                        </a>
                      )}
                      {call.transcript && (
                        <details className="mt-1">
                          <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                            View transcript
                          </summary>
                          <p className="mt-1 text-[10px] text-gray-500 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {call.transcript}
                          </p>
                        </details>
                      )}
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
  currentAgentName,
  onRefresh,
}: {
  session: Session;
  currentAgentId: number;
  currentAgentName?: string;
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
  const markUnbooked = trpc.agents.markUnbooked.useMutation({
    onSuccess: () => { utils.leads.list.invalidate(); toast.success("Lead moved back to Follow Up"); },
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
        className="group relative bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden cursor-pointer"
        style={{ opacity: isNotInterested ? 0.65 : 1 }}
        data-session-id={session.id}
        onClick={() => setShowConversation(true)}
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
              {/* Show stage badge only if not booked (avoid duplicate with Booked badge below) */}
              {!isBooked && <StageBadge stage={session.stage} />}
              {isBooked && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700 border border-green-200">
                  <CheckCircle2 className="w-3 h-3" /> Booked
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Hover call icon */}
              {session.leadPhone && (
                <a
                  href={`tel:${session.leadPhone}`}
                  className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-white bg-[#E8603C] hover:bg-[#d4522f]"
                  onClick={e => e.stopPropagation()}
                  title={`Call ${formatPhone(session.leadPhone)}`}
                >
                  <Phone className="w-3 h-3" />
                </a>
              )}
              {totalPrice && (
                <span className="text-base font-bold" style={{ color: "#E8603C" }}>
                  ${totalPrice}
                </span>
              )}
            </div>
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
                onClick={e => { e.stopPropagation(); markBooked.mutate({ sessionId: session.id }); }}
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
                onClick={e => { e.stopPropagation(); setShowLogCall(true); }}
              >
                <PhoneCall className="w-3 h-3" /> Log Call
              </button>
            )}

            {!isBooked && (
              isMine ? (
                <button
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-60"
                  onClick={e => { e.stopPropagation(); unclaimLead.mutate({ sessionId: session.id }); }}
                  disabled={unclaimLead.isPending}
                >
                  <UserX className="w-3 h-3" /> Release
                </button>
              ) : (
                <button
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors disabled:opacity-60"
                  onClick={e => { e.stopPropagation(); claimLead.mutate({ sessionId: session.id }); }}
                  disabled={claimLead.isPending}
                >
                  <UserCheck className="w-3 h-3" /> Claim
                </button>
              )
            )}

            {/* Unbook — only shown for booked leads */}
            {isBooked && (
              <button
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors disabled:opacity-60"
                onClick={e => { e.stopPropagation(); markUnbooked.mutate({ sessionId: session.id, stage: "FOLLOW_UP" }); }}
                disabled={markUnbooked.isPending}
                title="Move back to Follow Up"
              >
                <RotateCcw className="w-3 h-3" /> Unbook
              </button>
            )}

            {/* Not Interested — far right, muted */}
            {!isBooked && !isNotInterested && (
              <button
                className="ml-auto inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-60"
                onClick={e => { e.stopPropagation(); markNotInterested.mutate({ sessionId: session.id }); }}
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
        <ConversationDrawer session={session} onClose={() => setShowConversation(false)} currentAgentId={currentAgentId} currentAgentName={currentAgentName} />
      )}
    </>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

function CallAssistButton() {
  const [, navigate] = useLocation();
  return (
    <button
      onClick={() => navigate("/call-assist")}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100"
    >
      <Phone className="w-3 h-3" />
      Call Assist
    </button>
  );
}

type ViewMode = "all" | "my" | "unassigned" | "booked";

export default function AgentDashboard() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [showCallGuide, setShowCallGuide] = useState(false);
  const { state: opsChatState, open: openOpsChat, minimize: minimizeOpsChat } = useOpsChatWindow();
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

  // Global new-reply chime — fires for ANY session that gets a new customer reply,
  // regardless of whether a conversation drawer is open.
  useLeadReplyNotifier(allSessions);

  // ── Follow-up reminder toasts ───────────────────────────────────────────────────────────────────────────
  const { data: todayFollowUps, refetch: refetchFollowUps } = useTodayFollowUps(!!agentMe);
  // When a toast card is clicked, we need to open the LeadCard's drawer.
  // We do this by scrolling to the card and programmatically triggering a click.
  // We store the pending session ID and resolve it once allSessions is populated.
  const [pendingOpenId, setPendingOpenId] = useState<number | null>(null);
  useEffect(() => {
    if (!pendingOpenId || allSessions.length === 0) return;
    const el = document.querySelector<HTMLElement>(`[data-session-id="${pendingOpenId}"]`);
    if (el) {
      el.click();
      setPendingOpenId(null);
    }
  }, [pendingOpenId, allSessions]);

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
      {/* Follow-up reminder toasts */}
      <FollowUpReminderToast
        leads={todayFollowUps}
        onOpen={(id) => setPendingOpenId(id)}
        onDismiss={() => refetchFollowUps()}
      />

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
            <CallAssistButton />
            <button
              onClick={() => opsChatState === "open" ? minimizeOpsChat() : openOpsChat()}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
              style={opsChatState === "open"
                ? { background: "#0f172a", color: "#fff", borderColor: "#0f172a" }
                : { borderColor: "#F0D8D0", color: "#E8603C", background: "transparent" }
              }
            >
              <MessageSquare className="w-3.5 h-3.5" />
              OpsChat
            </button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <AgentNotificationBell followUpCount={todayFollowUps.length} />
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

        {/* Admin pages nav — only shown when agent has page permissions */}
        {agentMe.pagePermissions && agentMe.pagePermissions.length > 0 && (() => {
          const PAGE_URLS: Record<string, string> = {
            "command-center":    "/admin/command-center",
            "leads":             "/admin/leads",
            "pipeline":          "/admin/leads?tab=pipeline",
            "callbacks":         "/admin/leads?tab=callbacks",
            "calls":             "/admin/calls",
            "agents":            "/admin/leads?tab=agents",
            "leaderboard":       "/admin/leads?tab=leaderboard",
            "campaigns":         "/admin/campaigns",
            "always-on":         "/admin/always-on",
            "campaign-approval": "/admin/campaign-approval",
            "field-management":  "/admin/field-management",
            "quality":           "/admin/quality",
            "tracker-flow":      "/admin/tracker-flow",
            "settings":          "/admin/settings",
          };
          const permittedPages = ADMIN_PAGES.filter(p => (agentMe.pagePermissions as string[]).includes(p.id));
          return (
            <div className="border-t" style={{ borderColor: "#F0D8D0" }}>
              <div className="max-w-4xl mx-auto px-4 flex gap-1 overflow-x-auto">
                <span className="flex items-center px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                  Admin
                </span>
                {permittedPages.map(page => (
                  <a
                    key={page.id}
                    href={PAGE_URLS[page.id] ?? "/admin/command-center"}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
                    style={{ borderColor: "transparent", color: "#6b7280" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#E8603C"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#6b7280"; }}
                  >
                    {page.label}
                  </a>
                ))}
              </div>
            </div>
          );
        })()}
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5">
        {/* Personal performance stats bar */}
        {myStats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              {
                label: "Jobs Booked",
                value: myStats.bookedCount,
                display: String(myStats.bookedCount),
                icon: "✓",
                color: "#16a34a",
                bg: "#f0fdf4",
                border: "#bbf7d0",
                sub: `${myStats.leadsAssigned} assigned`,
              },
              {
                label: "Revenue",
                value: myStats.bookedRevenue,
                display: `$${myStats.bookedRevenue.toLocaleString()}`,
                icon: "$",
                color: "#E8603C",
                bg: "#fff8f5",
                border: "#F0D8D0",
                sub: "all time",
              },
              {
                label: "Conversion",
                value: myStats.conversionRate,
                display: `${myStats.conversionRate}%`,
                icon: "↗",
                color: "#7c3aed",
                bg: "#faf5ff",
                border: "#e9d5ff",
                sub: "leads → booked",
              },
              {
                label: "Calls Today",
                value: myStats.callAssistToday ?? 0,
                display: String(myStats.callAssistToday ?? 0),
                icon: "📞",
                color: "#0891b2",
                bg: "#ecfeff",
                border: "#a5f3fc",
                sub: "via Call Assist",
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
                <span className="text-xs text-gray-400">{stat.sub}</span>
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
                currentAgentName={agentMe.name}
                onRefresh={() => refetch()}
              />
            ))}
          </div>
        )}
      </main>

      {/* Live Call Guide slide-in panel */}
      {showCallGuide && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setShowCallGuide(false)}>
          <div
            className="relative w-full max-w-md h-full bg-white shadow-2xl overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
              <span className="text-sm font-semibold text-violet-700 flex items-center gap-1.5">
                <Phone className="w-4 h-4" />
                Live Call Guide
              </span>
              <button
                onClick={() => setShowCallGuide(false)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4">
              <CallGuide />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

 
 
 
 
