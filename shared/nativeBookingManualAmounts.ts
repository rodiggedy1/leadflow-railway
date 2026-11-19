import { z } from "zod";

// Same staff-edit range as the existing native booking details contract.
export const nativeManualAmountCentsSchema = z.number().int().min(0).max(10_000_000);
export const nativeManualAmountDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Choose a valid cleaning date.");
export const updateNativeBookingManualAmountInputSchema = z.object({
  bookingId: z.number().int().positive().safe(),
  expectedDate: nativeManualAmountDateSchema,
  expectedAmountCents: nativeManualAmountCentsSchema,
  expectedRevision: z.number().int().nonnegative().safe(),
  amountCents: nativeManualAmountCentsSchema,
  scope: z.enum(["visit", "subsequent"]),
  requestId: z.string().uuid().transform(value => value.toLowerCase()),
}).strict();
export type UpdateNativeBookingManualAmountInput = z.infer<typeof updateNativeBookingManualAmountInputSchema>;
export const nativeBookingManualAmountActorSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).strict();
export type NativeBookingManualAmountActor = z.infer<typeof nativeBookingManualAmountActorSchema>;
const visitSchema = z.object({
  jobId: z.number().int().positive().safe().nullable(),
  date: nativeManualAmountDateSchema,
  firstVisit: z.boolean(),
  amountCents: nativeManualAmountCentsSchema,
  protected: z.boolean(),
}).strict();
const protectedVisitSchema = z.object({ jobId: z.number().int().positive().safe().nullable(), date: nativeManualAmountDateSchema, reasons: z.array(z.string().min(1)).min(1) }).strict();
export const updateNativeBookingManualAmountResultSchema = z.object({
  bookingId: z.number().int().positive().safe(),
  selectedJobId: z.number().int().positive().safe().nullable(),
  selectedDate: nativeManualAmountDateSchema,
  selectedChanged: z.boolean(),
  selectedAmountCents: nativeManualAmountCentsSchema,
  manualAmountRevision: z.number().int().positive().safe(),
  changedVisitCount: z.number().int().nonnegative().safe(),
  changedJobCount: z.number().int().nonnegative().safe(),
  protectedVisitCount: z.number().int().nonnegative().safe(),
  protectedVisits: z.array(protectedVisitSchema),
  futureRuleChanged: z.boolean(),
  replayed: z.boolean(),
}).strict();
export type UpdateNativeBookingManualAmountResult = z.infer<typeof updateNativeBookingManualAmountResultSchema>;
const amountObservationSchema = z.object({ jobId: z.number().int().positive().safe().nullable(), date: nativeManualAmountDateSchema, firstVisit: z.boolean(), amountCents: nativeManualAmountCentsSchema }).strict();
export const nativeBookingManualAmountsSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative().safe(),
  visits: z.array(visitSchema),
  seriesRules: z.array(z.object({ fromDate: nativeManualAmountDateSchema, amountCents: nativeManualAmountCentsSchema }).strict()),
  history: z.array(z.object({
    requestId: z.string().uuid(),
    actor: nativeBookingManualAmountActorSchema,
    timestamp: z.string().datetime(),
    command: updateNativeBookingManualAmountInputSchema,
    priorEffective: z.array(amountObservationSchema),
    afterEffective: z.array(amountObservationSchema),
    result: updateNativeBookingManualAmountResultSchema,
  }).strict()),
}).strict().superRefine((metadata, ctx) => {
  const identities = new Set<string>();
  for (const visit of metadata.visits) {
    const key = visit.jobId !== null ? `job:${visit.jobId}` : visit.firstVisit ? "first" : `date:${visit.date}`;
    if (identities.has(key)) ctx.addIssue({ code: "custom", message: "Duplicate amount exception identity." });
    identities.add(key);
  }
  if (metadata.visits.filter(visit => visit.firstVisit).length > 1) ctx.addIssue({ code: "custom", message: "Ambiguous first-visit exception." });
  const requests = new Set<string>();
  if (metadata.revision !== metadata.history.length) ctx.addIssue({ code: "custom", message: "Amount revision/history mismatch." });
  metadata.history.forEach((event, index) => {
    const key = event.requestId.toLowerCase();
    if (requests.has(key) || key !== event.command.requestId || event.result.manualAmountRevision !== index + 1 || event.command.expectedRevision !== index || event.result.bookingId !== event.command.bookingId || event.result.replayed || event.result.protectedVisitCount !== event.result.protectedVisits.length) ctx.addIssue({ code: "custom", message: "Invalid amount command history." });
    requests.add(key);
  });
});
export type NativeBookingManualAmounts = z.infer<typeof nativeBookingManualAmountsSchema>;
export type NativeManualAmountVisit = z.infer<typeof visitSchema>;
export interface NativeAmountBooking {
  requestedLocalDate: string;
  recurrence: string;
  firstCleaningTotalCents: number;
  futureVisitTotalCents: number | null;
  manualAmountOverrides?: unknown;
}
export interface NativeVisitIdentity { jobId?: number | null; firstVisit?: boolean }
export interface NativeDisplayAmounts { firstCleaningTotalCents: number; futureVisitTotalCents: number | null; manualAmountRevision: number }
export class NativeBookingManualAmountsError extends Error {
  constructor() { super("Stored manual booking amounts need review."); this.name = "NativeBookingManualAmountsError"; }
}
export function parseNativeBookingManualAmounts(value: unknown): NativeBookingManualAmounts | null {
  if (value === null || value === undefined) return null;
  const parsed = nativeBookingManualAmountsSchema.safeParse(value);
  if (!parsed.success) throw new NativeBookingManualAmountsError();
  return parsed.data;
}
function originalAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new NativeBookingManualAmountsError();
  return value;
}
function ruleAmount(metadata: NativeBookingManualAmounts | null, date?: string): number | undefined {
  // Append order represents command precedence: a later command from an earlier
  // boundary must also replace previously-commanded later future prices.
  return metadata?.seriesRules.slice().reverse().find(rule => date === undefined || rule.fromDate <= date)?.amountCents;
}
function exception(metadata: NativeBookingManualAmounts | null, date: string, identity: NativeVisitIdentity, firstVisit: boolean, protectedOnly: boolean) {
  const visits = metadata?.visits.filter(visit => visit.protected === protectedOnly) ?? [];
  return visits.find(visit => identity.jobId != null && visit.jobId === identity.jobId)
    ?? (firstVisit ? visits.find(visit => visit.firstVisit) : undefined)
    ?? visits.find(visit => visit.jobId === null && !visit.firstVisit && visit.date === date);
}
/** Pure selection only; never recalculates or mutates original booking prices. */
export function effectiveNativeVisitAmount(booking: NativeAmountBooking, date: string, identity: NativeVisitIdentity = {}): number {
  if (booking.manualAmountOverrides == null) return (identity.firstVisit ?? date === booking.requestedLocalDate) ? booking.firstCleaningTotalCents : booking.futureVisitTotalCents ?? booking.firstCleaningTotalCents;
  if (!nativeManualAmountDateSchema.safeParse(date).success || (identity.jobId != null && (!Number.isSafeInteger(identity.jobId) || identity.jobId <= 0))) throw new NativeBookingManualAmountsError();
  const metadata = parseNativeBookingManualAmounts(booking.manualAmountOverrides);
  const firstVisit = identity.firstVisit ?? date === booking.requestedLocalDate;
  const selected = exception(metadata, date, identity, firstVisit, true) ?? exception(metadata, date, identity, firstVisit, false);
  if (selected) return selected.amountCents;
  if (firstVisit) return originalAmount(booking.firstCleaningTotalCents);
  return ruleAmount(metadata, date) ?? originalAmount(firstVisit ? booking.firstCleaningTotalCents : booking.futureVisitTotalCents ?? booking.firstCleaningTotalCents);
}
/** Future baseline, excluding visit/first exceptions; omitted date is latest command. */
export function effectiveNativeFutureAmount(booking: NativeAmountBooking, date?: string): number | null {
  if (booking.manualAmountOverrides == null) return booking.recurrence === "one-time" ? null : booking.futureVisitTotalCents;
  const metadata = parseNativeBookingManualAmounts(booking.manualAmountOverrides);
  if (date !== undefined && !nativeManualAmountDateSchema.safeParse(date).success) throw new NativeBookingManualAmountsError();
  if (booking.recurrence === "one-time") return null;
  return ruleAmount(metadata, date) ?? (booking.futureVisitTotalCents === null ? null : originalAmount(booking.futureVisitTotalCents));
}
export function selectNativeDisplayAmounts(booking: NativeAmountBooking): NativeDisplayAmounts {
  if (booking.manualAmountOverrides == null) return { firstCleaningTotalCents: booking.firstCleaningTotalCents, futureVisitTotalCents: booking.recurrence === "one-time" ? null : booking.futureVisitTotalCents, manualAmountRevision: 0 };
  const metadata = parseNativeBookingManualAmounts(booking.manualAmountOverrides);
  return {
    firstCleaningTotalCents: effectiveNativeVisitAmount(booking, booking.requestedLocalDate, { firstVisit: true }),
    futureVisitTotalCents: effectiveNativeFutureAmount(booking),
    manualAmountRevision: metadata?.revision ?? 0,
  };
}
