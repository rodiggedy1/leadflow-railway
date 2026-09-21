import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, FileText, Filter, MessageSquare, Pause, Pencil, Play, RefreshCw, Search, Send, Sparkles } from "lucide-react";
import { proxyRecordingUrl } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import "./team-confirmation-review.css";
import "./confirmation-calls-leads-cohesion.css";
import "./confirmation-calls-audio-player.css";
import "./confirmation-calls-crm-identity.css";

type Outcome = "confirmed" | "reschedule" | "cancel" | "no_answer" | "voicemail" | "unknown";
type CallStatus = "pending" | "fired" | "completed" | "failed" | "no_answer";
type ConfirmationCall = {
  id: number;
  status: CallStatus;
  recordingUrl: string | null;
  summary: string | null;
  transcript: string | null;
  durationSeconds: number | null;
  endedReason: string | null;
  aiOutcome: string | null;
  aiFlexibility: string | null;
  aiNotes: string | null;
  aiOutcomeLabel: string | null;
  manualOutcome: string | null;
  manualOutcomeLabel: string | null;
  smsFollowupSent: number | null;
  smsFollowupBody: string | null;
  smsReply: string | null;
  smsReplies: Array<{ text: string; receivedAt: number }> | null;
  smsConfirmedAt: number | null;
};
type ConfirmationJob = {
  id: number;
  customerName: string | null;
  customerPhone: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
  serviceType: string | null;
  teamName: string | null;
  confirmationCall: ConfirmationCall | null;
};

const LABELS: Record<Outcome, string> = {
  confirmed: "Confirmed",
  reschedule: "Reschedule requested",
  cancel: "Cancel requested",
  no_answer: "No reply",
  voicemail: "Voicemail",
  unknown: "Needs review",
};
const OVERRIDE_OPTIONS: Array<{ outcome: Outcome; label: string }> = [
  { outcome: "confirmed", label: "Confirmed ✓" },
  { outcome: "reschedule", label: "Wants to Reschedule" },
  { outcome: "cancel", label: "Cancel" },
  { outcome: "voicemail", label: "Left Voicemail" },
  { outcome: "no_answer", label: "No Answer" },
  { outcome: "unknown", label: "Unknown" },
];
const WAVEFORM = [22, 42, 28, 58, 76, 45, 34, 61, 83, 52, 31, 67, 46, 73, 88, 54, 37, 63, 29, 49, 71, 41, 26, 57, 39, 23, 47, 31];

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function formatTime(dateTime: string | null): string {
  if (!dateTime) return "—";
  const date = new Date(dateTime);
  return Number.isNaN(date.getTime()) ? dateTime : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function displayPlaybackPosition(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function parseNotes(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function outcomeFor(call: ConfirmationCall): Outcome | undefined {
  const candidate = call.manualOutcome ?? call.aiOutcome;
  return candidate && candidate in LABELS ? candidate as Outcome : undefined;
}

function displayStatus(call: ConfirmationCall | null): { label: string; className: string } {
  if (!call || call.status === "pending") return { label: "Not sent", className: "" };
  if (call.status === "fired") return { label: "Sending…", className: "is-warn" };
  if (call.status === "completed") return { label: "SMS sent", className: "is-sent" };
  if (call.status === "failed") return { label: "Failed", className: "is-warn" };
  return { label: "No reply", className: "is-warn" };
}

function LiveRecordingPlayer({ customer, recordingUrl, durationSeconds }: { customer: string; recordingUrl: string; durationSeconds: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const durationLabel = formatDuration(durationSeconds ?? duration);
  const safeDuration = duration || durationSeconds || 1;
  const playedBars = Math.round((position / safeDuration) * WAVEFORM.length);
  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        toast.error("The recording could not be played.");
      }
    } else {
      audio.pause();
    }
  };
  const advanceSpeed = () => {
    const next = speed === 1 ? 1.25 : speed === 1.25 ? 1.5 : 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };
  const seek = (value: number) => {
    setPosition(value);
    if (audioRef.current) audioRef.current.currentTime = value;
  };
  return <section className={`ops-recording ops-audio-player ${playing ? "is-previewing" : ""}`} aria-label={`Call recording for ${customer}`}>
    <audio
      ref={audioRef}
      src={proxyRecordingUrl(recordingUrl) ?? recordingUrl}
      preload="metadata"
      onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : durationSeconds ?? 0)}
      onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => { setPlaying(false); setPosition(0); }}
    />
    <header><button type="button" className="ops-audio-play" aria-label={playing ? `Pause call recording for ${customer}` : `Play call recording for ${customer}`} onClick={togglePlayback}>{playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}</button><div><b>Call recording</b><small>Confirmation outcome · recorded call</small></div><button type="button" className="ops-audio-speed" onClick={advanceSpeed} aria-label={`Recording speed ${speed} times`}>{speed}×</button></header>
    <div className="ops-audio-track"><time>{displayPlaybackPosition(Math.round(position))}</time><div className="ops-audio-scrub"><span className="ops-audio-progress" style={{ width: `${(position / safeDuration) * 100}%` }} /><span className="ops-audio-wave" aria-hidden="true">{WAVEFORM.map((height, index) => <i className={index < playedBars ? "is-played" : ""} key={index} style={{ height: `${height}%` }} />)}</span><input aria-label={`Recording progress for ${customer}`} type="range" min="0" max={safeDuration} value={position} onChange={(event) => seek(Number(event.target.value))} /></div><time>{durationLabel}</time></div>
    <footer>{playing ? "Playing recorded call" : "Play, pause, adjust speed, or seek the recorded call"}</footer>
  </section>;
}

export default function ConfirmationCallsExactLive() {
  const [date, setDate] = useState(todayLocal);
  const [tab, setTab] = useState<"dispatch" | "results">("dispatch");
  const [selected, setSelected] = useState<number[]>([]);
  const [openTranscript, setOpenTranscript] = useState<number | null>(null);
  const [notice, setNotice] = useState("Ready to send confirmation messages.");
  const [isFiringBatch, setIsFiringBatch] = useState(false);
  const { agentName } = useAgentPermissions();
  const utils = trpc.useUtils();
  const { data, isLoading, isFetching, refetch } = trpc.leadflowConfirmationCalls.getJobsForDay.useQuery(
    { date },
    { staleTime: 0, refetchInterval: 5_000 },
  );
  const jobs = (data ?? []) as ConfirmationJob[];
  const placeCall = trpc.leadflowConfirmationCalls.placeCall.useMutation();
  const overrideMutation = trpc.leadflowConfirmationCalls.overrideOutcome.useMutation({
    onSuccess: () => {
      toast.success("Outcome updated");
      void refetch();
      void utils.scheduling.getSchedule.invalidate({ date });
    },
    onError: (error) => toast.error(error.message),
  });

  const pending = jobs.filter((job) => !job.confirmationCall || job.confirmationCall.status === "pending");
  const results = jobs.filter((job) => job.confirmationCall && job.confirmationCall.status !== "pending");
  const allSelected = pending.length > 0 && pending.every((job) => selected.includes(job.id));
  useEffect(() => {
    if (!isLoading && pending.length === 0 && results.length > 0) setTab("results");
  }, [isLoading, pending.length, results.length]);
  const toggle = (id: number) => setSelected((current) => current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]);
  const selectAll = () => setSelected(allSelected ? [] : pending.map((job) => job.id));
  const dispatch = useCallback(async () => {
    if (!jobs.length || !selected.length) return;
    const toCall = jobs.filter((job) => selected.includes(job.id));
    if (!toCall.length) return;
    setIsFiringBatch(true);
    setSelected([]);
    setNotice(`Sending ${toCall.length} selected confirmation message${toCall.length === 1 ? "" : "s"}…`);
    try {
      for (const job of toCall) {
        if (!job.customerPhone) continue;
        try {
          await placeCall.mutateAsync({ leadflowJobId: job.id, jobDate: date });
        } catch (error) {
          console.error("[ConfirmationCalls] Failed to send confirmation message", error);
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } finally {
      setIsFiringBatch(false);
    }
    await refetch();
    setNotice("Confirmation send run complete. Review the results for the selected date.");
  }, [date, jobs, placeCall, refetch, selected]);
  const summary = useMemo(() => ({
    confirmed: results.filter((job) => outcomeFor(job.confirmationCall!) === "confirmed" || (job.confirmationCall?.status === "completed" && !outcomeFor(job.confirmationCall!))).length,
    reschedule: results.filter((job) => outcomeFor(job.confirmationCall!) === "reschedule").length,
    noReply: results.filter((job) => job.confirmationCall?.status === "no_answer").length,
  }), [results]);
  const changeDate = (offset: number) => {
    setDate((current) => addDays(current, offset));
    setSelected([]);
    setOpenTranscript(null);
  };

  return <main className="confirmation-review ops-review">
    <header className="ops-utility"><label><Search size={17} /><input aria-label="Search confirmations" placeholder="Search confirmations…" onChange={() => setNotice("Search is not available in this confirmation queue.")} /><kbd>⌘ K</kbd></label><div><button aria-label="Confirmation notifications" onClick={() => setNotice("Review the current queue and results below.")}><Bell size={18} /><i /></button><span>RG</span></div></header>
    <div className="ops-content ops-content--narrow">
      <section className="ops-head"><div><span>Customer operations</span><h1><MessageSquare size={27} />Confirmation Calls</h1><p>Queue confirmation outreach, review readiness notes, and scan structured call outcomes in a single dispatch workspace.</p></div><button className="ops-refresh" onClick={() => void refetch()} disabled={isFetching}><RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />Refresh</button></section>
      <p className="ops-status-notice"><Sparkles size={14} />{notice}</p>
      <section className="ops-date-nav"><button onClick={() => changeDate(-1)}><ChevronLeft size={17} /></button><div><strong>{formatDisplayDate(date)}</strong><small>{date === todayLocal() ? "Today" : "Selected date"}</small></div><button onClick={() => changeDate(1)}><ChevronRight size={17} /></button></section>
      <nav className="ops-segmented"><button className={tab === "dispatch" ? "is-active" : ""} onClick={() => setTab("dispatch")}><Send size={15} />Dispatch <b>{pending.length}</b></button><button className={tab === "results" ? "is-active" : ""} onClick={() => setTab("results")}><ClipboardList size={15} />Results <b>{results.length}</b></button></nav>
      {tab === "dispatch" ? <section className="ops-confirmation-list">
        <header className="ops-list-head"><div><span>Dispatch queue</span><h2>Confirmation messages</h2><p>{jobs.length} appointments · <b>{results.length} sent</b> · {pending.length} remaining</p></div>{pending.length > 0 ? <button className="ops-quiet" onClick={selectAll}>{allSelected ? "Deselect all" : "Select all unsent"}</button> : null}</header>
        {selected.length > 0 && <button className="ops-dispatch-cta" onClick={() => void dispatch()} disabled={isFiringBatch}><MessageSquare size={16} />{isFiringBatch ? "Sending messages…" : `Send SMS to ${selected.length} selected`} <span>{isFiringBatch ? "In progress" : "Selected messages"}</span></button>}
        {isLoading ? <div className="ops-empty-state">Loading confirmation queue…</div> : jobs.length === 0 ? <div className="ops-empty-state">No appointments are scheduled for this date.</div> : pending.length === 0 ? <div className="ops-empty-state">All confirmation messages have been sent. Open Results to review their outcomes.</div> : <div className="ops-dispatch-stack">{pending.map((job) => {
          const status = displayStatus(job.confirmationCall);
          return <label className={`ops-dispatch-card ${selected.includes(job.id) ? "is-selected" : ""}`} key={job.id}><input className="ops-selection-control" type="checkbox" checked={selected.includes(job.id)} onChange={() => toggle(job.id)} aria-label={`Select ${job.customerName ?? "customer"} for confirmation SMS`} /><span className="ops-selection-indicator" aria-hidden="true"><Check size={14} strokeWidth={3} /></span><span className="ops-time"><b>{formatTime(job.serviceDateTime)}</b></span><span className="ops-confirm-person"><b>{job.customerName ?? "Unknown"}</b><small>{job.jobAddress ?? "—"}</small><i>{job.serviceType ?? "—"}</i></span><em className={`ops-confirm-status ${status.className}`}>{status.label}</em></label>;
        })}</div>}
      </section> : <section className="ops-results">
        <header className="ops-list-head"><div><span>Outcome review</span><h2>Confirmation results</h2><p>Structured outcomes with readiness notes, fallback messages, call recordings, and transcripts.</p></div><button className="ops-quiet" onClick={() => setNotice("Outcome filters are not available in this queue.")}><Filter size={14} />All outcomes <ChevronDown size={14} /></button></header>
        <div className="ops-result-summary"><span className="is-good">{summary.confirmed} Confirmed</span><span className="is-warm">{summary.reschedule} Reschedule</span><span>{summary.noReply} No reply</span></div>
        {isLoading ? <div className="ops-empty-state">Loading confirmation results…</div> : results.length === 0 ? <div className="ops-empty-state">No confirmation messages have been sent for this date.</div> : <div className="ops-results-stack">{results.map((job) => {
          const call = job.confirmationCall!;
          const outcome = outcomeFor(call);
          const notes = parseNotes(call.aiNotes);
          const effectiveLabel = call.manualOutcomeLabel
            ?? call.aiOutcomeLabel
            ?? (call.endedReason === "customer-busy" ? "Line Busy" : call.endedReason === "pipeline-error-eleven-labs-voice-not-found" ? "Voice Error" : outcome ? LABELS[outcome] : displayStatus(call).label);
          return <article className={`ops-result-card is-${outcome ?? "unknown"}`} key={job.id}>
            <header><span className="ops-time"><b>{formatTime(job.serviceDateTime)}</b></span><div><b>{job.customerName ?? "Unknown"}</b><small>{job.jobAddress ?? "—"}</small></div><span className={`ops-outcome is-${outcome ?? "unknown"}`}>{effectiveLabel}</span><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="ops-outcome-edit" aria-label={`Set outcome for ${job.customerName ?? "customer"}`} disabled={overrideMutation.isPending}><Pencil size={13} /><ChevronDown size={12} /></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><div className="px-2 py-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Set outcome</div>{OVERRIDE_OPTIONS.map((option) => <DropdownMenuItem key={option.outcome} className="text-sm cursor-pointer" onClick={() => overrideMutation.mutate({ id: call.id, outcome: option.outcome, label: option.label, agentName: agentName ?? "Agent" })}>{option.label}</DropdownMenuItem>)}{call.manualOutcome && <><DropdownMenuSeparator /><DropdownMenuItem className="text-sm cursor-pointer text-muted-foreground" onClick={() => overrideMutation.mutate({ id: call.id, outcome: null, label: null, agentName: agentName ?? "Agent" })}>Clear override</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu></header>
            {(call.aiFlexibility || notes.length > 0) && <div className="ops-readiness-chips">{call.aiFlexibility && <i>{call.aiFlexibility.replace(/_/g, " ")}</i>}{notes.map((note) => <i key={note}>{note}</i>)}</div>}
            {call.summary && <p className="ops-call-summary"><Sparkles size={14} />{call.summary}</p>}
            {call.smsFollowupSent ? <section className="ops-sms-fallback"><header><MessageSquare size={13} />SMS fallback</header><p className="is-outbound">{call.smsFollowupBody ?? "SMS sent"}</p>{call.smsReplies && call.smsReplies.length > 0 ? call.smsReplies.map((reply, index) => <p className="is-inbound" key={`${reply.receivedAt}-${index}`}>{index === call.smsReplies!.length - 1 && call.smsConfirmedAt ? <CheckCheck size={12} /> : null}{reply.text}</p>) : call.smsReply ? <p className="is-inbound">{call.smsConfirmedAt ? <CheckCheck size={12} /> : null}{call.smsReply}</p> : <small>Awaiting reply…</small>}</section> : null}
            {call.recordingUrl ? <LiveRecordingPlayer customer={job.customerName ?? "customer"} recordingUrl={call.recordingUrl} durationSeconds={call.durationSeconds} /> : null}
            {call.transcript && <button className="ops-transcript-toggle" onClick={() => setOpenTranscript((open) => open === call.id ? null : call.id)}><FileText size={14} />{openTranscript === call.id ? "Hide transcript" : "View transcript"}</button>}
            {openTranscript === call.id && call.transcript && <pre className="ops-transcript">{call.transcript}</pre>}
          </article>;
        })}</div>}
      </section>}
    </div>
  </main>;
}
