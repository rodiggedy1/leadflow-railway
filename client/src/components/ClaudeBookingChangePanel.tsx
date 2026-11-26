import { useRef, useState } from "react";
import { CalendarClock, Check, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  formatArrivalWindow, formatBookingDate, formatBookingTime,
  type BookingActionRecord, type BookingActionRequest, type BookingActionVisit,
} from "@shared/claudeBookingActions";
import type { CustomerTask } from "@shared/claudeCustomerTasks";
import "./claude-booking-change.css";

/** Additive booking-change panel on SMS customer task cards (Phase 1). Tasks without a booking change are unchanged
 * apart from the optional "Set up booking change" button; every existing manual control keeps working. */
const background = { trpc: { context: { batch: "background" } } } as const;
const visitLabel = (visit: BookingActionVisit) => `${formatBookingDate(visit.date)} · ${visit.arrivalWindow
  ? `${formatArrivalWindow(visit.arrivalWindow)} window` : visit.time ? formatBookingTime(visit.time) : "time unavailable"} · ${visit.publicBookingNumber}`;
/** Only LeadFlow's own booking-change messages reach the screen; database and other server errors never do. */
class PanelMessage extends Error {}
const OWN_MESSAGE_CODES = new Set(["CONFLICT", "NOT_FOUND", "PRECONDITION_FAILED"]);
const SOMETHING_WENT_WRONG = "Something went wrong. Nothing was repeated. Refresh the task and check its status before trying again.";
function ownMessage(error: unknown): string | null {
  if (error instanceof PanelMessage) return error.message;
  const data = (error as { data?: { code?: string } })?.data;
  if (data?.code === "FORBIDDEN" || data?.code === "UNAUTHORIZED") return "You need booking access to do this.";
  if (data?.code && OWN_MESSAGE_CODES.has(data.code) && error instanceof Error && error.message) return error.message;
  return null;
}
export function errorText(error: unknown): string {
  return ownMessage(error) ?? SOMETHING_WENT_WRONG;
}
type ConfirmationSteps = {
  begin: () => Promise<{ sessionId: number; text: string }>;
  send: (reserved: { sessionId: number; text: string }) => Promise<{ smsSent?: boolean; duplicate?: boolean }>;
  finish: (outcome: "sent" | "failed") => Promise<unknown>;
};
/** "Send confirmation": reserve, send once, record the outcome once. A failure says whether the text may have gone out. */
export async function sendBookingConfirmation(steps: ConfirmationSteps): Promise<void> {
  let reserved: { sessionId: number; text: string };
  try { reserved = await steps.begin(); }
  catch (caught) { throw new PanelMessage(ownMessage(caught) ?? "The confirmation was not sent. Refresh the task and try again."); }
  let outcome: "sent" | "failed" = "failed";
  let sendFailed = false;
  try {
    const sent = await steps.send(reserved);
    outcome = sent.duplicate || sent.smsSent ? "sent" : "failed";
  } catch { sendFailed = true; }
  try { await steps.finish(outcome); }
  catch {
    throw new PanelMessage(outcome === "sent"
      ? "The confirmation was sent, but saving that failed. Don't send it again: refresh the task in two minutes and choose \"It was sent\"."
      : "The confirmation may not have been sent, and its status could not be saved. Refresh the task in two minutes and check the conversation before choosing.");
  }
  if (sendFailed) throw new PanelMessage("The confirmation may not have been sent. Check the conversation before trying again.");
  if (outcome === "failed") throw new PanelMessage("The confirmation was not sent. Check the conversation, then try again.");
}

export function ClaudeBookingChangePanel({ task }: { task: CustomerTask }) {
  const sms = !("call" in task) && !("email" in task) && Number.isSafeInteger(task.sessionId);
  const utils = trpc.useUtils();
  const view = trpc.claudeCustomerTasks.bookingAction.useQuery({ id: task.id }, { enabled: sms, staleTime: 30_000, refetchOnWindowFocus: false, retry: false, ...background });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [availability, setAvailability] = useState(false);
  const [confirmationText, setConfirmationText] = useState<string | null>(null);
  const setup = trpc.claudeCustomerTasks.setupBookingAction.useMutation();
  const edit = trpc.claudeCustomerTasks.editBookingAction.useMutation();
  const execute = trpc.claudeCustomerTasks.executeBookingAction.useMutation();
  const verify = trpc.claudeCustomerTasks.verifyBookingAction.useMutation();
  const begin = trpc.claudeCustomerTasks.beginBookingConfirmation.useMutation();
  const finish = trpc.claudeCustomerTasks.finishBookingConfirmation.useMutation();
  const send = trpc.leads.sendMessage.useMutation();
  if (!sms) return null;

  /** One request at a time per card; the server separately guarantees each step happens at most once. */
  const run = async (request: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await request(); }
    catch (caught) { setError(errorText(caught)); }
    finally {
      busyRef.current = false; setBusy(false);
      try { await utils.claudeCustomerTasks.invalidate(); } catch { /* the next refresh picks it up */ }
    }
  };

  const data = view.data;
  if (view.isLoading) return null;
  if (!data) {
    if (task.status === "done" || view.isError) return null;
    return editing
      ? <BookingRequestForm task={task} busy={busy} error={error} onCancel={() => setEditing(false)}
          onSave={(request, itemId) => void run(async () => { await setup.mutateAsync({ id: task.id, request, itemId }); setEditing(false); })} />
      : <div className="cbc-setup"><button type="button" disabled={busy} onClick={() => { setError(""); setEditing(true); }}><CalendarClock />Set up booking change</button></div>;
  }

  const { record, assessment } = data;
  const reschedule = record.request.type === "reschedule_visit";
  const heading = `${reschedule ? "Reschedule one visit" : "Cancel one-time booking"} · ${record.source === "claude" ? "proposed by Claude" : "set up by staff"}`;

  if (record.status === "proposed") {
    if (editing) return <BookingRequestForm task={task} initial={record.request} busy={busy} error={error} onCancel={() => setEditing(false)}
      onSave={request => void run(async () => { await edit.mutateAsync({ id: task.id, revision: record.revision, request }); setEditing(false); setAvailability(false); })} />;
    const visit = assessment?.visit ?? null;
    const executable = Boolean(data.enabled && assessment?.executable && visit && (!reschedule || availability));
    return <section className="cbc-panel" aria-label="Booking change">
      <h4><CalendarClock />{heading}</h4>
      {visit && <p className="cbc-visit">Booking {visit.publicBookingNumber} · {visit.serviceName ?? "Cleaning"}{visit.address ? ` · ${visit.address}` : ""}{visit.teamName ? ` · ${visit.teamName}` : ""}</p>}
      <dl className="cbc-change">
        <dt>{reschedule ? "From" : "Visit"}</dt>
        <dd>{visit ? visitLabel(visit) : formatBookingDate(record.request.visitDate)}</dd>
        {reschedule && <><dt>To</dt><dd>{record.request.newDate ? formatBookingDate(record.request.newDate) : "Date not chosen"}
          {assessment?.effectiveNewTime ? visit?.arrivalWindow ? ` · ${formatArrivalWindow(visit.arrivalWindow)} window` : ` · ${formatBookingTime(assessment.effectiveNewTime)}` : ""}</dd></>}
      </dl>
      {record.request.evidenceQuote && <blockquote className="cbc-quote">“{record.request.evidenceQuote}”</blockquote>}
      {assessment?.paymentStatus && <p className="cbc-note">Payment: {assessment.paymentStatus.replace(/_/g, " ")}</p>}
      {(assessment?.warnings ?? []).map(warning => <p key={warning} className="cbc-warning">⚠ {warning}</p>)}
      {(assessment?.manualReasons ?? []).map(reason => <p key={reason} className="cbc-manual">Manual: {reason}</p>)}
      {reschedule && assessment?.executable && <label className="cbc-check"><input type="checkbox" checked={availability} disabled={busy}
        onChange={event => setAvailability(event.target.checked)} />I confirmed a team is available for the new date and time</label>}
      <div className="cbc-actions">
        <button type="button" disabled={busy || record.status !== "proposed"} onClick={() => { setError(""); setEditing(true); }}>Edit</button>
        <button type="button" className="cct-primary" disabled={busy || !executable} title={!data.enabled ? "Booking changes are switched off" : undefined}
          onClick={() => { if (!executable || !visit) return; void run(() => execute.mutateAsync({ id: task.id, revision: record.revision, jobId: visit.jobId, availabilityConfirmed: availability })); }}>
          {busy ? <><Loader2 />Executing…</> : "Approve & execute"}</button>
      </div>
      {error && <p className="cct-feedback" role="alert">{error}</p>}
      <History record={record} />
    </section>;
  }

  const execution = record.execution!;
  const done = `${reschedule ? "Moved" : "Cancelled"} by LeadFlow · approved by ${execution.by.name} · ${new Date(execution.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  const result = execution.expected.cancelled ? `Booking ${execution.publicBookingNumber} (visit ${formatBookingDate(execution.previous.date)}) cancelled`
    : `Booking ${execution.publicBookingNumber}: ${formatBookingDate(execution.previous.date)} ${formatBookingTime(execution.previous.time)} → ${formatBookingDate(execution.expected.date!)}${execution.expected.arrivalWindow ? ` · ${formatArrivalWindow(execution.expected.arrivalWindow)} window` : ` · ${formatBookingTime(execution.expected.time!)}`}`;

  if (record.status === "executed" || record.status === "verification_failed") {
    return <section className="cbc-panel cbc-unverified" aria-label="Booking change">
      <h4><CalendarClock />{heading}</h4>
      <p><strong>Executed, not verified yet.</strong> {result}</p>
      <p className="cbc-note">{done}</p>
      {record.verification && <p className="cbc-manual">Verification: {record.verification.explanation}</p>}
      <p className="cbc-note">The change will not be executed again. The task stays open until the stored booking is verified.</p>
      <div className="cbc-actions"><button type="button" disabled={busy} onClick={() => void run(() => verify.mutateAsync({ id: task.id }))}>
        {busy ? <><Loader2 />Checking…</> : <><RefreshCw />Verify again</>}</button></div>
      {error && <p className="cct-feedback" role="alert">{error}</p>}
      <History record={record} />
    </section>;
  }

  const verification = record.verification;
  const confirmation = record.confirmation;
  const verifiedLine = verification ? `Verified ${new Date(verification.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (${verification.method === "instinct" ? "Instinct verifier" : "exact re-read"})` : "";
  if (record.status === "verified" && confirmation) {
    const text = confirmationText ?? confirmation.text;
    const sendConfirmation = () => void run(() => sendBookingConfirmation({
      begin: () => begin.mutateAsync({ id: task.id, text }),
      send: reserved => send.mutateAsync({ sessionId: reserved.sessionId, message: reserved.text }),
      finish: outcome => finish.mutateAsync({ id: task.id, outcome }),
    }));
    return <section className="cbc-panel cbc-verified" aria-label="Booking change">
      <h4><Check />{heading}</h4>
      <p><strong>Executed and verified.</strong> {result}</p>
      <p className="cbc-note">{done} · {verifiedLine}</p>
      {confirmation.status === "ready" && <>
        <label className="cbc-label" htmlFor={`cbc-confirm-${task.id}`}>Confirmation to the customer (edit before sending)</label>
        <textarea id={`cbc-confirm-${task.id}`} value={text} disabled={busy} maxLength={1600} onChange={event => setConfirmationText(event.target.value)} />
        <div className="cbc-actions">
          <button type="button" disabled={busy} onClick={() => void run(() => finish.mutateAsync({ id: task.id, outcome: "skipped" }))}>No confirmation needed</button>
          <button type="button" className="cct-primary" disabled={busy || !text.trim()} onClick={sendConfirmation}>{busy ? <><Loader2 />Sending…</> : "Send confirmation"}</button>
        </div>
      </>}
      {confirmation.status === "sending" && <p className="cbc-note"><Loader2 />Sending the confirmation…</p>}
      {confirmation.status === "uncertain" && <>
        <p className="cbc-warning">⚠ The confirmation may have been sent. Check the conversation before choosing.</p>
        <div className="cbc-actions">
          <button type="button" disabled={busy} onClick={() => void run(() => finish.mutateAsync({ id: task.id, outcome: "mark_not_sent" }))}>It was not sent</button>
          <button type="button" className="cct-primary" disabled={busy} onClick={() => void run(() => finish.mutateAsync({ id: task.id, outcome: "mark_sent" }))}>It was sent</button>
        </div>
      </>}
      {error && <p className="cct-feedback" role="alert">{error}</p>}
      <History record={record} />
    </section>;
  }

  return <section className="cbc-panel cbc-closed" aria-label="Booking change">
    <h4><Check />{heading}</h4>
    <p><strong>Executed and verified.</strong> {result}</p>
    <p className="cbc-note">{done}{verifiedLine ? ` · ${verifiedLine}` : ""}{confirmation ? ` · Confirmation ${confirmation.status === "sent" ? "sent" : "not needed"}${confirmation.by ? ` (${confirmation.by.name})` : ""}` : ""}</p>
    <History record={record} />
  </section>;
}

function History({ record }: { record: BookingActionRecord }) {
  return <details className="cbc-history"><summary>History ({record.history.length})</summary><ul>
    {record.history.map((entry, index) => <li key={index}>{new Date(entry.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {entry.action.replace(/_/g, " ")}{entry.actor ? ` · ${entry.actor.name}` : ""}{entry.note ? ` · ${entry.note}` : ""}</li>)}
  </ul></details>;
}

function BookingRequestForm({ task, initial, busy, error, onSave, onCancel }: {
  task: CustomerTask; initial?: BookingActionRequest; busy: boolean; error: string;
  onSave: (request: BookingActionRequest, itemId: string | null) => void; onCancel: () => void;
}) {
  const visits = trpc.claudeCustomerTasks.bookingActionVisits.useQuery({ id: task.id }, { staleTime: 30_000, retry: false, ...background });
  const [type, setType] = useState<BookingActionRequest["type"]>(initial?.type ?? "reschedule_visit");
  const [jobId, setJobId] = useState<number | null>(initial?.jobId ?? null);
  const [visitDate, setVisitDate] = useState(initial?.visitDate ?? "");
  const [newDate, setNewDate] = useState(initial?.newDate ?? "");
  const [newTime, setNewTime] = useState(initial?.newTime ?? "");
  const [itemId, setItemId] = useState<string | null>(task.items.length === 1 ? task.items[0].id : null);
  const options = visits.data ?? [];
  const chosen = options.find(visit => visit.jobId === jobId) ?? (jobId === null ? options.filter(visit => visit.date === visitDate)[0] : undefined);
  const reschedule = type === "reschedule_visit";
  const valid = Boolean(visitDate) && (!reschedule || Boolean(newDate));
  return <section className="cbc-panel cbc-form" aria-label="Booking change details">
    <h4><CalendarClock />{initial ? "Edit booking change" : "Set up booking change"}</h4>
    <label className="cbc-label">Change<select value={type} disabled={busy} onChange={event => setType(event.target.value as BookingActionRequest["type"])}>
      <option value="reschedule_visit">Reschedule one visit</option><option value="cancel_visit">Cancel a one-time booking</option></select></label>
    <label className="cbc-label">Visit<select value={chosen ? String(chosen.jobId) : ""} disabled={busy || visits.isLoading}
      onChange={event => { const visit = options.find(option => option.jobId === Number(event.target.value)); setJobId(visit?.jobId ?? null); setVisitDate(visit?.date ?? ""); }}>
      <option value="">{visits.isLoading ? "Loading visits…" : options.length ? "Choose a visit" : "No upcoming native visits"}</option>
      {options.map(visit => <option key={visit.jobId} value={visit.jobId}>{visitLabel(visit)}</option>)}</select></label>
    {reschedule && <div className="cbc-row">
      <label className="cbc-label">New date<input type="date" value={newDate} disabled={busy} onChange={event => setNewDate(event.target.value)} /></label>
      <label className="cbc-label">New time<input type="time" value={chosen?.arrivalWindow ? chosen.arrivalWindow.start : newTime} disabled={busy || Boolean(chosen?.arrivalWindow)}
        onChange={event => setNewTime(event.target.value)} /></label>
    </div>}
    {reschedule && chosen?.arrivalWindow && <p className="cbc-note">This booking keeps its {formatArrivalWindow(chosen.arrivalWindow)} arrival window.</p>}
    {!initial && task.items.length > 1 && <label className="cbc-label">Completes checklist item<select value={itemId ?? ""} disabled={busy}
      onChange={event => setItemId(event.target.value || null)}><option value="">None</option>{task.items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
    <div className="cbc-actions">
      <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className="cct-primary" disabled={busy || !valid} onClick={() => onSave({ type, visitDate, jobId: chosen?.jobId ?? jobId,
        newDate: reschedule ? newDate || null : null, newTime: reschedule && !chosen?.arrivalWindow ? newTime || null : null,
        evidenceQuote: initial?.evidenceQuote ?? null }, itemId)}>{busy ? <><Loader2 />Saving…</> : "Save"}</button>
    </div>
    {error && <p className="cct-feedback" role="alert">{error}</p>}
  </section>;
}
