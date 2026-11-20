import { easternDateIso, BOOKING_TIME_ZONE } from "../shared/easternTime";
import { shiftBookingDate } from "../shared/bookingReschedule";
import { teamEvidenceWeekInputSchema, type TeamEvidenceWeekInput, type TeamEvidenceWindow } from "../shared/teamLeaderboardEvidence";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";

/** Only the requested Sunday-start week, clipped at the supplied capture instant.
 * No payroll-week changes, browser dates or source timestamps are substituted. */
export function resolveTeamEvidenceWindow(input: TeamEvidenceWeekInput, now = new Date()): TeamEvidenceWindow {
  const { weekStart } = teamEvidenceWeekInputSchema.parse(input);
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid audit capture instant");
  const weekEnd = shiftBookingDate(weekStart, 6);
  const start = businessLocalDateTimeToUtcMs(weekStart, "00:00", BOOKING_TIME_ZONE);
  const fullEnd = businessLocalDateTimeToUtcMs(shiftBookingDate(weekStart, 7), "00:00", BOOKING_TIME_ZONE);
  if (start > now.getTime()) throw new Error("Cannot audit a future service week");
  return {
    weekStart, weekEnd, throughDate: [weekEnd, easternDateIso(now)].sort()[0],
    timeZone: BOOKING_TIME_ZONE,
    startInclusiveUtc: new Date(start).toISOString(),
    endExclusiveUtc: new Date(Math.min(fullEnd, now.getTime())).toISOString(),
    capturedAtUtc: now.toISOString(),
  };
}
