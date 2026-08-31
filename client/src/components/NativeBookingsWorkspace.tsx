import { trpc } from "@/lib/trpc";
import { BookingPaymentActions } from "@/components/BookingPaymentActions";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "@shared/bookingWidgetConfig";
import { CalendarDays, CreditCard, Filter, Loader2, MapPin, MessageCircle, MoreHorizontal, Plus, Search, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import "@/pages/bookings-preview.css";

type StatusFilter = "All" | "Confirmed" | "Needs attention" | "Completed";
type NativeExtra = { id: string; label: string; quantity: number };
type WorkspaceRow = {
  key: string;
  source: "booking" | "funnel";
  id: number;
  publicNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  status: string;
  requestedLocalDate: string | null;
  requestedLocalTime: string | null;
  address: string | null;
  serviceName: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  recurrence: string | null;
  extras: NativeExtra[];
  specialRequestNotes: string[];
  assignmentStatus: string;
  paymentStatus: string;
  firstCleaningTotalCents: number | null;
};

const API_STATUS: Record<Exclude<StatusFilter, "All">, "confirmed" | "needs_attention" | "completed"> = {
  Confirmed: "confirmed",
  "Needs attention": "needs_attention",
  Completed: "completed",
};
const businessDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dateAtNoon = (value: string) => new Date(`${value}T12:00:00`);
const shiftDate = (value: string, days: number) => {
  const date = dateAtNoon(value);
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const displayDate = (value: string) => dateAtNoon(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const displayTime = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
};
const labelStatus = (value: string) => value === "lead" ? "Lead / In progress" : value === "payment_incomplete" ? "Reservation started / Payment incomplete" : value === "needs_attention" ? "Needs attention" : value === "pending_payment" ? "Pending payment" : value.charAt(0).toUpperCase() + value.slice(1);
const labelRecurrence = (value: string) => value === "biweekly" ? "Every 2 weeks" : value === "one-time" ? "One-time" : value.charAt(0).toUpperCase() + value.slice(1);
const extrasFrom = (value: unknown): NativeExtra[] => Array.isArray(value)
  ? value.filter((item): item is NativeExtra => Boolean(item && typeof item === "object" && typeof (item as NativeExtra).id === "string" && typeof (item as NativeExtra).label === "string" && typeof (item as NativeExtra).quantity === "number"))
  : [];
const funnelExtrasFrom = (value: unknown): NativeExtra[] => Array.isArray(value)
  ? value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { id?: unknown; quantity?: unknown };
    if (typeof candidate.id !== "string" || typeof candidate.quantity !== "number") return [];
    return [{ id: candidate.id, label: BOOKING_WIDGET_PRICED_EXTRAS.find((extra) => extra.id === candidate.id)?.label ?? candidate.id, quantity: candidate.quantity }];
  })
  : [];
const notesFrom = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export default function NativeBookingsWorkspace() {
  const [view, setView] = useState<"bookings" | "leads">("bookings");
  const [activeKey, setRawActiveKey] = useState<string | null>(null);
  const detailDismissedRef = useRef(false);
  const setActiveKey = (key: string | null) => {
    detailDismissedRef.current = key === null;
    setRawActiveKey(key);
  };
  const [date, setDate] = useState(businessDate);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("All");
  const listInput = useMemo(() => ({ date, status: status === "All" ? undefined : API_STATUS[status], query: query.trim() || undefined, limit: 200 }), [date, query, status]);
  const funnelListInput = useMemo(() => ({ query: query.trim() || undefined, limit: 200 }), [query]);
  const listQuery = trpc.bookings.list.useQuery(listInput, { staleTime: 10_000 });
  const funnelListQuery = trpc.bookingFunnel.list.useQuery(funnelListInput, { staleTime: 10_000 });
  const selectedBookingId = activeKey?.startsWith("booking:") ? Number(activeKey.slice("booking:".length)) : null;
  const selectedFunnelId = activeKey?.startsWith("funnel:") ? Number(activeKey.slice("funnel:".length)) : null;
  const detailQuery = trpc.bookings.get.useQuery({ id: selectedBookingId ?? 0 }, { enabled: selectedBookingId !== null, staleTime: 10_000 });
  const funnelDetailQuery = trpc.bookingFunnel.get.useQuery({ id: selectedFunnelId ?? 0 }, { enabled: selectedFunnelId !== null, staleTime: 10_000 });
  const bookings = listQuery.data ?? [];
  const funnelLeads = funnelListQuery.data ?? [];
  const rows = useMemo<WorkspaceRow[]>(() => {
    const bookingRows = bookings.map((booking) => ({
      key: `booking:${booking.id}`,
      source: "booking" as const,
      id: booking.id,
      publicNumber: booking.publicBookingNumber,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      customerEmail: booking.customerEmail,
      status: booking.status,
      requestedLocalDate: booking.requestedLocalDate,
      requestedLocalTime: booking.requestedLocalTime,
      address: booking.address,
      serviceName: booking.serviceName,
      bedrooms: booking.bedrooms,
      bathrooms: booking.bathrooms,
      recurrence: booking.recurrence,
      extras: extrasFrom(booking.extras),
      specialRequestNotes: notesFrom(booking.specialRequestNotes),
      assignmentStatus: booking.assignmentStatus,
      paymentStatus: booking.paymentStatus,
      firstCleaningTotalCents: booking.firstCleaningTotalCents,
    }));
    const funnelRows = funnelLeads.filter((lead) => !lead.bookingId).map((lead) => ({
      key: `funnel:${lead.id}`,
      source: "funnel" as const,
      id: lead.id,
      publicNumber: lead.publicFunnelNumber,
      customerName: lead.customerName,
      customerPhone: lead.customerPhone,
      customerEmail: lead.customerEmail,
      status: lead.stage,
      requestedLocalDate: lead.requestedLocalDate,
      requestedLocalTime: lead.requestedLocalTime,
      address: lead.address,
      serviceName: lead.serviceName,
      bedrooms: lead.bedrooms,
      bathrooms: lead.bathrooms,
      recurrence: lead.recurrence,
      extras: funnelExtrasFrom(lead.extras),
      specialRequestNotes: notesFrom(lead.specialRequestNotes),
      assignmentStatus: "unassigned",
      paymentStatus: lead.paymentLast4 ? "card_on_file" : "not_started",
      firstCleaningTotalCents: lead.firstCleaningTotalCents,
    }));
    if (view === "bookings") return [...funnelRows.filter((row) => row.status !== "lead"), ...bookingRows].filter((row) => row.requestedLocalDate === date);
    return funnelRows.filter((row) => row.status === "lead");
  }, [bookings, date, funnelLeads, view]);

  useEffect(() => {
    if (!rows.length) return setRawActiveKey(null);
    if (activeKey !== null && rows.some((row) => row.key === activeKey)) return;
    if (!detailDismissedRef.current) setActiveKey(rows[0].key);
  }, [activeKey, rows]);

  const active = useMemo<WorkspaceRow | null>(() => {
    if (selectedBookingId !== null && detailQuery.data) {
      const booking = detailQuery.data;
      return {
        key: `booking:${booking.id}`, source: "booking", id: booking.id, publicNumber: booking.publicBookingNumber,
        customerName: booking.customerName, customerPhone: booking.customerPhone, customerEmail: booking.customerEmail,
        status: booking.status, requestedLocalDate: booking.requestedLocalDate, requestedLocalTime: booking.requestedLocalTime,
        address: booking.address, serviceName: booking.serviceName, bedrooms: booking.bedrooms, bathrooms: booking.bathrooms,
        recurrence: booking.recurrence, extras: extrasFrom(booking.extras), specialRequestNotes: notesFrom(booking.specialRequestNotes),
        assignmentStatus: booking.assignmentStatus, paymentStatus: booking.paymentStatus, firstCleaningTotalCents: booking.firstCleaningTotalCents,
      };
    }
    if (selectedFunnelId !== null && funnelDetailQuery.data) {
      const lead = funnelDetailQuery.data;
      return {
        key: `funnel:${lead.id}`, source: "funnel", id: lead.id, publicNumber: lead.publicFunnelNumber,
        customerName: lead.customerName, customerPhone: lead.customerPhone, customerEmail: lead.customerEmail,
        status: lead.stage, requestedLocalDate: lead.requestedLocalDate, requestedLocalTime: lead.requestedLocalTime,
        address: lead.address, serviceName: lead.serviceName, bedrooms: lead.bedrooms, bathrooms: lead.bathrooms,
        recurrence: lead.recurrence, extras: funnelExtrasFrom(lead.extras), specialRequestNotes: notesFrom(lead.specialRequestNotes),
        assignmentStatus: "unassigned", paymentStatus: lead.paymentLast4 ? "card_on_file" : "not_started", firstCleaningTotalCents: lead.firstCleaningTotalCents,
      };
    }
    return rows.find((row) => row.key === activeKey) ?? null;
  }, [activeKey, detailQuery.data, funnelDetailQuery.data, rows, selectedBookingId, selectedFunnelId]);

  const dates = useMemo(() => [-1, 0, 1, 2].map((offset) => shiftDate(date, offset)), [date]);
  const revenueCents = rows.reduce((total, row) => total + (row.firstCleaningTotalCents ?? 0), 0);
  const assigned = rows.filter((row) => row.assignmentStatus === "assigned").length;
  const cards = rows.filter((row) => row.paymentStatus === "card_on_file").length;

  return <main className={`bookings-ops-shell ${active ? "has-detail" : ""}`}>
    <section className="bookings-ops-main">
      <header className="bookings-ops-header"><div><p>OPERATIONS · NATIVE REQUESTS</p><h1>Bookings</h1><span>{view === "bookings" ? "New Book with AI requests appear here immediately for review." : "Phone-captured booking leads appear here while customers finish the flow."}</span></div><button type="button" className="bookings-new-booking" disabled title="Manual booking creation is not connected in this release"><Plus />New booking</button></header>
      <div className="bookings-toolbar"><div className="bookings-status-tabs" aria-label="Bookings workspace view"><button type="button" className={view === "bookings" ? "active" : ""} onClick={() => setView("bookings")}>Bookings</button><button type="button" className={view === "leads" ? "active" : ""} onClick={() => setView("leads")}>Leads</button></div></div>
      {view === "bookings" && <div className="bookings-date-rail" aria-label="Select booking date">{dates.map((option) => { const item = dateAtNoon(option); return <button type="button" key={option} className={date === option ? "date-active" : ""} onClick={() => setDate(option)}><small>{item.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</small><strong>{item.getDate()}</strong>{date === option && <i />}</button>; })}<label><CalendarDays /><input aria-label="Choose booking date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>}
      <div className="bookings-metric-row" aria-label="Booking metrics"><article><span className="bookings-metric-icon coral"><CalendarDays /></span><div><small>{view === "bookings" ? "REQUESTS" : "LEADS"}</small><strong>{rows.length}</strong><p>{view === "bookings" ? "on selected date" : "in progress"}</p></div></article><article><span className="bookings-metric-icon violet"><Users /></span><div><small>TEAMS ASSIGNED</small><strong>{assigned}<em>/{rows.length}</em></strong><p>{rows.length - assigned ? `${rows.length - assigned} needs a team` : "Everything covered"}</p></div></article><article><span className="bookings-metric-icon green"><CreditCard /></span><div><small>CARDS ON FILE</small><strong>{cards}<em>/{rows.length}</em></strong><p>{rows.length - cards ? `${rows.length - cards} not started` : "All secured"}</p></div></article><article><span className="bookings-metric-icon gold">$</span><div><small>REQUESTED REVENUE</small><strong>${(revenueCents / 100).toLocaleString()}</strong><p>first-clean totals</p></div></article></div>
      <div className="bookings-toolbar"><div className="bookings-search-box"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, address, or request number" /></div>{view === "bookings" ? <div className="bookings-status-tabs">{(["All", "Confirmed", "Needs attention", "Completed"] as const).map((option) => <button type="button" key={option} className={status === option ? "active" : ""} onClick={() => setStatus(option)}>{option}</button>)}</div> : <div className="bookings-status-tabs"><button type="button" className="active">Lead / In progress</button></div>}<button type="button" className="bookings-filter-button" disabled><Filter />Filters</button></div>
      <div className="bookings-list" aria-label={view === "bookings" ? "Native LeadFlow bookings list" : "Native LeadFlow leads list"}><div className="bookings-list-head"><span>TIME & CUSTOMER</span><span>SERVICE</span><span>TEAM</span><span>PAYMENT</span><span>TOTAL</span><span /></div>{(listQuery.isLoading || funnelListQuery.isLoading) ? <div className="bookings-empty-day"><Loader2 className="animate-spin" /><h3>Loading {view}</h3></div> : (listQuery.error || funnelListQuery.error) ? <div className="bookings-empty-day"><X /><h3>Could not load {view}</h3><p>{listQuery.error?.message ?? funnelListQuery.error?.message}</p></div> : rows.length ? rows.map((row) => { const home = row.bedrooms === null || row.bathrooms === null ? "Details in progress" : row.bedrooms === 0 ? `Studio · ${row.bathrooms} baths` : `${row.bedrooms} bed · ${row.bathrooms} baths`; const hasCard = row.paymentStatus === "card_on_file"; return <button type="button" className={activeKey === row.key ? "bookings-row selected" : "bookings-row"} key={row.key} onClick={() => setActiveKey(row.key)}><span className="bookings-customer-cell"><b>{row.requestedLocalTime ? displayTime(row.requestedLocalTime) : "Lead"}</b><i className={row.status === "lead" || row.status === "needs_attention" ? "bookings-status-dot attention" : "bookings-status-dot"} /><span><strong>{row.customerName}</strong><small><MapPin /> {row.address ?? "Details in progress"}</small></span></span><span className="bookings-service-cell"><strong>{row.serviceName ?? "Booking lead"}</strong><small>{home}{row.recurrence ? ` · ${labelRecurrence(row.recurrence)}` : ""}</small>{row.source === "funnel" ? <em>{labelStatus(row.status)}</em> : row.extras.length > 0 && <em>+{row.extras.length} extra{row.extras.length > 1 ? "s" : ""}</em>}</span><span className="bookings-team-cell"><i className="bookings-team-avatar gray">?</i><span><strong>Unassigned</strong><small>Needs review</small></span></span><span className={hasCard ? "bookings-payment-ok" : "bookings-payment-missing"}><CreditCard />{hasCard ? "Card on file" : "Not started"}</span><strong className="bookings-row-price">{row.firstCleaningTotalCents === null ? "—" : `$${(row.firstCleaningTotalCents / 100).toFixed(0)}`}</strong><MoreHorizontal /></button>; }) : <div className="bookings-empty-day"><CalendarDays /><h3>No {view} found</h3><p>{view === "bookings" ? "Try another date or clear your filters." : "New phone-captured leads will appear here."}</p></div>}</div>
    </section>
    {active && <aside className="bookings-detail-panel" aria-label={`Booking details for ${active.customerName}`}><header><div><small>{active.publicNumber}</small><h2>{active.customerName}</h2><span className={active.status === "lead" || active.status === "needs_attention" ? "bookings-detail-status attention" : "bookings-detail-status"}>{labelStatus(active.status)}</span></div><button type="button" onClick={() => setActiveKey(null)} aria-label="Close booking detail panel"><X /></button></header><div className="bookings-detail-scroll"><section className="bookings-detail-summary"><div><CalendarDays /><span><small>REQUESTED TIME</small><strong>{active.requestedLocalTime && active.requestedLocalDate ? `${displayTime(active.requestedLocalTime)} · ${displayDate(active.requestedLocalDate)}` : "Not selected yet"}</strong></span></div><div><MapPin /><span><small>ADDRESS</small><strong>{active.address ?? "Not entered yet"}</strong></span></div></section><section className="bookings-editor-section"><div className="bookings-section-title"><div><small>SERVICE & EXTRAS</small><h3>{active.serviceName ?? "Booking details in progress"}</h3></div><strong>{active.firstCleaningTotalCents === null ? "—" : `$${(active.firstCleaningTotalCents / 100).toFixed(0)}`}</strong></div><p className="bookings-home-line">{active.bedrooms === null || active.bathrooms === null ? "Room details not entered yet" : `${active.bedrooms === 0 ? "Studio" : `${active.bedrooms} bedrooms`} · ${active.bathrooms} bathrooms`}</p><div className="bookings-selected-extras">{active.extras.length ? active.extras.map((extra) => <button type="button" disabled key={extra.id}>{extra.label}{extra.quantity > 1 ? ` × ${extra.quantity}` : ""}</button>) : <button type="button" disabled>Nothing extra</button>}</div></section><section className="bookings-editor-section"><small>RECURRING PREFERENCE</small><div className="bookings-choice-grid"><button type="button" className="choice-active" disabled>{active.recurrence ? labelRecurrence(active.recurrence) : "Not selected"}{active.recurrence && active.recurrence !== "one-time" && <span>Intent pending</span>}</button></div><p className="bookings-editor-hint">{!active.recurrence ? "Preference not entered yet." : active.recurrence === "one-time" ? "One-time request." : "No future visits were created. Confirm the recurring plan during review."}</p></section><section className="bookings-editor-section"><small>ASSIGNED TEAM</small><div className="bookings-team-select"><button type="button" className="bookings-team-option active" disabled><i className="bookings-team-avatar gray">?</i><span><strong>Unassigned</strong><small>Assignment is not connected in this release</small></span></button></div></section><section className="bookings-editor-section"><small>PAYMENT</small>{active.source === "booking" && active.firstCleaningTotalCents !== null ? <BookingPaymentActions bookingId={active.id} totalCents={active.firstCleaningTotalCents} paymentStatus={active.paymentStatus} /> : <div className="bookings-card-panel missing"><CreditCard /><div><strong>Payment not started</strong><p>Card collection is not connected for this in-progress lead.</p></div></div>}</section><section className="bookings-editor-section"><small>CUSTOMER</small><p className="bookings-home-line">{active.customerPhone}<br />{active.customerEmail ?? "Email not entered yet"}</p></section><section className="bookings-editor-section"><small>NOTES & SPECIAL REQUESTS</small><textarea value={active.specialRequestNotes.join("\n")} readOnly placeholder="No special requests" /><div className="bookings-customer-actions"><button type="button" disabled><MessageCircle />Text customer</button><button type="button" disabled><CalendarDays />Reschedule</button></div></section></div><footer><button type="button" className="bookings-cancel-button" disabled>Cancel booking</button><button type="button" className="bookings-save-button" disabled>Save changes</button></footer></aside>}
  </main>;
}
