/**
 * OpsChat — Internal team communication hub.
 * Accessible to both the owner (Manus OAuth) and all agent accounts (email + password).
 * Layout: 3 columns — left sidebar (queue + jobs), center (timeline + thread), right (job details + actions).
 */

import { useState, useRef, useEffect, useMemo } from "react";
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
  messageCount: number;
  photoSubmitted: boolean;
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_META: Record<PriorityStatus, { label: string; bg: string; text: string; border: string }> = {
  issue:    { label: "Needs Attention", bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200" },
  soon:     { label: "Starting Soon",   bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200" },
  progress: { label: "In Progress",     bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200" },
  complete: { label: "Completed",       bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-200" },
  assigned: { label: "Assigned",        bg: "bg-slate-50",  text: "text-slate-600",  border: "border-slate-200" },
};

const TIMELINE_TONE: Record<string, string> = {
  arrival:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  photo:    "bg-sky-50 text-sky-700 border-sky-200",
  issue:    "bg-red-50 text-red-700 border-red-200",
  office:   "bg-violet-50 text-violet-700 border-violet-200",
  schedule: "bg-amber-50 text-amber-700 border-amber-200",
  complete: "bg-emerald-50 text-emerald-700 border-emerald-200",
  review:   "bg-indigo-50 text-indigo-700 border-indigo-200",
  sms:      "bg-slate-50 text-slate-600 border-slate-200",
  call:     "bg-purple-50 text-purple-700 border-purple-200",
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
  { key: "urgent",   label: "Urgent" },
  { key: "dispatch", label: "Dispatch / Today" },
  { key: "general",  label: "General" },
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
      {job.issueNote && (
        <div className={cn("mt-3 rounded-xl px-3 py-2 text-xs", selected ? "bg-white/10 text-slate-100" : "bg-red-50 text-red-700")}>
          {job.issueNote}
        </div>
      )}
    </button>
  );
}

function TimelineEvent({ event }: { event: { id: string; ts: number; type: string; text: string } }) {
  const tone = TIMELINE_TONE[event.type] ?? TIMELINE_TONE.office;
  const timeStr = new Date(event.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false });
  return (
    <span className={cn(
      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap shrink-0",
      tone
    )}>
      <span className="font-bold tabular-nums">{timeStr}</span>
      <span className="opacity-40 select-none">·</span>
      <span>{event.text}</span>
    </span>
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
  msg: { id: string; ts: number; from: string; role: string; body: string; source: string };
  callerName: string;
  seenBy?: string[];
}) {
  const isMine = msg.from === callerName;
  const timeStr = new Date(msg.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const initials = msg.from.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const colorClass = avatarColor(msg.from);
  return (
    <div className={cn("flex items-end gap-2", isMine ? "justify-end" : "justify-start")}>
      {/* Avatar — only on others' messages */}
      {!isMine && (
        <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mb-0.5", colorClass)}>
          {initials}
        </div>
      )}
      <div className={cn(
        "max-w-[72%] rounded-2xl px-4 py-3",
        isMine
          ? "bg-slate-900 text-white rounded-br-sm"
          : "bg-white border border-slate-100 text-slate-900 shadow-sm rounded-bl-sm"
      )}>
        {!isMine && (
          <p className="text-xs font-semibold mb-1 text-slate-500">{msg.from}</p>
        )}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.body}</p>
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <p className="text-xs text-slate-400">{timeStr}</p>
          {/* Read receipts — shown only on my last message */}
          {isMine && seenBy && seenBy.length > 0 && (
            <p className="text-[10px] text-slate-400 italic">
              Seen by {seenBy.join(", ")}
            </p>
          )}
        </div>
      </div>
    </div>
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
  const [activeTab, setActiveTab] = useState<"today" | "channels">("today");
  const [activeChannel, setActiveChannel] = useState<string>("dispatch");
  const [composer, setComposer] = useState("");
  const [selectedQuickAction, setSelectedQuickAction] = useState<string | null>(null);
  const threadBottomRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);

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
    { messageId: lastMyChannelMsgId!, channel: activeChannel },
    { enabled: isAuthenticated && activeTab === "channels" && lastMyChannelMsgId !== null, refetchInterval: 10_000 }
  );

  // seenBy for the last my-message in current job thread
  const lastMyThreadMsgId = useMemo(() => {
    if (!jobDetail?.thread) return null;
    const mine = [...jobDetail.thread].reverse().find((m) => m.from === callerName);
    return mine ? Number(mine.id) : null;
  }, [jobDetail?.thread, callerName]);

  const { data: threadSeenBy } = trpc.opsChat.getSeenBy.useQuery(
    { messageId: lastMyThreadMsgId!, cleanerJobId: selectedJobId! },
    { enabled: isAuthenticated && activeTab === "today" && lastMyThreadMsgId !== null && selectedJobId !== null, refetchInterval: 10_000 }
  );

  // ── Send message mutation ───────────────────────────────────────────────────
  const sendMsg = trpc.opsChat.sendMessage.useMutation({
    onSuccess: () => {
      setComposer("");
      setSelectedQuickAction(null);
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
    if (!composer.trim()) return;
    if (activeTab === "today" && selectedJobId) {
      sendMsg.mutate({
        cleanerJobId: selectedJobId,
        body: composer.trim(),
        authorName: callerName,
        authorRole: "office",
        quickAction: selectedQuickAction ?? undefined,
      });
    } else if (activeTab === "channels") {
      sendMsg.mutate({
        channel: activeChannel,
        body: composer.trim(),
        authorName: callerName,
        authorRole: "office",
      });
    }
  }

  function handleQuickAction(qa: typeof QUICK_ACTIONS[number]) {
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
                onClick={() => setActiveTab(tab)}
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
                  <span className="text-xs text-slate-400 italic">Live sorted</span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between rounded-xl bg-red-50 px-3 py-2.5">
                    <span className="text-sm font-medium text-red-600">🔥 Needs attention</span>
                    <span className="text-sm font-bold text-red-600">{grouped.issue.length}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2.5">
                    <span className="text-sm font-medium text-amber-600">⏰ Starting soon</span>
                    <span className="text-sm font-bold text-amber-600">{grouped.soon.length}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-blue-50 px-3 py-2.5">
                    <span className="text-sm font-medium text-blue-600">🟡 In progress</span>
                    <span className="text-sm font-bold text-blue-600">{grouped.progress.length}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5">
                    <span className="text-sm font-medium text-emerald-600">✅ Completed</span>
                    <span className="text-sm font-bold text-emerald-600">{grouped.complete.length}</span>
                  </div>
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
                        onClick={() => { setActiveTab("channels"); setActiveChannel(ch.key); }}
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
                    {[...grouped.issue, ...grouped.soon, ...grouped.progress, ...grouped.complete,
                      ...jobs.filter(j => j.status === "assigned")].map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        selected={selectedJobId === job.id}
                        onClick={() => { setSelectedJobId(job.id); setActiveTab("today"); }}
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
                    onClick={() => setActiveChannel(ch.key)}
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

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <Textarea
                        value={composer}
                        onChange={(e) => setComposer(e.target.value)}
                        placeholder="Type a message or use a one-tap action…"
                        rows={3}
                        className="resize-none border-0 bg-transparent p-0 text-sm text-slate-700 focus-visible:ring-0 placeholder:text-slate-400"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
                        }}
                      />
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1">
                          <button className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-white transition text-xs flex items-center gap-1">
                            <Camera className="h-4 w-4" /> Photo
                          </button>
                          <button className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-white transition text-xs flex items-center gap-1">
                            <Mic className="h-4 w-4" /> Voice
                          </button>
                          <button className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-white transition">
                            <Smile className="h-4 w-4" />
                          </button>
                        </div>
                        <Button
                          onClick={handleSend}
                          disabled={!composer.trim() || sendMsg.isPending}
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
        ) : activeTab === "channels" ? (
          /* Channel view */
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
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <Textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder={`Message ${CHANNELS.find(c => c.key === activeChannel)?.label ?? activeChannel}…`}
                  rows={3}
                  className="resize-none border-0 bg-transparent p-0 text-sm text-slate-700 focus-visible:ring-0 placeholder:text-slate-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
                  }}
                />
                <div className="flex items-center justify-end mt-2">
                  <Button
                    onClick={handleSend}
                    disabled={!composer.trim() || sendMsg.isPending}
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

            {/* Job Details card */}
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

            {/* Actions card */}
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
    </div>
  );
}
