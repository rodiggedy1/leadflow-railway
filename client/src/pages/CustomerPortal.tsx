import { ArrowRight, CalendarDays, Check, ChevronRight, ClipboardList, Home, MapPin, Plus, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CUSTOMER_PORTAL_SERVICES, type CustomerPortalService } from "@shared/customerPortalServices";
import "./customer-portal.css";

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function formatCleaningDate(value: string | null) {
  if (!value) return "Timing to be confirmed";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(year, month - 1, day, 12));
}

function serviceDescription(service: CustomerPortalService) {
  return service.detail.replace(/ · /g, " · ");
}

function PortalRequestForm({ service, onClose, onCreated }: { service: CustomerPortalService; onClose: () => void; onCreated: () => void }) {
  const createRequest = trpc.customerPortal.createRequest.useMutation({ onSuccess: onCreated });
  const formRef = useRef<HTMLFormElement>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [address, setAddress] = useState("");
  const [requestedLocalDate, setRequestedLocalDate] = useState("");
  const [requestedLocalTime, setRequestedLocalTime] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reviewing) {
      if (!formRef.current?.reportValidity()) return;
      setReviewing(true);
      return;
    }
    await createRequest.mutateAsync({ serviceId: service.id, selections, address, requestedLocalDate, requestedLocalTime, notes: notes || undefined });
  };

  return <div className="mib-portal-modal-layer" role="presentation"><section className="mib-portal-modal" aria-label={`Book ${service.name}`}>
    <button className="mib-portal-modal-close" type="button" onClick={onClose} aria-label="Close service form">×</button>
    <div className="mib-portal-eyebrow">MAIDS IN BLACK · SERVICE REQUEST</div>
    <h2>{service.name}</h2><p>{service.detail}. Your request is reviewed before final confirmation.</p>
    {createRequest.isSuccess ? <div className="mib-portal-success"><span><Check /></span><h3>Request received.</h3><p>We&apos;ll review your request and confirm the next step.</p><button type="button" className="mib-portal-primary" onClick={onClose}>Back to My Home <ArrowRight /></button></div> : reviewing ? <form onSubmit={submit} className="mib-portal-request-form"><div className="mib-portal-review"><div className="mib-portal-eyebrow">REVIEW YOUR REQUEST</div><h3>{service.name}</h3><dl>{service.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{selections[field.label]}</dd></div>)}<div><dt>Preferred time</dt><dd>{requestedLocalDate} · {requestedLocalTime}</dd></div><div><dt>Service address</dt><dd>{address}</dd></div>{notes && <div><dt>Notes</dt><dd>{notes}</dd></div>}</dl><p>Your request will be reviewed before final confirmation.</p></div>{createRequest.error && <p className="mib-portal-form-error" role="alert">{createRequest.error.message}</p>}<div className="mib-portal-review-actions"><button type="button" className="mib-portal-secondary" onClick={() => setReviewing(false)}>Back to edit</button><button className="mib-portal-primary" disabled={createRequest.isPending} type="submit">{createRequest.isPending ? "Saving request…" : "Send request"}<ArrowRight /></button></div></form> : <form ref={formRef} onSubmit={submit} className="mib-portal-request-form">
      {service.fields.map((field) => <label key={field.label}><span>{field.label}</span>{field.type === "text" ? <textarea required maxLength={1000} value={selections[field.label] ?? ""} onChange={(event) => setSelections((current) => ({ ...current, [field.label]: event.target.value }))} placeholder={field.placeholder} /> : <select required value={selections[field.label] ?? ""} onChange={(event) => setSelections((current) => ({ ...current, [field.label]: event.target.value }))}><option value="">Select one</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select>}</label>)}
      <div className="mib-portal-form-split"><label><span>Preferred date</span><input required type="date" value={requestedLocalDate} onChange={(event) => setRequestedLocalDate(event.target.value)} /></label><label><span>Preferred time</span><input required type="time" value={requestedLocalTime} onChange={(event) => setRequestedLocalTime(event.target.value)} /></label></div>
      <label><span>Service address</span><input required minLength={5} maxLength={500} autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street address" /></label>
      <label><span>Anything else? <em>Optional</em></span><textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Share any helpful details" /></label>
      {createRequest.error && <p className="mib-portal-form-error" role="alert">{createRequest.error.message}</p>}
      <button className="mib-portal-primary" type="submit">Review request <ArrowRight /></button>
    </form>}
  </section></div>;
}

export default function CustomerPortal() {
  const utils = trpc.useUtils();
  const portal = trpc.customerPortal.me.useQuery(undefined, { retry: false, staleTime: 30_000 });
  const redeem = trpc.customerPortal.redeemHandoff.useMutation({ onSuccess: () => void utils.customerPortal.me.invalidate() });
  const redemptionAttempted = useRef(false);
  const [selectedService, setSelectedService] = useState<CustomerPortalService | null>(null);
  const accessCode = useMemo(() => new URLSearchParams(window.location.search).get("access"), []);

  useEffect(() => {
    if (!accessCode || redemptionAttempted.current) return;
    redemptionAttempted.current = true;
    void redeem.mutateAsync({ code: accessCode }).then(() => window.history.replaceState({}, "", "/my-home"));
  }, [accessCode]);

  const data = portal.data;
  if (redeem.isPending || (portal.isLoading && accessCode)) return <main className="mib-portal-gate"><Sparkles /><p>Opening your Maids in Black portal…</p></main>;
  if (!data?.account) return <main className="mib-portal-gate"><div className="mib-portal-mark">M</div><div className="mib-portal-eyebrow">MAIDS IN BLACK · MY HOME</div><h1>Everything for your home, in one place.</h1><p>Your portal opens automatically when you complete a booking. Return from your booking confirmation on this device to keep requests and updates together.</p>{redeem.error && <p className="mib-portal-form-error">{redeem.error.message}</p>}<a className="mib-portal-primary" href="/book-now">Book home cleaning <ArrowRight /></a></main>;

  const activeCleanings = data.cleanings.filter((cleaning) => !["completed", "cancelled"].includes(cleaning.status));
  const activeRequests = data.requests.filter((request) => !["completed", "cancelled"].includes(request.status));
  return <main className="mib-portal-shell">
    <header className="mib-portal-topbar"><a className="mib-portal-brand" href="/my-home"><span>M</span> Maids in Black</a><div className="mib-portal-profile"><span>{data.account.name.split(" ")[0]}</span><i /></div></header>
    <section className="mib-portal-hero"><div><div className="mib-portal-eyebrow">MY HOME · MAIDS IN BLACK</div><h1>Welcome back, {data.account.name.split(" ")[0]}.</h1><p>Your cleaning, home requests, timing, and updates are together here.</p></div><a className="mib-portal-primary" href="/book-now"><Plus /> Book home cleaning</a></section>
    <section className="mib-portal-stats"><article><ClipboardList /><div><span>Active requests</span><strong>{activeCleanings.length + activeRequests.length}</strong></div></article><article><CalendarDays /><div><span>Upcoming cleanings</span><strong>{activeCleanings.length || "—"}</strong></div></article><article><ShieldCheck /><div><span>Portal access</span><strong>Secure</strong></div></article></section>
    <section className="mib-portal-section" aria-labelledby="mib-services-heading"><div className="mib-portal-section-heading"><div><div className="mib-portal-eyebrow">MORE WAYS WE CAN HELP</div><h2 id="mib-services-heading">What else can we take off your list?</h2></div><span>12 services</span></div><div className="mib-portal-services"><a className="mib-portal-service mib-portal-cleaning" href="/book-now"><span><Sparkles /></span><div><strong>Home cleaning</strong><p>One-time or recurring</p><em>Book cleaning <ArrowRight /></em></div></a>{CUSTOMER_PORTAL_SERVICES.map((service) => <button className="mib-portal-service" type="button" onClick={() => setSelectedService(service)} key={service.id}><span><Wrench /></span><div><strong>{service.name}</strong><p>{serviceDescription(service)}</p><em>Start request <ArrowRight /></em></div></button>)}</div></section>
    <section className="mib-portal-section"><div className="mib-portal-section-heading"><div><div className="mib-portal-eyebrow">YOUR HOME</div><h2>Cleaning &amp; requests</h2></div><span>{data.cleanings.length + data.requests.length} total</span></div><div className="mib-portal-records">{[...data.cleanings.map((cleaning) => ({ kind: "cleaning" as const, ...cleaning })), ...data.requests.map((request) => ({ kind: "request" as const, ...request }))].length === 0 ? <div className="mib-portal-empty"><Home /><h3>Your home history starts here.</h3><p>When you make a booking or send a service request, it will appear here.</p></div> : <>{data.cleanings.map((cleaning) => <article className="mib-portal-record" key={`cleaning-${cleaning.id}`}><div><small>HOME CLEANING</small><h3>{cleaning.serviceName}</h3><p><CalendarDays /> {formatCleaningDate(cleaning.requestedLocalDate)} · {cleaning.requestedLocalTime || "Time to be confirmed"}</p><p><MapPin /> {cleaning.address || "Address to be confirmed"}</p></div><aside><b>{cleaning.status.replace(/_/g, " ")}</b><strong>{cleaning.firstCleaningTotalCents ? formatMoney(cleaning.firstCleaningTotalCents) : "Quote saved"}</strong><span>{cleaning.paymentStatus?.replace(/_/g, " ") || ""}</span></aside></article>)}{data.requests.map((request) => <article className="mib-portal-record" key={`request-${request.id}`}><div><small>HOME SERVICE REQUEST</small><h3>{request.serviceName}</h3><p><CalendarDays /> {formatCleaningDate(request.requestedLocalDate)} · {request.requestedLocalTime}</p><p><MapPin /> {request.address}</p></div><aside><b>{request.status.replace(/_/g, " ")}</b><strong>{formatMoney(request.estimatedTotalCents)}</strong><span>{request.estimateRequiresReview ? "Estimate to confirm" : "Estimated total"}</span></aside></article>)}</>}</div></section>
    <section className="mib-portal-help"><span><Sparkles /></span><div><h3>Need a hand with something else?</h3><p>Choose a service above and tell us what you need.</p></div><button type="button" onClick={() => setSelectedService(CUSTOMER_PORTAL_SERVICES[0])}>Start a request <ChevronRight /></button></section>
    {selectedService && <PortalRequestForm service={selectedService} onClose={() => setSelectedService(null)} onCreated={() => void utils.customerPortal.me.invalidate()} />}
  </main>;
}
