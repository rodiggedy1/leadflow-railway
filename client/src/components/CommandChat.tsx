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
import { useState, useRef, useEffect, useCallback } from "react";
import EmojiPicker, { type EmojiClickData, Theme } from "emoji-picker-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Clock, CheckCheck, Loader2, Send, Megaphone, MapPin,
  X, Camera, Mic, Smile, ImageIcon, UserCheck, Zap, Phone, Wand2, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
    createdAt: Date;
  }>;
  channelLoading: boolean;
  callerName: string;
  /** Called when user hits Send in the composer */
  onSendMessage: (body: string, mediaUrl?: string) => void;
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

// ── component ─────────────────────────────────────────────────────────────────

export default function CommandChat({ channelMsgs, channelLoading, callerName, onSendMessage, onJumpToJob, onSwitchToToday }: CommandChatProps) {
  const [composer, setComposer] = useState("");
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const threadBottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: cmdData, isLoading: cmdLoading } = trpc.opsChat.getCommandChatData.useQuery(undefined, {
    refetchInterval: 20_000,
  });

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

  // Auto-scroll thread to bottom when new messages arrive
  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [channelMsgs.length]);

  const snapshot = cmdData?.snapshot ?? { issue: 0, soon: 0, progress: 0, complete: 0, assigned: 0 };
  const alerts = cmdData?.alerts ?? [];
  const pinnedJobs = cmdData?.pinnedJobs ?? [];
  const autoRaised = cmdData?.autoRaised ?? [];

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
    onSendMessage(body, mediaUrl);
    setComposer("");
    setStagedPhotos(prev => { prev.forEach(p => URL.revokeObjectURL(p.previewUrl)); return []; });
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* ── LEFT PANEL: Ops Snapshot + Live Alerts ── */}
      <div className="w-[300px] shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-white">
          <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-1">General Command Chat</p>
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-slate-900">Ship Control</h2>
            {totalAlerts > 0 && (
              <span className="text-xs font-semibold bg-slate-100 text-slate-700 rounded-full px-3 py-1 border border-slate-200">
                {totalAlerts} alert{totalAlerts !== 1 ? "s" : ""}
              </span>
            )}
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
                {alerts.map((alert, i) => (
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
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── CENTER PANEL: Pinned Day Status + Conversation ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-white">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">MIB Command Chat</h2>
              <p className="text-sm text-slate-500 mt-0.5">The chat that keeps the whole day moving — not tied to one job, but aware of all of them.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-medium bg-red-50 text-red-600 border border-red-100 rounded-full px-3 py-1">
                Priority alerts pulled from job threads
              </span>
              <Button
                size="sm"
                className="bg-slate-900 text-white hover:bg-slate-700 rounded-full"
                onClick={() => setBroadcastOpen(true)}
              >
                <Megaphone className="h-3.5 w-3.5 mr-1.5" />
                Broadcast update
              </Button>
            </div>
          </div>
        </div>

        {/* Pinned Day Status */}
        <div className="px-6 py-3 border-b border-slate-100">
          <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-2">Pinned Day Status</p>
          {cmdLoading ? (
            <div className="flex gap-3">
              {[1,2,3,4].map(i => <div key={i} className="w-36 h-20 rounded-xl bg-slate-100 animate-pulse shrink-0" />)}
            </div>
          ) : pinnedJobs.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">No jobs scheduled today.</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-slate-200">
              {pinnedJobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => onJumpToJob(job.id)}
                  className={cn(
                    "shrink-0 w-36 rounded-xl border p-3 text-left transition hover:shadow-sm",
                    BUCKET_BG[job.status as StatusBucket] ?? "bg-slate-50 border-slate-200"
                  )}
                >
                  <p className="text-[10px] text-slate-400 font-medium">{job.time}</p>
                  <p className="text-sm font-bold text-slate-900 leading-tight mt-0.5 truncate">{job.name}</p>
                  <p className={cn("text-[10px] font-semibold mt-1.5", BUCKET_COLORS[job.status as StatusBucket] ?? "text-slate-500")}>
                    {BUCKET_LABELS[job.status as StatusBucket] ?? job.status}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Conversation thread */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 scrollbar-thin scrollbar-thumb-slate-200">
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
                          <div className="flex items-center gap-2 mt-2">
                            {/* Call icon — dial lead directly */}
                            {leadPhone && (
                              <a
                                href={`tel:${leadPhone}`}
                                title={`Call ${leadName}`}
                                className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
                              >
                                <Phone className="h-4 w-4" />
                              </a>
                            )}
                            {/* View Conversation — open lead in Admin Leads page */}
                            {sessionId && (
                              <a
                                href={`/admin/leads?session=${sessionId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View conversation thread"
                                className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-sky-100 hover:bg-sky-200 text-sky-700 hover:text-sky-900 transition-colors"
                              >
                                <MessageSquare className="h-4 w-4" />
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
                              className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-violet-100 hover:bg-violet-200 text-violet-700 hover:text-violet-900 transition-colors"
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

                // ── Default bubble ───────────────────────────────────────────────
                return (
                  <div key={msg.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[75%] rounded-2xl px-4 py-3",
                      isAlert ? "bg-slate-900 text-white w-full max-w-full" :
                      isMine ? "bg-slate-100 text-slate-900" : "bg-white border border-slate-200 text-slate-900"
                    )}>
                      {!isMine && (
                        <p className={cn("text-[10px] font-semibold mb-1", isAlert ? "text-slate-300" : "text-slate-500")}>
                          {msg.from} · {msg.role === "alert" ? "Alert" : msg.role === "office" ? "Office" : msg.role === "cleaner" ? "Cleaner" : "Dispatch"}
                        </p>
                      )}
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                      {mediaUrls.length > 0 && (
                        <div className={cn("mt-2 flex flex-wrap gap-2", mediaUrls.length === 1 ? "max-w-xs" : "")}>
                          {mediaUrls.map((url, idx) => (
                            <a key={idx} href={url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={url}
                                alt={`attachment-${idx}`}
                                className="rounded-xl object-cover cursor-zoom-in"
                                style={{ width: mediaUrls.length === 1 ? "100%" : "80px", height: mediaUrls.length === 1 ? "auto" : "80px", maxWidth: "100%" }}
                              />
                            </a>
                          ))}
                        </div>
                      )}
                      <p className={cn("text-[10px] mt-1.5 text-right", isAlert ? "text-slate-400" : "text-slate-400")}>
                        {fmtMsgTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={threadBottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-white">
          {/* Quick-action chips */}
          <div className="flex gap-2 mb-3 flex-wrap">
            {[
              { label: "Broadcast Update", primary: true, action: () => setBroadcastOpen(true) },
              { label: "Raise Alert", action: () => setComposer("🚨 ALERT: ") },
              { label: "Ask Status", action: () => setComposer("📋 Status check — can all teams confirm current status?") },
              { label: "Route Reminder", action: () => setComposer("🗺️ Route reminder: please confirm your next stop and ETA.") },
            ].map((chip) => (
              <button
                key={chip.label}
                onClick={chip.action}
                className={cn(
                  "text-xs font-semibold rounded-full px-4 py-2 transition",
                  chip.primary
                    ? "bg-slate-900 text-white hover:bg-slate-700"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                )}
              >
                {chip.label}
              </button>
            ))}
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
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
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

      {/* ── RIGHT PANEL: Rules + Auto-Raised Issues + Suggested Widgets ── */}
      <div className="w-[280px] shrink-0 border-l border-slate-200 bg-slate-50 flex flex-col overflow-y-auto">
        <div className="px-5 py-4 space-y-5">

          {/* Command Center Rules */}
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-3">Command Center Rules</p>
            <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
              <p>Any issue flagged inside a job thread automatically surfaces here as an alert card.</p>
              <p>Regular team conversation still happens here, but urgent ops signals stay visible and pinned.</p>
              <p>This page acts like dispatch control: teamwide reminders, bottlenecks, route awareness, and job health at a glance.</p>
            </div>
          </div>

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
                    <p className="text-sm font-bold text-red-700">{issue.jobName}</p>
                    <p className="text-xs text-red-600 mt-0.5">{issue.note}</p>
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

          {/* Suggested Widgets */}
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-3">Suggested Widgets</p>
            <div className="space-y-2 text-sm text-slate-500">
              <p>Late arrivals / no check-ins</p>
              <p>Supply requests from cleaners</p>
              <p>Client messages awaiting reply</p>
            </div>
          </div>
        </div>
      </div>

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
    </div>
  );
}
