import { BOOKING_TIME_ZONE, easternDateIso } from "../../shared/easternTime";
import { businessLocalDateTimeToUtcMs } from "../utils/businessTime";
import { normalizePhone } from "../utils/phone";

export type VoiceBookingRecord = {
  source: "leadflow_job" | "native_booking";
  id: number;
  bookingId?: number | null;
  customerName: string | null;
  customerPhone: string | null;
  date: string | null;
  serviceDateTime: string | null;
  localTime?: string | null;
  timeZone?: string | null;
  startAt?: number | null;
  serviceName: string | null;
  address: string | null;
  teamName: string | null;
  status: string | null;
  progressStatus?: string | null;
  etaTimeStr?: string | null;
  etaTimestamp?: number | null;
  missingFromSourceAt?: Date | string | null;
};

export type VoiceCustomerContact = {
  source: "customer_account" | "booking_funnel";
  id: number;
  customerName: string | null;
  customerPhone: string | null;
};

export type VoiceBookingContextBooking = {
  source: VoiceBookingRecord["source"];
  id: number;
  bookingId?: number | null;
  jobDate: string;
  timing: "today" | "upcoming" | "historical";
  customerName?: string;
  serviceTime?: string;
  serviceType?: string;
  address?: string;
  teamName?: string;
  bookingStatus?: string;
  etaInfo?: string;
};

export type VoiceCustomerBookingContext = {
  found: boolean;
  hasUpcomingBooking: boolean;
  customerName?: string;
  jobDate?: string;
  serviceTime?: string;
  serviceType?: string;
  address?: string;
  teamName?: string;
  bookingStatus?: string;
  etaInfo?: string;
  upcomingBooking: VoiceBookingContextBooking | null;
  previousBooking: VoiceBookingContextBooking | null;
  currentLocalDate: string;
  message: string;
};

const text = (value: string | null | undefined) => value?.trim() || undefined;
const status = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TERMINAL = new Set(["cancelled", "canceled", "completed", "rescheduled", "missing_from_launch27", "expired"]);

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  } catch { return false; }
}

function instant(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !validDate(value.slice(0, 10))) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function clock(ms: number, timeZone = BOOKING_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

function zoneDate(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

type Dated = { record: VoiceBookingRecord; date: string; time?: string; verifiedSchedule: boolean };
function dated(record: VoiceBookingRecord): Dated | null {
  if (!validDate(record.date)) return null;
  const result: Dated = { record, date: record.date, verifiedSchedule: false };
  try {
    const zone = record.timeZone || BOOKING_TIME_ZONE;
    if (record.source === "native_booking") {
      if (!record.timeZone || !record.localTime || !TIME.test(record.localTime) || !Number.isSafeInteger(record.startAt)) return result;
      const ms = record.startAt!;
      // Round-trip the persisted instant, including either valid side of a DST fold.
      businessLocalDateTimeToUtcMs(record.date, record.localTime, zone);
      if (zoneDate(ms, zone) !== record.date || clock(ms, zone) !== record.localTime || ms % 60_000 !== 0) return result;
      if (record.serviceDateTime && instant(record.serviceDateTime) !== ms) return result;
      result.date = easternDateIso(new Date(ms));
      result.time = clock(ms);
      result.verifiedSchedule = true;
      return result;
    }
    let ms: number | undefined;
    if (record.serviceDateTime) {
      const value = record.serviceDateTime;
      const parsed = instant(value);
      if (parsed !== null) {
        ms = parsed;
      } else if (/^\d{4}-\d{2}-\d{2}[ T]([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) {
        ms = businessLocalDateTimeToUtcMs(value.slice(0, 10), value.slice(11, 16), zone);
      } else return result;
      // jobDate is the operational New York business date, never a naive UTC slice.
      const actualDate = easternDateIso(new Date(ms));
      if (actualDate !== record.date) return { ...result, date: actualDate, time: clock(ms) };
      result.time = clock(ms);
      if (record.localTime && record.localTime !== clock(ms, zone)) return result;
    } else if (record.localTime) {
      if (!TIME.test(record.localTime)) return result;
      ms = businessLocalDateTimeToUtcMs(record.date, record.localTime, zone);
      if (easternDateIso(new Date(ms)) !== record.date) return result;
      result.time = clock(ms);
    }
    result.verifiedSchedule = true;
  } catch { /* Bad calendars, timezone names and DST gaps are not appointments. */ }
  return result;
}

function completed(record: VoiceBookingRecord): boolean {
  return status(record.status) === "completed" || status(record.progressStatus) === "completed";
}
function active(item: Dated): boolean {
  const record = item.record;
  if (!item.verifiedSchedule || completed(record) || record.missingFromSourceAt != null || TERMINAL.has(status(record.status))) return false;
  // Launch27 documents assigned; unknown source statuses do not prove confirmation.
  return record.source === "native_booking" ? status(record.status) === "confirmed" : status(record.status) === "assigned";
}
function chronological(a: Dated, b: Dated): number {
  return a.date.localeCompare(b.date) || (a.time ?? "23:59").localeCompare(b.time ?? "23:59")
    || a.record.id - b.record.id || a.record.source.localeCompare(b.record.source);
}

function summary(item: Dated, timing: VoiceBookingContextBooking["timing"], now: Date): VoiceBookingContextBooking {
  const record = item.record;
  const result: VoiceBookingContextBooking = {
    source: record.source, id: record.id, jobDate: item.date, timing,
    ...(record.bookingId !== undefined ? { bookingId: record.bookingId } : {}),
  };
  const fields = { customerName: text(record.customerName), serviceTime: item.time, serviceType: text(record.serviceName),
    address: text(record.address), teamName: text(record.teamName), bookingStatus: text(record.status) };
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) Object.assign(result, { [key]: value });
  // A bare ETA clock has no date provenance. Only a still-current timestamp on today's verified visit is safe.
  if (timing === "today" && typeof record.etaTimestamp === "number" && Number.isFinite(record.etaTimestamp)
    && record.etaTimestamp >= now.getTime()) {
    try {
      if (easternDateIso(new Date(record.etaTimestamp)) === item.date) {
        result.etaInfo = `ETA: ${new Intl.DateTimeFormat("en-US", { timeZone: BOOKING_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(record.etaTimestamp))}`;
      }
    } catch { /* Invalid ETA is omitted, never used as arrival evidence. */ }
  }
  return result;
}

/** Pure display projection over fresh caller-filtered SELECT rows; no I/O, writes or identity merging. */
export function projectVoiceCustomerBookingContext({ phone, bookings, contacts, now = new Date() }: {
  phone: string;
  bookings: VoiceBookingRecord[];
  contacts: VoiceCustomerContact[];
  now?: Date;
}): VoiceCustomerBookingContext {
  const currentLocalDate = easternDateIso(now);
  const normalized = typeof phone === "string" ? normalizePhone(phone) : null;
  const matched = normalized ? bookings.filter(record => normalizePhone(record.customerPhone) === normalized) : [];
  const matchedContacts = normalized ? contacts.filter(record => normalizePhone(record.customerPhone) === normalized) : [];
  const found = matched.length > 0 || matchedContacts.length > 0;
  const allDated = matched.map(dated).filter((item): item is Dated => item !== null);
  // Only stable native booking IDs establish counterparts; names, phone/date pairs and job IDs do not.
  const blockedBookingIds = new Set(matched.filter(record => record.source === "native_booking"
    && (status(record.status) !== "confirmed" || completed(record) || record.missingFromSourceAt != null))
    .map(record => record.bookingId ?? record.id));
  const eligible = allDated.filter(item => item.date >= currentLocalDate && active(item)
    && !(item.record.source === "leadflow_job" && item.record.bookingId != null && blockedBookingIds.has(item.record.bookingId)))
    .sort(chronological);
  const historical = allDated.filter(item => item.date < currentLocalDate || item.date === currentLocalDate && completed(item.record))
    .sort((a, b) => chronological(b, a));
  const namedContact = (source: VoiceCustomerContact["source"]) => matchedContacts.filter(item => item.source === source && text(item.customerName))
    .sort((a, b) => a.id - b.id)[0]?.customerName;
  const customerName = text(namedContact("customer_account"))
    ?? eligible.map(item => text(item.record.customerName)).find(Boolean)
    ?? [...allDated].sort((a, b) => chronological(b, a)).map(item => text(item.record.customerName)).find(Boolean)
    ?? matched.map(record => text(record.customerName)).find(Boolean)
    ?? text(namedContact("booking_funnel"));
  const upcomingBooking = eligible[0] ? summary(eligible[0], eligible[0].date === currentLocalDate ? "today" : "upcoming", now) : null;
  const previousBooking = historical[0] ? summary(historical[0], "historical", now) : null;
  const greeting = customerName ? `Hello ${customerName}. ` : "";
  const message = !found ? "No matching customer was found."
    : upcomingBooking ? `${greeting}Verified booking ${upcomingBooking.timing === "today" ? "today" : `on ${upcomingBooking.jobDate}`}${upcomingBooking.serviceTime ? ` at ${upcomingBooking.serviceTime}` : ""}.`
    : `${greeting}Known customer; no verified upcoming booking. A new quote or booking can be requested.`;
  const result: VoiceCustomerBookingContext = { found, hasUpcomingBooking: upcomingBooking !== null, upcomingBooking, previousBooking, currentLocalDate, message };
  if (customerName) result.customerName = customerName;
  if (upcomingBooking) {
    const { jobDate, serviceTime, serviceType, address, teamName, bookingStatus, etaInfo } = upcomingBooking;
    Object.assign(result, { jobDate });
    for (const [key, value] of Object.entries({ serviceTime, serviceType, address, teamName, bookingStatus, etaInfo })) {
      if (value !== undefined) Object.assign(result, { [key]: value });
    }
  }
  return result;
}
