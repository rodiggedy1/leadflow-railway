import AdminPageGuard from "@/components/AdminPageGuard";
import {
  CalendarDays,
  Check,
  CreditCard,
  Filter,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import "./bookings-preview.css";

type BookingStatus = "Confirmed" | "Needs attention" | "Completed";
type BookingFrequency = "One-time" | "Weekly" | "Every 2 weeks" | "Monthly";
type TeamTone = "violet" | "coral" | "green" | "gray";

type DemoBooking = {
  id: number;
  time: string;
  date: string;
  name: string;
  phone: string;
  address: string;
  service: string;
  home: string;
  price: number;
  status: BookingStatus;
  frequency: BookingFrequency;
  team: string;
  teamInitials: string;
  teamColor: TeamTone;
  card: boolean;
  extras: string[];
  notes: string;
};

const SEED_BOOKINGS: DemoBooking[] = [
  { id: 1842, time: "8:30 AM", date: "2026-08-30", name: "Demo Customer A", phone: "(000) 000-0001", address: "101 Preview Avenue, Washington, DC", service: "Deep cleaning", home: "2 bed · 2 bath", price: 405, status: "Confirmed", frequency: "Every 2 weeks", team: "Demo Team Amara", teamInitials: "AM", teamColor: "violet", card: true, extras: ["Inside fridge"], notes: "Sample note: text before arrival." },
  { id: 1843, time: "10:30 AM", date: "2026-08-30", name: "Demo Customer B", phone: "(000) 000-0002", address: "202 Sample Street, Washington, DC", service: "Standard cleaning", home: "1 bed · 1 bath", price: 164, status: "Confirmed", frequency: "Every 2 weeks", team: "Demo Team Janna", teamInitials: "JT", teamColor: "coral", card: true, extras: [], notes: "Sample access note for UI review." },
  { id: 1844, time: "1:00 PM", date: "2026-08-30", name: "Demo Customer C", phone: "(000) 000-0003", address: "303 Prototype Drive, Oxon Hill, MD", service: "Move-out cleaning", home: "3 bed · 2 bath", price: 399, status: "Needs attention", frequency: "One-time", team: "Unassigned", teamInitials: "?", teamColor: "gray", card: false, extras: ["Inside oven", "Interior cabinets"], notes: "Sample note: flexible arrival window." },
  { id: 1845, time: "2:30 PM", date: "2026-08-30", name: "Demo Customer D", phone: "(000) 000-0004", address: "404 Demo Lane, Silver Spring, MD", service: "Deep cleaning", home: "3 bed · 2 bath", price: 369, status: "Completed", frequency: "Monthly", team: "Demo Team Amara", teamInitials: "AM", teamColor: "violet", card: true, extras: ["Baseboards", "Inside oven"], notes: "Sample pet note for UI review." },
  { id: 1846, time: "9:00 AM", date: "2026-08-31", name: "Demo Customer E", phone: "(000) 000-0005", address: "505 Example Court, Washington, DC", service: "Standard cleaning", home: "2 bed · 1 bath", price: 189, status: "Confirmed", frequency: "Weekly", team: "Demo Team Janna", teamInitials: "JT", teamColor: "coral", card: true, extras: [], notes: "" },
];

const EXTRA_CHOICES = ["Inside fridge", "Inside oven", "Interior windows", "Baseboards", "Interior cabinets", "Laundry", "Basement"];
const TEAM_CHOICES: Array<{ name: string; initials: string; color: TeamTone }> = [
  { name: "Demo Team Amara", initials: "AM", color: "violet" },
  { name: "Demo Team Janna", initials: "JT", color: "coral" },
  { name: "Demo Team Imani", initials: "IM", color: "green" },
  { name: "Unassigned", initials: "?", color: "gray" },
];

function BookingsPreviewContent() {
  const [bookings, setBookings] = useState(SEED_BOOKINGS);
  const [activeId, setActiveId] = useState<number | null>(1842);
  const [date, setDate] = useState("2026-08-30");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"All" | BookingStatus>("All");

  const active = bookings.find((booking) => booking.id === activeId) ?? null;
  const visible = useMemo(
    () => bookings.filter((booking) => booking.date === date && (status === "All" || booking.status === status) && `${booking.name} ${booking.address} ${booking.team}`.toLowerCase().includes(query.toLowerCase())),
    [bookings, date, query, status],
  );

  const update = (changes: Partial<DemoBooking>) => {
    if (!active) return;
    setBookings((rows) => rows.map((row) => row.id === active.id ? { ...row, ...changes } : row));
  };

  const toggleExtra = (extra: string) => {
    if (!active) return;
    update({ extras: active.extras.includes(extra) ? active.extras.filter((item) => item !== extra) : [...active.extras, extra] });
  };

  const assignTeam = (name: string) => {
    const team = TEAM_CHOICES.find((option) => option.name === name);
    if (!team) return;
    update({ team: team.name, teamInitials: team.initials, teamColor: team.color });
  };

  const previewOnly = (action: string) => toast.info(`${action} is a UI preview. Nothing was sent, booked, charged, or saved.`);
  const dayTotal = visible.reduce((sum, booking) => sum + booking.price, 0);
  const assigned = visible.filter((booking) => booking.team !== "Unassigned").length;
  const cards = visible.filter((booking) => booking.card).length;

  return (
    <main className={`bookings-ops-shell ${active ? "has-detail" : ""}`}>
      <aside className="bookings-ops-nav" aria-label="Bookings workspace navigation">
        <div className="bookings-ops-logo"><Sparkles /><span>MiB</span></div>
        <nav>
          <button type="button" className="nav-active"><CalendarDays />Bookings</button>
          <button type="button" onClick={() => previewOnly("Teams")}><Users />Teams</button>
          <button type="button" onClick={() => previewOnly("Inbox")}><MessageCircle />Inbox</button>
          <button type="button" onClick={() => previewOnly("Payments")}><CreditCard />Payments</button>
        </nav>
        <div className="bookings-nav-user"><span>RG</span><div><strong>Rohan</strong><small>Administrator</small></div></div>
      </aside>

      <section className="bookings-ops-main">
        <header className="bookings-ops-header">
          <div><p>OPERATIONS · UI PREVIEW</p><h1>Bookings</h1><span>Run the day without losing the details. Sample records only.</span></div>
          <button type="button" className="bookings-new-booking" onClick={() => previewOnly("New booking")}><Plus />New booking</button>
        </header>

        <div className="bookings-date-rail" aria-label="Select demo booking date">
          <button type="button" className={date === "2026-08-29" ? "date-active" : ""} onClick={() => setDate("2026-08-29")}><small>FRI</small><strong>29</strong>{date === "2026-08-29" && <i />}</button>
          <button type="button" className={date === "2026-08-30" ? "date-active" : ""} onClick={() => setDate("2026-08-30")}><small>SAT</small><strong>30</strong>{date === "2026-08-30" && <i />}</button>
          <button type="button" className={date === "2026-08-31" ? "date-active" : ""} onClick={() => setDate("2026-08-31")}><small>SUN</small><strong>31</strong>{date === "2026-08-31" && <i />}</button>
          <button type="button" className={date === "2026-09-01" ? "date-active" : ""} onClick={() => setDate("2026-09-01")}><small>MON</small><strong>1</strong>{date === "2026-09-01" && <i />}</button>
          <label><CalendarDays /><input aria-label="Choose demo booking date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        </div>

        <div className="bookings-metric-row" aria-label="Demo booking metrics">
          <article><span className="bookings-metric-icon coral"><CalendarDays /></span><div><small>BOOKINGS</small><strong>{visible.length}</strong><p>on selected date</p></div></article>
          <article><span className="bookings-metric-icon violet"><Users /></span><div><small>TEAMS ASSIGNED</small><strong>{assigned}<em>/{visible.length}</em></strong><p>{visible.length - assigned ? `${visible.length - assigned} needs a team` : "Everything covered"}</p></div></article>
          <article><span className="bookings-metric-icon green"><CreditCard /></span><div><small>CARDS ON FILE</small><strong>{cards}<em>/{visible.length}</em></strong><p>{visible.length - cards ? `${visible.length - cards} needs attention` : "All secured"}</p></div></article>
          <article><span className="bookings-metric-icon gold">$</span><div><small>BOOKED REVENUE</small><strong>${dayTotal.toLocaleString()}</strong><p>sample values only</p></div></article>
        </div>

        <div className="bookings-toolbar">
          <div className="bookings-search-box"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, address, or team" /></div>
          <div className="bookings-status-tabs">{(["All", "Confirmed", "Needs attention", "Completed"] as const).map((option) => <button type="button" key={option} className={status === option ? "active" : ""} onClick={() => setStatus(option)}>{option}</button>)}</div>
          <button type="button" className="bookings-filter-button" onClick={() => previewOnly("Filters")}><Filter />Filters</button>
        </div>

        <div className="bookings-list" aria-label="Demo bookings list">
          <div className="bookings-list-head"><span>TIME & CUSTOMER</span><span>SERVICE</span><span>TEAM</span><span>PAYMENT</span><span>TOTAL</span><span /></div>
          {visible.length ? visible.map((booking) => (
            <button type="button" className={activeId === booking.id ? "bookings-row selected" : "bookings-row"} key={booking.id} onClick={() => setActiveId(booking.id)}>
              <span className="bookings-customer-cell"><b>{booking.time}</b><i className={booking.status === "Needs attention" ? "bookings-status-dot attention" : "bookings-status-dot"} /><span><strong>{booking.name}</strong><small><MapPin /> {booking.address}</small></span></span>
              <span className="bookings-service-cell"><strong>{booking.service}</strong><small>{booking.home} · {booking.frequency}</small>{booking.extras.length > 0 && <em>+{booking.extras.length} extra{booking.extras.length > 1 ? "s" : ""}</em>}</span>
              <span className="bookings-team-cell"><i className={`bookings-team-avatar ${booking.teamColor}`}>{booking.teamInitials}</i><span><strong>{booking.team}</strong><small>{booking.team === "Unassigned" ? "Assign now" : "Assigned"}</small></span></span>
              <span className={booking.card ? "bookings-payment-ok" : "bookings-payment-missing"}>{booking.card ? <><ShieldCheck />Card on file</> : <><CreditCard />Card needed</>}</span>
              <strong className="bookings-row-price">${booking.price}</strong><MoreHorizontal />
            </button>
          )) : <div className="bookings-empty-day"><CalendarDays /><h3>No demo bookings found</h3><p>Try another date or clear your filters.</p></div>}
        </div>
      </section>

      {active && <aside className="bookings-detail-panel" aria-label={`Demo booking details for ${active.name}`}>
        <header><div><small>BOOKING #{active.id}</small><h2>{active.name}</h2><span className={active.status === "Needs attention" ? "bookings-detail-status attention" : "bookings-detail-status"}>{active.status}</span></div><button type="button" onClick={() => setActiveId(null)} aria-label="Close booking detail panel"><X /></button></header>
        <div className="bookings-detail-scroll">
          <section className="bookings-detail-summary"><div><CalendarDays /><span><small>APPOINTMENT</small><strong>{active.time} · Aug {active.date.endsWith("31") ? "31" : "30"}</strong></span></div><div><MapPin /><span><small>ADDRESS</small><strong>{active.address}</strong></span></div></section>
          <section className="bookings-editor-section"><div className="bookings-section-title"><div><small>SERVICE & EXTRAS</small><h3>{active.service}</h3></div><strong>${active.price}</strong></div><p className="bookings-home-line">{active.home}</p><div className="bookings-selected-extras">{active.extras.map((extra) => <button type="button" key={extra} onClick={() => toggleExtra(extra)}>{extra}<X /></button>)}<button type="button" className="add-extra" onClick={() => previewOnly("Add extra")}><Plus />Add extra</button></div><div className="bookings-extra-picker">{EXTRA_CHOICES.map((extra) => <button type="button" key={extra} className={active.extras.includes(extra) ? "picked" : ""} onClick={() => toggleExtra(extra)}>{active.extras.includes(extra) && <Check />}{extra}</button>)}</div></section>
          <section className="bookings-editor-section"><small>RECURRING SERVICE</small><div className="bookings-choice-grid">{(["One-time", "Weekly", "Every 2 weeks", "Monthly"] as BookingFrequency[]).map((frequency) => <button type="button" key={frequency} className={active.frequency === frequency ? "choice-active" : ""} onClick={() => update({ frequency })}>{frequency}{frequency !== "One-time" && <span>{frequency === "Weekly" ? "Save 20%" : frequency === "Every 2 weeks" ? "Save 15%" : "Save 10%"}</span>}</button>)}</div><p className="bookings-editor-hint">The first cleaning remains full price. Discounts begin with visit two.</p></section>
          <section className="bookings-editor-section"><small>ASSIGNED TEAM</small><div className="bookings-team-select">{TEAM_CHOICES.map((team) => <button type="button" key={team.name} className={active.team === team.name ? "bookings-team-option active" : "bookings-team-option"} onClick={() => assignTeam(team.name)}><i className={`bookings-team-avatar ${team.color}`}>{team.initials}</i><span><strong>{team.name}</strong><small>{team.name === "Unassigned" ? "Leave open" : "2 cleaners · available"}</small></span>{active.team === team.name && <Check />}</button>)}</div></section>
          <section className="bookings-editor-section"><small>PAYMENT</small><div className={active.card ? "bookings-card-panel secured" : "bookings-card-panel missing"}><CreditCard /><div><strong>{active.card ? "Demo Visa ending in 4242" : "No demo card on file"}</strong><p>{active.card ? "Sample Stripe status" : "Secure card link action is not connected"}</p></div>{active.card ? <ShieldCheck /> : <button type="button" onClick={() => { update({ card: true }); previewOnly("Send card link"); }}>Send link</button>}</div></section>
          <section className="bookings-editor-section"><small>NOTES & SPECIAL REQUESTS</small><textarea value={active.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="Sample access details, pets, priorities, or special requests…" /><div className="bookings-customer-actions"><button type="button" onClick={() => previewOnly("Text customer")}><MessageCircle />Text customer</button><button type="button" onClick={() => previewOnly("Reschedule")}><CalendarDays />Reschedule</button></div></section>
        </div>
        <footer><button type="button" className="bookings-cancel-button" onClick={() => previewOnly("Cancel booking")}>Cancel booking</button><button type="button" className="bookings-save-button" onClick={() => toast.success("UI preview updated in this browser. No booking was saved.")}><Check />Save changes</button></footer>
      </aside>}
    </main>
  );
}

export default function BookingsPreview() {
  return <AdminPageGuard pageId="bookings"><BookingsPreviewContent /></AdminPageGuard>;
}
