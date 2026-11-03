import { useState } from "react";
import "./customer-booking-link-payment-options.css";
import { Check } from "lucide-react";
import { PublicBookingCardSetupBeforeReservation } from "./BookingPaymentCheckout";
import { BookingWalletCardOnFileCheckout } from "./BookingApplePayCheckout";
import { BookingCashAppCheckout } from "./BookingCashAppCheckout";
import { customerBookingError } from "@/lib/customerBookingError";
import visaMark from "@/assets/payment-marks/visa.svg";
import mastercardMark from "@/assets/payment-marks/mastercard.svg";
import amexMark from "@/assets/payment-marks/amex.svg";
import discoverMark from "@/assets/payment-marks/discover.svg";
import applePayMark from "@/assets/payment-marks/apple-pay.svg";
import cashAppPayMark from "@/assets/payment-marks/cash-app-pay.svg";
import googlePayMark from "@/assets/payment-marks/google-pay.svg";
import poweredByStripeMark from "@/assets/payment-marks/powered-by-stripe.svg";

type PaymentMethod = "card" | "apple_pay" | "cashapp" | "google_pay";
type Reservation = { publicFunnelNumber: string; mutationToken: string };
type Props = {
  customerName: string;
  total: number;
  selectedDate: Date;
  creatingReservation: boolean;
  onPrepareReservation: () => Promise<Reservation | null>;
  onFinalizeCard: () => Promise<void>;
  onPaymentSaved: (label: string) => void;
  onCashAppPaid: (totalCents: number) => void;
};

const money = (cents: number) => `$${Math.round(cents / 100)}`;

/** /book's payment choices, copied without changing the working /book page or Stripe adapters. */
export function CustomerBookingLinkPaymentOptions({
  customerName,
  total,
  selectedDate,
  creatingReservation,
  onPrepareReservation,
  onFinalizeCard,
  onPaymentSaved,
  onCashAppPaid,
}: Props) {
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod | null>(null);
  const [applePayAvailable, onApplePayAvailable] = useState(false);
  const [googlePayAvailable, onGooglePayAvailable] = useState(false);
  const [walletBusy, onWalletBusyChange] = useState(false);
  const [cashAppBusy, onCashAppBusyChange] = useState(false);
  const [cashAppExitRequest, setCashAppExitRequest] = useState<Exclude<
    PaymentMethod,
    "cashapp"
  > | null>(null);
  const [cardOnFile, setCardOnFile] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [formError, setFormError] = useState("");
  const isSaving =
    creatingReservation || finalizing || walletBusy || cashAppBusy;
  const allowCashAppSwitch =
    selectedPaymentMethod === "cashapp" &&
    cashAppBusy &&
    cashAppExitRequest === null;

  const onPaymentMethodChange = (method: PaymentMethod | null) => {
    if (
      cashAppBusy &&
      selectedPaymentMethod === "cashapp" &&
      (method === "card" || method === "apple_pay" || method === "google_pay")
    ) {
      setCashAppExitRequest(method);
      return;
    }
    setCashAppExitRequest(null);
    setSelectedPaymentMethod(method);
    setFormError("");
  };
  const finalizeConfirmedCard = async () => {
    setFinalizing(true);
    setFormError("");
    try {
      await onFinalizeCard();
    } catch (cause) {
      setFormError(customerBookingError(cause, "We could not confirm your booking. Please try again.").message);
    } finally {
      setFinalizing(false);
    }
  };
  const onCardReady = (brand: string, last4: string) => {
    onPaymentSaved(`${brand} ending in ${last4}`);
    setCardOnFile(true);
    void finalizeConfirmedCard();
  };
  const onWalletReady = (
    wallet: "apple_pay" | "google_pay",
    brand: string,
    last4: string
  ) => {
    onPaymentSaved(`${wallet === "apple_pay" ? "Apple Pay" : "Google Pay"} · ${brand} ending in ${last4}`);
    setCardOnFile(true);
    void finalizeConfirmedCard();
  };
  const onCashAppExited = (
    destination: Exclude<PaymentMethod, "cashapp"> | null,
    notice?: string
  ) => {
    setCashAppExitRequest(null);
    setSelectedPaymentMethod(destination);
    setFormError(notice ?? "");
  };

  return (
    <div className="customer-link-payment-options">
      <section className="literal-book-payment-heading">
        <div className="literal-book-eyebrow">Secure checkout</div>
        <h2>How would you like to secure your booking?</h2>
        <div className="literal-book-payment-heading-detail">
          <p>Choose the option that works best for you.</p>
          <img
            className="literal-book-powered-by-stripe"
            src={poweredByStripeMark}
            alt="Powered by Stripe"
          />
        </div>
      </section>

      <section
        className={`literal-book-card-choice${selectedPaymentMethod === "card" ? " is-selected" : ""}`}
        aria-label="Card on file payment method"
      >
        <button
          type="button"
          className="literal-book-card-choice-head"
          aria-expanded={selectedPaymentMethod === "card"}
          onClick={() => onPaymentMethodChange("card")}
          disabled={isSaving && !allowCashAppSwitch}
        >
          <span aria-hidden="true">
            {selectedPaymentMethod === "card" ? "✓" : ""}
          </span>
          <div className="literal-book-payment-choice-content">
            <div className="literal-book-payment-choice-copy">
              <strong>Card on file · pay after service</strong>
              <p>
                Securely save your card now. You&apos;re charged after the
                cleaning.
              </p>
            </div>
            <span
              className="literal-book-payment-choice-marks literal-book-card-network-marks"
              aria-hidden="true"
            >
              <img src={visaMark} alt="" />
              <img src={mastercardMark} alt="" />
              <img src={amexMark} alt="" />
              <img src={discoverMark} alt="" />
            </span>
          </div>
        </button>
        <div
          className={`literal-book-card-detail${selectedPaymentMethod === "card" ? " is-open" : ""}`}
          aria-hidden={selectedPaymentMethod !== "card"}
        >
          {cardOnFile ? (
            <div className="literal-book-card-message">
              <Check /> Your card is securely on file. Confirming your booking
              now.
            </div>
          ) : (
            <PublicBookingCardSetupBeforeReservation
              customerName={customerName}
              onPrepareReservation={onPrepareReservation}
              creatingBooking={isSaving}
              onComplete={result =>
                onCardReady(result.cardBrand, result.cardLast4)
              }
            />
          )}
        </div>
      </section>
      <section
        className={`literal-book-apple-pay-choice${selectedPaymentMethod === "apple_pay" ? " is-selected" : ""}`}
      >
        <button
          type="button"
          className="literal-book-card-choice-head"
          aria-expanded={selectedPaymentMethod === "apple_pay"}
          onClick={() => onPaymentMethodChange("apple_pay")}
          disabled={isSaving && !allowCashAppSwitch}
        >
          <span aria-hidden="true">
            {selectedPaymentMethod === "apple_pay" ? "✓" : ""}
          </span>
          <div className="literal-book-payment-choice-content">
            <div className="literal-book-payment-choice-copy">
              <strong>Apple Pay</strong>
              <p>
                Securely save Apple Pay now. You&apos;re charged after the
                cleaning.
              </p>
            </div>
            <span
              className="literal-book-payment-choice-marks literal-book-wallet-mark"
              aria-hidden="true"
            >
              <img src={applePayMark} alt="" />
            </span>
          </div>
        </button>
        <div
          className={`literal-book-apple-pay-detail${selectedPaymentMethod === "apple_pay" ? " is-open" : ""}`}
        >
          <p className="literal-book-apple-pay-note">
            Use Apple Pay to securely save your card. You&apos;re charged after
            the cleaning.
          </p>
          {!applePayAvailable ? (
            <p className="literal-book-apple-pay-unavailable" role="status">
              Apple Pay is not available in this browser or Wallet. You can use
              Card on file or Google Pay instead.
            </p>
          ) : null}
          <BookingWalletCardOnFileCheckout
            wallet="apple_pay"
            active={selectedPaymentMethod === "apple_pay"}
            customerName={customerName}
            deferredAmountCents={total}
            deferredPaymentDate={selectedDate}
            onAvailabilityChange={onApplePayAvailable}
            onPrepareReservation={onPrepareReservation}
            onComplete={({ cardBrand, cardLast4 }) =>
              onWalletReady("apple_pay", cardBrand, cardLast4)
            }
            onBusyChange={onWalletBusyChange}
          />
        </div>
      </section>
      <section
        className={`literal-book-cashapp-choice${selectedPaymentMethod === "cashapp" ? " is-selected" : ""}`}
      >
        <button
          type="button"
          className="literal-book-card-choice-head"
          aria-expanded={selectedPaymentMethod === "cashapp"}
          onClick={() => onPaymentMethodChange("cashapp")}
          disabled={isSaving && !allowCashAppSwitch}
        >
          <span aria-hidden="true">
            {selectedPaymentMethod === "cashapp" ? "✓" : ""}
          </span>
          <div className="literal-book-payment-choice-content">
            <div className="literal-book-payment-choice-copy">
              <strong>Pay with Cash App</strong>
              <p>Pay {money(total)} today for your first cleaning.</p>
            </div>
            <span
              className="literal-book-payment-choice-marks literal-book-wallet-mark"
              aria-hidden="true"
            >
              <img src={cashAppPayMark} alt="" />
            </span>
          </div>
        </button>
        <div
          className={`literal-book-cashapp-detail${selectedPaymentMethod === "cashapp" ? " is-open" : ""}`}
        >
          <p className="literal-book-cashapp-note">
            Cash App securely charges {money(total)} today for the first
            cleaning only.
          </p>
          <BookingCashAppCheckout
            active={selectedPaymentMethod === "cashapp"}
            totalCents={total}
            exitRequest={
              selectedPaymentMethod === "cashapp" ? cashAppExitRequest : null
            }
            onPrepareReservation={onPrepareReservation}
            onBusyChange={onCashAppBusyChange}
            onPaid={onCashAppPaid}
            onExited={onCashAppExited}
          />
        </div>
      </section>
      <section
        className={`literal-book-google-pay-choice${selectedPaymentMethod === "google_pay" ? " is-selected" : ""}`}
      >
        <button
          type="button"
          className="literal-book-card-choice-head"
          aria-expanded={selectedPaymentMethod === "google_pay"}
          onClick={() => onPaymentMethodChange("google_pay")}
          disabled={isSaving && !allowCashAppSwitch}
        >
          <span aria-hidden="true">
            {selectedPaymentMethod === "google_pay" ? "✓" : ""}
          </span>
          <div className="literal-book-payment-choice-content">
            <div className="literal-book-payment-choice-copy">
              <strong>Google Pay</strong>
              <p>
                Securely save Google Pay now. You&apos;re charged after the
                cleaning.
              </p>
            </div>
            <span
              className="literal-book-payment-choice-marks literal-book-wallet-mark"
              aria-hidden="true"
            >
              <img src={googlePayMark} alt="" />
            </span>
          </div>
        </button>
        <div
          className={`literal-book-google-pay-detail${selectedPaymentMethod === "google_pay" ? " is-open" : ""}`}
        >
          <p className="literal-book-google-pay-note">
            Use Google Pay to securely save your card. You&apos;re charged after
            the cleaning.
          </p>
          {!googlePayAvailable ? (
            <p className="literal-book-google-pay-unavailable" role="status">
              Google Pay is not available in this browser or Wallet. You can use
              Card on file or Apple Pay instead.
            </p>
          ) : null}
          <BookingWalletCardOnFileCheckout
            wallet="google_pay"
            active={selectedPaymentMethod === "google_pay"}
            customerName={customerName}
            deferredAmountCents={total}
            deferredPaymentDate={selectedDate}
            onAvailabilityChange={onGooglePayAvailable}
            onPrepareReservation={onPrepareReservation}
            onComplete={({ cardBrand, cardLast4 }) =>
              onWalletReady("google_pay", cardBrand, cardLast4)
            }
            onBusyChange={onWalletBusyChange}
          />
        </div>
      </section>
      {formError && (
        <p className="literal-book-checkout-error" role="alert">
          {formError}
        </p>
      )}
      {cardOnFile && formError && (
        <button
          type="button"
          className="customer-link-primary"
          onClick={() => void finalizeConfirmedCard()}
          disabled={isSaving}
        >
          Try confirming booking →
        </button>
      )}
    </div>
  );
}
