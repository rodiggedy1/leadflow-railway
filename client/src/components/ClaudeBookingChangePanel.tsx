import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, CalendarClock, CheckCircle2, Clock3, ExternalLink, Loader2, Pencil, RefreshCw, Send } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { looksLikeBookingChange } from "@shared/bookingChangeClaims";
import {
  formatArrivalWindow, formatBookingTime,
  type BookingActionRecord, type BookingActionRequest, type BookingActionView, type BookingActionVisit,
} from "@shared/claudeBookingActions";
import type { CustomerTask } from "@shared/claudeCustomerTasks";
import "./claude-booking-change.css";

/** Booking changes on SMS customer task cards (Phase 1), in the approved 320px card design. Tasks without a booking
 * change only show the optional "Set up booking change" link; every existing manual control keeps working. */
const background = { trpc: { context: { batch: "background" } } } as const;
const shortDate = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
  .format(new Date(`${date}T12:00:00.000Z`));
const shortTime = (time: string) => formatBookingTime(time).replace(":00 ", " ");
const timeOrWindow = (time: string | null, window: { start: string; end: string } | null) => window ? formatArrivalWindow(window) : time ? formatBookingTime(time) : null;
const visitOption = (visit: BookingActionVisit) => `${shortDate(visit.date)} · ${visit.arrivalWindow ? `${formatArrivalWindow(visit.arrivalWindow)} window` : visit.time ? formatBookingTime(visit.time) : "time unavailable"}`;

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

const isSmsTask = (task: CustomerTask) => !("call" in task) && !("email" in task) && Number.isSafeInteger(task.sessionId);
/** The card's booking change, if any. One shared request for every card (same cache entry) lists the tasks that have
 * a booking change with a fingerprint of each record; only those cards load their details, and they reload only when
 * their own record changed. Ordinary task cards make no booking-change request. Safe to call from several places. */
export function useBookingChange(task: CustomerTask, expanded = false) {
  const sms = isSmsTask(task);
  const utils = trpc.useUtils();
  const versions = trpc.claudeCustomerTasks.bookingActionVersions.useQuery(undefined, { enabled: sms, staleTime: 30_000, refetchOnWindowFocus: false, retry: false, ...background });
  const version = sms ? versions.data?.[String(task.id)] ?? null : null;
  const hasRecord = version !== null;
  // Keyed by the record's fingerprint, outside the task-list cache: the existing "refresh every task" after any task
  // update does not reload it; it reloads only when this booking change itself changed (or after 60 s on refocus).
  const view = useQuery({
    queryKey: ["claudeBookingChange", task.id, version],
    queryFn: () => utils.client.claudeCustomerTasks.bookingAction.query({ id: task.id }, { context: { batch: "background" } }),
    enabled: hasRecord, staleTime: 60_000, refetchOnWindowFocus: true, retry: false, placeholderData: previous => previous,
    // "Sending" turns into "may have been sent" after two minutes without any write: check again while it lasts.
    refetchInterval: query => query.state.data?.record.confirmation?.status === "sending" ? 30_000 : false,
  });
  // Dismissed proposals (Activity history), only while the card is open; reloads when this task's booking change changes.
  const dismissed = useQuery({
    queryKey: ["claudeBookingChangeDismissed", task.id, version],
    queryFn: () => utils.client.claudeCustomerTasks.dismissedBookingActions.query({ id: task.id }, { context: { batch: "background" } }),
    // staleTime 0: "no booking change" before and after a dismissal share one key, so a key change always reloads.
    enabled: sms && expanded, staleTime: 0, refetchOnWindowFocus: false, retry: false, placeholderData: previous => previous,
  });
  return { sms, version, hasRecord, versions, view, data: hasRecord ? (view.data ?? null) : null, dismissed: dismissed.data ?? [] };
}

/** A booking change LeadFlow cannot make: the customer's booking is in Launch27, or which system it is in is not clear.
 * null = native LeadFlow (or not a booking change), so the existing approve, execute and verify workflow applies. */
/** "both" = bookings in both systems: notice shown, and a native appointment can still be changed by the native workflow. */
export type ManualBookingChange = { source: "launch27" | "both" | "unknown"; launch27BookingIds: number[] } | null;
const launch27BookingUrl = (id: number) => `https://maidsinblack.launch27.com/admin/bookings/${id}`;
/** A record for a native visit (executable, or already changed by LeadFlow) keeps the native workflow. */
const nativeRecord = (view: BookingActionView | null) => Boolean(view && (view.record.status !== "proposed" || (view.assessment?.executable && view.assessment.visit)));
/** Pure decision, tested on its own. Anything other than a confirmed native booking is manual. */
export function manualBookingChange(task: CustomerTask, view: BookingActionView | null,
  source: { source: "native" | "launch27" | "both" | "unknown"; launch27BookingIds: number[] } | null | undefined, sourceFailed: boolean): ManualBookingChange {
  if (nativeRecord(view) || !(view || looksLikeBookingChange(task.title, task.sourceText, ...task.items.map(item => item.title)))) return null;
  if (sourceFailed) return { source: "unknown", launch27BookingIds: [] };
  if (!source || source.source === "native") return null;
  return { source: source.source, launch27BookingIds: source.launch27BookingIds };
}
/** Asks the server which booking system this customer's visits are in, only for booking-change cards. */
export function useManualBookingChange(task: CustomerTask, view: BookingActionView | null): ManualBookingChange {
  const relevant = !nativeRecord(view) && Boolean(view || looksLikeBookingChange(task.title, task.sourceText, ...task.items.map(item => item.title)));
  const source = trpc.claudeCustomerTasks.bookingSource.useQuery({ id: task.id }, { enabled: relevant, staleTime: 300_000, refetchOnWindowFocus: false, retry: false, ...background });
  return relevant ? manualBookingChange(task, view, source.data, source.isError) : null;
}
const changeKind = (text: string) => /\bcancel/i.test(text) ? "cancellation" : /\bskip/i.test(text) ? "skipped appointment"
  : /\bfrequen|\bbi-?weekly\b|\bevery (other|two|three|four|2|3|4) weeks?\b|\bmonthly\b/i.test(text) ? "frequency change"
  : /\bpause/i.test(text) ? "pause" : /\breschedul|\bpostpone|\bmove\b|\bdifferent (day|date|time)\b/i.test(text) ? "reschedule" : "booking change";
/** One line for the collapsed card. */
export const manualBookingStatus = (manual: NonNullable<ManualBookingChange>) => ({ tone: "warning" as const,
  text: manual.source === "launch27" ? "Manual action required — Launch27" : manual.source === "both" ? "Check booking — Launch27 and LeadFlow"
    : "Manual action required — booking system not confirmed" });
/** Shown on every booking-change card that LeadFlow cannot change itself. Never shows a success or verified status. */
export function ManualBookingNotice({ task, manual }: { task: CustomerTask; manual: NonNullable<ManualBookingChange> }) {
  const kind = changeKind([task.title, task.sourceText, ...task.items.map(item => item.title)].join(" \n "));
  const l27 = manual.source === "launch27";
  return <section className="cbc-manual" role="status" aria-label="Manual action required">
    <p className="cbc-manual-title"><AlertTriangle aria-hidden="true" />{manualBookingStatus(manual).text}</p>
    <p className="cbc-manual-text">The {kind} has <strong>NOT</strong> been made automatically. {l27
      ? "Make the change in Launch27, then close this task."
      : manual.source === "both" ? `This customer has bookings in Launch27 and LeadFlow. A Launch27 booking must be changed by hand in Launch27${"call" in task || "email" in task ? "" : "; a LeadFlow booking can be changed below"}.`
      : "LeadFlow could not confirm where this booking is. Check Launch27 and make the change by hand, then close this task."}</p>
    {manual.launch27BookingIds.map(id => <a key={id} className="cbc-manual-link" href={launch27BookingUrl(id)} target="_blank" rel="noopener noreferrer">
      <ExternalLink aria-hidden="true" />Open booking {id} in Launch27</a>)}
    {!manual.launch27BookingIds.length && <p className="cbc-muted">No Launch27 booking link was found. Search for the customer in Launch27.</p>}
  </section>;
}

type StatusTone = "pending" | "done" | "warning";
/** One short line for the collapsed card (null when there is no booking change). */
export function bookingChangeStatus(view: BookingActionView | null): { tone: StatusTone; text: string } | null {
  if (!view) return null;
  const { record, assessment } = view;
  const confirmation = record.confirmation;
  if (record.status === "proposed") return assessment && !assessment.executable ? { tone: "warning", text: "Booking change needs review" } : { tone: "pending", text: "Awaiting approval" };
  if (record.status === "executed" || record.status === "verification_failed") return { tone: "warning", text: "Changed · not verified yet" };
  if (record.status === "verified") {
    if (confirmation?.status === "uncertain") return { tone: "warning", text: "Confirmation may have been sent" };
    if (confirmation?.status === "sending") return { tone: "pending", text: "Verified · Sending confirmation" };
    return { tone: "done", text: "Verified · Confirmation pending" };
  }
  return { tone: "done", text: `Verified · ${confirmation?.status === "sent" ? "Confirmation sent" : "No confirmation needed"}` };
}
/** Booking-change history for the card's Activity history. */
export function bookingChangeHistory(record: BookingActionRecord | null | undefined): Array<{ at: number; text: string }> {
  return (record?.history ?? []).map(entry => ({ at: entry.at,
    text: `Booking change ${entry.action.replace(/_/g, " ")}${entry.actor ? ` · ${entry.actor.name}` : ""}${entry.note ? ` · ${entry.note}` : ""}` }));
}

function Appointment({ before, after, cancelled, windowKept, label, compact = false }: {
  before: { date: string; time: string | null; window: { start: string; end: string } | null } | null;
  after: { date: string; time: string | null; window: { start: string; end: string } | null } | null;
  cancelled: boolean; windowKept: boolean; label: boolean; compact?: boolean;
}) {
  const beforeText = before ? `${shortDate(before.date)}${before.window ? ` · ${formatArrivalWindow(before.window)}` : before.time ? ` · ${shortTime(before.time)}` : ""}` : null;
  if (compact) return <div className="cbc-appointment cbc-appointment-compact">
    {beforeText && <s className="cbc-before">{beforeText}</s>}
    {cancelled ? <strong className="cbc-cancelled">Cancelled</strong> : after && <strong className="cbc-after-compact">{shortDate(after.date)}
      {after.window ? ` · ${formatArrivalWindow(after.window)}` : after.time ? ` · ${shortTime(after.time)}` : ""}</strong>}
  </div>;
  return <div className="cbc-appointment">
    {label && <span className="cbc-caption">{cancelled ? "Appointment" : "Current appointment"}</span>}
    {beforeText && <s className="cbc-before">{beforeText}</s>}
    {cancelled ? <strong className="cbc-cancelled">Cancelled</strong> : after && <>
      {label && <><ArrowDown className="cbc-arrow" aria-hidden="true" /><span className="cbc-caption">New appointment</span></>}
      <strong className="cbc-after">{shortDate(after.date)}</strong>
      {timeOrWindow(after.time, after.window) && <span className="cbc-time">{timeOrWindow(after.time, after.window)}</span>}
      {windowKept && <span className="cbc-muted">Arrival window preserved</span>}
    </>}
  </div>;
}

/** The expanded booking-change section of an SMS task card (null for other tasks). */
export function ClaudeBookingChangePanel({ task, manual = null }: { task: CustomerTask; manual?: ManualBookingChange }) {
  const { sms, hasRecord, versions, view, data } = useBookingChange(task);
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [confirmationText, setConfirmationText] = useState<string | null>(null);
  const setup = trpc.claudeCustomerTasks.setupBookingAction.useMutation();
  const edit = trpc.claudeCustomerTasks.editBookingAction.useMutation();
  const dismiss = trpc.claudeCustomerTasks.dismissBookingAction.useMutation();
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
      // Refresh only what this card's step can change: the booking-change fingerprints (a changed one reloads this
      // card's details) and the task list.
      try {
        await Promise.all([utils.claudeCustomerTasks.bookingActionVersions.invalidate(), utils.claudeCustomerTasks.list.invalidate()]);
      } catch { /* the next refresh picks it up */ }
    }
  };
  const feedback = error ? <p className="cct-feedback" role="alert">{error}</p> : null;

  if (versions.isLoading || (hasRecord && view.isLoading)) return <p className="cbc-loading"><Loader2 aria-hidden="true" />Loading booking change…</p>;
  if (!data) {
    // Launch27 or unclear booking: the card shows "Manual action required" instead of the native setup.
    if ((manual && manual.source !== "both") || task.status === "done" || versions.isError || (hasRecord && view.isError)) return null;
    return editing
      ? <BookingRequestForm task={task} busy={busy} error={error} onCancel={() => { setEditing(false); setError(""); }}
          onSave={(request, itemId) => void run(async () => { await setup.mutateAsync({ id: task.id, request, itemId }); setEditing(false); })} />
      : <button type="button" className="cbc-setup-link" disabled={busy} onClick={() => { setError(""); setEditing(true); }}><CalendarClock aria-hidden="true" />Set up booking change</button>;
  }

  const { record, assessment } = data;
  const reschedule = record.request.type === "reschedule_visit";

  if (record.status === "proposed") {
    if (editing) return <BookingRequestForm task={task} initial={record.request} busy={busy} error={error} onCancel={() => { setEditing(false); setError(""); }}
      onSave={request => void run(async () => { await edit.mutateAsync({ id: task.id, revision: record.revision, request }); setEditing(false); })} />;
    const visit = assessment?.visit ?? null;
    const executable = Boolean(data.enabled && assessment?.executable && visit);
    const window = visit?.arrivalWindow ?? null;
    return <section className="cbc-section" aria-label="Booking change">
      {executable ? <p className="cbc-status cbc-status-pending"><Clock3 aria-hidden="true" />Awaiting approval</p>
        : <p className="cbc-status cbc-status-warning"><AlertTriangle aria-hidden="true" />Needs manual handling</p>}
      <div className="cct-block"><h5>Customer request</h5><p className="cct-verbatim cct-request">{task.sourceText}</p></div>
      <Appointment label cancelled={!reschedule} windowKept={reschedule && Boolean(window)}
        before={visit ? { date: visit.date, time: visit.time, window } : { date: record.request.visitDate, time: null, window: null }}
        after={reschedule && record.request.newDate ? { date: record.request.newDate, time: assessment?.effectiveNewTime ?? null, window } : null} />
      {reschedule && !record.request.newDate && <p className="cbc-note">New date not chosen yet.</p>}
      {(assessment?.manualReasons ?? []).map(reason => <p key={reason} className="cbc-note cbc-warning-text">{reason}</p>)}
      {(assessment?.warnings ?? []).filter(warning => !/team availability/i.test(warning)).map(warning => <p key={warning} className="cbc-note">{warning}</p>)}
      {executable && <p className="cbc-muted">Only this appointment will change.</p>}
      {(!manual || manual.source === "both") && <button type="button" className="cbc-primary" disabled={busy || !executable} title={!data.enabled ? "Booking changes are switched off" : undefined}
        onClick={() => { if (!executable || !visit) return; void run(() => execute.mutateAsync({ id: task.id, revision: record.revision, jobId: visit.jobId, availabilityConfirmed: true })); }}>
        {busy ? <><Loader2 aria-hidden="true" />{reschedule ? "Rescheduling…" : "Cancelling…"}</> : reschedule ? "Approve & reschedule" : "Approve & cancel"}</button>}
      <div className="cbc-links">
        <button type="button" className="cbc-link" disabled={busy} onClick={() => { setError(""); setEditing(true); }}><Pencil aria-hidden="true" />Edit change</button>
        <button type="button" className="cbc-link cbc-link-muted" disabled={busy} onClick={() => void run(() => dismiss.mutateAsync({ id: task.id, revision: record.revision }))}>Dismiss proposal</button>
      </div>
      {feedback}
    </section>;
  }

  const execution = record.execution!;
  const before = { date: execution.previous.date, time: execution.expected.arrivalWindow ? null : execution.previous.time, window: null };
  const after = execution.expected.cancelled || !execution.expected.date ? null
    : { date: execution.expected.date, time: execution.expected.time, window: execution.expected.arrivalWindow };
  const result = <Appointment label={false} cancelled={execution.expected.cancelled} windowKept={Boolean(execution.expected.arrivalWindow)} before={before} after={after} />;

  if (record.status === "executed" || record.status === "verification_failed") {
    return <section className="cbc-section" aria-label="Booking change">
      <p className="cbc-status cbc-status-warning"><AlertTriangle aria-hidden="true" />{reschedule ? "Rescheduled" : "Cancelled"} · not verified yet</p>
      {result}
      <p className="cbc-muted">The change was saved and will not be made again. Verify it before sending a confirmation.</p>
      {record.verification && <p className="cbc-note">{record.verification.explanation}</p>}
      <button type="button" className="cbc-secondary" disabled={busy} onClick={() => void run(() => verify.mutateAsync({ id: task.id }))}>
        {busy ? <><Loader2 aria-hidden="true" />Checking…</> : <><RefreshCw aria-hidden="true" />Verify again</>}</button>
      {feedback}
    </section>;
  }

  const confirmation = record.confirmation;
  if (record.status === "verified" && confirmation) {
    const text = confirmationText ?? confirmation.text;
    const sendConfirmation = () => void run(() => sendBookingConfirmation({
      begin: () => begin.mutateAsync({ id: task.id, text }),
      send: reserved => send.mutateAsync({ sessionId: reserved.sessionId, message: reserved.text }),
      finish: outcome => finish.mutateAsync({ id: task.id, outcome }),
    }));
    return <section className="cbc-section" aria-label="Booking change">
      <p className="cbc-status cbc-status-done"><CheckCircle2 aria-hidden="true" />{reschedule ? "Rescheduled" : "Cancelled"} &amp; verified</p>
      {result}
      <div className="cbc-divider" />
      <h5 className="cbc-heading">Customer confirmation</h5>
      {confirmation.status === "ready" && <>
        <textarea aria-label="Confirmation to the customer" value={text} disabled={busy} maxLength={1600} onChange={event => setConfirmationText(event.target.value)} />
        <button type="button" className="cbc-primary" disabled={busy || !text.trim()} onClick={sendConfirmation}>
          {busy ? <><Loader2 aria-hidden="true" />Sending…</> : <><Send aria-hidden="true" />Send confirmation</>}</button>
        <button type="button" className="cbc-link cbc-link-muted cbc-center" disabled={busy} onClick={() => void run(() => finish.mutateAsync({ id: task.id, outcome: "skipped" }))}>No confirmation needed</button>
      </>}
      {confirmation.status === "sending" && <p className="cbc-loading"><Loader2 aria-hidden="true" />Sending the confirmation…</p>}
      {confirmation.status === "uncertain" && <>
        <p className="cbc-note cbc-warning-text">The confirmation may have been sent. Check the conversation before choosing.</p>
        <div className="cbc-pair">
          <button type="button" className="cbc-secondary" disabled={busy} onClick={() => void run(() => finish.mutateAsync({ id: task.id, outcome: "mark_not_sent" }))}>It was not sent</button>
          <button type="button" className="cbc-primary" disabled={busy} onClick={() => void run(() => finish.mutateAsync({ id: task.id, outcome: "mark_sent" }))}>It was sent</button>
        </div>
      </>}
      {feedback}
    </section>;
  }

  return <section className="cbc-section" aria-label="Booking change">
    <Appointment label={false} compact cancelled={execution.expected.cancelled} windowKept={false} before={before} after={after} />
    <p className="cbc-status cbc-status-done"><CheckCircle2 aria-hidden="true" />Verified · {confirmation?.status === "sent" ? "Confirmation sent" : "No confirmation needed"}</p>
  </section>;
}

const TIMES = Array.from({ length: 25 }, (_, index) => `${String(7 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);
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
  const times = newTime && !TIMES.includes(newTime) ? [newTime, ...TIMES] : TIMES;
  const empty = !visits.isLoading && !visits.isError && options.length === 0;
  return <section className="cbc-section cbc-form" aria-label="Booking change details">
    <h5 className="cbc-heading">{initial ? "Edit booking change" : "Booking change"}</h5>
    {visits.isLoading ? <p className="cbc-loading"><Loader2 aria-hidden="true" />Loading bookings…</p>
      : visits.isError ? <p className="cct-feedback" role="alert">Bookings could not be loaded. Close and try again.</p>
      : empty ? <p className="cbc-empty">No upcoming native bookings for this customer. Handle this request manually.</p>
      : <>
        <div className="cbc-segment" role="group" aria-label="Change">
          <button type="button" aria-pressed={reschedule} disabled={busy} onClick={() => setType("reschedule_visit")}>Reschedule</button>
          <button type="button" aria-pressed={!reschedule} disabled={busy} onClick={() => setType("cancel_visit")}>Cancel</button>
        </div>
        <label className="cbc-label">Current appointment<select value={chosen ? String(chosen.jobId) : ""} disabled={busy}
          onChange={event => { const visit = options.find(option => option.jobId === Number(event.target.value)); setJobId(visit?.jobId ?? null); setVisitDate(visit?.date ?? ""); }}>
          <option value="">Choose an appointment</option>
          {options.map(visit => <option key={visit.jobId} value={visit.jobId}>{visitOption(visit)}</option>)}</select></label>
        {reschedule && <>
          <label className="cbc-label">New date<input type="date" value={newDate} disabled={busy} onChange={event => setNewDate(event.target.value)} /></label>
          <label className="cbc-label">New time{chosen?.arrivalWindow
            ? <select disabled value="window"><option value="window">Keeps the {formatArrivalWindow(chosen.arrivalWindow)} window</option></select>
            : <select value={newTime} disabled={busy} onChange={event => setNewTime(event.target.value)}>
                <option value="">Keep existing time</option>
                {times.map(time => <option key={time} value={time}>{formatBookingTime(time)}</option>)}</select>}</label>
        </>}
        {!initial && task.items.length > 1 && <label className="cbc-label">Linked checklist item<select value={itemId ?? ""} disabled={busy}
          onChange={event => setItemId(event.target.value || null)}><option value="">None</option>{task.items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
        <button type="button" className="cbc-primary" disabled={busy || !valid} onClick={() => onSave({ type, visitDate, jobId: chosen?.jobId ?? jobId,
          newDate: reschedule ? newDate || null : null, newTime: reschedule && !chosen?.arrivalWindow ? newTime || null : null,
          evidenceQuote: initial?.evidenceQuote ?? null }, itemId)}>{busy ? <><Loader2 aria-hidden="true" />Saving…</> : "Save booking change"}</button>
      </>}
    <button type="button" className="cbc-link cbc-link-muted cbc-center" disabled={busy} onClick={onCancel}>Cancel setup</button>
    {error && <p className="cct-feedback" role="alert">{error}</p>}
  </section>;
}
