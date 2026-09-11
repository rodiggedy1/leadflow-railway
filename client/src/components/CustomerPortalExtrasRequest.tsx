import { useState } from "react";
import { ArrowRight, CalendarDays, Check, CheckCircle2, Minus, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "@shared/bookingWidgetConfig";
import { formatCustomerPortalExtrasEstimate } from "@shared/customerPortalExtrasRequest";
import type { CustomerPortalScheduleRequestBooking } from "./CustomerPortalScheduleRequest";
import { formatCustomerPortalServiceTime } from "@/lib/customerPortalTime";
import "./customer-portal-extras-request.css";

export function CustomerPortalExtrasRequest({ booking, onClose }: { booking: CustomerPortalScheduleRequestBooking; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [selectedExtraIds, setSelectedExtraIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const requestExtras = trpc.customerPortal.requestBookingExtras.useMutation({
    onSuccess: () => {
      void utils.customerPortal.me.invalidate();
      setSubmitted(true);
    },
  });

  const selectedExtras = BOOKING_WIDGET_PRICED_EXTRAS.filter((extra) => selectedExtraIds.includes(extra.id));
  const requestEstimateCents = selectedExtras.reduce((total, extra) => total + (extra.unitPrice * 100 * (extra.quantityUnit ? quantities[extra.id] ?? 1 : 1)), 0);
  const toggleExtra = (extraId: string) => setSelectedExtraIds((current) => current.includes(extraId) ? current.filter((id) => id !== extraId) : [...current, extraId]);
  const changeQuantity = (extraId: string, next: number) => setQuantities((current) => ({ ...current, [extraId]: Math.max(1, Math.min(100, next)) }));
  const submit = () => {
    if (selectedExtras.length === 0) return;
    requestExtras.mutate({
      bookingSource: booking.source,
      bookingId: booking.id,
      extras: selectedExtras.map((extra) => ({ extraId: extra.id, quantity: extra.quantityUnit ? quantities[extra.id] ?? 1 : 1 })),
      notes: notes.trim() || undefined,
    });
  };

  if (submitted) {
    return <div className="mib-portal-modal" role="dialog" aria-modal="true" aria-labelledby="mib-extras-request-confirmed"><main className="mib-portal-modal-card mib-portal-extras-request__dialog"><button type="button" className="mib-portal-close" onClick={onClose} aria-label="Close extras request confirmation">×</button><section className="mib-portal-extras-request__confirmed"><span><CheckCircle2 /></span><small>REQUEST SENT</small><h2 id="mib-extras-request-confirmed">We&apos;ll review your extras.</h2><p>Your request was sent to our office. Your booking and card stay unchanged until we confirm the details with you.</p><button type="button" className="mib-portal-primary" onClick={onClose}>Return to My Home <ArrowRight /></button></section></main></div>;
  }

  return <div className="mib-portal-modal" role="dialog" aria-modal="true" aria-labelledby="mib-extras-request-title"><main className="mib-portal-modal-card mib-portal-extras-request__dialog"><button type="button" className="mib-portal-close" onClick={onClose} aria-label="Close extras request">×</button><header className="mib-portal-extras-request__heading"><small>ADD EXTRAS</small><h2 id="mib-extras-request-title">Make your cleaning yours.</h2><p>Select the extras you&apos;d like us to review for this visit.</p></header><section className="mib-portal-extras-request__workspace"><div className="mib-portal-extras-request__current"><CalendarDays /><span><small>UPCOMING APPOINTMENT</small><strong>{booking.serviceType || "Home cleaning"} · {booking.jobDate}</strong><em>{formatCustomerPortalServiceTime(booking.serviceDateTime)}</em></span></div><div className="mib-portal-extras-request__grid" role="group" aria-label="Choose extras">{BOOKING_WIDGET_PRICED_EXTRAS.map((extra) => { const selected = selectedExtraIds.includes(extra.id); const quantity = quantities[extra.id] ?? 1; return <div className={`mib-portal-extras-request__card${selected ? " selected" : ""}`} key={extra.id}><button type="button" className="mib-portal-extras-request__toggle" onClick={() => toggleExtra(extra.id)} aria-pressed={selected}><span>{selected ? <Check /> : <Plus />}</span><strong>{extra.label}</strong><small>+{formatCustomerPortalExtrasEstimate(extra.unitPrice * 100)}{extra.quantityUnit ? `/${extra.quantityUnit}` : ""}</small></button>{selected && extra.quantityUnit && <div className="mib-portal-extras-request__quantity"><button type="button" aria-label={`Decrease ${extra.label} quantity`} onClick={() => changeQuantity(extra.id, quantity - 1)}><Minus /></button><strong>{quantity}</strong><button type="button" aria-label={`Increase ${extra.label} quantity`} onClick={() => changeQuantity(extra.id, quantity + 1)}><Plus /></button></div>}</div>; })}</div><div className="mib-portal-extras-request__summary"><span>{selectedExtras.length === 0 ? "Choose one or more extras" : `${selectedExtras.length} extra${selectedExtras.length === 1 ? "" : "s"} selected`}</span><strong>{formatCustomerPortalExtrasEstimate(requestEstimateCents)} <small>request estimate</small></strong></div><label className="mib-portal-extras-request__notes"><span>Note for our office <em>Optional</em></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything we should know?" maxLength={2_000} /></label>{requestExtras.error && <p className="mib-portal-error">{requestExtras.error.message}</p>}</section><footer className="mib-portal-extras-request__actions"><button type="button" className="mib-portal-extras-request__back" onClick={onClose}>Not now</button><button type="button" className="mib-portal-primary" disabled={selectedExtras.length === 0 || requestExtras.isPending} onClick={submit}>{requestExtras.isPending ? "Sending request…" : "Send request"}<ArrowRight /></button></footer></main></div>;
}
