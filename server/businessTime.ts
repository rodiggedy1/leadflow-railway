const BUSINESS_TIME_ZONE = "America/New_York";

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return (asUtc - date.getTime()) / 60_000;
}

/** Returns the UTC instant corresponding to midnight in the business timezone. */
export function getBusinessDayStart(now = new Date()): Date {
  const businessDate = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    businessDate
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  const localMidnightAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day)
  );
  const offsetAtNoon = getTimeZoneOffsetMinutes(
    new Date(localMidnightAsUtc + 12 * 60 * 60 * 1000),
    BUSINESS_TIME_ZONE
  );
  return new Date(localMidnightAsUtc - offsetAtNoon * 60_000);
}
