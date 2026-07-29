/**
 * OperationsPanel.tsx
 * The Operations Center — right panel of the CS Inbox.
 *
 * Layout:
 *   ┌─────────────────────────────┐
 *   │  Header: Customer name      │  ← pinned, always shows selected conversation
 *   │  "Operations" · N Active    │
 *   ├─────────────────────────────┤
 *   │  Mission cards (scrollable) │  ← animated, live-updating via SSE
 *   │  [+ New Mission] button     │
 *   ├─────────────────────────────┤
 *   │  Reference footer           │  ← Notes · Timeline · Quick actions
 *   └─────────────────────────────┘
 *
 * Design: matches the existing CsInbox aesthetic (white cards, soft shadows,
 * #7C5CFF accent, Inter font, rounded-[28px] outer shell).
 */

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import type { CsMissionStage } from "../../../drizzle/schema";
import {
  CheckCircle2,
  Clock,
  Zap,
  Circle,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Phone,
  Link2,
  StickyNote,
  History,
  Loader2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CsMissionRow {
  id: number;
  sessionId: number;
  agentId: number;
  agentName: string | null;
  title: string;
  emoji: string | null;
  status: "active" | "waiting" | "ready" | "completed" | "cancelled";
  stages: CsMissionStage[];
  sortOrder: number;
  createdAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
}

interface OperationsPanelProps {
  /** The currently selected conversation session id */
  sessionId: number | null;
  /** Customer display name */
  customerName: string;
  /** Customer initials (for avatar) */
  initials: string;
  /** Agent id from agents.me */
  agentId: number;
  /** Agent name from agents.me */
  agentName: string;
  /** Whether this is a Teams conversation (cleaner) */
  isTeams?: boolean;
  /** Called when user clicks the Call quick action */
  onCallClick?: () => void;
  /** Called when user clicks the Share link quick action */
  onShareLinkClick?: () => void;
  /** Called when user clicks the Notes reference link */
  onNotesClick?: () => void;
  /** Called when user clicks the Timeline reference link */
  onTimelineClick?: () => void;
  /** Notes count to display in the footer */
  notesCount?: number;
  /** Invalidation trigger from SSE — increment to force refetch */
  sseRefetchKey?: number;
}

// ── Stage helpers ──────────────────────────────────────────────────────────────

const STAGE_STYLES: Record<CsMissionStage["status"], {
  border: string;
  bg: string;
  icon: React.ReactNode;
  labelColor: string;
}> = {
  done: {
    border: "border-l-emerald-400",
    bg: "bg-emerald-50/60",
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />,
    labelColor: "text-emerald-700",
  },
  waiting: {
    border: "border-l-amber-400",
    bg: "bg-amber-50/60",
    icon: <Loader2 className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 animate-spin" />,
    labelColor: "text-amber-700",
  },
  ready: {
    border: "border-l-violet-500",
    bg: "bg-violet-50/60",
    icon: <Zap className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />,
    labelColor: "text-violet-700",
  },
  pending: {
    border: "border-l-slate-300",
    bg: "bg-slate-50/60",
    icon: <Circle className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />,
    labelColor: "text-slate-400",
  },
};

const STATUS_BADGE: Record<CsMissionRow["status"], { label: string; className: string }> = {
  active:    { label: "Active",    className: "bg-violet-100 text-violet-700" },
  waiting:   { label: "Waiting",   className: "bg-amber-100 text-amber-700" },
  ready:     { label: "Ready",     className: "bg-emerald-100 text-emerald-700" },
  completed: { label: "Done",      className: "bg-slate-100 text-slate-500" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-400" },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function StageRow({ stage, missionId, onSendReply }: {
  stage: CsMissionStage;
  missionId: number;
  onSendReply?: (text: string, missionId: number) => void;
}) {
  const s = STAGE_STYLES[stage.status];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6 }}
      transition={{ duration: 0.2 }}
      className={`border-l-4 ${s.border} ${s.bg} rounded-r-lg px-3 py-2 flex flex-col gap-1`}
    >
      <div className="flex items-center gap-1.5">
        {s.icon}
        <span className={`text-xs font-semibold ${s.labelColor}`}>{stage.label}</span>
      </div>
      {stage.content && (
        <p className="text-xs text-slate-600 leading-relaxed pl-5">{stage.content}</p>
      )}
      {stage.status === "ready" && stage.suggestedReply && onSendReply && (
        <div className="pl-5 mt-1">
          <p className="text-xs text-slate-500 italic mb-1.5">"{stage.suggestedReply}"</p>
          <button
            onClick={() => onSendReply(stage.suggestedReply!, missionId)}
            className="w-full text-xs font-bold py-2 px-3 rounded-lg text-white transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg, #7C5CFF, #6B4FE0)" }}
          >
            Send to Customer
          </button>
        </div>
      )}
    </motion.div>
  );
}

function MissionCard({
  mission,
  agentId,
  agentName,
  onSendReply,
  onComplete,
  onCancel,
}: {
  mission: CsMissionRow;
  agentId: number;
  agentName: string;
  onSendReply?: (text: string, missionId: number) => void;
  onComplete: (missionId: number) => void;
  onCancel: (missionId: number) => void;
}) {
  const [expanded, setExpanded] = useState(mission.status !== "completed");
  const badge = STATUS_BADGE[mission.status];
  const isCompleted = mission.status === "completed";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.25 }}
      className={`rounded-2xl overflow-hidden transition-all ${
        isCompleted
          ? "opacity-60"
          : mission.status === "ready"
          ? "ring-2 ring-violet-400 shadow-lg shadow-violet-100"
          : "shadow-sm"
      }`}
      style={{
        background: "#FFFFFF",
        border: isCompleted ? "1px solid rgba(16,24,40,.06)" : "1.5px solid rgba(124,92,255,.15)",
      }}
    >
      {/* Card header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {mission.emoji && (
            <span className="text-base leading-none flex-shrink-0">{mission.emoji}</span>
          )}
          <span className="text-sm font-bold text-slate-800 truncate">{mission.title}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>
            {badge.label}
          </span>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
            : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          }
        </div>
      </button>

      {/* Expandable body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 flex flex-col gap-2">
              {/* Stage pipeline */}
              {mission.stages.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <AnimatePresence mode="popLayout">
                    {mission.stages.map(stage => (
                      <StageRow
                        key={stage.id}
                        stage={stage}
                        missionId={mission.id}
                        onSendReply={onSendReply}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">No stages yet.</p>
              )}

              {/* Action row */}
              {!isCompleted && (
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => onComplete(mission.id)}
                    className="flex-1 text-xs font-semibold py-1.5 px-3 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    ✓ Mark Done
                  </button>
                  <button
                    onClick={() => onCancel(mission.id)}
                    className="text-xs font-semibold py-1.5 px-3 rounded-lg bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── New Mission Form ───────────────────────────────────────────────────────────

const QUICK_TEMPLATES = [
  { emoji: "🚕", title: "Get ETA" },
  { emoji: "🔑", title: "Send Gate Code" },
  { emoji: "💬", title: "Follow-up Needed" },
  { emoji: "💳", title: "Payment Question" },
  { emoji: "🛏", title: "Room Change Request" },
  { emoji: "📋", title: "Special Instructions" },
];

function NewMissionForm({
  onSubmit,
  onCancel,
  isLoading,
}: {
  onSubmit: (title: string, emoji: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("📌");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: "#F8F6FF", border: "1.5px solid rgba(124,92,255,.25)" }}
    >
      <p className="text-xs font-bold text-violet-700 uppercase tracking-wide">New Mission</p>

      {/* Quick templates */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_TEMPLATES.map(t => (
          <button
            key={t.title}
            type="button"
            onClick={() => { setEmoji(t.emoji); setTitle(t.title); }}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
              title === t.title
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
            }`}
          >
            {t.emoji} {t.title}
          </button>
        ))}
      </div>

      {/* Custom title input */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && title.trim()) onSubmit(title.trim(), emoji);
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Custom mission title..."
          className="flex-1 text-sm px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!title.trim() || isLoading}
          onClick={() => title.trim() && onSubmit(title.trim(), emoji)}
          className="flex-1 text-sm font-bold py-2 rounded-xl text-white disabled:opacity-50 transition-all active:scale-95"
          style={{ background: "linear-gradient(135deg, #7C5CFF, #6B4FE0)" }}
        >
          {isLoading ? "Creating..." : "Create Mission"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-semibold py-2 px-4 rounded-xl bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function OperationsPanel({
  sessionId,
  customerName,
  initials,
  agentId,
  agentName,
  isTeams = false,
  onCallClick,
  onShareLinkClick,
  onNotesClick,
  onTimelineClick,
  notesCount = 0,
  sseRefetchKey = 0,
}: OperationsPanelProps) {
  const [showNewForm, setShowNewForm] = useState(false);
  const utils = trpc.useUtils();

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: missions = [], isLoading } = trpc.csMissions.listBySession.useQuery(
    { sessionId: sessionId! },
    {
      enabled: !!sessionId,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    }
  );

  // Refetch when SSE fires a cs_mission_update for this session
  const prevRefetchKey = useRef(sseRefetchKey);
  useEffect(() => {
    if (sseRefetchKey !== prevRefetchKey.current && sessionId) {
      prevRefetchKey.current = sseRefetchKey;
      utils.csMissions.listBySession.invalidate({ sessionId });
    }
  }, [sseRefetchKey, sessionId, utils]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMission = trpc.csMissions.create.useMutation({
    onSuccess: (data) => {
      console.log("[Operations] mission created", data);
      setShowNewForm(false);
      if (sessionId) utils.csMissions.listBySession.invalidate({ sessionId });
    },
    onError: (err) => {
      console.error("[Operations] create failed", err);
      toast.error(err.message || "Could not create mission");
    },
  });

  const completeMission = trpc.csMissions.complete.useMutation({
    onSuccess: () => {
      if (sessionId) utils.csMissions.listBySession.invalidate({ sessionId });
    },
  });

  const cancelMission = trpc.csMissions.cancel.useMutation({
    onSuccess: () => {
      if (sessionId) utils.csMissions.listBySession.invalidate({ sessionId });
    },
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeMissions = missions.filter(m => m.status !== "completed" && m.status !== "cancelled");
  const completedMissions = missions.filter(m => m.status === "completed");

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleCreate(title: string, emoji: string) {
    if (!hasValidContext || !sessionId) {
      toast.error("Select a customer conversation before creating a mission");
      return;
    }
    createMission.mutate({ sessionId, title, emoji });
  }

  function handleSendReply(text: string, missionId: number) {
    // Bubble up to CsInbox to pre-fill the composer
    // For now, copy to clipboard as a fallback
    navigator.clipboard?.writeText(text).catch(() => {});
    // TODO: wire to CsInbox composer via callback prop
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  const isEmpty = !isLoading && activeMissions.length === 0 && !showNewForm;
  // ── Context validity ─────────────────────────────────────────────────────
  // agentId is resolved server-side from ctx.agent — only sessionId is required client-side
  const hasValidContext = !!sessionId;

  return (
    <div
      className="h-full rounded-[28px] overflow-hidden flex flex-col"
      style={{
        background: "#FBFBFC",
        border: "1px solid rgba(16,24,40,.06)",
        boxShadow: "0 10px 28px rgba(15,23,42,.05)",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "24px 24px 20px",
          background: "#FFFFFF",
          borderBottom: "1px solid rgba(16,24,40,.06)",
          flexShrink: 0,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar */}
            <div
              className="flex-shrink-0 flex items-center justify-center text-white font-black text-sm rounded-2xl"
              style={{
                width: 44,
                height: 44,
                background: isTeams
                  ? "linear-gradient(135deg,#14b8a6,#10b981)"
                  : "linear-gradient(135deg,#7C5CFF,#A78BFA)",
                boxShadow: isTeams
                  ? "0 6px 16px rgba(16,185,129,.22)"
                  : "0 6px 16px rgba(124,92,255,.22)",
              }}
            >
              {initials}
            </div>
            <div className="min-w-0">
              <div
                className="font-black text-slate-900 truncate"
                style={{ fontSize: 17, letterSpacing: "-0.03em", lineHeight: 1.2 }}
              >
                {customerName}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: "#7C5CFF" }}
                >
                  Operations
                </span>
                {activeMissions.length > 0 && (
                  <span
                    className="text-[10px] font-black px-1.5 py-0.5 rounded-full text-white"
                    style={{ background: "#7C5CFF" }}
                  >
                    {activeMissions.length}
                  </span>
                )}
                {/* DIAGNOSTIC — remove after verification */}
                <span className="text-[9px] text-slate-400 font-mono ml-1">
                  sid={sessionId ?? "∅"} aid={agentId || "∅"}
                </span>
              </div>
            </div>
          </div>

          {/* New mission button */}
          {!showNewForm && (
            <button
              type="button"
              disabled={!hasValidContext}
              onClick={() => hasValidContext && setShowNewForm(true)}
              className="flex-shrink-0 flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg,#7C5CFF,#6B4FE0)" }}
              title={!hasValidContext ? "Select a customer conversation first" : undefined}
            >
              <Plus className="w-3 h-3" />
              New
            </button>
          )}
        </div>
      </div>

      {/* ── Mission list (scrollable) ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {/* No session selected — show empty state and block all creation */}
        {!hasValidContext && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
              style={{ background: "rgba(124,92,255,.08)" }}
            >
              💬
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">No conversation selected</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Select a customer conversation to view and create missions
              </p>
            </div>
          </div>
        )}
        {/* New mission form */}
        <AnimatePresence>
          {showNewForm && (
            <NewMissionForm
              key="new-form"
              onSubmit={handleCreate}
              onCancel={() => setShowNewForm(false)}
              isLoading={createMission.isPending}
            />
          )}
        </AnimatePresence>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="flex flex-col gap-3">
            {[1, 2].map(i => (
              <div
                key={i}
                className="h-16 rounded-2xl animate-pulse"
                style={{ background: "rgba(124,92,255,.06)" }}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center gap-3 py-10 text-center"
          >
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
              style={{ background: "rgba(124,92,255,.08)" }}
            >
              🎯
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">No active operations</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Create a mission to track work for this conversation
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewForm(true)}
              className="text-xs font-bold px-4 py-2 rounded-xl text-white transition-all hover:opacity-90"
              style={{ background: "linear-gradient(135deg,#7C5CFF,#6B4FE0)" }}
            >
              + Create Mission
            </button>
          </motion.div>
        )}

        {/* Active missions */}
        <AnimatePresence mode="popLayout">
          {activeMissions.map(mission => (
            <MissionCard
              key={mission.id}
              mission={mission as CsMissionRow}
              agentId={agentId}
              agentName={agentName}
              onSendReply={handleSendReply}
              onComplete={id => completeMission.mutate({ missionId: id })}
              onCancel={id => cancelMission.mutate({ missionId: id })}
            />
          ))}
        </AnimatePresence>

        {/* Completed missions (collapsed by default) */}
        {completedMissions.length > 0 && (
          <details className="group">
            <summary className="text-xs font-semibold text-slate-400 cursor-pointer select-none hover:text-slate-600 transition-colors list-none flex items-center gap-1.5 py-1">
              <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
              {completedMissions.length} completed
            </summary>
            <div className="flex flex-col gap-2 mt-2">
              <AnimatePresence>
                {completedMissions.map(mission => (
                  <MissionCard
                    key={mission.id}
                    mission={mission as CsMissionRow}
                    agentId={agentId}
                    agentName={agentName}
                    onComplete={id => completeMission.mutate({ missionId: id })}
                    onCancel={id => cancelMission.mutate({ missionId: id })}
                  />
                ))}
              </AnimatePresence>
            </div>
          </details>
        )}
      </div>

      {/* ── Reference footer ────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex flex-col gap-0"
        style={{
          borderTop: "1px solid rgba(16,24,40,.06)",
          background: "#FFFFFF",
        }}
      >
        {/* Reference links */}
        <div className="flex divide-x divide-slate-100">
          <button
            type="button"
            onClick={onNotesClick}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
          >
            <StickyNote className="w-3.5 h-3.5" />
            Notes{notesCount > 0 ? ` (${notesCount})` : ""}
          </button>
          <button
            type="button"
            onClick={onTimelineClick}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
          >
            <History className="w-3.5 h-3.5" />
            Timeline
          </button>
        </div>

        {/* Quick actions */}
        <div
          className="flex divide-x"
          style={{ borderTop: "1px solid rgba(16,24,40,.06)", divideColor: "rgba(16,24,40,.06)" }}
        >
          {onCallClick && (
            <button
              type="button"
              onClick={onCallClick}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Phone className="w-3.5 h-3.5 text-emerald-500" />
              Call
            </button>
          )}
          {onShareLinkClick && (
            <button
              type="button"
              onClick={onShareLinkClick}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Link2 className="w-3.5 h-3.5 text-violet-500" />
              Share Link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default OperationsPanel;
