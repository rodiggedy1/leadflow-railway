import { useState } from "react";
import { ArrowRight, CalendarDays, CheckCircle2, TriangleAlert, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { CustomerPortalAppointmentCalendar } from "@/components/CustomerPortalAppointmentCalendar";
import { customerPortalAppointmentWindows, formatCustomerPortalDate, formatCustomerPortalDateKey, formatCustomerPortalTime, type CustomerPortalAppointmentWindow } from "@/lib/customerPortalAppointment";
import { formatCustomerPortalServiceTime } from "@/lib/customerPortalTime";
import { formatCustomerPortalLateRescheduleFee, isCustomerPortalRescheduleWithin24Hours } from "@shared/customerPortalScheduleRequest";
import "./customer-portal-schedule-request.css";

export type CustomerPortalScheduleRequestBooking = {
  source: "booking" | "leadflow";
  id: number;
  jobDate: string;
  serviceDateTime: string | null;
  scheduledAt: string | number | null;
  serviceType: string | null;
};

export function CustomerPortalScheduleRequest({ booking, onClose }: { booking: CustomerPortalScheduleRequestBooking; onClose: () => void }) {
  const utils = trpc.useUtils();
  const requestChange = trpc.customerPortal.requestScheduleChange.useMutation({
    onSuccess: () => {
      void utils.customerPortal.me.invalidate();
      setSubmitted(true);
    },
  });
  const [date, setDate] = useState<Date | null>(null);
  const [timeWindow, setTimeWindow] = useState<CustomerPortalAppointmentWindow | null>(null);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const lateReschedule = isCustomerPortalRescheduleWithin24Hours({ scheduledAt: booking.scheduledAt, scheduledDate: booking.jobDate });
  const currentTime = formatCustomerPortalServiceTime(booking.serviceDateTime);
  const canSubmit = Boolean(date && timeWindow);

  const submit = () => {
    if (!canSubmit) return;
    requestChange.mutate({
      bookingSource: booking.source,
      bookingId: booking.id,
      ...(date && timeWindow ? {
        preferredLocalDate: formatCustomerPortalDateKey(date),
        preferredLocalTime: formatCustomerPortalTime(timeWindow),
      } : {}),
      notes: notes.trim() || undefined,
    });
  };

  if (submitted) {
    return <div className="mib-portal-rebook-overlay" role="dialog" aria-modal="true" aria-labelledby="mib-schedule-request-confirmed"><main className="mib-booking-panel mib-portal-schedule-request"><button type="button" className="mib-portal-schedule-request__close" onClick={onClose} aria-label="Close request confirmation"><X /></button><section className="mib-portal-schedule-request__confirmed"><span><CheckCircle2 /></span><small>REQUEST SENT</small><h1 id="mib-schedule-request-confirmed">We&apos;ll take it from here.</h1><p>Your preferred appointment change was sent to our office. We&apos;ll review it and text you with an update.</p>{lateReschedule && <div className="mib-portal-schedule-request__late-note"><TriangleAlert /><span><strong>{formatCustomerPortalLateRescheduleFee()} late reschedule fee may apply.</strong><small>No fee was charged through this request.</small></span></div>}<button type="button" className="book-now-next-button" onClick={onClose}>Return to My Home <ArrowRight /></button></section></main></div>;
  }

  return <div className="mib-portal-rebook-overlay" role="dialog" aria-modal="true" aria-labelledby="mib-schedule-request-title"><main className="mib-booking-panel mib-portal-schedule-request"><header className="mib-booking-panel__header"><div className="mib-booking-panel__agent"><span className="mib-booking-panel__avatar">M<i /></span><div><strong>Maids in Black</strong><span>Reschedule your appointment</span></div></div><button type="button" onClick={onClose} aria-label="Close reschedule request" className="mib-booking-panel__close">×</button></header><section className="mib-booking-panel__intro mib-portal-schedule-request__intro"><span>RESCHEDULE REQUEST</span><h1 id="mib-schedule-request-title">Choose a new preferred time.</h1><p>Your appointment stays as scheduled until our office reviews and confirms your request.</p></section><section className="mib-portal-schedule-request__workspace"><div className="mib-portal-schedule-request__current"><CalendarDays /><span><small>CURRENT APPOINTMENT</small><strong>{booking.serviceType || "Home cleaning"} · {booking.jobDate}</strong><em>{currentTime}</em></span></div><div className="mib-portal-schedule-request__calendar"><div className="mib-portal-appointment-field-head"><span>Preferred new appointment</span><small>We&apos;ll confirm availability before making any change.</small></div><CustomerPortalAppointmentCalendar value={date} onChange={setDate} /><div className="mib-portal-time-window-grid" role="group" aria-label="Choose a preferred time window">{customerPortalAppointmentWindows.map(window => <button type="button" key={window.id} className={timeWindow?.id === window.id ? "selected" : ""} onClick={() => setTimeWindow(window)} aria-pressed={timeWindow?.id === window.id}><strong>{window.label}</strong><span>{window.detail}</span></button>)}</div>{date && <p className="mib-portal-appointment-selection">Preferred: <strong>{formatCustomerPortalDate(date)}{timeWindow ? ` · ${formatCustomerPortalTime(timeWindow)}` : ""}</strong></p>}</div>{lateReschedule && <div className="mib-portal-schedule-request__fee-warning" role="alert"><TriangleAlert /><span><strong>{formatCustomerPortalLateRescheduleFee()} late reschedule warning</strong><small>This change is being requested same-day or within 24 hours of service. A {formatCustomerPortalLateRescheduleFee()} cancellation fee may apply. No fee will be charged through this request.</small></span></div>}<label className="mib-portal-schedule-request__notes"><span>Anything we should know?</span><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Optional note for our office" maxLength={2_000} /></label>{requestChange.error && <p className="mib-portal-error">{requestChange.error.message}</p>}</section><footer className="book-now-step-actions mib-portal-schedule-request__actions"><button type="button" className="book-now-back-button" onClick={onClose}>Back</button><button type="button" className="book-now-next-button" disabled={!canSubmit || requestChange.isPending} onClick={submit}>{requestChange.isPending ? "Sending request…" : "Send reschedule request"}<ArrowRight /></button></footer></main></div>;
}
