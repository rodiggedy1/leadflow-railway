import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  GripVertical,
  Lock,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import { toast } from "sonner";
import LeadflowScheduleCallLogPanel from "@/components/LeadflowScheduleCallLogPanel";
import LeadflowScheduleIssueDialog from "@/components/LeadflowScheduleIssueDialog";
import { LeadflowScheduleMap } from "@/components/LeadflowScheduleMap";
import "./operations-crm-review.css";
import "./schedule-crm-review.css";
import "./schedule-leads-cohesion.css";
import "./schedule-identity-portraits.css";
import "./schedule-card-density.css";
import "./schedule-palette-balance.css";
import "./schedule-crm-exact-live.css";

const ET = "America/New_York";

type Team = {
  id: number;
  name: string;
  color: string | null;
  isActive: number;
  isArchived?: number;
  regionTags?: string | null;
  workScheduleUnavailable?: boolean;
  overrideNote?: string | null;
};

type Job = {
  id: number;
  customerName: string | null;
  customerPhone?: string | null;
  jobAddress: string | null;
  serviceType: string | null;
  serviceDateTime: string | null;
  frequency?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  bookingStatus: string | null;
  isNewClient?: boolean;
  isRecurring?: boolean;
  isMoveInOut?: boolean;
  requestedTeam?: string | null;
  customerNotes?: string | null;
  staffNotes?: string | null;
  adminNotes?: string | null;
  checklistItems?: string | null;
  clientHistory?: {
    totalBookings: number;
    lifetimeValue: number;
    avgPrice: number;
    usualTeam: string | null;
    aiMemoryBullets?: string[];
  } | null;
  recentCalls?: Array<{ step: string; outcome: string; summary: string | null; transcript: string | null; durationSeconds: number; createdAt: string | Date }>;
  callsSummary?: string | null;
  assignment?: {
    teamId: number;
    teamName: string | null;
    routeOrder: number;
    driveTimeSecs: number | null;
    estimatedArrivalMs: number | null;
    estimatedDepartureMs: number | null;
  } | null;
};

type Filter = "all" | "new" | "recurring" | "move";

const customerPortraits = [
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/xDBqJDhyFPziPsOt.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/TtZGSsKomHzKvXmE.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/ypcLWxzXhQzCCWcC.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/VjRgwvLUkGAKxnVA.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bvdqcqtPZSJhgtqq.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/DOtabpUhLIcbLXur.png",
];

function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: ET });
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return next.toLocaleDateString("en-CA", { timeZone: ET });
}

function dayLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: ET });
}

function timeLabel(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: ET });
}

function dateTimeLabel(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-US", { weekday: "short", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: ET });
}

function driveLabel(secs?: number | null) {
  if (!secs) return "Route not calculated";
  if (secs < 60) return `${secs}s drive`;
  return `${Math.round(secs / 60)}m drive`;
}

function customerName(job: Job) {
  return job.customerName?.trim() || "Customer";
}

function initials(value: string) {
  return value.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
}

function portraitFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return customerPortraits[Math.abs(hash) % customerPortraits.length];
}

function CustomerPortrait({ name, detail = false }: { name: string; detail?: boolean }) {
  return <img className={`scr-person-portrait${detail ? " scr-person-portrait-detail" : ""}`} src={portraitFor(name)} alt={`Customer portrait for ${name}`} />;
}

function frequency(job: Job) {
  if (job.isMoveInOut) return "Move In/Out";
  if (job.isRecurring) return "Recurring";
  if (job.isNewClient) return "New";
  return job.frequency?.replace(/\s*\(.*?\)/g, "").trim() || "Service";
}

function service(job: Job) {
  if (job.serviceType) return job.serviceType;
  const parts = [job.bedrooms != null ? `${job.bedrooms} Bed` : null, job.bathrooms != null ? `${job.bathrooms} Bath` : null].filter(Boolean);
  return parts.join(" / ") || "Cleaning service";
}

function ScheduleSidebar() {
  const [location] = window.location.pathname ? [window.location.pathname] : [""];
  const tabLink = (tab: string) => `/admin/field-management?tab=${tab}`;
  const staticGroups = [
    ["Operations", "board"],
    ["Control Tower", "tower"],
    ["Schedule", "schedule"],
    ["Job Log", "log"],
    ["Workflow", "workflow"],
    ["AI Concierge", "concierge"],
  ] as const;
  return (
    <aside className="ocr-sidebar scr-sidebar" aria-label="Schedule workspaces">
      <div className="ocr-brand"><div className="ocr-logo-mark" aria-hidden="true"><span /><span /><span /><span /></div><div><strong>Sales CRM</strong><small>Company pipeline</small></div></div>
      <div className="ocr-nav-scroll">
        <nav className="ocr-nav-primary">
          {staticGroups.map(([label, tab]) => <a key={tab} href={tab === "schedule" ? "/admin/schedule" : tabLink(tab)} className={tab === "schedule" ? "is-active" : ""}><CalendarDays size={16} /><span>{label}</span></a>)}
        </nav>
        <div className="ocr-nav-group"><p>TEAM</p><a href="/admin/schedule"><Users />Team routes</a><a href="/admin/schedule"><Navigation />Coverage</a></div>
        <div className="ocr-nav-group"><p>REPORTING</p><a href={tabLink("schedule")}><ShieldAlert />Schedule health</a><a href={tabLink("log")}><FileText />Day log</a></div>
      </div>
      <div className="ocr-utility"><a href="/admin/settings"><Settings2 />Settings</a></div>
      <div className="ocr-billing"><div><strong>Live</strong><small>Scheduling workspace</small></div><a href={location === "/admin/schedule" ? "#schedule" : "/admin/schedule"}><Calendar />Open schedule</a></div>
    </aside>
  );
}

function LiveJobCard({ job, selected, locked, conflict, onSelect }: { job: Job; selected: boolean; locked: boolean; conflict: boolean; onSelect: () => void }) {
  const name = customerName(job);
  const kind = frequency(job);
  const tagClass = kind.toLowerCase().replaceAll("/", "").replaceAll(" ", "-");
  return (
    <button className={`scr-job-card ${selected ? "is-selected" : ""} ${conflict ? "is-conflict" : ""}`} type="button" onClick={onSelect}>
      <span className="scr-job-person"><CustomerPortrait name={name} /><span className="scr-job-person-name">{name}</span></span>
      <span className="scr-job-context"><span className="scr-job-service">{service(job)}</span><span className="scr-job-address"><MapPin size={12} />{job.jobAddress || "Address unavailable"}</span>{job.requestedTeam && <span className="scr-request">Requested: {job.requestedTeam}</span>}{conflict && <span className="scr-conflict"><AlertTriangle size={12} />Time conflict — review</span>}</span>
      <span className="scr-job-timing"><span className="scr-job-card-top"><GripVertical size={14} /><time>{timeLabel(job.serviceDateTime)}</time><span className={`scr-job-tag ${tagClass}`}>{kind}</span>{locked && <Lock size={12} />}</span></span>
      <span className="scr-drive"><Navigation size={12} />{driveLabel(job.assignment?.driveTimeSecs)}</span>
    </button>
  );
}

function TeamRoute({ team, jobs, selectedJobId, lockedJobIds, conflictJobIds, onJobSelect, onTeamSelect }: { team: Team; jobs: Job[]; selectedJobId: number | null; lockedJobIds: Set<number>; conflictJobIds: Set<number>; onJobSelect: (job: Job) => void; onTeamSelect: (team: Team) => void }) {
  const isOff = team.workScheduleUnavailable || team.isActive !== 1;
  const isFocused = jobs.some(job => job.id === selectedJobId);
  const teamDrive = jobs.reduce((sum, job) => sum + (job.assignment?.driveTimeSecs || 0), 0);
  const region = [team.regionTags || "", `${jobs.length} job${jobs.length === 1 ? "" : "s"}`, teamDrive ? `${Math.round(teamDrive / 60)}m driving` : "route pending"].filter(Boolean).join(" · ");
  return (
    <section className={`scr-team-route ${isOff ? "is-off" : ""} ${isFocused ? "is-focused" : ""}`}>
      {isOff && <div className="scr-team-banner"><Calendar size={12} />{team.overrideNote || "Off today (schedule)"}</div>}
      <header><i className="scr-team-avatar" style={{ background: team.color || "#777b82" }}>{initials(team.name)}</i><button type="button" onClick={() => onTeamSelect(team)}>{team.name}</button>{conflictJobIds.size > 0 && jobs.some(job => conflictJobIds.has(job.id)) && <span className="scr-team-alert">{jobs.filter(job => conflictJobIds.has(job.id)).length} issue</span>}<ChevronDown size={14} /></header>
      <p>{region}</p>
      <div className="scr-team-jobs">{jobs.length ? jobs.map(job => <LiveJobCard key={job.id} job={job} selected={selectedJobId === job.id} locked={lockedJobIds.has(job.id)} conflict={conflictJobIds.has(job.id)} onSelect={() => onJobSelect(job)} />) : <div className="scr-empty-team">No jobs assigned</div>}</div>
    </section>
  );
}

function ClientDrawer({ job, teams, onClose, onRaiseIssue }: { job: Job | null; teams: Team[]; onClose: () => void; onRaiseIssue: (job: Job) => void }) {
  const utils = trpc.useUtils();
  const [showReassign, setShowReassign] = useState(false);
  const manualAssign = trpc.leadflowSchedule.manualAssign.useMutation({
    onSuccess: () => {
      if (job?.serviceDateTime) utils.leadflowSchedule.getSchedule.invalidate({ date: job.serviceDateTime.slice(0, 10) });
      setShowReassign(false);
      toast.success("Job reassigned");
    },
    onError: error => toast.error(error.message),
  });
  if (!job) return null;
  const name = customerName(job);
  const history = job.clientHistory;
  const checklist = (() => { try { return job.checklistItems ? JSON.parse(job.checklistItems) as Array<{ text: string; checked: boolean }> : []; } catch { return []; } })();
  return (
    <div className="scr-drawer-backdrop" onClick={onClose}>
      <aside className="scr-client-drawer" onClick={event => event.stopPropagation()} aria-label="Customer schedule profile">
        <header><div className="scr-client-identity"><CustomerPortrait name={name} detail /><div><span className="scr-overline">CLIENT PROFILE</span><h2>{name}</h2><p><MapPin size={13} />{job.jobAddress || "Address unavailable"}</p></div></div><button type="button" aria-label="Close customer profile" onClick={onClose}><X /></button></header>
        <div className="scr-drawer-scroll">
          <section className="scr-client-stats"><div><b>{history?.totalBookings ?? "—"}</b><span>Cleanings</span></div><div><b>{history ? `$${history.lifetimeValue.toLocaleString()}` : "—"}</b><span>Lifetime</span></div><div><b>{history ? `$${history.avgPrice}` : "—"}</b><span>Avg / visit</span></div><div><b>{history?.usualTeam || job.assignment?.teamName || "—"}</b><span>Usual team</span></div></section>
          <section><h3><CalendarDays />This Job</h3><div className="scr-detail-grid"><article><label>Service</label><b>{service(job)}</b></article><article><label>Scheduled</label><b>{dateTimeLabel(job.serviceDateTime)}</b></article><article><label>Frequency</label><b>{frequency(job)}</b></article><article><label>Team</label><b>{job.assignment?.teamName || "Unassigned"}</b></article></div></section>
          <section className="scr-assignment-section"><div className="scr-assignment-heading"><h3><Users />Assignment</h3><span>{job.assignment?.teamName || "Unassigned"}</span></div><p>Choose the team assigned to this service.</p><button className="scr-assignment-open" type="button" onClick={() => setShowReassign(true)}><Users />{job.assignment?.teamName ? "Change team" : "Assign a team"}<ChevronDown /></button></section>
          {(job.customerNotes || job.staffNotes || job.adminNotes || checklist.length > 0) && <section><h3><FileText />Notes & checklist</h3>{job.customerNotes && <div className="scr-note-card"><label>Customer notes</label><p>{job.customerNotes}</p></div>}{job.staffNotes && <div className="scr-note-card"><label>Staff notes</label><p>{job.staffNotes}</p></div>}{job.adminNotes && <div className="scr-note-card"><label>Admin notes</label><p>{job.adminNotes}</p></div>}{checklist.length > 0 && <div className="scr-checklist">{checklist.map((item, index) => <span key={`${item.text}-${index}`}>{item.checked ? "✓" : "○"} {item.text}</span>)}</div>}</section>}
          {job.recentCalls && job.recentCalls.length > 0 && <section><h3><Phone />Recent calls</h3>{job.recentCalls.map((call, index) => <div className="scr-call-card" key={`${call.step}-${index}`}><b>{call.step.replaceAll("_", " ")} <i>{call.outcome}</i></b><p>{call.transcript || call.summary || "No call summary available."}</p></div>)}</section>}
          {history?.aiMemoryBullets && history.aiMemoryBullets.length > 0 && <section><h3><Sparkles />AI memory</h3><ul className="scr-memory">{history.aiMemoryBullets.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section>}
        </div>
        <footer><button className="scr-link-button" type="button" onClick={() => onRaiseIssue(job)}><AlertTriangle />Raise issue</button><button type="button" onClick={() => setShowReassign(true)}>Reassign</button><button className="scr-primary-button" type="button" disabled={!job.customerPhone} title={job.customerPhone ? "Customer messaging remains in the existing Inbox workflow" : "No customer phone is available"}>Text customer</button></footer>
        {showReassign && <div className="scr-inline-dialog"><header><b>Reassign {name}</b><button type="button" onClick={() => setShowReassign(false)}><X /></button></header><p>Select a live team. This changes the assignment; use Lock All to lock the current route.</p><div>{teams.filter(team => team.isActive === 1 && !team.isArchived).map(team => <button key={team.id} type="button" disabled={manualAssign.isPending} onClick={() => manualAssign.mutate({ date: job.serviceDateTime?.slice(0, 10) || todayStr(), jobId: job.id, teamId: team.id, sourceTeamId: job.assignment?.teamId })}><i style={{ background: team.color || "#777b82" }} />{team.name}{job.assignment?.teamId === team.id && <small>Current</small>}</button>)}</div></div>}
      </aside>
    </div>
  );
}

function TeamModal({ teams, selectedTeam, onClose, onChanged }: { teams: Team[]; selectedTeam: Team | null; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  const [adding, setAdding] = useState(false);
  const upsert = trpc.leadflowSchedule.upsertTeam.useMutation({ onSuccess: () => { onChanged(); setName(""); setHomeAddress(""); setAdding(false); toast.success("Team added"); }, onError: error => toast.error(error.message) });
  const archive = trpc.leadflowSchedule.archiveTeam.useMutation({ onSuccess: onChanged, onError: error => toast.error(error.message) });
  return <div className="scr-modal-backdrop" onClick={onClose}><section className="scr-modal" onClick={event => event.stopPropagation()}><header><div><Settings2 /><span><b>{selectedTeam ? selectedTeam.name : "Manage Teams"}</b><small>Live scheduling controls</small></span></div><button type="button" onClick={onClose}><X /></button></header>{adding ? <div className="scr-live-team-form"><label>Team name<input value={name} onChange={event => setName(event.target.value)} /></label><label>Home base<input value={homeAddress} onChange={event => setHomeAddress(event.target.value)} /></label><div><button type="button" onClick={() => { setAdding(false); setName(""); setHomeAddress(""); }}>Cancel</button><button type="button" disabled={!name.trim() || upsert.isPending} onClick={() => upsert.mutate({ name: name.trim(), homeAddress: homeAddress.trim() || undefined, maxHoursPerDay: 8 })}>{upsert.isPending ? "Adding…" : "Add team"}</button></div></div> : <><button className="scr-modal-add" type="button" onClick={() => setAdding(true)}><Plus />Add Team</button>{teams.map(team => <article key={team.id}><i className="scr-team-avatar" style={{ background: team.color || "#777b82" }}>{initials(team.name)}</i><span><b>{team.name}</b><small>{team.regionTags || "No region tags"}</small></span><button type="button" disabled={archive.isPending} onClick={() => archive.mutate({ teamId: team.id, archive: !team.isArchived })}>{team.isArchived ? "Restore" : "Archive"}</button></article>)}</>}</section></div>;
}

export default function LeadflowScheduleCRMExactLive() {
  const utils = trpc.useUtils();
  const [date, setDate] = useState(todayStr);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [showTeams, setShowTeams] = useState(false);
  const [showCalls, setShowCalls] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [suggestAddress, setSuggestAddress] = useState("");
  const [issueJob, setIssueJob] = useState<Job | null>(null);

  const { data, isLoading } = trpc.leadflowSchedule.getSchedule.useQuery({ date }, { staleTime: 30_000, refetchOnWindowFocus: false });
  const { data: jobLocks = [] } = trpc.leadflowSchedule.getJobLocks.useQuery({ date });
  const { data: analysisData, isFetching: analysisFetching } = trpc.leadflowSchedule.analyzeSchedule.useQuery({ date }, { enabled: showAnalysis, staleTime: 60_000 });
  const { data: dayIssues = [] } = trpc.leadflowScheduleCalls.getDayIssues.useQuery({ jobDate: date }, { refetchInterval: 30_000 });
  const { data: suggestionData, isFetching: suggestionFetching } = trpc.leadflowSchedule.suggestSlots.useQuery({ address: suggestAddress, date }, { enabled: suggestAddress.length > 5, staleTime: 60_000 });
  useOpsStream({ onJobUpdate: () => utils.leadflowSchedule.getSchedule.invalidate({ date }) });

  const optimize = trpc.leadflowSchedule.optimizeDay.useMutation({ onSuccess: () => { utils.leadflowSchedule.getSchedule.invalidate({ date }); utils.leadflowSchedule.getJobLocks.invalidate({ date }); toast.success("Routes optimized"); }, onError: error => toast.error(error.message) });
  const reset = trpc.leadflowSchedule.resetOptimization.useMutation({ onSuccess: () => { utils.leadflowSchedule.getSchedule.invalidate({ date }); utils.leadflowSchedule.getJobLocks.invalidate({ date }); toast.success("Owned assignments and locks cleared"); }, onError: error => toast.error(error.message) });
  const rerunDistances = trpc.leadflowSchedule.rerunDistances.useMutation({ onSuccess: result => { utils.leadflowSchedule.getSchedule.invalidate({ date }); toast.success(result.message); }, onError: error => toast.error(error.message) });
  const lockJob = trpc.leadflowSchedule.lockJob.useMutation({ onSuccess: () => utils.leadflowSchedule.getJobLocks.invalidate({ date }), onError: error => toast.error(error.message) });

  const jobs = (data?.jobs ?? []) as Job[];
  const teams = (data?.teams ?? []) as Team[];
  const lockedJobIds = useMemo(() => new Set(jobLocks.map(lock => lock.leadflowJobId)), [jobLocks]);
  const activeJobs = useMemo(() => jobs.filter(job => job.bookingStatus !== "cancelled"), [jobs]);
  const filteredJobs = useMemo(() => activeJobs.filter(job => filter === "all" || (filter === "new" && job.isNewClient) || (filter === "recurring" && job.isRecurring) || (filter === "move" && job.isMoveInOut)), [activeJobs, filter]);
  const counts = useMemo(() => ({ all: activeJobs.length, new: activeJobs.filter(job => job.isNewClient).length, recurring: activeJobs.filter(job => job.isRecurring).length, move: activeJobs.filter(job => job.isMoveInOut).length }), [activeJobs]);
  const grouped = useMemo(() => {
    const result = new Map<number | null, Job[]>();
    teams.forEach(team => result.set(team.id, []));
    result.set(null, []);
    filteredJobs.forEach(job => result.get(job.assignment?.teamId ?? null)?.push(job));
    result.forEach(group => group.sort((a, b) => (a.serviceDateTime ? new Date(a.serviceDateTime).getTime() : Infinity) - (b.serviceDateTime ? new Date(b.serviceDateTime).getTime() : Infinity) || (a.assignment?.routeOrder ?? 999) - (b.assignment?.routeOrder ?? 999)));
    return result;
  }, [filteredJobs, teams]);
  const conflictJobIds = useMemo(() => {
    const conflicts = new Set<number>();
    grouped.forEach(group => group.forEach((job, index) => group.slice(index + 1).forEach(other => {
      if (!job.serviceDateTime || !other.serviceDateTime) return;
      const jobStart = new Date(job.serviceDateTime).getTime();
      const otherStart = new Date(other.serviceDateTime).getTime();
      const jobLength = Math.max(2, Number(job.serviceType?.match(/(\d+)\s*bed/i)?.[1] || 0)) * 3_600_000;
      const otherLength = Math.max(2, Number(other.serviceType?.match(/(\d+)\s*bed/i)?.[1] || 0)) * 3_600_000;
      if (jobStart < otherStart + otherLength && otherStart < jobStart + jobLength) { conflicts.add(job.id); conflicts.add(other.id); }
    })));
    return conflicts;
  }, [grouped]);

  useEffect(() => { setSelectedJob(null); setShowAnalysis(false); }, [date]);
  const hasAssignments = Boolean(data?.hasAssignments);
  const assignedUnlocked = activeJobs.filter(job => job.assignment?.teamId && !lockedJobIds.has(job.id));
  const currentTeamCount = teams.filter(team => team.isActive === 1 && !team.isArchived).length;

  return <main className="ocr-shell scr-shell schedule-crm-exact-live" id="schedule">
    <ScheduleSidebar />
    <section className="scr-workspace">
      <header className="scr-page-head"><div><div className="scr-title-line"><h1>Schedule</h1><span><i />Live workspace</span></div><p>Route planning, team availability, and day-of assignments.</p></div><div className="scr-head-actions"><button type="button" onClick={() => setShowTeams(true)}><Settings2 />Teams</button><button type="button" onClick={() => setShowCalls(true)}><Phone />Calls{dayIssues.length > 0 && <span className="scr-counter">{dayIssues.length}</span>}</button><button type="button" disabled={optimize.isPending || activeJobs.length === 0} onClick={() => optimize.mutate({ date })}><Sparkles />{hasAssignments ? "Re-optimize" : "Optimize Routes"}</button><button className={showAnalysis ? "is-active" : ""} type="button" onClick={() => setShowAnalysis(value => !value)}><ShieldAlert />Analyze</button></div></header>
      <nav className="scr-workspace-tabs"><a href="/admin/field-management?tab=board">Day Board</a><a href="/admin/field-management?tab=tower">Control Tower</a><button className="is-active" type="button">Schedule</button><a href="/admin/field-management?tab=log">Job Log</a><a href="/admin/field-management?tab=workflow">Workflow</a><a href="/admin/field-management?tab=concierge">✦ AI Concierge</a></nav>
      <section className="scr-schedule-toolbar"><div className="scr-date-nav"><button type="button" aria-label="Previous day" onClick={() => setDate(value => addDays(value, -1))}><ChevronLeft /></button><Calendar /><b>{dayLabel(date)}</b><button type="button" aria-label="Next day" onClick={() => setDate(value => addDays(value, 1))}><ChevronRight /></button></div><span className="scr-count"><Users />{activeJobs.length} jobs · {currentTeamCount} teams</span><div className="scr-toolbar-right">{hasAssignments && <button type="button" disabled={reset.isPending || optimize.isPending} onClick={() => { if (window.confirm("Clear owned assignments and locks for this day? Jobs will remain unassigned until you assign or optimize them.")) reset.mutate({ date }); }}><RotateCcw />Reset</button>}{hasAssignments && <button type="button" disabled={rerunDistances.isPending || optimize.isPending} onClick={() => rerunDistances.mutate({ date })}><MapPin />Rerun Distances</button>}{assignedUnlocked.length > 0 && <button type="button" disabled={lockJob.isPending} onClick={async () => { for (const job of assignedUnlocked) await lockJob.mutateAsync({ jobId: job.id, date, teamId: job.assignment!.teamId, lockedPosition: job.assignment!.routeOrder ?? 0 }); toast.success(`Locked ${assignedUnlocked.length} job${assignedUnlocked.length === 1 ? "" : "s"}`); }}><Lock />Lock All</button>}</div></section>
      <section className="scr-filter-bar"><span>Filter routes:</span>{(["all", "new", "recurring", "move"] as Filter[]).map(value => <button type="button" key={value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "move" ? "Move In/Out" : value[0].toUpperCase() + value.slice(1)} <b>{counts[value]}</b></button>)}</section>
      {showAnalysis && <section className="scr-analysis"><header><span><ShieldAlert />Schedule Analysis</span><button type="button" onClick={() => setShowAnalysis(false)}><X /></button></header>{analysisFetching ? <p><Bot />Analyzing the live schedule…</p> : analysisData ? <><p><Bot />{analysisData.aiSummary || "Live schedule analysis is ready for review."}</p><div>{analysisData.issues.length ? analysisData.issues.map((issue, index) => <article key={`${issue.code}-${index}`}><AlertTriangle /><span><b>{issue.title}</b><small>{issue.detail}</small></span><ChevronDown /></article>) : <article><AlertCircle /><span><b>No issues found</b><small>The selected day has no reported schedule conflicts.</small></span></article>}</div><footer>{analysisData.meta.totalJobs} jobs · {analysisData.meta.assignedJobs} assigned · {analysisData.meta.totalTeams} teams <span>{analysisData.counts.total} issues total</span></footer></> : <p><Bot />Open analysis to inspect the selected live schedule.</p>}</section>}
      <section className="scr-slot-finder"><MapPin /><b>Find best slot</b><input value={suggestion} onChange={event => setSuggestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && suggestion.trim()) setSuggestAddress(suggestion.trim()); }} placeholder="Enter customer address…" /><button type="button" disabled={!suggestion.trim() || suggestionFetching} onClick={() => setSuggestAddress(suggestion.trim())}><Search />{suggestionFetching ? "Searching…" : "Search"}</button></section>
      {suggestionData && <section className="scr-live-slots"><b>Best slots for {suggestionData.geocodedAddress}</b>{suggestionData.slots.length ? suggestionData.slots.map((slot, index) => <span key={slot.teamId}><i style={{ background: slot.teamColor }} />{slot.teamName}<small>{slot.suggestedTimeMs ? new Date(slot.suggestedTimeMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Time pending"} · +{Math.round(slot.addedDriveSecs / 60)} min drive</small>{index === 0 && <em>Best fit</em>}</span>) : <p>No available teams for this date.</p>}</section>}
      <section className="scr-schedule-main">{isLoading ? <div className="scr-live-loading">Loading live schedule…</div> : <div className="scr-route-stack">{teams.filter(team => !team.isArchived).map(team => <TeamRoute key={team.id} team={team} jobs={grouped.get(team.id) || []} selectedJobId={selectedJob?.id ?? null} lockedJobIds={lockedJobIds} conflictJobIds={conflictJobIds} onJobSelect={setSelectedJob} onTeamSelect={team => { setSelectedTeam(team); setShowTeams(true); }} />)}{(grouped.get(null) || []).length > 0 && <section className="scr-unassigned"><header><AlertCircle />Unassigned ({(grouped.get(null) || []).length})</header>{(grouped.get(null) || []).map(job => <LiveJobCard key={job.id} job={job} selected={selectedJob?.id === job.id} locked={lockedJobIds.has(job.id)} conflict={conflictJobIds.has(job.id)} onSelect={() => setSelectedJob(job)} />)}</section>}<section className="scr-weekly"><header><CalendarDays />Weekly Team Schedule <ChevronDown /></header><div>{teams.filter(team => team.isActive === 1 && !team.isArchived).map(team => <span key={team.id}>{team.name}<b>{team.workScheduleUnavailable ? "Off today" : "Available"}</b></span>)}</div></section></div>}
        <aside className="scr-map-panel"><header><span><Navigation />Route map</span><b>{currentTeamCount} teams</b></header><div className="scr-map-grid schedule-crm-live-map">{isLoading ? <div className="scr-live-map-loading">Loading route map…</div> : <LeadflowScheduleMap jobs={filteredJobs as never[]} teams={teams as never[]} selectedJobId={selectedJob?.id ?? null} onJobSelect={id => setSelectedJob(jobs.find(job => job.id === id) ?? null)} />}</div></aside></section>
    </section>
    {showTeams && <TeamModal teams={teams} selectedTeam={selectedTeam} onClose={() => { setShowTeams(false); setSelectedTeam(null); }} onChanged={() => { utils.leadflowSchedule.getTeams.invalidate(); utils.leadflowSchedule.getSchedule.invalidate({ date }); }} />}
    {showCalls && <LeadflowScheduleCallLogPanel open={showCalls} onClose={() => setShowCalls(false)} jobDate={date} />}
    {issueJob && <LeadflowScheduleIssueDialog open={Boolean(issueJob)} onClose={() => setIssueJob(null)} leadflowJobId={issueJob.id} jobDate={date} onCallFired={() => setShowCalls(true)} />}
    <ClientDrawer job={selectedJob} teams={teams} onClose={() => setSelectedJob(null)} onRaiseIssue={setIssueJob} />
  </main>;
}
