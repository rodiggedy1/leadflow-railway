import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { leadflowJobs } from "../drizzle/schema";
import type { LiveTextSyncSummary } from "../shared/liveTextMonitor";
import { getDb } from "./db";
import { isValidAuditDate } from "./dailyActionAuditEngine";
import type { Launch27Booking } from "./launch27";
import { launch27BookingToLeadflowJob } from "./leadflowJobsService";
import { runLiveTextSyncTransaction } from "./liveTextMonitorSyncTransaction";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type PersistenceResult = Pick<
  LiveTextSyncSummary,
  "created" | "updated" | "protectedRecords" | "complete"
> & {
  /** Internal receipt: only actual source rows successfully written in this transaction. */
  refreshedJobIds: number[];
};
const SOURCE_ORIGIN = "launch27_import";
const MAX_DB_INT = 2_147_483_647;
const MAX_SOURCE_BOOKINGS = 500;

function validId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_DB_INT
  );
}
function sourceError(): never {
  // Do not expose customer/provider payloads in errors.
  throw new Error(
    "Live text sync source values are invalid or outside the selected date."
  );
}
function validText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.length <= max && !value.includes("\0")
  );
}
function validTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => validText(item, 65_535));
}
function validCount(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= MAX_DB_INT)
  );
}

/** Match the source's explicit local/date-only contract without assigning an
 * arbitrary offset/time; qualified instants retain their real Eastern date. */
function validSourceDate(value: string, target: string): boolean {
  const calendar = (date: string) => !date.startsWith("0000") && isValidAuditDate(date);
  if (calendar(value)) return value === target;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || !calendar(match[1]) || +match[2] > 23 || +match[3] > 59 || +(match[4] ?? 0) > 59) return false;
  if (!match[5]) return match[1] === target;
  if (match[5] !== "Z") {
    const hours = +match[5].slice(1, 3), minutes = +match[5].slice(4);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return false;
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  return `${part("year")?.padStart(4, "0")}-${part("month")}-${part("day")}` === target;
}

/** Validate and snapshot all inputs before acquiring a connection or starting writes. */
function sourceValues(booking: Launch27Booking, date: string) {
  if (
    !booking ||
    typeof booking !== "object" ||
    !validId(booking.id) ||
    !validText(booking.serviceDate, 50) ||
    !validSourceDate(booking.serviceDate, date) ||
    !validText(booking.fullName, 255) ||
    !validText(booking.phone, 30) ||
    !validText(booking.email, 320) ||
    !validText(booking.address, 500) ||
    !validText(booking.frequency, 100) ||
    !validText(booking.bookingStatus, 50) ||
    !booking.bookingStatus.trim() ||
    !validTextList(booking.serviceNames) ||
    booking.serviceNames.join(", ").length > 500 ||
    !validTextList(booking.extras) ||
    Buffer.byteLength(JSON.stringify(booking.extras), "utf8") > 65_535 ||
    !validCount(booking.bedrooms) ||
    !validCount(booking.bathrooms) ||
    !validText(booking.customerNotes, 65_535) ||
    Buffer.byteLength(booking.customerNotes, "utf8") > 65_535 ||
    !validText(booking.staffNotes, 65_535) ||
    typeof booking.totalRevenue !== "number" ||
    !Number.isFinite(booking.totalRevenue) ||
    booking.totalRevenue < 0 ||
    !Number.isSafeInteger(Math.round(booking.totalRevenue * 100)) ||
    Math.round(booking.totalRevenue * 100) > MAX_DB_INT ||
    typeof booking.hasStripeCard !== "boolean" ||
    !(booking.paymentBrand === null || validText(booking.paymentBrand, 50)) ||
    !(booking.paymentLast4 === null || validText(booking.paymentLast4, 4)) ||
    !Array.isArray(booking.teams) ||
    booking.teams.some(
      team => !team || !validId(team.id) || !validText(team.title, 255)
    ) ||
    booking.teams
      .map(team => team.title)
      .filter(Boolean)
      .join(", ").length > 255
  )
    sourceError();
  // The pure mapper is the only reused part of the old importer. The returned
  // scalar/JSON snapshot cannot change while the transaction awaits a query.
  return { ...launch27BookingToLeadflowJob(booking, date), bookingId: null };
}

/**
 * Persist a caller's freshly fetched, fully validated selected-date source list.
 * No provider calls, matching by contact, synthetic recurrence, absent marking,
 * merge/delete, canonical booking, assignment, message or payment writes.
 *
 * An owned public mysql2 lease bounds checkout, every statement and transaction
 * close to one 15s budget, destroying the lease on timeout. Source size caps
 * writes at 500. The existing shared getDb pool and settings stay untouched.
 */
export async function persistLiveTextSyncDate(
  date: string,
  bookings: Launch27Booking[],
  db?: Db
): Promise<PersistenceResult> {
  if (!isValidAuditDate(date) || !Array.isArray(bookings)) sourceError();
  if (bookings.length > MAX_SOURCE_BOOKINGS) {
    throw new Error(
      "Live text sync source exceeds the 500-booking safety limit."
    );
  }
  const mapped = bookings.map(booking => sourceValues(booking, date));
  const sourceIds = mapped
    .map(values => values.launch27BookingId)
    .sort((a, b) => a - b);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error(
      "Live text sync source contains duplicate stable booking IDs."
    );
  }
  if (!mapped.length)
    return {
      created: 0,
      updated: 0,
      protectedRecords: 0,
      complete: true,
      refreshedJobIds: [],
    };

  return runLiveTextSyncTransaction(async () => db ?? await getDb(), async tx => {
    // ALL bindings, across every date/origin/native linkage, locked and checked
    // before the first write. Never LIMIT 1, never search household placeholders.
    const bindings = await tx
      .select({
        id: leadflowJobs.id,
        launch27BookingId: leadflowJobs.launch27BookingId,
        origin: leadflowJobs.origin,
        bookingId: leadflowJobs.bookingId,
      })
      .from(leadflowJobs)
      .where(inArray(leadflowJobs.launch27BookingId, sourceIds))
      .orderBy(asc(leadflowJobs.launch27BookingId), asc(leadflowJobs.id))
      .for("update");
    const bySourceId = new Map<number, (typeof bindings)[number]>();
    const localIds = new Set<number>();
    for (const binding of bindings) {
      if (
        !validId(binding.id) ||
        !validId(binding.launch27BookingId) ||
        !sourceIds.includes(binding.launch27BookingId) ||
        localIds.has(binding.id) ||
        bySourceId.has(binding.launch27BookingId)
      ) {
        throw new Error(
          "Live text sync found invalid or duplicate stable booking bindings."
        );
      }
      localIds.add(binding.id);
      bySourceId.set(binding.launch27BookingId, binding);
    }

    const result: PersistenceResult = {
      created: 0,
      updated: 0,
      protectedRecords: 0,
      complete: true,
      refreshedJobIds: [],
    };
    for (const values of mapped) {
      const existing = bySourceId.get(values.launch27BookingId);
      if (existing) {
        if (existing.origin !== SOURCE_ORIGIN || existing.bookingId !== null) {
          result.protectedRecords++;
          result.complete = false;
          continue;
        }
        // Explicit allowlist, NOT mapper spread: preserve binding/series,
        // recurrence/workflow/reviews/payroll and all existing amount/card data.
        const updated = await tx
          .update(leadflowJobs)
          .set({
            jobDate: values.jobDate,
            serviceDateTime: values.serviceDateTime,
            customerName: values.customerName,
            customerPhone: values.customerPhone,
            customerEmail: values.customerEmail,
            jobAddress: values.jobAddress,
            serviceName: values.serviceName,
            bedrooms: values.bedrooms,
            bathrooms: values.bathrooms,
            extras: values.extras,
            bookingStatus: values.bookingStatus,
            teamName: values.teamName,
            teamId: values.teamId,
            // Only a positively matched source row can clear its missing marker.
            missingFromLaunch27At: null,
          })
          .where(
            and(
              eq(leadflowJobs.id, existing.id),
              eq(leadflowJobs.launch27BookingId, values.launch27BookingId),
              eq(leadflowJobs.origin, SOURCE_ORIGIN),
              isNull(leadflowJobs.bookingId)
            )
          );
        if (updated[0].affectedRows !== 1)
          throw new Error(
            "Live text sync source binding changed before update."
          );
        result.updated++;
        result.refreshedJobIds.push(existing.id);
      } else {
        // Real source booking only. A duplicate insert race is allowed to throw;
        // the entire selected date rolls back, with no retry or raced-row update.
        const inserted = await tx.insert(leadflowJobs).values(values);
        const insertedId = inserted[0].insertId;
        if (!validId(insertedId))
          throw new Error(
            "Live text sync did not receive a valid inserted job ID."
          );
        result.created++;
        result.refreshedJobIds.push(insertedId);
      }
    }
    // The owner returns this receipt only after an acknowledged in-budget COMMIT.
    return result;
  });
}
