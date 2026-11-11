import { useId } from "react";
import "./internal-booking-controls.css";

export interface InternalBookingAmountControlProps {
  value: string;
  onChange: (value: string) => void;
  onReset: () => void;
  calculatedTotalCents: number;
  adjustmentCents: number;
  disabled: boolean;
  error?: string;
}

export interface InternalBookWithoutPaymentControlProps {
  onClick: () => void;
  disabled: boolean;
}

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);

const signedMoney = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    signDisplay: "always",
  }).format(cents / 100);

/** Controlled presentation only; the parent owns parsing and booking validation. */
export function InternalBookingAmountControl({
  value,
  onChange,
  onReset,
  calculatedTotalCents,
  adjustmentCents,
  disabled,
  error,
}: InternalBookingAmountControlProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const errorId = `${id}-error`;

  return (
    <div className="internal-booking-amount-control">
      <h2 className="internal-booking-amount-heading">Edit booking price</h2>
      <label className="br3-field" htmlFor={id}>
        <span>Final booking amount ($)</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={(calculatedTotalCents / 100).toFixed(2)}
          onChange={event => onChange(event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${noteId} ${errorId}` : noteId}
        />
      </label>
      <p id={noteId} className="internal-booking-control-note">
        Calculated price: {money(calculatedTotalCents)}. First cleaning only.
        Future visits unchanged.
      </p>
      <button
        type="button"
        className="internal-booking-amount-reset"
        onClick={onReset}
        disabled={disabled}
      >
        Use calculated price
      </button>
      {error && (
        <p id={errorId} className="internal-booking-control-error" role="alert">
          {error}
        </p>
      )}
      {adjustmentCents !== 0 && (
        <div className="internal-booking-price-adjustment" aria-live="polite">
          <span>Staff price adjustment</span>
          <strong>{signedMoney(adjustmentCents)}</strong>
        </div>
      )}
    </div>
  );
}

/** Separate unpaid action, never a substitute or extra payment method. */
export function InternalBookWithoutPaymentControl({
  onClick,
  disabled,
}: InternalBookWithoutPaymentControlProps) {
  return (
    <section className="internal-booking-no-payment-control br3-method">
      <button
        type="button"
        className="br3-method-head"
        aria-label="Book without payment"
        onClick={onClick}
        disabled={disabled}
      >
        <span className="br3-radio" aria-hidden="true" />
        <span className="br3-method-copy">
          <strong>Book without payment</strong>
          <small>
            No payment will be collected. The booking remains unpaid.
          </small>
        </span>
      </button>
    </section>
  );
}
