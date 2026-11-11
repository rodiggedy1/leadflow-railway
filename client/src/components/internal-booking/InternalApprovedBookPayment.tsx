import type { ReactNode } from "react";
import {
  ArrowLeft,
  BedDouble,
  Bath,
  Clock,
  Users,
  Minus,
  Plus,
  Check,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { easternDateLabel } from "@shared/easternTime";
import visa from "@/assets/payment-marks/visa.svg";
import mastercard from "@/assets/payment-marks/mastercard.svg";
import amex from "@/assets/payment-marks/amex.svg";
import discover from "@/assets/payment-marks/discover.svg";
import applePay from "@/assets/payment-marks/apple-pay.svg";
import googlePay from "@/assets/payment-marks/google-pay.svg";
import cashApp from "@/assets/payment-marks/cash-app-pay.svg";
import stripeMark from "@/assets/payment-marks/powered-by-stripe.svg";
import {
  useApprovedBookContext,
  approvedBookArrivalLabel,
  approvedBookArrivalDiscountTitle,
} from "../approved-book/ApprovedBookContext";
import "../approved-book/approved-payment.css";

export type ApprovedBookPaymentMethod =
  | "card"
  | "apple_pay"
  | "cashapp"
  | "google_pay";
export interface ApprovedBookPaymentProps {
  selectedPaymentMethod: ApprovedBookPaymentMethod | null;
  onPaymentMethodChange: (method: ApprovedBookPaymentMethod) => void;
  isSaving: boolean;
  bookingDetailsLocked: boolean;
  allowCashAppSwitch: boolean;
  cardOnFile: boolean;
  formError: string;
  onRetryFinalization: () => void;
  /** Real checkout components remain mounted when their accordion is closed. */
  panels: Record<ApprovedBookPaymentMethod, ReactNode>;
  internalAmountControl?: ReactNode;
  internalNoPaymentControl?: ReactNode;
}
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100
  );
const frequencies: Record<string, string> = {
  "one-time": "One-time",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
};
const services: Record<string, string> = {
  standard: "Standard cleaning",
  deep: "Deep cleaning",
  moveout: "Move-out cleaning",
};
const methods: {
  id: ApprovedBookPaymentMethod;
  title: string;
  detail: string;
  mark?: string;
}[] = [
  {
    id: "card",
    title: "Card on file · pay after service",
    detail: "Securely save your card now. You’re charged after the cleaning.",
  },
  {
    id: "apple_pay",
    title: "Apple Pay",
    detail: "Securely save Apple Pay now. You’re charged after the cleaning.",
    mark: applePay,
  },
  {
    id: "cashapp",
    title: "Pay with Cash App",
    detail: "Pay today for your first clean",
    mark: cashApp,
  },
  {
    id: "google_pay",
    title: "Google Pay",
    detail: "Securely save Google Pay now. You’re charged after the cleaning.",
    mark: googlePay,
  },
];
function Quantity({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="br2-quantity">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={disabled || value <= min}
        onClick={() => { if (!disabled && value > min) onChange(value - 1); }}
      >
        <Minus />
      </button>
      <span aria-live="polite">{value}</span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={disabled || value >= max}
        onClick={() => { if (!disabled && value < max) onChange(value + 1); }}
      >
        <Plus />
      </button>
    </div>
  );
}

/** Presentation only. Reservation, Stripe, Cash App, retry and success stay in Book. */
export default function ApprovedBookPayment({
  selectedPaymentMethod,
  onPaymentMethodChange,
  isSaving,
  bookingDetailsLocked,
  allowCashAppSwitch,
  cardOnFile,
  formError,
  onRetryFinalization,
  panels,
  internalAmountControl,
  internalNoPaymentControl,
}: ApprovedBookPaymentProps) {
  const { flow, location, arrival, onBack } = useApprovedBookContext();
  const p = flow.pricing;
  const frequency = frequencies[flow.frequency] || flow.frequency;
  const service = services[flow.service] || flow.service;
  const date = flow.requestedLocalDate
    ? easternDateLabel(flow.requestedLocalDate)
    : "Choose your date";
  const payNow = selectedPaymentMethod === "cashapp";
  const editLocked = isSaving || bookingDetailsLocked || cardOnFile;
  const editHome = () => { if (!editLocked) flow.setStep(1); };
  const editClean = () => { if (!editLocked) onBack(); };
  return (
    <main className="br-third-page">
      <section className="br2-hero br3-hero">
        <div className="br2-container">
          <button
            type="button"
            className="br2-back"
            onClick={editClean}
            disabled={editLocked}
          >
            <ArrowLeft />
            Back to your clean
          </button>
          <div className="br2-step-label">STEP 3 OF 3 · SECURE PAYMENT</div>
          <h1>Your home is in good hands.</h1>
          <p className="br2-hero-subtitle">
            One last step. Choose how you’d like to secure your clean.
          </p>
          <div className="br2-hero-proof">
            <span>
              <LockKeyhole />
              Secure checkout
            </span>
            <span>Insured &amp; bonded</span>
            <span>200% satisfaction guarantee</span>
          </div>
        </div>
      </section>
      <section
        className="br2-facts br2-container"
        aria-label="Your final cleaning summary"
      >
        <div className="br2-fact">
          <label>YOUR CLEAN</label>
          <b>{service}</b>
          <button type="button" onClick={editHome} disabled={editLocked}>
            Change
          </button>
          <p>
            {frequency} ·{" "}
            {flow.pricingMode === "hourly"
              ? `${flow.maidCount} cleaners · ${flow.hourCount} hours`
              : `${flow.bedrooms} bedrooms · ${flow.bathrooms} bathrooms`}
          </p>
        </div>
        <div className="br2-fact">
          <label>WHEN</label>
          <b>{date}</b>
          <button type="button" onClick={editClean} disabled={editLocked}>
            Change
          </button>
          <p>{approvedBookArrivalLabel(arrival)}</p>
        </div>
        <div className="br2-fact">
          <label>WHERE</label>
          <b>
            {location.city}
            {location.zip ? ` ${location.zip}` : ""}
          </b>
          <button type="button" onClick={editClean} disabled={editLocked}>
            Change
          </button>
          <p>
            {[location.street, location.apt].filter(Boolean).join(", ") ||
              flow.address}
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
      <div className="br3-layout br2-container">
        <div className="br3-main">
          {internalAmountControl}
          <section
            className="br3-payment-card"
            aria-label="Choose your payment method"
          >
            <div className="br3-intro">
              <div className="br3-overline">SECURE CHECKOUT</div>
              <h2>How would you like to secure your booking?</h2>
              <div className="br3-intro-line">
                <p>Choose the option that works best for you.</p>
                <span className="br3-stripe">
                  <img src={stripeMark} alt="Powered by Stripe" />
                </span>
              </div>
              {bookingDetailsLocked && <p role="status">Your booking details are locked to this quote. You can still retry checkout or choose another payment method.</p>}
            </div>
            <div className="br3-methods">
              {methods.map(option => {
                const active = selectedPaymentMethod === option.id;
                return (
                  <section
                    key={option.id}
                    className={`br3-method${active ? " is-selected" : ""}`}
                    data-internal-payment-method={option.id}
                  >
                    <button
                      type="button"
                      className="br3-method-head"
                      aria-expanded={active}
                      aria-controls={`br3-panel-${option.id}`}
                      onClick={() => onPaymentMethodChange(option.id)}
                      disabled={isSaving && !allowCashAppSwitch}
                    >
                      <span className="br3-radio" aria-hidden="true">
                        {active && <Check />}
                      </span>
                      <span className="br3-method-copy">
                        <strong>{option.title}</strong>
                        <small>
                          {option.id === "cashapp"
                            ? `Pay ${money(p.firstCleaningTotalCents)} today for your first clean`
                            : option.detail}
                        </small>
                      </span>
                      <span
                        className={`br3-method-marks${option.mark ? " br3-wallet-mark" : ""}`}
                        aria-hidden="true"
                      >
                        {option.mark ? (
                          <img src={option.mark} alt="" />
                        ) : (
                          <>
                            {[visa, mastercard, amex, discover].map(mark => (
                              <img key={mark} src={mark} alt="" />
                            ))}
                          </>
                        )}
                      </span>
                    </button>
                    <div
                      className={`br3-method-detail${active ? " is-open" : ""}`}
                      id={`br3-panel-${option.id}`}
                      aria-hidden={!active}
                      inert={!active}
                    >
                      {panels[option.id]}
                    </div>
                  </section>
                );
              })}
              {internalNoPaymentControl}
            </div>
            {formError && (
              <div className="br3-booking-error" role="alert">
                {formError}
              </div>
            )}
            {cardOnFile && formError ? (
              <button
                type="button"
                className="br3-secure-button"
                onClick={onRetryFinalization}
                disabled={isSaving}
              >
                Try confirming booking →
              </button>
            ) : null}
            <div className="br3-trust-row">
              <span>
                <LockKeyhole />
                Secure payment
              </span>
              <span>
                <ShieldCheck />
                Insured &amp; bonded
              </span>
            </div>
          </section>
        </div>
        <aside
          className="br3-sidebar"
          aria-label="Price summary and peace of mind"
        >
          <div className="br2-price-card br3-summary">
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
                    disabled={editLocked}
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
                    disabled={editLocked}
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
                    disabled={editLocked}
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
                    disabled={editLocked}
                    onChange={flow.setHourCount}
                  />
                </div>
              </>
            )}
            <div className="br2-side-choice">
              <label>{service}</label>
              <button type="button" onClick={editHome} disabled={editLocked}>
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
              <button type="button" onClick={editHome} disabled={editLocked}>
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
              {p.arrivalDiscountPercent !== undefined && p.arrivalDiscountPercent > 0 && p.arrivalDiscountCents !== undefined && (
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
              <p>
                {payNow
                  ? "Cash App · first cleaning charged today"
                  : "Card & wallets · charged after your clean"}
                <br />
                Your payment information is securely handled by Stripe.
              </p>
            </div>
          </div>
          <section
            className="br3-testimonial"
            aria-label="Maids in Black customer review"
          >
            <span className="br-stars" aria-label="5 stars">
              ★★★★★
            </span>
            <blockquote>
              “Even if something goes wrong they make it right. My entire floor
              uses them now.”
            </blockquote>
            <p>
              Ronda Clarke <span>· Maids in Black customer</span>
            </p>
          </section>
          <section className="br3-guarantee">
            <ShieldCheck />
            <h3>Book with zero risk</h3>
            <p>
              Not thrilled with your clean? Let us know within 24 hours and
              we’ll return to re-clean the missed areas.
            </p>
            <small>Our 200% satisfaction guarantee.</small>
          </section>
        </aside>
      </div>
    </main>
  );
}
