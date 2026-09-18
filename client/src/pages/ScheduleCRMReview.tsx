import { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Bot,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Copy,
  FileText,
  GripVertical,
  HelpCircle,
  Link2,
  Lock,
  MapPin,
  MessageSquare,
  Navigation,
  PanelRightOpen,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import "./operations-crm-review.css";
import "./schedule-crm-review.css";
import "./schedule-leads-cohesion.css";
import "./schedule-identity-portraits.css";
import "./schedule-card-density.css";
import "./schedule-palette-balance.css";

type ScheduleJob = {
  id: number;
  time: string;
  customer: string;
  address: string;
  service: string;
  frequency: "New" | "Recurring" | "Move In/Out";
  team: string;
  drive: string;
  locked?: boolean;
  conflict?: boolean;
  requestedTeam?: string;
};

type ScheduleTeam = {
  id: number;
  name: string;
  color: string;
  region: string;
  status?: "ready" | "needs-attention" | "off";
  jobs: ScheduleJob[];
};

const teams: ScheduleTeam[] = [
  {
    id: 1,
    name: "Team Sienna",
    color: "#34c89b",
    region: "DC · 3 jobs · 38m driving",
    status: "ready",
    jobs: [
      { id: 101, time: "9:00 AM", customer: "Jordan Rivera", address: "1819 14th St NW, Washington", service: "3 Bed / 2 Bath", frequency: "Recurring", team: "Team Sienna", drive: "14m from home", locked: true },
      { id: 102, time: "12:30 PM", customer: "Amelia Carter", address: "1100 16th St NW, Washington", service: "2 Bed / 2 Bath", frequency: "New", team: "Team Sienna", drive: "12m drive" },
      { id: 103, time: "3:30 PM", customer: "Noah Bennett", address: "2121 K St NW, Washington", service: "4 Bed / 3 Bath", frequency: "Recurring", team: "Team Sienna", drive: "12m drive" },
    ],
  },
  {
    id: 2,
    name: "Team Harper",
    color: "#e7b24e",
    region: "MD · 2 jobs · 31m driving",
    status: "needs-attention",
    jobs: [
      { id: 104, time: "10:00 AM", customer: "Olivia Morgan", address: "7900 Wisconsin Ave, Bethesda", service: "3 Bed / 2 Bath", frequency: "New", team: "Team Harper", drive: "18m from home", requestedTeam: "Team Harper" },
      { id: 105, time: "2:00 PM", customer: "Ethan Wells", address: "4800 Hampden Ln, Bethesda", service: "Move In / Out", frequency: "Move In/Out", team: "Team Harper", drive: "13m drive", conflict: true },
    ],
  },
  {
    id: 3,
    name: "Team Monroe",
    color: "#777b82",
    region: "VA · 1 job · 22m driving",
    status: "off",
    jobs: [],
  },
];

const unassignedJobs: ScheduleJob[] = [
  { id: 106, time: "11:00 AM", customer: "Sophia Kim", address: "1550 Wilson Blvd, Arlington", service: "2 Bed / 1 Bath", frequency: "New", team: "Unassigned", drive: "Needs assignment" },
];

const PERSON_PORTRAITS: Record<string, string> = {
  "Jordan Rivera": "/manus-storage/leads-crm-owner-james-taylor_6fac06b4.png",
  "Amelia Carter": "/manus-storage/leads-crm-owner-hannah-mills_c84fd53e.png",
  "Noah Bennett": "/manus-storage/leads-crm-owner-mark-darnalds_cf661d0b.png",
  "Olivia Morgan": "/manus-storage/leads-crm-owner-grace-miller_7bf6a25c.png",
  "Ethan Wells": "/manus-storage/leads-crm-owner-alex-santos_8f730ad0.png",
  "Sophia Kim": "/manus-storage/leads-crm-owner-kate-chen_1285ffcf.png",
};

const teamInitials = (team: string) => team.replace("Team ", "").split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();

function StaticPersonPortrait({ person, detail = false }: { person: string; detail?: boolean }) {
  const portrait = PERSON_PORTRAITS[person];
  if (portrait) return <img className={`scr-person-portrait${detail ? " scr-person-portrait-detail" : ""}`} src={portrait} alt={`Static portrait for ${person}`} />;
  return <i className={`scr-person-initial${detail ? " scr-person-initial-detail" : ""}`}>{person.split(" ").map(part => part[0]).join("").slice(0, 2)}</i>;
}

const primaryNav = [
  ["Companies", BarChart3, "241"],
  ["Deals Board", ClipboardIcon, undefined],
  ["Forecast", BarChart3, "9"],
  ["Activities", ListIcon, undefined],
  ["Contacts", Users, "38"],
  ["Email Sequences", MailIcon, undefined],
] as const;

function ClipboardIcon(props: React.ComponentProps<typeof FileText>) {
  return <FileText {...props} />;
}

function ListIcon(props: React.ComponentProps<typeof FileText>) {
  return <FileText {...props} />;
}

function MailIcon(props: React.ComponentProps<typeof FileText>) {
  return <MessageSquare {...props} />;
}

function StaticNotice({ notice }: { notice: string | null }) {
  return notice ? <div className="scr-notice" role="status">{notice}</div> : null;
}

function ScheduleSidebar() {
  return (
    <aside className="ocr-sidebar scr-sidebar" aria-label="CRM review navigation">
      <div className="ocr-brand">
        <div className="ocr-logo-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <div><strong>Sales CRM</strong><small>Company pipeline</small></div>
      </div>
      <div className="ocr-nav-scroll">
        <nav className="ocr-nav-primary">
          {primaryNav.map(([label, Icon, count]) => (
            <button key={label} className={label === "Companies" ? "is-active" : ""} type="button">
              <Icon size={16} strokeWidth={1.7} /><span>{label}</span>{count && <b>{count}</b>}
            </button>
          ))}
        </nav>
        <div className="ocr-nav-group"><p>TEAM</p><button><CircleDot />Strategic AEs</button><button><Navigation />Mid Market</button><button><Users />SDR Team</button></div>
        <div className="ocr-nav-group"><p>REPORTING</p><button><BarChart3 />Q1 Forecast</button><button><AlertTriangle />Slipping Deals</button></div>
        <div className="ocr-nav-group"><p>PIPELINES</p><button><i className="ocr-pipeline-dot dot-yellow" />North America</button><button><i className="ocr-pipeline-dot dot-pink" />EMEA Enterprise</button><button><i className="ocr-pipeline-dot dot-purple" />APAC Expansion</button></div>
      </div>
      <div className="ocr-utility"><button><Users />Invite teammates</button><button><HelpCircle />Help</button></div>
      <div className="ocr-billing"><div><strong>14 Days</strong><small>Left on trials</small></div><button><PanelRightOpen />Add Billings</button></div>
    </aside>
  );
}

function JobCard({ job, selected, onSelect }: { job: ScheduleJob; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`scr-job-card ${selected ? "is-selected" : ""} ${job.conflict ? "is-conflict" : ""}`} type="button" onClick={onSelect}>
      <span className="scr-job-person"><StaticPersonPortrait person={job.customer} /><span className="scr-job-person-name">{job.customer}</span></span>
      <span className="scr-job-context"><span className="scr-job-service">{job.service}</span><span className="scr-job-address"><MapPin size={12} />{job.address}</span>{job.requestedTeam && <span className="scr-request">Requested: {job.requestedTeam}</span>}{job.conflict && <span className="scr-conflict"><AlertTriangle size={12} />Time conflict — review</span>}</span>
      <span className="scr-job-timing"><span className="scr-job-card-top"><GripVertical size={14} /><time>{job.time}</time><span className={`scr-job-tag ${job.frequency.toLowerCase().replaceAll("/", "").replaceAll(" ", "-")}`}>{job.frequency}</span>{job.locked && <Lock size={12} />}</span></span>
      <span className="scr-drive"><Navigation size={12} />{job.drive}</span>
    </button>
  );
}

function TeamRoute({ team, selectedJob, onSelect, onNotice }: { team: ScheduleTeam; selectedJob: number | null; onSelect: (job: ScheduleJob) => void; onNotice: (message: string) => void }) {
  const isOff = team.status === "off";
  const isFocused = team.jobs.some(job => job.id === selectedJob);
  return (
    <section className={`scr-team-route ${isOff ? "is-off" : ""} ${isFocused ? "is-focused" : ""}`}>
      {isOff && <div className="scr-team-banner"><Calendar size={12} />Off today (schedule)</div>}
      <header>
        <i className="scr-team-avatar" style={{ background: team.color }}>{teamInitials(team.name)}</i>
        <button type="button" onClick={() => onNotice("Team settings are review-only in this preview.")}>{team.name}</button>
        {team.status === "needs-attention" && <span className="scr-team-alert">1 issue</span>}
        <ChevronDown size={14} />
      </header>
      <p>{team.region}</p>
      <div className="scr-team-jobs">
        {team.jobs.length ? team.jobs.map(job => <JobCard key={job.id} job={job} selected={selectedJob === job.id} onSelect={() => onSelect(job)} />) : <div className="scr-empty-team">No jobs assigned</div>}
      </div>
    </section>
  );
}

function ClientDrawer({ job, onClose, onNotice }: { job: ScheduleJob | null; onClose: () => void; onNotice: (message: string) => void }) {
  if (!job) return null;
  return (
    <div className="scr-drawer-backdrop" onClick={onClose}>
      <aside className="scr-client-drawer" onClick={event => event.stopPropagation()} aria-label="Static client schedule profile">
        <header><div className="scr-client-identity"><StaticPersonPortrait person={job.customer} detail /><div><span className="scr-overline">CLIENT PROFILE</span><h2>{job.customer}</h2><p><MapPin size={13} />{job.address}</p></div></div><button type="button" onClick={onClose}><X /></button></header>
        <div className="scr-drawer-scroll">
          <section className="scr-client-stats"><div><b>12</b><span>Cleanings</span></div><div><b>$2,480</b><span>Lifetime</span></div><div><b>$206</b><span>Avg / visit</span></div><div><b>{job.team.replace("Team ", "")}</b><span>Usual team</span></div></section>
          <section><h3><CalendarDays />This Job</h3><div className="scr-detail-grid"><article><label>Service</label><b>{job.service}</b></article><article><label>Scheduled</label><b>{job.time}</b></article><article><label>Frequency</label><b>{job.frequency}</b></article><article><label>Team</label><b>{job.team}</b></article></div></section>
          <section><h3><FileText />Notes & checklist</h3><div className="scr-note-card"><label>Customer notes</label><p>Please use the service entrance and text on arrival. The cat will be in the bedroom.</p></div><div className="scr-checklist"><span>✓ Bring eco-friendly supplies</span><span>○ Prioritize kitchen and main bath</span><span>○ Confirm lockbox after service</span></div></section>
          <section><h3><Phone />Recent calls</h3><div className="scr-call-card"><b>Confirmation Call <i>answered</i></b><p>Customer confirmed the scheduled time and noted access instructions.</p></div><div className="scr-call-card"><b>OpenPhone <i>outbound</i></b><p>Sent reminder and confirmed service preferences.</p></div></section>
          <section><h3><Sparkles />AI memory</h3><ul className="scr-memory"><li>Prefers messages before arrival.</li><li>Usually requests the same team.</li><li>Kitchen detail is the highest priority.</li></ul></section>
        </div>
        <footer><button className="scr-link-button" type="button" onClick={() => onNotice("Customer text is review-only in this preview.")}><MessageSquare />Text customer</button><button type="button" onClick={() => onNotice("Reassignment is review-only in this preview.")}>Reassign</button><button className="scr-primary-button" type="button" onClick={() => onNotice("Save changes is review-only in this preview.")}>Save changes</button></footer>
      </aside>
    </div>
  );
}

export default function ScheduleCRMReview() {
  const [selectedJob, setSelectedJob] = useState<ScheduleJob | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showTeams, setShowTeams] = useState(false);
  const [showCalls, setShowCalls] = useState(false);
  const [filter, setFilter] = useState<"all" | "new" | "recurring" | "move">("all");
  const filteredTeams = useMemo(() => teams.map(team => ({ ...team, jobs: team.jobs.filter(job => filter === "all" || (filter === "new" && job.frequency === "New") || (filter === "recurring" && job.frequency === "Recurring") || (filter === "move" && job.frequency === "Move In/Out")) })), [filter]);

  return (
    <main className="ocr-shell scr-shell" data-review-only="true">
      <ScheduleSidebar />
      <section className="scr-workspace">
        <header className="scr-page-head">
          <div><div className="scr-title-line"><h1>Schedule</h1><span><i />Static preview</span></div><p>Route planning, team availability, and day-of assignments.</p></div>
          <div className="scr-head-actions"><button type="button" onClick={() => setShowTeams(true)}><Settings2 />Teams</button><button type="button" onClick={() => setShowCalls(true)}><Phone />Calls<span className="scr-counter">2</span></button><button type="button" onClick={() => setNotice("Optimization is review-only in this preview.")}><Sparkles />Optimize Routes</button><button className={showAnalysis ? "is-active" : ""} type="button" onClick={() => setShowAnalysis(value => !value)}><ShieldAlert />Analyze</button></div>
        </header>
        <nav className="scr-workspace-tabs"><button>Day Board</button><button>Control Tower</button><button className="is-active">Schedule</button><button>Job Log</button><button>Workflow</button><button>✦ AI Concierge</button></nav>
        <section className="scr-schedule-toolbar">
          <div className="scr-date-nav"><button type="button" onClick={() => setNotice("Date navigation is review-only in this preview.")}><ChevronLeft /></button><Calendar /><b>Tue, Sep 15</b><button type="button" onClick={() => setNotice("Date navigation is review-only in this preview.")}><ChevronRight /></button></div>
          <span className="scr-count"><Users />6 jobs · 3 teams</span>
          <div className="scr-toolbar-right"><button type="button" onClick={() => setNotice("Reset is review-only in this preview.")}><RotateCcw />Reset</button><button type="button" onClick={() => setNotice("Distance recalculation is review-only in this preview.")}><MapPin />Rerun Distances</button><button type="button" onClick={() => setNotice("Lock All is review-only in this preview.")}><Lock />Lock All</button></div>
        </section>
        <StaticNotice notice={notice} />
        <section className="scr-filter-bar"><span>Filter routes:</span><button className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All <b>6</b></button><button className={filter === "new" ? "is-active" : ""} onClick={() => setFilter("new")}>New <b>2</b></button><button className={filter === "recurring" ? "is-active" : ""} onClick={() => setFilter("recurring")}>Recurring <b>3</b></button><button className={filter === "move" ? "is-active" : ""} onClick={() => setFilter("move")}>Move In/Out <b>1</b></button></section>
        {showAnalysis && <section className="scr-analysis"><header><span><ShieldAlert />Schedule Analysis</span><button onClick={() => setShowAnalysis(false)}><X /></button></header><p><Bot />Two operational items need attention before routes are finalized.</p><div><article><AlertTriangle /><span><b>1 timing conflict</b><small>Team Harper has an overlapping afternoon window.</small></span><ChevronDown /></article><article><AlertCircle /><span><b>1 unassigned job</b><small>Sophia Kim still needs a team assignment.</small></span><ChevronDown /></article></div><footer>6 jobs · 5 assigned · 3 teams <span>2 issues total</span></footer></section>}
        <section className="scr-slot-finder"><MapPin /><b>Find best slot</b><input placeholder="Enter customer address…" /><button type="button" onClick={() => setNotice("Slot search is review-only in this preview.")}><Search />Search</button></section>
        <section className="scr-schedule-main">
          <div className="scr-route-stack">
            {filteredTeams.map(team => <TeamRoute key={team.id} team={team} selectedJob={selectedJob?.id ?? null} onSelect={setSelectedJob} onNotice={setNotice} />)}
            <section className="scr-unassigned"><header><AlertCircle />Unassigned (1)</header><JobCard job={unassignedJobs[0]} selected={selectedJob?.id === 106} onSelect={() => setSelectedJob(unassignedJobs[0])} /></section>
            <section className="scr-weekly"><header><CalendarDays />Weekly Team Schedule <ChevronDown /></header><div><span>Team Sienna <b>Mon–Sat</b></span><span>Team Harper <b>Tue–Sat</b></span><span>Team Monroe <b>Wed–Sun</b></span></div></section>
          </div>
          <aside className="scr-map-panel"><header><span><Navigation />Route map</span><b>3 teams</b></header><div className="scr-map-grid"><div className="scr-map-road r1" /><div className="scr-map-road r2" /><div className="scr-map-road r3" /><svg viewBox="0 0 600 390" preserveAspectRatio="none"><path d="M54 295C130 255 145 240 208 205S337 113 455 82 535 93 560 42" /><path d="M52 94C115 102 170 126 224 166S327 270 415 302 500 307 555 350" /><path d="M30 210C145 180 220 218 295 176S418 130 560 170" /></svg><button className="scr-map-marker marker-one" onClick={() => setSelectedJob(teams[0].jobs[0])}>1</button><button className="scr-map-marker marker-two" onClick={() => setSelectedJob(teams[1].jobs[0])}>2</button><button className="scr-map-marker marker-three" onClick={() => setSelectedJob(unassignedJobs[0])}>!</button><div className="scr-map-legend">{teams.map(team => <span key={team.id}><i style={{ background: team.color }} />{team.name}</span>)}</div></div></aside>
        </section>
      </section>
      {showTeams && <div className="scr-modal-backdrop" onClick={() => setShowTeams(false)}><section className="scr-modal" onClick={event => event.stopPropagation()}><header><div><Settings2 /><span><b>Manage Teams</b><small>Static preview</small></span></div><button onClick={() => setShowTeams(false)}><X /></button></header><button className="scr-modal-add" onClick={() => setNotice("Add Team is review-only in this preview.")}><Plus />Add Team</button>{teams.map(team => <article key={team.id}><i className="scr-team-avatar" style={{ background: team.color }}>{teamInitials(team.name)}</i><span><b>{team.name}</b><small>{team.region}</small></span><button onClick={() => setNotice("Team editing is review-only in this preview.")}>Edit</button></article>)}</section></div>}
      {showCalls && <div className="scr-modal-backdrop" onClick={() => setShowCalls(false)}><section className="scr-modal scr-call-modal" onClick={event => event.stopPropagation()}><header><div><Phone /><span><b>Call Log</b><small>Tue, Sep 15 · static preview</small></span></div><button onClick={() => setShowCalls(false)}><X /></button></header><article><b>Schedule Escalation <i>answered</i></b><p>Customer requested an earlier arrival window; review team availability.</p></article><article><b>Confirmation Call <i>voicemail</i></b><p>Left a schedule confirmation reminder.</p></article></section></div>}
      <ClientDrawer job={selectedJob} onClose={() => setSelectedJob(null)} onNotice={setNotice} />
    </main>
  );
}
