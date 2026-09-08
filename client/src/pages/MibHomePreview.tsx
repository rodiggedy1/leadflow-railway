import AdminPageGuard from "@/components/AdminPageGuard";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Headphones,
  LayoutDashboard,
  LineChart,
  Megaphone,
  MessageCircle,
  Search,
  Settings,
  Smartphone,
  Star,
  Users,
  UserRound,
  WalletCards,
} from "lucide-react";
import "./mib-home-preview.css";

const sidebarItems = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Bookings", icon: CalendarDays },
  { label: "Customers", icon: UserRound },
  { label: "Teams", icon: Users },
  { label: "Schedule", icon: CalendarDays },
  { label: "Leads", icon: Megaphone },
  { label: "Messages", icon: MessageCircle },
  { label: "Payments", icon: WalletCards },
  { label: "Reviews", icon: Star },
  { label: "Marketing", icon: Megaphone },
  { label: "Reports", icon: LineChart },
  { label: "Settings", icon: Settings },
];

const scheduleRows = [
  ["8:30 AM", "Audrey Schaffer", "Standard Cleaning · 232 9th St SE", "In progress"],
  ["10:30 AM", "Marshall Moore", "Deep Cleaning · 1803 19th St NW", "Upcoming"],
  ["2:30 PM", "Ava Ford", "Move-out Cleaning · 1110 23rd St NW", "Upcoming"],
  ["4:00 PM", "Tina Lopez", "Standard Cleaning · 1600 Pennsylvania Ave NW", "Upcoming"],
];

const teamRows = [
  ["TM", "Team Madison", "4/5 on shift", "64%"],
  ["JS", "Team Jamal", "3/4 on shift", "59%"],
  ["MW", "Team Marcus", "5/6 on shift", "76%"],
  ["ES", "Team Elena", "2/4 on shift", "43%"],
];

const activityRows = [
  ["New booking created", "Standard Cleaning · RaeChel Richmond", "2 min ago"],
  ["Payment processed", "$220.00 · Tina Lopez", "12 min ago"],
  ["New lead", "Thumbtack · D.C. Metro", "28 min ago"],
  ["Review received", "5 stars · Marshall Moore", "1 hour ago"],
  ["Team member clocked in", "Jamal Smith", "2 hours ago"],
];

function PreviewMetric({
  icon: Icon,
  label,
  value,
  comparison,
  comparisonLabel,
  tone,
  points,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  comparison: string;
  comparisonLabel: string;
  tone: "coral" | "green" | "violet" | "gold";
  points: string;
}) {
  return <article className={`mib-preview-metric ${tone}`} data-static-reference="true"><span><Icon /></span><div><small>{label}</small><strong>{value}</strong><p><b>↗ {comparison}</b><em>{comparisonLabel}</em></p></div><svg viewBox="0 0 132 68" aria-hidden="true" preserveAspectRatio="none"><defs><linearGradient id={`${tone}-fade`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="currentColor" stopOpacity=".18" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs><path d={`${points} L132 68 L0 68 Z`} fill={`url(#${tone}-fade)`} /><path d={points} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" /></svg></article>;
}

function ViewAll() {
  return <span>View all <ChevronRight /></span>;
}

export default function MibHomePreview() {
  return <AdminPageGuard pageId="command-center"><main className="mib-home-preview" aria-label="MIB operations homepage visual preview"><aside className="mib-home-preview__sidebar" aria-label="MIB navigation preview"><div className="mib-home-preview__brand"><img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/MIB_logo_final_138df3e8.png" alt="Maids in Black" /></div><nav>{sidebarItems.map(({ label, icon: Icon, active }) => <span key={label} className={active ? "active" : ""} data-presentation-only="true"><Icon /><b>{label}</b></span>)}</nav><div className="mib-home-preview__help"><Headphones /><strong>Need help?</strong><p>We’re here for you.</p><button type="button" disabled>Contact support</button></div></aside><section className="mib-home-preview__workspace"><header className="mib-home-preview__topbar"><label><Search /><input aria-label="Preview search" readOnly value="Search bookings, customers, or teams…" /></label><div><button type="button" disabled aria-label="Preview today selector"><CalendarDays />Today<ChevronDown /></button><button type="button" disabled aria-label="Previous preview day"><ChevronLeft /></button><button type="button" disabled aria-label="Next preview day"><ChevronRight /></button><button type="button" disabled aria-label="Preview notifications"><Bell /><i /></button><button type="button" disabled aria-label="Preview user menu"><span>RG</span><ChevronDown /></button></div></header><section className="mib-home-preview__heading"><div><p>OPERATIONS</p><h1>Good morning, Rohan.</h1><span>Here’s what’s happening with Maids in Black today.</span></div><div className="mib-home-preview__range" aria-label="Reference date controls"><button type="button" disabled>Last 30 days <ChevronDown /></button><span><button type="button" disabled aria-label="Previous reference range"><ChevronLeft /></button><button type="button" disabled aria-label="Next reference range"><ChevronRight /></button></span></div></section><section className="mib-home-preview__metrics" aria-label="Reference metric cards"><PreviewMetric icon={CalendarDays} label="Total Bookings" value="28" comparison="+12%" comparisonLabel="vs. last Monday" tone="coral" points="M0 57 L16 51 L30 53 L45 40 L59 47 L76 26 L92 39 L109 17 L122 22 L132 7" /><PreviewMetric icon={CircleDollarSign} label="Revenue" value="$6,420" comparison="+18%" comparisonLabel="vs. last Monday" tone="green" points="M0 57 L16 49 L31 53 L46 38 L60 48 L76 30 L91 37 L108 14 L121 28 L132 9" /><PreviewMetric icon={Users} label="New Customers" value="17" comparison="+31%" comparisonLabel="vs. last Monday" tone="violet" points="M0 52 L14 48 L28 51 L41 42 L57 45 L73 35 L88 43 L104 17 L117 30 L132 13" /><PreviewMetric icon={Star} label="Average Rating" value="4.9" comparison="+0.2" comparisonLabel="vs. last month" tone="gold" points="M0 55 L15 49 L30 52 L45 37 L58 48 L74 29 L90 14 L104 35 L119 22 L132 10" /></section><section className="mib-home-preview__overview"><article className="mib-preview-panel mib-preview-chart"><header><div><h2>Bookings overview</h2><p><strong>186</strong><b>↗ 14%</b><span>Total bookings</span></p></div><div className="mib-preview-chart__tabs"><b>Bookings</b><span>Revenue</span><span>Customers</span><button type="button" disabled>Last 30 days <ChevronDown /></button></div></header><div className="mib-preview-bars" aria-label="Decorative bookings chart reference">{Array.from({ length: 24 }, (_, index) => <i key={index} style={{ height: `${30 + ((index * 19) % 52)}%` }} />)}</div></article><article className="mib-preview-panel mib-preview-service"><header><h2>Bookings by service</h2><ViewAll /></header><div><div className="mib-preview-donut"><strong>186</strong><small>Bookings</small></div><ul><li><i className="coral" />Standard Cleaning <b>42%</b></li><li><i className="peach" />Deep Cleaning <b>28%</b></li><li><i className="green" />Move-out Cleaning <b>15%</b></li><li><i className="violet" />Recurring <b>10%</b></li><li><i className="gray" />Other <b>5%</b></li></ul></div></article></section><section className="mib-home-preview__operating-grid"><article className="mib-preview-panel"><header><h2>Today’s schedule</h2><ViewAll /></header><ul className="mib-preview-list">{scheduleRows.map(([time, name, detail, status], index) => <li key={name}><strong>{time}</strong><i className={index === 0 ? "live" : ""} /><span>{name}<small>{detail}</small></span><em>{status}</em><ChevronRight /></li>)}</ul></article><article className="mib-preview-panel"><header><h2>Active teams</h2><ViewAll /></header><ul className="mib-preview-list mib-preview-list--teams">{teamRows.map(([initials, name, detail, width]) => <li key={name}><b>{initials}</b><span>{name}<small>{detail}</small></span><i style={{ width }} /><ChevronRight /></li>)}</ul></article><article className="mib-preview-panel"><header><h2>Recent activity</h2><ViewAll /></header><ul className="mib-preview-list mib-preview-list--activity">{activityRows.map(([title, detail, time]) => <li key={title}><b><ClipboardList /></b><span>{title}<small>{detail}</small></span><em>{time}</em></li>)}</ul></article></section><section className="mib-home-preview__promos"><article className="teams"><Users /><div><h2>Keep your teams set up for success.</h2><p>Manage schedules, track performance, and deliver amazing service.</p><button type="button" disabled>Manage teams <ChevronRight /></button></div></article><article className="growth"><Megaphone /><div><h2>Grow your business.</h2><p>Turn more leads into bookings with automated follow-ups.</p><button type="button" disabled>View leads <ChevronRight /></button></div></article><article className="mobile"><Smartphone /><div><h2>Get the mobile app</h2><p>Give your teams everything they need on the go.</p><button type="button" disabled>Send download link <ChevronRight /></button></div></article></section></section></main></AdminPageGuard>;
}
