import { and, eq, gte, lt } from "drizzle-orm";
import { bookings, conversationSessions, opsChatMessages } from "../drizzle/schema";
import { getDb } from "./db";
import { normalizePhone } from "./utils/phone";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const MAX_MANUAL_BOOKING_DOLLARS = Math.floor(Number.MAX_SAFE_INTEGER / 100);

export type UnifiedBookingDetail = {
  customerName: string | null;
  bookedByAgentId: number | null;
  bookedByAgentName: string | null;
  totalCents: number | null;
  identityKey: string;
};

export function manualAnnouncementBookingFromMetadata(
  metadataText: string | null,
  messageId: number,
): UnifiedBookingDetail | null {
  try {
    const metadata: unknown = JSON.parse(metadataText ?? "{}");
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
    const value = metadata as Record<string, unknown>;
    const customerName = typeof value.personName === "string" ? value.personName.trim() : "";
    const bookedAmount = value.bookedAmount;
    const bookedByAgentMetricId = value.bookedByAgentMetricId;
    if (
      value.manualHeaderBooking !== true ||
      !customerName ||
      typeof bookedAmount !== "number" ||
      !Number.isSafeInteger(bookedAmount) ||
      bookedAmount <= 0 ||
      bookedAmount > MAX_MANUAL_BOOKING_DOLLARS
    ) return null;
    return {
      customerName,
      bookedByAgentId: typeof bookedByAgentMetricId === "number" && Number.isSafeInteger(bookedByAgentMetricId) && bookedByAgentMetricId > 0
        ? bookedByAgentMetricId
        : null,
      bookedByAgentName: typeof value.bookedByAgentMetricName === "string" ? value.bookedByAgentMetricName : null,
      totalCents: bookedAmount * 100,
      identityKey: `ops-chat-message:${messageId}`,
    };
  } catch {
    return null;
  }
}

/**
 * Single source of truth for Command Chat booking metrics.
 * Native bookings use createdAt; lead-card bookings use bookedAt; explicitly
 * marked Announce booking messages use their existing createdAt timestamp.
 * Native and lead-card bookings deduplicate by normalized customer phone; a
 * manual announcement has no phone and uses its persisted message ID once.
 */
export async function getUnifiedBookingDetails(
  db: Database,
  start: Date,
  endExclusive: Date,
): Promise<UnifiedBookingDetail[]> {
  const [nativeRows, sessionRows, manualAnnouncementRows] = await Promise.all([
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
    db
      .select({
        id: opsChatMessages.id,
        metadata: opsChatMessages.metadata,
      })
      .from(opsChatMessages)
      .where(and(
        eq(opsChatMessages.channel, "command"),
        eq(opsChatMessages.quickAction, "announce_booking"),
        gte(opsChatMessages.createdAt, start),
        lt(opsChatMessages.createdAt, endExclusive),
      )),
  ]);

  const manualAnnouncementDetails: UnifiedBookingDetail[] = [];
  for (const row of manualAnnouncementRows) {
    const detail = manualAnnouncementBookingFromMetadata(row.metadata, row.id);
    if (detail) manualAnnouncementDetails.push(detail);
  }

  const seenBookingKeys = new Set<string>();
  return [
    ...nativeRows
      .filter((row) => !["cancelled", "canceled"].includes(row.status))
      .map((row) => ({
        customerName: row.customerName,
        bookedByAgentId: row.bookedByAgentId,
        bookedByAgentName: row.bookedByAgentName,
        totalCents: row.totalCents,
        identityKey: normalizePhone(row.customerPhone) || `unknown:${row.customerName ?? "customer"}`,
      })),
    ...sessionRows.map((row) => ({
      customerName: row.leadName,
      bookedByAgentId: row.bookedByAgentId,
      bookedByAgentName: row.bookedByAgentName,
      totalCents: row.bookedAmount == null ? null : Math.round(Number(row.bookedAmount) * 100),
      identityKey: normalizePhone(row.leadPhone) || `unknown:${row.leadName ?? "customer"}`,
    })),
    ...manualAnnouncementDetails,
  ].filter((row) => {
    if (seenBookingKeys.has(row.identityKey)) return false;
    seenBookingKeys.add(row.identityKey);
    return true;
  });
}
