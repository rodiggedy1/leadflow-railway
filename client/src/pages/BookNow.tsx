import { trpc } from "@/lib/trpc";
import { NATIVE_BOOKING_PRICING_VERSION } from "@shared/booking";
import type { BookingFunnelPublicResult, UpdateBookingFunnelInput } from "@shared/bookingFunnel";
import {
  BOOKING_WIDGET_PRICED_EXTRAS,
  BOOKING_WIDGET_RECURRING_OPTIONS,
  calculateBookingWidgetPrice,
  calculateBookingWidgetRecurringPrice,
  parseBookingWidgetDraft,
  validateBookingWidgetIntakeField,
  type BookingWidgetRecurringFrequency,
  type BookingWidgetServiceId,
} from "@shared/bookingWidgetConfig";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CreditCard,
  Home,
  Loader2,
  LockKeyhole,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import "./book-now.css";

type AppointmentDate = { iso: string; day: string; date: string; full: string };

const SERVICE_COPY: Record<BookingWidgetServiceId, string> = {
  standard: "A reliable reset for regularly maintained homes",
  deep: "Detailed top-to-bottom care for extra buildup",
  moveout: "An empty-home clean designed for handoff day",
};

const SERVICE_ICONS: Record<BookingWidgetServiceId, string> = {
  standard: "✨",
  deep: "🧼",
  moveout: "📦",
};

const TIME_SLOTS = ["8:30 AM", "10:30 AM", "1:00 PM", "2:30 PM"] as const;

function createBookingAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function timeLabelTo24Hour(time: string): string {
  const match = /^(\d{1,2}):(\d{2})\s+(AM|PM)$/i.exec(time.trim());
  if (!match) throw new Error("Select a valid requested time.");
  const rawHour = Number(match[1]);
  const hour = rawHour % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function buildAppointmentDates(): AppointmentDate[] {
  return Array.from({ length: 4 }, (_, offset) => {
    const value = new Date();
    value.setHours(12, 0, 0, 0);
    value.setDate(value.getDate() + offset);
    return {
      iso: [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-"),
      day: value.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
      date: String(value.getDate()),
      full: value.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    };
  });
}

export default function BookNow() {
  const configQuery = trpc.bookings.getPublicWidgetConfig.useQuery(undefined, { staleTime: 5 * 60_000 });
  const beginFunnelMutation = trpc.bookingFunnel.begin.useMutation();
  const updateFunnelMutation = trpc.bookingFunnel.update.useMutation();
  const reserveFunnelMutation = trpc.bookingFunnel.reserve.useMutation();
  const config = useMemo(() => parseBookingWidgetDraft(JSON.stringify(configQuery.data)), [configQuery.data]);
  const dates = useMemo(buildAppointmentDates, []);
  const bookingAttemptIdRef = useRef(createBookingAttemptId());
  const funnelRecordRef = useRef<BookingFunnelPublicResult | null>(null);
  const leadCapturePromiseRef = useRef<Promise<BookingFunnelPublicResult | null> | null>(null);
  const initialSnapshotSavedRef = useRef(false);
  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState<BookingWidgetServiceId>("deep");
  const [bedrooms, setBedrooms] = useState(2);
  const [bathrooms, setBathrooms] = useState(2);
  const [selectedExtraIds, setSelectedExtraIds] = useState<string[]>(["inside-fridge"]);
  const [extraQuantities, setExtraQuantities] = useState<Record<string, number>>({ "inside-fridge": 1 });
  const [frequency, setFrequency] = useState<BookingWidgetRecurringFrequency>("biweekly");
  const [date, setDate] = useState(dates[0]);
  const [time, setTime] = useState<(typeof TIME_SLOTS)[number]>("1:00 PM");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [funnelRecord, setFunnelRecord] = useState<BookingFunnelPublicResult | null>(null);
  const [formError, setFormError] = useState("");
  const [demoCardSaved, setDemoCardSaved] = useState(false);
  const [done, setDone] = useState(false);

  const service = config.services.find((item) => item.id === serviceId) ?? config.services[1];
  const selectedExtras = BOOKING_WIDGET_PRICED_EXTRAS.filter((extra) => selectedExtraIds.includes(extra.id));
  const selectedExtraLabels = selectedExtras.map((extra) => extra.label);
  const priceBreakdown = calculateBookingWidgetPrice({
    serviceId,
    bedrooms,
    bathrooms,
    selectedExtras: selectedExtraLabels,
    extraQuantities,
  });
  const recurringPrice = calculateBookingWidgetRecurringPrice(priceBreakdown.total, frequency);
  const recurringOption = frequency === "one-time" ? null : BOOKING_WIDGET_RECURRING_OPTIONS.find((option) => option.id === frequency) ?? null;
  const progress = Math.round((step / 4) * 100);
  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
  const customerName = fullName || "there";
  const funnelMutationPending = beginFunnelMutation.isPending || updateFunnelMutation.isPending || reserveFunnelMutation.isPending;

  const rememberFunnelRecord = (record: BookingFunnelPublicResult | null) => {
    funnelRecordRef.current = record;
    setFunnelRecord(record);
  };

  const buildProgressivePatch = (): UpdateBookingFunnelInput["patch"] => ({
    customerName: fullName,
    customerPhone: phone.trim(),
    customerEmail: email.trim() || null,
    serviceId,
    serviceName: service.name,
    bedrooms,
    bathrooms,
    extras: selectedExtras.map((extra) => ({ id: extra.id, quantity: extra.quantityUnit ? extraQuantities[extra.id] ?? 1 : 1 })),
    specialRequestNotes: notes.trim() ? [notes.trim()] : [],
    address: address.trim() || null,
    requestedLocalDate: date.iso,
    requestedLocalTime: timeLabelTo24Hour(time),
    requestedTimeZone: "America/New_York",
    recurrence: frequency,
    pricingVersion: NATIVE_BOOKING_PRICING_VERSION,
    firstCleaningTotalCents: Math.round(priceBreakdown.total * 100),
    futureVisitTotalCents: recurringPrice === null ? null : Math.round(recurringPrice * 100),
    priceSnapshot: priceBreakdown,
  });

  const persistFunnelPatch = async (patch: UpdateBookingFunnelInput["patch"]) => {
    const current = funnelRecordRef.current;
    if (!current) return null;
    const next = await updateFunnelMutation.mutateAsync({
      publicFunnelNumber: current.publicFunnelNumber,
      mutationToken: current.mutationToken,
      expectedVersion: current.version,
      patch,
    });
    rememberFunnelRecord(next);
    return next;
  };

  const captureLeadIfReady = async (showValidation = false): Promise<BookingFunnelPublicResult | null> => {
    const nameError = validateBookingWidgetIntakeField("fullName", fullName);
    const phoneError = validateBookingWidgetIntakeField("phone", phone);
    if (nameError || phoneError) {
      if (showValidation) setFormError(nameError ?? phoneError ?? "Complete your name and phone number.");
      return null;
    }
    if (leadCapturePromiseRef.current) return leadCapturePromiseRef.current;
    const capture = (async () => {
      let current = funnelRecordRef.current;
      if (!current) {
        current = await beginFunnelMutation.mutateAsync({
          idempotencyKey: bookingAttemptIdRef.current,
          source: "book-page",
          customerName: fullName,
          customerPhone: phone,
        });
        rememberFunnelRecord(current);
      }
      if (!initialSnapshotSavedRef.current) {
        current = await persistFunnelPatch(buildProgressivePatch());
        if (!current) throw new Error("Lead record is unavailable. Please try again.");
        initialSnapshotSavedRef.current = true;
      }
      setFormError("");
      return current;
    })().catch((error: unknown) => {
      setFormError(error instanceof Error ? error.message : "We could not save your information. Please try again.");
      return null;
    }).finally(() => {
      leadCapturePromiseRef.current = null;
    });
    leadCapturePromiseRef.current = capture;
    return capture;
  };

  const toggleExtra = (id: string) => {
    const extra = BOOKING_WIDGET_PRICED_EXTRAS.find((item) => item.id === id);
    if (!extra) return;
    setSelectedExtraIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    if (extra.quantityUnit) setExtraQuantities((current) => ({ ...current, [id]: current[id] ?? 1 }));
  };

  const changeExtraQuantity = (id: string, quantity: number) => {
    setExtraQuantities((current) => ({ ...current, [id]: Math.max(1, Math.floor(quantity)) }));
  };

  const saveLeadContactIfReady = async () => {
    const nameError = validateBookingWidgetIntakeField("fullName", fullName);
    const phoneError = validateBookingWidgetIntakeField("phone", phone);
    if (nameError || phoneError) return;
    if (!funnelRecordRef.current) {
      await captureLeadIfReady();
      return;
    }
    if (leadCapturePromiseRef.current) {
      await leadCapturePromiseRef.current;
      return;
    }
    const sync = persistFunnelPatch({ customerName: fullName, customerPhone: phone })
      .catch((error: unknown) => {
        setFormError(error instanceof Error ? error.message : "We could not update your information. Please try again.");
        return null;
      })
      .finally(() => {
        leadCapturePromiseRef.current = null;
      });
    leadCapturePromiseRef.current = sync;
    await sync;
  };

  const continueToSecureBooking = async () => {
    const error = validateBookingWidgetIntakeField("fullName", fullName)
      ?? validateBookingWidgetIntakeField("phone", phone)
      ?? validateBookingWidgetIntakeField("email", email)
      ?? (address.trim().length >= 5 ? null : "Enter the complete service address.");
    if (error) {
      setFormError(error);
      return;
    }
    const captured = await captureLeadIfReady(true);
    const current = funnelRecordRef.current ?? captured;
    if (!current) return;
    setFormError("");
    try {
      const input = {
        publicFunnelNumber: current.publicFunnelNumber,
        mutationToken: current.mutationToken,
        expectedVersion: current.version,
        patch: buildProgressivePatch(),
      };
      const next = current.stage === "lead"
        ? await reserveFunnelMutation.mutateAsync(input)
        : await updateFunnelMutation.mutateAsync(input);
      rememberFunnelRecord(next);
      setStep(4);
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : "We could not reserve your appointment. Please try again.");
    }
  };

  const resetDemo = () => {
    setDone(false);
    setStep(1);
    setDemoCardSaved(false);
    rememberFunnelRecord(null);
    bookingAttemptIdRef.current = createBookingAttemptId();
    leadCapturePromiseRef.current = null;
    initialSnapshotSavedRef.current = false;
    setFormError("");
    beginFunnelMutation.reset();
    updateFunnelMutation.reset();
    reserveFunnelMutation.reset();
  };

  if (configQuery.isLoading) {
    return <main className="book-now-page book-now-loading"><Loader2 className="book-now-spinner" aria-label="Loading booking page" /></main>;
  }

  if (done) {
    return <main className="book-now-page book-now-confirmation-page"><section className="book-now-confirmation-card"><span className="book-now-big-check"><Check /></span><small>UI PREVIEW COMPLETE</small><h1>You&apos;re all set, {customerName} 🎉</h1><p>This visual preview shows how the confirmation screen will look. No booking or payment was submitted.</p><div className="book-now-confirmation-details"><div><CalendarDays /><span><small>WHEN</small><strong>{date.full} · {time}</strong></span></div><div><MapPin /><span><small>WHERE</small><strong>{address || "Service address"}</strong></span></div></div><div className="book-now-expect-grid"><article><span>📩</span><strong>Helpful reminders</strong><p>We&apos;ll text you before your cleaning.</p></article><article><span>🚗</span><strong>Track your team</strong><p>Get a tracking link when they&apos;re on the way.</p></article><article><span>💳</span><strong>Pay after service</strong><p>Your card won&apos;t be charged until the cleaning is complete.</p></article></div><button type="button" onClick={resetDemo}>Start over</button></section></main>;
  }

  return <main className="book-now-page">
    <header className="book-now-header"><div className="book-now-customer-logo"><Sparkles /><span>Maids in Black</span></div><div className="book-now-secure-copy"><ShieldCheck />Vetted teams · Satisfaction guaranteed</div><button type="button" disabled title="Customer support link will be connected later">Need help? <strong>Text us</strong></button></header>
    <div className="book-now-progress"><div><span>STEP {step} OF 4</span><strong>{step === 1 ? "Your cleaning" : step === 2 ? "Choose a time" : step === 3 ? "Your details" : "Secure booking"}</strong></div><div className="book-now-progress-track"><i style={{ width: `${progress}%` }} /></div></div>
    <div className="book-now-layout"><section className="book-now-workspace">
      {step === 1 && <div className="book-now-step-panel"><div className="book-now-step-heading"><small>BUILD YOUR CLEANING</small><h1>A cleaner home starts here.</h1><p>Tell us what you need. Your price updates instantly.</p></div><label className="book-now-field-label">Choose your service</label><div className="book-now-service-grid">{config.services.map((item) => { const minimum = calculateBookingWidgetPrice({ serviceId: item.id, bedrooms: 1, bathrooms: 1 }).total; return <button type="button" key={item.id} className={serviceId === item.id ? "book-now-service-card active" : "book-now-service-card"} onClick={() => setServiceId(item.id)}><span className="book-now-service-icon">{SERVICE_ICONS[item.id]}</span><strong>{item.name}</strong><p>{SERVICE_COPY[item.id]}</p><small>From ${minimum}</small>{serviceId === item.id && <i><Check /></i>}</button>; })}</div><label className="book-now-field-label">Tell us about your home</label><div className="book-now-home-controls"><Counter label="Bedrooms" value={bedrooms} minimum={0} maximum={7} setValue={setBedrooms} /><Counter label="Bathrooms" value={bathrooms} minimum={0} maximum={20} setValue={setBathrooms} /></div><label className="book-now-field-label">Make it yours <span>Optional</span></label><div className="book-now-extras-grid">{BOOKING_WIDGET_PRICED_EXTRAS.map((extra) => { const selected = selectedExtraIds.includes(extra.id); const quantity = extraQuantities[extra.id] ?? 1; return <div key={extra.id} className={selected ? "book-now-extra-card active" : "book-now-extra-card"}><button type="button" className="book-now-extra-toggle" onClick={() => toggleExtra(extra.id)}><span>{selected ? <Check /> : <Plus />}</span><strong>{extra.label}</strong><small>+${extra.unitPrice}{extra.quantityUnit ? `/${extra.quantityUnit}` : ""}</small></button>{selected && extra.quantityUnit && <div className="book-now-extra-quantity"><button type="button" aria-label={`Decrease ${extra.label} quantity`} onClick={() => changeExtraQuantity(extra.id, quantity - 1)}><Minus /></button><strong>{quantity}</strong><button type="button" aria-label={`Increase ${extra.label} quantity`} onClick={() => changeExtraQuantity(extra.id, quantity + 1)}><Plus /></button></div>}</div>; })}</div></div>}
      {step === 2 && <div className="book-now-step-panel"><div className="book-now-step-heading"><small>YOUR APPOINTMENT</small><h1>When should we come?</h1><p>Pick an available day and arrival window.</p></div><label className="book-now-field-label">Available dates</label><div className="book-now-date-grid">{dates.map((item) => <button type="button" key={item.iso} className={date.iso === item.iso ? "book-now-date-choice active" : "book-now-date-choice"} onClick={() => setDate(item)}><small>{item.day}</small><strong>{item.date}</strong>{date.iso === item.iso && <i />}</button>)}</div><div className="book-now-selected-date"><CalendarDays /><span><small>SELECTED DATE</small><strong>{date.full}</strong></span></div><label className="book-now-field-label">Arrival window</label><div className="book-now-time-grid">{TIME_SLOTS.map((item) => <button type="button" key={item} className={time === item ? "book-now-time-choice active" : "book-now-time-choice"} onClick={() => setTime(item)}>{item}<small>{item === "1:00 PM" ? "Best availability" : "Available"}</small></button>)}</div><label className="book-now-field-label">How often?</label><div className="book-now-frequency-grid"><button type="button" className={frequency === "one-time" ? "book-now-frequency-card active" : "book-now-frequency-card"} onClick={() => setFrequency("one-time")}><strong>One-time</strong><span>No commitment</span></button>{BOOKING_WIDGET_RECURRING_OPTIONS.map((option) => <button type="button" key={option.id} className={frequency === option.id ? "book-now-frequency-card active" : "book-now-frequency-card"} onClick={() => setFrequency(option.id)}><strong>{option.label}</strong><span>Save {option.discountPercent}%</span>{option.badge && <b>{option.badge}</b>}</button>)}</div>{recurringOption && recurringPrice !== null && <div className="book-now-first-clean-note"><ShieldCheck /><p><strong>Your first cleaning remains ${priceBreakdown.total}.</strong><br />Your {recurringOption.discountPercent}% savings begin with visit two — ${recurringPrice} per future visit.</p></div>}</div>}
      {step === 3 && <div className="book-now-step-panel"><div className="book-now-step-heading"><small>YOUR DETAILS</small><h1>Almost there.</h1><p>We&apos;ll use this information for confirmation and arrival updates.</p></div><div className="book-now-form-grid"><label><span>First name</span><input value={firstName} onChange={(event) => setFirstName(event.target.value)} onBlur={() => void saveLeadContactIfReady()} autoComplete="given-name" /></label><label><span>Last name</span><input value={lastName} onChange={(event) => setLastName(event.target.value)} onBlur={() => void saveLeadContactIfReady()} autoComplete="family-name" /></label><label><span>Mobile phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} onBlur={() => void saveLeadContactIfReady()} inputMode="tel" autoComplete="tel" /></label><label><span>Email address</span><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" /></label><label className="full"><span>Service address</span><div className="book-now-input-icon"><MapPin /><input value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" /></div></label><label className="full"><span>Access details or special requests <em>Optional</em></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Gate code, pets, priorities, parking instructions…" /></label></div>{formError && <div className="book-now-form-error" role="alert">{formError}</div>}{funnelRecord && <div className="book-now-save-status"><Check />{funnelRecord.stage === "lead" ? "Information saved" : "Reservation saved"}</div>}<div className="book-now-privacy-note"><LockKeyhole /><div><strong>Your information stays private</strong><p>We only use it for your booking, reminders, and arrival updates.</p></div></div></div>}
      {step === 4 && <div className="book-now-step-panel"><div className="book-now-step-heading"><small>SECURE YOUR APPOINTMENT</small><h1>Add a card to reserve your spot.</h1><p>You won&apos;t be charged until after your cleaning is complete.</p></div><div className="book-now-demo-notice"><LockKeyhole /><p><strong>UI preview only.</strong> Do not enter real card information. No card data is collected or stored.</p></div><div className="book-now-stripe-shell"><div className="book-now-stripe-top"><CreditCard /><div><strong>Secure card on file</strong><p>Payment information will be securely handled by Stripe.</p></div><span>stripe</span></div><label><span>Card number</span><div className="book-now-card-input"><input disabled placeholder="1234 1234 1234 1234" /><CreditCard /></div></label><div className="book-now-split-input"><label><span>Expiration</span><input disabled placeholder="MM / YY" /></label><label><span>Security code</span><input disabled placeholder="CVC" /></label></div><label><span>Name on card</span><input disabled value={customerName === "there" ? "Customer name" : customerName} readOnly /></label><button type="button" className={demoCardSaved ? "book-now-card-saved" : "book-now-save-card"} onClick={() => setDemoCardSaved(true)}>{demoCardSaved ? <><Check />Demo card state saved</> : <><LockKeyhole />Preview saved-card state</>}</button></div><div className="book-now-trust-row"><span><ShieldCheck />Secure Stripe-hosted fields in the live version</span><span><LockKeyhole />Never stored on our servers</span></div></div>}
      <footer className="book-now-step-actions">{step > 1 ? <button type="button" className="book-now-back-button" disabled={funnelMutationPending} onClick={() => setStep((current) => current - 1)}><ArrowLeft />Back</button> : <span />}<button type="button" className="book-now-next-button" disabled={(step === 3 && funnelMutationPending) || (step === 4 && !demoCardSaved)} onClick={() => step === 3 ? void continueToSecureBooking() : step < 4 ? setStep((current) => current + 1) : setDone(true)}>{step === 4 ? "Preview confirmation" : step === 3 && funnelMutationPending ? "Saving reservation…" : step === 3 ? "Continue to secure booking" : "Continue"}<ArrowRight /></button></footer>
    </section><aside className="book-now-summary"><div className="book-now-summary-top"><span>YOUR CLEANING</span><button type="button" onClick={() => setStep(1)}>Edit</button></div><h2>{service.name}</h2><p><Home /> {bedrooms === 0 ? "Studio" : `${bedrooms} bedrooms`} · {bathrooms} bathrooms</p><div className="book-now-summary-list"><div><span>Base cleaning</span><strong>${priceBreakdown.baseCleaningTotal}</strong></div>{priceBreakdown.serviceAdjustment > 0 && <div><span>{service.name} adjustment</span><strong>+${priceBreakdown.serviceAdjustment}</strong></div>}{selectedExtras.map((extra) => <div key={extra.id}><span>{extra.label}{extra.quantityUnit ? ` × ${extraQuantities[extra.id] ?? 1}` : ""}</span><strong>+${extra.unitPrice * (extra.quantityUnit ? extraQuantities[extra.id] ?? 1 : 1)}</strong></div>)}</div><div className="book-now-summary-total"><span>{frequency === "one-time" ? "Total" : "First cleaning"}</span><strong>${priceBreakdown.total}</strong></div>{recurringOption && recurringPrice !== null && <div className="book-now-future-summary"><span>{recurringOption.label} after visit one</span><strong>${recurringPrice}/visit</strong><small>Save {recurringOption.discountPercent}%</small></div>}<div className="book-now-appointment-preview"><CalendarDays /><div><small>YOUR APPOINTMENT</small><strong>{date.full}</strong><span>{time}</span></div><ChevronRight /></div><div className="book-now-summary-proof"><span className="book-now-proof-icon"><ShieldCheck /></span><div><strong>Professional, vetted cleaners</strong><p>Insured teams with supplies included</p></div></div><div className="book-now-summary-guarantee"><ShieldCheck /><p><strong>Happiness guaranteed</strong><br />If something isn&apos;t right, we&apos;ll return to make it right.</p></div></aside></div>
  </main>;
}

function Counter({ label, value, minimum, maximum, setValue }: { label: string; value: number; minimum: number; maximum: number; setValue: (next: number) => void }) {
  return <div className="book-now-counter"><div><Home /><span><small>HOME SIZE</small><strong>{label}</strong></span></div><div><button type="button" disabled={value <= minimum} onClick={() => setValue(Math.max(minimum, value - 1))}><Minus /></button><strong>{value}</strong><button type="button" disabled={value >= maximum} onClick={() => setValue(Math.min(maximum, value + 1))}><Plus /></button></div></div>;
}
