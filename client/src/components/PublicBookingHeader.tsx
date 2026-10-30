import { ShieldCheck } from "lucide-react";
import "./public-booking-header.css";

/**
 * Static chrome for the canonical public booking route. It deliberately owns
 * no booking state, controls, navigation, or sizing rules for the form.
 */
export default function PublicBookingHeader() {
  return (
    <header className="public-booking-header">
      <div className="public-booking-header__inner">
        <div
          className="public-booking-header__brand"
          aria-label="Maids in Black Snapclean online booking"
        >
          <span>
            MAIDS <b>IN BLACK</b>
          </span>
          <small>SNAPCLEAN · ONLINE BOOKING</small>
        </div>

        <div className="public-booking-header__assurance">
          <span className="public-booking-header__secure">
            <ShieldCheck aria-hidden="true" />
            Secure booking
          </span>
          <span className="public-booking-header__help">
            Here to help you feel at home ✦
          </span>
        </div>
      </div>
    </header>
  );
}
