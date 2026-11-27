import { z } from "zod";
import { taskActorSchema } from "./claudeCustomerTasks";

/** Phase 1 booking changes on Claude customer SMS tasks (native bookings only).
 * ROLLBACK: set to false and release. Proposals then show as information only and every task is handled
 * manually, exactly as before. No database step is needed: the action records live in their own private rows. */
export const CLAUDE_BOOKING_ACTIONS_ENABLED = true;

export const BOOKING_ACTION_CHANNEL = "instinct_booking_action" as const;
export const BOOKING_ACTION_QUICK_ACTION = "claude_booking_action" as const;
/** One private action record per task (unique ops_chat_messages.activeDedupKey). */
export const bookingActionKey = (taskId: number) => `claude-booking-action:v1:${taskId}`;
/** A dismissed proposal keeps its row and history under this archive key: the task has no booking change any more
 * (it can get a new one), and older code, which looks only at the key above, never sees it. */
export const dismissedBookingActionKey = (taskId: number, at: number) => `claude-booking-action:v1:${taskId}:dismissed:${at}`;

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const bookingActionTypeSchema = z.enum(["reschedule_visit", "cancel_visit"]);
export type BookingActionType = z.infer<typeof bookingActionTypeSchema>;

/** What Claude may propose inside its task. Anything that does not match is dropped (the task stays manual). */
export const modelBookingActionSchema = z.object({
  type: bookingActionTypeSchema,
  visitDate: localDate,
  newDate: localDate.nullable(),
  newTime: localTime.nullable(),
  evidenceQuote: z.string().trim().min(1),
}).strict();
export type ModelBookingAction = z.infer<typeof modelBookingActionSchema>;

/** The request as proposed by Claude or set up/edited by staff. The server always resolves the visit itself. */
export const bookingActionRequestSchema = z.object({
  type: bookingActionTypeSchema,
  visitDate: localDate,
  /** Set when staff pick an exact visit; otherwise the visit is found from the customer's phone and visitDate. */
  jobId: z.number().int().positive().nullable(),
  newDate: localDate.nullable(),
  newTime: localTime.nullable(),
  evidenceQuote: z.string().nullable(),
}).strict();
export type BookingActionRequest = z.infer<typeof bookingActionRequestSchema>;

const arrivalWindowSchema = z.object({ start: localTime, end: localTime, label: z.string() }).strict();
export type BookingActionArrivalWindow = z.infer<typeof arrivalWindowSchema>;

export const bookingActionStatusSchema = z.enum(["proposed", "executed", "verified", "verification_failed", "closed"]);
export const bookingActionRecordSchema = z.object({
  version: z.literal(1),
  taskId: z.number().int().positive(),
  source: z.enum(["claude", "staff"]),
  /** Checklist item this action satisfies; ticked automatically only after verification. */
  itemId: z.string().nullable(),
  request: bookingActionRequestSchema,
  revision: z.number().int().positive(),
  status: bookingActionStatusSchema,
  execution: z.object({
    by: taskActorSchema, at: z.number().finite(),
    bookingId: z.number().int().positive(), jobId: z.number().int().positive(), publicBookingNumber: z.string(),
    canonicalVisit: z.boolean(),
    previous: z.object({ date: localDate, time: localTime }).strict(),
    expected: z.object({ date: localDate.nullable(), time: localTime.nullable(), arrivalWindow: arrivalWindowSchema.nullable(), cancelled: z.boolean() }).strict(),
    availabilityConfirmed: z.boolean(),
    lateRescheduleWarning: z.boolean(),
  }).strict().nullable(),
  verification: z.object({
    outcome: z.enum(["verified", "not_verified"]),
    method: z.enum(["instinct", "direct_readback"]).nullable(),
    explanation: z.string(),
    checkedAt: z.number().finite(),
    attempts: z.number().int().positive(),
  }).strict().nullable(),
  confirmation: z.object({
    text: z.string(),
    status: z.enum(["ready", "sending", "sent", "skipped", "uncertain"]),
    by: taskActorSchema.nullable(),
    at: z.number().finite().nullable(),
  }).strict().nullable(),
  history: z.array(z.object({
    action: z.enum(["proposed", "set_up", "edited", "executed", "execution_failed", "verified", "verification_failed",
      "confirmation_sending", "confirmation_sent", "confirmation_failed", "confirmation_skipped", "closed", "dismissed"]),
    actor: taskActorSchema.nullable(), at: z.number().finite(), note: z.string().nullable(),
  }).strict()),
}).strict();
export type BookingActionRecord = z.infer<typeof bookingActionRecordSchema>;

/** A visit this customer could choose (staff dropdown). */
export const bookingActionVisitSchema = z.object({
  jobId: z.number().int().positive(), bookingId: z.number().int().positive(), publicBookingNumber: z.string(),
  date: localDate, time: localTime.nullable(), arrivalWindow: arrivalWindowSchema.nullable(),
  serviceName: z.string().nullable(), address: z.string().nullable(), teamName: z.string().nullable(),
  recurrence: z.string(), canonicalVisit: z.boolean(),
}).strict();
export type BookingActionVisit = z.infer<typeof bookingActionVisitSchema>;

/** Fresh, read-only assessment shown on the card and re-checked inside the execution transaction. */
export const bookingActionAssessmentSchema = z.object({
  executable: z.boolean(),
  /** Plain-language reasons the action must stay manual (empty when executable). */
  manualReasons: z.array(z.string()),
  /** Information for staff that does not block execution. */
  warnings: z.array(z.string()),
  visit: bookingActionVisitSchema.nullable(),
  paymentStatus: z.string().nullable(),
  /** Reschedule only: the new time that will be saved (window bookings keep their window start). */
  effectiveNewTime: localTime.nullable(),
  requiresAvailabilityConfirmation: z.boolean(),
}).strict();
export type BookingActionAssessment = z.infer<typeof bookingActionAssessmentSchema>;

export const bookingActionViewSchema = z.object({
  enabled: z.boolean(),
  record: bookingActionRecordSchema,
  assessment: bookingActionAssessmentSchema.nullable(),
  visits: z.array(bookingActionVisitSchema),
}).strict();
export type BookingActionView = z.infer<typeof bookingActionViewSchema>;

export function formatBookingDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })
    .format(new Date(`${date}T12:00:00.000Z`));
}
export function formatBookingTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}
export function formatArrivalWindow(window: { start: string; end: string }): string {
  return `${formatBookingTime(window.start)}–${formatBookingTime(window.end)}`;
}
/** Owner-approved confirmation wording, filled only from the verified booking values. */
export function bookingConfirmationText(input: { customerName: string | null; type: BookingActionType; date: string;
  time: string | null; arrivalWindow: { start: string; end: string } | null }): string {
  const first = input.customerName?.trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${first},` : "Hi there,";
  if (input.type === "cancel_visit")
    return `${greeting} your cleaning on ${formatBookingDate(input.date)} has been cancelled. If you'd like to book again, just reply here. – Maids in Black`;
  const when = input.arrivalWindow
    ? `${formatBookingDate(input.date)}, with your arrival window of ${formatArrivalWindow(input.arrivalWindow)}`
    : `${formatBookingDate(input.date)} at ${formatBookingTime(input.time!)}`;
  return `${greeting} you're all set! Your cleaning has been moved to ${when}. – Maids in Black`;
}
