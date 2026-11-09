import React from "react";
import {
  ArrowRight,
  BedDouble,
  Bath,
  Minus,
  Plus,
  Sparkles,
  Brush,
  Package,
  Users,
  Clock,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import {
  useApprovedBookFlow,
  useApprovedBookLocation,
  useApprovedBookContext,
} from "./ApprovedBookContext";
import { calculatePublicBookingPrice } from "@shared/publicBookingPricing";
import TrustSections from "./TrustSections";
import "./first-page.css";

function Counter({
  label,
  detail,
  value,
  min,
  max,
  onChange,
  icon: Icon,
}: {
  label: string;
  detail: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  icon: any;
}) {
  return (
    <div className="br-counter">
      <Icon className="br-line-icon" aria-hidden="true" />
      <div className="br-counter-copy">
        <b>
          {value} {label}
          {value === 1 ? "" : "s"}
        </b>
        <small>{detail}</small>
      </div>
      <div className="br-counter-actions">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          <Minus />
        </button>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          <Plus />
        </button>
      </div>
    </div>
  );
}
const serviceChoices = [
  { id: "standard" as const, label: "Standard", icon: Sparkles },
  { id: "deep" as const, label: "Deep Clean", icon: Brush },
  { id: "moveout" as const, label: "Move-out", icon: Package },
];
const frequencyChoices = [
  { id: "weekly" as const, label: "Weekly" },
  { id: "biweekly" as const, label: "Biweekly" },
  { id: "monthly" as const, label: "Monthly" },
  { id: "one-time" as const, label: "One-time" },
];
export default function FirstPage() {
  const flow = useApprovedBookFlow();
  const { zip } = useApprovedBookLocation();
  const { setLocation, onNext, assets } = useApprovedBookContext();
  const setZip = (value: string) => setLocation({ zip: value });
  return (
    <div className="br-first-page">
      <section className="br-hero">
        <div className="br-hero-inner">
          <div className="br-editorial">
            <div className="br-eyebrow">
              WASHINGTON DC · MARYLAND · VIRGINIA
            </div>
            <h1>
              Book a top-rated
              <br />
              cleaner in <em>60 seconds.</em>
            </h1>
            <p className="br-hero-lead">
              Your clean home starts here.
              <br />
              Choose your service. See your price. Leave the cleaning to us.
            </p>
            <div className="br-proof">
              <div>
                <div className="br-stars" aria-label="5 stars">
                  ★★★★★
                </div>
                <strong>5-star rated</strong>
                <span>Cleaning you can count on</span>
              </div>
              <div>
                <strong>90,000+</strong>
                <span>Homes cleaned</span>
              </div>
              <div>
                <ShieldCheck />
                <strong>200%</strong>
                <span>Satisfaction guarantee</span>
              </div>
            </div>
            <div className="br-human">
              <figure className="br-photo">
                <img
                  src={assets.teamPhoto}
                  alt="Maids in Black team member holding a spray bottle in a kitchen"
                  width="1536"
                  height="2048"
                />
                <figcaption>
                  <span className="br-photo-dot" />A team that cares.
                </figcaption>
              </figure>
              <div className="br-featured-review">
                <div className="br-eyebrow">FROM OUR CUSTOMERS</div>
                <div className="br-stars" aria-label="5 stars">
                  ★★★★★
                </div>
                <blockquote>
                  “Appreciate the great communication and top tier service.”
                </blockquote>
                <p>
                  Robin Jones<span>Maids in Black customer</span>
                </p>
              </div>
            </div>
          </div>
          <div className="br-form-card">
            <div className="br-card-heading">
              <h2>Get your exact price</h2>
              <p>A few details. A cleaner home.</p>
            </div>
            <div className="br-card-section">
              <label className="br-label" htmlFor="br-zip">
                WHERE
              </label>
              <input
                id="br-zip"
                className="br-zip"
                placeholder="Your ZIP code"
                inputMode="numeric"
                autoComplete="off"
                maxLength={5}
                value={zip}
                onChange={e => setZip(e.target.value.replace(/\D/g, ""))}
              />
              <p className="br-field-note">
                Your full service address comes on the next page.
              </p>
            </div>
            <div className="br-card-section">
              <span className="br-label">PRICING</span>
              <div
                className="br-pricing-toggle"
                role="radiogroup"
                aria-label="Booking price type"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={flow.pricingMode === "home"}
                  className={flow.pricingMode === "home" ? "is-selected" : ""}
                  onClick={() => flow.setPricingMode("home")}
                >
                  Flat rate
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={flow.pricingMode === "hourly"}
                  className={flow.pricingMode === "hourly" ? "is-selected" : ""}
                  onClick={() => flow.setPricingMode("hourly")}
                >
                  By the hour
                </button>
              </div>
            </div>
            <div className="br-card-section">
              <span className="br-label">
                {flow.pricingMode === "home"
                  ? "YOUR HOME"
                  : "YOUR CLEANING TEAM"}
              </span>
              {flow.pricingMode === "home" ? (
                <>
                  <Counter
                    label="Bedroom"
                    detail="Living room & kitchen included"
                    value={flow.bedrooms}
                    min={0}
                    max={7}
                    onChange={flow.setBedrooms}
                    icon={BedDouble}
                  />
                  <Counter
                    label="Bathroom"
                    detail="Round half baths up"
                    value={flow.bathrooms}
                    min={1}
                    max={5}
                    onChange={flow.setBathrooms}
                    icon={Bath}
                  />
                </>
              ) : (
                <>
                  <Counter
                    label="Cleaner"
                    detail="Choose the size of your team"
                    value={flow.maidCount}
                    min={1}
                    max={4}
                    onChange={flow.setMaidCount}
                    icon={Users}
                  />
                  <Counter
                    label="Hour"
                    detail="Time for each cleaner"
                    value={flow.hourCount}
                    min={1}
                    max={8}
                    onChange={flow.setHourCount}
                    icon={Clock}
                  />
                </>
              )}
            </div>
            <div className="br-card-section">
              <span className="br-label">TYPE OF CLEAN</span>
              <div
                className="br-service-grid"
                role="radiogroup"
                aria-label="Type of clean"
              >
                {serviceChoices.map(({ id, label, icon: Icon }) => (
                  <button
                    type="button"
                    key={id}
                    className={flow.service === id ? "is-selected" : ""}
                    role="radio"
                    aria-checked={flow.service === id}
                    onClick={() => flow.setService(id)}
                  >
                    <Icon />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="br-card-section">
              <span className="br-label">HOW OFTEN</span>
              <div
                className="br-frequency-grid"
                role="radiogroup"
                aria-label="Cleaning frequency"
              >
                {frequencyChoices.map(({ id, label }) => {
                  const discount = calculatePublicBookingPrice({
                    ...flow.pricingInput,
                    recurrence: id,
                  }).discountPercent;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={flow.frequency === id}
                      className={flow.frequency === id ? "is-selected" : ""}
                      key={id}
                      onClick={() => flow.setFrequency(id)}
                    >
                      <b>{label}</b>
                      {discount > 0 ? (
                        <small>Save {discount}%</small>
                      ) : (
                        <small>Just this clean</small>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="br-frequency-note">
                First clean at the one-time rate. Recurring savings start on
                visit two.
              </p>
            </div>
            <div className="br-card-bottom">
              <div className="br-price-assurance">
                <CheckCircle2 />
                See your price before you book.
              </div>
              <button
                type="button"
                className="br-continue"
                onClick={() => void onNext()}
              >
                See my price <ArrowRight />
              </button>
              <p>Next: choose your date, extras and cleaning details.</p>
            </div>
          </div>
        </div>
      </section>
      <TrustSections />
    </div>
  );
}
