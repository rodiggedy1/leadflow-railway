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
import "./mib-home-preview.css";

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

const metricMicroBars = {
  coral: [30, 42, 35, 52, 46, 66, 51, 72, 64, 79, 70, 88, 82, 100],
  green: [28, 38, 33, 48, 40, 58, 47, 72, 59, 82, 71, 90, 78, 100],
  violet: [34, 30, 40, 35, 48, 43, 57, 49, 74, 63, 88, 78, 92, 100],
  gold: [32, 42, 36, 54, 44, 66, 76, 57, 70, 88, 72, 84, 76, 96],
} as const;

const pulseItems = [
  { icon: CalendarDays, title: "New booking", detail: "$369 deep clean · Tomorrow 9:00 AM", time: "2m ago", tone: "coral" },
  { icon: MessageCircle, title: "New message", detail: "Sean replied about entry details", time: "6m ago", tone: "violet" },
  { icon: Bell, title: "Team update", detail: "Team Madison may be 15 min late", time: "12m ago", tone: "gold" },
  { icon: ClipboardList, title: "Command", detail: "3 customers need follow-up", time: "18m ago", tone: "green" },
] as const;

const commandPresence = [
  { name: "You", initials: "RG", tone: "owner", portrait: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/myuBDxqUFdShwbiv.png" },
  { name: "Madison", initials: "MA", tone: "violet", portrait: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/maUqForRGuyxRSnl.png" },
  { name: "Jamal", initials: "JA", tone: "coral", portrait: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/AvtFDWfyMzNAnEyN.png" },
  { name: "Elena", initials: "EL", tone: "gold", portrait: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/paPFTUPldIyooTlX.png" },
  { name: "Marcus", initials: "MC", tone: "green", portrait: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/myuBDxqUFdShwbiv.png" },
  { name: "Tina", initials: "TI", tone: "peach", portrait: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/kbPgTKhXUXORgafI.png" },
] as const;

function PreviewMetric({
  icon: Icon,
  label,
  value,
  comparison,
  comparisonLabel,
  tone,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  comparison: string;
  comparisonLabel: string;
  tone: "coral" | "green" | "violet" | "gold";
}) {
  return (
    <article className={`mib-preview-metric ${tone}`} data-static-reference="true">
      <span><Icon /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p><b>↗ {comparison}</b><em>{comparisonLabel}</em></p>
      </div>
      <div className="mib-preview-metric__microchart" aria-hidden="true">
        {metricMicroBars[tone].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
      </div>
    </article>
  );
}

function ViewAll() {
  return <span>View all <ChevronRight /></span>;
}

export default function MibHomePreview() {
  return (
    <AdminPageGuard pageId="command-center">
      <main className="mib-home-preview" aria-label="MIB operations homepage visual preview">
        <MibSidebar activeItem="Dashboard" />

        <section className="mib-home-preview__workspace">
          <header className="mib-command-header mib-command-header--dark-variant" aria-label="Command header" data-static-reference="true">
            <div className="mib-command-header__identity"><span><MessageCircle /></span><div><strong>Command</strong><small><i />12 online</small></div></div>
            <div className="mib-command-header__presence" aria-label="Static team presence">
              {commandPresence.map(({ name, initials, tone, portrait }) => <div key={name} className={`mib-command-header__member ${tone}`}><b>{portrait ? <img src={portrait} alt={`${name} portrait preview`} /> : initials}</b><small>{name}</small>{name === "You" && <i />}</div>)}
              <span className="mib-command-header__more">+4</span>
            </div>
            <label className="mib-command-header__compose"><input aria-label="Static Command Chat message preview" readOnly value="Message the team…" /><button type="button" disabled aria-label="Send static Command Chat preview"><ChevronRight /></button></label>
            <div className="mib-command-header__actions"><button type="button" disabled aria-label="Preview notifications"><Bell /><i /></button><button type="button" disabled aria-label="Preview user menu"><span>RG</span><b>Rohan Gilkes<small>Admin</small></b><ChevronDown /></button></div>
          </header>

          <section className="mib-home-preview__heading">
            <div><p>OPERATIONS</p><h1>Good morning, Rohan.</h1><span>Here’s what’s happening with Maids in Black today.</span></div>
            <div className="mib-home-preview__range" aria-label="Reference date controls"><button type="button" disabled>Last 30 days <ChevronDown /></button><span><button type="button" disabled aria-label="Previous reference range"><ChevronLeft /></button><button type="button" disabled aria-label="Next reference range"><ChevronRight /></button></span></div>
          </section>

          <section className="mib-preview-pulse" aria-label="Operations Pulse" data-static-reference="true">
            <div className="mib-preview-pulse__title"><span><i />LIVE</span><strong>Operations Pulse</strong></div>
            {pulseItems.map(({ icon: Icon, title, detail, time, tone }) => <article key={title} className={tone}><span><Icon /></span><div><strong>{title}</strong><p>{detail}</p><small>{time}</small></div></article>)}
            <div className="mib-preview-pulse__actions"><button type="button" disabled aria-label="Previous pulse item"><ChevronLeft /></button><button type="button" disabled aria-label="Next pulse item"><ChevronRight /></button><button type="button" disabled>View all <ChevronRight /></button></div>
          </section>

          <section className="mib-home-preview__metrics" aria-label="Reference metric cards">
            <PreviewMetric icon={CalendarDays} label="Total Bookings" value="28" comparison="+12%" comparisonLabel="vs. last Monday" tone="coral" />
            <PreviewMetric icon={CircleDollarSign} label="Revenue" value="$6,420" comparison="+18%" comparisonLabel="vs. last Monday" tone="green" />
            <PreviewMetric icon={Users} label="New Customers" value="17" comparison="+31%" comparisonLabel="vs. last Monday" tone="violet" />
            <PreviewMetric icon={Star} label="Average Rating" value="4.9" comparison="+0.2" comparisonLabel="vs. last month" tone="gold" />
          </section>

          <section className="mib-home-preview__overview">
            <article className="mib-preview-panel mib-preview-chart">
              <header><div><h2>Bookings overview</h2><p><strong>186</strong><b>↗ 14%</b><span>Total bookings</span></p></div><div className="mib-preview-chart__tabs"><b>Bookings</b><span>Revenue</span><span>Customers</span><button type="button" disabled>Last 30 days <ChevronDown /></button></div></header>
              <div className="mib-preview-bars" aria-label="Decorative bookings chart reference">{Array.from({ length: 24 }, (_, index) => <i key={index} style={{ height: `${30 + ((index * 19) % 52)}%` }} />)}</div>
            </article>
            <article className="mib-preview-panel mib-preview-service"><header><h2>Bookings by service</h2><ViewAll /></header><div><div className="mib-preview-donut"><strong>186</strong><small>Bookings</small></div><ul><li><i className="coral" />Standard Cleaning <b>42%</b></li><li><i className="peach" />Deep Cleaning <b>28%</b></li><li><i className="green" />Move-out Cleaning <b>15%</b></li><li><i className="violet" />Recurring <b>10%</b></li><li><i className="gray" />Other <b>5%</b></li></ul></div></article>
          </section>

          <section className="mib-home-preview__operating-grid">
            <article className="mib-preview-panel"><header><h2>Today’s schedule</h2><ViewAll /></header><ul className="mib-preview-list">{scheduleRows.map(([time, name, detail, status], index) => <li key={name}><strong>{time}</strong><i className={index === 0 ? "live" : ""} /><span>{name}<small>{detail}</small></span><em>{status}</em><ChevronRight /></li>)}</ul></article>
            <article className="mib-preview-panel"><header><h2>Active teams</h2><ViewAll /></header><ul className="mib-preview-list mib-preview-list--teams">{teamRows.map(([initials, name, detail, width]) => <li key={name}><b>{initials}</b><span>{name}<small>{detail}</small></span><i style={{ width }} /><ChevronRight /></li>)}</ul></article>
            <article className="mib-preview-panel"><header><h2>Recent activity</h2><ViewAll /></header><ul className="mib-preview-list mib-preview-list--activity">{activityRows.map(([title, detail, time]) => <li key={title}><b><ClipboardList /></b><span>{title}<small>{detail}</small></span><em>{time}</em></li>)}</ul></article>
          </section>

          <section className="mib-home-preview__promos">
            {actionCards.map(card => <article key={card.title} className={card.className}><img src={card.image} alt={card.alt} /><div><h2>{card.title}</h2><p>{card.description}</p><button type="button" disabled>{card.action} <ChevronRight /></button></div></article>)}
          </section>
        </section>
      </main>
    </AdminPageGuard>
  );
}
