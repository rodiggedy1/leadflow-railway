import { z } from "zod";

export type BookingArrivalMode = "flexible" | "preferred" | "exact";
export type BookingArrivalPeriod = "morning" | "afternoon";
export type BookingArrivalPreference = {
  mode: BookingArrivalMode;
  period?: BookingArrivalPeriod;
  startLocalTime: string;
  endLocalTime: string;
};

const EXACT_WINDOWS: Readonly<Record<string, string>> = {
  "08:30": "10:30",
  "10:30": "12:30",
  "12:30": "14:30",
  "14:30": "16:30",
  "16:30": "18:30",
};

/** A requested arrival window, not an availability or guaranteed-arrival rule. */
export const bookingArrivalPreferenceSchema = z.object({
  mode: z.enum(["flexible", "preferred", "exact"]),
  period: z.enum(["morning", "afternoon"]).optional(),
  startLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict().refine(preference => {
  if (preference.mode === "flexible") {
    return preference.period === undefined &&
      preference.startLocalTime === "08:30" && preference.endLocalTime === "17:00";
  }
  if (preference.mode === "preferred") {
    return preference.period === "morning"
      ? preference.startLocalTime === "08:00" && preference.endLocalTime === "12:00"
      : preference.period === "afternoon" &&
        preference.startLocalTime === "12:00" && preference.endLocalTime === "17:00";
  }
  return preference.period === undefined &&
    EXACT_WINDOWS[preference.startLocalTime] === preference.endLocalTime;
}, { message: "Select a supported arrival window." });

export function createBookingArrivalPreference(
  mode: BookingArrivalMode,
  period?: BookingArrivalPeriod,
  startLocalTime?: string,
): BookingArrivalPreference {
  if (mode === "flexible") {
    return { mode, startLocalTime: "08:30", endLocalTime: "17:00" };
  }
  if (mode === "preferred") {
    if (period !== "morning" && period !== "afternoon") {
      throw new Error("Select a preferred arrival period.");
    }
    return {
      mode,
      period,
      startLocalTime: period === "morning" ? "08:00" : "12:00",
      endLocalTime: period === "morning" ? "12:00" : "17:00",
    };
  }
  if (mode !== "exact" || !startLocalTime || !Object.prototype.hasOwnProperty.call(EXACT_WINDOWS, startLocalTime)) {
    throw new Error("Select a supported exact arrival window.");
  }
  return { mode, startLocalTime, endLocalTime: EXACT_WINDOWS[startLocalTime] };
}

export function formatBookingArrivalPreference(preference: BookingArrivalPreference): string {
  const validated = bookingArrivalPreferenceSchema.parse(preference);
  const formatTime = (time: string) => {
    const [hour, minute] = time.split(":").map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  };
  const label = validated.mode === "flexible" ? "Flexible"
    : validated.mode === "exact" ? "Exact"
      : `Preferred ${validated.period === "morning" ? "morning" : "afternoon"}`;
  return `${label} · ${formatTime(validated.startLocalTime)}–${formatTime(validated.endLocalTime)}`;
}
