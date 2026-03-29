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
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import EmojiPicker, { type EmojiClickData, Theme } from "emoji-picker-react";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { useOsNotification } from "@/hooks/useOsNotification";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
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
  CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

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
  onSendMessage: (body: string, mediaUrl?: string, replyTo?: { id: number; body: string; author: string }) => void;
  /** Called when user clicks "Jump to Job Thread" */
  onJumpToJob: (jobId: number) => void;
  /** Called when user clicks "Today Ops" in the in-panel tab switcher */
  onSwitchToToday: () => void;
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
}: {
  msg: LeadMsg;
  claimLeadMutation: ClaimMutation;
  sessionStatus?: SessionStatus | null;
}) {
  // Shake state: fires every 8 seconds while unclaimed
  const [shaking, setShaking] = useState(false);
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(msg.metadata ?? "{}"); } catch {}
  const leadName    = (meta.leadName    as string)         ?? msg.from;
  const leadPhone   = (meta.leadPhone   as string)         ?? "";
  const serviceType = (meta.serviceType as string)         ?? "";
  const price       = (meta.price       as number | string) ?? "";
  const sessionId   = (meta.sessionId   as number | null)  ?? null;
  const arrivedAt   = (meta.arrivedAt   as number)         ?? msg.createdAt.getTime();
  const claimedBy   = (meta.claimedBy   as string | null)  ?? null;
  const claimedAt   = (meta.claimedAt   as number | null)  ?? null;
  const isClaimed   = Boolean(claimedBy);

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

  return (
    <div
      onAnimationEnd={() => setShaking(false)}
      className={cn(
        "relative rounded-xl border overflow-hidden transition-all",
        !isClaimed && shaking && "animate-lead-shake",
        isClaimed ? "border-emerald-200 bg-white shadow-sm" : cn("bg-white shadow-md", borderColor),
      )}
    >
      {/* Pulsing glow ring for unclaimed — color shifts with urgency */}
      {!isClaimed && !isResolved && (
        <span className={cn("absolute inset-0 rounded-xl ring-2 ring-offset-0 animate-pulse pointer-events-none", urgencyRing)} />
      )}

      {/* Status band */}
      <div className={cn("flex items-center gap-1.5 px-3 py-1.5", bandBg)}>
        {isBooked ? (
          <>
            <span className="text-white text-xs shrink-0">$</span>
            <span className="text-[10px] font-bold text-white uppercase tracking-widest truncate">
              Booked{sessionStatus?.bookedByAgentName ? ` · ${sessionStatus.bookedByAgentName}` : ""}
            </span>
            {sessionStatus?.bookedAmount && (
              <span className="ml-auto text-[10px] text-blue-100 shrink-0 font-bold">
                ${sessionStatus.bookedAmount}
              </span>
            )}
          </>
        ) : isLost ? (
          <>
            <span className="text-white text-xs shrink-0">😞</span>
            <span className="text-[10px] font-bold text-white uppercase tracking-widest truncate">
              Lost{sessionStatus?.lostReason ? ` · ${sessionStatus.lostReason.replace(/_/g, " ")}` : ""}
            </span>
          </>
        ) : isCold ? (
          <>
            <span className="text-white text-xs shrink-0">❄️</span>
            <span className="text-[10px] font-bold text-white uppercase tracking-widest truncate">Cold · No reply</span>
          </>
        ) : isVoicemail ? (
          <>
            <span className="text-white text-xs shrink-0">📞</span>
            <span className="text-[10px] font-bold text-white uppercase tracking-widest truncate">Voicemail · Call back</span>
          </>
        ) : isFollowUp ? (
          <>
            <span className="text-white text-xs shrink-0">🔔</span>
            <span className="text-[10px] font-bold text-white uppercase tracking-widest truncate">Follow-up Set</span>
          </>
        ) : isClaimed ? (
          <>
            <UserCheck className="h-3 w-3 text-white shrink-0" />
            <span className="text-[10px] font-bold text-white uppercase tracking-widest truncate">
              Claimed · {claimedBy}
            </span>
            {claimedAt && (
              <span className="ml-auto text-[10px] text-emerald-100 shrink-0">
                {new Date(claimedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
              </span>
            )}
          </>
        ) : (
          <>
            <Zap className="h-3 w-3 text-white shrink-0" />
            <span className="text-[10px] font-bold text-white uppercase tracking-widest">Unclaimed</span>
            <span className={cn("ml-auto font-mono font-bold tabular-nums text-[10px]", timerColor)}>
              {timerLabel}
            </span>
          </>
        )}
      </div>

      {/* Lead info */}
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-slate-900 leading-tight truncate">{leadName}</p>
          {price && <p className="text-sm font-bold text-emerald-700 shrink-0">${price}</p>}
        </div>
        {leadPhone   && <p className="text-xs text-slate-400 mt-0.5">{leadPhone}</p>}
        {serviceType && <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide">{serviceType}</p>}

        {/* Action row */}
        <div className="flex items-center gap-2 mt-2.5">
          {leadPhone && (
            <a
              href={`tel:${leadPhone}`}
              title={`Call ${leadName}`}
              className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors shrink-0"
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
              className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors shrink-0"
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            title="Open outbound Call Assist for this lead"
            onClick={() => {
              const params = new URLSearchParams();
              if (sessionId)   params.set("sessionId",   String(sessionId));
              if (leadName)    params.set("name",        leadName);
              if (leadPhone)   params.set("phone",       leadPhone);
              if (serviceType) params.set("serviceType", serviceType);
              window.open(`/call-assist?${params.toString()}`, "_blank");
            }}
            className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-violet-100 hover:bg-violet-200 text-violet-700 transition-colors shrink-0"
          >
            <Wand2 className="h-3.5 w-3.5" />
          </button>
          <div className="flex-1" />
          {isClaimed ? (
            <span className="text-[10px] text-emerald-600 font-semibold">✓ Taken</span>
          ) : (
            <button
              onClick={() => claimLeadMutation.mutate({ messageId: msg.id, sessionId: sessionId ?? undefined })}
              disabled={claimLeadMutation.isPending}
              className="h-7 px-3 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {claimLeadMutation.isPending
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <>⚡ Claim</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function HotLeadsTray({
  channelMsgs,
  claimLeadMutation,
  onCollapse,
}: {
  channelMsgs: LeadMsg[];
  claimLeadMutation: ClaimMutation;
  onCollapse: () => void;
}) {
  // Derive lead cards from channelMsgs — only new_lead quickAction, last 8h
  const cutoff = Date.now() - 8 * 60 * 60 * 1000;
  const leads = channelMsgs
    .filter((m) => m.quickAction === "new_lead" && m.createdAt.getTime() > cutoff)
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
    { enabled: sessionIds.length > 0, refetchInterval: 30_000 }
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

// ── component ─────────────────────────────────────────────────────────────────

export default function CommandChat({ channelMsgs, channelLoading, callerName, onSendMessage, onJumpToJob, onSwitchToToday }: CommandChatProps) {
  const [composer, setComposer] = useState("");
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const threadBottomRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: cmdData, isLoading: cmdLoading } = trpc.opsChat.getCommandChatData.useQuery(undefined, {
    refetchInterval: 20_000,
  });

  // Load all agent photo URLs for message bubble avatars
  const { data: agentPhotoData } = trpc.opsChat.getAllAgentPhotoMap.useQuery(undefined, {
    staleTime: 2 * 60 * 1000,
    retry: false,
  });
  const senderPhotoMap: Record<string, string | null> = useMemo(() => agentPhotoData?.photos ?? {}, [agentPhotoData?.photos]);

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

  const claimLeadMutation = trpc.opsChat.claimLead.useMutation({
    onSuccess: (res) => {
      if (!res.success && 'alreadyClaimedBy' in res) {
        toast.info(`Already claimed by ${res.alreadyClaimedBy}`);
      } else {
        toast.success("Lead claimed!");
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
  const { data: activePin, refetch: refetchPin } = trpc.opsChat.getChannelPin.useQuery({ channel: "command" }, { refetchInterval: 30_000 });
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

  // ── Quote-reply state ─────────────────────────────────────────────────────
  const [replyTo, setReplyTo] = useState<{ id: number; body: string; author: string } | null>(null);

  // ── Read receipts (seenBy) ─────────────────────────────────────────────────
  const myCommandMsgIds = useMemo(
    () => channelMsgs.filter(m => m.from === callerName).map(m => m.id).filter(id => id > 0),
    [channelMsgs, callerName]
  );
  const { data: commandSeenByBulk } = trpc.opsChat.getSeenByBulk.useQuery(
    { messageIds: myCommandMsgIds, channel: "command" },
    { enabled: myCommandMsgIds.length > 0, refetchInterval: 10_000 }
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
  const cmdMsgIds = channelMsgs.map(m => m.id);
  const { data: reactionsData, refetch: refetchReactions } = trpc.opsChat.getReactions.useQuery(
    { messageIds: cmdMsgIds },
    { enabled: cmdMsgIds.length > 0, refetchInterval: 10_000 }
  );
  const reactionsByMsgId = (reactionsData?.reactions ?? []).reduce<Record<number, Array<{ callerId: string; callerName: string; emoji: string }>>>((acc, r) => {
    if (!acc[r.messageId]) acc[r.messageId] = [];
    acc[r.messageId].push(r);
    return acc;
  }, {});
  const toggleReactionMutation = trpc.opsChat.toggleReaction.useMutation({ onSuccess: () => refetchReactions() });

  // ── Scroll-to-original ────────────────────────────────────────────────────────────────
  const cmdMsgRefMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const [highlightedCmdMsgId, setHighlightedCmdMsgId] = useState<number | null>(null);
  function scrollToCmdMsg(id: number) {
    const el = cmdMsgRefMap.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedCmdMsgId(id);
    setTimeout(() => setHighlightedCmdMsgId(null), 1800);
  }

  // ── Inline issue note editing (right panel auto-raised issues) ──────────────
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const { refetch: refetchCmdData } = trpc.opsChat.getCommandChatData.useQuery(undefined, { enabled: false });
  const updateIssueNoteMutation = trpc.opsChat.updateIssueNote.useMutation({
    onSuccess: () => {
      toast.success("Note saved");
      setEditingNoteId(null);
      refetchCmdData();
    },
    onError: (err) => toast.error("Failed to save note", { description: err.message }),
  });

  // ── Resolve Issue modal state (Command Chat general_issue) ────────────────────
  const [resolveIssueOpen, setResolveIssueOpen] = useState(false);
  const [resolveIssueMessageId, setResolveIssueMessageId] = useState<number | null>(null);
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

  // Auto-scroll thread to bottom when new messages arrive.
  // On first mount (initialScrollDone is false) jump instantly — no smooth scroll
  // so re-entering the chat doesn't trigger a jarring fast-scroll animation.
  const initialScrollDone = useRef(false);
  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    if (!initialScrollDone.current) {
      // First render — jump to bottom instantly, no animation
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" as ScrollBehavior });
      initialScrollDone.current = true;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [channelMsgs.length]);

  // Play notification sound + OS notification when new messages arrive from others.
  // Skip on first load (prev === -1) to avoid firing for all existing messages on remount.
  useEffect(() => {
    const prev = prevMsgCountRef.current;
    const curr = channelMsgs.length;
    if (prev === -1) {
      // First load — just record current count, don't fire sound
      prevMsgCountRef.current = curr;
      return;
    }
    if (curr > prev) {
      // Check if the newest message is from someone else
      const newest = channelMsgs[channelMsgs.length - 1];
      if (newest && newest.from !== callerName) {
        playNotification();
        // Show OS notification when tab is in background
        osNotify({
          title: `Command Chat — ${newest.from}`,
          body: newest.body?.slice(0, 100) ?? "New message",
          tag: "leadflow-command",
        });
      }
    }
    prevMsgCountRef.current = curr;
  }, [channelMsgs, callerName, playNotification, osNotify]);

  // ── Repeating sound every 60 seconds while any unclaimed lead exists ─────────
  const unclaimedLeads = useMemo(() => {
    return channelMsgs.filter(m => {
      if (m.quickAction !== "new_lead") return false;
      try {
        const meta = JSON.parse(m.metadata ?? "{}");
        return !meta.claimedBy;
      } catch { return false; }
    });
  }, [channelMsgs]);

  useEffect(() => {
    if (unclaimedLeads.length === 0) return;
    const interval = setInterval(() => {
      playNotification();
    }, 60_000);
    return () => clearInterval(interval);
  }, [unclaimedLeads.length, playNotification]);

  const snapshot = cmdData?.snapshot ?? { issue: 0, soon: 0, progress: 0, complete: 0, assigned: 0 };
  const alerts = cmdData?.alerts ?? [];
  const pinnedJobs = cmdData?.pinnedJobs ?? [];
  const autoRaised = cmdData?.autoRaised ?? [];
  const manualIssues = cmdData?.manualIssues ?? [];
  const pendingReminderCount = cmdData?.pendingReminderCount ?? 0;

  const totalAlerts = snapshot.issue + snapshot.soon;

  function handleSend() {
    const hasText = composer.trim().length > 0;
    const donePhotos = stagedPhotos.filter(p => p.status === "done" && p.s3Url);
    const uploadingPhotos = stagedPhotos.filter(p => p.status === "uploading" || p.status === "pending");
    if (!hasText && donePhotos.length === 0) return;
    if (uploadingPhotos.length > 0) {
      toast.error("Please wait for photos to finish uploading");
      return;
    }
    const mediaUrl = donePhotos.length > 0 ? JSON.stringify(donePhotos.map(p => p.s3Url!)) : undefined;
    const body = composer.trim() || (donePhotos.length > 0 ? "Photo" : "");
    onSendMessage(body, mediaUrl, replyTo ?? undefined);
    setComposer("");
    setReplyTo(null);
    setStagedPhotos(prev => { prev.forEach(p => URL.revokeObjectURL(p.previewUrl)); return []; });
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
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("cmd_leftCollapsed") === "true"; } catch { return false; }
  });
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("cmd_rightCollapsed") === "true"; } catch { return false; }
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // Persist to localStorage whenever values change
  useEffect(() => { try { localStorage.setItem("cmd_leftWidth",  String(leftWidth));  } catch {} }, [leftWidth]);
  useEffect(() => { try { localStorage.setItem("cmd_rightWidth", String(rightWidth)); } catch {} }, [rightWidth]);
  useEffect(() => { try { localStorage.setItem("cmd_leftCollapsed",  String(leftCollapsed));  } catch {} }, [leftCollapsed]);
  useEffect(() => { try { localStorage.setItem("cmd_rightCollapsed", String(rightCollapsed)); } catch {} }, [rightCollapsed]);

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
        className="shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col overflow-hidden transition-[width] duration-200"
        style={{ width: leftCollapsed ? 0 : leftWidth, minWidth: leftCollapsed ? 0 : MIN_LEFT, overflow: leftCollapsed ? "hidden" : undefined }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-white">
          <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-1 whitespace-nowrap">General Command Chat</p>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-2xl font-bold text-slate-900 whitespace-nowrap">Ship Control</h2>
            <div className="flex items-center gap-1.5 shrink-0">
              {totalAlerts > 0 && (
                <span className="text-xs font-semibold bg-slate-100 text-slate-700 rounded-full px-3 py-1 border border-slate-200 whitespace-nowrap">
                  {totalAlerts} alert{totalAlerts !== 1 ? "s" : ""}
                </span>
              )}
              <button
                type="button"
                onClick={() => setLeftCollapsed(true)}
                title="Collapse panel"
                className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* View switcher pill */}
          <div className="flex bg-slate-100 rounded-full p-1 gap-1">
            <button
              onClick={onSwitchToToday}
              className="flex-1 text-xs font-semibold rounded-full py-1.5 transition-all text-slate-500 hover:text-slate-800"
            >
              Today Ops
            </button>
            <button
              className="flex-1 text-xs font-semibold rounded-full py-1.5 bg-slate-900 text-white shadow-sm"
            >
              Channels
            </button>
          </div>

          {/* Ops Snapshot */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 mb-3">Ops Snapshot</p>
            {cmdLoading ? (
              <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {(["issue", "progress", "soon", "complete"] as StatusBucket[]).map((bucket) => (
                  <div key={bucket} className={cn("rounded-lg border p-3", BUCKET_BG[bucket])}>
                    <p className={cn("text-xs font-medium", BUCKET_COLORS[bucket])}>{BUCKET_LABELS[bucket]}</p>
                    <p className={cn("text-2xl font-bold mt-1", BUCKET_COLORS[bucket])}>{snapshot[bucket]}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

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
                  return (
                    <button
                      key={i}
                      onClick={() => onJumpToJob(alert.jobId)}
                      className={cn(
                        "w-full text-left rounded-xl border p-3 transition hover:shadow-sm",
                        alert.type === "issue" ? "bg-red-50 border-red-100 hover:bg-red-100" : "bg-amber-50 border-amber-100 hover:bg-amber-100"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-sm font-semibold leading-tight", alert.type === "issue" ? "text-red-700" : "text-amber-700")}>
                          {alert.title}
                        </p>
                        <span className={cn("text-[10px] font-medium shrink-0 mt-0.5", alert.type === "issue" ? "text-red-500" : "text-amber-500")}>
                          {fmt12(alert.ts)}
                        </span>
                      </div>
                      <p className={cn("text-xs mt-1 leading-snug", alert.type === "issue" ? "text-red-600" : "text-amber-600")}>
                        {alert.body}
                      </p>
                      <p className={cn("text-[10px] font-semibold uppercase tracking-wide mt-1.5", alert.type === "issue" ? "text-red-400" : "text-amber-400")}>
                        {alert.source}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Left drag handle + collapse-expand toggle ── */}
      <div
        className="relative flex-none flex items-center justify-center group"
        style={{ width: 8, cursor: "col-resize", zIndex: 10 }}
        onMouseDown={leftCollapsed ? undefined : startDrag("left")}
      >
        {/* Drag track */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-slate-200 group-hover:bg-slate-400 transition-colors rounded-full" />
        {/* Expand/collapse pill button — always visible */}
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setLeftCollapsed(v => !v)}
          title={leftCollapsed ? "Expand panel" : "Collapse panel"}
          className="absolute z-20 w-5 h-10 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-400 transition-all opacity-0 group-hover:opacity-100"
        >
          {leftCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </div>

      {/* ── CENTER PANEL: Pinned Day Status + Conversation ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-white" style={{ minWidth: MIN_CENTER }}>
        {/* Header — compact single-line bar */}
        <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-slate-500 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 whitespace-nowrap">MIB Command Chat</h2>
            <span className="hidden sm:inline text-[10px] font-medium bg-red-50 text-red-500 border border-red-100 rounded-full px-2 py-0.5 whitespace-nowrap">Priority alerts from job threads</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {pendingReminderCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-semibold bg-sky-50 text-sky-600 border border-sky-200 rounded-full px-2 py-0.5">
                <Bell className="h-3 w-3" />{pendingReminderCount} reminder{pendingReminderCount !== 1 ? "s" : ""} set
              </span>
            )}
            <button
              onClick={toggleMute}
              title={notifMuted ? "Unmute notifications" : "Mute notifications"}
              className="h-7 w-7 flex items-center justify-center rounded-full border border-slate-200 hover:bg-slate-100 transition-colors"
            >
              {notifMuted
                ? <BellOff className="h-3.5 w-3.5 text-slate-400" />
                : <Bell className="h-3.5 w-3.5 text-slate-500" />}
            </button>
            <Button size="sm" variant="outline" className="h-7 text-xs rounded-full px-3" onClick={() => setBroadcastOpen(true)}>
              <Megaphone className="h-3 w-3 mr-1" />Broadcast
            </Button>
          </div>
        </div>

        {/* Active Sticky Pin banner — real sticky note look */}
        {activePin && (
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

        {/* Pinned Day Status — arrow-navigated chip strip */}
        {(() => {
          // eslint-disable-next-line react-hooks/rules-of-hooks
          const stripRef = useRef<HTMLDivElement>(null);
          const scroll = (dir: "left" | "right") => {
            if (!stripRef.current) return;
            stripRef.current.scrollBy({ left: dir === "left" ? -160 : 160, behavior: "smooth" });
          };
          return (
            <div className="border-b border-slate-100 shrink-0 flex items-center gap-1 px-2 py-1.5">
              <button
                onClick={() => scroll("left")}
                className="shrink-0 rounded-full p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                aria-label="Scroll left"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {cmdLoading ? (
                <div className="flex gap-2 flex-1">
                  {[1,2,3,4].map(i => <div key={i} className="w-24 h-7 rounded-full bg-slate-100 animate-pulse shrink-0" />)}
                </div>
              ) : pinnedJobs.length === 0 ? (
                <p className="text-[10px] text-slate-400 flex-1">No jobs today.</p>
              ) : (
                <div
                  ref={stripRef}
                  className="flex gap-2 flex-1 overflow-x-auto"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {pinnedJobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => onJumpToJob(job.id)}
                      className={cn(
                        "shrink-0 rounded-full border px-3 py-1 text-left transition hover:shadow-sm flex items-center gap-1.5",
                        BUCKET_BG[job.status as StatusBucket] ?? "bg-slate-50 border-slate-200"
                      )}
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", {
                        "bg-red-500": job.status === "issue",
                        "bg-amber-500": job.status === "soon",
                        "bg-blue-500": job.status === "progress",
                        "bg-emerald-500": job.status === "complete",
                        "bg-slate-400": job.status === "assigned",
                      })} />
                      <span className="text-xs font-semibold text-slate-800 whitespace-nowrap max-w-[100px] truncate">{job.name}</span>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">{job.time}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => scroll("right")}
                className="shrink-0 rounded-full p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                aria-label="Scroll right"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          );
        })()}

        {/* Conversation thread */}
        <div ref={threadScrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-4 scrollbar-thin scrollbar-thumb-slate-200">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">Conversation</p>
            <span className="text-[10px] font-medium text-slate-400 bg-slate-100 rounded-full px-2.5 py-0.5">Alerts + regular team chat</span>
          </div>
          <div className="space-y-4">
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

                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[72%] rounded-xl overflow-hidden border border-emerald-200 shadow-sm">
                        {/* Header band */}
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-700">
                          <Zap className="h-3 w-3 text-emerald-200" />
                          <span className="text-[10px] font-semibold text-emerald-100 uppercase tracking-widest">New Lead</span>
                          <span className="ml-auto text-[10px] text-emerald-300">{fmtMsgTime(msg.createdAt)}</span>
                        </div>
                        {/* Lead info */}
                        <div className="px-3 py-2.5 bg-white">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-base font-bold text-slate-900 leading-tight">{leadName}</p>
                              {leadPhone && <p className="text-xs text-slate-400 mt-0.5">{leadPhone}</p>}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-lg font-bold text-emerald-700">${price}</p>
                              <p className="text-[10px] text-slate-400">{serviceType}</p>
                            </div>
                          </div>
                          {size && (
                            <p className="text-xs text-slate-500 mt-1.5">🛏️ {size} &nbsp;·&nbsp; {serviceType}</p>
                          )}
                          {extras.length > 0 && (
                            <p className="text-xs text-slate-400 mt-0.5">📦 {extras.join(", ")}</p>
                          )}
                          {utmSource && (
                            <p className="text-xs text-slate-400 mt-0.5">📍 {utmSource}</p>
                          )}
                          {/* Elapsed timer */}
                          <div className="flex items-center gap-1 text-xs text-slate-400 mt-2.5 pt-2 border-t border-slate-100">
                            <Clock className="h-3 w-3" />
                            <ElapsedTimer arrivedAt={arrivedAt} />
                          </div>

                          {/* Action icons row */}
                          <div className="flex items-center gap-3 mt-3">
                            {/* Call icon — dial lead directly */}
                            {leadPhone && (
                              <a
                                href={`tel:${leadPhone}`}
                                title={`Call ${leadName}`}
                                className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors shrink-0"
                              >
                                <Phone className="h-4 w-4" />
                              </a>
                            )}
                            {/* SMS icon — open SMS conversation drawer */}
                            {sessionId && (
                              <a
                                href={`/admin/leads?session=${sessionId}&tab=sms`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open SMS conversation"
                                className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 hover:text-emerald-900 transition-colors shrink-0"
                              >
                                <MessageCircle className="h-4 w-4" />
                              </a>
                            )}
                            {/* Call Assist icon — open call assist page pre-filled */}
                            <button
                              title="Open Call Assist for this lead"
                              onClick={() => {
                                const params = new URLSearchParams();
                                if (sessionId) params.set("sessionId", String(sessionId));
                                if (leadName)    params.set("name",        encodeURIComponent(leadName));
                                if (leadPhone)   params.set("phone",       encodeURIComponent(leadPhone));
                                if (serviceType) params.set("serviceType", encodeURIComponent(serviceType));
                                window.open(`/call-assist?${params.toString()}`, "_blank");
                              }}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-violet-100 hover:bg-violet-200 text-violet-700 hover:text-violet-900 transition-colors shrink-0"
                            >
                              <Wand2 className="h-4 w-4" />
                            </button>
                            {/* Spacer then Claim */}
                            <div className="flex-1" />
                            {/* Claim button / claimed state */}
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

                // ── Default bubble ───────────────────────────────────────────────────
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
                  return (
                    <div
                      key={msg.id}
                      ref={(el) => { if (el) cmdMsgRefMap.current.set(msg.id, el); else cmdMsgRefMap.current.delete(msg.id); }}
                      className={cn(
                        "flex group transition-colors duration-300",
                        isMine ? "justify-end" : "justify-start",
                        highlightedCmdMsgId === msg.id ? "bg-amber-50 rounded-xl" : ""
                      )}
                    >
                      {/* Avatar circle for other people's messages */}
                      {!isMine && !isAlert && (
                        <div
                          className="w-7 h-7 rounded-full overflow-hidden shrink-0 mt-1 mr-2"
                          title={msg.from}
                        >
                          {authorPhoto ? (
                            <img src={authorPhoto} alt={msg.from ?? ""} className="w-full h-full object-cover" />
                          ) : (
                            <div
                              className="w-full h-full flex items-center justify-center text-[10px] font-bold text-white"
                              style={{ backgroundColor: authorColor }}
                            >
                              {authorInitial}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Bubble + WhatsApp-style hover actions */}
                      <div className="relative flex items-start" style={{ flexDirection: isMine ? "row-reverse" : "row" }}>
                        <div className={cn(
                          "max-w-[75%] rounded-2xl px-4 py-3",
                          isAlert ? "bg-slate-900 text-white w-full max-w-full" :
                          isMine ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"
                        )}>
                          {!isMine && (
                            <p className="text-[10px] font-semibold mb-1" style={{ color: isAlert ? "#94a3b8" : authorColor }}>
                              {msg.from} · {msg.role === "alert" ? "Alert" : msg.role === "office" ? "Office" : msg.role === "cleaner" ? "Cleaner" : "Dispatch"}
                            </p>
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
                          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                            {(() => {
                              // Token-based markdown renderer: supports **bold** and [text](url)
                              const tokens: React.ReactNode[] = [];
                              const linkRe = /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)/g;
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
                              linkRe.lastIndex = 0;
                              while ((match = linkRe.exec(msg.body)) !== null) {
                                if (match.index > lastIdx) tokens.push(...renderBold(msg.body.slice(lastIdx, match.index), `pre-${match.index}`));
                                tokens.push(<a key={`link-${match.index}`} href={match[2]} target="_blank" rel="noopener noreferrer" className="underline text-blue-400 hover:text-blue-300">{match[1]}</a>);
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
                          <div className="flex items-center justify-end gap-1 mt-1.5">
                            <p className={cn("text-[10px]", isAlert ? "text-slate-400" : "text-slate-400")}>
                              {fmtMsgTime(msg.createdAt)}
                            </p>
                            {/* WhatsApp-style read receipt — only on my own messages */}
                            {isMine && !isAlert && (() => {
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
                        {!isAlert && (
                          <div
                            className={cn(
                              "opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center gap-1 self-start mt-1",
                              isMine ? "mr-1.5" : "ml-1.5"
                            )}
                          >
                            <button
                              onClick={() => setReplyTo({ id: msg.id, body: msg.body, author: msg.from })}
                              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition bg-slate-100 text-slate-600 hover:bg-slate-200"
                            >
                              <ChevronDown className="h-3 w-3" />
                              <span>Reply</span>
                            </button>
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
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
              })
            )}
            <div ref={threadBottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-white">
          {/* Quick-action chips */}
          <div className="flex gap-2 mb-3 flex-wrap">
            <button
              onClick={() => setBroadcastOpen(true)}
              className="text-xs font-semibold rounded-full px-4 py-2 transition bg-slate-900 text-white hover:bg-slate-700"
            >
              Broadcast Update
            </button>
            <button
              onClick={() => setIssueOpen(true)}
              className="text-xs font-semibold rounded-full px-4 py-2 transition bg-white border border-red-200 text-red-700 hover:bg-red-50"
            >
              Open Issue
            </button>
            <button
              onClick={() => setReminderOpen(true)}
              className="text-xs font-semibold rounded-full px-4 py-2 transition bg-white border border-sky-200 text-sky-700 hover:bg-sky-50"
            >
              Set Reminder
            </button>
            <button
              onClick={() => setPinOpen(true)}
              className="text-xs font-semibold rounded-full px-4 py-2 transition bg-white border border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              Pin Note
            </button>
            <button
              onClick={() => setBookingOpen(true)}
              className="text-xs font-semibold rounded-full px-4 py-2 transition bg-white border border-violet-200 text-violet-700 hover:bg-violet-50"
            >
              Announce Booking
            </button>
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
          <div
            className={cn(
              "rounded-2xl border bg-slate-50 p-3 transition",
              isDragging ? "border-slate-900 bg-slate-100 ring-2 ring-slate-900/10" : "border-slate-200"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) stageFiles(e.dataTransfer.files); }}
          >
            <Textarea
              ref={composerRef}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder={isDragging ? "Drop photos here…" : isTranscribing ? "Transcribing voice note…" : "Type a message or drop photos…"}
              rows={2}
              className="resize-none border-0 bg-transparent p-0 text-sm text-slate-700 focus-visible:ring-0 placeholder:text-slate-400"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); return; }
                onCmdKeyPress();
              }}
              onBlur={onCmdBlur}
            />
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1 relative">
                {/* Photo */}
                <button
                  className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-white transition text-xs flex items-center gap-1"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-4 w-4" /> Photo
                </button>
                {/* Voice */}
                {isRecording ? (
                  <button
                    className="rounded-xl px-2.5 py-1.5 bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition text-xs flex items-center gap-1.5 font-medium"
                    onClick={stopRecording}
                  >
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    {recordingSeconds}s — Stop
                  </button>
                ) : isTranscribing ? (
                  <button disabled className="rounded-xl px-2.5 py-1.5 text-slate-400 transition text-xs flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing…
                  </button>
                ) : (
                  <button
                    className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-white transition text-xs flex items-center gap-1"
                    onClick={startRecording}
                  >
                    <Mic className="h-4 w-4" /> Voice
                  </button>
                )}
                {/* Emoji */}
                <div ref={emojiRef} className="relative">
                  <button
                    className={cn("rounded-xl p-2 transition", showEmoji ? "text-slate-900 bg-white" : "text-slate-400 hover:text-slate-700 hover:bg-white")}
                    onClick={() => setShowEmoji(v => !v)}
                  >
                    <Smile className="h-4 w-4" />
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
                size="sm"
                onClick={handleSend}
                disabled={(!composer.trim() && stagedPhotos.filter(p => p.status === "done").length === 0)}
                className="rounded-xl"
              >
                <Send className="h-3.5 w-3.5 mr-1.5" /> Send
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right drag handle + collapse-expand toggle ── */}
      <div
        className="relative flex-none flex items-center justify-center group"
        style={{ width: 8, cursor: "col-resize", zIndex: 10 }}
        onMouseDown={rightCollapsed ? undefined : startDrag("right")}
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-slate-200 group-hover:bg-slate-400 transition-colors rounded-full" />
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setRightCollapsed(v => !v)}
          title={rightCollapsed ? "Expand panel" : "Collapse panel"}
          className="absolute z-20 w-5 h-10 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-400 transition-all opacity-0 group-hover:opacity-100"
        >
          {rightCollapsed ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
      </div>

      {/* ── RIGHT PANEL: Rules + Auto-Raised Issues + Suggested Widgets ── */}
      <div
        className="shrink-0 border-l border-slate-200 bg-slate-50 flex flex-col overflow-y-auto transition-[width] duration-200"
        style={{ width: rightCollapsed ? 0 : rightWidth, minWidth: rightCollapsed ? 0 : MIN_RIGHT, overflow: rightCollapsed ? "hidden" : undefined }}
      >
        <div className="px-5 py-4 space-y-5">

          {/* ── Hot Leads Tray ── */}
          <HotLeadsTray
            channelMsgs={channelMsgs}
            claimLeadMutation={claimLeadMutation}
            onCollapse={() => setRightCollapsed(true)}
          />

          <div className="border-t border-slate-200" />

          {/* Auto-Raised Issues */}
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

          <div className="border-t border-slate-200" />

          {/* Manual Issues */}
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
        </div>
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
      {resolveIssueOpen && resolveIssueMessageId && (
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
                  if (!resolveIssueNoteText.trim() || !resolveIssueMessageId) return;
                  setResolveIssueSubmitting(true);
                  try {
                    await openIssueMutation.mutateAsync({
                      title: "__resolve__",
                      note: "",
                      messageId: resolveIssueMessageId,
                      authorName: callerName,
                      resolutionNote: resolveIssueNoteText.trim(),
                    });
                    setResolveIssueOpen(false);
                    setResolveIssueNoteText("");
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
    </div>
  );
}
