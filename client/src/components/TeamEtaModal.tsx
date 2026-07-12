/**
 * TeamEtaModal.tsx
 * Pixel-perfect implementation of the approved Team ETA design.
 * Design source: team-eta-react-tailwind.zip / TeamEtaModal.tsx
 */
import React, { useMemo, useState, useRef } from "react";
import {
  AlertTriangle,
  CarFront,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  MessageCircle,
  Phone,
  PhoneMissed,
  Play,
  RefreshCw,
  Send,
  Users,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

// ── Helpers ───────────────────────────────────────────────────────────────────
function getTodayDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function formatTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}

function getInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ── Types ─────────────────────────────────────────────────────────────────────
type EtaStatus = "on_time" | "running_late" | "early" | "unclear" | "no_answer" | "pending";

interface EtaCall {
  step: string | null;
  resultType: "success" | "no_answer" | "unclear" | "dispatcher_needed";
  etaTimeStr: string | null;
  etaStatus: string | null;
  cleanerStatement: string | null;
  clientNotified: boolean;
  smsSentBody: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  createdAt: Date;
}

interface TeamJob {
  id: number;
  customerName: string | null;
  customerPhone: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
  jobStatus: string | null;
  delayMinutes: number;
  arrivedAt: Date | null;
  completedAt: Date | null;
  etaCall: EtaCall | null;
}

interface TeamEtaSummaryItem {
  teamName: string;
  cleanerName: string;
  cleanerPhone: string | null;
  etaStatus: EtaStatus;
  delayMinutes: number;
  etaTimestamp: number | null;
  etaConfidence: number | null;
  etaCallFiredAt: Date | null;
  currentJobId: number;
  currentJobAddress: string | null;
  currentJobServiceDateTime: string | null;
  currentJobStatus: string | null | undefined;
  arrivedAt: Date | null;
  completedAt: Date | null;
  etaCall: EtaCall | null;
  jobs: TeamJob[];
}

// ── State styles (from design file) ──────────────────────────────────────────
const STATE_STYLES: Record<EtaStatus, { accent: string; soft: string; text: string; border: string; label: string }> = {
  on_time:      { accent: "#1FA55B", soft: "#F1FBF5", text: "#147A43", border: "#CDEFD9", label: "On Time" },
  early:        { accent: "#1FA55B", soft: "#F1FBF5", text: "#147A43", border: "#CDEFD9", label: "Arriving Early" },
  running_late: { accent: "#F97316", soft: "#FFF7ED", text: "#C2410C", border: "#FED7AA", label: "Running Late" },
  unclear:      { accent: "#7C5CFC", soft: "#F7F5FF", text: "#5B3FD6", border: "#DDD6FE", label: "Unclear ETA" },
  no_answer:    { accent: "#3B82F6", soft: "#F2F7FF", text: "#1D4ED8", border: "#BFDBFE", label: "No Answer" },
  pending:      { accent: "#94A3B8", soft: "#F8FAFC", text: "#64748B", border: "#E2E8F0", label: "Pending" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function HouseIcon({ roof = "#8FB7E7", muted = false, completed = false }: { roof?: string; muted?: boolean; completed?: boolean }) {
  return (
    <div className="relative">
      <svg viewBox="0 0 64 64" className={`h-12 w-12 drop-shadow-sm ${muted ? "opacity-40 grayscale-[30%]" : ""}`}>
        <path d="M8 31 32 12l24 19v25H8Z" fill="#FFFDF8" stroke="#334155" strokeWidth="2.2" />
        <path d="M5 32 32 9l27 23-4 5L32 17 9 37Z" fill={roof} stroke="#334155" strokeWidth="2.2" />
        <rect x="27" y="37" width="11" height="19" rx="1.5" fill="#F2C6A0" stroke="#334155" strokeWidth="2" />
        <rect x="13" y="37" width="9" height="9" rx="1" fill="#DDF3FF" stroke="#334155" strokeWidth="1.7" />
        <rect x="43" y="37" width="9" height="9" rx="1" fill="#DDF3FF" stroke="#334155" strokeWidth="1.7" />
        <path d="M10 56h44" stroke="#80B98E" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {completed && (
        <span className="absolute -bottom-1 -left-1 grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white shadow">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      )}
    </div>
  );
}

function VanIcon() {
  return (
    <svg viewBox="0 0 84 48" className="h-11 w-[76px] drop-shadow-md" style={{ animation: "etaFloat 2.4s ease-in-out infinite" }}>
      <path d="M13 13h44l13 10v13H8V19a6 6 0 0 1 5-6Z" fill="#FFF" stroke="#26364D" strokeWidth="2.5" />
      <path d="M57 13v11h13L57 13Z" fill="#BDE6FF" stroke="#26364D" strokeWidth="2.5" />
      <rect x="17" y="18" width="19" height="12" rx="2" fill="#D8F1FF" />
      <circle cx="22" cy="38" r="6" fill="#26364D" />
      <circle cx="59" cy="38" r="6" fill="#26364D" />
      <rect x="41" y="15" width="12" height="12" rx="3" fill="#111827" />
      <text x="47" y="24" textAnchor="middle" fontSize="8" fontWeight="700" fill="white">MIB</text>
    </svg>
  );
}

function ConfidenceRing({ value, color }: { value: number; color: string }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(value, 100)) / 100) * c;
  return (
    <div className="relative h-[76px] w-[76px]">
      <svg className="-rotate-90" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#E8ECF2" strokeWidth="6" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-base font-extrabold">{value ? `${value}%` : "—"}</div>
    </div>
  );
}

const ROOF_COLORS = ["#80D8A6", "#8FB7E7", "#F6B27B", "#B9A7F8", "#F4C56B"];

function Timeline({ team }: { team: TeamEtaSummaryItem }) {
  const s = STATE_STYLES[team.etaStatus];
  const jobs = team.jobs;
  const currentIdx = jobs.findIndex(j =>
    j.jobStatus !== "completed" && j.jobStatus !== "cancelled"
  );
  const activeIdx = currentIdx === -1 ? jobs.length - 1 : currentIdx;
  const progress = jobs.length <= 1 ? 0 : (activeIdx / (jobs.length - 1)) * 100;

  return (
    <div className="relative min-w-0 flex-1 px-5 pb-2 pt-3">
      {/* Track */}
      <div className="absolute left-[8%] right-[8%] top-[93px] h-[3px] rounded-full bg-slate-200" />
      <div
        className="absolute left-[8%] top-[93px] h-[3px] rounded-full"
        style={{ width: `calc(${Math.max(progress, 5)}% - 8%)`, background: `linear-gradient(90deg,#22C55E,${s.accent})` }}
      />
      <div
        className="relative grid gap-2"
        style={{ gridTemplateColumns: `repeat(${jobs.length}, minmax(110px,1fr))` }}
      >
        {jobs.map((job, idx) => {
          const isCurrent = idx === activeIdx;
          const isDone = job.jobStatus === "completed" || job.jobStatus === "cancelled";
          const isUpcoming = !isCurrent && !isDone;

          // Label above node
          let topLabel: string;
          let topColor: string | undefined;
          if (isCurrent) {
            topLabel = "Current Stop";
            topColor = s.accent;
          } else if (isDone) {
            topLabel = job.completedAt ? `Done ${formatTime(job.completedAt)}` : "Completed";
            topColor = "#15803D";
          } else {
            // Upcoming — show ETA if available, else scheduled time
            topLabel = job.etaCall?.etaTimeStr ? `ETA ${job.etaCall.etaTimeStr}` : formatTime(job.serviceDateTime);
            topColor = job.etaCall?.etaTimeStr
              ? (job.etaCall.etaStatus === "running_late" || job.etaCall.etaStatus === "late" ? "#C2410C" : "#15803D")
              : undefined;
          }

          // ETA time shown below node for current
          let etaDisplay: string | null = null;
          if (isCurrent) {
            etaDisplay = team.etaCall?.etaTimeStr ?? formatTime(team.currentJobServiceDateTime);
          }

          return (
            <div key={job.id} className="flex min-w-0 flex-col items-center text-center">
              {/* Top label */}
              <div
                className="h-8 text-[11px] font-bold uppercase tracking-[0.08em]"
                style={{ color: topColor ?? "#94A3B8" }}
              >
                {topLabel}
              </div>

              {/* ETA time for current */}
              {isCurrent && etaDisplay && (
                <div className="mb-1 text-[18px] font-extrabold" style={{ color: s.text }}>
                  {etaDisplay}
                </div>
              )}
              {(!isCurrent || !etaDisplay) && (
                <div className="mb-1 text-sm font-extrabold text-slate-400">
                  {formatTime(job.serviceDateTime)}
                </div>
              )}

              {/* Node */}
              <div className="relative z-10 flex h-[76px] items-center justify-center">
                {isCurrent ? (
                  <div
                    className="grid h-[72px] w-[72px] place-items-center rounded-full border-[6px] bg-white"
                    style={{
                      borderColor: s.accent,
                      boxShadow: `0 0 0 10px ${s.accent}14`,
                    }}
                  >
                    {team.etaStatus === "unclear" || team.etaStatus === "no_answer" ? (
                      <PhoneMissed className="h-7 w-7" style={{ color: s.accent }} />
                    ) : (
                      <VanIcon />
                    )}
                  </div>
                ) : (
                  <HouseIcon
                    completed={isDone}
                    muted={isUpcoming}
                    roof={ROOF_COLORS[idx % ROOF_COLORS.length]}
                  />
                )}
              </div>

              {/* Customer name */}
              <div className="mt-1 truncate text-sm font-bold">{job.customerName}</div>

              {/* Address city */}
              <div className="truncate text-[12px] text-slate-500">
                {job.jobAddress?.split(",").slice(-2, -1)[0]?.trim() ?? job.jobAddress}
              </div>

              {/* Status pill for current */}
              {isCurrent && team.etaCall?.etaStatus && (
                <div
                  className="mt-2 rounded-full px-3 py-1 text-xs font-bold"
                  style={{ background: s.soft, color: s.text }}
                >
                  {team.etaCall.cleanerStatement
                    ? `${team.delayMinutes > 0 ? `${team.delayMinutes} min late` : "On time"}`
                    : s.label}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCard({ icon, count, label, helper, color, soft }: {
  icon: React.ReactNode; count: number; label: string; helper: string; color: string; soft: string;
}) {
  return (
    <div className="flex min-w-[185px] flex-1 items-center gap-3 rounded-[20px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="grid h-11 w-11 place-items-center rounded-2xl shrink-0" style={{ background: soft, color }}>{icon}</div>
      <div>
        <div className="text-2xl font-extrabold tracking-[-0.04em]">{count}</div>
        <div className="text-sm font-bold" style={{ color }}>{label}</div>
        <div className="mt-0.5 text-[11px] text-slate-400">{helper}</div>
      </div>
    </div>
  );
}

function AudioPlayer({ url, color }: { url: string | null; color: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  function toggle() {
    if (!url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  }

  return (
    <div className="mt-4 flex items-center gap-3 rounded-[18px] border border-indigo-100 bg-white px-3 py-3">
      <button
        onClick={toggle}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white shadow-lg"
        style={{ background: `linear-gradient(135deg, ${color}, #EF4444)`, boxShadow: `0 4px 14px ${color}44` }}
      >
        <Play className="ml-0.5 h-5 w-5 fill-current" />
      </button>
      <div className="flex h-10 flex-1 items-center gap-[3px]">
        {[5, 11, 17, 10, 20, 26, 18, 31, 22, 14, 27, 34, 20, 12, 25, 18, 30, 13, 22, 10].map((h, i) => (
          <span key={i} className="w-[3px] rounded-full" style={{ height: h, background: `linear-gradient(to top, #a5b4fc, #6366f1)` }} />
        ))}
      </div>
      <span className="text-xs font-bold text-slate-400">0:11</span>
    </div>
  );
}

function ExpandedCard({ team }: { team: TeamEtaSummaryItem }) {
  const s = STATE_STYLES[team.etaStatus];
  const initials = getInitials(team.teamName);
  const currentJob = team.jobs.find(j => j.jobStatus !== "completed" && j.jobStatus !== "cancelled") ?? team.jobs[team.jobs.length - 1];
  const scheduledTime = formatTime(currentJob?.serviceDateTime);
  const etaTimeStr = team.etaCall?.etaTimeStr ?? null;
  const confidence = team.etaConfidence ?? 0;

  return (
    <article
      className="overflow-hidden rounded-[26px] border bg-white shadow-[0_16px_50px_rgba(15,23,42,0.08)]"
      style={{ borderColor: s.border }}
    >
      {/* Top section: team info + timeline + confidence */}
      <div className="grid grid-cols-[250px_minmax(0,1fr)_110px] gap-2 border-b border-slate-100 px-5 py-5">
        {/* Left: team identity */}
        <div className="relative border-r border-slate-100 pr-5">
          <div className="absolute -left-5 -top-5 h-[calc(100%+40px)] w-1 rounded-r-full" style={{ background: s.accent }} />
          <div className="flex items-center gap-3">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-lg font-extrabold text-slate-600">
              {initials}
            </div>
            <div>
              <h3 className="text-xl font-extrabold tracking-[-0.03em]">{team.teamName}</h3>
              <span
                className="mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-bold"
                style={{ background: s.soft, borderColor: s.border, color: s.text }}
              >
                {s.label}
              </span>
            </div>
          </div>
          <div className="mt-5 space-y-2 text-sm text-slate-500">
            <div className="flex items-center gap-2"><Users className="h-4 w-4" /> {team.jobs.length} jobs today</div>
            <div className="flex items-center gap-2"><CarFront className="h-4 w-4" /> {team.cleanerName}</div>
          </div>
        </div>

        {/* Center: timeline */}
        <Timeline team={team} />

        {/* Right: confidence ring */}
        <div className="flex flex-col items-center justify-center border-l border-slate-100 pl-3">
          <ConfidenceRing value={confidence} color={s.accent} />
          <div className="mt-1 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">ETA Confidence</div>
        </div>
      </div>

      {/* Bottom 3-column section */}
      <div className="grid grid-cols-3 gap-3 bg-slate-50/70 p-5">
        {/* Col 1: ETA & Status */}
        <section className="rounded-[22px] border p-5" style={{ background: s.soft, borderColor: s.border }}>
          <div className="text-[11px] font-extrabold uppercase tracking-[0.16em]" style={{ color: s.text }}>ETA &amp; Status</div>
          <div className="mt-4 text-[40px] font-black tracking-[-0.05em]" style={{ color: s.text }}>
            {etaTimeStr ?? scheduledTime}
          </div>
          <div
            className="mt-2 inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1.5 text-xs font-bold"
            style={{ borderColor: s.border, color: s.text }}
          >
            <Clock3 className="h-3.5 w-3.5" />
            {s.label}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t pt-4 text-sm" style={{ borderColor: s.border }}>
            <div>
              <div className="text-xs text-slate-400">Scheduled</div>
              <div className="mt-1 font-bold">{scheduledTime}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Original ETA</div>
              <div className="mt-1 font-bold">{etaTimeStr ?? scheduledTime}</div>
            </div>
          </div>
        </section>

        {/* Col 2: Cleaner Update */}
        <section className="rounded-[22px] border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5">
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-indigo-600">
            <MessageCircle className="h-4 w-4" />
            Cleaner Update
          </div>
          <div className="mt-4 rounded-[20px] rounded-tl-md bg-indigo-100/80 p-4 text-[15px] font-semibold italic leading-6">
            "{team.etaCall?.cleanerStatement ?? "No clear ETA was provided."}"
          </div>
          {team.etaCall?.recordingUrl ? (
            <AudioPlayer url={team.etaCall.recordingUrl} color={s.accent} />
          ) : (
            <div className="mt-4 rounded-[18px] border border-indigo-100 bg-white px-4 py-3 text-xs text-slate-400">
              No recording available
            </div>
          )}
        </section>

        {/* Col 3: Customer Notified */}
        <section className="rounded-[22px] border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5">
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Customer Notified
          </div>
          {team.etaCall?.smsSentBody ? (
            <>
              <div className="mt-4 rounded-[20px] rounded-bl-md bg-emerald-100/80 p-4 text-sm leading-6 shadow-sm">
                {team.etaCall.smsSentBody}
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Delivered {team.etaCall.createdAt ? formatTime(new Date(team.etaCall.createdAt)) : "just now"}
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-[20px] rounded-bl-md bg-slate-100/80 p-4 text-sm leading-6 text-slate-400">
              Customer update pending.
            </div>
          )}
        </section>
      </div>

      {/* Footer: action buttons */}
      <div className="flex items-center justify-between border-t border-slate-100 bg-white px-5 py-3">
        <div className="text-sm font-semibold text-slate-400">
          {team.jobs.length} jobs today · {team.cleanerPhone ?? "No phone"}
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold hover:bg-slate-50 transition-colors">
            <Phone className="h-4 w-4" /> Call Cleaner
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white shadow-lg transition-colors"
            style={{ background: `linear-gradient(135deg, ${s.accent}, #EF4444)`, boxShadow: `0 4px 14px ${s.accent}44` }}
          >
            <Send className="h-4 w-4" /> Send Update
          </button>
        </div>
      </div>
    </article>
  );
}

function CollapsedRow({ team, onClick }: { team: TeamEtaSummaryItem; onClick: () => void }) {
  const s = STATE_STYLES[team.etaStatus];
  const jobs = team.jobs;
  const currentIdx = jobs.findIndex(j => j.jobStatus !== "completed" && j.jobStatus !== "cancelled");
  const activeIdx = currentIdx === -1 ? jobs.length - 1 : currentIdx;

  return (
    <button
      onClick={onClick}
      className="grid w-full grid-cols-[260px_minmax(0,1fr)_90px_36px] items-center gap-4 rounded-[22px] border border-slate-200/80 bg-white px-4 py-3 text-left shadow-[0_7px_22px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]"
    >
      {/* Team identity */}
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 font-extrabold text-slate-600">
          {getInitials(team.teamName)}
        </div>
        <div>
          <div className="font-extrabold">{team.teamName}</div>
          <span className="mt-1 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: s.soft, color: s.text }}>
            {s.label}
          </span>
        </div>
      </div>

      {/* Mini timeline */}
      <div className="flex min-w-0 items-center">
        {jobs.map((job, idx) => (
          <React.Fragment key={job.id}>
            <div className="flex min-w-[76px] flex-col items-center">
              {idx === activeIdx ? (
                <div
                  className="grid h-9 w-9 place-items-center rounded-full border-4 bg-white"
                  style={{ borderColor: s.accent }}
                >
                  {team.etaStatus === "unclear" || team.etaStatus === "no_answer"
                    ? <PhoneMissed className="h-4 w-4" style={{ color: s.accent }} />
                    : <CarFront className="h-4 w-4" style={{ color: s.accent }} />
                  }
                </div>
              ) : (
                <HouseIcon
                  muted={idx > activeIdx}
                  completed={idx < activeIdx || job.jobStatus === "completed"}
                />
              )}
              <div className="mt-1 text-[10px] font-bold text-slate-500">
                {idx === activeIdx
                  ? (job.etaCall?.etaTimeStr ? `ETA ${job.etaCall.etaTimeStr}` : formatTime(job.serviceDateTime))
                  : formatTime(job.serviceDateTime)
                }
              </div>
            </div>
            {idx < jobs.length - 1 && (
              <div
                className="mx-1 h-[2px] min-w-[28px] flex-1 rounded-full"
                style={{ background: idx < activeIdx ? s.accent : "#D9DEE7" }}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Confidence ring */}
      <ConfidenceRing value={team.etaConfidence ?? 0} color={s.accent} />

      {/* Chevron */}
      <ChevronRight className="h-5 w-5 text-slate-400" />
    </button>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
interface TeamEtaModalProps {
  open: boolean;
  onClose: () => void;
}

export function TeamEtaModal({ open, onClose }: TeamEtaModalProps) {
  const today = useMemo(() => getTodayDate(), []);
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: teams, isLoading, refetch } = trpc.fieldMgmt.getTeamEtaSummary.useQuery(
    { date: today },
    { enabled: open, refetchInterval: open ? 60_000 : false }
  );

  // Auto-select first team when data loads
  const teamsArr = teams ?? [];
  const activeTeam = teamsArr.find(t => t.teamName === activeId) ?? teamsArr[0] ?? null;

  const counts = useMemo(() => ({
    on_time: teamsArr.filter(t => t.etaStatus === "on_time" || t.etaStatus === "early").length,
    running_late: teamsArr.filter(t => t.etaStatus === "running_late").length,
    unclear: teamsArr.filter(t => t.etaStatus === "unclear").length,
    no_answer: teamsArr.filter(t => t.etaStatus === "no_answer").length,
    pending: teamsArr.filter(t => t.etaStatus === "pending").length,
  }), [teamsArr]);

  const movingCount = teamsArr.filter(t =>
    t.currentJobStatus === "on_the_way" || t.currentJobStatus === "in_progress" ||
    t.currentJobStatus === "finishing_up" || t.currentJobStatus === "wrapping_up"
  ).length;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <style>{`@keyframes etaFloat{0%,100%{transform:translateY(0) translateX(0)}50%{transform:translateY(-2px) translateX(2px)}}`}</style>

      <div
        className="flex h-[calc(100vh-32px)] w-full max-w-[1540px] flex-col overflow-hidden rounded-[30px] border border-white/80 font-sans text-slate-900"
        style={{ background: "radial-gradient(circle at top left,#EAF1FF 0%,#F7F9FC 35%,#EEF2F7 100%)" }}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-8 py-5 shrink-0">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-orange-500">
              <Clock3 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-[30px] font-black tracking-[-0.05em]">Team ETA</h1>
              <p className="text-sm font-medium text-slate-500">Live arrival updates for today's jobs</p>
            </div>
          </div>
          <div className="flex items-center gap-5 text-sm font-semibold text-slate-400">
            <span className="flex items-center gap-2"><Clock3 className="h-4 w-4" /> Eastern Time (ET)</span>
            <span>{movingCount > 0 ? `${movingCount} team${movingCount > 1 ? "s" : ""} moving` : "Updated"}</span>
            <button onClick={() => refetch()} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-slate-100">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Scrollable main */}
        <main className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
          {/* Sticky summary + filter bar */}
          <section className="sticky top-0 z-20 -mx-8 px-8 pb-4 pt-5" style={{ background: "rgba(247,249,252,0.95)", backdropFilter: "blur(12px)" }}>
            <div className="flex gap-3 overflow-x-auto pb-1">
              <SummaryCard icon={<CheckCircle2 className="h-5 w-5" />} count={counts.on_time} label="On Time" helper="Ahead or on schedule" color="#1FA55B" soft="#F1FBF5" />
              <SummaryCard icon={<Clock3 className="h-5 w-5" />} count={counts.running_late} label="Running Late" helper="10–30 min late" color="#F59E0B" soft="#FFF8EE" />
              <SummaryCard icon={<AlertTriangle className="h-5 w-5" />} count={0} label="Significantly Late" helper="30+ min late" color="#EF4444" soft="#FFF2F2" />
              <SummaryCard icon={<MessageCircle className="h-5 w-5" />} count={counts.unclear} label="Unclear" helper="Awaiting update" color="#7C5CFC" soft="#F7F5FF" />
              <SummaryCard icon={<PhoneMissed className="h-5 w-5" />} count={counts.no_answer} label="No Answer" helper="No response yet" color="#3B82F6" soft="#F2F7FF" />
            </div>

            {/* Team filter tabs */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-bold text-white">
                <Users className="h-4 w-4" /> All Teams <span className="text-white/60">{teamsArr.length}</span>
              </button>
              {teamsArr.map(team => {
                const isActive = team.teamName === (activeTeam?.teamName ?? "");
                return (
                  <button
                    key={team.teamName}
                    onClick={() => setActiveId(team.teamName)}
                    className={`inline-flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-bold transition ${
                      isActive ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] ${isActive ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"}`}>
                      {getInitials(team.teamName)}
                    </span>
                    {team.teamName}
                    <span className={isActive ? "text-white/55" : "text-slate-400"}>{team.jobs.length} jobs</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-slate-400">Loading teams…</div>
          ) : teamsArr.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-slate-400">No teams scheduled today.</div>
          ) : (
            <div className="space-y-3">
              {activeTeam && <ExpandedCard team={activeTeam} />}
              {teamsArr.filter(t => t.teamName !== activeTeam?.teamName).map(team => (
                <CollapsedRow key={team.teamName} team={team} onClick={() => setActiveId(team.teamName)} />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default TeamEtaModal;
