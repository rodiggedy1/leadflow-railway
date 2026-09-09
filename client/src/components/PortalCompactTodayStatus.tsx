import { Check, ChevronDown, NotebookPen, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { getCustomerPortalLiveStatusView, type CustomerPortalTodayJob } from "@shared/customerPortalLiveStatus";
import "./portal-compact-today-status.css";

const STATUS_STEPS = ["Confirmed", "On the way", "Arrived", "Complete"];

type PortalBookingDetail = {
  id: number;
  serviceName: string | null;
  customerNotes: string | null;
};

type PortalCompactTodayStatusProps = {
  job: CustomerPortalTodayJob;
  booking: PortalBookingDetail | null;
  onViewBooking: () => void;
  onUpdateNote?: (note: string) => void;
  savingNote?: boolean;
};

export function PortalCompactTodayStatus({ job, booking, onViewBooking, onUpdateNote, savingNote = false }: PortalCompactTodayStatusProps) {
  const view = getCustomerPortalLiveStatusView(job);
  const noteValue = booking?.customerNotes ?? "";
  const [note, setNote] = useState(noteValue);
  const [notesOpen, setNotesOpen] = useState(false);
  const noteChanged = note !== noteValue;
  const canEditNote = Boolean(booking && onUpdateNote);

  useEffect(() => { setNote(noteValue); }, [booking?.id, noteValue]);

  return <section className={`mib-home-today-status${view.isRunningLate ? " is-running-late" : ""}`} aria-label="Today’s cleaning status" aria-live="polite">
    <div className="mib-home-today-status__strip">
      <div className="mib-home-today-status__copy"><small>TODAY’S CLEANING <i aria-hidden="true" /></small><h2>{view.title}</h2><p>{view.detail}</p></div>
      <ol className={`mib-home-today-status__steps is-step-${view.progressIndex}`} aria-label={`Current status: ${view.title}`}>{STATUS_STEPS.map((step, index) => <li key={step} className={index < view.progressIndex ? "is-complete" : index === view.progressIndex ? "is-current" : ""}><span>{index < view.progressIndex ? <Check aria-hidden="true" /> : null}</span><b>{step}</b></li>)}</ol>
      <div className="mib-home-today-status__team"><span className="mib-home-today-status__team-icon"><UserRound aria-hidden="true" /></span><div><strong>{job.teamName || "Your Maids in Black team"}</strong><p>{job.serviceType || "Your cleaning team"}</p></div><button type="button" onClick={onViewBooking}>View booking</button></div>
    </div>
    {canEditNote ? <div className="mib-home-today-status__notes">
      <button className="mib-home-today-status__notes-toggle" type="button" aria-expanded={notesOpen} aria-controls={`portal-home-today-note-${booking!.id}`} onClick={() => setNotesOpen(open => !open)}><span><NotebookPen aria-hidden="true" /> Notes for today</span><ChevronDown aria-hidden="true" /></button>
      <div id={`portal-home-today-note-${booking!.id}`} className={`mib-home-today-status__notes-reveal${notesOpen ? " is-open" : ""}`}><div className="mib-home-today-status__notes-inner"><form onSubmit={event => { event.preventDefault(); if (noteChanged) onUpdateNote?.(note); }}><div><label htmlFor={`portal-home-today-note-input-${booking!.id}`}>Notes for today</label><small>Visible to your cleaning team</small></div><textarea id={`portal-home-today-note-input-${booking!.id}`} value={note} onChange={event => setNote(event.target.value)} maxLength={2_000} placeholder="Add any instructions for your cleaning team" /><div className="mib-home-today-status__notes-actions"><span>{note.length}/2,000</span><button type="submit" disabled={!noteChanged || savingNote}>{savingNote ? "Saving note…" : "Save note"}</button></div></form></div></div>
    </div> : noteValue ? <div className="mib-home-today-status__saved-note"><NotebookPen aria-hidden="true" /><span><b>Notes for today</b><small>{noteValue}</small></span></div> : null}
  </section>;
}
