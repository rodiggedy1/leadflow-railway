import { and, eq, gt, sql } from "drizzle-orm";
import { bookings, leadflowJobs } from "../drizzle/schema";
import { PUBLIC_BOOKING_POST_BOOKING_UPSELLS } from "../shared/publicBookingPricing";
import { getDb } from "./db";
import { broadcastCleanerPortalJobsChanged } from "./cleanerPortalUpdates";
import { broadcastOpsUpdate } from "./sseBroadcast";

export class BookingUpsellInputError extends Error {}

export async function applyCanonicalAdditionalServices(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  bookingId: number,
  selections: Array<{ id: string; quantity: number }>,
) {
  const seen = new Set<string>();
  const submitted = selections.map(selection => {
    if (seen.has(selection.id)) throw new BookingUpsellInputError("Each additional service can only be selected once.");
    seen.add(selection.id);
    const catalog = PUBLIC_BOOKING_POST_BOOKING_UPSELLS[selection.id];
    if (!catalog) throw new BookingUpsellInputError("Unsupported additional service.");
    return { id: selection.id, label: catalog.label, quantity: selection.quantity, unitPriceCents: catalog.unitPriceCents, totalCents: catalog.unitPriceCents * selection.quantity };
  });
  const result = await db.transaction(async tx => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (!booking) throw new BookingUpsellInputError("Booking not found.");
    const upsellIds = new Set(Object.keys(PUBLIC_BOOKING_POST_BOOKING_UPSELLS));
    const retained = booking.extras.filter(extra => !upsellIds.has(extra.id));
    const extras = [...retained, ...submitted].sort((left, right) => left.id.localeCompare(right.id));
    const existingTotal = booking.extras.filter(extra => upsellIds.has(extra.id)).reduce((total, extra) => total + extra.totalCents, 0);
    const submittedTotal = submitted.reduce((total, extra) => total + extra.totalCents, 0);
    const delta = submittedTotal - existingTotal;
    const firstCleaningTotalCents = booking.firstCleaningTotalCents + delta;
    const futureVisitTotalCents = booking.futureVisitTotalCents === null ? null : booking.futureVisitTotalCents + delta;
    const now = new Date();
    await tx.update(bookings).set({ extras, firstCleaningTotalCents, futureVisitTotalCents, updatedAt: now }).where(eq(bookings.id, bookingId));
    const rows = await tx.select({ id: leadflowJobs.id, jobDate: leadflowJobs.jobDate }).from(leadflowJobs).where(eq(leadflowJobs.bookingId, bookingId));
    const current = rows.find(row => row.jobDate === booking.requestedLocalDate) ?? rows[0];
    if (current) await tx.update(leadflowJobs).set({ extras: JSON.stringify(extras.map(extra => extra.id)), jobTotalCents: firstCleaningTotalCents, updatedAt: now }).where(eq(leadflowJobs.id, current.id));
    if (futureVisitTotalCents !== null) await tx.update(leadflowJobs).set({ extras: JSON.stringify(extras.map(extra => extra.id)), jobTotalCents: sql`${leadflowJobs.jobTotalCents} + ${delta}`, updatedAt: now }).where(and(eq(leadflowJobs.bookingId, bookingId), gt(leadflowJobs.jobDate, booking.requestedLocalDate)));
    return { bookingId, totalCents: firstCleaningTotalCents, firstCleaningTotalCents, futureVisitTotalCents, upsells: submitted, extras };
  });
  broadcastCleanerPortalJobsChanged();
  broadcastOpsUpdate("booking_funnel_update");
  return result;
}
