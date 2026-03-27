/**
 * CommandChat — MIB Command Chat view.
 * Renders when the user selects the "command" channel.
 * Layout: 3 columns
 *   Left  : Ops Snapshot + Live Alerts & Escalations
 *   Center: Pinned Day Status + Conversation thread + quick-action chips
 *   Right : Command Center Rules + Auto-Raised Issues + Suggested Widgets
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, CheckCheck, Loader2, Send, Megaphone, Bell, MapPin, MessageSquare, X } from "lucide-react";
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
    createdAt: Date;
  }>;
  channelLoading: boolean;
  callerName: string;
  /** Called when user hits Send in the composer */
  onSendMessage: (body: string) => void;
  /** Called when user clicks "Jump to Job Thread" */
  onJumpToJob: (jobId: number) => void;
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

// ── component ─────────────────────────────────────────────────────────────────

export default function CommandChat({ channelMsgs, channelLoading, callerName, onSendMessage, onJumpToJob }: CommandChatProps) {
  const [composer, setComposer] = useState("");
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const threadBottomRef = useRef<HTMLDivElement>(null);

  const { data: cmdData, isLoading: cmdLoading } = trpc.opsChat.getCommandChatData.useQuery(undefined, {
    refetchInterval: 20_000,
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
    const text = composer.trim();
    if (!text) return;
    onSendMessage(text);
    setComposer("");
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
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <Textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="Message MIB Command Chat… (Enter to send, Shift+Enter for new line)"
              rows={2}
              className="resize-none border-0 bg-transparent p-0 text-sm text-slate-700 focus-visible:ring-0 placeholder:text-slate-400"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
            />
            <div className="flex justify-end mt-2">
              <Button size="sm" onClick={handleSend} disabled={!composer.trim()} className="rounded-xl">
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
