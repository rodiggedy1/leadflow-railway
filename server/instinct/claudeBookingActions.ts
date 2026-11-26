/**
 * Phase 1 booking changes on Claude customer SMS tasks: reschedule one native visit, or cancel a one-time native
 * booking. Staff approve; LeadFlow executes with the EXISTING booking functions inside one transaction together with
 * the action's own record; LeadFlow then verifies the stored state (Instinct verifier first, exact re-read fallback);
 * staff send or skip the confirmation; only then does the task close. Nothing here charges, refunds, releases a
 * hold, sends a message or contacts anyone. Launch27 visits are never touched.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  bookingCashAppPayments, bookingPaymentProfiles, bookings, cleanerPortalJobProgress, leadflowJobs,
  opsChatMessages, paymentAuthorizations,
} from "../../drizzle/schema";
import {
  BOOKING_ACTION_CHANNEL, BOOKING_ACTION_QUICK_ACTION, CLAUDE_BOOKING_ACTIONS_ENABLED, bookingActionKey,
  bookingActionRecordSchema, bookingActionRequestSchema, bookingConfirmationText, formatArrivalWindow, formatBookingDate,
  formatBookingTime, modelBookingActionSchema,
  type BookingActionAssessment, type BookingActionRecord, type BookingActionRequest, type BookingActionView,
  type BookingActionVisit,
} from "../../shared/claudeBookingActions";
import { getPublicBookingArrivalPreference } from "../../shared/publicBookingPricing";
import { isCustomerPortalRescheduleWithin24Hours } from "../../shared/customerPortalScheduleRequest";
import { CLAUDE_CUSTOMER_TASK_ACTION, type CustomerTask, type TaskActor } from "../../shared/claudeCustomerTasks";
import { authorizedScopeSchema, type ExtractionAction, type VerifiedIdentity } from "../../shared/instinct";
import { cancelCanonicalBookingInTransaction } from "../bookingCancellationService";
import { NATIVE_BOOKING_OPERATIONAL_ORIGIN } from "../bookingLifecycleService";
import { operationalBookingLocalTime, rescheduleOperationalBooking } from "../bookingRescheduleService";
import type { getDb } from "../db";
import { getEasternBusinessDate } from "../leadflowJobsService";
import { businessLocalDateTimeToUtcMs } from "../utils/businessTime";
import { normalizePhone } from "../utils/phone";
import { createClaudeCustomerTaskPersistence } from "./claudeCustomerTasksStore";
import { createNativeRecordReader } from "./nativeRecords";
import { createLazyReadDb, type ReadDb } from "./readDb";
import { resolveInstinctInstallation } from "./service";
import { createRequestVerifier } from "./verify";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type BookingActionDb = Db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Q = Db | Tx;
type BookingRow = typeof bookings.$inferSelect;
type JobRow = typeof leadflowJobs.$inferSelect;

export type BookingActionErrorCode = "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "PRECONDITION_FAILED";
export class BookingActionError extends Error {
  constructor(readonly code: BookingActionErrorCode, message: string) { super(message); this.name = "BookingActionError"; }
}
const fail = (code: BookingActionErrorCode, message: string): never => { throw new BookingActionError(code, message); };

const TIME_ZONE = "America/New_York";
const INACTIVE_JOB = new Set(["completed", "cancelled", "canceled", "rescheduled", "missing_from_launch27"]);
const CLOSED_BOOKING = new Set(["cancelled", "canceled", "completed", "expired"]);
const NOT_STARTED_PROGRESS = new Set(["assigned", "new", "not_started"]);
/** Cancellation only when no money has moved and no hold exists; everything else is a staff payment decision. */
const PAYMENT_SAFE_FOR_CANCEL = new Set(["not_started", "card_on_file"]);
const ACTIVE_HOLD = ["authorized", "pending_card"];
const INACTIVE_CASH_APP = new Set(["failed", "cancelled", "canceled"]);
const SENDING_STALE_MS = 2 * 60_000;
// Created on first use: the task store also imports this module (it attaches proposals at task creation).
let persistenceInstance: ReturnType<typeof createClaudeCustomerTaskPersistence> | undefined;
const persistence = () => (persistenceInstance ??= createClaudeCustomerTaskPersistence());

const rowsOf = (result: unknown): Array<Record<string, any>> => {
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first) ? first as Array<Record<string, any>> : [];
};
const affected = (result: unknown): number => {
  const header = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
  return Number(header?.affectedRows ?? 0);
};
const decode = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
};
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// ───────────────────────── action record (private row, one per task) ─────────────────────────
async function lockRecord(tx: Tx, taskId: number): Promise<{ rowId: number; record: BookingActionRecord } | null> {
  const [row] = rowsOf(await tx.execute(sqlSelectRecord(taskId, true)));
  return row ? parseRow(row, taskId) : null;
}
async function readRecord(q: Q, taskId: number): Promise<{ rowId: number; record: BookingActionRecord } | null> {
  const [row] = rowsOf(await q.execute(sqlSelectRecord(taskId, false)));
  return row ? parseRow(row, taskId) : null;
}
function sqlSelectRecord(taskId: number, forUpdate: boolean) {
  // Unique activeDedupKey index: this locks exactly one row.
  return forUpdate
    ? sql`SELECT * FROM ops_chat_messages WHERE activeDedupKey = ${bookingActionKey(taskId)} FOR UPDATE`
    : sql`SELECT * FROM ops_chat_messages WHERE activeDedupKey = ${bookingActionKey(taskId)}`;
}
function parseRow(row: Record<string, any>, taskId: number): { rowId: number; record: BookingActionRecord } {
  if (row.channel !== BOOKING_ACTION_CHANNEL || row.quickAction !== BOOKING_ACTION_QUICK_ACTION)
    return fail("CONFLICT", "The booking change record is invalid.");
  const parsed = bookingActionRecordSchema.safeParse(decode(row.metadata));
  if (!parsed.success || parsed.data.taskId !== taskId) return fail("CONFLICT", "The booking change record is invalid.");
  return { rowId: Number(row.id), record: parsed.data };
}
async function saveRecord(tx: Tx, rowId: number, record: BookingActionRecord): Promise<void> {
  const value = bookingActionRecordSchema.parse(record);
  const changed = affected(await tx.execute(sql`UPDATE ops_chat_messages SET metadata = ${JSON.stringify(value)}, lastActivityAt = ${Date.now()}
    WHERE id = ${rowId} AND activeDedupKey = ${bookingActionKey(record.taskId)} AND channel = ${BOOKING_ACTION_CHANNEL}`));
  if (changed !== 1) fail("CONFLICT", "The booking change record could not be saved.");
}
async function insertRecord(tx: Tx, record: BookingActionRecord): Promise<void> {
  const value = bookingActionRecordSchema.parse(record);
  await tx.insert(opsChatMessages).values({
    channel: BOOKING_ACTION_CHANNEL, quickAction: BOOKING_ACTION_QUICK_ACTION, authorName: "Instinct", authorRole: "system",
    body: "Booking change proposal", activeDedupKey: bookingActionKey(record.taskId), cardStatus: "active",
    metadata: JSON.stringify(value), lastActivityAt: Date.now(),
  });
}

// ───────────────────────── tasks (existing persistence; only existing task semantics are used) ─────────────────────────
function isSmsTask(task: CustomerTask): boolean {
  return !("email" in task) && !("call" in task) && typeof task.sessionId === "number" && typeof task.customerPhone === "string";
}
async function lockTask(tx: Tx, taskId: number): Promise<CustomerTask> {
  return persistence().parseTask(await persistence().taskRow(tx, taskId));
}
async function readTask(q: Q, taskId: number): Promise<CustomerTask> {
  const [row] = rowsOf(await q.execute(sql`SELECT * FROM ops_chat_messages WHERE id = ${taskId} AND quickAction = ${CLAUDE_CUSTOMER_TASK_ACTION}`));
  if (!row) return fail("NOT_FOUND", "Customer task not found.");
  return persistence().parseTask(row);
}

/** Called inside the task-creation transaction. Never throws: an unusable proposal simply leaves a manual task. */
export async function attachProposedBookingAction(tx: Tx, task: { id: number; items: Array<{ id: string; evidenceQuote: string }> },
  raw: unknown, inboundText: string): Promise<boolean> {
  if (raw === undefined || raw === null) return false;
  try {
    const proposal = modelBookingActionSchema.safeParse(raw);
    if (!proposal.success || !inboundText.includes(proposal.data.evidenceQuote)) return false;
    const p = proposal.data;
    const matching = task.items.find(item => item.evidenceQuote === p.evidenceQuote);
    const now = Date.now();
    await insertRecord(tx, {
      version: 1, taskId: task.id, source: "claude", itemId: matching?.id ?? (task.items.length === 1 ? task.items[0].id : null),
      request: { type: p.type, visitDate: p.visitDate, jobId: null, newDate: p.type === "reschedule_visit" ? p.newDate : null,
        newTime: p.type === "reschedule_visit" ? p.newTime : null, evidenceQuote: p.evidenceQuote },
      revision: 1, status: "proposed", execution: null, verification: null, confirmation: null,
      history: [{ action: "proposed", actor: null, at: now, note: "Proposed by Claude" }],
    });
    return true;
  } catch (error) {
    console.warn("[ClaudeBookingAction] proposal not attached:", error instanceof Error ? error.message : "unknown");
    return false;
  }
}

// ───────────────────────── visits and the fresh assessment ─────────────────────────
interface Resolved {
  booking: BookingRow; job: JobRow; canonicalVisit: boolean; previousTime: string;
  arrivalWindow: { start: string; end: string; label: string } | null;
}
function windowOf(booking: BookingRow): Resolved["arrivalWindow"] {
  const preference = getPublicBookingArrivalPreference(booking.priceSnapshot);
  if (!preference) return null;
  const label = preference.mode === "flexible" ? "flexible" : preference.mode === "preferred" ? (preference.period ?? "preferred") : "exact window";
  return { start: preference.startLocalTime, end: preference.endLocalTime, label };
}
function visitOf(booking: BookingRow, job: JobRow): BookingActionVisit {
  const window = windowOf(booking);
  return { jobId: job.id, bookingId: booking.id, publicBookingNumber: booking.publicBookingNumber, date: job.jobDate,
    time: operationalBookingLocalTime(job.serviceDateTime, booking.requestedTimeZone || TIME_ZONE),
    arrivalWindow: window, serviceName: job.serviceName ?? booking.serviceName, address: job.jobAddress ?? booking.address,
    teamName: job.teamName, recurrence: booking.recurrence, canonicalVisit: job.jobDate === booking.requestedLocalDate };
}
const jobActive = (job: JobRow) => !INACTIVE_JOB.has(job.bookingStatus.trim().toLowerCase());

/** This customer's native bookings and their operational visits (Launch27 visits are excluded by bookingId/origin). */
async function customerRecords(q: Q, phone: string, forUpdate: boolean): Promise<{ bookings: BookingRow[]; jobs: JobRow[] }> {
  const bookingQuery = q.select().from(bookings).where(eq(bookings.customerPhone, phone));
  const bookingRows = forUpdate ? await bookingQuery.for("update") : await bookingQuery;
  if (!bookingRows.length) return { bookings: [], jobs: [] };
  const jobQuery = q.select().from(leadflowJobs).where(and(inArray(leadflowJobs.bookingId, bookingRows.map(row => row.id)),
    eq(leadflowJobs.origin, NATIVE_BOOKING_OPERATIONAL_ORIGIN)));
  const jobRows = forUpdate ? await jobQuery.for("update") : await jobQuery;
  return { bookings: bookingRows, jobs: jobRows };
}
export async function upcomingVisits(q: Q, phone: string, today = getEasternBusinessDate()): Promise<BookingActionVisit[]> {
  const { bookings: bookingRows, jobs } = await customerRecords(q, phone, false);
  const byId = new Map(bookingRows.map(row => [row.id, row]));
  return jobs.filter(job => jobActive(job) && job.jobDate >= today && !CLOSED_BOOKING.has((byId.get(job.bookingId!)?.status ?? "").toLowerCase()))
    .sort((a, b) => a.jobDate.localeCompare(b.jobDate) || (a.serviceDateTime ?? "").localeCompare(b.serviceDateTime ?? "") || a.id - b.id)
    .slice(0, 20).map(job => visitOf(byId.get(job.bookingId!)!, job));
}

/** Upcoming native visits for a task's customer (staff "Set up booking change" choices). */
export async function taskUpcomingVisits(db: Db, taskId: number): Promise<BookingActionVisit[]> {
  const task = await readTask(db, taskId);
  const phone = isSmsTask(task) ? normalizePhone(task.customerPhone) : null;
  return phone ? upcomingVisits(db, phone) : [];
}

interface AssessmentResult { assessment: BookingActionAssessment; resolved: Resolved | null; newTime: string | null }
export async function assessBookingAction(q: Q, task: CustomerTask, request: BookingActionRequest,
  options: { forUpdate?: boolean; now?: Date } = {}): Promise<AssessmentResult> {
  const now = options.now ?? new Date(), today = getEasternBusinessDate(now);
  const manual: string[] = [], warnings: string[] = [];
  const done = (resolved: Resolved | null, newTime: string | null = null, paymentStatus: string | null = null): AssessmentResult => ({
    assessment: { executable: manual.length === 0, manualReasons: manual, warnings,
      visit: resolved ? visitOf(resolved.booking, resolved.job) : null, paymentStatus,
      effectiveNewTime: newTime, requiresAvailabilityConfirmation: request.type === "reschedule_visit" },
    resolved, newTime });
  if (!CLAUDE_BOOKING_ACTIONS_ENABLED) manual.push("Booking changes are switched off. Handle this task manually.");
  if (!isSmsTask(task)) { manual.push("Booking changes are available on SMS tasks only."); return done(null); }
  if (task.status === "done") manual.push("This task is already done.");
  const phone = normalizePhone(task.customerPhone);
  if (!phone) { manual.push("This task has no usable customer phone number."); return done(null); }
  const { bookings: bookingRows, jobs } = await customerRecords(q, phone, options.forUpdate === true);
  if (!bookingRows.length) { manual.push("No LeadFlow booking was found for this customer's phone number."); return done(null); }
  const byId = new Map(bookingRows.map(row => [row.id, row]));
  const candidates = request.jobId !== null ? jobs.filter(job => job.id === request.jobId)
    : jobs.filter(job => job.jobDate === request.visitDate && jobActive(job));
  if (candidates.length === 0) {
    const unscheduled = bookingRows.some(row => row.requestedLocalDate === request.visitDate && !CLOSED_BOOKING.has(row.status.toLowerCase())
      && !jobs.some(job => job.bookingId === row.id));
    manual.push(unscheduled
      ? "This booking has no scheduled visit record yet (no team assigned). Handle it manually."
      : `No native booking visit was found on ${formatBookingDate(request.visitDate)} for this customer. Choose the visit, or handle it manually.`);
    return done(null);
  }
  if (candidates.length > 1) { manual.push("More than one visit matches that date. Choose the exact visit."); return done(null); }
  const job = candidates[0], booking = byId.get(job.bookingId!)!;
  const previousTime = operationalBookingLocalTime(job.serviceDateTime, booking.requestedTimeZone || TIME_ZONE);
  const arrivalWindow = windowOf(booking);
  const resolved: Resolved | null = previousTime ? { booking, job, canonicalVisit: job.jobDate === booking.requestedLocalDate, previousTime, arrivalWindow } : null;
  if (!jobActive(job)) manual.push(`That visit is already ${job.bookingStatus}.`);
  if (CLOSED_BOOKING.has(booking.status.toLowerCase())) manual.push(`The booking is ${booking.status}.`);
  if (job.jobDate < today) manual.push("That visit is in the past.");
  if (!previousTime) manual.push("The visit's current time is unavailable.");
  const [progress] = await q.select({ jobStatus: cleanerPortalJobProgress.jobStatus, startedAt: cleanerPortalJobProgress.startedAt })
    .from(cleanerPortalJobProgress).where(eq(cleanerPortalJobProgress.leadflowJobId, job.id)).limit(1);
  if (progress && (progress.startedAt !== null || !NOT_STARTED_PROGRESS.has(progress.jobStatus))) manual.push("The cleaners have already started this visit.");
  if (arrivalWindow && previousTime && previousTime !== arrivalWindow.start) manual.push("The visit time and its arrival window disagree. Handle it manually.");
  const late = isCustomerPortalRescheduleWithin24Hours({ scheduledAt: job.serviceDateTime, scheduledDate: job.jobDate, now });
  if (request.type === "reschedule_visit") {
    let newTime: string | null = null;
    if (!request.newDate) manual.push("Choose the new date.");
    else if (request.newDate < today) manual.push("The new date is in the past.");
    if (arrivalWindow) {
      if (request.newTime && request.newTime !== arrivalWindow.start) manual.push("Changing the arrival window isn't supported yet. Handle it manually.");
      newTime = arrivalWindow.start;
      warnings.push(`Keeps the booking's ${arrivalWindow.label} arrival window (${formatArrivalWindow(arrivalWindow)}).`);
    } else {
      newTime = request.newTime ?? previousTime;
      if (!request.newTime && previousTime) warnings.push(`The customer didn't state a time. Keeping ${formatBookingTime(previousTime)}.`);
    }
    if (!newTime) manual.push("Choose the new time.");
    if (request.newDate && newTime && request.newDate === job.jobDate && newTime === previousTime) manual.push("The visit is already on that date and time.");
    if (request.newDate && newTime) {
      try { businessLocalDateTimeToUtcMs(request.newDate, newTime, booking.requestedTimeZone || TIME_ZONE); }
      catch { manual.push("The new date and time are not a valid local time."); }
    }
    if (late) warnings.push("Within 24 hours of the visit: the $70 late-reschedule fee may apply. Staff decide; nothing is charged.");
    warnings.push("LeadFlow can't check team availability. Confirm it before executing.");
    return done(resolved, newTime, booking.paymentStatus);
  }
  // Cancel: one-time bookings only (the visit is the whole booking), and only when no money has moved.
  if (booking.recurrence !== "one-time") manual.push("Cancelling one visit of a recurring booking isn't supported yet. Handle it manually.");
  if (jobs.some(other => other.bookingId === booking.id && other.id !== job.id && jobActive(other))) manual.push("This booking has more than one active visit. Handle it manually.");
  if (!PAYMENT_SAFE_FOR_CANCEL.has(booking.paymentStatus)) manual.push(`Payment status is "${booking.paymentStatus}". Staff must handle the payment side, so cancel it manually.`);
  const [profile] = await q.select({ id: bookingPaymentProfiles.id }).from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, booking.id)).limit(1);
  if (profile) {
    const holds = await q.select({ id: paymentAuthorizations.id }).from(paymentAuthorizations)
      .where(and(eq(paymentAuthorizations.bookingPaymentProfileId, profile.id), inArray(paymentAuthorizations.status, ACTIVE_HOLD))).limit(1);
    if (holds.length) manual.push("A card hold exists on this booking. Staff decide whether to release it, so cancel it manually.");
  }
  const cashApp = await q.select({ status: bookingCashAppPayments.status }).from(bookingCashAppPayments).where(eq(bookingCashAppPayments.bookingId, booking.id));
  if (cashApp.some(row => !INACTIVE_CASH_APP.has(row.status.toLowerCase()))) manual.push("A Cash App payment exists on this booking. Staff must handle it, so cancel it manually.");
  if (late) warnings.push("Within 24 hours of the visit: any late-cancellation fee is a staff decision. Nothing is charged.");
  return done(resolved, null, booking.paymentStatus);
}

// ───────────────────────── staff: set up / edit / view ─────────────────────────
export async function setupBookingAction(db: Db, taskId: number, input: { request: BookingActionRequest; itemId: string | null }, actor: TaskActor): Promise<BookingActionRecord> {
  const request = bookingActionRequestSchema.parse(normalizeRequest(input.request));
  return db.transaction(async tx => {
    const task = await lockTask(tx, taskId);
    if (!isSmsTask(task)) fail("PRECONDITION_FAILED", "Booking changes are available on SMS tasks only.");
    if (task.status === "done") fail("PRECONDITION_FAILED", "This task is already done.");
    if (input.itemId !== null && !task.items.some(item => item.id === input.itemId)) fail("NOT_FOUND", "Checklist item not found.");
    if (await lockRecord(tx, taskId)) fail("CONFLICT", "This task already has a booking change. Refresh it.");
    const record: BookingActionRecord = { version: 1, taskId, source: "staff", itemId: input.itemId ?? (task.items.length === 1 ? task.items[0].id : null),
      request, revision: 1, status: "proposed", execution: null, verification: null, confirmation: null,
      history: [{ action: "set_up", actor, at: Date.now(), note: summary(request) }] };
    await insertRecord(tx, record);
    return record;
  });
}
export async function editBookingAction(db: Db, taskId: number, input: { revision: number; request: BookingActionRequest }, actor: TaskActor): Promise<BookingActionRecord> {
  const request = bookingActionRequestSchema.parse(normalizeRequest(input.request));
  return db.transaction(async tx => {
    const current = await lockRecord(tx, taskId) ?? fail("NOT_FOUND", "Booking change not found.");
    const { rowId, record } = current;
    if (record.status !== "proposed") fail("CONFLICT", "This booking change was already executed. It can't be edited.");
    if (record.revision !== input.revision) fail("CONFLICT", "This booking change was edited by someone else. Refresh it.");
    const next: BookingActionRecord = { ...record, request, revision: record.revision + 1,
      history: [...record.history, { action: "edited", actor, at: Date.now(), note: summary(request) }] };
    await saveRecord(tx, rowId, next);
    return next;
  });
}
function normalizeRequest(request: BookingActionRequest): BookingActionRequest {
  return request.type === "cancel_visit" ? { ...request, newDate: null, newTime: null } : request;
}
function summary(request: BookingActionRequest): string {
  const visit = `visit ${request.visitDate}${request.jobId ? ` (visit #${request.jobId})` : ""}`;
  return request.type === "cancel_visit" ? `Cancel ${visit}` : `Reschedule ${visit} to ${request.newDate ?? "?"} ${request.newTime ?? "(current time)"}`;
}

/** Which tasks have a booking-change record: ONE indexed query for the whole task list, so task cards without a
 * booking change make no request of their own. Newest first; bounded so it stays small as records accumulate. */
export const BOOKING_ACTION_TASK_IDS_LIMIT = 1000;
export async function bookingActionTaskIds(db: Db): Promise<number[]> {
  const rows = rowsOf(await db.execute(sql`SELECT activeDedupKey FROM ops_chat_messages
    WHERE channel = ${BOOKING_ACTION_CHANNEL} AND quickAction = ${BOOKING_ACTION_QUICK_ACTION} ORDER BY id DESC LIMIT ${BOOKING_ACTION_TASK_IDS_LIMIT}`));
  const prefix = bookingActionKey(0).slice(0, -1);
  const ids = rows.map(row => String(row.activeDedupKey ?? "")).filter(key => key.startsWith(prefix))
    .map(key => Number(key.slice(prefix.length))).filter(id => Number.isSafeInteger(id) && id > 0);
  return Array.from(new Set(ids));
}
export async function getBookingActionView(db: Db, taskId: number): Promise<BookingActionView | null> {
  const found = await readRecord(db, taskId);
  if (!found) return null;
  const task = await readTask(db, taskId);
  const phone = normalizePhone(task.customerPhone);
  const assessment = found.record.status === "proposed" ? (await assessBookingAction(db, task, found.record.request)).assessment : null;
  return { enabled: CLAUDE_BOOKING_ACTIONS_ENABLED, record: withStaleSending(found.record), assessment,
    visits: phone && found.record.status === "proposed" ? await upcomingVisits(db, phone) : [] };
}
/** A confirmation left "sending" (browser closed mid-send) is shown as uncertain: never offered for a blind resend. */
function withStaleSending(record: BookingActionRecord, now = Date.now()): BookingActionRecord {
  if (record.confirmation?.status !== "sending" || (record.confirmation.at ?? 0) > now - SENDING_STALE_MS) return record;
  return { ...record, confirmation: { ...record.confirmation, status: "uncertain" } };
}

// ───────────────────────── execute (exactly once) ─────────────────────────
/** One transaction: lock the action record, lock the task, re-assess with booking/visit rows locked, run the
 * existing booking function with the same transaction, and save "executed". A failure anywhere rolls back all of it.
 * A repeated click, retry or call after a restart finds "executed" (committed) and changes nothing. */
export async function executeBookingAction(db: Db, taskId: number,
  input: { revision: number; jobId: number; availabilityConfirmed: boolean }, actor: TaskActor,
  options: { now?: Date; updateCanonicalBookingDetails?: UpdateCanonical } = {}): Promise<{ record: BookingActionRecord; executedNow: boolean }> {
  const now = options.now ?? new Date();
  let result: { record: BookingActionRecord; executedNow: boolean };
  try {
    result = await db.transaction(async tx => {
      const current = await lockRecord(tx, taskId) ?? fail("NOT_FOUND", "Booking change not found.");
      const { rowId, record } = current;
      if (record.status !== "proposed") return { record, executedNow: false };
      if (record.revision !== input.revision) fail("CONFLICT", "This booking change was edited. Refresh and review it before executing.");
      const task = await lockTask(tx, taskId);
      const { assessment, resolved, newTime } = await assessBookingAction(tx, task, record.request, { forUpdate: true, now });
      if (!assessment.executable || !resolved) fail("PRECONDITION_FAILED", assessment.manualReasons.join(" ") || "This booking change can't be executed.");
      const { booking, job, canonicalVisit, previousTime, arrivalWindow } = resolved!;
      if (job.id !== input.jobId) fail("CONFLICT", "The visit for this booking change has changed. Refresh and review it.");
      const reschedule = record.request.type === "reschedule_visit";
      if (reschedule && !input.availabilityConfirmed) fail("PRECONDITION_FAILED", "Confirm team availability before executing.");
      if (reschedule) {
        const newDate = record.request.newDate!, time = newTime!;
        if (canonicalVisit) {
          const update = options.updateCanonicalBookingDetails ?? (await import("../bookingsRouter")).updateCanonicalBookingDetails;
          await update(tx, { bookingId: booking.id, requestedLocalDate: newDate, requestedLocalTime: time, rescheduleMode: "visit" });
        } else {
          await rescheduleOperationalBooking(tx, { jobId: job.id, previousLocalDate: job.jobDate, previousLocalTime: previousTime,
            requestedLocalDate: newDate, requestedLocalTime: time, requestedTimeZone: booking.requestedTimeZone || TIME_ZONE, mode: "visit" });
        }
      } else {
        const cancelled = await cancelCanonicalBookingInTransaction(tx, booking.id, now);
        if (!cancelled) fail("NOT_FOUND", "Booking not found.");
      }
      const at = now.getTime();
      const next: BookingActionRecord = { ...record, status: "executed",
        execution: { by: actor, at, bookingId: booking.id, jobId: job.id, publicBookingNumber: booking.publicBookingNumber, canonicalVisit,
          previous: { date: job.jobDate, time: previousTime },
          expected: reschedule ? { date: record.request.newDate!, time: newTime!, arrivalWindow: arrivalWindow ? { start: arrivalWindow.start, end: arrivalWindow.end, label: arrivalWindow.label } : null, cancelled: false }
            : { date: null, time: null, arrivalWindow: null, cancelled: true },
          availabilityConfirmed: reschedule ? input.availabilityConfirmed : false,
          lateRescheduleWarning: assessment.warnings.some(warning => warning.startsWith("Within 24 hours")) },
        history: [...record.history, { action: "executed", actor, at, note: reschedule
          ? `Moved booking ${booking.publicBookingNumber} visit ${job.jobDate} ${previousTime} → ${record.request.newDate} ${newTime}`
          : `Cancelled one-time booking ${booking.publicBookingNumber} (visit ${job.jobDate})` }] };
      if (task.status === "unclaimed") {
        task.owner = actor; task.status = "claimed"; task.claimedAt = at;
        task.activity.push({ action: "claimed", actor, at, note: "Claimed to execute the booking change." });
        await persistence().saveTask(tx, task);
      }
      await saveRecord(tx, rowId, next);
      return { record: next, executedNow: true };
    });
  } catch (error) {
    await recordFailure(db, taskId, actor, error);
    throw error;
  }
  if (result.executedNow) {
    try { (await import("../cleanerPortalUpdates")).broadcastCleanerPortalJobsChanged(); } catch { /* refresh only */ }
  }
  return result;
}
type UpdateCanonical = (tx: Tx, input: { bookingId: number; requestedLocalDate: string; requestedLocalTime: string; rescheduleMode: "visit" }) => Promise<unknown>;
async function recordFailure(db: Db, taskId: number, actor: TaskActor, error: unknown): Promise<void> {
  try {
    await db.transaction(async tx => {
      const current = await lockRecord(tx, taskId);
      if (!current || current.record.status !== "proposed") return;
      const message = error instanceof Error ? error.message.slice(0, 300) : "Execution failed.";
      await saveRecord(tx, current.rowId, { ...current.record,
        history: [...current.record.history, { action: "execution_failed" as const, actor, at: Date.now(), note: message }].slice(-50) });
    });
  } catch { /* the failure itself was already returned to staff; history is best effort */ }
}

// ───────────────────────── verify (repeatable; never re-executes) ─────────────────────────
interface Check { outcome: "verified" | "not_verified"; method: "instinct" | "direct_readback" | null; explanation: string }
let sharedReadDb: ReadDb | undefined;
export interface VerifyOptions { readDb?: ReadDb; now?: Date; env?: Record<string, string | undefined> }

export async function verifyBookingAction(db: Db, taskId: number, actor: TaskActor, options: VerifyOptions = {}): Promise<BookingActionRecord> {
  const found = await readRecord(db, taskId) ?? fail("NOT_FOUND", "Booking change not found.");
  if (found.record.status === "proposed") fail("PRECONDITION_FAILED", "This booking change has not been executed.");
  if (found.record.status === "verified" || found.record.status === "closed") return found.record;
  const task = await readTask(db, taskId);
  const check = await checkStoredState(db, task, found.record, options);
  return db.transaction(async tx => {
    const current = await lockRecord(tx, taskId) ?? fail("NOT_FOUND", "Booking change not found.");
    const { rowId, record } = current;
    if (record.status !== "executed" && record.status !== "verification_failed") return record;
    const at = (options.now ?? new Date()).getTime(), execution = record.execution!;
    const verification = { ...check, checkedAt: at, attempts: (record.verification?.attempts ?? 0) + 1 };
    if (check.outcome === "not_verified") {
      const next: BookingActionRecord = { ...record, status: "verification_failed", verification,
        history: [...record.history, { action: "verification_failed", actor, at, note: check.explanation.slice(0, 300) }] };
      await saveRecord(tx, rowId, next);
      return next;
    }
    const lockedTask = await lockTask(tx, taskId);
    const confirmation = bookingConfirmationText({ customerName: lockedTask.customerName, type: record.request.type,
      date: execution.expected.date ?? execution.previous.date, time: execution.expected.time, arrivalWindow: execution.expected.arrivalWindow });
    const item = record.itemId ? lockedTask.items.find(candidate => candidate.id === record.itemId) : undefined;
    if (item && !item.completedBy && lockedTask.status !== "done") {
      // Existing checklist semantics: the approving staff member, noted as executed and verified by LeadFlow.
      item.completedBy = execution.by; item.completedAt = at;
      lockedTask.activity.push({ action: "item_completed", actor: execution.by, at, note: item.id });
      await persistence().saveTask(tx, lockedTask);
    }
    const next: BookingActionRecord = { ...record, status: "verified", verification,
      confirmation: { text: confirmation, status: "ready", by: null, at: null },
      history: [...record.history, { action: "verified", actor, at, note: `${check.method === "instinct" ? "Instinct verifier" : "Exact re-read"}: ${check.explanation}`.slice(0, 300) }] };
    await saveRecord(tx, rowId, next);
    return next;
  });
}

/** Fresh read after commit. The Instinct verifier decides first; an exact re-read is used only when it cannot
 * decide (for example a customer with several emails). A discrepancy reported by Instinct is never overridden. */
async function checkStoredState(db: Db, task: CustomerTask, record: BookingActionRecord, options: VerifyOptions): Promise<Check> {
  let instinctNote = "";
  try {
    const result = await verifyWithInstinct(task, record, options);
    if (result.outcome === "matches_current") return { outcome: "verified", method: "instinct", explanation: "The stored booking matches the change." };
    if (result.outcome === "discrepancy") return { outcome: "not_verified", method: "instinct", explanation: result.explanation };
    instinctNote = ` (Instinct verifier could not decide: ${result.limitations.slice(0, 3).join(", ") || result.outcome})`;
  } catch (error) {
    instinctNote = ` (Instinct verifier unavailable: ${error instanceof Error ? error.message.slice(0, 80) : "error"})`;
  }
  const direct = await directReadback(db, record);
  return { ...direct, explanation: `${direct.explanation}${instinctNote}` };
}
async function verifyWithInstinct(task: CustomerTask, record: BookingActionRecord, options: VerifyOptions) {
  const execution = record.execution!;
  const installation = resolveInstinctInstallation(options.env ?? process.env);
  const scope = authorizedScopeSchema.parse({ ...installation, actor: { staffId: /^[1-9]\d*$/.test(execution.by.id) ? execution.by.id : "1", role: "admin" } });
  const nowIso = (options.now ?? new Date()).toISOString();
  const quote = record.request.evidenceQuote?.trim() || summary(record.request);
  const fingerprint = sha(["booking-action", record.taskId, record.revision]);
  const ref = { store: "conversation_sessions" as const, sourceKind: "sms" as const, sourceId: `task:${record.taskId}`, providerId: null,
    sourceRevision: `r${record.revision}`, contextFingerprint: fingerprint, sourceAccountKey: scope.sourceAccountKey,
    sessionId: task.sessionId ? String(task.sessionId) : null, threadId: null, occurredAtUtc: null, observedAtUtc: nowIso,
    timeBasis: "stored_record" as const, handlingEvidence: null };
  const identity: VerifiedIdentity = { installationScope: scope.installationScope, sourceAccountKey: scope.sourceAccountKey,
    phone: normalizePhone(task.customerPhone), email: null, sessionIds: task.sessionId ? [String(task.sessionId)] : [],
    customerPortalAccountId: null, decision: "verified", reasons: [], evidenceRefs: [ref], fingerprint: sha(["identity", task.customerPhone]), displayName: null };
  const expected = execution.expected;
  const window = expected.arrivalWindow && execution.canonicalVisit ? expected.arrivalWindow : null;
  const action: ExtractionAction = {
    id: `booking-action:${record.taskId}`, revision: `r${record.revision}`, contextId: `task:${record.taskId}`,
    action: expected.cancelled ? "cancel" : "reschedule", agreement: "requested", anchorRef: ref,
    citations: [{ ref, start: 0, end: quote.length, exactQuote: quote }],
    expected: { bookingReference: `leadflow:job:${execution.jobId}`, date: expected.cancelled ? null : expected.date, originalDate: null,
      time: expected.cancelled ? null : (window ? window.start : expected.time), timeKind: expected.cancelled ? "unspecified" : window ? "window" : "exact",
      windowEnd: window ? window.end : null, timeZone: TIME_ZONE, scope: "visit", address: null, serviceName: null, extras: null,
      extrasMode: "unspecified", teamName: null, amountCents: null, notes: null, notesDestination: "unspecified" },
    explanation: summary(record.request), confidence: 1, ambiguous: false, missingParameters: [], supersededByRef: null,
  };
  const readDb = options.readDb ?? (sharedReadDb ??= createLazyReadDb());
  const verifier = createRequestVerifier({ nativeRecords: createNativeRecordReader({ db: readDb,
    authorizeScope: candidate => candidate.installationScope === scope.installationScope && candidate.sourceAccountKey === scope.sourceAccountKey }) });
  return verifier.verify(scope, identity, action);
}
async function directReadback(db: Db, record: BookingActionRecord): Promise<Check> {
  const execution = record.execution!, expected = execution.expected;
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, execution.bookingId)).limit(1);
  const jobs = await db.select().from(leadflowJobs).where(eq(leadflowJobs.bookingId, execution.bookingId));
  const job = jobs.find(row => row.id === execution.jobId);
  if (!booking || !job) return { outcome: "not_verified", method: "direct_readback", explanation: "The booking or its visit could not be read." };
  if (expected.cancelled) {
    const open = jobs.filter(row => row.bookingStatus.toLowerCase() !== "cancelled");
    return booking.status === "cancelled" && open.length === 0
      ? { outcome: "verified", method: "direct_readback", explanation: "The booking and its visit are cancelled." }
      : { outcome: "not_verified", method: "direct_readback", explanation: `Booking status ${booking.status}; ${open.length} visit(s) not cancelled.` };
  }
  const time = operationalBookingLocalTime(job.serviceDateTime, booking.requestedTimeZone || TIME_ZONE);
  const problems: string[] = [];
  if (!jobActive(job)) problems.push(`visit status ${job.bookingStatus}`);
  if (job.jobDate !== expected.date) problems.push(`visit date ${job.jobDate}`);
  if (time !== expected.time) problems.push(`visit time ${time ?? "unavailable"}`);
  if (execution.canonicalVisit && (booking.requestedLocalDate !== expected.date || booking.requestedLocalTime !== expected.time))
    problems.push(`booking date/time ${booking.requestedLocalDate} ${booking.requestedLocalTime}`);
  return problems.length
    ? { outcome: "not_verified", method: "direct_readback", explanation: `Expected ${expected.date} ${expected.time}; found ${problems.join(", ")}.` }
    : { outcome: "verified", method: "direct_readback", explanation: `The visit is stored on ${expected.date} at ${expected.time}.` };
}

// ───────────────────────── confirmation (staff-approved send) and closing ─────────────────────────
/** Reserve the send: only one "sending" at a time, and never again after "sent". Returns the text to send. */
export async function beginBookingConfirmation(db: Db, taskId: number, text: string, actor: TaskActor): Promise<{ record: BookingActionRecord; text: string; sessionId: number }> {
  const message = text.trim();
  if (!message || message.length > 1600) fail("PRECONDITION_FAILED", "The confirmation must be 1 to 1600 characters.");
  return db.transaction(async tx => {
    const current = await lockRecord(tx, taskId) ?? fail("NOT_FOUND", "Booking change not found.");
    const { rowId, record } = current;
    if (record.status !== "verified" || record.confirmation?.status !== "ready") fail("CONFLICT", "This confirmation is not ready to send. Refresh the task.");
    const task = await lockTask(tx, taskId);
    if (!task.sessionId) fail("PRECONDITION_FAILED", "This task has no SMS conversation.");
    const at = Date.now();
    const next: BookingActionRecord = { ...record, confirmation: { text: message, status: "sending", by: actor, at },
      history: [...record.history, { action: "confirmation_sending", actor, at, note: null }] };
    await saveRecord(tx, rowId, next);
    return { record: next, text: message, sessionId: task.sessionId! };
  });
}
export type ConfirmationOutcome = "sent" | "failed" | "skipped" | "mark_sent" | "mark_not_sent";
export async function finishBookingConfirmation(db: Db, taskId: number, outcome: ConfirmationOutcome, actor: TaskActor): Promise<BookingActionRecord> {
  return db.transaction(async tx => {
    const current = await lockRecord(tx, taskId) ?? fail("NOT_FOUND", "Booking change not found.");
    const { rowId, record } = current;
    const confirmation = record.confirmation;
    if (record.status !== "verified" || !confirmation) return record.status === "closed" ? record : fail("CONFLICT", "This confirmation is not active. Refresh the task.");
    const at = Date.now();
    if (outcome === "failed" || outcome === "mark_not_sent") {
      if (confirmation.status !== "sending") return record;
      const next: BookingActionRecord = { ...record, confirmation: { ...confirmation, status: "ready" },
        history: [...record.history, { action: "confirmation_failed", actor, at, note: outcome === "failed" ? "Send failed" : "Marked not sent" }] };
      await saveRecord(tx, rowId, next);
      return next;
    }
    if (outcome === "skipped" && confirmation.status !== "ready") fail("CONFLICT", "The confirmation is already being sent. Refresh the task.");
    if ((outcome === "sent" || outcome === "mark_sent") && confirmation.status !== "sending") fail("CONFLICT", "No confirmation send is in progress.");
    const sent = outcome !== "skipped";
    const task = await lockTask(tx, taskId);
    const execution = record.execution!;
    const history: BookingActionRecord["history"] = [...record.history, { action: sent ? "confirmation_sent" : "confirmation_skipped", actor, at,
      note: outcome === "mark_sent" ? "Marked sent after checking the conversation" : null }];
    const open = task.items.filter(item => !item.completedBy);
    if (task.status !== "done" && open.length === 0) {
      if (task.owner?.id !== actor.id) {
        const previous = task.owner;
        task.owner = actor; task.status = "claimed"; task.claimedAt = at;
        task.activity.push({ action: "claimed", actor, at, note: previous ? `Took over from ${previous.name} (${previous.id}) to close after the booking change.` : "Claimed to close after the booking change." });
      }
      task.status = "done"; task.completedAt = at; task.completedBy = actor;
      task.completionNote = `Booking change executed by ${execution.by.name} and verified by LeadFlow. ${sent ? `Confirmation sent by ${actor.name}.` : `No confirmation needed (${actor.name}).`}`;
      task.activity.push({ action: "completed", actor, at, note: task.completionNote });
      await persistence().saveTask(tx, task);
      history.push({ action: "closed", actor, at, note: null });
    } else if (task.status !== "done") {
      history.push({ action: "closed", actor, at, note: "Task left open: other checklist items remain." });
    }
    const next: BookingActionRecord = { ...record, status: "closed", confirmation: { ...confirmation, status: sent ? "sent" : "skipped", by: actor, at }, history };
    await saveRecord(tx, rowId, next);
    return next;
  });
}
