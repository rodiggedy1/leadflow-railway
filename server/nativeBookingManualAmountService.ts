import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { bookings, leadflowJobs, type LeadflowJob } from "../drizzle/schema";
import {
  effectiveNativeVisitAmount, effectiveNativeFutureAmount, nativeBookingManualAmountActorSchema,
  nativeBookingManualAmountsSchema, parseNativeBookingManualAmounts, updateNativeBookingManualAmountInputSchema,
  type NativeBookingManualAmounts, type NativeBookingManualAmountActor, type NativeManualAmountVisit,
  type UpdateNativeBookingManualAmountInput, type UpdateNativeBookingManualAmountResult,
} from "../shared/nativeBookingManualAmounts";

export { updateNativeBookingManualAmountInputSchema };
export type { NativeBookingManualAmountActor, UpdateNativeBookingManualAmountInput, UpdateNativeBookingManualAmountResult };
type Db = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
export type NativeBookingManualAmountTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const conflict = (message: string): never => { throw new TRPCError({ code: "CONFLICT", message }); };
type Visit = { jobId: number | null; date: string; firstVisit: boolean; amountCents: number; job?: LeadflowJob };
function replaceVisit(metadata: NativeBookingManualAmounts, next: NativeManualAmountVisit) {
  metadata.visits = metadata.visits.filter(visit => !(next.jobId !== null && visit.jobId === next.jobId) && !(next.firstVisit && visit.firstVisit) && !(visit.jobId === null && visit.firstVisit === next.firstVisit && visit.date === next.date));
  metadata.visits.push(next);
}

/** Staff caller owns authorization, transaction/rollback, and after-commit refresh. */
export async function updateNativeBookingManualAmount(tx: NativeBookingManualAmountTx, rawInput: UpdateNativeBookingManualAmountInput, rawActor: NativeBookingManualAmountActor): Promise<UpdateNativeBookingManualAmountResult> {
  const input = updateNativeBookingManualAmountInputSchema.parse(rawInput);
  const actor = nativeBookingManualAmountActorSchema.parse(rawActor);
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1).for("update");
  if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
  let metadata: NativeBookingManualAmounts;
  try { metadata = parseNativeBookingManualAmounts(booking.manualAmountOverrides) ?? { version: 1, revision: 0, visits: [], seriesRules: [], history: [] }; }
  catch { return conflict("Stored manual booking amounts need review. No amounts were changed."); }
  const replay = metadata.history.find(event => event.requestId.toLowerCase() === input.requestId);
  if (replay) {
    if (JSON.stringify(replay.command) !== JSON.stringify(input) || replay.actor.id !== actor.id || replay.actor.name !== actor.name) conflict("This request UUID was already used for another amount command.");
    return { ...replay.result, replayed: true };
  }
  if (metadata.revision !== input.expectedRevision) conflict("The cleaning amount was edited by someone else. Refresh before saving.");
  if (input.scope === "subsequent" && booking.recurrence === "one-time") conflict("A one-time booking has no subsequent visits. Choose only this visit.");
  const jobs = await tx.select().from(leadflowJobs).where(eq(leadflowJobs.bookingId, booking.id)).orderBy(leadflowJobs.id).for("update");
  const selectedRows = jobs.filter(job => job.jobDate === input.expectedDate);
  if (selectedRows.length > 1 || (!selectedRows.length && jobs.length)) conflict("The exact requested cleaning cannot be selected unambiguously. Refresh before saving.");
  if (!jobs.length && input.expectedDate !== booking.requestedLocalDate) conflict("The booking cleaning date changed. Refresh before saving.");
  const selectedJob = selectedRows[0];
  const firstRows = jobs.filter(job => job.jobDate === booking.requestedLocalDate);
  if (firstRows.length > 1 || jobs.length && !firstRows.length) conflict("The linked first-cleaning identity needs review.");
  if (input.scope === "subsequent" && new Set(jobs.filter(job => job.jobDate >= input.expectedDate).map(job => job.jobDate)).size !== jobs.filter(job => job.jobDate >= input.expectedDate).length) conflict("Multiple linked visits share a future date. No amounts were changed.");
  const visits: Visit[] = jobs.map(job => ({ jobId: job.id, date: job.jobDate, firstVisit: job.id === firstRows[0]?.id, amountCents: job.id === firstRows[0]?.id ? effectiveNativeVisitAmount(booking, job.jobDate, { jobId: job.id, firstVisit: true }) : job.jobTotalCents, job }));
  if (!jobs.length) visits.push({ jobId: null, date: booking.requestedLocalDate, firstVisit: true, amountCents: effectiveNativeVisitAmount(booking, booking.requestedLocalDate, { firstVisit: true }) });
  for (const visit of visits) {
    if (!Number.isSafeInteger(visit.amountCents) || visit.amountCents < 0 || visit.amountCents > 10_000_000) conflict("A current occurrence amount needs review.");
  }
  const selected = visits.find(visit => visit.jobId === (selectedJob?.id ?? null))!;
  if (selected.amountCents !== input.expectedAmountCents) conflict("The current cleaning amount changed. Refresh before saving.");
  const affected = input.scope === "visit" ? [selected] : visits.filter(visit => visit.date >= input.expectedDate);
  const boundary = input.expectedDate;
  const futureEligible = input.scope === "subsequent" && ["weekly", "biweekly", "monthly"].includes(booking.recurrence);
  const futureRuleChanged = futureEligible && (effectiveNativeFutureAmount(booking, boundary) !== input.amountCents || metadata.seriesRules.some(rule => rule.fromDate >= boundary && effectiveNativeFutureAmount(booking, rule.fromDate) !== input.amountCents) || metadata.visits.some(visit => !visit.firstVisit && visit.date >= boundary && visit.amountCents !== input.amountCents));
  const changed = affected.filter(visit => visit.amountCents !== input.amountCents);
  if (futureEligible) {
    const byId = new Map(visits.map(visit => [visit.jobId, visit]));
    metadata.visits = metadata.visits.filter(visit => visit.firstVisit || (visit.jobId !== null ? (byId.get(visit.jobId)?.date ?? visit.date) : visit.date) < boundary);
    metadata.seriesRules.push({ fromDate: boundary, amountCents: input.amountCents });
  }
  for (const visit of affected) {
    if (input.scope === "visit" || visit.firstVisit || !futureEligible) replaceVisit(metadata, { jobId: visit.jobId, date: visit.date, firstVisit: visit.firstVisit, amountCents: input.amountCents, protected: false });
  }
  const result: UpdateNativeBookingManualAmountResult = {
    bookingId: booking.id, selectedJobId: selected.jobId, selectedDate: selected.date,
    selectedChanged: changed.includes(selected), selectedAmountCents: input.amountCents,
    manualAmountRevision: metadata.revision + 1, changedVisitCount: changed.length,
    changedJobCount: changed.filter(visit => visit.jobId !== null && !visit.firstVisit).length,
    protectedVisitCount: 0, protectedVisits: [],
    futureRuleChanged, replayed: false,
  };
  metadata.revision++;
  const observe = (visit: Visit, amountCents: number) => ({ jobId: visit.jobId, date: visit.date, firstVisit: visit.firstVisit, amountCents });
  const now = new Date();
  metadata.history.push({ requestId: input.requestId, actor, timestamp: now.toISOString(), command: input,
    priorEffective: affected.map(visit => observe(visit, visit.amountCents)),
    afterEffective: affected.map(visit => observe(visit, input.amountCents)), result });
  nativeBookingManualAmountsSchema.parse(metadata);
  const affectedRows = (value: unknown) => Number((value as { affectedRows?: number })?.affectedRows ?? (value as Array<{ affectedRows?: number }>)?.[0]?.affectedRows ?? 0);
  // The first cleaning's booking amount is saved in metadata only. Its original
  // booking/job financial pair remains unchanged for existing payment readers.
  for (const visit of changed) if (visit.jobId !== null && !visit.firstVisit) {
    const written = await tx.update(leadflowJobs).set({ jobTotalCents: input.amountCents, updatedAt: now }).where(and(eq(leadflowJobs.id, visit.jobId), eq(leadflowJobs.bookingId, booking.id), eq(leadflowJobs.jobTotalCents, visit.amountCents)));
    if (affectedRows(written) !== 1) conflict("The selected cleaning amount changed before it could be saved.");
  }
  const written = await tx.update(bookings).set({ manualAmountOverrides: metadata, updatedAt: now }).where(eq(bookings.id, booking.id));
  if (affectedRows(written) !== 1) conflict("The booking amount metadata could not be saved.");
  return result;
}
