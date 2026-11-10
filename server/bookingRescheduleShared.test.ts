import { describe, expect, it } from "vitest";
import {
  BOOKING_RESCHEDULE_MODES, bookingRescheduleModeSchema, bookingRescheduleDateSchema,
  bookingRescheduleTimeSchema, isValidBookingRescheduleDate, isRecurringBookingFrequency,
  bookingDateShiftDays, shiftBookingDate,
} from "../shared/bookingReschedule";

describe("booking reschedule shared contract — pure offline tests", () => {
  it("accepts only the two explicit scope enum values", () => {
    expect(BOOKING_RESCHEDULE_MODES).toEqual(["visit", "subsequent"]);
    for (const mode of BOOKING_RESCHEDULE_MODES) expect(bookingRescheduleModeSchema.parse(mode)).toBe(mode);
    for (const mode of ["", "all", "future", "Visit", null, undefined, 1]) expect(bookingRescheduleModeSchema.safeParse(mode).success).toBe(false);
  });

  it.each(["2024-02-29", "2000-02-29", "2026-01-31", "2026-04-30", "2026-03-08", "2026-11-01"])("accepts genuine calendar day %s", date => {
    expect(isValidBookingRescheduleDate(date)).toBe(true);
    expect(bookingRescheduleDateSchema.parse(date)).toBe(date);
  });

  it.each(["2026-02-29", "1900-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "2026-01-32", "2026-1-01", "2026-01-1", " 2026-01-01", "2026-01-01T00:00:00Z", "not-a-date", ""])("rejects invalid/normalized date %s", date => {
    expect(isValidBookingRescheduleDate(date)).toBe(false);
    expect(bookingRescheduleDateSchema.safeParse(date).success).toBe(false);
  });

  it("validates strict zero-padded 24-hour HH:mm, not labels or seconds", () => {
    for (const time of ["00:00", "09:00", "12:35", "23:59"]) expect(bookingRescheduleTimeSchema.parse(time)).toBe(time);
    for (const time of ["24:00", "23:60", "-1:00", "9:00", "09:0", "09:00:00", "9 AM", " 09:00", "09:00 ", "", null, undefined]) expect(bookingRescheduleTimeSchema.safeParse(time).success).toBe(false);
  });

  it.each([
    "weekly", "Weekly", " WEEKLY ", "biweekly", "Bi-weekly", "bi weekly", "Bi–weekly", "Bi—weekly",
    "triweekly", "Tri-weekly", "tri weekly", "Tri–weekly", "Tri—weekly", "monthly", "Monthly", " MONTHLY ",
  ])("recognizes native and imported recurring spelling %s", frequency => {
    expect(isRecurringBookingFrequency(frequency)).toBe(true);
  });

  it.each([null, undefined, "", "one-time", "One time", "one_time", "ONE-TIME", "none"])("does not request a recurring scope choice for %s", frequency => {
    expect(isRecurringBookingFrequency(frequency)).toBe(false);
  });

  it.each([
    ["2026-03-07", "2026-03-09", 2], ["2026-10-31", "2026-11-02", 2],
    ["2024-02-28", "2024-03-01", 2], ["2026-02-28", "2026-03-01", 1],
    ["2026-12-31", "2027-01-01", 1], ["2026-03-01", "2026-02-28", -1],
    ["2026-11-10", "2026-11-10", 0],
  ] as const)("shifts %s → %s by %i calendar days across DST/month/year boundaries", (previous, requested, days) => {
    expect(bookingDateShiftDays(previous, requested)).toBe(days);
    expect(shiftBookingDate(previous, days)).toBe(requested);
    expect(shiftBookingDate(requested, -days)).toBe(previous);
  });

  it("rejects invalid input dates and fractional/non-finite shifts rather than normalizing", () => {
    expect(() => bookingDateShiftDays("2026-02-30", "2026-03-01")).toThrow();
    expect(() => bookingDateShiftDays("2026-03-01", "2026-02-30")).toThrow();
    expect(() => shiftBookingDate("2026-02-30", 1)).toThrow();
    for (const shift of [0.5, NaN, Infinity]) expect(() => shiftBookingDate("2026-03-01", shift)).toThrow();
  });
});
