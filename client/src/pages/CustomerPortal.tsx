import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bell, CalendarClock, CalendarDays, CheckCircle2, ChevronDown, CircleHelp, ClipboardList, CreditCard, Grid2X2, Hammer, Home, Image, Lightbulb, MapPin, Menu, MessageSquare, Paintbrush, Plus, ShieldCheck, Sofa, Sparkles, SprayCan, Trash2, Truck, Tv, UserRound, Waves, Wrench } from "lucide-react";
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
import "./customer-portal-direct-ui.css";
import "./customer-portal-sidebar-pages.css";
import "./customer-portal-home-images.css";
import "./customer-portal-home-reference-refinement.css";
import "./customer-portal-login.css";

const FEATURED_SERVICE_IDS = ["furniture-assembly", "moving-help", "lawn-yard-care", "junk-removal", "pressure-washing"] as const;
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);
type PortalPage = "home" | "bookings" | "services" | "payments" | "messages" | "account";
const SERVICE_ICONS: Record<string, typeof Wrench> = {
  "tv-mounting": Tv,
  "furniture-assembly": Sofa,
  "picture-hanging": Image,
  "minor-home-repairs": Hammer,
  handyman: Wrench,
  plumbing: Wrench,
  "electrical-lighting": Lightbulb,
  "interior-painting": Paintbrush,
  "moving-help": Truck,
  "lawn-yard-care": Waves,
  "junk-removal": Trash2,
  "pressure-washing": SprayCan,
};
const SERVICE_CTAS: Record<string, string> = {
  "tv-mounting": "Mount my TV",
  "furniture-assembly": "Get it assembled",
  "picture-hanging": "Hang my pictures",
  "minor-home-repairs": "Fix it for me",
  handyman: "Book a handyman",
  plumbing: "Get plumbing help",
  "electrical-lighting": "Light it up",
  "interior-painting": "Paint my space",
  "moving-help": "Get moving",
  "lawn-yard-care": "Take care of my yard",
  "junk-removal": "Remove my junk",
  "pressure-washing": "Get it cleaned",
};
const FEATURED_CARD_DETAILS: Record<string, string> = {
  "furniture-assembly": "Small or standard item",
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

function PortalLoginGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const requestLoginCode = trpc.customerPortal.requestLoginCode.useMutation();
  const verifyLoginCode = trpc.customerPortal.verifyLoginCode.useMutation();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [resendAfterSeconds, setResendAfterSeconds] = useState(0);
  const [verificationFailed, setVerificationFailed] = useState(false);
  useEffect(() => {
    if (resendAfterSeconds <= 0) return;
    const timeout = window.setTimeout(() => setResendAfterSeconds(seconds => Math.max(0, seconds - 1)), 1_000);
    return () => window.clearTimeout(timeout);
  }, [resendAfterSeconds]);
  const requestCode = () => {
    setVerificationFailed(false);
    requestLoginCode.mutate({ phone }, { onSuccess: result => { setStage("code"); setCode(""); setResendAfterSeconds(result.resendAfterSeconds); } });
  };
  const verifyCode = () => verifyLoginCode.mutate({ phone, code }, { onSuccess: result => { if (!result.ok) { setVerificationFailed(true); return; } onAuthenticated(); } });
  return <main className="mib-portal-gate mib-portal-login-gate"><div className="mib-portal-mark">M</div><small>MAIDS IN BLACK · MY HOME</small><h1>{stage === "phone" ? "Welcome back." : "Check your texts."}</h1>{stage === "phone" ? <><p>Enter the mobile number used for your Maids in Black booking and we&apos;ll send a secure sign-in code.</p><form onSubmit={event => { event.preventDefault(); requestCode(); }}><label><span>Mobile number</span><input required type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="(202) 555-0123" /></label><button className="mib-portal-primary" type="submit" disabled={requestLoginCode.isPending}>{requestLoginCode.isPending ? "Sending code…" : "Text me a sign-in code"}<ArrowRight /></button></form><p className="mib-portal-login-note">If that number is eligible, a sign-in code is on its way.</p></> : <><p>We sent a six-digit sign-in code to the number you entered. It expires in 10 minutes.</p><form onSubmit={event => { event.preventDefault(); verifyCode(); }}><label><span>Six-digit code</span><input required type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setVerificationFailed(false); }} placeholder="000000" /></label>{verificationFailed && <p className="mib-portal-error">That code could not be verified. Try again or request a new code.</p>}<button className="mib-portal-primary" type="submit" disabled={verifyLoginCode.isPending || code.length !== 6}>{verifyLoginCode.isPending ? "Signing in…" : "Open my portal"}<ArrowRight /></button></form><div className="mib-portal-login-actions"><button type="button" onClick={() => { setStage("phone"); setCode(""); setVerificationFailed(false); }}>Use a different number</button><button type="button" disabled={resendAfterSeconds > 0 || requestLoginCode.isPending} onClick={requestCode}>{resendAfterSeconds > 0 ? `Resend in ${resendAfterSeconds}s` : "Resend code"}</button></div></>}<a className="mib-portal-login-book" href="/book-now">Book home cleaning <ArrowRight /></a></main>;
}

export default function CustomerPortal() {
  const [selectedService, setSelectedService] = useState<CustomerPortalService | null>(null);
  const [showCleaningRebook, setShowCleaningRebook] = useState(false);
  const [activePage, setActivePage] = useState<PortalPage>("home");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [newCardSetup, setNewCardSetup] = useState<{ clientSecret: string; setupIntentId: string } | null>(null);
  const utils = trpc.useUtils();
  const portal = trpc.customerPortal.me.useQuery();
  const startNewCardSetup = trpc.customerPortal.startNewCardSetup.useMutation();

  const featuredServices = useMemo(() => FEATURED_SERVICE_IDS.map(id => CUSTOMER_PORTAL_SERVICES.find(service => service.id === id)).filter((service): service is CustomerPortalService => Boolean(service)), []);
  const activeCleanings = useMemo(() => (portal.data?.cleanings ?? []).filter(cleaning => !["completed", "cancelled", "canceled"].includes(cleaning.status)), [portal.data?.cleanings]);
  const nextCleaning = useMemo(() => [...activeCleanings].sort((left, right) => left.requestedLocalDate.localeCompare(right.requestedLocalDate))[0], [activeCleanings]);

  if (portal.isLoading) return <main className="mib-portal-gate">Loading your home portal…</main>;
  if (!portal.data?.account) return <PortalLoginGate onAuthenticated={() => { void portal.refetch(); }} />;

  const totalRecords = portal.data.cleanings.length + portal.data.requests.length;
  const customerName = portal.data.account.name.split(" ")[0];
  const homeAddress = portal.data.cleanings.find(cleaning => Boolean(cleaning.address))?.address ?? "";
  const savedCardLabel = portal.data.savedCard?.last4 ? `${portal.data.savedCard.brand ? `${portal.data.savedCard.brand} ` : "Card "}ending in ${portal.data.savedCard.last4}` : "No saved card on file";
  const closeCleaningRebook = () => { setShowCleaningRebook(false); void utils.customerPortal.me.invalidate(); };

  const goToPage = (page: PortalPage) => { setActivePage(page); setMobileNavOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const openService = (serviceId: string) => {
    if (serviceId === "home-cleaning") {
      setShowCleaningRebook(true);
      return;
    }
    const service = CUSTOMER_PORTAL_SERVICES.find(candidate => candidate.id === serviceId);
    if (service) setSelectedService(service);
  };
  const records = <div className="mib-portal-records">
    {totalRecords === 0 ? <div className="mib-portal-empty"><Sparkles /><h3>Your home history starts here.</h3><p>Your cleaning and service requests will appear here.</p></div> : <>
      {portal.data.requests.map(request => <article className="mib-portal-booking-card" key={`request-${request.id}`}><div className="mib-portal-booking-top"><div><small>HOME SERVICE REQUEST</small><h3>{request.serviceName}</h3><span className="mib-portal-status">{formatStatus(request.status)}</span></div><div className="mib-portal-price"><span>{request.estimateRequiresReview ? "Estimate · review required" : "Estimated total"}</span><strong>{formatCurrency(request.estimatedTotalCents)}</strong></div></div><div className="mib-portal-booking-grid"><div><CalendarDays /><span>PREFERRED APPOINTMENT</span><strong>{formatLocalDate(request.requestedLocalDate)} · {request.requestedLocalTime}</strong><p>Your preferred time is awaiting confirmation.</p></div><div><MapPin /><span>LOCATION</span><strong>{request.address}</strong><p>{request.customerRequest}</p></div><div><CreditCard /><span>PAYMENT</span><strong>{request.paymentLast4 ? `${request.paymentBrand ? `${request.paymentBrand} ` : "Card "}ending in ${request.paymentLast4}` : savedCardLabel}</strong><p>{request.paymentLast4 ? "Your selected card is securely on file. No charge today." : "A payment method has not been saved."}</p></div></div><div className="mib-portal-booking-footer"><div><i />{request.publicRequestNumber ? `Request ${request.publicRequestNumber} saved` : "Request saved"}</div><span>{formatStatus(request.status)}</span></div></article>)}
      {portal.data.cleanings.map(cleaning => <article className="mib-portal-booking-card" key={`cleaning-${cleaning.id}`}><div className="mib-portal-booking-top"><div><small>HOME CLEANING</small><h3>{cleaning.serviceName}</h3><span className="mib-portal-status">{formatStatus(cleaning.status)}</span></div><div className="mib-portal-price"><span>First cleaning</span><strong>{formatCurrency(cleaning.firstCleaningTotalCents)}</strong></div></div><div className="mib-portal-booking-grid"><div><CalendarDays /><span>PREFERRED APPOINTMENT</span><strong>{formatLocalDate(cleaning.requestedLocalDate)}{cleaning.requestedLocalTime ? ` · ${cleaning.requestedLocalTime}` : ""}</strong><p>{cleaning.status === "needs_attention" ? "Your appointment is awaiting confirmation." : "We will keep you updated here."}</p></div><div><MapPin /><span>LOCATION</span><strong>{cleaning.address || "Address saved with booking"}</strong><p>We will confirm the right cleaning team for your home.</p></div><div><CreditCard /><span>PAYMENT</span><strong>{cleaning.paymentStatus === "card_on_file" ? "Card on file" : formatStatus(cleaning.paymentStatus)}</strong><p>{cleaning.paymentStatus === "card_on_file" ? "Your card is securely saved. No charge today." : "Payment status is saved with this booking."}</p></div></div><div className="mib-portal-booking-footer"><div><i />{cleaning.publicBookingNumber ? `Booking ${cleaning.publicBookingNumber} saved` : "Booking saved"}</div><span>{formatStatus(cleaning.status)}</span></div></article>)}
    </>}
  </div>;

  return <div className="mib-portal-shell mib-direct-portal" id="mib-home">
    <header className="mib-direct-topbar"><a href="/my-home" className="mib-direct-brand"><span className="mib-direct-logo">M</span><span><strong>Maids in Black</strong><small>Your home, managed in one place.</small></span></a><button className="mib-direct-mobile-menu" type="button" aria-expanded={mobileNavOpen} aria-controls="mib-direct-mobile-navigation" onClick={() => setMobileNavOpen(open => !open)}><Menu /><span>Menu</span></button><div className="mib-direct-user"><span className="mib-direct-notification"><Bell /><i /></span><span className="mib-direct-avatar">{customerName.slice(0, 1).toUpperCase()}</span><b>{customerName}</b><ChevronDown /></div></header>
    <div className="mib-direct-layout">
      <aside id="mib-direct-mobile-navigation" className={`mib-direct-sidebar${mobileNavOpen ? " mobile-open" : ""}`} aria-label="Portal navigation"><nav>
        <button className={activePage === "home" ? "active" : ""} type="button" onClick={() => goToPage("home")}><Home /><span>Home</span></button>
        <button className={activePage === "bookings" ? "active" : ""} type="button" onClick={() => goToPage("bookings")}><CalendarDays /><span>My bookings</span></button>
        <button className={activePage === "services" ? "active" : ""} type="button" onClick={() => goToPage("services")}><Grid2X2 /><span>Services</span></button>
        <button className={activePage === "payments" ? "active" : ""} type="button" onClick={() => goToPage("payments")}><CreditCard /><span>Payments</span></button>
        <button className={activePage === "messages" ? "active" : ""} type="button" onClick={() => goToPage("messages")}><MessageSquare /><span>Messages</span><i className="mib-direct-message-dot" aria-hidden="true" /></button>
        <button className={activePage === "account" ? "active" : ""} type="button" onClick={() => goToPage("account")}><UserRound /><span>Account</span></button>
      </nav><div className="mib-direct-help"><CircleHelp /><span><b>Need help?</b>Contact us</span></div></aside>
      <main className="mib-direct-main">
        {activePage === "home" && <><section className="mib-direct-hero"><div><small>MY HOME</small><h1>Welcome back,<br />{customerName}.</h1><p>Your home requests, timing, and updates are all here.</p><div className="mib-direct-hero-actions"><button className="mib-direct-button mib-direct-button-primary" type="button" onClick={() => setShowCleaningRebook(true)}><Plus /> Book home cleaning</button><button className="mib-direct-button" type="button" onClick={() => goToPage("services")}>Browse all services <ArrowRight /></button></div></div><div className="mib-direct-hero-art" role="img" aria-label="A calm, tidy bedroom"><div className="mib-direct-hero-plant" /><div className="mib-direct-hero-sofa" /><span>A cleaner home<br />for a calmer you.</span></div></section>
        <section className="mib-direct-stats" aria-label="Account summary">
          <article><ClipboardList /><div><strong>{totalRecords}</strong><span>Active bookings</span><button type="button" onClick={() => goToPage("bookings")}>View and manage <ArrowRight /></button></div></article>
          <article><CalendarClock /><div><strong>{nextCleaning ? formatLocalDate(nextCleaning.requestedLocalDate) : "—"}</strong><span>Next visit</span><button type="button" onClick={() => goToPage("bookings")}>See details <ArrowRight /></button></div></article>
          <article><ShieldCheck /><div><strong>This device</strong><span>Account access</span><em>Secure portal access</em></div></article>
        </section>
        <section className="mib-direct-section mib-direct-discovery" id="mib-services" aria-labelledby="mib-services-heading"><div className="mib-direct-section-head"><div><small>MORE MAIDS IN BLACK CAN HANDLE</small><h2 id="mib-services-heading">What else can we take off your list?</h2><p>Book trusted help without searching, calling around, or chasing quotes.</p></div><button type="button" onClick={() => goToPage("services")}>View all services <ArrowRight /></button></div>
          <div className="mib-direct-services"><div className="mib-direct-services-top"><button className="mib-direct-service mib-direct-service-feature" type="button" onClick={() => setShowCleaningRebook(true)}><div><span className="mib-direct-service-icon"><Home /></span><h3>Home cleaning</h3><p>One-time or recurring</p><ul><li>Trusted, vetted cleaners</li><li>Same great quality</li><li>Flexible scheduling</li></ul><em>Book cleaning <ArrowRight /></em></div><div className="mib-direct-cleaning-art" aria-hidden="true" /></button>{featuredServices.slice(0, 2).map(service => { const Icon = SERVICE_ICONS[service.id] ?? Wrench; return <button className="mib-direct-service" type="button" key={service.id} onClick={() => setSelectedService(service)}><div className="mib-direct-service-art" aria-hidden="true" /><div className="mib-direct-service-body"><span className="mib-direct-service-icon"><Icon /></span><h3>{service.name}</h3><p>{FEATURED_CARD_DETAILS[service.id] ?? service.detail}</p><b>Starting at {formatCurrency(service.startingPrice * 100)}</b><em>{SERVICE_CTAS[service.id] ?? "Start request"} <ArrowRight /></em></div></button>; })}</div><div className="mib-direct-services-bottom">{featuredServices.slice(2).map(service => { const Icon = SERVICE_ICONS[service.id] ?? Wrench; return <button className="mib-direct-service" type="button" key={service.id} onClick={() => setSelectedService(service)}><div className="mib-direct-service-art" aria-hidden="true" /><div className="mib-direct-service-body"><span className="mib-direct-service-icon"><Icon /></span><h3>{service.name}</h3><p>{service.detail}</p><b>Starting at {formatCurrency(service.startingPrice * 100)}</b><em>{SERVICE_CTAS[service.id] ?? "Start request"} <ArrowRight /></em></div></button>; })}</div></div>
        </section>
        <footer className="mib-direct-ask" aria-label="Find another home service"><div className="mib-direct-footer-top"><div><small>YOUR HOME, COVERED</small><h2>Whatever is next,<br />we can help.</h2><p>Cleaning and home services, handled in one place.</p></div></div><div className="mib-direct-footer-links"><div><small>BOOK A SERVICE</small><nav aria-label="Quick service links"><button type="button" onClick={() => openService("home-cleaning")}>Home cleaning</button><button type="button" onClick={() => openService("furniture-assembly")}>Furniture assembly</button><button type="button" onClick={() => openService("moving-help")}>Moving help</button><button type="button" onClick={() => openService("lawn-yard-care")}>Lawn &amp; yard care</button></nav></div><div><small>YOUR PORTAL</small><nav aria-label="Portal links"><button type="button" onClick={() => goToPage("bookings")}>My bookings</button><button type="button" onClick={() => goToPage("services")}>All services</button><button type="button" onClick={() => goToPage("payments")}>Payments</button><button type="button" onClick={() => goToPage("account")}>Account</button></nav></div></div><div className="mib-direct-footer-bottom"><span>Maids in Black · Your home, managed in one place.</span></div><div className="mib-direct-ask-photo" aria-hidden="true"><img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/AELCGmPvHfefwVla.webp" alt="" /></div></footer></>}
        {activePage === "bookings" && <section className="mib-direct-page"><div className="mib-direct-page-title"><small>MY HOME</small><h1>My bookings</h1><p>Upcoming, recurring, and completed visits.</p><button className="mib-direct-button mib-direct-button-primary" type="button" onClick={() => setShowCleaningRebook(true)}><Plus /> New booking</button></div>
      <div className="mib-portal-heading"><div><small>YOUR BOOKINGS</small><h2 id="mib-bookings-heading">Everything we&apos;re handling for you.</h2></div>{totalRecords > 0 && <span>{totalRecords} {totalRecords === 1 ? "request" : "requests"}</span>}</div>
      {records}</section>}
        {activePage === "services" && <section className="mib-direct-page mib-direct-services-page"><div className="mib-direct-page-title"><small>SERVICES</small><h1>What can we handle?</h1><p>Reliable help for the jobs around your home, all in one place.</p></div><section className="mib-direct-services-featured"><div><small>HOME CLEANING</small><h2>A clean home,<br />on your schedule.</h2><p>One-time and recurring cleaning, handled by trusted Maids in Black teams.</p><button className="mib-direct-button mib-direct-button-primary" type="button" onClick={() => setShowCleaningRebook(true)}>Book cleaning <ArrowRight /></button></div></section><div className="mib-direct-services-catalog-head"><div><small>HOME SERVICES</small><h2>Everything else on your list.</h2></div><span>{CUSTOMER_PORTAL_SERVICES.length} services available</span></div><div className="mib-direct-service-catalog">{CUSTOMER_PORTAL_SERVICES.map(service => { const Icon = SERVICE_ICONS[service.id] ?? Wrench; return <button type="button" key={service.id} onClick={() => setSelectedService(service)}><span><Icon /></span><div><h3>{service.name}</h3><p>{FEATURED_CARD_DETAILS[service.id] ?? service.detail}</p><b>Starting at {formatCurrency(service.startingPrice * 100)}</b><em>{SERVICE_CTAS[service.id] ?? "Start request"} <ArrowRight /></em></div></button>; })}</div></section>}
        {activePage === "payments" && <section className="mib-direct-page mib-direct-payments-page"><div className="mib-direct-page-title"><small>PAYMENTS</small><h1>Payments</h1><p>Use one secure payment method across your Maids in Black services.</p>{!newCardSetup && <button className="mib-direct-button mib-direct-button-primary" type="button" disabled={startNewCardSetup.isPending} onClick={() => { void startNewCardSetup.mutateAsync().then(setNewCardSetup); }}><Plus /> {portal.data.savedCard ? "Add a new card" : "Add a card"}</button>}</div><div className="mib-direct-payment-layout"><div className="mib-direct-payment-primary"><div className="mib-direct-payment-card-head"><span><CreditCard /></span><small>DEFAULT PAYMENT</small></div><h2>{savedCardLabel}</h2><p>{portal.data.savedCard ? "This verified card can be selected for cleaning rebooks and service requests. No charge is made when you save it." : "Add a verified card to use it for cleaning rebooks and service requests."}</p>{portal.data.savedCard && <strong className="mib-direct-payment-verified"><ShieldCheck /> Verified payment method</strong>}{newCardSetup && <Elements stripe={stripePromise} options={{ clientSecret: newCardSetup.clientSecret, appearance: { theme: "stripe" } }}><PortalNewCardForm clientSecret={newCardSetup.clientSecret} setupIntentId={newCardSetup.setupIntentId} customerName={portal.data.account.name} onSaved={() => { setNewCardSetup(null); void utils.customerPortal.me.invalidate(); }} /></Elements>}</div><aside className="mib-direct-payment-assurance"><span><ShieldCheck /></span><small>PAYMENT DETAILS</small><h2>Simple by design.</h2><p>Your card is saved securely for future requests. You choose it before a service is confirmed, and nothing is charged just for saving it.</p></aside></div><section className="mib-direct-payment-notice"><div><small>YOU&apos;RE IN CONTROL</small><h2>Clear choices before every service.</h2></div><p>For cleaning rebooks and home-service requests, you can use your saved card or securely add a new one. Maids in Black confirms the final service details before any payment is taken.</p></section></section>}
        {activePage === "messages" && <section className="mib-direct-page"><div className="mib-direct-page-title"><small>MESSAGES</small><h1>Messages</h1><p>Updates from your Maids in Black team will appear here.</p></div><div className="mib-direct-unavailable"><MessageSquare /><h2>Messages are not available in this portal yet.</h2><p>Booking and service-request updates remain available in My bookings.</p><button className="mib-direct-button" type="button" onClick={() => goToPage("bookings")}>View my bookings <ArrowRight /></button></div></section>}
        {activePage === "account" && <section className="mib-direct-page mib-direct-account-page"><div className="mib-direct-page-title"><small>ACCOUNT</small><h1>Your home profile</h1><p>Saved details used for your existing Maids in Black bookings.</p></div><section className="mib-direct-account-overview"><span className="mib-direct-account-avatar">{customerName.slice(0, 1).toUpperCase()}</span><div><small>YOUR ACCOUNT</small><h2>{portal.data.account.name}</h2><p>Your details stay connected to your home cleanings and service requests.</p></div><strong><ShieldCheck /> Secure portal access</strong></section><div className="mib-direct-account-detail-grid"><article><span><UserRound /></span><small>CONTACT</small><h2>Contact details</h2><p>{portal.data.account.phone}</p><p>{portal.data.account.email ?? "Email not saved"}</p></article><article><span><MapPin /></span><small>MY HOME</small><h2>{homeAddress || "Address saved with booking"}</h2><p>Home details are used to prefill rebooking and service-request forms.</p></article><article><span><ShieldCheck /></span><small>ACCOUNT ACCESS</small><h2>This device</h2><p>Your portal opens using the secure link from your booking confirmation.</p></article></div></section>}
      </main>
    </div>
    {selectedService && <ServiceRequestForm service={selectedService} homeAddress={homeAddress} savedCard={portal.data.savedCard} customerName={portal.data.account.name} onClose={() => setSelectedService(null)} />}
    {showCleaningRebook && <div className="mib-portal-rebook-overlay" role="dialog" aria-modal="true" aria-label="Rebook home cleaning"><BookNow portalRebook={{ customerName: portal.data.account.name, phone: portal.data.account.phone, email: portal.data.account.email, address: homeAddress, savedCard: portal.data.savedCard }} onClose={closeCleaningRebook} /></div>}
  </div>;
}
