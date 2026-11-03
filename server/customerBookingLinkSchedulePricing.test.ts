import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANONICAL_TIME_SLOTS, CANONICAL_TIME_SLOT_LABELS } from "../shared/canonicalBooking";
import { calculatePublicBookingPrice, type PublicBookingPricingInput } from "../shared/publicBookingPricing";

const root = resolve(import.meta.dirname, "..");
const page = readFileSync(resolve(root, "client/src/pages/CustomerBookingLinkLive.tsx"), "utf8");
const book = readFileSync(resolve(root, "client/src/pages/Book.tsx"), "utf8");

const input: PublicBookingPricingInput = {
  pricingMode: "home", serviceId: "standard", bedrooms: 1, bathrooms: 1,
  homeType: "House", condition: 6, maidCount: 2, hourCount: 2,
  extras: [{ id: "inside-fridge", quantity: 2 }], recurrence: "one-time",
};

describe("personalized booking time and recurrence parity", () => {
  it("uses the exact same five arrival labels and shared selector on both pages", () => {
    expect(CANONICAL_TIME_SLOT_LABELS).toEqual(["8:30 AM", "10:30 AM", "12:30 PM", "2:30 PM", "4:30 PM"]);
    expect(CANONICAL_TIME_SLOTS).toEqual(["08:30", "10:30", "12:30", "14:30", "16:30"]);
    expect(book).toContain("export function BookingArrivalWindowSelector(");
    expect(book.match(/<BookingArrivalWindowSelector/g)).toHaveLength(1);
    expect(page).toContain("<BookingArrivalWindowSelector selectedTime={selectedArrivalWindow}");
    expect(page).toContain("setSelectedTime(timeLabelTo24Hour(time))");
    expect(page).not.toContain('new Set([requestedTime, "13:00"])');
    expect(page).not.toContain("timeOfDayLabel");
  });

  it("formats local arrival values by canonical labels, never by converting them through a browser timezone", () => {
    const formatTime = page.slice(page.indexOf("const formatTime ="), page.indexOf("const dollars ="));
    expect(formatTime).toContain("CANONICAL_TIME_SLOT_LABELS.find");
    expect(formatTime).toContain("timeLabelTo24Hour(slot) === value");
    expect(formatTime).not.toContain("new Date");
    expect(formatTime).not.toContain("Intl.DateTimeFormat");
    expect(page).toContain("requestedLocalTime: selectedTime");
  });

  it("offers all recurring frequencies from /book and computes dollars saved against the recurring base", () => {
    expect(book).toContain("export const FREQUENCY_OPTIONS:");
    expect(page).toContain('FREQUENCY_OPTIONS.filter(option => option.id !== "one-time")');
    expect(page).toContain("calculatePublicBookingPrice({ ...pricing, recurrence: option.id })");
    expect(page).toContain("price.futureVisitBaseTotalCents - (price.futureVisitTotalCents ?? price.futureVisitBaseTotalCents)");
    expect(page).toContain("option.price.discountPercent");
    expect(page).not.toContain("biweeklySavings * 26");
    expect(page).not.toContain("Every 4 weeks");
  });

  it.each([
    ["weekly", 20, 15_100],
    ["biweekly", 15, 16_100],
    ["monthly", 10, 17_000],
  ] as const)("keeps %s pricing identical to the existing calculator with first-visit condition/extras", (recurrence, discount, future) => {
    const price = calculatePublicBookingPrice({ ...input, recurrence });
    expect(price.firstCleaningTotalCents).toBe(29_800);
    expect(price.futureVisitBaseTotalCents).toBe(18_900);
    expect(price.discountPercent).toBe(discount);
    expect(price.futureVisitTotalCents).toBe(future);
  });

  it("retains the approved first-cleaning-only custom override rather than silently changing global recurring pricing", () => {
    const price = calculatePublicBookingPrice({ ...input, customPriceCents: 10_000, recurrence: "biweekly" });
    expect(price.firstCleaningTotalCents).toBe(10_000);
    expect(price.futureVisitBaseTotalCents).toBe(18_900);
    expect(price.futureVisitTotalCents).toBe(16_100);
  });
});
