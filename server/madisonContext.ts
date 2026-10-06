import { desc, eq, and, inArray, notInArray } from "drizzle-orm";
import { bookings, cleanerPortalJobProgress, leadflowJobs } from "../drizzle/schema";
import { getDb } from "./db";

export type MadisonResolvedContext = {
  customerId?: number;
  customerName?: string;
  bookingId?: number;
  leadflowJobId?: number;
  teamName?: string;
  cleanerPhone?: string;
  serviceDateTime?: string;
  isCleaner: boolean;
  senderName?: string;
};

export function buildMadisonPhoneCandidates(fromPhone: string): string[] {
  const digits = fromPhone.replace(/[^\d]/g, "");
  return Array.from(new Set([
    fromPhone,
    digits,
    digits.length === 10 ? `+1${digits}` : fromPhone,
    digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : fromPhone,
  ]));
}

/**
 * Resolve only against LeadFlow-owned records. A missing or ambiguous match
 * remains unresolved; this helper never selects a legacy job source or mutates data.
 */
export async function resolveMadisonContext(
  fromPhone: string,
  isCleaner: boolean,
  senderName: string | undefined,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): Promise<MadisonResolvedContext> {
  if (isCleaner) return { isCleaner: true, senderName, cleanerPhone: fromPhone };

  const candidates = buildMadisonPhoneCandidates(fromPhone);
  try {
    const bookingsForPhone = await db
      .select({
        id: bookings.id,
        customerName: bookings.customerName,
        customerPhone: bookings.customerPhone,
        requestedLocalDate: bookings.requestedLocalDate,
        requestedLocalTime: bookings.requestedLocalTime,
      })
      .from(bookings)
      .where(inArray(bookings.customerPhone, candidates))
      .orderBy(desc(bookings.createdAt))
      .limit(2);

    const jobsForPhone = await db
      .select({
        id: leadflowJobs.id,
        bookingId: leadflowJobs.bookingId,
        customerName: leadflowJobs.customerName,
        customerPhone: leadflowJobs.customerPhone,
        serviceDateTime: leadflowJobs.serviceDateTime,
        teamName: leadflowJobs.teamName,
      })
      .from(leadflowJobs)
      .where(and(
        inArray(leadflowJobs.customerPhone, candidates),
        notInArray(leadflowJobs.bookingStatus, ["cancelled", "rescheduled"]),
      ))
      .orderBy(desc(leadflowJobs.updatedAt))
      .limit(2);

    const [job] = jobsForPhone;
    const bookingTargets = new Set(
      jobsForPhone.map((candidate) => candidate.bookingId).filter((id): id is number => id != null),
    );
    const bookingIsAmbiguous = bookingsForPhone.length > 1 && bookingTargets.size === 0;
    const jobIsAmbiguous = jobsForPhone.length > 1 && bookingTargets.size > 1;
    if (bookingIsAmbiguous || jobIsAmbiguous) {
      return {
        isCleaner: false,
        senderName,
        customerName: senderName,
      };
    }
    const booking = job?.bookingId
      ? bookingsForPhone.find((candidate) => candidate.id === job.bookingId)
      : bookingsForPhone[0];

    const resolvedName = booking?.customerName ?? job?.customerName ?? senderName;
    return {
      isCleaner: false,
      senderName: resolvedName,
      customerName: resolvedName,
      bookingId: booking?.id ?? job?.bookingId ?? undefined,
      leadflowJobId: job?.id,
      serviceDateTime: job?.serviceDateTime ?? (booking ? `${booking.requestedLocalDate} ${booking.requestedLocalTime}` : undefined),
      teamName: job?.teamName,
    };
  } catch (error) {
    console.warn("[MadisonContext] LeadFlow lookup failed:", error);
    return { isCleaner: false, senderName, customerName: senderName };
  }
}

export async function getMadisonEtaProgress(
  leadflowJobId: number,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
) {
  const [progress] = await db
    .select({
      etaTimeStr: cleanerPortalJobProgress.etaTimeStr,
      etaTimestamp: cleanerPortalJobProgress.etaTimestamp,
      jobStatus: cleanerPortalJobProgress.jobStatus,
    })
    .from(cleanerPortalJobProgress)
    .where(eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobId))
    .limit(1);
  return progress ?? null;
}

export async function getMadisonBookingPayment(
  bookingId: number,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
) {
  const [booking] = await db
    .select({
      paymentStatus: bookings.paymentStatus,
      paymentMethod: bookings.paymentMethod,
      status: bookings.status,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return booking ?? null;
}
