import { ArrowLeft, Phone } from "lucide-react";
import brandLogo from "@/assets/book-cohesion/maids-in-black-logo.svg";
import "./public-booking-header.css";

/** Public /book chrome; canonical booking and checkout state remain in Book. */
export default function PublicBookingHeader() {
  return (
    <header className="br-site-header">
      <div className="br-site-header-inner">
        <a href="https://maidsinblack.com/" aria-label="Maids in Black home">
          <img src={brandLogo} alt="Maids in Black" width={190} height={35} />
        </a>
        <div className="br-site-links">
          <a className="br-back" href="https://maidsinblack.com/">
            <ArrowLeft aria-hidden="true" />
            Back to website
          </a>
          <a className="br-help" href="tel:+12028885362">
            <Phone aria-hidden="true" />
            202-888-5362
          </a>
        </div>
      </div>
    </header>
  );
}
