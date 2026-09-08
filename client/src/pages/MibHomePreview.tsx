import AdminPageGuard from "@/components/AdminPageGuard";
import MibSidebar from "@/components/MibSidebar";
import { useOpsChatWindow } from "@/hooks/useOpsChatWindow";
import { trpc } from "@/lib/trpc";
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
import { useEffect, useMemo, useState } from "react";
import {
  bookingMetricSummary,
  bookingsForMibDashboardDate,
  businessDateForMibDashboard,
  type MibDashboardAggregate,
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
const serviceTones = ["coral", "peach", "green", "violet", "gray"] as const;
const serviceColors = { coral: "#f66242", peach: "#ffc3b5", green: "#53c7a4", violet: "#9e83f5", gray: "#a4a8b2" } as const;

function initialsFor(name: string | null | undefined) {
  return (name ?? "").split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "—";
}

function formatCurrency(cents: number) {
  return cents ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100) : "$0";
}

function formatDollars(dollars: number) {
  return dollars ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(dollars) : "$0";
}

function formatTime(value: string | null) {
  if (!value) return "Time pending";
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

function dayGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function comparison(current: number, previous: number, label: string) {
  const change = percentChange(current, previous);
  return { value: change === null ? "—" : `${change >= 0 ? "+" : ""}${change}%`, label };
}

function aggregateSummary(rows: MibDashboardAggregate[]) {
  return rows.reduce((summary, row) => ({
    totalBookings: summary.totalBookings + row.totalBookings,
    revenueCents: summary.revenueCents + row.revenueCents,
    assignedBookings: summary.assignedBookings + row.assignedBookings,
    cardsOnFile: summary.cardsOnFile + row.cardsOnFile,
  }), { totalBookings: 0, revenueCents: 0, assignedBookings: 0, cardsOnFile: 0 });
}

function slotSeries(values: number[]) {
  const normalized = values.length ? values : [0];
  const maximum = Math.max(...normalized, 1);
  return Array.from({ length: 14 }, (_, index) => {
    const value = normalized[Math.floor((index * normalized.length) / 14)] ?? 0;
    return value ? Math.max(18, Math.round((value / maximum) * 100)) : 12;
  });
}

function chartSlots(values: number[]) {
  return Array.from({ length: 24 }, (_, index) => {
    const from = Math.floor((index * values.length) / 24);
    const to = Math.floor(((index + 1) * values.length) / 24);
    return values.slice(from, Math.max(to, from + 1)).reduce((sum, value) => sum + value, 0);
  });
}

function relativeTime(value: Date | string | null) {
  if (!value) return "—";
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hour${elapsed >= 7_200_000 ? "s" : ""} ago`;
  return `${Math.floor(elapsed / 86_400_000)} days ago`;
}

function presenceForHeader(agent: { awayStatus: string | null; lastSeenAt: Date | string | null }) {
  if (agent.awayStatus) return "away" as const;
  if (!agent.lastSeenAt) return "offline" as const;
  const minutesSinceSeen = Math.floor((Date.now() - new Date(agent.lastSeenAt).getTime()) / 60_000);
  if (minutesSinceSeen <= 2) return "online" as const;
  if (minutesSinceSeen <= 15) return "away" as const;
  return "offline" as const;
}

function PreviewMetric({ icon: Icon, label, value, comparisonValue, comparisonLabel, tone, series }: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  comparisonValue: string;
  comparisonLabel: string;
  tone: "coral" | "green" | "violet" | "gold";
  series: number[];
}) {
  return (
    <article className={`mib-preview-metric ${tone}`}>
      <span><Icon /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p><b>↗ {comparisonValue}</b><em>{comparisonLabel}</em></p>
      </div>
      <div className="mib-preview-metric__microchart" aria-hidden="true">
        {slotSeries(series).map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
      </div>
    </article>
  );
}

function ViewAll() {
  return <span>View all <ChevronRight /></span>;
}

export default function MibHomePreview() {
  const { open: openCommandChat } = useOpsChatWindow();
  const [todayDateStr, setTodayDateStr] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      setTodayDateStr((currentDate) => currentDate === nextDate ? currentDate : nextDate);
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);
  const today = useMemo(() => businessDateForMibDashboard(), []);
  const currentWindowStart = useMemo(() => shiftMibDashboardDate(today, -29), [today]);
  const previousWindowStart = useMemo(() => shiftMibDashboardDate(today, -59), [today]);
  const bookingWindowInput = useMemo(() => ({ startDate: previousWindowStart, endDate: today }), [previousWindowStart, today]);
  const publicMetricsInput = useMemo(() => ({ ...bookingWindowInput, serviceStartDate: currentWindowStart }), [bookingWindowInput, currentWindowStart]);
  const bookingQuery = trpc.mibDashboard.getBookingWindow.useQuery(bookingWindowInput, { staleTime: 10_000, refetchInterval: 30_000 });
  const publicMetricsQuery = trpc.mibDashboard.getPublicBookingMetrics.useQuery(publicMetricsInput, { staleTime: 10_000, refetchInterval: 30_000 });
  const metricsOverviewQuery = trpc.metrics.getOverview.useQuery({ range: "30d" }, { staleTime: 5 * 60_000, refetchInterval: 60_000 });
  const performanceStatsQuery = trpc.performance.stats.useQuery({ days: 30 }, { staleTime: 2 * 60_000, refetchInterval: 60_000 });
  const activityQuery = trpc.mibDashboard.getRecentActivity.useQuery({ limit: 5 }, { staleTime: 30_000, refetchInterval: 60_000 });
  const currentAgentQuery = trpc.agents.me.useQuery(undefined, { staleTime: 30_000 });
  const agentStatusesQuery = trpc.agents.getStatuses.useQuery(undefined, { staleTime: 30_000, refetchInterval: 60_000 });
  const commandBookingStatsQuery = trpc.leads.stats.useQuery({ dateFrom: todayDateStr, dateTo: todayDateStr }, { refetchInterval: 60_000 });
  const isLoading = publicMetricsQuery.isLoading;
  const isUnavailable = Boolean(publicMetricsQuery.error);
  const allRows = bookingQuery.data?.bookings ?? [];
  const dailyMetrics = publicMetricsQuery.data?.days ?? [];
  const metricsKpis = metricsOverviewQuery.data?.kpis;
  const metricsMonthly = metricsOverviewQuery.data?.monthly ?? [];
  const fiveStarJobs = metricsOverviewQuery.data?.quality.find((item) => item.label === "5-star jobs")?.value ?? 0;
  const performanceSummary = useMemo(() => (performanceStatsQuery.data ?? []).reduce((summary, row) => ({
    bookings: summary.bookings + row.bookings,
    bookedRevenue: summary.bookedRevenue + row.bookedRevenue,
  }), { bookings: 0, bookedRevenue: 0 }), [performanceStatsQuery.data]);
  const metricsLoading = metricsOverviewQuery.isLoading || performanceStatsQuery.isLoading;
  const metricsUnavailable = Boolean(metricsOverviewQuery.error || performanceStatsQuery.error);
  const currentWindowRows = useMemo(() => allRows.filter((row) => row.requestedLocalDate && row.requestedLocalDate >= currentWindowStart), [allRows, currentWindowStart]);
  const previousWindowRows = useMemo(() => allRows.filter((row) => row.requestedLocalDate && row.requestedLocalDate < currentWindowStart), [allRows, currentWindowStart]);
  const todayRows = useMemo(() => bookingsForMibDashboardDate(allRows, today), [allRows, today]);
  const yesterdayRows = useMemo(() => bookingsForMibDashboardDate(allRows, shiftMibDashboardDate(today, -1)), [allRows, today]);
  const todayMetrics = useMemo(() => dailyMetrics.find((row) => row.date === today) ?? aggregateSummary([]), [dailyMetrics, today]);
  const yesterdayMetrics = useMemo(() => dailyMetrics.find((row) => row.date === shiftMibDashboardDate(today, -1)) ?? aggregateSummary([]), [dailyMetrics, today]);
  const currentMetrics = useMemo(() => aggregateSummary(dailyMetrics.filter((row) => row.date >= currentWindowStart)), [currentWindowStart, dailyMetrics]);
  const previousMetrics = useMemo(() => aggregateSummary(dailyMetrics.filter((row) => row.date < currentWindowStart)), [currentWindowStart, dailyMetrics]);
  const dailyBookings = useMemo(() => dailyMetrics.filter((row) => row.date >= currentWindowStart).map((row) => row.totalBookings), [currentWindowStart, dailyMetrics]);
  const overviewBars = chartSlots(dailyBookings);
  const overviewMaximum = Math.max(...overviewBars, 1);
  const metricsOverviewBars = chartSlots(metricsMonthly.map((item) => item.booked));
  const metricsOverviewMaximum = Math.max(...metricsOverviewBars, 1);
  const serviceTotal = useMemo(() => (metricsOverviewQuery.data?.serviceTypeBreakdown ?? []).reduce((total, service) => total + service.value, 0), [metricsOverviewQuery.data?.serviceTypeBreakdown]);
  const serviceSlots = useMemo(() => {
    if (metricsLoading || metricsUnavailable) return Array.from({ length: 5 }, (_, index) => ({ name: index === 0 ? metricsLoading ? "Loading" : "Unavailable" : "", share: "—", tone: serviceTones[index] }));
    const entries = metricsOverviewQuery.data?.serviceTypeBreakdown.map((service) => [service.name, service.value] as const) ?? [];
    const primary = entries.slice(0, 4);
    const remaining = entries.slice(4).reduce((sum, [, count]) => sum + count, 0);
    if (remaining) primary.push(["Other", remaining]);
    return Array.from({ length: 5 }, (_, index) => {
      const row = primary[index];
      return { name: row?.[0] ?? "", share: row && serviceTotal ? `${Math.round((row[1] / serviceTotal) * 100)}%` : "—", tone: serviceTones[index] };
    });
  }, [metricsLoading, metricsUnavailable, metricsOverviewQuery.data?.serviceTypeBreakdown, serviceTotal]);
  const donutStyle = useMemo(() => {
    if (metricsLoading || metricsUnavailable || !serviceTotal) return { background: "#eeeae4" };
    let cursor = 0;
    const segments = serviceSlots.filter((slot) => slot.share !== "—").map((slot) => {
      const next = cursor + Number.parseInt(slot.share, 10);
      const part = `${serviceColors[slot.tone]} ${cursor}% ${next}%`;
      cursor = next;
      return part;
    });
    if (cursor < 100) segments.push(`#eeeae4 ${cursor}% 100%`);
    return { background: `conic-gradient(${segments.join(", ")})` };
  }, [metricsLoading, metricsUnavailable, serviceSlots, serviceTotal]);
  const scheduleSlots = useMemo(() => {
    const rows = [...todayRows].sort((a, b) => (a.requestedLocalTime ?? "99:99").localeCompare(b.requestedLocalTime ?? "99:99")).slice(0, 4);
    return Array.from({ length: 4 }, (_, index) => rows[index] ?? null);
  }, [todayRows]);
  const assignedBookingSlots = useMemo(() => Array.from({ length: 4 }, (_, index) => todayRows.filter((row) => row.assignmentStatus === "assigned")[index] ?? null), [todayRows]);
  const displayedAgents = agentStatusesQuery.data?.slice(0, 7) ?? [];
  const onlineAgents = (agentStatusesQuery.data ?? []).filter((agent) => presenceForHeader(agent) === "online");
  const agentSlots = Array.from({ length: 7 }, (_, index) => displayedAgents[index] ?? null);
  const activitySlots = Array.from({ length: 5 }, (_, index) => activityQuery.data?.items[index] ?? null);
  const bookingsComparison = comparison(todayMetrics.totalBookings, yesterdayMetrics.totalBookings, "vs. yesterday");
  const revenueComparison = comparison(todayMetrics.revenueCents, yesterdayMetrics.revenueCents, "vs. yesterday");
  const headlineComparison = comparison(currentMetrics.totalBookings, previousMetrics.totalBookings, "vs. previous 30 days");
  const greetingName = currentAgentQuery.data?.name?.split(" ")[0];
  const metricUnavailable = isLoading ? "Loading" : isUnavailable ? "—" : null;
  const newBookingDetail = commandBookingStatsQuery.isLoading ? "Loading new bookings" : commandBookingStatsQuery.error ? "New booking data unavailable" : `${commandBookingStatsQuery.data?.bookedCount ?? 0} booking${commandBookingStatsQuery.data?.bookedCount === 1 ? "" : "s"} today`;
  const newRevenueDetail = commandBookingStatsQuery.isLoading ? "Loading new revenue" : commandBookingStatsQuery.error ? "New revenue data unavailable" : `${formatCurrency((commandBookingStatsQuery.data?.bookedRevenue ?? 0) * 100)} booked today`;
  const cardsNotOnFile = Math.max(todayMetrics.totalBookings - todayMetrics.cardsOnFile, 0);

  return (
    <AdminPageGuard pageId="command-center">
      <main className="mib-home-preview" aria-label="MIB operations dashboard">
        <MibSidebar activeItem="Dashboard" />
        <section className="mib-home-preview__workspace">
          <header className="mib-command-header mib-command-header--dark-variant" aria-label="Command header">
            <div className="mib-command-header__identity"><span><MessageCircle /></span><div><strong>Command</strong><small><i />{agentStatusesQuery.isLoading ? "Checking availability" : `${onlineAgents.length} online`}</small></div></div>
            <div className="mib-command-header__presence" aria-label="Command team availability">
              {agentSlots.map((agent, index) => <div key={agent?.id ?? `agent-slot-${index}`} className={`mib-command-header__member ${presenceTones[index % presenceTones.length]} ${agent ? `is-${presenceForHeader(agent)}` : ""}`}><b>{agent?.profilePhotoUrl ? <img src={agent.profilePhotoUrl} alt={agent.name} /> : initialsFor(agent?.name)}</b><small>{agent ? agent.name.split(" ")[0] : agentStatusesQuery.isLoading && index === 0 ? "Loading" : ""}</small>{agent && <i />}</div>)}
              <span className="mib-command-header__more">+{Math.max((agentStatusesQuery.data?.length ?? 0) - 7, 0)}</span>
            </div>
            <button type="button" className="mib-command-header__compose" onClick={openCommandChat} aria-label="Open Command Chat"><span>Message the team…</span><i><ChevronRight /></i></button>
            <div className="mib-command-header__actions"><button type="button" disabled aria-label="Notifications"><Bell /><i /></button><button type="button" disabled aria-label="Current signed-in agent"><span>{initialsFor(currentAgentQuery.data?.name)}</span><b>{currentAgentQuery.data?.name ?? "Loading agent"}<small>{currentAgentQuery.data?.isAdmin ? "Admin" : "Agent"}</small></b><ChevronDown /></button></div>
          </header>

          <section className="mib-home-preview__heading">
            <div><p>OPERATIONS</p><h1>{greetingName ? `${dayGreeting()}, ${greetingName}.` : "Operations dashboard"}</h1><span>Here’s what’s happening with Maids in Black today.</span></div>
            <div className="mib-home-preview__range" aria-label="Dashboard period"><button type="button" disabled>Last 30 days <ChevronDown /></button><span><button type="button" disabled aria-label="Previous range"><ChevronLeft /></button><button type="button" disabled aria-label="Next range"><ChevronRight /></button></span></div>
          </section>

          <section className="mib-preview-pulse" aria-label="Operations Pulse">
            <div className="mib-preview-pulse__title"><span><i />LIVE</span><strong>Operations Pulse</strong></div>
            {[{ icon: CalendarDays, title: "New booking", detail: newBookingDetail, tone: "coral" }, { icon: CircleDollarSign, title: "New Revenue", detail: newRevenueDetail, tone: "violet" }, { icon: Users, title: "Team update", detail: isLoading || isUnavailable ? "—" : `${todayMetrics.assignedBookings} bookings assigned`, tone: "gold" }, { icon: ClipboardList, title: "Command", detail: isLoading || isUnavailable ? "—" : `${cardsNotOnFile} cards not on file`, tone: "green" }].map(({ icon: Icon, title, detail, tone }) => <article key={title} className={tone}><span><Icon /></span><div><strong>{title}</strong><p>{detail}</p><small>Live</small></div></article>)}
            <div className="mib-preview-pulse__actions"><button type="button" disabled aria-label="Previous pulse item"><ChevronLeft /></button><button type="button" disabled aria-label="Next pulse item"><ChevronRight /></button><button type="button" disabled>View all <ChevronRight /></button></div>
          </section>

          <section className="mib-home-preview__metrics" aria-label="Live booking metrics">
            <PreviewMetric icon={CalendarDays} label="Total Bookings" value={metricsLoading ? "—" : metricsUnavailable ? "—" : String(performanceSummary.bookings)} comparisonValue="—" comparisonLabel={metricsLoading ? "Loading" : metricsUnavailable ? "Unavailable" : "Last 30 days"} tone="coral" series={metricsLoading || metricsUnavailable ? [] : metricsMonthly.map((item) => item.booked)} />
            <PreviewMetric icon={CircleDollarSign} label="Revenue" value={metricsLoading ? "—" : metricsUnavailable ? "—" : formatDollars(performanceSummary.bookedRevenue)} comparisonValue="—" comparisonLabel={metricsLoading ? "Loading" : metricsUnavailable ? "Unavailable" : "Last 30 days"} tone="green" series={metricsLoading || metricsUnavailable ? [] : metricsMonthly.map((item) => item.revenue * 100)} />
            <PreviewMetric icon={Users} label="Lead Volume" value={metricsLoading ? "—" : metricsUnavailable ? "—" : String(metricsKpis?.totalLeads ?? 0)} comparisonValue="—" comparisonLabel={metricsLoading ? "Loading" : metricsUnavailable ? "Unavailable" : "Last 30 days"} tone="violet" series={metricsLoading || metricsUnavailable ? [] : metricsMonthly.map((item) => item.leads)} />
            <PreviewMetric icon={Star} label="5-Star Jobs" value={metricsLoading ? "—" : metricsUnavailable ? "—" : `${fiveStarJobs}%`} comparisonValue="—" comparisonLabel={metricsLoading ? "Loading" : metricsUnavailable ? "Unavailable" : "Last 30 days"} tone="gold" series={metricsLoading || metricsUnavailable ? [] : metricsMonthly.map((item) => item.jobs)} />
          </section>

          <section className="mib-home-preview__overview">
            <article className="mib-preview-panel mib-preview-chart">
              <header><div><h2>Bookings overview</h2><p><strong>{metricsLoading || metricsUnavailable ? "—" : performanceSummary.bookings}</strong><b>↗ —</b><span>{metricsLoading ? "Loading" : metricsUnavailable ? "Unavailable" : "Total bookings"}</span></p></div><div className="mib-preview-chart__tabs"><b>Bookings</b><span>Revenue</span><span>Customers</span><button type="button" disabled>Last 30 days <ChevronDown /></button></div></header>
              <div className="mib-preview-bars" aria-label="Bookings overview">{metricsOverviewBars.map((count, index) => <i key={index} style={{ height: `${metricsLoading || metricsUnavailable ? 38 : count ? Math.max(16, (count / metricsOverviewMaximum) * 100) : 7}%`, opacity: metricsLoading || metricsUnavailable ? 0.22 : undefined }} />)}</div>
            </article>
            <article className="mib-preview-panel mib-preview-service"><header><h2>Bookings by service</h2><ViewAll /></header><div><div className="mib-preview-donut" style={donutStyle}><strong>{metricsLoading || metricsUnavailable ? "—" : serviceTotal}</strong><small>Bookings</small></div><ul>{serviceSlots.map((slot, index) => <li key={`${slot.name}-${index}`}><i className={slot.tone} />{slot.name}<b>{slot.share}</b></li>)}</ul></div></article>
          </section>

          <section className="mib-home-preview__operating-grid">
            <article className="mib-preview-panel"><header><h2>Today’s schedule</h2><ViewAll /></header><ul className="mib-preview-list">{scheduleSlots.map((row, index) => <li key={row?.key ?? `schedule-slot-${index}`}><strong>{row ? formatTime(row.requestedLocalTime) : "—"}</strong><i className={row?.assignmentStatus === "assigned" ? "live" : ""} /><span>{row ? row.customerName : index === 0 ? isLoading ? "Loading schedule" : isUnavailable ? "Schedule unavailable" : "No bookings scheduled" : ""}<small>{row?.serviceName ?? ""}</small></span><em>{row ? row.assignmentStatus === "assigned" ? "Assigned" : "Unassigned" : ""}</em><ChevronRight /></li>)}</ul></article>
            <article className="mib-preview-panel"><header><h2>Active teams</h2><ViewAll /></header><ul className="mib-preview-list mib-preview-list--teams">{assignedBookingSlots.map((row, index) => <li key={row?.key ?? `team-slot-${index}`}><b>{row ? index + 1 : "—"}</b><span>{row ? row.customerName : index === 0 ? bookingQuery.isLoading ? "Loading assigned bookings" : bookingQuery.error ? "Assigned bookings unavailable" : "No bookings assigned" : ""}<small>{row ? `${row.serviceName ?? "Service"} · Assigned` : ""}</small></span><i style={{ width: row ? "100%" : "0%" }} /><ChevronRight /></li>)}</ul></article>
            <article className="mib-preview-panel"><header><h2>Recent activity</h2><ViewAll /></header><ul className="mib-preview-list mib-preview-list--activity">{activitySlots.map((item, index) => <li key={item?.id ?? `activity-slot-${index}`}><b><ClipboardList /></b><span>{item ? item.title : index === 0 ? activityQuery.isLoading ? "Loading activity" : activityQuery.error ? "Activity unavailable" : "No recent activity" : ""}<small>{item?.body || item?.eventType || ""}</small></span><em>{item ? relativeTime(item.createdAt) : ""}</em></li>)}</ul></article>
          </section>

          <section className="mib-home-preview__promos">
            {actionCards.map(card => <article key={card.title} className={card.className}><img src={card.image} alt={card.alt} /><div><h2>{card.title}</h2><p>{card.description}</p><button type="button" disabled>{card.action} <ChevronRight /></button></div></article>)}
          </section>
        </section>
      </main>
    </AdminPageGuard>
  );
}
