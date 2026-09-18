import { useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  DollarSign,
  Home,
  Info,
  List,
  Map,
  MapPin,
  Megaphone,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Sun,
  TrendingUp,
  Users,
  UserPlus,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import "./operations-dashboard-review.css";
import "./operations-dashboard-leads-cohesion.css";

type MapView = "map" | "list" | "timeline";
type Team = { name: string; service: string; address: string; eta: string; left: string; top: string; tone: "green" | "amber" | "blue" | "slate"; photo: string };

const TEAM_PORTRAIT = "/manus-storage/dashboard-team-portrait_ee89ad11.jpg";
const HOME_IMAGES = [
  "/manus-storage/dashboard-home-living_34007149.jpg",
  "/manus-storage/dashboard-home-dining_02439dcf.jpg",
  "/manus-storage/dashboard-growth-home_e675ad8d.jpg",
] as const;

const TEAMS: Team[] = [
  { name: "Team Sienna", service: "Deep clean", address: "1234 Connecticut Ave NW", eta: "ETA 1:42 PM", left: "47%", top: "42%", tone: "green", photo: TEAM_PORTRAIT },
  { name: "Team Harper", service: "Standard clean", address: "1840 19th Street NW", eta: "On route", left: "30%", top: "58%", tone: "amber", photo: TEAM_PORTRAIT },
  { name: "Team Maya", service: "Move out", address: "3201 New Hampshire Ave", eta: "Complete", left: "57%", top: "63%", tone: "blue", photo: TEAM_PORTRAIT },
  { name: "Team Monroe", service: "Standard clean", address: "4100 Cathedral Ave NW", eta: "Not started", left: "70%", top: "74%", tone: "slate", photo: TEAM_PORTRAIT },
];

const SCHEDULE = [
  ["8:00 AM", "Completed", "1234 Connecticut Ave NW", "Deep clean · Team Sienna", "green", HOME_IMAGES[0]],
  ["9:00 AM", "In progress", "1840 19th Street NW", "Move out · Team Harper", "blue", HOME_IMAGES[1]],
  ["11:00 AM", "In progress", "3201 New Hampshire Ave", "Standard clean · Team Maya", "blue", HOME_IMAGES[2]],
  ["1:00 PM", "Upcoming", "2230 California St NW", "Deep clean · Team 6", "slate", HOME_IMAGES[1]],
  ["3:00 PM", "Upcoming", "4100 Cathedral Ave NW", "Standard clean · Team Monroe", "slate", HOME_IMAGES[0]],
] as const;

const LEAD_SOURCES = [
  ["Thumbtack", "842", "24%", "100%", "#38a8ff"],
  ["Google", "421", "12%", "68%", "#60b8ff"],
  ["Yelp", "213", "8%", "42%", "#8ac8ff"],
  ["Nextdoor", "178", "36%", "35%", "#78ddc4"],
  ["Website / AI", "164", "52%", "31%", "#a286ff"],
  ["Angi", "98", "14%", "19%", "#ffab62"],
] as const;

const SERVICE_MIX = [
  ["Cleaning", "62%", "#1ed69a"],
  ["Move Out", "18%", "#3b9bff"],
  ["Junk Removal", "8%", "#ffad45"],
  ["Lawn Care", "6%", "#8b6cff"],
  ["Handyman", "4%", "#ff6868"],
  ["Other", "2%", "#758391"],
] as const;

function MetricCard({ icon: Icon, tone, value, label, change, detail }: { icon: LucideIcon; tone: string; value: string; label: string; change?: string; detail: string }) {
  return <article className="odr-metric-card">
    <span className="odr-metric-icon" style={{ "--accent": tone } as CSSProperties}><Icon /></span>
    <div className="odr-metric-copy"><div className="odr-metric-head"><strong>{value}</strong>{change && <em>↑ {change}</em>}</div><b>{label}</b><small>{detail}</small></div>
  </article>;
}

export default function OperationsDashboardReview() {
  const [view, setView] = useState<MapView>("map");
  const [activeTeam, setActiveTeam] = useState(0);
  const [activeSchedule, setActiveSchedule] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const active = TEAMS[activeTeam];

  return <main className="odr-dashboard" data-review-only="true">
    <header className="odr-utility-bar">
      <label className="odr-search"><Search /><input aria-label="Search static dashboard preview" placeholder="Search anything..." /><kbd>⌘ K</kbd></label>
      <div className="odr-utilities"><button type="button" aria-label="Preview theme"><Sun /></button><button type="button" className="odr-location"><MapPin /> Washington, DC <ChevronDown /></button><button type="button" className="odr-notifications" aria-label="Preview notifications"><Bell /><i /></button><button type="button" className="odr-avatar" aria-label="Static profile">MA</button></div>
    </header>

    <div className="odr-content">
      <section className="odr-greeting"><div><small>Tuesday, September 15 · Static preview</small><h1>Good morning, Operations <span>👋</span></h1><p>Here’s your business at a glance. Everything looks good.</p></div><aside className="odr-quote"><Sparkles /><p>“Clear priorities make a calm service day.”</p><small>— LeadFlow Operations</small></aside></section>

      <section className="odr-kpis" aria-label="Static daily metrics">
        <MetricCard icon={CalendarDays} tone="#3b9bff" value="24" label="Jobs Today" change="12%" detail="18 completed · 6 remaining" />
        <MetricCard icon={DollarSign} tone="#1ed69a" value="$4,280" label="Revenue Today" change="18%" detail="vs. last Tuesday" />
        <MetricCard icon={Users} tone="#4aa8ff" value="12" label="Teams Active" detail="2 on break · 10 working" />
        <MetricCard icon={MessageSquare} tone="#ffb449" value="48" label="New Leads" change="32%" detail="12 unresponded" />
        <MetricCard icon={HeartStatusIcon} tone="#ff7c88" value="Review queue" label="Customer Sentiment" detail="Review data not connected" />
      </section>

      <section className="odr-primary-grid" aria-label="Static field operations overview">
        <article className="odr-card odr-jobs-card">
          <header className="odr-card-head odr-jobs-head"><div><span className="odr-section-kicker">Field view</span><h2>Jobs in Progress</h2><p>Live view of your teams in the field</p><div className="odr-field-meta"><span><i className="green" />4 teams in field</span><span><i className="amber" />2 route exceptions</span></div></div><div className="odr-segmented" aria-label="Local map display selector">{(["map", "list", "timeline"] as MapView[]).map(option => <button type="button" className={view === option ? "is-active" : ""} key={option} onClick={() => setView(option)}>{option === "map" ? <Map /> : option === "list" ? <List /> : <Clock />}{option[0].toUpperCase() + option.slice(1)}</button>)}</div></header>
          <div className={`odr-map odr-map-${view}`}>
            <span className="odr-map-label odr-map-label-a">Bethesda</span><span className="odr-map-label odr-map-label-b">Silver Spring</span><span className="odr-map-label odr-map-label-c">Washington</span><span className="odr-map-label odr-map-label-d">Arlington</span><span className="odr-map-label odr-map-label-e">College Park</span><span className="odr-map-label odr-map-label-f">Alexandria</span>
            <div className="odr-map-district odr-map-district-a"/><div className="odr-map-district odr-map-district-b"/><div className="odr-map-district odr-map-district-c"/><div className="odr-map-river"/>
            <svg className="odr-map-roads" viewBox="0 0 800 440" preserveAspectRatio="none" aria-hidden="true"><g className="odr-map-minor-roads"><path d="M-30 40 L210 240 L390 165 L600 315 L840 220"/><path d="M55 -20 L200 118 L320 90 L515 220 L708 145 L830 212"/><path d="M-30 355 L190 284 L355 365 L525 300 L830 410"/><path d="M132 468 L274 320 L433 368 L580 250 L762 300"/><path d="M-10 198 L170 150 L305 238 L498 166 L655 247 L830 130"/><path d="M80 15 L97 402"/><path d="M280 -10 L250 445"/><path d="M490 -10 L450 450"/><path d="M686 -10 L650 448"/></g><g className="odr-map-major-roads"><path d="M-20 290 C130 220 160 80 390 104 S630 238 830 36"/><path d="M70 430 C210 316 343 340 460 170 S730 154 824 250"/><path d="M260 -20 C364 130 406 196 646 438"/><path d="M-20 95 C158 72 280 245 454 264 S648 348 830 310"/></g><path className="odr-map-route odr-route-green" d="M78 310 C165 230 245 165 376 182 S485 248 542 192"/><path className="odr-map-route odr-route-purple" d="M408 419 C418 320 454 251 507 172 S620 104 737 80"/></svg>
            {TEAMS.map((team, index) => <button type="button" className={`odr-map-marker ${team.tone} ${activeTeam === index ? "is-active" : ""}`} key={team.name} onClick={() => setActiveTeam(index)} style={{ left: team.left, top: team.top }} aria-label={`Select ${team.name}`}><Circle /></button>)}
            {view === "map" && <div className="odr-team-popover"><img className="odr-team-photo" src={active.photo} alt="Static field team portrait"/><div><strong>{active.name}</strong><span>{active.service}</span><small>{active.address}</small><b>{active.eta}</b><i><em /></i></div></div>}
            {view === "list" && <div className="odr-map-alt"><h3>Active team list</h3>{TEAMS.map(team => <p key={team.name}><span className={team.tone} /> <b>{team.name}</b><small>{team.eta}</small></p>)}</div>}
            {view === "timeline" && <div className="odr-map-alt odr-mini-timeline"><h3>Team timeline</h3>{TEAMS.map((team, index) => <p key={team.name}><b>{team.name}</b><i style={{ width: `${38 + index * 12}%` }} /></p>)}</div>}
            <div className="odr-map-zoom"><button type="button"><Plus /></button><button type="button"><Minus /></button></div>
            <footer className="odr-map-legend"><span><i className="green" />On time <b>12</b></span><span><i className="amber" />Running late <b>2</b></span><span><i className="blue" />Completed <b>8</b></span><span><i className="slate" />Not started <b>4</b></span></footer>
          </div>
        </article>

        <article className="odr-card odr-schedule-card"><header className="odr-card-head"><div><span className="odr-section-kicker">Day route</span><h2>Today’s Schedule</h2><p>Five planned stops across the day</p></div><button type="button" className="odr-text-action">View all <ArrowRight /></button></header><div className="odr-schedule-list">{SCHEDULE.map(([time, status, address, detail, tone, photo]) => <button type="button" className={`odr-schedule-row ${activeSchedule === address ? "is-selected" : ""}`} aria-pressed={activeSchedule === address} key={address} onClick={() => setActiveSchedule(address)}><span className={`odr-schedule-rail ${tone}`}><i /></span><time>{time}<small className={tone}>{status}</small></time><img className="odr-home-thumb" src={photo} alt="Static home interior"/><div><strong>{address}</strong><small>{detail}</small></div><MoreHorizontal /></button>)}</div><button type="button" className="odr-outline-button">View full schedule <ArrowRight /></button></article>

        <aside className="odr-attention-rail"><article className="odr-card odr-activity"><header className="odr-card-head"><div><span className="odr-section-kicker">Signal feed</span><h2>Recent Activity</h2></div><button type="button" className="odr-text-action">View all <ArrowRight /></button></header><ActivityRow icon={CalendarDays} tone="coral" title="New booking" time="2 min ago" detail="A new Deep Clean was placed for Friday."/><ActivityRow icon={MessageSquare} tone="blue" title="Lead received" time="12 min ago" detail="New inquiry needs a first response."/><ActivityRow icon={CheckCircle2} tone="green" title="Job completed" time="28 min ago" detail="Team update was recorded for today."/><ActivityRow icon={HeartStatusIcon} tone="gold" title="Review follow-up" time="1 hour ago" detail="A completed-job follow-up is ready to review."/><ActivityRow icon={UserPlus} tone="purple" title="New applicant" time="2 hours ago" detail="A new application is ready for screening."/></article><article className="odr-card odr-actions"><header className="odr-card-head"><div><span className="odr-section-kicker">Exception queue</span><h2>Action Items</h2></div><button type="button" className="odr-text-action">View all <ArrowRight /></button></header><ActionRow icon={AlertTriangle} tone="danger" title="2 teams running late" detail="Review route exceptions" selected={activeAction === "route"} onClick={() => setActiveAction("route")}/><ActionRow icon={Info} tone="blue" title="12 new leads unresponded" detail="Respond within one hour" selected={activeAction === "leads"} onClick={() => setActiveAction("leads")}/><ActionRow icon={UserPlus} tone="purple" title="5 new applicants" detail="Move candidates to screening" selected={activeAction === "applicants"} onClick={() => setActiveAction("applicants")}/></article></aside>
      </section>

      <section className="odr-analytics-grid"><article className="odr-card odr-lead-sources"><header className="odr-card-head"><h2>Lead Sources</h2><button type="button" className="odr-select">Last 30 days <ChevronDown /></button></header>{LEAD_SOURCES.map(([name, count, change, width, color]) => <div className="odr-source-row" key={name}><span className="odr-source-logo" style={{ background: color }}>{name[0]}</span><b>{name}</b><i><em style={{ width, background: color }} /></i><strong>{count}</strong><small>↑ {change}</small></div>)}</article>
        <article className="odr-card odr-revenue"><header className="odr-card-head"><div><h2>Revenue</h2><p><b>$84,230</b> <em>↑ 28%</em></p></div><button type="button" className="odr-select">Last 30 days <ChevronDown /></button></header><div className="odr-chart"><span>$6K</span><span>$4K</span><span>$2K</span><span>$0</span><svg viewBox="0 0 460 170" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="odrRevenue" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1ed69a" stopOpacity=".32"/><stop offset="1" stopColor="#1ed69a" stopOpacity="0"/></linearGradient></defs><path className="odr-chart-area" d="M0 145 L20 132 38 134 56 121 74 125 92 111 110 115 130 97 148 104 165 83 183 90 202 76 220 88 240 67 258 72 276 54 294 65 312 45 330 57 348 32 367 38 385 22 404 28 424 6 460 0 L460 170 L0 170Z"/><path className="odr-chart-line" d="M0 145 L20 132 38 134 56 121 74 125 92 111 110 115 130 97 148 104 165 83 183 90 202 76 220 88 240 67 258 72 276 54 294 65 312 45 330 57 348 32 367 38 385 22 404 28 424 6 460 0"/></svg><footer><span>Aug 16</span><span>Aug 23</span><span>Aug 30</span><span>Sep 6</span><span>Sep 13</span></footer></div></article>
        <article className="odr-card odr-service-mix"><header className="odr-card-head"><h2>Jobs by Service</h2></header><div className="odr-donut" style={{ background: "conic-gradient(#1ed69a 0 62%, #3b9bff 62% 80%, #ffad45 80% 88%, #8b6cff 88% 94%, #ff6868 94% 98%, #758391 98% 100%)" }}><div><strong>287</strong><small>Jobs</small></div></div><div className="odr-service-legend">{SERVICE_MIX.map(([name, value, color]) => <p key={name}><i style={{ background: color }} />{name}<b>{value}</b></p>)}</div></article>
        <article className="odr-card odr-growth"><div className="odr-growth-copy"><h2>Add more services.<br />Reach more customers.</h2><p>Expand into lawn care, junk removal, handyman, and AI-powered service growth.</p><button type="button">Explore new services <ArrowRight /></button><footer><Wrench /><Briefcase /><Megaphone /><MoreHorizontal /></footer></div><img src="/manus-storage/dashboard-growth-home_e675ad8d.jpg" alt="Warm modern home interior" /></article>
      </section>
    </div>
  </main>;
}

function HeartStatusIcon(props: React.ComponentProps<typeof CheckCircle2>) { return <CheckCircle2 {...props} />; }

function ActivityRow({ icon: Icon, tone, title, time, detail }: { icon: LucideIcon; tone: string; title: string; time: string; detail: string }) {
  return <button type="button" className="odr-activity-row"><span className={`odr-activity-icon ${tone}`}><Icon /></span><div><strong>{title}</strong><small>{detail}</small></div><time>{time}</time></button>;
}

function ActionRow({ icon: Icon, tone, title, detail, selected, onClick }: { icon: LucideIcon; tone: string; title: string; detail: string; selected: boolean; onClick: () => void }) {
  return <button type="button" className={`odr-action-row ${tone} ${selected ? "is-selected" : ""}`} aria-pressed={selected} onClick={onClick}><span><Icon /></span><div><strong>{title}</strong><small>{detail}</small></div><ArrowRight /></button>;
}
