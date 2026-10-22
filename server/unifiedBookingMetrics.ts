import { and, eq, gte, lt } from "drizzle-orm";
import { bookings, conversationSessions } from "../drizzle/schema";
import { getDb } from "./db";
import { normalizePhone } from "./utils/phone";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type UnifiedBookingDetail = {
  customerName: string | null;
  bookedByAgentId: number | null;
  bookedByAgentName: string | null;
  totalCents: number | null;
  phone: string;
};

/**
 * Single source of truth for Command Chat booking metrics.
 * Native bookings use createdAt; Command Chat bookings use bookedAt.
 * Both sources are deduplicated by normalized customer phone exactly once.
 */
export async function getUnifiedBookingDetails(
  db: Database,
  start: Date,
  endExclusive: Date,
): Promise<UnifiedBookingDetail[]> {
  const [nativeRows, sessionRows] = await Promise.all([
    db
      .select({
        status: bookings.status,
        customerName: bookings.customerName,
        customerPhone: bookings.customerPhone,
        bookedByAgentId: bookings.bookedByAgentId,
        bookedByAgentName: bookings.bookedByAgentName,
        totalCents: bookings.firstCleaningTotalCents,
      })
      .from(bookings)
      .where(and(
        gte(bookings.createdAt, start),
        lt(bookings.createdAt, endExclusive),
      )),
    db
      .select({
        leadName: conversationSessions.leadName,
        leadPhone: conversationSessions.leadPhone,
        bookedByAgentId: conversationSessions.bookedByAgentId,
        bookedByAgentName: conversationSessions.bookedByAgentName,
        bookedAmount: conversationSessions.bookedAmount,
      })
      .from(conversationSessions)
      .where(and(
        eq(conversationSessions.isBooked, 1),
        gte(conversationSessions.bookedAt, start),
        lt(conversationSessions.bookedAt, endExclusive),
      )),
  ]);

  const seenPhones = new Set<string>();
  return [
    ...nativeRows
      .filter((row) => !["cancelled", "canceled"].includes(row.status))
      .map((row) => ({
        customerName: row.customerName,
        bookedByAgentId: row.bookedByAgentId,
        bookedByAgentName: row.bookedByAgentName,
        totalCents: row.totalCents,
        phone: normalizePhone(row.customerPhone),
      })),
    ...sessionRows.map((row) => ({
      customerName: row.leadName,
      bookedByAgentId: row.bookedByAgentId,
      bookedByAgentName: row.bookedByAgentName,
      totalCents: row.bookedAmount == null ? null : Math.round(Number(row.bookedAmount) * 100),
      phone: normalizePhone(row.leadPhone),
    })),
  ].filter((row) => {
    const phone = row.phone || `unknown:${row.customerName ?? "customer"}`;
    if (seenPhones.has(phone)) return false;
    seenPhones.add(phone);
    return true;
  });
}
