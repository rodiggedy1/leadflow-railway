import React, { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Bath,
  Minus,
  Plus,
  Sunrise,
  Sun,
  Sunset,
  CheckCircle2,
  LockKeyhole,
  ShieldCheck,
  Check,
  Clock,
  Users,
  House,
  Brush,
  Boxes,
} from "lucide-react";
import {
  useApprovedBookFlow,
  useApprovedBookLocation,
  useApprovedBookArrival,
  useApprovedBookContext,
  approvedBookArrivalLabel,
  approvedBookArrivalDiscountTitle,
} from "./ApprovedBookContext";
import { CANONICAL_TIME_SLOTS } from "@shared/canonicalBooking";
import { PUBLIC_BOOKING_PRICED_EXTRAS } from "@shared/publicBookingPricing";
import { easternDateLabel } from "@shared/easternTime";
import cabinets from "@/assets/book-now-review/extras-cabinets.png";
import fridge from "@/assets/book-now-review/extras-fridge.png";
import oven from "@/assets/book-now-review/extras-oven.png";
import windows from "@/assets/book-now-review/extras-windows.png";
import laundry from "@/assets/book-now-review/extras-laundry.png";
import ArrivalOptions from "./ArrivalOptions";
import ReviewCalendar from "./ReviewCalendar";
import "./second-page.css";

const extraOrder = [
  "inside-fridge",
  "inside-oven",
  "interior-windows",
  "inside-cabinets",
  "organizing-hour",
  "wipe-walls-room",
  "basement",
  "laundry-load",
  "sweep-garage",
];
const frequencyNames: Record<string, string> = {
  "one-time": "One-time",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
};
const serviceNames: Record<string, string> = {
  standard: "Standard cleaning",
  deep: "Deep cleaning",
  moveout: "Move-out cleaning",
};
const conditionOptions = [
  {
    value: 5,
    label: "Light / normal",
    detail: "Routine dusting, wiping and floors",
  },
  { value: 6, label: "Moderately messy", detail: "Extra clutter or buildup" },
  {
    value: 8,
    label: "Heavy cleaning needed",
    detail: "Significant dirt or buildup",
  },
  {
    value: 10,
    label: "Full reset / restoration",
    detail: "Severe buildup or a long-unattended home",
  },
];
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
function Quantity({
  label,
  value,
  min = 0,
  max = 50,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="br2-quantity">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus />
      </button>
      <span aria-live="polite">{value}</span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus />
      </button>
    </div>
  );
}
export default function SecondPage() {
  const flow = useApprovedBookFlow();
  const location = useApprovedBookLocation();
  const arrival = useApprovedBookArrival();
  const [error, setError] = useState("");
  const {
    setLocation,
    dateValue,
    dateMin,
    onDateChange,
    onNext,
    onBack,
    assets,
    smsConsent,
    entryMethod,
  } = useApprovedBookContext();
  const illustrations: Record<string, string> = {
    "inside-fridge": fridge,
    "inside-oven": oven,
    "interior-windows": windows,
    "inside-cabinets": cabinets,
    "laundry-load": laundry,
    "organizing-hour": assets.organizing,
    "wipe-walls-room": assets.wipeWalls,
    basement: assets.basement,
    "sweep-garage": assets.sweepGarage,
  };
  const p = flow.pricing;
  const frequency = frequencyNames[flow.frequency];
  const service = serviceNames[flow.service];
  const selectedTimeIndex = Math.max(
    0,
    CANONICAL_TIME_SLOTS.indexOf(
      arrival.startLocalTime as (typeof CANONICAL_TIME_SLOTS)[number]
    )
  );
  const updateAddress = (field: keyof typeof location, value: string) =>
    setLocation({ [field]: value });
  const proceed = () => {
    if (
      !flow.firstName.trim() ||
      !flow.lastName.trim() ||
      flow.customerPhone.replace(/\D/g, "").length < 10 ||
      !/^\S+@\S+\.\S+$/.test(flow.customerEmail.trim())
    ) {
      setError("Please complete your name, email and phone before continuing.");
      document.getElementById("br2-first-name")?.focus();
      return;
    }
    if (
      !location.street.trim() ||
      !location.city.trim() ||
      !location.region.trim() ||
      !/^\d{5}$/.test(location.zip)
    ) {
      setError(
        "Please enter your complete service address, including street, city, state and ZIP."
      );
      document.getElementById("br2-street")?.focus();
      return;
    }
    if (!dateValue || dateValue < dateMin) {
      setError("Please choose a date from tomorrow onwards.");
      return;
    }
    setError("");
    void onNext();
  };
  return (
    <main className="br-second-page">
      <section className="br2-hero">
        <div className="br2-container">
          <button type="button" className="br2-back" onClick={onBack}>
            <ArrowLeft />
            Back to your home
          </button>
          <div className="br2-step-label">STEP 2 OF 3 · YOUR CLEAN</div>
          <h1>Almost there. Let’s personalize your clean.</h1>
          <p className="br2-hero-subtitle">
            <strong>{frequency}</strong>
            {p.discountPercent > 0
              ? ` · Save ${p.discountPercent}% from your second clean`
              : " · A fresh start for your home"}
          </p>
          <div className="br2-hero-proof">
            <span>5-star rated</span>
            <span>90,000+ homes cleaned</span>
            <span>200% satisfaction guarantee</span>
          </div>
        </div>
      </section>
      <section
        className="br2-facts br2-container"
        aria-label="Your cleaning summary"
      >
        <div className="br2-fact">
          <label>HOW OFTEN</label>
          <b>{frequency}</b>
          <button type="button" onClick={onBack}>
            Change
          </button>
          <p>
            {p.discountPercent > 0
              ? `Save ${p.discountPercent}% from visit two`
              : "Just this clean"}
          </p>
        </div>
        <div className="br2-fact">
          <label>WHERE</label>
          <b>
            {location.city || "DC · Maryland · Virginia"}
            {location.zip ? ` ${location.zip}` : ""}
          </b>
          <button
            type="button"
            onClick={() => document.getElementById("br2-street")?.focus()}
          >
            Add service address
          </button>
          <p>
            {flow.bedrooms} bedroom{flow.bedrooms === 1 ? "" : "s"} ·{" "}
            {flow.bathrooms} bathroom{flow.bathrooms === 1 ? "" : "s"}
          </p>
        </div>
        <div className="br2-fact">
          <label>YOUR SERVICE</label>
          <b>
            {flow.pricingMode === "hourly"
              ? `${flow.hourCount} hours · ${flow.maidCount} cleaners`
              : service}
          </b>
          <p>
            {flow.pricingMode === "hourly"
              ? "Your selected team and cleaner-hours"
              : "Tailored to your home and priorities"}
          </p>
        </div>
        <div className="br2-fact">
          <label>FIRST CLEANING</label>
          <b>{money(p.firstCleaningTotalCents)}</b>
          <p>
            {p.futureVisitTotalCents !== null
              ? `Then ${money(p.futureVisitTotalCents)} each visit`
              : "Your one-time cleaning total"}
          </p>
        </div>
      </section>
      <div className="br2-layout br2-container">
        <div className="br2-main">
          <section className="br2-stage">
            <div className="br2-stage-name">
              <span>YOUR CLEAN</span>
              <b>1</b>
            </div>
            <div className="br2-stage-body">
              <div className="br2-card">
                <div className="br2-card-label">DATE &amp; TIME</div>
                <div className="br2-schedule-note">
                  Choose your preferred day and arrival time. We’ll confirm your
                  appointment.
                </div>
                <ReviewCalendar
                  value={dateValue}
                  min={dateMin}
                  onChange={onDateChange}
                />
                <div className="br2-arrival-heading">ARRIVAL PREFERENCE</div>
                <ArrivalOptions selectedTimeIndex={selectedTimeIndex} />
                <div className="br2-chosen-time">
                  <strong>
                    {dateValue
                      ? easternDateLabel(dateValue)
                      : "Choose your date"}
                    {" · "}
                    {approvedBookArrivalLabel(arrival)}
                  </strong>
                  <p>
                    Selecting an arrival preference does not reserve a booking.
                  </p>
                </div>
              </div>
              <div className="br2-card">
                <div className="br2-card-label">HOME CONDITION</div>
                <div className="br2-condition">
                  <h3>A little context goes a long way.</h3>
                  <p>Help us give your home the attention it needs.</p>
                </div>
                <div
                  className="br2-condition-options"
                  role="radiogroup"
                  aria-label="Overall home condition"
                >
                  {conditionOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={flow.condition === option.value}
                      className={
                        flow.condition === option.value ? "is-selected" : ""
                      }
                      onClick={() => flow.setCondition(option.value)}
                    >
                      <b>{option.label}</b>
                      <small>{option.detail}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="br2-card">
                <div className="br2-card-label">EXTRAS</div>
                <p className="br2-extras-intro">
                  A little more attention where you need it.
                  <br />
                  <small>
                    Extras apply to your first clean. Recurring prices stay
                    separate.
                  </small>
                </p>
                <div className="br2-extras-grid">
                  {extraOrder.map(id => {
                    const extra = PUBLIC_BOOKING_PRICED_EXTRAS[id];
                    const value = flow.extras[id] || 0;
                    const Icon =
                      id === "organizing-hour"
                        ? Boxes
                        : id === "basement"
                          ? House
                          : Brush;
                    return (
                      <div
                        key={id}
                        className={`br2-extra${value > 0 ? " is-selected" : ""}`}
                      >
                        {illustrations[id] ? (
                          <img src={illustrations[id]} alt="" loading="lazy" />
                        ) : (
                          <div className="br2-extra-icon">
                            <Icon />
                          </div>
                        )}
                        <label>{extra.label}</label>
                        <p>
                          {money(extra.unitPrice * 100)}
                          {extra.quantityUnit ? ` / ${extra.quantityUnit}` : ""}
                        </p>
                        <Quantity
                          label={extra.label}
                          value={value}
                          onChange={n => flow.setExtra(id, n - value)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
          <section className="br2-stage">
            <div className="br2-stage-name">
              <span>YOUR HOME</span>
              <b>2</b>
            </div>
            <div className="br2-stage-body">
              <div className="br2-card br2-customer-card">
                <h3>Contact information</h3>
                <div className="br2-input-grid">
                  <label>
                    <span>First name</span>
                    <input
                      id="br2-first-name"
                      autoComplete="off"
                      value={flow.firstName}
                      onChange={e => flow.setFirstName(e.target.value)}
                      placeholder="First name"
                    />
                  </label>
                  <label>
                    <span>Last name</span>
                    <input
                      autoComplete="off"
                      value={flow.lastName}
                      onChange={e => flow.setLastName(e.target.value)}
                      placeholder="Last name"
                    />
                  </label>
                  <label>
                    <span>Email</span>
                    <input
                      type="email"
                      autoComplete="off"
                      value={flow.customerEmail}
                      onChange={e => flow.setCustomerEmail(e.target.value)}
                      placeholder="Email address"
                    />
                  </label>
                  <label>
                    <span>Phone</span>
                    <input
                      type="tel"
                      autoComplete="off"
                      value={flow.customerPhone}
                      onChange={e => flow.setCustomerPhone(e.target.value)}
                      placeholder="Phone number"
                    />
                  </label>
                </div>
                {smsConsent && (
                  <label className="br2-consent">
                    <input
                      type="checkbox"
                      checked={smsConsent.value}
                      onChange={e => smsConsent.onChange(e.target.checked)}
                    />
                    <span>
                      I agree to receive service-related text updates about my
                      booking.
                    </span>
                  </label>
                )}
                <div className="br2-divider" />
                <h3>Cleaning address</h3>
                <div className="br2-address-grid">
                  <label className="br2-street">
                    <span>Street address</span>
                    <input
                      id="br2-street"
                      autoComplete="off"
                      value={location.street}
                      onChange={e => updateAddress("street", e.target.value)}
                      placeholder="Street address"
                    />
                  </label>
                  <label>
                    <span>Apt / suite</span>
                    <input
                      autoComplete="off"
                      value={location.apt}
                      onChange={e => updateAddress("apt", e.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                  <label>
                    <span>City</span>
                    <input
                      autoComplete="off"
                      value={location.city}
                      onChange={e => updateAddress("city", e.target.value)}
                      placeholder="City"
                    />
                  </label>
                  <label>
                    <span>State</span>
                    <select
                      value={location.region}
                      onChange={e => updateAddress("region", e.target.value)}
                      aria-label="State"
                    >
                      <option value="">Select state</option>
                      <option value="DC">Washington DC</option>
                      <option value="MD">Maryland</option>
                      <option value="VA">Virginia</option>
                    </select>
                  </label>
                  <label>
                    <span>ZIP code</span>
                    <input
                      autoComplete="off"
                      inputMode="numeric"
                      maxLength={5}
                      value={location.zip}
                      onChange={e =>
                        updateAddress("zip", e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="ZIP code"
                    />
                  </label>
                </div>
                <div className="br2-divider" />
                {entryMethod && (
                  <label className="br2-select">
                    <span>How will we get in?</span>
                    <select
                      value={entryMethod.value}
                      onChange={e => entryMethod.onChange(e.target.value)}
                    >
                      <option>I’ll be at home</option>
                      <option>Someone will let you in</option>
                      <option>Other — see special instructions</option>
                    </select>
                  </label>
                )}
                <label className="br2-notes">
                  <span>Special requests</span>
                  <textarea
                    value={flow.notes}
                    onChange={e => flow.setNotes(e.target.value)}
                    rows={4}
                    placeholder="Any special instructions for your cleaner?"
                  />
                </label>
                {error && (
                  <p className="br2-form-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  className="br2-continue"
                  onClick={proceed}
                >
                  Continue to payment <ArrowRight />
                </button>
                <p className="br2-actions-note">
                  <LockKeyhole />
                  Next: secure payment.
                </p>
              </div>
            </div>
          </section>
        </div>
        <aside className="br2-sidebar" aria-label="Price summary">
          <div className="br2-price-card">
            <div className="br2-card-label">WHAT YOU’LL PAY</div>
            {flow.pricingMode === "home" ? (
              <>
                <div className="br2-small-counter">
                  <BedDouble />
                  <span>Bedrooms</span>
                  <Quantity
                    label="bedrooms"
                    value={flow.bedrooms}
                    min={0}
                    max={7}
                    onChange={flow.setBedrooms}
                  />
                </div>
                <div className="br2-small-counter">
                  <Bath />
                  <span>Bathrooms</span>
                  <Quantity
                    label="bathrooms"
                    value={flow.bathrooms}
                    min={1}
                    max={5}
                    onChange={flow.setBathrooms}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="br2-small-counter">
                  <Users />
                  <span>Cleaners</span>
                  <Quantity
                    label="cleaners"
                    value={flow.maidCount}
                    min={1}
                    max={4}
                    onChange={flow.setMaidCount}
                  />
                </div>
                <div className="br2-small-counter">
                  <Clock />
                  <span>Hours</span>
                  <Quantity
                    label="hours"
                    value={flow.hourCount}
                    min={1}
                    max={8}
                    onChange={flow.setHourCount}
                  />
                </div>
              </>
            )}
            <div className="br2-side-choice">
              <label>{service}</label>
              <button type="button" onClick={onBack}>
                Change
              </button>
            </div>
            <div className="br2-side-choice">
              <div>
                <label>{frequency}</label>
                <p>
                  {p.discountPercent > 0
                    ? `Save ${p.discountPercent}% from your second clean`
                    : "One-time cleaning"}
                </p>
              </div>
              <button type="button" onClick={onBack}>
                Change
              </button>
            </div>
            <div className="br2-price-lines">
              <div>
                <span>
                  {flow.pricingMode === "hourly"
                    ? `${flow.maidCount} cleaners · ${flow.hourCount} hours`
                    : `${flow.bedrooms} bedrooms · ${flow.bathrooms} bathrooms`}
                </span>
                <strong>{money(p.serviceSubtotalCents)}</strong>
              </div>
              {p.extras.map(extra => (
                <div key={extra.id}>
                  <span>
                    {extra.label}
                    {extra.quantity > 1 ? ` × ${extra.quantity}` : ""}
                  </span>
                  <strong>{money(extra.totalCents)}</strong>
                </div>
              ))}
              {p.arrivalDiscountPercent !== undefined &&
                p.arrivalDiscountPercent > 0 &&
                p.arrivalDiscountCents !== undefined && (
                  <div className="br2-arrival-deduction">
                    <span>
                      {approvedBookArrivalDiscountTitle(arrival.mode)}
                      <small>First cleaning only</small>
                    </span>
                    <strong>−{money(p.arrivalDiscountCents)}</strong>
                  </div>
                )}
            </div>
            <div className="br2-total">
              <span>First cleaning</span>
              <strong aria-live="polite">
                {money(p.firstCleaningTotalCents)}
              </strong>
            </div>
            {p.futureVisitTotalCents !== null && (
              <div className="br2-recurring">
                <span>Every visit after this one</span>
                <strong>{money(p.futureVisitTotalCents)}</strong>
                <small>
                  From your second clean · Save {p.discountPercent}%
                </small>
              </div>
            )}
            <div className="br2-price-footer">
              <LockKeyhole />
              <p>See your total before you book.</p>
            </div>
          </div>
          <div className="br2-benefit-card">
            <h3>WHAT YOU GET</h3>
            <ul>
              <li>
                <Check />
                Insured &amp; bonded
              </li>
              <li>
                <Check />
                All supplies included
              </li>
              <li>
                <Check />
                200% satisfaction guarantee
              </li>
              <li>
                <Check />A team that cares
              </li>
            </ul>
          </div>
          <div className="br2-review-quote">
            <span className="br-stars" aria-label="5 stars">
              ★★★★★
            </span>
            <blockquote>
              “Appreciate the great communication and top tier service.”
            </blockquote>
            <p>Robin Jones · Maids in Black customer</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
