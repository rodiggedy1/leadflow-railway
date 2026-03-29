/**
 * AgentDashboard — Personal workspace for each sales agent.
 * Uses email + password auth — no Manus account required.
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { useLeadReplyNotifier } from "@/hooks/useLeadReplyNotifier";
import SharedConversationDrawer, { DrawerSession } from "@/components/ConversationDrawer";
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

// ConversationDrawer replaced with shared component from @/components/ConversationDrawer
// The shared drawer is used directly in LeadCard below

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
        <SharedConversationDrawer
          session={session as unknown as DrawerSession}
          onClose={() => setShowConversation(false)}
          isAdmin={false}
          agentList={[]}
          onSessionUpdate={() => { utils.leads.list.invalidate(); }}
          onRefresh={() => { utils.leads.list.invalidate(); onRefresh(); }}
        />
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

 
 
 
 
