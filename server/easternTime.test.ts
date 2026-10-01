import { describe, expect, it } from "vitest";
import {
  easternCalendarWeekday,
  easternDateIso,
  easternDateIsoFromDate,
  parseEasternDate,
} from "../shared/easternTime";

describe("booking Eastern-time calendar contract", () => {
  it("uses the Eastern calendar date even when the UTC date has already rolled over", () => {
    expect(easternDateIso(new Date("2026-10-02T03:30:00.000Z"))).toBe("2026-10-01");
    expect(easternDateIso(new Date("2026-10-02T03:30:00.000Z"), 1)).toBe("2026-10-02");
  });

  it("round-trips booking dates without browser-local timezone drift", () => {
    const date = parseEasternDate("2026-11-01");
    expect(easternDateIsoFromDate(date)).toBe("2026-11-01");
    expect(easternCalendarWeekday(2026, 10, 1)).toBe(0);
  });
});
