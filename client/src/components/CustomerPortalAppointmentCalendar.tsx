import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { firstCustomerPortalBookableDate, getCustomerPortalCalendarGrid, isCustomerPortalBookableDate, isSameCustomerPortalDate } from "@/lib/customerPortalAppointment";

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CustomerPortalAppointmentCalendar({ value, onChange }: { value: Date | null; onChange: (date: Date) => void }) {
  const minimumDate = useMemo(() => firstCustomerPortalBookableDate(), []);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(minimumDate.getFullYear(), minimumDate.getMonth(), 1));
  const grid = useMemo(() => getCustomerPortalCalendarGrid(visibleMonth), [visibleMonth]);
  const previousMonthEnd = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 0);
  return <section className="mib-preferred-calendar" aria-label="Choose a preferred appointment date">
    <div className="mib-preferred-calendar-head"><div><span>Choose a date</span><strong>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(visibleMonth)}</strong></div><div className="mib-preferred-calendar-nav"><button type="button" aria-label="Previous month" onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))} disabled={!isCustomerPortalBookableDate(previousMonthEnd)}><ChevronLeft /></button><button type="button" aria-label="Next month" onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight /></button></div></div>
    <div className="mib-preferred-calendar-weekdays" aria-hidden="true">{weekdayLabels.map(day => <span key={day}>{day}</span>)}</div>
    <div className="mib-preferred-calendar-grid">{grid.map(date => { const outside = date.getMonth() !== visibleMonth.getMonth(); const selected = isSameCustomerPortalDate(value, date); const bookable = isCustomerPortalBookableDate(date); return <button key={date.toISOString()} type="button" disabled={!bookable} onClick={() => onChange(date)} className={`mib-preferred-calendar-day${outside ? " outside" : ""}${selected ? " selected" : ""}`} aria-pressed={selected} aria-label={new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date)}>{date.getDate()}</button>; })}</div>
  </section>;
}
