import { useCallback, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  DollarSign,
  Info,
  List,
  Map,
  MapPin,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Search,
  Sparkles,
  Sun,
  Users,
  UserPlus,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { LeadflowScheduleMap, type LeadflowScheduleMapJob, type LeadflowScheduleMapTeam } from "@/components/LeadflowScheduleMap";
import "./operations-dashboard-exact-live.css";
import "./operations-dashboard-exact-live-cohesion.css";

type MapView = "map" | "list" | "timeline";
type Tone = "green" | "amber" | "blue" | "slate";
type DashboardJob = {
  id: number;
  customerName: string;
  address: string | null;
  serviceName: string | null;
  serviceDateTime: string | null;
  bookingStatus: string;
  jobStatus: string;
  teamName: string | null;
  jobTotalCents: number;
  customerRating: number | null;
  latitude: number | null;
  longitude: number | null;
};
type Overview = {
  date: string;
  jobs: DashboardJob[];
  metrics: {
    jobsToday: number;
    completedJobs: number;
    remainingJobs: number;
    scheduledValueCents: number;
    activeTeams: number;
    routeExceptions: number;
    reviewQueue: number;
    newLeads: number;
    unrespondedLeads: number;
  };
  activities: Array<{ id: number; eventType: string; title: string; body: string | null; createdAt: Date; readAt: Date | null }>;
  sources: Array<{ source: string; count: number; previousCount: number }>;
  revenueTrend: Array<{ date: string; totalCents: number }>;
  previousRevenueTotalCents: number;
  serviceMix: Array<{ label: string; count: number }>;
};
type CustomerResult = { phone: string; name: string; address: string | null };

const ASSET_ROOT = "https://leadflowqf-caerhauj.manus.space/manus-storage";
const TEAM_PORTRAIT = `${ASSET_ROOT}/dashboard-team-portrait_ee89ad11.jpg`;
const HOME_IMAGES = [
  `${ASSET_ROOT}/dashboard-home-living_34007149.jpg`,
  `${ASSET_ROOT}/dashboard-home-dining_02439dcf.jpg`,
  `${ASSET_ROOT}/dashboard-growth-home_e675ad8d.jpg`,
] as const;
const ET = "America/New_York";
const SOURCE_COLORS: Record<string, string> = { Thumbtack: "#38a8ff", Google: "#60b8ff", Yelp: "#8ac8ff", Nextdoor: "#78ddc4", "Website / AI": "#a286ff", Angi: "#ffab62", Meta: "#60b8ff", Bark: "#758391", Phone: "#758391", Campaign: "#a286ff", Direct: "#78ddc4", Other: "#758391" };
const SERVICE_COLORS = ["#1ed69a", "#3b9bff", "#ffad45", "#8b6cff", "#ff6868", "#758391"];

function easternToday() { return new Date().toLocaleDateString("en-CA", { timeZone: ET }); }
function formatMoney(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100); }
function formatTime(value: string | null) {
  if (!value) return "Time pending";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time pending" : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
}
function formatLongDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: ET }); }
function percentChange(current: number, previous: number) {
  if (!previous) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  return { change, label: `${change >= 0 ? "↑" : "↓"} ${Math.abs(change)}%` };
}
function timeAgo(value: Date) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"} ago`;
}
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "MI"; }
function statusTone(status: string): Tone {
  if (status === "completed") return "green";
  if (status === "running_late" || status === "issue_at_property" || status === "no_show") return "amber";
  if (["on_the_way", "arrived", "in_progress", "wrapping_up", "finishing_up"].includes(status)) return "blue";
  return "slate";
}
function statusLabel(status: string) {
  const labels: Record<string, string> = { on_the_way: "On route", arrived: "Arrived", in_progress: "In progress", running_late: "Running late", wrapping_up: "Finishing up", finishing_up: "Finishing up", completed: "Completed", issue_at_property: "Issue", no_show: "No show", assigned: "Upcoming" };
  return labels[status] ?? "Upcoming";
}
function activityTone(eventType: string) {
  if (eventType === "booking") return "coral";
  if (eventType === "new_lead" || eventType === "lead_reply") return "blue";
  if (eventType === "review_send") return "gold";
  return "green";
}
function activityIcon(eventType: string): LucideIcon {
  if (eventType === "booking") return CalendarDays;
  if (eventType === "new_lead" || eventType === "lead_reply") return MessageSquare;
  if (eventType === "review_send") return HeartStatusIcon;
  return CheckCircle2;
}
function activityHref(eventType: string) {
  if (eventType === "new_lead" || eventType === "lead_reply" || eventType === "booking") return "/admin/leads";
  if (eventType === "review_send") return "/admin/quality";
  return "/admin/command-chat";
}
function buildChartPath(points: Array<{ totalCents: number }>) {
  const max = Math.max(1, ...points.map(point => point.totalCents));
  const width = 460;
  const height = 170;
  const baseline = 158;
  const coordinates = points.map((point, index) => {
    const x = points.length <= 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = baseline - Math.round((point.totalCents / max) * 146);
    return [x, y] as const;
  });
  const line = coordinates.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") || `M0 ${baseline} L${width} ${baseline}`;
  return { line, area: `${line} L${width} 170 L0 170Z`, max };
}
function donutGradient(items: Array<{ count: number; color: string }>) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (!total) return "conic-gradient(#758391 0 100%)";
  let cursor = 0;
  const stops = items.map(item => { const next = cursor + (item.count / total) * 100; const result = `${item.color} ${cursor}% ${next}%`; cursor = next; return result; });
  return `conic-gradient(${stops.join(", ")})`;
}

function MetricCard({ icon: Icon, tone, value, label, change, detail, href }: { icon: LucideIcon; tone: string; value: string; label: string; change?: string; detail: string; href?: string }) {
  const content = <><span className="odr-metric-icon" style={{ "--accent": tone } as CSSProperties}><Icon /></span><div className="odr-metric-copy"><div className="odr-metric-head"><strong>{value}</strong>{change && <em>{change}</em>}</div><b>{label}</b><small>{detail}</small></div></>;
  return href ? <a className="odr-metric-card" href={href}>{content}</a> : <article className="odr-metric-card">{content}</article>;
}

function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/agents/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: email.trim(), password }) });
      const result = await response.json();
      if (!response.ok || !result.success) { setError(result.error || "Login failed. Please try again."); return; }
      onSuccess();
    } catch { setError("Login failed. Please try again."); } finally { setPending(false); }
  };
  return <main className="odr-login"><form onSubmit={submit}><span><Sparkles /></span><strong>Operations Dashboard</strong><small>Sign in to view the live operation.</small><label>Email<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>{error && <p>{error}</p>}<button type="submit" disabled={pending || !email || !password}>{pending ? "Signing in…" : "Sign in"}</button></form></main>;
}

export default function OperationsDashboardExactLive() {
  const [view, setView] = useState<MapView>("map");
  const [activeTeam, setActiveTeam] = useState(0);
  const [activeSchedule, setActiveSchedule] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const dashboardDate = easternToday();
  const { data: agent, isLoading: agentLoading, isError: agentError, refetch: refetchAgent } = trpc.agents.me.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
  const { data, isLoading, isFetching, error } = trpc.leadflowJobs.dashboardOverview.useQuery({ date: dashboardDate }, { enabled: Boolean(agent), staleTime: 30_000, refetchInterval: 60_000, refetchIntervalInBackground: false, retry: false });
  const { data: scheduleMapData } = trpc.leadflowSchedule.getSchedule.useQuery({ date: dashboardDate }, { enabled: Boolean(agent), staleTime: 30_000, refetchOnWindowFocus: false, retry: false });
  const { data: hiringStats } = trpc.hiring.getPipelineStats.useQuery(undefined, { enabled: Boolean(agent), staleTime: 55_000, refetchInterval: 60_000, retry: false });
  const { data: searchResults } = trpc.opsChat.searchCustomers.useQuery({ query: search.trim() }, { enabled: Boolean(agent) && search.trim().length >= 2, staleTime: 30_000, retry: false });
  const overview = data as Overview | undefined;
  const customerSearchResults = (searchResults as { customers?: CustomerResult[] } | undefined)?.customers ?? [];
  const metrics = overview?.metrics;
  const schedule = useMemo(() => (overview?.jobs ?? []).slice(0, 5), [overview?.jobs]);
  const mapJobs = overview?.jobs ?? [];
  const scheduleMapJobs = useMemo<LeadflowScheduleMapJob[]>(() => (scheduleMapData?.jobs ?? []).map(job => ({
    id: job.id,
    customerName: job.customerName,
    jobAddress: job.jobAddress,
    serviceDateTime: job.serviceDateTime,
    assignment: job.assignment ? { teamId: job.assignment.teamId, routeOrder: job.assignment.routeOrder } : null,
  })), [scheduleMapData?.jobs]);
  const scheduleMapTeams = useMemo<LeadflowScheduleMapTeam[]>(() => (scheduleMapData?.teams ?? []).map(team => ({
    id: team.id,
    name: team.name,
    color: team.color,
    homeLat: team.homeLat,
    homeLng: team.homeLng,
    isActive: team.isActive,
  })), [scheduleMapData?.teams]);
  const active = mapJobs[activeTeam] ?? null;
  const selectMapJob = useCallback((jobId: number) => {
    const nextIndex = mapJobs.findIndex(job => job.id === jobId);
    if (nextIndex >= 0) setActiveTeam(nextIndex);
  }, [mapJobs]);
  const chart = useMemo(() => buildChartPath(overview?.revenueTrend ?? []), [overview?.revenueTrend]);
  const sourceRows = useMemo(() => (overview?.sources ?? []).slice(0, 6).map(item => ({ ...item, color: SOURCE_COLORS[item.source] ?? SOURCE_COLORS.Other, trend: percentChange(item.count, item.previousCount) })), [overview?.sources]);
  const maxSource = Math.max(1, ...sourceRows.map(item => item.count));
  const serviceMix = useMemo(() => (overview?.serviceMix ?? []).map((item, index) => ({ ...item, color: SERVICE_COLORS[index % SERVICE_COLORS.length] })), [overview?.serviceMix]);
  const serviceTotal = serviceMix.reduce((sum, item) => sum + item.count, 0);
  const revenueTotalCents = (overview?.revenueTrend ?? []).reduce((sum, point) => sum + point.totalCents, 0);
  const revenueTrend = percentChange(revenueTotalCents, overview?.previousRevenueTotalCents ?? 0);
  const unreadActivity = Boolean(overview?.activities.some(item => item.readAt === null));
  const applicantCount = hiringStats?.candidatesInMotion ?? 0;

  if (agentLoading) return <main className="odr-loading">Loading Operations Dashboard…</main>;
  if (agentError || !agent) return <LoginGate onSuccess={() => void refetchAgent()} />;

  return <main className="odr-dashboard" data-live-operations-dashboard="true">
    <header className="odr-utility-bar">
      <label className="odr-search"><Search /><input aria-label="Search customers" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search anything..." /><kbd>⌘ K</kbd>{search.trim().length >= 2 && <div className="odr-search-results">{customerSearchResults.length ? customerSearchResults.slice(0, 6).map(result => <a key={`${result.phone}-${result.name}`} href={`/admin/customer-profile?phone=${encodeURIComponent(result.phone)}&name=${encodeURIComponent(result.name)}`}><strong>{result.name || result.phone}</strong><small>{result.address || result.phone}</small></a>) : <p>No matching customers</p>}</div>}</label>
      <div className="odr-utilities"><button type="button" aria-label="Dashboard appearance"><Sun /></button><button type="button" className="odr-location"><MapPin /> Washington, DC <ChevronDown /></button><button type="button" className="odr-notifications" aria-label="Recent activity" onClick={() => setActivityOpen(open => !open)}><Bell />{unreadActivity && <i />}</button><button type="button" className="odr-avatar" aria-label={`${agent.name} profile`}>{initials(agent.name)}</button></div>
      {activityOpen && <aside className="odr-live-activity-popover"><header><strong>Recent Activity</strong><button type="button" aria-label="Close recent activity" onClick={() => setActivityOpen(false)}>×</button></header>{(overview?.activities ?? []).length ? overview!.activities.map(item => <a href={activityHref(item.eventType)} key={item.id}><b>{item.title}</b><small>{item.body || "Recorded activity"}</small><time>{timeAgo(item.createdAt)}</time></a>) : <p>No activity has been recorded yet.</p>}</aside>}
    </header>

    <div className="odr-content">
      <section className="odr-greeting"><div><small>{formatLongDate(overview?.date ?? easternToday())} · East Coast{isFetching ? " · Updating…" : ""}</small><h1>Good morning, {agent.name.split(" ")[0] || "Operations"} <span>👋</span></h1><p>Here’s your business at a glance. Everything looks good.</p></div><aside className="odr-quote"><Sparkles /><p>“Clear priorities make a calm service day.”</p><small>— LeadFlow Operations</small></aside></section>

      <section className="odr-kpis" aria-label="Live daily metrics">
        <MetricCard icon={CalendarDays} tone="#3b9bff" value={metrics ? String(metrics.jobsToday) : "—"} label="Jobs Today" detail={metrics ? `${metrics.completedJobs} completed · ${metrics.remainingJobs} remaining` : "Loading live schedule"} href="/admin/day-board" />
        <MetricCard icon={DollarSign} tone="#1ed69a" value={metrics ? formatMoney(metrics.scheduledValueCents) : "—"} label="Revenue Today" detail="Scheduled job value" href="/admin/schedule" />
        <MetricCard icon={Users} tone="#4aa8ff" value={metrics ? String(metrics.activeTeams) : "—"} label="Teams Active" detail="Working teams in the field" href="/admin/day-board" />
        <MetricCard icon={MessageSquare} tone="#ffb449" value={metrics ? String(metrics.newLeads) : "—"} label="New Leads" detail={metrics ? `${metrics.unrespondedLeads} unresponded` : "Loading lead activity"} href="/admin/leads" />
        <MetricCard icon={HeartStatusIcon} tone="#ff7c88" value={metrics ? String(metrics.reviewQueue) : "—"} label="Review Queue" detail="Completed jobs without a rating" href="/admin/quality" />
      </section>

      {error ? <section className="odr-live-error"><Info /><div><b>Dashboard data could not load.</b><span>{error.message}</span></div></section> : <>
        <section className="odr-primary-grid" aria-label="Live field operations overview">
          <article className="odr-card odr-jobs-card">
            <header className="odr-card-head odr-jobs-head"><div><span className="odr-section-kicker">Field view</span><h2>Jobs in Progress</h2><p>Live view of your teams in the field</p><div className="odr-field-meta"><span><i className="green" />{metrics?.activeTeams ?? "—"} teams in field</span><span><i className="amber" />{metrics?.routeExceptions ?? "—"} route exceptions</span></div></div><div className="odr-segmented" aria-label="Map display selector">{(["map", "list", "timeline"] as MapView[]).map(option => <button type="button" className={view === option ? "is-active" : ""} key={option} onClick={() => setView(option)}>{option === "map" ? <Map /> : option === "list" ? <List /> : <Clock />}{option[0].toUpperCase() + option.slice(1)}</button>)}</div></header>
            <div className={`odr-map odr-map-${view}`}>
              {view === "map" && (scheduleMapData
                ? <LeadflowScheduleMap jobs={scheduleMapJobs} teams={scheduleMapTeams} selectedJobId={active?.id ?? null} onJobSelect={selectMapJob} darkMode maxUnassignedJobs={30} />
                : <p className="odr-live-empty">Loading route map…</p>)}
              {view === "map" && active && <div className="odr-team-popover"><img className="odr-team-photo" src={TEAM_PORTRAIT} alt="Team portrait"/><div><strong>{active.teamName || active.customerName}</strong><span>{active.serviceName || "Service"}</span><small>{active.address || "Address pending"}</small><b>{statusLabel(active.jobStatus)}</b><i><em style={{ width: active.jobStatus === "completed" ? "100%" : "68%" }} /></i></div></div>}
              {view === "list" && <div className="odr-map-alt"><h3>Active team list</h3>{mapJobs.length ? mapJobs.map(job => <p key={job.id}><span className={statusTone(job.jobStatus)} /> <b>{job.teamName || job.customerName}</b><small>{statusLabel(job.jobStatus)}</small></p>) : <p><small>No cached job locations yet.</small></p>}</div>}
              {view === "timeline" && <div className="odr-map-alt odr-mini-timeline"><h3>Team timeline</h3>{mapJobs.length ? mapJobs.map((job, index) => <p key={job.id}><b>{job.teamName || job.customerName}</b><i style={{ width: `${38 + index * 12}%` }} /></p>) : <p><small>No active team timeline yet.</small></p>}</div>}
              <footer className="odr-map-legend"><span><i className="green" />On time <b>{metrics?.activeTeams ?? "—"}</b></span><span><i className="amber" />Running late <b>{metrics?.routeExceptions ?? "—"}</b></span><span><i className="blue" />Completed <b>{metrics?.completedJobs ?? "—"}</b></span><span><i className="slate" />Not started <b>{metrics?.remainingJobs ?? "—"}</b></span></footer>
            </div>
          </article>

          <article className="odr-card odr-schedule-card"><header className="odr-card-head"><div><span className="odr-section-kicker">Day route</span><h2>Today’s Schedule</h2><p>{metrics ? `${metrics.jobsToday} planned stop${metrics.jobsToday === 1 ? "" : "s"} across the day` : "Loading planned stops"}</p></div><a href="/admin/schedule" className="odr-text-action">View all <ArrowRight /></a></header><div className="odr-schedule-list">{isLoading ? <p className="odr-live-empty">Loading schedule…</p> : schedule.length ? schedule.map((job, index) => <a href="/admin/day-board" className={`odr-schedule-row ${activeSchedule === String(job.id) ? "is-selected" : ""}`} aria-current={activeSchedule === String(job.id) ? "true" : undefined} key={job.id} onClick={() => setActiveSchedule(String(job.id))}><span className={`odr-schedule-rail ${statusTone(job.jobStatus)}`}><i /></span><time>{formatTime(job.serviceDateTime)}<small className={statusTone(job.jobStatus)}>{statusLabel(job.jobStatus)}</small></time><img className="odr-home-thumb" src={HOME_IMAGES[index % HOME_IMAGES.length]} alt="Service home"/><div><strong>{job.address || "Address pending"}</strong><small>{[job.serviceName, job.teamName].filter(Boolean).join(" · ") || "Service pending"}</small></div><MoreHorizontal /></a>) : <p className="odr-live-empty">No active jobs are scheduled for this date.</p>}</div><a href="/admin/schedule" className="odr-outline-button">View full schedule <ArrowRight /></a></article>

          <aside className="odr-attention-rail"><article className="odr-card odr-activity"><header className="odr-card-head"><div><span className="odr-section-kicker">Signal feed</span><h2>Recent Activity</h2></div><button type="button" className="odr-text-action" onClick={() => setActivityOpen(true)}>View all <ArrowRight /></button></header>{(overview?.activities ?? []).length ? overview!.activities.map(item => <ActivityRow href={activityHref(item.eventType)} key={item.id} icon={activityIcon(item.eventType)} tone={activityTone(item.eventType)} title={item.title} time={timeAgo(item.createdAt)} detail={item.body || "Recorded activity"}/>) : !isLoading && <p className="odr-live-empty">No activity has been recorded yet.</p>}</article><article className="odr-card odr-actions"><header className="odr-card-head"><div><span className="odr-section-kicker">Exception queue</span><h2>Action Items</h2></div></header><ActionRow href="/admin/day-board" icon={AlertTriangle} tone="danger" title={`${metrics?.routeExceptions ?? "—"} route exception${metrics?.routeExceptions === 1 ? "" : "s"}`} detail="Review route exceptions" selected={activeAction === "route"} onClick={() => setActiveAction("route")}/><ActionRow href="/admin/leads" icon={Info} tone="blue" title={`${metrics?.unrespondedLeads ?? "—"} new lead${metrics?.unrespondedLeads === 1 ? "" : "s"} unresponded`} detail="Respond within one hour" selected={activeAction === "leads"} onClick={() => setActiveAction("leads")}/><ActionRow href="/admin/hiring" icon={UserPlus} tone="purple" title={`${applicantCount} candidate${applicantCount === 1 ? "" : "s"} in motion`} detail="Move candidates to screening" selected={activeAction === "applicants"} onClick={() => setActiveAction("applicants")}/></article></aside>
        </section>

        <section className="odr-analytics-grid"><article className="odr-card odr-lead-sources"><header className="odr-card-head"><h2>Lead Sources</h2><button type="button" className="odr-select">Last 30 days <ChevronDown /></button></header>{sourceRows.length ? sourceRows.map(item => <div className="odr-source-row" key={item.source}><span className="odr-source-logo" style={{ background: item.color }}>{item.source[0]?.toUpperCase() || "D"}</span><b>{item.source}</b><i><em style={{ width: `${(item.count / maxSource) * 100}%`, background: item.color }} /></i><strong>{item.count}</strong><small className={item.trend && item.trend.change < 0 ? "is-negative" : ""}>{item.trend?.label ?? "—"}</small></div>) : <p className="odr-live-empty">No lead-source records in this period.</p>}</article>
          <article className="odr-card odr-revenue"><header className="odr-card-head"><div><h2>Revenue</h2><p><b>{formatMoney(revenueTotalCents)}</b>{revenueTrend && <em className={revenueTrend.change < 0 ? "is-negative" : ""}>{revenueTrend.label}</em>}</p></div><button type="button" className="odr-select">Last 30 days <ChevronDown /></button></header><div className="odr-chart"><span>{formatMoney(chart.max)}</span><span>{formatMoney(Math.round(chart.max * .66))}</span><span>{formatMoney(Math.round(chart.max * .33))}</span><span>$0</span><svg viewBox="0 0 460 170" preserveAspectRatio="none" aria-label="Scheduled value trend"><defs><linearGradient id="odrRevenue" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1ed69a" stopOpacity=".32"/><stop offset="1" stopColor="#1ed69a" stopOpacity="0"/></linearGradient></defs><path className="odr-chart-area" d={chart.area}/><path className="odr-chart-line" d={chart.line}/></svg><footer>{[0, 7, 14, 21, 29].map(offset => <span key={offset}>{overview?.revenueTrend[offset]?.date ?? ""}</span>)}</footer></div></article>
          <article className="odr-card odr-service-mix"><header className="odr-card-head"><h2>Jobs by Service</h2></header><div className="odr-donut" style={{ background: donutGradient(serviceMix) }}><div><strong>{serviceTotal || "—"}</strong><small>Jobs</small></div></div><div className="odr-service-legend">{serviceMix.length ? serviceMix.map(item => <p key={item.label}><i style={{ background: item.color }} />{item.label}<b>{serviceTotal ? `${Math.round((item.count / serviceTotal) * 100)}%` : "0%"}</b></p>) : <p><span>No service mix yet.</span></p>}</div></article>
          <article className="odr-card odr-growth"><div className="odr-growth-copy"><h2>Add more services.<br />Reach more customers.</h2><p>Expand into lawn care, junk removal, handyman, and AI-powered service growth.</p><button type="button">Explore new services <ArrowRight /></button><footer><Wrench /><Briefcase /><Megaphone /><MoreHorizontal /></footer></div><img src={`${ASSET_ROOT}/dashboard-growth-home_e675ad8d.jpg`} alt="Warm modern home interior" /></article>
        </section>
      </>}
    </div>
  </main>;
}

const HeartStatusIcon = CheckCircle2;

function ActivityRow({ icon: Icon, tone, title, time, detail, href }: { icon: LucideIcon; tone: string; title: string; time: string; detail: string; href: string }) {
  return <a href={href} className="odr-activity-row"><span className={`odr-activity-icon ${tone}`}><Icon /></span><div><strong>{title}</strong><small>{detail}</small></div><time>{time}</time></a>;
}

function ActionRow({ icon: Icon, tone, title, detail, selected, onClick, href }: { icon: LucideIcon; tone: string; title: string; detail: string; selected: boolean; onClick: () => void; href: string }) {
  return <a href={href} className={`odr-action-row ${tone} ${selected ? "is-selected" : ""}`} aria-current={selected ? "true" : undefined} onClick={onClick}><span><Icon /></span><div><strong>{title}</strong><small>{detail}</small></div><ArrowRight /></a>;
}
