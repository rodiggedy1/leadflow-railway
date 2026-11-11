import { useCallback, useRef, useState } from "react";
import { useLocation } from "wouter";
import PublicBookingHeader from "@/components/PublicBookingHeader";
import InternalPublicBook from "./InternalPublicBook";
import { InternalBookingCheckoutProvider } from "./BookingCheckoutTransport";
import { useInternalExactBooking } from "./useInternalExactBooking";
import "./internal-booking-shell.css";

function InternalBookingAttempt({ onStartAnotherBooking, onOpenBookings, onScreenChange }: {
  onStartAnotherBooking: () => void;
  onOpenBookings: () => void;
  onScreenChange: () => void;
}) {
  const { adapter, checkoutTransport } = useInternalExactBooking();
  return (
    <InternalBookingCheckoutProvider value={checkoutTransport}>
      <InternalPublicBook
        internalBooking={adapter}
        onStartAnotherBooking={onStartAnotherBooking}
        onOpenBookings={onOpenBookings}
        onScreenChange={onScreenChange}
      />
    </InternalBookingCheckoutProvider>
  );
}

export function InternalBookingWrapper({ onClose }: { onClose?: () => void }) {
  const [, navigate] = useLocation();
  const [attempt, setAttempt] = useState(0);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const onScreenChange = useCallback(() => {
    shellRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);
  const onStartAnotherBooking = useCallback(() => {
    setAttempt(current => current + 1);
    setCloseConfirmOpen(false);
    shellRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);
  const onOpenBookings = useCallback(() => {
    if (onClose) onClose();
    else navigate("/admin/bookings");
  }, [navigate, onClose]);
  return (
    <div
      ref={shellRef}
      className={`internal-exact-booking-shell${onClose ? " is-modal" : ""} public-booking-cohesion approved-book-surface`}
    >
      <PublicBookingHeader />
      <InternalBookingAttempt
        key={attempt}
        onStartAnotherBooking={onStartAnotherBooking}
        onOpenBookings={onOpenBookings}
        onScreenChange={onScreenChange}
      />
      {closeConfirmOpen && onClose && (
        <div className="booking-close-confirm-shade" role="presentation">
          <div className="booking-close-confirm" role="dialog" aria-modal="true" aria-labelledby="booking-close-confirm-title">
            <div className="ey">CLOSE BOOKING</div>
            <h2 id="booking-close-confirm-title">Close this booking window?</h2>
            <p>Any information entered so far will be lost.</p>
            <div className="booking-close-confirm-actions">
              <button type="button" className="btn" onClick={() => setCloseConfirmOpen(false)}>Keep booking open</button>
              <button type="button" className="btn gold" onClick={onClose}>Close window</button>
            </div>
          </div>
        </div>
      )}
      {onClose && (
        <button type="button" className="internal-booking-modal-close" onClick={() => setCloseConfirmOpen(true)} aria-label="Close new booking form">×</button>
      )}
    </div>
  );
}
