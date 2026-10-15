import { useEffect, useMemo, useRef, useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  FileText,
  Home,
  Info,
  Landmark,
  MapPin,
  Minus,
  Plus,
  Sparkles,
  UserRound,
  WalletCards,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PremiumCardSetupForm } from "@/components/BookingPaymentCheckout";
import { useCanonicalBookingFlow } from "@/components/useCanonicalBookingFlow";
import {
  easternCalendarWeekday,
  easternDateIso,
  easternDateIsoFromDate,
  easternDateLabel,
  easternMonthDate,
  easternMonthLabel,
  parseEasternDate,
} from "@shared/easternTime";
import {
  CANONICAL_CONDITION_COPY,
  CANONICAL_FREQUENCIES,
  CANONICAL_SERVICE_IDS,
  createCanonicalBookingInput,
} from "@shared/canonicalBooking";
import {
  getPublicBookingServiceName,
  PUBLIC_BOOKING_PRICING_VERSION,
  type PublicBookingHomeType,
} from "@shared/publicBookingPricing";
import { CANONICAL_POST_BOOKING_UPSELLS } from "@shared/canonicalBookingCatalog";
import "./internal-booking-review.css";

type ServiceId = (typeof CANONICAL_SERVICE_IDS)[number];
type Frequency = (typeof CANONICAL_FREQUENCIES)[number];
type Payment = "card" | "cashapp" | "invoice";
type SectionState = "current" | "completed" | "pending";

type BookingResult = {
  bookingId: number;
  publicBookingNumber: string;
};

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string)
  : null;
const homeTypes: PublicBookingHomeType[] = [
  "House",
  "Apartment",
  "Townhome",
  "Condo",
];
const services = [
  { id: "standard" as const, title: "Standard Clean", copy: "Regular cleaning for maintained homes", icon: Home },
  { id: "deep" as const, title: "Deep Clean", copy: "More detailed cleaning for a deeper refresh", icon: Sparkles },
  { id: "moveout" as const, title: "Move-out Clean", copy: "Thorough cleaning for move-outs", icon: FileText },
];
const extras = [
  { id: "inside-fridge", label: "Inside Fridge", price: 30 },
  { id: "inside-oven", label: "Inside Oven", price: 30 },
  { id: "interior-windows", label: "Interior Windows", price: 25 },
  { id: "laundry-load", label: "Laundry (1 load)", price: 25 },
  { id: "organizing-hour", label: "Organizing", price: 30 },
];
const standardTimes = ["08:30", "10:30", "12:30", "14:30", "16:30", "18:30"] as const;
const recommendableTimes = standardTimes.filter(value => value !== "18:30");
const additionalServiceOptions = Object.entries(CANONICAL_POST_BOOKING_UPSELLS).map(([id, value]) => ({
  id,
  title: value.label,
  copy: value.quantityUnit,
  unitPriceCents: value.unitPriceCents,
}));
const timeLabel = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
};
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const frequencyLabel = (value: string) => value === "one-time" ? "One-time" : value === "biweekly" ? "Bi-weekly" : value.charAt(0).toUpperCase() + value.slice(1);
const firstBookableDate = () => parseEasternDate(easternDateIso(new Date(), 1));

function ReviewField({ label, value, placeholder, required = false, error, inputRef, onChange }: { label: string; value: string; placeholder?: string; required?: boolean; error?: string; inputRef?: React.RefObject<HTMLInputElement | null>; onChange?: (value: string) => void }) {
  return <label className={`ibr-field${error ? " has-error" : ""}`}><span>{label}{required && <b> *</b>}</span><input ref={inputRef} value={value} placeholder={placeholder} onChange={event => onChange?.(event.target.value)} aria-label={label} aria-required={required} aria-invalid={Boolean(error)} />{error && <small className="ibr-field-error" role="alert">{error}</small>}</label>;
}

function Section({ number, title, optional, prompt, state, children }: { number: number; title: string; optional?: boolean; prompt: string; state: SectionState; children: React.ReactNode }) {
  return <section className={`ibr-section is-${state}`}><div className="ibr-section-label"><span className="ibr-step-number">{number}</span><div><h2>{title}{optional && <em> (Optional)</em>}</h2><div className="ibr-prompt"><b>What to say:</b><span>“{prompt}”</span></div></div></div><div className="ibr-section-content">{children}</div></section>;
}

export default function InternalBookingReview() {
  const flow = useCanonicalBookingFlow({ stepCount: 10, overrides: { homeType: "Apartment" } });
  const { draft, step, setStep, pricingInput, pricing, serviceId, setServiceId, pricingMode, setPricingMode, bedrooms, setBedrooms, bathrooms, setBathrooms, homeType, setHomeType, maidCount, setMaidCount, hourCount, setHourCount, condition, setCondition, frequency, setFrequency, extras: extraQuantities, setExtra, customerName, setCustomerName, customerPhone, setCustomerPhone, customerEmail, setCustomerEmail, address, setAddress, date, setDate, time, setTime, notes, setNotes, reset } = flow;
  const [payment, setPayment] = useState<Payment>("card");
  const [hasBasement, setHasBasement] = useState(() => Boolean(flow.extras.basement));
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const firstDate = firstBookableDate();
    return easternMonthDate(firstDate.getUTCFullYear(), firstDate.getUTCMonth(), 1);
  });
  const [isOpen, setIsOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [createdBooking, setCreatedBooking] = useState<BookingResult | null>(null);
  const [additionalServices, setAdditionalServices] = useState<Record<string, number>>({});
  const [cardClientSecret, setCardClientSecret] = useState<string | null>(null);
  const [cardSetupIntentId, setCardSetupIntentId] = useState<string | null>(null);
  const [cardSaved, setCardSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const completionBookingRef = useRef<BookingResult | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const customerNameRef = useRef<HTMLInputElement>(null);
  const customerPhoneRef = useRef<HTMLInputElement>(null);
  const customerEmailRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);

  const timeCountsQuery = trpc.bookings.standardTimeCounts.useQuery({ date }, { enabled: step === 6 && Boolean(date), staleTime: 30_000 });
  const timeCounts = useMemo(() => new Map((timeCountsQuery.data ?? []).map(row => [row.time, Number(row.count)])), [timeCountsQuery.data]);
  const recommendedTime = useMemo(() => {
    if (timeCountsQuery.isLoading || timeCountsQuery.isFetching || timeCountsQuery.isError) return null;
    return recommendableTimes.reduce((best, candidate) => (timeCounts.get(candidate) ?? 0) < (timeCounts.get(best) ?? 0) ? candidate : best);
  }, [timeCounts, timeCountsQuery.isError, timeCountsQuery.isFetching, timeCountsQuery.isLoading]);

  useEffect(() => {
    if (step === 6 && recommendedTime && time === "08:30") setTime(recommendedTime);
  }, [recommendedTime, setTime, step, time]);
  useEffect(() => {
    if (hasBasement && !extraQuantities.basement) setExtra("basement", 1);
    if (!hasBasement && extraQuantities.basement) setExtra("basement", -extraQuantities.basement);
  }, [extraQuantities.basement, hasBasement, setExtra]);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [step, success, createdBooking]);

  const startCardSetup = trpc.bookingPaymentAdmin.startInternalCardSetup.useMutation({
    onSuccess: result => {
      if (result.alreadyComplete) {
        setCardSaved(true); setCardClientSecret(null); setCardSetupIntentId(null);
        return;
      }
      setCardClientSecret(result.clientSecret); setCardSetupIntentId(result.setupIntentId);
    },
    onError: () => setError("We couldn't start secure card entry. Please try again."),
  });
  const confirmCardSetup = trpc.bookingPaymentAdmin.confirmInternalCardSetup.useMutation({
    onSuccess: () => {
      setCardSaved(true); setCardClientSecret(null); setCardSetupIntentId(null);
    },
    onError: () => setError("We couldn't save the card. Please check the card details and try again."),
  });
  const switchPayment = trpc.bookingPaymentAdmin.switchInternalPaymentMethod.useMutation({
    onSuccess: result => {
      setPayment(result.paymentMethod); setCardClientSecret(null); setCardSetupIntentId(null); setCardSaved(false); setError(null);
      if (result.paymentMethod === "card" && createdBooking) startCardSetup.mutate({ bookingId: createdBooking.bookingId });
    },
    onError: () => setError("We couldn't change the payment method. Please try again."),
  });
  const updateAdditionalServices = trpc.bookings.updateAdditionalServices.useMutation({
    onSuccess: () => {
      const booking = completionBookingRef.current ?? createdBooking;
      if (booking) setSuccess(`${booking.publicBookingNumber} created with ${payment === "cashapp" ? "Cash App" : payment === "invoice" ? "Check" : "card saved"}. It is now in Bookings for assignment and follow-up.`);
      completionBookingRef.current = null;
    },
    onError: () => setError("We couldn't update the booking services. Please try again."),
  });
  const createBooking = trpc.bookings.createInternal.useMutation({
    onSuccess: result => {
      const booking = { bookingId: result.bookingId, publicBookingNumber: result.publicBookingNumber };
      completionBookingRef.current = booking;
      setCreatedBooking(booking);
      setError(null);
      if (payment === "card") startCardSetup.mutate({ bookingId: result.bookingId });
    },
    onError: () => { setError("We couldn't create the booking. Please review the required fields and try again."); setSuccess(null); },
  });

  const validateBookingDetails = () => {
    const nextErrors: Record<string, string> = {};
    if (!customerName.trim()) nextErrors.customerName = "Complete the customer information before continuing.";
    if (!customerPhone.trim()) nextErrors.customerPhone = "Complete the customer information before continuing.";
    if (!customerEmail.trim()) nextErrors.customerEmail = "Enter the customer's email address.";

    if (address.trim().length < 5) nextErrors.address = "Enter the complete service address.";
    setFieldErrors(nextErrors);
    const firstInvalid = [["customerName", customerNameRef], ["customerPhone", customerPhoneRef], ["customerEmail", customerEmailRef], ["address", addressRef]].find(([key]) => nextErrors[key as string]);
    if (firstInvalid) {
      setError("Complete the highlighted required fields before continuing.");
      (firstInvalid[1] as React.RefObject<HTMLInputElement | null>).current?.focus();
      return false;
    }
    setError(null);
    return true;
  };
  const submit = () => {
    setError(null);
    if (!validateBookingDetails()) return;
    if (createdBooking) {
      updateAdditionalServices.mutate({ bookingId: createdBooking.bookingId, additionalServices: Object.entries(additionalServices).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity })) });
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    createBooking.mutate({
      idempotencyKey,
      paymentMethod: payment,
      companyNotes: notes.trim() || null,
      additionalServices: payment === "card" ? [] : Object.entries(additionalServices).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity })),
      booking: {
        ...createCanonicalBookingInput(draft, { idempotencyKey, surface: "popup", acceptedPricingVersion: PUBLIC_BOOKING_PRICING_VERSION, acceptedTotalCents: pricing.firstCleaningTotalCents }),
        pricing: { ...pricingInput, extras: [...pricingInput.extras] },
      },
    });
  };
  const next = () => {
    setError(null);
    if (step === 7 && !validateBookingDetails()) return;
    if (step === 8 && !createdBooking) { submit(); return; }
    if (step === 8 && payment === "card" && createdBooking && !cardSaved) { setError("Save the card before continuing."); return; }
    if (step === 10) { submit(); return; }
    setStep(Math.min(10, step + 1));
  };
  const back = () => { setError(null); setStep(Math.max(1, step - 1)); };
  const selectedExtras = extras.filter(extra => (extraQuantities[extra.id] ?? 0) > 0);
  const extraTotal = selectedExtras.reduce((sum, extra) => sum + extra.price * (extraQuantities[extra.id] ?? 0), 0) * 100;
  const serviceTitle = getPublicBookingServiceName(serviceId);
  const homeDetail = pricingMode === "hourly" ? `${maidCount} ${maidCount === 1 ? "maid" : "maids"} · ${hourCount} ${hourCount === 1 ? "hour" : "hours"}` : `${bedrooms === 0 ? "Studio" : `${bedrooms} bed`} · ${bathrooms} bath · ${homeType}`;
  const total = pricing.firstCleaningTotalCents + extraTotal;
  const busy = createBooking.isPending || startCardSetup.isPending || confirmCardSetup.isPending || switchPayment.isPending || updateAdditionalServices.isPending;
  const completed = new Set<number>();
  if (customerName.trim() && customerPhone.trim() && customerEmail.trim()) completed.add(1);
  completed.add(2);
  if (bedrooms && bathrooms && homeType) completed.add(3);
  if (selectedExtras.length) completed.add(4);
  if (date && time) completed.add(5);
  if (address.trim().length >= 5) completed.add(6);
  if (frequency) completed.add(7);
  if (payment !== "card" || cardSaved) completed.add(8);
  const firstIncomplete = [1, 2, 3, 4, 5, 6, 7, 8].find(number => !completed.has(number)) ?? 8;
  const sectionState = (number: number): SectionState => number === firstIncomplete ? "current" : number < firstIncomplete && completed.has(number) ? "completed" : "pending";

  const toggleExtra = (id: string, price: number) => {
    const quantity = extraQuantities[id] ?? 0;
    setExtra(id, quantity ? -quantity : 1);
    if (id === "basement") setHasBasement(!quantity);
    void price;
  };
  const setAdditionalService = (id: string, delta: number) =>
    setAdditionalServices(current => ({
      ...current,
      [id]: Math.max(0, (current[id] ?? 0) + delta),
    }));
  const chooseDate = (dateValue: string) => {
    setDate(dateValue);
    setVisibleMonth(easternMonthDate(Number(dateValue.slice(0, 4)), Number(dateValue.slice(5, 7)) - 1, 1));
  };
  const selectedDate = useMemo(() => parseEasternDate(date), [date]);
  const calendarYear = visibleMonth.getUTCFullYear();
  const calendarMonth = visibleMonth.getUTCMonth();
  const calendarLeading = easternCalendarWeekday(calendarYear, calendarMonth);
  const calendarDays = new Date(Date.UTC(calendarYear, calendarMonth + 1, 0, 12)).getUTCDate();
  const earliestDate = firstBookableDate();
  const earliestMonth = easternMonthDate(earliestDate.getUTCFullYear(), earliestDate.getUTCMonth(), 1);
  const quickDates = useMemo(() => [0, 1, 2].map(offset => parseEasternDate(easternDateIso(new Date(), offset))), []);

  if (success) return <main className="ibr-review-launcher ibr-completion-launcher"><div className="ibr-completion-backdrop"><section className="ibr-success-card ibr-completion-modal" role="dialog" aria-modal="true" aria-labelledby="booking-created-title"><button type="button" className="ibr-completion-close" aria-label="Close booking confirmation" onClick={() => { setSuccess(null); setIsOpen(false); }}>×</button><div className="ibr-success-icon"><Check size={25} /></div><p className="ey">BOOKING CREATED</p><h1 id="booking-created-title">You’re all set.</h1><p className="ibr-success-lede">{success}</p><div className="ibr-completion-details"><div><span>BOOKING</span><strong>{createdBooking?.publicBookingNumber ?? "Created"}</strong></div><div><span>CUSTOMER</span><strong>{customerName || "Customer"}</strong></div><div><span>WHEN</span><strong>{easternDateLabel(date)} · {timeLabel(time)}</strong></div><div><span>SERVICE</span><strong>{serviceTitle}</strong></div><div className="ibr-completion-detail-wide"><span>WHERE</span><strong>{address || "Service address"}</strong></div><div><span>TOTAL</span><strong>{money(total)}</strong></div></div><div className="ibr-completion-upsells"><div><span className="ibr-completion-section-kicker">WHILE WE’RE THERE</span><h2>Add additional services</h2><p>Optional services can be added to this booking now.</p></div><div className="ibr-completion-service-grid">{additionalServiceOptions.map(service => { const quantity = additionalServices[service.id] ?? 0; return <div className={`ibr-completion-service${quantity ? " is-selected" : ""}`} key={service.id}><button type="button" className="ibr-service-toggle" onClick={() => setAdditionalService(service.id, quantity ? -quantity : 1)}><span><strong>{service.title}</strong><small>{money(service.unitPriceCents)} · {service.copy}</small></span></button><div className="ibr-service-quantity"><button type="button" aria-label={`Decrease ${service.title}`} disabled={!quantity} onClick={() => setAdditionalService(service.id, -1)}><Minus size={13} /></button><b>{quantity}</b><button type="button" aria-label={`Increase ${service.title}`} onClick={() => setAdditionalService(service.id, 1)}><Plus size={13} /></button></div></div>; })}</div><button type="button" className="ibr-create-button ibr-save-upsells" disabled={busy} onClick={submit}>{updateAdditionalServices.isPending ? "Saving services…" : "Save additional services"}<ArrowRight size={15} /></button></div><div className="ibr-completion-actions"><button type="button" onClick={() => window.location.assign("/admin/bookings")}>Open bookings CRM <ArrowRight size={15} /></button><button type="button" className="secondary" onClick={() => { reset(); completionBookingRef.current = null; setCreatedBooking(null); setCardClientSecret(null); setCardSetupIntentId(null); setCardSaved(false); setSuccess(null); setError(null); setFieldErrors({}); setPayment("card"); setAdditionalServices({}); setStep(1); }}>Create another booking</button><button type="button" className="tertiary" onClick={() => { setSuccess(null); setIsOpen(false); }}>Close</button></div></section></div></main>;

  return <div className="ibr-review-launcher">
    {!isOpen && <button type="button" className="ibr-open-button" onClick={() => setIsOpen(true)}>Open Internal Booking</button>}
    {isOpen && <div className="ibr-modal-backdrop" onClick={() => setIsOpen(false)}><div className="ibr-modal-window" onClick={event => event.stopPropagation()}><button type="button" className="ibr-modal-close" aria-label="Close Internal Booking" onClick={() => setIsOpen(false)}>×</button><div className="ibr-review-page"><main className="ibr-page-shell">
      <div className="ibr-page-heading"><div><h1>Create a New Booking</h1><p>Book a cleaning for a customer. Fill out the details below and we’ll create the booking in LeadFlow.</p></div><button className="ibr-history-button" type="button"><UserRound size={15} /> View Customer History <ArrowRight size={15} /></button></div>
      <div className="ibr-layout"><div className="ibr-form-card">
        <Section number={1} title="Customer Information" prompt="Can I get your name, phone number, and email so I can get this on the calendar for you?" state={sectionState(1)}><div className="ibr-fields-3"><ReviewField label="Full Name" value={customerName} onChange={value => { setCustomerName(value); setFieldErrors(current => ({ ...current, customerName: "" })); }} placeholder="e.g. Sarah Johnson" required error={fieldErrors.customerName} inputRef={customerNameRef} /><ReviewField label="Phone" value={customerPhone} onChange={value => { setCustomerPhone(value); setFieldErrors(current => ({ ...current, customerPhone: "" })); }} placeholder="(202) 555-1234" required error={fieldErrors.customerPhone} inputRef={customerPhoneRef} /><ReviewField label="Email" value={customerEmail} onChange={value => { setCustomerEmail(value); setFieldErrors(current => ({ ...current, customerEmail: "" })); }} placeholder="sarah@example.com" required error={fieldErrors.customerEmail} inputRef={customerEmailRef} /></div></Section>
        <Section number={2} title="Service Type" prompt="What type of cleaning do you need? Most customers choose a Standard or Deep Clean." state={sectionState(2)}><div className="ibr-choice-grid">{services.map(item => { const Icon = item.icon; return <button type="button" key={item.id} className={`ibr-choice ${serviceId === item.id ? "is-selected" : ""}`} onClick={() => setServiceId(item.id)}><Icon size={23} /><span><strong>{item.title}</strong><small>{item.copy}</small></span></button>; })}</div></Section>
        <Section number={3} title="Home Details" prompt="Choose home-based pricing or hourly pricing, then enter the details needed for the estimate." state={sectionState(3)}><div className="ibr-home-details"><div className="ibr-choice-grid"><button type="button" className={`ibr-choice ${pricingMode === "home" ? "is-selected" : ""}`} onClick={() => setPricingMode("home")}><Home size={20} /><span><strong>Home pricing</strong><small>Price by bedrooms, bathrooms, and home condition.</small></span></button><button type="button" className={`ibr-choice ${pricingMode === "hourly" ? "is-selected" : ""}`} onClick={() => setPricingMode("hourly")}><Clock3 size={20} /><span><strong>Hourly pricing</strong><small>Price by number of maids and hours.</small></span></button></div>{pricingMode === "hourly" ? <div className="ibr-fields-2"><div className="ibr-stepper-field"><span>Maids <b>*</b></span><div className="ibr-stepper"><button type="button" aria-label="Decrease maids" disabled={maidCount <= 1} onClick={() => setMaidCount(Math.max(1, maidCount - 1))}><Minus size={15} /></button><strong>{maidCount} {maidCount === 1 ? "maid" : "maids"}</strong><button type="button" aria-label="Increase maids" disabled={maidCount >= 4} onClick={() => setMaidCount(Math.min(4, maidCount + 1))}><Plus size={15} /></button></div></div><div className="ibr-stepper-field"><span>Hours <b>*</b></span><div className="ibr-stepper"><button type="button" aria-label="Decrease hours" disabled={hourCount <= 1} onClick={() => setHourCount(Math.max(1, hourCount - 1))}><Minus size={15} /></button><strong>{hourCount} {hourCount === 1 ? "hour" : "hours"}</strong><button type="button" aria-label="Increase hours" disabled={hourCount >= 8} onClick={() => setHourCount(Math.min(8, hourCount + 1))}><Plus size={15} /></button></div></div></div> : <><div className="ibr-fields-2"><div className="ibr-stepper-field"><span>Bedrooms <b>*</b></span><div className="ibr-stepper"><button type="button" aria-label="Decrease bedrooms" onClick={() => setBedrooms(Math.max(0, bedrooms - 1))}><Minus size={15} /></button><strong>{bedrooms === 0 ? "Studio" : `${bedrooms} ${bedrooms === 1 ? "bedroom" : "bedrooms"}`}</strong><button type="button" aria-label="Increase bedrooms" onClick={() => setBedrooms(Math.min(7, bedrooms + 1))}><Plus size={15} /></button></div></div><div className="ibr-stepper-field"><span>Bathrooms <b>*</b></span><div className="ibr-stepper"><button type="button" aria-label="Decrease bathrooms" onClick={() => setBathrooms(Math.max(1, bathrooms - 1))}><Minus size={15} /></button><strong>{bathrooms} {bathrooms === 1 ? "bathroom" : "bathrooms"}</strong><button type="button" aria-label="Increase bathrooms" onClick={() => setBathrooms(Math.min(5, bathrooms + 1))}><Plus size={15} /></button></div></div></div><div className="ibr-home-type"><span className="ibr-control-label">Home type</span><div className="ibr-home-type-grid">{homeTypes.map(type => <button type="button" key={type} className={homeType === type ? "is-selected" : ""} onClick={() => setHomeType(type)}><Home size={15} />{type}</button>)}</div></div><label className="ibr-basement-row"><span><input type="checkbox" checked={hasBasement} onChange={event => setHasBasement(event.target.checked)} /><span><strong>Basement</strong><small>Add basement as an extra so the team has enough time.</small></span></span><b>{hasBasement ? "+$40" : "Optional"}</b></label></>}<div className="ibr-condition-control"><div className="ibr-condition-heading"><span>Home condition <small>1 = light touch-up · 10 = full reset</small></span><strong>{condition}/10 · {condition <= 3 ? "Light" : condition <= 6 ? "Average" : condition <= 8 ? "Detailed" : "Heavy"}</strong></div><input aria-label="Home condition" type="range" min="1" max="10" value={condition} onChange={event => setCondition(Number(event.target.value))} /><div className="ibr-condition-scale"><span>1 · Light upkeep</span><span>5 · Average</span><span>10 · Heavy condition</span></div></div></div></Section>
        <Section number={4} title="Additional Services" optional prompt="Would you like to add any extras? These are popular add-ons." state={sectionState(4)}><div className="ibr-extra-grid">{extras.map(extra => <button type="button" key={extra.id} className={`ibr-extra ${(extraQuantities[extra.id] ?? 0) > 0 ? "is-selected" : ""}`} onClick={() => toggleExtra(extra.id, extra.price)}><span className="ibr-check">{(extraQuantities[extra.id] ?? 0) > 0 ? <Check size={13} /> : null}</span><span><strong>{extra.label}</strong><small>{extra.price ? `+$${extra.price}` : "Custom"}</small></span></button>)}</div></Section>
        <Section number={5} title="Date & Time" prompt="What day works best for you? We have these times available." state={sectionState(5)}><div className="ibr-date-layout"><div className="ibr-calendar"><header><button type="button" aria-label="Previous month" disabled={visibleMonth <= earliestMonth} onClick={() => setVisibleMonth(easternMonthDate(calendarYear, calendarMonth - 1, 1))}><ChevronLeft size={18} /></button><strong>{easternMonthLabel(visibleMonth)}</strong><button type="button" aria-label="Next month" onClick={() => setVisibleMonth(easternMonthDate(calendarYear, calendarMonth + 1, 1))}><ChevronRight size={18} /></button></header><div className="ibr-calendar-week">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <span key={day}>{day}</span>)}</div><div className="ibr-calendar-days">{Array.from({ length: calendarLeading + calendarDays }, (_, index) => { const day = index - calendarLeading + 1; if (index < calendarLeading) return <span key={`empty-${index}`} />; const dayDate = easternMonthDate(calendarYear, calendarMonth, day); const unavailable = dayDate < earliestDate; const selected = easternDateIsoFromDate(dayDate) === easternDateIsoFromDate(selectedDate); const hasAvailability = !unavailable && [1, 2, 3, 5, 6].includes(dayDate.getUTCDay()); return <button type="button" key={day} className={selected ? "selected" : unavailable ? "muted" : ""} disabled={unavailable} onClick={() => chooseDate(easternDateIsoFromDate(dayDate))}>{day}{hasAvailability && !selected && <span className="ibr-calendar-dot" aria-hidden="true" />}</button>; })}</div><div className="ibr-calendar-quick-dates">{quickDates.map((quickDate, index) => <button type="button" key={easternDateIsoFromDate(quickDate)} className={easternDateIsoFromDate(quickDate) === date ? "selected" : ""} onClick={() => chooseDate(easternDateIsoFromDate(quickDate))}><span><strong>{index === 0 ? "Today" : index === 1 ? "Tomorrow" : easternDateLabel(easternDateIsoFromDate(quickDate)).split(",")[0]}</strong><small>{easternDateLabel(easternDateIsoFromDate(quickDate))}</small></span><ChevronRight size={14} /></button>)}</div></div><div className="ibr-date-side"><div className="ibr-field"><span>Selected date</span><div className="ibr-input-with-icon"><CalendarDays size={16} /><span>{easternDateLabel(date)}</span></div></div><div className="ibr-field"><span>Arrival window</span><div className="ibr-input-with-icon"><Clock3 size={16} /><span>{timeLabel(time)} – {timeLabel(`${String((Number(time.slice(0, 2)) + 2) % 24).padStart(2, "0")}:${time.slice(3)}`)}</span></div></div></div></div><div className="ibr-availability"><div className="ibr-availability-heading"><span>Available arrival windows</span><small>Live schedule preview</small></div><div className="ibr-availability-grid">{standardTimes.slice(0, 4).map(value => { const count = timeCounts.get(value) ?? 0; const recommended = value === recommendedTime; return <button type="button" key={value} className={time === value ? "is-selected" : ""} onClick={() => setTime(value)}><span><strong>{timeLabel(value)} – {timeLabel(`${String((Number(value.slice(0, 2)) + 2) % 24).padStart(2, "0")}:${value.slice(3)}`)}</strong><small>{timeCountsQuery.isLoading ? "Loading schedule…" : timeCountsQuery.isError ? "Schedule counts unavailable" : `${count} open${recommended ? " · Recommended" : ""}`}</small></span>{recommended && <em>Best option</em>}</button>; })}</div></div><div className="ibr-info-note"><Info size={16} /> We provide a 2-hour arrival window. You’ll get a text when the team is on the way.</div></Section>
        <Section number={6} title="Address" prompt="What’s the cleaning address?" state={sectionState(6)}><div className={`ibr-input-with-icon ibr-wide-input${fieldErrors.address ? " has-error" : ""}`}><MapPin size={17} /><input ref={addressRef} value={address} onChange={event => { setAddress(event.target.value); setFieldErrors(current => ({ ...current, address: "" })); }} placeholder="Street, city, state, ZIP" aria-required="true" aria-invalid={Boolean(fieldErrors.address)} /></div>{fieldErrors.address && <small className="ibr-field-error ibr-address-error" role="alert">{fieldErrors.address}</small>}</Section>
        <Section number={7} title="Recurring" optional prompt="Would you like to set this up as a recurring service? You’ll save 15% on future cleanings." state={sectionState(7)}><div className="ibr-frequency-grid">{(CANONICAL_FREQUENCIES as readonly Frequency[]).map(value => <button type="button" key={value} className={`ibr-frequency ${frequency === value ? "is-selected" : ""}`} onClick={() => setFrequency(value)}><span className="ibr-radio" /><span><strong>{frequencyLabel(value)}</strong>{value !== "one-time" && <small>Save 15%</small>}</span></button>)}</div></Section>
        <Section number={8} title="Payment" prompt="How would you like to collect payment? Choose card, Cash App, or invoice." state={sectionState(8)}><div className="ibr-payment-grid">{([{ id: "card", label: "Card", icon: CreditCard }, { id: "cashapp", label: "Cash App", icon: WalletCards }, { id: "invoice", label: "Invoice", icon: Landmark }] as const).map(item => { const Icon = item.icon; return <button type="button" key={item.id} className={`ibr-payment ${payment === item.id ? "is-selected" : ""}`} disabled={busy} onClick={() => { if (createdBooking) { switchPayment.mutate({ bookingId: createdBooking.bookingId, paymentMethod: item.id }); } else { setPayment(item.id); } }}><Icon size={18} /><span><strong>{item.label}</strong></span></button>; })}</div>{payment === "card" && createdBooking && cardClientSecret && cardSetupIntentId ? <div className="ibr-card-setup"><Elements stripe={stripePromise} options={{ clientSecret: cardClientSecret, appearance: { theme: "stripe" } }}><PremiumCardSetupForm customerName={customerName} clientSecret={cardClientSecret} onConfirm={paymentMethodId => confirmCardSetup.mutateAsync({ bookingId: createdBooking.bookingId, setupIntentId: cardSetupIntentId, paymentMethodId }).then(() => undefined)} /></Elements></div> : payment === "card" && createdBooking ? <div className="ibr-card-setup"><strong>Preparing secure card entry…</strong></div> : payment === "card" ? <div className="ibr-card-setup"><strong>Card setup begins after Book service.</strong><small>This matches the existing Internal Booking workflow.</small></div> : <div className="ibr-card-setup"><strong>{payment === "cashapp" ? "Cash App selected" : "Invoice selected"}</strong><small>Payment will be collected according to the existing Internal Booking workflow.</small></div>}</Section>
      </div><aside className="ibr-sidebar"><section className="ibr-summary-card"><div className="ibr-side-heading"><div><small className="ibr-summary-kicker">REVIEW BEFORE CREATING</small><h2>Booking Summary</h2></div><button type="button" onClick={() => setStep(1)}>✎ Edit</button></div><div className="ibr-summary-service"><Home size={24} /><div><strong>{serviceTitle}</strong><span>{homeDetail}</span></div></div><div className="ibr-price-lines"><div><span>First cleaning</span><b>{money(pricing.firstCleaningTotalCents)}</b></div>{selectedExtras.map(extra => <div key={extra.id}><span>{extra.label}</span><b>{money(extra.price * 100 * (extraQuantities[extra.id] ?? 0))}</b></div>)}<div className="ibr-total"><span>Estimated Total</span><b>{money(total)}</b></div></div><div className="ibr-summary-details"><div><CalendarDays size={17} /><span>{easternDateLabel(date)}</span></div><div><Clock3 size={17} /><span>{timeLabel(time)} arrival window</span></div><div><MapPin size={17} /><span>{address || "Service address not entered"}</span></div></div><div className="ibr-success-note"><Check size={16} /><span>Price will be shown to customer and booking will be created in LeadFlow.</span></div></section><section className="ibr-side-card ibr-notes-card"><div className="ibr-side-heading"><div><h2>Booking notes</h2><small>Keep the important details in one place.</small></div><span>{notes.length}/500</span></div><textarea value={notes} maxLength={500} onChange={event => setNotes(event.target.value)} placeholder="Add notes for the team…" /></section><button type="button" className="ibr-sidebar-book-button ibr-create-button" disabled={busy} onClick={() => { if (!createdBooking) { submit(); return; } if (payment === "card" && !cardSaved) { setError("Save the card before continuing."); return; } submit(); }}><span>{busy ? "Preparing secure payment…" : createdBooking ? payment === "card" && !cardSaved ? "Enter card details" : "Finish booking" : "Create booking"}</span><ArrowRight size={15} /></button></aside></div>
      {error && <div className="ibr-error" role="alert">{error}</div>}
    </main></div></div></div>}
  </div>;
}
