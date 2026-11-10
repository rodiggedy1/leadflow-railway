import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { bookings, leadflowJobs, type LeadflowJob } from "../drizzle/schema";
import {
  bookingDateShiftDays, bookingRescheduleDateSchema, bookingRescheduleModeSchema,
  bookingRescheduleTimeSchema, isRecurringBookingFrequency, shiftBookingDate,
  type BookingRescheduleMode,
} from "../shared/bookingReschedule";
import type { getDb } from "./db";
import {
  buildRecurringLeadflowJobValues, getRecurringInterval, isSameLeadflowJobIdentity,
  nextRecurringBusinessDate,
} from "./leadflowJobsService";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type BookingRescheduleTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type OperationalBookingRescheduleInput = {
  jobId?: number;
  bookingId?: number;
  previousLocalDate: string;
  previousLocalTime?: string;
  requestedLocalDate: string;
  requestedLocalTime: string;
  requestedTimeZone?: string;
  mode?: BookingRescheduleMode;
  allowMissingOperationalJob?: boolean;
};
export type OperationalBookingRescheduleResult = {
  movedCount: number;
  selectedJobId: number | null;
  continuationCreated: boolean;
};

const INACTIVE_STATUSES = new Set(["completed", "cancelled", "canceled", "rescheduled", "missing_from_launch27"]);
function active(job: LeadflowJob): boolean {
  return !INACTIVE_STATUSES.has(job.bookingStatus.trim().toLowerCase());
}
function hasExactIdentity(job: LeadflowJob): boolean {
  return Boolean((job.customerPhone?.trim() || job.customerEmail?.trim()) && job.jobAddress?.trim() && job.serviceName?.trim());
}
function badRequest(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
export function operationalBookingLocalTime(serviceDateTime: string | null, timeZone = "America/New_York"): string | null {
  if (!serviceDateTime || !Number.isFinite(new Date(serviceDateTime).getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(serviceDateTime));
}
function localDateTime(date: string, time: string, timeZone: string): string {
  try {
    return new Date(businessLocalDateTimeToUtcMs(date, time, timeZone)).toISOString();
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid booking date or time.");
  }
}
function sameScope(selected: LeadflowJob, candidate: LeadflowJob): boolean {
  if (selected.bookingId !== null) return candidate.bookingId === selected.bookingId;
  if (selected.bookingSeriesId !== null) return candidate.bookingSeriesId === selected.bookingSeriesId;
  if (!hasExactIdentity(selected)) return candidate.id === selected.id;
  return candidate.bookingId === null && candidate.bookingSeriesId === null && isSameLeadflowJobIdentity(selected, candidate);
}

/** Caller owns the transaction and any after-commit broadcast. No artifact IDs are changed. */
export async function rescheduleOperationalBooking(
  tx: BookingRescheduleTransaction,
  input: OperationalBookingRescheduleInput,
): Promise<OperationalBookingRescheduleResult> {
  bookingRescheduleDateSchema.parse(input.previousLocalDate);
  bookingRescheduleDateSchema.parse(input.requestedLocalDate);
  bookingRescheduleTimeSchema.parse(input.requestedLocalTime);
  if (input.previousLocalTime !== undefined) bookingRescheduleTimeSchema.parse(input.previousLocalTime);
  if (input.mode !== undefined) bookingRescheduleModeSchema.parse(input.mode);
  if (!input.jobId && !input.bookingId) badRequest("Choose the exact operational visit to reschedule.");
  const timeZone = input.requestedTimeZone ?? "America/New_York";
  const selectedRows = await tx.select().from(leadflowJobs).where(
    input.jobId ? eq(leadflowJobs.id, input.jobId) : and(eq(leadflowJobs.bookingId, input.bookingId!), eq(leadflowJobs.jobDate, input.previousLocalDate)),
  ).for("update");
  if (selectedRows.length > 1) badRequest("The original booking visit is ambiguous. Choose its exact job ID.");
  const selected = selectedRows[0];
  if (!selected) {
    if (!input.jobId && input.bookingId && input.allowMissingOperationalJob) {
      const linked = await tx.select({ id: leadflowJobs.id }).from(leadflowJobs).where(eq(leadflowJobs.bookingId, input.bookingId)).for("update");
      if (linked.length === 0) return { movedCount: 0, selectedJobId: null, continuationCreated: false };
    }
    throw new TRPCError({ code: "NOT_FOUND", message: "The selected original operational visit was not found." });
  }
  if (selected.jobDate !== input.previousLocalDate || (input.bookingId && selected.bookingId !== input.bookingId)) {
    badRequest("The selected booking date has changed. Refresh before rescheduling.");
  }
  const oldTime = operationalBookingLocalTime(selected.serviceDateTime, timeZone);
  if (input.previousLocalTime !== undefined && oldTime !== input.previousLocalTime) {
    badRequest("The selected booking time has changed. Refresh before rescheduling.");
  }
  const changed = selected.jobDate !== input.requestedLocalDate || oldTime !== input.requestedLocalTime;
  if (!changed) return { movedCount: 0, selectedJobId: selected.id, continuationCreated: false };
  if (!active(selected)) badRequest("Completed or inactive visits cannot be rescheduled.");
  const recurring = isRecurringBookingFrequency(selected.frequency);
  if (recurring && input.mode === undefined) {
    badRequest("Choose Move only this visit or Shift subsequent visits before rescheduling a recurring booking.");
  }
  const mode = input.mode ?? "visit";
  const unlinked = selected.bookingId === null && selected.bookingSeriesId === null;
  if (recurring && unlinked && !hasExactIdentity(selected)) badRequest("This visit lacks a complete exact contact, address, and service identity. Its continuation cannot be safely linked.");
  const scopeRows = await tx.select().from(leadflowJobs).where(
    selected.bookingId !== null ? eq(leadflowJobs.bookingId, selected.bookingId)
      : selected.bookingSeriesId !== null ? eq(leadflowJobs.bookingSeriesId, selected.bookingSeriesId)
        : !hasExactIdentity(selected) ? eq(leadflowJobs.id, selected.id) : and(
            selected.customerPhone === null ? isNull(leadflowJobs.customerPhone) : eq(leadflowJobs.customerPhone, selected.customerPhone),
            selected.customerEmail === null ? isNull(leadflowJobs.customerEmail) : eq(leadflowJobs.customerEmail, selected.customerEmail),
            eq(leadflowJobs.jobAddress, selected.jobAddress!), eq(leadflowJobs.serviceName, selected.serviceName!),
          ),
  ).for("update");
  if (unlinked && scopeRows.some(row => !sameScope(selected, row))) badRequest("The exact identity matches another linked booking series. Rescheduling is ambiguous.");
  const scope = scopeRows.filter(row => sameScope(selected, row));
  if (recurring) {
    const seenDates = new Set<string>();
    for (const row of scope.filter(row => row.jobDate >= selected.jobDate)) {
      if (seenDates.has(row.jobDate) || (unlinked && getRecurringInterval(row.frequency) !== getRecurringInterval(selected.frequency))) {
        badRequest("Multiple or inconsistent visits match this exact identity. The recurring series cannot be safely linked.");
      }
      seenDates.add(row.jobDate);
    }
  }
  const moving = mode === "subsequent" && recurring
    ? scope.filter(row => active(row) && row.jobDate >= selected.jobDate)
    : [selected];
  const days = bookingDateShiftDays(selected.jobDate, input.requestedLocalDate);
  const moves = moving.map(row => ({
    row, jobDate: row.id === selected.id ? input.requestedLocalDate : shiftBookingDate(row.jobDate, days),
  })).map(move => ({ ...move, serviceDateTime: localDateTime(move.jobDate, input.requestedLocalTime, timeZone) }));

  // A visit-only move must not re-anchor the worker on the moved date. Establish
  // the original next visit first, using its original time, identity, and price.
  let continuationDate: string | null = null;
  let continuationValues: (Omit<ReturnType<typeof buildRecurringLeadflowJobValues>, "bookingSeriesId"> & { bookingSeriesId: number | null }) | null = null;
  let establishContinuation = false;
  if (recurring && mode === "visit" && selected.nextOccurrenceCreatedAt !== null) {
    // The claim already prevents the worker from creating another continuation.
    // The selected date may be a prior visit-only exception, so it cannot be used
    // to derive a new cadence. Preserve every verified existing series row and
    // the claim; only the explicitly selected visit is eligible for a write.
    const established = scope.filter(row => row.id !== selected.id && active(row) &&
      getRecurringInterval(row.frequency) === getRecurringInterval(selected.frequency));
    if (established.length === 0) badRequest("This visit already claimed its next occurrence, but the original continuation cannot be proven. No visits were changed.");
  } else if (recurring && mode === "visit") {
    continuationDate = nextRecurringBusinessDate(selected.jobDate, selected.frequency);
    if (!continuationDate) badRequest("The original recurring continuation could not be determined.");
    const continuations = scope.filter(row => row.id !== selected.id && row.jobDate === continuationDate);
    if (continuations.length > 1) badRequest("The original next recurring visit is ambiguous.");
    if (continuations.length === 1 && !active(continuations[0])) badRequest("The original next recurring visit is inactive; its continuation cannot be safely established.");
    if (continuations.length === 0) {
      const nativeRows = selected.bookingId === null ? [] : await tx.select({ futureVisitTotalCents: bookings.futureVisitTotalCents }).from(bookings).where(eq(bookings.id, selected.bookingId)).limit(1);
      if (oldTime === null) badRequest("The original visit time is unavailable; its unchanged recurring continuation cannot be safely established.");
      const values = buildRecurringLeadflowJobValues(selected, continuationDate, nativeRows[0]?.futureVisitTotalCents ?? selected.jobTotalCents);
      continuationValues = {
        ...values, bookingSeriesId: selected.bookingSeriesId,
        bookingStatus: selected.bookingStatus === "unassigned" ? "unassigned" : "assigned",
        serviceDateTime: localDateTime(continuationDate, oldTime, timeZone),
      };
    }
    establishContinuation = selected.nextOccurrenceCreatedAt === null;
  }

  const movingIds = new Set(moves.map(move => move.row.id));
  const targetDates = Array.from(new Set([...moves.map(move => move.jobDate), ...(continuationDate ? [continuationDate] : [])]));
  const collisionRows = await tx.select().from(leadflowJobs).where(inArray(leadflowJobs.jobDate, targetDates)).for("update");
  const conflicts = (row: LeadflowJob) => sameScope(selected, row) || (hasExactIdentity(selected) && isSameLeadflowJobIdentity(selected, row));
  for (const move of moves) {
    if (collisionRows.some(row => !movingIds.has(row.id) && row.jobDate === move.jobDate && conflicts(row))) {
      throw new TRPCError({ code: "CONFLICT", message: "A matching LeadFlow job already exists on a requested date. No visits were changed." });
    }
  }
  if (continuationValues && (moves.some(move => move.jobDate === continuationDate) || collisionRows.some(row => row.id !== selected.id && row.jobDate === continuationDate && conflicts(row)))) {
    throw new TRPCError({ code: "CONFLICT", message: "The unchanged recurring continuation conflicts with another visit. No visits were changed." });
  }

  // All identity, date/time, continuation, and collision validation precedes writes.
  const orderedMoves = [...moves].sort((a, b) => days > 0 ? b.row.jobDate.localeCompare(a.row.jobDate) : a.row.jobDate.localeCompare(b.row.jobDate));
  for (const move of orderedMoves) {
    await tx.update(leadflowJobs).set({
      jobDate: move.jobDate, serviceDateTime: move.serviceDateTime,
      ...(move.row.id === selected.id && establishContinuation ? { nextOccurrenceCreatedAt: new Date() } : {}),
    }).where(eq(leadflowJobs.id, move.row.id));
  }
  if (continuationValues) await tx.insert(leadflowJobs).values(continuationValues);
  return { movedCount: moves.length, selectedJobId: selected.id, continuationCreated: continuationValues !== null };
}
