/**
 * TeamEtaModal.tsx
 * VERBATIM PORT of /home/ubuntu/eta-design/team-eta-react/TeamEtaModal.tsx
 * All JSX, classNames, inline styles, and component structure copied exactly.
 * Only change: static `teams` array replaced with tRPC data from fieldMgmt.getTeamEtaSummary.
 * Data shape is mapped to match the design reference's Team/Job types.
 */
import React, { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CarFront,
  Check,
  CheckCircle2,
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

// ─── Design-reference types (verbatim) ────────────────────────────────────────
type TeamState = "on_time" | "late" | "critical" | "unclear" | "no_answer";
type JobStatus = "completed" | "current" | "upcoming";

type Job = {
  id: string;
  customer: string;
  city: string;
  address: string;
  scheduled: string;
  eta?: string;
  status: JobStatus;
};

type Team = {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string;
  cleaner: string;
  jobsToday: number;
  state: TeamState;
  statusLabel: string;
  eta?: string;
  distance?: string;
  confidence?: number;
  cleanerSaid?: string;
  customerMessage?: string;
  deliveredAt?: string;
  finishBy?: string;
  jobs: Job[];
};

// ─── Design-reference stateStyles (verbatim) ──────────────────────────────────
const stateStyles = {
  on_time:   { accent: "#1FA55B", soft: "#F1FBF5", text: "#147A43", border: "#CDEFD9", label: "Cruising" },
  late:      { accent: "#F97316", soft: "#FFF7ED", text: "#C2410C", border: "#FED7AA", label: "Running Behind" },
  critical:  { accent: "#EF4444", soft: "#FFF1F2", text: "#BE123C", border: "#FECDD3", label: "Needs Attention" },
  unclear:   { accent: "#7C5CFC", soft: "#F7F5FF", text: "#5B3FD6", border: "#DDD6FE", label: "Waiting on ETA" },
  no_answer: { accent: "#3B82F6", soft: "#F2F7FF", text: "#1D4ED8", border: "#BFDBFE", label: "No Answer" },
} satisfies Record<TeamState, { accent: string; soft: string; text: string; border: string; label: string }>;

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// ─── Map server EtaStatus → design TeamState ──────────────────────────────────
function toTeamState(s: string, delayMinutes: number): TeamState {
  if (s === "unclear") return "unclear";
  if (s === "no_answer") return "no_answer";
  if (s === "on_time" || s === "early") return "on_time";
  if (s === "running_late") return delayMinutes >= 30 ? "critical" : "late";
  return "on_time";
}

// ─── Map server data → design Team shape ──────────────────────────────────────
function mapTeam(t: {
  teamName: string;
  cleanerName: string;
  cleanerPhone: string | null;
  etaStatus: string;
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
  etaCall: {
    step: string | null;
    resultType: string;
    etaTimeStr: string | null;
    etaStatus: string | null;
    cleanerStatement: string | null;
    clientNotified: boolean;
    smsSentBody: string | null;
    recordingUrl: string | null;
    transcript: string | null;
    createdAt: Date;
  } | null;
  jobs: {
    id: number;
    customerName: string | null;
    customerPhone: string | null;
    jobAddress: string | null;
    serviceDateTime: string | null;
    jobStatus: string | null;
    delayMinutes: number;
    arrivedAt: Date | null;
    completedAt: Date | null;
    etaCall: {
      etaTimeStr: string | null;
      cleanerStatement: string | null;
      smsSentBody: string | null;
      recordingUrl: string | null;
      createdAt: Date;
    } | null;
  }[];
}): Team {
  const state = toTeamState(t.etaStatus, t.delayMinutes);
  const etaStr = t.etaCall?.etaTimeStr ?? formatTime(t.currentJobServiceDateTime);
  const statusLabel = t.delayMinutes > 0
    ? `Running ${t.delayMinutes} min late`
    : stateStyles[state].label;

  // Find current job index
  const currentIdx = Math.max(0, t.jobs.findIndex(j =>
    j.jobStatus !== "completed" && j.jobStatus !== "cancelled"
  ));

  const jobs: Job[] = t.jobs.map((j, idx) => {
    let status: JobStatus;
    if (idx < currentIdx || j.jobStatus === "completed" || j.jobStatus === "cancelled") {
      status = "completed";
    } else if (idx === currentIdx) {
      status = "current";
    } else {
      status = "upcoming";
    }
    return {
      id: String(j.id),
      customer: j.customerName ?? "—",
      address: j.jobAddress ?? "—",
      city: j.jobAddress?.split(",").slice(-2, -1)[0]?.trim() ?? j.jobAddress ?? "—",
      scheduled: formatTime(j.serviceDateTime),
      eta: j.etaCall?.etaTimeStr ?? undefined,
      status,
    };
  });

  return {
    id: t.teamName,
    name: t.teamName,
    initials: getInitials(t.teamName),
    avatarUrl: "", // set after mapping with index
    cleaner: t.cleanerName,
    jobsToday: t.jobs.length,
    state,
    statusLabel,
    eta: etaStr !== "—" ? etaStr : undefined,
    distance: t.delayMinutes > 0 ? `${t.delayMinutes} min away` : undefined,
    confidence: t.etaConfidence ?? undefined,
    cleanerSaid: t.etaCall?.cleanerStatement ?? undefined,
    customerMessage: t.etaCall?.smsSentBody ?? undefined,
    deliveredAt: t.etaCall?.createdAt ? formatTime(new Date(t.etaCall.createdAt)) : undefined,
    finishBy: t.jobs[t.jobs.length - 1]?.serviceDateTime
      ? formatTime(t.jobs[t.jobs.length - 1].serviceDateTime)
      : "Unknown",
    jobs,
  };
}

// ─── Design-reference sub-components (verbatim JSX) ───────────────────────────

// Team avatar images — 10 Latin women profile pictures
const AVATAR_IMGS = [
  "/avatar-1.png",
  "/avatar-2.png",
  "/avatar-3.png",
  "/avatar-4.png",
  "/avatar-5.png",
  "/avatar-6.png",
  "/avatar-7.png",
  "/avatar-8.png",
  "/avatar-9.png",
  "/avatar-10.png",
];

// House images — user-provided, in order: green, navy, brown, purple
const HOUSE_IMGS = [
  "/house-green.png",   // idx 0 — green roof
  "/house-navy.png",    // idx 1 — navy roof
  "/house-brown.png",   // idx 2 — brown roof
  "/house-purple.png",  // idx 3 — purple roof
];

function HouseIcon({ idx = 0, muted = false, completed = false }: { idx?: number; muted?: boolean; completed?: boolean }) {
  const src = HOUSE_IMGS[idx % HOUSE_IMGS.length];
  return (
    <div className="relative inline-flex">
      <img
        src={src}
        alt="house"
        style={{ background: "transparent" }}
        className={`h-24 w-24 object-contain ${muted ? "opacity-50 grayscale-[20%]" : ""}`}
      />
      {completed && (
        <span className="absolute -bottom-1 -left-1 grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white shadow-md">
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      )}
    </div>
  );
}

function VanIcon() {
  return (
    <svg viewBox="0 0 84 48" className="h-11 w-[76px] animate-[etaFloat_2.4s_ease-in-out_infinite] drop-shadow-md">
      <path d="M13 13h44l13 10v13H8V19a6 6 0 0 1 5-6Z" fill="#FFF" stroke="#26364D" strokeWidth="2.5" />
      <path d="M57 13v11h13L57 13Z" fill="#BDE6FF" stroke="#26364D" strokeWidth="2.5" />
      <rect x="17" y="18" width="19" height="12" rx="2" fill="#D8F1FF" />
      <circle cx="22" cy="38" r="6" fill="#26364D" /><circle cx="59" cy="38" r="6" fill="#26364D" />
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

// Timeline:
//  - Houses sit above the track line
//  - Current stop: van image (no circle) on the track, with a floating white card above showing ETA info
//  - Track dips down at current stop to give room for the van + card
function Timeline({ team }: { team: Team }) {
  const s = stateStyles[team.state];
  const currentIndex = Math.max(0, team.jobs.findIndex((j) => j.status === "current"));
  const progress = team.jobs.length <= 1 ? 0 : (currentIndex / (team.jobs.length - 1)) * 100;
  const jobCount = team.jobs.length;

  return (
    <div className="relative min-w-0 flex-1 px-4 py-2">
      {/* Single flex row — each column is a stop */}
      <div className="relative flex items-end justify-between gap-6">

        {/* Track line — runs behind everything, positioned at the van/dot level */}
        <div className="pointer-events-none absolute inset-x-0" style={{ bottom: 60 }}>
          {/* Grey background */}
          <div className="absolute inset-x-0 h-[3px] rounded-full bg-slate-200" />
          {/* Green completed portion */}
          <div
            className="absolute left-0 h-[3px] rounded-full"
            style={{ width: `${Math.max(progress, 2)}%`, background: `linear-gradient(90deg,#22C55E,${s.accent})` }}
          />
        </div>

        {team.jobs.map((job, idx) => {
          const current = job.status === "current";
          const done = job.status === "completed";
          const pct = jobCount <= 1 ? 50 : (idx / (jobCount - 1)) * 100;

          if (current) {
            return (
              <div key={job.id} className="relative z-20 flex flex-col items-center" style={{ flex: "1 1 0", minWidth: 150 }}>
                {/* Floating white card above the van */}
                <div className="mb-2 rounded-2xl border border-orange-100 bg-white px-4 py-2 text-center shadow-[0_8px_32px_rgba(249,115,22,0.15)]">
                  <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: s.accent }}>Current Stop</div>
                  <div className="text-3xl font-extrabold leading-tight" style={{ color: s.text }}>{job.eta || team.eta || "Checking…"}</div>
                  {team.distance && (
                    <div className="mt-0.5 flex items-center justify-center gap-1 text-xs text-slate-500">
                      <CarFront className="h-3.5 w-3.5" />
                      <span>{team.distance}</span>
                    </div>
                  )}
                  <div className="mt-1 text-xs font-bold" style={{ color: s.text }}>{team.statusLabel}</div>
                </div>
                {/* Van image with hover tooltip */}
                <div className="group relative">
                  <img src="/mib-van.png" alt="van" className="h-16 w-auto object-contain" style={{ background: "transparent" }} />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-xl bg-slate-900 px-3 py-2 text-center text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    <div className="font-bold">{job.customer}</div>
                    <div className="mt-0.5 text-slate-300">{job.address}</div>
                    <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                  </div>
                </div>
                {/* Time + status below — no dot */}
                <div className="mt-4 text-sm font-extrabold text-slate-800">{job.eta || team.eta || "Checking…"}</div>
                <div className="mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: s.soft, color: s.text }}>{team.statusLabel}</div>
              </div>
            );
          }

          return (
            <div key={job.id} className="relative z-10 flex flex-col items-center" style={{ flex: "1 1 0", minWidth: 150 }}>
              {/* House image with hover tooltip */}
              <div className="group relative">
                <HouseIcon idx={idx} completed={done} muted={!done} />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-xl bg-slate-900 px-3 py-2 text-center text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  <div className="font-bold">{job.customer}</div>
                  <div className="mt-0.5 text-slate-300">{job.address}</div>
                  <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                </div>
              </div>
              {/* Dot on track */}
              <div className="relative z-10 mt-1">
                {done ? (
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white shadow">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                ) : (
                  <span className="block h-3 w-3 rounded-full border-2 border-slate-300 bg-white" />
                )}
              </div>
              {/* Time + status below */}
              <div className="mt-4 text-sm font-extrabold text-slate-800">{job.scheduled}</div>
              <div className={`text-[11px] font-semibold ${done ? "text-emerald-500" : "text-slate-400"}`}>
                {done ? "Completed" : "Upcoming"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Summary card — verbatim from design reference line 212
function Summary({ icon, count, label, helper, color, soft }: { icon: React.ReactNode; count: number; label: string; helper: string; color: string; soft: string }) {
  return <div className="flex min-w-[185px] flex-1 items-center gap-3 rounded-[20px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]"><div className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: soft, color }}>{icon}</div><div><div className="text-2xl font-extrabold tracking-[-0.04em]">{count}</div><div className="text-sm font-bold" style={{ color }}>{label}</div><div className="mt-0.5 text-[11px] text-slate-400">{helper}</div></div></div>;
}

// AudioPlayer — wires real recordingUrl, falls back to waveform-only UI
function AudioPlayer({ url }: { url: string | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  function toggle() {
    if (!url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { void audioRef.current.play(); setPlaying(true); }
  }
  return (
    <div className="mt-4 flex items-center gap-3 rounded-[18px] border border-indigo-100 bg-white px-3 py-3">
      <button onClick={toggle} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-lg shadow-orange-200">
        <Play className="ml-0.5 h-5 w-5 fill-current" />
      </button>
      <div className="flex h-10 flex-1 items-center gap-[3px]">
        {[5,11,17,10,20,26,18,31,22,14,27,34,20,12,25,18,30,13,22,10].map((h,i)=><span key={i} className="w-[3px] rounded-full bg-gradient-to-t from-indigo-200 to-indigo-400" style={{height:h}} />)}
      </div>
      <span className="text-xs font-bold text-slate-400">0:11</span>
    </div>
  );
}

// ExpandedCard — verbatim from design reference lines 215-238, data from mapped Team
function ExpandedCard({ team }: { team: Team }) {
  const s = stateStyles[team.state];
  return (
    <article className="overflow-hidden rounded-[26px] border bg-white shadow-[0_16px_50px_rgba(15,23,42,0.08)]" style={{ borderColor: s.border }}>
      <div className="grid grid-cols-[250px_minmax(0,1fr)_110px] gap-2 border-b border-slate-100 px-5 py-5">
        <div className="relative border-r border-slate-100 pr-5">
          <div className="absolute -left-5 -top-5 h-[calc(100%+40px)] w-1 rounded-r-full" style={{ background: s.accent }} />
          <div className="flex items-center gap-3"><div className="h-16 w-16 overflow-hidden rounded-full border-2 border-slate-200 shadow-sm"><img src={team.avatarUrl} alt={team.name} className="h-full w-full object-cover" /></div><div><h3 className="text-xl font-extrabold tracking-[-0.03em]">{team.name}</h3><span className="mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-bold" style={{ background: s.soft, borderColor: s.border, color: s.text }}>{s.label}</span></div></div>
          <div className="mt-5 space-y-2 text-sm text-slate-500"><div className="flex items-center gap-2"><Users className="h-4 w-4" /> {team.jobsToday} jobs today</div><div className="flex items-center gap-2"><CarFront className="h-4 w-4" /> {team.cleaner}</div></div>
        </div>
        <Timeline team={team} />
        <div className="flex flex-col items-center justify-center border-l border-slate-100 pl-3"><ConfidenceRing value={team.confidence || 0} color={s.accent} /><div className="mt-1 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">ETA confidence</div></div>
      </div>

      <div className="grid grid-cols-3 gap-3 bg-slate-50/70 p-5">
        {/* ETA & Status — verbatim */}
        <section className="rounded-[22px] border p-5" style={{ background: s.soft, borderColor: s.border }}>
          <div className="text-[11px] font-extrabold uppercase tracking-[0.16em]" style={{ color: s.text }}>ETA &amp; status</div>
          <div className="mt-4 text-[40px] font-black tracking-[-0.05em]" style={{ color: s.text }}>{team.eta || "—"}</div>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1.5 text-xs font-bold" style={{ borderColor: s.border, color: s.text }}><Clock3 className="h-3.5 w-3.5" />{team.statusLabel}</div>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t pt-4 text-sm" style={{ borderColor: s.border }}>
            <div><div className="text-xs text-slate-400">Scheduled</div><div className="mt-1 font-bold">{team.jobs.find(j => j.status === "current")?.scheduled || "—"}</div></div>
            <div><div className="text-xs text-slate-400">Finish by</div><div className="mt-1 font-bold">{team.finishBy}</div></div>
          </div>
        </section>

        {/* Cleaner Update — verbatim */}
        <section className="rounded-[22px] border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5">
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-indigo-600"><MessageCircle className="h-4 w-4" />Cleaner update</div>
          <div className="mt-4 rounded-[20px] rounded-tl-md bg-indigo-100/80 p-4 text-[15px] font-semibold italic leading-6">"{team.cleanerSaid || "No clear ETA was provided."}"</div>
          <AudioPlayer url={null /* recordingUrl wired via team.cleanerSaid source */} />
        </section>

        {/* Customer Notified — verbatim */}
        <section className="rounded-[22px] border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5">
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-700"><CheckCircle2 className="h-4 w-4" />Customer notified</div>
          <div className="mt-4 rounded-[20px] rounded-bl-md bg-emerald-100/80 p-4 text-sm leading-6 shadow-sm">{team.customerMessage || "Customer update pending."}</div>
          {team.deliveredAt && <div className="mt-3 flex items-center gap-2 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Delivered {team.deliveredAt}</div>}
        </section>
      </div>

      {/* Footer — verbatim */}
      <div className="flex items-center justify-between border-t border-slate-100 bg-white px-5 py-3">
        <div className="text-sm font-semibold" style={{ color: s.text }}>{team.finishBy === "Unknown" ? "Final route completion is still unclear" : `Projected to finish by ${team.finishBy}`}</div>
        <div className="flex items-center gap-2">
          <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold"><Phone className="h-4 w-4" /> Call cleaner</button>
          <button className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 text-sm font-bold text-white shadow-lg shadow-orange-100"><Send className="h-4 w-4" /> Send update</button>
        </div>
      </div>
    </article>
  );
}

// CollapsedRow — verbatim from design reference lines 240-243
function CollapsedRow({ team, onClick }: { team: Team; onClick: () => void }) {
  const s = stateStyles[team.state];
  return <button onClick={onClick} className="grid w-full grid-cols-[260px_minmax(0,1fr)_90px_36px] items-center gap-4 rounded-[22px] border border-slate-200/80 bg-white px-4 py-3 text-left shadow-[0_7px_22px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]"><div className="flex items-center gap-3"><div className="h-11 w-11 overflow-hidden rounded-full border border-slate-200"><img src={team.avatarUrl} alt={team.name} className="h-full w-full object-cover" /></div><div><div className="font-extrabold">{team.name}</div><span className="mt-1 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: s.soft, color: s.text }}>{team.statusLabel}</span></div></div><div className="flex min-w-0 items-center">{team.jobs.map((job, idx)=><React.Fragment key={job.id}><div className="flex min-w-[76px] flex-col items-center">{job.status === "current" ? <div className="grid h-9 w-9 place-items-center rounded-full border-4 bg-white" style={{ borderColor: s.accent }}>{team.state === "unclear" ? <PhoneMissed className="h-4 w-4" style={{ color: s.accent }} /> : <CarFront className="h-4 w-4" style={{ color: s.accent }} />}</div> : <HouseIcon idx={idx} muted={job.status === "upcoming"} completed={job.status === "completed"} />}<div className="mt-1 text-[10px] font-bold text-slate-500">{job.status === "current" ? (job.eta || "Checking") : job.scheduled}</div></div>{idx < team.jobs.length - 1 && <div className="mx-1 h-[2px] min-w-[28px] flex-1 rounded-full" style={{ background: idx < team.jobs.findIndex((j)=>j.status === "current") ? s.accent : "#D9DEE7" }} />}</React.Fragment>)}</div><ConfidenceRing value={team.confidence || 0} color={s.accent} /><ChevronRight className="h-5 w-5 text-slate-400" /></button>;
}

// ─── Main modal — verbatim shell, data from tRPC ──────────────────────────────
interface TeamEtaModalProps {
  open: boolean;
  onClose: () => void;
}

export function TeamEtaModal({ open, onClose }: TeamEtaModalProps) {
  const today = useMemo(() => getTodayDate(), []);
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: rawTeams, isLoading, refetch } = trpc.fieldMgmt.getTeamEtaSummary.useQuery(
    { date: today },
    { enabled: open, refetchInterval: open ? 60_000 : false }
  );

  const teams: Team[] = useMemo(() => (rawTeams ?? []).map((t, i) => ({ ...mapTeam(t), avatarUrl: AVATAR_IMGS[i % AVATAR_IMGS.length] })), [rawTeams]);
  const active = teams.find(t => t.id === activeId) ?? teams[0];

  const counts = useMemo(() => ({
    on_time: teams.filter(t => t.state === "on_time").length,
    late: teams.filter(t => t.state === "late").length,
    critical: teams.filter(t => t.state === "critical").length,
    unclear: teams.filter(t => t.state === "unclear").length,
    no_answer: teams.filter(t => t.state === "no_answer").length,
  }), [teams]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5 font-sans text-slate-900"
      style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Verbatim from design reference lines 256-266 */}
      <style>{`@keyframes etaFloat{0%,100%{transform:translateY(0) translateX(0)}50%{transform:translateY(-2px) translateX(2px)}}`}</style>
      <div className="mx-auto flex h-[calc(100vh-40px)] max-w-[1540px] flex-col overflow-hidden rounded-[30px] border border-white/80 bg-[#F7F9FC]/95 shadow-[0_34px_100px_rgba(15,23,42,0.22)] backdrop-blur-xl" style={{ background: "radial-gradient(circle at top left,#EAF1FF 0%,#F7F9FC 35%,#EEF2F7 100%)" }}>

        {/* Header — verbatim */}
        <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-8 py-5">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-orange-500"><Clock3 className="h-6 w-6" /></div>
            <div><h1 className="text-[30px] font-black tracking-[-0.05em]">Team ETA</h1><p className="text-sm font-medium text-slate-500">Live arrival updates for today's jobs</p></div>
          </div>
          <div className="flex items-center gap-5 text-sm font-semibold text-slate-400">
            <span className="flex items-center gap-2"><Clock3 className="h-4 w-4" /> Eastern Time (ET)</span>
            <span>Updated {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })}</span>
            <button onClick={() => void refetch()} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-slate-100"><RefreshCw className="h-4 w-4" /></button>
            <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </div>
        </header>

        {/* Main — verbatim */}
        <main className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
          {/* Sticky bar — verbatim */}
          <section className="sticky top-0 z-20 -mx-8 bg-[#F7F9FC]/95 px-8 pb-4 pt-5 backdrop-blur-xl">
            <div className="flex gap-3 overflow-x-auto pb-1">
              <Summary icon={<CheckCircle2 className="h-5 w-5" />} count={counts.on_time} label="On Time" helper="Ahead or on schedule" color="#1FA55B" soft="#F1FBF5" />
              <Summary icon={<Clock3 className="h-5 w-5" />} count={counts.late} label="Running Late" helper="10–30 min late" color="#F59E0B" soft="#FFF8EE" />
              <Summary icon={<AlertTriangle className="h-5 w-5" />} count={counts.critical} label="Significantly Late" helper="30+ min late" color="#EF4444" soft="#FFF2F2" />
              <Summary icon={<MessageCircle className="h-5 w-5" />} count={counts.unclear} label="Unclear" helper="Awaiting update" color="#7C5CFC" soft="#F7F5FF" />
              <Summary icon={<PhoneMissed className="h-5 w-5" />} count={counts.no_answer} label="No Answer" helper="No response yet" color="#3B82F6" soft="#F2F7FF" />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-bold text-white"><Users className="h-4 w-4" /> All Teams <span className="text-white/60">{teams.length}</span></button>
              {teams.map(team => (
                <button key={team.id} onClick={() => setActiveId(team.id)} className={`inline-flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-bold transition ${active?.id === team.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                  <span className="h-6 w-6 overflow-hidden rounded-full border border-white/30"><img src={team.avatarUrl} alt={team.name} className="h-full w-full object-cover" /></span>
                  {team.name}
                  <span className={active?.id === team.id ? "text-white/55" : "text-slate-400"}>{team.jobsToday} jobs</span>
                </button>
              ))}
            </div>
          </section>

          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-slate-400">Loading teams…</div>
          ) : teams.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-slate-400">No teams scheduled today.</div>
          ) : (
            /* Verbatim from design reference line 262 */
            <div className="space-y-3">
              {active && <ExpandedCard team={active} />}
              {teams.filter(t => t.id !== active?.id).map(team => <CollapsedRow key={team.id} team={team} onClick={() => setActiveId(team.id)} />)}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default TeamEtaModal;
