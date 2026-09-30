import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, CreditCard, Heart, Home, LockKeyhole, Minus, Plus, ShieldCheck, Sparkles, UserRound, UsersRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { CARD_ELEMENT_OPTIONS } from "@/components/useStripeCardSetup";
import {
  calculatePublicBookingPrice,
  getPublicBookingServiceName,
  PUBLIC_BOOKING_PRICED_EXTRAS,
  PUBLIC_BOOKING_PRICING_VERSION,
  type PublicBookingHomeType,
  type PublicBookingPricingMode,
} from "@shared/publicBookingPricing";
import type { BookingWidgetServiceId, BookingWidgetRecurringFrequency } from "@shared/bookingWidgetConfig";
import "./internal-booking.css";
import "./booking-flow-review.css";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);
const SERVICES: BookingWidgetServiceId[] = ["standard", "deep", "moveout"];
const FREQUENCIES: BookingWidgetRecurringFrequency[] = ["one-time", "weekly", "biweekly", "monthly"];
const HOME_TYPES: PublicBookingHomeType[] = ["House", "Apartment", "Townhome", "Condo"];
const TIMES = ["08:30", "11:00", "13:30", "16:30"];
const EXTRA_OPTIONS = Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS);
const CONDITION_COPY = ["Light touch-up", "Well cared for", "Typical home", "A little lived-in", "Bring the good gloves", "Needs extra attention", "Heavy-duty clean", "A serious reset", "Major cleanup", "Full transformation"];
const STEPS = ["Cleaning type", "Home details", "Home condition", "Extras", "Date & time", "Your information", "Payment method", "Final review"];

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type PaymentMethod = "card" | "cashapp" | "invoice";

function tomorrowIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function money(cents: number) { return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function label(value: string) { if (value === "one-time") return "One-time"; if (value === "biweekly") return "Bi-weekly"; return value.charAt(0).toUpperCase() + value.slice(1); }
function dateLabel(value: string) { if (!value) return "Choose a date"; const date = new Date(`${value}T12:00:00`); return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); }

function InternalCardForm({ customerName, clientSecret, onConfirmed }: { customerName: string; clientSecret: string; onConfirmed: (paymentMethodId: string) => Promise<void> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [name, setName] = useState(customerName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    setPending(true); setError(null);
    const card = elements.getElement(CardElement);
    if (!card) { setError("Card field is not ready yet."); setPending(false); return; }
    const result = await stripe.confirmCardSetup(clientSecret, { payment_method: { card, billing_details: { name } } });
    if (result.error || !result.setupIntent?.payment_method) { setError(result.error?.message ?? "Card verification failed. Please try again."); setPending(false); return; }
    try { await onConfirmed(result.setupIntent.payment_method as string); } catch (cause) { setError(cause instanceof Error ? cause.message : "Card verification failed. Please try again."); setPending(false); }
  };
  return <form onSubmit={submit} className="booking-card-acceptance">
    <header className="booking-card-acceptance-head">
      <span className="booking-card-acceptance-mark"><LockKeyhole /></span>
      <span><small>SECURE CARD DETAILS</small><strong>Add your card</strong><em>Your card is stored securely and charged only after service.</em></span>
    </header>
    <div className="booking-card-acceptance-fields">
      <label><span>Name on card</span><input required value={name} onChange={event => setName(event.target.value)} autoComplete="cc-name" placeholder="Name as it appears on your card" /></label>
      <label><span>Card details</span><span className="booking-card-element-shell"><CardElement options={CARD_ELEMENT_OPTIONS} className="w-full" /></span></label>
    </div>
    {error && <p role="alert" className="booking-card-acceptance-error">{error}</p>}
    <button type="submit" disabled={pending || !stripe} className="booking-card-acceptance-submit"><LockKeyhole className="h-4 w-4" />{pending ? "Saving secure card…" : "Save card to reserve →"}</button>
  </form>;
}

function ChoiceCard({ selected, onClick, icon: Icon, title, description }: { selected: boolean; onClick: () => void; icon: typeof Sparkles; title: string; description: string }) {
  return <button type="button" className={`internal-choice-card${selected ? " selected" : ""}`} onClick={onClick}><span className="internal-choice-icon"><Icon /></span><span><strong>{title}</strong><small>{description}</small></span><span className="internal-choice-check">{selected ? <Check /> : <ChevronRight />}</span></button>;
}

function StepperCard({ title, value, min, max, display, onChange }: { title: string; value: number; min: number; max: number; display: string; onChange: (value: number) => void }) {
  return <div className="internal-stepper-card"><span>{title}</span><output>{display}</output><div><button type="button" aria-label={`Decrease ${title}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Minus /></button><button type="button" aria-label={`Increase ${title}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Plus /></button></div></div>;
}

function ReviewCard({ number, title, detail, icon: Icon, onEdit }: { number: number; title: string; detail: string; icon: typeof Home; onEdit: () => void }) {
  return <article className="internal-review-card"><span className="internal-review-icon"><Icon /></span><div><small>STEP {number}</small><strong>{title}</strong><p>{detail}</p></div><button type="button" onClick={onEdit}>Edit <ChevronRight /></button></article>;
}

export function InternalBooking({ onClose }: { onClose?: () => void }) {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>(1);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [address, setAddress] = useState("");
  const [serviceId, setServiceId] = useState<BookingWidgetServiceId>("standard");
  const [pricingMode, setPricingMode] = useState<PublicBookingPricingMode>("home");
  const [bedrooms, setBedrooms] = useState(1);
  const [bathrooms, setBathrooms] = useState(1);
  const [homeType, setHomeType] = useState<PublicBookingHomeType>("House");
  const [maidCount, setMaidCount] = useState(2);
  const [hourCount, setHourCount] = useState(2);
  const [condition, setCondition] = useState(5);
  const [frequency, setFrequency] = useState<BookingWidgetRecurringFrequency>("biweekly");
  const [date, setDate] = useState(tomorrowIso);
  const [time, setTime] = useState("11:00");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdBooking, setCreatedBooking] = useState<{ bookingId: number; publicBookingNumber: string } | null>(null);
  const [cardClientSecret, setCardClientSecret] = useState<string | null>(null);
  const [cardSetupIntentId, setCardSetupIntentId] = useState<string | null>(null);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }, [step, success, createdBooking]);

  const pricing = useMemo(() => calculatePublicBookingPrice({ pricingMode, serviceId, bedrooms, bathrooms, homeType, condition, maidCount, hourCount, extras: Object.entries(extras).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity })), recurrence: frequency }), [pricingMode, serviceId, bedrooms, bathrooms, homeType, condition, maidCount, hourCount, extras, frequency]);
  const selectedExtras = EXTRA_OPTIONS.filter(([id]) => (extras[id] ?? 0) > 0);
  const setExtra = (id: string, delta: number) => setExtras(current => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) + delta) }));
  const startCardSetup = trpc.bookingPaymentAdmin.startInternalCardSetup.useMutation({ onSuccess: result => { setCardClientSecret(result.clientSecret); setCardSetupIntentId(result.setupIntentId); }, onError: mutationError => setError(mutationError.message) });
  const confirmCardSetup = trpc.bookingPaymentAdmin.confirmInternalCardSetup.useMutation({ onSuccess: () => { if (createdBooking) setSuccess(`${createdBooking.publicBookingNumber} created with card on file. It is now in Bookings for assignment and follow-up.`); }, onError: mutationError => setError(mutationError.message) });
  const createBooking = trpc.bookings.createInternal.useMutation({ onSuccess: result => { if (paymentMethod === "card") { setCreatedBooking({ bookingId: result.bookingId, publicBookingNumber: result.publicBookingNumber }); startCardSetup.mutate({ bookingId: result.bookingId }); } else setSuccess(`${result.publicBookingNumber} created at ${money(result.totalCents)}. It is now in Bookings for assignment and follow-up.`); setError(null); }, onError: mutationError => { setError(mutationError.message); setSuccess(null); } });

  const submit = () => {
    setError(null);
    const pricingInput = { pricingMode, serviceId, bedrooms, bathrooms, homeType, condition, maidCount, hourCount, extras: Object.entries(extras).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity })), recurrence: frequency };
    createBooking.mutate({ idempotencyKey: crypto.randomUUID(), paymentMethod, companyNotes: notes.trim() || null, booking: { surface: "full_page", customer: { fullName: customerName.trim(), phone: customerPhone.trim(), email: customerEmail.trim() }, service: { serviceId, bedrooms, bathrooms, extras: pricingInput.extras, specialRequestNotes: [] }, address: address.trim(), requestedSchedule: { localDate: date, localTime: time }, recurrence: frequency, acceptedPricing: { version: PUBLIC_BOOKING_PRICING_VERSION, totalCents: pricing.firstCleaningTotalCents }, pricing: pricingInput } });
  };
  const next = () => {
    setError(null);
    if (step === 6 && (!customerName.trim() || !customerPhone.trim() || !customerEmail.trim() || !address.trim())) { setError("Complete the customer information before continuing."); return; }
    if (step === 8) { submit(); return; }
    setStep(Math.min(8, step + 1) as Step);
  };
  const back = () => { setError(null); setStep(Math.max(1, step - 1) as Step); };
  const shellClass = onClose ? "internal-booking-modal-shell" : "internal-booking-shell";

  if (createdBooking && cardClientSecret && cardSetupIntentId && !success) return <main className={shellClass}><section className="internal-booking-card-stage"><p className="eyebrow">PAYMENT METHOD</p><h1>Add the card</h1><p>The card is saved securely to this booking. Nothing is charged today.</p><Elements stripe={stripePromise} options={{ clientSecret: cardClientSecret, appearance: { theme: "stripe" } }}><InternalCardForm customerName={customerName} clientSecret={cardClientSecret} onConfirmed={paymentMethodId => confirmCardSetup.mutateAsync({ bookingId: createdBooking.bookingId, setupIntentId: cardSetupIntentId, paymentMethodId }).then(() => undefined)} /></Elements></section></main>;
  if (success) return <main className={shellClass}><section className="internal-booking-success"><CheckCircle2 size={44} /><p className="eyebrow">BOOKING CREATED</p><h1>{success.split(" created")[0]}</h1><p>{success.slice(success.indexOf(" created") + 1)}</p><button type="button" onClick={() => onClose ? onClose() : navigate("/admin/bookings")}>Open bookings CRM</button><button className="secondary" type="button" onClick={() => { setSuccess(null); setCreatedBooking(null); setCardClientSecret(null); setCardSetupIntentId(null); setStep(1); }}>Create another booking</button></section></main>;

  const serviceName = getPublicBookingServiceName(serviceId);
  const homeDetail = pricingMode === "hourly" ? `${maidCount} maids · ${hourCount} hours` : `${bedrooms === 0 ? "Studio" : `${bedrooms} bed`} · ${bathrooms} bath · ${homeType}`;
  const stepContent = step === 1 ? <><h1>What kind of cleaning do they need?</h1><p className="internal-lede">Choose the service that best matches the customer&apos;s request.</p><div className="internal-choice-grid">{SERVICES.map(value => <ChoiceCard key={value} selected={serviceId === value} onClick={() => setServiceId(value)} icon={Sparkles} title={getPublicBookingServiceName(value)} description={value === "standard" ? "A reliable reset for a well-kept home." : value === "deep" ? "Extra detail for a home needing more attention." : "A thorough clean before a move or handoff."} />)}</div></> : step === 2 ? <><h1>Tell us about the home</h1><p className="internal-lede">Use the same bedroom, bathroom, hourly, and recurring options as the public form.</p><div className="internal-mode-toggle"><button type="button" className={pricingMode === "home" ? "selected" : ""} onClick={() => setPricingMode("home")}>Bedrooms &amp; bathrooms</button><button type="button" className={pricingMode === "hourly" ? "selected" : ""} onClick={() => setPricingMode("hourly")}>Book hourly instead</button></div>{pricingMode === "home" ? <><div className="internal-stepper-grid"><StepperCard title="Bedrooms" value={bedrooms} min={0} max={7} display={bedrooms === 0 ? "Studio" : String(bedrooms)} onChange={setBedrooms} /><StepperCard title="Bathrooms" value={bathrooms} min={1} max={5} display={String(bathrooms)} onChange={setBathrooms} /></div><div className="internal-card-label">Home type</div><div className="internal-pill-grid">{HOME_TYPES.map(value => <button type="button" key={value} className={homeType === value ? "selected" : ""} onClick={() => setHomeType(value)}>{value}</button>)}</div></> : <div className="internal-stepper-grid"><StepperCard title="Maids" value={maidCount} min={1} max={4} display={String(maidCount)} onChange={setMaidCount} /><StepperCard title="Hours" value={hourCount} min={1} max={8} display={String(hourCount)} onChange={setHourCount} /></div>}<div className="internal-frequency-block"><div className="internal-card-label">Recurring frequency</div><div className="internal-frequency-grid">{FREQUENCIES.map(value => <button type="button" key={value} className={frequency === value ? "selected" : ""} onClick={() => setFrequency(value)}><strong>{label(value)}</strong><small>{value === "weekly" ? "Save 20% after visit one" : value === "biweekly" ? "Save 15% after visit one" : value === "monthly" ? "Save 10% after visit one" : "Single visit"}</small></button>)}</div></div></> : step === 3 ? <><h1>How is the home currently maintained?</h1><p className="internal-lede">This helps set a fair estimate and enough time for the team.</p><div className="internal-condition-grid">{CONDITION_COPY.map((copy, index) => <button type="button" key={copy} className={condition === index + 1 ? "selected" : ""} onClick={() => setCondition(index + 1)}><span>{index + 1}</span><strong>{copy}</strong></button>)}</div><input className="internal-condition-range" type="range" min="1" max="10" value={condition} onChange={event => setCondition(Number(event.target.value))} /><div className="internal-condition-selected"><strong>{condition}</strong><span>{CONDITION_COPY[condition - 1]}</span></div></> : step === 4 ? <><h1>Need anything else?</h1><p className="internal-lede">Add services and quantities while you are on the call.</p><div className="internal-extras-grid">{EXTRA_OPTIONS.map(([id, extra]) => <article className="internal-extra-card" key={id}><div><strong>{extra.label}</strong><small>${extra.unitPrice}{extra.quantityUnit ? ` / ${extra.quantityUnit}` : ""}</small></div><div className="internal-quantity"><button type="button" onClick={() => setExtra(id, -1)} disabled={!extras[id]}><Minus /></button><output>{extras[id] ?? 0}</output><button type="button" onClick={() => setExtra(id, 1)}><Plus /></button></div></article>)}</div></> : step === 5 ? <><h1>When should the cleaning happen?</h1><p className="internal-lede">Choose the requested date and arrival window.</p><div className="internal-date-card"><CalendarDays /><label>Date<input type="date" min={tomorrowIso()} value={date} onChange={event => setDate(event.target.value)} /><strong>{dateLabel(date)}</strong></label></div><div className="internal-card-label">Arrival time</div><div className="internal-time-grid">{TIMES.map(value => <button type="button" key={value} className={time === value ? "selected" : ""} onClick={() => setTime(value)}><Clock3 />{value}</button>)}</div></> : step === 6 ? <><h1>Who are we booking for?</h1><p className="internal-lede">Capture the customer details and anything the team should know.</p><div className="internal-contact-grid"><label>Full name<input required value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Customer name" /></label><label>Phone<input required value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} placeholder="202-555-0123" /></label><label>Email<input required type="email" value={customerEmail} onChange={event => setCustomerEmail(event.target.value)} placeholder="customer@example.com" /></label><label>Address<input required value={address} onChange={event => setAddress(event.target.value)} placeholder="Street, city, state, ZIP" /></label><label className="wide">Company notes<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Gate code, parking, pets, or anything the team should know" /></label></div></> : step === 7 ? <><h1>How will this booking be collected?</h1><p className="internal-lede">Card is selected by default. Nothing is charged today.</p><div className="internal-choice-grid">{(["card", "cashapp", "invoice"] as PaymentMethod[]).map(value => <ChoiceCard key={value} selected={paymentMethod === value} onClick={() => setPaymentMethod(value)} icon={CreditCard} title={value === "cashapp" ? "Cash App" : label(value)} description={value === "card" ? "Save a card securely for payment after service." : value === "cashapp" ? "Collect through the separate Cash App flow." : "Mark the booking for invoice collection."} />)}</div></> : <><h1>Take a final look</h1><p className="internal-lede">Confirm the details before creating this native booking.</p><div className="internal-review-grid"><ReviewCard number={1} title="Cleaning type" detail={serviceName} icon={Sparkles} onEdit={() => setStep(1)} /><ReviewCard number={2} title="Home details" detail={homeDetail} icon={Home} onEdit={() => setStep(2)} /><ReviewCard number={3} title="Home condition" detail={`${condition} · ${CONDITION_COPY[condition - 1]}`} icon={ShieldCheck} onEdit={() => setStep(3)} /><ReviewCard number={4} title="Extras" detail={selectedExtras.length ? `${selectedExtras.length} selected` : "No extras selected"} icon={Plus} onEdit={() => setStep(4)} /><ReviewCard number={5} title="Schedule" detail={`${dateLabel(date)} · ${time}`} icon={CalendarDays} onEdit={() => setStep(5)} /><ReviewCard number={6} title="Customer" detail={customerName || "Customer details"} icon={UserRound} onEdit={() => setStep(6)} /><ReviewCard number={7} title="Collection" detail={paymentMethod === "cashapp" ? "Cash App" : label(paymentMethod)} icon={CreditCard} onEdit={() => setStep(7)} /></div><div className="internal-review-total"><span>First cleaning<strong>{money(pricing.firstCleaningTotalCents)}</strong></span>{pricing.futureVisitTotalCents !== null && <span>{label(frequency)} after visit one<strong>{money(pricing.futureVisitTotalCents)} / visit</strong></span>}</div></>;

  return <main className={shellClass}>{onClose && <button type="button" className="internal-booking-modal-close" onClick={onClose} aria-label="Close new booking form">×</button>}<section className="internal-booking-frame"><aside className="internal-booking-progress"><p className="eyebrow">INTERNAL BOOKING</p><h2>New booking</h2><p>Same options as the public form, streamlined for a phone call.</p><ol>{STEPS.map((title, index) => { const number = index + 1; return <li key={title} className={number === step ? "current" : number < step ? "done" : ""}><span>{number < step ? <Check /> : number}</span><div><strong>{title}</strong>{number < step && <small>{number === 1 ? serviceName : number === 2 ? homeDetail : number === 5 ? dateLabel(date) : number === 6 ? customerName || "Contact details" : number === 7 ? label(paymentMethod) : "Complete"}</small>}</div></li>; })}</ol><div className="internal-progress-secure"><ShieldCheck /><span><strong>Secure booking</strong><small>Information stays protected.</small></span></div></aside><section className="internal-booking-stage"><div className="internal-step-overline">STEP {step} OF 8</div><div className="internal-step-content">{stepContent}</div>{error && <div className="form-error" role="alert">{error}</div>}<footer className="internal-step-actions"><button type="button" className="internal-back-button" onClick={back} disabled={step === 1 || createBooking.isPending}><ArrowLeft /> Back</button><span><Heart /> A cleaner, happier home is just a few steps away.</span><button type="button" className="internal-next-button" onClick={next} disabled={createBooking.isPending || startCardSetup.isPending}>{createBooking.isPending || startCardSetup.isPending ? "Creating…" : step === 8 ? <><Check /> Create booking</> : <>Continue <ArrowRight /></>}</button></footer></section></section></main>;
}

export default InternalBooking;
