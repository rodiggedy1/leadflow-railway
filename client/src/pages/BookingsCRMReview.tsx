import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Filter,
  House,
  ImageIcon,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Users,
  UserPlus,
  WalletCards,
  X,
} from "lucide-react";
import "./operations-crm-review.css";
import "./bookings-crm-review.css";
import "./bookings-typography-cohesion.css";
import "./bookings-avatar-cohesion.css";
import "./bookings-customer-avatar-cohesion.css";
import "./bookings-portraits.css";

type BookingStatus = "confirmed" | "needs_attention" | "completed" | "lead" | "payment_incomplete";
type BookingView = "bookings" | "leads";
type Booking = {
  key: string;
  publicNumber: string;
  customer: string;
  initials: string;
  source: "Native booking" | "Launch27 import" | "Service request" | "Booking lead";
  status: BookingStatus;
  service: string;
  bedrooms: number;
  bathrooms: number;
  recurrence: "One time" | "Weekly" | "Bi-weekly" | "Monthly";
  scheduled: string;
  window: string;
  team: string | null;
  payment: "Visa •••• 4242" | "Mastercard •••• 0672" | "Payment not started" | "Paid";
  total: number | null;
  address: string;
  phone: string;
  email: string;
  extras: string[];
  notes: string;
};

const SAMPLE_BOOKINGS: Booking[] = [
  { key: "booking:sample-a", publicNumber: "BK-10482", customer: "Sample client — A", initials: "SA", source: "Native booking", status: "confirmed", service: "Recurring home service", bedrooms: 3, bathrooms: 2, recurrence: "Bi-weekly", scheduled: "Tue, Sep 15", window: "9:00 AM – 12:00 PM", team: "Team North", payment: "Visa •••• 4242", total: 184, address: "123 Example Street, Washington, DC", phone: "+1 (202) 555-0141", email: "sample-a@example.test", extras: ["Inside fridge", "Laundry × 1"], notes: "Static sample note for visual review only." },
  { key: "booking:sample-b", publicNumber: "BK-10483", customer: "Sample client — B", initials: "SB", source: "Native booking", status: "confirmed", service: "Deep home service", bedrooms: 4, bathrooms: 3, recurrence: "One time", scheduled: "Tue, Sep 15", window: "10:00 AM – 1:00 PM", team: "Team Central", payment: "Mastercard •••• 0672", total: 246, address: "456 Demo Avenue, Arlington, VA", phone: "+1 (202) 555-0142", email: "sample-b@example.test", extras: ["Inside cabinets"], notes: "Static sample note for visual review only." },
  { key: "lead:sample-c", publicNumber: "LD-20484", customer: "Sample client — C", initials: "SC", source: "Booking lead", status: "lead", service: "Move-in service", bedrooms: 2, bathrooms: 2, recurrence: "One time", scheduled: "Not selected", window: "Details in progress", team: null, payment: "Payment not started", total: null, address: "789 Preview Lane, Silver Spring, MD", phone: "+1 (202) 555-0143", email: "sample-c@example.test", extras: [], notes: "Static sample booking lead." },
  { key: "leadflow:sample-d", publicNumber: "L27-33014", customer: "Sample client — D", initials: "SD", source: "Launch27 import", status: "needs_attention", service: "Recurring home service", bedrooms: 4, bathrooms: 2, recurrence: "Weekly", scheduled: "Tue, Sep 15", window: "12:00 PM – 3:00 PM", team: null, payment: "Visa •••• 4242", total: 338, address: "100 Static Place, Washington, DC", phone: "+1 (202) 555-0144", email: "sample-d@example.test", extras: ["Inside oven", "Change sheets"], notes: "Static sample note for visual review only." },
  { key: "booking:sample-e", publicNumber: "BK-10485", customer: "Sample client — E", initials: "SE", source: "Native booking", status: "completed", service: "Standard home service", bedrooms: 2, bathrooms: 1, recurrence: "Monthly", scheduled: "Tue, Sep 15", window: "1:00 PM – 3:00 PM", team: "Team West", payment: "Paid", total: 156, address: "200 Mockup Drive, Bethesda, MD", phone: "+1 (202) 555-0145", email: "sample-e@example.test", extras: [], notes: "Static sample note for visual review only." },
  { key: "portal:sample-f", publicNumber: "SR-0671", customer: "Sample client — F", initials: "SF", source: "Service request", status: "payment_incomplete", service: "Post-construction service", bedrooms: 3, bathrooms: 2, recurrence: "One time", scheduled: "Tue, Sep 15", window: "2:00 PM – 5:00 PM", team: null, payment: "Payment not started", total: 412, address: "300 Prototype Road, Alexandria, VA", phone: "+1 (202) 555-0146", email: "sample-f@example.test", extras: ["Inside cabinets", "Interior windows"], notes: "Static sample service request." },
  { key: "leadflow:sample-g", publicNumber: "L27-33016", customer: "Sample client — G", initials: "SG", source: "Launch27 import", status: "confirmed", service: "Recurring home service", bedrooms: 3, bathrooms: 2, recurrence: "Bi-weekly", scheduled: "Tue, Sep 15", window: "3:00 PM – 6:00 PM", team: "Team East", payment: "Visa •••• 4242", total: 184, address: "400 Example Court, Washington, DC", phone: "+1 (202) 555-0147", email: "sample-g@example.test", extras: ["Balcony"], notes: "Static sample note for visual review only." },
  { key: "booking:sample-h", publicNumber: "BK-10486", customer: "Sample client — H", initials: "SH", source: "Native booking", status: "confirmed", service: "Deep home service", bedrooms: 5, bathrooms: 3, recurrence: "One time", scheduled: "Tue, Sep 15", window: "4:00 PM – 7:00 PM", team: "Team North", payment: "Mastercard •••• 0672", total: 264, address: "500 Placeholder Way, Rockville, MD", phone: "+1 (202) 555-0148", email: "sample-h@example.test", extras: ["Inside fridge"], notes: "Static sample note for visual review only." },
];

const NAV = [
  { label: "Home", icon: House },
  { label: "Bookings", icon: CalendarDays },
  { label: "Messages", icon: MessageCircle, count: "2" },
  { label: "Payments", icon: CreditCard },
  { label: "My Home", icon: House },
  { label: "Reviews", icon: ClipboardList },
  { label: "Account", icon: Users },
];
const DATE_RAIL = [["MON", "14"], ["TUE", "15"], ["WED", "16"], ["THU", "17"]] as const;
const PHOTO_COLORS = ["linear-gradient(135deg,#6c5d4d,#2a2520 45%,#b49f7d)", "linear-gradient(135deg,#497079,#21343c 45%,#a6d0c3)", "linear-gradient(135deg,#786553,#322c27 48%,#c5ad88)", "linear-gradient(135deg,#493f68,#262332 48%,#a394d4)"];
const TEAM_AVATAR_COLORS: Record<string, string> = { "Team North": "#d76b5b", "Team Central": "#4ca1af", "Team West": "#d19d48", "Team East": "#9871d3", Unassigned: "#353535" };
const CUSTOMER_AVATAR_COLORS: Record<string, string> = { SA: "#d76b5b", SB: "#4ca1af", SC: "#d19d48", SD: "#9871d3", SE: "#4e9a72", SF: "#c46a85", SG: "#d76b5b", SH: "#4ca1af" };
const CUSTOMER_PORTRAITS: Record<string, string> = {
  SA: "/manus-storage/leads-crm-owner-emma-green_55d28723.png",
  SB: "/manus-storage/leads-crm-owner-mark-darnalds_cf661d0b.png",
  SC: "/manus-storage/leads-crm-owner-kate-chen_1285ffcf.png",
  SD: "/manus-storage/leads-crm-owner-oliver-chan_8454e8e9.png",
  SE: "/manus-storage/leads-crm-owner-sarah-nguyen_2fbb7d63.png",
  SF: "/manus-storage/leads-crm-owner-alex-santos_8f730ad0.png",
  SG: "/manus-storage/leads-crm-owner-grace-miller_7bf6a25c.png",
  SH: "/manus-storage/leads-crm-owner-maria-keller_063bfec2.png",
};
const teamAvatarColor = (team: string | null) => TEAM_AVATAR_COLORS[team ?? "Unassigned"] ?? "#4e9a72";
const customerAvatarColor = (initials: string) => CUSTOMER_AVATAR_COLORS[initials] ?? "#4e9a72";

const statusLabel = (status: BookingStatus) => status === "lead" ? "Lead / In progress" : status === "payment_incomplete" ? "Reservation started / Payment incomplete" : status === "needs_attention" ? "Needs attention" : status === "confirmed" ? "Confirmed" : "Completed";
const statusClass = (status: BookingStatus) => status === "lead" ? "attention" : status === "needs_attention" ? "attention" : status === "payment_incomplete" ? "payment" : status;

function MibReviewLogo() { return <div className="bcr-logo-mark" aria-hidden="true"><span /><span /><span /><span /></div>; }

function StaticButton({ children, className = "", onClick }: { children: React.ReactNode; className?: string; onClick: () => void }) {
  return <button type="button" className={className} onClick={onClick}>{children}</button>;
}

function MiniPhoto({ label, index, onClick }: { label: "Before" | "After"; index: number; onClick: () => void }) {
  return <button type="button" className="bcr-photo-thumb" aria-label={`Open static ${label.toLowerCase()} photo ${index + 1}`} onClick={onClick}><span style={{ background: PHOTO_COLORS[index % PHOTO_COLORS.length] }} /><b>{label}</b><em>View</em></button>;
}

function PhotoLightbox({ label, index, onClose, onPrevious, onNext }: { label: "Before" | "After"; index: number; onClose: () => void; onPrevious: () => void; onNext: () => void }) {
  return <div className="bcr-photo-lightbox" role="dialog" aria-modal="true" aria-label={`${label} static photo viewer`} onClick={onClose}><header onClick={event => event.stopPropagation()}><span>{label} · {index + 1} of 2</span><a href="#review-only-photo" onClick={event => event.preventDefault()}><Download size={15} />Download original</a><button type="button" onClick={onClose} aria-label="Close static photo viewer"><X size={18} /></button></header><button type="button" className="bcr-photo-previous" onClick={event => { event.stopPropagation(); onPrevious(); }} aria-label="Previous static photo"><ChevronLeft /></button><div className="bcr-photo-full" style={{ background: PHOTO_COLORS[index % PHOTO_COLORS.length] }} onClick={event => event.stopPropagation()}><span>Static {label.toLowerCase()} photo</span></div><button type="button" className="bcr-photo-next" onClick={event => { event.stopPropagation(); onNext(); }} aria-label="Next static photo"><ChevronRight /></button></div>;
}

function BookingDetailDrawer({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [notice, setNotice] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("2026-09-15");
  const [photo, setPhoto] = useState<{ label: "Before" | "After"; index: number } | null>(null);
  const staticAction = (label: string) => setNotice(`${label} is review-only — no booking was changed.`);
  return <>
    <button type="button" className="ocr-drawer-backdrop" aria-label="Close static booking detail" onClick={onClose} />
    <aside className="ocr-detail-drawer bcr-workspace-detail" role="dialog" aria-modal="true" aria-labelledby="bcr-detail-title">
      <header className="bcr-workspace-detail-header"><div><small>{booking.publicNumber}</small><h2 id="bcr-detail-title">{booking.customer}</h2><span className={`bcr-detail-status ${statusClass(booking.status)}`}>{statusLabel(booking.status)}</span></div><button type="button" aria-label="Close booking detail panel" onClick={onClose}><X size={18} /></button></header>
      <div className="ocr-detail-drawer-scroll bcr-workspace-detail-scroll">
        <section className="bcr-detail-summary"><div><CalendarDays /><span><small>REQUESTED TIME</small><strong>{booking.scheduled} · {booking.window}</strong></span></div><div><MapPin /><span><small>ADDRESS</small><strong>{booking.address}</strong></span></div></section>
        <section className="bcr-editor-section"><div className="bcr-section-title"><div><small>SERVICE &amp; EXTRAS</small><h3>{booking.service}</h3></div><strong>{booking.total === null ? "—" : `$${booking.total.toFixed(0)}`}</strong></div><p className="bcr-home-line">{booking.bedrooms} bedrooms · {booking.bathrooms} bathrooms</p><div className="bcr-selected-extras">{booking.extras.length ? booking.extras.map(extra => <button type="button" key={extra} onClick={() => staticAction("Extras")}>{extra}</button>) : <button type="button" onClick={() => staticAction("Extras")}>Nothing extra</button>}</div></section>
        <section className="bcr-editor-section"><small>RECURRING PREFERENCE</small><div className="bcr-choice-grid">{(["One time", "Weekly", "Bi-weekly", "Tri-weekly", "Monthly"] as const).map(option => <button type="button" key={option} className={booking.recurrence === option ? "choice-active" : ""} onClick={() => staticAction("Recurring preference")}>{option}</button>)}</div><p className="bcr-editor-hint">Static preview of the current booking recurrence controls.</p></section>
        <section className="bcr-editor-section"><small>ASSIGNED TEAM</small><button type="button" className="bcr-team-option active" onClick={() => staticAction("Team assignment")}><i style={{ background: teamAvatarColor(booking.team) }}>{booking.team ? booking.team.split(" ").map(part => part[0]).join("") : "?"}</i><span><strong>{booking.team ?? "Unassigned"}</strong><small>{booking.team ? "Static team assignment" : "Needs review"}</small></span></button></section>
        <section className="bcr-editor-section"><small>PAYMENT</small><div className={`bcr-card-panel ${booking.payment === "Payment not started" ? "missing" : ""}`}><CreditCard /><div><strong>{booking.payment}</strong><p>{booking.payment === "Payment not started" ? "Card collection is not connected for this static in-progress lead." : "Static payment surface — no card action is connected."}</p></div></div></section>
        <section className="bcr-editor-section"><div className="bcr-photo-review-title"><div><small>CLEANER PHOTOS</small><h3>Before &amp; after</h3><p>Static photo-review treatment from the current workspace.</p></div><ImageIcon /></div><div className="bcr-photo-groups">{(["Before", "After"] as const).map((label, groupIndex) => <section className={`bcr-photo-group ${label === "After" ? "after" : ""}`} key={label}><header><div><strong>{label}</strong><span>{label === "Before" ? "Visit condition" : "Finished result"}</span></div><small>2 photos</small></header><div className="bcr-photo-grid"><MiniPhoto label={label} index={groupIndex * 2} onClick={() => setPhoto({ label, index: 0 })} /><MiniPhoto label={label} index={groupIndex * 2 + 1} onClick={() => setPhoto({ label, index: 1 })} /></div></section>)}</div></section>
        <section className="bcr-editor-section"><small>CUSTOMER</small><p className="bcr-home-line">{booking.phone}<br />{booking.email}</p><div className="bcr-customer-actions"><StaticButton onClick={() => staticAction("Customer My Home link")}><Copy size={14} />Copy Customer My Home Link</StaticButton></div></section>
        <section className="bcr-editor-section"><small>NOTES &amp; SPECIAL REQUESTS</small><textarea value={booking.notes} readOnly aria-label="Static booking special requests" /><div className="bcr-customer-actions bcr-request-actions"><StaticButton onClick={() => staticAction("Text customer")}><MessageCircle size={14} />Text customer</StaticButton><div><label><CalendarDays size={14} />Reschedule <input type="date" value={rescheduleDate} onChange={event => setRescheduleDate(event.target.value)} /></label><StaticButton onClick={() => staticAction("Save date")}>Save date</StaticButton></div></div></section>
      </div>
      <footer className="bcr-workspace-detail-footer"><StaticButton className="bcr-cancel-booking" onClick={() => staticAction("Cancel booking")}>Cancel booking</StaticButton><StaticButton className="bcr-save-changes" onClick={() => staticAction("Save changes")}>Save changes</StaticButton><span className="sr-only" aria-live="polite">{notice}</span></footer>
    </aside>
    {photo && <PhotoLightbox label={photo.label} index={photo.index} onClose={() => setPhoto(null)} onPrevious={() => setPhoto(current => current ? { ...current, index: Math.max(0, current.index - 1) } : current)} onNext={() => setPhoto(current => current ? { ...current, index: Math.min(1, current.index + 1) } : current)} />}
  </>;
}

export default function BookingsCRMReview() {
  const [view, setView] = useState<BookingView>("bookings");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dateIndex, setDateIndex] = useState(1);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [notice, setNotice] = useState("");
  const [detailBooking, setDetailBooking] = useState<Booking | null>(null);
  const rows = useMemo(() => SAMPLE_BOOKINGS.filter(booking => {
    const matchesView = view === "bookings" ? booking.status !== "lead" : booking.status === "lead";
    const matchesStatus = status === "All" || status === "Confirmed" && booking.status === "confirmed" || status === "Needs attention" && booking.status === "needs_attention" || status === "Completed" && booking.status === "completed";
    const haystack = `${booking.customer} ${booking.address} ${booking.publicNumber}`.toLowerCase();
    return matchesView && matchesStatus && haystack.includes(query.trim().toLowerCase());
  }), [query, status, view]);
  const selected = SAMPLE_BOOKINGS.find(booking => booking.key === activeKey) ?? null;
  const activeRows = rows.filter(booking => !["lead", "payment_incomplete"].includes(booking.status));
  const assigned = activeRows.filter(booking => booking.team).length;
  const cards = activeRows.filter(booking => booking.payment !== "Payment not started").length;
  const revenue = activeRows.reduce((total, booking) => total + (booking.total ?? 0), 0);

  useEffect(() => { if (!detailBooking) return; const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setDetailBooking(null); window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [detailBooking]);
  const staticAction = (label: string) => setNotice(`${label} is review-only — no real booking action was run.`);

  return <div className="operations-crm-review booking-crm-review bcr-full-workspace" data-review-only="true">
    <aside className="ocr-sidebar bcr-sidebar" aria-label="Static Bookings workspace navigation"><div className="ocr-brand bcr-brand"><MibReviewLogo /><div><strong>Maids in Black</strong><span>Bookings workspace</span></div></div><div className="ocr-nav-scroll"><nav className="ocr-nav-primary">{NAV.map(({ label, icon: Icon, count }) => <button type="button" key={label} className={label === "Bookings" ? "is-active" : ""} onClick={() => staticAction(label)}><Icon size={14} strokeWidth={1.4} /><span>{label}</span>{count && <b>{count}</b>}</button>)}</nav></div><div className="ocr-nav-utility"><button type="button" onClick={() => staticAction("Invite teammates")}><UserPlus size={14} />Invite teammates</button><button type="button" onClick={() => staticAction("Help")}><CircleHelp size={14} />Help</button></div><div className="ocr-sidebar-footer"><div className="ocr-trial"><div><strong>Bookings</strong><span>Static review</span></div><button type="button" onClick={() => staticAction("Review mode")}><WalletCards size={14} />Review mode</button></div></div></aside>
    <main className="ocr-workspace bcr-workspace">
      <header className="ocr-header"><div className="bcr-page-intro"><p>OPERATIONS · BOOKINGS</p><h1>Bookings</h1><span>{view === "bookings" ? "Native requests and isolated Launch27 imports appear here for review." : "Phone-captured booking leads appear here while customers finish the flow."}</span></div><div className="bcr-header-actions"><StaticButton className="bcr-new-booking" onClick={() => staticAction("New booking")}><Plus size={14} />New booking</StaticButton><StaticButton className="bcr-header-button" onClick={() => staticAction("Refresh team & card details")}><CreditCard size={14} />Refresh team &amp; card details</StaticButton><StaticButton className="bcr-header-button" onClick={() => staticAction("Import next 30 days")}><CalendarDays size={14} />Import next 30 days</StaticButton></div></header>
      <section className="bcr-workspace-toolbar"><div className="ocr-tabs bcr-view-tabs"><button type="button" className={view === "bookings" ? "is-active" : ""} onClick={() => { setView("bookings"); setStatus("All"); }}>Bookings</button><button type="button" className={view === "leads" ? "is-active" : ""} onClick={() => { setView("leads"); setStatus("All"); }}>Leads</button></div>{view === "bookings" && <div className="bcr-toolbar-operations"><StaticButton className="bcr-inline-action" onClick={() => staticAction("Sync Sep 15, 2026")}><CalendarDays size={14} />Sync Sep 15, 2026</StaticButton><StaticButton className="bcr-inline-action" onClick={() => staticAction(selected ? "Cancel selected booking" : "Select a booking first")}><X size={14} />Cancel selected booking</StaticButton></div>}</section>
      {view === "bookings" && <section className="bcr-date-rail" aria-label="Static booking date selection">{DATE_RAIL.map(([day, number], index) => <button type="button" key={number} className={dateIndex === index ? "date-active" : ""} onClick={() => setDateIndex(index)}><small>{day}</small><strong>{number}</strong>{dateIndex === index && <i />}</button>)}<label><CalendarDays size={14} /><input aria-label="Choose static booking date" type="date" value="2026-09-15" readOnly /></label></section>}
      <section className="bcr-metric-row" aria-label="Static booking metrics"><article><span className="bcr-metric-icon coral"><CalendarDays size={16} /></span><div><small>{view === "bookings" ? "BOOKINGS" : "LEADS"}</small><strong>{rows.length}</strong><p>{view === "bookings" ? "on selected date" : "in progress"}</p></div></article><article><span className="bcr-metric-icon violet"><Users size={16} /></span><div><small>TEAMS ASSIGNED</small><strong>{assigned}<em>/{activeRows.length}</em></strong><p>{activeRows.length - assigned ? `${activeRows.length - assigned} needs a team` : "Everything covered"}</p></div></article><article><span className="bcr-metric-icon green"><CreditCard size={16} /></span><div><small>CARDS ON FILE</small><strong>{cards}<em>/{activeRows.length}</em></strong><p>{activeRows.length - cards ? `${activeRows.length - cards} not started` : "All secured"}</p></div></article><article><span className="bcr-metric-icon gold">$</span><div><small>REVENUE</small><strong>${revenue.toLocaleString()}</strong><p>active first-clean totals</p></div></article></section>
      <section className="bcr-list-toolbar"><label className="bcr-search-box"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search customer, address, or request number" /></label><div className="bcr-status-tabs">{view === "bookings" ? ["All", "Confirmed", "Needs attention", "Completed"].map(option => <button type="button" key={option} className={status === option ? "active" : ""} onClick={() => setStatus(option)}>{option}</button>) : <button type="button" className="active">Lead / In progress</button>}</div><StaticButton className="bcr-filter-button" onClick={() => staticAction("Filters")}><Filter size={14} />Filters</StaticButton></section>
      {notice && <div className="bcr-static-notice" role="status">{notice}</div>}
      <section className="bcr-booking-list" aria-label={view === "bookings" ? "Static LeadFlow bookings list" : "Static LeadFlow leads list"}><div className="bcr-booking-list-head"><span>TIME &amp; CUSTOMER</span><span>SERVICE</span><span>TEAM</span><span>PAYMENT</span><span>TOTAL</span><span /></div>{rows.length ? rows.map(booking => <button type="button" className={`bcr-booking-row ${selected?.key === booking.key ? "selected" : ""} ${booking.status === "needs_attention" ? "needs-attention" : ""}`} key={booking.key} onClick={() => { setActiveKey(booking.key); setDetailBooking(booking); }}><span className="bcr-customer-cell"><b>{booking.status === "lead" ? "Lead" : booking.window.split(" – ")[0]}</b><i className={booking.status === "lead" || booking.status === "needs_attention" ? "bcr-status-dot attention" : "bcr-status-dot"} /><span><span className="bcr-customer-name">{CUSTOMER_PORTRAITS[booking.initials] ? <img className="bcr-customer-portrait" src={CUSTOMER_PORTRAITS[booking.initials]} alt={`Static portrait for ${booking.customer}`} /> : <i style={{ background: customerAvatarColor(booking.initials) }}>{booking.initials}</i>}<strong>{booking.customer}</strong></span><small><MapPin size={11} />{booking.address}</small></span></span><span className="bcr-service-cell"><strong>{booking.service}</strong><small>{booking.bedrooms} bed · {booking.bathrooms} baths · {booking.recurrence}</small><em>{booking.source}</em></span><span className="bcr-team-cell"><i style={{ background: teamAvatarColor(booking.team) }}>{booking.team ? booking.team.split(" ").map(part => part[0]).join("") : "?"}</i><span><strong>{booking.team ?? "Unassigned"}</strong><small>{booking.team ? "Team assigned" : "Needs review"}</small></span></span><span className={booking.payment === "Payment not started" ? "bcr-payment-missing" : "bcr-payment-ok"}><CreditCard size={14} />{booking.payment}</span><strong className="bcr-row-price">{booking.total === null ? "—" : `$${booking.total.toFixed(0)}`}</strong><MoreHorizontal size={18} /></button>) : <div className="bcr-empty-day"><CalendarDays size={22} /><h3>No {view} found</h3><p>Try another static date or clear your local filters.</p></div>}</section>
    </main>
    {detailBooking && <BookingDetailDrawer booking={detailBooking} onClose={() => setDetailBooking(null)} />}
  </div>;
}
