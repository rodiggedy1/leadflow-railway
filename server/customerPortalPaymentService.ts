import { and, desc, eq } from "drizzle-orm";
import { bookingPaymentProfiles, bookings, stripeCustomers } from "../drizzle/schema";

export type CustomerPortalSavedCard = {
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  brand: string | null;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
};

export async function getCustomerPortalSavedCard(db: NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>, customerPhone: string): Promise<CustomerPortalSavedCard | null> {
  const [customerCard] = await db.select().from(stripeCustomers).where(eq(stripeCustomers.phone, customerPhone)).limit(1);
  if (customerCard?.stripePaymentMethodId && customerCard.cardLast4) {
    return { stripeCustomerId: customerCard.stripeCustomerId, stripePaymentMethodId: customerCard.stripePaymentMethodId, brand: customerCard.cardBrand, last4: customerCard.cardLast4, expMonth: customerCard.cardExpMonth, expYear: customerCard.cardExpYear };
  }
  const [bookingCard] = await db.select({ stripeCustomerId: bookingPaymentProfiles.stripeCustomerId, stripePaymentMethodId: bookingPaymentProfiles.stripePaymentMethodId, brand: bookingPaymentProfiles.cardBrand, last4: bookingPaymentProfiles.cardLast4, expMonth: bookingPaymentProfiles.cardExpMonth, expYear: bookingPaymentProfiles.cardExpYear }).from(bookingPaymentProfiles).innerJoin(bookings, eq(bookingPaymentProfiles.bookingId, bookings.id)).where(and(eq(bookings.customerPhone, customerPhone), eq(bookingPaymentProfiles.paymentStatus, "card_on_file"))).orderBy(desc(bookingPaymentProfiles.updatedAt)).limit(1);
  if (!bookingCard?.stripeCustomerId || !bookingCard.stripePaymentMethodId || !bookingCard.last4) return null;
  return { stripeCustomerId: bookingCard.stripeCustomerId, stripePaymentMethodId: bookingCard.stripePaymentMethodId, brand: bookingCard.brand, last4: bookingCard.last4, expMonth: bookingCard.expMonth, expYear: bookingCard.expYear };
}
