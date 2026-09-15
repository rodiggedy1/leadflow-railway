import { and, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { bookingPaymentProfiles, bookings, stripeCustomers } from "../drizzle/schema";

type ReconciliationDatabase = {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
};

/**
 * Mirrors only already-verified booking cards that are absent or incomplete in
 * stripe_customers, the existing Admin Payments → Cards on File source.
 * It does not call Stripe and never changes any booking or payment-profile row.
 */
export async function reconcileMissingStripeCustomerCards(db: ReconciliationDatabase): Promise<number> {
  const rows = await db
    .select({
      phone: bookings.customerPhone,
      name: bookings.customerName,
      stripeCustomerId: bookingPaymentProfiles.stripeCustomerId,
      stripePaymentMethodId: bookingPaymentProfiles.stripePaymentMethodId,
      cardBrand: bookingPaymentProfiles.cardBrand,
      cardLast4: bookingPaymentProfiles.cardLast4,
      cardExpMonth: bookingPaymentProfiles.cardExpMonth,
      cardExpYear: bookingPaymentProfiles.cardExpYear,
    })
    .from(bookingPaymentProfiles)
    .innerJoin(bookings, eq(bookingPaymentProfiles.bookingId, bookings.id))
    .leftJoin(stripeCustomers, eq(stripeCustomers.phone, bookings.customerPhone))
    .where(and(
      eq(bookingPaymentProfiles.paymentStatus, "card_on_file"),
      isNotNull(bookingPaymentProfiles.stripeCustomerId),
      isNotNull(bookingPaymentProfiles.stripePaymentMethodId),
      isNotNull(bookingPaymentProfiles.cardLast4),
      or(
        isNull(stripeCustomers.id),
        isNull(stripeCustomers.stripePaymentMethodId),
        isNull(stripeCustomers.cardLast4),
      ),
    ))
    .orderBy(desc(bookingPaymentProfiles.updatedAt));

  const seenPhones = new Set<string>();
  let repaired = 0;
  for (const row of rows) {
    if (!row.phone || seenPhones.has(row.phone) || !row.stripeCustomerId || !row.stripePaymentMethodId || !row.cardLast4) continue;
    seenPhones.add(row.phone);
    await db.insert(stripeCustomers).values({
      phone: row.phone,
      name: row.name,
      stripeCustomerId: row.stripeCustomerId,
      stripePaymentMethodId: row.stripePaymentMethodId,
      cardBrand: row.cardBrand,
      cardLast4: row.cardLast4,
      cardExpMonth: row.cardExpMonth,
      cardExpYear: row.cardExpYear,
      cardSavedAt: Date.now(),
    }).onDuplicateKeyUpdate({ set: {
      name: row.name,
      stripeCustomerId: row.stripeCustomerId,
      stripePaymentMethodId: row.stripePaymentMethodId,
      cardBrand: row.cardBrand,
      cardLast4: row.cardLast4,
      cardExpMonth: row.cardExpMonth,
      cardExpYear: row.cardExpYear,
      cardSavedAt: Date.now(),
    } });
    repaired += 1;
  }
  return repaired;
}
