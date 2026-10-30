import "./public-booking-header.css";

/** Static visual chrome for the canonical /book route. */
export default function PublicBookingHeader() {
  return (
    <header className="public-booking-header">
      <div className="public-booking-header__inner">
        <div className="public-booking-header__wordmark">
          MAIDS <span>IN BLACK</span>
          <small>SNAPCLEAN · ONLINE BOOKING</small>
        </div>
        <div className="public-booking-header__right">
          <div className="public-booking-header__secure">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            Secure booking
          </div>
          <span className="public-booking-header__help">
            Here to help you feel at home ✦
          </span>
        </div>
      </div>
    </header>
  );
}
