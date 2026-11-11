import { InternalBooking } from "./InternalBooking";

export default function InternalBookingReview() {
  return <InternalBooking onClose={() => window.history.back()} />;
}
