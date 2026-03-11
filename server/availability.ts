/**
 * Availability Slot Utility
 *
 * Returns the next N available days starting from tomorrow,
 * skipping Sundays (day 0). Saturday is included.
 *
 * Example (today = Monday):  → ["Tuesday", "Wednesday"]
 * Example (today = Friday):  → ["Saturday", "Monday"]
 * Example (today = Saturday): → ["Monday", "Tuesday"]
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface AvailableSlot {
  label: string;        // e.g. "Tuesday, March 12"
  shortLabel: string;   // e.g. "Tuesday"
  date: Date;
}

/**
 * Returns the next `count` available days starting from tomorrow.
 * Skips Sundays. All other days (Mon–Sat) are considered available.
 */
export function getNextAvailableSlots(count = 2, fromDate?: Date): AvailableSlot[] {
  const slots: AvailableSlot[] = [];
  const cursor = fromDate ? new Date(fromDate) : new Date();

  // Start from tomorrow
  cursor.setDate(cursor.getDate() + 1);
  cursor.setHours(0, 0, 0, 0);

  while (slots.length < count) {
    const dayOfWeek = cursor.getDay(); // 0 = Sunday

    if (dayOfWeek !== 0) {
      // Not Sunday — it's available
      const dayName = DAY_NAMES[dayOfWeek]!;
      const month = cursor.toLocaleString("en-US", { month: "long" });
      const dateNum = cursor.getDate();

      slots.push({
        label: `${dayName}, ${month} ${dateNum}`,
        shortLabel: dayName,
        date: new Date(cursor),
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return slots;
}

/**
 * Formats two slots into the availability question text.
 * e.g. "We currently have openings Tuesday or Wednesday. Would one of those work for you?"
 */
export function formatAvailabilityQuestion(slots: AvailableSlot[]): string {
  if (slots.length === 0) return "When would you like to schedule your cleaning?";
  if (slots.length === 1) return `We currently have an opening ${slots[0]!.shortLabel}. Would that work for you?`;

  return `We currently have openings ${slots[0]!.shortLabel} or ${slots[1]!.shortLabel}. Would one of those work for you?`;
}

/**
 * Formats two slots into the guided choice question.
 * e.g. "Great — I can reserve:\nTuesday\nWednesday\nWhich would you prefer?"
 */
export function formatSlotChoiceQuestion(slots: AvailableSlot[]): string {
  if (slots.length === 0) return "What day works best for you?";
  if (slots.length === 1) return `Great — I can reserve ${slots[0]!.label}. Does that work?`;

  return `Great — I can reserve:\n${slots[0]!.label}\n${slots[1]!.label}\nWhich would you prefer?`;
}
