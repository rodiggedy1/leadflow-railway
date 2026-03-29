/**
 * OpsChat — Internal team communication hub.
 * Accessible to both the owner (Manus OAuth) and all agent accounts (email + password).
 * Layout: 3 columns — left sidebar (queue + jobs), center (timeline + thread), right (job details + actions).
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { useOsNotification } from "@/hooks/useOsNotification";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { TypingBubble } from "@/components/TypingBubble";
import { senderHex, senderColorClass } from "@/lib/senderColor";
import CommandChat from "@/components/CommandChat";
import DmPanel from "@/components/DmPanel";
import ReminderPopup from "@/components/ReminderPopup";
import ProfilePhotoDrawer from "@/components/ProfilePhotoDrawer";
import EmojiPicker, { type EmojiClickData, Theme } from "emoji-picker-react";
import { useOpsChatWindow } from "@/hooks/useOpsChatWindow";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Phone,
  ExternalLink,
  Send,
  Camera,
  Mic,
  Smile,
  ChevronLeft,
  ChevronRight,
  LogIn,
  Loader2,
  MessageCircle,
  Minus,
  X,
  ImageIcon,
  ZoomIn,
  AlertTriangle,
  Square,
  MicOff,
  CheckCircle2,
  Car,
  Play,
  CheckCheck,
  Clock,
  Camera as CameraIcon,
  Flag,
  MapPin,
  CalendarDays,
  MessageSquare,
  ChevronDown,
  Users,
  Wifi,
  WifiOff,
  LayoutDashboard,
  Radio,
  UserCircle,
  ClipboardList,
  Bell,
  BellOff,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type PriorityStatus = "issue" | "soon" | "progress" | "complete" | "assigned";

interface JobSummary {
  id: number;
  title: string;
  client: string;
  team: string | null;
  address: string;
  serviceType: string;
  price: string;
  time: string;
  status: PriorityStatus;
  jobStatus: string | null;
  issueNote: string | null;
  flagged: boolean;
  flaggedAt: number | null;
  messageCount: number;
  photoSubmitted: boolean;
}

// ── EscalationTimer ───────────────────────────────────────────────────────────

/** Live countdown showing how long a flagged issue has been open. */
function EscalationTimer({ flaggedAt, selected }: { flaggedAt: number; selected: boolean }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - flaggedAt) / 60_000));
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - flaggedAt) / 60_000)), 30_000);
    return () => clearInterval(id);
  }, [flaggedAt]);
  const label = elapsed < 1 ? "< 1 min unresolved" : `${elapsed} min unresolved`;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
      selected ? "bg-red-500/30 text-red-200" : "bg-red-100 text-red-700"
    )}>
      ⚠️ {label}
    </span>
  );
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_META: Record<PriorityStatus, { label: string; bg: string; text: string; border: string }> = {
  issue:    { label: "Needs Attention", bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200" },
  soon:     { label: "Starting Soon",   bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200" },
  progress: { label: "In Progress",     bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200" },
  complete: { label: "Completed",       bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-200" },
  assigned: { label: "Assigned",        bg: "bg-slate-50",  text: "text-slate-600",  border: "border-slate-200" },
};

// time = bold colored timestamp · label = event text · bg/border = pill shell
const TIMELINE_TONE: Record<string, { time: string; label: string; bg: string; border: string }> = {
  arrival:  { time: "text-emerald-700", label: "text-emerald-800", bg: "bg-emerald-50",  border: "border-emerald-200" },
  photo:    { time: "text-sky-600",     label: "text-sky-800",     bg: "bg-sky-50",      border: "border-sky-200" },
  issue:    { time: "text-red-600",     label: "text-red-700",     bg: "bg-red-50",      border: "border-red-200" },
  schedule: { time: "text-amber-600",   label: "text-amber-800",   bg: "bg-amber-50",    border: "border-amber-200" },
  complete: { time: "text-emerald-700", label: "text-emerald-800", bg: "bg-emerald-50",  border: "border-emerald-200" },
};

const QUICK_ACTIONS = [
  { key: "Issue",          label: "Issue",          template: "⚠️ ISSUE REPORTED\n\nLocation: \nType: \nPhoto attached: " },
  { key: "Photo",          label: "Photo",          template: "📸 PHOTOS UPLOADED\n\nBefore photos added to this job thread." },
  { key: "Late",           label: "Late",           template: "⏱ DELAY\n\nRunning about 15 minutes behind schedule." },
  { key: "Complete",       label: "Complete",       template: "✅ JOB COMPLETE\n\nAll areas finished and after photos uploaded." },
  { key: "Message Client", label: "Message Client", template: "Hey — quick update from your cleaning: we're taking a little extra time on one area to make sure it's done right 👍" },
  { key: "Review + Rebook",label: "Review + Rebook",template: "This job is complete.\n\nSuggested next step:\n• Send review request\n• Offer recurring service in 2 weeks" },
];

const CHANNELS = [
  { key: "command",  label: "MIB Command Chat", isCommand: true },
  { key: "urgent",   label: "Urgent" },
  { key: "dispatch", label: "Dispatch / Today" },
  { key: "cleaners", label: "Cleaners" },
];

// ── Agent Login Gate ──────────────────────────────────────────────────────────

function AgentLoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = trpc.agents.login.useMutation({
    onSuccess: (data) => {
      toast.success(`Welcome, ${data.agent.name}!`);
      onSuccess();
    },
    onError: (err) => toast.error(err.message || "Login failed"),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 w-full max-w-sm mx-4">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center mx-auto mb-3">
            <MessageCircle className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">OpsChat</h1>
          <p className="text-sm text-slate-500 mt-1">Sign in to access the ops hub</p>
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
            <Label htmlFor="ops-email">Email</Label>
            <Input
              id="ops-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              disabled={loginMutation.isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ops-password">Password</Label>
            <Input
              id="ops-password"
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
            className="w-full bg-slate-900 text-white hover:bg-slate-800"
            disabled={loginMutation.isPending || !email || !password}
          >
            {loginMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…</>
            ) : (
              <><LogIn className="w-4 h-4 mr-2" /> Sign In</>
            )}
          </Button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-4">
          Contact your admin if you need access.
        </p>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status, className }: { status: PriorityStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", m.bg, m.text, m.border, className)}>
      {m.label}
    </span>
  );
}

function JobCard({ job, selected, onClick }: { job: JobSummary; selected: boolean; onClick: () => void }) {
  const meta = STATUS_META[job.status];
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-2xl border p-4 text-left transition hover:shadow-md",
        selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
              selected ? "border-white/20 bg-white/10 text-white" : cn(meta.bg, meta.text, meta.border)
            )}>
              {meta.label}
            </span>
            <span className={cn("text-xs", selected ? "text-slate-300" : "text-slate-500")}>{job.time}</span>
          </div>
          <div className="mt-2 text-sm font-semibold truncate">{job.title}</div>
          <div className={cn("mt-0.5 text-sm truncate", selected ? "text-slate-300" : "text-slate-500")}>
            {job.client}{job.team ? ` • ${job.team}` : ""}
          </div>
          <div className={cn("mt-1 text-xs truncate", selected ? "text-slate-400" : "text-slate-500")}>{job.address}</div>
        </div>
        {job.messageCount > 0 && (
          <div className={cn(
            "min-w-6 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-semibold",
            selected ? "bg-white text-slate-900" : "bg-slate-900 text-white"
          )}>
            {job.messageCount}
          </div>
        )}
      </div>
      {job.flagged && job.flaggedAt && (
        <div className="mt-2">
          <EscalationTimer flaggedAt={job.flaggedAt} selected={selected} />
        </div>
      )}
      {job.issueNote && (
        <div className={cn("mt-2 rounded-xl px-3 py-2 text-xs", selected ? "bg-white/10 text-slate-100" : "bg-red-50 text-red-700")}>
          {job.issueNote}
        </div>
      )}
    </button>
  );
}

// Map event type → lucide icon
const TIMELINE_ICON: Record<string, React.ElementType> = {
  schedule:  Car,
  arrival:   MapPin,
  progress:  Play,
  complete:  CheckCheck,
  photo:     CameraIcon,
  issue:     Flag,
  late:      Clock,
};

// Strip leading "TeamName " or "TeamName is" etc. from event text
function stripTeamName(text: string): string {
  // Remove patterns like "GoGreen is on the way" → "On the way"
  // or "GoGreen started the job" → "Started the job"
  // or "GoGreen marked job complete" → "Marked job complete"
  return text.replace(/^[A-Za-z0-9 ]+ (is |has |marked |started |uploaded |flagged |arrived|completed)/i, (_, verb) =>
    verb.charAt(0).toUpperCase() + verb.slice(1)
  ).replace(/^[A-Za-z0-9 ]+ (?=on the way|at the property|the job|job complete|photos|an issue)/i, "");
}

function TimelineEvent({ event }: { event: { id: string; ts: number; type: string; text: string } }) {
  const tone = TIMELINE_TONE[event.type] ?? TIMELINE_TONE.schedule;
  // 12-hour clock, no seconds
  const timeStr = new Date(event.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const Icon = TIMELINE_ICON[event.type] ?? Clock;
  const label = stripTeamName(event.text);
  return (
    <span className={cn(
      "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap shrink-0",
      tone.bg, tone.border
    )}>
      <Icon className={cn("w-3.5 h-3.5 shrink-0", tone.time)} />
      <span className={cn("font-bold tabular-nums", tone.time)}>{timeStr}</span>
      <span className="text-slate-300 select-none font-light">·</span>
      <span className={cn("font-medium", tone.label)}>{label}</span>
    </span>
  );
}

// ── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({ urls, startIndex, onClose }: { urls: string[]; startIndex: number; onClose: () => void }) {
  const [idx, setIdx] = useState(startIndex);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIdx(i => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx(i => Math.min(urls.length - 1, i + 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [urls.length, onClose]);
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Close */}
      <button
        className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>
      {/* Prev */}
      {urls.length > 1 && idx > 0 && (
        <button
          className="absolute left-4 z-10 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 transition"
          onClick={(e) => { e.stopPropagation(); setIdx(i => i - 1); }}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      {/* Image */}
      <img
        src={urls[idx]}
        alt={`Photo ${idx + 1}`}
        className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      {/* Next */}
      {urls.length > 1 && idx < urls.length - 1 && (
        <button
          className="absolute right-4 z-10 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 transition"
          onClick={(e) => { e.stopPropagation(); setIdx(i => i + 1); }}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
      {/* Counter */}
      {urls.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
          {idx + 1} / {urls.length}
        </div>
      )}
    </div>
  );
}

/** Deterministic pastel color from a name string */
function avatarColor(name: string): string {
  const palette = [
    "bg-violet-100 text-violet-700",
    "bg-sky-100 text-sky-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700",
    "bg-teal-100 text-teal-700",
    "bg-indigo-100 text-indigo-700",
    "bg-orange-100 text-orange-700",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function ThreadMessage({ msg, callerName, isMine: isMineOverride, seenBy, onReply, onScrollToMsg, reactions, onReact, senderPhotoMap, senderStatusMap }: {
  msg: { id: string; ts: number; from: string; role: string; body: string; source: string; mediaUrl?: string | null; quickAction?: string | null; metadata?: string | null; replyToId?: number | null; replyToBody?: string | null; replyToAuthor?: string | null };
  callerName: string;
  /** Pass true when the message was sent by the current user — overrides internal msg.from === callerName check */
  isMine?: boolean;
  seenBy?: string[];
  onReply?: (msg: { id: number; body: string; author: string }) => void;
  onScrollToMsg?: (id: number) => void;
  reactions?: { emoji: string; callerName: string; callerId: string }[];
  onReact?: (messageId: number, emoji: string) => void;
  senderPhotoMap?: Record<string, string | null>;
  /** Map of senderName -> "online" | "away" | "offline" for status dot overlay */
  senderStatusMap?: Record<string, "online" | "away" | "offline">;
}) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [showReactPicker, setShowReactPicker] = useState(false);
  // Prefer the explicit isMine prop (computed with myNames Set at call site) over the internal check
  const isMine = isMineOverride ?? (msg.from === callerName);
  const timeStr = new Date(msg.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const initials = msg.from.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const colorClass = senderColorClass(msg.from);
  const senderPhoto = senderPhotoMap?.[msg.from] ?? null;

  // Group reactions by emoji
  const reactionGroups = (reactions ?? []).reduce<Record<string, { count: number; names: string[]; isMine: boolean }>>((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, names: [], isMine: false };
    acc[r.emoji].count++;
    acc[r.emoji].names.push(r.callerName);
    if (r.callerName === callerName) acc[r.emoji].isMine = true;
    return acc;
  }, {});

  // Parse mediaUrl — may be a JSON array of URLs or a single URL
  const imageUrls: string[] = (() => {
    if (!msg.mediaUrl) return [];
    try {
      const parsed = JSON.parse(msg.mediaUrl);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {}
    return [msg.mediaUrl];
  })();

  // ── issue_resolved card ────────────────────────────────────────────────────────────────────────
  if (msg.quickAction === "issue_resolved") {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(msg.metadata ?? "{}"); } catch { /* ignore */ }
    const issTitle = (meta.issueTitle as string) ?? "Issue";
    const issNote = (meta.issueNote as string | null) ?? null;
    const resNote = (meta.resolutionNote as string | null) ?? null;
    const resolvedBy = (meta.resolvedBy as string) ?? msg.from;
    return (
      <div className={cn("flex", isMine ? "justify-end" : "justify-start")}>
        <div className="max-w-[72%] rounded-xl overflow-hidden border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600">
            <CheckCircle2 className="h-3 w-3 text-emerald-100" />
            <span className="text-[10px] font-semibold text-emerald-100 uppercase tracking-widest">✅ Issue Resolved</span>
            <span className="ml-auto text-[10px] text-emerald-300">{timeStr}</span>
          </div>
          <div className="px-3 py-2.5 bg-white">
            <div className="rounded-lg bg-red-50 border border-red-100 px-2.5 py-1.5 mb-2">
              <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-0.5">Original Issue</p>
              <p className="text-xs text-slate-700 font-medium">{issTitle}</p>
              {issNote && <p className="text-xs text-slate-500 mt-0.5">{issNote}</p>}
            </div>
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

  return (
    <>
      {lightboxIdx !== null && (
        <Lightbox urls={imageUrls} startIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      )}
      <div className={cn("flex items-end gap-2 group", isMine ? "justify-end" : "justify-start")}>
        {/* Avatar — others' messages on left, with online status dot overlay */}
        {!isMine && (
          <div className="relative w-7 h-7 shrink-0 mb-0.5">
            <div className="w-full h-full rounded-full overflow-hidden">
              {senderPhoto ? (
                <img src={senderPhoto} alt={msg.from} className="w-full h-full object-cover" />
              ) : (
                <div className={cn("w-full h-full flex items-center justify-center text-[10px] font-bold", colorClass)}>
                  {initials}
                </div>
              )}
            </div>
            {/* Status dot — only shown when senderStatusMap is provided */}
            {senderStatusMap && (() => {
              const st = senderStatusMap[msg.from];
              if (!st || st === "offline") return null;
              return (
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white",
                    st === "online" ? "bg-green-500" : "bg-amber-400"
                  )}
                  title={st === "online" ? "Online" : "Away"}
                />
              );
            })()}
          </div>
        )}
        {/* Bubble + WhatsApp-style hover dropdown */}
        <div className="relative flex items-start" style={{ flexDirection: isMine ? "row-reverse" : "row" }}>
          <div className={cn(
            "max-w-[72%] rounded-2xl overflow-hidden",
            isMine
              ? "bg-slate-900 text-white rounded-br-sm"
              : "bg-slate-100 text-slate-900 rounded-bl-sm"
          )}>
            {/* Inline images */}
            {imageUrls.length > 0 && (
              <div className={cn(
                "grid gap-0.5",
                imageUrls.length === 1 ? "grid-cols-1" : imageUrls.length === 2 ? "grid-cols-2" : "grid-cols-3"
              )}>
                {imageUrls.map((url, i) => (
                  <button
                    key={i}
                    className="relative group/img overflow-hidden aspect-square"
                    onClick={() => setLightboxIdx(i)}
                  >
                    <img
                      src={url}
                      alt={`Photo ${i + 1}`}
                      className="w-full h-full object-cover transition-transform duration-200 group-hover/img:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition flex items-center justify-center">
                      <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover/img:opacity-100 transition drop-shadow" />
                    </div>
                  </button>
                ))}
              </div>
            )}
            {/* Text body */}
            {(msg.body || msg.replyToId) && (
              <div className="px-4 py-3">
                {/* Sender name (others only) */}
                {!isMine && (
                  <p className="text-xs font-semibold mb-1" style={{ color: senderHex(msg.from) }}>{msg.from}</p>
                )}
                {/* WhatsApp-style quoted block: left accent bar uses sender's color, click scrolls to original */}
                {msg.replyToId && msg.replyToBody && (
                  <div
                    className={cn(
                      "mb-2.5 rounded-lg overflow-hidden flex transition-colors",
                      onScrollToMsg ? "cursor-pointer hover:brightness-95" : "cursor-default",
                      isMine ? "bg-slate-800" : "bg-slate-100"
                    )}
                    onClick={() => msg.replyToId && onScrollToMsg?.(msg.replyToId)}
                    title={onScrollToMsg ? "Click to jump to original message" : undefined}
                  >
                    {/* Left accent bar — color matches the quoted author's sender color */}
                    <div className="w-1 shrink-0 rounded-l-lg" style={{ backgroundColor: senderHex(msg.replyToAuthor ?? "") }} />
                    <div className="px-2.5 py-2 min-w-0">
                      <p className="text-xs font-semibold mb-0.5 truncate" style={{ color: senderHex(msg.replyToAuthor ?? "") }}>
                        {msg.replyToAuthor ?? "Unknown"}
                      </p>
                      <p className={cn(
                        "text-xs line-clamp-2 leading-snug",
                        isMine ? "text-slate-400" : "text-slate-500"
                      )}>
                        {msg.replyToBody}
                      </p>
                    </div>
                  </div>
                )}
                {msg.body && (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {(() => {
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
                        tokens.push(<a key={`link-${match.index}`} href={match[2]} target="_blank" rel="noopener noreferrer" className="underline text-blue-500 hover:text-blue-400">{match[1]}</a>);
                        lastIdx = match.index + match[0].length;
                      }
                      if (lastIdx < msg.body.length) tokens.push(...renderBold(msg.body.slice(lastIdx), `tail`));
                      return tokens;
                    })()}
                  </p>
                )}
              </div>
            )}
            {/* Footer: time + read receipts */}
            <div className={cn("flex items-center gap-1.5 px-4 pb-3", !msg.body && imageUrls.length > 0 ? "pt-2" : "-mt-1")}>
              <p className={cn("text-xs flex-1", isMine ? "text-slate-400" : "text-slate-400")}>{timeStr}</p>
              {/* WhatsApp-style read receipt — only on my own messages */}
              {isMine && seenBy !== undefined && (
                <span
                  title={seenBy.length > 0 ? `Seen by ${seenBy.join(", ")}` : "Sent"}
                  className="inline-flex items-center shrink-0"
                >
                  {seenBy.length > 0 ? (
                    /* Double blue tick — seen */
                    <svg width="18" height="11" viewBox="0 0 18 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Seen">
                      <path d="M1 5.5L4.5 9L10 2" stroke="#53bdeb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M5 5.5L8.5 9L14 2" stroke="#53bdeb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    /* Single grey tick — sent */
                    <svg width="12" height="11" viewBox="0 0 12 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Sent">
                      <path d="M1 5.5L4.5 9L11 2" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>
              )}
            </div>
            {/* Reaction pills */}
            {Object.keys(reactionGroups).length > 0 && (
              <div className={cn("flex flex-wrap gap-1 px-4 pb-2", isMine ? "justify-end" : "justify-start")}>
                {Object.entries(reactionGroups).map(([emoji, { count, names, isMine: myReact }]) => (
                  <button
                    key={emoji}
                    onClick={() => onReact?.(Number(msg.id), emoji)}
                    title={names.join(", ")}
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition hover:scale-110",
                      myReact
                        ? "bg-blue-100 border-blue-300 text-blue-700"
                        : "bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200"
                    )}
                  >
                    <span>{emoji}</span>
                    <span className="font-medium">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Hover actions: Reply + React */}
          <div
            className={cn(
              "opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 self-start mt-2",
              isMine ? "mr-1.5 flex-row-reverse" : "ml-1.5"
            )}
          >
            {/* Reply button */}
            {onReply && (
              <button
                onClick={() => onReply({ id: Number(msg.id), body: msg.body, author: msg.from })}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition",
                  isMine
                    ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                <ChevronDown className="h-3 w-3" />
                <span>Reply</span>
              </button>
            )}
            {/* Quick-react: 4 emoji buttons */}
            {onReact && (
              <div className="flex items-center gap-0.5">
                {["\uD83D\uDC4D", "\u2764\uFE0F", "\u2705", "\uD83D\uDD25"].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => onReact(Number(msg.id), emoji)}
                    className={cn(
                      "text-sm rounded-full w-7 h-7 flex items-center justify-center transition hover:scale-125",
                      isMine ? "hover:bg-slate-700" : "hover:bg-slate-200"
                    )}
                    title={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface OpsChatProps {
  onMinimize?: () => void;
  onClose?: () => void;
}

export default function OpsChat({ onMinimize, onClose }: OpsChatProps = {}) {
  // Owner auth (Manus OAuth)
  const { user, loading: ownerLoading } = useAuth();

  // Agent auth (email + password)
  const { data: agentMe, isLoading: agentLoading, refetch: refetchAgentMe } = trpc.agents.me.useQuery(undefined, {
    retry: false,
  });

  const { minimize: minimizeFromHook, state: opsChatState } = useOpsChatWindow();
  const minimizeOpsChat = onMinimize ?? minimizeFromHook;
  // Save scroll position when widget hides; restore it when widget re-opens
  const savedScrollTopRef = useRef<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<PriorityStatus | null>(null);
  const [activeTab, setActiveTab] = useState<"today" | "channels">("channels");
  const [activeChannel, setActiveChannel] = useState<string>("command");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  // Auto-collapse sidebar only for command channel; expand for all other views
  const handleSetActiveChannel = (ch: string) => {
    setActiveChannel(ch);
    setSidebarCollapsed(ch === "command");
  };

  // Switching to today always expands sidebar.
  // Switching to channels from today defaults to command channel with sidebar collapsed.
  const handleSetActiveTab = (tab: "today" | "channels") => {
    if (tab === "channels" && activeTab === "today") {
      // Coming from jobs view → land on command channel, sidebar collapsed
      setActiveTab("channels");
      setActiveChannel("command");
      setSidebarCollapsed(true);
    } else if (tab === "today") {
      setActiveTab("today");
      setSidebarCollapsed(false);
    } else {
      setActiveTab(tab);
    }
  };
  const [composer, setComposer] = useState("");
  const [selectedQuickAction, setSelectedQuickAction] = useState<string | null>(null);
  const threadBottomRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null); // scroll container ref for reliable bottom scroll
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Staged photos: each has a local preview URL, upload state, and final S3 URL
  type StagedPhoto = {
    id: string;
    previewUrl: string;
    file: File;
    status: "pending" | "uploading" | "done" | "error";
    s3Url?: string;
  };
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);

  // uploadOpsPhoto mutation
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
    // Upload each immediately
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

  // ── Emoji picker state ─────────────────────────────────────────────────────
  const [showEmoji, setShowEmoji] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize composer textarea and scroll to cursor as user types
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    // Reset height first so shrinking works correctly
    el.style.height = "auto";
    // Grow to fit content, capped at 200px (≈8 lines)
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
    // Scroll the textarea itself so the cursor is always visible
    el.scrollTop = el.scrollHeight;
  }, [composer]);

  // Close emoji picker on outside clickk
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
    // Restore cursor position after state update
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + data.emoji.length, start + data.emoji.length);
    });
  }

  // ── Voice recording state ──────────────────────────────────────────────────
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

  // ── Flag Issue modal state ─────────────────────────────────────────────────
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const flagIssue = trpc.opsChat.flagIssue.useMutation({
    onSuccess: () => {
      setShowFlagModal(false);
      setFlagNote("");
      toast.success("Job flagged — moved to Needs Attention");
      utils.opsChat.listTodayJobs.invalidate();
      if (selectedJobId) utils.opsChat.getJobDetail.invalidate({ jobId: selectedJobId });
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Resolve Issue modal state ───────────────────────────────────────────────
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveSubmitting, setResolveSubmitting] = useState(false);
  // Quote-reply state for job thread
  const [jobReplyTo, setJobReplyTo] = useState<{ id: number; body: string; author: string } | null>(null);
  const resolveIssue = trpc.opsChat.resolveIssue.useMutation({
    onSuccess: () => {
      setShowResolveModal(false);
      setResolveNote("");
      toast.success("Issue resolved — job returned to normal queue");
      utils.opsChat.listTodayJobs.invalidate();
      if (selectedJobId) utils.opsChat.getJobDetail.invalidate({ jobId: selectedJobId });
    },
    onError: (e) => toast.error(e.message),
  });

  // Profile photo state
  const [profilePhotoOpen, setProfilePhotoOpen] = useState(false);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [agentStatusOpen, setAgentStatusOpen] = useState(false);
  // DM panels: list of open DM recipients (name + email key + photoUrl)
  const [openDms, setOpenDms] = useState<Array<{ name: string; key: string; photoUrl: string | null }>>([]); 
  const openDm = (name: string, key: string, photoUrl: string | null) => {
    setOpenDms((prev) => {
      if (prev.some((d) => d.key === key)) return prev; // already open
      return [...prev, { name, key, photoUrl }];
    });
  };
  const closeDm = (key: string) => setOpenDms((prev) => prev.filter((d) => d.key !== key));

   // Load my profile photo on mount (only when authenticated)
  const { data: myProfile } = trpc.opsChat.getMyProfile.useQuery(undefined, {
    enabled: Boolean(user) || Boolean(agentMe),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  // Sync server photo into local state (only if user hasn't just uploaded a new one)
  useEffect(() => {
    if (myProfile?.photoUrl && !profilePhotoUrl) {
      setProfilePhotoUrl(myProfile.photoUrl);
    }
  }, [myProfile?.photoUrl]);
  // Resolved caller name — use myProfile.name (from DB) as the authoritative name
  // because messages are stored with the DB name (e.g. "Rohan G"), not the OAuth name (e.g. "Rohan Gilkes").
  // Fall back to agentMe.name, then user.name, then "Office".
  const callerName = myProfile?.name ?? agentMe?.name ?? user?.name ?? "Office";
  // All possible names this user may have — covers the race where myProfile hasn't loaded yet
  // but messages are already rendered (OAuth name vs DB name mismatch).
  const myNames = useMemo(() => {
    const s = new Set<string>();
    if (myProfile?.name) s.add(myProfile.name);
    if (agentMe?.name) s.add(agentMe.name);
    if (user?.name) s.add(user.name);
    return s;
  }, [myProfile?.name, agentMe?.name, user?.name]);
  // Agent status list — always polled every 60s so data is ready when panel opens
  // Stable DM key: use email from myProfile (owner) or agentMe (agent).
  // agentMe uses publicProcedure so it always resolves even before opsChatProcedure auth.
  // myProfile returns email for both owner and agents.
  const myDmKey = (myProfile as any)?.email ?? agentMe?.email ?? callerName;

  const { data: agentStatusData } = trpc.opsChat.getAgentStatusList.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: Boolean(user) || Boolean(agentMe),
    retry: false,
    staleTime: 30_000,
  });
  // Load all agent photo URLs for message bubble avatars
  const { data: agentPhotoData } = trpc.opsChat.getAllAgentPhotoMap.useQuery(undefined, {
    enabled: Boolean(user) || Boolean(agentMe),
    staleTime: 2 * 60 * 1000,
    retry: false,
  });
  // senderPhotoMap: name -> photoUrl (null = use colored initial)
  const senderPhotoMap: Record<string, string | null> = useMemo(() => {
    const base = agentPhotoData?.photos ?? {};
    // Always include own photo (may have just been uploaded)
    if (callerName && profilePhotoUrl) return { ...base, [callerName]: profilePhotoUrl };
    return base;
  }, [agentPhotoData?.photos, callerName, profilePhotoUrl]);

  // -- Notification sound + OS notification --
  const { playSound: playNotification, muted: notifMuted, toggleMute } = useNotificationSound();
  const { notify: osNotify, permission: notifPermission, requestPermission: requestOsPermission } = useOsNotification();
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false);
  // -1 sentinel: means "not yet initialized" — prevents spurious sound on first load
  const prevJobMsgCountRef = useRef(-1);
  const prevChannelMsgCountRef = useRef(-1);
  const prevChannelRef = useRef("");

  // -- DM unread counts + sound notification --
  const prevDmUnreadRef = useRef<Record<string, number>>({});
  const { data: dmUnreadData } = trpc.opsChat.getDmUnreadCounts.useQuery(
    { myName: callerName, myKey: myDmKey.includes("@") ? myDmKey : undefined },
    { enabled: Boolean(callerName && callerName !== "Office"), refetchInterval: 5_000 }
  );
  const dmUnreadMap: Record<string, number> = dmUnreadData?.unread ?? {};
  const totalDmUnread = Object.values(dmUnreadMap).reduce((a, b) => a + b, 0);

  // Play sound when any DM thread gets new unread messages (panel not open)
  useEffect(() => {
    const prev = prevDmUnreadRef.current;
    const curr = dmUnreadMap;
    const openDmNames = new Set(openDms.map((d) => d.name.toLowerCase().replace(/\s+/g, "-")));
    for (const [thread, count] of Object.entries(curr)) {
      const prevCount = prev[thread] ?? 0;
      if (count > prevCount) {
        // Only play if the DM panel for this thread is NOT open
        const parts = thread.split("::");
        const otherSlug = parts.find((p) => !openDmNames.has(p));
        if (otherSlug) {
          playNotification();
          osNotify({
            title: "New Direct Message",
            body: "You have an unread DM",
            tag: `leadflow-dm-${thread}`,
          });
          break; // one chime per poll cycle
        }
      }
    }
    prevDmUnreadRef.current = { ...curr };
  }, [JSON.stringify(dmUnreadMap), openDms, playNotification]);

  // Request OS notification permission on first user interaction
  useEffect(() => {
    const unlock = () => {
      requestOsPermission();
      document.removeEventListener("click", unlock, true);
    };
    document.addEventListener("click", unlock, true);
    return () => document.removeEventListener("click", unlock, true);
  }, [requestOsPermission]);

  // ── Typing indicator (keyed to selected job thread) ─────────────────────────
  const jobChannelKey = selectedJobId ? `job:${selectedJobId}` : "";
  const { typers: jobTypers, onKeyPress: onJobKeyPress, onBlur: onJobBlur } = useTypingIndicator(jobChannelKey);

  // Auth is still loading
  const authLoading = ownerLoading || agentLoading;

  // Neither owner nor agent is logged in
  const isAuthenticated = Boolean(user) || Boolean(agentMe);

  const scrollTimeline = (dir: "left" | "right") => {
    const el = timelineScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? 240 : -240, behavior: "smooth" });
  };

  const utils = trpc.useUtils();

  // ── Data queries ────────────────────────────────────────────────────────────
  const { data: jobs = [], isLoading: jobsLoading } = trpc.opsChat.listTodayJobs.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });

  const { data: jobDetail, isLoading: detailLoading } = trpc.opsChat.getJobDetail.useQuery(
    { jobId: selectedJobId! },
    { enabled: isAuthenticated && selectedJobId !== null, refetchInterval: 15_000 }
  );

  const { data: channelMsgs = [], isLoading: channelLoading } = trpc.opsChat.listChannelMessages.useQuery(
    { channel: activeChannel },
    { enabled: isAuthenticated && activeTab === "channels", refetchInterval: 15_000 }
  );

  const { data: channelCounts } = trpc.opsChat.getChannelCounts.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });

  // Unread counts (per-caller, for badge)
  const { data: unreadCounts, refetch: refetchUnread } = trpc.opsChat.getUnreadCounts.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });

  // markRead mutation — called when opening a channel or job thread
  const markRead = trpc.opsChat.markRead.useMutation({
    onSuccess: () => refetchUnread(),
  });

  // ── Per-message read receipts (bulk) ────────────────────────────────────────
  // Collect IDs of MY sent messages only — we only show ticks on own messages
  const myThreadMsgIds = useMemo(() => {
    return (jobDetail?.thread ?? [])
      .filter((m) => m.from === callerName)
      .map((m) => Number(m.id))
      .filter((id) => id > 0);
  }, [jobDetail?.thread, callerName]);

  const myChannelMsgIds = useMemo(() => {
    return channelMsgs
      .filter((m) => m.from === callerName)
      .map((m) => m.id)
      .filter((id) => id > 0);
  }, [channelMsgs, callerName]);

   const { data: threadSeenByBulk } = trpc.opsChat.getSeenByBulk.useQuery(
    { messageIds: myThreadMsgIds, cleanerJobId: selectedJobId ?? 0 },
    { enabled: isAuthenticated && activeTab === "today" && myThreadMsgIds.length > 0 && !!selectedJobId, refetchInterval: 10_000 }
  );
  const { data: channelSeenByBulk } = trpc.opsChat.getSeenByBulk.useQuery(
    { messageIds: myChannelMsgIds, channel: activeChannel },
    { enabled: isAuthenticated && activeTab === "channels" && myChannelMsgIds.length > 0, refetchInterval: 10_000 }
  );
  // Build seenByMap from flat reads array (server returns flat to avoid superjson depth issues)
  const activeSeenByMap = useMemo(() => {
    const bulkData = activeTab === "today" ? threadSeenByBulk : channelSeenByBulk;
    console.log('[ReadReceipts] activeTab:', activeTab, 'bulkData:', bulkData, 'myThreadMsgIds:', myThreadMsgIds.slice(0,3), 'myChannelMsgIds:', myChannelMsgIds.slice(0,3));
    const map: Record<number, string[]> = {};
    for (const entry of bulkData?.reads ?? []) {
      if (!map[entry.messageId]) map[entry.messageId] = [];
      map[entry.messageId].push(entry.callerName);
    }
    console.log('[ReadReceipts] map keys:', Object.keys(map).slice(0,5));
    return map;
  }, [activeTab, threadSeenByBulk, channelSeenByBulk, myThreadMsgIds, myChannelMsgIds]);

  // ── Sender status map ─────────────────────────────────────────────────────────
  // Derived from agentStatusList: name -> "online" | "away" | "offline"
  const senderStatusMap = useMemo(() => {
    const map: Record<string, "online" | "away" | "offline"> = {};
    const now = Date.now();
    for (const ag of agentStatusData?.agents ?? []) {
      const diffMin = ag.lastSeenAt ? Math.floor((now - ag.lastSeenAt) / 60_000) : null;
      if (diffMin === null) { map[ag.name] = "offline"; }
      else if (diffMin <= 2) { map[ag.name] = "online"; }
      else if (diffMin <= 15) { map[ag.name] = "away"; }
      else { map[ag.name] = "offline"; }
    }
    return map;
  }, [agentStatusData?.agents]);

  // ── Reactions ────────────────────────────────────────────────────────────────
  // Collect all visible message IDs for the reactions query
  const threadMsgIds = useMemo(() => (jobDetail?.thread ?? []).map(m => Number(m.id)), [jobDetail?.thread]);
  const channelMsgIds = useMemo(() => channelMsgs.map(m => m.id), [channelMsgs]);
  const activeMsgIds = activeTab === "today" ? threadMsgIds : channelMsgIds;

  const { data: reactionsData, refetch: refetchReactions } = trpc.opsChat.getReactions.useQuery(
    { messageIds: activeMsgIds },
    { enabled: isAuthenticated && activeMsgIds.length > 0, refetchInterval: 10_000 }
  );

  // Group reactions by messageId for O(1) lookup in render
  const reactionsByMsgId = useMemo(() => {
    const map: Record<number, Array<{ callerId: string; callerName: string; emoji: string }>> = {};
    for (const r of reactionsData?.reactions ?? []) {
      if (!map[r.messageId]) map[r.messageId] = [];
      map[r.messageId].push(r);
    }
    return map;
  }, [reactionsData]);

  const toggleReaction = trpc.opsChat.toggleReaction.useMutation({
    onSuccess: () => refetchReactions(),
  });

  // ── Scroll-to-original ────────────────────────────────────────────────────────
  // Map of messageId → DOM element ref for scroll-to-original
  const msgRefMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);

  function scrollToMsg(id: number) {
    const el = msgRefMap.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMsgId(id);
    setTimeout(() => setHighlightedMsgId(null), 1800);
  }

  // ── Send message mutation ───────────────────────────────────────────────────
  const sendMsg = trpc.opsChat.sendMessage.useMutation({
    onSuccess: () => {
      setComposer("");
      setSelectedQuickAction(null);
      // Clear staged photos and revoke object URLs
      setStagedPhotos(prev => { prev.forEach(p => URL.revokeObjectURL(p.previewUrl)); return []; });
      if (selectedJobId) {
        utils.opsChat.getJobDetail.invalidate({ jobId: selectedJobId });
      }
      if (activeTab === "channels") {
        utils.opsChat.listChannelMessages.invalidate({ channel: activeChannel });
      }
    },
  });

  // Auto-select first job
  useEffect(() => {
    if (!selectedJobId && jobs.length > 0) {
      setSelectedJobId(jobs[0].id);
    }
  }, [jobs, selectedJobId]);

  // Mark channel as read when switching channels or opening channel tab
  useEffect(() => {
    if (!isAuthenticated || activeTab !== "channels" || channelMsgs.length === 0) return;
    const lastId = channelMsgs[channelMsgs.length - 1]?.id;
    if (lastId) markRead.mutate({ lastMessageId: lastId, channel: activeChannel });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel, activeTab, channelMsgs.length, isAuthenticated]);

  // Mark job thread as read when opening a job
  useEffect(() => {
    if (!isAuthenticated || !selectedJobId || !jobDetail?.thread?.length) return;
    const lastId = Number(jobDetail.thread[jobDetail.thread.length - 1]?.id);
    if (lastId) markRead.mutate({ lastMessageId: lastId, cleanerJobId: selectedJobId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId, jobDetail?.thread?.length, isAuthenticated]);

  // Scroll thread to bottom on new messages — double-rAF ensures the new message
  // DOM node is fully painted before we scroll, preventing the "one message short" bug.
  const scrollToBottom = useCallback((instant = false) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = threadScrollRef.current;
        if (container) {
          container.scrollTo({ top: container.scrollHeight, behavior: instant ? "instant" : "smooth" });
        } else {
          threadBottomRef.current?.scrollIntoView({ behavior: instant ? "instant" : "smooth", block: "end" });
        }
      });
    });
  }, []);
  // Save scroll position when widget hides; restore it when widget re-opens.
  const prevOpsChatStateRef = useRef(opsChatState);
  useEffect(() => {
    const prev = prevOpsChatStateRef.current;
    const curr = opsChatState;
    prevOpsChatStateRef.current = curr;
    if (prev === "open" && curr !== "open") {
      // Widget is hiding — save current scroll position
      const container = threadScrollRef.current;
      if (container) savedScrollTopRef.current = container.scrollTop;
    } else if (prev !== "open" && curr === "open") {
      // Widget is re-opening — restore saved scroll position
      const saved = savedScrollTopRef.current;
      if (saved !== null) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const container = threadScrollRef.current;
            if (container) container.scrollTop = saved;
          });
        });
      }
    }
  }, [opsChatState]);
  // Track whether we've done the initial scroll for the current view.
  // On first load/re-entry: jump instantly. On subsequent new messages: smooth scroll.
  const initialScrollDoneRef = useRef(false);
  const prevScrollKeyRef = useRef("");
  useEffect(() => {
    // Build a key that changes when the user switches views (job vs channel)
    const key = selectedJobId ? `job-${selectedJobId}` : `channel-${activeChannel}`;
    const isNewView = prevScrollKeyRef.current !== key;
    if (isNewView) {
      prevScrollKeyRef.current = key;
      initialScrollDoneRef.current = false;
    }
    if (!initialScrollDoneRef.current) {
      // Only jump to bottom on first load if we don't have a saved position to restore
      if (savedScrollTopRef.current === null) {
        scrollToBottom(true);
      }
      initialScrollDoneRef.current = true;
    } else {
      scrollToBottom(false); // smooth for new messages
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobDetail?.thread?.length, channelMsgs.length, selectedJobId, activeChannel]);

  // Play notification sound when new job thread messages arrive from others.
  // Use .length as the dep (not the array object) so we only fire when count changes,
  // not on every 15-second refetch that returns a new array reference.
  const jobThreadLength = jobDetail?.thread?.length ?? 0;
  useEffect(() => {
    const thread = jobDetail?.thread ?? [];
    const curr = thread.length;
    const prev = prevJobMsgCountRef.current;
    if (prev === -1) {
      // First load — just record count, don't fire sound
      prevJobMsgCountRef.current = curr;
      return;
    }
    if (curr > prev) {
      const newest = thread[thread.length - 1];
      // Use myNames set to handle OAuth name vs DB name mismatch
      if (newest && !myNames.has(newest.from)) {
        // Always attempt to play — AudioContext.resume() handles suspended state
        playNotification();
        const jobName = jobs.find((j) => j.id === selectedJobId)?.title ?? "Job Thread";
        osNotify({
          title: `${jobName} — ${newest.from}`,
          body: newest.body?.slice(0, 100) ?? "New message",
          tag: `leadflow-job-${selectedJobId}`,
        });
      }
    }
    prevJobMsgCountRef.current = curr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobThreadLength, selectedJobId]);

  // Play notification sound when new command/channel messages arrive from others.
  const channelMsgLength = channelMsgs.length;
  useEffect(() => {
    const curr = channelMsgLength;
    const prev = prevChannelMsgCountRef.current;
    // Reset counter when user switches channels (or on first load)
    if (prevChannelRef.current !== activeChannel || prev === -1) {
      prevChannelRef.current = activeChannel;
      prevChannelMsgCountRef.current = curr;
      return;
    }
    if (curr > prev) {
      const newest = channelMsgs[channelMsgs.length - 1];
      if (newest && !myNames.has(newest.from)) {
        // Always attempt to play — AudioContext.resume() handles suspended state
        playNotification();
        osNotify({
          title: `#${activeChannel} — ${newest.from}`,
          body: newest.body?.slice(0, 100) ?? "New message",
          tag: `leadflow-channel-${activeChannel}`,
        });
      }
    }
    prevChannelMsgCountRef.current = curr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelMsgLength, activeChannel]);
  // Listen for PLAY_SOUND messages from the Service Worker.
  // When the tab is in the background, the SW shows the OS notification banner
  // and posts PLAY_SOUND back to all open page clients. The page receives this
  // message even when hidden; AudioContext.resume() will unblock it when the
  // user returns to the tab.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "PLAY_SOUND") {
        playNotification();
      }
    };
    navigator.serviceWorker.addEventListener("message", handleSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleSwMessage);
  }, [playNotification]);

  // ── Derived data ────────────────────────────────────────────────────────────
  const grouped = {
    issue:    jobs.filter((j) => j.status === "issue"),
    soon:     jobs.filter((j) => j.status === "soon"),
    progress: jobs.filter((j) => j.status === "progress"),
    complete: jobs.filter((j) => j.status === "complete"),
  };

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;

  function handleSend() {
    const hasText = composer.trim().length > 0;
    const donePhotos = stagedPhotos.filter(p => p.status === "done" && p.s3Url);
    const uploadingPhotos = stagedPhotos.filter(p => p.status === "uploading" || p.status === "pending");
    if (!hasText && donePhotos.length === 0) return;
    if (uploadingPhotos.length > 0) {
      toast.error("Please wait for photos to finish uploading");
      return;
    }
    const mediaUrl = donePhotos.length > 0
      ? JSON.stringify(donePhotos.map(p => p.s3Url!))
      : undefined;
    const body = composer.trim() || (donePhotos.length > 0 ? "Photo" : "");
    if (activeTab === "today" && selectedJobId) {
      sendMsg.mutate({
        cleanerJobId: selectedJobId,
        body,
        authorName: callerName,
        authorRole: "office",
        quickAction: selectedQuickAction ?? undefined,
        mediaUrl,
        replyToId: jobReplyTo?.id,
        replyToBody: jobReplyTo?.body,
        replyToAuthor: jobReplyTo?.author,
      });
      setJobReplyTo(null);
    } else if (activeTab === "channels") {
      sendMsg.mutate({
        channel: activeChannel,
        body,
        authorName: callerName,
        authorRole: "office",
        mediaUrl,
      });
    }
  }

  function handleQuickAction(qa: typeof QUICK_ACTIONS[number]) {
    if (qa.key === "Issue") {
      // Issue chip opens the Flag modal directly
      setShowFlagModal(true);
      return;
    }
    setSelectedQuickAction(qa.key);
    setComposer(qa.template);
  }

  // ── Auth gate ───────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AgentLoginGate onSuccess={() => refetchAgentMe()} />;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden">
      {/* ── Notification permission banner ── */}
      {!notifBannerDismissed && notifPermission !== "granted" && notifPermission !== "denied" && notifPermission !== "unsupported" && isAuthenticated && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 shrink-0">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <span className="text-base">🔔</span>
            <span><strong>Enable notifications</strong> to get background alerts when new messages arrive.</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => requestOsPermission()}
              className="text-xs font-semibold px-3 py-1 rounded-full bg-amber-600 text-white hover:bg-amber-700 transition"
            >
              Enable
            </button>
            <button
              onClick={() => setNotifBannerDismissed(true)}
              className="text-xs text-amber-600 hover:text-amber-800 transition"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── Reminder popup (fires when a due reminder is detected) ── */}
      <ReminderPopup />
      {/* ── LEFT SIDEBAR ──────────────────────────────────────────────────────────────── */}
      {sidebarCollapsed ? (
        /* Slim icon rail when collapsed */
        <div className="w-14 shrink-0 h-full border-r border-slate-200 bg-white flex flex-col items-center py-3 gap-3 overflow-visible transition-all">
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition"
            title="Expand sidebar"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {/* Channel icons */}
          {CHANNELS.map((ch) => {
            const count = channelCounts ? (channelCounts as Record<string, number>)[ch.key] ?? 0 : 0;
            return (
              <button
                key={ch.key}
                onClick={() => { handleSetActiveTab("channels"); handleSetActiveChannel(ch.key); }}
                className={cn(
                  "relative w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold transition",
                  activeChannel === ch.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
                title={ch.label}
              >
                {ch.label.charAt(0)}
                {count > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">
                    {count > 9 ? "9+" : count}
                  </span>
                )}
              </button>
            );
          })}
          {/* Today ops icon */}
          <button
            onClick={() => { handleSetActiveTab("today"); }}
            className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold transition",
              activeTab === "today" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
            title="Today Ops"
          >
            <CalendarDays className="w-4 h-4" />
          </button>
          {/* Agent status icon */}
          <div className="relative">
            <button
              onClick={() => setAgentStatusOpen(v => !v)}
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center transition",
                agentStatusOpen ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
              title="Agent status"
            >
              <Users className="w-4 h-4" />
            </button>
            {/* DM unread badge */}
            {totalDmUnread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center pointer-events-none">
                {totalDmUnread > 9 ? "9+" : totalDmUnread}
              </span>
            )}
            {/* Agent status popover */}
            {agentStatusOpen && (
              <>
              {/* Backdrop — click outside to close */}
              <div className="fixed inset-0 z-40" onClick={() => setAgentStatusOpen(false)} />
              <div className="absolute left-12 bottom-0 z-50 w-72 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">Agent Status</p>
                  <button onClick={() => setAgentStatusOpen(false)} className="text-slate-400 hover:text-slate-700">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
                  {!agentStatusData ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-400">Loading...</div>
                  ) : agentStatusData.agents.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-400">No agents found</div>
                  ) : agentStatusData.agents.map((ag) => {
                    const now = Date.now();
                    const seenMs = ag.lastSeenAt;
                    const diffMin = seenMs ? Math.floor((now - seenMs) / 60_000) : null;
                    const agStatus: "online" | "away" | "offline" =
                      diffMin === null ? "offline"
                      : diffMin <= 2 ? "online"
                      : diffMin <= 15 ? "away"
                      : "offline";
                    const statusLabel = seenMs === null || diffMin === null ? "Never logged in" :
                      diffMin === 0 ? "Active now" :
                      diffMin < 60 ? `${diffMin}m ago` :
                      diffMin < 1440 ? `${Math.floor(diffMin / 60)}h ago` :
                      new Date(seenMs).toLocaleDateString();
                    const dotColor = agStatus === "online" ? "bg-green-500" : agStatus === "away" ? "bg-amber-400" : "bg-slate-300";
                    return (
                      <div key={ag.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="relative shrink-0">
                          {ag.photoUrl ? (
                            <img src={ag.photoUrl} alt={ag.name} className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                              style={{ backgroundColor: senderHex(ag.name) }}
                            >
                              {ag.name[0].toUpperCase()}
                            </div>
                          )}
                          <span
                            className={cn("absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white", dotColor)}
                            title={agStatus === "online" ? "Online" : agStatus === "away" ? "Away (active <15m)" : "Offline"}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{ag.name}</p>
                          <p className={cn("text-xs truncate",
                            agStatus === "online" ? "text-green-600 font-medium" :
                            agStatus === "away" ? "text-amber-500" :
                            "text-slate-400"
                          )}>{agStatus === "online" ? "Online" : agStatus === "away" ? `Away • ${statusLabel}` : statusLabel}</p>
                        </div>
                        {/* DM button with per-agent unread badge */}
                        {(() => {
                          // Build the canonical thread key for this agent pair
                          const agEmail = ag.email ?? "";
                          const threadKey = agEmail && myDmKey.includes("@")
                            ? [myDmKey, agEmail].sort().join("::")
                            : "";
                          const agentUnread = threadKey ? (dmUnreadMap[threadKey] ?? 0) : 0;
                          return (
                            <button
                              onClick={() => { openDm(ag.name, ag.email ?? ag.name, ag.photoUrl); setAgentStatusOpen(false); }}
                              className="relative ml-1 p-1 rounded-full hover:bg-blue-50 text-blue-500 hover:text-blue-700 transition-colors"
                              title={agentUnread > 0 ? `${agentUnread} unread DM${agentUnread > 1 ? "s" : ""} from ${ag.name}` : `DM ${ag.name}`}
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              {agentUnread > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                                  {agentUnread > 9 ? "9+" : agentUnread}
                                </span>
                              )}
                            </button>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
              </>
            )}
          </div>
          {/* ── Page navigation shortcuts ── */}
          <div className="mt-auto flex flex-col items-center gap-2 pb-1">
            <div className="w-7 h-px bg-slate-200 mb-1" />
            <a
              href="/admin/leads"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition"
              title="Leads / Admin Dashboard"
            >
              <LayoutDashboard className="w-4 h-4" />
            </a>
            <a
              href="/admin/command-center"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition"
              title="Control Tower"
            >
              <Radio className="w-4 h-4" />
            </a>
            <a
              href="/admin/field-management"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition"
              title="Field Mgmt Day Board"
            >
              <ClipboardList className="w-4 h-4" />
            </a>
            <a
              href="/agent"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition"
              title="Agent Workspace"
            >
              <UserCircle className="w-4 h-4" />
            </a>
          </div>
          {/* Profile photo avatar — always visible even when collapsed */}
          <div className="pb-1">
            <button
              onClick={() => setProfilePhotoOpen(true)}
              className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-white shadow hover:ring-slate-300 transition"
              title={`${callerName} — edit profile photo`}
            >
              {profilePhotoUrl ? (
                <img src={profilePhotoUrl} alt={callerName} className="w-full h-full object-cover" />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ backgroundColor: senderHex(callerName) }}
                >
                  {(callerName ?? "?")[0].toUpperCase()}
                </div>
              )}
            </button>
          </div>
        </div>
      ) : (
      <div className="w-[300px] shrink-0 h-full border-r border-slate-200 bg-white flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">In-App Ops Chat</p>
              <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Today</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
                title="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 shadow-sm font-medium">
                {jobs.length} online
              </div>
              <button
                onClick={minimizeOpsChat}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 text-xs font-medium transition"
                title="Minimize OpsChat"
                aria-label="Minimize OpsChat"
              >
                <Minus className="w-3.5 h-3.5" />
                Minimize
              </button>
            </div>
          </div>

          {/* Tab toggle */}
          <div className="flex rounded-2xl border border-slate-200 bg-slate-100 p-1">
            {(["today", "channels"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => handleSetActiveTab(tab as "today" | "channels")}
                className={cn(
                  "flex-1 rounded-xl px-3 py-2 text-sm font-medium transition",
                  activeTab === tab ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"
                )}
              >
                {tab === "today" ? "Today Ops" : "Channels"}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {activeTab === "today" ? (
            <div className="px-3 pb-4 space-y-4">
              {/* Priority Queue */}
              <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-sm font-bold text-slate-900">Priority Queue</span>
                  {activeFilter ? (
                    <button
                      onClick={() => setActiveFilter(null)}
                      className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2 transition"
                    >Clear filter</button>
                  ) : (
                    <span className="text-xs text-slate-400 italic">Tap to filter</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {([
                    { key: "issue" as PriorityStatus,    emoji: "🔥", label: "Needs attention", count: grouped.issue.length,    active: "bg-red-600",     inactive: "bg-red-50",     text: "text-red-600" },
                    { key: "soon" as PriorityStatus,     emoji: "⏰", label: "Starting soon",  count: grouped.soon.length,     active: "bg-amber-500",   inactive: "bg-amber-50",   text: "text-amber-600" },
                    { key: "progress" as PriorityStatus, emoji: "🟡", label: "In progress",    count: grouped.progress.length, active: "bg-blue-600",    inactive: "bg-blue-50",    text: "text-blue-600" },
                    { key: "complete" as PriorityStatus, emoji: "✅", label: "Completed",       count: grouped.complete.length, active: "bg-emerald-600", inactive: "bg-emerald-50", text: "text-emerald-600" },
                  ]).map(({ key, emoji, label, count, active, inactive, text }) => {
                    const isActive = activeFilter === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setActiveFilter(isActive ? null : key)}
                        className={cn(
                          "w-full flex items-center justify-between rounded-xl px-3 py-2.5 transition-all hover:opacity-90 active:scale-[0.98]",
                          isActive ? `${active} shadow-sm` : inactive
                        )}
                      >
                        <span className={cn("text-sm font-medium", isActive ? "text-white" : text)}>{emoji} {label}</span>
                        <span className={cn("text-sm font-bold", isActive ? "text-white" : text)}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Conversations */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1 mb-2">Conversations</p>
                <div className="space-y-1">
                  {CHANNELS.map((ch) => {
                    const count = channelCounts ? (channelCounts as Record<string, number>)[ch.key] ?? 0 : 0;
                    const isActive = activeChannel === ch.key && (activeTab as string) === "channels";
                    return (
                      <button
                        key={ch.key}
                        onClick={() => { handleSetActiveTab("channels"); handleSetActiveChannel(ch.key); }}
                        className={cn(
                          "w-full flex items-center justify-between rounded-2xl border px-4 py-3.5 text-sm transition",
                          isActive
                            ? "bg-slate-900 border-slate-900 text-white"
                            : "bg-white border-slate-200 text-slate-800 hover:border-slate-300 hover:shadow-sm"
                        )}
                      >
                        <span className="font-medium">{ch.label}</span>
                        <span className={cn("text-sm font-semibold min-w-[20px] text-right", isActive ? "text-white" : "text-slate-500")}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Jobs */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1 mb-2">Jobs</p>
                {jobsLoading ? (
                  <div className="text-sm text-slate-400 text-center py-8">Loading jobs…</div>
                ) : jobs.length === 0 ? (
                  <div className="text-sm text-slate-400 text-center py-8">No jobs today</div>
                ) : (
                  <div className="space-y-2">
                    {(activeFilter
                      ? jobs.filter(j => j.status === activeFilter)
                      : [...grouped.issue, ...grouped.soon, ...grouped.progress, ...grouped.complete, ...jobs.filter(j => j.status === "assigned")]
                    ).map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        selected={selectedJobId === job.id}
                        onClick={() => { setSelectedJobId(job.id); handleSetActiveTab("today"); }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Channels tab */
            <div className="px-3 pb-4 pt-1 space-y-1">
              {CHANNELS.map((ch) => {
                const count = channelCounts ? (channelCounts as Record<string, number>)[ch.key] ?? 0 : 0;
                return (
                  <button
                    key={ch.key}
                    onClick={() => handleSetActiveChannel(ch.key)}
                    className={cn(
                      "w-full flex items-center justify-between rounded-2xl border px-4 py-3.5 text-sm transition",
                      activeChannel === ch.key
                        ? "bg-slate-900 border-slate-900 text-white"
                        : "bg-white border-slate-200 text-slate-800 hover:border-slate-300 hover:shadow-sm"
                    )}
                  >
                    <span className="font-medium">{ch.label}</span>
                    <span className={cn("text-sm font-semibold min-w-[20px] text-right", activeChannel === ch.key ? "text-white" : "text-slate-500")}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Signed-in-as footer with profile photo */}
        <button
          onClick={() => setProfilePhotoOpen(true)}
          className="px-4 py-3 border-t border-slate-100 bg-white flex items-center gap-2.5 hover:bg-slate-50 transition w-full text-left"
          title="View/edit profile photo"
        >
          {profilePhotoUrl ? (
            <img
              src={profilePhotoUrl}
              alt={callerName}
              className="w-7 h-7 rounded-full object-cover ring-2 ring-white shadow-sm shrink-0"
            />
          ) : (
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
              style={{ backgroundColor: senderHex(callerName) }}
            >
              {(callerName ?? "?")[0].toUpperCase()}
            </div>
          )}
          <p className="text-xs text-slate-400 truncate">
            <span className="font-medium text-slate-600">{callerName}</span>
          </p>
        </button>
      </div>
      )} {/* end sidebarCollapsed ternary */}

      {/* ── CENTER PANEL ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "today" && selectedJob ? (
          <>
            {/* Center header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold text-slate-900">{selectedJob.title}</h2>
                  <StatusBadge status={selectedJob.status} />
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {selectedJob.client}
                  {selectedJob.time ? ` • ${selectedJob.time}` : ""}
                  {selectedJob.team ? ` • ${selectedJob.team}` : ""}
                </p>
                <p className="text-sm text-slate-500">{selectedJob.address}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Sound mute toggle */}
                <button
                  onClick={toggleMute}
                  title={notifMuted ? "Notifications muted — click to unmute" : "Notifications on — click to mute"}
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition",
                    notifMuted ? "bg-red-100 text-red-500 hover:bg-red-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  )}
                >
                  {notifMuted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                </button>
                {jobDetail?.job.cleanerPhone && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={`tel:${jobDetail.job.cleanerPhone}`}>
                      <Phone className="h-4 w-4 mr-1.5" />
                      Call Cleaner
                    </a>
                  </Button>
                )}
                <Button size="sm" className="bg-slate-900 text-white hover:bg-slate-800" asChild>
                  <a href={`/admin/field-management`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1.5" />
                    Open Full Job
                  </a>
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              {detailLoading ? (
                <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
              ) : jobDetail ? (
                <>
                  {/* Live Activity Timeline — horizontal with arrow navigation */}
                  <div className="px-6 pt-4 pb-3 border-b border-slate-100 bg-white">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Live Activity Timeline</p>
                    {jobDetail.timeline.length === 0 ? (
                      <p className="text-sm text-slate-400">No activity yet</p>
                    ) : (
                      <div className="relative flex items-center gap-1">
                        <button
                          onClick={() => scrollTimeline("left")}
                          className="shrink-0 h-7 w-7 rounded-full border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-slate-800 transition shadow-sm"
                          aria-label="Scroll left"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <div
                          ref={timelineScrollRef}
                          className="flex items-center gap-2 overflow-x-auto flex-1"
                          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                        >
                          {jobDetail.timeline.map((ev) => <TimelineEvent key={ev.id} event={ev} />)}
                        </div>
                        <button
                          onClick={() => scrollTimeline("right")}
                          className="shrink-0 h-7 w-7 rounded-full border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-slate-800 transition shadow-sm"
                          aria-label="Scroll right"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Thread */}
                  <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Thread</p>
                      {jobDetail.thread.some(m => m.role === "cleaner" || m.role === "client") && (
                        <span className="text-xs font-semibold text-red-600">Requires response</span>
                      )}
                    </div>
                    <div ref={threadScrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-4 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                      <div className="space-y-4">
                        {jobDetail.thread.length === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-8">No messages yet — start the thread below.</p>
                        ) : (
                          jobDetail.thread.map((msg, idx) => {
                            const isLast = idx === jobDetail.thread.length - 1;
                            const isMine = myNames.has(msg.from);
                            const msgId = Number(msg.id);
                            return (
                              <div
                                key={msg.id}
                                ref={(el) => { if (el) msgRefMap.current.set(msgId, el); else msgRefMap.current.delete(msgId); }}
                                className={cn(
                                  "rounded-xl transition-colors duration-700",
                                  highlightedMsgId === msgId ? "bg-amber-100" : ""
                                )}
                              >
                                <ThreadMessage
                                  msg={msg}
                                  callerName={callerName}
                                  isMine={isMine}
                                  seenBy={isMine ? (activeSeenByMap[msgId] ?? []) : undefined}
                                  onReply={(m) => setJobReplyTo(m)}
                                  onScrollToMsg={scrollToMsg}
                                  reactions={reactionsByMsgId[msgId]}
                                  onReact={(id, emoji) => toggleReaction.mutate({ messageId: id, emoji })}
                                  senderPhotoMap={senderPhotoMap}
                                  senderStatusMap={senderStatusMap}
                                />
                              </div>
                            );
                          })
                        )}
                        <div ref={threadBottomRef} />
                      </div>
                    </div>
                  </div>

                  {/* Quick actions + Composer */}
                  <div className="px-6 py-3 border-t border-slate-100 bg-white">
                    {/* Reply preview bar */}
                    {jobReplyTo && (
                      <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="w-0.5 h-8 rounded-full shrink-0" style={{ backgroundColor: senderHex(jobReplyTo.author) }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-semibold text-slate-500 mb-0.5">{jobReplyTo.author}</p>
                          <p className="text-xs text-slate-600 truncate">{jobReplyTo.body}</p>
                        </div>
                        <button
                          onClick={() => setJobReplyTo(null)}
                          className="shrink-0 rounded-full p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
                        >
                          <X className="h-3.5 w-3.5" />
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

                    <div className="flex flex-wrap gap-2 mb-3">
                      {QUICK_ACTIONS.map((qa) => (
                        <button
                          key={qa.key}
                          onClick={() => handleQuickAction(qa)}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-sm font-medium transition",
                            selectedQuickAction === qa.key
                              ? "bg-slate-900 text-white border-slate-900"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                          )}
                        >
                          {qa.label}
                        </button>
                      ))}
                    </div>

                    {/* Staged photo preview strip */}
                    {stagedPhotos.length > 0 && (
                      <div className="flex gap-2 mb-3 flex-wrap">
                        {stagedPhotos.map((p) => (
                          <div key={p.id} className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-200 shrink-0">
                            <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                            {/* Upload progress overlay */}
                            {(p.status === "uploading" || p.status === "pending") && (
                              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                <Loader2 className="h-4 w-4 text-white animate-spin" />
                              </div>
                            )}
                            {p.status === "error" && (
                              <div className="absolute inset-0 bg-red-900/60 flex items-center justify-center">
                                <span className="text-white text-[10px] font-bold">ERR</span>
                              </div>
                            )}
                            {/* Remove button */}
                            <button
                              className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 transition"
                              onClick={() => removeStagedPhoto(p.id)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        {/* Add more */}
                        <button
                          className="w-16 h-16 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 hover:border-slate-400 hover:text-slate-600 transition shrink-0"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <ImageIcon className="h-5 w-5" />
                        </button>
                      </div>
                    )}

                    {/* Typing indicator */}
                    <TypingBubble typers={jobTypers} />

                    {/* Drag-drop composer box */}
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
                        className="resize-none border-0 bg-transparent p-0 text-sm text-slate-700 focus-visible:ring-0 placeholder:text-slate-400 min-h-[72px] overflow-y-auto"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); return; }
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { handleSend(); return; }
                          onJobKeyPress();
                        }}
                        onBlur={onJobBlur}
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
                          onClick={handleSend}
                          disabled={(!composer.trim() && stagedPhotos.filter(p => p.status === "done").length === 0) || sendMsg.isPending}
                          className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl px-4"
                          size="sm"
                        >
                          <Send className="h-4 w-4 mr-1.5" />
                          Send
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Job not found</div>
              )}
            </div>
          </>
        ) : activeTab === "channels" && activeChannel === "command" ? (
          /* MIB Command Chat — special 3-column ops view */
          <CommandChat
            channelMsgs={channelMsgs.map(m => ({ id: m.id, from: m.from, role: m.role, body: m.body, mediaUrl: m.mediaUrl, quickAction: m.quickAction, metadata: m.metadata ?? null, replyToId: m.replyToId ?? null, replyToBody: m.replyToBody ?? null, replyToAuthor: m.replyToAuthor ?? null, createdAt: new Date(m.ts) }))}
            channelLoading={channelLoading}
            callerName={callerName}
            onSendMessage={(body, mediaUrl, replyTo) => {
              sendMsg.mutate({
                body,
                channel: "command",
                authorName: callerName,
                mediaUrl,
                replyToId: replyTo?.id,
                replyToBody: replyTo?.body,
                replyToAuthor: replyTo?.author,
              });
            }}
            onJumpToJob={(jobId) => {
              handleSetActiveTab("today");
              setSelectedJobId(jobId);
            }}
            onSwitchToToday={() => handleSetActiveTab("today")}
          />
        ) : activeTab === "channels" ? (
          /* Regular channel view */
          <>
            <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {CHANNELS.find(c => c.key === activeChannel)?.label ?? activeChannel}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">Internal team channel</p>
              </div>
              {/* Sound mute toggle */}
              <button
                onClick={toggleMute}
                title={notifMuted ? "Notifications muted — click to unmute" : "Notifications on — click to mute"}
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center transition",
                  notifMuted ? "bg-red-100 text-red-500 hover:bg-red-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                )}
              >
                {notifMuted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
              </button>
            </div>
            <div ref={threadScrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-4 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              <div className="space-y-4">
                {channelLoading ? (
                  <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
                ) : channelMsgs.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No messages in this channel yet.</p>
                ) : (
                  channelMsgs.map((msg, idx) => {
                    const isLast = idx === channelMsgs.length - 1;
                    const isMine = myNames.has(msg.from);
                    const msgId = msg.id;
                    return (
                      <div
                        key={msg.id}
                        ref={(el) => { if (el) msgRefMap.current.set(msgId, el); else msgRefMap.current.delete(msgId); }}
                        className={cn(
                          "rounded-xl transition-colors duration-700",
                          highlightedMsgId === msgId ? "bg-amber-100" : ""
                        )}
                      >
                        <ThreadMessage
                          msg={{ ...msg, id: String(msg.id), source: "ops" }}
                          callerName={callerName}
                          isMine={isMine}
                          seenBy={isMine ? (activeSeenByMap[msgId] ?? []) : undefined}
                          onScrollToMsg={scrollToMsg}
                          reactions={reactionsByMsgId[msgId]}
                          onReact={(id, emoji) => toggleReaction.mutate({ messageId: id, emoji })}
                          senderStatusMap={senderStatusMap}
                        />
                      </div>
                    );
                  })
                )}
                <div ref={threadBottomRef} />
              </div>
            </div>
            <div className="px-6 py-3 border-t border-slate-100 bg-white">
              {/* Staged photo preview strip */}
              {stagedPhotos.length > 0 && (
                <div className="flex gap-2 mb-3 flex-wrap">
                  {stagedPhotos.map((p) => (
                    <div key={p.id} className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-200 shrink-0">
                      <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                      {(p.status === "uploading" || p.status === "pending") && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <Loader2 className="h-4 w-4 text-white animate-spin" />
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
                  placeholder={isDragging ? "Drop photos here…" : isTranscribing ? "Transcribing voice note…" : `Message ${CHANNELS.find(c => c.key === activeChannel)?.label ?? activeChannel}…`}
                  className="resize-none border-0 bg-transparent p-0 text-sm text-slate-700 focus-visible:ring-0 placeholder:text-slate-400 min-h-[72px] overflow-y-auto"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); return; }
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
                  }}
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
                    onClick={handleSend}
                    disabled={(!composer.trim() && stagedPhotos.filter(p => p.status === "done").length === 0) || sendMsg.isPending}
                    className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl px-4"
                    size="sm"
                  >
                    <Send className="h-4 w-4 mr-1.5" />
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            Select a job from the left panel
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL (Job Details + Actions) ──────────────────────────── */}
      {activeTab === "today" && jobDetail && (
        <div className="w-[300px] shrink-0 border-l border-slate-200 bg-slate-50 overflow-y-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <div className="p-4 space-y-3">

            {/* 1. Flag / Resolve card — always pinned at top */}
            {jobDetail.job.flagged ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-red-700 uppercase tracking-wide">Needs Attention</p>
                    {jobDetail.job.openFlagNote && (
                      <p className="text-xs text-red-600 mt-0.5 leading-snug">{jobDetail.job.openFlagNote}</p>
                    )}
                    {jobDetail.job.openFlaggedBy && (
                      <p className="text-[10px] text-red-400 mt-0.5">Flagged by {jobDetail.job.openFlaggedBy}</p>
                    )}
                  </div>
                </div>
                <Button
                  className="w-full h-8 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-semibold"
                  onClick={() => setShowResolveModal(true)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Resolve Issue
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full h-10 rounded-2xl text-sm font-medium border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition"
                onClick={() => setShowFlagModal(true)}
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Flag as Needs Attention
              </Button>
            )}

            {/* 2. Job Details card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">Job Details</p>

              <div className="mb-4">
                <p className="text-xs text-slate-400 mb-0.5">Client</p>
                <p className="text-base font-bold text-slate-900">{jobDetail.job.client}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Service</p>
                  <p className="text-sm font-semibold text-slate-900 leading-snug">{jobDetail.job.serviceType || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Price</p>
                  <p className="text-sm font-semibold text-slate-900">{jobDetail.job.price || "—"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Window</p>
                  <p className="text-sm font-semibold text-slate-900">{jobDetail.job.time || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Team</p>
                  <p className="text-sm font-semibold text-slate-900">{jobDetail.job.teamName ?? jobDetail.job.cleanerName}</p>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-xs text-slate-400 mb-0.5">Address</p>
                <p className="text-sm font-semibold text-slate-900">{jobDetail.job.address}</p>
              </div>

              {(jobDetail.job.customerNotes || jobDetail.job.staffNotes) && (
                <div>
                  <p className="text-xs text-slate-400 mb-1.5">Notes</p>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {jobDetail.job.customerNotes ?? jobDetail.job.staffNotes}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 3. Actions card — at bottom */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">Actions</p>
              <div className="grid grid-cols-2 gap-2">
                {jobDetail.job.customerPhone ? (
                  <Button variant="outline" className="h-9 rounded-xl text-xs font-medium border-slate-200 text-slate-800 bg-white hover:bg-slate-50 whitespace-nowrap" asChild>
                    <a href={`tel:${jobDetail.job.customerPhone}`}>Call Client</a>
                  </Button>
                ) : (
                  <Button variant="outline" className="h-9 rounded-xl text-xs font-medium border-slate-200 text-slate-800 bg-white hover:bg-slate-50 whitespace-nowrap">
                    Call Client
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="h-9 rounded-xl text-xs font-medium border-slate-200 text-slate-800 bg-white hover:bg-slate-50 whitespace-nowrap"
                  onClick={() => handleQuickAction(QUICK_ACTIONS.find(q => q.key === "Message Client")!)}
                >
                  Message Client
                </Button>
                <Button
                  variant="outline"
                  className="h-9 rounded-xl text-xs font-medium border-slate-200 text-slate-800 bg-white hover:bg-slate-50 whitespace-nowrap"
                  onClick={() => handleQuickAction(QUICK_ACTIONS.find(q => q.key === "Late")!)}
                >
                  Approve Extra Time
                </Button>
                <Button
                  variant="outline"
                  className="h-9 rounded-xl text-xs font-medium border-slate-200 text-slate-800 bg-white hover:bg-slate-50 whitespace-nowrap"
                  onClick={() => handleQuickAction(QUICK_ACTIONS.find(q => q.key === "Complete")!)}
                >
                  Mark Complete
                </Button>
                <Button
                  variant="outline"
                  className="h-9 rounded-xl text-xs font-medium border-slate-200 text-slate-800 bg-white hover:bg-slate-50 whitespace-nowrap"
                  onClick={() => handleQuickAction(QUICK_ACTIONS.find(q => q.key === "Review + Rebook")!)}
                >
                  Send Review Link
                </Button>
                <Button
                  variant="outline"
                  className="h-9 rounded-xl text-xs font-medium border-slate-200 text-slate-800 bg-white hover:bg-slate-50 whitespace-nowrap"
                  onClick={() => handleQuickAction(QUICK_ACTIONS.find(q => q.key === "Review + Rebook")!)}
                >
                  Offer Rebook
                </Button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── Flag Issue Modal ────────────────────────────────────────────────────────────────── */}
      {showFlagModal && selectedJobId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowFlagModal(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">Flag as Needs Attention</h2>
                </div>
                <p className="text-sm text-slate-500 ml-10">This job will move to the top of the Priority Queue and the team will be alerted.</p>
              </div>
              <button className="rounded-xl p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition" onClick={() => setShowFlagModal(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-semibold text-slate-700 mb-1.5 block">What’s the issue?</Label>
                <Textarea
                  value={flagNote}
                  onChange={e => setFlagNote(e.target.value)}
                  placeholder="e.g. Cleaner locked out, client not home, supply issue…"
                  rows={3}
                  className="resize-none rounded-xl border-slate-200 text-sm"
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-1">
                <Button
                  variant="outline"
                  className="flex-1 rounded-xl border-slate-200 text-slate-700"
                  onClick={() => setShowFlagModal(false)}
                  disabled={flagSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white"
                  disabled={!flagNote.trim() || flagSubmitting}
                  onClick={async () => {
                    if (!flagNote.trim() || !selectedJobId) return;
                    setFlagSubmitting(true);
                    try {
                      await flagIssue.mutateAsync({
                        cleanerJobId: selectedJobId,
                        issueNote: flagNote.trim(),
                        flaggedByName: callerName,
                      });
                    } finally {
                      setFlagSubmitting(false);
                    }
                  }}
                >
                  {flagSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><AlertTriangle className="h-4 w-4 mr-1.5" /> Flag Job</>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Resolve Issue Modal ─────────────────────────────────────────────────────────────────────────────────────── */}
      {showResolveModal && jobDetail?.job.openFlagId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowResolveModal(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">Resolve Issue</h2>
                </div>
                {jobDetail.job.openFlagNote && (
                  <div className="ml-10 mt-1 rounded-xl bg-red-50 border border-red-100 px-3 py-2">
                    <p className="text-xs text-red-600 leading-snug">⚠️ {jobDetail.job.openFlagNote}</p>
                  </div>
                )}
              </div>
              <button className="rounded-xl p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition" onClick={() => setShowResolveModal(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-semibold text-slate-700 mb-1.5 block">How was it resolved?</Label>
                <Textarea
                  value={resolveNote}
                  onChange={e => setResolveNote(e.target.value)}
                  placeholder="e.g. Cleaner got access via lockbox, client called back, supplies restocked…"
                  rows={3}
                  className="resize-none rounded-xl border-slate-200 text-sm"
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-1">
                <Button
                  variant="outline"
                  className="flex-1 rounded-xl border-slate-200 text-slate-700"
                  onClick={() => setShowResolveModal(false)}
                  disabled={resolveSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 text-white"
                  disabled={!resolveNote.trim() || resolveSubmitting}
                  onClick={async () => {
                    if (!resolveNote.trim() || !jobDetail.job.openFlagId) return;
                    setResolveSubmitting(true);
                    try {
                      await resolveIssue.mutateAsync({
                        flagId: jobDetail.job.openFlagId,
                        resolutionNote: resolveNote.trim(),
                        resolvedByName: callerName,
                      });
                    } finally {
                      setResolveSubmitting(false);
                    }
                  }}
                >
                  {resolveSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Mark Resolved</>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Profile Photo Drawer ─────────────────────────────────────────────────────────────────────────────────────── */}
      <ProfilePhotoDrawer
        open={profilePhotoOpen}
        onClose={() => setProfilePhotoOpen(false)}
        callerName={callerName}
        currentPhotoUrl={profilePhotoUrl}
        onPhotoUpdated={(url) => setProfilePhotoUrl(url || null)}
      />

      {/* ── Floating DM Panels ─────────────────────────────────────────────────── */}
      {openDms.map((dm, idx) => (
        <DmPanel
          key={dm.key}
          myName={callerName}
          myKey={myDmKey}
          recipientName={dm.name}
          recipientKey={dm.key}
          recipientPhotoUrl={dm.photoUrl}
          slotIndex={idx}
          onClose={() => closeDm(dm.key)}
        />
      ))}
      </div>{/* end flex-1 wrapper */}
    </div>
  );
}
