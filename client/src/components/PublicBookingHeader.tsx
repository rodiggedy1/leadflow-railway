import { ArrowLeft, Phone, ShieldCheck } from "lucide-react";
import brandLogo from "@/assets/book-cohesion/maids-in-black-logo.svg";
import "./public-booking-header.css";

/** Static /book chrome. Booking state, controls, and form sizing stay in Book. */
export default function PublicBookingHeader() {
  return (
    <header className="public-booking-header">
      <div className="public-booking-header__inner">
        <a
          className="public-booking-header__brand"
          href="https://maidsinblack.com/"
          aria-label="Maids in Black home"
        >
          <img src={brandLogo} alt="Maids in Black" width={186} height={34} />
        </a>
        <div className="public-booking-header__assurance">
          <a
            className="public-booking-header__back"
            href="https://maidsinblack.com/"
          >
            <ArrowLeft aria-hidden="true" /> Back to website
          </a>
          <span className="public-booking-header__secure">
            <ShieldCheck aria-hidden="true" /> Secure booking
          </span>
          <a className="public-booking-header__help" href="tel:+12028885362">
            <Phone aria-hidden="true" />
            202-888-5362
          </a>
        </div>
      </div>
    </header>
  );
}
