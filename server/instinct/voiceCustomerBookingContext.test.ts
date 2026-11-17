import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { businessLocalDateTimeToUtcMs } from "../utils/businessTime";
import { projectVoiceCustomerBookingContext as project, type VoiceBookingRecord, type VoiceCustomerContact } from "./voiceCustomerBookingContext";

const phone = "3029816191";
const now = new Date("2026-11-17T18:00:00Z");
function job(patch: Partial<VoiceBookingRecord> = {}): VoiceBookingRecord {
  return { source: "leadflow_job", id: 1, customerName: "Returning Customer", customerPhone: phone,
    date: "2026-11-18", serviceDateTime: "2026-11-18T15:00:00Z", serviceName: "Standard cleaning",
    address: "123 Main St", teamName: "Team A", status: "assigned", ...patch };
}
function native(patch: Partial<VoiceBookingRecord> = {}): VoiceBookingRecord {
  return job({ source: "native_booking", status: "confirmed", localTime: "10:00", timeZone: "America/New_York",
    startAt: businessLocalDateTimeToUtcMs("2026-11-18", "10:00", "America/New_York"), ...patch });
}
function contact(patch: Partial<VoiceCustomerContact> = {}): VoiceCustomerContact {
  return { source: "customer_account", id: 9, customerName: "Account Name", customerPhone: phone, ...patch };
}
function context(bookings: VoiceBookingRecord[], contacts: VoiceCustomerContact[] = []) {
  return project({ phone, bookings, contacts, now });
}
afterEach(() => vi.useRealTimers());

describe("voice customer booking context", () => {
  it("recognizes the reported Oct 31 customer on Nov 17 without presenting history as an appointment", () => {
    const result = context([job({ date: "2026-10-31", serviceDateTime: "2026-10-31T14:00:00Z", etaTimeStr: "10:30 AM",
      etaTimestamp: Date.parse("2026-10-31T14:30:00Z") })]);
    expect(result).toMatchObject({ found: true, hasUpcomingBooking: false, upcomingBooking: null,
      currentLocalDate: "2026-11-17", previousBooking: { timing: "historical", jobDate: "2026-10-31", bookingStatus: "assigned" } });
    for (const key of ["jobDate", "serviceTime", "serviceType", "address", "teamName", "bookingStatus", "etaInfo"]) expect(result).not.toHaveProperty(key);
    expect(result.message).toContain("Hello Returning Customer");
    expect(result.message).toContain("no verified upcoming booking");
    expect(result.message).not.toContain("2026-10-31");
    expect(result.previousBooking).not.toHaveProperty("etaInfo");
  });
  it("selects the nearest eligible visit, independently retaining the most recent history", () => {
    const result = context([job({ id: 30, date: "2026-11-30", serviceDateTime: "2026-11-30T15:00:00Z" }),
      job({ id: 9, date: "2026-10-31", serviceDateTime: "2026-10-31T14:00:00Z" }), job({ id: 4 })]);
    expect(result.upcomingBooking?.id).toBe(4);
    expect(result.previousBooking?.id).toBe(9);
    expect(result.jobDate).toBe("2026-11-18");
  });
  it.each(["completed", "cancelled", "canceled", "rescheduled", "missing_from_launch27", "expired", "needs_attention", "pending_payment", "draft", "unknown"])("does not promote future imported status %s", status => {
    const result = context([job({ status })]);
    expect(result.found).toBe(true);
    expect(result.hasUpcomingBooking).toBe(false);
    expect(result.previousBooking).toBeNull();
  });
  it("excludes completed progress and missing-source markers regardless of assigned status", () => {
    for (const patch of [{ progressStatus: "COMPLETED" }, { missingFromSourceAt: new Date() }, { missingFromSourceAt: "2026-11-17" }]) {
      expect(context([job(patch)]).hasUpcomingBooking).toBe(false);
    }
  });
  it("recognizes an unfinished funnel contact without inventing a booking", () => {
    const result = context([], [contact({ source: "booking_funnel", customerName: "Funnel Name" })]);
    expect(result).toMatchObject({ found: true, customerName: "Funnel Name", hasUpcomingBooking: false, upcomingBooking: null, previousBooking: null });
    expect(result).not.toHaveProperty("jobDate");
  });
  it("accepts only a confirmed native visit with complete consistent requested schedule", () => {
    expect(context([native()]).upcomingBooking).toMatchObject({ source: "native_booking", serviceTime: "10:00" });
    for (const patch of [{ status: "needs_attention" }, { status: "pending_payment" }, { status: "draft" }, { status: "expired" },
      { startAt: null }, { localTime: null }, { timeZone: null }, { timeZone: "invalid" }, { localTime: "11:00" },
      { startAt: Date.parse("2026-11-19T15:00:00Z") }, { serviceDateTime: "2026-11-18T16:00:00Z" }]) {
      expect(context([native(patch)]).hasUpcomingBooking).toBe(false);
    }
  });
  it("matches normalized phone exactly, not names, and never merges record IDs", () => {
    const result = context([job({ id: 3, bookingId: 88, customerName: "Different Name", customerPhone: "+1 (302) 981-6191" }),
      job({ id: 4, customerName: "Account Name", customerPhone: "7035551234" })], [contact()]);
    expect(result.customerName).toBe("Account Name");
    expect(result.upcomingBooking).toMatchObject({ id: 3, bookingId: 88, customerName: "Different Name" });
  });
  it.each(["cancelled", "canceled", "completed", "expired", "needs_attention", "pending_payment", "draft"])("blocks linked assigned jobs when their native booking is %s", status => {
    expect(context([job({ id: 70, bookingId: 88 }), native({ id: 88, bookingId: 88, status })]).hasUpcomingBooking).toBe(false);
    // Same date/phone but a different stable booking is not a counterpart.
    expect(context([job({ id: 70, bookingId: 89 }), native({ id: 88, bookingId: 88, status })]).upcomingBooking?.id).toBe(70);
  });
  it.each(["", "bad", null, undefined, 3029816191])("safely rejects invalid runtime phone %s", value => {
    expect(project({ phone: value as string, bookings: [job()], contacts: [contact()], now })).toMatchObject({ found: false, hasUpcomingBooking: false, upcomingBooking: null });
  });
  it.each(["+443029816191", "+493029816191", "23029816191", "9816191", "302981619100"])("rejects foreign or partial suffix %s", customerPhone => {
    expect(context([job({ customerPhone })], [contact({ customerPhone })]).found).toBe(false);
    expect(project({ phone: customerPhone, bookings: [job()], contacts: [], now }).found).toBe(false);
  });
  it("uses account, earliest eligible named visit, latest dated name, then funnel name", () => {
    const rows = [job({ id: 3, customerName: "Later", date: "2026-11-30", serviceDateTime: null }), job({ id: 2, customerName: "Nearest" }),
      job({ id: 1, customerName: "History", date: "2026-10-31", serviceDateTime: null })];
    expect(context(rows, [contact()]).customerName).toBe("Account Name");
    expect(context(rows).customerName).toBe("Nearest");
    expect(context([rows[2]], [contact({ source: "booking_funnel", customerName: "Funnel" })]).customerName).toBe("History");
  });
  it("labels an uncompleted past-start today visit as today, never future or history", () => {
    const result = context([job({ date: "2026-11-17", serviceDateTime: "2026-11-17T13:00:00Z" })]);
    expect(result.upcomingBooking).toMatchObject({ timing: "today", jobDate: "2026-11-17", serviceTime: "08:00" });
    expect(result.previousBooking).toBeNull();
    expect(result.message).toContain("today");
    expect(result.message).not.toContain("future");
  });
  it("treats completed today as historical but does not infer completion for old assigned visits", () => {
    const result = context([job({ date: "2026-11-17", serviceDateTime: "2026-11-17T13:00:00Z", progressStatus: "completed" })]);
    expect(result.upcomingBooking).toBeNull();
    expect(result.previousBooking?.timing).toBe("historical");
  });
  it("uses New York business dates across midnight UTC and actual timestamp date conflicts", () => {
    const result = project({ phone, bookings: [job({ date: "2026-11-17", serviceDateTime: "2026-11-18T02:00:00Z" })], contacts: [], now: new Date("2026-11-18T01:00:00Z") });
    expect(result.currentLocalDate).toBe("2026-11-17");
    expect(result.upcomingBooking?.timing).toBe("today");
    const conflict = context([job({ date: "2026-11-18", serviceDateTime: "2026-11-17T02:00:00Z" })]);
    expect(conflict.upcomingBooking).toBeNull();
    expect(conflict.previousBooking?.jobDate).toBe("2026-11-16");
  });
  it("computes runtime today on every call, never captures the module boot date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T18:00:00Z"));
    const args = { phone, bookings: [job()], contacts: [] };
    expect(project(args).hasUpcomingBooking).toBe(true);
    vi.setSystemTime(new Date("2026-11-19T18:00:00Z"));
    expect(project(args)).toMatchObject({ currentLocalDate: "2026-11-19", hasUpcomingBooking: false, upcomingBooking: null });
  });
  it.each([null, "", "2026-02-29", "2026-11-31", "2026-13-01", "2026-00-01", "2026-11-00", "11/18/2026", "2026-11-18T00:00:00Z"])("never promotes malformed date %s", date => {
    expect(context([job({ date })])).toMatchObject({ found: true, customerName: "Returning Customer", hasUpcomingBooking: false, upcomingBooking: null, previousBooking: null });
  });
  it("validates local datetime, timezone, DST gaps and malformed UTC schedule values", () => {
    for (const patch of [{ serviceDateTime: "not-a-date" }, { serviceDateTime: "2026-11-18T99:00:00Z" },
      { serviceDateTime: "2026-11-31T15:00:00Z" }, { serviceDateTime: "2026-11-18 25:00:00" },
      { serviceDateTime: "2026-11-18 10:00:00", timeZone: "invalid" }]) expect(context([job(patch)]).hasUpcomingBooking).toBe(false);
    expect(context([native({ date: "2026-11-19", localTime: "00:00", timeZone: "UTC",
      startAt: Date.parse("2026-11-19T00:00:00Z"), serviceDateTime: "2026-11-18T24:00:00Z" })]).hasUpcomingBooking).toBe(false);
    expect(project({ phone, bookings: [job({ date: "2027-03-14", serviceDateTime: "2027-03-14 02:30:00" })], contacts: [], now }).hasUpcomingBooking).toBe(false);
  });
  it("orders by date, local time and stable ID, including date-only imported rows", () => {
    expect(context([job({ id: 9 }), job({ id: 2 }), job({ id: 1, serviceDateTime: "2026-11-18T16:00:00Z" })]).upcomingBooking?.id).toBe(2);
    expect(context([job({ serviceDateTime: null })]).hasUpcomingBooking).toBe(true);
  });
  it("exposes ETA only with a current today timestamp, never stale or future-day ETA text", () => {
    const timestamp = Date.parse("2026-11-17T18:30:00Z");
    expect(context([job({ etaTimestamp: timestamp, etaTimeStr: "1:30 PM" })])).not.toHaveProperty("etaInfo");
    const today = { date: "2026-11-17", serviceDateTime: "2026-11-17T15:00:00Z" };
    expect(context([job({ ...today, etaTimestamp: timestamp })]).etaInfo).toContain("1:30 PM");
    for (const etaTimestamp of [null, Date.parse("2026-11-16T18:30:00Z"), Date.parse("2026-11-17T17:00:00Z"), Date.parse("2026-11-18T18:30:00Z")]) {
      expect(context([job({ ...today, etaTimestamp, etaTimeStr: "1:30 PM" })])).not.toHaveProperty("etaInfo");
    }
  });
  it("does not mutate frozen caller rows or arrays", () => {
    const bookings = [Object.freeze(job({ id: 3 })), Object.freeze(job({ id: 1 }))];
    const contacts = [Object.freeze(contact())];
    const before = JSON.stringify({ bookings, contacts });
    Object.freeze(bookings); Object.freeze(contacts);
    context(bookings, contacts);
    expect(JSON.stringify({ bookings, contacts })).toBe(before);
  });
  it("has no arbitrary cutoff even when eligible data follows more than 50 historical records", () => {
    const rows = Array.from({ length: 80 }, (_, id) => job({ id, date: "2026-10-31", serviceDateTime: "2026-10-31T14:00:00Z" }));
    rows.push(job({ id: 100 }));
    expect(context(rows).upcomingBooking?.id).toBe(100);
    expect(context(rows.slice(0, 80))).toMatchObject({ found: true, hasUpcomingBooking: false, previousBooking: { id: 79 } });
  });
  it("returns unknown callers without adopting any other customer", () => {
    expect(project({ phone: "7035551234", bookings: [job()], contacts: [contact()], now })).toMatchObject({ found: false, hasUpcomingBooking: false, upcomingBooking: null, previousBooking: null });
  });
  it("imports only verified pure helper modules, not application services or data access", () => {
    const source = readFileSync(new URL("./voiceCustomerBookingContext.ts", import.meta.url), "utf8");
    expect(source.match(/^import .+ from .+;$/gm)).toEqual([
      'import { BOOKING_TIME_ZONE, easternDateIso } from "../../shared/easternTime";',
      'import { businessLocalDateTimeToUtcMs } from "../utils/businessTime";',
      'import { normalizePhone } from "../utils/phone";',
    ]);
  });
});
