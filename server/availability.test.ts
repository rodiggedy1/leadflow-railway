import { describe, it, expect } from "vitest";
import { getNextAvailableSlots, formatAvailabilityQuestion, formatSlotChoiceQuestion } from "./availability";

// Helper: create a date for a given day name this week
function dateForDay(dayName: string): Date {
  const days: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
    Thursday: 4, Friday: 5, Saturday: 6,
  };
  const target = days[dayName]!;
  const now = new Date("2026-03-09T12:00:00Z"); // Monday March 9 2026
  const diff = (target - now.getDay() + 7) % 7;
  const d = new Date(now);
  d.setDate(d.getDate() + diff);
  return d;
}

describe("getNextAvailableSlots", () => {
  it("returns 2 slots by default", () => {
    const slots = getNextAvailableSlots(2, new Date("2026-03-09T12:00:00Z")); // Monday
    expect(slots).toHaveLength(2);
  });

  it("starts from tomorrow (Monday → Tuesday, Wednesday)", () => {
    const slots = getNextAvailableSlots(2, new Date("2026-03-09T12:00:00Z")); // Monday
    expect(slots[0]!.shortLabel).toBe("Tuesday");
    expect(slots[1]!.shortLabel).toBe("Wednesday");
  });

  it("skips Sunday (Saturday → Monday, Tuesday)", () => {
    const slots = getNextAvailableSlots(2, new Date("2026-03-14T12:00:00Z")); // Saturday
    expect(slots[0]!.shortLabel).toBe("Monday");
    expect(slots[1]!.shortLabel).toBe("Tuesday");
  });

  it("skips Sunday when it falls in the middle (Friday → Saturday, Monday)", () => {
    const slots = getNextAvailableSlots(2, new Date("2026-03-13T12:00:00Z")); // Friday
    expect(slots[0]!.shortLabel).toBe("Saturday");
    expect(slots[1]!.shortLabel).toBe("Monday");
  });

  it("Sunday itself → Monday, Tuesday", () => {
    const slots = getNextAvailableSlots(2, new Date("2026-03-15T12:00:00Z")); // Sunday
    expect(slots[0]!.shortLabel).toBe("Monday");
    expect(slots[1]!.shortLabel).toBe("Tuesday");
  });

  it("includes the full label with date", () => {
    const slots = getNextAvailableSlots(2, new Date("2026-03-09T12:00:00Z")); // Monday
    expect(slots[0]!.label).toContain("Tuesday");
    expect(slots[0]!.label).toContain("March");
  });

  it("never returns a Sunday slot", () => {
    // Test across an entire week
    for (let i = 0; i < 7; i++) {
      const from = new Date("2026-03-09T12:00:00Z");
      from.setDate(from.getDate() + i);
      const slots = getNextAvailableSlots(2, from);
      for (const slot of slots) {
        expect(slot.shortLabel).not.toBe("Sunday");
        expect(slot.date.getDay()).not.toBe(0);
      }
    }
  });
});

describe("formatAvailabilityQuestion", () => {
  it("formats two slots correctly", () => {
    const slots = getNextAvailableSlots(2, new Date("2026-03-09T12:00:00Z")); // Monday
    const msg = formatAvailabilityQuestion(slots);
    expect(msg).toContain("Tuesday");
    expect(msg).toContain("Wednesday");
    expect(msg).toContain("Would one of those work");
  });

  it("handles empty slots gracefully", () => {
    const msg = formatAvailabilityQuestion([]);
    expect(msg).toBeTruthy();
  });
});

describe("formatSlotChoiceQuestion", () => {
  it("formats two slots as a choice", () => {
    const slots = getNextAvailableSlots(2, new Date("2026-03-09T12:00:00Z")); // Monday
    const msg = formatSlotChoiceQuestion(slots);
    expect(msg).toContain("Tuesday");
    expect(msg).toContain("Wednesday");
    expect(msg).toContain("Which would you prefer");
  });

  it("handles empty slots gracefully", () => {
    const msg = formatSlotChoiceQuestion([]);
    expect(msg).toBeTruthy();
  });
});
