/**
 * OpsChat — Internal team communication hub.
 * WhatsApp-style interface tied to real job data.
 * Layout: 3 columns — left sidebar (queue + jobs), center (timeline + thread), right (job details + actions).
 */

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Phone,
  MessageSquare,
  ExternalLink,
  Send,
  Camera,
  Mic,
  Smile,
  RefreshCw,
  Users,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Zap,
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

const STATUS_META: Record<PriorityStatus, { label: string; icon: string; bg: string; text: string; border: string }> = {
  issue:    { label: "Needs Attention", icon: "🔥", bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200" },
  soon:     { label: "Starting Soon",   icon: "⏰", bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200" },
  progress: { label: "In Progress",     icon: "🟡", bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200" },
  complete: { label: "Completed",       icon: "✅", bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-200" },
  assigned: { label: "Assigned",        icon: "📋", bg: "bg-slate-50",  text: "text-slate-600",  border: "border-slate-200" },
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
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono text-slate-400 w-10 shrink-0">{timeStr}</span>
      <span className={cn("rounded-full border px-3 py-1 text-xs font-medium", tone)}>
        {event.text}
      </span>
    </div>
  );
}

function ThreadMessage({ msg }: { msg: { id: string; ts: number; from: string; role: string; body: string; source: string } }) {
  const isOffice = msg.role === "office" || msg.role === "agent";
  const timeStr = new Date(msg.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return (
    <div className={cn("flex flex-col gap-0.5", isOffice ? "items-end" : "items-start")}>
      <div className={cn(
        "max-w-[80%] rounded-3xl px-4 py-3",
        isOffice ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"
      )}>
        <div className={cn("text-xs font-semibold mb-1", isOffice ? "text-slate-300" : "text-slate-500")}>
          {msg.from} · {msg.role}
        </div>
        <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.body}</div>
      </div>
      <span className="text-xs text-slate-400 px-2">{timeStr}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OpsChat() {
  const { user } = useAuth();
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"today" | "channels">("today");
  const [activeChannel, setActiveChannel] = useState<string>("dispatch");
  const [composer, setComposer] = useState("");
  const [selectedQuickAction, setSelectedQuickAction] = useState<string | null>(null);
  const threadBottomRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();

  // ── Data queries ────────────────────────────────────────────────────────────
  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = trpc.opsChat.listTodayJobs.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { data: jobDetail, isLoading: detailLoading } = trpc.opsChat.getJobDetail.useQuery(
    { jobId: selectedJobId! },
    { enabled: selectedJobId !== null, refetchInterval: 15_000 }
  );

  const { data: channelMsgs = [], isLoading: channelLoading } = trpc.opsChat.listChannelMessages.useQuery(
    { channel: activeChannel },
    { enabled: activeTab === "channels", refetchInterval: 15_000 }
  );

  const { data: channelCounts } = trpc.opsChat.getChannelCounts.useQuery(undefined, {
    refetchInterval: 30_000,
  });

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
    const authorName = user?.name ?? "Office";
    if (activeTab === "today" && selectedJobId) {
      sendMsg.mutate({
        cleanerJobId: selectedJobId,
        body: composer.trim(),
        authorName,
        authorRole: "office",
        quickAction: selectedQuickAction ?? undefined,
      });
    } else if (activeTab === "channels") {
      sendMsg.mutate({
        channel: activeChannel,
        body: composer.trim(),
        authorName,
        authorRole: "office",
      });
    }
  }

  function handleQuickAction(qa: typeof QUICK_ACTIONS[number]) {
    setSelectedQuickAction(qa.key);
    setComposer(qa.template);
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
            <div className="rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 shadow-sm font-medium">
              {jobs.length} online
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
        <div className="flex-1 overflow-y-auto">
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
                    const isUrgentActive = activeChannel === ch.key && (activeTab as string) === "channels";
                    return (
                      <button
                        key={ch.key}
                        onClick={() => { setActiveTab("channels"); setActiveChannel(ch.key); }}
                        className={cn(
                          "w-full flex items-center justify-between rounded-2xl border px-4 py-3.5 text-sm transition",
                          isUrgentActive
                            ? "bg-slate-900 border-slate-900 text-white"
                            : "bg-white border-slate-200 text-slate-800 hover:border-slate-300 hover:shadow-sm"
                        )}
                      >
                        <span className="font-medium">{ch.label}</span>
                        <span className={cn(
                          "text-sm font-semibold min-w-[20px] text-right",
                          isUrgentActive ? "text-white" : "text-slate-500"
                        )}>{count}</span>
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
                    <span className={cn(
                      "text-sm font-semibold min-w-[20px] text-right",
                      activeChannel === ch.key ? "text-white" : "text-slate-500"
                    )}>{count}</span>
                  </button>
                );
              })}
            </div>
          )}
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
                  <a href={`/field-management`} target="_blank" rel="noopener noreferrer">
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
                  {/* Live Activity Timeline */}
                  <div className="px-6 py-4 border-b border-slate-100 bg-white">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Live Activity Timeline</p>
                    <div className="space-y-2">
                      {jobDetail.timeline.length === 0 ? (
                        <p className="text-sm text-slate-400">No activity yet</p>
                      ) : (
                        jobDetail.timeline.map((ev) => <TimelineEvent key={ev.id} event={ev} />)
                      )}
                    </div>
                  </div>

                  {/* Thread */}
                  <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Thread</p>
                      {jobDetail.thread.some(m => m.role === "cleaner" || m.role === "client") && (
                        <span className="text-xs font-semibold text-red-600">Requires response</span>
                      )}
                    </div>
                    <ScrollArea className="flex-1 px-6 py-4">
                      <div className="space-y-4">
                        {jobDetail.thread.length === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-8">No messages yet — start the thread below.</p>
                        ) : (
                          jobDetail.thread.map((msg) => <ThreadMessage key={msg.id} msg={msg} />)
                        )}
                        <div ref={threadBottomRef} />
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Quick actions */}
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

                    {/* Composer */}
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
            <ScrollArea className="flex-1 px-6 py-4">
              <div className="space-y-4">
                {channelLoading ? (
                  <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
                ) : channelMsgs.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No messages in this channel yet.</p>
                ) : (
                  channelMsgs.map((msg) => (
                    <ThreadMessage key={msg.id} msg={{ ...msg, id: String(msg.id), source: "ops" }} />
                  ))
                )}
                <div ref={threadBottomRef} />
              </div>
            </ScrollArea>
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

           {/* ── RIGHT PANEL (Job Details + Actions) ──────────────────── */}
      {activeTab === "today" && jobDetail && (
        <div className="w-[300px] shrink-0 border-l border-slate-200 bg-slate-50 overflow-y-auto">
          <div className="p-4 space-y-3">

            {/* Job Details card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">Job Details</p>

              {/* Client */}
              <div className="mb-4">
                <p className="text-xs text-slate-400 mb-0.5">Client</p>
                <p className="text-base font-bold text-slate-900">{jobDetail.job.client}</p>
              </div>

              {/* Service + Price */}
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

              {/* Window + Team */}
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

              {/* Address */}
              <div className="mb-4">
                <p className="text-xs text-slate-400 mb-0.5">Address</p>
                <p className="text-sm font-semibold text-slate-900">{jobDetail.job.address}</p>
              </div>

              {/* Notes */}
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
