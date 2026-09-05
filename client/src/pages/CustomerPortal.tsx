import { useMemo, useState } from "react";
import { Armchair, ArrowRight, Bell, CalendarClock, CalendarDays, CheckCircle2, ChevronDown, CircleHelp, ClipboardList, CreditCard, Grid2X2, Home, MapPin, Plus, ReceiptText, ShieldCheck, Sparkles, Trash2, Truck, Waves, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Elements, CardElement } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CARD_ELEMENT_OPTIONS, useStripeCardSetup } from "@/components/useStripeCardSetup";
import { CUSTOMER_PORTAL_SERVICES, type CustomerPortalService } from "@shared/customerPortalServices";
import { calculateCustomerPortalEstimate } from "@shared/customerPortalPricing";
import { CustomerPortalAppointmentCalendar } from "@/components/CustomerPortalAppointmentCalendar";
import { customerPortalAppointmentWindows, formatCustomerPortalDate, formatCustomerPortalDateKey, formatCustomerPortalTime, type CustomerPortalAppointmentWindow } from "@/lib/customerPortalAppointment";
import BookNow from "./BookNow";
import "./customer-portal.css";
import "./customer-portal-request-upgrades.css";
import "./customer-portal-dashboard.css";
import "./customer-portal-dashboard-overrides.css";

const FEATURED_SERVICE_IDS = ["furniture-assembly", "moving-help", "lawn-yard-care", "junk-removal", "pressure-washing"] as const;
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);
const SERVICE_ICONS: Record<string, typeof Wrench> = {
  "furniture-assembly": Armchair,
  "moving-help": Truck,
  "lawn-yard-care": Waves,
  "junk-removal": Trash2,
  "pressure-washing": Waves,
};
const SERVICE_IMAGE_URLS: Record<string, string> = {
  "furniture-assembly": "/manus-storage/maids-in-black-service-furniture-assembly_3aabfbd7.png",
  "moving-help": "/manus-storage/maids-in-black-service-moving-help_a58ca741.png",
  "lawn-yard-care": "/manus-storage/maids-in-black-service-lawn-yard_c8ae902e.png",
  "junk-removal": "/manus-storage/maids-in-black-service-junk-removal_d80019ac.png",
  "pressure-washing": "/manus-storage/maids-in-black-service-pressure-washing_af6e8f2b.png",
};
const PORTAL_HERO_IMAGE = "/manus-storage/maids-in-black-portal-hero-living-room_24258f28.png";

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

function PortalNewCardForm({ clientSecret, setupIntentId, customerName, onSaved }: { clientSecret: string; setupIntentId: string; customerName: string; onSaved: (card: { brand: string; last4: string }) => void }) {
  const confirmNewCardSetup = trpc.customerPortal.confirmNewCardSetup.useMutation();
  const { stripeReady, name, setName, cardError, loading, handleSubmit } = useStripeCardSetup({ clientSecret, prefillName: customerName, onSetupSucceeded: async paymentMethodId => {
    const card = await confirmNewCardSetup.mutateAsync({ setupIntentId, paymentMethodId });
    onSaved(card);
  } });
  return <form className="mib-portal-new-card-form" onSubmit={handleSubmit}><label><span>Name on card</span><input required value={name} onChange={event => setName(event.target.value)} autoComplete="cc-name" /></label><label><span>Card details</span><div className="mib-portal-card-element"><CardElement options={CARD_ELEMENT_OPTIONS} /></div></label>{cardError && <p className="mib-portal-error">{cardError}</p>}<button className="mib-portal-primary" type="submit" disabled={!stripeReady || loading || confirmNewCardSetup.isPending}>{loading || confirmNewCardSetup.isPending ? "Saving secure card…" : "Save new card"}<ArrowRight /></button></form>;
}

function ServiceRequestForm({ service, homeAddress, savedCard, customerName, onClose }: { service: CustomerPortalService; homeAddress: string; savedCard: { brand: string | null; last4: string } | null; customerName: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const createRequest = trpc.customerPortal.createRequest.useMutation({ onSuccess: () => { void utils.customerPortal.me.invalidate(); onClose(); } });
  const startNewCardSetup = trpc.customerPortal.startNewCardSetup.useMutation();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [useDifferentAddress, setUseDifferentAddress] = useState(false);
  const [address, setAddress] = useState(homeAddress);
  const [date, setDate] = useState<Date | null>(null);
  const [timeWindow, setTimeWindow] = useState<CustomerPortalAppointmentWindow | null>(null);
  const [notes, setNotes] = useState("");
  const [paymentChoice, setPaymentChoice] = useState<"saved" | "new">(savedCard ? "saved" : "new");
  const [activeCard, setActiveCard] = useState(savedCard);
  const [newCardSetup, setNewCardSetup] = useState<{ clientSecret: string; setupIntentId: string } | null>(null);
  const selectedAddress = useDifferentAddress || !homeAddress ? address.trim() : homeAddress;
  const canSubmit = service.fields.every(field => selections[field.label]?.trim()) && selectedAddress.length >= 5 && Boolean(date) && Boolean(timeWindow) && Boolean(activeCard);
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
      {!newCardSetup && <div className="mib-portal-payment-choice" role="radiogroup" aria-label="Payment method"><button type="button" role="radio" aria-checked={paymentChoice === "saved"} disabled={!activeCard} onClick={() => setPaymentChoice("saved")} className={paymentChoice === "saved" ? "selected" : ""}><CreditCard /><span><strong>{activeCard ? `Use ${activeCard.brand ? `${activeCard.brand} ` : "card "}ending in ${activeCard.last4}` : "No saved card available"}</strong><small>{activeCard ? "Selected by default · no charge today" : "Add a new card to continue"}</small></span></button><button type="button" role="radio" aria-checked={paymentChoice === "new"} onClick={() => { setPaymentChoice("new"); setNewCardSetup(null); }} className={paymentChoice === "new" ? "selected" : ""}><CreditCard /><span><strong>Add a new card</strong><small>Use a different payment method for this request</small></span></button></div>}
      {paymentChoice === "new" && !newCardSetup && <button type="button" className="mib-portal-secondary-action" disabled={startNewCardSetup.isPending} onClick={() => { void startNewCardSetup.mutateAsync().then(setNewCardSetup); }}>{startNewCardSetup.isPending ? "Preparing secure card entry…" : "Continue to secure card entry"}<ArrowRight /></button>}
      {newCardSetup && <Elements stripe={stripePromise} options={{ clientSecret: newCardSetup.clientSecret, appearance: { theme: "stripe" } }}><PortalNewCardForm clientSecret={newCardSetup.clientSecret} setupIntentId={newCardSetup.setupIntentId} customerName={customerName} onSaved={card => { setActiveCard(card); setPaymentChoice("saved"); setNewCardSetup(null); void utils.customerPortal.me.invalidate(); }} /></Elements>}
      {createRequest.error && <p className="mib-portal-error">{createRequest.error.message}</p>}
      {!newCardSetup && <button type="button" className="mib-portal-primary" disabled={!canSubmit || paymentChoice !== "saved" || createRequest.isPending} onClick={() => { if (!date || !timeWindow) return; createRequest.mutate({ serviceId: service.id, selections, address: selectedAddress, requestedLocalDate: formatCustomerPortalDateKey(date), requestedLocalTime: formatCustomerPortalTime(timeWindow), notes: notes || undefined }); }}>{createRequest.isPending ? "Sending request…" : "Send service request"}<ArrowRight /></button>}
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
  const scrollToSection = (sectionId: string) => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const openService = (serviceId: string) => {
    if (serviceId === "home-cleaning") { setShowCleaningRebook(true); return; }
    const service = CUSTOMER_PORTAL_SERVICES.find(candidate => candidate.id === serviceId);
    if (service) setSelectedService(service);
  };

  return <main className="mib-portal-shell">
    <header className="mib-portal-topbar"><a href="/my-home"><span className="mib-portal-mark">M<i /></span><span><strong>Maids in Black</strong><small>Your home, managed in one place.</small></span></a><div className="mib-portal-topbar-actions"><span className="mib-portal-notification" aria-label="Notifications"><Bell /><i /></span><span className="mib-portal-customer-mark">{customerName.charAt(0).toUpperCase()}</span><b>{customerName}</b><ChevronDown /></div></header>
    <div className="mib-portal-layout">
      <aside className="mib-portal-sidebar" aria-label="Portal sections">
        <button className="active" type="button" onClick={() => scrollToSection("mib-home")}><Home /><span>Home</span></button>
        <button type="button" onClick={() => scrollToSection("mib-bookings")}><CalendarDays /><span>My bookings</span></button>
        <button type="button" onClick={() => scrollToSection("mib-services")}><Grid2X2 /><span>Services</span></button>
        <button type="button" onClick={() => scrollToSection("mib-bookings")}><ReceiptText /><span>Payments</span></button>
        <span className="mib-portal-sidebar-help"><CircleHelp /><span>Need help?<br />Contact us</span></span>
      </aside>
      <div className="mib-portal-content">
        <section className="mib-portal-hero" id="mib-home">
          <div className="mib-portal-hero-copy"><small>MY HOME</small><h1>Welcome back,<br />{customerName}.</h1><p>Your home requests, timing, and updates are all here.</p><div className="mib-portal-hero-actions"><button className="mib-portal-primary" type="button" onClick={() => setShowCleaningRebook(true)}><Plus /> Book home cleaning</button><button className="mib-portal-hero-secondary" type="button" onClick={() => scrollToSection("mib-services")}>Browse all services <ArrowRight /></button></div></div>
          <div className="mib-portal-hero-media"><img src={PORTAL_HERO_IMAGE} alt="A calm, light-filled home" /><div><span>A cleaner<br />home for a<br />calmer you.</span><i /></div></div>
        </section>
        <section className="mib-portal-stats" aria-label="Account summary">
          <article><ClipboardList /><div><strong>{activeCleanings.length}</strong><span>Active bookings</span><button type="button" onClick={() => scrollToSection("mib-bookings")}>View and manage <ArrowRight /></button></div></article>
          <article><CalendarClock /><div><strong>{nextCleaning ? formatLocalDate(nextCleaning.requestedLocalDate) : "—"}</strong><span>Next visit</span><button type="button" onClick={() => scrollToSection("mib-bookings")}>See details <ArrowRight /></button></div></article>
          <article><ShieldCheck /><div><strong>This device</strong><span>Account access</span><em className="mib-portal-stat-note">Secure portal access</em></div></article>
        </section>
        <section className="mib-portal-section mib-portal-discovery" id="mib-services" aria-labelledby="mib-services-heading">
          <div className="mib-portal-heading"><div><small>MORE MAIDS IN BLACK CAN HANDLE</small><h2 id="mib-services-heading">What else can we take off your list?</h2><p>Book trusted help without searching, calling around, or chasing quotes.</p></div><button className="mib-portal-text-action" type="button" onClick={() => setShowAllServices(current => !current)} aria-expanded={showAllServices}>{showAllServices ? "Show fewer services" : "View all services"} <ArrowRight /></button></div>
          <div className="mib-portal-services">
            <button className="mib-portal-service mib-portal-service-cleaning" type="button" onClick={() => setShowCleaningRebook(true)}><div className="mib-portal-service-content"><div className="mib-portal-service-icon"><Home /></div><div><strong>Home cleaning</strong><p>One-time or recurring</p></div><ul><li>Trusted, vetted cleaners</li><li>Same great quality</li><li>Flexible scheduling</li></ul><em>Book cleaning <ArrowRight /></em></div><img className="mib-portal-service-media" src={PORTAL_HERO_IMAGE} alt="Freshly prepared bedroom" /></button>
            {visibleServices.map(service => { const Icon = SERVICE_ICONS[service.id] ?? Wrench; return <button className={`mib-portal-service mib-portal-service-${service.id}`} type="button" key={service.id} onClick={() => setSelectedService(service)}><img className="mib-portal-service-media" src={SERVICE_IMAGE_URLS[service.id]} alt="" /><div className="mib-portal-service-content"><div className="mib-portal-service-icon"><Icon /></div><div><strong>{service.name}</strong><p>{service.detail}</p><span>Starting at {formatCurrency(service.startingPrice * 100)}</span><em>Start request <ArrowRight /></em></div></div></button>; })}
          </div>
        </section>
        <section className="mib-portal-ask-panel" aria-label="Need a different service"><div><small>DON&apos;T SEE WHAT YOU NEED?</small><h2>Just tell us.</h2><p>We&apos;ll help you find the right home service.</p></div><div><button className="mib-portal-ask-launcher" type="button" onClick={() => { setShowAllServices(true); scrollToSection("mib-services"); }}><Sparkles /><span>Browse all available services</span><ArrowRight /></button><div className="mib-portal-quick-services"><button type="button" onClick={() => openService("home-cleaning")}>Cleaning</button><button type="button" onClick={() => openService("furniture-assembly")}>Assembly</button><button type="button" onClick={() => openService("lawn-yard-care")}>Yard</button><button type="button" onClick={() => openService("moving-help")}>Moving</button></div></div></section>
        <section className="mib-portal-section mib-portal-bookings" id="mib-bookings" aria-labelledby="mib-bookings-heading">
      <div className="mib-portal-heading"><div><small>YOUR BOOKINGS</small><h2 id="mib-bookings-heading">Everything we&apos;re handling for you.</h2></div>{totalRecords > 0 && <span>{totalRecords} {totalRecords === 1 ? "request" : "requests"}</span>}</div>
      <div className="mib-portal-records">
        {totalRecords === 0 ? <div className="mib-portal-empty"><Sparkles /><h3>Your home history starts here.</h3><p>Your cleaning and service requests will appear here.</p></div> : <>
          {portal.data.requests.map(request => <article className="mib-portal-booking-card" key={`request-${request.id}`}><div className="mib-portal-booking-top"><div><small>HOME SERVICE REQUEST</small><h3>{request.serviceName}</h3><span className="mib-portal-status">{formatStatus(request.status)}</span></div><div className="mib-portal-price"><span>{request.estimateRequiresReview ? "Estimate · review required" : "Estimated total"}</span><strong>{formatCurrency(request.estimatedTotalCents)}</strong></div></div><div className="mib-portal-booking-grid"><div><CalendarDays /><span>PREFERRED APPOINTMENT</span><strong>{formatLocalDate(request.requestedLocalDate)} · {request.requestedLocalTime}</strong><p>Your preferred time is awaiting confirmation.</p></div><div><MapPin /><span>LOCATION</span><strong>{request.address}</strong><p>{request.customerRequest}</p></div><div><CreditCard /><span>PAYMENT</span><strong>{request.paymentLast4 ? `${request.paymentBrand ? `${request.paymentBrand} ` : "Card "}ending in ${request.paymentLast4}` : savedCardLabel}</strong><p>{request.paymentLast4 ? "Your selected card is securely on file. No charge today." : "A payment method has not been saved."}</p></div></div><div className="mib-portal-booking-footer"><div><i />{request.publicRequestNumber ? `Request ${request.publicRequestNumber} saved` : "Request saved"}</div><span>{formatStatus(request.status)}</span></div></article>)}
          {portal.data.cleanings.map(cleaning => <article className="mib-portal-booking-card" key={`cleaning-${cleaning.id}`}>
            <div className="mib-portal-booking-top"><div><small>HOME CLEANING</small><h3>{cleaning.serviceName}</h3><span className="mib-portal-status">{formatStatus(cleaning.status)}</span></div><div className="mib-portal-price"><span>First cleaning</span><strong>{formatCurrency(cleaning.firstCleaningTotalCents)}</strong></div></div>
            <div className="mib-portal-booking-grid"><div><CalendarDays /><span>PREFERRED APPOINTMENT</span><strong>{formatLocalDate(cleaning.requestedLocalDate)}{cleaning.requestedLocalTime ? ` · ${cleaning.requestedLocalTime}` : ""}</strong><p>{cleaning.status === "needs_attention" ? "Your appointment is awaiting confirmation." : "We will keep you updated here."}</p></div><div><MapPin /><span>LOCATION</span><strong>{cleaning.address || "Address saved with booking"}</strong><p>We will confirm the right cleaning team for your home.</p></div><div><CreditCard /><span>PAYMENT</span><strong>{cleaning.paymentStatus === "card_on_file" ? "Card on file" : formatStatus(cleaning.paymentStatus)}</strong><p>{cleaning.paymentStatus === "card_on_file" ? "Your card is securely saved. No charge today." : "Payment status is saved with this booking."}</p></div></div>
            <div className="mib-portal-booking-footer"><div><i />{cleaning.publicBookingNumber ? `Booking ${cleaning.publicBookingNumber} saved` : "Booking saved"}</div><span>{formatStatus(cleaning.status)}</span></div>
          </article>)}
        </>}
      </div>
        </section>
      </div>
    </div>
    {selectedService && <ServiceRequestForm service={selectedService} homeAddress={homeAddress} savedCard={portal.data.savedCard} customerName={portal.data.account.name} onClose={() => setSelectedService(null)} />}
    {showCleaningRebook && <div className="mib-portal-rebook-overlay" role="dialog" aria-modal="true" aria-label="Rebook home cleaning"><BookNow portalRebook={{ customerName: portal.data.account.name, phone: portal.data.account.phone, email: portal.data.account.email, address: homeAddress, savedCard: portal.data.savedCard }} onClose={closeCleaningRebook} /></div>}
  </main>;
}
