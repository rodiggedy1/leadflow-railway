import AdminPageGuard from "@/components/AdminPageGuard";
import MibSidebar from "@/components/MibSidebar";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  MessageCircle,
  Star,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useOpsChatWindow } from "@/hooks/useOpsChatWindow";
import {
  bookingMetricSummary,
  bookingsForMibDashboardDate,
  businessDateForMibDashboard,
  percentChange,
  shiftMibDashboardDate,
} from "@shared/mibDashboard";
import "./mib-home-preview.css";

const actionCards = [
  {
    image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/vPmUAKhVtzTzruHW.png",
    alt: "Warm living room with an upholstered chair",
    className: "teams",
    title: "Keep your teams set up for success.",
    description: "Manage schedules, track performance, and deliver amazing service.",
    action: "Manage teams",
  },
  {
    image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/KtPTcczUntFsdOzR.png",
    alt: "Cleaning supplies on a light counter",
    className: "growth",
    title: "Grow your business.",
    description: "Turn more leads into bookings with automated follow-ups.",
    action: "View leads",
  },
  {
    image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/QqBhMBjofpziFnzR.png",
    alt: "Hand holding the Maids in Black mobile app",
    className: "mobile",
    title: "Get the mobile app",
    description: "Give your teams everything they need on the go.",
    action: "Send download link",
  },
];

const presenceTones = ["owner", "violet", "coral", "gold", "green", "peach"] as const;

const initialsFor = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
const formatDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });
const formatShortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const formatCurrency = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const formatTime = (time: string | null) => {
  if (!time) return "Time pending";
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
};
const relativeTime = (value: Date | string | null) => {
  if (!value) return "Recently";
  const difference = Math.max(0, Date.now() - new Date(value).getTime());
  if (difference < 60_000) return "Just now";
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} min ago`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} hr ago`;
  return `${Math.floor(difference / 86_400_000)} days ago`;
};
const dayGreeting = (now = new Date()) => {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

function comparisonText(current: number, previous: number) {
  const change = percentChange(current, previous);
  if (change === null) return { value: "—", label: previous === 0 ? "no prior-day activity" : "same as prior day" };
  return { value: `${change > 0 ? "+" : ""}${change}%`, label: "vs. prior day" };
}

function PreviewMetric({
  icon: Icon,
  label,
  value,
  comparison,
  comparisonLabel,
  tone,
  series,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  comparison: string;
  comparisonLabel: string;
  tone: "coral" | "green" | "violet" | "gold";
  series: number[];
}) {
  const max = Math.max(...series, 1);
  return (
    <article className={`mib-preview-metric ${tone}`}>
      <span><Icon /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p><b>{comparison !== "—" ? `↗ ${comparison}` : comparison}</b><em>{comparisonLabel}</em></p>
      </div>
      <div className="mib-preview-metric__microchart" aria-hidden="true">
        {series.map((point, index) => <i key={index} style={{ height: `${Math.max((point / max) * 100, point > 0 ? 12 : 4)}%` }} />)}
      </div>
    </article>
  );
}

function ViewAll() {
  return <span>View all <ChevronRight /></span>;
}

export default function MibHomePreview() {
  const [selectedDate, setSelectedDate] = useState(businessDateForMibDashboard);
  const { open: openCommandChat } = useOpsChatWindow();
  const previousDate = useMemo(() => shiftMibDashboardDate(selectedDate, -1), [selectedDate]);
  const overviewStartDate = useMemo(() => shiftMibDashboardDate(selectedDate, -29), [selectedDate]);
  const bookingWindowInput = useMemo(() => ({ startDate: overviewStartDate, endDate: selectedDate }), [overviewStartDate, selectedDate]);
  const agentQuery = trpc.agents.me.useQuery(undefined, { staleTime: 30_000 });
  const agentStatusesQuery = trpc.agents.getStatuses.useQuery(undefined, { staleTime: 30_000, refetchInterval: 60_000 });
  const bookingWindowQuery = trpc.mibDashboard.getBookingWindow.useQuery(bookingWindowInput, { staleTime: 10_000, refetchInterval: 30_000 });
  const activityQuery = trpc.mibDashboard.getRecentActivity.useQuery({ limit: 5 }, { staleTime: 30_000, refetchInterval: 60_000 });
  const allBookingRows = bookingWindowQuery.data?.bookings ?? [];
  const selectedRows = useMemo(() => bookingsForMibDashboardDate(allBookingRows, selectedDate), [allBookingRows, selectedDate]);
  const previousRows = useMemo(() => bookingsForMibDashboardDate(allBookingRows, previousDate), [allBookingRows, previousDate]);
  const selectedMetrics = useMemo(() => bookingMetricSummary(selectedRows), [selectedRows]);
  const previousMetrics = useMemo(() => bookingMetricSummary(previousRows), [previousRows]);
  const overviewDates = useMemo(() => Array.from({ length: 30 }, (_, index) => shiftMibDashboardDate(overviewStartDate, index)), [overviewStartDate]);
  const dailyMetrics = useMemo(() => overviewDates.map((date) => ({ date, metrics: bookingMetricSummary(bookingsForMibDashboardDate(allBookingRows, date)) })), [allBookingRows, overviewDates]);
  const overviewMetrics = useMemo(() => bookingMetricSummary(allBookingRows), [allBookingRows]);
  const chartMax = Math.max(...dailyMetrics.map(({ metrics }) => metrics.totalBookings), 1);
  const serviceBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    allBookingRows.forEach((row) => {
      const name = row.serviceName?.trim() || "Service not specified";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const topServices = entries.slice(0, 4).map(([name, count]) => ({ name, count }));
    const remaining = entries.slice(4).reduce((sum, [, count]) => sum + count, 0);
    if (remaining > 0) topServices.push({ name: "Other services", count: remaining });
    return topServices.map((service, index) => ({ ...service, percentage: overviewMetrics.totalBookings ? Math.round((service.count / overviewMetrics.totalBookings) * 100) : 0, tone: (["coral", "peach", "green", "violet", "gray"] as const)[index] ?? "gray" }));
  }, [allBookingRows, overviewMetrics.totalBookings]);
  const serviceColors = { coral: "#f46747", peach: "#f8a98f", green: "#3db38b", violet: "#9b84e8", gray: "#c9c7c2" } as const;
  const donutStyle = useMemo(() => {
    if (!serviceBreakdown.length) return { background: "#ebe9e4" };
    let from = 0;
    const segments = serviceBreakdown.map((service) => {
      const to = from + service.percentage;
      const segment = `${serviceColors[service.tone]} ${from}% ${to}%`;
      from = to;
      return segment;
    });
    if (from < 100) segments.push(`#ebe9e4 ${from}% 100%`);
    return { background: `conic-gradient(${segments.join(", ")})` };
  }, [serviceBreakdown]);
  const scheduleRowsForSelectedDate = useMemo(() => [...selectedRows].sort((a, b) => (a.requestedLocalTime ?? "99:99").localeCompare(b.requestedLocalTime ?? "99:99")).slice(0, 5), [selectedRows]);
  const bookingComparison = comparisonText(selectedMetrics.totalBookings, previousMetrics.totalBookings);
  const revenueComparison = comparisonText(selectedMetrics.revenueCents, previousMetrics.revenueCents);
  const assignedComparison = comparisonText(selectedMetrics.assignedBookings, previousMetrics.assignedBookings);
  const cardsComparison = comparisonText(selectedMetrics.cardsOnFile, previousMetrics.cardsOnFile);
  const dataLoading = bookingWindowQuery.isLoading;
  const dataError = bookingWindowQuery.error;
  const agentStatuses = agentStatusesQuery.data ?? [];
  const availableAgents = agentStatuses.filter((agent) => !agent.awayStatus).length;
  const displayedAgents = agentStatuses.slice(0, 6);
  const currentAgent = agentQuery.data;
  const pulseItems = [
    { icon: CalendarDays, title: "Selected-day bookings", detail: `${selectedMetrics.totalBookings} booking${selectedMetrics.totalBookings === 1 ? "" : "s"} on ${formatDate(selectedDate)}`, tone: "coral" },
    { icon: Users, title: "Assignment coverage", detail: `${selectedMetrics.assignedBookings} of ${selectedMetrics.totalBookings} bookings assigned`, tone: "violet" },
    { icon: CircleDollarSign, title: "Booking revenue", detail: `${formatCurrency(selectedMetrics.revenueCents)} in first-cleaning totals`, tone: "green" },
    { icon: Bell, title: "Payment readiness", detail: `${selectedMetrics.cardsOnFile} of ${selectedMetrics.totalBookings} cards on file`, tone: "gold" },
  ] as const;
  const greetingName = currentAgent?.name?.split(" ")[0];

  return (
    <AdminPageGuard pageId="command-center">
      <main className="mib-home-preview" aria-label="MIB operations dashboard">
        <MibSidebar activeItem="Dashboard" />

        <section className="mib-home-preview__workspace">
          <header className="mib-command-header mib-command-header--dark-variant" aria-label="Command header">
            <div className="mib-command-header__identity"><span><MessageCircle /></span><div><strong>Command</strong><small><i />{agentStatusesQuery.isLoading ? "Checking availability" : `${availableAgents} available`}</small></div></div>
            <div className="mib-command-header__presence" aria-label="Command team availability">
              {displayedAgents.map((agent, index) => <button type="button" key={agent.id} onClick={openCommandChat} className={`mib-command-header__member ${presenceTones[index % presenceTones.length]}`} aria-label={`Open Command Chat with ${agent.name}`}><b>{agent.profilePhotoUrl ? <img src={agent.profilePhotoUrl} alt={agent.name} /> : initialsFor(agent.name)}</b><small>{agent.id === currentAgent?.id ? "You" : agent.name.split(" ")[0]}</small>{agent.id === currentAgent?.id && <i />}</button>)}
              {agentStatuses.length > displayedAgents.length && <span className="mib-command-header__more">+{agentStatuses.length - displayedAgents.length}</span>}
            </div>
            <label className="mib-command-header__compose"><input aria-label="Open Command Chat" readOnly value="Message the team…" onClick={openCommandChat} /><button type="button" onClick={openCommandChat} aria-label="Open Command Chat"><ChevronRight /></button></label>
            <div className="mib-command-header__actions"><button type="button" disabled aria-label="Notifications are not connected on this dashboard"><Bell /></button><button type="button" disabled aria-label="Current signed-in agent"><span>{currentAgent ? initialsFor(currentAgent.name) : "—"}</span><b>{currentAgent?.name ?? "Loading agent"}<small>{currentAgent?.isAdmin ? "Admin" : "Agent"}</small></b><ChevronDown /></button></div>
          </header>

          <section className="mib-home-preview__heading">
            <div><p>OPERATIONS</p><h1>{greetingName ? `${dayGreeting()}, ${greetingName}.` : "Operations dashboard"}</h1><span>{formatDate(selectedDate)} · Live booking operations for Maids in Black.</span></div>
            <div className="mib-home-preview__range" aria-label="Dashboard date controls"><label className="mib-home-preview__range-date"><span>{formatDate(selectedDate)} <ChevronDown /></span><input aria-label="Select dashboard date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label><span><button type="button" onClick={() => setSelectedDate(shiftMibDashboardDate(selectedDate, -1))} aria-label="Previous day"><ChevronLeft /></button><button type="button" onClick={() => setSelectedDate(shiftMibDashboardDate(selectedDate, 1))} aria-label="Next day"><ChevronRight /></button></span></div>
          </section>

          <section className="mib-preview-pulse" aria-label="Operations Pulse">
            <div className="mib-preview-pulse__title"><span><i />LIVE</span><strong>Operations Pulse</strong></div>
            {dataLoading ? <article className="coral"><span><CalendarDays /></span><div><strong>Loading booking operations</strong><p>Retrieving the selected day’s live booking data.</p></div></article> : dataError ? <article className="gold"><span><Bell /></span><div><strong>Booking data unavailable</strong><p>{dataError.message}</p></div></article> : pulseItems.map(({ icon: Icon, title, detail, tone }) => <article key={title} className={tone}><span><Icon /></span><div><strong>{title}</strong><p>{detail}</p><small>Selected day</small></div></article>)}
            <div className="mib-preview-pulse__actions"><button type="button" onClick={() => setSelectedDate(shiftMibDashboardDate(selectedDate, -1))} aria-label="Previous day"><ChevronLeft /></button><button type="button" onClick={() => setSelectedDate(shiftMibDashboardDate(selectedDate, 1))} aria-label="Next day"><ChevronRight /></button><button type="button" onClick={openCommandChat}>Open Command <ChevronRight /></button></div>
          </section>

          <section className="mib-home-preview__metrics" aria-label="Live booking metrics">
            {dataLoading ? <div className="mib-preview-metric coral"><span><CalendarDays /></span><div><small>Live booking metrics</small><strong>—</strong><p><em>Loading selected-day data</em></p></div></div> : dataError ? <div className="mib-preview-metric gold"><span><Bell /></span><div><small>Live booking metrics</small><strong>—</strong><p><em>Data could not be loaded</em></p></div></div> : <>
              <PreviewMetric icon={CalendarDays} label="Total Bookings" value={String(selectedMetrics.totalBookings)} comparison={bookingComparison.value} comparisonLabel={bookingComparison.label} tone="coral" series={[previousMetrics.totalBookings, selectedMetrics.totalBookings]} />
              <PreviewMetric icon={CircleDollarSign} label="Revenue" value={formatCurrency(selectedMetrics.revenueCents)} comparison={revenueComparison.value} comparisonLabel={revenueComparison.label} tone="green" series={[previousMetrics.revenueCents, selectedMetrics.revenueCents]} />
              <PreviewMetric icon={Users} label="Teams Assigned" value={`${selectedMetrics.assignedBookings}/${selectedMetrics.totalBookings}`} comparison={assignedComparison.value} comparisonLabel={assignedComparison.label} tone="violet" series={[previousMetrics.assignedBookings, selectedMetrics.assignedBookings]} />
              <PreviewMetric icon={Star} label="Cards on File" value={`${selectedMetrics.cardsOnFile}/${selectedMetrics.totalBookings}`} comparison={cardsComparison.value} comparisonLabel={cardsComparison.label} tone="gold" series={[previousMetrics.cardsOnFile, selectedMetrics.cardsOnFile]} />
            </>}
          </section>

          <section className="mib-home-preview__overview">
            <article className="mib-preview-panel mib-preview-chart">
              <header><div><h2>Bookings overview</h2><p><strong>{dataLoading || dataError ? "—" : overviewMetrics.totalBookings}</strong><span>{dataLoading ? "Loading booking volume" : dataError ? "Booking data unavailable" : "Total bookings"}</span></p></div><div className="mib-preview-chart__tabs"><b>Bookings</b><span>{formatShortDate(overviewStartDate)}–{formatShortDate(selectedDate)}</span><button type="button" disabled>Last 30 days <ChevronDown /></button></div></header>
              <div className="mib-preview-bars" aria-label="Bookings per day for the selected 30-day window">{dataLoading ? Array.from({ length: 30 }, (_, index) => <i key={index} className="mib-data-loading" />) : dataError ? <p className="mib-panel-empty">Booking volume could not be loaded.</p> : dailyMetrics.map(({ date, metrics }) => <i key={date} title={`${formatShortDate(date)}: ${metrics.totalBookings} booking${metrics.totalBookings === 1 ? "" : "s"}`} style={{ height: `${Math.max((metrics.totalBookings / chartMax) * 100, metrics.totalBookings > 0 ? 10 : 3)}%` }} />)}</div>
            </article>
            <article className="mib-preview-panel mib-preview-service"><header><h2>Bookings by service</h2><ViewAll /></header><div><div className="mib-preview-donut" style={donutStyle}><strong>{dataLoading || dataError ? "—" : overviewMetrics.totalBookings}</strong><small>Bookings</small></div><ul>{dataLoading ? <li className="mib-panel-empty">Loading service mix.</li> : dataError ? <li className="mib-panel-empty">Service mix unavailable.</li> : serviceBreakdown.length ? serviceBreakdown.map((service) => <li key={service.name}><i className={service.tone} />{service.name} <b>{service.percentage}%</b></li>) : <li className="mib-panel-empty">No booking services in this window.</li>}</ul></div></article>
          </section>

          <section className="mib-home-preview__operating-grid">
            <article className="mib-preview-panel"><header><h2>{selectedDate === businessDateForMibDashboard() ? "Today’s schedule" : `Schedule · ${formatShortDate(selectedDate)}`}</h2><ViewAll /></header><ul className="mib-preview-list">{dataLoading ? <li className="mib-panel-empty">Loading schedule.</li> : dataError ? <li className="mib-panel-empty">Schedule unavailable.</li> : scheduleRowsForSelectedDate.length ? scheduleRowsForSelectedDate.map((row) => <li key={row.key}><strong>{formatTime(row.requestedLocalTime)}</strong><i className={row.assignmentStatus === "assigned" ? "live" : ""} /><span>{row.customerName}<small>{row.serviceName ?? "Service pending"}</small></span><em>{row.assignmentStatus === "assigned" ? "Assigned" : "Unassigned"}</em><ChevronRight /></li>) : <li className="mib-panel-empty">No bookings scheduled.</li>}</ul></article>
            <article className="mib-preview-panel"><header><h2>Active teams</h2><ViewAll /></header><ul className="mib-preview-list mib-preview-list--teams"><li className="mib-panel-empty"><b>—</b><span>Team status unavailable<small>The unified booking feed does not provide active team roster data.</small></span></li></ul></article>
            <article className="mib-preview-panel"><header><h2>Recent activity</h2><ViewAll /></header><ul className="mib-preview-list mib-preview-list--activity">{activityQuery.isLoading ? <li className="mib-panel-empty">Loading activity.</li> : activityQuery.error ? <li className="mib-panel-empty">Activity unavailable.</li> : activityQuery.data?.items.length ? activityQuery.data.items.map((item) => <li key={item.id}><b><ClipboardList /></b><span>{item.title}<small>{item.body || item.eventType}</small></span><em>{relativeTime(item.createdAt)}</em></li>) : <li className="mib-panel-empty">No recent activity.</li>}</ul></article>
          </section>

          <section className="mib-home-preview__promos">
            {actionCards.map(card => <article key={card.title} className={card.className}><img src={card.image} alt={card.alt} /><div><h2>{card.title}</h2><p>{card.description}</p><button type="button" disabled>{card.action} <ChevronRight /></button></div></article>)}
          </section>
        </section>
      </main>
    </AdminPageGuard>
  );
}
