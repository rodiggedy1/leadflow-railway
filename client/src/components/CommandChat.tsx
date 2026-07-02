/**
 * CommandChat — MIB Command Chat view.
 * Renders when the user selects the "command" channel.
 * Layout: 3 columns
 *   Left  : Ops Snapshot + Live Alerts & Escalations
 *   Center: Pinned Day Status + Conversation thread + quick-action chips + composer
 *   Right : Command Center Rules + Auto-Raised Issues + Suggested Widgets
 *
 * Composer has full parity with the job-thread composer:
 *   Photo (drag-drop + click), Voice (MediaRecorder + Whisper), Emoji picker
 */
import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { ConversationViewport, type ConversationMessage as CVMessage } from "@/components/ConversationViewport";
import EmojiPicker, { type EmojiClickData, Theme } from "emoji-picker-react";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { useOsNotification } from "@/hooks/useOsNotification";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { useOpsStream } from "@/hooks/useOpsStream";
import { TypingBubble } from "@/components/TypingBubble";
import { trpc } from "@/lib/trpc";
import { senderHex } from "@/lib/senderColor";
import GlitterBurst from "@/components/GlitterBurst";
import TasksPanel, { DueTaskPopup } from "@/components/TasksPanel";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Clock, CheckCheck, Loader2, Send, Megaphone, MapPin,
  X, Camera, Mic, Smile, ImageIcon, UserCheck, Zap, Phone, Wand2, MessageSquare, MessageCircle,
  Pin, Bell, BellOff, TriangleAlert, PartyPopper, StickyNote, ChevronLeft, ChevronRight,
  ExternalLink, ChevronDown, Plus,
  CheckCircle2, XCircle, Sparkles, Copy, ClipboardCheck, ClipboardList, Briefcase, UserPlus,
  CalendarDays, Headphones, Radio, BookOpen, PhoneCall, PhoneOff, PhoneMissed, Search,
  ShieldAlert, CircleCheckBig, ArrowRight, Calculator, RefreshCw, PhoneIncoming, Mail, Bot, Smartphone, RotateCcw,
  DollarSign, Check, User, Calendar, CreditCard, Play, Pause, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import FollowUpsModal from "@/components/FollowUpsModal";
import { useAuth } from "@/_core/hooks/useAuth";
import FAQPanel from "@/components/FAQPanel";
import ObjectionsPanel from "@/components/ObjectionsPanel";
import IssueDialog from "@/components/IssueDialog";
import CallLogPanel from "@/components/CallLogPanel";
import ThreadPanel from "@/components/ThreadPanel";
import AllThreadsPanel from "@/components/AllThreadsPanel";
import AICallPanel from "@/components/AICallPanel";
import { CustomerMentionChip, QuickReplyModal, CustomerData, renderMessageWithMentions } from "@/components/CustomerMentionChip";
import { IssueEngineOverlay, CreateIssueModal, ActiveIssuesPill } from "@/components/IssueEngineOverlay";

// ── Payment Link Modal ───────────────────────────────────────────────────────
function _normalizePhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.startsWith("+") ? raw : `+${raw}`;
}
function _formatTs(ts: number | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}
function _CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
        copied
          ? "bg-green-100 text-green-700 border border-green-200"
          : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
      }`}
      title="Copy link to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied" : "Copy Link"}
    </button>
  );
}
function PaymentLinkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phone, setPhone] = React.useState("");
  const [name, setName] = React.useState("");
  const [jobDate, setJobDate] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [result, setResult] = React.useState<{ url: string; expiresAt: number } | null>(null);

  const generate = trpc.stripe.generateCardAuthToken.useMutation({
    onSuccess: (data) => {
      setResult({ url: data.url, expiresAt: data.expiresAt });
      toast.success("Card link generated!");
    },
    onError: (err) => toast.error(err.message || "Failed to generate link"),
  });

  function handleClose() {
    setPhone(""); setName(""); setJobDate(""); setAddress(""); setResult(null);
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) { toast.error("Phone number is required"); return; }
    generate.mutate({
      customerPhone: _normalizePhone(phone.trim()),
      customerName: name.trim() || undefined,
      jobDate: jobDate.trim() || undefined,
      jobAddress: address.trim() || undefined,
    });
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#E8735A]/30 focus:border-[#E8735A]";
  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#E8735A]/10 grid place-items-center">
              <CreditCard className="w-3.5 h-3.5 text-[#E8735A]" />
            </div>
            Generate Card Link
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 mt-1">
          <div>
            <label className={labelCls}><Phone className="w-3 h-3 inline mr-1" />Customer Phone *</label>
            <Input className={inputCls} placeholder="+1 (555) 000-0000" value={phone} onChange={e => setPhone(e.target.value)} required />
          </div>
          <div>
            <label className={labelCls}><User className="w-3 h-3 inline mr-1" />Customer Name</label>
            <Input className={inputCls} placeholder="Jane Smith" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}><Calendar className="w-3 h-3 inline mr-1" />Job Date</label>
            <Input className={inputCls} placeholder="Thursday, July 10 at 10 AM" value={jobDate} onChange={e => setJobDate(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}><MapPin className="w-3 h-3 inline mr-1" />Job Address</label>
            <Input className={inputCls} placeholder="123 Main St, Washington DC" value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Button type="submit" disabled={generate.isPending} className="w-full bg-[#E8735A] hover:bg-[#d4604a] text-white font-bold rounded-xl">
              {generate.isPending
                ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Generating…</span>
                : <span className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> Generate Secure Card Link</span>}
            </Button>
          </div>
        </form>

        {result && (
          <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-green-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Secure link created
                </p>
                <p className="mt-1 text-xs text-green-700">Valid for 7 days · expires {_formatTs(result.expiresAt)}</p>
              </div>
              <_CopyBtn text={result.url} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── types ─────────────────────────────────────────────────────────────────────

type StatusBucket = "issue" | "soon" | "progress" | "complete" | "assigned";

interface CommandChatProps {
  /** Channel messages already loaded by the parent (the "command" channel thread) */
  channelMsgs: Array<{
    id: number;
    from: string;
    role: string;
    body: string;
    mediaUrl?: string | null;
    quickAction?: string | null;
    metadata?: string | null;
    replyToId?: number | null;
    replyToBody?: string | null;
    replyToAuthor?: string | null;
    cleanerJobId?: number | null;
    threadParentId?: number | null;
    threadParentBody?: string | null;
    threadParentFrom?: string | null;
    replyCount?: number;
    createdAt: Date;
  }>;
  channelLoading: boolean;
  callerName: string;
  /** Called when user hits Send in the composer */
  onSendMessage: (body: string, mediaUrl?: string, replyTo?: { id: number; body: string; author: string }, quickAction?: string, metadata?: string) => void;
  /** Called when user clicks "Jump to Job Thread" */
  onJumpToJob: (jobId: number) => void;
  /** Called when user sends a reply in a thread panel */
  onSendThreadReply?: (body: string, parentId: number) => void;
  /** Called when user clicks "Ops" in the in-panel tab switcher */
  onSwitchToToday: () => void;
  /** Called when user clicks "CS" in the in-panel tab switcher */
  onSwitchToCS?: () => void;
  onSwitchToCSSession?: (sessionId: number) => void;
  /** Called when user clicks the Lead Ops badge in the header */
  onSwitchToLeadOps?: (sessionId?: number) => void;
  /** Current away status of the calling agent (null = available) */
  awayStatus?: string | null;
  /** Called when agent sets or clears away status */
  onSetAwayStatus?: (status: string | null) => void;
  /** Map of senderName -> "online" | "away" | "offline" for status dot overlays on avatars */
  senderStatusMap?: Record<string, "online" | "away" | "offline">;
  /** Full agent list with id/name/photoUrl/awayStatus for the online presence bar */
  agentList?: Array<{ id: number; name: string; photoUrl: string | null; awayStatus: string | null; onCallSince?: number | null }>;
  /** True when this panel is currently visible (not hidden by display:none). Used for @mention tracking. */
  isVisible?: boolean;
  /** All possible names for the current user (handles OAuth name vs DB name mismatch). Used for @mention detection. */
  myNames?: Set<string>;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const BUCKET_LABELS: Record<StatusBucket, string> = {
  issue:    "Needs Attention",
  soon:     "Starting Soon",
  progress: "In Progress",
  complete: "Completed",
  assigned: "Assigned",
};

const BUCKET_COLORS: Record<StatusBucket, string> = {
  issue:    "text-red-600",
  soon:     "text-amber-600",
  progress: "text-blue-600",
  complete: "text-emerald-600",
  assigned: "text-slate-500",
};

const BUCKET_BG: Record<StatusBucket, string> = {
  issue:    "bg-red-50 border-red-100",
  soon:     "bg-amber-50 border-amber-100",
  progress: "bg-blue-50 border-blue-100",
  complete: "bg-emerald-50 border-emerald-100",
  assigned: "bg-slate-50 border-slate-100",
};

function fmt12(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
}

function fmtMsgTime(d: Date): string {
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

// ── ElapsedTimer: live "X min ago" display ───────────────────────────────────

function ElapsedTimer({ arrivedAt }: { arrivedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - arrivedAt) / 60000));
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - arrivedAt) / 60000)), 30_000);
    return () => clearInterval(id);
  }, [arrivedAt]);
  if (elapsed < 1) return <span className="text-emerald-600 font-semibold">just now</span>;
  if (elapsed < 60) return <span className="text-amber-600 font-semibold">{elapsed}m ago</span>;
  const h = Math.floor(elapsed / 60), m = elapsed % 60;
  return <span className="text-red-600 font-semibold">{h}h {m}m ago</span>;
}

// ── ConvertToIssueModal ──────────────────────────────────────────────────────
type ConvertModalState = {
  commentId: number;
  commentBody: string;
  title: string;
  severity: string;
  team: string;
  customer: string;
  loading: boolean;
  submitting: boolean;
};
const SEVERITY_COLORS: Record<string, string> = {
  Critical: "text-red-600",
  High: "text-orange-500",
  Medium: "text-amber-500",
  Low: "text-slate-500",
};
function ConvertToIssueModal({
  state,
  onClose,
  onFieldChange,
  onSubmit,
}: {
  state: ConvertModalState & { msgId?: number };
  onClose: () => void;
  onFieldChange: (field: keyof ConvertModalState, value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            Create Issue
          </DialogTitle>
        </DialogHeader>
        <div className="px-1 py-2">
          {state.loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Analyzing message...</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-1">Title</p>
                  <input
                    value={state.title}
                    onChange={e => onFieldChange("title", e.target.value)}
                    className="w-full text-sm font-semibold text-slate-900 bg-transparent outline-none placeholder:text-slate-300"
                    placeholder="Issue title"
                  />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-1">Severity</p>
                  <select
                    value={state.severity}
                    onChange={e => onFieldChange("severity", e.target.value)}
                    className={cn("w-full text-sm font-semibold bg-transparent outline-none", SEVERITY_COLORS[state.severity] ?? "text-slate-900")}
                  >
                    {["Critical", "High", "Medium", "Low"].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-1">Team</p>
                  <input
                    value={state.team}
                    onChange={e => onFieldChange("team", e.target.value)}
                    className="w-full text-sm font-semibold text-slate-900 bg-transparent outline-none placeholder:text-slate-300"
                    placeholder="e.g. Dispatch"
                  />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-1">Customer</p>
                  <input
                    value={state.customer}
                    onChange={e => onFieldChange("customer", e.target.value)}
                    className="w-full text-sm font-semibold text-slate-900 bg-transparent outline-none placeholder:text-slate-300"
                    placeholder="Customer name"
                  />
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 mb-1">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs font-semibold text-red-600">This should now have an owner and resolution path</p>
              </div>
            </>
          )}
        </div>
        <DialogFooter className="px-7 pb-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={state.submitting || state.loading || !state.title.trim()}
            className="rounded-xl bg-slate-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-slate-800 disabled:opacity-40 transition flex items-center gap-2"
          >
            {state.submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Create issue
            {!state.submitting && <ArrowRight className="h-3.5 w-3.5" />}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── IssueCommentThread ──────────────────────────────────────────────────────

type IssueComment = {
  id: number;
  issueKey: string;
  authorName: string;
  body: string;
  type: "text" | "system";
  createdAt: number;
};

function IssueCommentThread({
  issueKey,
  callerName,
  expanded,
  onToggle,
}: {
  issueKey: string;
  callerName: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: comments = [], refetch } = trpc.opsChat.getIssueComments.useQuery(
    { issueKey },
    { enabled: expanded, refetchInterval: expanded ? 5000 : false, staleTime: 2000 }
  );

  const addComment = trpc.opsChat.addIssueComment.useMutation({
    onSuccess: () => refetch(),
  });

  // Scroll to bottom when new comments arrive
  useEffect(() => {
    if (expanded && comments.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [expanded, comments.length]);

  async function handleSubmit() {
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      await addComment.mutateAsync({ issueKey, authorName: callerName, body, type: "text" });
      setDraft("");
    } finally {
      setSubmitting(false);
    }
  }

  const commentCount = comments.length;

  return (
    <div className="border-t border-slate-200 mt-4">
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-6 py-3 text-left hover:bg-slate-100 transition rounded-b-2xl"
      >
        <MessageCircle className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="text-xs font-semibold text-slate-500">
          {commentCount > 0 ? `${commentCount} comment${commentCount !== 1 ? "s" : ""}` : "Add comment"}
        </span>
        {commentCount > 0 && (
          <span className="ml-auto text-xs text-slate-400">{expanded ? "Hide" : "Show"}</span>
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", expanded && "rotate-180")} />
      </button>

      {/* Thread body */}
      {expanded && (
        <div className="px-6 pb-4">
          {/* Comment list */}
          {comments.length > 0 && (
            <div className="space-y-2 mb-3 max-h-48 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
              {(comments as IssueComment[]).map(c => (
                <div key={c.id} className={cn(
                  "flex gap-2 items-start",
                  c.type === "system" ? "opacity-60" : ""
                )}>
                  {c.type === "system" ? (
                    <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle2 className="h-3 w-3 text-slate-500" />
                    </div>
                  ) : (
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0 mt-0.5"
                      style={{ background: `hsl(${Math.abs(c.authorName.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0)) % 360}, 55%, 52%)` }}
                    >
                      {c.authorName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    {c.type !== "system" && (
                      <span className="text-[10px] font-semibold text-slate-500 mr-1.5">{c.authorName}</span>
                    )}
                    <span className={cn(
                      "text-xs",
                      c.type === "system" ? "italic text-slate-400" : "text-slate-700"
                    )}>{c.body}</span>
                    <span className="text-[9px] text-slate-300 ml-1.5">
                      {new Date(c.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
          {/* Composer */}
          <div className="flex gap-2 items-end">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Add a note..."
              rows={2}
              className="flex-1 min-w-0 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition"
            />
            <button
              onClick={handleSubmit}
              disabled={!draft.trim() || submitting}
              className="shrink-0 rounded-xl bg-slate-800 text-white px-3 py-2 text-xs font-semibold hover:bg-slate-700 disabled:opacity-40 transition flex items-center gap-1"
            >
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── HotLeadsTray ─────────────────────────────────────────────────────────────

type LeadMsg = {
  id: number;
  from: string;
  role: string;
  body: string;
  mediaUrl?: string | null;
  quickAction?: string | null;
  metadata?: string | null;
  replyToId?: number | null;
  replyToBody?: string | null;
  replyToAuthor?: string | null;
  cleanerJobId?: number | null;
  threadParentId?: number | null;
  threadParentBody?: string | null;
  threadParentFrom?: string | null;
  replyCount?: number;
  createdAt: Date;
};

type ClaimMutation = {
  mutate: (args: { messageId: number; sessionId?: number }) => void;
  isPending: boolean;
};

/** Returns elapsed seconds since arrivedAt, ticking every second. */
function useElapsedSecs(arrivedAt: number) {
  const [secs, setSecs] = useState(() => Math.floor((Date.now() - arrivedAt) / 1000));
  useEffect(() => {
    const id = setInterval(() => setSecs(Math.floor((Date.now() - arrivedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [arrivedAt]);
  return secs;
}

function HotLeadClaimTimer({ arrivedAt }: { arrivedAt: number }) {
  const secs = useElapsedSecs(arrivedAt);
  const mins = Math.floor(secs / 60);
  const label = mins < 1
    ? `${secs}s`
    : mins < 60
    ? `${mins}m ${secs % 60}s`
    : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  // Color: green < 2 min, amber 2-5 min, red ≥ 5 min
  const colorClass = mins < 2 ? "text-emerald-300" : mins < 5 ? "text-yellow-200" : "text-red-200";
  return <span className={cn("font-mono font-bold tabular-nums", colorClass)}>{label}</span>;
}

type SessionStatus = {
  id: number;
  isBooked: boolean;
  bookedAt: number | null;
  bookedByAgentName: string | null;
  bookedAmount: number | null;
  stage: string;
  lostReason: string | null;
};

function HotLeadCard({
  msg,
  claimLeadMutation,
  sessionStatus,
  onOpenFirstMsg,
}: {
  msg: LeadMsg;
  claimLeadMutation: ClaimMutation;
  sessionStatus?: SessionStatus | null;
  onOpenFirstMsg?: (details: string) => void;
}) {
  // Shake state: fires every 8 seconds while unclaimed
  const [shaking, setShaking] = useState(false);
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch {}
  const leadName    = (meta.leadName    as string)         ?? msg.from;
  const leadPhone   = (meta.leadPhone   as string)         ?? "";
  const serviceType = (meta.serviceType as string)         ?? "";
  const price       = (meta.price       as number | string) ?? "";
  const size        = (meta.size        as string)         ?? ""; // city for thumbtack-sms, home size for others
  const utmSource   = (meta.utmSource   as string | null)  ?? null;
  const manualSource = (meta.source     as string | null)  ?? null;
  const SOURCE_LABELS: Record<string, string> = {
    yelp: "Yelp", google: "Google", thumbtack: "Thumbtack",
    bark: "Bark", phone: "Phone", other: "Manual",
  };
  const sourceDisplay = manualSource
    ? (SOURCE_LABELS[manualSource] ?? manualSource)
    : utmSource && utmSource !== "thumbtack-sms"
      ? (SOURCE_LABELS[utmSource] ?? utmSource)
      : null;
  const sessionId   = (meta.sessionId   as number | null)  ?? null;
  const arrivedAt   = (meta.arrivedAt   as number)         ?? msg.createdAt.getTime();
  const claimedBy   = (meta.claimedBy   as string | null)  ?? null;
  const claimedAt   = (meta.claimedAt   as number | null)  ?? null;
  const thumbtackUrl = (meta.thumbtackUrl as string | null) ?? null;
  const isClaimed   = Boolean(claimedBy);
  const isThumbSms  = utmSource === "thumbtack-sms";

  // Derive live status from sessionStatus prop
  const isBooked  = sessionStatus?.isBooked ?? false;
  const stage     = sessionStatus?.stage ?? null;
  // Each outcome stage gets its own band — never collapse Cold into Lost
  const isLost    = !isBooked && stage === "LOST";
  const isCold    = !isBooked && stage === "COLD";
  const isFollowUp  = !isBooked && stage === "FOLLOW_UP_SCHEDULED";
  const isVoicemail  = !isBooked && stage === "VOICEMAIL";
  const isResolved   = isBooked || isLost || isCold || isFollowUp || isVoicemail;

  // Live elapsed seconds — drives both timer label and urgency colors
  const secs = useElapsedSecs(arrivedAt);
  const mins = Math.floor(secs / 60);

  // Shake every 8 seconds while unclaimed and not yet resolved
  useEffect(() => {
    if (isClaimed || isResolved) return;
    // Trigger immediately on mount
    setShaking(true);
    const onEnd = () => setShaking(false);
    const interval = setInterval(() => {
      setShaking(true);
    }, 8000);
    return () => clearInterval(interval);
  }, [isClaimed]);

  const urgencyBand = isBooked
    ? "bg-blue-600   border-blue-200"
    : isLost
    ? "bg-slate-500  border-slate-300"
    : isCold
    ? "bg-sky-700    border-sky-400"
    : isVoicemail
    ? "bg-cyan-700   border-cyan-400"
    : isFollowUp
    ? "bg-purple-600 border-purple-300"
    : isClaimed
    ? "bg-emerald-600 border-emerald-200"
    : mins < 2  ? "bg-amber-500  border-amber-300"
    : mins < 5  ? "bg-orange-500 border-orange-400"
    :             "bg-red-600    border-red-400";
  const urgencyRing = (isResolved || isClaimed) ? "" :
    mins < 2  ? "ring-amber-400"
    : mins < 5 ? "ring-orange-500"
    :            "ring-red-500";
  const timerColor = mins < 2 ? "text-emerald-200" : mins < 5 ? "text-yellow-200" : "text-red-200";
  const timerLabel = mins < 1
    ? `${secs}s`
    : mins < 60
    ? `${mins}m ${secs % 60}s`
    : `${Math.floor(mins / 60)}h ${mins % 60}m`;

  const [bandBg, borderColor] = urgencyBand.split(" ");

  // Derive pill badge label and colors for the new design
  const pillLabel = isBooked
    ? `Booked${sessionStatus?.bookedByAgentName ? ` · ${sessionStatus.bookedByAgentName}` : ""}`
    : isLost
    ? `Lost${sessionStatus?.lostReason ? ` · ${sessionStatus.lostReason.replace(/_/g, " ")}` : ""}`
    : isCold    ? "Cold · No reply"
    : isVoicemail ? "Voicemail"
    : isFollowUp  ? "Follow-up set"
    : isClaimed   ? `Claimed · ${claimedBy}`
    : "Needs claim";

  const pillColors = isBooked
    ? "bg-blue-50 text-blue-700 border border-blue-200"
    : isLost
    ? "bg-slate-100 text-slate-500 border border-slate-200"
    : isCold
    ? "bg-sky-50 text-sky-700 border border-sky-200"
    : isVoicemail
    ? "bg-cyan-50 text-cyan-700 border border-cyan-200"
    : isFollowUp
    ? "bg-purple-50 text-purple-700 border border-purple-200"
    : isClaimed
    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
    : "bg-red-50 text-red-600 border border-red-200";

  const cardBg = isBooked
    ? "bg-blue-50/60 border-blue-200"
    : isLost || isCold
    ? "bg-slate-50 border-slate-200"
    : isClaimed
    ? "bg-emerald-50/40 border-emerald-200"
    : isResolved
    ? "bg-slate-50 border-slate-200"
    : "bg-[#f0fdf4] border-emerald-200";

  const waitLabel = mins < 1
    ? `Waiting ${secs}s`
    : mins < 60
    ? `Waiting ${mins}m`
    : `Waiting ${Math.floor(mins / 60)}h ${mins % 60}m`;

  return (
    <div
      onAnimationEnd={() => setShaking(false)}
      className={cn(
        "relative rounded-2xl border overflow-hidden transition-all",
        !isClaimed && shaking && "animate-lead-shake",
        cardBg,
      )}
    >
      {/* Pulsing glow ring for unclaimed */}
      {!isClaimed && !isResolved && (
        <span className={cn("absolute inset-0 rounded-2xl ring-2 ring-offset-0 animate-pulse pointer-events-none", urgencyRing)} />
      )}

      {/* Thumbtack label */}
      {isThumbSms && (
        <div className="flex items-center gap-1.5 px-3 pt-2.5">
          <span className="text-sky-600 text-[10px]">📌</span>
          <span className="text-[10px] font-semibold text-sky-700 uppercase tracking-widest">New Thumbtack Opportunity</span>
        </div>
      )}

      {/* Card body — clickable to open SMS */}
      <div
        className={cn("px-3.5 pt-3 pb-2", sessionId && "cursor-pointer")}
        onClick={() => { if (sessionId) window.open(`/admin/leads?session=${sessionId}&tab=sms`, "_blank"); }}
      >
        {/* Top row: pill badge + price */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className={cn("text-[11px] font-semibold rounded-full px-2.5 py-0.5 shrink-0", pillColors)}>
            {pillLabel}
          </span>
          {price && (
            <span className="text-xl font-bold text-emerald-700 shrink-0 leading-none">${price}</span>
          )}
        </div>

        {/* Name */}
        <p className="text-base font-bold text-slate-900 leading-tight">{leadName}</p>

        {/* Phone */}
        {leadPhone && <p className="text-sm text-slate-400 mt-0.5">{leadPhone}</p>}

        {/* Service details */}
        {serviceType && <p className="text-sm text-slate-500 mt-1">{serviceType}</p>}
        {isThumbSms && size && <p className="text-xs text-sky-600 mt-0.5 font-medium">📍 {size}</p>}

        {/* Bottom row: source + wait time */}
        <div className="flex items-center justify-between mt-2.5">
          <span className="text-sm text-slate-400">{sourceDisplay ?? ""}</span>
          {!isResolved && !isClaimed && (
            <span className="text-sm font-semibold text-slate-600">{waitLabel}</span>
          )}
          {isClaimed && claimedAt && (
            <span className="text-xs text-emerald-600 font-semibold">
              {new Date(claimedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })}
            </span>
          )}
          {isBooked && sessionStatus?.bookedAmount && (
            <span className="text-xs text-blue-600 font-bold">${sessionStatus.bookedAmount} booked</span>
          )}
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 px-3.5 pb-3">
        <a
          href="https://maidsquotes-b55s3sg4.manus.space/"
          target="_blank"
          rel="noopener noreferrer"
          title="Open quote generator"
          className="inline-flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-900 font-semibold"
          onClick={e => e.stopPropagation()}
        >
          <Calculator className="h-3 w-3" /> Quote
        </a>
        {thumbtackUrl && (
          <a
            href={thumbtackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-sky-600 hover:text-sky-800 font-semibold"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" /> Thumbtack
          </a>
        )}
        {leadPhone && (
          <a
            href={`openphone://call?to=${leadPhone}`}
            title={`Call ${leadName}`}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white/70 hover:bg-white text-slate-600 transition-colors shrink-0"
            onClick={e => e.stopPropagation()}
          >
            <Phone className="h-3.5 w-3.5" />
          </a>
        )}
        {sessionId && (
          <a
            href={`/admin/leads?session=${sessionId}&tab=sms`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open SMS conversation"
            className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white/70 hover:bg-white text-emerald-700 transition-colors shrink-0"
            onClick={e => e.stopPropagation()}
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          title="Generate first outreach message"
          onClick={e => {
            e.stopPropagation();
            const parts: string[] = [];
            if (leadName)    parts.push(`Name: ${leadName}`);
            if (leadPhone)   parts.push(`Phone: ${leadPhone}`);
            if (serviceType) parts.push(`Service: ${serviceType}`);
            if (price)       parts.push(`Estimated price: $${price}`);
            onOpenFirstMsg?.(parts.join("\n"));
          }}
          className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white/70 hover:bg-white text-violet-700 transition-colors shrink-0"
        >
          <Wand2 className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1" />
        {isClaimed ? (
          <span className="text-[10px] text-emerald-600 font-semibold">✓ Taken</span>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); claimLeadMutation.mutate({ messageId: msg.id, sessionId: sessionId ?? undefined }); }}
            disabled={claimLeadMutation.isPending}
            className="h-7 px-4 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {claimLeadMutation.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <>⚡ Claim</>}
          </button>
        )}
      </div>
    </div>
  );
}

function HotLeadsTray({
  channelMsgs,
  claimLeadMutation,
  onCollapse,
  onOpenFirstMsg,
  searchQuery = "",
}: {
  channelMsgs: LeadMsg[];
  claimLeadMutation: ClaimMutation;
  onCollapse: () => void;
  onOpenFirstMsg?: (details: string) => void;
  searchQuery?: string;
}) {
  // Derive lead cards from channelMsgs — only new_lead quickAction, last 8h
  const cutoff = Date.now() - 8 * 60 * 60 * 1000;
  const q = searchQuery.toLowerCase().trim();
  const leads = channelMsgs
    .filter((m) => {
      if (m.quickAction !== "new_lead" || m.createdAt.getTime() <= cutoff) return false;
      if (!q) return true;
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(m.metadata ?? "{}"); } catch {}
      const name = ((meta.leadName as string) ?? m.from ?? "").toLowerCase();
      const phone = ((meta.leadPhone as string) ?? "").toLowerCase();
      const service = ((meta.serviceType as string) ?? "").toLowerCase();
      const source = ((meta.utmSource as string) ?? (meta.source as string) ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || service.includes(q) || source.includes(q);
    })
    .slice()
    .reverse(); // newest first

  // Collect sessionIds from lead metadata to poll live status
  const sessionIds = useMemo(() => {
    const ids: number[] = [];
    for (const m of leads) {
      try {
        const meta = JSON.parse(m.metadata ?? "{}");
        if (typeof meta.sessionId === "number") ids.push(meta.sessionId);
      } catch {}
    }
    return ids;
  }, [leads]);

  const { data: sessionStatuses } = trpc.opsChat.getLeadSessionStatuses.useQuery(
    { sessionIds },
    { enabled: sessionIds.length > 0, refetchInterval: 60_000 }
  );

  // Build a map from sessionId -> status for O(1) lookup
  const statusMap = useMemo(() => {
    const m = new Map<number, SessionStatus>();
    for (const s of sessionStatuses ?? []) m.set(s.id, s);
    return m;
  }, [sessionStatuses]);

  const unclaimedCount = leads.filter((m) => {
    try { const meta = JSON.parse(m.metadata ?? "{}"); return !meta.claimedBy; } catch { return true; }
  }).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">Hot Leads</p>
          {unclaimedCount > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold animate-pulse">
              {unclaimedCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onCollapse}
          title="Collapse panel"
          className="w-5 h-5 rounded-full flex items-center justify-center text-slate-300 hover:bg-slate-200 hover:text-slate-600 transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Lead cards */}
      {leads.length === 0 ? (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-center">
          <Zap className="h-4 w-4 text-slate-300 mx-auto mb-1" />
          <p className="text-xs text-slate-400">No new leads in the last 8 hours</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {leads.map((msg) => (
            <HotLeadCard
              key={msg.id}
              msg={msg}
              claimLeadMutation={claimLeadMutation}
              onOpenFirstMsg={onOpenFirstMsg}
              sessionStatus={(() => {
                try {
                  const meta = JSON.parse(msg.metadata ?? "{}");
                  const sid = typeof meta.sessionId === "number" ? meta.sessionId : null;
                  return sid ? (statusMap.get(sid) ?? null) : null;
                } catch { return null; }
              })()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── MessageList (memoized) ───────────────────────────────────────────────────
// Extracted so that typing in the composer (setComposer) does NOT re-render
// the 500-message list. None of these props change on keystroke.

type MessageListProps = {
  channelMsgs: LeadMsg[];
  channelLoading: boolean;
  callerName: string;
  onJumpToJob: (jobId: number) => void;
  reactionsByMsgId: Record<number, Array<{ callerId: string; callerName: string; emoji: string }>>;
  commandSeenByMap: Record<number, string[]>;
  senderPhotoMap: Record<string, string | null>;
  unreadTagIds: number[];
  highlightedCmdMsgId: number | null;
  cmdMsgRefMap: React.MutableRefObject<Map<number, HTMLDivElement>>;
  msgsContainerRef: React.RefObject<HTMLDivElement | null>;
  threadScrollRef: React.RefObject<HTMLDivElement | null>;
  threadBottomRef: React.RefObject<HTMLDivElement | null>;
  toggleReactionMutation: { mutate: (args: { messageId: number; emoji: string }) => void };
  claimLeadMutation: ClaimMutation;
  scrollToCmdMsg: (id: number) => void;
  openChatConvert: (msgId: number, msgBody: string) => void;
  setReplyTo: (v: { id: number; body: string; author: string } | null) => void;
  setLightboxUrl: (url: string | null) => void;
  setFirstMsgDetails: (v: string) => void;
  setFirstMsgResult: (v: string) => void;
  setFirstMsgCopied: (v: boolean) => void;
  setFirstMsgOpen: (v: boolean) => void;
  setResolveIssueMessageId: (v: number | null) => void;
  setResolveIssueTitle: (v: string) => void;
  setResolveIssueNote: (v: string) => void;
  setResolveIssueNoteText: (v: string) => void;
  setResolveIssueOpen: (v: boolean) => void;
  dismissSystemCard: (messageId: number) => void;
  onScrollToBottom: () => void;
  setOpenThreadId: (id: number | null) => void;
  openThreadId: number | null;
  allThreadsOpen: boolean;
  setAllThreadsOpen: (v: boolean) => void;
  activeThreadCount: number;
  unreadThreadCount: number;
  leadRepliesOpen: boolean;
  setLeadRepliesOpen: (v: boolean) => void;
  leadReplies: Array<{ id: number; leadName: string; leadPhone: string | null; leadSource: string | null; stage: string; assignedAgentName: string | null; lastInboundAt: number; isUnread: boolean; ageMs: number }>;
  leadRepliesCount: number;
  unreadLeadRepliesCount: number;
  onSwitchToLeadOps?: (sessionId?: number) => void;
  superAlertMsgSet: Set<number>; // keep this - it was already here
  // Conversation row action buttons
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchResultIdx: number;
  setSearchResultIdx: (v: number) => void;
  searchMatchList: Array<{ id: number; body: string }>;
  navigateSearchResult: (dir: 1 | -1) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  notifMuted: boolean;
  toggleMute: () => void;
  pendingReminderCount: number;
  centerView: "chat" | "issues" | "calls";
  setCenterView: (v: "chat" | "issues" | "calls") => void;
  todayCallCount: number;
  emailUnreadCount: number;
  mentionPhoneMap: Record<string, string>;
};

// ── Collapsible Call Debrief Card ────────────────────────────────────────────
function CallDebriefCard({
  msgId, grade, wentWell, improve, nextLine, recordingUrl, callerName, callerPhone, createdAt,
}: {
  msgId: number; grade: string | null; wentWell: string | null; improve: string | null;
  nextLine: string | null; recordingUrl: string | null; callerName: string | null;
  callerPhone: string | null; createdAt: Date;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasRecording = !!recordingUrl;
  const hasDetails = !!(wentWell || improve || nextLine);
  const waveHeights = [3,5,8,12,16,20,14,18,22,16,10,14,20,24,18,12,16,20,14,8,12,18,22,16,10,6,10,14,18,12,8,5];
  const gradeColors: Record<string, string> = {
    A: "bg-emerald-500", B: "bg-blue-500", C: "bg-amber-500", D: "bg-orange-500", F: "bg-red-500",
  };
  const gradeBg = grade ? (gradeColors[grade] ?? "bg-indigo-500") : null;
  const displayName = callerName ?? callerPhone ?? "Unknown caller";

  function togglePlay(e: React.MouseEvent) {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
    else { audioRef.current.play(); setIsPlaying(true); }
  }

  return (
    <div className="flex justify-start my-1 px-1">
      <div className="w-full max-w-[520px]">
        {/* Main bubble */}
        <div
          className="rounded-2xl px-3 py-2.5 cursor-pointer select-none transition-all duration-150 bg-[#0f172a] border border-slate-700 shadow-sm hover:border-slate-600"
          onClick={() => setExpanded(v => !v)}
        >
          {/* Top row: phone icon + name + grade badge + time + chevron */}
          <div className="flex items-center gap-2 mb-2.5">
            <Phone className="h-3.5 w-3.5 text-teal-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-100 flex-1 truncate">{displayName}</span>
            {gradeBg && (
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white ${gradeBg}`}>{grade}</span>
            )}
            <span className="text-[10px] text-slate-500 tabular-nums">{fmtMsgTime(createdAt)}</span>
            {hasDetails && (
              expanded
                ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
                : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
            )}
          </div>
          {/* Audio row: play button + waveform */}
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                hasRecording ? "bg-teal-600 hover:bg-teal-700 text-white" : "bg-slate-700 text-slate-500 cursor-not-allowed"
              }`}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
            </button>
            <div className="flex items-center gap-[2px] flex-1 h-7">
              {waveHeights.map((h, wi) => (
                <div key={wi} className="rounded-full w-[3px] bg-teal-600/70" style={{ height: `${h}px` }} />
              ))}
            </div>
          </div>
          {hasRecording && (
            <audio
              ref={audioRef}
              src={recordingUrl!}
              onEnded={() => setIsPlaying(false)}
              onPause={() => setIsPlaying(false)}
              className="hidden"
            />
          )}
        </div>
        {/* Expandable debrief details */}
        {hasDetails && expanded && (
          <div className="mt-1 rounded-xl border border-slate-700 bg-[#0f172a]/80 px-3 py-2.5 animate-in slide-in-from-top-1 duration-150">
            {wentWell && (
              <div className="mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">✔ Went well</span>
                <p className="text-xs text-slate-300 leading-relaxed mt-0.5 pl-3">{wentWell}</p>
              </div>
            )}
            {improve && (
              <div className="mb-2 border-t border-slate-700 pt-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">▲ Improve</span>
                <p className="text-xs text-slate-300 leading-relaxed mt-0.5 pl-3">{improve}</p>
              </div>
            )}
            {nextLine && (
              <div className="border-t border-slate-700 pt-2">
                <p className="text-[10px] text-teal-400 font-semibold uppercase tracking-widest mb-1">Next time, say:</p>
                <p className="text-xs text-slate-200 italic leading-relaxed">"{nextLine}"</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const MessageList = memo(function MessageList({
  channelMsgs,
  channelLoading,
  callerName,
  onJumpToJob,
  reactionsByMsgId,
  commandSeenByMap,
  senderPhotoMap,
  unreadTagIds,
  highlightedCmdMsgId,
  cmdMsgRefMap,
  msgsContainerRef,
  threadScrollRef,
  threadBottomRef,
  toggleReactionMutation,
  claimLeadMutation,
  scrollToCmdMsg,
  openChatConvert,
  setReplyTo,
  setLightboxUrl,
  setFirstMsgDetails,
  setFirstMsgResult,
  setFirstMsgCopied,
  setFirstMsgOpen,
  setResolveIssueMessageId,
  setResolveIssueTitle,
  setResolveIssueNote,
  setResolveIssueNoteText,
  setResolveIssueOpen,
  dismissSystemCard,
  onScrollToBottom,
  setOpenThreadId,
  openThreadId,
  allThreadsOpen,
  setAllThreadsOpen,
  activeThreadCount,
  unreadThreadCount,
  leadRepliesOpen,
  setLeadRepliesOpen,
  leadReplies,
  leadRepliesCount,
  unreadLeadRepliesCount,
  onSwitchToLeadOps,
  superAlertMsgSet,
  searchOpen,
  openSearch,
  closeSearch,
  searchQuery,
  setSearchQuery,
  searchResultIdx,
  setSearchResultIdx,
  searchMatchList,
  navigateSearchResult,
  searchInputRef,
  notifMuted,
  toggleMute,
  pendingReminderCount,
  centerView,
  setCenterView,
  todayCallCount,
  emailUnreadCount,
  mentionPhoneMap,
}: MessageListProps) {
  return (
    <>
        <div ref={threadScrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-4 scrollbar-thin scrollbar-thumb-slate-200" onScroll={(e) => { const el = e.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 250) onScrollToBottom(); }}>
          <div className="flex items-center justify-between mb-4">
            {searchOpen ? (
              <div className="flex items-center gap-1.5 flex-1 min-w-0 animate-in slide-in-from-left-2 duration-200">
                <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setSearchResultIdx(0); }}
                  onKeyDown={e => {
                    if (e.key === "Escape") closeSearch();
                    if (e.key === "Enter") navigateSearchResult(e.shiftKey ? -1 : 1);
                  }}
                  placeholder="Search messages…"
                  className="flex-1 min-w-0 text-sm bg-transparent outline-none text-slate-800 placeholder:text-slate-400"
                />
                {searchQuery && searchMatchList.length > 0 && (
                  <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">
                    {searchResultIdx + 1}/{searchMatchList.length}
                  </span>
                )}
                {searchQuery && searchMatchList.length === 0 && (
                  <span className="text-[10px] text-slate-400 shrink-0">No results</span>
                )}
                {searchQuery && searchMatchList.length > 0 && (
                  <>
                    <button onClick={() => navigateSearchResult(-1)} className="h-5 w-5 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500" title="Previous (Shift+Enter)">
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <button onClick={() => navigateSearchResult(1)} className="h-5 w-5 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500" title="Next (Enter)">
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </>
                )}
                <button onClick={closeSearch} className="h-5 w-5 flex items-center justify-center rounded hover:bg-slate-100 text-slate-400 shrink-0" title="Close (Esc)">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">Conversation</p>
            )}
            <div className="flex items-center gap-1">
              {!searchOpen && pendingReminderCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-semibold bg-sky-50 text-sky-600 border border-sky-200 rounded-full px-2 py-0.5 mr-1">
                  <Bell className="h-3 w-3" />{pendingReminderCount} reminder{pendingReminderCount !== 1 ? "s" : ""} set
                </span>
              )}
              {!searchOpen && (
                <button onClick={openSearch} title="Search messages" className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors">
                  <Search className="h-3.5 w-3.5 text-slate-400" />
                </button>
              )}
              <button onClick={toggleMute} title={notifMuted ? "Unmute notifications" : "Mute notifications"} className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors">
                {notifMuted ? <BellOff className="h-3.5 w-3.5 text-slate-400" /> : <Bell className="h-3.5 w-3.5 text-slate-400" />}
              </button>
              <button
                title="Threads"
                onClick={() => setAllThreadsOpen(true)}
                className={cn(
                  "relative h-7 w-7 flex items-center justify-center rounded-full transition-colors",
                  allThreadsOpen ? "bg-violet-50 text-violet-600" : "hover:bg-slate-100 text-slate-400"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {activeThreadCount > 0 && (
                  <span className={cn(
                    "absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full text-white text-[9px] font-bold flex items-center justify-center leading-none ring-1 ring-white",
                    unreadThreadCount > 0 ? "bg-blue-500 animate-pulse" : "bg-slate-400"
                  )}>
                    {unreadThreadCount > 0 ? (unreadThreadCount > 9 ? "9+" : unreadThreadCount) : activeThreadCount}
                  </span>
                )}
              </button>
              <button
                title="Lead Replies"
                onClick={() => setLeadRepliesOpen(!leadRepliesOpen)}
                className={cn(
                  "relative h-7 w-7 flex items-center justify-center rounded-full transition-colors",
                  leadRepliesOpen ? "bg-emerald-50 text-emerald-600" : "hover:bg-slate-100 text-slate-400"
                )}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span className={cn(
                    "absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full text-white text-[9px] font-bold flex items-center justify-center leading-none ring-1 ring-white",
                    unreadLeadRepliesCount > 0 ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                  )}>
                    {unreadLeadRepliesCount > 0 ? (unreadLeadRepliesCount > 9 ? "9+" : unreadLeadRepliesCount) : leadRepliesCount}
                  </span>
              </button>
              <button
                title="AI Call Log"
                onClick={() => setCenterView(centerView === "calls" ? "chat" : "calls")}
                className={cn(
                  "relative h-7 w-7 flex items-center justify-center rounded-full transition-colors",
                  centerView === "calls" ? "bg-orange-50 text-orange-600" : "hover:bg-slate-100 text-slate-400"
                )}
              >
                <PhoneIncoming className="h-3.5 w-3.5" />
                {todayCallCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-orange-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
                    {todayCallCount > 9 ? "9+" : todayCallCount}
                  </span>
                )}
              </button>
            </div>
          </div>
          <div ref={msgsContainerRef} className="space-y-4" style={{ paddingBottom: '8px' }}>
            {channelLoading ? (
              <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
            ) : channelMsgs.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No messages yet. Start the conversation.</p>
            ) : (
              channelMsgs.map((msg) => {
                const isMine = msg.from === callerName;
                const isAlert = msg.role === "alert" || msg.role === "system";
                const isSuperAlert = superAlertMsgSet.has(msg.id);
                const isReview = msg.quickAction === "review_confirmed";
                const isCallSummary = msg.quickAction === "call_summary";
                // Parse mediaUrl — may be a JSON array of URLs or a single URL
                let mediaUrls: string[] = [];
                if (msg.mediaUrl && !isCallSummary) {
                  try { mediaUrls = JSON.parse(msg.mediaUrl); } catch { mediaUrls = [msg.mediaUrl]; }
                }

                // ── Review card (warm gold) ──────────────────────────────────────
                if (isReview) {
                  const lines = msg.body.split("\n").filter(Boolean);
                  const mainLine = lines[0] ?? "";
                  const dateLine = lines[1] ?? "";
                  const cleanMain = mainLine.replace(/\*\*/g, "").replace(/^⭐\s*/, "");
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[72%] rounded-xl overflow-hidden border border-amber-100 shadow-sm">
                        {/* Header band */}
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-b border-amber-100">
                          <span className="text-sm">⭐</span>
                          <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-widest">Review Received</span>
                          <span className="ml-auto text-[10px] text-amber-400">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        {/* Body */}
                        <div className="px-3 py-2.5 bg-white">
                          <p className="text-sm font-medium text-slate-800 leading-snug">{cleanMain}</p>
                          {dateLine && (
                            <p className="text-xs text-slate-400 mt-1">{dateLine.replace(/^📅\s*/, "📅 ")}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // Call summary — hidden per user request
                if (isCallSummary) return null;

                // ── Rating Alert card (compact dark) ─────────────────────────────
                if (msg.from === "⭐ Rating Alert" || msg.from?.includes("Rating Alert")) {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const rating = (meta.rating as number) ?? 0;
                  const starsStr = "★".repeat(rating) + "☆".repeat(5 - rating);
                  const ratingLabel = rating >= 5 ? "5-star" : rating >= 4 ? "4-star" : rating >= 3 ? "3-star" : rating >= 2 ? "2-star" : "1-star";
                  const link = (meta.link as string) ?? null;
                  const lines = msg.body.split("\n").filter(Boolean);
                  const customerLine = lines.find(l => l.startsWith("👤"))?.replace(/^👤 Customer: /, "") ?? "";
                  const jobLine = lines.find(l => l.startsWith("📍"))?.replace(/^📍 Job: /, "") ?? "";
                  const commentLine = lines.find(l => l.startsWith("💬"))?.replace(/^💬 Comment: /, "") ?? null;
                  const ratingColor = rating >= 4 ? "text-yellow-400" : rating === 3 ? "text-amber-400" : "text-red-400";
                  return (
                    <div key={msg.id} className="flex justify-start my-1 px-1">
                      <div className="rounded-xl overflow-hidden" style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", maxWidth: "480px" }}>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                          <span className="text-[10px] text-slate-400 font-medium">★ Rating Alert · Dispatch</span>
                          <span className="ml-auto text-[10px] text-slate-500">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2">
                          <p className={"text-sm font-bold leading-snug " + ratingColor}>{ratingLabel} {starsStr}</p>
                          <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                            {customerLine}{jobLine ? " | " + jobLine : ""}
                          </p>
                          {commentLine && <p className="text-xs text-slate-500 mt-0.5 italic">{commentLine}</p>}
                          {link && (
                            <a href={link} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:underline mt-1 inline-block">
                              View in Quality Dashboard →
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── Customer SMS Reply card (compact dark) ────────────────────────
                if (msg.from === "📱 Customer SMS Reply" || msg.from?.includes("Customer SMS Reply")) {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const intent = (meta.intent as string) ?? "unclear";
                  const isCancellation = intent === "cancellation";
                  // Parse body: line 0 = title line, line 1 = "Customer replied...", line 2 = quoted text, line 3 = action line
                  const lines = msg.body.split("\n").filter(Boolean);
                  const titleLine = lines[0]?.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]\s*/u, "").replace(/\*\*/g, "") ?? "";
                  const quotedLine = lines.find(l => l.startsWith(">"))?.replace(/^>\s*"?/, "").replace(/"$/, "") ?? "";
                  const intentColor = isCancellation ? "text-red-400" : "text-amber-400";
                  const intentLabel = isCancellation ? "🚨 Cancellation" : "❓ Unclear Reply";
                  return (
                    <div key={msg.id} className="flex justify-start my-1 px-1">
                      <div className="rounded-xl overflow-hidden" style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", maxWidth: "480px" }}>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                          <span className="text-[10px] text-slate-400 font-medium">📱 Customer SMS Reply · Dispatch</span>
                          <span className="ml-auto text-[10px] text-slate-500">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2">
                          <p className={"text-sm font-bold leading-snug " + intentColor}>{intentLabel}</p>
                          <p className="text-xs text-slate-300 font-medium mt-0.5 leading-snug">{titleLine}</p>
                          {quotedLine && (
                            <p className="text-xs text-slate-400 mt-1 leading-snug italic border-l-2 border-slate-600 pl-2">
                              "{quotedLine}"
                            </p>
                          )}
                          <p className="text-[10px] text-slate-500 mt-1.5">Review in Confirmation Calls page</p>
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── New Lead card — hidden per user request (side cards handle this now)
                if (msg.quickAction === "new_lead") return null;
                if (false && msg.quickAction === "new_lead") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const leadName = (meta.leadName as string) ?? msg.from;
                  const leadPhone = (meta.leadPhone as string) ?? "";
                  const serviceType = (meta.serviceType as string) ?? "";
                  const size = (meta.size as string) ?? "";
                  const price = (meta.price as number | string) ?? "";
                  const extrasRaw = meta.extras ?? [];
                  const extras: string[] = Array.isArray(extrasRaw)
                    ? (extrasRaw as string[])
                    : typeof extrasRaw === "string"
                      ? (() => { try { const p = JSON.parse(extrasRaw); return Array.isArray(p) ? p : [extrasRaw]; } catch { return extrasRaw ? [extrasRaw] : []; } })()
                      : [];
                  const utmSource = (meta.utmSource as string | null) ?? null;
                  const sessionId = (meta.sessionId as number | null) ?? null;
                  const arrivedAt = (meta.arrivedAt as number) ?? msg.createdAt.getTime();
                  const claimedBy = (meta.claimedBy as string | null) ?? null;
                  const claimedAt = (meta.claimedAt as number | null) ?? null;

                  const isThumbSms = utmSource === "thumbtack-sms";
                  // Build written-out headline
                  const sourceLabel = utmSource
                    ? utmSource.toLowerCase() === "widget" || utmSource.toLowerCase() === "widget form"
                      ? "Widget Form"
                      : utmSource.toLowerCase() === "google"
                        ? "Google"
                        : utmSource.toLowerCase() === "yelp"
                          ? "Yelp"
                          : utmSource
                    : null;
                  const headlineParts: string[] = [];
                  if (size) headlineParts.push(size);
                  if (serviceType) headlineParts.push(serviceType);
                  const headline = sourceLabel
                    ? `New Lead Alert: ${sourceLabel}`
                    : headlineParts.length > 0
                      ? headlineParts.join(" / ")
                      : "New Lead";
                  const detailLine = headlineParts.length > 0 ? headlineParts.join(" / ") : "";
                  const subParts = [
                    price ? `Quoted at $${price}` : null,
                    claimedBy ? `Claimed by ${claimedBy}` : "no one has claimed yet",
                  ].filter(Boolean);
                  return (
                    <div key={msg.id} className="w-full">
                      <div className={cn(
                        "w-full rounded-2xl px-5 py-4",
                        isThumbSms ? "bg-sky-50" : "bg-[#f0fdf4]"
                      )}>
                        {/* Top row: name + time inline */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs text-slate-500">{leadName}</span>
                          {leadPhone && <span className="text-xs text-slate-400">· {leadPhone}</span>}
                          <div className="flex-1" />
                          <span className="text-xs text-slate-400 shrink-0">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        {/* Headline: written-out, bold, full width */}
                        <p className="text-lg font-bold text-slate-900 leading-snug mb-1 w-full">
                          {headline}
                        </p>
                        {/* Detail line: size / service if source-based headline */}
                        {sourceLabel && detailLine && (
                          <p className="text-sm text-slate-600 mb-1">{detailLine}</p>
                        )}
                        {/* Subtext: price + claim status */}
                        <p className="text-sm text-slate-500 mb-3">{subParts.join(" · ")}</p>
                        {/* Action icons row */}
                        <div className="flex items-center gap-3">
                          {leadPhone && (
                            <a
                              href={`openphone://call?to=${leadPhone}`}
                              title={`Call ${leadName}`}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/80 hover:bg-white text-slate-600 hover:text-slate-900 transition-colors shrink-0 shadow-sm"
                            >
                              <Phone className="h-4 w-4" />
                            </a>
                          )}
                          {sessionId && (
                            <a
                              href={`/admin/leads?session=${sessionId}&tab=sms`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open SMS conversation"
                              className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-emerald-100 hover:bg-emerald-200 text-emerald-700 hover:text-emerald-900 transition-colors shrink-0 shadow-sm"
                            >
                              <MessageCircle className="h-4 w-4" />
                            </a>
                          )}
                          <a
                            href="https://maidsquotes-b55s3sg4.manus.space/"
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open quote generator"
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 transition-colors shrink-0 shadow-sm text-xs font-semibold"
                          >
                            <Calculator className="h-3.5 w-3.5" /> Quote
                          </a>
                          <button
                            title="Generate first outreach message for this lead"
                            onClick={() => {
                              const parts: string[] = [];
                              if (leadName)    parts.push(`Name: ${leadName}`);
                              if (leadPhone)   parts.push(`Phone: ${leadPhone}`);
                              if (serviceType) parts.push(`Service: ${serviceType}`);
                              if (size)        parts.push(`Home size: ${size}`);
                              if (price)       parts.push(`Estimated price: $${price}`);
                              if (extras.length > 0) parts.push(`Extras: ${extras.join(", ")}`);
                              setFirstMsgDetails(parts.join("\n"));
                              setFirstMsgResult("");
                              setFirstMsgCopied(false);
                              setFirstMsgOpen(true);
                            }}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-violet-100 hover:bg-violet-200 text-violet-700 hover:text-violet-900 transition-colors shrink-0 shadow-sm"
                          >
                            <Wand2 className="h-4 w-4" />
                          </button>
                          <div className="flex-1" />
                          {claimedBy ? (
                            <div className="flex items-center gap-1 text-xs text-emerald-700 font-semibold">
                              <UserCheck className="h-3.5 w-3.5" />
                              <span>Claimed by {claimedBy}</span>
                              {claimedAt && (
                                <span className="text-slate-400 font-normal ml-1">at {new Date(claimedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })}</span>
                              )}
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              className="h-8 text-xs bg-emerald-700 hover:bg-emerald-800 text-white rounded-full px-4"
                              disabled={claimLeadMutation.isPending}
                              onClick={() => claimLeadMutation.mutate({ messageId: msg.id, sessionId: sessionId ?? undefined })}
                            >
                              {claimLeadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Claim"}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── Issue Engine Created card ─────────────────────────────────
                if (msg.quickAction === "issue_engine_created") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const ieTitle = (meta.issueTitle as string) ?? msg.body;
                  const ieNotes = (meta.notes as string | null) ?? null;
                  const ieTypeLabel = (meta.typeLabel as string) ?? "Issue";
                  const ieSeverity = (meta.severity as string) ?? "medium";
                  const sevColorMap: Record<string, string> = {
                    critical: "text-red-600", high: "text-orange-500",
                    medium: "text-amber-500", low: "text-slate-400",
                  };
                  const sevColor = sevColorMap[ieSeverity] ?? "text-amber-500";
                  return (
                    <div key={msg.id} className="flex justify-center my-3 px-4">
                      <div
                        className="w-full max-w-[560px] rounded-2xl overflow-hidden"
                        style={{
                          background: "linear-gradient(135deg, #fffbf0 0%, #fef6e4 100%)",
                          border: "1.5px solid #fde8b0",
                          boxShadow: "0 0 0 5px rgba(253,212,80,0.13), 0 6px 28px rgba(251,146,60,0.16)",
                        }}
                      >
                        {/* Beige header row */}
                        <div className="flex items-center gap-2 px-5 py-3.5">
                          <span className="text-lg">🔥</span>
                          <span className="text-sm font-black text-orange-600 uppercase tracking-widest">Issue Created</span>
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-sm font-semibold text-orange-500">{ieTypeLabel}</span>
                            <span className={`text-sm font-bold ${sevColor}`}>{ieSeverity.charAt(0).toUpperCase() + ieSeverity.slice(1)}</span>
                          </div>
                        </div>
                        {/* White body section */}
                        <div className="mx-3 mb-3 rounded-xl bg-white px-5 py-4" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                          <p className="text-[15px] font-bold text-slate-900 mb-1">{ieTitle}</p>
                          {ieNotes && <p className="text-sm text-slate-500 leading-relaxed mb-3">{ieNotes}</p>}
                          {!ieNotes && <p className="text-sm text-slate-400 leading-relaxed mb-3">This issue will stay pinned until closed.</p>}
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => {
                                const ieId = (meta.issueId as number | null) ?? null;
                                setIssueEngineInitialId(ieId);
                                setIssueEngineOverlayOpen(true);
                              }}
                              className="px-5 py-2 rounded-full bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 transition"
                            >
                              View Issue
                            </button>
                            <span className="text-xs text-slate-400">Created by {msg.from} · {fmtMsgTime(msg.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── General Issue card (red) ─────────────────────────────────────
                if (msg.quickAction === "general_issue") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const issTitle = (meta.issueTitle as string) ?? msg.body;
                  const issNote = (meta.issueNote as string | null) ?? null;
                  const jobTitle = (meta.jobTitle as string | null) ?? null;
                  const isResolved = !!(meta.resolvedAt);
                  return (
                    <div key={msg.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
                      <div className={cn("max-w-[72%] rounded-xl overflow-hidden border shadow-sm", isResolved ? "border-slate-200 opacity-60" : "border-red-200")}>
                        <div className={cn("flex items-center gap-1.5 px-3 py-1.5", isResolved ? "bg-slate-400" : "bg-red-600")}>
                          <TriangleAlert className="h-3 w-3 text-red-100" />
                          <span className="text-[10px] font-semibold text-red-100 uppercase tracking-widest">{isResolved ? "Issue (Resolved)" : "Issue Raised"}</span>
                          {jobTitle && <span className="ml-1.5 text-[10px] bg-red-700 text-red-200 rounded-full px-2 py-0.5">{jobTitle}</span>}
                          <span className="ml-auto text-[10px] text-red-300">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2.5 bg-white">
                          <p className="text-sm font-semibold text-slate-900">{issTitle}</p>
                          {issNote && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{issNote}</p>}
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-[10px] text-slate-400">Raised by {msg.from}</p>
                            {!isResolved && (
                              <button
                                onClick={() => {
                                  setResolveIssueMessageId(msg.id);
                                  setResolveIssueTitle(issTitle);
                                  setResolveIssueNote(issNote ?? "");
                                  setResolveIssueNoteText("");
                                  setResolveIssueOpen(true);
                                }}
                                className="text-[10px] font-semibold text-green-600 hover:text-green-800 flex items-center gap-0.5"
                              >
                                <CheckCheck className="h-3 w-3" /> Resolve
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── Reminder card (sky blue) ─────────────────────────────────────
                if (msg.quickAction === "reminder") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const remBody = (meta.reminderBody as string) ?? msg.body;
                  const setBy = (meta.setBy as string) ?? msg.from;
                  return (
                    <div key={msg.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
                      <div className="max-w-[72%] rounded-xl overflow-hidden border border-sky-200 shadow-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600">
                          <Bell className="h-3 w-3 text-sky-100" />
                          <span className="text-[10px] font-semibold text-sky-100 uppercase tracking-widest">Reminder</span>
                          <span className="ml-auto text-[10px] text-sky-300">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2.5 bg-white">
                          <p className="text-sm font-medium text-slate-800">{remBody}</p>
                          <p className="text-[10px] text-slate-400 mt-1.5">Set by {setBy}</p>
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── Announce Booking card (celebratory) ──────────────────────────
                if (msg.quickAction === "announce_booking") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const personName = (meta.personName as string) ?? "";
                  const amount = (meta.amount as string | null) ?? null;
                  const note = (meta.note as string | null) ?? null;
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[80%] rounded-xl overflow-hidden border border-violet-200 shadow-md" style={{ background: "linear-gradient(135deg, #fdf4ff 0%, #f5f3ff 50%, #ede9fe 100%)" }}>
                        {/* Confetti header with burst animation */}
                        <div className="relative flex items-center gap-2 px-4 py-2 overflow-hidden" style={{ background: "linear-gradient(90deg, #7c3aed, #a855f7, #ec4899)" }}>
                          {/* Glitter confetti particles — burst outward then fade */}
                          {[...Array(18)].map((_, i) => {
                            const angle = (i / 18) * 360;
                            const dist = 30 + (i % 3) * 20;
                            const tx = Math.cos((angle * Math.PI) / 180) * dist;
                            const ty = Math.sin((angle * Math.PI) / 180) * dist;
                            const colors = ["#fbbf24","#34d399","#f472b6","#60a5fa","#fb923c","#a3e635","#fff","#e879f9"];
                            const size = 3 + (i % 4);
                            return (
                              <span
                                key={i}
                                className="absolute rounded-full pointer-events-none"
                                style={{
                                  width: `${size}px`,
                                  height: `${size}px`,
                                  background: colors[i % colors.length],
                                  left: "50%",
                                  top: "50%",
                                  transform: "translate(-50%,-50%)",
                                  animation: `confetti-burst-${i % 3} ${0.6 + (i % 3) * 0.2}s ease-out ${(i * 0.04)}s both`,
                                  "--tx": `${tx}px`,
                                  "--ty": `${ty}px`,
                                } as React.CSSProperties}
                              />
                            );
                          })}
                          <PartyPopper className="h-4 w-4 text-white relative z-10" />
                          <span className="text-[10px] font-bold text-white uppercase tracking-widest relative z-10">🎉 New Booking!</span>
                          <span className="ml-auto text-[10px] text-purple-200 relative z-10">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        {/* Body */}
                        <div className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center text-white font-bold text-base shrink-0">
                              {(msg.from ?? "?").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-base font-bold text-slate-900">Congrats to {msg.from}!</p>
                              {amount && <p className="text-sm font-semibold text-violet-700 mt-0.5">{amount}</p>}
                              {personName && <p className="text-xs text-slate-500 mt-0.5">Client: {personName}</p>}
                            </div>
                          </div>
                          {note && <p className="text-xs text-slate-500 mt-2 leading-relaxed">{note}</p>}
                          <p className="text-[10px] text-slate-400 mt-2">Announced by {msg.from}</p>
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── New Application (Hiring) card ─────────────────────────────────
                if (msg.quickAction === "new_application") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const appName = (meta.applicantName as string) ?? "New Applicant";
                  const appPhone = (meta.applicantPhone as string | null) ?? null;
                  const appPosition = (meta.position as string | null) ?? null;
                  const appPhoto = (meta.photoUrl as string | null) ?? null;
                  const candidateId = (meta.candidateId as number | null) ?? null;
                  const initials = appName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[72%] rounded-xl overflow-hidden border border-amber-200 shadow-sm">
                        {/* Header */}
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-700">
                          <UserPlus className="h-3 w-3 text-amber-200" />
                          <span className="text-[10px] font-semibold text-amber-100 uppercase tracking-widest">New Application</span>
                          <span className="ml-auto text-[10px] text-amber-300">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        {/* Body */}
                        <div className="px-3 py-2.5 bg-white">
                          <div className="flex items-center gap-3">
                            {/* Photo or initials avatar */}
                            {appPhoto ? (
                              <img src={appPhoto} alt={appName} className="h-10 w-10 rounded-full object-cover shrink-0 border border-amber-100" />
                            ) : (
                              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-400 flex items-center justify-center text-white font-bold text-sm shrink-0">
                                {initials}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-base font-bold text-slate-900 leading-tight">{appName}</p>
                              {appPhone && <p className="text-xs text-slate-400 mt-0.5">{appPhone}</p>}
                              {appPosition && <p className="text-xs text-amber-700 font-medium mt-0.5">{appPosition}</p>}
                            </div>
                          </div>
                          {/* Action row */}
                          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-100">
                            <a
                              href="/admin/hiring"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-full transition-colors"
                            >
                              <Briefcase className="h-3.5 w-3.5" />
                              View in Hiring
                            </a>

                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── Away Status card ──────────────────────────────────────────────
                if (msg.quickAction?.startsWith("away_status:")) {
                  const statusKey = msg.quickAction.split(":")[1];
                  const STATUS_MAP: Record<string, { label: string; sub: string; emoji: string; accent: string; bg: string; border: string; headerBg: string }> = {
                    away_sec: { label: "Away for a sec",  sub: "Quick break",         emoji: "☕", accent: "#92400e", bg: "#fffbeb", border: "#fde68a", headerBg: "linear-gradient(90deg,#f59e0b,#fbbf24)" },
                    lunch:    { label: "Lunch break",     sub: "Quick munch",         emoji: "🍔", accent: "#065f46", bg: "#ecfdf5", border: "#a7f3d0", headerBg: "linear-gradient(90deg,#10b981,#34d399)" },
                    back15:   { label: "Back in 15",      sub: "Short defined break", emoji: "⏰", accent: "#3730a3", bg: "#eef2ff", border: "#c7d2fe", headerBg: "linear-gradient(90deg,#6366f1,#818cf8)" },
                    eod:      { label: "Signing off",     sub: "End of day",          emoji: "🌙", accent: "#0c4a6e", bg: "#f0f9ff", border: "#bae6fd", headerBg: "linear-gradient(90deg,#0ea5e9,#38bdf8)" },
                  };
                  const s = STATUS_MAP[statusKey] ?? { label: msg.body, sub: "", emoji: "💬", accent: "#334155", bg: "#f8fafc", border: "#e2e8f0", headerBg: "#334155" };
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[72%] rounded-2xl overflow-hidden shadow-md" style={{ border: `1px solid ${s.border}`, background: s.bg }}>
                        {/* Coloured header strip */}
                        <div className="flex items-center gap-2 px-4 py-2" style={{ background: s.headerBg }}>
                          <span className="text-lg leading-none">{s.emoji}</span>
                          <span className="text-[11px] font-bold text-white uppercase tracking-widest">{s.label}</span>
                          <span className="ml-auto text-[10px] text-white/70">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        {/* Body */}
                        <div className="px-4 py-3 flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                            style={{ background: s.headerBg }}>
                            {(msg.from ?? "?").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold" style={{ color: s.accent }}>{msg.from}</p>
                            <p className="text-xs text-slate-500">{s.sub}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── Issue Resolved card (green) ───────────────────────────────────
                if (msg.quickAction === "issue_resolved") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const issTitle = (meta.issueTitle as string) ?? "Issue";
                  const issNote = (meta.issueNote as string | null) ?? null;
                  const jobTitle = (meta.jobTitle as string | null) ?? null;
                  const resNote = (meta.resolutionNote as string | null) ?? null;
                  const resolvedBy = (meta.resolvedBy as string) ?? msg.from;
                  return (
                    <div key={msg.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
                      <div className="max-w-[72%] rounded-xl overflow-hidden border border-emerald-200 shadow-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600">
                          <CheckCheck className="h-3 w-3 text-emerald-100" />
                          <span className="text-[10px] font-semibold text-emerald-100 uppercase tracking-widest">✅ Issue Resolved</span>
                          {jobTitle && <span className="ml-1.5 text-[10px] bg-emerald-700 text-emerald-200 rounded-full px-2 py-0.5">{jobTitle}</span>}
                          <span className="ml-auto text-[10px] text-emerald-300">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2.5 bg-white">
                          {/* Original issue context */}
                          <div className="rounded-lg bg-red-50 border border-red-100 px-2.5 py-1.5 mb-2">
                            <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-0.5">Original Issue</p>
                            <p className="text-xs text-slate-700 font-medium">{issTitle}</p>
                            {issNote && <p className="text-xs text-slate-500 mt-0.5">{issNote}</p>}
                          </div>
                          {/* Resolution note */}
                          {resNote && (
                            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1.5 mb-2">
                              <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide mb-0.5">Resolution</p>
                              <p className="text-xs text-slate-700">{resNote}</p>
                            </div>
                          )}
                          <p className="text-[10px] text-slate-400">Resolved by {resolvedBy}</p>
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── Follow-up Created card (violet) ─────────────────────────────
                if (msg.quickAction === "follow_up_created") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const fuName = (meta.name as string) ?? msg.body;
                  const fuType = (meta.type as string) ?? "";
                  const fuOwner = (meta.owner as string) ?? msg.from;
                  const fuPriority = (meta.priority as string) ?? "Normal";
                  const fuNextStep = (meta.nextStep as string) ?? "";
                  const fuDueLabel = (meta.dueLabel as string) ?? "";
                  const fuNote = (meta.internalNote as string | null) ?? null;
                  const priorityColor: Record<string, string> = {
                    High: "text-red-600 bg-red-50 border-red-200",
                    Normal: "text-amber-600 bg-amber-50 border-amber-200",
                    Low: "text-slate-500 bg-slate-50 border-slate-200",
                  };
                  const pClass = priorityColor[fuPriority] ?? priorityColor["Normal"];
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[72%] rounded-xl overflow-hidden border border-violet-200 shadow-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600">
                          <ClipboardList className="h-3 w-3 text-violet-100" />
                          <span className="text-[10px] font-semibold text-violet-100 uppercase tracking-widest">Follow-up Created</span>
                          {fuType && <span className="ml-1.5 text-[10px] bg-violet-700 text-violet-200 rounded-full px-2 py-0.5">{fuType}</span>}
                          <span className="ml-auto text-[10px] text-violet-300">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2.5 bg-white">
                          <p className="text-sm font-semibold text-slate-900">{fuName}</p>
                          {fuNextStep && <p className="text-xs text-slate-600 mt-0.5">{fuNextStep}</p>}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {fuDueLabel && (
                              <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                                <Clock className="h-3 w-3" /> {fuDueLabel}
                              </span>
                            )}
                            <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${pClass}`}>{fuPriority}</span>
                          </div>
                          {fuNote && <p className="text-xs text-slate-400 mt-1.5 italic">{fuNote}</p>}
                          <p className="text-[10px] text-slate-400 mt-2">Assigned to {fuOwner}</p>
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── Call Started card ────────────────────────────────────────────────────────
                if (msg.quickAction === "call_started") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const agentName = (meta.agentName as string) ?? msg.from;
                  const direction = (meta.direction as string) ?? "incoming";
                  const dirLabel = direction === "outgoing" ? "outbound" : "inbound";
                  const callerLabel = (meta.callerLabel as string | null) ?? null;
                  return (
                    <div key={msg.id} className="flex justify-center my-1">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-200 bg-emerald-50 shadow-sm">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        <PhoneCall className="h-3 w-3 text-emerald-600 shrink-0" />
                        <span className="text-xs font-medium text-emerald-800">
                          {agentName} {dirLabel === "outbound" ? "called" : "answered"}{callerLabel ? <> <span className="font-semibold">{callerLabel}</span></> : ""}
                        </span>
                        <span className="text-[10px] text-emerald-400">{fmtMsgTime(msg.createdAt)}</span>
                      </div>
                    </div>
                  );
                }
                // ── Call Ended card ──────────────────────────────────────────────────────────
                if (msg.quickAction === "call_ended") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const agentName = (meta.agentName as string) ?? msg.from;
                  const durationLabel = (meta.durationLabel as string | null) ?? null;
                  const direction = (meta.direction as string) ?? "incoming";
                  const dirLabel = direction === "outgoing" ? "outbound" : "inbound";
                  // callerLabel not stored in call_ended metadata; look up from call_started if needed
                  return (
                    <div key={msg.id} className="flex justify-center my-1">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 shadow-sm">
                        <PhoneOff className="h-3 w-3 text-slate-400 shrink-0" />
                        <span className="text-xs text-slate-600">
                          {agentName} ended {dirLabel} call{durationLabel ? <> &middot; <span className="font-medium">{durationLabel}</span></> : ""}
                        </span>
                        <span className="text-[10px] text-slate-400">{fmtMsgTime(msg.createdAt)}</span>
                      </div>
                    </div>
                  );
                }
                // ── Missed Call card ─────────────────────────────────────────────────────
                if (msg.quickAction === "missed_call") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const callerPhone = (meta.callerPhone as string) ?? "";
                  const phoneNumberLabel = (meta.phoneNumberLabel as string) ?? "";
                  return (
                    <div key={msg.id} className="flex justify-center my-1">
                      <a
                        href="/admin/missed-calls"
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-red-200 bg-red-50 shadow-sm hover:bg-red-100 transition-colors cursor-pointer"
                      >
                        <PhoneMissed className="h-3 w-3 text-red-500 shrink-0" />
                        <span className="text-xs text-red-700 font-medium">
                          Missed call · {callerPhone}{phoneNumberLabel ? <> &middot; {phoneNumberLabel}</> : ""}
                        </span>
                        <span className="text-[10px] text-red-400">{fmtMsgTime(msg.createdAt)}</span>
                      </a>
                    </div>
                  );
                }
                // ── Call Debrief card ────────────────────────────────────────────────────
                if (msg.quickAction === "call_debrief") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const grade = (meta.grade as string | null) ?? null;
                  const wentWell = (meta.wentWell as string | null) ?? null;
                  const improve = (meta.improve as string | null) ?? null;
                  const nextLine = (meta.nextLine as string | null) ?? null;
                  const recordingUrl = (meta.recordingUrl as string | null) ?? null;
                  const callerName = (meta.callerName as string | null) ?? null;
                  const callerPhone = (meta.callerPhone as string | null) ?? null;
                  return (
                    <CallDebriefCard
                      key={msg.id}
                      msgId={msg.id}
                      grade={grade}
                      wentWell={wentWell}
                      improve={improve}
                      nextLine={nextLine}
                      recordingUrl={recordingUrl}
                      callerName={callerName}
                      callerPhone={callerPhone}
                      createdAt={msg.createdAt}
                    />
                  );
                }
                // ── Stale ETA alert card (amber) ──────────────────────────────────
                if (msg.quickAction === "stale_eta") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const cleanerName = (meta.cleanerName as string) ?? msg.from ?? "Team";
                  const customerName = (meta.customerName as string | null) ?? null;
                  const etaStr = (meta.etaStr as string | null) ?? null;
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[72%] rounded-xl overflow-hidden border border-amber-300 shadow-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500">
                          <TriangleAlert className="h-3 w-3 text-amber-100" />
                          <span className="text-[10px] font-semibold text-amber-100 uppercase tracking-widest">ETA Passed</span>
                          <span className="ml-auto text-[10px] text-amber-200">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2.5 bg-amber-50">
                          <p className="text-sm font-semibold text-slate-900">{cleanerName} — still on the way</p>
                          {customerName && <p className="text-xs text-slate-500 mt-0.5">For {customerName}</p>}
                          {etaStr && <p className="text-xs text-amber-700 mt-0.5">ETA was {etaStr}</p>}
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── Sync watchdog alert card (amber, dismissible) ─────────────────
                // ── Sync watchdog — hidden per user request
                if (msg.quickAction === "sync_watchdog") return null;
                if (false && msg.quickAction === "sync_watchdog") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const minutesSince = (meta.minutesSince as number | null) ?? null;
                  const lastSyncStr = (meta.lastSyncStr as string | null) ?? null;
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[80%] rounded-xl overflow-hidden border border-amber-400 shadow-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500">
                          <RefreshCw className="h-3 w-3 text-amber-100" />
                          <span className="text-[10px] font-semibold text-amber-100 uppercase tracking-widest">Sync Alert</span>
                          <span className="ml-auto text-[10px] text-amber-200">{fmtMsgTime(msg.createdAt)}</span>
                          <button
                            className="ml-1 text-amber-200 hover:text-white transition-colors"
                            title="Dismiss"
                            onClick={() => {
                              dismissSystemCard(msg.id);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="px-3 py-2.5 bg-amber-50">
                          <p className="text-sm font-semibold text-slate-900">
                            Schedule sync overdue{minutesSince ? ` — ${minutesSince} min since last sync` : ""}
                          </p>
                          {lastSyncStr && (
                            <p className="text-xs text-amber-700 mt-0.5">Last sync: {lastSyncStr}</p>
                          )}
                          <p className="text-xs text-slate-500 mt-1">
                            Jobs added to Launch27 since the last sync may be missing from Field Management.
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── Sync mismatch card (red, dismissible) ─────────────────────────
                if (msg.quickAction === "sync_mismatch") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const date = (meta.date as string | null) ?? "";
                  const l27Count = (meta.l27Count as number | null) ?? 0;
                  const dbCount = (meta.dbCount as number | null) ?? 0;
                  const missingJobs = (meta.missingJobs as Array<{ id: number; name: string; status: string }> | null) ?? [];
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[85%] rounded-xl overflow-hidden border border-red-400 shadow-sm">
                        {/* Header */}
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600">
                          <AlertTriangle className="h-3 w-3 text-red-100" />
                          <span className="text-[10px] font-semibold text-red-100 uppercase tracking-widest">Sync Mismatch</span>
                          <span className="ml-auto text-[10px] text-red-200">{fmtMsgTime(msg.createdAt)}</span>
                          <button
                            className="ml-1 text-red-200 hover:text-white transition-colors"
                            title="Dismiss"
                            onClick={() => dismissSystemCard(msg.id)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        {/* Body */}
                        <div className="px-3 py-2.5 bg-red-50">
                          <p className="text-sm font-semibold text-slate-900">
                            {date} — Launch27 has {l27Count} job{l27Count !== 1 ? "s" : ""}, LeadFlow has {dbCount}
                          </p>
                          <p className="text-xs text-red-700 mt-0.5">
                            {missingJobs.length} job{missingJobs.length !== 1 ? "s" : ""} missing after sync
                          </p>
                          {missingJobs.length > 0 && (
                            <ul className="mt-2 space-y-1">
                              {missingJobs.map((j) => (
                                <li key={j.id} className="flex items-center gap-1.5 text-xs text-slate-700">
                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                                  <span className="font-medium">{j.name}</span>
                                  <span className="text-slate-400">#{j.id}</span>
                                  <span className="ml-auto text-[10px] text-slate-400 capitalize">{j.status}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="text-[11px] text-slate-500 mt-2">
                            Run a manual sync from Field Management to resolve.
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── Sync OK card (green, dismissible) ───────────────────────────
                if (msg.quickAction === "sync_ok") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const date = (meta.date as string | null) ?? "";
                  const count = (meta.count as number | null) ?? 0;
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[80%] rounded-xl overflow-hidden border border-emerald-300 shadow-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600">
                          <CheckCheck className="h-3 w-3 text-emerald-100" />
                          <span className="text-[10px] font-semibold text-emerald-100 uppercase tracking-widest">Sync OK</span>
                          <span className="ml-auto text-[10px] text-emerald-200">{fmtMsgTime(msg.createdAt)}</span>
                          <button
                            className="ml-1 text-emerald-200 hover:text-white transition-colors"
                            title="Dismiss"
                            onClick={() => dismissSystemCard(msg.id)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="px-3 py-2 bg-emerald-50">
                          <p className="text-sm font-semibold text-slate-900">
                            {date} — all {count} job{count !== 1 ? "s" : ""} synced
                          </p>
                          <p className="text-xs text-emerald-700 mt-0.5">
                            Launch27 and LeadFlow counts match.
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── Cron Error card (red, dismissible) ──────────────────────────────
                // ── Cron error — hidden per user request
                if (msg.quickAction === "cron_error") return null;
                if (false && msg.quickAction === "cron_error") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const jobName = (meta.jobName as string | null) ?? "unknown";
                  const errorMsg = (meta.errorMsg as string | null) ?? msg.body ?? "";
                  const ranAt = (meta.ranAt as string | null) ?? null;
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[80%] rounded-xl overflow-hidden border border-red-300 shadow-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600">
                          <AlertTriangle className="h-3 w-3 text-red-100" />
                          <span className="text-[10px] font-semibold text-red-100 uppercase tracking-widest">Cron Failed</span>
                          <span className="ml-auto text-[10px] text-red-200">{fmtMsgTime(msg.createdAt)}</span>
                          <button
                            className="ml-1 text-red-200 hover:text-white transition-colors"
                            title="Dismiss"
                            onClick={() => dismissSystemCard(msg.id)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="px-3 py-2 bg-red-50">
                          <p className="text-sm font-semibold text-slate-900">{jobName}</p>
                          <p className="text-xs text-red-700 mt-0.5 break-words">{errorMsg}</p>
                          {ranAt && (
                            <p className="text-[10px] text-slate-400 mt-1">
                              {new Date(ranAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── Ops Summary card (daily schedule overview) ─────────────────────
                if (msg.quickAction === "ops_summary") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const totalJobs = (meta.totalJobs as number) ?? 0;
                  const confirmed = (meta.confirmed as number) ?? 0;
                  const unconfirmed = (meta.unconfirmed as number) ?? 0;
                  const missingPhone = (meta.missingPhone as number) ?? 0;
                  const gaps = (meta.gaps as number) ?? 0;
                  const confirmedNames = (meta.confirmedNames as string[]) ?? [];
                  const unconfirmedNames = (meta.unconfirmedNames as string[]) ?? [];
                  const allGood = unconfirmed === 0 && missingPhone === 0 && gaps === 0;
                  const summaryDate = (meta.summaryDate as string) ?? "";
                  const summaryDateLabel = summaryDate
                    ? (() => {
                        try {
                          const [y, m, d] = summaryDate.split("-").map(Number);
                          return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });
                        } catch { return summaryDate; }
                      })()
                    : "today";
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[82%] rounded-xl overflow-hidden border border-slate-300 shadow-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700">
                          <ClipboardList className="h-3 w-3 text-slate-200" />
                          <span className="text-[10px] font-semibold text-slate-200 uppercase tracking-widest">Ops Summary</span>
                          <span className="ml-auto text-[10px] text-slate-400">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2.5 bg-white">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-semibold text-slate-900">{totalJobs} job{totalJobs !== 1 ? "s" : ""} — {summaryDateLabel}</span>
                            {allGood && <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">All confirmed 🎉</span>}
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs">
                            {confirmed > 0 && (
                              <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                                <CheckCircle2 className="h-3 w-3" />
                                {confirmed} confirmed{confirmedNames.length > 0 ? `: ${confirmedNames.join(", ")}` : ""}
                              </span>
                            )}
                            {unconfirmed > 0 && (
                              <span className="flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                <TriangleAlert className="h-3 w-3" />
                                {unconfirmed} unconfirmed{unconfirmedNames.length > 0 ? `: ${unconfirmedNames.join(", ")}` : ""}
                              </span>
                            )}
                            {missingPhone > 0 && (
                              <span className="flex items-center gap-1 text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                                <PhoneOff className="h-3 w-3" />
                                {missingPhone} no phone
                              </span>
                            )}
                            {gaps > 0 && (
                              <span className="flex items-center gap-1 text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                                <TriangleAlert className="h-3 w-3" />
                                {gaps} unassigned
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── Escalation flag card (unconfirmed after 8 PM call) ────────────────
                // ── Escalation flag card — hidden per user request
                if (msg.quickAction === "schedule_escalation_flag") return null;
                if (false && msg.quickAction === "schedule_escalation_flag") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const cleanerName = (meta.cleanerName as string) ?? "Unknown cleaner";
                  const cleanerPhone = (meta.cleanerPhone as string) ?? null;
                  const jobCount = Array.isArray(meta.jobIds) ? (meta.jobIds as unknown[]).length : 0;
                  const reason = (meta.reason as string) ?? "no_answer";
                  const isNoAnswer = reason === "no_answer";
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[80%] rounded-xl overflow-hidden border border-red-300 shadow-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600">
                          <PhoneOff className="h-3 w-3 text-red-100" />
                          <span className="text-[10px] font-semibold text-red-100 uppercase tracking-widest">
                            {isNoAnswer ? "No Answer" : "Did Not Confirm"}
                          </span>
                          <span className="ml-auto text-[10px] text-red-300">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2.5 bg-red-50">
                          <p className="text-sm font-semibold text-slate-900">
                            {cleanerName} — schedule unconfirmed
                          </p>
                          <p className="text-xs text-red-700 mt-0.5">
                            {isNoAnswer ? "Did not answer" : "Did not confirm"} after 8 PM escalation call
                            {jobCount > 0 ? ` · ${jobCount} job${jobCount !== 1 ? "s" : ""} tomorrow` : ""}
                          </p>
                          {cleanerPhone && (
                            <p className="text-xs text-slate-500 mt-1">
                              📞 Call manually: {cleanerPhone}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── SMS Undelivered alert card ─────────────────────────────────────────
                if (msg.quickAction === "sms_undelivered") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const customerName = (meta.customerName as string) ?? "Client";
                  const phone = (meta.phone as string) ?? "";
                  const step = (meta.step as string) ?? "";
                  const stepLabel = step === "client_pre_job" ? "Pre-arrival SMS"
                    : step === "client_on_the_way" ? "On-the-way SMS"
                    : step === "client_running_late" ? "Running-late SMS"
                    : "Client SMS";
                  const jobId = (meta.cleanerJobId as number | undefined) ?? msg.cleanerJobId ?? undefined;
                  return (
                    <div key={msg.id} className="w-full my-2">
                      <div className="rounded-xl border-2 border-red-400 bg-red-50 overflow-hidden shadow-sm">
                        <div className="flex items-center gap-2 px-3 py-2 bg-red-500">
                          <span className="text-white text-sm font-bold">📵 SMS Not Delivered</span>
                          <span className="ml-auto text-red-100 text-xs">{msg.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div className="px-3 py-2.5">
                          <p className="text-sm font-semibold text-red-800">{stepLabel} to {customerName} was undelivered</p>
                          {phone && <p className="text-xs text-red-600 mt-0.5">Phone: {phone} — may be a landline or VoIP</p>}
                          <p className="text-xs text-red-500 mt-1 font-medium">Get an alternate mobile number and contact the client directly.</p>
                          {jobId && (
                            <button
                              onClick={() => onJumpToJob(jobId)}
                              className="mt-2 text-xs text-red-700 underline hover:text-red-900"
                            >
                              → Jump to job thread
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
                // ── Skip cleaner_status cards — rendered in sidebar instead
                if (msg.quickAction === "cleaner_status") return null;
                if (msg.quickAction === "escalation_nudge") return null;
                if (msg.quickAction === "weekly_schedule") return null;
                // ── Check-in availability card ─────────────────────────────────────────
                if (msg.quickAction === "checkin_availability") {
                  let meta: { cleanerName?: string; isAvailable?: boolean; maxJobs?: number | null; note?: string | null; availabilityDate?: string } = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch {}
                  const isAvail = meta.isAvailable;
                  const jobsLabel = isAvail
                    ? `up to ${meta.maxJobs != null && meta.maxJobs >= 10 ? "4+" : meta.maxJobs ?? "?"} job${meta.maxJobs !== 1 ? "s" : ""}`
                    : null;
                  const dateLabel = meta.availabilityDate
                    ? new Date(meta.availabilityDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
                    : "tomorrow";
                  const timeLabel = msg.createdAt
                    ? msg.createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })
                    : "";
                  return (
                    <div
                      key={msg.id}
                      ref={(el) => { if (el) cmdMsgRefMap.current.set(msg.id, el); else cmdMsgRefMap.current.delete(msg.id); }}
                      className="w-full my-1"
                    >
                      <div className={`flex items-start gap-3 px-4 py-3 rounded-2xl border-l-4 ${
                        isAvail
                          ? "bg-teal-50 border-teal-400"
                          : "bg-red-50 border-red-400"
                      }`}>
                        <span className="text-xl shrink-0 mt-0.5">{isAvail ? "✅" : "❌"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-800">{meta.cleanerName ?? msg.from}</span>
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                              isAvail
                                ? "bg-teal-100 text-teal-700 border-teal-200"
                                : "bg-red-100 text-red-700 border-red-200"
                            }`}>
                              {isAvail ? `✅ Available ${dateLabel}` : `❌ Off ${dateLabel}`}
                            </span>
                            {isAvail && jobsLabel && (
                              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-600 border border-teal-200">
                                📋 {jobsLabel}
                              </span>
                            )}
                          </div>
                          {meta.note && (
                            <p className="text-xs text-slate-500 mt-1 italic">"{meta.note}"</p>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0 mt-0.5 whitespace-nowrap">{timeLabel}</span>
                      </div>
                    </div>
                  );
                }
                // ── Lead Assignment card (amber/orange) ──────────────────────────────
                if (msg.quickAction === "lead_assignment") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const laLeadName = (meta.leadName as string) ?? "Lead";
                  const laLeadPhone = (meta.leadPhone as string | null) ?? null;
                  const laAgentName = (meta.agentName as string) ?? "Agent";
                  const laAssignedByName = (meta.assignedByName as string) ?? "";
                  const laNotes = (meta.notes as string | null) ?? null;
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[80%] rounded-xl overflow-hidden border border-orange-300 shadow-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500">
                          <Briefcase className="h-3 w-3 text-orange-100" />
                          <span className="text-[10px] font-semibold text-orange-100 uppercase tracking-widest">Lead Assigned</span>
                          <span className="ml-auto text-[10px] text-orange-200">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2.5 bg-orange-50">
                          <p className="text-sm font-semibold text-slate-900">{laLeadName}</p>
                          {laLeadPhone && <p className="text-xs text-slate-500 mt-0.5">📞 {laLeadPhone}</p>}
                          <p className="text-xs text-orange-700 mt-0.5">Assigned to <span className="font-semibold">{laAgentName}</span></p>
                          {laAssignedByName && <p className="text-[10px] text-slate-400 mt-0.5">By {laAssignedByName}</p>}
                          {laNotes && <p className="text-xs text-slate-500 mt-1 italic border-t border-orange-100 pt-1">{laNotes}</p>}
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── Voice Text Sent card ────────────────────────────────────────────────
                if (msg.quickAction === "voice_text_sent") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const vtName = (meta.contactName as string) ?? "Client";
                  const vtMsg = (meta.message as string) ?? "";
                  const vtBy = (meta.triggeredBy as string) ?? msg.from ?? "";
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[80%] rounded-xl overflow-hidden border border-blue-200 shadow-sm">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#007AFF]">
                          <MessageSquare className="h-3 w-3 text-blue-100" />
                          <span className="text-[10px] font-semibold text-blue-100 uppercase tracking-widest">Text Sent</span>
                          <span className="ml-auto text-[10px] text-blue-200">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2.5 bg-blue-50">
                          <p className="text-sm font-semibold text-slate-900">{vtName}</p>
                          {vtMsg && (
                            <p className="text-xs text-slate-600 mt-1 leading-relaxed border-l-2 border-blue-300 pl-2">&ldquo;{vtMsg}&rdquo;</p>
                          )}
                          {vtBy && <p className="text-[10px] text-slate-400 mt-1.5">via voice command by {vtBy}</p>}
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── Voice Call Completed card ───────────────────────────────────────────
                if (msg.quickAction === "voice_call_completed") {
                  let meta: Record<string, unknown> = {};
                  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
                  const vcName = (meta.contactName as string) ?? "Client";
                  const vcOutcome = (meta.outcome as string) ?? "completed";
                  const vcSummary = (meta.summary as string | null) ?? null;
                  const vcDuration = (meta.durationSeconds as number | null) ?? null;
                  const vcBy = (meta.triggeredBy as string) ?? msg.from ?? "";
                  const vcScript = (meta.script as string | null) ?? null;
                  const outcomeLabel = vcOutcome === "completed" ? "✅ Call Completed" : vcOutcome === "voicemail" ? "📬 Voicemail Left" : vcOutcome === "no_answer" ? "📵 No Answer" : "❌ Call Failed";
                  const outcomeColor = vcOutcome === "completed" ? "bg-emerald-500" : vcOutcome === "voicemail" ? "bg-violet-500" : vcOutcome === "no_answer" ? "bg-amber-500" : "bg-red-500";
                  const outcomeBorder = vcOutcome === "completed" ? "border-emerald-200" : vcOutcome === "voicemail" ? "border-violet-200" : vcOutcome === "no_answer" ? "border-amber-200" : "border-red-200";
                  const outcomeBg = vcOutcome === "completed" ? "bg-emerald-50" : vcOutcome === "voicemail" ? "bg-violet-50" : vcOutcome === "no_answer" ? "bg-amber-50" : "bg-red-50";
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className={`max-w-[80%] rounded-xl overflow-hidden border ${outcomeBorder} shadow-sm`}>
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 ${outcomeColor}`}>
                          <Phone className="h-3 w-3 text-white/80" />
                          <span className="text-[10px] font-semibold text-white/90 uppercase tracking-widest">{outcomeLabel}</span>
                          {vcDuration && <span className="text-[10px] text-white/70 ml-1">· {vcDuration}s</span>}
                          <span className="ml-auto text-[10px] text-white/70">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className={`px-3 py-2.5 ${outcomeBg}`}>
                          <p className="text-sm font-semibold text-slate-900">{vcName}</p>
                          {vcScript && (
                            <p className="text-xs text-slate-600 mt-1 leading-relaxed border-l-2 border-slate-300 pl-2 italic">&ldquo;{vcScript}&rdquo;</p>
                          )}
                          {vcSummary && (
                            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{vcSummary}</p>
                          )}
                          {vcBy && <p className="text-[10px] text-slate-400 mt-1.5">via voice command by {vcBy}</p>}
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── Default bubble ─────────────────────────────────────────────────────
                {
                  const msgReactions = reactionsByMsgId[msg.id] ?? [];
                  const reactionGroups = msgReactions.reduce<Record<string, string[]>>((acc, r) => {
                    if (!acc[r.emoji]) acc[r.emoji] = [];
                    acc[r.emoji].push(r.callerName);
                    return acc;
                  }, {});
                  const authorInitial = (msg.from ?? "?")[0].toUpperCase();
                  const authorColor = senderHex(msg.from ?? "");
                  const authorPhoto = senderPhotoMap[msg.from ?? ""] ?? null;
                  const isTaggedMsg = unreadTagIds.includes(msg.id);
                  return (
                    <div
                      key={msg.id}
                      ref={(el) => { if (el) cmdMsgRefMap.current.set(msg.id, el); else cmdMsgRefMap.current.delete(msg.id); }}
                      className={cn(
                        "w-full group transition-colors duration-300",
                        highlightedCmdMsgId === msg.id ? "bg-amber-50 rounded-2xl" : "",
                        isTaggedMsg ? "border-l-4 border-amber-400 pl-2 -ml-2 rounded-r-2xl" : "",
                        msg.threadParentId ? "border-l-2 border-violet-300" : ""
                      )}
                    >
                      {/* Bubble + hover actions */}
                      <div className={"relative flex items-end gap-2 w-full" + (isMine && !isAlert ? " justify-end" : "")}>
                        {/* Avatar — left for others, right for isMine */}
                        {!isAlert && !isMine && (
                          <div className="shrink-0 self-end mb-0.5">
                            {authorPhoto ? (
                              <img src={authorPhoto} alt={msg.from} className="w-7 h-7 rounded-full object-cover border border-white shadow-sm" />
                            ) : (
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold border border-white shadow-sm" style={{ background: authorColor }}>{authorInitial}</div>
                            )}
                          </div>
                        )}
                        <div className={"rounded-2xl " + (isAlert ? "max-w-[560px] px-4 py-2.5 bg-[#0f172a] text-white" : isMine ? "max-w-[75%] ml-auto px-5 py-4 bg-[#0f172a] text-white" : "w-full px-5 py-4 bg-[#f1f5f9] text-slate-900")}>
                          {/* Top row: sender label + role + time */}
                          <div className="flex items-center justify-between mb-2">
                            <span className={cn(
                              "text-xs",
                              isAlert ? "text-slate-400 font-normal" : isMine ? "text-slate-400 font-semibold" : "font-semibold"
                            )} style={{ color: isAlert || isMine ? undefined : authorColor }}>
                              {isAlert
                                ? `${msg.from}${msg.role && msg.role !== "alert" ? " · " + (msg.role === "office" ? "Office" : msg.role === "cleaner" ? "Cleaner" : "Dispatch") : ""}`
                                : isMine ? "You" : msg.from
                              }
                              {!isAlert && !isMine && (
                                <span className="font-normal text-slate-400 ml-1">
                                  · {msg.role === "alert" ? "Alert" : msg.role === "office" ? "Office" : msg.role === "cleaner" ? "Cleaner" : "Dispatch"}
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {isSuperAlert && (
                                <span title="Super-Alert" className="inline-flex items-center gap-0.5 rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold text-purple-700 border border-purple-200">
                                  <Zap className="h-2.5 w-2.5" /> SUPER
                                </span>
                              )}
                              <span className={cn("text-xs", isAlert || isMine ? "text-slate-500" : "text-slate-400")}>
                                {fmtMsgTime(msg.createdAt)}
                              </span>
                            </div>
                          </div>
                          {/* Thread reply context pill — shown when this message is a thread reply surfaced in main feed */}
                          {msg.threadParentId && (
                            <button
                              type="button"
                              onClick={() => setOpenThreadId(msg.threadParentId!)}
                              className={cn(
                                "mb-2.5 w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors group/thread",
                                isMine ? "bg-violet-900/40 border border-violet-700/50 hover:bg-violet-900/60" : "bg-violet-50 border border-violet-200 hover:bg-violet-100"
                              )}
                            >
                              <MessageSquare className={cn("h-3.5 w-3.5 shrink-0", isMine ? "text-violet-400" : "text-violet-500")} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className={cn("text-[10px] font-bold uppercase tracking-wider", isMine ? "text-violet-400" : "text-violet-600")}>
                                    Thread reply
                                  </span>
                                  {msg.threadParentFrom && (
                                    <span className={cn("text-[10px]", isMine ? "text-violet-500" : "text-violet-500")}>· {msg.threadParentFrom}</span>
                                  )}
                                </div>
                                {msg.threadParentBody && (
                                  <p className={cn("text-xs truncate mt-0.5 leading-snug", isMine ? "text-violet-300" : "text-violet-700")}>
                                    {msg.threadParentBody.length > 80 ? msg.threadParentBody.slice(0, 80) + "…" : msg.threadParentBody}
                                  </p>
                                )}
                              </div>
                              <span className={cn(
                                "text-[10px] shrink-0 transition-colors whitespace-nowrap",
                                isMine ? "text-violet-500 group-hover/thread:text-violet-300" : "text-violet-400 group-hover/thread:text-violet-600"
                              )}>
                                Open thread →
                              </span>
                            </button>
                          )}
                          {/* WhatsApp-style quoted block with vivid sender accent */}
                          {msg.replyToId && msg.replyToBody && (
                            <button
                              type="button"
                              onClick={() => msg.replyToId && scrollToCmdMsg(msg.replyToId)}
                              className={cn(
                                "mb-2.5 rounded-lg overflow-hidden flex w-full text-left cursor-pointer hover:brightness-95 transition-all",
                                isMine ? "bg-slate-700" : "bg-slate-100"
                              )}
                            >
                              <div className="w-1 shrink-0 rounded-l-lg" style={{ backgroundColor: senderHex(msg.replyToAuthor ?? "") }} />
                              <div className="px-2.5 py-2 min-w-0">
                                <p className="text-xs font-semibold mb-0.5 truncate" style={{ color: senderHex(msg.replyToAuthor ?? "") }}>{msg.replyToAuthor ?? "Unknown"}</p>
                                <p className={cn("text-xs line-clamp-2 leading-snug break-words", isMine ? "text-slate-300" : "text-slate-500")}>{msg.replyToBody}</p>
                              </div>
                            </button>
                          )}
                          <p className={cn("leading-relaxed whitespace-pre-wrap break-words", isAlert ? "text-xl font-bold leading-snug" : "text-base")}>
                            {renderMessageWithMentions(msg.body, `msg-${msg.id}`, mentionPhoneMap)}
                          </p>
                          {mediaUrls.length > 0 && (
                            <div className={cn("mt-2 flex flex-wrap gap-2", mediaUrls.length === 1 ? "max-w-xs" : "")}>
                              {mediaUrls.map((url, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setLightboxUrl(url)}
                                  className="focus:outline-none"
                                >
                                  <img
                                    src={url.includes(".r2.dev/") ? `/api/media-proxy?url=${encodeURIComponent(url)}` : url}
                                    alt={`attachment-${idx}`}
                                    className="rounded-xl object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                                    style={{ width: mediaUrls.length === 1 ? "100%" : "80px", height: mediaUrls.length === 1 ? "auto" : "80px", maxWidth: "100%" }}
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                          {!isAlert && (
                            <div className="flex items-center justify-end gap-1 mt-1.5">
                              <p className="text-[10px] text-slate-400">
                                {fmtMsgTime(msg.createdAt)}
                              </p>
                              {/* WhatsApp-style read receipt — only on my own messages */}
                              {isMine && (() => {
                                const seenBy = commandSeenByMap[msg.id] ?? [];
                                return (
                                  <span
                                    title={seenBy.length > 0 ? `Seen by ${seenBy.join(", ")}` : "Sent"}
                                    className="inline-flex items-center shrink-0"
                                  >
                                    {seenBy.length > 0 ? (
                                      <svg width="18" height="11" viewBox="0 0 18 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Seen">
                                        <path d="M1 5.5L4.5 9L10 2" stroke="#53bdeb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                        <path d="M5 5.5L8.5 9L14 2" stroke="#53bdeb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                      </svg>
                                    ) : (
                                      <svg width="12" height="11" viewBox="0 0 12 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Sent">
                                        <path d="M1 5.5L4.5 9L11 2" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                      </svg>
                                    )}
                                  </span>
                                );
                              })()}
                            </div>
                          )}
                          {/* Reaction pills */}
                          {Object.keys(reactionGroups).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {Object.entries(reactionGroups).map(([emoji, names]) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => toggleReactionMutation.mutate({ messageId: msg.id, emoji })}
                                  title={names.join(", ")}
                                  className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs bg-slate-100 hover:bg-slate-200 border border-slate-200 transition"
                                >
                                  <span>{emoji}</span>
                                  <span className="text-slate-600 font-medium">{names.length}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                          {/* WhatsApp-style hover actions: Reply + quick-react strip */}
                        <div
                          className={cn(
                            "opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center gap-1 self-start mt-1",
                            isMine ? "order-first mr-1.5" : "ml-1.5"
                          )}
                        >
                          {/* Reply only shown when no thread exists on this message */}
                          {!isAlert && !(msg.replyCount && msg.replyCount > 0) && !msg.threadParentId && (
                            <button
                              onClick={() => setReplyTo({ id: msg.id, body: msg.body, author: msg.from })}
                              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition bg-slate-100 text-slate-600 hover:bg-slate-200"
                            >
                              <ChevronDown className="h-3 w-3" />
                              <span>Reply</span>
                            </button>
                          )}
                          {/* Slack-style: Thread button — root messages only */}
                          {!isAlert && !msg.threadParentId && (
                            <button
                              onClick={() => setOpenThreadId(msg.id)}
                              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition bg-violet-50 text-violet-600 hover:bg-violet-100 border border-violet-200"
                            >
                              <MessageSquare className="h-3 w-3" />
                              <span>{(msg.replyCount ?? 0) > 0 ? "Reply in thread" : "Thread"}</span>
                            </button>
                          )}
                          {/* Reply in thread — for thread reply messages surfaced in main feed */}
                          {!isAlert && msg.threadParentId && (
                            <button
                              onClick={() => setOpenThreadId(msg.threadParentId!)}
                              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition bg-violet-50 text-violet-600 hover:bg-violet-100 border border-violet-200"
                            >
                              <MessageSquare className="h-3 w-3" />
                              <span>Reply in thread</span>
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setCreateIssueDefaultTitle(msg.body?.slice(0, 120) ?? "");
                              setCreateIssueModalOpen(true);
                            }}
                            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition border border-red-200 bg-white text-red-600 hover:bg-red-50 shadow-sm"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            <span>Create Issue</span>
                          </button>
                          {!isAlert && (
                            <div className="flex gap-0.5">
                              {["👍", "❤️", "✅", "🔥"].map(e => (
                                <button
                                  key={e}
                                  type="button"
                                  onClick={() => toggleReactionMutation.mutate({ messageId: msg.id, emoji: e })}
                                  className="w-7 h-7 rounded-full flex items-center justify-center text-sm bg-slate-100 hover:bg-slate-200 transition"
                                >
                                  {e}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Reply count badge — shown below the bubble when thread has replies */}
                      {!isAlert && !msg.threadParentId && (msg.replyCount ?? 0) > 0 && (
                        <button
                          onClick={() => setOpenThreadId(msg.id)}
                          className={cn(
                            "mt-1 ml-9 flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-800 hover:bg-violet-50 px-2.5 py-1 rounded-full transition",
                            isMine ? "ml-auto mr-9" : "ml-9"
                          )}
                        >
                          <MessageSquare className="h-3 w-3" />
                          {msg.replyCount} {msg.replyCount === 1 ? "reply" : "replies"}
                        </button>
                      )}
                    </div>
                  );
                }
              })
            )}
             <div ref={threadBottomRef} />
          </div>
        </div>
    </>
  );
});

// ── component ─────────────────────────────────────────────────────────────────

// Module-level variable: persists across CommandChat unmount/remount cycles
// (unlike useRef which resets to its initial value on each mount).
function MissedCallPanelRow({ row, lineColor, fmtPhone, tAgo, agentName, onResolved }: {
  row: any; lineColor: string;
  fmtPhone: (p: string) => string;
  tAgo: (d: Date) => string;
  agentName: string;
  onResolved: () => void;
}) {
  const [showDialog, setShowDialog] = useState(false);
  const [notes, setNotes] = useState("");
  const markMutation = trpc.missedCalls.markCalledBack.useMutation({
    onSuccess: () => { onResolved(); setShowDialog(false); },
  });
  return (
    <div className="px-4 py-3 hover:bg-slate-50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <PhoneMissed className="h-4 w-4 text-red-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold text-slate-900">{fmtPhone(row.callerPhone)}</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${lineColor}`}>{row.phoneNumberLabel}</span>
              {row.smsSent === 1 && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">SMS sent</span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-400">
              <Clock className="h-3 w-3" />
              <span>{tAgo(row.calledAt)}</span>
              <span className="text-slate-200">·</span>
              <span>{new Date(row.calledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {/* AI outcome badge — only shown when Madison handled the call */}
            {row.aiOutcome && row.aiOutcome !== 'missed' && (
              <div className="mt-1">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                  row.aiOutcome === 'callback_requested' ? 'bg-yellow-100 text-yellow-700' :
                  row.aiOutcome === 'booked' ? 'bg-emerald-100 text-emerald-700' :
                  row.aiOutcome === 'quote_given' ? 'bg-blue-100 text-blue-700' :
                  row.aiOutcome === 'faq_answered' ? 'bg-violet-100 text-violet-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  AI: {(row.aiOutcome as string).replace(/_/g, ' ')}
                </span>
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowDialog(true)}
          className="shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors"
          disabled={markMutation.isPending}
        >
          {markMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          Done
        </button>
      </div>
      {/* AI summary block — shown below the row when Madison handled the call */}
      {row.aiSummary && (
        <div className="mt-2 mx-0 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <p className="text-xs text-amber-800 leading-relaxed">{row.aiSummary}</p>
          {row.aiRecordingUrl && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Bot className="h-3 w-3 text-amber-500 shrink-0" />
              <audio controls src={row.aiRecordingUrl} style={{ flex: 1, height: 24, minWidth: 0 }} />
            </div>
          )}
        </div>
      )}
      {showDialog && (
        <Dialog open onOpenChange={(o) => { if (!o) setShowDialog(false); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Mark as Called Back
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <p className="text-sm text-slate-600">{fmtPhone(row.callerPhone)} · {row.phoneNumberLabel} line</p>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optional) — e.g. Left voicemail"
                className="resize-none text-sm"
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setShowDialog(false)} disabled={markMutation.isPending}>Cancel</Button>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => markMutation.mutate({ id: row.id, agentName, notes: notes || undefined })}
                disabled={markMutation.isPending}
              >
                {markMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── CS SMS History Hover Popover (uses ConversationViewport) ────────────────
function CsSmsHistoryPopover({
  sessionId,
  children,
  onOpenFull,
}: {
  sessionId: number;
  children: React.ReactNode;
  onOpenFull: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [right, setRight] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const { data: sessionData, isLoading } = trpc.leads.getById.useQuery(
    { id: sessionId },
    { enabled: hovered, staleTime: 60_000 }
  );
  // SMS adapter: normalize messageHistory JSON → ConversationMessage[]
  const messages = useMemo((): CVMessage[] => {
    if (!sessionData?.messageHistory) return [];
    try {
      const parsed: Array<{ role: string; content?: string; ts?: number }> = JSON.parse(
        sessionData.messageHistory as string
      );
      const updatedAt = String(sessionData.updatedAt ?? sessionData.id);
      return parsed
        .filter(
          (m) =>
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            m.content.trim()
        )
        .map((m, idx) => ({
          id: `${sessionId}:${idx}`,
          versionKey: `${sessionId}:${idx}:${updatedAt}`,
          author: {
            name: m.role === "assistant" ? "You" : "Customer",
            role: m.role === "assistant" ? "agent" : "customer",
          },
          content: m.content!,
          createdAt: m.ts ? new Date(m.ts) : new Date(0),
        }));
    } catch {
      return [];
    }
  }, [sessionData?.messageHistory, sessionData?.updatedAt, sessionId]);
  const handleMouseEnter = () => {
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      setRight(window.innerWidth - rect.left + 8);
    }
    setHovered(true);
  };
  return (
    <div ref={rowRef} onMouseEnter={handleMouseEnter} onMouseLeave={() => setHovered(false)}>
      {children}
      {hovered && right !== null && (
        <div
          className="fixed z-[9999] w-[420px] rounded-2xl border border-slate-200 bg-white shadow-2xl"
          style={{ top: 80, right }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <ConversationViewport
            messages={messages}
            isLoading={isLoading}
            title="Recent conversation"
            ctaLabel="Open conversation →"
            onOpenFull={onOpenFull}
          />
        </div>
      )}
    </div>
  );
}

// ─── Lead Chat History Hover Popover (uses ConversationViewport) ───────────────
function LeadChatHistoryPopover({
  sessionId,
  children,
  onOpenFull,
}: {
  sessionId: number;
  children: React.ReactNode;
  onOpenFull: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [right, setRight] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const { data: sessionData, isLoading } = trpc.leads.getById.useQuery(
    { id: sessionId },
    { enabled: hovered, staleTime: 60_000 }
  );
  const messages = useMemo((): CVMessage[] => {
    if (!sessionData?.messageHistory) return [];
    try {
      const parsed: Array<{ role: string; content?: string; ts?: number }> = JSON.parse(
        sessionData.messageHistory as string
      );
      const updatedAt = String(sessionData.updatedAt ?? sessionData.id);
      return parsed
        .filter(
          (m) =>
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            m.content.trim()
        )
        .map((m, idx) => ({
          id: `${sessionId}:${idx}`,
          versionKey: `${sessionId}:${idx}:${updatedAt}`,
          author: {
            name: m.role === "assistant" ? "You" : "Customer",
            role: m.role === "assistant" ? "agent" : "customer",
          },
          content: m.content!,
          createdAt: m.ts ? new Date(m.ts) : new Date(0),
        }));
    } catch {
      return [];
    }
  }, [sessionData?.messageHistory, sessionData?.updatedAt, sessionId]);
  const handleMouseEnter = () => {
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      setRight(window.innerWidth - rect.left + 8);
    }
    setHovered(true);
  };
  return (
    <div ref={rowRef} onMouseEnter={handleMouseEnter} onMouseLeave={() => setHovered(false)}>
      {children}
      {hovered && right !== null && (
        <div
          className="fixed z-[9999] w-[420px] rounded-2xl border border-slate-200 bg-white shadow-2xl"
          style={{ top: 80, right }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <ConversationViewport
            messages={messages}
            isLoading={isLoading}
            title="Recent conversation"
            ctaLabel="Open conversation →"
            onOpenFull={onOpenFull}
          />
        </div>
      )}
    </div>
  );
}
// ─── Email History Hover Popover (uses ConversationViewport) ─────────────────
function EmailHistoryPopover({
  threadId,
  children,
  onOpenFull,
}: {
  threadId: string;
  children: React.ReactNode;
  onOpenFull: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [right, setRight] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const { data: threadData, isLoading } = trpc.gmail.getThread.useQuery(
    { threadId },
    { enabled: hovered, staleTime: 60_000 }
  );
  // Email adapter: normalize Gmail thread messages → ConversationMessage[]
  const messages = useMemo((): CVMessage[] => {
    if (!threadData?.messages) return [];
    return [...threadData.messages].map((msg: any) => ({
      id: msg.id ?? msg.date,
      versionKey: `${msg.id ?? msg.date}:${msg.date}`,
      author: {
        name:
          threadData.inboxEmail && msg.fromEmail === threadData.inboxEmail
            ? "You"
            : msg.from || msg.fromEmail || "Unknown",
        role:
          threadData.inboxEmail && msg.fromEmail === threadData.inboxEmail
            ? "agent"
            : "customer",
      },
      content: msg.snippet || msg.bodyText || "",
      createdAt: new Date(msg.date),
    }));
  }, [threadData]);
  const handleMouseEnter = () => {
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      setRight(window.innerWidth - rect.left + 8);
    }
    setHovered(true);
  };
  return (
    <div ref={rowRef} onMouseEnter={handleMouseEnter} onMouseLeave={() => setHovered(false)}>
      {children}
      {hovered && right !== null && (
        <div
          className="fixed z-[9999] w-[420px] rounded-2xl border border-slate-200 bg-white shadow-2xl"
          style={{ top: 80, right }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <ConversationViewport
            messages={messages}
            isLoading={isLoading}
            title="Recent emails"
            ctaLabel="View full thread →"
            onOpenFull={onOpenFull}
          />
        </div>
      )}
    </div>
  );
}

let _commandChatScrollTop = 0;
export default function CommandChat({ channelMsgs, channelLoading, callerName, onSendMessage, onJumpToJob, onSendThreadReply, onSwitchToToday, onSwitchToCS,
  onSwitchToCSSession, onSwitchToLeadOps, awayStatus, onSetAwayStatus, senderStatusMap, agentList, isVisible, myNames: myNamesProp }: CommandChatProps) {
  const [composer, setComposer] = useState("");
  // Message quality check

  // @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = closed
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(0); // cursor pos of the '@'

  // Customer @mention — separate query for customer search
  const [customerMentionQuery, setCustomerMentionQuery] = useState<string | null>(null);
  const { data: customerMentionResults } = trpc.opsChat.searchCustomers.useQuery(
    { query: customerMentionQuery ?? "" },
    { enabled: (customerMentionQuery?.length ?? 0) >= 2, staleTime: 30_000 }
  );
  // Cleaner @mention — search cleaners/teams by name
  const { data: cleanerMentionResults } = trpc.opsChat.searchCleaners.useQuery(
    { query: customerMentionQuery ?? "" },
    { enabled: (customerMentionQuery?.length ?? 0) >= 2, staleTime: 30_000 }
  );
  // Map of name → phone for @[Name] token format (populated on mention selection)
  const mentionPhoneMapRef = useRef<Record<string, string>>({});

  // ── Issues tab state ─────────────────────────────────────────────────────
  const [leftTab, setLeftTab] = useState<"chat" | "issues">("chat");
  const [rightTab, setRightTab] = useState<"leads" | "followups">("leads");
  const [rightSearch, setRightSearch] = useState("");
  const [centerView, setCenterView] = useState<"chat" | "issues" | "calls">("chat");
  // ── AI Call Command Center state ─────────────────────────────────────────
  const [issueDialogJob, setIssueDialogJob] = useState<{ id: number; date: string } | null>(null);
  const [callLogOpen, setCallLogOpen] = useState(false);
  // issueOwners: keyed by issueKey → owner name (DB-backed via getIssueOwnership)
  const [issueOwners, setIssueOwners] = useState<Record<string, string>>({});
  // issueResolved: keyed by issueKey → true when resolved (DB-backed)
  const [issueResolved, setIssueResolved] = useState<Record<string, boolean>>({}); 
  // selectedIssueKey: which issue is expanded in center Issues view
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  // expandedComments: set of issueKeys whose comment thread is open
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [chatConvertModal, setChatConvertModal] = useState<(ConvertModalState & { msgId: number }) | null>(null);
  const [highlightedIssueKey, setHighlightedIssueKey] = useState<string | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [followUpsOpen, setFollowUpsOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [objectionOpen, setObjectionOpen] = useState(false);
  const [followUpsInitialId, setFollowUpsInitialId] = useState<number | null>(null);
  const [fuPanelExpanded, setFuPanelExpanded] = useState(true);
  const { data: fuPanelItems = [] } = trpc.followUps.list.useQuery(undefined, { staleTime: 60_000, refetchInterval: 2 * 60_000 });
  const [overdueAcknowledged, setOverdueAcknowledged] = useState<Set<number>>(new Set());
  const { user: currentUser } = useAuth();
  const currentFirstName = currentUser?.name?.split(/\s+/)[0]?.toLowerCase() ?? "";
  const overdueItems = (fuPanelItems as any[]).filter((fu) =>
    fu.dueAt < Date.now() &&
    !fu.completedAt &&
    !overdueAcknowledged.has(fu.id) &&
    currentFirstName.length > 0 &&
    (fu.owner as string)?.toLowerCase().startsWith(currentFirstName)
  );
  const showOverdueModal = overdueItems.length > 0;
  const completeFuMutation = trpc.followUps.complete.useMutation({
    onSuccess: () => { utils.followUps.list.invalidate(); },
  });
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const threadBottomRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // ── Slack-style thread panel state ──────────────────────────────────────────
  const [openThreadId, setOpenThreadId] = useState<number | null>(null);
  const [allThreadsOpen, setAllThreadsOpen] = useState(false);
  const [leadRepliesOpen, setLeadRepliesOpen] = useState(false);
  const [csSmsOpen, setCsSmsOpen] = useState(false);
  const [missedCallsOpen, setMissedCallsOpen] = useState(false);
  const [emailsOpen, setEmailsOpen] = useState(false);
  const [quickReplyTarget, setQuickReplyTarget] = useState<{ customer: CustomerData; view: "sms" | "email"; lastMessage?: string; emailSubject?: string; isLeadChat?: boolean; sessionId?: number } | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [taskRefetchTick, setTaskRefetchTick] = useState(0);
  const [dueTaskPopupDismissed, setDueTaskPopupDismissed] = useState<Set<number>>(() => new Set());
  const { data: dueTasks = [] } = trpc.tasks.getDue.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const visibleDueTasks = (dueTasks as any[]).filter((t: any) => !dueTaskPopupDismissed.has(t.id));
  const [threadRefetchTick, setThreadRefetchTick] = useState(0);
  const { data: activeThreads = [] } = trpc.opsChat.listActiveThreads.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const activeThreadCount = (activeThreads as any[]).length;
  const unreadThreadCount = (activeThreads as any[]).filter((t: any) => t.hasUnread).length;
  const [hiddenLeadIds, setHiddenLeadIds] = useState<Set<number>>(new Set());
  const { data: rawLeadReplies = [] } = trpc.leads.getLeadReplies.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 0,
  });
  const leadReplies = (rawLeadReplies as any[]).filter((l: any) => !hiddenLeadIds.has(l.id));
  const leadRepliesCount = leadReplies.length;
  const unreadLeadRepliesCount = leadReplies.filter((l: any) => l.isUnread).length;
  // ── Email inbox unread count ─────────────────────────────────────────────────
  const { data: emailUnreadData } = trpc.gmail.getUnreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
    staleTime: 0, // Always refetch when cache is invalidated (e.g. after marking email read in inbox)
  });
  const emailUnreadCount = emailUnreadData?.count ?? 0;
  // ── Email thread list for the slide-in panel ────────────────────────────────
  const { data: emailThreadsData } = trpc.gmail.listThreads.useQuery(
    { maxResults: 50, unreadOnly: true },
    { staleTime: 30_000, refetchInterval: 60_000, retry: false, enabled: emailsOpen }
  );
  const emailThreadsList = emailThreadsData?.threads ?? [];
  // ── Missed Calls today count (pending only) ─────────────────────────────────
  const { data: missedCallsTodayData, refetch: refetchMissedCallsToday } = trpc.missedCalls.getPendingCount.useQuery(
    { todayOnly: true },
    { staleTime: 30_000, refetchInterval: 60_000, retry: false }
  );
  const missedCallsTodayCount = missedCallsTodayData?.count ?? 0;
  // ── Missed calls list for the slide-in panel ────────────────────────────────
  const { data: missedCallsListData = [], refetch: refetchMissedCallsList } = trpc.missedCalls.listMissedCalls.useQuery(
    { filter: "pending", limit: 100, offset: 0 },
    { staleTime: 30_000, refetchInterval: 60_000, retry: false, enabled: missedCallsOpen }
  );
  // ── Unanswered CS SMS count (202-888-5362 line only) ─────────────────────────
  const { data: csUnansweredData } = trpc.leads.getUnansweredCsCount.useQuery(undefined, {
    staleTime: 0, refetchInterval: 60_000, retry: false,
  });
  // Optimistically-hidden session IDs — removed from list immediately on checkmark click
  const [hiddenCsSessionIds, setHiddenCsSessionIds] = useState<Set<number>>(new Set());
  const rawCsUnansweredSessions = csUnansweredData?.sessions ?? [];
  const csUnansweredSessions = rawCsUnansweredSessions.filter(s => !hiddenCsSessionIds.has(s.id));
  const hiddenSessions = rawCsUnansweredSessions.filter(s => hiddenCsSessionIds.has(s.id));
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const hiddenUrgentCount = hiddenSessions.filter(s => s.ageMs > ONE_HOUR_MS).length;
  const hiddenWarningCount = hiddenSessions.filter(s => s.ageMs > FIFTEEN_MIN_MS && s.ageMs <= ONE_HOUR_MS).length;
  const csUnansweredCount = Math.max(0, (csUnansweredData?.count ?? 0) - hiddenCsSessionIds.size);
  const csUnansweredUrgent = Math.max(0, (csUnansweredData?.urgentCount ?? 0) - hiddenUrgentCount);
  const csUnansweredWarning = Math.max(0, (csUnansweredData?.warningCount ?? 0) - hiddenWarningCount);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guard: prevent duplicate "I'm Back" messages when button click + keystroke both fire
  const imBackFiredRef = useRef(false);

  const utils = trpc.useUtils();

  const resolveSessionFromBanner = trpc.leads.resolveSession.useMutation({
    onSuccess: (_data, variables) => {
      utils.leads.getUnansweredCsCount.invalidate();
      // Surgical cache update: mark only the resolved session — no full refetch.
      const resolvedAt = new Date();
      utils.leads.listCsInbox.setData({ showResolved: true }, (old) => {
        if (!old) return old;
        return old.map((s) =>
          s.id === variables.sessionId ? { ...s, csResolvedAt: resolvedAt } : s
        );
      });
      utils.leads.getLeadReplies.invalidate();
    },
  });
  const [hiddenEmailThreadIds, setHiddenEmailThreadIds] = useState<Set<string>>(new Set());
  const completeEmailThread = trpc.gmail.completeThread.useMutation({
    onSuccess: () => {
      utils.gmail.listThreads.invalidate();
      utils.gmail.getUnreadCount.invalidate();
    },
  });

  const { data: cmdData, isLoading: cmdLoading } = trpc.opsChat.getCommandChatData.useQuery(undefined, {
    refetchInterval: 60_000, // SSE triggers immediate refetch; interval is fallback only
  });

  // ── Recent call recordings — queried directly from DB, same as CsInbox ─────────────
  const { data: recentCallRecordings = [] } = trpc.leads.getRecentCallRecordings.useQuery(
    { limit: 20 },
    { refetchInterval: 30_000 }
  );

  // ── SSE real-time updates (CommandChat owns its own stream connection) ──────────────
  // CommandChat is rendered inside OpsChat which also calls useOpsStream.
  // Both hooks open separate SSE connections; the server handles multiple clients.
  useOpsStream({
    onNewMessage: (channel, _jobId, threadParentId) => {
      if (channel === "command" || !channel) {
        utils.opsChat.getCommandChatData.invalidate();
        utils.opsChat.listChannelMessages.invalidate({ channel: "command" });
        // If this is a thread reply, also bump the thread refetch tick
        if (threadParentId) {
          setThreadRefetchTick(t => t + 1);
        }
      }
    },
    onJobUpdate: () => {
      utils.opsChat.getCommandChatData.invalidate();
    },
    onLeadUpdate: () => {
      utils.opsChat.getCommandChatData.invalidate();
      // Also refresh channel messages so the hot leads tray reflects claim changes
      utils.opsChat.listChannelMessages.invalidate({ channel: "command" });
      utils.leads.list.invalidate();
      // Refresh lead replies notification immediately on any inbound lead event
      utils.leads.getLeadReplies.invalidate();
      // Refresh unanswered CS SMS count
      utils.leads.getUnansweredCsCount.invalidate();
    },
    onReactionUpdate: () => {
      refetchReactions();
    },
    onIssueComment: (issueKey) => {
      // Invalidate the specific issue's comment thread so all agents see it instantly
      utils.opsChat.getIssueComments.invalidate({ issueKey });
    },
    onLeadAssignment: () => {
      // Refresh the pending assignment query so the overlay appears for the assigned agent
      utils.leads.getPendingAssignment.invalidate();
      utils.opsChat.getCommandChatData.invalidate();
      utils.opsChat.listChannelMessages.invalidate({ channel: "command" });
    },
    onSuperAlert: () => {
      // Refresh pending super-alerts so the overlay appears immediately for targeted agents
      utils.opsChat.getPendingSuperAlerts.invalidate();
      utils.opsChat.getSuperAlertMessageIds.invalidate();
      utils.opsChat.getCommandChatData.invalidate();
      utils.opsChat.listChannelMessages.invalidate({ channel: "command" });
    },
    onMissedCall: () => {
      refetchMissedCallsToday();
      refetchMissedCallsList();
    },
    onMissedCallResolved: () => {
      refetchMissedCallsToday();
      refetchMissedCallsList();
    },
    onTaskUpdate: () => {
      utils.tasks.list.invalidate();
      utils.tasks.listMine.invalidate();
      utils.tasks.getDue.invalidate();
      setTaskRefetchTick(t => t + 1);
    },
  });

  // Fetch message IDs that triggered super-alerts (for ⚡ badge rendering)
  // MUST be declared here (early) because the message render loop at line ~924 uses superAlertMsgSet
  const { data: superAlertMsgIds = [] } = trpc.opsChat.getSuperAlertMessageIds.useQuery(
    { channel: "command" },
    { staleTime: 0, refetchInterval: 60_000 }
  );
  const superAlertMsgSet = useMemo(() => new Set(superAlertMsgIds), [superAlertMsgIds]);

  // Load all agent photo URLs for message bubble avatars
  const { data: agentPhotoData } = trpc.opsChat.getAllAgentPhotoMap.useQuery(undefined, {
    staleTime: 2 * 60 * 1000,
    retry: false,
  });
  const senderPhotoMap: Record<string, string | null> = useMemo(() => agentPhotoData?.photos ?? {}, [agentPhotoData?.photos]);
  // All agent names available for @mention autocomplete (exclude self)
  const mentionNames = useMemo(() => {
    const all = Object.keys(senderPhotoMap).filter(n => n && n !== callerName);
    // Deduplicate: if two names share the same first name, keep only the longer (full) name
    const byFirst: Record<string, string> = {};
    for (const name of all) {
      const first = name.split(" ")[0].toLowerCase();
      if (!byFirst[first] || name.length > byFirst[first].length) {
        byFirst[first] = name;
      }
    }
    return Object.values(byFirst).sort();
  }, [senderPhotoMap, callerName]);
  const mentionSuggestions = useMemo(
    () => mentionQuery === null ? [] : mentionNames.filter(n => n.toLowerCase().startsWith(mentionQuery.toLowerCase())),
    [mentionNames, mentionQuery]
  );

  // Customer mention suggestions (separate from agent mentions)
  const customerSuggestions = useMemo(
    () => customerMentionQuery === null ? [] : (customerMentionResults?.customers ?? []),
    [customerMentionQuery, customerMentionResults]
  );

  // Cleaner/team mention suggestions
  const cleanerSuggestions = useMemo(
    () => customerMentionQuery === null ? [] : (cleanerMentionResults?.cleaners ?? []),
    [customerMentionQuery, cleanerMentionResults]
  );

  // ── Notification sound + OS notification ──────────────────────────────────────
  const { playSound: playNotification, muted: notifMuted, toggleMute } = useNotificationSound();
  const { notify: osNotify, requestPermission: requestOsPermission } = useOsNotification();
  // -1 sentinel: means "not yet initialized" — prevents spurious sound on first load/remount
  const prevMsgCountRef = useRef(-1);

  // Request OS notification permission on first user interaction
  useEffect(() => {
    const unlock = () => {
      requestOsPermission();
      document.removeEventListener("click", unlock, true);
    };
    document.addEventListener("click", unlock, true);
    return () => document.removeEventListener("click", unlock, true);
  }, [requestOsPermission]);

  // ── Typing indicator ───────────────────────────────────────────────────────────
  const { typers: cmdTypers, onKeyPress: onCmdKeyPress, onBlur: onCmdBlur } = useTypingIndicator("command");

  const dismissSystemCardMutation = trpc.opsChat.dismissSystemCard.useMutation({
    onSuccess: () => {
      utils.opsChat.getCommandChatData.invalidate();
      utils.opsChat.listChannelMessages.invalidate({ channel: "command" });
    },
  });
  const claimLeadMutation = trpc.opsChat.claimLead.useMutation({
    onSuccess: (res) => {
      if (!res.success && 'alreadyClaimedBy' in res) {
        toast.info(`Already claimed by ${res.alreadyClaimedBy}`);
      } else {
        toast.success("Lead claimed!");
        // Refresh channel messages so the hot leads tray card shows claimed state
        utils.opsChat.listChannelMessages.invalidate({ channel: "command" });
        utils.leads.list.invalidate();
      }
    },
    onError: (err) => toast.error("Claim failed", { description: err.message }),
  });

  const broadcastMutation = trpc.opsChat.broadcastSmsToCleaners.useMutation({
    onSuccess: (res) => {
      toast.success(`Broadcast sent to ${res.sent} cleaner${res.sent !== 1 ? "s" : ""}`, { description: res.failed > 0 ? `${res.failed} failed` : undefined });
      setBroadcastOpen(false);
      setBroadcastMsg("");
    },
    onError: (err) => {
      toast.error("Broadcast failed", { description: err.message });
    },
  });

  // ── Issue Engine (Phase 1) state ──────────────────────────────────────────
  const [issueEngineOverlayOpen, setIssueEngineOverlayOpen] = useState(false);
  const [issueEngineInitialId, setIssueEngineInitialId] = useState<number | null>(null);
  const [createIssueModalOpen, setCreateIssueModalOpen] = useState(false);
  const [createIssueDefaultTitle, setCreateIssueDefaultTitle] = useState("");
  // ── Open Issue modal state ─────────────────────────────────────────────────
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueNote, setIssueNote] = useState("");
  const [issueJobId, setIssueJobId] = useState<number | undefined>(undefined);
  const openIssueMutation = trpc.opsChat.openIssue.useMutation({
    onSuccess: () => {
      toast.success("Issue posted to Command Chat");
      setIssueOpen(false); setIssueTitle(""); setIssueNote(""); setIssueJobId(undefined);
      utils.opsChat.getCommandChatData.invalidate();
    },
    onError: (err) => toast.error("Failed to post issue", { description: err.message }),
  });

  // ── Set Reminder modal state ───────────────────────────────────────────────
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderBody, setReminderBody] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState<number>(15);
  const [reminderCustom, setReminderCustom] = useState("");
  const setReminderMutation = trpc.opsChat.setReminder.useMutation({
    onSuccess: () => {
      const mins = reminderMinutes === -1 ? parseInt(reminderCustom, 10) : reminderMinutes;
      toast.success(`Reminder set for ${mins} min from now`);
      setReminderOpen(false); setReminderBody(""); setReminderMinutes(15); setReminderCustom("");
    },
    onError: (err) => toast.error("Failed to set reminder", { description: err.message }),
  });

  // ── Pin Note modal state ───────────────────────────────────────────────────
  const [pinOpen, setPinOpen] = useState(false);
  const [pinBody, setPinBody] = useState("");
  const { data: activePin, refetch: refetchPin } = trpc.opsChat.getChannelPin.useQuery({ channel: "command" }, { refetchInterval: 60_000 });
  const { data: todayJobsData } = trpc.opsChat.listTodayJobs.useQuery(undefined, { staleTime: 60_000 });
  const pinNoteMutation = trpc.opsChat.pinNote.useMutation({
    onSuccess: () => {
      toast.success("Note pinned!"); setPinOpen(false); setPinBody(""); refetchPin();
    },
    onError: (err) => toast.error("Failed to pin note", { description: err.message }),
  });
  const dismissPinMutation = trpc.opsChat.dismissPin.useMutation({
    onSuccess: () => { toast.success("Pin dismissed"); refetchPin(); },
  });

   // ── Super-alert overlay ──────────────────────────────────────────────────────
  // Poll every 3s for unacknowledged super-alerts; also refreshed via SSE onSuperAlert.
  // Server uses session cookie to identify the caller — no agentName input needed.
  const { data: pendingSuperAlerts = [] } = trpc.opsChat.getPendingSuperAlerts.useQuery(
    undefined,
    { refetchInterval: 3_000, refetchIntervalInBackground: true, retry: 2, staleTime: 0, refetchOnWindowFocus: true }
  );
  const acknowledgeSuperAlertMutation = trpc.opsChat.acknowledgeSuperAlert.useMutation({
    onSuccess: () => { utils.opsChat.getPendingSuperAlerts.invalidate(); },
    onError: (err) => toast.error("Failed to dismiss alert", { description: err.message }),
  });
  // Show the oldest unacknowledged super-alert as the active overlay
  const activeSuperAlert = pendingSuperAlerts[0] ?? null;

  // ── Announce Booking modal state ───────────────────────────────────────────
  const [bookingOpen, setBookingOpen] = useState(false);
  const [showGlitter, setShowGlitter] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ── First Message Generator modal state ─────────────────────────────────────
  const [firstMsgOpen, setFirstMsgOpen] = useState(false);
  const [firstMsgDetails, setFirstMsgDetails] = useState("");
  const [firstMsgResult, setFirstMsgResult] = useState("");
  const [firstMsgCopied, setFirstMsgCopied] = useState(false);
  const generateFirstMessageMutation = trpc.tools.generateFirstMessage.useMutation({
    onSuccess: (data) => { setFirstMsgResult(data.message); setFirstMsgCopied(false); },
    onError: (err) => toast.error("Failed to generate message", { description: err.message }),
  });

  // ── Quote-reply state ─────────────────────────────────────────────────────
  const [replyTo, setReplyTo] = useState<{ id: number; body: string; author: string } | null>(null);

  // ── Read receipts (seenBy) ─────────────────────────────────────────────────
  const myCommandMsgIds = useMemo(
    () => channelMsgs.filter(m => m.from === callerName).map(m => m.id).filter(id => id > 0),
    [channelMsgs, callerName]
  );
  const { data: commandSeenByBulk } = trpc.opsChat.getSeenByBulk.useQuery(
    { messageIds: myCommandMsgIds, channel: "command" },
    { enabled: myCommandMsgIds.length > 0, refetchInterval: 60_000 }
  );
  const commandSeenByMap = useMemo(() => {
    const map: Record<number, string[]> = {};
    for (const entry of commandSeenByBulk?.reads ?? []) {
      if (!map[entry.messageId]) map[entry.messageId] = [];
      map[entry.messageId].push(entry.callerName);
    }
    return map;
  }, [commandSeenByBulk]);

  // ── Reactions ────────────────────────────────────────────────────────────────
  // getReactions is a mutation (POST) to avoid HTTP 414 when hundreds of IDs are sent.
  const cmdMsgIds = useMemo(() => channelMsgs.map(m => m.id).filter(id => Number.isFinite(id) && id > 0), [channelMsgs]);
  const [reactionsData, setReactionsData] = useState<{ reactions: Array<{ messageId: number; callerId: string; callerName: string; emoji: string }> } | undefined>(undefined);
  const getReactionsMutation = trpc.opsChat.getReactions.useMutation({
    onSuccess: (data) => setReactionsData(data),
  });
  const refetchReactions = useCallback(() => {
    if (cmdMsgIds.length > 0) getReactionsMutation.mutate({ messageIds: cmdMsgIds });
  }, [cmdMsgIds]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    refetchReactions();
    const interval = setInterval(refetchReactions, 10_000);
    return () => clearInterval(interval);
  }, [refetchReactions]);
  const reactionsByMsgId = useMemo(() =>
    (reactionsData?.reactions ?? []).reduce<Record<number, Array<{ callerId: string; callerName: string; emoji: string }>>>(
      (acc: Record<number, Array<{ callerId: string; callerName: string; emoji: string }>>, r: { messageId: number; callerId: string; callerName: string; emoji: string }) => {
        if (!acc[r.messageId]) acc[r.messageId] = [];
        acc[r.messageId].push(r);
        return acc;
      }, {}
    ),
  [reactionsData]);
  const toggleReactionMutation = trpc.opsChat.toggleReaction.useMutation({ onSuccess: () => refetchReactions() });
  const callClientRunningLateMutation = trpc.fieldMgmt.callClientRunningLate.useMutation();
  const [callingClientJobId, setCallingClientJobId] = useState<number | null>(null);
  const [clientCallDone, setClientCallDone] = useState<Set<number>>(new Set());
  // Confirmation dialog state for "Call Client (Running Late)"
  const [callConfirmState, setCallConfirmState] = useState<{
    cleanerJobId: number;
    clientName: string | null;
    etaLabel: string | null;
    detectedFromSms: boolean;
    smsText: string | null;
    isTestCard: boolean;
  } | null>(null);
  // Editable ETA time string in the confirmation dialog ("HH:MM" 24h, or "" for no ETA)
  const [editedEtaTime, setEditedEtaTime] = useState<string>("");

  /** Convert a "HH:MM" 24h string to a Unix ms timestamp for today (ET). Returns null if blank/invalid. */
  function etaTimeStringToMs(timeStr: string): number | null {
    if (!timeStr) return null;
    const [hStr, mStr] = timeStr.split(":");
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (isNaN(h) || isNaN(m)) return null;
    // Build timestamp treating input as ET (America/New_York) — avoids server-timezone drift.
    const now = new Date();
    const etParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const year  = etParts.find(p => p.type === "year")!.value;
    const month = etParts.find(p => p.type === "month")!.value;
    const day   = etParts.find(p => p.type === "day")!.value;
    // Find the ET UTC offset by comparing a known UTC noon to what ET wall clock shows.
    const noonUtc = new Date(`${year}-${month}-${day}T12:00:00Z`);
    const etNoonParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(noonUtc);
    const etNoonH = parseInt(etNoonParts.find(p => p.type === "hour")!.value, 10);
    // etOffsetHours = how many hours ET is behind UTC (e.g. 4 for EDT, 5 for EST)
    const etOffsetHours = 12 - etNoonH;
    // Build the target UTC timestamp: ET wall clock time + offset = UTC
    const etMidnightUtc = Date.UTC(
      parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10)
    );
    const eta = new Date(etMidnightUtc + (h + etOffsetHours) * 3_600_000 + m * 60_000);
    // If the time is in the past by more than 1 hour, skip
    if (eta.getTime() < now.getTime() - 60 * 60 * 1000) return null;
    return eta.getTime();
  }

  /** Format a "HH:MM" 24h string as a human-readable 12h label for the call script preview. */
  function etaTimeStringToLabel(timeStr: string): string | null {
    const ms = etaTimeStringToMs(timeStr);
    if (!ms) return null;
    return new Date(ms).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    });
  }

  async function executeCallClientRunningLate(cleanerJobId: number) {
    const etaOverrideMs = etaTimeStringToMs(editedEtaTime) ?? undefined;
    const testMode = callConfirmState?.isTestCard ?? false;
    setCallConfirmState(null);
    setEditedEtaTime("");
    setCallingClientJobId(cleanerJobId);
    try {
      await callClientRunningLateMutation.mutateAsync({ cleanerJobId, etaOverrideMs, ...(testMode ? { testMode: true } : {}) });
      setClientCallDone(prev => new Set(prev).add(cleanerJobId));
    } catch (err: any) {
      alert(err?.message ?? "Failed to call client");
    } finally {
      setCallingClientJobId(null);
    }
  }

  const chatPrefillMutation = trpc.opsChat.prefillIssueFromComment.useMutation();
  const chatConvertMutation = trpc.opsChat.convertChatMessageToIssue.useMutation();
  const openChatConvert = useCallback(async (msgId: number, msgBody: string) => {
    setChatConvertModal({ msgId, commentId: msgId, commentBody: msgBody, title: "", severity: "Medium", team: "", customer: "", loading: true, submitting: false });
    try {
      const prefill = await chatPrefillMutation.mutateAsync({ commentBody: msgBody });
      setChatConvertModal(prev => prev ? { ...prev, title: prefill.title, severity: prefill.severity, team: prefill.team, customer: prefill.customer, loading: false } : null);
    } catch {
      setChatConvertModal(prev => prev ? { ...prev, loading: false } : null);
    }
  }, [chatPrefillMutation]); // chatPrefillMutation ref is stable from trpc
  async function submitChatConvert() {
    if (!chatConvertModal || chatConvertModal.submitting) return;
    setChatConvertModal(prev => prev ? { ...prev, submitting: true } : null);
    try {
      const result = await chatConvertMutation.mutateAsync({
        messageId: chatConvertModal.msgId,
        title: chatConvertModal.title,
        severity: chatConvertModal.severity,
        team: chatConvertModal.team,
        customer: chatConvertModal.customer,
        authorName: callerName,
        channel: "command",
        sourceMessageBody: chatConvertModal.commentBody,
      });
      setChatConvertModal(null);
      utils.opsChat.getCommandChatData.invalidate();
      if (result.newIssueKey) {
        setLeftTab("issues");
        setCenterView("issues");
        setHighlightedIssueKey(result.newIssueKey);
        setTimeout(() => {
          const el = document.getElementById(`issue-card-${result.newIssueKey}`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => setHighlightedIssueKey(null), 3000);
        }, 150);
      }
    } catch {
      setChatConvertModal(prev => prev ? { ...prev, submitting: false } : null);
    }
  }

  // ── Scroll-to-original ────────────────────────────────────────────────────────────────
  const cmdMsgRefMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const [highlightedCmdMsgId, setHighlightedCmdMsgId] = useState<number | null>(null);

  // ── Inline header search ────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchMatchIds = useMemo(() => {
    if (!searchQuery.trim()) return new Set<number>();
    const q = searchQuery.toLowerCase();
    return new Set(channelMsgs.filter(m => m.body.toLowerCase().includes(q)).map(m => m.id));
  }, [searchQuery, channelMsgs]);
  const searchMatchList = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return channelMsgs.filter(m => searchMatchIds.has(m.id));
  }, [searchQuery, searchMatchIds, channelMsgs]);
  const [searchResultIdx, setSearchResultIdx] = useState(0);
  function openSearch() {
    setSearchOpen(true);
    setSearchQuery("");
    setSearchResultIdx(0);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }
  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResultIdx(0);
  }
  function navigateSearchResult(dir: 1 | -1) {
    if (searchMatchList.length === 0) return;
    const next = (searchResultIdx + dir + searchMatchList.length) % searchMatchList.length;
    setSearchResultIdx(next);
    const target = searchMatchList[next];
    if (target) scrollToCmdMsg(target.id);
  }

  const scrollToCmdMsg = useCallback((id: number) => {
    const el = cmdMsgRefMap.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedCmdMsgId(id);
    setTimeout(() => setHighlightedCmdMsgId(null), 1800);
  }, []); // cmdMsgRefMap is a ref (stable), setHighlightedCmdMsgId is a setter (stable)

  // ── Inline issue note editing (right panel auto-raised issues) ──────────────
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const updateIssueNoteMutation = trpc.opsChat.updateIssueNote.useMutation({
    onSuccess: () => {
      toast.success("Note saved");
      setEditingNoteId(null);
      utils.opsChat.getCommandChatData.invalidate();
    },
    onError: (err) => toast.error("Failed to save note", { description: err.message }),
  });

  // ── Resolve Issue modal state (Command Chat general_issue) ────────────────────
  const [resolveIssueOpen, setResolveIssueOpen] = useState(false);
  const [resolveIssueMessageId, setResolveIssueMessageId] = useState<number | null>(null);
  const [resolveIssueKey, setResolveIssueKey] = useState<string | null>(null);
  const [resolveIssueTitle, setResolveIssueTitle] = useState("");
  const [resolveIssueNote, setResolveIssueNote] = useState("");
  const [resolveIssueNoteText, setResolveIssueNoteText] = useState("");
  const [resolveIssueSubmitting, setResolveIssueSubmitting] = useState(false);
  const glitterRunning = useRef(false);
  const triggerGlitter = () => {
    if (glitterRunning.current) return; // already playing — ignore
    glitterRunning.current = true;
    setShowGlitter(true);
    // Hard fallback: force-stop after 6.5s in case onDone never fires
    setTimeout(() => {
      glitterRunning.current = false;
      setShowGlitter(false);
    }, 6500);
  };

  // ── Celebration sound helper ───────────────────────────────────────────────
  const playCelebrationSound = useCallback(() => {
    try {
      const audio = new Audio("https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/celebration_chime_648a50c1.wav");
      audio.volume = 0.7;
      audio.play().catch(() => {/* autoplay blocked — silent fail */});
    } catch { /* ignore */ }
  }, []);

  // ── Broadcast celebration polling ─────────────────────────────────────────
  // Poll every 3s; when a new announce_booking message appears that we haven't
  // seen yet, fire glitter + sound on every agent's screen simultaneously.
  const lastSeenCelebrationId = useRef<number | null>(null);
  // Celebration polling: only poll when the panel is visible. SSE also invalidates it via onNewMessage.
  // 10s interval is sufficient — glitter fires within 10s of a booking announcement.
  const { data: latestCelebration } = trpc.opsChat.getLatestCelebration.useQuery(undefined, {
    enabled: isVisible !== false,
    refetchInterval: isVisible !== false ? 10_000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  useEffect(() => {
    if (!latestCelebration) return;
    const id = latestCelebration.id;
    if (lastSeenCelebrationId.current === null) {
      // First load — just record the current latest, don't fire
      lastSeenCelebrationId.current = id;
      return;
    }
    if (id !== lastSeenCelebrationId.current) {
      lastSeenCelebrationId.current = id;
      triggerGlitter();
      playCelebrationSound();
    }
  }, [latestCelebration, playCelebrationSound]);
  const [bookingPerson, setBookingPerson] = useState("");
  const [bookingAmount, setBookingAmount] = useState("");
  const [bookingNote, setBookingNote] = useState("");
  const announceBookingMutation = trpc.opsChat.announceBooking.useMutation({
    onSuccess: () => {
      toast.success("Booking announced! 🎉");
      setBookingOpen(false); setBookingPerson(""); setBookingAmount(""); setBookingNote("");
      triggerGlitter();
      playCelebrationSound();
    },
    onError: (err) => toast.error("Failed to announce booking", { description: err.message }),
  });

  // ── Staged photos ──────────────────────────────────────────────────────────
  type StagedPhoto = {
    id: string;
    previewUrl: string;
    file: File;
    status: "pending" | "uploading" | "done" | "error";
    s3Url?: string;
  };
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const uploadPhoto = trpc.opsChat.uploadOpsPhoto.useMutation();

  async function stageFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!arr.length) return;
    const newItems: StagedPhoto[] = arr.map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      previewUrl: URL.createObjectURL(f),
      file: f,
      status: "pending",
    }));
    setStagedPhotos(prev => [...prev, ...newItems]);
    for (const item of newItems) {
      setStagedPhotos(prev => prev.map(p => p.id === item.id ? { ...p, status: "uploading" } : p));
      try {
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(item.file);
        });
        const { url } = await uploadPhoto.mutateAsync({
          filename: item.file.name,
          mimeType: item.file.type,
          dataBase64,
        });
        setStagedPhotos(prev => prev.map(p => p.id === item.id ? { ...p, status: "done", s3Url: url } : p));
      } catch {
        setStagedPhotos(prev => prev.map(p => p.id === item.id ? { ...p, status: "error" } : p));
        toast.error("Photo upload failed");
      }
    }
  }

  function removeStagedPhoto(id: string) {
    setStagedPhotos(prev => {
      const item = prev.find(p => p.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  }

  // ── Emoji picker ───────────────────────────────────────────────────────────
  const [showEmoji, setShowEmoji] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showEmoji) return;
    function handleClick(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showEmoji]);

  function insertEmoji(data: EmojiClickData) {
    const el = composerRef.current;
    if (!el) { setComposer(prev => prev + data.emoji); return; }
    const start = el.selectionStart ?? composer.length;
    const end = el.selectionEnd ?? composer.length;
    const next = composer.slice(0, start) + data.emoji + composer.slice(end);
    setComposer(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + data.emoji.length, start + data.emoji.length);
    });
  }

  // ── Voice recording ────────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const transcribeVoice = trpc.opsChat.transcribeVoiceNote.useMutation();
  const voiceCommandMutation = trpc.opsChat.voiceCommand.useMutation();
    const sendVoiceText = trpc.leads.sendMessage.useMutation();
  const postVoiceCallCard = trpc.opsChat.postVoiceCallCard.useMutation();
  const rewriteVoiceMsg = trpc.opsChat.rewriteVoiceMessage.useMutation();
  const [voiceTone, setVoiceTone] = useState<"friendly" | "professional" | "casual">("friendly");
  const [voiceRewriting, setVoiceRewriting] = useState(false);
  const [voiceBubbleEditing, setVoiceBubbleEditing] = useState(false);
  // Voice command confirmation card state
  type VoiceMatch = { sessionId: number; name: string; phone: string };
  type VoiceConfirmState = {
    message: string;
    matches: VoiceMatch[];
    selected: VoiceMatch | null;
  };
  const [voiceConfirm, setVoiceConfirm] = useState<VoiceConfirmState | null>(null);
  const [voiceConfirmMsg, setVoiceConfirmMsg] = useState("");
  const [voiceConfirmAction, setVoiceConfirmAction] = useState<"text" | "call" | "remind" | "chat">("text");
  const [voiceUnknown, setVoiceUnknown] = useState<string | null>(null); // non-null = show "didn't understand" error
  type VoiceStatusJob = {
    id: number;
    customerName: string;
    teamName: string;
    jobStatus: string | null;
    serviceDateTime: string | null;
    jobAddress: string | null;
    etaTimestamp: number | null;
    delayMinutes: number | null;
    updatedAt: string;
    jobDate: string;
  };
  const [voiceStatusJob, setVoiceStatusJob] = useState<VoiceStatusJob | null>(null);
  const [voiceStatusNotFound, setVoiceStatusNotFound] = useState<string | null>(null); // client name when no job found today
  const [voiceRemindTime, setVoiceRemindTime] = useState<string>(""); // time expression from LLM e.g. "30 minutes"
  const [voiceConfirmScenario, setVoiceConfirmScenario] = useState<string | null>(null);
  const [voiceSending, setVoiceSending] = useState(false);
  const [voiceSearchQuery, setVoiceSearchQuery] = useState("");
  const [voiceNeedsSearch, setVoiceNeedsSearch] = useState(false);
  // Voice call state (mirrors AICallPanel exactly)
  type VoiceCallStatus = "idle" | "firing" | "queued" | "ringing" | "in_progress" | "completed" | "voicemail" | "no_answer" | "failed";
  const [voiceCallStatus, setVoiceCallStatus] = useState<VoiceCallStatus>("idle");
  const [voiceCallVapiId, setVoiceCallVapiId] = useState<string | null>(null);
  const [voiceCallSummary, setVoiceCallSummary] = useState<string | null>(null);
  const [voiceCallTranscript, setVoiceCallTranscript] = useState<string | null>(null);
  const [voiceCallRecordingUrl, setVoiceCallRecordingUrl] = useState<string | null>(null);
  const [voiceCallShowTranscript, setVoiceCallShowTranscript] = useState(false);
  const [voiceCardMinimized, setVoiceCardMinimized] = useState(false);
  const voiceCallPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceCallContactNameRef = useRef<string | null>(null);
  const voiceCallContactPhoneRef = useRef<string | null>(null);
  const voiceCallScriptRef = useRef<string | null>(null);
  const voiceCallUtils = trpc.useUtils();
  // startCall mutation — verbatim from AICallPanel
  const voiceStartCallMutation = trpc.callMatrix.startCall.useMutation({
    onSuccess: (result) => {
      if (result.vapiCallId) {
        setVoiceCallVapiId(result.vapiCallId);
        setVoiceCallStatus("queued");
        // Start polling — verbatim from AICallPanel.startPolling
        if (voiceCallPollRef.current) clearInterval(voiceCallPollRef.current);
        voiceCallPollRef.current = setInterval(async () => {
          try {
            const poll = await voiceCallUtils.callMatrix.pollCall.fetch({ vapiCallId: result.vapiCallId! });
            const s = poll.status as VoiceCallStatus;
            setVoiceCallStatus(s);
            if (poll.summary) setVoiceCallSummary(poll.summary);
            if (poll.transcript) setVoiceCallTranscript(poll.transcript);
            if (poll.recordingUrl) setVoiceCallRecordingUrl(poll.recordingUrl);
            if (s === "completed" || s === "voicemail" || s === "no_answer" || s === "failed") {
              if (voiceCallPollRef.current) clearInterval(voiceCallPollRef.current);
              voiceCallPollRef.current = null;
              // Post voice_call_completed card server-side
              postVoiceCallCard.mutate({
                contactName: voiceCallContactNameRef.current ?? "Client",
                contactPhone: voiceCallContactPhoneRef.current ?? "",
                triggeredBy: callerName,
                script: voiceCallScriptRef.current ?? "",
                outcome: s as "completed" | "voicemail" | "no_answer" | "failed",
                summary: poll.summary ?? undefined,
                durationSeconds: poll.durationSeconds ?? undefined,
              });
            }
          } catch { /* ignore */ }
        }, 5000);
      } else {
        setVoiceCallStatus("failed");
        toast.error("Call failed to start");
      }
    },
    onError: (err) => {
      setVoiceCallStatus("failed");
      toast.error(`Call error: ${err.message}`);
    },
  });
  // Cleanup poll on unmount
  useEffect(() => () => { if (voiceCallPollRef.current) clearInterval(voiceCallPollRef.current); }, []);
  const { data: voiceSearchResults = [] } = trpc.opsChat.searchClients.useQuery(
    { query: voiceSearchQuery },
    { enabled: !!voiceConfirm && voiceSearchQuery.trim().length >= 2 }
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.start(100);
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    } catch {
      toast.error("Microphone access denied");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setIsTranscribing(true);
    await new Promise<void>(resolve => {
      mr.onstop = () => resolve();
      mr.stop();
      mr.stream.getTracks().forEach(t => t.stop());
    });
    try {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const { text } = await transcribeVoice.mutateAsync({ dataBase64, mimeType: "audio/webm" });
      setComposer(prev => prev ? prev + " " + text : text);
      toast.success("Voice note transcribed");
    } catch {
      toast.error("Transcription failed");
    } finally {
      setIsTranscribing(false);
    }
    }, [transcribeVoice]);

  // ── Push-to-talk (PTT) — Ctrl+Shift+Space or hold mic button ─────────────────
  const [isPttActive, setIsPttActive] = useState(false);
  const isPttActiveRef = useRef(false); // ref for stale-closure-safe keyup handler

  // Like stopRecording but auto-submits the transcript instead of filling the composer
  const stopRecordingAndSend = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setIsPttActive(false);
    isPttActiveRef.current = false;
    setIsTranscribing(true);
    await new Promise<void>(resolve => {
      mr.onstop = () => resolve();
      mr.stop();
      mr.stream.getTracks().forEach(t => t.stop());
    });
    try {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const { text } = await transcribeVoice.mutateAsync({ dataBase64, mimeType: "audio/webm" });
      if (!text.trim()) return;

      // Route through voice command intent detection
      const result = await voiceCommandMutation.mutateAsync({ transcript: text.trim() });

      // Clear any previous unknown/status state
      setVoiceUnknown(null);
      setVoiceStatusJob(null);
      setVoiceStatusNotFound(null);

      if (result.action === "remind") {
        // Show reminder confirmation card — no contact lookup needed
        setVoiceConfirmAction("remind");
        setVoiceConfirmMsg(result.message ?? "");
        setVoiceRemindTime((result as any).scenario ?? "30 minutes");
        setVoiceConfirm({
          message: result.message ?? "",
          matches: [],
          selected: null,
        });
        setVoiceNeedsSearch(false);
        setVoiceCallStatus("idle");
        setVoiceCallVapiId(null);
        return;
      }

      if ((result.action === "text" || result.action === "call") && result.matches.length > 0 && result.message) {
        // Show confirmation card — message is already written in friendly quality by the server
        setVoiceConfirmMsg(result.message);
        setVoiceConfirmAction(result.action as "text" | "call");
        setVoiceConfirmScenario((result as any).scenario ?? null);
        setVoiceConfirm({
          message: result.message,
          matches: result.matches,
          selected: result.matches.length === 1 ? result.matches[0] : null,
        });
        setVoiceTone("friendly");
        // Reset call state for new card
        setVoiceCallStatus("idle");
        setVoiceCallVapiId(null);
        setVoiceCallSummary(null);
        setVoiceCallTranscript(null);
        setVoiceCallRecordingUrl(null);
      } else if ((result.action === "text" || result.action === "call") && result.needsSearch && result.message) {
        // No client found — show search card so user can find the contact manually
        setVoiceNeedsSearch(true);
        setVoiceSearchQuery("");
        setVoiceConfirmMsg(result.message);
        setVoiceConfirmAction(result.action as "text" | "call");
        setVoiceConfirmScenario((result as any).scenario ?? null);
        setVoiceConfirm({
          message: result.message,
          matches: [],
          selected: null,
        });
        setVoiceCallStatus("idle");
        setVoiceCallVapiId(null);
        setVoiceCallSummary(null);
        setVoiceCallTranscript(null);
        setVoiceCallRecordingUrl(null);
      } else if (result.action === "chat") {
        // Explicit chat post — send to ops chat channel
        onSendMessage(result.message ?? text.trim());
        toast.success("Posted to chat");
      } else if (result.action === "status") {
        const r = result as any;
        if (r.statusNotFound) {
          setVoiceStatusNotFound(r.detectedName ?? text.trim());
        } else {
          setVoiceStatusJob(r.statusJob);
        }
      } else {
        // Unknown / unrecognized command — show inline error, do NOT post anything
        setVoiceUnknown(text.trim());
      }
    } catch {
      toast.error("Transcription failed");
    } finally {
      setIsTranscribing(false);
    }
  }, [transcribeVoice, voiceCommandMutation, onSendMessage]);

  // Global keyboard shortcut: hold Ctrl+Shift+Space to record, release to send
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space" && e.ctrlKey && e.shiftKey && !e.repeat && !isPttActiveRef.current) {
        e.preventDefault();
        isPttActiveRef.current = true;
        setIsPttActive(true);
        startRecording();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space" && isPttActiveRef.current) {
        e.preventDefault();
        stopRecordingAndSend();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [startRecording, stopRecordingAndSend]);

    // ── Scroll behaviour ─────────────────────────────────────────────────────────
  // Guard: when OpsChat overlay is display:none, scrollHeight = 0.
  // Only scroll when visible. On first open: jump to bottom.
  // On new messages: only scroll if user is already near the bottom (preserve reading position).
  //
  // IMPORTANT: We use double-rAF (requestAnimationFrame inside requestAnimationFrame).
  // The first rAF fires after React commits the new DOM node.
  // The second rAF fires after the browser has finished layout/paint for that frame,
  // so scrollHeight is fully updated and the scroll lands with the message fully visible.

  const initialScrollDone = useRef(false);
  const prevMsgLen = useRef(0);

  // "New message" toast — shown when a message arrives while scrolled up
  const [cmdNewMsgToast, setCmdNewMsgToast] = useState<{ from: string } | null>(null);
  const cmdToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showCmdToast(from: string) {
    if (cmdToastTimer.current) clearTimeout(cmdToastTimer.current);
    setCmdNewMsgToast({ from });
    cmdToastTimer.current = setTimeout(() => setCmdNewMsgToast(null), 6000);
  }

  function dismissCmdToast() {
    if (cmdToastTimer.current) clearTimeout(cmdToastTimer.current);
    setCmdNewMsgToast(null);
    threadBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  // ── @mention awareness ───────────────────────────────────────────────────────
  // localStorage key: cmd_lastSeenMsgId_{callerName}
  // Tracks the highest message id the agent has "seen" in Command Chat.
  // Any message with id > lastSeen that contains @callerName is an unread tag.
  const lsKey = `cmd_lastSeenMsgId_${callerName}`;

  // Unread tagged message ids (messages that @mention callerName and arrived after lastSeen)
  const [unreadTagIds, setUnreadTagIds] = useState<number[]>(() => []);
  // Mention history drawer state
  const [showMentionHistory, setShowMentionHistory] = useState(false);
  const [showCallPanel, setShowCallPanel] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  // Live floating pill: shown when a new @mention arrives while the panel IS visible
  const [livePill, setLivePill] = useState<{ from: string; body: string } | null>(null);
  const livePillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTagCountRef = useRef(-1); // -1 = not yet initialized, suppresses pill on first load

  // All names the current user might go by (handles OAuth name vs DB name mismatch)
  const effectiveNames = useMemo(() => {
    const s = new Set<string>(myNamesProp ?? []);
    if (callerName) s.add(callerName);
    return s;
  }, [myNamesProp, callerName]);

  // Build a combined regex that matches @AnyOfMyNames
  const mentionPattern = useMemo(() => {
    if (effectiveNames.size === 0) return null;
    const alts = Array.from(effectiveNames)
      .map(n => n.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'))
      .join('|');
    return new RegExp(`@(${alts})(?:\\b|\\s|$)`, 'i');
  }, [effectiveNames]);

  // ALL messages that mention the current user (not just unread) — used for the history drawer
  const allMentions = useMemo(() => {
    if (!mentionPattern) return [];
    return channelMsgs
      .filter(m => !effectiveNames.has(m.from) && mentionPattern.test(m.body))
      .slice() // copy before reversing
      .reverse(); // newest first
  }, [channelMsgs, mentionPattern, effectiveNames]);

  // Compute unread tagged messages whenever channelMsgs changes
  useEffect(() => {
    if (!mentionPattern || channelMsgs.length === 0) return;
    let lastSeen = 0;
    try { lastSeen = parseInt(localStorage.getItem(lsKey) ?? "0", 10) || 0; } catch {}
    const tagged = channelMsgs.filter(
      m => m.id > lastSeen && !effectiveNames.has(m.from) && mentionPattern.test(m.body)
    );
    setUnreadTagIds(tagged.map(m => m.id));

    // Detect newly arrived tag while panel is visible → show live pill
    // prevTagCountRef starts at -1 to suppress pill on initial load
    const newCount = tagged.length;
    if (isVisible && prevTagCountRef.current >= 0 && newCount > prevTagCountRef.current) {
      const newest = tagged[tagged.length - 1];
      if (newest) {
        if (livePillTimer.current) clearTimeout(livePillTimer.current);
        setLivePill({ from: newest.from, body: newest.body });
        livePillTimer.current = setTimeout(() => setLivePill(null), 7000);
      }
    }
    prevTagCountRef.current = newCount;
  }, [channelMsgs, mentionPattern, effectiveNames, isVisible, lsKey]);

  // Mark all @mentions as seen (called on banner X dismiss)
  function markTagsSeen() {
    const maxId = channelMsgs.reduce((m, msg) => Math.max(m, msg.id), 0);
    try { localStorage.setItem(lsKey, String(maxId)); } catch {}
    setUnreadTagIds([]);
    if (livePillTimer.current) clearTimeout(livePillTimer.current);
    setLivePill(null);
    prevTagCountRef.current = 0;
  }

  // Jump to the FIRST unread mention, then remove it from the queue.
  // Saves that ID as the new lastSeen floor only if it’s the last remaining mention.
  // This way the count decrements 15 → 14 → … → 0 one jump at a time.
  function jumpToNextMention() {
    if (unreadTagIds.length === 0) return;
    const [firstId, ...rest] = unreadTagIds;
    scrollToCmdMsg(firstId);
    if (rest.length === 0) {
      // Last mention consumed — mark all seen
      markTagsSeen();
    } else {
      // Still more to go — just remove the first one from the queue
      // Save firstId as the new floor so it won’t reappear on remount
      try { localStorage.setItem(lsKey, String(firstId)); } catch {}
      setUnreadTagIds(rest);
    }
  }

  // When panel becomes visible, auto-mark tags as seen after a short delay
  // (gives the user a moment to notice the banner before it disappears)
  const wasVisible = useRef(isVisible);
  useEffect(() => {
    if (isVisible && !wasVisible.current && unreadTagIds.length > 0) {
      // Panel just became visible with pending tags — leave banner up so user can act
    }
    wasVisible.current = isVisible;
  }, [isVisible, unreadTagIds.length]);

  // Returns true if the scroll container is within 250px of the bottom.
  // 250px threshold (vs old 150px) ensures we catch cases where the compose
  // box is tall or the last message is partially visible.
  function isCmdNearBottom(el: HTMLDivElement) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 250;
  }

  // When the composer textarea grows (multi-line typing) OR when the scroll container
  // Single source of truth for scrolling: a MutationObserver on the messages container.
  // Whenever a child node is added (new message), immediately set scrollTop = scrollHeight.
  // This fires synchronously after DOM mutation, before paint, so it's always accurate.
  const msgsContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = threadScrollRef.current;
    const msgsDiv = msgsContainerRef.current;
    if (!container || !msgsDiv) return;
    // Initial scroll to bottom
    container.scrollTop = container.scrollHeight;
    // Observe child additions (new messages).
    // Only auto-scroll if the user is already near the bottom (scroll-lock pattern).
    const mo = new MutationObserver(() => {
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 250;
      if (nearBottom) {
        container.scrollTop = container.scrollHeight;
      } else {
        setNewMsgCount(n => n + 1);
      }
    });
    mo.observe(msgsDiv, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  // NOTE: Notification sound + OS notification for command channel messages is handled
  // exclusively by OpsChat.tsx (the parent) via useTabLeader to prevent duplicates.
  // CommandChat.tsx intentionally does NOT fire its own notifications.

   // ── Unclaimed leads (badge/highlight only — repeating sound removed) ───────
  const unclaimedLeads = useMemo(() => {
    return channelMsgs.filter(m => {
      if (m.quickAction !== "new_lead") return false;
      try {
        const meta = JSON.parse(m.metadata ?? "{}");
        return !meta.claimedBy;
      } catch { return false; }
    });
  }, [channelMsgs]);

  // ── Today's Revenue ticker — same query as leads page Booked Revenue card ──
  // todayDateStr must update at ET midnight so the query rolls over to the new day.
  // We recompute it every minute; when the date string changes the query input
  // changes and tRPC automatically re-fetches with the new date.
  const [todayDateStr, setTodayDateStr] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })
  );
  useEffect(() => {
    const id = setInterval(() => {
      const next = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      setTodayDateStr(prev => (prev !== next ? next : prev));
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  const { data: todayStats } = trpc.leads.stats.useQuery(
    { dateFrom: todayDateStr, dateTo: todayDateStr },
    { refetchInterval: 60_000 }
  );
  const todayRevenue = todayStats?.bookedRevenue ?? 0;
  const todayBookingCount = todayStats?.bookedCount ?? 0;

  // My Assigned Leads Today panel
  const [showMyLeads, setShowMyLeads] = useState(false);
  const { data: myAssignedLeads = [] } = trpc.leads.myAssignedLeadsToday.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // AI Call Command Center — today's call count for badge
  const { data: todayCallLog = [] } = trpc.calls.getCallLog.useQuery(
    { jobDate: todayDateStr, limit: 100 },
    { refetchInterval: 30_000, staleTime: 15_000 }
  );
  const todayCallCount = todayCallLog.length;
  // Map cleanerJobId → most recent firedAt for the "called at" indicator on team cards
  const callLogByJobId = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of todayCallLog) {
      if (entry.cleanerJobId == null || entry.firedAt == null) continue;
      const jobId = entry.cleanerJobId as number;
      const firedAt = entry.firedAt as number;
      const existing = map.get(jobId);
      if (existing == null || firedAt > existing) {
        map.set(jobId, firedAt);
      }
    }
    return map;
  }, [todayCallLog]);
  const snapshot = cmdData?.snapshot ?? { issue: 0, soon: 0, progress: 0, complete: 0, assigned: 0 };
  const alerts = cmdData?.alerts ?? [];
  const pinnedJobs = cmdData?.pinnedJobs ?? [];
  const autoRaised = cmdData?.autoRaised ?? [];
  const manualIssues = cmdData?.manualIssues ?? [];
  const pendingReminderCount = cmdData?.pendingReminderCount ?? 0;
  const unassignedJobs = cmdData?.unassignedJobs ?? [];
  const cleanerStatuses = [...(cmdData?.cleanerStatuses ?? [])].sort((a, b) => a.ts - b.ts).filter(cs => {
    // Keep completed cards until midnight EST
    if (cs.status === "completed") {
      const now = new Date();
      const midnightEst = new Date(now.toLocaleDateString("en-US", { timeZone: "America/New_York" }));
      midnightEst.setDate(midnightEst.getDate() + 1);
      return cs.ts < midnightEst.getTime();
    }
    return true;
  });

  const totalAlerts = snapshot.issue + snapshot.soon;

  // ── Issue ownership — DB-backed ──────────────────────────────────────────
  // Build stable issueKeys for all current issues
  const allIssueKeys = useMemo(() => [
    ...alerts.filter(a => a.type !== "general_issue").map(a => `alert-${a.jobId}-${a.ts}`),
    ...manualIssues.map(m => `manual-${m.messageId}`),
  ], [alerts, manualIssues]);

  // Stable serialized key so tRPC doesn't see a new input object every render
  const allIssueKeysStr = useMemo(() => [...allIssueKeys].sort().join(","), [allIssueKeys]);
  const allIssueKeysParsed = useMemo(() => allIssueKeysStr ? allIssueKeysStr.split(",") : [], [allIssueKeysStr]);
  // Unresolved count for badge — computed outside JSX to avoid IIFE re-renders
  const unresolvedIssueCount = useMemo(
    () => allIssueKeys.filter(k => !issueResolved[k]).length,
    [allIssueKeys, issueResolved]
  );

  const { data: ownershipRows = [], refetch: refetchOwnership } = trpc.opsChat.getIssueOwnership.useQuery(
    { issueKeys: allIssueKeysParsed },
    { enabled: allIssueKeysParsed.length > 0, staleTime: 10_000, refetchInterval: 15_000 }
  );

  // Sync DB rows into local state — use a stable serialized key to avoid infinite loops
  const ownershipRowsKey = useMemo(
    () => ownershipRows.map(r => `${r.issueKey}:${r.claimedBy ?? ""}:${r.resolvedAt ?? ""}`).join("|"),
    [ownershipRows]
  );
  useEffect(() => {
    const owners: Record<string, string> = {};
    const resolved: Record<string, boolean> = {};
    for (const row of ownershipRows) {
      if (row.claimedBy) owners[row.issueKey] = row.claimedBy;
      if (row.resolvedAt) resolved[row.issueKey] = true;
    }
    setIssueOwners(owners);
    setIssueResolved(resolved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownershipRowsKey]);

  const claimIssueMutation = trpc.opsChat.claimIssue.useMutation({
    onSuccess: () => refetchOwnership(),
  });
  const resolveIssueOwnershipMutation = trpc.opsChat.resolveIssueOwnership.useMutation({
    onSuccess: () => refetchOwnership(),
  });
  const addIssueCommentMutation = trpc.opsChat.addIssueComment.useMutation();
  function doSend() {
    const donePhotos = stagedPhotos.filter(p => p.status === "done" && p.s3Url);
    const mediaUrl = donePhotos.length > 0 ? JSON.stringify(donePhotos.map(p => p.s3Url!)) : undefined;
    let body = composer.trim() || (donePhotos.length > 0 ? "Photo" : "");

    onSendMessage(body, mediaUrl, replyTo ?? undefined);
    setComposer("");
    setReplyTo(null);
    setStagedPhotos(prev => { prev.forEach(p => URL.revokeObjectURL(p.previewUrl)); return []; });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        threadBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    });
  }

  function handleSend() {
    const hasText = composer.trim().length > 0;
    const donePhotos = stagedPhotos.filter(p => p.status === "done" && p.s3Url);
    const uploadingPhotos = stagedPhotos.filter(p => p.status === "uploading" || p.status === "pending");
    if (!hasText && donePhotos.length === 0) { return; }
    if (uploadingPhotos.length > 0) {
      toast.error("Please wait for photos to finish uploading");
      return;
    }
    doSend();
  }

  // ── Panel resize & collapse ──────────────────────────────────────────────
  const MIN_LEFT  = 200;
  const MAX_LEFT  = 420;
  const MIN_RIGHT = 180;
  const MAX_RIGHT = 400;
  const MIN_CENTER = 380;

  const [leftWidth, setLeftWidth] = useState<number>(() => {
    try { const v = localStorage.getItem("cmd_leftWidth"); return v ? Math.max(MIN_LEFT, Math.min(MAX_LEFT, Number(v))) : 300; } catch { return 300; }
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    try { const v = localStorage.getItem("cmd_rightWidth"); return v ? Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, Number(v))) : 280; } catch { return 280; }
  });
  const [leftCollapsed] = useState<boolean>(false);
  const [awayOpen, setAwayOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);
  // Right column is always visible — never collapsed
  const rightCollapsed = false;

  const containerRef = useRef<HTMLDivElement>(null);

  // Persist to localStorage whenever values change
  useEffect(() => { try { localStorage.setItem("cmd_leftWidth",  String(leftWidth));  } catch {} }, [leftWidth]);
  useEffect(() => { try { localStorage.setItem("cmd_rightWidth", String(rightWidth)); } catch {} }, [rightWidth]);
  // left panel is always open
  // Clear any stale rightCollapsed value from localStorage so it never re-hides the panel
  useEffect(() => { try { localStorage.removeItem("cmd_rightCollapsed"); } catch {} }, []);

  // Drag handler factory
  function startDrag(side: "left" | "right") {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startLeft  = leftWidth;
      const startRight = rightWidth;
      const containerWidth = containerRef.current?.offsetWidth ?? window.innerWidth;

      function onMove(ev: MouseEvent) {
        const delta = ev.clientX - startX;
        if (side === "left") {
          const next = Math.max(MIN_LEFT, Math.min(MAX_LEFT, startLeft + delta));
          // Ensure center doesn't shrink below MIN_CENTER
          const centerAvail = containerWidth - next - (rightCollapsed ? 0 : rightWidth) - 8; // 8px for handles
          if (centerAvail >= MIN_CENTER) setLeftWidth(next);
        } else {
          const next = Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, startRight - delta));
          const centerAvail = containerWidth - (leftCollapsed ? 0 : leftWidth) - next - 8;
          if (centerAvail >= MIN_CENTER) setRightWidth(next);
        }
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };
  }

  return (
    <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">
      {showGlitter && <GlitterBurst onDone={() => { glitterRunning.current = false; setShowGlitter(false); }} />}

      {/* ── My Assigned Leads Modal ────────────────────────────────────────────────────────────────────────────────── */}
      {showMyLeads && (() => {
        const myAgent = agentList?.find(a => a.name === callerName);
        const bookedLeads = myAssignedLeads.filter(l => l.isBooked);
        const notBookedLeads = myAssignedLeads.filter(l => !l.isBooked);
        const totalValue = bookedLeads.reduce((s, l) => s + l.estimatedValue, 0);
        const fmt = (d: Date | null) =>
          d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
        const srcLabel = (s: string | null) => {
          if (!s) return '';
          const m: Record<string, string> = { thumbtack: 'Thumbtack', google: 'Google', yelp: 'Yelp', bark: 'Bark', 'bark-sms': 'Bark', phone: 'Phone', other: 'Other' };
          return m[s.toLowerCase()] ?? s;
        };
        return (
          <div className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center" onClick={() => setShowMyLeads(false)}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
              className="relative z-10 w-full max-w-lg mx-4 rounded-3xl bg-white shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  {myAgent?.photoUrl ? (
                    <img src={myAgent.photoUrl} alt={callerName} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-black text-sm">
                      {callerName.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div className="font-black text-slate-900 text-base">{callerName}</div>
                    <div className="text-xs text-slate-400">{myAssignedLeads.length} leads today · ${totalValue.toLocaleString()} booked</div>
                  </div>
                </div>
                <button onClick={() => setShowMyLeads(false)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                  <X className="w-4 h-4 text-slate-600" />
                </button>
              </div>
              {/* Body */}
              <div className="overflow-y-auto flex-1 px-4 py-4 space-y-2">
                {myAssignedLeads.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-sm">No leads assigned today</div>
                ) : (
                  myAssignedLeads.map(lead => (
                    <div key={lead.id} className={`rounded-2xl border p-4 ${
                      lead.isBooked ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-slate-900 text-sm truncate">{lead.leadName}</span>
                            {lead.isBooked && (
                              <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black text-white">Booked</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                            {lead.leadSource && <span>{srcLabel(lead.leadSource)}</span>}
                            <span>Arrived {fmt(lead.createdAt)}</span>
                            {lead.firstCallAt && <span>Called {fmt(lead.firstCallAt)}</span>}
                            {lead.bookedAt && <span>Booked {fmt(lead.bookedAt)}</span>}
                          </div>
                          {lead.internalNotes && (
                            <div className="mt-2 text-[11px] text-slate-600 bg-white rounded-xl px-3 py-2 border border-slate-200">
                              {lead.internalNotes}
                            </div>
                          )}
                        </div>
                        {lead.estimatedValue > 0 && (
                          <div className="shrink-0 text-right">
                            <div className="font-black text-slate-900 text-sm">${lead.estimatedValue.toLocaleString()}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
              {/* Footer */}
              {myAssignedLeads.length > 0 && (
                <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex gap-4 text-xs text-slate-500">
                    <span><span className="font-black text-emerald-600">{bookedLeads.length}</span> booked</span>
                    <span><span className="font-black text-slate-700">{notBookedLeads.length}</span> not booked</span>
                  </div>
                  <div className="text-sm font-black text-slate-900">${totalValue.toLocaleString()} total</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Lead assignment overlay is now handled globally by LeadAssignmentWatcher in App.tsx */}

      {/* ── Super-Alert Blocking Overlay ──────────────────────────────────────── */}
      {activeSuperAlert && (
        <div className="absolute inset-0 z-[9998] flex items-center justify-center" style={{ background: "rgba(30, 10, 60, 0.88)" }}>
          <div
            className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden shadow-2xl"
            style={{ animation: "pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite", border: "3px solid #a855f7" }}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 bg-purple-600">
              <Zap className="h-5 w-5 text-yellow-300 shrink-0" />
              <span className="text-sm font-bold text-white uppercase tracking-wider">⚡ Super-Alert from {activeSuperAlert.senderName}</span>
            </div>
            {/* Body */}
            <div className="px-5 py-4 bg-purple-50">
              <div className="mb-4 rounded-xl bg-white border border-purple-200 px-4 py-3 shadow-sm">
                <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{activeSuperAlert.messageBody}</p>
              </div>
              <p className="text-xs text-purple-700 font-medium mb-4">You must reply before you can continue.</p>
              <button
                disabled={acknowledgeSuperAlertMutation.isPending}
                onClick={() => {
                  acknowledgeSuperAlertMutation.mutate({ alertId: activeSuperAlert.id });
                  // Pre-fill reply-to so the composer is in reply mode
                  setReplyTo({
                    id: activeSuperAlert.messageId,
                    body: activeSuperAlert.messageBody,
                    author: activeSuperAlert.senderName,
                  });
                  // Focus the composer
                  setTimeout(() => composerRef.current?.focus(), 100);
                }}
                className="w-full rounded-xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-bold py-3 text-sm transition flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {acknowledgeSuperAlertMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                Reply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
          onKeyDown={(e) => { if (e.key === "Escape") setLightboxUrl(null); }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center text-white transition-colors"
            aria-label="Close photo"
          >
            <X className="w-5 h-5" />
          </button>
          {/* Open in new tab */}
          <a
            href={lightboxUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-4 right-16 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center text-white transition-colors"
            aria-label="Open full size"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          {/* Image — stop propagation so clicking the image doesn't close */}
          <img
            src={lightboxUrl && lightboxUrl.includes(".r2.dev/") ? `/api/media-proxy?url=${encodeURIComponent(lightboxUrl)}` : lightboxUrl ?? undefined}
            alt="Full size"
            className="max-h-[90vh] max-w-[90vw] rounded-2xl shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── LEFT PANEL: Ops Snapshot + Live Alerts ── */}
      <div
        className="shrink-0 flex flex-col overflow-hidden transition-[width] duration-200"
        style={{ width: leftCollapsed ? 0 : leftWidth, minWidth: leftCollapsed ? 0 : MIN_LEFT, overflow: leftCollapsed ? "hidden" : undefined }}
      >
        {/* Single scrollable area — header + content all scroll together */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          {/* Design card: rounded-[32px] border backdrop-blur */}
          <div className="rounded-[32px] border border-white/70 bg-white/80 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur overflow-hidden">
          <div className="px-6 pt-6 pb-5">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">General Command Chat</p>
                <h2 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">Ship Control</h2>
              </div>
            </div>

            {/* 4 Stat Tiles */}
            {cmdLoading ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 mb-4">
                {/* Needs action */}
                <div className="rounded-2xl border bg-gradient-to-br from-rose-500/15 to-rose-500/5 border-rose-200 p-3.5">
                  <p className="text-xs font-semibold text-rose-700">Needs action</p>
                  <p className="mt-1.5 text-3xl font-semibold tracking-tight text-rose-700">{snapshot.issue}</p>
                </div>
                {/* In progress */}
                <div className="rounded-2xl border bg-gradient-to-br from-sky-500/15 to-sky-500/5 border-sky-200 p-3.5">
                  <p className="text-xs font-semibold text-sky-700">In progress</p>
                  <p className="mt-1.5 text-3xl font-semibold tracking-tight text-sky-700">{snapshot.progress}</p>
                </div>
                {/* Starting soon */}
                <div className="rounded-2xl border bg-gradient-to-br from-amber-500/15 to-amber-500/5 border-amber-200 p-3.5">
                  <p className="text-xs font-semibold text-amber-700">Starting soon</p>
                  <p className="mt-1.5 text-3xl font-semibold tracking-tight text-amber-700">{snapshot.soon}</p>
                </div>
                {/* Completed */}
                <div className="rounded-2xl border bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-200 p-3.5">
                  <p className="text-xs font-semibold text-emerald-700">Completed</p>
                  <p className="mt-1.5 text-3xl font-semibold tracking-tight text-emerald-700">{snapshot.complete}</p>
                </div>
              </div>
            )}

            {/* Command priority card — shows unassigned jobs as max-priority alert */}
            {unassignedJobs.length > 0 ? (
              <div className="mb-4 rounded-2xl border-2 border-red-500 bg-red-50 p-3.5 shadow-lg shadow-red-500/20 animate-pulse">
                <div className="mb-2 flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-600 text-white shadow-md shadow-red-500/30 shrink-0">
                    <TriangleAlert className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-red-700 uppercase tracking-wide">⚠ Unassigned Job</div>
                    <div className="text-[10px] font-semibold text-red-500 uppercase tracking-widest">Action required now</div>
                  </div>
                  <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unassignedJobs.length}</span>
                </div>
                <div className="space-y-2">
                  {unassignedJobs.slice(0, 2).map(job => (
                    <button
                      key={job.id}
                      onClick={() => onJumpToJob(job.id)}
                      className="w-full text-left rounded-xl border border-red-200 bg-white p-2.5 hover:bg-red-50 transition"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-xs font-bold text-red-700 leading-tight">{job.customerName}</span>
                        {job.startTime && (
                          <span className={cn(
                            "shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                            job.minutesUntil !== null && job.minutesUntil <= 60
                              ? "bg-red-600 text-white"
                              : "bg-red-100 text-red-700"
                          )}>{job.minutesUntil !== null && job.minutesUntil < 0 ? `${Math.abs(job.minutesUntil)}m ago` : job.startTime}</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] text-red-500 font-medium truncate">{job.jobAddress || job.serviceType}</div>
                      <div className="mt-1 text-[10px] font-bold text-red-600 uppercase tracking-widest">No team assigned → Tap to assign</div>
                    </button>
                  ))}
                  {unassignedJobs.length > 2 && (
                    <p className="text-[10px] text-red-500 font-semibold text-center">+{unassignedJobs.length - 2} more unassigned</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="mb-4 rounded-2xl border border-indigo-100 bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(255,255,255,0.7))] p-3.5">
                <div className="mb-1.5 flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-500/20">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="text-sm font-semibold">Command priority</div>
                </div>
                <p className="text-xs leading-5 text-slate-600">All jobs assigned. General chat stays lightweight — issues only appear when risk, money, or schedule confidence drops.</p>
              </div>
            )}

            {/* Chat / Issues tab switcher */}
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setLeftTab("chat"); setCenterView("chat"); }}
                  className={cn(
                    "rounded-[18px] px-4 py-3 text-sm font-semibold transition",
                    leftTab === "chat" ? "bg-slate-900 text-white shadow-lg shadow-slate-900/10" : "text-slate-500"
                  )}
                >
                  Command chat
                </button>
                <button
                  onClick={() => { setLeftTab("issues"); setCenterView("issues"); }}
                  className={cn(
                    "rounded-[18px] px-4 py-3 text-sm font-semibold transition relative",
                    leftTab === "issues" ? "bg-slate-900 text-white shadow-lg shadow-slate-900/10" : "text-slate-500"
                  )}
                >
                  Issues
                  {unresolvedIssueCount > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold min-w-[18px] h-[18px] px-1 leading-none bg-red-500 text-white">
                      {unresolvedIssueCount}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Rest of scrollable content */}
          <div className="px-4 pb-4 space-y-4">

          {/* Issues section — shown above Live Alerts when Issues tab is active */}
          {leftTab === "issues" && (() => {
            const allIssues: Array<{ key: string; title: string; body: string; sourceBody?: string | null; source: string; ts: number; type: "alert" | "manual" }> = [
              ...alerts
                .filter(a => a.type !== "general_issue")
                .map(a => ({ key: `alert-${a.jobId}-${a.ts}`, title: a.title, body: a.body, sourceBody: null, source: a.source, ts: a.ts, type: "alert" as const })),
              ...manualIssues.map(m => ({ key: `manual-${m.messageId}`, title: m.title, body: m.note ?? "", sourceBody: m.sourceBody ?? null, source: m.authorName, ts: m.ts, type: "manual" as const })),
            ].sort((a, b) => Number(b.ts) - Number(a.ts));
            if (allIssues.length === 0) return (
              <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
                <CheckCheck className="h-5 w-5 text-emerald-400 mx-auto mb-1" />
                <p className="text-xs text-slate-400">No open issues</p>
              </div>
            );
            return (
              <div>
                <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-2">Open Issues</p>
                <div className="space-y-2">
                  {allIssues.map(issue => {
                    const isResolved = issueResolved[issue.key];
                    const owner = issueOwners[issue.key];
                    return (
                      <div
                        key={issue.key}
                        className={cn(
                          "rounded-xl border p-3 transition",
                          isResolved ? "bg-emerald-50 border-emerald-100 opacity-60" : issue.type === "alert" ? "bg-red-50 border-red-100" : "bg-orange-50 border-orange-100"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className={cn("text-sm font-semibold leading-tight", isResolved ? "text-emerald-700 line-through" : issue.type === "alert" ? "text-red-700" : "text-orange-700")}>
                            {issue.title}
                          </p>
                          <span className={cn("text-[10px] font-medium shrink-0 mt-0.5", isResolved ? "text-emerald-400" : issue.type === "alert" ? "text-red-400" : "text-orange-400")}>
                            {fmt12(issue.ts)}
                          </span>
                        </div>
                        {issue.body && (
                          <p className={cn("text-xs mt-1 leading-snug", isResolved ? "text-emerald-600" : issue.type === "alert" ? "text-red-600" : "text-orange-600")}>
                            {issue.body}
                          </p>
                        )}
                        <div className="flex items-center justify-between mt-2 gap-2">
                          {owner ? (
                            <span className="text-[10px] font-semibold text-slate-500 border border-slate-200 rounded-full px-2 py-0.5">
                              Owner: {owner}
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{issue.source}</span>
                          )}
                          {!isResolved && (
                            <button
                              onClick={() => {
                                if (!owner) {
                                  setIssueOwners(prev => ({ ...prev, [issue.key]: callerName }));
                                  claimIssueMutation.mutate({ issueKey: issue.key, claimedBy: callerName });
                                } else {
                                  setResolveIssueKey(issue.key);
                                  setResolveIssueMessageId(null);
                                  setResolveIssueTitle(issue.title);
                                  setResolveIssueNote(issue.body ?? "");
                                  setResolveIssueNoteText("");
                                  setResolveIssueOpen(true);
                                }
                              }}
                              className={cn(
                                "text-[10px] font-semibold rounded-full px-2.5 py-1 transition shrink-0",
                                owner ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-slate-900 text-white hover:bg-slate-700"
                              )}
                            >
                              {owner ? "Resolve" : "Claim"}
                            </button>
                          )}
                          {isResolved && (
                            <span className="text-[10px] font-semibold text-emerald-600">Resolved ✓</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Live Alerts & Escalations */}
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-2">Live Alerts & Escalations</p>
            {cmdLoading ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
            ) : alerts.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
                <CheckCheck className="h-5 w-5 text-emerald-400 mx-auto mb-1" />
                <p className="text-xs text-slate-400">All clear — no active alerts</p>
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert, i) => {
                  // general_issue cards are shown in the right panel under "Manual Issues"
                  if (alert.type === "general_issue") return null;
                  const alertKey = `alert-${alert.jobId}-${alert.ts}`;
                  const isResolved = !!issueResolved[alertKey];
                  const owner = issueOwners[alertKey];
                  return (
                    <div
                      key={i}
                      onClick={() => !isResolved && onJumpToJob(alert.jobId)}
                      className={cn(
                        "w-full text-left rounded-xl border p-3 transition",
                        isResolved
                          ? "bg-emerald-50 border-emerald-100 opacity-60"
                          : alert.type === "issue"
                          ? "bg-red-50 border-red-100 hover:bg-red-100 hover:shadow-sm cursor-pointer"
                          : "bg-amber-50 border-amber-100 hover:bg-amber-100 hover:shadow-sm cursor-pointer"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn(
                          "text-sm font-semibold leading-tight",
                          isResolved ? "text-emerald-700 line-through" : alert.type === "issue" ? "text-red-700" : "text-amber-700"
                        )}>
                          {alert.title}
                        </p>
                        <span className={cn(
                          "text-[10px] font-medium shrink-0 mt-0.5",
                          isResolved ? "text-emerald-400" : alert.type === "issue" ? "text-red-500" : "text-amber-500"
                        )}>
                          {fmt12(alert.ts)}
                        </span>
                      </div>
                      <p className={cn(
                        "text-xs mt-1 leading-snug",
                        isResolved ? "text-emerald-600" : alert.type === "issue" ? "text-red-600" : "text-amber-600"
                      )}>
                        {alert.body}
                      </p>
                      <div className="flex items-center justify-between mt-1.5 gap-2">
                        <p className={cn(
                          "text-[10px] font-semibold uppercase tracking-wide",
                          isResolved ? "text-emerald-500" : alert.type === "issue" ? "text-red-400" : "text-amber-400"
                        )}>
                          {owner ? `Owner: ${owner}` : alert.source}
                        </p>
                        {isResolved && (
                          <span className="text-[10px] font-semibold text-emerald-600">Resolved ✓</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cleaner Status Updates */}
          {cleanerStatuses.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-2">Team Status</p>
              <div className="space-y-1.5">
                {cleanerStatuses.map((cs) => {
                  const etaTs = (cs as any).etaTimestamp as number | null;
                  const isStaleEta = cs.status === "on_the_way" && etaTs && etaTs < Date.now();
                  const isUrgent = cs.status === "issue_at_property" || cs.status === "running_late";
                  const isCompleted = cs.status === "completed";
                  // Detect auto-detected-from-SMS cards
                  const detectedFromSms = !!(cs as any).detectedFromSms;
                  const smsText: string | null = (cs as any).smsText ?? null;
                  const arrivalLine = etaTs && etaTs > Date.now()
                    ? `Arrives: ${new Date(etaTs).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })}`
                    : cs.etaLabel ? `ETA: ${cs.etaLabel}` : null;
                  const tooltipLines = [
                    `${cs.emoji} ${cs.cleanerName} — ${cs.label}`,
                    cs.customerName ? `Customer: ${cs.customerName}` : null,
                    cs.jobAddress ? `Address: ${cs.jobAddress}` : null,
                    arrivalLine,
                    isStaleEta ? `⚠️ ETA passed — check in` : null,
                    cs.issueNote ? `Issue: ${cs.issueNote}` : null,
                    detectedFromSms && smsText ? `SMS: "${smsText}"` : null,
                  ].filter(Boolean) as string[];
                  const cardBg = isUrgent
                    ? "bg-red-50 border-red-100 hover:bg-red-100"
                    : isStaleEta
                    ? "bg-amber-50 border-amber-200 hover:bg-amber-100"
                    : isCompleted
                    ? "bg-emerald-50 border-emerald-100 hover:bg-emerald-100"
                    : "bg-slate-50 border-slate-200 hover:bg-slate-100";
                  const nameColor = isUrgent ? "text-red-700" : isStaleEta ? "text-amber-700" : isCompleted ? "text-emerald-700" : "text-slate-700";
                  const subColor = isUrgent ? "text-red-500" : isStaleEta ? "text-amber-600" : isCompleted ? "text-emerald-600" : "text-slate-500";
                  return (
                    <Tooltip key={cs.id} delayDuration={300}>
                      <TooltipTrigger asChild>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => cs.cleanerJobId ? onJumpToJob(cs.cleanerJobId) : undefined}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') cs.cleanerJobId && onJumpToJob(cs.cleanerJobId); }}
                          className={`w-full text-left rounded-xl border px-3 py-2 transition hover:shadow-sm cursor-pointer ${cardBg}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm leading-none shrink-0">{cs.emoji}</span>
                              <span className={`text-xs font-semibold truncate ${nameColor}`}>
                                <span className="font-bold">{cs.cleanerName}</span>
                                <span className="font-normal"> — {cs.label}</span>
                              </span>
                              {isStaleEta && <span className="text-[10px] text-amber-500 shrink-0">⚠️</span>}
                              {/* Amber badge for auto-detected SMS cards */}
                              {detectedFromSms && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-100 text-amber-700 border border-amber-300 leading-none">
                                  📱 via SMS
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 shrink-0">{fmt12(cs.ts)}</span>
                          </div>
                          {(cs.customerName || cs.etaLabel || cs.issueNote) && (
                            <p className={`text-[11px] mt-0.5 truncate ${subColor}`}>
                              {cs.customerName && <span>{cs.customerName}</span>}
                              {cs.etaLabel && <span className="ml-1">· ETA {cs.etaLabel}</span>}
                              {cs.issueNote && cs.status === "issue_at_property" && <span className="ml-1">· {cs.issueNote}</span>}
                            </p>
                          )}
                          {/* AI Call Command Center — ⚠ button for any job with a cleanerJobId */}
                          {cs.cleanerJobId && (
                            <div className="mt-1.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIssueDialogJob({ id: cs.cleanerJobId!, date: todayDateStr });
                                }}
                                className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-orange-500 text-white hover:bg-orange-600 transition"
                                title="Raise issue & fire AI call"
                              >
                                <PhoneCall className="h-2.5 w-2.5" />
                                Call with AI
                              </button>
                              {callLogByJobId.has(cs.cleanerJobId!) && (
                                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                  <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
                                  Called {fmt12(callLogByJobId.get(cs.cleanerJobId!)!)}
                                </span>
                              )}

                            </div>
                          )}
                          {/* HIDDEN: "Call Client" button replaced by the ⚠ AI Call button above.
                               The underlying callClientRunningLate mutation, callConfirmState, clientCallDone,
                               and callingClientJobId state are all still present for easy revert.
                               To restore: uncomment the original block from git history. */}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-[240px] space-y-0.5 text-xs">
                        {tooltipLines.map((line, i) => (
                          <p key={i} className={i === 0 ? "font-semibold" : i === tooltipLines.length - 1 && detectedFromSms ? "text-amber-300 italic" : "text-slate-300"}>{line}</p>
                        ))}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          )}
          </div>{/* end inner content */}
          </div>{/* end white card */}
        </div>{/* end single scrollable area */}
      </div>
      {/* ── Left drag handle ── */}
      <div
        className="relative flex-none"
        style={{ width: leftCollapsed ? 0 : 12, cursor: leftCollapsed ? "default" : "col-resize", zIndex: 10 }}
        onMouseDown={leftCollapsed ? undefined : startDrag("left")}
      />

      {/* ── CENTER PANEL: Pinned Day Status + Conversation ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-slate-100 min-h-0" style={{ minWidth: MIN_CENTER }}>
        {/* White card wrapper with grey showing on sides */}
        <div className="bg-white rounded-2xl shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-3 pb-3 border-b border-slate-200 bg-slate-50 shadow-sm shrink-0">
          {/* Compact single-row header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900 leading-none mr-2">MIB Command</h2>
                  {/* Stat cards */}
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onSwitchToLeadOps?.()}
                        className="flex flex-col items-start px-3 py-1.5 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer min-w-[64px]"
                      >
                        <span className="text-lg font-bold text-blue-600 leading-tight">{todayStats?.total ?? 0}</span>
                        <span className="text-[9px] font-semibold tracking-widest text-slate-400 uppercase leading-none mt-0.5">New Leads</span>
                      </button>
                    </TooltipTrigger>
                    {todayStats?.leadList && todayStats.leadList.length > 0 && (
                      <TooltipContent side="bottom" align="start" className="p-0 overflow-hidden min-w-[220px] max-w-[300px] max-h-[360px] overflow-y-auto bg-[#0f1623] border border-white/10 shadow-xl rounded-xl">
                        <div className="px-3 py-2 border-b border-white/10 sticky top-0 bg-[#0f1623]">
                          <p className="text-[11px] font-semibold text-white">{todayStats.leadList.length} leads with phone</p>
                        </div>
                        <div className="divide-y divide-white/[0.06]">
                          {todayStats.leadList.map((lead, i) => (
                            <div key={i} className="px-3 py-1.5 flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] text-white/80 truncate">{lead.leadName}</p>
                                <p className="text-[10px] text-white/40 font-mono">{lead.leadPhone}</p>
                              </div>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${lead.isBooked ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-white/40'}`}>
                                {lead.isBooked ? '✓ booked' : 'open'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </TooltipContent>
                    )}
                  </Tooltip>
                  {/* Booked card */}
                  {(() => {
                    const byAgent: Record<string, number> = {};
                    (todayStats?.bookedList ?? []).forEach(b => {
                      const name = b.bookedByAgentName ?? 'Unassigned';
                      byAgent[name] = (byAgent[name] ?? 0) + 1;
                    });
                    const agentEntries = Object.entries(byAgent).sort((a, b) => b[1] - a[1]);
                    return (
                      <Tooltip delayDuration={150}>
                        <TooltipTrigger asChild>
                          <span className="flex flex-col items-start px-3 py-1.5 bg-white border border-slate-200 rounded-xl cursor-default min-w-[56px]">
                            <span className="text-lg font-bold text-emerald-600 leading-tight">{todayBookingCount}</span>
                            <span className="text-[9px] font-semibold tracking-widest text-slate-400 uppercase leading-none mt-0.5">Booked</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="start" className="p-0 overflow-hidden min-w-[180px] bg-[#0f1623] border border-white/10 shadow-xl rounded-xl">
                          <div className="px-3 py-2 border-b border-white/10">
                            <p className="text-[11px] font-semibold text-white">Bookings by agent</p>
                          </div>
                          <div className="divide-y divide-white/[0.06]">
                            {agentEntries.map(([name, count]) => (
                              <div key={name} className="px-3 py-1.5 flex items-center justify-between gap-4">
                                <span className="text-[11px] text-white/80 truncate">{name}</span>
                                <span className="text-[11px] font-bold text-emerald-400 shrink-0">{count}</span>
                              </div>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })()}
                  {/* CVR card */}
                  {(todayStats?.total ?? 0) > 0 && (
                    <span className="flex flex-col items-start px-3 py-1.5 bg-white border border-slate-200 rounded-xl cursor-default min-w-[56px]">
                      <span className="text-lg font-bold text-blue-500 leading-tight">{Math.round((todayBookingCount / (todayStats?.total ?? 1)) * 100)}%</span>
                      <span className="text-[9px] font-semibold tracking-widest text-slate-400 uppercase leading-none mt-0.5">CVR</span>
                    </span>
                  )}
                  {/* Revenue card */}
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <span className="flex flex-col items-start px-3 py-1.5 bg-white border border-slate-200 rounded-xl cursor-default min-w-[72px]">
                        <span className="text-lg font-bold text-emerald-600 leading-tight">${todayRevenue.toLocaleString()}</span>
                        <span className="text-[9px] font-semibold tracking-widest text-slate-400 uppercase leading-none mt-0.5">Today</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="end" className="p-0 overflow-hidden min-w-[230px] max-w-[290px] bg-[#0f1623] border border-white/10 shadow-xl rounded-xl">
                      <div className="px-3 py-2.5 border-b border-white/10">
                        <p className="text-[12px] font-semibold text-white">${todayRevenue.toLocaleString()} booked today</p>
                        <p className="text-[10px] text-white/50">{todayBookingCount} booking{todayBookingCount !== 1 ? 's' : ''}</p>
                      </div>
                      {todayStats?.bookedList && todayStats.bookedList.length > 0 ? (
                        <div className="divide-y divide-white/[0.06]">
                          {todayStats.bookedList.map((b, i) => (
                            <div key={i} className="px-3 py-2 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium text-white truncate">{b.leadName}</p>
                                {b.bookedByAgentName && (
                                  <p className="text-[10px] text-white/40 truncate">by {b.bookedByAgentName}</p>
                                )}
                              </div>
                              <span className="text-[11px] font-semibold text-emerald-400 shrink-0">${b.amount.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="px-3 py-2.5 text-[11px] text-white/40">No bookings yet today</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                  {/* My leads button — only when assigned */}
                  {myAssignedLeads.length > 0 && (
                    <button
                      onClick={() => setShowMyLeads(v => !v)}
                      className="flex flex-col items-start px-3 py-1.5 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer min-w-[56px]"
                    >
                      <span className="text-lg font-bold text-amber-500 leading-tight">{myAssignedLeads.length}</span>
                      <span className="text-[9px] font-semibold tracking-widest text-slate-400 uppercase leading-none mt-0.5">My Leads</span>
                    </button>
                  )}
                </div>
            </div>
            {/* Issue Engine pill */}
            <ActiveIssuesPill onClick={() => setIssueEngineOverlayOpen(true)} />
            {/* Agent presence circles — far right */}
            {agentList && agentList.length > 0 && (() => {
              const MAX_SHOW = 8;
              const visible = agentList.slice(0, MAX_SHOW);
              const overflow = agentList.length - MAX_SHOW;
              return (
                <div className="flex items-center shrink-0" style={{ gap: 0 }}>
                  {visible.map((ag, idx) => {
                    const status = senderStatusMap?.[ag.name] ?? "offline";
                    const dotColor = status === "online" ? "bg-emerald-400" : status === "away" ? "bg-amber-400" : "bg-slate-300";
                    const initials = ag.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                    const hue = (ag.name.charCodeAt(0) * 37) % 360;
                    const isOnCall = Boolean(ag.onCallSince);
                    return (
                      <div key={ag.id} className="relative" title={isOnCall ? `${ag.name} — on a call` : `${ag.name} — ${status}`} style={{ marginLeft: idx === 0 ? 0 : -6, zIndex: visible.length - idx }}>
                        {ag.photoUrl ? (
                          <img src={ag.photoUrl} alt={ag.name} className={cn("w-8 h-8 rounded-full object-cover border-2 border-white shadow-sm", isOnCall && "ring-2 ring-green-400")} />
                        ) : (
                          <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold border-2 border-white shadow-sm", isOnCall && "ring-2 ring-green-400")} style={{ background: `hsl(${hue}, 55%, 52%)` }}>{initials}</div>
                        )}
                        <span className={cn("absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white", isOnCall ? "bg-green-500" : dotColor)} />
                      </div>
                    );
                  })}
                  {overflow > 0 && (
                    <div className="w-8 h-8 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-slate-500 shadow-sm" style={{ marginLeft: -6 }}>+{overflow}</div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Issues center view — shown when centerView === 'issues' */}
        {centerView === "issues" && (() => {
          const allIssues: Array<{ key: string; title: string; body: string; sourceBody?: string | null; source: string; ts: number; type: "alert" | "manual" }> = [
            ...alerts
              .filter(a => a.type !== "general_issue")
              .map(a => ({ key: `alert-${a.jobId}-${a.ts}`, title: a.title, body: a.body, sourceBody: null, source: a.source, ts: a.ts, type: "alert" as const })),
            ...manualIssues.map(m => ({ key: `manual-${m.messageId}`, title: m.title, body: m.note ?? "", sourceBody: m.sourceBody ?? null, source: m.authorName, ts: m.ts, type: "manual" as const })),
          ].sort((a, b) => Number(b.ts) - Number(a.ts));
          return (
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5" style={{ scrollbarWidth: "none" }}>
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">Active Issues</p>
                <span className="text-[10px] font-medium text-slate-400 bg-slate-100 rounded-full px-2.5 py-0.5">{allIssues.length} open</span>
              </div>
              {allIssues.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                  <CheckCheck className="h-10 w-10 opacity-30" />
                  <p className="text-sm font-medium">No open issues</p>
                  <p className="text-xs text-slate-300">All clear — nothing needs attention right now</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {allIssues.map(issue => {
                    const isResolved = issueResolved[issue.key];
                    const owner = issueOwners[issue.key];
                    // Derive customer risk from issue type
                    const customerRisk = issue.type === "alert" ? "High" : "Medium";
                    // Response pressure: time since issue was raised
                    const minutesAgo = Math.floor((Date.now() - issue.ts) / 60000);
                    const pressureLabel = minutesAgo < 1 ? "Just now" : minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.floor(minutesAgo / 60)}h ago`;
                    // Recommended action subtitle derived from issue type
                    const actionSubtitle = issue.type === "alert"
                      ? "Call cleaner, fix issue + notify client"
                      : "Claim issue, call cleaner, and notify client if arrival slips";
                    return (
                      <div
                        key={issue.key}
                        id={`issue-card-${issue.key}`}
                        className={cn(
                          "rounded-2xl border border-slate-200 bg-slate-50 shadow-sm transition hover:shadow-md",
                          highlightedIssueKey === issue.key && "ring-2 ring-red-400 ring-offset-2"
                        )}
                      >
                        <div className="px-6 pt-5 pb-6">
                          {/* Card label */}
                          <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-3">
                            {isResolved ? "Resolved Issue" : "Active Issue Card"}
                          </p>

                          {/* Top row: left = emoji + title + body, right = action buttons */}
                          <div className="flex items-start justify-between gap-6 mb-5">
                            {/* Left: title + body */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2.5 mb-1.5">
                                <span className="text-2xl shrink-0 leading-none">{isResolved ? "🟢" : issue.type === "alert" ? "🚨" : "⚠️"}</span>
                                <p className={cn(
                                  "text-xl font-bold leading-tight",
                                  isResolved ? "text-slate-400 line-through" : "text-slate-900"
                                )}>
                                  {issue.title}
                                </p>
                              </div>
                              {/* Recommended action subtitle */}
                              <p className="text-sm font-semibold text-slate-700 leading-snug mt-1.5">{actionSubtitle}</p>
                              {issue.body && (
                                <p className="text-sm text-slate-500 leading-relaxed mt-1">{issue.body}</p>
                              )}
                              {issue.sourceBody && (
                                <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-sm text-slate-500 italic leading-snug">
                                  &ldquo;{issue.sourceBody}&rdquo;
                                </blockquote>
                              )}
                            </div>

                            {/* Right: action buttons — match goal design */}
                            <div className="flex items-center gap-3 shrink-0 self-start mt-1">
                              {!isResolved && !owner && (
                                <button
                                  onClick={() => {
                                    setIssueOwners(prev => ({ ...prev, [issue.key]: callerName }));
                                    claimIssueMutation.mutate({ issueKey: issue.key, claimedBy: callerName });
                                  }}
                                  className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white text-blue-600 text-sm font-semibold px-5 py-4 hover:bg-blue-50 hover:border-blue-200 transition min-w-[120px] justify-center"
                                >
                                  <ShieldAlert className="h-4 w-4 shrink-0" />
                                  <span>Claim issue</span>
                                </button>
                              )}
                              {!isResolved && owner && (
                                <>
                                  {/* Owner pill — light blue bg, blue border, centered icon+text */}
                                  <div className="flex flex-col items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 text-blue-600 text-sm font-semibold px-5 py-3.5 min-w-[110px] gap-0.5">
                                    <ShieldAlert className="h-4 w-4" />
                                    <span className="text-xs leading-tight">Owner:</span>
                                    <span className="text-sm font-bold leading-tight">{owner}</span>
                                  </div>
                                  {/* Mark resolved — solid green, centered icon+text */}
                                  <button
                                    onClick={() => {
                                      setResolveIssueKey(issue.key);
                                      setResolveIssueMessageId(null);
                                      setResolveIssueTitle(issue.title);
                                      setResolveIssueNote(issue.body ?? "");
                                      setResolveIssueNoteText("");
                                      setResolveIssueOpen(true);
                                    }}
                                    className="flex flex-col items-center justify-center rounded-2xl bg-emerald-600 text-white text-sm font-bold px-5 py-3.5 min-w-[110px] gap-0.5 hover:bg-emerald-700 transition"
                                  >
                                    <CircleCheckBig className="h-4 w-4" />
                                    <span className="text-xs leading-tight">Mark</span>
                                    <span className="text-sm font-bold leading-tight">resolved</span>
                                  </button>
                                </>
                              )}
                              {isResolved && (
                                <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold px-5 py-4">
                                  <CircleCheckBig className="h-4 w-4" />
                                  <span>Resolved</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Bottom: 3 info tiles — white bg, light border */}
                          <div className="grid grid-cols-3 gap-3">
                            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Ownership</p>
                              <p className="text-base font-bold text-slate-800">{owner ?? "Unclaimed"}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Customer Risk</p>
                              <p className={cn(
                                "text-base font-bold",
                                customerRisk === "High" ? "text-red-600" : "text-amber-600"
                              )}>{customerRisk}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Response Pressure</p>
                              <p className="text-base font-bold text-slate-800">{pressureLabel}</p>
                            </div>
                          </div>
                        </div>
                        {/* Comment thread — inline below the card content */}
                        <IssueCommentThread
                          issueKey={issue.key}
                          callerName={callerName}
                          expanded={expandedComments.has(issue.key)}
                          onToggle={() => setExpandedComments(prev => {
                            const next = new Set(prev);
                            if (next.has(issue.key)) next.delete(issue.key);
                            else next.add(issue.key);
                            return next;
                          })}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* AI Call Command Center — Calls center view */}
        {centerView === "calls" && (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5" style={{ scrollbarWidth: "none" }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <PhoneIncoming className="h-4 w-4 text-orange-500" />
                <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">AI Call Log — Today</p>
              </div>
              <button
                onClick={() => setCenterView("chat")}
                className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition"
              >
                ✕ Close
              </button>
            </div>
            {todayCallLog.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <PhoneIncoming className="h-10 w-10 opacity-30" />
                <p className="text-sm font-medium">No AI calls today</p>
                <p className="text-xs text-slate-300">Click ⚠ AI Call on a Team Status card to fire one</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(todayCallLog as any[]).map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {entry.templateName ?? "Manual call"}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {entry.teamName ?? entry.clientName ?? "Unknown"}
                          {entry.calledTarget === "team" ? " (team)" : " (client)"}
                        </p>
                      </div>
                      <span className={cn(
                        "shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                        entry.status === "completed" ? "bg-green-100 text-green-700 border-green-200" :
                        entry.status === "failed" ? "bg-red-100 text-red-700 border-red-200" :
                        entry.status === "no_answer" ? "bg-amber-100 text-amber-700 border-amber-200" :
                        entry.status === "fired" ? "bg-blue-100 text-blue-700 border-blue-200" :
                        "bg-gray-100 text-gray-600 border-gray-200"
                      )}>
                        {entry.status === "completed" ? "✓ Completed" :
                         entry.status === "failed" ? "✕ Failed" :
                         entry.status === "no_answer" ? "📵 No Answer" :
                         entry.status === "fired" ? "📞 Fired" : "Pending"}
                      </span>
                    </div>
                    {entry.firedAt && (
                      <p className="text-[10px] text-slate-400 mb-2">
                        Fired {new Date(entry.firedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })}
                        {entry.firedBy ? ` by ${entry.firedBy}` : ""}
                        {entry.durationSeconds ? ` · ${Math.floor(entry.durationSeconds / 60)}m ${entry.durationSeconds % 60}s` : ""}
                      </p>
                    )}
                    {entry.recordingUrl && (
                      <div className="mb-2">
                        <audio controls src={entry.recordingUrl} className="w-full h-8 rounded-xl" style={{ accentColor: "#f97316" }} />
                      </div>
                    )}
                    {entry.transcript && (
                      <details className="mt-1">
                        <summary className="text-[10px] font-semibold text-slate-400 cursor-pointer hover:text-slate-600">Transcript</summary>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed whitespace-pre-wrap">{entry.transcript}</p>
                      </details>
                    )}
                    {entry.notes && (
                      <p className="text-xs text-slate-500 mt-1 italic">{entry.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Active Sticky Pin banner — real sticky note look (chat view only) */}
        {centerView === "chat" && activePin && (
          <div className="relative mx-4 mt-3 mb-0" style={{ transform: "rotate(-0.8deg)", filter: "drop-shadow(2px 4px 8px rgba(0,0,0,0.18))" }}>
            {/* Pushpin */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" }}>
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-red-400 to-red-600 border-2 border-red-700 shadow-md" />
              <div className="w-1.5 h-3 bg-gradient-to-b from-slate-400 to-slate-600 rounded-b-full -mt-0.5" />
            </div>
            {/* Note body */}
            <div className="rounded-sm overflow-hidden pt-3" style={{ background: "#fef08a", boxShadow: "inset 0 -2px 4px rgba(0,0,0,0.06)" }}>
              {/* Lined paper texture */}
              <div className="px-4 pt-2 pb-3" style={{
                backgroundImage: "repeating-linear-gradient(transparent, transparent 22px, #fde047 22px, #fde047 23px)",
                backgroundPositionY: "28px",
                fontFamily: "'Caveat', 'Comic Sans MS', cursive",
              }}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">📌 {activePin.authorName}</p>
                  <button
                    onClick={() => dismissPinMutation.mutate({ channel: "command" })}
                    className="shrink-0 rounded-full p-0.5 text-amber-600 hover:bg-amber-300 hover:text-amber-900 transition"
                    title="Dismiss pin"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-base text-amber-950 leading-relaxed whitespace-pre-wrap" style={{ fontFamily: "'Caveat', 'Comic Sans MS', cursive", fontSize: "1rem" }}>{activePin.body}</p>
              </div>
              {/* Torn bottom edge */}
              <div className="h-3 w-full" style={{ background: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='12' viewBox='0 0 40 12'%3E%3Cpath d='M0 0 Q5 12 10 6 Q15 0 20 8 Q25 14 30 5 Q35 0 40 8 L40 12 L0 12 Z' fill='%23fef08a'/%3E%3C/svg%3E\") repeat-x bottom", backgroundSize: "40px 12px" }} />
            </div>
          </div>
        )}


        {/* Conversation thread — relative wrapper for toast overlay */}
        <div className={cn("relative flex-1 min-h-0 flex flex-col", (centerView === "issues" || centerView === "calls") && "hidden")}>
          {/* Combined pill bar — mentions + threads in one compact row */}
          {true && (
            <div className="shrink-0 flex items-center gap-2 px-5 py-1.5 bg-slate-50 border-b border-slate-200 overflow-x-auto">
              {/* Mentions pill — shows count + jump when unread, or just See all when all read */}
              {(unreadTagIds.length > 0 || allMentions.length > 0) && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={unreadTagIds.length > 0 ? jumpToNextMention : () => setShowMentionHistory(true)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition",
                      unreadTagIds.length > 0
                        ? "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                        : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    <Bell className="h-3 w-3" />
                    {unreadTagIds.length > 0 ? (
                      <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                        {unreadTagIds.length > 99 ? "99+" : unreadTagIds.length}
                      </span>
                    ) : null}
                  </button>
                  {unreadTagIds.length > 0 && (
                    <button onClick={markTagsSeen} className="text-slate-300 hover:text-slate-500 transition" title="Dismiss">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                  <button onClick={() => setShowMentionHistory(true)} className="text-[10px] text-slate-400 hover:text-slate-600 transition font-medium">
                    See all
                  </button>
                </div>
              )}
              {/* Divider between pills */}
              {(unreadTagIds.length > 0 || allMentions.length > 0) && activeThreadCount > 0 && (
                <span className="text-slate-300 text-xs">|</span>
              )}
              {/* Threads pill */}
              {activeThreadCount > 0 && (
                <button
                  onClick={() => setAllThreadsOpen(true)}
                  className="relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Threads
                  {unreadThreadCount > 0 && (
                    <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-slate-800 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                      {unreadThreadCount > 9 ? "9+" : unreadThreadCount}
                    </span>
                  )}
                </button>
              )}
              {/* Lead Replies pill — always visible */}
              {(unreadTagIds.length > 0 || activeThreadCount > 0) && (
                <span className="text-slate-300 text-xs">|</span>
              )}
              <button
                onClick={() => setLeadRepliesOpen(!leadRepliesOpen)}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition border",
                  leadRepliesOpen
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                )}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Lead Chats
                {leadRepliesCount > 0 && (
                  <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                    {leadRepliesCount > 9 ? "9+" : leadRepliesCount}
                  </span>
                )}
              </button>
              {/* Email Inbox pill — opens slide-in preview panel */}
              <span className="text-slate-300 text-xs">|</span>
              <button
                onClick={() => { setEmailsOpen(v => !v); if (csSmsOpen) setCsSmsOpen(false); if (leadRepliesOpen) setLeadRepliesOpen(false); if (missedCallsOpen) setMissedCallsOpen(false); if (tasksOpen) setTasksOpen(false); }}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition border",
                  emailsOpen
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                )}
              >
                <Mail className="h-3.5 w-3.5" />
                Email
                {emailUnreadCount > 0 && (
                  <span className={cn(
                    "ml-0.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center leading-none",
                    emailsOpen ? "bg-white text-slate-900" : "bg-slate-800 text-white"
                  )}>
                    {emailUnreadCount}
                  </span>
                )}
              </button>
              {/* Missed Calls pill */}
              <span className="text-slate-300 text-xs">|</span>
              <button
                onClick={() => { setMissedCallsOpen(v => !v); if (csSmsOpen) setCsSmsOpen(false); if (leadRepliesOpen) setLeadRepliesOpen(false); if (tasksOpen) setTasksOpen(false); if (emailsOpen) setEmailsOpen(false); }}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition border",
                  missedCallsOpen
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                )}
              >
                <PhoneMissed className="h-3.5 w-3.5" />
                Missed
                {missedCallsTodayCount > 0 && (
                  <span className="ml-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                    {missedCallsTodayCount > 99 ? "99+" : missedCallsTodayCount}
                  </span>
                )}
              </button>

              {/* CS SMS unanswered pill — 202-888-5362 line */}
              <span className="text-slate-300 text-xs">|</span>
              <button
                onClick={() => { setCsSmsOpen(v => !v); if (leadRepliesOpen) setLeadRepliesOpen(false); if (missedCallsOpen) setMissedCallsOpen(false); if (emailsOpen) setEmailsOpen(false); }}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition border",
                  csSmsOpen
                    ? "bg-slate-900 text-white border-slate-900"
                    : csUnansweredUrgent > 0
                    ? "bg-white text-red-600 border-red-200 hover:bg-red-50"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                )}
                title={
                  csUnansweredUrgent > 0
                    ? `${csUnansweredUrgent} waiting 1h+`
                    : csUnansweredWarning > 0
                    ? `${csUnansweredWarning} waiting 15min+`
                    : "All CS SMS caught up"
                }
              >
                <Smartphone className="h-3.5 w-3.5" />
                CS
                {csUnansweredCount > 0 && (
                  <span className={cn(
                    "ml-0.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center leading-none",
                    csUnansweredUrgent > 0 ? "bg-red-500 text-white" : "bg-slate-700 text-white"
                  )}>
                    {csUnansweredCount > 99 ? "99+" : csUnansweredCount}
                  </span>
                )}
              </button>
              {/* Tasks pill */}
              <span className="text-slate-300 text-xs">|</span>
              <button
                onClick={() => { setTasksOpen(v => !v); if (csSmsOpen) setCsSmsOpen(false); if (leadRepliesOpen) setLeadRepliesOpen(false); if (missedCallsOpen) setMissedCallsOpen(false); if (emailsOpen) setEmailsOpen(false); }}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition border",
                  tasksOpen
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                )}
                title="Tasks"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                Tasks
                {visibleDueTasks.length > 0 && (
                  <span className="ml-0.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center leading-none bg-indigo-500 text-white animate-pulse">
                    {visibleDueTasks.length > 99 ? "99+" : visibleDueTasks.length}
                  </span>
                )}
              </button>
              {/* Payment Link button */}
              <button
                onClick={() => setShowPaymentModal(true)}
                className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition shrink-0"
                title="Generate payment link"
              >
                <DollarSign className="h-3.5 w-3.5" />
              </button>
              {/* Make Call button */}
              <button
                onClick={() => setShowCallPanel(true)}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition shrink-0"
                title="Make AI call"
              >
                <Bot className="h-3.5 w-3.5" />
                <Smartphone className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* AI Call Panel — slide-in from right */}
          <AICallPanel open={showCallPanel} onClose={() => setShowCallPanel(false)} />
          <PaymentLinkModal open={showPaymentModal} onClose={() => setShowPaymentModal(false)} />

          {/* Mention History Drawer — slide-in from right */}
          {showMentionHistory && (
            <div className="absolute inset-0 z-40 flex">
              {/* Backdrop */}
              <div
                className="flex-1 bg-black/20"
                onClick={() => setShowMentionHistory(false)}
              />
              {/* Drawer panel */}
              <div className="w-80 bg-white flex flex-col shadow-2xl border-l border-slate-200 animate-in slide-in-from-right-4 duration-200">
                {/* Drawer header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-amber-500" />
                    <span className="text-sm font-semibold text-slate-800">Mentions</span>
                    {allMentions.length > 0 && (
                      <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-1.5 py-0.5 rounded-full">
                        {allMentions.length}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowMentionHistory(false)}
                    className="text-slate-400 hover:text-slate-600 transition"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* Drawer body */}
                <div className="flex-1 overflow-y-auto">
                  {allMentions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 py-16 text-slate-400">
                      <Bell className="h-8 w-8 opacity-30" />
                      <p className="text-sm">No mentions yet</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {allMentions.map((msg) => {
                        const isUnread = unreadTagIds.includes(msg.id);
                        const photoUrl = senderPhotoMap[msg.from] ?? null;
                        const initials = msg.from.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
                        const color = senderHex(msg.from);
                        // Highlight @mention in the body
                        const highlightedBody = msg.body.replace(
                          mentionPattern!,
                          (match) => `<mark class="bg-amber-100 text-amber-800 rounded px-0.5">${match}</mark>`
                        );
                        return (
                          <div
                            key={msg.id}
                            className={cn(
                              "px-4 py-3 hover:bg-slate-50 transition group",
                              isUnread && "bg-amber-50/60"
                            )}
                          >
                            <div className="flex items-start gap-3">
                              {/* Avatar */}
                              <div className="relative shrink-0">
                                {photoUrl ? (
                                  <img
                                    src={photoUrl}
                                    alt={msg.from}
                                    className="w-8 h-8 rounded-full object-cover shadow-sm"
                                  />
                                ) : (
                                  <div
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm"
                                    style={{ background: color }}
                                  >
                                    {initials}
                                  </div>
                                )}
                                {isUnread && (
                                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-white" />
                                )}
                              </div>
                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1 mb-0.5">
                                  <span className="text-xs font-semibold text-slate-700 truncate">{msg.from}</span>
                                  <span className="text-[10px] text-slate-400 shrink-0">
                                    {new Date(msg.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                    {" "}
                                    {new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                                  </span>
                                </div>
                                <p
                                  className="text-xs text-slate-600 line-clamp-3 leading-relaxed"
                                  dangerouslySetInnerHTML={{ __html: highlightedBody }}
                                />
                                <button
                                  onClick={() => {
                                    setShowMentionHistory(false);
                                    setTimeout(() => scrollToCmdMsg(msg.id), 150);
                                  }}
                                  className="mt-1.5 text-[10px] font-semibold text-violet-600 hover:text-violet-800 opacity-0 group-hover:opacity-100 transition flex items-center gap-1"
                                >
                                  <ExternalLink className="h-2.5 w-2.5" />
                                  Jump to message
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* Drawer footer */}
                {unreadTagIds.length > 0 && (
                  <div className="shrink-0 px-4 py-3 border-t border-slate-100 bg-slate-50">
                    <button
                      onClick={() => {
                        setShowMentionHistory(false);
                        markTagsSeen();
                      }}
                      className="w-full text-xs font-semibold text-slate-500 hover:text-slate-700 transition"
                    >
                      Mark all {unreadTagIds.length} as read
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Live floating pill — slides up when a new @mention arrives while panel is visible */}
          {livePill && (
            <button
              onClick={() => {
                const lastId = unreadTagIds[unreadTagIds.length - 1];
                if (lastId) scrollToCmdMsg(lastId);
                setLivePill(null);
                if (livePillTimer.current) clearTimeout(livePillTimer.current);
              }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-2 rounded-full bg-violet-600 text-white text-xs font-semibold shadow-lg hover:bg-violet-700 active:scale-95 transition-all animate-in slide-in-from-bottom-2 duration-200 max-w-[80%]"
            >
              <span className="text-sm shrink-0">🔔</span>
              <span className="truncate">{livePill.from} mentioned you</span>
              <X
                className="h-3 w-3 shrink-0 opacity-70"
                onClick={(e) => { e.stopPropagation(); setLivePill(null); if (livePillTimer.current) clearTimeout(livePillTimer.current); }}
              />
            </button>
          )}

          {/* New-message toast — WhatsApp pattern */}
          {cmdNewMsgToast && (
            <button
              onClick={dismissCmdToast}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 text-white text-xs font-semibold shadow-lg hover:bg-amber-600 active:scale-95 transition-all animate-in slide-in-from-bottom-2 duration-200"
            >
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              New message from {cmdNewMsgToast.from}
            </button>
          )}
        <MessageList
          channelMsgs={channelMsgs}
          channelLoading={channelLoading}
          callerName={callerName}
          onJumpToJob={onJumpToJob}
          reactionsByMsgId={reactionsByMsgId}
          commandSeenByMap={commandSeenByMap}
          senderPhotoMap={senderPhotoMap}
          unreadTagIds={unreadTagIds}
          highlightedCmdMsgId={highlightedCmdMsgId}
          cmdMsgRefMap={cmdMsgRefMap}
          msgsContainerRef={msgsContainerRef}
          threadScrollRef={threadScrollRef}
          threadBottomRef={threadBottomRef}
          toggleReactionMutation={toggleReactionMutation}
          claimLeadMutation={claimLeadMutation}
          scrollToCmdMsg={scrollToCmdMsg}
          openChatConvert={openChatConvert}
          setReplyTo={setReplyTo}
          setLightboxUrl={setLightboxUrl}
          setFirstMsgDetails={setFirstMsgDetails}
          setFirstMsgResult={setFirstMsgResult}
          setFirstMsgCopied={setFirstMsgCopied}
          setFirstMsgOpen={setFirstMsgOpen}
          setResolveIssueMessageId={setResolveIssueMessageId}
          setResolveIssueTitle={setResolveIssueTitle}
          setResolveIssueNote={setResolveIssueNote}
          setResolveIssueNoteText={setResolveIssueNoteText}
          setResolveIssueOpen={setResolveIssueOpen}
          dismissSystemCard={(id) => dismissSystemCardMutation.mutate({ messageId: id })}
          onScrollToBottom={() => setNewMsgCount(0)}
          setOpenThreadId={setOpenThreadId}
          openThreadId={openThreadId}
          allThreadsOpen={allThreadsOpen}
          setAllThreadsOpen={setAllThreadsOpen}
          activeThreadCount={activeThreadCount}
          unreadThreadCount={unreadThreadCount}
          leadRepliesOpen={leadRepliesOpen}
          setLeadRepliesOpen={setLeadRepliesOpen}
          leadReplies={leadReplies as any}
          leadRepliesCount={leadRepliesCount}
          unreadLeadRepliesCount={unreadLeadRepliesCount}
          onSwitchToLeadOps={onSwitchToLeadOps}
          superAlertMsgSet={superAlertMsgSet}
          searchOpen={searchOpen}
          openSearch={openSearch}
          closeSearch={closeSearch}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchResultIdx={searchResultIdx}
          setSearchResultIdx={setSearchResultIdx}
          searchMatchList={searchMatchList}
          navigateSearchResult={navigateSearchResult}
          searchInputRef={searchInputRef}
          notifMuted={notifMuted}
          toggleMute={toggleMute}
          pendingReminderCount={pendingReminderCount}
          centerView={centerView}
          setCenterView={setCenterView}
          todayCallCount={todayCallCount}
          emailUnreadCount={emailUnreadCount}
          mentionPhoneMap={mentionPhoneMapRef.current}
        />
        {/* New-message badge — shown when user is scrolled up */}
        {newMsgCount > 0 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20">
            <button
              onClick={() => {
                const container = threadScrollRef.current;
                if (container) container.scrollTop = container.scrollHeight;
                setNewMsgCount(0);
              }}
              className="flex items-center gap-1.5 bg-slate-900 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg hover:bg-slate-700 transition"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              {newMsgCount} new {newMsgCount === 1 ? 'message' : 'messages'}
            </button>
          </div>
        )}
        </div>{/* end relative wrapper */}
        {chatConvertModal && (
          <ConvertToIssueModal
            state={chatConvertModal}
            onClose={() => setChatConvertModal(null)}
            onFieldChange={(field, value) => setChatConvertModal(prev => prev ? { ...prev, [field]: value } : null)}
            onSubmit={submitChatConvert}
          />
        )}
        {/* Composer — hidden when in issues view */}
        <div className={cn("relative shrink-0", (centerView === "issues" || centerView === "calls") && "hidden")}>
        <FAQPanel open={faqOpen} onClose={() => setFaqOpen(false)} context="Command Chat" />
        <ObjectionsPanel open={objectionOpen} onClose={() => setObjectionOpen(false)} />
        <div className="px-5 py-4 bg-white">

          {/* Staged photo preview strip */}
          {stagedPhotos.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {stagedPhotos.map((p) => (
                <div key={p.id} className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-200 shrink-0">
                  <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                  {(p.status === "pending" || p.status === "uploading") && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                    </div>
                  )}
                  {p.status === "error" && (
                    <div className="absolute inset-0 bg-red-900/60 flex items-center justify-center">
                      <span className="text-white text-[10px] font-bold">ERR</span>
                    </div>
                  )}
                  <button
                    className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 transition"
                    onClick={() => removeStagedPhoto(p.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                className="w-16 h-16 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 hover:border-slate-400 hover:text-slate-600 transition shrink-0"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageIcon className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) stageFiles(e.target.files); e.target.value = ""; }}
          />

          {/* Quote-reply preview bar */}
          {replyTo && (
            <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-slate-100 rounded-xl border-l-4 border-slate-400">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-slate-500 mb-0.5">Replying to {replyTo.author}</p>
                <p className="text-xs text-slate-600 truncate">{replyTo.body.slice(0, 120)}{replyTo.body.length > 120 ? "…" : ""}</p>
              </div>
              <button
                onClick={() => setReplyTo(null)}
                className="shrink-0 text-slate-400 hover:text-slate-700 p-0.5"
                aria-label="Cancel reply"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Typing indicator */}
                    <TypingBubble typers={cmdTypers} />

          {/* ── Voice Command Unknown Error */}
          {voiceUnknown && (
            <div className="mb-2 mx-auto w-full max-w-sm rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
              <div className="shrink-0 w-7 h-7 rounded-xl bg-amber-100 flex items-center justify-center mt-0.5">
                <span className="text-amber-600 text-sm">🎙️</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide mb-0.5">Didn't understand</p>
                <p className="text-sm text-amber-800 italic truncate">"{voiceUnknown}"</p>
                <p className="text-[11px] text-amber-600 mt-1">Try: "Text Maria…", "Call Rohan…", "Remind me…", or "Post in chat…"</p>
              </div>
              <button
                onClick={() => setVoiceUnknown(null)}
                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-amber-400 hover:text-amber-700 hover:bg-amber-100 transition mt-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* ── Voice Command Status Card ───────────────────────────────────── */}
          {voiceStatusNotFound && (
            <div className="mb-2 mx-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-start gap-3">
              <div className="shrink-0 w-7 h-7 rounded-xl bg-slate-200 flex items-center justify-center mt-0.5">
                <span className="text-slate-500 text-sm">📍</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-0.5">No job today</p>
                <p className="text-sm text-slate-700">No job found for <span className="font-semibold">{voiceStatusNotFound}</span> today.</p>
              </div>
              <button onClick={() => setVoiceStatusNotFound(null)} className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition mt-0.5">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {voiceStatusJob && (() => {
            const job = voiceStatusJob;
            const statusLabels: Record<string, { label: string; color: string; dot: string }> = {
              on_the_way:        { label: "On the way",       color: "bg-blue-100 text-blue-700",   dot: "bg-blue-500" },
              arrived:           { label: "Arrived",          color: "bg-green-100 text-green-700", dot: "bg-green-500" },
              running_late:      { label: "Running late",     color: "bg-red-100 text-red-700",     dot: "bg-red-500" },
              in_progress:       { label: "In progress",      color: "bg-violet-100 text-violet-700", dot: "bg-violet-500" },
              finishing_up:      { label: "Finishing up",     color: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500" },
              wrapping_up:       { label: "Wrapping up",      color: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500" },
              completed:         { label: "Completed",        color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
              issue_at_property: { label: "Issue at property", color: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
            };
            const statusMeta = job.jobStatus ? (statusLabels[job.jobStatus] ?? { label: job.jobStatus, color: "bg-slate-100 text-slate-600", dot: "bg-slate-400" }) : null;
            const updatedAgo = (() => {
              const diffMs = Date.now() - new Date(job.updatedAt).getTime();
              const mins = Math.floor(diffMs / 60_000);
              if (mins < 1) return "just now";
              if (mins < 60) return `${mins}m ago`;
              return `${Math.floor(mins / 60)}h ago`;
            })();
            const scheduledTime = job.serviceDateTime ? (() => {
              const d = new Date(job.serviceDateTime);
              return isNaN(d.getTime()) ? job.serviceDateTime : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
            })() : null;
            const etaTime = job.etaTimestamp ? (() => {
              const d = new Date(job.etaTimestamp);
              return isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
            })() : null;
            return (
              <div className="mb-2 mx-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-slate-100">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shrink-0">
                    <span className="text-white font-bold text-sm">{job.customerName[0].toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Job Status</p>
                    <p className="text-[15px] font-bold text-slate-900 truncate leading-snug">{job.customerName}</p>
                  </div>
                  <button onClick={() => setVoiceStatusJob(null)} className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* Body */}
                <div className="px-4 py-3 space-y-2.5">
                  {/* Team */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Team</span>
                    <span className="text-sm font-semibold text-slate-800">{job.teamName}</span>
                  </div>
                  {/* Status badge */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Status</span>
                    {statusMeta ? (
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusMeta.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                        {statusMeta.label}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400 italic">No update yet</span>
                    )}
                  </div>
                  {/* Delay if running late */}
                  {job.jobStatus === "running_late" && job.delayMinutes && (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Delay</span>
                      <span className="text-sm font-semibold text-red-600">{job.delayMinutes} min late</span>
                    </div>
                  )}
                  {/* ETA or scheduled time */}
                  {(etaTime || scheduledTime) && (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{etaTime ? "ETA" : "Scheduled"}</span>
                      <span className="text-sm font-semibold text-slate-800">{etaTime ?? scheduledTime}</span>
                    </div>
                  )}
                  {/* Address */}
                  {job.jobAddress && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide shrink-0 mt-0.5">Address</span>
                      <span className="text-xs text-slate-600 text-right leading-snug">{job.jobAddress}</span>
                    </div>
                  )}
                  {/* Last update */}
                  <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-100">Last updated {updatedAgo}</p>
                </div>
              </div>
            );
          })()}

          {/* ── Voice Command Confirmation Card ─────────────────────────────── */}
          {voiceConfirm && voiceCardMinimized && (
            /* Minimized pill — fixed bottom-right, floats above chat */
            <div
              className="fixed bottom-6 right-6 z-50 rounded-2xl border border-slate-200 bg-white shadow-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-slate-50 transition w-72"
              style={{boxShadow: "0 8px 32px rgba(0,0,0,0.15)"}}
              onClick={() => setVoiceCardMinimized(false)}
            >
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-sm">{(voiceConfirm.selected?.name ?? "?")[0].toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{voiceConfirmAction === "call" ? "AI Call" : voiceConfirmAction === "remind" ? "Set Reminder" : "Send Text"}</p>
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {voiceConfirmAction === "call" && voiceCallStatus !== "idle"
                    ? (voiceCallStatus === "firing" ? "Placing call…" :
                       voiceCallStatus === "queued" ? "Call queued…" :
                       voiceCallStatus === "ringing" ? `📞 Ringing… ${voiceConfirm.selected?.name ?? ""}` :
                       voiceCallStatus === "in_progress" ? `🟢 In progress — ${voiceConfirm.selected?.name ?? ""}` :
                       voiceCallStatus === "completed" ? `✅ Done — ${voiceConfirm.selected?.name ?? ""}` :
                       voiceCallStatus === "voicemail" ? `📩 Voicemail — ${voiceConfirm.selected?.name ?? ""}` :
                       voiceCallStatus === "no_answer" ? `🔇 No answer — ${voiceConfirm.selected?.name ?? ""}` :
                       `❌ Failed — ${voiceConfirm.selected?.name ?? ""}`)
                    : (voiceConfirm.selected?.name ?? "Select contact")}
                </p>
              </div>
              {(voiceCallStatus === "firing" || voiceCallStatus === "queued" || voiceCallStatus === "ringing" || voiceCallStatus === "in_progress") && (
                <Loader2 className="h-4 w-4 animate-spin text-violet-500 shrink-0" />
              )}
              <button
                onClick={(e) => { e.stopPropagation(); if (voiceCallPollRef.current) clearInterval(voiceCallPollRef.current); setVoiceConfirm(null); setVoiceNeedsSearch(false); setVoiceSearchQuery(""); setVoiceTone("friendly"); setVoiceBubbleEditing(false); setVoiceCallStatus("idle"); setVoiceCallVapiId(null); setVoiceCallSummary(null); setVoiceCallTranscript(null); setVoiceCallRecordingUrl(null); setVoiceCardMinimized(false); }}
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {voiceConfirm && !voiceCardMinimized && (
            <div className="mb-2 mx-auto w-full max-w-sm rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden min-h-[480px] flex flex-col" style={{boxShadow: "0 8px 40px rgba(0,0,0,0.13)"}}>
              {/* Header — contact identity */}
              <div className="flex items-start gap-4 px-5 pt-5 pb-4">
                {/* Avatar */}
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-md mt-0.5">
                  <span className="text-white font-bold text-lg">{(voiceConfirm.selected?.name ?? "?")[0].toUpperCase()}</span>
                </div>

                {/* Identity block */}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em] mb-0.5">{voiceConfirmAction === "call" ? "AI Call" : "Send Text"}</p>
                  {voiceConfirm.selected ? (
                    <p className="text-[17px] font-bold text-slate-900 truncate leading-snug">{voiceConfirm.selected.name}</p>
                  ) : (
                    <p className="text-sm text-slate-400 italic">Select a contact below</p>
                  )}

                  {/* Last service pill */}
                  {voiceConfirm.selected && (voiceConfirm.selected as any).lastJobTime && (() => {
                    try {
                      const dt = new Date((voiceConfirm.selected as any).lastJobTime);
                      const day = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
                      const time = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
                      return (
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Last service</span>
                          <span className="inline-flex items-center gap-1 bg-violet-50 border border-violet-200 text-violet-600 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                            {day} · {time}
                          </span>
                        </div>
                      );
                    } catch { return null; }
                  })()}
                </div>

                {/* Minimize + Close buttons */}
                <div className="flex items-center gap-1 -mt-0.5">
                  <button
                    onClick={() => setVoiceCardMinimized(true)}
                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                    title="Minimize"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </button>
                  <button
                    onClick={() => { if (voiceCallPollRef.current) clearInterval(voiceCallPollRef.current); setVoiceConfirm(null); setVoiceNeedsSearch(false); setVoiceSearchQuery(""); setVoiceTone("friendly"); setVoiceBubbleEditing(false); setVoiceCallStatus("idle"); setVoiceCallVapiId(null); setVoiceCallSummary(null); setVoiceCallTranscript(null); setVoiceCallRecordingUrl(null); setVoiceCardMinimized(false); }}
                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Search bar — hidden for remind action, always visible for text/call */}
              {voiceConfirmAction !== "remind" && <div className="px-5 pb-3">
                <input
                  type="text"
                  placeholder="Search or correct contact name..."
                  value={voiceSearchQuery}
                  onChange={e => setVoiceSearchQuery(e.target.value)}
                  className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
                />
                {voiceSearchQuery.trim().length >= 2 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {voiceSearchResults.length === 0 && (
                      <p className="text-xs text-slate-400 py-1 px-1">No contacts found</p>
                    )}
                    {voiceSearchResults.map(m => (
                      <button
                        key={m.sessionId}
                        onClick={() => {
                          setVoiceNeedsSearch(false);
                          setVoiceSearchQuery("");
                          setVoiceConfirm(prev => prev ? { ...prev, selected: m, matches: [m] } : null);
                        }}
                        className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-50 hover:bg-violet-50 border border-transparent hover:border-violet-200 transition text-left"
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center shrink-0">
                          <span className="text-white font-bold text-xs">{m.name[0].toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{m.name}</p>
                          <p className="text-xs text-slate-400 truncate">{m.phone}</p>
                          {(m as any).lastJobTime && (
                            <p className="text-[10px] text-violet-500 font-semibold truncate">
                              {(() => { try { const dt = new Date((m as any).lastJobTime); return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }) + " · " + dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" }); } catch { return ""; } })()}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>}

              {/* Contact picker — only shown when multiple matches AND none selected yet */}
              {voiceConfirmAction !== "remind" && !voiceNeedsSearch && voiceConfirm.matches.length > 1 && !voiceConfirm.selected && (
                <div className="px-5 pb-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Who did you mean?</p>
                  <div className="flex flex-col gap-1">
                    {voiceConfirm.matches.map(m => (
                      <button
                        key={m.sessionId}
                        onClick={() => setVoiceConfirm(prev => prev ? { ...prev, selected: m } : null)}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2.5 rounded-2xl border transition text-left",
                          voiceConfirm.selected?.sessionId === m.sessionId
                            ? "bg-violet-50 border-violet-300"
                            : "bg-slate-50 border-transparent hover:border-violet-200 hover:bg-violet-50"
                        )}
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center shrink-0">
                          <span className="text-white font-bold text-xs">{m.name[0].toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{m.name}</p>
                          <p className="text-xs text-slate-400 truncate">{m.phone}</p>
                        </div>
                        {voiceConfirm.selected?.sessionId === m.sessionId && (
                          <CheckCircle2 className="h-4 w-4 text-violet-600 ml-auto shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* iMessage-style tap-to-edit bubble */}
              {voiceConfirmAction !== "remind" && !voiceNeedsSearch && (
                <div className="px-5 pb-5">
                  <div className="flex justify-end min-h-[180px] items-start pt-1">
                    {voiceBubbleEditing ? (
                      <textarea
                        autoFocus
                        value={voiceConfirmMsg}
                        onChange={e => setVoiceConfirmMsg(e.target.value)}
                        onBlur={() => setVoiceBubbleEditing(false)}
                        rows={6}
                        className="w-full max-w-[90%] text-[15px] leading-relaxed bg-[#007AFF] text-white rounded-[20px] rounded-br-[6px] px-5 py-4 resize-none focus:outline-none shadow-sm placeholder:text-blue-200 caret-white"
                        style={{colorScheme: "dark"}}
                      />
                    ) : (
                      <button
                        onClick={() => setVoiceBubbleEditing(true)}
                        className="max-w-[90%] bg-[#007AFF] rounded-[20px] rounded-br-[6px] px-5 py-4 shadow-sm text-left group relative"
                        title="Tap to edit"
                      >
                        <p className="text-white text-[15px] leading-relaxed whitespace-pre-wrap">{voiceConfirmMsg || "\u2026"}</p>
                        <span className="absolute -top-5 right-0 text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition">Tap to edit</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Reminder details — only for remind action */}
              {voiceConfirmAction === "remind" && (
                <div className="px-5 pb-3">
                  <div className="rounded-2xl bg-violet-50 border border-violet-200 px-4 py-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">⏰</span>
                      <p className="text-xs font-bold text-violet-700 uppercase tracking-wide">Reminder</p>
                    </div>
                    <p className="text-sm text-slate-700 font-medium mb-3">{voiceConfirmMsg || "Reminder"}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Fire in:</span>
                      <input
                        type="text"
                        value={voiceRemindTime}
                        onChange={e => setVoiceRemindTime(e.target.value)}
                        className="flex-1 text-sm font-semibold text-violet-700 bg-white border border-violet-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                        placeholder="e.g. 30 minutes, 1 hour, 3pm"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Tone rewrite buttons — only for text action */}
              {!voiceNeedsSearch && voiceConfirmAction === "text" && (
                <div className="px-5 pb-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Rewrite tone</p>
                  <div className="flex gap-2">
                    {(["friendly", "professional", "casual"] as const).map(tone => (
                      <button
                        key={tone}
                        disabled={voiceRewriting}
                        onClick={async () => {
                          if (!voiceConfirmMsg.trim() || voiceRewriting) return;
                          setVoiceTone(tone);
                          setVoiceRewriting(true);
                          try {
                            const result = await rewriteVoiceMsg.mutateAsync({
                              rawMessage: voiceConfirmMsg,
                              customerName: voiceConfirm.selected?.name ?? "Customer",
                              tone,
                            });
                            setVoiceConfirmMsg(result.message);
                          } catch {
                            toast.error("Rewrite failed");
                          } finally {
                            setVoiceRewriting(false);
                          }
                        }}
                        className={cn(
                          "flex-1 rounded-xl py-2 text-xs font-semibold transition border",
                          voiceTone === tone && !voiceRewriting
                            ? "bg-slate-900 text-white border-slate-900"
                            : "bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-900"
                        )}
                      >
                        {voiceRewriting && voiceTone === tone ? (
                          <span className="flex items-center justify-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Rewriting…</span>
                        ) : (
                          tone === "friendly" ? "😊 Friendly" : tone === "professional" ? "👔 Professional" : "💬 Casual"
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Live call status — only for call action */}
              {voiceConfirmAction === "call" && voiceCallStatus !== "idle" && (
                <div className="px-5 pb-3">
                  <div className={cn(
                    "rounded-2xl px-4 py-3 text-sm font-semibold flex items-center gap-2",
                    voiceCallStatus === "firing" || voiceCallStatus === "queued" ? "bg-amber-50 text-amber-700 border border-amber-200" :
                    voiceCallStatus === "ringing" ? "bg-blue-50 text-blue-700 border border-blue-200" :
                    voiceCallStatus === "in_progress" ? "bg-green-50 text-green-700 border border-green-200" :
                    voiceCallStatus === "completed" ? "bg-slate-50 text-slate-700 border border-slate-200" :
                    voiceCallStatus === "voicemail" ? "bg-purple-50 text-purple-700 border border-purple-200" :
                    "bg-red-50 text-red-700 border border-red-200"
                  )}>
                    {(voiceCallStatus === "firing" || voiceCallStatus === "queued" || voiceCallStatus === "ringing" || voiceCallStatus === "in_progress") && (
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    )}
                    <span>
                      {voiceCallStatus === "firing" ? "Placing call…" :
                       voiceCallStatus === "queued" ? "Call queued…" :
                       voiceCallStatus === "ringing" ? "📞 Ringing…" :
                       voiceCallStatus === "in_progress" ? "🟢 In progress" :
                       voiceCallStatus === "completed" ? "✅ Call completed" :
                       voiceCallStatus === "voicemail" ? "📩 Voicemail left" :
                       voiceCallStatus === "no_answer" ? "🔇 No answer" :
                       "❌ Call failed"}
                    </span>
                  </div>
                  {voiceCallSummary && (
                    <p className="mt-2 text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">{voiceCallSummary}</p>
                  )}
                  {voiceCallTranscript && (
                    <div className="mt-2">
                      <button
                        onClick={() => setVoiceCallShowTranscript(v => !v)}
                        className="text-[11px] text-violet-600 font-semibold hover:underline"
                      >
                        {voiceCallShowTranscript ? "Hide transcript" : "Show transcript"}
                      </button>
                      {voiceCallShowTranscript && (
                        <pre className="mt-1 text-[11px] text-slate-600 whitespace-pre-wrap bg-slate-50 rounded-xl px-3 py-2 border border-slate-100 max-h-32 overflow-y-auto">{voiceCallTranscript}</pre>
                      )}
                    </div>
                  )}
                  {voiceCallRecordingUrl && (
                    <audio controls src={voiceCallRecordingUrl} className="w-full mt-2 h-8" />
                  )}
                </div>
              )}

              {/* Divider */}
              <div className="h-px bg-slate-100 mx-5" />

              {/* Action buttons */}
              <div className="flex items-center gap-2 px-5 py-4 mt-auto">
                <button
                  onClick={() => {
                    if (voiceCallPollRef.current) clearInterval(voiceCallPollRef.current);
                    setVoiceConfirm(null); setVoiceNeedsSearch(false); setVoiceSearchQuery("");
                    setVoiceTone("friendly"); setVoiceBubbleEditing(false);
                    setVoiceCallStatus("idle"); setVoiceCallVapiId(null);
                    setVoiceCallSummary(null); setVoiceCallTranscript(null); setVoiceCallRecordingUrl(null);
                  }}
                  className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  {voiceConfirmAction === "call" && (voiceCallStatus === "completed" || voiceCallStatus === "voicemail" || voiceCallStatus === "no_answer") ? "Done" : "Cancel"}
                </button>

                {/* TEXT action send button */}
                {voiceConfirmAction === "text" && (
                  <button
                    disabled={!voiceConfirm.selected || !voiceConfirmMsg.trim() || voiceSending}
                    onClick={async () => {
                      if (!voiceConfirm.selected || !voiceConfirmMsg.trim()) return;
                      setVoiceSending(true);
                      try {
                        await sendVoiceText.mutateAsync({
                          sessionId: voiceConfirm.selected.sessionId,
                          message: voiceConfirmMsg.trim(),
                          fromNumberId: "PN0wVLcpCq",
                          isVoiceCommand: true,
                        });
                        toast.success(`Texted ${voiceConfirm.selected.name} ✓`);
                        setVoiceConfirm(null);
                        setVoiceConfirmMsg("");
                        setVoiceNeedsSearch(false);
                        setVoiceSearchQuery("");
                        setVoiceTone("friendly");
                        setVoiceBubbleEditing(false);
                      } catch {
                        toast.error("Failed to send — please try again");
                      } finally {
                        setVoiceSending(false);
                      }
                    }}
                    className="flex-1 rounded-2xl bg-[#007AFF] text-white px-4 py-3 text-sm font-semibold hover:bg-blue-600 disabled:opacity-40 transition flex items-center justify-center gap-2"
                  >
                    {voiceSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {voiceSending ? "Sending…" : "Send"}
                  </button>
                )}

                {/* REMIND action button */}
                {voiceConfirmAction === "remind" && (
                  <button
                    disabled={!voiceRemindTime.trim() || voiceSending}
                    onClick={async () => {
                      if (!voiceRemindTime.trim()) return;
                      setVoiceSending(true);
                      try {
                        // Parse the time expression into a UTC epoch ms timestamp
                        const timeStr = voiceRemindTime.trim().toLowerCase();
                        let triggerAt: number;
                        const now = Date.now();
                        const minMatch = timeStr.match(/(\d+)\s*min/);
                        const hrMatch = timeStr.match(/(\d+)\s*h/);
                        const clockMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
                        if (minMatch) {
                          triggerAt = now + parseInt(minMatch[1]) * 60_000;
                        } else if (hrMatch) {
                          triggerAt = now + parseInt(hrMatch[1]) * 3_600_000;
                        } else if (clockMatch) {
                          const d = new Date();
                          let h = parseInt(clockMatch[1]);
                          const m = clockMatch[2] ? parseInt(clockMatch[2]) : 0;
                          const ampm = clockMatch[3];
                          if (ampm === "pm" && h < 12) h += 12;
                          if (ampm === "am" && h === 12) h = 0;
                          d.setHours(h, m, 0, 0);
                          if (d.getTime() <= now) d.setDate(d.getDate() + 1); // next occurrence
                          triggerAt = d.getTime();
                        } else {
                          triggerAt = now + 30 * 60_000; // fallback 30 min
                        }
                        await setReminderMutation.mutateAsync({
                          channel: "command",
                          body: voiceConfirmMsg.trim() || "Voice reminder",
                          authorName: callerName,
                          triggerAt,
                        });
                        toast.success(`⏰ Reminder set for ${voiceRemindTime}`);
                        setVoiceConfirm(null);
                        setVoiceConfirmMsg("");
                        setVoiceRemindTime("");
                      } catch {
                        toast.error("Failed to set reminder");
                      } finally {
                        setVoiceSending(false);
                      }
                    }}
                    className="flex-1 rounded-2xl bg-violet-600 text-white px-4 py-3 text-sm font-semibold hover:bg-violet-700 disabled:opacity-40 transition flex items-center justify-center gap-2"
                  >
                    {voiceSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>⏰</span>}
                    {voiceSending ? "Setting…" : "Set Reminder"}
                  </button>
                )}

                {/* CALL action button */}
                {voiceConfirmAction === "call" && voiceCallStatus === "idle" && (
                  <button
                    disabled={!voiceConfirm.selected || !voiceConfirmMsg.trim()}
                    onClick={() => {
                      if (!voiceConfirm.selected) return;
                      voiceCallContactNameRef.current = voiceConfirm.selected.name;
                      voiceCallContactPhoneRef.current = voiceConfirm.selected.phone;
                      voiceCallScriptRef.current = voiceConfirmMsg.trim();
                      setVoiceCallStatus("firing");
                      voiceStartCallMutation.mutate({
                        cleanerJobId: 1,
                        jobDate: "",
                        personName: voiceConfirm.selected.name,
                        phone: voiceConfirm.selected.phone,
                        scenario: voiceConfirmScenario ?? voiceConfirmMsg.slice(0, 80),
                        script: voiceConfirmMsg.trim(),
                        audience: "customer",
                      });
                    }}
                    className="flex-1 rounded-2xl bg-green-600 text-white px-4 py-3 text-sm font-semibold hover:bg-green-700 disabled:opacity-40 transition flex items-center justify-center gap-2"
                  >
                    📞 Call {voiceConfirm.selected?.name?.split(" ")[0] ?? ""}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Composer box with drag-drop */}
          <div className="relative">

          {/* @mention autocomplete dropdown */}
          {mentionQuery !== null && mentionSuggestions.length > 0 && (
            <div className="absolute bottom-full mb-1 left-0 z-50 w-56 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
              {mentionSuggestions.map((name, idx) => (
                <button
                  key={name}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const before = composer.slice(0, mentionStart);
                    const after = composer.slice(composerRef.current?.selectionStart ?? composer.length);
                    const next = before + "@" + name + " " + after;
                    setComposer(next);
                    setMentionQuery(null);
                    requestAnimationFrame(() => {
                      const pos = (before + "@" + name + " ").length;
                      composerRef.current?.focus();
                      composerRef.current?.setSelectionRange(pos, pos);
                    });
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors",
                    idx === mentionIndex ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50"
                  )}
                >
                  {senderPhotoMap[name] ? (
                    <img src={senderPhotoMap[name]!} alt={name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: `hsl(${(name.charCodeAt(0) * 37) % 360}, 55%, 52%)` }}>
                      {name[0].toUpperCase()}
                    </div>
                  )}
                  <span className="font-medium truncate">{name}</span>
                </button>
              ))}
            </div>
          )}
          {/* @mention autocomplete dropdown — customers + cleaners combined */}
          {customerMentionQuery !== null && (customerSuggestions.length > 0 || cleanerSuggestions.length > 0) && (
            <div className="absolute bottom-full mb-1 left-0 z-50 w-72 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-80 overflow-y-auto">
              {customerSuggestions.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50 sticky top-0">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Customers</p>
                  </div>
                  {customerSuggestions.map((c) => {
                    const initials = c.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                    const hue = Math.abs(c.phone.split("").reduce((a: number, ch: string) => a + ch.charCodeAt(0), 0)) % 360;
                    return (
                      <button
                        key={c.phone}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          // Store phone in token for reliable lookup across sessions
                          mentionPhoneMapRef.current[c.name] = c.phone;
                          const token = `@[${c.name}|${c.phone}]`;
                          const before = composer.slice(0, mentionStart);
                          const after = composer.slice(composerRef.current?.selectionStart ?? composer.length);
                          setComposer(before + token + " " + after);
                          setCustomerMentionQuery(null);
                          requestAnimationFrame(() => {
                            const pos = (before + token + " ").length;
                            composerRef.current?.focus();
                            composerRef.current?.setSelectionRange(pos, pos);
                          });
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-slate-50 transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: `hsl(${hue}, 55%, 52%)` }}>
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{c.name}</p>
                          <p className="text-[11px] text-slate-400 truncate">{c.frequency ?? "Customer"}{c.city ? ` · ${c.city}` : ""}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold text-emerald-600">${c.ltv >= 1000 ? `${(c.ltv / 1000).toFixed(1)}k` : c.ltv}</p>
                          <p className="text-[10px] text-slate-400">{c.totalCleans} cleans</p>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
              {cleanerSuggestions.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50 sticky top-0">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Cleaners / Teams</p>
                  </div>
                  {cleanerSuggestions.map((c) => {
                    const initials = c.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                    const hue = Math.abs(c.phone.split("").reduce((a: number, ch: string) => a + ch.charCodeAt(0), 0)) % 360;
                    return (
                      <button
                        key={c.phone}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          // Store phone in token for reliable lookup across sessions
                          mentionPhoneMapRef.current[c.name] = c.phone;
                          const token = `@[${c.name}|${c.phone}]`;
                          const before = composer.slice(0, mentionStart);
                          const after = composer.slice(composerRef.current?.selectionStart ?? composer.length);
                          setComposer(before + token + " " + after);
                          setCustomerMentionQuery(null);
                          requestAnimationFrame(() => {
                            const pos = (before + token + " ").length;
                            composerRef.current?.focus();
                            composerRef.current?.setSelectionRange(pos, pos);
                          });
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-slate-50 transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: `hsl(${hue}, 55%, 52%)` }}>
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{c.name}</p>
                          <p className="text-[11px] text-slate-400">Cleaner</p>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
          {/* WhatsApp single-row composer: [+] [textarea] [emoji] */}
          <div
            className={cn(
              "rounded-2xl border px-3 py-2 transition flex items-center gap-2",
              isDragging ? "border-slate-300 bg-slate-200 ring-2 ring-slate-900/10" : "border-slate-200 bg-slate-50"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) stageFiles(e.dataTransfer.files); }}
          >
              {/* + button opens action menu */}
              <Popover open={plusOpen} onOpenChange={setPlusOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "shrink-0 h-9 w-9 rounded-full border-2 flex items-center justify-center transition-all",
                      plusOpen ? "border-slate-900 bg-slate-900 text-white rotate-45" : "border-slate-300 bg-white text-slate-600 hover:border-slate-500"
                    )}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-1.5" align="start" side="top">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-1">Actions</p>
                  <button onClick={() => { setBroadcastOpen(true); setPlusOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 transition flex items-center gap-2.5 text-sm text-slate-700">
                    <Radio className="h-4 w-4 text-slate-500" /> Broadcast
                  </button>
                  <button onClick={() => { setReminderOpen(true); setPlusOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 transition flex items-center gap-2.5 text-sm text-slate-700">
                    <Bell className="h-4 w-4 text-slate-500" /> Reminder
                  </button>
                  <button onClick={() => { setPinOpen(true); setPlusOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 transition flex items-center gap-2.5 text-sm text-slate-700">
                    <Pin className="h-4 w-4 text-slate-500" /> Pin
                  </button>
                  <button onClick={() => { setFollowUpsOpen(true); setPlusOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 transition flex items-center gap-2.5 text-sm text-slate-700">
                    <ClipboardList className="h-4 w-4 text-slate-500" /> Follow-ups
                  </button>
                  <button onClick={() => { setFaqOpen(true); setPlusOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 transition flex items-center gap-2.5 text-sm text-slate-700">
                    <BookOpen className="h-4 w-4 text-slate-500" /> FAQ
                  </button>
                  <button onClick={() => { fileInputRef.current?.click(); setPlusOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 transition flex items-center gap-2.5 text-sm text-slate-700">
                    <span className="text-base leading-none">📷</span> Photo
                  </button>
                  {isRecording ? (
                    <button onClick={() => { stopRecording(); setPlusOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-red-50 transition flex items-center gap-2.5 text-sm text-red-600">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      {recordingSeconds}s — Stop
                    </button>
                  ) : isTranscribing ? (
                    <button disabled className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2.5 text-sm text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin" /> Transcribing…
                    </button>
                  ) : (
                    <button onClick={() => { startRecording(); setPlusOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 transition flex items-center gap-2.5 text-sm text-slate-700">
                      <span className="text-base leading-none">🎤</span> Voice
                    </button>
                  )}
                  <button onClick={() => { setObjectionOpen(true); setPlusOpen(false); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 transition flex items-center gap-2.5 text-sm text-slate-700">
                    <span className="text-base leading-none">🛡️</span> Objections
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  {awayStatus ? (
                    <button
                      onClick={() => {
                        if (imBackFiredRef.current) return;
                        imBackFiredRef.current = true;
                        onSendMessage(`✅ ${callerName} — I'm Back`, undefined, undefined, "away_status:back");
                        onSetAwayStatus?.(null);
                        setPlusOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-emerald-50 transition flex items-center gap-2.5 text-sm text-emerald-700 font-semibold"
                    >
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> I'm Back
                    </button>
                  ) : (
                    <Popover open={awayOpen} onOpenChange={setAwayOpen}>
                      <PopoverTrigger asChild>
                        <button className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 transition flex items-center gap-2.5 text-sm text-slate-700">
                          <span className="inline-block w-2 h-2 rounded-full bg-amber-400" /> Away
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-52 p-1.5" align="start" side="right">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-1">Set status</p>
                        {([
                          { key: "away_sec", label: "Away for a sec",  sub: "Quick break",         emoji: "☕",  accent: "#f59e0b", bg: "#fffbeb", border: "#fde68a" },
                          { key: "lunch",    label: "Lunch break",     sub: "Quick munch",         emoji: "🍔",  accent: "#10b981", bg: "#ecfdf5", border: "#a7f3d0" },
                          { key: "back15",   label: "Back in 15",      sub: "Short defined break", emoji: "⏰",  accent: "#6366f1", bg: "#eef2ff", border: "#c7d2fe" },
                          { key: "eod",      label: "Signing off",     sub: "End of day",          emoji: "🌙",  accent: "#0ea5e9", bg: "#f0f9ff", border: "#bae6fd" },
                        ] as const).map(({ key, label, sub, emoji, accent, bg, border }) => (
                          <button
                            key={key}
                            className="w-full text-left px-3 py-2.5 rounded-lg hover:opacity-90 transition flex items-center gap-3 mb-1"
                            style={{ background: bg, border: `1px solid ${border}` }}
                            onClick={() => {
                              imBackFiredRef.current = false;
                              onSendMessage(`${emoji} ${callerName} — ${label}`, undefined, undefined, `away_status:${key}`);
                              onSetAwayStatus?.(key);
                              setAwayOpen(false);
                              setPlusOpen(false);
                            }}
                          >
                            <span className="text-xl leading-none">{emoji}</span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold leading-tight" style={{ color: accent }}>{label}</p>
                              <p className="text-[11px] text-slate-400 leading-tight">{sub}</p>
                            </div>
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  )}
                </PopoverContent>
              </Popover>
            {/* Textarea grows to fill space */}
            <Textarea
              ref={composerRef}
              value={composer}
              onChange={(e) => {
                const val = e.target.value;
                // Intercept +issue to open Create Issue modal
                if (val.trim().toLowerCase() === '+issue') {
                  setComposer('');
                  setCreateIssueModalOpen(true);
                  return;
                }
                setComposer(val);
                const pos = e.target.selectionStart ?? val.length;
                const before = val.slice(0, pos);
                const atMatch = before.match(/@([\w\s]*)$/);
                if (atMatch) {
                  const q = atMatch[1];
                  setMentionStart(pos - atMatch[0].length);
                  setMentionIndex(0);
                  // If query has a space it's likely a full name — search customers
                  if (q.includes(" ") || q.length >= 3) {
                    // Check if it matches an agent name first
                    const agentMatch = mentionNames.some(n => n.toLowerCase().startsWith(q.toLowerCase()));
                    if (!agentMatch && q.length >= 2) {
                      setCustomerMentionQuery(q);
                      setMentionQuery(null);
                    } else {
                      setMentionQuery(q);
                      setCustomerMentionQuery(null);
                    }
                  } else {
                    setMentionQuery(q);
                    setCustomerMentionQuery(null);
                  }
                } else {
                  setMentionQuery(null);
                  setCustomerMentionQuery(null);
                }
              }}
              placeholder={isDragging ? "Drop photos here…" : isTranscribing ? "Transcribing voice note…" : "Message the team…"}
              rows={1}
              className="flex-1 resize-none border-0 bg-transparent p-0 text-sm text-slate-700 focus-visible:ring-0 placeholder:text-slate-400 self-center"
              onKeyDown={(e) => {
                if (mentionQuery !== null && mentionSuggestions.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionSuggestions.length - 1)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
                  if (e.key === "Tab") {
                    // Tab: insert the mention and keep composing
                    e.preventDefault();
                    const chosen = mentionSuggestions[mentionIndex];
                    if (chosen) {
                      const before = composer.slice(0, mentionStart);
                      const after = composer.slice((composerRef.current?.selectionStart ?? composer.length));
                      const next = before + "@" + chosen + " " + after;
                      setComposer(next);
                      setMentionQuery(null);
                      requestAnimationFrame(() => {
                        const pos = (before + "@" + chosen + " ").length;
                        composerRef.current?.setSelectionRange(pos, pos);
                      });
                    }
                    return;
                  }
                  if (e.key === "Enter") {
                    // Enter with dropdown open: close dropdown and send immediately
                    e.preventDefault();
                    setMentionQuery(null);
                    handleSend();
                    return;
                  }
                  if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); return; }
                }
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); return; }
                if (awayStatus && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  if (!imBackFiredRef.current) {
                    imBackFiredRef.current = true;
                    onSendMessage(`✅ ${callerName} — I'm Back`, undefined, undefined, "away_status:back");
                    onSetAwayStatus?.(null);
                  }
                }
                onCmdKeyPress();
              }}
              onBlur={onCmdBlur}
            />
            {/* WhatsApp-style bottom bar: + menu | emoji */}
              {/* PTT mic button — hold to talk, release to send */}
              <button
                className={cn(
                  "shrink-0 h-9 w-9 rounded-full border-2 flex items-center justify-center transition-all select-none",
                  isPttActive
                    ? "border-red-500 bg-red-500 text-white animate-pulse"
                    : isTranscribing
                    ? "border-violet-300 bg-violet-50 text-violet-400 cursor-wait"
                    : "border-slate-200 bg-white hover:border-violet-400 hover:text-violet-600 text-slate-500"
                )}
                onMouseDown={(e) => { e.preventDefault(); if (!isPttActiveRef.current && !isTranscribing) { isPttActiveRef.current = true; setIsPttActive(true); startRecording(); } }}
                onMouseUp={() => { if (isPttActiveRef.current) stopRecordingAndSend(); }}
                onMouseLeave={() => { if (isPttActiveRef.current) stopRecordingAndSend(); }}
                title="Hold to talk (or hold Ctrl+Shift+Space)"
                disabled={isTranscribing}
              >
                {isPttActive ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-white" />
                ) : isTranscribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
              {/* Emoji picker */}
              <div ref={emojiRef} className="relative shrink-0">
                <button
                  className={cn("h-9 w-9 rounded-full border-2 flex items-center justify-center transition text-base", showEmoji ? "border-slate-400 bg-slate-100" : "border-slate-200 bg-white hover:border-slate-400")}
                  onClick={() => setShowEmoji(v => !v)}
                >
                  😊
                </button>
                {showEmoji && (
                  <div className="absolute bottom-11 left-0 z-50 shadow-2xl rounded-2xl overflow-hidden">
                    <EmojiPicker
                      theme={Theme.LIGHT}
                      onEmojiClick={(data) => { insertEmoji(data); setShowEmoji(false); }}
                      height={350}
                      width={300}
                      searchDisabled={false}
                      skinTonesDisabled
                      previewConfig={{ showPreview: false }}
                    />
                  </div>
                )}
              </div>
          </div>
          </div>{/* end relative wrapper for @mention dropdown */}
        </div>
        </div>{/* end relative composer wrapper */}
        </div>{/* end white card */}
      </div>
      {/* ── Right drag handle ── */}
      <div
        className="relative flex-none"
        style={{ width: rightCollapsed ? 0 : 12, cursor: rightCollapsed ? "default" : "col-resize", zIndex: 10 }}
        onMouseDown={rightCollapsed ? undefined : startDrag("right")}
      />

      {/* ── RIGHT PANEL: Rules + Auto-Raised Issues + Suggested Widgets ── */}
      <div
        className="shrink-0 flex flex-col overflow-y-auto transition-[width] duration-200"
        style={{ width: rightCollapsed ? 0 : rightWidth, minWidth: rightCollapsed ? 0 : MIN_RIGHT, overflow: rightCollapsed ? "hidden" : undefined, scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <div className="rounded-[32px] border border-white/70 bg-white/80 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="px-5 py-4 space-y-4">

          {/* ── Search bar ── */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              type="text"
              value={rightSearch}
              onChange={(e) => setRightSearch(e.target.value)}
              placeholder="Search leads, issues, people"
              className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none"
            />
            {rightSearch && (
              <button onClick={() => setRightSearch("")} className="text-slate-400 hover:text-slate-600">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* ── Hot leads / Follow-ups tab toggle ── */}
          <div className="flex rounded-2xl border border-slate-200 bg-slate-50 p-1 gap-1">
            <button
              onClick={() => setRightTab("leads")}
              className={cn("flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition", rightTab === "leads" ? "bg-white text-slate-900 shadow-sm border border-blue-500" : "text-slate-500")}
            >
              Hot leads
            </button>
            <button
              onClick={() => setRightTab("followups")}
              className={cn("flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition", rightTab === "followups" ? "bg-white text-slate-900 shadow-sm border border-blue-500" : "text-slate-500")}
            >
              Follow-ups
            </button>
          </div>

          {/* ── Hot Leads Tray (shown when rightTab === "leads") ── */}
          {rightTab === "leads" && (
          <HotLeadsTray
            channelMsgs={channelMsgs}
            claimLeadMutation={claimLeadMutation}
            searchQuery={rightSearch}
            onCollapse={() => {/* right column is always visible */}}
            onOpenFirstMsg={(details) => {
              setFirstMsgDetails(details);
              setFirstMsgResult("");
              setFirstMsgCopied(false);
              setFirstMsgOpen(true);
            }}
          />
          )}

          {rightTab === "leads" && (
          <>
          <div className="border-t border-slate-200" />

          {/* Auto-Raised Issues — only under leads tab */}
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-3">Auto-Raised Issues</p>
            {cmdLoading ? (
              <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
            ) : autoRaised.length === 0 ? (
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-center">
                <CheckCheck className="h-4 w-4 text-emerald-500 mx-auto mb-1" />
                <p className="text-xs text-emerald-600 font-medium">No open issues</p>
              </div>
            ) : (
              <div className="space-y-2">
                {autoRaised.map((issue) => (
                  <div key={issue.flagId} className="rounded-xl bg-red-50 border border-red-100 p-3">
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-sm font-bold text-red-700 leading-snug">{issue.jobName}</p>
                      <button
                        title="Edit note"
                        onClick={() => {
                          setEditingNoteId(issue.flagId);
                          setEditingNoteText(issue.note ?? "");
                        }}
                        className="shrink-0 mt-0.5 text-red-400 hover:text-red-600 transition"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                          <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                        </svg>
                      </button>
                    </div>
                    {editingNoteId === issue.flagId ? (
                      <div className="mt-2 space-y-1.5">
                        <textarea
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border border-red-200 bg-white text-xs text-slate-700 px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-red-400"
                          placeholder="Add a note about this issue..."
                          autoFocus
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => updateIssueNoteMutation.mutate({ flagId: issue.flagId, note: editingNoteText })}
                            disabled={updateIssueNoteMutation.isPending}
                            className="flex-1 rounded-lg bg-red-600 text-white text-[10px] font-semibold py-1.5 hover:bg-red-700 transition disabled:opacity-50"
                          >
                            {updateIssueNoteMutation.isPending ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingNoteId(null)}
                            className="flex-1 rounded-lg bg-white border border-red-200 text-red-600 text-[10px] font-semibold py-1.5 hover:bg-red-50 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-red-600 mt-0.5 leading-snug">{issue.note || <span className="italic text-red-400">No note — click pencil to add</span>}</p>
                    )}
                    <button
                      onClick={() => onJumpToJob(issue.jobId)}
                      className="mt-2 text-[10px] font-bold tracking-widest text-red-500 uppercase hover:text-red-700 transition"
                    >
                      Jump to Job Thread →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          </>
          )}

          {/* Follow-ups + Manual Issues — only under followups tab */}
          {rightTab === "followups" && (
          <>
            <div>
              <button
                onClick={() => setFuPanelExpanded((v) => !v)}
                className="w-full flex items-center justify-between mb-3 group"
              >
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-3.5 w-3.5 text-violet-500" />
                  <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">Follow-ups</p>
                  {fuPanelItems.length > 0 && (
                    <span className="text-[10px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">{fuPanelItems.length}</span>
                  )}
                </div>
                <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", fuPanelExpanded && "rotate-180")} />
              </button>
              {fuPanelExpanded && (
                fuPanelItems.length === 0 ? (
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
                    <p className="text-xs text-slate-400">No active follow-ups</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(fuPanelItems as any[]).filter((fu) => !rightSearch.trim() || fu.name?.toLowerCase().includes(rightSearch.toLowerCase()) || fu.nextStep?.toLowerCase().includes(rightSearch.toLowerCase()) || fu.owner?.toLowerCase().includes(rightSearch.toLowerCase())).map((fu) => {
                      const isOverdue = fu.dueAt < Date.now();
                      const d = new Date(fu.dueAt);
                      const dueStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
                      return (
                        <button
                          key={fu.id}
                          onClick={() => { setFollowUpsInitialId(fu.id); setFollowUpsOpen(true); }}
                          className="w-full text-left rounded-xl border border-slate-200 bg-white p-3 hover:border-violet-300 hover:shadow-sm transition"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="text-sm font-semibold text-slate-900 leading-tight truncate">{fu.name}</span>
                            {fu.priority === "High" && (
                              <span className="text-[10px] font-bold bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full shrink-0">High</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mb-1.5 line-clamp-2 leading-relaxed">{fu.nextStep}</p>
                          <div className="flex flex-wrap gap-1">
                            <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", isOverdue ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600")}>{dueStr}</span>
                            <span className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{fu.owner}</span>
                            <span className="text-[10px] font-medium bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full">{fu.type}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            <div className="border-t border-slate-200" />

            <div>
              <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-3">Manual Issues</p>
              {cmdLoading ? (
                <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
              ) : manualIssues.length === 0 ? (
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
                  <p className="text-xs text-slate-400">No open manual issues</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {manualIssues.map((issue) => (
                    <div key={issue.messageId} className="rounded-xl bg-orange-50 border border-orange-100 p-3">
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-sm font-bold text-orange-700 leading-snug">{issue.title}</p>
                        <span className="text-[10px] text-orange-400 shrink-0 mt-0.5">{fmt12(issue.ts)}</span>
                      </div>
                      {issue.note && <p className="text-xs text-orange-600 mt-0.5 leading-snug">{issue.note}</p>}
                      {issue.jobTitle && <p className="text-[10px] text-orange-400 mt-0.5">Job: {issue.jobTitle}</p>}
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-400">{issue.authorName}</p>
                        <button
                          onClick={() => {
                            setResolveIssueMessageId(issue.messageId);
                            setResolveIssueTitle(issue.title);
                            setResolveIssueNote(issue.note ?? "");
                            setResolveIssueNoteText("");
                            setResolveIssueOpen(true);
                          }}
                          className="text-[10px] font-semibold text-orange-500 hover:text-orange-700 underline"
                        >
                          Resolve
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
          )}

        </div>
        </div>{/* end white card */}
      </div>

      {/* ── Issue Engine Overlay ── */}
      <IssueEngineOverlay
        open={issueEngineOverlayOpen}
        onClose={() => { setIssueEngineOverlayOpen(false); setIssueEngineInitialId(null); }}
        callerName={callerName}
        agentPhotoMap={senderPhotoMap}
        initialIssueId={issueEngineInitialId}
      />
      {/* ── Create Issue Modal (+issue) ── */}
      <CreateIssueModal
        open={createIssueModalOpen}
        onClose={() => { setCreateIssueModalOpen(false); setCreateIssueDefaultTitle(""); }}
        callerName={callerName}
        defaultTitle={createIssueDefaultTitle}
        onIssueCreated={(meta) => {
          // Optimistic: inject the card into the channel cache immediately
          const tempId = Date.now() * -1;
          const tempMsg = {
            id: tempId,
            ts: Date.now(),
            from: callerName,
            role: "office" as const,
            body: meta.issueTitle,
            mediaUrl: null,
            quickAction: "issue_engine_created",
            metadata: JSON.stringify(meta),
            replyToId: null,
            replyToBody: null,
            replyToAuthor: null,
            cleanerJobId: null,
            threadParentId: null,
            threadParentBody: null,
            threadParentFrom: null,
            replyCount: 0,
          };
          utils.opsChat.listChannelMessages.setData(
            { channel: "command" },
            (prev) => prev ? [...prev, tempMsg] : [tempMsg]
          );
        }}
      />
      {/* ── Open Issue Dialog ── */}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-red-600" />
              Open Issue
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">Post a general issue to the Command Chat. Optionally tag a job.</p>
          <div className="space-y-3">
            <Input
              placeholder="Issue title (required)"
              value={issueTitle}
              onChange={(e) => setIssueTitle(e.target.value)}
            />
            <Textarea
              placeholder="Additional notes (optional)"
              value={issueNote}
              onChange={(e) => setIssueNote(e.target.value)}
              rows={3}
              className="resize-none"
            />
            {todayJobsData && todayJobsData.length > 0 && (
              <select
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
                value={issueJobId ?? ""}
                onChange={(e) => setIssueJobId(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">Tag a job (optional)</option>
                {todayJobsData.map((j) => (
                  <option key={j.id} value={j.id}>{j.client} · {j.time}</option>
                ))}
              </select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)}>Cancel</Button>
            <Button
              onClick={() => openIssueMutation.mutate({ title: issueTitle, note: issueNote, jobId: issueJobId, channel: "command", authorName: callerName })}
              disabled={!issueTitle.trim() || openIssueMutation.isPending}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {openIssueMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TriangleAlert className="h-4 w-4 mr-2" />}
              Post Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Set Reminder Dialog ── */}
      <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-sky-600" />
              Set Reminder
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">A reminder card will post to Command Chat at the scheduled time.</p>
          <Textarea
            placeholder="Reminder message…"
            value={reminderBody}
            onChange={(e) => setReminderBody(e.target.value)}
            rows={3}
            className="resize-none"
          />
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2">When?</p>
            <div className="flex gap-2 flex-wrap">
              {[5, 15, 30, 60].map((m) => (
                <button
                  key={m}
                  onClick={() => setReminderMinutes(m)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-xs font-semibold border transition",
                    reminderMinutes === m
                      ? "bg-sky-600 text-white border-sky-600"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-sky-50"
                  )}
                >
                  {m < 60 ? `${m} min` : "1 hr"}
                </button>
              ))}
              <button
                onClick={() => setReminderMinutes(-1)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-xs font-semibold border transition",
                  reminderMinutes === -1
                    ? "bg-sky-600 text-white border-sky-600"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-sky-50"
                )}
              >
                Custom
              </button>
            </div>
            {reminderMinutes === -1 && (
              <Input
                className="mt-2 w-28"
                type="number"
                min={1}
                max={480}
                placeholder="Minutes"
                value={reminderCustom}
                onChange={(e) => setReminderCustom(e.target.value)}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReminderOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const mins = reminderMinutes === -1 ? parseInt(reminderCustom, 10) : reminderMinutes;
                if (!mins || mins < 1) return;
                setReminderMutation.mutate({ body: reminderBody, triggerAt: Date.now() + mins * 60_000, channel: "command", authorName: callerName });
              }}
              disabled={!reminderBody.trim() || setReminderMutation.isPending || (reminderMinutes === -1 && (!reminderCustom || parseInt(reminderCustom, 10) < 1))}
              className="bg-sky-600 text-white hover:bg-sky-700"
            >
              {setReminderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Bell className="h-4 w-4 mr-2" />}
              Set Reminder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Pin Note Dialog ── */}
      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pin className="h-5 w-5 text-amber-600" />
              Pin a Note
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">Pins a sticky note at the top of Command Chat. Only one pin at a time — pinning a new note replaces the current one.</p>
          {/* Sticky note preview */}
          <div
            className="rounded-xl border-2 border-amber-300 overflow-hidden shadow-sm"
            style={{ background: "linear-gradient(135deg, #fef9c3 0%, #fef3c7 50%, #fde68a 100%)" }}
          >
            <div className="h-2 w-full" style={{ background: "repeating-linear-gradient(90deg, #fbbf24 0px, #fbbf24 18px, #fde68a 18px, #fde68a 36px)" }} />
            <Textarea
              placeholder="Write your sticky note…"
              value={pinBody}
              onChange={(e) => setPinBody(e.target.value)}
              rows={4}
              className="resize-none border-0 bg-transparent text-amber-900 placeholder:text-amber-400 font-medium focus-visible:ring-0 px-4 py-3"
              style={{ fontFamily: "'Caveat', 'Patrick Hand', cursive, sans-serif", fontSize: "15px", lineHeight: "1.8" }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPinOpen(false)}>Cancel</Button>
            <Button
              onClick={() => pinNoteMutation.mutate({ body: pinBody, channel: "command", authorName: callerName })}
              disabled={!pinBody.trim() || pinNoteMutation.isPending}
              className="bg-amber-500 text-white hover:bg-amber-600"
            >
              {pinNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Pin className="h-4 w-4 mr-2" />}
              Pin Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Announce Booking Dialog ── */}
      <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PartyPopper className="h-5 w-5 text-violet-600" />
              Announce a Booking
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">Celebrate a new booking with the whole team!</p>
          <div className="space-y-3">
            <Input
              placeholder="Person's name (required)"
              value={bookingPerson}
              onChange={(e) => setBookingPerson(e.target.value)}
            />
            <Input
              placeholder="Amount (e.g. $320 recurring) — optional"
              value={bookingAmount}
              onChange={(e) => setBookingAmount(e.target.value)}
            />
            <Textarea
              placeholder="Extra note (optional)"
              value={bookingNote}
              onChange={(e) => setBookingNote(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingOpen(false)}>Cancel</Button>
            <Button
              onClick={() => announceBookingMutation.mutate({ personName: bookingPerson, amount: bookingAmount, note: bookingNote, channel: "command", authorName: callerName })}
              disabled={!bookingPerson.trim() || announceBookingMutation.isPending}
              className="bg-gradient-to-r from-violet-600 to-pink-500 text-white hover:from-violet-700 hover:to-pink-600"
            >
              {announceBookingMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PartyPopper className="h-4 w-4 mr-2" />}
              Announce!
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Broadcast Dialog ── */}
      <Dialog open={broadcastOpen} onOpenChange={setBroadcastOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-slate-700" />
              Broadcast to All Cleaners
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">This will send an SMS to every active cleaner with a phone number on file.</p>
          <Textarea
            value={broadcastMsg}
            onChange={(e) => setBroadcastMsg(e.target.value)}
            placeholder="Type your broadcast message…"
            rows={4}
            className="resize-none"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBroadcastOpen(false)}>Cancel</Button>
            <Button
              onClick={() => broadcastMutation.mutate({ message: broadcastMsg })}
              disabled={!broadcastMsg.trim() || broadcastMutation.isPending}
              className="bg-slate-900 text-white hover:bg-slate-700"
            >
              {broadcastMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send Broadcast
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Resolve Issue Modal (Command Chat general_issue) ───────────────────────────── */}
      {resolveIssueOpen && (resolveIssueMessageId !== null || resolveIssueKey !== null) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !resolveIssueSubmitting && setResolveIssueOpen(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
                  <CheckCheck className="h-4.5 w-4.5 text-green-600" />
                </div>
                <h2 className="text-lg font-bold text-slate-900">Resolve Issue</h2>
              </div>
              <button
                className="rounded-xl p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                onClick={() => setResolveIssueOpen(false)}
                disabled={resolveIssueSubmitting}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Original issue preview */}
            <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 mb-4">
              <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-1">⚠️ Original Issue</p>
              <p className="text-sm font-semibold text-slate-900">{resolveIssueTitle}</p>
              {resolveIssueNote && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{resolveIssueNote}</p>}
            </div>

            {/* Resolution note */}
            <div className="mb-4">
              <label className="text-sm font-semibold text-slate-700 mb-1.5 block">How was it resolved?</label>
              <Textarea
                value={resolveIssueNoteText}
                onChange={(e) => setResolveIssueNoteText(e.target.value)}
                placeholder="e.g. Cleaner got access via lockbox, client called back, issue was a false alarm…"
                rows={3}
                className="resize-none rounded-xl border-slate-200 text-sm"
                autoFocus
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 rounded-xl border-slate-200 text-slate-700"
                onClick={() => setResolveIssueOpen(false)}
                disabled={resolveIssueSubmitting}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 text-white"
                disabled={!resolveIssueNoteText.trim() || resolveIssueSubmitting}
                onClick={async () => {
                  if (!resolveIssueNoteText.trim()) return;
                  setResolveIssueSubmitting(true);
                  try {
                    if (resolveIssueMessageId) {
                      // Manual general_issue path — update message metadata
                      await openIssueMutation.mutateAsync({
                        title: "__resolve__",
                        note: "",
                        messageId: resolveIssueMessageId,
                        authorName: callerName,
                        resolutionNote: resolveIssueNoteText.trim(),
                      });
                    } else if (resolveIssueKey) {
                      // Alert / ownership path — mark resolved + add resolution note comment
                      await resolveIssueOwnershipMutation.mutateAsync({ issueKey: resolveIssueKey, resolvedBy: callerName });
                      await addIssueCommentMutation.mutateAsync({ issueKey: resolveIssueKey, authorName: callerName, body: resolveIssueNoteText.trim(), type: "text" });
                      setIssueResolved(prev => ({ ...prev, [resolveIssueKey]: true }));
                    }
                    setResolveIssueOpen(false);
                    setResolveIssueNoteText("");
                    setResolveIssueKey(null);
                    refetchOwnership();
                    toast.success("Issue resolved ✅");
                  } catch (err: unknown) {
                    toast.error("Failed to resolve issue", { description: err instanceof Error ? err.message : "Unknown error" });
                  } finally {
                    setResolveIssueSubmitting(false);
                  }
                }}
              >
                {resolveIssueSubmitting
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <><CheckCheck className="h-4 w-4 mr-1.5" /> Mark Resolved</>
                }
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── First Message Generator Modal ── */}
      {firstMsgOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setFirstMsgOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center">
                  <Wand2 className="h-4 w-4 text-white" />
                </div>
                <h2 className="text-base font-bold text-slate-900">First Message Generator</h2>
              </div>
              <button
                className="rounded-xl p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                onClick={() => setFirstMsgOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Input */}
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-1.5 block">
                  Paste Booking Details
                </label>
                <p className="text-xs text-slate-400 mb-2 leading-relaxed">
                  Paste the raw booking info (name, city, home size, services, pricing, availability, etc.) and the AI will craft a personalized first outreach message.
                </p>
                <Textarea
                  value={firstMsgDetails}
                  onChange={(e) => setFirstMsgDetails(e.target.value)}
                  placeholder={`e.g.\nName: Sarah Johnson\nCity: Arlington, VA\nHome: 3 bed / 2 bath\nService: Deep clean\nQuote: $220\u2013$260\nAvailability: Tue or Thu this week`}
                  rows={6}
                  className="resize-none rounded-xl border-slate-200 text-sm font-mono"
                  autoFocus
                />
              </div>

              {/* Generated result */}
              {firstMsgResult && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-semibold text-slate-700">Generated Message</label>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(firstMsgResult).then(() => {
                          setFirstMsgCopied(true);
                          setTimeout(() => setFirstMsgCopied(false), 2500);
                        });
                      }}
                      className={cn(
                        "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition",
                        firstMsgCopied
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      )}
                    >
                      {firstMsgCopied
                        ? <><CheckCheck className="h-3.5 w-3.5" /> Copied!</>
                        : <><MessageSquare className="h-3.5 w-3.5" /> Copy Message</>
                      }
                    </button>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                    {firstMsgResult}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-5 py-4 border-t border-slate-100">
              <Button
                variant="outline"
                className="flex-1 rounded-xl border-slate-200 text-slate-700"
                onClick={() => setFirstMsgOpen(false)}
              >
                Close
              </Button>
              <Button
                className="flex-1 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 text-white"
                disabled={!firstMsgDetails.trim() || generateFirstMessageMutation.isPending}
                onClick={() => generateFirstMessageMutation.mutate({ bookingDetails: firstMsgDetails.trim() })}
              >
                {generateFirstMessageMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Generating…</>
                  : <><Wand2 className="h-4 w-4 mr-1.5" /> Generate Message</>
                }
              </Button>
            </div>
          </div>
        </div>
      )}
      <FollowUpsModal
        open={followUpsOpen}
        onClose={() => { setFollowUpsOpen(false); setFollowUpsInitialId(null); }}
        initialItemId={followUpsInitialId}
      />

      {/* ─── Overdue Follow-up Forced-Acknowledgment Modal ─── */}
      {showOverdueModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          {/* Backdrop — no click-to-dismiss */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-md mx-4 bg-white rounded-3xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-red-600 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
                  <AlertTriangle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-bold text-lg leading-tight">Overdue Follow-Up{overdueItems.length > 1 ? 's' : ''}</p>
                  <p className="text-red-100 text-sm">{overdueItems.length} item{overdueItems.length > 1 ? 's' : ''} require{overdueItems.length === 1 ? 's' : ''} your attention</p>
                </div>
              </div>
            </div>
            {/* Items */}
            <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {overdueItems.map((fu: any) => {
                const d = new Date(fu.dueAt);
                const dueStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
                return (
                  <div key={fu.id} className="rounded-2xl border border-red-100 bg-red-50 p-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-semibold text-slate-900 text-sm leading-tight">{fu.name}</span>
                      <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap">{dueStr}</span>
                    </div>
                    <p className="text-xs text-slate-600 mb-3 leading-relaxed">{fu.nextStep}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          completeFuMutation.mutate({ id: fu.id });
                          setOverdueAcknowledged((prev) => new Set(prev).add(fu.id));
                        }}
                        className="flex-1 rounded-xl bg-slate-900 text-white text-xs font-semibold py-2 hover:bg-slate-700 transition"
                      >
                        Mark Done
                      </button>
                      <button
                        onClick={() => {
                          setOverdueAcknowledged((prev) => new Set(prev).add(fu.id));
                          setFollowUpsInitialId(fu.id);
                          setFollowUpsOpen(true);
                        }}
                        className="flex-1 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold py-2 hover:border-slate-300 transition"
                      >
                        Open
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Call Client (Running Late) Confirmation Dialog ──────────────────────── */}
      {callConfirmState && (
        <Dialog open onOpenChange={(o) => { if (!o) setCallConfirmState(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <span className="text-lg">📞</span> Confirm: Call Client
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3 py-1">
              {/* Test mode banner */}
              {callConfirmState.isTestCard && (
                <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-2.5 flex items-center gap-2">
                  <span className="text-base">🧪</span>
                  <div>
                    <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">Test Mode</p>
                    <p className="text-[11px] text-amber-600">Call will go to <span className="font-semibold">+1 (302) 981-6191</span>, not the real client.</p>
                  </div>
                </div>
              )}

              {/* Who will be called */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Client</p>
                <p className="text-sm font-semibold text-slate-800">
                  {callConfirmState.clientName ?? "(name not on file)"}
                </p>
              </div>

              {/* ETA — editable time input */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">ETA the call will give</p>
                  {editedEtaTime && (
                    <span className="text-[10px] text-red-600 font-semibold">
                      {etaTimeStringToLabel(editedEtaTime) ?? ""}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={editedEtaTime}
                    onChange={(e) => setEditedEtaTime(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                  {editedEtaTime && (
                    <button
                      onClick={() => setEditedEtaTime("")}
                      className="text-[11px] text-slate-400 hover:text-slate-600 transition px-1"
                      title="Clear ETA"
                    >
                      ✕ Clear
                    </button>
                  )}
                </div>
                {!editedEtaTime && (
                  <p className="text-[11px] text-slate-400 italic">No ETA — call will say &ldquo;running a little late&rdquo;</p>
                )}
              </div>

              {/* What the call will say — live preview based on editedEtaTime */}
              <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-400">Message that will be delivered</p>
                <p className="text-[12px] text-slate-700 leading-relaxed italic">
                  {(() => {
                    const firstName = callConfirmState.clientName?.split(" ")[0] ?? null;
                    const etaForPreview = editedEtaTime ? etaTimeStringToLabel(editedEtaTime) : null;
                    return (
                      <>
                        &ldquo;Hi{firstName ? ` ${firstName}` : ""}, this is a quick heads-up from Maid in Black — your cleaning team is running a little late
                        {etaForPreview ? ` and will arrive around ${etaForPreview}` : ""}.
                        We apologize for the delay and appreciate your patience. If you have any questions, feel free to call us back.&rdquo;
                      </>
                    );
                  })()}
                </p>
              </div>

              {/* Source badge for SMS-detected cards */}
              {callConfirmState.detectedFromSms && callConfirmState.smsText && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-amber-500">📱 Auto-detected from cleaner SMS</p>
                  <p className="text-[11px] text-amber-700 italic">&ldquo;{callConfirmState.smsText}&rdquo;</p>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <button
                onClick={() => setCallConfirmState(null)}
                className="flex-1 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold py-2 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => executeCallClientRunningLate(callConfirmState.cleanerJobId)}
                className="flex-1 rounded-xl bg-red-600 text-white text-sm font-semibold py-2 hover:bg-red-700 transition"
              >
                📞 Call Now
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── AI Call Command Center — Issue Dialog ── */}
      {issueDialogJob && (
        <IssueDialog
          open={!!issueDialogJob}
          onClose={() => setIssueDialogJob(null)}
          cleanerJobId={issueDialogJob.id}
          jobDate={issueDialogJob.date}
          onCallFired={() => {
            setIssueDialogJob(null);
            setCenterView("calls");
          }}
        />
      )}

      {/* ── AI Call Command Center — Call Log Sheet (alternative sheet view) ── */}
      <CallLogPanel
        open={callLogOpen}
        onClose={() => setCallLogOpen(false)}
        jobDate={todayDateStr}
      />

      {/* ── Slack-style Thread Panel (slides in from right) ── */}
      {openThreadId !== null && (
        <div
          className="fixed inset-y-0 right-0 z-[200] flex flex-col shadow-2xl"
          style={{ width: "380px", maxWidth: "90vw" }}
        >
          <ThreadPanel
            parentId={openThreadId}
            callerName={callerName}
            senderPhotoMap={senderPhotoMap}
            onClose={() => setOpenThreadId(null)}
            onSendReply={(body, parentId) => {
              if (onSendThreadReply) {
                onSendThreadReply(body, parentId);
              }
            }}
            refetchTick={threadRefetchTick}
          />
        </div>
      )}
      {/* All Threads browser — opened from header MessageSquare button */}
      <AllThreadsPanel
        open={allThreadsOpen}
        onClose={() => setAllThreadsOpen(false)}
        onOpenThread={(parentId) => {
          setAllThreadsOpen(false);
          setOpenThreadId(parentId);
        }}
      />
      {/* Lead Replies panel — opened from header MessageCircle button */}
      {/* CS SMS unanswered slide-in panel */}
      {csSmsOpen && (
        <div
          className="fixed inset-y-0 right-0 z-[200] flex flex-col bg-white shadow-2xl border-l border-slate-200 animate-in slide-in-from-right-2 duration-200"
          style={{ width: "360px", maxWidth: "90vw" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-semibold text-slate-900">Unanswered CS SMS</span>
              {csUnansweredUrgent > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none animate-pulse">
                  {csUnansweredUrgent} urgent
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(onSwitchToCS || onSwitchToCSSession) && (
                <button
                  onClick={() => { setCsSmsOpen(false); if (onSwitchToCS) onSwitchToCS(); }}
                  className="h-7 px-2.5 flex items-center gap-1 rounded-full text-[11px] font-semibold text-orange-600 hover:bg-orange-50 transition-colors"
                  title="Open CS inbox"
                >
                  Open CS
                  <ArrowRight className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={() => setCsSmsOpen(false)}
                className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors text-slate-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {/* Body */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {csUnansweredSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 py-16">
                <Smartphone className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium">No unanswered CS messages</p>
                <p className="text-xs text-slate-400">You're all caught up!</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {csUnansweredSessions.map((session) => {
                  const ageMin = Math.floor(session.ageMs / 60_000);
                  const ageDays = Math.floor(session.ageMs / 86_400_000);
                  const ageHours = Math.floor(session.ageMs / 3_600_000);
                  const ageLabel = ageMin < 1 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : ageDays >= 1 ? `${ageDays}d ago` : `${ageHours}h ${ageMin % 60}m ago`;
                  const isUrgent = session.ageMs > 60 * 60 * 1000;
                  const isWarning = !isUrgent && session.ageMs > 15 * 60 * 1000;
                  const displayName = session.leadName || session.leadPhone;
                  return (
                    <CsSmsHistoryPopover key={session.id} sessionId={session.id} onOpenFull={() => { setCsSmsOpen(false); if (onSwitchToCSSession) { onSwitchToCSSession(session.id); } else if (onSwitchToCS) { onSwitchToCS(); } }}>
                    <div className="flex items-stretch group hover:bg-slate-50 transition-colors">
                      {/* Main row — navigates to CS inbox */}
                      <button
                        onClick={() => {
                          setCsSmsOpen(false);
                          if (onSwitchToCSSession) {
                            onSwitchToCSSession(session.id);
                          } else if (onSwitchToCS) {
                            onSwitchToCS();
                          }
                        }}
                        className="flex-1 text-left px-4 py-3 min-w-0"
                      >
                        <div className="flex items-start gap-3">
                          {/* Age dot */}
                          <div className={cn(
                            "mt-1.5 h-2 w-2 rounded-full shrink-0",
                            isUrgent ? "bg-red-500 animate-pulse" : isWarning ? "bg-amber-400" : "bg-slate-300"
                          )} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900 truncate">{displayName}</span>
                              <span className={cn(
                                "text-[10px] font-semibold shrink-0",
                                isUrgent ? "text-red-500" : isWarning ? "text-amber-500" : "text-slate-400"
                              )}>{ageLabel}</span>
                            </div>
                            {session.lastMessagePreview && (
                              <p className="text-xs text-slate-500 truncate mt-0.5">{session.lastMessagePreview}</p>
                            )}
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-orange-500 transition-colors shrink-0 mt-1" />
                        </div>
                      </button>
                      {/* ⚡ Quick-reply button — opens composer modal */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCsSmsOpen(false);
                          const phone = session.leadPhone ?? "";
                          const name = session.leadName ?? phone;
                          setQuickReplyTarget({
                            customer: {
                              phone,
                              name,
                              email: null,
                              address: null,
                              frequency: null,
                              lastJobDate: null,
                              ltv: 0,
                              totalCleans: 0,
                              isVip: false,
                              city: "",
                            },
                            view: "sms",
                            lastMessage: session.lastMessagePreview ?? undefined,
                          });
                        }}
                        title="Quick Reply"
                        className="flex items-center gap-1 px-2.5 shrink-0 border-l border-slate-100 text-slate-400 hover:text-orange-600 hover:bg-orange-50 transition-colors text-[11px] font-semibold"
                      >
                        <span>⚡</span>
                        <span>Reply</span>
                      </button>
                      {/* Quick-resolve button — resolves without opening chat */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // Optimistically hide immediately so count drops at once
                          setHiddenCsSessionIds(prev => new Set([...prev, session.id]));
                          resolveSessionFromBanner.mutate({ sessionId: session.id });
                        }}
                        title="Resolve"
                        className="flex items-center justify-center w-10 shrink-0 border-l border-slate-100 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 transition-colors"
                      >
                        <CircleCheckBig className="h-4 w-4" />
                      </button>
                    </div>
                    </CsSmsHistoryPopover>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {leadRepliesOpen && (
        <div
          className="fixed inset-y-0 right-0 z-[200] flex flex-col bg-white shadow-2xl border-l border-slate-200 animate-in slide-in-from-right-2 duration-200"
          style={{ width: "360px", maxWidth: "90vw" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-semibold text-slate-900">Lead Replies</span>
              {unreadLeadRepliesCount > 0 && (
                <span className="bg-emerald-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                  {unreadLeadRepliesCount} new
                </span>
              )}
            </div>
            <button
              onClick={() => setLeadRepliesOpen(false)}
              className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors text-slate-400"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* Body */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {leadReplies.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 py-16">
                <MessageCircle className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium">No pending lead replies</p>
                <p className="text-xs text-slate-400">You\'re all caught up!</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {leadReplies.map((lead) => {
                  const ageMin = Math.floor(lead.ageMs / 60_000);
                  const ageLabel = ageMin < 1 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`;
                  const sourceLabel: Record<string, string> = {
                    thumbtack: 'Thumbtack', bark: 'Bark', yelp: 'Yelp',
                    form: 'Website', widget: 'Widget', voice: 'Phone',
                  };
                  const src = lead.leadSource ? (sourceLabel[lead.leadSource] ?? lead.leadSource) : 'Direct';
                  const openLeadsPage = () => {
                    setLeadRepliesOpen(false);
                    window.location.href = `/admin/leads?session=${lead.id}`;
                  };
                  const openQuickReply = () => {
                    setLeadRepliesOpen(false);
                    const phone = lead.leadPhone ?? "";
                    const name = lead.leadName ?? phone;
                    if (phone) {
                      setQuickReplyTarget({
                        customer: {
                          phone,
                          name,
                          email: null,
                          address: null,
                          frequency: null,
                          lastJobDate: null,
                          ltv: 0,
                          totalCleans: 0,
                          isVip: false,
                          city: "",
                        },
                        view: "sms",
                        lastMessage: lead.lastMessagePreview ?? undefined,
                        isLeadChat: true,
                        sessionId: lead.id,
                      });
                    } else {
                      openLeadsPage();
                    }
                  };
                  return (
                    <LeadChatHistoryPopover
                      key={lead.id}
                      sessionId={lead.id}
                      onOpenFull={openLeadsPage}
                    >
                      <div className="flex items-stretch group hover:bg-slate-50 transition-colors">
                        {/* Main row — navigates to leads page */}
                        <button
                          onClick={openLeadsPage}
                          className="flex-1 text-left px-4 py-3 min-w-0"
                        >
                          <div className="flex items-start gap-3">
                            {/* Unread dot */}
                            <div className={cn(
                              "mt-1.5 h-2 w-2 rounded-full shrink-0",
                              lead.isUnread ? "bg-emerald-500" : "bg-slate-200"
                            )} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-slate-900 truncate">{lead.leadName ?? lead.leadPhone}</span>
                                <span className={cn(
                                  "text-[10px] font-semibold shrink-0",
                                  ageMin < 10 ? "text-red-500" : ageMin < 60 ? "text-amber-500" : "text-slate-400"
                                )}>{ageLabel}</span>
                              </div>
                              {lead.lastMessagePreview && (
                                <p className="text-xs text-slate-500 truncate mt-0.5">{lead.lastMessagePreview}</p>
                              )}
                              {!lead.lastMessagePreview && (
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[10px] text-slate-400">{src}</span>
                                  {lead.assignedAgentName && (
                                    <>
                                      <span className="text-[10px] text-slate-300">·</span>
                                      <span className="text-[10px] text-slate-400">{lead.assignedAgentName}</span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                            <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-emerald-500 transition-colors shrink-0 mt-1" />
                          </div>
                        </button>
                        {/* ⚡ Quick-reply button — opens SMS composer in CommandChat */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openQuickReply();
                          }}
                          title="Quick Reply"
                          className="flex items-center gap-1 px-2.5 shrink-0 border-l border-slate-100 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors text-[11px] font-semibold"
                        >
                          <span>⚡</span>
                          <span>Reply</span>
                        </button>
                        {/* Quick-resolve button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setHiddenLeadIds(prev => new Set(Array.from(prev).concat(lead.id)));
                            resolveSessionFromBanner.mutate({ sessionId: lead.id });
                          }}
                          title="Resolve"
                          className="flex items-center justify-center w-10 shrink-0 border-l border-slate-100 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 transition-colors"
                        >
                          <CircleCheckBig className="h-4 w-4" />
                        </button>
                      </div>
                    </LeadChatHistoryPopover>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Email Inbox slide-in panel */}
      {emailsOpen && (
        <div
          className="fixed inset-y-0 right-0 z-[200] flex flex-col bg-white shadow-2xl border-l border-slate-200 animate-in slide-in-from-right-2 duration-200"
          style={{ width: "380px", maxWidth: "90vw" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-semibold text-slate-900">Email Inbox</span>
              {emailUnreadCount > 0 && (
                <span className="bg-blue-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                  {emailUnreadCount} unread
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { window.location.href = "/admin/inbox"; }}
                className="h-7 px-2.5 flex items-center gap-1 rounded-full text-[11px] font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
                title="Open full inbox"
              >
                Open inbox
                <ArrowRight className="h-3 w-3" />
              </button>
              <button
                onClick={() => setEmailsOpen(false)}
                className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors text-slate-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {/* Body */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {emailThreadsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 py-16">
                <Mail className="h-8 w-8 opacity-30" />
                <p className="text-sm font-medium">All caught up</p>
                <p className="text-xs text-slate-400">No unread emails</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {emailThreadsList.filter((t: any) => !hiddenEmailThreadIds.has(t.id)).map((thread: any) => {
                  const mins = Math.floor((Date.now() - Number(thread.date)) / 60_000);
                  const timeLabel = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
                  return (
                    <EmailHistoryPopover key={thread.id} threadId={thread.id} onOpenFull={() => { setEmailsOpen(false); window.location.href = `/admin/inbox?thread=${encodeURIComponent(thread.id)}`; }}>
                    <div className="flex items-stretch group hover:bg-slate-50 transition-colors">
                      {/* Main row — navigates to email inbox */}
                      <button
                        onClick={() => {
                          setEmailsOpen(false);
                          window.location.href = `/admin/inbox?thread=${encodeURIComponent(thread.id)}`;
                        }}
                        className="flex-1 text-left px-4 py-3 min-w-0"
                      >
                        <div className="flex items-start gap-2.5">
                          {/* Unread dot */}
                          <div className={cn(
                            "mt-1.5 h-2 w-2 rounded-full shrink-0 transition-colors",
                            thread.isUnread ? "bg-blue-500" : "bg-slate-200"
                          )} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <span className={cn(
                                "text-sm truncate",
                                thread.isUnread ? "font-semibold text-slate-900" : "font-medium text-slate-600"
                              )}>{thread.from || thread.fromEmail}</span>
                              <span className="text-[10px] text-slate-400 shrink-0">{timeLabel}</span>
                            </div>
                            <p className={cn(
                              "text-xs truncate mb-0.5",
                              thread.isUnread ? "font-semibold text-slate-800" : "text-slate-600"
                            )}>{thread.subject}</p>
                            {thread.snippet && (
                              <p className="text-[11px] text-slate-400 truncate">{thread.snippet}</p>
                            )}
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-blue-500 transition-colors shrink-0 mt-1" />
                        </div>
                      </button>
                      {/* ⚡ Quick-reply button — opens composer modal */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEmailsOpen(false);
                          const fromEmail = thread.fromEmail ?? thread.from ?? "";
                          const fromName = thread.from ?? fromEmail;
                          setQuickReplyTarget({
                            customer: {
                              phone: "",
                              name: fromName,
                              email: fromEmail,
                              address: null,
                              frequency: null,
                              lastJobDate: null,
                              ltv: 0,
                              totalCleans: 0,
                              isVip: false,
                              city: "",
                            },
                            view: "email",
                            lastMessage: thread.snippet || thread.subject || undefined,
                            emailSubject: thread.subject ? `Re: ${thread.subject}` : undefined,
                          });
                        }}
                        title="Quick Reply"
                        className="flex items-center gap-1 px-2.5 shrink-0 border-l border-slate-100 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors text-[11px] font-semibold"
                      >
                        <span>⚡</span>
                        <span>Reply</span>
                      </button>
                      {/* Resolve button — removes from panel */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setHiddenEmailThreadIds(prev => new Set([...prev, thread.id]));
                          completeEmailThread.mutate({ threadId: thread.id });
                        }}
                        title="Resolve"
                        className="flex items-center justify-center w-10 shrink-0 border-l border-slate-100 text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 transition-colors"
                      >
                        <CircleCheckBig className="h-4 w-4" />
                      </button>
                    </div>
                    </EmailHistoryPopover>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Missed Calls slide-in panel */}
      {missedCallsOpen && (() => {
        const LINE_COLORS: Record<string, string> = {
          Main: "bg-blue-100 text-blue-700",
          CS: "bg-purple-100 text-purple-700",
          Bark: "bg-orange-100 text-orange-700",
          Unknown: "bg-gray-100 text-gray-600",
        };
        function fmtPhone(phone: string) {
          const d = phone.replace(/\D/g, "");
          if (d.length === 11 && d[0] === "1") return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
          if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
          return phone;
        }
        function tAgo(date: Date) {
          const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
          if (mins < 1) return "just now";
          if (mins < 60) return `${mins}m ago`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `${hrs}h ago`;
          return `${Math.floor(hrs / 24)}d ago`;
        }
        return (
          <div
            className="fixed inset-y-0 right-0 z-[200] flex flex-col bg-white shadow-2xl border-l border-slate-200 animate-in slide-in-from-right-2 duration-200"
            style={{ width: "360px", maxWidth: "90vw" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2">
                <PhoneMissed className="h-4 w-4 text-red-500" />
                <span className="text-sm font-semibold text-slate-900">Missed Calls</span>
                {missedCallsTodayCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                    {missedCallsTodayCount} pending
                  </span>
                )}
              </div>
              <button
                onClick={() => setMissedCallsOpen(false)}
                className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors text-slate-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {(missedCallsListData as any[]).length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 py-16">
                  <PhoneMissed className="h-8 w-8 opacity-30" />
                  <p className="text-sm font-medium">No pending missed calls</p>
                  <p className="text-xs text-slate-400">All caught up!</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {(missedCallsListData as any[]).map((row: any) => {
                    const lineColor = LINE_COLORS[row.phoneNumberLabel as string] ?? LINE_COLORS.Unknown;
                    return (
                      <MissedCallPanelRow
                        key={row.id}
                        row={row}
                        lineColor={lineColor}
                        fmtPhone={fmtPhone}
                        tAgo={tAgo}
                        agentName={callerName}
                        onResolved={() => { refetchMissedCallsToday(); refetchMissedCallsList(); }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {/* Tasks slide-in panel */}
      <TasksPanel
        open={tasksOpen}
        onClose={() => setTasksOpen(false)}
        isAdmin={true}
        agentList={(agentList ?? []).map(a => ({ id: a.id, name: a.name, photoUrl: a.photoUrl ?? null }))}
        refetchTick={taskRefetchTick}
      />
      {/* Due task popup — fires when tasks come due */}
      <DueTaskPopup
        tasks={visibleDueTasks as any[]}
        onDismiss={(id) => setDueTaskPopupDismissed(prev => new Set(Array.from(prev).concat(id)))}
        onMarkDone={(id) => {
          setDueTaskPopupDismissed(prev => new Set(Array.from(prev).concat(id)));
          utils.tasks.getDue.invalidate();
          utils.tasks.list.invalidate();
          utils.tasks.listMine.invalidate();
        }}
        onOpenPanel={() => setTasksOpen(true)}
      />
      {/* Quick-reply modal — opened from sidebar SMS/email rows */}
      {quickReplyTarget && (
        <QuickReplyModal
          customer={quickReplyTarget.customer}
          initialView={quickReplyTarget.view}
          onClose={() => setQuickReplyTarget(null)}
          lastMessage={quickReplyTarget.lastMessage}
          emailSubject={quickReplyTarget.emailSubject}
          isLeadChat={quickReplyTarget.isLeadChat}
          sessionId={quickReplyTarget.sessionId}
        />
      )}
    </div>
  );
}
