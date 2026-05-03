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
import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import EmojiPicker, { type EmojiClickData, Theme } from "emoji-picker-react";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { useOsNotification } from "@/hooks/useOsNotification";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { useOpsStream } from "@/hooks/useOpsStream";
import { TypingBubble } from "@/components/TypingBubble";
import { trpc } from "@/lib/trpc";
import { senderHex } from "@/lib/senderColor";
import GlitterBurst from "@/components/GlitterBurst";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Clock, CheckCheck, Loader2, Send, Megaphone, MapPin,
  X, Camera, Mic, Smile, ImageIcon, UserCheck, Zap, Phone, Wand2, MessageSquare, MessageCircle,
  Pin, Bell, BellOff, TriangleAlert, PartyPopper, StickyNote, ChevronLeft, ChevronRight,
  ExternalLink, ChevronDown,
  CheckCircle2, XCircle, Sparkles, Copy, ClipboardCheck, ClipboardList, Briefcase, UserPlus,
  CalendarDays, Headphones, Radio, BookOpen, PhoneCall, PhoneOff, Search,
  ShieldAlert, CircleCheckBig, ArrowRight, Calculator, RefreshCw } from "lucide-react";
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
    createdAt: Date;
  }>;
  channelLoading: boolean;
  callerName: string;
  /** Called when user hits Send in the composer */
  onSendMessage: (body: string, mediaUrl?: string, replyTo?: { id: number; body: string; author: string }, quickAction?: string) => void;
  /** Called when user clicks "Jump to Job Thread" */
  onJumpToJob: (jobId: number) => void;
  /** Called when user clicks "Ops" in the in-panel tab switcher */
  onSwitchToToday: () => void;
  /** Called when user clicks "CS" in the in-panel tab switcher */
  onSwitchToCS?: () => void;
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
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
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
                      {new Date(c.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
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
              {new Date(claimedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
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
};

const MessageList = memo(function MessageList({
  channelMsgs,
  channelLoading,
  callerName,
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
}: MessageListProps) {
  return (
    <>
        <div ref={threadScrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-4 scrollbar-thin scrollbar-thumb-slate-200">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">Conversation</p>
            <span className="text-[10px] font-medium text-slate-400 bg-slate-100 rounded-full px-2.5 py-0.5">Alerts + regular team chat</span>
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

                // ── Call summary card (cool blue) ────────────────────────────────
                if (isCallSummary) {
                  const recordingMatch = msg.body.match(/\[Recording\]\((https?:\/\/[^)]+)\)/);
                  const recordingUrl = msg.mediaUrl || (recordingMatch ? recordingMatch[1] : null);
                  const cleanBody = msg.body.replace(/\n?🎙️\s*\[Recording\]\([^)]+\)/, "").trim();
                  const bodyLines = cleanBody.split("\n").filter(Boolean);
                  const headLine = bodyLines[0]?.replace(/\*\*/g, "").replace(/^📱\s*/, "") ?? "";
                  const summaryLines = bodyLines.slice(1).map(l => l.replace(/^📋\s*/, ""));
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[72%] rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                        {/* Header band */}
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border-b border-slate-700">
                          <span className="text-sm">📞</span>
                          <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-widest">AI Call Summary</span>
                          <span className="ml-auto text-[10px] text-slate-500">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        {/* Headline row */}
                        <div className="px-3 pt-2.5 pb-1.5 bg-slate-50 border-b border-slate-100">
                          <p className="text-sm font-medium text-slate-700">{headLine}</p>
                        </div>
                        {/* Summary */}
                        <div className="px-3 py-2.5 bg-white">
                          {summaryLines.map((line, i) => (
                            <p key={i} className="text-sm text-slate-600 leading-relaxed">{line}</p>
                          ))}
                          {recordingUrl && (
                            <div className="mt-2.5">
                              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">🎙️ Recording</p>
                              <audio
                                controls
                                src={recordingUrl}
                                className="w-full h-8 rounded-lg"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── New Lead card (emerald/green) ─────────────────────────────────
                if (msg.quickAction === "new_lead") {
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
                                <span className="text-slate-400 font-normal ml-1">at {new Date(claimedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}</span>
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
                  const gradeColors: Record<string, string> = {
                    A: "bg-green-100 text-green-700 border-green-300",
                    B: "bg-blue-100 text-blue-700 border-blue-300",
                    C: "bg-amber-100 text-amber-700 border-amber-300",
                    D: "bg-orange-100 text-orange-700 border-orange-300",
                    F: "bg-red-100 text-red-700 border-red-300",
                  };
                  const gradeColor = grade ? (gradeColors[grade] ?? gradeColors.C) : gradeColors.C;
                  return (
                    <div key={msg.id} className="flex justify-center my-2 px-4">
                      <div className="w-full max-w-sm rounded-[20px] border border-purple-200 bg-purple-50 shadow-sm p-4">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 border border-purple-200">
                              <Phone className="h-3 w-3 text-purple-600" />
                            </div>
                            <div>
                              <span className="text-[10px] font-semibold text-purple-700 uppercase tracking-widest">Call Debrief</span>
                              {(callerName || callerPhone) && (
                                <p className="text-xs font-medium text-purple-900 mt-0.5">{callerName ?? callerPhone}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {grade && (
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full border-2 text-xs font-bold ${gradeColor}`}>
                                {grade}
                              </span>
                            )}
                            <span className="text-[10px] text-purple-400">{fmtMsgTime(msg.createdAt)}</span>
                          </div>
                        </div>
                        {/* Audio player */}
                        {recordingUrl && (
                          <div className="mb-3">
                            <audio
                              controls
                              src={recordingUrl}
                              className="w-full h-8 rounded-xl"
                              style={{ accentColor: "#7c3aed" }}
                            />
                          </div>
                        )}
                        <div className="border-t border-purple-200/70 mb-3" />
                        {/* Went well */}
                        {wentWell && (
                          <div className="mb-2">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-green-500 text-xs">✔</span>
                              <span className="text-[10px] font-semibold uppercase tracking-widest text-green-600">Went well</span>
                            </div>
                            <p className="text-xs text-purple-800 leading-relaxed pl-4">{wentWell}</p>
                          </div>
                        )}
                        <div className="border-t border-purple-200/50 mb-2" />
                        {/* Improve */}
                        {improve && (
                          <div className="mb-3">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-amber-500 text-xs">▲</span>
                              <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">Improve</span>
                            </div>
                            <p className="text-xs text-purple-800 leading-relaxed pl-4">{improve}</p>
                          </div>
                        )}
                        {/* Next line */}
                        {nextLine && (
                          <div className="rounded-2xl bg-white border border-purple-200 px-3 py-2">
                            <p className="text-[10px] text-purple-400 font-semibold uppercase tracking-widest mb-1">Next time, say:</p>
                            <p className="text-xs text-purple-900 italic leading-relaxed">&ldquo;{nextLine}&rdquo;</p>
                          </div>
                        )}
                      </div>
                    </div>
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
                if (msg.quickAction === "sync_watchdog") {
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
                            <span className="text-sm font-semibold text-slate-900">{totalJobs} job{totalJobs !== 1 ? "s" : ""} tomorrow</span>
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
                if (msg.quickAction === "schedule_escalation_flag") {
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
                            {isNoAnswer ? "No Answer" : "Call Failed"}
                          </span>
                          <span className="ml-auto text-[10px] text-red-300">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2.5 bg-red-50">
                          <p className="text-sm font-semibold text-slate-900">
                            {cleanerName} — schedule unconfirmed
                          </p>
                          <p className="text-xs text-red-700 mt-0.5">
                            {isNoAnswer ? "Did not answer" : "Call failed"} after 8 PM escalation call
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
                // ── Skip cleaner_status cards — rendered in sidebar instead
                if (msg.quickAction === "cleaner_status") return null;
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
                        isTaggedMsg ? "border-l-4 border-amber-400 pl-2 -ml-2 rounded-r-2xl" : ""
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
                        <div className={"rounded-2xl px-5 py-4 " + (isAlert ? "w-full bg-[#0f172a] text-white" : isMine ? "max-w-[75%] ml-auto bg-[#0f172a] text-white" : "w-full bg-[#f1f5f9] text-slate-900")}>
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
                            <span className={cn("text-xs", isAlert || isMine ? "text-slate-500" : "text-slate-400")}>
                              {fmtMsgTime(msg.createdAt)}
                            </span>
                          </div>
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
                            {(() => {
                              // Token-based renderer: supports **bold**, [text](url), and bare https?:// URLs
                              const tokens: React.ReactNode[] = [];
                              // Combined regex: markdown links OR bare URLs (not already inside a markdown link)
                              const combinedRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s<>"'\]\)]+)/g;
                              const boldRe = /\*\*([^*]+)\*\*/g;
                              let lastIdx = 0;
                              let match: RegExpExecArray | null;
                              const renderBold = (text: string, keyPrefix: string) => {
                                const parts: React.ReactNode[] = [];
                                let bi = 0, bLast = 0;
                                let bm: RegExpExecArray | null;
                                boldRe.lastIndex = 0;
                                while ((bm = boldRe.exec(text)) !== null) {
                                  if (bm.index > bLast) parts.push(<span key={`${keyPrefix}-t${bi++}`}>{text.slice(bLast, bm.index)}</span>);
                                  parts.push(<strong key={`${keyPrefix}-b${bi++}`}>{bm[1]}</strong>);
                                  bLast = bm.index + bm[0].length;
                                }
                                if (bLast < text.length) parts.push(<span key={`${keyPrefix}-t${bi}`}>{text.slice(bLast)}</span>);
                                return parts;
                              };
                              combinedRe.lastIndex = 0;
                              while ((match = combinedRe.exec(msg.body)) !== null) {
                                if (match.index > lastIdx) tokens.push(...renderBold(msg.body.slice(lastIdx, match.index), `pre-${match.index}`));
                                if (match[1] !== undefined) {
                                  // Markdown [text](url)
                                  tokens.push(<a key={`link-${match.index}`} href={match[2]} target="_blank" rel="noopener noreferrer" className="underline text-blue-400 hover:text-blue-300">{match[1]}</a>);
                                } else {
                                  // Bare URL — strip trailing punctuation that's likely not part of the URL
                                  const rawUrl = match[3].replace(/[.,!?;:]+$/, "");
                                  tokens.push(<a key={`url-${match.index}`} href={rawUrl} target="_blank" rel="noopener noreferrer" className="underline text-blue-400 hover:text-blue-300 break-all">{rawUrl}</a>);
                                }
                                lastIdx = match.index + match[0].length;
                              }
                              if (lastIdx < msg.body.length) tokens.push(...renderBold(msg.body.slice(lastIdx), `tail`));
                              return tokens;
                            })()}
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
                                    src={url}
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
                          {!isAlert && (
                            <button
                              onClick={() => setReplyTo({ id: msg.id, body: msg.body, author: msg.from })}
                              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition bg-slate-100 text-slate-600 hover:bg-slate-200"
                            >
                              <ChevronDown className="h-3 w-3" />
                              <span>Reply</span>
                            </button>
                          )}
                          <button
                            onClick={() => openChatConvert(msg.id, msg.body)}
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
let _commandChatScrollTop = 0;

export default function CommandChat({ channelMsgs, channelLoading, callerName, onSendMessage, onJumpToJob, onSwitchToToday, onSwitchToCS, awayStatus, onSetAwayStatus, senderStatusMap, agentList, isVisible, myNames: myNamesProp }: CommandChatProps) {
  const [composer, setComposer] = useState("");
  // Message quality check

  // @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = closed
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(0); // cursor pos of the '@'
  // ── Issues tab state ─────────────────────────────────────────────────────
  const [leftTab, setLeftTab] = useState<"chat" | "issues">("chat");
  const [rightTab, setRightTab] = useState<"leads" | "followups">("leads");
  const [rightSearch, setRightSearch] = useState("");
  const [centerView, setCenterView] = useState<"chat" | "issues">("chat");
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guard: prevent duplicate "I'm Back" messages when button click + keystroke both fire
  const imBackFiredRef = useRef(false);

  const utils = trpc.useUtils();

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
    onNewMessage: (channel) => {
      if (channel === "command" || !channel) {
        utils.opsChat.getCommandChatData.invalidate();
        utils.opsChat.listChannelMessages.invalidate({ channel: "command" });
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
    },
    onReactionUpdate: () => {
      refetchReactions();
    },
  });

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
  const cmdMsgIds = useMemo(() => channelMsgs.map(m => m.id), [channelMsgs]);
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
  // Celebration polling kept at 3s because it drives the glitter animation
  // and is a lightweight single-row query. SSE also invalidates it via onNewMessage.
  const { data: latestCelebration } = trpc.opsChat.getLatestCelebration.useQuery(undefined, {
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
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
    // Observe child additions (new messages)
    const mo = new MutationObserver(() => {
      container.scrollTop = container.scrollHeight;
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

  const snapshot = cmdData?.snapshot ?? { issue: 0, soon: 0, progress: 0, complete: 0, assigned: 0 };
  const alerts = cmdData?.alerts ?? [];
  const pinnedJobs = cmdData?.pinnedJobs ?? [];
  const autoRaised = cmdData?.autoRaised ?? [];
  const manualIssues = cmdData?.manualIssues ?? [];
  const pendingReminderCount = cmdData?.pendingReminderCount ?? 0;
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
    const body = composer.trim() || (donePhotos.length > 0 ? "Photo" : "");
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
    if (!hasText && donePhotos.length === 0) return;
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
            src={lightboxUrl}
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

            {/* Command priority info card */}
            <div className="mb-4 rounded-2xl border border-indigo-100 bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(255,255,255,0.7))] p-3.5">
              <div className="mb-1.5 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-500/20">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="text-sm font-semibold">Command priority</div>
              </div>
              <p className="text-xs leading-5 text-slate-600">General chat stays lightweight. The system only creates an issue when risk, money, or schedule confidence drops.</p>
            </div>

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
                    ? `Arrives: ${new Date(etaTs).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
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
                          {cs.status === "running_late" && cs.cleanerJobId && (
                            <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                              {clientCallDone.has(cs.cleanerJobId) ? (
                                <span className="text-[10px] text-emerald-600 font-medium">✓ Client notified</span>
                              ) : (
                                <button
                                  disabled={callingClientJobId === cs.cleanerJobId}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!cs.cleanerJobId) return;
                                    // Open confirmation dialog instead of calling immediately
                                    setCallConfirmState({
                                      cleanerJobId: cs.cleanerJobId,
                                      clientName: cs.customerName ?? null,
                                      etaLabel: cs.etaLabel ?? null,
                                      detectedFromSms,
                                      smsText,
                                      isTestCard: cs.isTestCard ?? false,
                                    });
                                    // Pre-fill the editable ETA with the parsed value (24h "HH:MM")
                                    if (cs.etaLabel) {
                                      // Parse "3:45 PM" → "15:45" for the time input
                                      const match = cs.etaLabel.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
                                      if (match) {
                                        let h = parseInt(match[1], 10);
                                        const m = match[2];
                                        const ampm = match[3].toUpperCase();
                                        if (ampm === "PM" && h < 12) h += 12;
                                        if (ampm === "AM" && h === 12) h = 0;
                                        setEditedEtaTime(`${String(h).padStart(2, "0")}:${m}`);
                                      } else {
                                        setEditedEtaTime("");
                                      }
                                    } else {
                                      setEditedEtaTime("");
                                    }
                                  }}
                                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition"
                                >
                                  {callingClientJobId === cs.cleanerJobId ? (
                                    <><span className="animate-spin">⟳</span> Calling…</>
                                  ) : (
                                    <>📞 Call Client</>
                                  )}
                                </button>
                              )}
                            </div>
                          )}
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
        <div className="px-5 pt-3 pb-3 border-b border-slate-100 shrink-0">
          {/* Compact single-row header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
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
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-900 leading-none">MIB Command Chat</h2>
                  {agentList && agentList.length > 0 && (() => {
                    const MAX_SHOW = 6;
                    const visible = agentList.slice(0, MAX_SHOW);
                    const overflow = agentList.length - MAX_SHOW;
                    return (
                      <div className="flex items-center" style={{ gap: 0 }}>
                        {visible.map((ag, idx) => {
                          const status = senderStatusMap?.[ag.name] ?? "offline";
                          const dotColor = status === "online" ? "bg-emerald-400" : status === "away" ? "bg-amber-400" : "bg-slate-300";
                          const initials = ag.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                          const hue = (ag.name.charCodeAt(0) * 37) % 360;
                          const isOnCall = Boolean(ag.onCallSince);
                          return (
                            <div key={ag.id} className="relative" title={isOnCall ? `${ag.name} — on a call` : `${ag.name} — ${status}`} style={{ marginLeft: idx === 0 ? 6 : -4, zIndex: visible.length - idx }}>
                              {ag.photoUrl ? (
                                <img src={ag.photoUrl} alt={ag.name} className={cn("w-7 h-7 rounded-full object-cover border border-white shadow-sm", isOnCall && "ring-1 ring-green-400")} />
                              ) : (
                                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold border border-white shadow-sm", isOnCall && "ring-1 ring-green-400")} style={{ background: `hsl(${hue}, 55%, 52%)` }}>{initials}</div>
                              )}
                              <span className={cn("absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white", isOnCall ? "bg-green-500" : dotColor)} />
                            </div>
                          );
                        })}
                        {overflow > 0 && (
                          <div className="w-7 h-7 rounded-full bg-slate-100 border border-white flex items-center justify-center text-[10px] font-bold text-slate-500 shadow-sm" style={{ marginLeft: -4 }}>+{overflow}</div>
                        )}
                      </div>
                    );
                  })()}
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 whitespace-nowrap cursor-default">
                        ${todayRevenue.toLocaleString()} today
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
                </div>
              )}
            </div>
            {/* Icon buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              {!searchOpen && pendingReminderCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-semibold bg-sky-50 text-sky-600 border border-sky-200 rounded-full px-2 py-0.5">
                  <Bell className="h-3 w-3" />{pendingReminderCount} reminder{pendingReminderCount !== 1 ? "s" : ""} set
                </span>
              )}
              {!searchOpen && (
                <button
                  onClick={openSearch}
                  title="Search messages"
                  className="h-9 w-9 flex items-center justify-center rounded-full border border-slate-200 hover:bg-slate-100 transition-colors"
                >
                  <Search className="h-4 w-4 text-slate-500" />
                </button>
              )}
              <button
                onClick={toggleMute}
                title={notifMuted ? "Unmute notifications" : "Mute notifications"}
                className="h-9 w-9 flex items-center justify-center rounded-full border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                {notifMuted
                  ? <BellOff className="h-4 w-4 text-slate-400" />
                  : <Bell className="h-4 w-4 text-slate-500" />}
              </button>
              <button
                title="Broadcast"
                onClick={() => setBroadcastOpen(true)}
                className="h-9 w-9 flex items-center justify-center rounded-full border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                <Megaphone className="h-4 w-4 text-slate-500" />
              </button>
              <button
                title="Pin"
                className="h-9 w-9 flex items-center justify-center rounded-full border-2 border-slate-900 hover:bg-slate-100 transition-colors"
              >
                <Pin className="h-4 w-4 text-slate-900" />
              </button>
            </div>
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
        <div className={cn("relative flex-1 min-h-0 flex flex-col", centerView === "issues" && "hidden")}>
          {/* @mention re-entry banner — sticky amber strip when there are unread @mentions */}
          {unreadTagIds.length > 0 && (
            <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm">🔔</span>
                <p className="text-xs font-semibold truncate">
                  {unreadTagIds.length === 1
                    ? `You were mentioned in 1 message`
                    : `You were mentioned in ${unreadTagIds.length} messages`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setShowMentionHistory(true)}
                  className="text-xs text-amber-600 hover:text-amber-800 transition"
                >
                  See all
                </button>
                <span className="text-amber-300 text-xs">|</span>
                <button
                  onClick={jumpToNextMention}
                  className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline"
                >
                  Jump {unreadTagIds.length > 1 ? `(${unreadTagIds.length})` : ""}
                </button>
                <button
                  onClick={markTagsSeen}
                  className="text-amber-500 hover:text-amber-700 transition"
                  title="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

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
        />
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
        <div className={cn("relative shrink-0", centerView === "issues" && "hidden")}>
        <FAQPanel open={faqOpen} onClose={() => setFaqOpen(false)} context="Command Chat" />
        <ObjectionsPanel open={objectionOpen} onClose={() => setObjectionOpen(false)} />
        <div className="px-5 py-4 bg-white">
          {/* Quick-action chips */}
          <div className="flex gap-1.5 mb-3 items-center flex-nowrap overflow-x-auto">
            <button
              onClick={() => setBroadcastOpen(true)}
              className="text-xs font-medium rounded-full px-3 py-1.5 transition bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-sm shrink-0"
            >
              <Radio className="h-3 w-3" /> Broadcast
            </button>

            <button
              onClick={() => setReminderOpen(true)}
              className="text-xs font-medium rounded-full px-3 py-1.5 transition bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-sm shrink-0"
            >
              <Bell className="h-3 w-3" /> Reminder
            </button>
            <button
              onClick={() => setPinOpen(true)}
              className="text-xs font-medium rounded-full px-3 py-1.5 transition bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-sm shrink-0"
            >
              <Pin className="h-3 w-3" /> Pin
            </button>
            <button
              onClick={() => setFollowUpsOpen(true)}
              className="text-xs font-medium rounded-full px-3 py-1.5 transition bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-sm shrink-0"
            >
              <ClipboardList className="h-3 w-3" /> Follow-ups
            </button>
            <button
              onClick={() => setFaqOpen(true)}
              className="text-xs font-medium rounded-full px-3 py-1.5 transition bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-sm shrink-0"
            >
              <BookOpen className="h-3 w-3" /> FAQ
            </button>
{/* Away / I'm Back toggle */}
            {awayStatus ? (
              // Currently away — show "I'm Back" button to clear status
              <button
                className="text-xs font-medium rounded-full px-3 py-1.5 transition bg-emerald-600 border border-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm shrink-0"
                onClick={() => {
                  if (imBackFiredRef.current) return;
                  imBackFiredRef.current = true;
                  onSendMessage(`✅ ${callerName} — I'm Back`, undefined, undefined, "away_status:back");
                  onSetAwayStatus?.(null);
                }}
              >
                <span className="inline-block w-2 h-2 rounded-full bg-white" />
                I'm Back
              </button>
            ) : (
              // Not away — show Away picker
              <Popover open={awayOpen} onOpenChange={setAwayOpen}>
                <PopoverTrigger asChild>
                  <button className="text-xs font-medium rounded-full px-3 py-1.5 transition bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-sm shrink-0">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                    Away
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-1.5" align="end">
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
                        // Reset guard so the next "I'm Back" can fire
                        imBackFiredRef.current = false;
                        onSendMessage(`${emoji} ${callerName} — ${label}`, undefined, undefined, `away_status:${key}`);
                        onSetAwayStatus?.(key);
                        setAwayOpen(false);
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
          </div>

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
          <div
            className={cn(
              "rounded-2xl border p-4 transition",
              isDragging ? "border-slate-300 bg-slate-200 ring-2 ring-slate-900/10" : "border-slate-200 bg-slate-50"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) stageFiles(e.dataTransfer.files); }}
          >
            <Textarea
              ref={composerRef}
              value={composer}
              onChange={(e) => {
                const val = e.target.value;
                setComposer(val);
                // Clear quality warning when user edits
                // @mention detection: find '@' before cursor
                const pos = e.target.selectionStart ?? val.length;
                const before = val.slice(0, pos);
                const atMatch = before.match(/@(\w*)$/);
                if (atMatch) {
                  setMentionQuery(atMatch[1]);
                  setMentionStart(pos - atMatch[0].length);
                  setMentionIndex(0);
                } else {
                  setMentionQuery(null);
                }
              }}
              placeholder={isDragging ? "Drop photos here…" : isTranscribing ? "Transcribing voice note…" : "Message the team… (Enter to send, Shift+Enter for new line)"}
              rows={3}
              className="resize-none border-0 bg-transparent p-0 text-base text-slate-700 focus-visible:ring-0 placeholder:text-slate-400"
              onKeyDown={(e) => {
                // @mention autocomplete navigation
                if (mentionQuery !== null && mentionSuggestions.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionSuggestions.length - 1)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    const chosen = mentionSuggestions[mentionIndex];
                    if (chosen) {
                      const before = composer.slice(0, mentionStart);
                      const after = composer.slice((composerRef.current?.selectionStart ?? composer.length));
                      const next = before + "@" + chosen + " " + after;
                      setComposer(next);
                      setMentionQuery(null);
                      // Restore cursor after inserted name
                      requestAnimationFrame(() => {
                        const pos = (before + "@" + chosen + " ").length;
                        composerRef.current?.setSelectionRange(pos, pos);
                      });
                    }
                    return;
                  }
                  if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); return; }
                }
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); return; }
                // Auto-return: first keystroke while away clears status and posts "I'm Back"
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

            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1 relative">
                {/* Photo */}
                <button
                  className="rounded-full px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition text-sm font-medium flex items-center gap-1.5 shadow-sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  📷 Photo
                </button>
                {/* Voice */}
                {isRecording ? (
                  <button
                    className="rounded-full px-4 py-2 bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition text-sm flex items-center gap-1.5 font-medium shadow-sm"
                    onClick={stopRecording}
                  >
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    {recordingSeconds}s — Stop
                  </button>
                ) : isTranscribing ? (
                  <button disabled className="rounded-full px-4 py-2 bg-white border border-slate-200 text-slate-400 transition text-sm flex items-center gap-1.5 shadow-sm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing…
                  </button>
                ) : (
                  <button
                    className="rounded-full px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition text-sm font-medium flex items-center gap-1.5 shadow-sm"
                    onClick={startRecording}
                  >
                    🎤 Voice
                  </button>
                )}
                {/* Objections */}
                <button
                  className="rounded-full px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition text-sm font-medium flex items-center gap-1.5 shadow-sm"
                  onClick={() => setObjectionOpen(true)}
                >
                  🛡️ Objections
                </button>
                {/* Emoji */}
                <div ref={emojiRef} className="relative">
                  <button
                    className={cn("rounded-full px-4 py-2 bg-white border transition text-sm font-medium shadow-sm", showEmoji ? "border-slate-400 text-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50")}
                    onClick={() => setShowEmoji(v => !v)}
                  >
                    😊
                  </button>
                  {showEmoji && (
                    <div className="absolute bottom-10 left-0 z-50 shadow-2xl rounded-2xl overflow-hidden">
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
              <Button
                size="default"
                onClick={handleSend}
                disabled={(!composer.trim() && stagedPhotos.filter(p => p.status === "done").length === 0)}
                className="rounded-2xl px-6 py-3 font-semibold shadow-md bg-slate-900 hover:bg-slate-800 text-white text-sm h-auto"
              >
                <Send className="h-4 w-4 mr-2" /> Send to chat
              </Button>
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
                      const dueStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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
                const dueStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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
    </div>
  );
}
