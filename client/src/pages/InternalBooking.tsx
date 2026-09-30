import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, Plus, UserRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
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

const SERVICES: BookingWidgetServiceId[] = ["standard", "deep", "moveout"];
const FREQUENCIES: BookingWidgetRecurringFrequency[] = ["one-time", "weekly", "biweekly", "monthly"];
const HOME_TYPES: PublicBookingHomeType[] = ["House", "Apartment", "Townhome", "Condo"];
const TIMES = ["08:30", "11:00", "13:30", "16:30"];
const EXTRA_OPTIONS = Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS);

function tomorrowIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function label(value: string) {
  if (value === "one-time") return "One-time";
  if (value === "biweekly") return "Bi-weekly";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function InternalBooking() {
  const [, navigate] = useLocation();
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
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cashapp" | "invoice">("card");
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pricing = useMemo(() => calculatePublicBookingPrice({
    pricingMode,
    serviceId,
    bedrooms,
    bathrooms,
    homeType,
    condition,
    maidCount,
    hourCount,
    extras: Object.entries(extras).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity })),
    recurrence: frequency,
  }), [pricingMode, serviceId, bedrooms, bathrooms, homeType, condition, maidCount, hourCount, extras, frequency]);

  const createBooking = trpc.bookings.createInternal.useMutation({
    onSuccess: result => {
      setSuccess(`${result.publicBookingNumber} created at ${money(result.totalCents)}. It is now in Bookings for assignment and follow-up.`);
      setError(null);
    },
    onError: mutationError => {
      setError(mutationError.message);
      setSuccess(null);
    },
  });

  const setExtra = (id: string, quantity: number) => {
    setExtras(current => {
      const next = { ...current };
      if (quantity > 0) next[id] = quantity;
      else delete next[id];
      return next;
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const pricingInput = {
      pricingMode,
      serviceId,
      bedrooms,
      bathrooms,
      homeType,
      condition,
      maidCount,
      hourCount,
      extras: Object.entries(extras).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity })),
      recurrence: frequency,
    };
    createBooking.mutate({
      idempotencyKey: crypto.randomUUID(),
      paymentMethod,
      companyNotes: notes.trim() || null,
      booking: {
        surface: "full_page",
        customer: { fullName: customerName, phone: customerPhone, email: customerEmail },
          service: {
          serviceId,
          bedrooms,
          bathrooms,
          extras: pricingInput.extras,
          specialRequestNotes: [],
        },
        address,
        requestedSchedule: { localDate: date, localTime: time },
        recurrence: frequency,
        acceptedPricing: { version: PUBLIC_BOOKING_PRICING_VERSION, totalCents: pricing.firstCleaningTotalCents },
        pricing: pricingInput,
      },
    });
  };

  if (success) {
    return <main className="internal-booking-shell"><section className="internal-booking-success"><CheckCircle2 size={44} /><p className="eyebrow">BOOKING CREATED</p><h1>{success.split(" created")[0]}</h1><p>{success.slice(success.indexOf(" created") + 1)}</p><button type="button" onClick={() => navigate("/admin/bookings")}>Open bookings CRM</button><button className="secondary" type="button" onClick={() => setSuccess(null)}>Create another booking</button></section></main>;
  }

  return (
    <main className="internal-booking-shell">
      <form className="internal-booking-form" onSubmit={submit}>
        <header className="internal-booking-header"><button type="button" className="back-button" onClick={() => navigate("/admin/bookings")}><ArrowLeft size={18} /> Back to bookings</button><p className="eyebrow">INTERNAL BOOKING</p><h1>New booking</h1><p>Create the same native booking that comes through the public form — streamlined for a phone call.</p></header>
        <section className="internal-booking-section"><div className="section-title"><UserRound size={18} /><h2>Customer</h2></div><div className="field-grid"><label>Full name<input required value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Customer name" /></label><label>Phone<input required value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} placeholder="202-555-0123" /></label><label>Email<input required type="email" value={customerEmail} onChange={event => setCustomerEmail(event.target.value)} placeholder="customer@example.com" /></label><label className="wide">Address<input required value={address} onChange={event => setAddress(event.target.value)} placeholder="Street, city, state, ZIP" /></label></div></section>
        <section className="internal-booking-section"><div className="section-title"><Plus size={18} /><h2>Service</h2></div><div className="choice-row">{SERVICES.map(value => <button type="button" className={serviceId === value ? "choice selected" : "choice"} key={value} onClick={() => setServiceId(value)}>{getPublicBookingServiceName(value)}</button>)}</div><div className="choice-row"><button type="button" className={pricingMode === "home" ? "choice selected" : "choice"} onClick={() => setPricingMode("home")}>Bedrooms & bathrooms</button><button type="button" className={pricingMode === "hourly" ? "choice selected" : "choice"} onClick={() => setPricingMode("hourly")}>Hourly instead</button></div>{pricingMode === "home" ? <div className="field-grid"><label>Bedrooms<select value={bedrooms} onChange={event => setBedrooms(Number(event.target.value))}>{[0,1,2,3,4,5,6,7].map(value => <option key={value} value={value}>{value === 0 ? "Studio" : value}</option>)}</select></label><label>Bathrooms<select value={bathrooms} onChange={event => setBathrooms(Number(event.target.value))}>{[1,2,3,4,5].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Home type<select value={homeType} onChange={event => setHomeType(event.target.value as PublicBookingHomeType)}>{HOME_TYPES.map(value => <option key={value}>{value}</option>)}</select></label><label>Condition<select value={condition} onChange={event => setCondition(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label></div> : <div className="field-grid"><label>Maids<select value={maidCount} onChange={event => setMaidCount(Number(event.target.value))}>{[1,2,3,4].map(value => <option key={value}>{value}</option>)}</select></label><label>Hours<select value={hourCount} onChange={event => setHourCount(Number(event.target.value))}>{[1,2,3,4,5,6,7,8].map(value => <option key={value}>{value}</option>)}</select></label></div>}</section>
        <section className="internal-booking-section"><div className="section-title"><CalendarDays size={18} /><h2>Schedule</h2></div><div className="field-grid"><label>Date<input required type="date" min={tomorrowIso()} value={date} onChange={event => setDate(event.target.value)} /></label><label>Arrival time<select value={time} onChange={event => setTime(event.target.value)}>{TIMES.map(value => <option key={value}>{value}</option>)}</select></label><label>Frequency<select value={frequency} onChange={event => setFrequency(event.target.value as BookingWidgetRecurringFrequency)}>{FREQUENCIES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label></div></section>
        <section className="internal-booking-section"><div className="section-title"><Plus size={18} /><h2>Extras</h2></div><div className="extras-grid">{EXTRA_OPTIONS.map(([id, extra]) => <label className="extra-row" key={id}><span><b>{extra.label}</b><small>${extra.unitPrice}{extra.quantityUnit ? ` / ${extra.quantityUnit}` : ""}</small></span><input type="number" min={0} max={50} value={extras[id] ?? 0} onChange={event => setExtra(id, Number(event.target.value))} /></label>)}</div></section>
        <section className="internal-booking-section"><div className="section-title"><Clock3 size={18} /><h2>Collection & notes</h2></div><div className="choice-row">{(["card", "cashapp", "invoice"] as const).map(value => <button type="button" className={paymentMethod === value ? "choice selected" : "choice"} key={value} onClick={() => setPaymentMethod(value)}>{value === "cashapp" ? "Cash App" : label(value)}</button>)}</div><label>Company notes<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Anything the team should know" /></label></section>
        <aside className="internal-booking-total"><div><span>First cleaning</span><strong>{money(pricing.firstCleaningTotalCents)}</strong></div>{pricing.futureVisitTotalCents !== null && <div><span>{label(frequency)} after visit one</span><strong>{money(pricing.futureVisitTotalCents)} / visit</strong></div>}<button type="submit" disabled={createBooking.isPending}>{createBooking.isPending ? "Creating booking…" : "Create booking"}</button>{error && <p className="form-error">{error}</p>}</aside>
      </form>
    </main>
  );
}
