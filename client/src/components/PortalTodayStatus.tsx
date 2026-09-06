import { Check, UserRound } from "lucide-react";
import { getCustomerPortalLiveStatusView, type CustomerPortalTodayJob } from "@shared/customerPortalLiveStatus";

const STATUS_STEPS = ["Confirmed", "On the way", "Arrived", "Complete"];

export function PortalTodayStatus({ job, onViewBooking }: { job: CustomerPortalTodayJob; onViewBooking: () => void }) {
  const view = getCustomerPortalLiveStatusView(job);
  return <section className={`mib-direct-live-status${view.isRunningLate ? " is-running-late" : ""}`} aria-label="Today’s cleaning status" aria-live="polite">
    <div className="mib-direct-live-status-copy"><small>TODAY’S CLEANING <i aria-hidden="true" /></small><h2>{view.title}</h2><p>{view.detail}</p></div>
    <ol className={`mib-direct-status-steps is-step-${view.progressIndex}`} aria-label={`Current status: ${view.title}`}>{STATUS_STEPS.map((step, index) => <li key={step} className={index < view.progressIndex ? "is-complete" : index === view.progressIndex ? "is-current" : ""}><span>{index < view.progressIndex ? <Check aria-hidden="true" /> : null}</span><b>{step}</b></li>)}</ol>
    <div className="mib-direct-live-team"><span className="mib-direct-live-team-icon"><UserRound aria-hidden="true" /></span><div><strong>{job.teamName || "Your Maids in Black team"}</strong><p>{job.serviceType || "Your cleaning team"}</p></div><button className="mib-direct-live-booking" type="button" onClick={onViewBooking}>View booking</button></div>
  </section>;
}
