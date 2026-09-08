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
  Home,
  LayoutDashboard,
  LineChart,
  Megaphone,
  MessageCircle,
  Search,
  Settings,
  ShieldCheck,
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

const scheduleRows = ["Morning booking window", "Late-morning booking window", "Afternoon booking window", "Late-afternoon booking window"];
const teamRows = ["Team coverage", "Team coverage", "Team coverage", "Team coverage"];
const activityRows = ["New booking", "Payment activity", "Lead activity", "Service update"];

function PreviewMetric({ icon: Icon, label, tone, points }: { icon: typeof CalendarDays; label: string; tone: "coral" | "green" | "violet" | "gold"; points: string }) {
  return <article className={`mib-preview-metric ${tone}`}><span><Icon /></span><div><small>{label}</small><strong>—</strong><p><b>↗ —</b><em>Live after approval</em></p></div><svg viewBox="0 0 132 68" aria-hidden="true" preserveAspectRatio="none"><defs><linearGradient id={`${tone}-fade`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="currentColor" stopOpacity=".18" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs><path d={`${points} L132 68 L0 68 Z`} fill={`url(#${tone}-fade)`} /><path d={points} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" /></svg></article>;
}

export default function MibHomePreview() {
  return <AdminPageGuard pageId="command-center"><main className="mib-home-preview" aria-label="MIB operations homepage visual preview"><aside className="mib-home-preview__sidebar" aria-label="MIB navigation preview"><div className="mib-home-preview__brand"><img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/MIB_logo_final_138df3e8.png" alt="Maids in Black" /></div><nav>{sidebarItems.map(({ label, icon: Icon, active }) => <span key={label} className={active ? "active" : ""} data-presentation-only="true"><Icon /><b>{label}</b></span>)}</nav><div className="mib-home-preview__help"><Headphones /><strong>Need help?</strong><p>We’re here for you.</p><button type="button" disabled>Contact support</button></div></aside><section className="mib-home-preview__workspace"><header className="mib-home-preview__topbar"><label><Search /><input aria-label="Preview search" readOnly value="Search bookings, customers, or teams…" /></label><div><button type="button" disabled aria-label="Preview today selector"><CalendarDays />Today<ChevronDown /></button><button type="button" disabled aria-label="Previous preview period"><ChevronLeft /></button><button type="button" disabled aria-label="Next preview period"><ChevronRight /></button><button type="button" disabled aria-label="Preview notifications"><Bell /><i /></button><button type="button" disabled aria-label="Preview user menu"><span>RG</span><ChevronDown /></button></div></header><section className="mib-home-preview__heading"><div><p>OPERATIONS <em>UI PREVIEW</em></p><h1>Good morning, Rohan.</h1><span>Here’s what the MIB operations homepage could look like.</span></div></section><section className="mib-home-preview__metrics" aria-label="Homepage preview metric cards"><PreviewMetric icon={CalendarDays} label="Total bookings" tone="coral" points="M0 57 L16 51 L30 53 L45 40 L59 47 L76 26 L92 39 L109 17 L122 22 L132 7" /><PreviewMetric icon={CircleDollarSign} label="Revenue" tone="green" points="M0 57 L16 49 L31 53 L46 38 L60 48 L76 30 L91 37 L108 14 L121 28 L132 9" /><PreviewMetric icon={Users} label="New customers" tone="violet" points="M0 52 L14 48 L28 51 L41 42 L57 45 L73 35 L88 43 L104 17 L117 30 L132 13" /><PreviewMetric icon={Star} label="Service quality" tone="gold" points="M0 55 L15 49 L30 52 L45 37 L58 48 L74 29 L90 14 L104 35 L119 22 L132 10" /></section><section className="mib-home-preview__overview"><article className="mib-preview-panel mib-preview-chart"><header><div><h2>Bookings overview</h2><p>Live performance data will appear here.</p></div><span>Preview only <ChevronDown /></span></header><div className="mib-preview-chart__tabs"><b>Bookings</b><span>Revenue</span><span>Customers</span></div><div className="mib-preview-bars" aria-label="Decorative bookings chart preview">{Array.from({ length: 24 }, (_, index) => <i key={index} style={{ height: `${30 + ((index * 19) % 52)}%` }} />)}</div></article><article className="mib-preview-panel mib-preview-service"><header><h2>Bookings by service</h2><span>Preview only</span></header><div><div className="mib-preview-donut"><strong>Live</strong><small>data</small></div><ul><li><i className="coral" />Standard cleaning</li><li><i className="peach" />Deep cleaning</li><li><i className="green" />Move-out cleaning</li><li><i className="violet" />Recurring</li><li><i className="gray" />Other</li></ul></div></article></section><section className="mib-home-preview__operating-grid"><article className="mib-preview-panel"><header><h2>Today’s schedule</h2><span>Preview only</span></header><ul className="mib-preview-list">{scheduleRows.map((item, index) => <li key={`${item}-${index}`}><strong>{["8:30 AM", "10:30 AM", "2:30 PM", "4:00 PM"][index]}</strong><i className={index === 0 ? "live" : ""} /><span>{item}<small>Live booking details appear after approval.</small></span><em>{index === 0 ? "In progress" : "Upcoming"}</em><ChevronRight /></li>)}</ul></article><article className="mib-preview-panel"><header><h2>Active teams</h2><span>Preview only</span></header><ul className="mib-preview-list mib-preview-list--teams">{teamRows.map((item, index) => <li key={`${item}-${index}`}><b>{["TM", "JS", "MW", "ES"][index]}</b><span>{item}<small>Live availability appears after approval.</small></span><i style={{ width: `${42 + index * 13}%` }} /><ChevronRight /></li>)}</ul></article><article className="mib-preview-panel"><header><h2>Recent activity</h2><span>Preview only</span></header><ul className="mib-preview-list mib-preview-list--activity">{activityRows.map((item, index) => <li key={item}><b><ClipboardList /></b><span>{item}<small>Connected activity appears after approval.</small></span><em>{["Now", "—", "—", "—"][index]}</em></li>)}</ul></article></section><section className="mib-home-preview__promos"><article className="teams"><Users /><div><h2>Keep your teams set up for success.</h2><p>Manage schedules and availability from one calm workspace.</p><button type="button" disabled>Manage teams <ChevronRight /></button></div></article><article className="growth"><Megaphone /><div><h2>Grow your business.</h2><p>Bring leads, bookings, and follow-up into a clear daily rhythm.</p><button type="button" disabled>View leads <ChevronRight /></button></div></article><article className="care"><ShieldCheck /><div><h2>Deliver a five-star experience.</h2><p>Keep customer care and quality signals visible for the team.</p><button type="button" disabled>Explore customer care <ChevronRight /></button></div></article></section><footer className="mib-home-preview__notice"><Home />Homepage UI preview only — no live customer, booking, payment, message, or operational data is loaded.</footer></section></main></AdminPageGuard>;
}
