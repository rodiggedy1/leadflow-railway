import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { bookingPaymentProfiles, bookings } from "../drizzle/schema";

export type InvoiceGuardDb = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
export type InvoiceGuardTx = Parameters<Parameters<InvoiceGuardDb["transaction"]>[0]>[0];
type Booking = typeof bookings.$inferSelect;
type Profile = typeof bookingPaymentProfiles.$inferSelect & { stripeCustomerId: string; stripePaymentMethodId: string };

export function nativeFirstVisitOccurrenceKey(bookingId: number, date: string): string {
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TRPCError({ code: "CONFLICT", message: "The booking first-visit identity needs review." });
  }
  return `booking:${bookingId}:first:${date}`;
}

/**
 * Native card collectors only. Invoice issuance must acquire the SAME bookings
 * row lock before checking the payment profile, active durable authorizations,
 * and inserting the occurrence claim. A read-only claim check alone is not a
 * closed race. Reserve pending_card inside work; call the provider only AFTER
 * this transaction commits. Do not use this for imported jobs or portal requests.
 */
export async function withUnclaimedNativeFirstVisit<T>(
  db: InvoiceGuardDb,
  bookingId: number,
  work: (tx: InvoiceGuardTx, target: { booking: Booking; profile: Profile }) => Promise<T>,
): Promise<T> {
  return db.transaction(async tx => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1).for("update");
    if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
    const key = nativeFirstVisitOccurrenceKey(booking.id, booking.requestedLocalDate);
    // A locking CURRENT read avoids a stale REPEATABLE READ snapshot after
    // waiting for issuance. Retain claims for paid and void invoices as well.
    const [claims] = await tx.execute(sql`SELECT id, invoiceId FROM payable_invoice_lines WHERE occurrenceKey = ${key} LIMIT 1 FOR UPDATE`);
    if (!Array.isArray(claims)) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Invoice collection ownership could not be verified." });
    if (claims.length) throw new TRPCError({ code: "CONFLICT", message: "This booking first visit belongs to an invoice. Collect payment through that invoice." });
    const [manualPayments] = await tx.execute(sql`SELECT occurrenceKey FROM payable_invoice_manual_payments WHERE occurrenceKey = ${key} LIMIT 1 FOR UPDATE`);
    if (!Array.isArray(manualPayments)) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Manual payment ownership could not be verified." });
    if (manualPayments.length) throw new TRPCError({ code: "CONFLICT", message: "This booking first visit is already marked paid by staff." });
    const [profile] = await tx.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, bookingId)).limit(1).for("update");
    if (!profile || !profile.stripeCustomerId || !profile.stripePaymentMethodId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No booking-bound saved card found." });
    }
    return work(tx, { booking, profile: { ...profile, stripeCustomerId: profile.stripeCustomerId, stripePaymentMethodId: profile.stripePaymentMethodId } });
  });
}
