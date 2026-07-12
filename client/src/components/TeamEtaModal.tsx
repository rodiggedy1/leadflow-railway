/**
 * TeamEtaModal.tsx
 * Team ETA overview modal — triggered from Command Chat header.
 * Shows all teams' ETA status for today, with call recording, transcript,
 * client notification status, and action buttons.
 *
 * Design language: matches the Issue Engine modal (warm off-white context
 * blocks, muted orange labels, small semantic dots, restrained palette).
 */
import { useState, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
type EtaStatus = "on_time" | "running_late" | "early" | "unclear" | "no_answer" | "pending";

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
  currentJobAddress: string;
  currentJobServiceDateTime: Date | null;
  currentJobStatus: string;
  arrivedAt: Date | null;
  completedAt: Date | null;
  etaCall: {
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
  } | null;
  jobs: Array<{
    id: number;
    customerName: string;
    customerPhone: string | null;
    jobAddress: string;
    serviceDateTime: Date | null;
    jobStatus: string;
    delayMinutes: number;
    arrivedAt: Date | null;
    completedAt: Date | null;
    etaCall: {
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
    } | null;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<EtaStatus, {
  label: string;
  badgeBg: string;
  badgeText: string;
  dot: string;
  accentBar: string;
  ribbonText: string;
  ribbonIcon: string;
}> = {
  on_time:      { label: "On Time",       badgeBg: "#F0FDF4", badgeText: "#15803D", dot: "#22C55E", accentBar: "linear-gradient(180deg,#4ADE80,#16A34A)", ribbonText: "text-emerald-600", ribbonIcon: "👍" },
  early:        { label: "Arriving Early", badgeBg: "#F0FDF4", badgeText: "#15803D", dot: "#22C55E", accentBar: "linear-gradient(180deg,#4ADE80,#16A34A)", ribbonText: "text-emerald-600", ribbonIcon: "🎉" },
  running_late: { label: "Running Late",  badgeBg: "#FFFBEB", badgeText: "#B45309", dot: "#F59E0B", accentBar: "linear-gradient(180deg,#FCD34D,#D97706)", ribbonText: "text-amber-600",   ribbonIcon: "⏰" },
  unclear:      { label: "Unclear ETA",   badgeBg: "#F5F3FF", badgeText: "#6D28D9", dot: "#8B5CF6", accentBar: "linear-gradient(180deg,#C4B5FD,#7C3AED)", ribbonText: "text-violet-600",  ribbonIcon: "⚠️" },
  no_answer:    { label: "No Answer",     badgeBg: "#EFF6FF", badgeText: "#1D4ED8", dot: "#3B82F6", accentBar: "linear-gradient(180deg,#93C5FD,#2563EB)", ribbonText: "text-blue-500",    ribbonIcon: "📵" },
  pending:      { label: "Pending",       badgeBg: "#F8FAFC", badgeText: "#64748B", dot: "#94A3B8", accentBar: "linear-gradient(180deg,#CBD5E1,#94A3B8)", ribbonText: "text-slate-400",   ribbonIcon: "⏳" },
};

function formatTime(dt: Date | null | undefined): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m} min ${s.toString().padStart(2, "0")} sec`;
}

function getTodayDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ── Waveform audio player ─────────────────────────────────────────────────────
function AudioPlayer({ url, durationSeconds, color }: { url: string; durationSeconds: number; color: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const BARS = 48;
  const heights = useMemo(() => {
    const h = [3,5,8,12,16,20,18,14,10,7,5,8,14,20,24,28,26,22,18,14,10,8,12,18,24,28,26,20,16,12,8,6,10,16,22,26,24,18,14,10,7,5,8,14,20,24,20,14];
    return h.slice(0, BARS);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress((audio.currentTime / (audio.duration || 1)) * 100);
    const onEnd = () => { setPlaying(false); setProgress(0); };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => { audio.removeEventListener("timeupdate", onTime); audio.removeEventListener("ended", onEnd); };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play(); setPlaying(true); }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * (audio.duration || 0);
    setProgress(pct * 100);
  };

  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3 mb-3" style={{ background: "#FAFAFA" }}>
      <audio ref={audioRef} src={url} preload="metadata" />
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 hover:scale-105 transition-transform"
          style={{ background: color }}
        >
          {playing ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
          )}
        </button>
        <div className="flex-1">
          <div
            className="flex items-center gap-[2px] h-7 cursor-pointer"
            onClick={seek}
          >
            {heights.map((h, i) => {
              const barPct = (i / BARS) * 100;
              return (
                <div
                  key={i}
                  style={{
                    width: 3,
                    minWidth: 3,
                    height: h,
                    borderRadius: 2,
                    background: barPct <= progress ? color : "#E2E8F0",
                    transition: "background 80ms",
                  }}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[9px] text-slate-400">0:00</span>
            <span className="text-[9px] text-slate-400">{Math.floor(durationSeconds / 60)}:{(durationSeconds % 60).toString().padStart(2, "0")}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-slate-400">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07C9.44 17.25 7.76 15.57 6.68 13.6a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 5.59 3h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L9.91 10.91a16 16 0 0 0 6.29 6.29l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 24 18z"/>
        </svg>
        ETA Call Recording · {formatDuration(durationSeconds)}
      </div>
    </div>
  );
}

// ── Team card ─────────────────────────────────────────────────────────────────
function TeamCard({ team }: { team: TeamEtaSummaryItem }) {
  const [expanded, setExpanded] = useState(false);
  const [txOpen, setTxOpen] = useState(false);
  // selectedJobId: which job node is selected in the timeline — null means the current job
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const cfg = STATUS_CONFIG[team.etaStatus];

  const initials = team.cleanerName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  // The job whose ETA details are shown in the expanded section
  const selectedJob = selectedJobId != null
    ? team.jobs.find(j => j.id === selectedJobId) ?? null
    : null;

  // Displayed ETA call — from selected job if one is clicked, otherwise from current job
  const displayedEtaCall = selectedJob?.etaCall ?? team.etaCall;
  const displayedJobStatus = selectedJob?.jobStatus ?? team.currentJobStatus;
  const displayedArrivedAt = selectedJob?.arrivedAt ?? team.arrivedAt;
  const displayedCompletedAt = selectedJob?.completedAt ?? team.completedAt;
  const displayedCustomerName = selectedJob?.customerName ?? null;

  // Cleaner statement from the displayed call
  const cleanerStatement = displayedEtaCall?.cleanerStatement ?? null;

  // Determine ribbon message
  const ribbonMsg = useMemo(() => {
    const s = team.currentJobStatus;
    // Arrived / on-site statuses take priority over ETA call status
    const arrivedDisplay = team.arrivedAt ? ` · arrived ${formatTime(new Date(team.arrivedAt))}` : "";
    const completedDisplay = team.completedAt ? ` at ${formatTime(new Date(team.completedAt))}` : "";
    if (s === "completed") return `Job completed${completedDisplay}`;
    if (s === "in_progress") return `Cleaning in progress${arrivedDisplay}`;
    if (s === "finishing_up") return `Finishing up${arrivedDisplay}`;
    if (s === "wrapping_up") return `Wrapping up${arrivedDisplay}`;
    if (s === "arrived") return `Team has arrived${arrivedDisplay}`;
    // Only show ETA time if we actually have one from a call — never show scheduled time as ETA
    const etaDisplay = team.etaCall?.etaTimeStr ?? (team.etaTimestamp ? formatTime(new Date(team.etaTimestamp)) : null);
    if (team.etaStatus === "on_time") return etaDisplay ? `On track · ETA ${etaDisplay}` : "On track";
    if (team.etaStatus === "early") return etaDisplay ? `Arriving early · ETA ${etaDisplay}` : "Arriving early";
    if (team.etaStatus === "running_late") return etaDisplay ? `Running late · ETA ${etaDisplay}` : "Running late";
    if (team.etaStatus === "no_answer") {
      const attempt = team.etaCall?.step === "eta_call_2" ? "2nd" : "1st";
      return `${attempt} call not answered — retry pending`;
    }
    if (team.etaStatus === "unclear") return "ETA unclear — manual follow-up needed";
    return "ETA call pending";
  }, [team]);

  // Player color
  const playerColor = useMemo(() => {
    if (team.etaStatus === "on_time" || team.etaStatus === "early") return "#16A34A";
    if (team.etaStatus === "running_late") return "#D97706";
    if (team.etaStatus === "unclear") return "#7C3AED";
    return "#3B82F6";
  }, [team.etaStatus]);

  // Only "completed" is done — matches customer portal exactly
  // Index of the current (active) job — first non-completed, non-cancelled job
  const currentJobIdx = team.jobs.findIndex(j => j.jobStatus !== "completed" && j.jobStatus !== "cancelled");
  // If all jobs are completed, set activeIdx PAST the end so every node renders as a checkmark
  const activeIdx = currentJobIdx === -1 ? team.jobs.length : currentJobIdx;

  return (
    <div className="overflow-hidden rounded-[20px] bg-white border border-slate-200 shadow-[0_2px_12px_rgba(15,23,42,.05)] hover:shadow-[0_8px_32px_rgba(15,23,42,.09)] transition-shadow">
      <div className="flex">
        {/* Accent bar */}
        <div className="w-[4px] shrink-0" style={{ background: cfg.accentBar }} />

        {/* Identity rail */}
        <div className="w-[200px] shrink-0 px-4 py-4 border-r border-slate-100">
          <div className="text-[15px] font-[800] tracking-[-0.02em] text-slate-900 mb-1">{team.teamName}</div>
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-[700] mb-3"
            style={{ background: cfg.badgeBg, color: cfg.badgeText }}
          >
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: cfg.dot }} />
            {cfg.label}
          </span>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-[11px] font-[800] text-slate-600 shrink-0">
              {initials}
            </div>
            <div>
              <div className="text-[12px] font-[700] text-slate-800">{team.cleanerName}</div>
              {team.cleanerPhone && (
                <div className="text-[11px] text-slate-400 font-mono">{team.cleanerPhone}</div>
              )}
            </div>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1 font-[500]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Today: {team.jobs.length} job{team.jobs.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 px-5 py-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {/* Nodes — ALL jobs shown */}
          <div className="relative" style={{ minWidth: Math.max(480, team.jobs.length * 110), height: 96 }}>
            {/* Connector lines */}
            {team.jobs.map((job, i) => {
              if (i >= team.jobs.length - 1) return null;
              const x = 50 + i * 110 + 36;
              const isDone = job.jobStatus === "completed";

              return (
                <div key={`line-${i}`} className="absolute top-[36px]" style={{
                  left: x, width: 74, height: 2,
                  background: isDone ? "#16A34A" : undefined,
                  borderTop: isDone ? undefined : "2px dashed #CBD5E1",
                  borderRadius: isDone ? 2 : undefined,
                }} />
              );
            })}

            {/* Job nodes */}
            {team.jobs.map((job, i) => {
              const leftPos = 25 + i * 110;
              const isDone = job.jobStatus === "completed";
              const isCurrent = !isDone && i === activeIdx;
              const firstName = job.customerName?.split(" ")[0] ?? "";
              const lastInitial = job.customerName?.split(" ")[1]?.[0] ?? "";
              const city = job.jobAddress.split(",")[1]?.trim() ?? job.jobAddress;

              if (isCurrent) {
                // Van node
                const isSelected = selectedJobId === job.id;
                return (
                  <div
                    key={job.id}
                    className="absolute flex flex-col items-center cursor-pointer"
                    style={{ left: leftPos - 10, top: 4, width: 70 }}
                    onClick={() => { setSelectedJobId(isSelected ? null : job.id); setExpanded(true); setTxOpen(false); }}
                  >
                    <div className="text-[11px] font-[750] mb-1 whitespace-nowrap text-center" style={{ color: cfg.badgeText }}>
                      {(() => {
                        const s = team.currentJobStatus;
                        // If arrived/cleaning/completed — show arrived time
                        if (s === "arrived" || s === "in_progress" || s === "finishing_up" || s === "wrapping_up") {
                          return team.arrivedAt ? `Arrived ${formatTime(new Date(team.arrivedAt))}` : "Arrived";
                        }
                        if (s === "completed") {
                          return team.completedAt ? `Done ${formatTime(new Date(team.completedAt))}` : "Completed";
                        }
                        // On the way — show ETA from card
                        const etaStr = team.etaCall?.etaTimeStr ?? (team.etaTimestamp ? formatTime(new Date(team.etaTimestamp)) : null);
                        if (team.etaStatus === "pending" || team.etaStatus === "no_answer") return "ETA Pending";
                        if (team.etaStatus === "unclear") return "ETA Unclear";
                        return etaStr ? `ETA ${etaStr}` : "—";
                      })()}
                    </div>
                    <div className="w-[48px] h-[48px] rounded-full flex items-center justify-center border-2 bg-white transition-shadow" style={{ borderColor: cfg.dot, boxShadow: isSelected ? `0 0 0 3px ${cfg.dot}44` : undefined }}>
                      {(team.etaStatus === "on_time" || team.etaStatus === "early" || team.etaStatus === "running_late") ? (
                        <svg width="30" height="20" viewBox="0 0 56 40" fill="none">
                          <rect x="4" y="10" width="46" height="22" rx="5" fill="white" stroke={cfg.dot} strokeWidth="2"/>
                          <rect x="4" y="10" width="18" height="14" rx="3" fill={cfg.badgeBg} stroke={cfg.dot} strokeWidth="1.5"/>
                          <rect x="24" y="10" width="26" height="14" rx="2" fill={cfg.badgeBg} stroke={cfg.dot} strokeWidth="1.5"/>
                          <circle cx="14" cy="33" r="5" fill="#374151" stroke="#111827" strokeWidth="1.5"/>
                          <circle cx="14" cy="33" r="2.5" fill="#9CA3AF"/>
                          <circle cx="42" cy="33" r="5" fill="#374151" stroke="#111827" strokeWidth="1.5"/>
                          <circle cx="42" cy="33" r="2.5" fill="#9CA3AF"/>
                          <text x="28" y="22" textAnchor="middle" fontSize="5" fontWeight="700" fill={cfg.dot} fontFamily="Inter,sans-serif">MIB</text>
                        </svg>
                      ) : team.etaStatus === "no_answer" ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={cfg.dot} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07C9.44 17.25 7.76 15.57 6.68 13.6"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={cfg.dot} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                          <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                      )}
                    </div>
                    <div className="mt-1 text-center">
                      {(() => {
                        const s = team.currentJobStatus;
                        if (s === "completed") return <div className="text-[10px] font-[700]" style={{ color: cfg.badgeText }}>Completed</div>;
                        if (s === "in_progress" || s === "finishing_up" || s === "wrapping_up") return <div className="text-[10px] font-[700]" style={{ color: cfg.badgeText }}>Cleaning</div>;
                        if (s === "arrived") return <div className="text-[10px] font-[700]" style={{ color: cfg.badgeText }}>Arrived</div>;
                        if (s === "on_the_way" || team.etaStatus === "on_time" || team.etaStatus === "early" || team.etaStatus === "running_late") return <div className="text-[10px] font-[700]" style={{ color: cfg.badgeText }}>On the way</div>;
                        return null;
                      })()}
                      <div className="text-[10px] font-[700] text-slate-700 truncate max-w-[70px]">{firstName} {lastInitial}.</div>
                      <div className="text-[9px] text-slate-400 truncate max-w-[70px]">{city}</div>
                    </div>
                  </div>
                );
              }

              if (isDone) {
                // Checkmark node
                const isSelected = selectedJobId === job.id;
                return (
                  <div
                    key={job.id}
                    className="absolute flex flex-col items-center cursor-pointer"
                    style={{ left: leftPos, top: 14, width: 50 }}
                    onClick={() => { setSelectedJobId(isSelected ? null : job.id); setExpanded(true); setTxOpen(false); }}
                  >
                    <div className="text-[10px] font-[600] text-slate-400 mb-1.5 whitespace-nowrap text-center">{formatTime(job.serviceDateTime)}</div>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center transition-shadow" style={{ background: "#16A34A", boxShadow: isSelected ? "0 0 0 3px #16A34A44" : undefined }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <div className="mt-1 text-center">
                      <div className="text-[10px] font-[700] text-slate-700 truncate max-w-[60px]">{firstName} {lastInitial}.</div>
                      <div className="text-[9px] text-slate-400 truncate max-w-[60px]">{city}</div>
                    </div>
                  </div>
                );
              }

              // Future house node
              const isSelected = selectedJobId === job.id;
              return (
                <div
                  key={job.id}
                  className="absolute flex flex-col items-center cursor-pointer"
                  style={{ left: leftPos, top: 14, width: 50 }}
                  onClick={() => { setSelectedJobId(isSelected ? null : job.id); setExpanded(true); setTxOpen(false); }}
                >
                  <div className="text-[10px] font-[600] text-slate-400 mb-1.5 whitespace-nowrap text-center">{formatTime(job.serviceDateTime)}</div>
                  <div className="w-9 h-9 rounded-full border-2 bg-white flex items-center justify-center transition-shadow" style={{ borderColor: isSelected ? "#94A3B8" : "#E2E8F0", boxShadow: isSelected ? "0 0 0 3px #94A3B844" : undefined }}>
                    <svg width="22" height="22" viewBox="0 0 48 48" fill="none">
                      <polygon points="24,6 44,22 4,22" fill="#D1FAE5" stroke="#A7F3D0" strokeWidth="2"/>
                      <rect x="10" y="22" width="28" height="18" rx="2" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="1.5"/>
                      <rect x="20" y="30" width="8" height="10" rx="1" fill="#E0E7FF"/>
                    </svg>
                  </div>
                  <div className="mt-1 text-center">
                    <div className="text-[10px] font-[700] text-slate-700 truncate max-w-[60px]">{firstName} {lastInitial}.</div>
                    <div className="text-[9px] text-slate-400 truncate max-w-[60px]">{city}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Ribbon footer */}
      <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100" style={{ background: "#F9FAFB" }}>
        <div className={cn("flex items-center gap-1.5 text-[12px] font-[600]", cfg.ribbonText)}>
          <span>{cfg.ribbonIcon}</span>
          {ribbonMsg}
        </div>
        <button
          className="text-[11px] font-[700] text-slate-500 flex items-center gap-1 hover:text-slate-800 transition-colors"
          onClick={() => { setExpanded(v => !v); if (expanded) setSelectedJobId(null); }}
        >
          {expanded ? "Close" : (selectedJobId ? "ETA Details ▾" : "ETA Details ▾")}
          <svg
            className="transition-transform"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
            width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4 bg-white">
          {/* Context block — pixel-perfect mockup */}
          <div className="rounded-[14px] p-4 mb-4" style={{ background: "linear-gradient(135deg,#fef9f0,#fef3e2)", border: "1px solid #fde8c0" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-[800] tracking-[.15em] uppercase" style={{ color: "#F97316" }}>ETA Call Result</p>
              {selectedJob && (
                <button className="text-[10px] text-slate-400 hover:text-slate-700 font-[600] transition-colors" onClick={() => setSelectedJobId(null)}>← Current job</button>
              )}
            </div>
            <div className="rounded-[10px] overflow-hidden" style={{ border: "1px solid #fde8c0", background: "rgba(255,255,255,0.7)" }}>

              {/* ETA time big row */}
              {displayedEtaCall?.resultType === "success" && displayedEtaCall.etaTimeStr ? (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ borderBottom: "1px solid rgba(253,232,192,0.5)" }}>
                  <span className="text-[22px] font-[800] tabular-nums" style={{ color: cfg.badgeText }}>{displayedEtaCall.etaTimeStr}</span>
                  <span className="inline-flex items-center px-2.5 py-[3px] rounded-full text-[11px] font-[700]" style={{ background: cfg.badgeBg, color: cfg.badgeText, border: `1px solid ${cfg.dot}` }}>{cfg.label}</span>
                  {(selectedJob?.scheduledTime ?? (team.currentJobServiceDateTime ? formatTime(new Date(team.currentJobServiceDateTime)) : null)) && (
                    <span className="text-[11px] text-slate-400 ml-auto">Sched. {selectedJob?.scheduledTime ?? formatTime(new Date(team.currentJobServiceDateTime!))}</span>
                  )}
                </div>
              ) : displayedEtaCall?.resultType === "no_answer" ? (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ borderBottom: "1px solid rgba(253,232,192,0.5)" }}>
                  <span className="text-[14px] font-[700] text-slate-500">No answer</span>
                  <span className="inline-flex items-center px-2.5 py-[3px] rounded-full text-[11px] font-[700]" style={{ background: cfg.badgeBg, color: cfg.badgeText, border: `1px solid ${cfg.dot}` }}>{cfg.label}</span>
                </div>
              ) : null}

              {/* Cleaner Said row */}
              {displayedEtaCall && (
                <div className="flex items-start gap-3 px-3.5 py-2.5" style={{ borderBottom: "1px solid rgba(253,232,192,0.5)" }}>
                  <div className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: cfg.badgeBg }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={cfg.badgeText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-[9px] font-[700] uppercase tracking-[.12em] mb-[2px]" style={{ color: cfg.badgeText }}>
                      {displayedEtaCall.resultType === "no_answer" || displayedEtaCall.resultType === "dispatcher_needed" ? "Call Outcome" : "Cleaner Said"}
                    </p>
                    {displayedEtaCall.resultType === "no_answer" || displayedEtaCall.resultType === "dispatcher_needed" ? (
                      <p className="text-[12px] font-[600] text-slate-500">Call was not answered</p>
                    ) : cleanerStatement ? (
                      <p className="text-[12px] font-[600] italic" style={{ color: "#334155" }}>&#34;{cleanerStatement}&#34;</p>
                    ) : (
                      <p className="text-[12px] font-[600] text-slate-500">Transcript unavailable</p>
                    )}
                  </div>
                </div>
              )}

              {/* Current Job Status row */}
              <div className="flex items-start gap-3 px-3.5 py-2.5" style={{ borderBottom: "1px solid rgba(253,232,192,0.5)" }}>
                <div className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: "#F0FDF4" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                  </svg>
                </div>
                <div>
                  <p className="text-[9px] font-[700] uppercase tracking-[.12em] mb-[2px] text-emerald-700">Current Job Status</p>
                  {(() => {
                    const s = displayedJobStatus;
                    const arrivedStr = displayedArrivedAt ? ` arrived ${formatTime(new Date(displayedArrivedAt))}` : "";
                    const completedStr = displayedCompletedAt ? ` at ${formatTime(new Date(displayedCompletedAt))}` : "";
                    if (s === "completed") return (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-[700]" style={{ background: "#F0FDF4", color: "#15803D", border: "1px solid #BBF7D0" }}>● Completed</span>
                        {completedStr && <span className="text-[11px] text-slate-400">{completedStr}</span>}
                      </div>
                    );
                    if (s === "in_progress" || s === "finishing_up" || s === "wrapping_up") return (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-[700]" style={{ background: "#F0FDF4", color: "#15803D", border: "1px solid #BBF7D0" }}>● In Progress</span>
                        {arrivedStr && <span className="text-[11px] text-slate-400">{arrivedStr}</span>}
                      </div>
                    );
                    if (s === "arrived") return (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-[700]" style={{ background: "#F0FDF4", color: "#15803D", border: "1px solid #BBF7D0" }}>● Arrived</span>
                        {arrivedStr && <span className="text-[11px] text-slate-400">{arrivedStr}</span>}
                      </div>
                    );
                    if (s === "on_the_way") return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-[700]" style={{ background: "#FFFBEB", color: "#B45309", border: "1px solid #FDE68A" }}>● On the way</span>;
                    return <span className="text-[12px] font-[600] text-slate-500">{s ?? "Pending"}</span>;
                  })()}
                </div>
              </div>

              {/* Client Notified row */}
              <div className="flex items-start gap-3 px-3.5 py-2.5">
                <div className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: displayedEtaCall?.clientNotified ? cfg.badgeBg : "#F1F5F9" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={displayedEtaCall?.clientNotified ? cfg.badgeText : "#94A3B8"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/>
                  </svg>
                </div>
                <div>
                  <p className="text-[9px] font-[700] uppercase tracking-[.12em] mb-[2px]" style={{ color: displayedEtaCall?.clientNotified ? cfg.badgeText : "#94A3B8" }}>Client Notified</p>
                  {displayedEtaCall?.clientNotified ? (
                    <>
                      <p className="text-[12px] font-[700]" style={{ color: "#334155" }}>✓ SMS sent{displayedEtaCall.createdAt ? ` at ${formatTime(displayedEtaCall.createdAt)}` : ""}</p>
                      {displayedEtaCall.smsSentBody && (
                        <p className="text-[11px] italic mt-[2px]" style={{ color: "#94A3B8" }}>&#34;{displayedEtaCall.smsSentBody}&#34;</p>
                      )}
                    </>
                  ) : displayedEtaCall ? (
                    <p className="text-[12px] font-[600] text-slate-500">Client not notified</p>
                  ) : (
                    <p className="text-[12px] font-[600] text-slate-500">No ETA call yet</p>
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* Audio player */}
          {displayedEtaCall?.recordingUrl ? (
            <AudioPlayer
              url={displayedEtaCall.recordingUrl}
              durationSeconds={0}
              color={playerColor}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 mb-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07C9.44 17.25 7.76 15.57 6.68 13.6"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              </div>
              <div>
                <div className="text-[11px] font-[700] text-slate-400">No recording available</div>
                <div className="text-[10px] text-slate-300 mt-0.5">
                  {(displayedEtaCall?.resultType === "no_answer" || displayedEtaCall?.resultType === "dispatcher_needed") ? "Call was not answered" : "Recording will appear after a successful ETA call"}
                </div>
              </div>
            </div>
          )}

          {/* Transcript */}
          {displayedEtaCall?.transcript && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-3">
              <button
                className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] font-[700] text-slate-500 hover:bg-slate-50 transition-colors"
                onClick={() => setTxOpen(v => !v)}
              >
                <span className="flex items-center gap-1.5">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                  View Transcript
                </span>
                <svg
                  className="transition-transform"
                  style={{ transform: txOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {txOpen && (
                <div className="px-4 pb-3 border-t border-slate-100">
                  <div className="space-y-2 pt-3 text-[11px]">
                    {displayedEtaCall.transcript.split("\n").filter(Boolean).map((line, i) => {
                      const isSystem = /^(system|assistant):/i.test(line);
                      const isCleaner = /^(cleaner|user|customer):/i.test(line);
                      const text = line.replace(/^(system|assistant|cleaner|user|customer):\s*/i, "");
                      return (
                        <div key={i} className="flex gap-2.5">
                          <span className={cn("font-[700] shrink-0 w-14", isSystem ? "text-slate-400" : isCleaner ? "" : "text-slate-400")} style={isCleaner ? { color: cfg.badgeText } : {}}>
                            {isSystem ? "System" : isCleaner ? "Cleaner" : "—"}
                          </span>
                          <span className={cn("text-slate-600", isCleaner && "italic text-slate-700")}>{text}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-[700] border transition-colors" style={{ background: "#F0FDF4", color: "#15803D", borderColor: "#BBF7D0" }}>
              Call Team
            </button>
            <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-[700] border transition-colors" style={{ background: "#EFF6FF", color: "#1D4ED8", borderColor: "#BFDBFE" }}>
              Text Team
            </button>
            <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-[700] border transition-colors" style={{ background: "#FFFBEB", color: "#B45309", borderColor: "#FDE68A" }}>
              Re-run ETA Call
            </button>
            {(team.etaStatus === "unclear" || team.etaStatus === "no_answer") && (
              <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-[700] border transition-colors" style={{ background: "#EFF6FF", color: "#1D4ED8", borderColor: "#BFDBFE" }}>
                Text Customer
              </button>
            )}
            <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-[700] border border-slate-200 bg-white text-slate-500 transition-colors ml-auto hover:bg-slate-50">
              Mark Reviewed
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
interface TeamEtaModalProps {
  open: boolean;
  onClose: () => void;
}

export function TeamEtaModal({ open, onClose }: TeamEtaModalProps) {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const today = useMemo(() => getTodayDate(), []);

  const { data: teams, isLoading, refetch } = trpc.fieldMgmt.getTeamEtaSummary.useQuery(
    { date: today },
    { enabled: open, refetchInterval: open ? 60_000 : false }
  );

  const filteredTeams = useMemo(() => {
    if (!teams) return [];
    if (activeFilter === "all") return teams;
    return teams.filter(t => t.teamName === activeFilter);
  }, [teams, activeFilter]);

  // Summary counts
  const counts = useMemo(() => {
    if (!teams) return { on_time: 0, running_late: 0, significantly_late: 0, unclear: 0, no_answer: 0 };
    return {
      on_time: teams.filter(t => t.etaStatus === "on_time" || t.etaStatus === "early").length,
      running_late: teams.filter(t => t.etaStatus === "running_late" && (t.delayMinutes ?? 0) < 30).length,
      significantly_late: teams.filter(t => t.etaStatus === "running_late" && (t.delayMinutes ?? 0) >= 30).length,
      unclear: teams.filter(t => t.etaStatus === "unclear").length,
      no_answer: teams.filter(t => t.etaStatus === "no_answer").length,
    };
  }, [teams]);

  const updatedTime = useMemo(() => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" }), [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[min(1100px,calc(100vw-48px))] h-[min(900px,calc(100vh-48px))] overflow-hidden rounded-[24px] bg-white flex flex-col"
        style={{ boxShadow: "0 20px 60px rgba(15,23,42,.18)", border: "1px solid rgba(226,232,240,0.6)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 pt-5 pb-4 border-b border-slate-100 shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#FEF3E2" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#E07B39" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div>
              <h1 className="text-[22px] font-[800] tracking-[-0.03em] text-slate-900 leading-none">Team ETA</h1>
              <p className="text-[12px] text-slate-400 mt-0.5 font-[500]">Live arrival updates for today's jobs</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-[12px] text-slate-400 font-[500]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Eastern Time (ET)
            </div>
            <div className="text-[12px] text-slate-400 font-[500]">Updated {updatedTime}</div>
            <button
              onClick={() => refetch()}
              className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors text-slate-400"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors text-slate-400"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-7 py-5 space-y-4" style={{ background: "#F4F5F7" }}>

          {/* Summary strip */}
          <div className="flex gap-2.5">
            {[
              { key: "on_time", count: counts.on_time, label: "On Time / Early", dot: "#22C55E" },
              { key: "running_late", count: counts.running_late, label: "Running Late", dot: "#F59E0B" },
              { key: "significantly_late", count: counts.significantly_late, label: "Significantly Late", dot: "#EF4444" },
              { key: "unclear", count: counts.unclear, label: "Unclear", dot: "#8B5CF6" },
              { key: "no_answer", count: counts.no_answer, label: "No Answer", dot: "#3B82F6" },
            ].map(s => (
              <div key={s.key} className="flex-1 rounded-[16px] bg-white border border-slate-200 p-4 flex items-center gap-3 hover:shadow-sm transition-shadow cursor-pointer">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#F8FAFC" }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: s.dot }} />
                </div>
                <div>
                  <div className="text-[22px] font-[800] text-slate-900 leading-none">{isLoading ? "—" : s.count}</div>
                  <div className="text-[11px] font-[600] mt-0.5" style={{ color: s.dot }}>{s.label}</div>
                </div>
              </div>
            ))}
            <button className="rounded-[16px] bg-white border border-slate-200 px-5 flex items-center gap-2 text-[12px] font-[700] text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap">
              View All ETAs
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className={cn(
                "flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-[700] transition-colors",
                activeFilter === "all" ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
              onClick={() => setActiveFilter("all")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              All Teams
            </button>
            {teams?.map(t => {
              const initials = t.cleanerName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
              return (
                <button
                  key={t.teamName}
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-[600] transition-colors",
                    activeFilter === t.teamName ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                  )}
                  onClick={() => setActiveFilter(t.teamName)}
                >
                  <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[9px] font-[800] text-slate-600 shrink-0">{initials}</div>
                  {t.teamName}
                  <span className="text-[11px] text-slate-400">{t.jobs.length} jobs</span>
                </button>
              );
            })}
          </div>

          {/* Team cards */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-[13px] text-slate-400 font-[500]">Loading team ETAs…</div>
            </div>
          ) : filteredTeams.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-[13px] text-slate-400 font-[500]">No jobs found for today</div>
            </div>
          ) : (
            filteredTeams.map(team => (
              <TeamCard key={team.teamName} team={team as TeamEtaSummaryItem} />
            ))
          )}

          {/* Pro tip */}
          <div className="flex items-center gap-3 rounded-[16px] border border-slate-200 bg-white px-4 py-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#FEF3E2" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#E07B39" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <p className="text-[11px] text-slate-500 font-[500]">
              <span className="font-[700] text-slate-700">Pro tip</span> — First ETA call fires 30 minutes before scheduled time. If no answer, a retry is attempted 3 minutes after the first call.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
