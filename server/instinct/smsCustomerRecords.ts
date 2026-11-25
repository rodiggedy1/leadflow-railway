import { sql } from "drizzle-orm";
import { z } from "zod";
import { CLAUDE_CUSTOMER_TASK_ACTION } from "../../shared/claudeCustomerTasks";
import type { getDb } from "../db";
import type { ClaudeCustomerSmsGenerationBinding } from "./claudeCustomerSmsGeneration";
import type { VoiceBookingContextBooking, VoiceCustomerBookingContext } from "./voiceCustomerBookingContext";

/** Saved records sent to Claude with an SMS, alongside the recent messages. Read-only; context only. */
export interface SmsCustomerRecords {
  openStaffTasks: Array<{ title: string; status: "unclaimed" | "claimed"; createdOn?: string; items: Array<{ title: string; done: boolean }> }> | null;
  bookingContext: Record<string, unknown> | null;
  /** Saved records that could not be read for this message. */
  unavailableRecords: Array<"openStaffTasks" | "bookings">;
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const MAX_OPEN_TASKS = 20;
const storedTask = z.object({ task: z.object({
  title: z.string().trim().min(1), status: z.enum(["unclaimed", "claimed", "done"]), receivedAt: z.number().finite().optional(),
  items: z.array(z.object({ title: z.string().trim().min(1), completedAt: z.number().finite().nullable().optional() }).passthrough()),
}).passthrough() }).passthrough();
const easternDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

/** Unfinished staff tasks already saved for this exact conversation (unreadable rows are skipped). */
export function openStaffTasksFromRows(rows: Array<Record<string, unknown>>): NonNullable<SmsCustomerRecords["openStaffTasks"]> {
  const open: NonNullable<SmsCustomerRecords["openStaffTasks"]> = [];
  for (const row of rows) {
    let metadata: unknown;
    try { metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata; } catch { continue; }
    const parsed = storedTask.safeParse(metadata);
    if (!parsed.success || parsed.data.task.status === "done") continue;
    const task = parsed.data.task;
    open.push({ title: task.title, status: task.status as "unclaimed" | "claimed",
      ...(task.receivedAt !== undefined ? { createdOn: easternDate(task.receivedAt) } : {}),
      items: task.items.map(item => ({ title: item.title, done: item.completedAt != null })) });
    if (open.length === MAX_OPEN_TASKS) break;
  }
  return open;
}

function bookingFields(booking: VoiceBookingContextBooking) {
  return { date: booking.jobDate, ...(booking.serviceTime ? { time: booking.serviceTime } : {}),
    ...(booking.serviceType ? { service: booking.serviceType } : {}), ...(booking.address ? { address: booking.address } : {}),
    ...(booking.teamName ? { team: booking.teamName } : {}) };
}
/** Plain status words for Claude. The existing lookup already lists as upcoming ONLY a confirmed, scheduled visit
 * (cancelled, completed, rescheduled and unverified bookings are never upcoming). */
export function modelBookingContext(context: VoiceCustomerBookingContext): Record<string, unknown> {
  const upcoming = context.upcomingBooking, past = context.previousBooking;
  const recorded = (past?.bookingStatus ?? "").trim().toLowerCase();
  const pastStatus = recorded === "completed" ? "completed" : recorded === "cancelled" || recorded === "canceled" ? "cancelled"
    : recorded === "rescheduled" ? "rescheduled" : "past";
  return {
    customerFound: context.found,
    currentLocalDate: context.currentLocalDate,
    upcomingBooking: upcoming ? { status: "confirmed", timing: upcoming.timing, ...bookingFields(upcoming),
      ...(upcoming.etaInfo ? { arrival: upcoming.etaInfo } : {}) } : null,
    mostRecentPastBooking: past ? { status: pastStatus, ...(past.bookingStatus ? { recordedStatus: past.bookingStatus } : {}), ...bookingFields(past) } : null,
  };
}

/** Each lookup is independent: a failed one is reported as unavailable and never blocks the reply. */
export function createSmsCustomerRecordsReader(db: Db, readBookings: (db: Db, phone: string) => Promise<VoiceCustomerBookingContext>) {
  return async function readSmsCustomerRecords(binding: ClaudeCustomerSmsGenerationBinding): Promise<SmsCustomerRecords> {
    const [tasks, bookings] = await Promise.allSettled([
      db.execute(sql`SELECT id, metadata FROM ops_chat_messages WHERE channel = 'command' AND quickAction = ${CLAUDE_CUSTOMER_TASK_ACTION}
        AND sessionId = ${binding.sessionId} ORDER BY id DESC LIMIT 200`).then(result => openStaffTasksFromRows((result as any)[0] ?? [])),
      readBookings(db, binding.fromPhone).then(modelBookingContext),
    ]);
    const unavailableRecords: SmsCustomerRecords["unavailableRecords"] = [];
    if (tasks.status === "rejected") unavailableRecords.push("openStaffTasks");
    if (bookings.status === "rejected") unavailableRecords.push("bookings");
    return { openStaffTasks: tasks.status === "fulfilled" ? tasks.value : null,
      bookingContext: bookings.status === "fulfilled" ? bookings.value : null, unavailableRecords };
  };
}
