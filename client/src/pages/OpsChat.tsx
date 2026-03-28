/**
 * OpsChat — Internal team communication hub.
 * Accessible to both the owner (Manus OAuth) and all agent accounts (email + password).
 * Layout: 3 columns — left sidebar (queue + jobs), center (timeline + thread), right (job details + actions).
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import CommandChat from "@/components/CommandChat";
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

function ThreadMessage({ msg, callerName, seenBy }: {
  msg: { id: string; ts: number; from: string; role: string; body: string; source: string; mediaUrl?: string | null };
  callerName: string;
  seenBy?: string[];
}) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const isMine = msg.from === callerName;
  const timeStr = new Date(msg.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const initials = msg.from.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const colorClass = avatarColor(msg.from);

  // Parse mediaUrl — may be a JSON array of URLs or a single URL
  const imageUrls: string[] = (() => {
    if (!msg.mediaUrl) return [];
    try {
      const parsed = JSON.parse(msg.mediaUrl);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {}
    return [msg.mediaUrl];
  })();

  return (
    <>
      {lightboxIdx !== null && (
        <Lightbox urls={imageUrls} startIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      )}
      <div className={cn("flex items-end gap-2", isMine ? "justify-end" : "justify-start")}>
        {/* Avatar — only on others' messages */}
        {!isMine && (
          <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mb-0.5", colorClass)}>
            {initials}
          </div>
        )}
        <div className={cn(
          "max-w-[72%] rounded-2xl overflow-hidden",
          isMine
            ? "bg-slate-900 text-white rounded-br-sm"
            : "bg-white border border-slate-100 text-slate-900 shadow-sm rounded-bl-sm"
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
                  className="relative group overflow-hidden aspect-square"
                  onClick={() => setLightboxIdx(i)}
                >
                  <img
                    src={url}
                    alt={`Photo ${i + 1}`}
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center">
                    <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition drop-shadow" />
                  </div>
                </button>
              ))}
            </div>
          )}
          {/* Text body */}
          {msg.body && (
            <div className="px-4 py-3">
              {!isMine && (
                <p className="text-xs font-semibold mb-1 text-slate-500">{msg.from}</p>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.body}</p>
            </div>
          )}
          {/* Footer: time + read receipts */}
          <div className={cn("flex items-center justify-between gap-2 px-4 pb-3", !msg.body && imageUrls.length > 0 ? "pt-2" : "-mt-1")}>
            <p className="text-xs text-slate-400">{timeStr}</p>
            {isMine && seenBy && seenBy.length > 0 && (
              <p className="text-[10px] text-slate-400 italic">
                Seen by {seenBy.join(", ")}
              </p>
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

  const { minimize: minimizeFromHook } = useOpsChatWindow();
  const minimizeOpsChat = onMinimize ?? minimizeFromHook;
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<PriorityStatus | null>(null);
  const [activeTab, setActiveTab] = useState<"today" | "channels">("today");
  const [activeChannel, setActiveChannel] = useState<string>("dispatch");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  // Close emoji picker on outside click
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

  // Resolved caller name — owner name takes precedence, then agent name
  const callerName = user?.name ?? agentMe?.name ?? "Office";

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

  // seenBy for the last my-message in current channel
  const lastMyChannelMsgId = useMemo(() => {
    const mine = [...channelMsgs].reverse().find((m) => m.from === callerName);
    return mine ? mine.id : null;
  }, [channelMsgs, callerName]);

  const { data: channelSeenBy } = trpc.opsChat.getSeenBy.useQuery(
    { messageId: lastMyChannelMsgId ?? 0, channel: activeChannel },
    { enabled: isAuthenticated && activeTab === "channels" && !!lastMyChannelMsgId && lastMyChannelMsgId > 0, refetchInterval: 10_000 }
  );

  // seenBy for the last my-message in current job thread
  const lastMyThreadMsgId = useMemo(() => {
    if (!jobDetail?.thread) return null;
    const mine = [...jobDetail.thread].reverse().find((m) => m.from === callerName);
    return mine ? Number(mine.id) : null;
  }, [jobDetail?.thread, callerName]);

  const { data: threadSeenBy } = trpc.opsChat.getSeenBy.useQuery(
    { messageId: lastMyThreadMsgId ?? 0, cleanerJobId: selectedJobId ?? 0 },
    { enabled: isAuthenticated && activeTab === "today" && !!lastMyThreadMsgId && lastMyThreadMsgId > 0 && !!selectedJobId, refetchInterval: 10_000 }
  );

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

  // Scroll thread to bottom on new messages
  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [jobDetail?.thread, channelMsgs]);

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
      });
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      {sidebarCollapsed ? (
        /* Slim icon rail when collapsed */
        <div className="w-14 shrink-0 border-r border-slate-200 bg-white flex flex-col items-center py-3 gap-3 overflow-hidden transition-all">
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
        </div>
      ) : (
      <div className="w-[300px] shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">In-App Ops Chat</p>
              <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Today</h1>
            </div>
            <div className="flex items-center gap-2">
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

        {/* Signed-in-as footer */}
        <div className="px-4 py-3 border-t border-slate-100 bg-white">
          <p className="text-xs text-slate-400 truncate">
            Signed in as <span className="font-medium text-slate-600">{callerName}</span>
          </p>
        </div>
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
                    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                      <div className="space-y-4">
                        {jobDetail.thread.length === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-8">No messages yet — start the thread below.</p>
                        ) : (
                          jobDetail.thread.map((msg, idx) => {
                            const isLast = idx === jobDetail.thread.length - 1;
                            const isMine = msg.from === callerName;
                            return (
                              <ThreadMessage
                                key={msg.id}
                                msg={msg}
                                callerName={callerName}
                                seenBy={isLast && isMine ? (threadSeenBy?.seenBy ?? []) : undefined}
                              />
                            );
                          })
                        )}
                        <div ref={threadBottomRef} />
                      </div>
                    </div>
                  </div>

                  {/* Quick actions + Composer */}
                  <div className="px-6 py-3 border-t border-slate-100 bg-white">
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
                        rows={3}
                        className="resize-none border-0 bg-transparent p-0 text-sm text-slate-700 focus-visible:ring-0 placeholder:text-slate-400"
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
                <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Job not found</div>
              )}
            </div>
          </>
        ) : activeTab === "channels" && activeChannel === "command" ? (
          /* MIB Command Chat — special 3-column ops view */
          <CommandChat
            channelMsgs={channelMsgs.map(m => ({ id: m.id, from: m.from, role: m.role, body: m.body, mediaUrl: m.mediaUrl, createdAt: new Date(m.ts) }))}
            channelLoading={channelLoading}
            callerName={callerName}
            onSendMessage={(body, mediaUrl) => {
              sendMsg.mutate({ body, channel: "command", authorName: callerName, mediaUrl });
            }}
            onJumpToJob={(jobId) => {
              handleSetActiveTab("today");
              setSelectedJobId(jobId);
            }}
          />
        ) : activeTab === "channels" ? (
          /* Regular channel view */
          <>
            <div className="px-6 py-4 border-b border-slate-200 bg-white">
              <h2 className="text-xl font-semibold text-slate-900">
                {CHANNELS.find(c => c.key === activeChannel)?.label ?? activeChannel}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">Internal team channel</p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              <div className="space-y-4">
                {channelLoading ? (
                  <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
                ) : channelMsgs.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No messages in this channel yet.</p>
                ) : (
                  channelMsgs.map((msg, idx) => {
                    const isLast = idx === channelMsgs.length - 1;
                    const isMine = msg.from === callerName;
                    return (
                      <ThreadMessage
                        key={msg.id}
                        msg={{ ...msg, id: String(msg.id), source: "ops" }}
                        callerName={callerName}
                        seenBy={isLast && isMine ? (channelSeenBy?.seenBy ?? []) : undefined}
                      />
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
                  rows={3}
                  className="resize-none border-0 bg-transparent p-0 text-sm text-slate-700 focus-visible:ring-0 placeholder:text-slate-400"
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

      {/* ── Resolve Issue Modal ───────────────────────────────────────────────────────────────── */}
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
    </div>
  );
}
