export const BOOKING_TIME_ZONE = "America/New_York";

function easternParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BOOKING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function easternDateIso(date = new Date(), offsetDays = 0): string {
  const current = easternParts(date);
  const shifted = new Date(Date.UTC(current.year, current.month - 1, current.day + offsetDays, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function parseEasternDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function easternDateIsoFromDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function easternDateLabel(value: string, options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: BOOKING_TIME_ZONE }).format(parseEasternDate(value));
}

export function easternMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: BOOKING_TIME_ZONE }).format(date);
}

export function easternCalendarWeekday(year: number, monthIndex: number, day = 1): number {
  return new Date(Date.UTC(year, monthIndex, day, 12)).getUTCDay();
}

export function easternMonthDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 12));
}
