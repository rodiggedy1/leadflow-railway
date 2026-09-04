export type CustomerPortalAppointmentWindow = {
  id: "morning" | "midday" | "afternoon" | "evening";
  label: string;
  detail: string;
};

export const customerPortalAppointmentWindows: CustomerPortalAppointmentWindow[] = [
  { id: "morning", label: "Morning", detail: "8:00–11:00 AM" },
  { id: "midday", label: "Midday", detail: "11:00 AM–2:00 PM" },
  { id: "afternoon", label: "Afternoon", detail: "2:00–5:00 PM" },
  { id: "evening", label: "Evening", detail: "5:00–7:00 PM" },
];

function calendarDate(year: number, month: number, day: number) {
  return new Date(year, month, day, 12, 0, 0, 0);
}

export function startOfCustomerPortalDay(value: Date) {
  return calendarDate(value.getFullYear(), value.getMonth(), value.getDate());
}

export function firstCustomerPortalBookableDate(now = new Date()) {
  const nextDay = startOfCustomerPortalDay(now);
  nextDay.setDate(nextDay.getDate() + 1);
  return nextDay;
}

export function lastCustomerPortalBookableDate(now = new Date()) {
  const lastDay = firstCustomerPortalBookableDate(now);
  lastDay.setDate(lastDay.getDate() + 55);
  return lastDay;
}

export function isCustomerPortalBookableDate(date: Date, now = new Date()) {
  const candidate = startOfCustomerPortalDay(date).getTime();
  return candidate >= firstCustomerPortalBookableDate(now).getTime() && candidate <= lastCustomerPortalBookableDate(now).getTime();
}

export function getCustomerPortalCalendarGrid(month: Date) {
  const firstDay = calendarDate(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(firstDay);
  gridStart.setDate(gridStart.getDate() - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

export function isSameCustomerPortalDate(first: Date | null, second: Date | null) {
  return Boolean(first && second && first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate());
}

export function formatCustomerPortalDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

export function formatCustomerPortalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatCustomerPortalTime(window: CustomerPortalAppointmentWindow) {
  return `${window.label} (${window.detail})`;
}
