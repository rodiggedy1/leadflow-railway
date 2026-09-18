import { useEffect, useState } from "react";
import {
  Activity, AlertTriangle, Bell, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft,
  ChevronRight, CircleDot, Clock3, ExternalLink, HelpCircle, Home, Lock, MapPin,
  MessageCircle, Mic, Phone, PlayCircle, Send, Sparkles, UserRound, Users, X, XCircle,
  Zap,
} from "lucide-react";
import "./operations-crm-review.css";
import "./day-board-crm-review.css";
import "./day-board-crm-gridless.css";
import "./day-board-leads-cohesion.css";

type JobStatus = "not_started" | "on_the_way" | "in_progress" | "running_late" | "finishing_up" | "completed" | "issue";
type Tab = "Timeline" | "Messages" | "Calls";
type StaticJob = {
  id: number; customer: string; initials: string; time: string; end: string; left: number; width: number;
  service: string; address: string; status: JobStatus; bedrooms: number; bathrooms: number;
  cleaner: string; team: string; sms: number; issue?: string; eta?: string; unconfirmed?: boolean; unread?: boolean;
};

const CLIENT_PORTRAITS: Record<string, string> = {
  "Jordan Rivera": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/xDBqJDhyFPziPsOt.png",
  "Amelia Carter": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/TtZGSsKomHzKvXmE.png",
  "Noah Bennett": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/ypcLWxzXhQzCCWcC.png",
  "Sophia Kim": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/DOtabpUhLIcbLXur.png",
  "Ethan Wells": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bvdqcqtPZSJhgtqq.png",
  "Olivia Morgan": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/gUCwvRBUvWDZUkGx.png",
  "Liam Parker": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/CucZtKJOfkDlJvMg.png",
};

const hours = ["7 AM", "8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM", "7 PM", "8 PM", "9 PM"];
const statusConfig: Record<JobStatus, { label: string; color: string; icon: typeof Clock3 }> = {
  not_started: { label: "Not Started", color: "#84909b", icon: Clock3 },
  on_the_way: { label: "On the Way", color: "#4a94f5", icon: Activity },
  in_progress: { label: "In Progress", color: "#23bd7e", icon: Zap },
  running_late: { label: "Running Late", color: "#e8a345", icon: AlertTriangle },
  finishing_up: { label: "Finishing Up", color: "#39bbb7", icon: CheckCircle2 },
  completed: { label: "Completed", color: "#48a86d", icon: CheckCircle2 },
  issue: { label: "Issue", color: "#e66c75", icon: XCircle },
};
const lanes: Array<{ name: string; initials: string; team: string; color: string; jobs: StaticJob[] }> = [
  { name: "Team Harper", initials: "TH", team: "Harper · 3 jobs", color: "#8971ed", jobs: [
    { id: 1, customer: "Jordan Rivera", initials: "JR", time: "8:00 AM", end: "10:00 AM", left: 7.5, width: 15, service: "Standard Cleaning", address: "7900 Wisconsin Ave, Bethesda", status: "completed", bedrooms: 3, bathrooms: 2, cleaner: "Harper Lane", team: "Team Harper", sms: 100 },
    { id: 2, customer: "Amelia Carter", initials: "AC", time: "11:00 AM", end: "1:15 PM", left: 29, width: 17, service: "Deep Cleaning", address: "1840 19th Street NW, Washington", status: "in_progress", bedrooms: 3, bathrooms: 2, cleaner: "Harper Lane", team: "Team Harper", sms: 82, unread: true },
    { id: 3, customer: "Noah Bennett", initials: "NB", time: "3:00 PM", end: "4:45 PM", left: 58, width: 14, service: "Recurring Cleaning", address: "4100 Cathedral Ave NW, Washington", status: "not_started", bedrooms: 2, bathrooms: 2, cleaner: "Harper Lane", team: "Team Harper", sms: 100 },
  ] },
  { name: "Team Sienna", initials: "TS", team: "Sienna · 2 jobs", color: "#28b983", jobs: [
    { id: 4, customer: "Sophia Kim", initials: "SK", time: "9:30 AM", end: "11:00 AM", left: 18, width: 12, service: "Move In / Out", address: "1250 New Hampshire Ave NW", status: "on_the_way", bedrooms: 2, bathrooms: 1, cleaner: "Sienna Brooks", team: "Team Sienna", sms: 67, eta: "9:22 AM" },
    { id: 5, customer: "Ethan Wells", initials: "EW", time: "1:30 PM", end: "3:30 PM", left: 47, width: 16, service: "Standard Cleaning", address: "2230 California Street NW", status: "running_late", bedrooms: 4, bathrooms: 3, cleaner: "Sienna Brooks", team: "Team Sienna", sms: 42, eta: "1:48 PM", issue: "Traffic delay reported — customer update needed." },
  ] },
  { name: "Team Maya", initials: "TM", team: "Maya · 2 jobs", color: "#e676a5", jobs: [
    { id: 6, customer: "Olivia Morgan", initials: "OM", time: "10:00 AM", end: "11:30 AM", left: 22, width: 13, service: "Standard Cleaning", address: "3201 Connecticut Ave NW", status: "finishing_up", bedrooms: 2, bathrooms: 1, cleaner: "Maya Ellis", team: "Team Maya", sms: 100 },
    { id: 7, customer: "Liam Parker", initials: "LP", time: "2:00 PM", end: "4:30 PM", left: 51, width: 19, service: "Deep Cleaning", address: "1620 L Street NW, Washington", status: "not_started", bedrooms: 4, bathrooms: 2, cleaner: "Maya Ellis", team: "Team Maya", sms: 100, unconfirmed: true },
  ] },
];
const removedJobs = [
  { customer: "Ava Foster", address: "K Street NW", time: "10:00 AM", team: "Team Harper", state: "Rescheduled" },
  { customer: "Benjamin Cole", address: "North Capitol Street", time: "2:30 PM", team: "Team Sienna", state: "Cancelled" },
];

function ReviewNotice({ text }: { text: string | null }) { return text ? <div className="dbr-notice" role="status">{text}</div> : null; }

function CrmRail() {
  const items = [["Day Board", CalendarDays, ""], ["Schedule", Clock3, ""], ["Team availability", Users, ""], ["Route optimization", Activity, ""]] as const;
  return <aside className="ocr-sidebar dbr-sidebar"><div className="ocr-brand"><div className="ocr-logo-mark"><span /><span /><span /><span /></div><div><strong>Sales CRM</strong><span>Company pipeline</span></div></div><div className="ocr-nav-scroll"><nav className="ocr-nav-primary">{items.map(([label, Icon, count]) => <button type="button" className={label === "Day Board" ? "is-active" : ""} key={label}><Icon />{label}{count && <b>{count}</b>}</button>)}</nav><div className="ocr-nav-group"><p>VIEWS</p><button><i className="ocr-pipeline-dot dot-yellow" />Today <b>7</b></button><button><i className="ocr-pipeline-dot dot-pink" />Needs attention <b>2</b></button><button><i className="ocr-pipeline-dot dot-violet" />Unassigned <b>1</b></button></div><div className="ocr-nav-group"><p>TEAMS</p><button><Users />All field teams <b>3</b></button></div><div className="ocr-nav-group"><p>REPORTING</p><button><CircleDot />Daily health</button><button><AlertTriangle />Exceptions</button></div></div><div className="ocr-nav-utility"><button><Users />Invite teammates</button><button><HelpCircle />Help</button></div><div className="ocr-sidebar-footer"><div className="ocr-trial"><div><strong>14 Days</strong><span>Left on trials</span></div><button><ExternalLink />Add Billings</button></div></div></aside>;
}

function StatusPill({ status }: { status: JobStatus }) { const config = statusConfig[status]; const Icon = config.icon; return <span className="dbr-status-pill" style={{ color: config.color, borderColor: `${config.color}65`, background: `${config.color}18` }}><Icon size={11} />{config.label}</span>; }

function JobBlock({ job, selected, onClick }: { job: StaticJob; selected: boolean; onClick: () => void }) {
  const config = statusConfig[job.status]; const Icon = config.icon;
  return <button type="button" onClick={onClick} aria-label={`${job.customer}, ${config.label}`} className={`dbr-job ${selected ? "is-selected" : ""}`} style={{ left: `${job.left}%`, width: `${job.width}%`, borderColor: `${config.color}a4`, color: config.color }}><header><span className="dbr-job-client"><img src={CLIENT_PORTRAITS[job.customer]} alt={`Static review portrait for ${job.customer}`} /><span><Icon size={11} />{job.customer.split(" ")[0]}</span></span>{job.unread && <i />}</header><p>{job.address.split(",")[0]}</p><b className="dbr-sms-bar" style={{ width: `${job.sms}%`, background: job.sms > 75 ? "#32c184" : job.sms > 50 ? "#e3ae42" : "#e77478" }} /></button>;
}

function TimelineBoard({ select, selected }: { select: (job: StaticJob) => void; selected: StaticJob | null }) {
  return <section className="dbr-timeline-card"><header className="dbr-time-axis"><span>Team</span><div>{hours.map(hour => <b key={hour}>{hour}</b>)}</div></header><div className="dbr-lanes">{lanes.map(lane => <section className="dbr-lane" key={lane.name}><header><span className="dbr-team-avatar" style={{ background: lane.color }} aria-hidden="true">{lane.initials}</span><div><b>{lane.name}</b><small>{lane.team}</small></div></header><div className="dbr-lane-time">{hours.map(hour => <i key={hour} />)}<b className="dbr-now-line" style={{ left: "44%" }}><span>Now</span></b>{lane.jobs.map(job => <JobBlock job={job} selected={selected?.id === job.id} onClick={() => select(job)} key={job.id} />)}</div></section>)}</div><SmsHealthStrip /></section>;
}

function SmsHealthStrip() { const dots = [{ left: 9, color: "#2ec281", label: "Client reminder" }, { left: 18, color: "#2ec281", label: "On route" }, { left: 31, color: "#e1aa43", label: "Pending team SMS" }, { left: 45, color: "#2ec281", label: "Arrival" }, { left: 49, color: "#e06c73", label: "Client update failed" }, { left: 61, color: "#2ec281", label: "Checklist sent" }, { left: 71, color: "#2ec281", label: "Pre-job reminder" }]; return <footer className="dbr-sms-health"><header><b>SMS Activity</b><span><i style={{ background: "#2ec281" }} />Sent <i style={{ background: "#e06c73" }} />Failed <i style={{ background: "#e1aa43" }} />Pending</span></header><div>{hours.map(hour => <i key={hour} />)}{dots.map(dot => <button key={dot.left} title={dot.label} style={{ left: `${dot.left}%`, background: dot.color }} />)}</div></footer>; }

function DetailDrawer({ job, close, notify }: { job: StaticJob; close: () => void; notify: (text: string) => void }) {
  const [tab, setTab] = useState<Tab>("Timeline"); const [recipient, setRecipient] = useState("Client"); const [draft, setDraft] = useState(""); const config = statusConfig[job.status];
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === "Escape") close(); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [close]);
  return <><div className="dbr-drawer-backdrop" onClick={close} /><aside className="dbr-drawer"><header className="dbr-drawer-head"><div><StatusPill status={job.status} /><h2>{job.customer}</h2><p><MapPin size={12} />{job.address}</p></div><button onClick={close} aria-label="Close details"><X /></button></header><section className="dbr-drawer-meta">{[[Clock3, "Start", job.time], [Home, "Duration", "2h 15m"], [UserRound, "Cleaner", job.cleaner.split(" ")[0]]].map(([Icon, label, value]) => {const IconComponent=Icon as typeof Clock3;return <div key={label as string}><span><IconComponent size={13} />{label as string}</span><b>{value as string}</b></div>})}</section><section className="dbr-service"><div><small>Service</small><b>{job.service}</b></div><span>{job.bedrooms} BR</span><span>{job.bathrooms} BA</span></section><section className="dbr-step-health"><header><span>SMS Steps</span><b>{Math.round(job.sms / 20)}/5</b></header><div><i style={{ width: `${job.sms}%`, background: job.sms > 75 ? "#30bd80" : "#e2a942" }} /></div></section>{job.unconfirmed && <section className="dbr-alert is-warning"><AlertTriangle /><div><b>Unconfirmed in Launch27</b><p>Booking is marked new. Confirm assignment before automation begins.</p><button onClick={() => notify("Confirm Assignment is review-only in this preview.")}>Confirm Assignment</button></div></section>}{job.eta && <section className="dbr-alert is-eta"><Activity /><div><b>ETA: {job.eta}</b><p>Cleaner estimated arrival time</p></div></section>}{job.issue && <section className="dbr-alert is-issue"><AlertTriangle /><p>{job.issue}</p></section>}<section className="dbr-voice"><button onClick={() => notify("Voice Alert Cleaner is review-only in this preview.")}><Phone />Voice Alert Cleaner</button></section><nav className="dbr-drawer-tabs">{(["Timeline", "Messages", "Calls"] as Tab[]).map(name => <button className={tab === name ? "is-active" : ""} key={name} onClick={() => setTab(name)}>{name}{name === "Messages" && job.unread && <i />}</button>)}</nav><div className="dbr-drawer-scroll">{tab === "Timeline" && <section className="dbr-event-list">{[["8:00 AM", "Client reminder sent", "Your team arrives today between 8:00–10:00 AM.", "#31bc7d"], ["9:15 AM", "Cleaner marked on the way", "Team location status changed.", "#4795f2"], ["10:04 AM", "Team arrived", "Arrival update was sent to the customer.", "#30bd80"], ["11:20 AM", "Job status updated", "Checklist and photo workflow started.", "#42b9b3"]].map(([time,title,detail,color], index) => <article key={title}><aside><i style={{ background: color }} />{index < 3 && <b />}</aside><div><header><strong>{title}</strong><time>{time}</time></header><p>{detail}</p></div></article>)}</section>}{tab === "Messages" && <section className="dbr-messages"><article className="in"><small>Customer · 9:34 AM</small><p>Thank you. The building door is open and the front desk knows the team is coming.</p></article><article className="out"><small>Madison · 9:36 AM</small><p>Perfect — thank you. Team Harper is on the way and will check in upon arrival.</p></article><article className="in"><small>Customer · 10:15 AM</small><p>They are here now. Thanks!</p></article></section>}{tab === "Calls" && <section className="dbr-calls"><article><header><i><Mic /></i><div><b>Pre-job check-in</b><span>Answered · 1:42</span></div></header><p>Cleaner confirmed the route and customer access notes.</p><footer><button onClick={() => notify("Call playback is review-only in this preview.")}><PlayCircle />Listen</button><button onClick={() => notify("Transcript is review-only in this preview.")}>View transcript</button></footer></article><article><header><i><Phone /></i><div><b>Arrival confirmation</b><span>Voicemail · 0:32</span></div></header><p>Customer was notified that the team had arrived.</p></article></section>}</div>{tab === "Messages" && <footer className="dbr-compose"><div><button className={recipient === "Client" ? "is-active" : ""} onClick={() => setRecipient("Client")}>Client</button><button className={recipient === "Cleaner" ? "is-active" : ""} onClick={() => setRecipient("Cleaner")}>Cleaner</button><small>{recipient === "Client" ? "+1 (202) 555-0189" : "+1 (240) 555-0194"}</small></div><textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Type a message..." /><button onClick={() => notify("Sending a message is review-only in this preview.")} disabled={!draft.trim()}><Send /></button></footer>}</aside></>;
}

export default function DayBoardCRMReview() {
  const [selected, setSelected] = useState<StaticJob | null>(null); const [notice, setNotice] = useState<string | null>(null); const [date, setDate] = useState("Tue, Sep 15");
  const notify = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(null), 2600); };
  const dates = ["Mon, Sep 14", "Tue, Sep 15", "Wed, Sep 16", "Thu, Sep 17", "Fri, Sep 18"];
  return <main className="operations-crm-review dbr-shell" data-review-only="true"><CrmRail /><section className="dbr-workspace"><header className="ocr-header"><div className="ocr-page-title"><h1>Day Board</h1><span><i />Static preview</span></div><div className="ocr-header-actions"><button onClick={() => notify("Search is review-only in this preview.")}><Activity /></button><button className="has-notification" onClick={() => notify("Notifications are review-only in this preview.")}><Bell /></button><button className="ocr-profile"><i>MA</i><span>Madison</span><ChevronDown size={13} /></button></div></header><nav className="dbr-page-tabs"><button>Schedule</button><button className="is-active">Day Board</button><button>Team availability</button><button>Workflow</button></nav><section className="dbr-toolbar"><div className="dbr-date-buttons">{dates.map(item => <button key={item} className={date === item ? "is-active" : ""} onClick={() => setDate(item)}>{item === "Tue, Sep 15" ? <><CalendarDays />{item}</> : item}</button>)}</div><div className="dbr-toolbar-actions"><button onClick={() => notify("Status filters are review-only in this preview.")}>All statuses <ChevronDown /></button><button onClick={() => notify("Team filters are review-only in this preview.")}>All teams <ChevronDown /></button><button onClick={() => notify("Test Sound is review-only in this preview.")}><Bell />Test Sound</button></div></section><section className="dbr-summary"><div><small>Total</small><b>7</b></div><div><small>Active</small><b className="is-active">3</b></div><div><small>Issues</small><b className="is-issue">1</b></div><div><small>Done</small><b>1</b></div><div><small>SMS Failed</small><b className="is-issue">1</b></div><span>Tue, Sep 15 · East Coast</span></section><section className="dbr-board-scroll"><TimelineBoard selected={selected} select={setSelected} /><section className="dbr-removed"><header><XCircle />Removed from Schedule <b>2</b></header>{removedJobs.map(item => <button key={item.customer} onClick={() => notify(`${item.state} work is review-only in this preview.`)}><div><strong>{item.customer}</strong><span>{item.address}</span></div><time>{item.time}</time><span>{item.team}</span><b className={item.state === "Rescheduled" ? "is-rescheduled" : ""}>{item.state}</b><ChevronRight /></button>)}</section><footer className="dbr-legend">{(Object.keys(statusConfig) as JobStatus[]).map(status => <span key={status}><i style={{ background: statusConfig[status].color }} />{statusConfig[status].label}</span>)}<em><i />SMS health bar</em></footer></section></section>{selected && <DetailDrawer job={selected} close={() => setSelected(null)} notify={notify} />}<ReviewNotice text={notice} /></main>;
}
