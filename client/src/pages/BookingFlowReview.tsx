import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Heart,
  House,
  Leaf,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Minus,
  Package,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
  UsersRound,
  WashingMachine,
} from "lucide-react";
import { useMemo, useState } from "react";
import livingRoom from "@/assets/book-now-review/living-room.jpg";
import kitchen from "@/assets/book-now-review/kitchen.jpg";
import stillLife from "@/assets/book-now-review/still-life.jpg";
import standardBedroom from "@/assets/book-now-review/standard-bedroom.png";
import deepKitchen from "@/assets/book-now-review/deep-kitchen.png";
import moveoutBoxes from "@/assets/book-now-review/moveout-boxes.png";
import homeDetailsRail from "@/assets/book-now-review/home-details-rail.png";
import extrasBathroomRail from "@/assets/book-now-review/extras-bathroom-rail.png";
import extrasCabinets from "@/assets/book-now-review/extras-cabinets.png";
import extrasFridge from "@/assets/book-now-review/extras-fridge.png";
import extrasBaseboards from "@/assets/book-now-review/extras-baseboards.png";
import extrasLaundry from "@/assets/book-now-review/extras-laundry.png";
import extrasOven from "@/assets/book-now-review/extras-oven.png";
import extrasWindows from "@/assets/book-now-review/extras-windows.png";
import extrasCeilingFans from "@/assets/book-now-review/extras-ceiling-fans.png";
import extrasDoors from "@/assets/book-now-review/extras-doors.png";
import spotlessHouse from "@/assets/book-now-review/condition-01-spotless-house-ui.png";
import refreshedHouse from "@/assets/book-now-review/condition-02-refresh-house-ui.png";
import normalSofa from "@/assets/book-now-review/condition-03-sofa-ui.png";
import livedInHouse from "@/assets/book-now-review/condition-04-lived-in-house-ui.png";
import prettyLivedInSofa from "@/assets/book-now-review/condition-05-pretty-lived-in-sofa-ui.png";
import laundryBasket from "@/assets/book-now-review/condition-06-laundry-basket-ui.png";
import goodGlovesHouse from "@/assets/book-now-review/condition-07-good-gloves-ui.png";
import aTeamCleaningKit from "@/assets/book-now-review/condition-08-a-team-cleaning-kit-ui.png";
import reinforcementsBoxes from "@/assets/book-now-review/condition-09-reinforcements-boxes-ui.png";
import trashBags from "@/assets/book-now-review/condition-10-trash-bags-ui.png";
import "./booking-flow-review.css";

type Service = "standard" | "deep" | "moveout";
type Frequency = "one-time" | "weekly" | "biweekly" | "monthly";

const STEPS = [
  ["Cleaning Type", "Choose your service"],
  ["Home Details", "Tell us about your home"],
  ["Home Condition", "Helps us give you the best experience."],
  ["Extras", "Add more (optional)"],
  ["Date & Time", "Pick what works for you"],
  ["Your Info", "Contact details"],
  ["Payment", "Secure and easy"],
  ["Review & Book", "Confirm your cleaning"],
] as const;

const SERVICES: Array<{ id: Service; title: string; body: string; bullets: string[]; image: string }> = [
  { id: "standard", title: "Standard Cleaning", body: "Keep your home fresh, clean and comfortable.", bullets: ["Everyday cleaning", "Most popular", "Great for recurring"], image: standardBedroom },
  { id: "deep", title: "Deep Cleaning", body: "A more detailed, top-to-bottom clean.", bullets: ["Inside appliances", "Baseboards & more", "Best for first-time cleans"], image: deepKitchen },
  { id: "moveout", title: "Move-out Cleaning", body: "A complete clean for your next chapter.", bullets: ["Detailed top-to-bottom", "Inside cabinets", "Perfect for moving"], image: moveoutBoxes },
];

const EXTRAS = [
  ["inside-fridge", "Inside Fridge", "We’ll clean the inside and outside.", 25, extrasFridge],
  ["inside-oven", "Inside Oven", "Remove grease and residue.", 25, extrasOven],
  ["cabinets", "Interior Cabinets", "Wipe down inside cabinets.", 30, extrasCabinets],
  ["windows", "Windows (Interior)", "Clean interior windows and sills.", 20, extrasWindows],
  ["baseboards", "Baseboards", "Dust and wipe all baseboards.", 20, extrasBaseboards],
  ["laundry", "Laundry", "Wash, dry and fold one load.", 20, extrasLaundry],
  ["doors", "Interior Doors", "Wipe down doors and frames.", 15, extrasDoors],
  ["fans", "Ceiling Fans", "Dust and wipe ceiling fans.", 15, extrasCeilingFans],
] as const;

const CONDITION_COPY = [
  "Basically spotless",
  "Just needs a refresh",
  "Normal everyday mess",
  "Definitely lived-in",
  "Pretty lived-in",
  "It’s been a minute",
  "Bring the good gloves",
  "We need the A-team",
  "Send reinforcements",
  "Don’t ask. Just come.",
];

const CONDITION_IMAGES = [spotlessHouse, refreshedHouse, normalSofa, livedInHouse, prettyLivedInSofa, laundryBasket, goodGlovesHouse, aTeamCleaningKit, reinforcementsBoxes, trashBags] as const;

const UPSELLS = [
  ["Moving Help", "Let our trusted team handle the heavy lifting.", "From $99/hr", livingRoom],
  ["Lawn Care", "A clean yard makes a happier home.", "From $75", kitchen],
  ["Handyman Services", "Small fixes, big peace of mind.", "From $75/hr", stillLife],
  ["Junk Removal", "We haul it away so you don’t have to.", "From $99", livingRoom],
  ["Furniture Cleaning", "Deep clean your sofas, mattresses, and more.", "From $99", kitchen],
  ["Appliance Cleaning", "Inside your fridge, oven, and more.", "From $49", stillLife],
  ["Window Cleaning", "Streak-free windows for a brighter home.", "From $99", livingRoom],
  ["Pet Area Cleaning", "Tackle pet hair, odors, and messes.", "From $79", kitchen],
] as const;

function toMoney(value: number) { return `$${value}`; }

export default function BookingFlowReview() {
  const [step, setStep] = useState(1);
  const [complete, setComplete] = useState(false);
  const [service, setService] = useState<Service>("standard");
  const [bedrooms, setBedrooms] = useState(3);
  const [bathrooms, setBathrooms] = useState(2);
  const [homeType, setHomeType] = useState("House");
  const [frequency, setFrequency] = useState<Frequency>("one-time");
  const [condition, setCondition] = useState(5);
  const [extras, setExtras] = useState<Record<string, number>>({ "inside-fridge": 1, baseboards: 1 });
  const [selectedTime, setSelectedTime] = useState("10:00 AM");
  const [payMethod, setPayMethod] = useState("card");
  const [savedCard, setSavedCard] = useState(true);

  const selectedService = SERVICES.find((item) => item.id === service) ?? SERVICES[0];
  const base = service === "deep" ? 265 : service === "moveout" ? 295 : 180;
  const extraTotal = EXTRAS.reduce((total, [id, , , price]) => total + (extras[id] ?? 0) * price, 0);
  const total = base + extraTotal + 10;
  const selectedExtras = EXTRAS.filter(([id]) => (extras[id] ?? 0) > 0);
  const currentStep = STEPS[step - 1];
  const serviceLabel = selectedService.title;
  const rightImage = step === 2 ? homeDetailsRail : step === 4 ? extrasBathroomRail : step === 5 ? stillLife : livingRoom;

  const progressDetails = useMemo(() => [
    serviceLabel,
    `${bedrooms} bed · ${bathrooms} bath · ${homeType}`,
    `${condition} · ${CONDITION_COPY[condition - 1]}`,
    selectedExtras.length ? `${selectedExtras.length} extras selected` : "No extras selected",
    "Fri, Sep 18 · 10:00 AM",
    "Taylor Johnson",
    "Visa ending in 4242",
    "Confirm your cleaning",
  ], [bathrooms, bedrooms, condition, homeType, selectedExtras.length, serviceLabel]);

  const changeExtra = (id: string, delta: number) => setExtras((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) + delta) }));
  const next = () => {
    if (step === 8) setComplete(true);
    else setStep((current) => current + 1);
  };

  if (complete) return <BookingSuccessReview total={total} onRestart={() => { setComplete(false); setStep(1); }} />;

  return <main className="booking-review-page">
    <div className="booking-review-status">VISUAL REVIEW ONLY · No booking, customer, or payment data is collected.</div>
    <header className="booking-review-header">
      <a href="/" className="booking-review-brand" aria-label="Maids in Black home"><strong>Maids in Black<sup>®</sup></strong><span>CLEAN HOMES. BRIGHTER LIVES.</span></a>
      <div className="booking-review-help"><MessageCircle /> <span>Need help? Text us</span><i /> <strong>(202) 964-9506</strong></div>
    </header>

    <section className="booking-review-shell">
      <aside className="booking-review-progress" aria-label="Booking review progress">
        <ol>{STEPS.map(([title, subtitle], index) => {
          const itemStep = index + 1;
          const done = itemStep < step;
          const current = itemStep === step;
          return <li key={title} className={done ? "done" : current ? "current" : "future"}>
            <span>{done ? <Check /> : itemStep}</span><div><strong>{title}</strong><small>{done ? progressDetails[index] : current ? subtitle : subtitle}</small></div>
          </li>;
        })}</ol>
        <div className="booking-review-secure"><ShieldCheck /><div><strong>Secure booking</strong><span>Your information is always protected.</span></div></div>
      </aside>

      <section className="booking-review-stage">
        <div className={`booking-review-card${step === 1 ? " booking-review-card--service" : step === 3 ? " booking-review-card--condition" : ""}`}>
          <div className="booking-review-card-main">
            <div className="booking-review-overline">STEP {step} OF 8</div>
            {step === 1 && <CleaningType selected={service} onSelect={setService} />}
            {step === 2 && <HomeDetails bedrooms={bedrooms} bathrooms={bathrooms} homeType={homeType} frequency={frequency} onBedrooms={setBedrooms} onBathrooms={setBathrooms} onHomeType={setHomeType} onFrequency={setFrequency} />}
            {step === 3 && <HomeCondition value={condition} onChange={setCondition} />}
            {step === 4 && <Extras extras={extras} onChange={changeExtra} />}
            {step === 5 && <DateTime selectedTime={selectedTime} onSelectTime={setSelectedTime} />}
            {step === 6 && <YourInformation />}
            {step === 7 && <Payment method={payMethod} onMethod={setPayMethod} saved={savedCard} onSaved={setSavedCard} />}
            {step === 8 && <ReviewAndBook service={serviceLabel} bedrooms={bedrooms} bathrooms={bathrooms} homeType={homeType} condition={condition} extras={selectedExtras} total={total} onEdit={setStep} />}
          </div>
          {step !== 1 && step !== 3 && <aside className="booking-review-rail">
            {step === 7 || step === 8 ? <BookingSummary total={total} service={serviceLabel} bedrooms={bedrooms} bathrooms={bathrooms} extras={selectedExtras} /> : <ReassuranceRail image={rightImage} step={step} />}
          </aside>}
          <footer className="booking-review-actions">
            <button type="button" className="booking-review-back" onClick={() => setStep((current) => Math.max(1, current - 1))} disabled={step === 1}><ArrowLeft />Back</button>
            <div><Heart /> <span>{step === 8 ? "You won’t be charged until after your cleaning." : "A cleaner, happier home is just a few steps away."}</span></div>
            <button type="button" className="booking-review-next" onClick={next}>{step === 8 ? <><Check />Everything looks good</> : step === 3 ? <><span>Continue <ArrowRight /></span><small>Next: Extras</small></> : <>Continue <ArrowRight /></>}</button>
          </footer>
        </div>
      </section>
    </section>
  </main>;
}

function CleaningType({ selected, onSelect }: { selected: Service; onSelect: (service: Service) => void }) {
  return <><h1>What can we help you with?</h1><p className="booking-review-lede">Choose the type of cleaning that fits your needs.</p><div className="booking-service-grid">{SERVICES.map((item) => <button type="button" key={item.id} className={selected === item.id ? "selected" : ""} onClick={() => onSelect(item.id)}><img src={item.image} alt="Warm home interior" /><span className="booking-service-radio">{selected === item.id && <Check />}</span><h2>{item.title}</h2><p>{item.body}</p><ul>{item.bullets.map((bullet) => <li key={bullet}><Check />{bullet}</li>)}</ul></button>)}</div></>;
}

function Segment({ label, value, selected, onSelect }: { label: string; value: number; selected: number; onSelect: (value: number) => void }) {
  return <div className="booking-segment-field"><label>{label}</label><div>{[1, 2, 3, 4, 5].map((item) => <button type="button" key={item} className={selected === item ? "selected" : ""} onClick={() => onSelect(item)}>{item === 5 ? "5+" : item}</button>)}</div></div>;
}

function HomeDetails({ bedrooms, bathrooms, homeType, frequency, onBedrooms, onBathrooms, onHomeType, onFrequency }: { bedrooms: number; bathrooms: number; homeType: string; frequency: Frequency; onBedrooms: (value: number) => void; onBathrooms: (value: number) => void; onHomeType: (value: string) => void; onFrequency: (value: Frequency) => void }) {
  return <><h1>Tell us about your home</h1><p className="booking-review-lede">This helps us give you the most accurate price and send the right team.</p><div className="booking-home-row"><Segment label="Bedrooms" value={bedrooms} selected={bedrooms} onSelect={onBedrooms} /><Segment label="Bathrooms" value={bathrooms} selected={bathrooms} onSelect={onBathrooms} /></div><label className="booking-select"><span>Home size <em>(optional)</em></span><button type="button">Select square footage <ChevronDown /></button></label><div className="booking-home-type"><span>Home type</span><div>{[["House", House], ["Apartment", BedDouble], ["Townhome", House], ["Condo", BedDouble]].map(([name, Icon]) => { const IconComponent = Icon as typeof House; return <button type="button" className={homeType === name ? "selected" : ""} key={name as string} onClick={() => onHomeType(name as string)}><IconComponent />{name as string}</button>; })}</div></div><div className="booking-frequency"><span>Is this a recurring cleaning? <CircleHelp /></span><div>{[["one-time", "One-time"], ["weekly", "Weekly"], ["biweekly", "Bi-weekly"], ["monthly", "Monthly"]].map(([id, label]) => <button type="button" className={frequency === id ? "selected" : ""} key={id} onClick={() => onFrequency(id as Frequency)}>{label}</button>)}</div></div></>;
}

function HomeCondition({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const percent = ((value - 1) / 9) * 100;
  return <><h1>How much love does your home need?</h1><p className="booking-review-lede">No judgment — this just helps us send the right team and allow enough time.</p><section className="booking-condition-canvas"><div className="booking-condition-choices">{CONDITION_COPY.map((copy, index) => <button type="button" className={value === index + 1 ? "selected" : ""} onClick={() => onChange(index + 1)} key={copy}><span className="booking-condition-emoji" aria-hidden="true"><img src={CONDITION_IMAGES[index]} alt="" /></span><span>{copy}</span><b>{index + 1}</b></button>)}</div><div className="booking-condition-slider"><div className="booking-condition-track"><input aria-label="Home condition score" type="range" min="1" max="10" value={value} style={{ background: `linear-gradient(90deg, #e7d8c3 0%, #e7d8c3 ${percent}%, #171613 ${percent}%, #171613 100%)` }} onChange={(event) => onChange(Number(event.target.value))} /><output className="booking-condition-value" aria-hidden="true" style={{ left: `${percent}%` }}>{value}</output></div><div>{Array.from({ length: 10 }, (_, index) => <span key={index}>{index + 1}</span>)}</div></div><div className="booking-condition-feedback"><span aria-hidden="true">😅</span><div><strong>{CONDITION_COPY[value - 1]}</strong><p>Totally normal! We’ll make it feel fresh and clean again.</p></div></div></section></>;
}

function Extras({ extras, onChange }: { extras: Record<string, number>; onChange: (id: string, delta: number) => void }) {
  return <><h1>Add any extras?</h1><p className="booking-review-lede">Make it your own. You can always add more later.</p><div className="booking-extras-grid">{EXTRAS.map(([id, title, description, price, image]) => { const quantity = extras[id] ?? 0; return <article key={id}><img src={image} alt="Clean home detail" /><div><strong>{title}</strong><p>{description}</p><b>+{toMoney(price)}</b></div><div className="booking-quantity"><button type="button" onClick={() => onChange(id, -1)} disabled={quantity === 0}><Minus /></button><span>{quantity}</span><button type="button" onClick={() => onChange(id, 1)}><Plus /></button></div></article>; })}</div><div className="booking-review-note"><Sparkles /><span><strong>Not sure what you need?</strong> No problem — you can always add more later or tell your team on the day of your cleaning.</span></div></>;
}

function DateTime({ selectedTime, onSelectTime }: { selectedTime: string; onSelectTime: (time: string) => void }) {
  const times = ["8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];
  return <><h1>When works for you?</h1><p className="booking-review-lede">Select a date and time for your cleaning.</p><div className="booking-date-layout"><section className="booking-calendar"><header><ChevronLeft /><strong>September 2026</strong><ChevronRight /></header><div className="booking-calendar-week">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <span key={day}>{day}</span>)}</div><div className="booking-calendar-days">{Array.from({ length: 35 }, (_, index) => { const date = index - 1; return <button type="button" className={date === 18 ? "selected" : date < 1 || date > 30 ? "muted" : ""} key={index}>{date < 1 ? "" : date > 30 ? date - 30 : date}</button>; })}</div><div className="booking-review-note"><CalendarDays /><span><strong>Need something sooner?</strong> Text us at <b>(202) 964-9506</b> — we’ll do our best to help.</span></div></section><section className="booking-times"><h3>Available times</h3>{times.map((time) => <button type="button" className={selectedTime === time ? "selected" : ""} key={time} onClick={() => onSelectTime(time)}>{time}</button>)}</section></div></>;
}

function YourInformation() {
  return <><h1>Your information</h1><p className="booking-review-lede">We’ll use this to confirm your booking and keep you updated.</p><div className="booking-contact-grid"><label>First name *<input defaultValue="Taylor" /></label><label>Last name *<input defaultValue="Johnson" /></label><label className="full">Phone number *<span className="booking-input-with-icon"><MessageCircle /><input defaultValue="(202) 555-1234" /></span></label><label className="full">Email address *<span className="booking-input-with-icon"><MessageCircle /><input defaultValue="taylor@gmail.com" /></span><small>We’ll send your confirmation and receipts here.</small></label><label className="full">Service address *<span className="booking-input-with-icon"><MapPin /><input defaultValue="1234 14th St NW, Washington, DC 20009" /></span><a href="#review-only">Enter address manually</a></label><label className="full">Access notes <em>(optional)</em><textarea placeholder="e.g. gate code, lockbox, parking instructions, pets, etc." /></label></div></>;
}

function Payment({ method, onMethod, saved, onSaved }: { method: string; onMethod: (value: string) => void; saved: boolean; onSaved: (value: boolean) => void }) {
  return <><h1>Payment</h1><p className="booking-review-lede">Add your payment method to secure your booking.</p><div className="booking-payment-methods"><button type="button" className={method === "card" ? "selected" : ""} onClick={() => onMethod("card")}><CreditCard /><span><strong>Credit or debit card</strong><small>Fast, secure, and easy</small></span></button><button type="button" className={method === "wallet" ? "selected" : ""} onClick={() => onMethod("wallet")}><span className="booking-apple-mark">●</span><span><strong>Google Pay / Apple Pay</strong><small>Quick checkout</small></span></button></div><div className="booking-card-form"><label>Card number <span className="booking-input-with-icon"><CreditCard /><input placeholder="1234 1234 1234 1234" /><i>VISA</i></span></label><div><label>Expiration date<input placeholder="MM / YY" /></label><label>CVC<input placeholder="123" /></label></div><label>Name on card<input defaultValue="Taylor Johnson" /></label><label className="booking-save-card"><input type="checkbox" checked={saved} onChange={(event) => onSaved(event.target.checked)} /><span><strong>Save this card for future bookings</strong><small>It’s faster next time, and you can manage or remove it anytime.</small></span></label></div><div className="booking-payment-security"><LockKeyhole /><span><strong>Your payment information is secure.</strong><small>Provider-hosted payment fields will be connected after visual approval.</small></span><b>stripe</b></div></>;
}

function ReviewAndBook({ service, bedrooms, bathrooms, homeType, condition, extras, total, onEdit }: { service: string; bedrooms: number; bathrooms: number; homeType: string; condition: number; extras: ReadonlyArray<readonly [string, string, string, number, string]>; total: number; onEdit: (step: number) => void }) {
  const cards = [[1, "Cleaning Type", service, Sparkles], [2, "Home Details", `${bedrooms} bedrooms · ${bathrooms} bathrooms · ${homeType}`, House], [3, "Home Condition", `${condition} · ${CONDITION_COPY[condition - 1]}`, House], [4, "Extras", extras.length ? extras.map((item) => item[1]).join(", ") : "No extras selected", Sparkles], [5, "Date & Time", "Friday, September 18, 2026 · 10:00 AM", CalendarDays], [6, "Your Information", "Taylor Johnson · (202) 555-1234 · taylor@gmail.com", UsersRound], [7, "Payment Method", "Visa ending in 4242 · Expires 04/28", CreditCard]] as const;
  return <><h1>Thanks for booking!</h1><p className="booking-review-lede">Take a final look below and confirm your details.</p><div className="booking-final-grid">{cards.map(([target, title, detail, Icon]) => <article key={title}><Icon /><div><strong>{title}</strong><p>{detail}</p></div><button type="button" onClick={() => onEdit(target)}><span>Edit</span><ChevronRight /></button></article>)}</div><div className="booking-review-final-note"><ShieldCheck />Nothing is booked in this visual review. The live final-confirmation path will be attached only after the design is approved.</div></>;
}

function ReassuranceRail({ image, step }: { image: string; step: number }) {
  const contents = step === 4 ? ["Professional, detail-oriented cleaners", "Eco-friendly products", "Save time and get more done", "A home you’ll love coming back to"] : step === 5 ? ["Flexible scheduling", "Same-day options (when available)", "Trusted, background-checked cleaners", "Satisfaction guaranteed"] : step === 6 ? ["Trusted & insured", "Background-checked cleaners", "Eco-friendly products", "Your information is secure", "A cleaner, happier home awaits"] : ["Trusted & insured", "Background-checked team", "Eco-friendly products", "Easy online booking", "Satisfaction guaranteed"];
  const headline = step === 4 ? "Little extras. A big difference." : step === 6 ? "You’re almost there." : "A cleaner, happier home is just a few steps away.";
  return <div className="booking-reassurance"><img src={image} alt="Warm clean home interior" /><h2>{headline}</h2>{step === 6 && <p>Just a few more details and you’ll be all set.</p>}<i /><ul>{contents.map((item, index) => <li key={item}>{index === 0 ? <ShieldCheck /> : index === 1 ? <UsersRound /> : index === 2 ? <Leaf /> : index === 3 ? <CalendarDays /> : <Heart />}{item}</li>)}</ul>{step === 6 && <blockquote>“Booking was so easy and the team was amazing. Highly recommend!”<span><Star fill="currentColor" /><Star fill="currentColor" /><Star fill="currentColor" /><Star fill="currentColor" /><Star fill="currentColor" /> — DC Customer</span></blockquote>}</div>;
}

function BookingSummary({ total, service, bedrooms, bathrooms, extras }: { total: number; service: string; bedrooms: number; bathrooms: number; extras: ReadonlyArray<readonly [string, string, string, number, string]> }) {
  return <div className="booking-summary-rail"><img src={stillLife} alt="Warm clean home interior" /><h2>{service === "Standard Cleaning" ? "Booking summary" : "Order summary"}</h2><button type="button"><span>Edit</span><ChevronRight /></button><dl><div><dt>Cleaning type</dt><dd>{service}</dd></div><div><dt>Home details</dt><dd>{bedrooms} bed · {bathrooms} bath · House</dd></div><div><dt>Home condition</dt><dd>5 · Pretty lived-in</dd></div>{extras.map((item) => <div key={item[0]}><dt>{item[1]}</dt><dd>{toMoney(item[3])}</dd></div>)}<div><dt>Date & time</dt><dd>Fri, Sep 18, 2026 · 10:00 AM</dd></div></dl><div className="booking-summary-total"><span>Estimated total <CircleHelp /></span><strong>{toMoney(total)}</strong></div><div className="booking-summary-guarantee"><ShieldCheck /><span><strong>Satisfaction guaranteed</strong><small>Not happy? We’ll make it right. Our team is committed to your satisfaction.</small></span></div></div>;
}

function BookingSuccessReview({ total, onRestart }: { total: number; onRestart: () => void }) {
  return <main className="booking-review-page"><div className="booking-review-status">VISUAL REVIEW ONLY · This success state does not create a booking or send messages.</div><header className="booking-review-header"><a href="/" className="booking-review-brand"><strong>Maids in Black<sup>®</sup></strong><span>CLEAN HOMES. BRIGHTER LIVES.</span></a><div className="booking-review-help"><MessageCircle /> <span>Need help? Text us</span><i /> <strong>(202) 964-9506</strong></div></header><section className="booking-success-layout"><div><section className="booking-success-intro"><span><Check /></span><div><h1>You’re booked!</h1><p>Thanks for choosing Maids in Black.</p><small><MessageCircle />A confirmation text has been sent to (202) 555-1234.</small><small><MessageCircle />We’ve also emailed the details to taylor@gmail.com.</small></div></section><section className="booking-upsells"><div><small>MAKE LIFE EVEN EASIER</small><h2>Need anything else?</h2><p>Add more services and let us take care of it all.</p></div><div className="booking-upsell-grid">{UPSELLS.map(([title, copy, price, image]) => <article key={title}><img src={image} alt="Home service visual" /><div><strong>{title}</strong><p>{copy}</p><b>{price}</b><button type="button">Add to Booking</button></div></article>)}</div><button type="button" className="booking-all-services">View All Services <ArrowRight /></button></section></div><aside className="booking-success-summary"><img src={stillLife} alt="Warm clean home interior" /><h2>Booking Details</h2><dl><div><CalendarDays /><span>Fri, Sep 18, 2026<br /><small>10:00 AM – 12:00 PM</small></span></div><div><House /><span>3 bed · 2 bath · House</span></div><div><Sparkles /><span>Standard Cleaning</span></div><div><Package /><span>Inside Fridge, Baseboards</span></div><div><UsersRound /><span>Taylor Johnson<br /><small>(202) 555-1234 · taylor@gmail.com</small></span></div><div><CreditCard /><span>Visa ending in 4242</span></div></dl><div className="booking-success-total"><span>Total Paid</span><strong>{toMoney(total)}</strong></div><button type="button" className="booking-return" onClick={onRestart}>Back to flow <ArrowRight /></button></aside></section></main>;
}
