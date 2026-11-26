import { eq } from "drizzle-orm";
import { bookingSeries, bookings, leadflowJobs } from "../drizzle/schema";
import type { getDb } from "./db";

export type BookingDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type BookingCancellationTransaction = Parameters<Parameters<BookingDb["transaction"]>[0]>[0];

/** The same cancellation writes, inside the caller's transaction (the caller owns commit/rollback). */
export async function cancelCanonicalBookingInTransaction(tx: BookingCancellationTransaction, bookingId: number, now = new Date()) {
  const rows = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!rows[0]) return null;
  await tx.update(bookings).set({ status: "cancelled", updatedAt: now }).where(eq(bookings.id, bookingId));
  await tx.update(bookingSeries).set({ status: "cancelled", updatedAt: now }).where(eq(bookingSeries.bookingId, bookingId));
  await tx.update(leadflowJobs).set({ bookingStatus: "cancelled", updatedAt: now }).where(eq(leadflowJobs.bookingId, bookingId));
  return { id: bookingId, status: "cancelled" as const };
}

export async function cancelCanonicalBooking(db: BookingDb, bookingId: number) {
  const now = new Date();
  const result = await db.transaction(tx => cancelCanonicalBookingInTransaction(tx, bookingId, now));
  return result;
}
