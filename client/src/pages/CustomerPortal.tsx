import { useMemo, useState } from "react";
import { Armchair, ArrowRight, CalendarClock, CalendarDays, CheckCircle2, ClipboardList, CreditCard, Home, MapPin, Plus, ShieldCheck, Sparkles, Trash2, Truck, Waves, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { CUSTOMER_PORTAL_SERVICES, type CustomerPortalService } from "@shared/customerPortalServices";
import { calculateCustomerPortalEstimate } from "@shared/customerPortalPricing";
import { CustomerPortalAppointmentCalendar } from "@/components/CustomerPortalAppointmentCalendar";
import { customerPortalAppointmentWindows, formatCustomerPortalDate, formatCustomerPortalDateKey, formatCustomerPortalTime, type CustomerPortalAppointmentWindow } from "@/lib/customerPortalAppointment";
import BookNow from "./BookNow";
import "./customer-portal.css";
import "./customer-portal-request-upgrades.css";

const FEATURED_SERVICE_IDS = ["furniture-assembly", "moving-help", "lawn-yard-care", "junk-removal", "pressure-washing"] as const;
const SERVICE_ICONS: Record<string, typeof Wrench> = {
  "furniture-assembly": Armchair,
  "moving-help": Truck,
  "lawn-yard-care": Waves,
  "junk-removal": Trash2,
  "pressure-washing": Waves,
};

function formatStatus(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

function formatLocalDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(parsed);
}

function formatCurrency(cents: number | null | undefined) {
  return typeof cents === "number" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100) : "—";
}

function ServiceRequestForm({ service, homeAddress, onClose }: { service: CustomerPortalService; homeAddress: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const createRequest = trpc.customerPortal.createRequest.useMutation({ onSuccess: () => { void utils.customerPortal.me.invalidate(); onClose(); } });
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [useDifferentAddress, setUseDifferentAddress] = useState(false);
  const [address, setAddress] = useState(homeAddress);
  const [date, setDate] = useState<Date | null>(null);
  const [timeWindow, setTimeWindow] = useState<CustomerPortalAppointmentWindow | null>(null);
  const [notes, setNotes] = useState("");
  const selectedAddress = useDifferentAddress || !homeAddress ? address.trim() : homeAddress;
  const canSubmit = service.fields.every(field => selections[field.label]?.trim()) && selectedAddress.length >= 5 && Boolean(date) && Boolean(timeWindow);
  const estimate = calculateCustomerPortalEstimate(service.id, selections);

  return <div className="mib-portal-modal" role="dialog" aria-modal="true" aria-labelledby="mib-service-title">
    <div className="mib-portal-modal-card">
      <button className="mib-portal-close" type="button" onClick={onClose} aria-label="Close request form">×</button>
      <small>MAIDS IN BLACK · HOME SERVICES</small>
      <h2 id="mib-service-title">Book {service.name}</h2>
      <p>{service.detail}.</p>
      <div className="mib-portal-form-fields">
        {service.fields.map(field => <label key={field.label}><span>{field.label}</span>{field.options ? <select value={selections[field.label] ?? ""} onChange={event => setSelections(current => ({ ...current, [field.label]: event.target.value }))}><option value="">Choose one</option>{field.options.map(option => <option key={option}>{option}</option>)}</select> : <textarea placeholder={field.placeholder} value={selections[field.label] ?? ""} onChange={event => setSelections(current => ({ ...current, [field.label]: event.target.value }))} />}</label>)}
        {homeAddress && !useDifferentAddress ? <div className="mib-portal-address-choice"><span>Service address</span><strong>{homeAddress}</strong><button type="button" onClick={() => setUseDifferentAddress(true)}>Use a different address</button></div> : <label><span>Service address</span><input value={address} onChange={event => setAddress(event.target.value)} placeholder="Street address" autoComplete="street-address" />{homeAddress && <button className="mib-portal-inline-text-action" type="button" onClick={() => { setAddress(homeAddress); setUseDifferentAddress(false); }}>Use my home-cleaning address</button>}</label>}
        <div className="mib-portal-appointment-field"><div className="mib-portal-appointment-field-head"><span>Preferred appointment</span><small>We&apos;ll confirm this window before dispatch.</small></div><CustomerPortalAppointmentCalendar value={date} onChange={nextDate => setDate(nextDate)} /><div className="mib-portal-time-window-grid" role="group" aria-label="Choose a preferred time window">{customerPortalAppointmentWindows.map(window => <button type="button" key={window.id} className={timeWindow?.id === window.id ? "selected" : ""} onClick={() => setTimeWindow(window)} aria-pressed={timeWindow?.id === window.id}><strong>{window.label}</strong><span>{window.detail}</span></button>)}</div>{date && <p className="mib-portal-appointment-selection">Preferred: <strong>{formatCustomerPortalDate(date)}{timeWindow ? ` · ${formatCustomerPortalTime(timeWindow)}` : ""}</strong></p>}</div>
        <label><span>Anything else?</span><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Optional details" /></label>
      </div>
      <div className="mt-4 grid gap-1 rounded-[17px] border border-[#e9e6e0] bg-[#f7f5f1] p-[18px]">
        <span className="text-[11px] font-extrabold uppercase tracking-[.09em] text-[#746f69]">{estimate.requiresReview ? "Estimate · review required" : "Estimated total"}</span>
        <strong className="text-[30px] tracking-[-.04em] text-[#202020]">{formatCurrency(estimate.estimatedCents)}</strong>
        <small className="text-[12px] leading-5 text-[#746f69]">{estimate.requiresReview ? "This scope needs a Maids in Black review before a final price or appointment is confirmed." : "Based on your selected scope. Maids in Black confirms the final price before payment."}</small>
        {estimate.lineItems.length > 1 && <div className="mt-2 grid gap-1 border-t border-[#e1ddd6] pt-2">{estimate.lineItems.slice(1).map(item => <span className="flex justify-between gap-3 text-[11px] font-semibold text-[#746f69]" key={item.label}>{item.label}<b className="text-[#202020]">+{formatCurrency(item.cents)}</b></span>)}</div>}
      </div>
      {createRequest.error && <p className="mib-portal-error">{createRequest.error.message}</p>}
      <button type="button" className="mib-portal-primary" disabled={!canSubmit || createRequest.isPending} onClick={() => { if (!date || !timeWindow) return; createRequest.mutate({ serviceId: service.id, selections, address: selectedAddress, requestedLocalDate: formatCustomerPortalDateKey(date), requestedLocalTime: formatCustomerPortalTime(timeWindow), notes: notes || undefined }); }}>{createRequest.isPending ? "Sending request…" : "Send service request"}<ArrowRight /></button>
    </div>
  </div>;
}

export default function CustomerPortal() {
  const [selectedService, setSelectedService] = useState<CustomerPortalService | null>(null);
  const [showAllServices, setShowAllServices] = useState(false);
  const [showCleaningRebook, setShowCleaningRebook] = useState(false);
  const utils = trpc.useUtils();
  const portal = trpc.customerPortal.me.useQuery();

  const featuredServices = useMemo(() => FEATURED_SERVICE_IDS.map(id => CUSTOMER_PORTAL_SERVICES.find(service => service.id === id)).filter((service): service is CustomerPortalService => Boolean(service)), []);
  const visibleServices = showAllServices ? CUSTOMER_PORTAL_SERVICES : featuredServices;
  const activeCleanings = useMemo(() => (portal.data?.cleanings ?? []).filter(cleaning => !["completed", "cancelled", "canceled"].includes(cleaning.status)), [portal.data?.cleanings]);
  const nextCleaning = useMemo(() => [...activeCleanings].sort((left, right) => left.requestedLocalDate.localeCompare(right.requestedLocalDate))[0], [activeCleanings]);

  if (portal.isLoading) return <main className="mib-portal-gate">Loading your home portal…</main>;
  if (!portal.data?.account) return <main className="mib-portal-gate"><div className="mib-portal-mark">M</div><small>MAIDS IN BLACK · MY HOME</small><h1>Everything for your home, in one place.</h1><p>Your portal opens from your booking confirmation on this device.</p><a className="mib-portal-primary" href="/book-now">Book home cleaning <ArrowRight /></a></main>;

  const totalRecords = portal.data.cleanings.length + portal.data.requests.length;
  const customerName = portal.data.account.name.split(" ")[0];
  const homeAddress = portal.data.cleanings.find(cleaning => Boolean(cleaning.address))?.address ?? "";
  const savedCardLabel = portal.data.savedCard?.last4 ? `${portal.data.savedCard.brand ? `${portal.data.savedCard.brand} ` : "Card "}ending in ${portal.data.savedCard.last4}` : "No saved card on file";
  const closeCleaningRebook = () => { setShowCleaningRebook(false); void utils.customerPortal.me.invalidate(); };

  return <main className="mib-portal-shell">
    <header className="mib-portal-topbar"><a href="/my-home"><span className="mib-portal-mark">M</span> Maids in Black</a><b>{customerName}</b></header>
    <section className="mib-portal-hero">
      <div><small>MY HOME · MAIDS IN BLACK</small><h1>Welcome back, {customerName}.</h1><p>Your home requests, timing, and updates are all here.</p></div>
      <button className="mib-portal-primary" type="button" onClick={() => setShowCleaningRebook(true)}><Plus /> Book home cleaning</button>
    </section>
    <section className="mib-portal-stats" aria-label="Account summary">
      <article><ClipboardList /><div><span>Active bookings</span><strong>{activeCleanings.length}</strong></div></article>
      <article><CalendarClock /><div><span>Next visit</span><strong>{nextCleaning ? formatLocalDate(nextCleaning.requestedLocalDate) : "—"}</strong></div></article>
      <article><ShieldCheck /><div><span>Account access</span><strong>This device</strong></div></article>
    </section>
    <section className="mib-portal-section mib-portal-discovery" aria-labelledby="mib-services-heading">
      <div className="mib-portal-heading">
        <div><small>MORE MAIDS IN BLACK CAN HANDLE</small><h2 id="mib-services-heading">What else can we take off your list?</h2></div>
        <button className="mib-portal-text-action" type="button" onClick={() => setShowAllServices(current => !current)} aria-expanded={showAllServices}>{showAllServices ? "Show fewer services" : "View all services"} <ArrowRight /></button>
      </div>
      <div className="mib-portal-services">
        <button className="mib-portal-service mib-portal-service-cleaning" type="button" onClick={() => setShowCleaningRebook(true)}><div className="mib-portal-service-icon"><Home /></div><div><strong>Home cleaning</strong><p>One-time or recurring</p><em>Book cleaning <ArrowRight /></em></div></button>
        {visibleServices.map(service => {
          const Icon = SERVICE_ICONS[service.id] ?? Wrench;
          return <button className="mib-portal-service" type="button" key={service.id} onClick={() => setSelectedService(service)}><div className="mib-portal-service-icon"><Icon /></div><div><strong>{service.name}</strong><p>{service.detail}</p><span className="block mb-1 text-[11px] font-bold text-[#202020]">Starting at {formatCurrency(service.startingPrice * 100)}</span><em>Start request <ArrowRight /></em></div></button>;
        })}
      </div>
    </section>
    <section className="mib-portal-section mib-portal-bookings" aria-labelledby="mib-bookings-heading">
      <div className="mib-portal-heading"><div><small>YOUR BOOKINGS</small><h2 id="mib-bookings-heading">Everything we&apos;re handling for you.</h2></div>{totalRecords > 0 && <span>{totalRecords} {totalRecords === 1 ? "request" : "requests"}</span>}</div>
      <div className="mib-portal-records">
        {totalRecords === 0 ? <div className="mib-portal-empty"><Sparkles /><h3>Your home history starts here.</h3><p>Your cleaning and service requests will appear here.</p></div> : <>
          {portal.data.requests.map(request => <article className="mib-portal-booking-card" key={`request-${request.id}`}><div className="mib-portal-booking-top"><div><small>HOME SERVICE REQUEST</small><h3>{request.serviceName}</h3><span className="mib-portal-status">{formatStatus(request.status)}</span></div><div className="mib-portal-price"><span>{request.estimateRequiresReview ? "Estimate · review required" : "Estimated total"}</span><strong>{formatCurrency(request.estimatedTotalCents)}</strong></div></div><div className="mib-portal-booking-grid"><div><CalendarDays /><span>PREFERRED APPOINTMENT</span><strong>{formatLocalDate(request.requestedLocalDate)} · {request.requestedLocalTime}</strong><p>Your preferred time is awaiting confirmation.</p></div><div><MapPin /><span>LOCATION</span><strong>{request.address}</strong><p>{request.customerRequest}</p></div><div><CreditCard /><span>PAYMENT</span><strong>{savedCardLabel}</strong><p>{portal.data.savedCard?.last4 ? "Your saved card is securely on file. No charge today." : "A payment method has not been saved."}</p></div></div><div className="mib-portal-booking-footer"><div><i />{request.publicRequestNumber ? `Request ${request.publicRequestNumber} saved` : "Request saved"}</div><span>{formatStatus(request.status)}</span></div></article>)}
          {portal.data.cleanings.map(cleaning => <article className="mib-portal-booking-card" key={`cleaning-${cleaning.id}`}>
            <div className="mib-portal-booking-top"><div><small>HOME CLEANING</small><h3>{cleaning.serviceName}</h3><span className="mib-portal-status">{formatStatus(cleaning.status)}</span></div><div className="mib-portal-price"><span>First cleaning</span><strong>{formatCurrency(cleaning.firstCleaningTotalCents)}</strong></div></div>
            <div className="mib-portal-booking-grid"><div><CalendarDays /><span>PREFERRED APPOINTMENT</span><strong>{formatLocalDate(cleaning.requestedLocalDate)}{cleaning.requestedLocalTime ? ` · ${cleaning.requestedLocalTime}` : ""}</strong><p>{cleaning.status === "needs_attention" ? "Your appointment is awaiting confirmation." : "We will keep you updated here."}</p></div><div><MapPin /><span>LOCATION</span><strong>{cleaning.address || "Address saved with booking"}</strong><p>We will confirm the right cleaning team for your home.</p></div><div><CreditCard /><span>PAYMENT</span><strong>{cleaning.paymentStatus === "card_on_file" ? "Card on file" : formatStatus(cleaning.paymentStatus)}</strong><p>{cleaning.paymentStatus === "card_on_file" ? "Your card is securely saved. No charge today." : "Payment status is saved with this booking."}</p></div></div>
            <div className="mib-portal-booking-footer"><div><i />{cleaning.publicBookingNumber ? `Booking ${cleaning.publicBookingNumber} saved` : "Booking saved"}</div><span>{formatStatus(cleaning.status)}</span></div>
          </article>)}
        </>}
      </div>
    </section>
    {selectedService && <ServiceRequestForm service={selectedService} homeAddress={homeAddress} onClose={() => setSelectedService(null)} />}
    {showCleaningRebook && <div className="mib-portal-rebook-overlay" role="dialog" aria-modal="true" aria-label="Rebook home cleaning"><BookNow portalRebook={{ customerName: portal.data.account.name, phone: portal.data.account.phone, email: portal.data.account.email, address: homeAddress }} onClose={closeCleaningRebook} /></div>}
  </main>;
}
