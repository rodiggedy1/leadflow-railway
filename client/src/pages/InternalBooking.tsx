import { InternalBookingWrapper } from "@/components/internal-booking/InternalBookingWrapper";

export function InternalBooking({ onClose }: { onClose?: () => void }) {
  return <InternalBookingWrapper onClose={onClose} />;
}

export default InternalBooking;
