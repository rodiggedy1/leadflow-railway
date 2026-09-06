import { Check, MapPin, NotebookPen, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { getCustomerPortalLiveStatusView, type CustomerPortalTodayJob } from "@shared/customerPortalLiveStatus";

const STATUS_STEPS = ["Confirmed", "On the way", "Arrived", "Complete"];
type PortalBookingDetail = {
  id: number;
  serviceName: string | null;
  serviceDateTime: string | null;
  jobAddress: string | null;
  customerNotes: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
};

function formatScheduledTime(value: string | null) {
  if (!value) return "Time will be confirmed here.";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

export function PortalTodayStatus({ job, booking, onViewBooking, onUpdateNote, savingNote = false }: { job: CustomerPortalTodayJob; booking: PortalBookingDetail | null; onViewBooking: () => void; onUpdateNote?: (note: string) => void; savingNote?: boolean }) {
  const view = getCustomerPortalLiveStatusView(job);
  const noteValue = booking?.customerNotes ?? "";
  const [note, setNote] = useState(noteValue);
  useEffect(() => { setNote(noteValue); }, [booking?.id, noteValue]);
  const serviceName = booking?.serviceName || job.serviceType || "Home cleaning";
  const serviceTime = booking?.serviceDateTime || job.serviceDateTime;
  const address = booking?.jobAddress;
  const noteChanged = note !== noteValue;
  return <section className={`mib-direct-live-status${view.isRunningLate ? " is-running-late" : ""}`} aria-label="Today’s cleaning status" aria-live="polite">
    <div className="mib-direct-live-status-copy"><small>TODAY’S CLEANING <i aria-hidden="true" /></small><h2>{view.title}</h2><p>{view.detail}</p></div>
    <ol className={`mib-direct-status-steps is-step-${view.progressIndex}`} aria-label={`Current status: ${view.title}`}>{STATUS_STEPS.map((step, index) => <li key={step} className={index < view.progressIndex ? "is-complete" : index === view.progressIndex ? "is-current" : ""}><span>{index < view.progressIndex ? <Check aria-hidden="true" /> : null}</span><b>{step}</b></li>)}</ol>
    <div className="mib-direct-live-team"><span className="mib-direct-live-team-icon"><UserRound aria-hidden="true" /></span><div><strong>{job.teamName || "Your Maids in Black team"}</strong><p>{job.serviceType || "Your cleaning team"}</p></div><button className="mib-direct-live-booking" type="button" onClick={onViewBooking}>View booking</button></div>
    <div className="mib-direct-live-details"><div><span><NotebookPen aria-hidden="true" /> TODAY&apos;S SERVICE</span><strong>{serviceName}</strong><p>{formatScheduledTime(serviceTime)}{booking?.bedrooms ? ` · ${booking.bedrooms} bedroom${booking.bedrooms === 1 ? "" : "s"}` : ""}{booking?.bathrooms ? ` · ${booking.bathrooms} bath${booking.bathrooms === 1 ? "" : "s"}` : ""}</p></div>{address && <div><span><MapPin aria-hidden="true" /> SERVICE ADDRESS</span><strong>{address}</strong></div>}{booking && onUpdateNote ? <form className="mib-direct-live-note-form" onSubmit={event => { event.preventDefault(); if (noteChanged) onUpdateNote(note); }}><div><label htmlFor={`portal-today-note-${booking.id}`}>Notes for today</label><small>Visible to your cleaning team</small></div><textarea id={`portal-today-note-${booking.id}`} value={note} onChange={event => setNote(event.target.value)} maxLength={2_000} placeholder="Add any instructions for your cleaning team" /><div className="mib-direct-live-note-actions"><span>{note.length}/2,000</span><button type="submit" disabled={!noteChanged || savingNote}>{savingNote ? "Saving note…" : "Save note"}</button></div></form> : noteValue ? <div className="mib-direct-live-note"><span>NOTES FOR TODAY</span><p>{noteValue}</p></div> : null}</div>
  </section>;
}
