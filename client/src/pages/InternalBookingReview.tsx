import React, { useContext, useState } from "react";
import "./internal-booking-review.css";
import { ArrowRight, CalendarDays, Check, ChevronDown, Clock3, CreditCard, Home, Info, Landmark, MapPin, Sparkles, UserRound, WalletCards, FileText } from "lucide-react";

type ServiceId = "standard" | "deep" | "moveout";
type Frequency = "one-time" | "weekly" | "biweekly" | "monthly";
type Payment = "card" | "cashapp" | "invoice";
type SectionState = "current" | "completed" | "pending";
const availability = [
  { time: "8:30 AM – 10:30 AM", count: 2, recommended: true },
  { time: "10:30 AM – 12:30 PM", count: 4, recommended: false },
  { time: "1:00 PM – 3:00 PM", count: 1, recommended: false },
  { time: "3:30 PM – 5:30 PM", count: 3, recommended: false },
];
const homeTypes = ["House", "Apartment", "Townhome", "Condo"];
const services = [
  { id: "standard" as const, title: "Standard Clean", copy: "Regular cleaning for maintained homes", icon: Home },
  { id: "deep" as const, title: "Deep Clean", copy: "More detailed cleaning for a deeper refresh", icon: Sparkles },
  { id: "moveout" as const, title: "Move-out Clean", copy: "Thorough cleaning for move-outs", icon: FileText },
];
const extras = [
  { id: "fridge", label: "Inside Fridge", price: 30 }, { id: "oven", label: "Inside Oven", price: 30 }, { id: "windows", label: "Interior Windows", price: 25 },
  { id: "laundry", label: "Laundry (1 load)", price: 25 }, { id: "organizing", label: "Organizing", price: 30 }, { id: "other", label: "Other (specify)", price: 0 },
];
const ReviewProgressContext = React.createContext<{activeStep:number; setActiveStep:React.Dispatch<React.SetStateAction<number>>; completedSteps:number[]}>({activeStep:1,setActiveStep:()=>{},completedSteps:[]});

function ReviewField({ label, value, placeholder, required = false, onChange }: { label: string; value: string; placeholder?: string; required?: boolean; onChange?: (value: string) => void }) {
  return (
    <label className="ibr-field">
      <span>{label}{required && <b> *</b>}</span>
      <input value={value} placeholder={placeholder} readOnly={!onChange} onChange={event => onChange?.(event.target.value)} aria-label={label} />
    </label>
  );}
function Section({ number, title, optional, prompt, children }: { number: number; title: string; optional?: boolean; prompt: string; children: React.ReactNode }) {
  const { activeStep, setActiveStep, completedSteps } = useContext(ReviewProgressContext);
  const state: SectionState = number === activeStep ? "current" : number < activeStep && completedSteps.includes(number) ? "completed" : "pending";
  return (
    <section className={`ibr-section is-${state}`} onFocusCapture={() => setActiveStep(number)}>
      <div className="ibr-section-label"><span className="ibr-step-number">{number}</span><div><h2>{title}{optional && <em> (Optional)</em>}</h2><div className="ibr-prompt"><b>What to say:</b><span>“{prompt}”</span></div></div></div>
      <div className="ibr-section-content">{children}</div>
    </section>
  );}

export default function InternalBookingReview() {
  const [service, setService] = useState<ServiceId>("standard");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [address, setAddress] = useState("");
  const [bedrooms, setBedrooms] = useState("3 bedrooms");
  const [bathrooms, setBathrooms] = useState("2 bathrooms");
  const [homeType, setHomeType] = useState("House");
  const [hasBasement, setHasBasement] = useState(false);
  const [selectedExtras, setSelectedExtras] = useState<string[]>(["fridge"]);
  const [frequency, setFrequency] = useState<Frequency>("one-time");
  const [payment, setPayment] = useState<Payment>("card");
  const [notes, setNotes] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [selectedDate, setSelectedDate] = useState("Tue, Oct 14, 2026");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [homeCondition, setHomeCondition] = useState(5);
  const [selectedTime, setSelectedTime] = useState(availability[0].time);
  const [cardSetupReady, setCardSetupReady] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardZip, setCardZip] = useState("");
  const [activeStep, setActiveStep] = useState(3);
  const completedSteps = [
    customerName.trim() && customerPhone.trim() ? 1 : null,
    service ? 2 : null,
    bedrooms && bathrooms && homeType ? 3 : null,
    selectedExtras.length > 0 ? 4 : null,
    selectedDate && selectedTime ? 5 : null,
    address.trim() ? 6 : null,
    frequency ? 7 : null,
    payment === "card" ? (cardSetupReady ? 8 : null) : 8,
  ].filter((step): step is number => step !== null);
  const firstIncompleteStep = [1, 2, 3, 4, 5, 6, 7, 8].find(step => !completedSteps.includes(step)) ?? 8;
  const visibleActiveStep = Math.min(activeStep, firstIncompleteStep);

  const basePrice = service === "deep" ? 399 : service === "moveout" ? 449 : 299;
  const extrasTotal = extras.filter(extra => selectedExtras.includes(extra.id)).reduce((sum, extra) => sum + extra.price, 0);
  const total = basePrice + extrasTotal;
  const serviceTitle = service === "deep" ? "Deep Clean" : service === "moveout" ? "Move-out Clean" : "Standard Clean";
  return (
    <div className="ibr-review-launcher">
      {!isOpen && <button type="button" className="ibr-open-button" onClick={() => setIsOpen(true)}>Open Internal Booking</button>}
      {isOpen && <div className="ibr-modal-backdrop" onClick={() => setIsOpen(false)}>
        <div className="ibr-modal-window" onClick={event => event.stopPropagation()}>
          <button type="button" className="ibr-modal-close" aria-label="Close Internal Booking" onClick={() => setIsOpen(false)}>×</button>
          <div className="ibr-review-page">
        <main className="ibr-page-shell">
<div className="ibr-page-heading"><div><h1>Create a New Booking</h1><p>Book a cleaning for a customer. Fill out the details below and we’ll create the booking in LeadFlow.</p></div><button className="ibr-history-button" type="button"><UserRound size={15} /> View Customer History <ArrowRight size={15} /></button></div>  <div className="ibr-layout"> <ReviewProgressContext.Provider value={{ activeStep: visibleActiveStep, setActiveStep, completedSteps }}><div className="ibr-form-card"> <Section number={1} title="Customer Information" prompt="Can I get your name, phone number, and email so I can get this on the calendar for you?"><div className="ibr-fields-3"><ReviewField label="Full Name" value={customerName} onChange={setCustomerName} placeholder="e.g. Sarah Johnson" required /><ReviewField label="Phone" value={customerPhone} onChange={setCustomerPhone} placeholder="(202) 555-1234" required /><ReviewField label="Email" value={customerEmail} onChange={setCustomerEmail} placeholder="sarah@example.com" /></div></Section> <Section number={2} title="Service Type" prompt="What type of cleaning do you need? Most customers choose a Standard or Deep Clean."><div className="ibr-choice-grid">{services.map(item => { const Icon = item.icon; return <button type="button" key={item.id} className={`ibr-choice ${service === item.id ? "is-selected" : ""}`} onClick={() => { setService(item.id); setActiveStep(3); }}><Icon size={23} /><span><strong>{item.title}</strong><small>{item.copy}</small></span></button>; })}</div></Section> <Section number={3} title="Home Details" prompt="How many bedrooms and bathrooms do you have? This helps me give you the most accurate price."><div className="ibr-home-details"><div className="ibr-fields-2"><label className="ibr-field"><span>Bedrooms <b>*</b></span><select value={bedrooms} onChange={event => setBedrooms(event.target.value)}><option>1 bedroom</option><option>2 bedrooms</option><option>3 bedrooms</option><option>4 bedrooms</option><option>5 bedrooms</option></select></label><label className="ibr-field"><span>Bathrooms <b>*</b></span><select value={bathrooms} onChange={event => setBathrooms(event.target.value)}><option>1 bathroom</option><option>2 bathrooms</option><option>3 bathrooms</option><option>4 bathrooms</option></select></label></div><div className="ibr-home-type"><span className="ibr-control-label">Home type</span><div className="ibr-home-type-grid">{homeTypes.map(type => <button type="button" key={type} className={homeType === type ? "is-selected" : ""} onClick={() => setHomeType(type)}><Home size={15} />{type}</button>)}</div></div><div className="ibr-basement-row"><label><input type="checkbox" checked={hasBasement} onChange={event => setHasBasement(event.target.checked)} /><span><strong>Basement</strong><small>Add basement as an extra so the team has enough time.</small></span></label><b>{hasBasement ? "+$40" : "Optional"}</b></div><div className="ibr-condition-control"><div className="ibr-condition-heading"><span>Home condition <small>1 = light touch-up · 10 = full reset</small></span><strong>{homeCondition}/10 · {homeCondition <= 3 ? "Light" : homeCondition <= 6 ? "Average" : homeCondition <= 8 ? "Detailed" : "Heavy"}</strong></div><input aria-label="Home condition" type="range" min="1" max="10" step="1" value={homeCondition} onChange={event => setHomeCondition(Number(event.target.value))} /><div className="ibr-condition-scale"><span>1 · Light upkeep</span><span>5 · Average</span><span>10 · Heavy condition</span></div></div></div></Section> <Section number={4} title="Additional Services" optional prompt="Would you like to add any extras? These are popular add-ons."><div className="ibr-extra-grid">{extras.map(extra => <button type="button" key={extra.id} className={`ibr-extra ${selectedExtras.includes(extra.id) ? "is-selected" : ""}`} onClick={() => toggleExtra(extra.id)}><span className="ibr-check">{selectedExtras.includes(extra.id) ? <Check size={13} /> : null}</span><span><strong>{extra.label}</strong><small>{extra.price ? `+$${extra.price}` : "Custom"}</small></span></button>)}</div></Section> <Section number={5} title="Date & Time" prompt="What day works best for you? We have these times available."><div className="ibr-fields-2"><div className="ibr-field ibr-calendar-field"><span>Date</span><button type="button" className="ibr-input-with-icon ibr-date-trigger" onClick={() => setCalendarOpen(current => !current)}><CalendarDays size={16} /><span>{selectedDate}</span><ChevronDown size={15} /></button>{calendarOpen && <div className="ibr-calendar-popover"><div className="ibr-calendar-header"><button type="button" aria-label="Previous month">‹</button><strong>October 2026</strong><button type="button" aria-label="Next month">›</button></div><div className="ibr-calendar-weekdays">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <span key={day}>{day}</span>)}</div><div className="ibr-calendar-grid">{calendarDays.map((day, index) => <button type="button" key={`${day}-${index}`} className={`${index < 3 || index > 33 ? "is-muted" : ""} ${day === 14 && index === 16 ? "is-selected" : ""}`} onClick={() => { setSelectedDate(`${day === 14 ? "Tue" : "Wed"}, Oct ${day}, 2026`); setCalendarOpen(false); }}>{day}</button>)}</div><button type="button" className="ibr-calendar-today" onClick={() => { setSelectedDate("Tue, Oct 14, 2026"); setCalendarOpen(false); }}>Today</button></div>}</div><div className="ibr-field"><span>Arrival window</span><div className="ibr-input-with-icon"><Clock3 size={16} /><span>{selectedTime}</span><ChevronDown size={15} /></div></div></div><div className="ibr-availability"><div className="ibr-availability-heading"><span>Available arrival windows</span><small>Live schedule preview</small></div><div className="ibr-availability-grid">{availability.map(item => <button type="button" key={item.time} className={selectedTime === item.time ? "is-selected" : ""} onClick={() => setSelectedTime(item.time)}><span><strong>{item.time}</strong><small>{item.count} open {item.recommended ? "· Recommended" : ""}</small></span>{item.recommended && <em>Best option</em>}</button>)}</div></div><div className="ibr-info-note"><Info size={16} /> We provide a 2-hour arrival window. You’ll get a text when the team is on the way.</div></Section> <Section number={6} title="Address" prompt="What’s the cleaning address?"><div className="ibr-input-with-icon ibr-wide-input"><MapPin size={17} /><input value={address} onChange={event => setAddress(event.target.value)} placeholder="123 Main St, Washington, DC 20001" /></div></Section> <Section number={7} title="Recurring" optional prompt="Would you like to set this up as a recurring service? You’ll save 15% on future cleanings."><div className="ibr-frequency-grid">{(["one-time", "weekly", "biweekly", "monthly"] as Frequency[]).map(item => <button type="button" key={item} className={`ibr-frequency ${frequency === item ? "is-selected" : ""}`} onClick={() => setFrequency(item)}><span className="ibr-radio" /> <span><strong>{item === "one-time" ? "One-time" : item.charAt(0).toUpperCase() + item.slice(1)}</strong>{item !== "one-time" && <small>Save 15%</small>}</span></button>)}</div></Section> <Section number={8} title="Payment" prompt="How would you like to collect payment? Choose card, Cash App, or invoice."><div className="ibr-payment-grid">{([{ id: "card", label: "Card", icon: CreditCard }, { id: "cashapp", label: "Cash App", icon: WalletCards }, { id: "invoice", label: "Invoice", icon: Landmark }] as const).map(item => { const Icon = item.icon; return <button type="button" key={item.id} className={`ibr-payment ${payment === item.id ? "is-selected" : ""}`} onClick={() => { setPayment(item.id); if (item.id !== "card") setCardSetupReady(false); }}><Icon size={18} /><span><strong>{item.label}</strong></span></button>; })}</div>{payment === "card" && <div className={`ibr-card-setup ${cardSetupReady ? "is-ready" : ""}`}><div className="ibr-card-setup-heading"><div><strong>{cardSetupReady ? "Card ready" : "Credit card details"}</strong><small>{cardSetupReady ? "This card is ready to attach when the booking is created." : "Enter the card details for this booking."}</small></div></div><div className="ibr-card-fields"><label><span>Card number</span><input inputMode="numeric" value={cardNumber} onChange={event => setCardNumber(event.target.value)} placeholder="1234 5678 9012 3456" /></label><label><span>Expiry</span><input inputMode="numeric" value={cardExpiry} onChange={event => setCardExpiry(event.target.value)} placeholder="MM / YY" /></label><label><span>CVC</span><input inputMode="numeric" value={cardCvc} onChange={event => setCardCvc(event.target.value)} placeholder="123" /></label><label><span>ZIP code</span><input inputMode="numeric" value={cardZip} onChange={event => setCardZip(event.target.value)} placeholder="20001" /></label></div><button type="button" onClick={() => setCardSetupReady(true)}>{cardSetupReady ? "Card ready" : "Save card"}<ArrowRight size={14} /></button></div>}</Section> </div></ReviewProgressContext.Provider><aside className="ibr-sidebar"><section className="ibr-summary-card"><div className="ibr-side-heading"><div><small className="ibr-summary-kicker">REVIEW BEFORE CREATING</small><h2>Booking Summary</h2></div><button type="button">✎ Edit</button></div><div className="ibr-summary-service"><Home size={24}/><div><strong>{serviceTitle}</strong><span>{bedrooms} · {bathrooms} · {homeType}</span></div></div><div className="ibr-price-lines"><div><span>Base Price</span><b>${basePrice}</b></div>{extras.filter(extra => selectedExtras.includes(extra.id)).map(extra => <div key={extra.id}><span>{extra.label}</span><b>${extra.price}</b></div>)}<div className="ibr-total"><span>Estimated Total</span><b>${total}</b></div></div><div className="ibr-summary-details"><div><CalendarDays size={17}/><span>{selectedDate}</span></div><div><Clock3 size={17}/><span>{selectedTime} (2-hour window)</span></div><div><MapPin size={17}/><span>{address || "123 Main St, Washington, DC 20001"}</span></div></div><div className="ibr-success-note"><Check size={16}/><span>Price will be shown to customer and booking will be created in LeadFlow.</span></div></section><section className="ibr-side-card ibr-notes-card"><div className="ibr-side-heading"><div><h2>Booking notes</h2><small>Keep the important details in one place.</small></div><span>{notes.length}/500</span></div><textarea value={notes} maxLength={500} onChange={event => setNotes(event.target.value)} placeholder="Add notes for the team..." /></section><button type="button" className="ibr-sidebar-book-button ibr-create-button"><span>Create booking</span><ArrowRight size={15}/></button></aside></div>
        </main>
          </div>
        </div>
      </div>}
    </div>
  );
}
