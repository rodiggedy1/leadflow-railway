const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function getTimeZoneParts(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(new Date(utcMs));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour") % 24,
    minute: value("minute"),
    second: value("second"),
  };
}

function getUtcOffsetMs(utcMs: number, timeZone: string): number {
  const local = getTimeZoneParts(utcMs, timeZone);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - utcMs;
}

export function businessLocalDateTimeToUtcMs(localDate: string, localTime: string, timeZone: string): number {
  const dateMatch = DATE_PATTERN.exec(localDate);
  const timeMatch = TIME_PATTERN.exec(localTime);
  if (!dateMatch || !timeMatch) throw new Error("Requested date or time is malformed.");

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const roughUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstPass = roughUtc - getUtcOffsetMs(roughUtc, timeZone);
  const utcMs = roughUtc - getUtcOffsetMs(firstPass, timeZone);
  const roundTrip = getTimeZoneParts(utcMs, timeZone);

  if (
    roundTrip.year !== year ||
    roundTrip.month !== month ||
    roundTrip.day !== day ||
    roundTrip.hour !== hour ||
    roundTrip.minute !== minute
  ) {
    throw new Error("Requested local time does not exist in the business timezone.");
  }

  return utcMs;
}
