import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  DollarSign,
  Loader2,
  Map,
  MapPin,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  Users,
  UserPlus,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MapView } from "@/components/Map";
import "./operations-dashboard-exact-live.css";

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
  latitude: number | null;
  longitude: number | null;
};

type Activity = { id: number; eventType: string; title: string; body: string | null; createdAt: Date };
type Source = { source: string; count: number };
type TrendPoint = { date: string; totalCents: number };
type ServiceMix = { label: string; count: number };
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
  activities: Activity[];
  sources: Source[];
  revenueTrend: TrendPoint[];
  serviceMix: ServiceMix[];
};

const ET = "America/New_York";

function easternToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: ET });
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function formatTime(value: string | null) {
  if (!value) return "Time pending";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time pending" : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: ET });
}

function timeAgo(value: Date) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "MI";
}

function jobStatusLabel(status: string) {
  const labels: Record<string, string> = {
    on_the_way: "On the way",
    arrived: "Arrived",
    in_progress: "In progress",
    running_late: "Running late",
    wrapping_up: "Finishing up",
    completed: "Completed",
    issue_at_property: "Issue",
    no_show: "No show",
    assigned: "Scheduled",
  };
  return labels[status] ?? "Scheduled";
}

function jobTone(status: string) {
  if (status === "completed") return "green";
  if (status === "running_late" || status === "issue_at_property" || status === "no_show") return "red";
  if (["on_the_way", "arrived", "in_progress", "wrapping_up"].includes(status)) return "blue";
  return "slate";
}

function activityHref(eventType: string) {
  if (eventType === "new_lead" || eventType === "lead_reply" || eventType === "booking") return "/admin/leads";
  if (eventType === "review_send") return "/admin/quality";
  return "/admin/command-chat";
}

function useDashboardLogin() {
  const { data: agent, isLoading, isError, refetch } = trpc.agents.me.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
  return { agent, isLoading, isError, refetch };
}

function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/agents/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setError(result.error || "Login failed. Please try again.");
        return;
      }
      onSuccess();
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return <main className="odl-login"><form onSubmit={submit}><header><span><Sparkles /></span><div><strong>Operations Dashboard</strong><small>Sign in to view the live operation</small></div></header><label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p>{error}</p>}<button type="submit" disabled={pending || !email || !password}>{pending ? <Loader2 className="animate-spin" /> : <Send />}Sign in</button></form></main>;
}

function FieldMap({ jobs }: { jobs: DashboardJob[] }) {
  const markerRefs = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const mappable = useMemo(() => jobs.filter(job => job.latitude !== null && job.longitude !== null), [jobs]);
  const onMapReady = useCallback((map: google.maps.Map) => {
    markerRefs.current.forEach(marker => marker.map = null);
    markerRefs.current = [];
    if (!mappable.length || !window.google?.maps) return;
    const bounds = new window.google.maps.LatLngBounds();
    for (const job of mappable) {
      const position = { lat: job.latitude!, lng: job.longitude! };
      const marker = new window.google.maps.marker.AdvancedMarkerElement({ map, position, title: `${job.customerName} · ${jobStatusLabel(job.jobStatus)}` });
      markerRefs.current.push(marker);
      bounds.extend(position);
    }
    if (mappable.length === 1) {
      map.setCenter({ lat: mappable[0].latitude!, lng: mappable[0].longitude! });
      map.setZoom(13);
    } else {
      map.fitBounds(bounds, 46);
    }
  }, [mappable]);

  if (!mappable.length) return <div className="odl-map-empty"><MapPin /><strong>No cached job locations yet</strong><span>Jobs remain visible in today’s schedule.</span></div>;
  return <MapView className="odl-google-map" initialCenter={{ lat: mappable[0].latitude!, lng: mappable[0].longitude! }} initialZoom={11} onMapReady={onMapReady} />;
}

function MetricCard({ icon: Icon, label, value, detail, tone, href }: { icon: typeof CalendarDays; label: string; value: string; detail: string; tone: string; href?: string }) {
  const content = <><span className={`odl-metric-icon ${tone}`}><Icon /></span><span><strong>{value}</strong><b>{label}</b><small>{detail}</small></span></>;
  return href ? <a className="odl-metric-card" href={href}>{content}</a> : <article className="odl-metric-card">{content}</article>;
}

export default function OperationsDashboardExactLive() {
  const { agent, isLoading: agentLoading, isError: agentError, refetch: refetchAgent } = useDashboardLogin();
  const [date, setDate] = useState(easternToday);
  const [activityOpen, setActivityOpen] = useState(false);
  const { data, isLoading, isFetching, error } = trpc.leadflowJobs.dashboardOverview.useQuery({ date }, { enabled: Boolean(agent), staleTime: 30_000, refetchInterval: 60_000, refetchIntervalInBackground: false, retry: false });
  const { data: hiringStats } = trpc.hiring.getPipelineStats.useQuery(undefined, { enabled: Boolean(agent), staleTime: 55_000, refetchInterval: 60_000, retry: false });
  const overview = data as Overview | undefined;
  const scheduleRows = useMemo(() => (overview?.jobs ?? []).slice(0, 5), [overview?.jobs]);
  const sources = useMemo(() => (overview?.sources ?? []).slice(0, 6), [overview?.sources]);
  const maxSource = Math.max(1, ...sources.map(item => item.count));
  const maxService = Math.max(1, ...(overview?.serviceMix ?? []).map(item => item.count));
  const trendMax = Math.max(1, ...(overview?.revenueTrend ?? []).map(item => item.totalCents));

  if (agentLoading) return <main className="odl-loading"><Loader2 className="animate-spin" /></main>;
  if (agentError || !agent) return <LoginGate onSuccess={() => void refetchAgent()} />;

  const metrics = overview?.metrics;
  const applicantCount = hiringStats?.candidatesInMotion ?? 0;

  return <main className="odl-dashboard" aria-label="Operations Dashboard">
    <header className="odl-utility-bar">
      <a className="odl-title" href="/admin/dashboard"><span><Sparkles /></span><strong>Operations Dashboard</strong></a>
      <div className="odl-utilities"><label className="odl-date"><CalendarDays /><input aria-label="Dashboard date" type="date" value={date} onChange={event => setDate(event.target.value)} /></label><button type="button" className="odl-activity-button" aria-label="Open recent activity" onClick={() => setActivityOpen(open => !open)}><Bell /></button><span className="odl-avatar" title={agent.name}>{initials(agent.name)}</span></div>
      {activityOpen && <aside className="odl-activity-popover"><header><strong>Recent activity</strong><button type="button" onClick={() => setActivityOpen(false)} aria-label="Close recent activity"><X /></button></header>{(overview?.activities ?? []).length ? <div>{overview!.activities.map(item => <a href={activityHref(item.eventType)} key={item.id}><span><Bell /></span><p><b>{item.title}</b>{item.body && <small>{item.body}</small>}</p><time>{timeAgo(item.createdAt)}</time></a>)}</div> : <p className="odl-empty">No recorded activity yet.</p>}</aside>}
    </header>

    <div className="odl-content">
      <section className="odl-greeting"><div><small>{formatDate(date)} · East Coast{isFetching ? " · Updating…" : ""}</small><h1>Good morning, {agent.name.split(" ")[0] || "Operations"}</h1><p>Today’s scheduled operation at a glance.</p></div><a className="odl-command-link" href="/admin/command-chat"><MessageSquare /><span><b>Command Chat</b><small>Open the live operations channel</small></span><ArrowRight /></a></section>

      <section className="odl-kpis" aria-label="Live daily metrics">
        <MetricCard icon={CalendarDays} tone="blue" value={metrics ? String(metrics.jobsToday) : "—"} label="Jobs Today" detail={metrics ? `${metrics.completedJobs} completed · ${metrics.remainingJobs} remaining` : "Loading live schedule"} href="/admin/day-board" />
        <MetricCard icon={DollarSign} tone="green" value={metrics ? formatMoney(metrics.scheduledValueCents) : "—"} label="Scheduled Value" detail="Active jobs scheduled for this day" href="/admin/schedule" />
        <MetricCard icon={Users} tone="cyan" value={metrics ? String(metrics.activeTeams) : "—"} label="Teams Active" detail="Teams currently in active job statuses" href="/admin/day-board" />
        <MetricCard icon={MessageSquare} tone="gold" value={metrics ? String(metrics.newLeads) : "—"} label="New Leads" detail={metrics ? `${metrics.unrespondedLeads} unresponded` : "Loading lead activity"} href="/admin/leads" />
        <MetricCard icon={CheckCircle2} tone="rose" value={metrics ? String(metrics.reviewQueue) : "—"} label="Review Queue" detail="Completed jobs without a recorded rating" href="/admin/quality" />
      </section>

      {error ? <section className="odl-error"><CircleAlert /><div><b>Dashboard data could not load.</b><span>{error.message}</span></div></section> : <>
        <section className="odl-primary-grid">
          <article className="odl-card odl-map-card"><header className="odl-card-head"><div><small>Field view</small><h2>Jobs in Progress</h2><p>Live locations appear only when a cached job coordinate exists.</p></div><a href="/admin/day-board">Open Day Board <ArrowRight /></a></header><div className="odl-map-wrap">{overview ? <FieldMap jobs={overview.jobs} /> : <div className="odl-map-empty"><Loader2 className="animate-spin" /><span>Loading field view…</span></div>}</div><footer className="odl-map-legend"><span><i className="blue" />Active <b>{metrics?.activeTeams ?? "—"}</b></span><span><i className="red" />Exceptions <b>{metrics?.routeExceptions ?? "—"}</b></span><span><i className="green" />Completed <b>{metrics?.completedJobs ?? "—"}</b></span><span><i className="slate" />Scheduled <b>{metrics?.remainingJobs ?? "—"}</b></span></footer></article>

          <article className="odl-card odl-schedule-card"><header className="odl-card-head"><div><small>Day route</small><h2>Today’s Schedule</h2><p>{metrics ? `${metrics.jobsToday} active scheduled job${metrics.jobsToday === 1 ? "" : "s"}` : "Loading schedule"}</p></div><a href="/admin/schedule">View all <ArrowRight /></a></header><div className="odl-schedule-list">{isLoading ? <p className="odl-empty">Loading schedule…</p> : scheduleRows.length ? scheduleRows.map(job => <a href="/admin/day-board" key={job.id} className="odl-schedule-row"><span className={`odl-status-dot ${jobTone(job.jobStatus)}`} /><time>{formatTime(job.serviceDateTime)}<small className={jobTone(job.jobStatus)}>{jobStatusLabel(job.jobStatus)}</small></time><span className="odl-job-avatar">{initials(job.customerName)}</span><span><b>{job.address || "Address pending"}</b><small>{[job.serviceName, job.teamName].filter(Boolean).join(" · ") || "Service pending"}</small></span><ArrowRight /></a>) : <p className="odl-empty">No active jobs scheduled for this date.</p>}</div><a className="odl-outline-link" href="/admin/schedule">View full schedule <ArrowRight /></a></article>

          <aside className="odl-attention-rail"><article className="odl-card odl-activity-card"><header className="odl-card-head"><div><small>Signal feed</small><h2>Recent Activity</h2></div><button type="button" onClick={() => setActivityOpen(true)}>View all <ArrowRight /></button></header><div>{(overview?.activities ?? []).slice(0, 5).map(item => <a className="odl-activity-row" href={activityHref(item.eventType)} key={item.id}><span><Bell /></span><p><b>{item.title}</b><small>{item.body || "Recorded activity"}</small></p><time>{timeAgo(item.createdAt)}</time></a>)}{!isLoading && !(overview?.activities ?? []).length && <p className="odl-empty">No recorded activity yet.</p>}</div></article><article className="odl-card odl-actions"><header className="odl-card-head"><div><small>Exception queue</small><h2>Action Items</h2></div></header><a href="/admin/day-board" className="odl-action-row danger"><span><AlertTriangle /></span><p><b>{metrics?.routeExceptions ?? "—"} route exception{metrics?.routeExceptions === 1 ? "" : "s"}</b><small>Open live job status in Day Board</small></p><ArrowRight /></a><a href="/admin/leads" className="odl-action-row blue"><span><MessageSquare /></span><p><b>{metrics?.unrespondedLeads ?? "—"} unresponded lead{metrics?.unrespondedLeads === 1 ? "" : "s"}</b><small>Continue in the existing Leads CRM</small></p><ArrowRight /></a><a href="/admin/hiring" className="odl-action-row purple"><span><UserPlus /></span><p><b>{applicantCount} candidate{applicantCount === 1 ? "" : "s"} in motion</b><small>Open the existing hiring pipeline</small></p><ArrowRight /></a></article></aside>
        </section>

        <section className="odl-analytics-grid">
          <article className="odl-card odl-sources"><header className="odl-card-head"><h2>Lead Sources</h2><span>Last 30 days</span></header>{sources.length ? sources.map(item => <div className="odl-source-row" key={item.source}><span>{item.source.slice(0, 1).toUpperCase()}</span><b>{item.source}</b><i><em style={{ width: `${(item.count / maxSource) * 100}%` }} /></i><strong>{item.count}</strong></div>) : <p className="odl-empty">No lead-source records in this period.</p>}</article>
          <article className="odl-card odl-revenue"><header className="odl-card-head"><div><h2>Scheduled Value</h2><p>Daily job value · last 30 days</p></div><span>Scheduled jobs</span></header><div className="odl-chart"><div>{(overview?.revenueTrend ?? []).map(point => <span key={point.date} title={`${point.date}: ${formatMoney(point.totalCents)}`} style={{ height: `${Math.max(3, (point.totalCents / trendMax) * 100)}%` }} />)}</div><footer><small>{overview?.revenueTrend[0]?.date ?? ""}</small><small>{overview?.revenueTrend.at(-1)?.date ?? ""}</small></footer></div></article>
          <article className="odl-card odl-services"><header className="odl-card-head"><h2>Jobs by Service</h2><span>{metrics?.jobsToday ?? "—"} today</span></header>{(overview?.serviceMix ?? []).length ? <div>{overview!.serviceMix.map((item, index) => <p key={item.label}><i className={`tone-${index % 5}`} />{item.label}<em><b style={{ width: `${(item.count / maxService) * 100}%` }} /></em><strong>{item.count}</strong></p>)}</div> : <p className="odl-empty">No service mix for this date.</p>}</article>
          <article className="odl-card odl-live-card"><div><small>Live workspace</small><h2>Keep the operation moving.</h2><p>Lead handling, field status, and schedule changes continue in their existing workspaces.</p><a href="/admin/command-chat">Open Command Chat <ArrowRight /></a></div><span><Clock3 /><MapPin /><Search /></span></article>
        </section>
      </>}
    </div>
  </main>;
}
