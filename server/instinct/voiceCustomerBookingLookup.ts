import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { bookingAssignments, bookingFunnelRecords, bookings, cleanerPortalJobProgress, customerPortalAccounts, leadflowJobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { extractUSDigits, normalizePhone } from "../utils/phone";
import { projectVoiceCustomerBookingContext, type VoiceBookingRecord, type VoiceCustomerBookingContext, type VoiceCustomerContact } from "./voiceCustomerBookingContext";

type VoiceBookingDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type VoiceCustomerBookingLookupResult = VoiceCustomerBookingContext & { lookupAvailable: boolean };

/** Read existing records only; no portal account, reservation, assignment or message is created. */
export async function readVoiceCustomerBookingContext(db: VoiceBookingDb, phone: string, now = new Date()): Promise<VoiceCustomerBookingContext> {
  const safePhone = typeof phone === "string" ? phone : "";
  const normalizedPhone = normalizePhone(safePhone);
  const digits = extractUSDigits(safePhone);
  if (!normalizedPhone || !digits) return projectVoiceCustomerBookingContext({ phone: safePhone, bookings: [], contacts: [], now });

  const [jobRows, nativeRows, accountRows, funnelRows] = await Promise.all([
    db.select({
      id: leadflowJobs.id,
      bookingId: leadflowJobs.bookingId,
      customerName: leadflowJobs.customerName,
      customerPhone: leadflowJobs.customerPhone,
      date: leadflowJobs.jobDate,
      serviceDateTime: leadflowJobs.serviceDateTime,
      serviceName: leadflowJobs.serviceName,
      address: leadflowJobs.jobAddress,
      teamName: leadflowJobs.teamName,
      status: leadflowJobs.bookingStatus,
      missingFromSourceAt: leadflowJobs.missingFromLaunch27At,
      progressStatus: cleanerPortalJobProgress.jobStatus,
      etaTimeStr: cleanerPortalJobProgress.etaTimeStr,
      etaTimestamp: cleanerPortalJobProgress.etaTimestamp,
    }).from(leadflowJobs)
      .leftJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id))
      .where(sql`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${digits}`)
      .orderBy(asc(leadflowJobs.jobDate), asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.id)),
    db.select({
      id: bookings.id,
      customerName: bookings.customerName,
      customerPhone: bookings.customerPhone,
      date: bookings.requestedLocalDate,
      localTime: bookings.requestedLocalTime,
      timeZone: bookings.requestedTimeZone,
      startAt: bookings.requestedStartAt,
      serviceName: bookings.serviceName,
      address: bookings.address,
      status: bookings.status,
    }).from(bookings).where(eq(bookings.customerPhone, normalizedPhone))
      .orderBy(asc(bookings.requestedStartAt), asc(bookings.id)),
    db.select({ id: customerPortalAccounts.id, customerName: customerPortalAccounts.customerName, customerPhone: customerPortalAccounts.customerPhone })
      .from(customerPortalAccounts).where(eq(customerPortalAccounts.customerPhone, normalizedPhone)),
    db.select({ id: bookingFunnelRecords.id, customerName: bookingFunnelRecords.customerName, customerPhone: bookingFunnelRecords.customerPhone })
      .from(bookingFunnelRecords).where(eq(bookingFunnelRecords.customerPhone, normalizedPhone))
      .orderBy(desc(bookingFunnelRecords.updatedAt), desc(bookingFunnelRecords.id)),
  ]);

  // Match the existing native booking reader's active-assignment status and ordering.
  const nativeIds = nativeRows.map(row => row.id);
  const assignments = nativeIds.length ? await db.select({ bookingId: bookingAssignments.bookingId, teamName: bookingAssignments.teamName })
    .from(bookingAssignments).where(and(inArray(bookingAssignments.bookingId, nativeIds), eq(bookingAssignments.status, "assigned")))
    .orderBy(desc(bookingAssignments.assignedAt), desc(bookingAssignments.id)) : [];
  const teams = new Map<number, string | null>();
  for (const assignment of assignments) if (!teams.has(assignment.bookingId)) teams.set(assignment.bookingId, assignment.teamName);

  const records: VoiceBookingRecord[] = [
    ...jobRows.map(row => ({ ...row, source: "leadflow_job" as const })),
    ...nativeRows.map(row => ({ ...row, source: "native_booking" as const, bookingId: row.id, serviceDateTime: null, teamName: teams.get(row.id) ?? null })),
  ];
  const contacts: VoiceCustomerContact[] = [
    ...accountRows.map(row => ({ ...row, source: "customer_account" as const })),
    ...funnelRows.map(row => ({ ...row, source: "booking_funnel" as const })),
  ];
  return projectVoiceCustomerBookingContext({ phone, bookings: records, contacts, now });
}

export async function lookupVoiceCustomerBookingContext(phone: string): Promise<VoiceCustomerBookingLookupResult> {
  const now = new Date();
  const safePhone = typeof phone === "string" ? phone : "";
  const empty = () => projectVoiceCustomerBookingContext({ phone: safePhone, bookings: [], contacts: [], now });
  if (!normalizePhone(safePhone)) return { ...empty(), lookupAvailable: false, message: "Invalid phone number. Do not infer a customer or appointment." };
  try {
    const db = await getDb();
    if (!db) return { ...empty(), lookupAvailable: false, message: "Booking lookup unavailable. This does not establish whether the caller has an upcoming booking." };
    return { ...await readVoiceCustomerBookingContext(db, phone, now), lookupAvailable: true };
  } catch (error) {
    console.error("[Vapi] lookupCustomer failed:", error instanceof Error ? error.message : String(error));
    return { ...empty(), lookupAvailable: false, message: "Unable to look up booking at this time. Do not treat this as confirmation that no upcoming booking exists." };
  }
}
