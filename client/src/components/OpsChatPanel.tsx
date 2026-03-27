/**
 * OpsChatPanel
 *
 * Floating overlay that wraps the full OpsChat experience.
 * Three states:
 *   closed     → nothing rendered
 *   minimized  → compact pill bubble (bottom-right)
 *   open       → full-screen panel with maximize/minimize/close controls
 *
 * Used by both the Agent Dashboard and Admin pages so the chat is always
 * one click away without navigating away from the current page.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  X,
  Minus,
  Maximize2,
  Send,
  MessageCircle,
  LogIn,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { OpsChatWindowState } from "@/hooks/useOpsChatWindow";

// ── Types ─────────────────────────────────────────────────────────────────────

type PriorityStatus = "issue" | "soon" | "progress" | "complete" | "assigned";

interface JobSummary {
  id: number;
  title: string;
  client: string;
  team: string | null;
  time: string;
  status: PriorityStatus;
  issueNote: string | null;
  messageCount: number;
}

const STATUS_META: Record<PriorityStatus, { label: string; bg: string; text: string; border: string }> = {
  issue:    { label: "Needs Attention", bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200" },
  soon:     { label: "Starting Soon",   bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200" },
  progress: { label: "In Progress",     bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200" },
  complete: { label: "Completed",       bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-200" },
  assigned: { label: "Assigned",        bg: "bg-slate-50",  text: "text-slate-600",  border: "border-slate-200" },
};

const CHANNELS = [
  { key: "urgent",   label: "Urgent" },
  { key: "dispatch", label: "Dispatch" },
  { key: "general",  label: "General" },
  { key: "cleaners", label: "Cleaners" },
];

const QUICK_ACTIONS = [
  { key: "Issue",    label: "⚠️ Issue",    template: "⚠️ ISSUE REPORTED\n\nLocation: \nType: " },
  { key: "Late",     label: "⏱ Late",      template: "⏱ DELAY\n\nRunning about 15 minutes behind schedule." },
  { key: "Complete", label: "✅ Complete",  template: "✅ JOB COMPLETE\n\nAll areas finished and after photos uploaded." },
];

// ── Login Gate (inline, compact) ──────────────────────────────────────────────

function InlineLoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = trpc.agents.login.useMutation({
    onSuccess: (data) => { toast.success(`Welcome, ${data.agent.name}!`); onSuccess(); },
    onError: (err) => toast.error(err.message || "Login failed"),
  });

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-4">
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-900">Sign in to OpsChat</p>
          <p className="text-xs text-slate-500 mt-0.5">Use your agent credentials</p>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); if (email && password) loginMutation.mutate({ email: email.trim(), password }); }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="ops-panel-email" className="text-xs">Email</Label>
            <Input id="ops-panel-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus disabled={loginMutation.isPending} className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ops-panel-password" className="text-xs">Password</Label>
            <Input id="ops-panel-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required disabled={loginMutation.isPending} className="h-8 text-sm" />
          </div>
          <Button type="submit" size="sm" className="w-full bg-slate-900 text-white hover:bg-slate-800" disabled={loginMutation.isPending || !email || !password}>
            {loginMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Signing in…</> : <><LogIn className="w-3.5 h-3.5 mr-1.5" /> Sign In</>}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ── Thread message ─────────────────────────────────────────────────────────────

function ThreadMsg({ msg }: { msg: { id: string; ts: number; from: string; role: string; body: string } }) {
  const isOffice = msg.role === "office" || msg.role === "agent";
  const timeStr = new Date(msg.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return (
    <div className={cn("flex", isOffice ? "justify-end" : "justify-start")}>
      <div className="max-w-[82%] rounded-2xl px-3 py-2.5 bg-slate-200 text-slate-900">
        <p className="text-[10px] mb-1 text-slate-400">{msg.from} · {timeStr}</p>
        <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.body}</p>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface OpsChatPanelProps {
  state: OpsChatWindowState;
  onOpen: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

export default function OpsChatPanel({ state, onOpen, onMinimize, onClose }: OpsChatPanelProps) {
  // Auth
  const { user, loading: ownerLoading } = useAuth();
  const { data: agentMe, isLoading: agentLoading, refetch: refetchAgentMe } = trpc.agents.me.useQuery(undefined, { retry: false });
  const authLoading = ownerLoading || agentLoading;
  const isAuthenticated = Boolean(user) || Boolean(agentMe);
  const callerName = user?.name ?? agentMe?.name ?? "Office";

  // Panel state
  const [activeTab, setActiveTab] = useState<"today" | "channels">("today");
  const [activeChannel, setActiveChannel] = useState("dispatch");
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [composer, setComposer] = useState("");
  const [selectedQuickAction, setSelectedQuickAction] = useState<string | null>(null);
  const threadBottomRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();

  // Data
  const { data: jobs = [] } = trpc.opsChat.listTodayJobs.useQuery(undefined, {
    enabled: isAuthenticated && state === "open",
    refetchInterval: 30_000,
  });
  const { data: jobDetail } = trpc.opsChat.getJobDetail.useQuery(
    { jobId: selectedJobId! },
    { enabled: isAuthenticated && state === "open" && selectedJobId !== null, refetchInterval: 15_000 }
  );
  const { data: channelMsgs = [] } = trpc.opsChat.listChannelMessages.useQuery(
    { channel: activeChannel },
    { enabled: isAuthenticated && state === "open" && activeTab === "channels", refetchInterval: 15_000 }
  );
  const { data: channelCounts } = trpc.opsChat.getChannelCounts.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });

  // Unread badge count (urgent + dispatch)
  const unreadCount = channelCounts
    ? ((channelCounts as Record<string, number>).urgent ?? 0) + ((channelCounts as Record<string, number>).dispatch ?? 0)
    : 0;

  const sendMsg = trpc.opsChat.sendMessage.useMutation({
    onSuccess: () => {
      setComposer("");
      setSelectedQuickAction(null);
      if (selectedJobId) utils.opsChat.getJobDetail.invalidate({ jobId: selectedJobId });
      if (activeTab === "channels") utils.opsChat.listChannelMessages.invalidate({ channel: activeChannel });
    },
  });

  // Auto-select first job
  useEffect(() => {
    if (!selectedJobId && jobs.length > 0) setSelectedJobId(jobs[0].id);
  }, [jobs, selectedJobId]);

  // Scroll to bottom
  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [jobDetail?.thread, channelMsgs]);

  const handleSend = useCallback(() => {
    if (!composer.trim()) return;
    if (activeTab === "today" && selectedJobId) {
      sendMsg.mutate({ cleanerJobId: selectedJobId, body: composer.trim(), authorName: callerName, authorRole: "office", quickAction: selectedQuickAction ?? undefined });
    } else if (activeTab === "channels") {
      sendMsg.mutate({ channel: activeChannel, body: composer.trim(), authorName: callerName, authorRole: "office" });
    }
  }, [composer, activeTab, selectedJobId, activeChannel, callerName, selectedQuickAction, sendMsg]);

  const scrollTimeline = (dir: "left" | "right") => {
    const el = timelineScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? 200 : -200, behavior: "smooth" });
  };

  // ── Minimized bubble ──────────────────────────────────────────────────────
  if (state === "minimized") {
    return (
      <button
        onClick={onOpen}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-full bg-slate-900 text-white shadow-xl px-4 py-3 hover:bg-slate-800 transition-all hover:scale-105 active:scale-95"
        aria-label="Open OpsChat"
      >
        <MessageCircle className="w-5 h-5" />
        <span className="text-sm font-semibold">OpsChat</span>
        {unreadCount > 0 && (
          <span className="flex items-center justify-center min-w-[20px] h-5 rounded-full bg-red-500 text-white text-xs font-bold px-1.5">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    );
  }

  if (state !== "open") return null;

  // ── Full panel ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" style={{ contain: "strict" }}>
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center">
            <MessageCircle className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 leading-tight">OpsChat</p>
            {isAuthenticated && (
              <p className="text-[10px] text-slate-400 leading-tight">
                {callerName} · {jobs.length} jobs today
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onMinimize}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            aria-label="Minimize"
            title="Minimize"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            aria-label="Close"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      {authLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : !isAuthenticated ? (
        <InlineLoginGate onSuccess={() => refetchAgentMe()} />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* ── Left sidebar ─────────────────────────────────────────── */}
          <div className="w-[260px] shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
            {/* Tab toggle */}
            <div className="px-3 pt-3 pb-2">
              <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-0.5">
                {(["today", "channels"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition",
                      activeTab === tab ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"
                    )}
                  >
                    {tab === "today" ? "Today" : "Channels"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
              {activeTab === "today" ? (
                jobs.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No jobs today</p>
                ) : (
                  jobs.map((job) => {
                    const meta = STATUS_META[job.status as PriorityStatus] ?? STATUS_META.assigned;
                    const selected = selectedJobId === job.id;
                    return (
                      <button
                        key={job.id}
                        onClick={() => setSelectedJobId(job.id)}
                        className={cn(
                          "w-full rounded-xl border p-3 text-left transition",
                          selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-300"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <span className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium mb-1",
                              selected ? "border-white/20 bg-white/10 text-white" : cn(meta.bg, meta.text, meta.border)
                            )}>
                              {meta.label}
                            </span>
                            <p className="text-xs font-semibold truncate">{job.title}</p>
                            <p className={cn("text-[10px] truncate", selected ? "text-slate-300" : "text-slate-500")}>
                              {job.client}{job.team ? ` · ${job.team}` : ""} · {job.time}
                            </p>
                          </div>
                          {job.messageCount > 0 && (
                            <span className={cn(
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                              selected ? "bg-white text-slate-900" : "bg-slate-900 text-white"
                            )}>
                              {job.messageCount}
                            </span>
                          )}
                        </div>
                        {job.issueNote && (
                          <p className={cn("mt-1.5 rounded-lg px-2 py-1 text-[10px]", selected ? "bg-white/10 text-slate-100" : "bg-red-50 text-red-700")}>
                            {job.issueNote}
                          </p>
                        )}
                      </button>
                    );
                  })
                )
              ) : (
                CHANNELS.map((ch) => {
                  const count = channelCounts ? (channelCounts as Record<string, number>)[ch.key] ?? 0 : 0;
                  const active = activeChannel === ch.key;
                  return (
                    <button
                      key={ch.key}
                      onClick={() => setActiveChannel(ch.key)}
                      className={cn(
                        "w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-xs transition",
                        active ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 text-slate-800 hover:border-slate-300"
                      )}
                    >
                      <span className="font-medium">{ch.label}</span>
                      <span className={cn("font-semibold", active ? "text-white" : "text-slate-500")}>{count}</span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Signed-in footer */}
            <div className="px-3 py-2 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 truncate">
                Signed in as <span className="font-medium text-slate-600">{callerName}</span>
              </p>
            </div>
          </div>

          {/* ── Center: thread ───────────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {activeTab === "today" && selectedJobId && jobDetail ? (
              <>
                {/* Job header */}
                <div className="px-4 py-3 border-b border-slate-200 bg-white shrink-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{jobDetail.job.client}</p>
                  <p className="text-xs text-slate-500">{jobDetail.job.address} · {jobDetail.job.time}</p>
                </div>

                {/* Timeline strip */}
                {jobDetail.timeline.length > 0 && (
                  <div className="px-4 py-2 border-b border-slate-100 bg-white shrink-0">
                    <div className="relative flex items-center gap-1">
                      <button onClick={() => scrollTimeline("left")} className="shrink-0 w-6 h-6 rounded-full border border-slate-200 bg-white flex items-center justify-center text-slate-400 hover:text-slate-700 transition">
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                      <div ref={timelineScrollRef} className="flex items-center gap-1.5 overflow-x-auto flex-1" style={{ scrollbarWidth: "none" }}>
                        {jobDetail.timeline.map((ev) => (
                          <span key={ev.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium whitespace-nowrap text-slate-600 shrink-0">
                            <span className="font-bold tabular-nums">{new Date(ev.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false })}</span>
                            <span className="opacity-40">·</span>
                            {ev.text}
                          </span>
                        ))}
                      </div>
                      <button onClick={() => scrollTimeline("right")} className="shrink-0 w-6 h-6 rounded-full border border-slate-200 bg-white flex items-center justify-center text-slate-400 hover:text-slate-700 transition">
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Thread */}
                <ScrollArea className="flex-1 px-4 py-3">
                  <div className="space-y-3">
                    {jobDetail.thread.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">No messages yet</p>
                    ) : (
                      jobDetail.thread.map((msg) => <ThreadMsg key={msg.id} msg={msg} />)
                    )}
                    <div ref={threadBottomRef} />
                  </div>
                </ScrollArea>

                {/* Quick actions + composer */}
                <div className="px-4 py-3 border-t border-slate-100 bg-white shrink-0">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {QUICK_ACTIONS.map((qa) => (
                      <button
                        key={qa.key}
                        onClick={() => { setSelectedQuickAction(qa.key); setComposer(qa.template); }}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                          selectedQuickAction === qa.key ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                        )}
                      >
                        {qa.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 items-end">
                    <Textarea
                      value={composer}
                      onChange={(e) => setComposer(e.target.value)}
                      placeholder="Type a message…"
                      rows={2}
                      className="flex-1 resize-none text-xs border-slate-200 focus-visible:ring-1 focus-visible:ring-slate-900"
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
                    />
                    <Button
                      onClick={handleSend}
                      disabled={!composer.trim() || sendMsg.isPending}
                      size="sm"
                      className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </>
            ) : activeTab === "channels" ? (
              <>
                <div className="px-4 py-3 border-b border-slate-200 bg-white shrink-0">
                  <p className="text-sm font-semibold text-slate-900">{CHANNELS.find(c => c.key === activeChannel)?.label ?? activeChannel}</p>
                  <p className="text-xs text-slate-500">Internal team channel</p>
                </div>
                <ScrollArea className="flex-1 px-4 py-3">
                  <div className="space-y-3">
                    {channelMsgs.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">No messages yet</p>
                    ) : (
                      channelMsgs.map((msg) => <ThreadMsg key={msg.id} msg={{ ...msg, id: String(msg.id) }} />)
                    )}
                    <div ref={threadBottomRef} />
                  </div>
                </ScrollArea>
                <div className="px-4 py-3 border-t border-slate-100 bg-white shrink-0">
                  <div className="flex gap-2 items-end">
                    <Textarea
                      value={composer}
                      onChange={(e) => setComposer(e.target.value)}
                      placeholder={`Message ${CHANNELS.find(c => c.key === activeChannel)?.label ?? activeChannel}…`}
                      rows={2}
                      className="flex-1 resize-none text-xs border-slate-200 focus-visible:ring-1 focus-visible:ring-slate-900"
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
                    />
                    <Button
                      onClick={handleSend}
                      disabled={!composer.trim() || sendMsg.isPending}
                      size="sm"
                      className="bg-slate-900 text-white hover:bg-slate-800 rounded-xl shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                Select a job from the left panel
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
