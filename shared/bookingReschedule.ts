import { z } from "zod";

export const BOOKING_RESCHEDULE_MODES = ["visit", "subsequent"] as const;
export type BookingRescheduleMode = (typeof BOOKING_RESCHEDULE_MODES)[number];
export const bookingRescheduleModeSchema = z.enum(BOOKING_RESCHEDULE_MODES);

export function isValidBookingRescheduleDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export const bookingRescheduleDateSchema = z
  .string()
  .refine(
    isValidBookingRescheduleDate,
    "Enter a valid booking date using YYYY-MM-DD."
  );
export const bookingRescheduleTimeSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    "Enter a valid booking time using HH:mm."
  );

export function isRecurringBookingFrequency(
  value: string | null | undefined
): boolean {
  const frequency = value?.toLowerCase().replace(/[–—]/g, "-").trim() ?? "";
  return frequency.includes("weekly") || frequency.includes("monthly");
}

export function bookingDateShiftDays(
  previousDate: string,
  requestedDate: string
): number {
  bookingRescheduleDateSchema.parse(previousDate);
  bookingRescheduleDateSchema.parse(requestedDate);
  return (
    (Date.parse(`${requestedDate}T00:00:00.000Z`) -
      Date.parse(`${previousDate}T00:00:00.000Z`)) /
    86_400_000
  );
}

export function shiftBookingDate(value: string, days: number): string {
  bookingRescheduleDateSchema.parse(value);
  if (!Number.isInteger(days))
    throw new Error("The booking date shift must use whole calendar days.");
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
