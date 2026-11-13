import { bookingArrivalPreferenceSchema } from "@shared/bookingArrival";

/** Display an explicit saved window only while its start matches the current schedule. */
export function getBookingArrivalWindowLabel(
  requestedLocalTime: string | null | undefined,
  arrivalPreference: unknown,
): string | undefined {
  const preference = bookingArrivalPreferenceSchema.safeParse(arrivalPreference);
  if (!preference.success || preference.data.startLocalTime !== requestedLocalTime) {
    return undefined;
  }
  const formatTime = (time: string) => {
    const [hour, minute] = time.split(":").map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
  };
  return `${formatTime(preference.data.startLocalTime)}–${formatTime(preference.data.endLocalTime)}`;
}
