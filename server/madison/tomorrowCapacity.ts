import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { cleanerJobs, completedJobs, conversationSessions, reactivationContacts, smsOptOuts } from "../../drizzle/schema";
import { isRecurringFrequency } from "../alwaysOnEngine";
import { normalizePhoneLegacy } from "../utils/phone";

type Db = any;

export type TomorrowCapacityRecipient = { name: string; phone: string; reason: string; lastBookingDate?: string | null };
export type TomorrowCapacityCandidate = {
  moveKey: string;
  headline: string;
  businessReason: string;
  impact: string;
  eligibleCount: number;
  excludedCount: number;
  excludedReasons: string[];
  recipients: TomorrowCapacityRecipient[];
  draftMessage: string;
  targetDescription: string;
  details: string[];
  source: { jobDate: string };
};

const DAILY_JOB_TARGET = 30;
const RECIPIENT_LIMIT = 30;
const DAY_MS = 86_400_000;

function easternDate() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** A customer with any stored active/future service or a later completed booking is not a former one-time target. */
export function bookingActivityExclusionReason(input: { candidateLastBookingDate: string | null; latestCompletedBookingDate: string | null; hasActiveOrFutureBooking: boolean }) {
  if (input.hasActiveOrFutureBooking) return "has an active or future booking";
  if (input.latestCompletedBookingDate && input.latestCompletedBookingDate !== input.candidateLastBookingDate) return "has a newer booking history";
  return null;
}

async function loadSafetySets(db: Db) {
  const [globalStops, sessionStops, complaintRows, activeCsRows] = await Promise.all([
    db.select({ phone: smsOptOuts.phone }).from(smsOptOuts),
    db.select({ phone: conversationSessions.leadPhone }).from(conversationSessions).where(eq(conversationSessions.smsOptOut, 1)),
    db.select({ phone: cleanerJobs.customerPhone }).from(cleanerJobs)
      .where(sql`${cleanerJobs.customerComplaint} IS NOT NULL AND TRIM(${cleanerJobs.customerComplaint}) <> ''`),
    db.select({ phone: conversationSessions.leadPhone }).from(conversationSessions)
      .where(and(eq(conversationSessions.stage, "OPEN"), sql`${conversationSessions.csResolvedAt} IS NULL`)),
  ]);
  const normalize = (phone: string | null | undefined) => normalizePhoneLegacy(phone ?? "") ?? "";
  return {
    stops: new Set([...globalStops, ...sessionStops].map((row) => normalize(row.phone)).filter(Boolean)),
    complaints: new Set(complaintRows.map((row) => normalize(row.phone)).filter(Boolean)),
    activeCs: new Set(activeCsRows.map((row) => normalize(row.phone)).filter(Boolean)),
  };
}

/** Reads the already synced tomorrow schedule; only active, distinct bookings count toward the 30-job target. */
async function countVerifiedTomorrowBookings(db: Db, tomorrow: string) {
  const rows = await db.select({ id: cleanerJobs.id, bookingId: cleanerJobs.bookingId })
    .from(cleanerJobs)
    .where(and(eq(cleanerJobs.jobDate, tomorrow), sql`${cleanerJobs.bookingStatus} NOT IN ('cancelled', 'rescheduled')`));
  return new Set(rows.map((row) => String(row.bookingId ?? row.id))).size;
}

/** Reuses the curated reactivation pool and excludes any contact with current safety or recent-campaign concerns. */
async function selectSafePastOneTimeCustomers(db: Db): Promise<{ recipients: TomorrowCapacityRecipient[]; exclusions: string[] }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
  const [{ stops, complaints, activeCs }, rows, recentCampaignRows] = await Promise.all([
    loadSafetySets(db),
    db.select({ phone: completedJobs.phone, name: completedJobs.name, firstName: completedJobs.firstName, frequency: completedJobs.frequency, status: completedJobs.status, jobDate: completedJobs.jobDate })
      .from(completedJobs)
      .where(and(eq(completedJobs.reactivationEligible, 1), eq(completedJobs.phoneInvalid, 0), isNotNull(completedJobs.phone), isNotNull(completedJobs.jobDate)))
      .orderBy(desc(completedJobs.jobDate)).limit(1000),
    db.select({ phone: reactivationContacts.phone }).from(reactivationContacts)
      .where(and(isNotNull(reactivationContacts.sentAt), gte(reactivationContacts.sentAt, sevenDaysAgo))),
  ]);
  const storedCandidatePhones = Array.from(new Set(rows.map((row) => row.phone).filter((phone): phone is string => Boolean(phone))));
  const [bookingHistoryRows, activeOrFutureBookingRows] = storedCandidatePhones.length > 0
    ? await Promise.all([
      db.select({ phone: completedJobs.phone, jobDate: completedJobs.jobDate }).from(completedJobs)
        .where(inArray(completedJobs.phone, storedCandidatePhones)),
      db.select({ phone: cleanerJobs.customerPhone }).from(cleanerJobs)
        .where(and(gte(cleanerJobs.jobDate, easternDate()), sql`(${cleanerJobs.bookingStatus} IS NULL OR ${cleanerJobs.bookingStatus} NOT IN ('cancelled', 'rescheduled', 'completed'))`)),
    ])
    : [[], []];
  const recentlyMessaged = new Set(recentCampaignRows.map((row) => normalizePhoneLegacy(row.phone ?? "")).filter(Boolean));
  const latestCompletedBookingDate = new Map<string, string>();
  for (const row of bookingHistoryRows) {
    const phone = normalizePhoneLegacy(row.phone ?? "");
    if (phone && row.jobDate && (row.jobDate > (latestCompletedBookingDate.get(phone) ?? ""))) latestCompletedBookingDate.set(phone, row.jobDate);
  }
  const activeOrFutureBookingPhones = new Set(activeOrFutureBookingRows.map((row) => normalizePhoneLegacy(row.phone ?? "")).filter(Boolean));
  const recipients: TomorrowCapacityRecipient[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const phone = normalizePhoneLegacy(row.phone ?? "");
    let reason = "";
    if (!phone) reason = "invalid phone";
    else if (seen.has(phone)) reason = "duplicate customer";
    else if (row.status === "OPTED_OUT" || stops.has(phone)) reason = "STOP opt-out";
    else if (complaints.has(phone)) reason = "open complaint";
    else if (activeCs.has(phone)) reason = "active customer-service conversation";
    else if (recentlyMessaged.has(phone)) reason = "contacted in a campaign within 7 days";
    else {
      const bookingExclusion = bookingActivityExclusionReason({ candidateLastBookingDate: row.jobDate, latestCompletedBookingDate: latestCompletedBookingDate.get(phone) ?? null, hasActiveOrFutureBooking: activeOrFutureBookingPhones.has(phone) });
      if (bookingExclusion) reason = bookingExclusion;
      else if (isRecurringFrequency(row.frequency)) reason = "not a previous one-time customer";
    }
    if (reason) { exclusions.push(reason); continue; }
    seen.add(phone);
    recipients.push({ name: row.name?.trim() || row.firstName?.trim() || "Customer", phone, reason: "Previous one-time customer with no newer booking", lastBookingDate: row.jobDate });
  }
  return { recipients: recipients.slice(0, RECIPIENT_LIMIT), exclusions };
}

/** Purely formats a review-first candidate; it never persists a move or sends a message. */
export function buildTomorrowCapacityCandidate(input: { tomorrow: string; bookedJobs: number; recipients: TomorrowCapacityRecipient[]; exclusions: string[] }): TomorrowCapacityCandidate | null {
  const jobsNeeded = Math.max(DAILY_JOB_TARGET - input.bookedJobs, 0);
  if (jobsNeeded === 0 || input.recipients.length === 0) return null;
  const recipients = input.recipients.slice(0, RECIPIENT_LIMIT);
  return {
    moveKey: `capacity:${input.tomorrow}`,
    headline: "Fill tomorrow’s capacity",
    businessReason: `Tomorrow has ${input.bookedJobs} verified scheduled job${input.bookedJobs === 1 ? "" : "s"}, which is ${jobsNeeded} below your ${DAILY_JOB_TARGET}-job target.`,
    impact: `Review ${recipients.length} safe previous one-time customer${recipients.length === 1 ? "" : "s"} who have not rebooked recently to help recover ${jobsNeeded} job${jobsNeeded === 1 ? "" : "s"}.`,
    eligibleCount: recipients.length,
    excludedCount: input.exclusions.length,
    excludedReasons: Array.from(new Set(input.exclusions)).slice(0, 4),
    recipients,
    draftMessage: "Hi! We have availability tomorrow and wanted to see whether you would like to get another cleaning scheduled. Reply here and we’ll help find a time that works for you.",
    targetDescription: "safe previous one-time customers who have not rebooked recently",
    details: [`Verified scheduled jobs: ${input.bookedJobs} of ${DAILY_JOB_TARGET} target.`, `Goal: recover ${jobsNeeded} additional job${jobsNeeded === 1 ? "" : "s"} to reach the target.`, `Review pool: up to ${RECIPIENT_LIMIT} safe former one-time customers.`, "Recipients are rechecked immediately before sending."],
    source: { jobDate: input.tomorrow },
  };
}

export async function getTomorrowCapacityCandidate(db: Db, tomorrow: string): Promise<TomorrowCapacityCandidate | null> {
  const [bookedJobs, selection] = await Promise.all([
    countVerifiedTomorrowBookings(db, tomorrow),
    selectSafePastOneTimeCustomers(db),
  ]);
  return buildTomorrowCapacityCandidate({ tomorrow, bookedJobs, ...selection });
}
