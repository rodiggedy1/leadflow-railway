import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { cleanerJobs, conversationSessions, reactivationContacts, smsOptOuts } from "../../drizzle/schema";
import { normalizePhoneLegacy } from "../utils/phone";

type Db = any;

export type SmartUpsellRecipient = { name: string; phone: string; reason: string };
export type SmartUpsellCandidate = {
  moveKey: string;
  headline: string;
  businessReason: string;
  impact: string;
  eligibleCount: number;
  excludedCount: number;
  excludedReasons: string[];
  recipients: SmartUpsellRecipient[];
  draftMessage: string;
  targetDescription: string;
  details: string[];
  source: { jobDate: string };
};

const RECIPIENT_LIMIT = 30;
const RECENT_CONTACT_DAYS = 7;
const DAY_MS = 86_400_000;
const INSIDE_OVEN_EXTRA = "clean_inside_oven";

export function isStandardOrRegularCleaning(serviceType: string | null | undefined) {
  const normalized = serviceType?.trim().toLowerCase() ?? "";
  return normalized.includes("standard") || normalized.includes("regular");
}

/** Returns true only for the canonical inside-oven extra key; malformed extras are never treated as missing. */
export function hasInsideOvenExtra(extras: string | null | undefined) {
  if (!extras) return false;
  try {
    const parsed = JSON.parse(extras);
    return Array.isArray(parsed) && parsed.some((value) => typeof value === "string" && value.trim().toLowerCase() === INSIDE_OVEN_EXTRA);
  } catch {
    return null;
  }
}

async function loadSafetySets(db: Db) {
  const sevenDaysAgo = new Date(Date.now() - RECENT_CONTACT_DAYS * DAY_MS);
  const [globalStops, sessionStops, complaintRows, activeCsRows, recentCampaignRows] = await Promise.all([
    db.select({ phone: smsOptOuts.phone }).from(smsOptOuts),
    db.select({ phone: conversationSessions.leadPhone }).from(conversationSessions).where(eq(conversationSessions.smsOptOut, 1)),
    db.select({ phone: cleanerJobs.customerPhone }).from(cleanerJobs).where(sql`${cleanerJobs.customerComplaint} IS NOT NULL AND TRIM(${cleanerJobs.customerComplaint}) <> ''`),
    db.select({ phone: conversationSessions.leadPhone }).from(conversationSessions).where(and(eq(conversationSessions.stage, "OPEN"), sql`${conversationSessions.csResolvedAt} IS NULL`)),
    db.select({ phone: reactivationContacts.phone }).from(reactivationContacts).where(and(isNotNull(reactivationContacts.sentAt), gte(reactivationContacts.sentAt, sevenDaysAgo))),
  ]);
  const normalized = (phone: string | null | undefined) => normalizePhoneLegacy(phone ?? "") ?? "";
  return {
    stops: new Set([...globalStops, ...sessionStops].map((row) => normalized(row.phone)).filter(Boolean)),
    complaints: new Set(complaintRows.map((row) => normalized(row.phone)).filter(Boolean)),
    activeCs: new Set(activeCsRows.map((row) => normalized(row.phone)).filter(Boolean)),
    recentCampaigns: new Set(recentCampaignRows.map((row) => normalized(row.phone)).filter(Boolean)),
  };
}

/** Returns only safely contactable upcoming Standard/Regular bookings whose selected extras explicitly omit inside-oven cleaning. */
export async function getTomorrowOvenUpsellCandidate(db: Db, tomorrow: string): Promise<SmartUpsellCandidate | null> {
  const [safety, jobs] = await Promise.all([
    loadSafetySets(db),
    db.select({ bookingId: cleanerJobs.bookingId, customerName: cleanerJobs.customerName, customerPhone: cleanerJobs.customerPhone, serviceType: cleanerJobs.serviceType, extras: cleanerJobs.extras, serviceDateTime: cleanerJobs.serviceDateTime })
      .from(cleanerJobs)
      .where(and(eq(cleanerJobs.jobDate, tomorrow), sql`${cleanerJobs.bookingStatus} NOT IN ('cancelled', 'rescheduled')`))
      .orderBy(desc(cleanerJobs.serviceDateTime)).limit(250),
  ]);
  const recipients: SmartUpsellRecipient[] = [];
  const exclusions: string[] = [];
  const seenPhones = new Set<string>();
  const seenBookings = new Set<string>();
  for (const job of jobs) {
    const phone = normalizePhoneLegacy(job.customerPhone ?? "");
    const bookingKey = String(job.bookingId ?? "");
    const ovenSelected = hasInsideOvenExtra(job.extras);
    let reason = "";
    if (!phone) reason = "invalid phone";
    else if (seenPhones.has(phone) || (bookingKey && seenBookings.has(bookingKey))) reason = "duplicate booking";
    else if (!isStandardOrRegularCleaning(job.serviceType)) reason = "not a Standard or Regular Cleaning";
    else if (ovenSelected === true) reason = "inside-oven add-on already selected";
    else if (ovenSelected === null) reason = "selected extras could not be verified";
    else if (safety.stops.has(phone)) reason = "STOP opt-out";
    else if (safety.complaints.has(phone)) reason = "open complaint";
    else if (safety.activeCs.has(phone)) reason = "active customer-service conversation";
    else if (safety.recentCampaigns.has(phone)) reason = "contacted in a campaign within 7 days";
    if (reason) { exclusions.push(reason); continue; }
    seenPhones.add(phone);
    if (bookingKey) seenBookings.add(bookingKey);
    recipients.push({ name: job.customerName?.trim() || "Customer", phone, reason: "Standard or Regular Cleaning tomorrow with no inside-oven add-on selected" });
  }
  const eligible = recipients.slice(0, RECIPIENT_LIMIT);
  if (eligible.length === 0) return null;
  return {
    moveKey: `upsell:inside-oven:${tomorrow}`,
    headline: "Offer inside-oven cleaning for tomorrow",
    businessReason: `${eligible.length} customer${eligible.length === 1 ? " has" : "s have"} a verified Standard or Regular Cleaning tomorrow without the inside-oven add-on selected.`,
    impact: "Prepare relevant add-on offers before tomorrow’s services; each customer remains in your review control.",
    eligibleCount: eligible.length,
    excludedCount: exclusions.length,
    excludedReasons: Array.from(new Set(exclusions)).slice(0, 4),
    recipients: eligible,
    draftMessage: "Hi! Before your cleaning tomorrow, would you like to add an inside-oven clean to your service? Reply here and we’ll take care of it.",
    targetDescription: "tomorrow’s Standard or Regular Cleaning customers without the inside-oven add-on",
    details: ["Every recipient has a verified booking tomorrow.", "Their current booking is Standard or Regular Cleaning and does not include the canonical inside-oven extra.", "Recipients are rechecked immediately before sending."],
    source: { jobDate: tomorrow },
  };
}
