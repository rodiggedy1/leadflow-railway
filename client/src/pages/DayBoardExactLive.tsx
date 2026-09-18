import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  ExternalLink,
  HelpCircle,
  Home,
  MapPin,
  Mic,
  Phone,
  PlayCircle,
  Send,
  UserRound,
  Users,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { proxyRecordingUrl } from "@/lib/utils";
import { triggerTestChime, useNewReplyNotifier } from "@/hooks/useNewReplyNotifier";
import "./operations-crm-review.css";
import "./day-board-crm-review.css";
import "./day-board-crm-gridless.css";
import "./day-board-leads-cohesion.css";
import "./day-board-exact-live.css";

type TimelineEvent = {
  id: string;
  logId?: number;
  type: "sms_cleaner" | "sms_client" | "call" | "cs_alert" | "status_change";
  status: "sent" | "failed" | "pending" | "status_change";
  timestamp: Date;
  label: string;
  detail?: string;
  recipient?: string;
  success: boolean;
  errorDetail?: string;
  step?: string;
};

type LiveJob = {
  id: number;
  cleanerName: string | null;
  teamName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  cleanerPhone: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
  serviceType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  jobStatus: string | null;
  delayMinutes: number | null;
  issueNote: string | null;
  etaTimestamp: number | null;
  updatedAt: Date | null;
  stepsFired: number;
  stepsSuccess: number;
  totalSteps: number;
  timeline: TimelineEvent[];
  bookingStatus: string | null;
};

type DrawerTab = "Timeline" | "Messages" | "Calls";
type LiveStatus = "not_started" | "on_the_way" | "in_progress" | "running_late" | "finishing_up" | "completed" | "issue";

const CLIENT_PORTRAITS = [
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/xDBqJDhyFPziPsOt.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/TtZGSsKomHzKvXmE.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/ypcLWxzXhQzCCWcC.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/DOtabpUhLIcbLXur.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bvdqcqtPZSJhgtqq.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/gUCwvRBUvWDZUkGx.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/CucZtKJOfkDlJvMg.png",
] as const;

const hours = ["7 AM", "8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM", "7 PM", "8 PM", "9 PM"];
const BOARD_START_HOUR = 7;
const BOARD_END_HOUR = 21;
const BOARD_MINUTES = (BOARD_END_HOUR - BOARD_START_HOUR) * 60;

const statusConfig: Record<LiveStatus, { label: string; color: string; icon: typeof Clock3 }> = {
  not_started: { label: "Not Started", color: "#84909b", icon: Clock3 },
  on_the_way: { label: "On the Way", color: "#4a94f5", icon: Activity },
  in_progress: { label: "In Progress", color: "#23bd7e", icon: Zap },
  running_late: { label: "Running Late", color: "#e8a345", icon: AlertTriangle },
  finishing_up: { label: "Finishing Up", color: "#39bbb7", icon: CheckCircle2 },
  completed: { label: "Completed", color: "#48a86d", icon: CheckCircle2 },
  issue: { label: "Issue", color: "#e66c75", icon: XCircle },
};

function getInitials(value: string | null | undefined) {
  return (value ?? "Client").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "CL";
}

function hash(value: string) {
  return Array.from(value).reduce((total, character) => ((total << 5) - total + character.charCodeAt(0)) | 0, 0);
}

function customerPortrait(name: string | null) {
  return CLIENT_PORTRAITS[Math.abs(hash(name ?? "Client")) % CLIENT_PORTRAITS.length];
}

function teamColor(name: string) {
  const colors = ["#8971ed", "#28b983", "#e676a5", "#4a94f5", "#e3ae42", "#39bbb7"];
  return colors[Math.abs(hash(name)) % colors.length];
}

function normalizeStatus(status: string | null): LiveStatus {
  if (status === "issue_at_property" || status === "no_show") return "issue";
  if (status === "wrapping_up") return "finishing_up";
  if (status && status in statusConfig) return status as LiveStatus;
  return "not_started";
}

function formatDateLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function addDays(value: string, amount: number) {
  const next = new Date(`${value}T12:00:00`);
  next.setDate(next.getDate() + amount);
  return next.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function serviceTime(job: LiveJob) {
  if (!job.serviceDateTime) return "—";
  const date = new Date(job.serviceDateTime);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
}

function parseToMinutes(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = date.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return (parts[0] - BOARD_START_HOUR) * 60 + parts[1];
}

function toPercent(minutes: number) {
  const cellWidth = 100 / hours.length;
  return Math.max(0, Math.min(100, (minutes / 60 + 0.5) * cellWidth));
}

function estimateDuration(job: LiveJob) {
  const bedrooms = job.bedrooms ?? 2;
  const kind = (job.serviceType ?? "").toLowerCase();
  if (kind.includes("deep") || kind.includes("move")) return Math.max(120, 60 + bedrooms * 45);
  if (kind.includes("standard") || kind.includes("recurring")) return Math.max(90, 45 + bedrooms * 30);
  return 90 + bedrooms * 20;
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function CrmRail() {
  const [, navigate] = useLocation();
  const items = [
    ["Day Board", CalendarDays, "/admin/day-board"],
    ["Schedule", Clock3, "/admin/schedule"],
    ["Team availability", Users, "/admin/team-availability"],
    ["Route optimization", Activity, "/admin/field-management"],
  ] as const;
  return <aside className="ocr-sidebar dbr-sidebar">
    <div className="ocr-brand"><div className="ocr-logo-mark"><span /><span /><span /><span /></div><div><strong>Sales CRM</strong><span>Company pipeline</span></div></div>
    <div className="ocr-nav-scroll">
      <nav className="ocr-nav-primary">{items.map(([label, Icon, destination]) => <button type="button" className={label === "Day Board" ? "is-active" : ""} key={label} onClick={() => navigate(destination)}><Icon />{label}</button>)}</nav>
      <div className="ocr-nav-group"><p>VIEWS</p><button><i className="ocr-pipeline-dot dot-yellow" />Today</button><button><i className="ocr-pipeline-dot dot-pink" />Needs attention</button><button><i className="ocr-pipeline-dot dot-violet" />Unassigned</button></div>
      <div className="ocr-nav-group"><p>TEAMS</p><button onClick={() => navigate("/admin/team-availability")}><Users />All field teams</button></div>
      <div className="ocr-nav-group"><p>REPORTING</p><button><CircleDot />Daily health</button><button><AlertTriangle />Exceptions</button></div>
    </div>
    <div className="ocr-nav-utility"><button><Users />Invite teammates</button><button><HelpCircle />Help</button></div>
    <div className="ocr-sidebar-footer"><div className="ocr-trial"><div><strong>14 Days</strong><span>Left on trials</span></div><button><ExternalLink />Add Billings</button></div></div>
  </aside>;
}

function StatusPill({ job }: { job: LiveJob }) {
  const config = statusConfig[normalizeStatus(job.jobStatus)];
  const Icon = config.icon;
  return <span className="dbr-status-pill" style={{ color: config.color, borderColor: `${config.color}65`, background: `${config.color}18` }}><Icon size={11} />{config.label}</span>;
}

function JobBlock({ job, selected, unread, onClick }: { job: LiveJob; selected: boolean; unread: boolean; onClick: () => void }) {
  const start = parseToMinutes(job.serviceDateTime);
  if (start === null || start < -30 || start > BOARD_MINUTES) return null;
  const end = Math.min(BOARD_MINUTES, start + estimateDuration(job));
  const left = toPercent(Math.max(0, start));
  const width = toPercent(end - Math.max(0, start));
  const config = statusConfig[normalizeStatus(job.jobStatus)];
  const Icon = config.icon;
  const smsRatio = job.stepsSuccess / Math.max(job.totalSteps, 1);
  const smsColor = smsRatio > .75 ? "#32c184" : smsRatio > .4 ? "#e3ae42" : "#e77478";
  return <button type="button" onClick={onClick} aria-label={`${job.customerName ?? "Client"}, ${config.label}`} className={`dbr-job ${selected ? "is-selected" : ""}`} style={{ left: `${left}%`, width: `calc(${width}% - 4px)`, borderColor: config.color, color: config.color }}>
    <header><span className="dbr-job-client"><img src={customerPortrait(job.customerName)} alt={`Customer portrait for ${job.customerName ?? "Client"}`} /><span><Icon size={11} />{(job.customerName ?? "Client").split(" ")[0]}</span></span>{unread && <i />}</header>
    <p>{(job.jobAddress ?? "—").split(",")[0]}</p>
    <b className="dbr-sms-bar" style={{ width: `${smsRatio * 100}%`, background: smsColor }} />
  </button>;
}

function LiveTimelineBoard({ jobs, date, selected, unreadJobIds, select }: { jobs: LiveJob[]; date: string; selected: LiveJob | null; unreadJobIds: Set<number>; select: (job: LiveJob) => void }) {
  const lanes = useMemo(() => {
    const grouped = new Map<string, LiveJob[]>();
    for (const job of jobs) {
      const key = job.cleanerName ?? job.teamName ?? "Unassigned";
      grouped.set(key, [...(grouped.get(key) ?? []), job]);
    }
    return Array.from(grouped.entries()).sort(([, first], [, second]) => Math.min(...first.map(job => parseToMinutes(job.serviceDateTime) ?? 9999)) - Math.min(...second.map(job => parseToMinutes(job.serviceDateTime) ?? 9999)));
  }, [jobs]);
  const [nowPosition, setNowPosition] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      if (date !== today) return setNowPosition(null);
      const parts = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).split(":").map(Number);
      const minutes = (parts[0] - BOARD_START_HOUR) * 60 + parts[1];
      setNowPosition(minutes >= 0 && minutes <= BOARD_MINUTES ? toPercent(minutes) : null);
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [date]);
  return <section className="dbr-timeline-card">
    <header className="dbr-time-axis"><span>Team</span><div>{hours.map(hour => <b key={hour}>{hour}</b>)}</div></header>
    <div className="dbr-lanes">{lanes.map(([name, teamJobs]) => <section className="dbr-lane" key={name}>
      <header><span className="dbr-team-avatar" style={{ background: teamColor(name) }} aria-hidden="true">{getInitials(name)}</span><div><b>{name}</b><small>{`${name.split(" ")[0]} · ${teamJobs.length} job${teamJobs.length === 1 ? "" : "s"}`}</small></div></header>
      <div className="dbr-lane-time">{hours.map(hour => <i key={hour} />)}{nowPosition != null && <b className="dbr-now-line" style={{ left: `${nowPosition}%` }}><span>Now</span></b>}{teamJobs.map(job => <JobBlock key={job.id} job={job} selected={selected?.id === job.id} unread={unreadJobIds.has(job.id)} onClick={() => select(job)} />)}</div>
    </section>)}</div>
    <LiveSmsHealthStrip jobs={jobs} />
  </section>;
}

function LiveSmsHealthStrip({ jobs }: { jobs: LiveJob[] }) {
  const dots = useMemo(() => jobs.flatMap(job => job.timeline.map((event, index) => {
    const eventMinutes = parseToMinutes(event.timestamp ? new Date(event.timestamp).toISOString() : null);
    return { id: `${job.id}-${event.id}-${index}`, left: eventMinutes == null ? null : toPercent(eventMinutes), color: event.status === "failed" ? "#e77478" : event.status === "pending" ? "#e1aa43" : "#2ec281", label: `${event.label} · ${job.customerName ?? "Client"}` };
  }).filter((entry): entry is { id: string; left: number; color: string; label: string } => entry.left !== null)), [jobs]);
  return <footer className="dbr-sms-health"><header><b>SMS Activity</b><span><i style={{ background: "#2ec281" }} />Sent <i style={{ background: "#e06c73" }} />Failed <i style={{ background: "#e1aa43" }} />Pending</span></header><div>{hours.map(hour => <i key={hour} />)}{dots.map(dot => <button key={dot.id} title={dot.label} style={{ left: `${dot.left}%`, background: dot.color }} />)}</div></footer>;
}

function DetailDrawer({ job, close, unread, markRead, confirmAssignment }: { job: LiveJob; close: () => void; unread: boolean; markRead: (jobId: number) => void; confirmAssignment: (jobId: number) => void }) {
  const [tab, setTab] = useState<DrawerTab>("Timeline");
  const [recipient, setRecipient] = useState<"client" | "cleaner">("client");
  const [draft, setDraft] = useState("");
  const [openTranscripts, setOpenTranscripts] = useState<Record<number, boolean>>({});
  const { data: messages, isLoading: messagesLoading, refetch: refetchMessages } = trpc.fieldMgmt.getJobMessages.useQuery({ cleanerJobId: job.id }, { enabled: tab === "Messages", refetchInterval: tab === "Messages" ? 15_000 : false, staleTime: 10_000 });
  const { data: calls, isLoading: callsLoading } = trpc.fieldMgmt.getJobCalls.useQuery({ cleanerJobId: job.id }, { enabled: tab === "Calls" });
  const sendSms = trpc.fieldMgmt.sendJobSms.useMutation({ onSuccess: () => { setDraft(""); void refetchMessages(); } });
  const voiceAlert = trpc.fieldMgmt.voiceAlertCleaner.useMutation({ onSuccess: data => {
    const number = data.dialedNumber ? data.dialedNumber.replace(/^\+1/, "").replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") : null;
    toast.success(data.isCsFallback ? `Call placed to CS office${number ? ` — ${number}` : ""} (no cleaner phone on file)` : `Call placed to cleaner${number ? ` — ${number}` : ""}`);
  }, onError: error => toast.error(error.message || "Failed to place call") });
  const previousInboundCount = useRef<number | null>(null);
  useEffect(() => {
    if (!messages) return;
    const inbound = messages.filter(message => message.direction === "inbound").length;
    if (previousInboundCount.current !== null && inbound > previousInboundCount.current) void triggerTestChime();
    previousInboundCount.current = inbound;
  }, [messages]);
  useEffect(() => { const handler = (event: KeyboardEvent) => event.key === "Escape" && close(); window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [close]);
  const phone = recipient === "client" ? job.customerPhone : job.cleanerPhone;
  const duration = estimateDuration(job);
  const durationLabel = `${Math.floor(duration / 60)}h ${duration % 60 ? `${duration % 60}m` : ""}`.trim();
  const smsProgress = Math.round((job.stepsSuccess / Math.max(job.totalSteps, 1)) * 100);
  return <><div className="dbr-drawer-backdrop" onClick={close} /><aside className="dbr-drawer dbr-live-drawer">
    <header className="dbr-drawer-head"><div><StatusPill job={job} /><h2>{job.customerName ?? "Client"}</h2><p><MapPin size={12} />{job.jobAddress ?? "—"}</p></div><button onClick={close} aria-label="Close details"><X /></button></header>
    <section className="dbr-drawer-meta">{[[Clock3, "Start", serviceTime(job)], [Home, "Duration", durationLabel], [UserRound, "Cleaner", job.cleanerName?.split(" ")[0] ?? "—"]].map(([Icon, label, value]) => { const MetaIcon = Icon as typeof Clock3; return <div key={label as string}><span><MetaIcon size={13} />{label as string}</span><b>{value as string}</b></div>; })}</section>
    <section className="dbr-service"><div><small>Service</small><b>{job.serviceType ?? "—"}</b></div>{job.bedrooms != null && <span>{job.bedrooms} BR</span>}{job.bathrooms != null && <span>{job.bathrooms} BA</span>}</section>
    <section className="dbr-step-health"><header><span>SMS Steps</span><b>{job.stepsSuccess}/{job.totalSteps}</b></header><div><i style={{ width: `${smsProgress}%`, background: smsProgress > 75 ? "#30bd80" : "#e2a942" }} /></div></section>
    {job.bookingStatus === "new" && <section className="dbr-alert is-warning"><AlertTriangle /><div><b>Unconfirmed in Launch27</b><p>Booking status is new — automation may skip this job.</p><button onClick={() => confirmAssignment(job.id)}>Confirm Assignment</button></div></section>}
    {job.etaTimestamp && (job.jobStatus === "on_the_way" || job.jobStatus === "running_late") && <section className="dbr-alert is-eta"><Activity /><div><b>ETA: {new Date(job.etaTimestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</b><p>Cleaner estimated arrival time</p></div></section>}
    {job.issueNote && <section className="dbr-alert is-issue"><AlertTriangle /><p>{job.issueNote}</p></section>}
    <section className="dbr-voice"><button onClick={() => voiceAlert.mutate({ cleanerJobId: job.id })} disabled={voiceAlert.isPending}><Phone />{voiceAlert.isPending ? "Calling Cleaner…" : "Voice Alert Cleaner"}</button></section>
    <nav className="dbr-drawer-tabs">{(["Timeline", "Messages", "Calls"] as DrawerTab[]).map(name => <button className={tab === name ? "is-active" : ""} key={name} onClick={() => { setTab(name); if (name === "Messages" && unread) markRead(job.id); }}>{name}{name === "Messages" && unread && <i />}</button>)}</nav>
    <div className="dbr-drawer-scroll">
      {tab === "Timeline" && <section className="dbr-event-list">{job.timeline.length === 0 ? <p className="dbr-live-empty">No events yet</p> : job.timeline.map((event, index) => <article key={event.id}><aside><i style={{ background: event.status === "failed" ? "#e77478" : event.status === "pending" ? "#e1aa43" : "#2ec281" }} />{index < job.timeline.length - 1 && <b />}</aside><div><header><strong>{event.label}</strong><time>{new Date(event.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })}</time></header>{event.detail && <p>{event.detail}</p>}{event.status === "failed" && <small className="dbr-live-error">Failed{event.errorDetail ? ` · ${event.errorDetail}` : ""}</small>}</div></article>)}</section>}
      {tab === "Messages" && <section className="dbr-messages dbr-live-messages">{messagesLoading ? <p className="dbr-live-empty">Loading messages…</p> : !messages?.length ? <p className="dbr-live-empty">No messages yet</p> : messages.map(message => <article className={message.direction === "outbound" ? "out" : "in"} key={`${message.direction}-${message.id}`}><small>{message.direction === "outbound" ? message.label.replace(/_/g, " ") : message.label} · {new Date(message.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })}</small><p>{message.body}</p></article>)}</section>}
      {tab === "Calls" && <section className="dbr-calls">{callsLoading ? <p className="dbr-live-empty">Loading calls…</p> : !calls?.length ? <p className="dbr-live-empty">No calls recorded for this job</p> : calls.map(call => { const isOpen = openTranscripts[call.id] ?? false; const recordingSrc = proxyRecordingUrl(call.recordingUrl); return <article key={call.id}><header><i><Mic /></i><div><b>{call.step?.replace(/_/g, " ") ?? "Call"}</b><span>{(call.outcome ?? "no answer").replace(/_/g, " ")}{call.durationSeconds ? ` · ${formatDuration(call.durationSeconds)}` : ""}</span></div></header>{call.summary && <p>{call.summary}</p>}{recordingSrc && <audio className="dbr-live-audio" src={recordingSrc} controls />}{call.recordingUrl && <footer><a href={call.recordingUrl} target="_blank" rel="noreferrer"><PlayCircle />Open recording</a>{call.transcript && <button onClick={() => setOpenTranscripts(previous => ({ ...previous, [call.id]: !isOpen }))}>{isOpen ? "Hide transcript" : "View transcript"}</button>}</footer>}{!call.recordingUrl && call.transcript && <footer><button onClick={() => setOpenTranscripts(previous => ({ ...previous, [call.id]: !isOpen }))}>{isOpen ? "Hide transcript" : "View transcript"}</button></footer>}{isOpen && call.transcript && <pre className="dbr-live-transcript">{call.transcript}</pre>}</article>; })}</section>}
    </div>
    {tab === "Messages" && <footer className="dbr-compose"><div><button className={recipient === "client" ? "is-active" : ""} onClick={() => setRecipient("client")}>Client</button><button className={recipient === "cleaner" ? "is-active" : ""} onClick={() => setRecipient("cleaner")}>Cleaner</button><small>{phone ?? "no phone on file"}</small></div><textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Type a message..." /><button onClick={() => { if (draft.trim() && phone) sendSms.mutate({ cleanerJobId: job.id, to: phone, body: draft.trim() }); }} disabled={!draft.trim() || !phone || sendSms.isPending}><Send /></button></footer>}
  </aside></>;
}

export default function DayBoardExactLive() {
  const [, navigate] = useLocation();
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  const [selected, setSelected] = useState<LiveJob | null>(null);
  const [lastRead, setLastRead] = useState<Record<number, number>>(() => { try { return JSON.parse(localStorage.getItem("dayboard_last_read") ?? "{}"); } catch { return {}; } });
  const utils = trpc.useUtils();
  const { data: jobs, isLoading, isFetching } = trpc.fieldMgmt.getJobsForDay.useQuery({ date }, { staleTime: 30_000, refetchInterval: 60_000, refetchIntervalInBackground: false, retry: false, throwOnError: false });
  const confirmAssignment = trpc.fieldMgmt.confirmAssignment.useMutation({ onSuccess: () => { toast.success("Assignment confirmed — automation will now include this job."); void utils.fieldMgmt.getJobsForDay.invalidate({ date }); }, onError: error => toast.error(`Failed to confirm: ${error.message}`) });
  const allJobs = (jobs ?? []) as LiveJob[];
  const activeJobs = useMemo(() => allJobs.filter(job => job.bookingStatus !== "rescheduled" && job.bookingStatus !== "cancelled"), [allJobs]);
  const removedJobs = useMemo(() => allJobs.filter(job => job.bookingStatus === "rescheduled" || job.bookingStatus === "cancelled"), [allJobs]);
  const jobIds = useMemo(() => allJobs.map(job => job.id), [allJobs]);
  const { data: unreadReplies } = trpc.fieldMgmt.getJobUnreadReplies.useQuery({ cleanerJobIds: jobIds }, { enabled: jobIds.length > 0, refetchInterval: 60_000, staleTime: 55_000, retry: false, throwOnError: false });
  const unreadJobIds = useMemo(() => new Set((unreadReplies ?? []).filter(reply => reply.latestReplyAt > (lastRead[reply.cleanerJobId] ?? 0)).map(reply => reply.cleanerJobId)), [lastRead, unreadReplies]);
  useNewReplyNotifier(unreadJobIds, allJobs);
  useEffect(() => { const handler = (event: KeyboardEvent) => event.key === "Escape" && setSelected(null); window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  const stats = useMemo(() => ({
    total: activeJobs.length,
    active: activeJobs.filter(job => ["in_progress", "on_the_way", "finishing_up", "wrapping_up"].includes(job.jobStatus ?? "")).length,
    issues: activeJobs.filter(job => ["issue_at_property", "no_show"].includes(job.jobStatus ?? "")).length,
    done: activeJobs.filter(job => job.jobStatus === "completed").length,
    smsFailed: activeJobs.reduce((count, job) => count + job.timeline.filter(event => event.status === "failed").length, 0),
  }), [activeJobs]);
  const dateRail = useMemo(() => [-1, 0, 1, 2, 3].map(offset => addDays(date, offset)), [date]);
  const markRead = useCallback((jobId: number) => setLastRead(previous => { const next = { ...previous, [jobId]: Date.now() }; try { localStorage.setItem("dayboard_last_read", JSON.stringify(next)); } catch {} return next; }), []);
  return <main className="operations-crm-review dbr-shell dbr-live-shell">
    <CrmRail />
    <section className="dbr-workspace">
      <header className="ocr-header"><div className="ocr-page-title"><h1>Day Board</h1><span><i />Live workspace</span></div><div className="ocr-header-actions"><button onClick={() => navigate("/admin/field-management")} title="Open Field Management"><Activity /></button><button className="has-notification" title="Day Board notifications"><Bell /></button><button className="ocr-profile"><i>MA</i><span>Madison</span><ChevronDown size={13} /></button></div></header>
      <nav className="dbr-page-tabs"><button onClick={() => navigate("/admin/schedule")}>Schedule</button><button className="is-active">Day Board</button><button onClick={() => navigate("/admin/team-availability")}>Team availability</button><button onClick={() => navigate("/admin/field-management")}>Workflow</button></nav>
      <section className="dbr-toolbar"><div className="dbr-date-buttons">{dateRail.map(item => item === date ? <label className="dbr-live-date-control is-active" key={item}><CalendarDays />{formatDateLabel(item)}<input className="dbr-live-date-input" aria-label="Choose service date" type="date" value={date} onChange={event => setDate(event.target.value)} /></label> : <button key={item} onClick={() => setDate(item)}>{formatDateLabel(item)}</button>)}</div><div className="dbr-toolbar-actions"><button>All statuses <ChevronDown /></button><button>All teams <ChevronDown /></button><button onClick={() => void triggerTestChime()}><Bell />Test Sound</button></div></section>
      <section className="dbr-summary"><div><small>Total</small><b>{isLoading ? "—" : stats.total}</b></div><div><small>Active</small><b className="is-active">{isLoading ? "—" : stats.active}</b></div><div><small>Issues</small><b className="is-issue">{isLoading ? "—" : stats.issues}</b></div><div><small>Done</small><b>{isLoading ? "—" : stats.done}</b></div><div><small>SMS Failed</small><b className="is-issue">{isLoading ? "—" : stats.smsFailed}</b></div><span>{formatDateLabel(date)} · East Coast{isFetching ? " · Updating…" : ""}</span></section>
      <section className="dbr-board-scroll">{isLoading ? <div className="dbr-live-loading">Loading Day Board…</div> : activeJobs.length === 0 ? <div className="dbr-live-loading">No jobs on {formatDateLabel(date)}.</div> : <LiveTimelineBoard jobs={activeJobs} date={date} selected={selected} unreadJobIds={unreadJobIds} select={setSelected} />}
        {removedJobs.length > 0 && <section className="dbr-removed"><header><XCircle />Removed from Schedule <b>{removedJobs.length}</b></header>{removedJobs.map(job => <button key={job.id} onClick={() => setSelected(job)}><div><strong>{job.customerName ?? "Client"}</strong><span>{(job.jobAddress ?? "—").split(",")[0]}</span></div><time>{serviceTime(job)}</time><span>{job.cleanerName?.split(" ")[0] ?? job.teamName ?? "—"}</span><b className={job.bookingStatus === "rescheduled" ? "is-rescheduled" : ""}>{job.bookingStatus === "rescheduled" ? "Rescheduled" : "Cancelled"}</b><ChevronRight /></button>)}</section>}
        <footer className="dbr-legend">{(Object.keys(statusConfig) as LiveStatus[]).map(status => <span key={status}><i style={{ background: statusConfig[status].color }} />{statusConfig[status].label}</span>)}<em><i />SMS health bar</em></footer>
      </section>
    </section>
    {selected && <DetailDrawer job={selected} close={() => setSelected(null)} unread={unreadJobIds.has(selected.id)} markRead={markRead} confirmAssignment={jobId => confirmAssignment.mutate({ cleanerJobId: jobId })} />}
  </main>;
}
