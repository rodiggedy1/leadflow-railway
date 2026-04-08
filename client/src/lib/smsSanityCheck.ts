/**
 * smsSanityCheck.ts
 * Pure client-side date/time sanity checks for outbound CS SMS messages.
 * No network calls — all deterministic regex + date math.
 */

export interface SanityWarning {
  type: "wrong_day_of_week" | "implausible_time" | "date_mismatch";
  message: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function resolveYear(month0: number, day: number): number {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();
  // If the month is already past this year, and we're in Nov or Dec, assume next year
  if (month0 < curMonth && curMonth >= 10) return curYear + 1;
  return curYear;
}

function parseDateFromText(text: string): Date | null {
  // Matches: "April 10", "April 10th", "Apr 10", "10 April", "10th of April"
  const monthDayRe = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;
  const dayMonthRe = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/gi;

  let m: RegExpExecArray | null;

  m = monthDayRe.exec(text);
  if (m) {
    const month0 = MONTH_MAP[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    if (month0 !== undefined && day >= 1 && day <= 31) {
      return new Date(resolveYear(month0, day), month0, day);
    }
  }

  m = dayMonthRe.exec(text);
  if (m) {
    const day = parseInt(m[1], 10);
    const month0 = MONTH_MAP[m[2].toLowerCase()];
    if (month0 !== undefined && day >= 1 && day <= 31) {
      return new Date(resolveYear(month0, day), month0, day);
    }
  }

  return null;
}

// ─── Check 1: Wrong day-of-week for a date ──────────────────────────────────
// Detects patterns like "Wednesday April 10" or "Monday the 15th"

function checkWrongDayOfWeek(text: string): SanityWarning[] {
  const warnings: SanityWarning[] = [];
  // Pattern: <dayname> <month> <day> or <dayname> the <day>
  const re = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:the\s+)?(?:(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const namedDay = m[1].toLowerCase();
    const monthStr = m[2]?.toLowerCase();
    const day = parseInt(m[3], 10);

    if (!monthStr) continue; // "Monday the 15th" without month — can't verify, skip

    const month0 = MONTH_MAP[monthStr];
    if (month0 === undefined || day < 1 || day > 31) continue;

    const year = resolveYear(month0, day);
    const date = new Date(year, month0, day);
    if (isNaN(date.getTime())) continue;

    const actualDay = DAY_NAMES[date.getDay()];
    if (actualDay !== namedDay) {
      const actualCapitalized = actualDay.charAt(0).toUpperCase() + actualDay.slice(1);
      const namedCapitalized = namedDay.charAt(0).toUpperCase() + namedDay.slice(1);
      const monthCapitalized = monthStr.charAt(0).toUpperCase() + monthStr.slice(1);
      warnings.push({
        type: "wrong_day_of_week",
        message: `"${namedCapitalized} ${monthCapitalized} ${day}" is actually a ${actualCapitalized} in ${year}.`,
      });
    }
  }
  return warnings;
}

// ─── Check 2: Implausible AM time ───────────────────────────────────────────
// Flag any AM time between 12:01 AM and 7:59 AM (no jobs before 8 AM)

function checkImplausibleTime(text: string): SanityWarning[] {
  const warnings: SanityWarning[] = [];
  // Matches: "3am", "3 am", "3:00am", "3:00 AM", "3:30 AM"
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*am\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const hour = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    // 12 AM = midnight (0), 1–7 AM = implausible
    const hour24 = hour === 12 ? 0 : hour;
    if (hour24 >= 0 && hour24 <= 7 && !(hour24 === 7 && min >= 0)) {
      // Flag 12:01 AM through 7:59 AM
      if (hour24 < 7 || (hour24 === 7 && min < 0)) {
        const display = m[2] ? `${m[1]}:${m[2]} AM` : `${m[1]} AM`;
        warnings.push({
          type: "implausible_time",
          message: `"${display}" looks like it should be PM — we don't schedule jobs before 8 AM.`,
        });
      }
    }
  }
  // Simpler pass: any hour 1–7 AM
  const re2 = /\b([1-7])(?::(\d{2}))?\s*am\b/gi;
  let m2: RegExpExecArray | null;
  const alreadyFlagged = new Set(warnings.map((w) => w.message));
  while ((m2 = re2.exec(text)) !== null) {
    const display = m2[2] ? `${m2[1]}:${m2[2]} AM` : `${m2[1]} AM`;
    const msg = `"${display}" looks like it should be PM — we don't schedule jobs before 8 AM.`;
    if (!alreadyFlagged.has(msg)) {
      warnings.push({ type: "implausible_time", message: msg });
      alreadyFlagged.add(msg);
    }
  }
  // Also flag 12 AM (midnight)
  const re3 = /\b12(?::(\d{2}))?\s*am\b/gi;
  let m3: RegExpExecArray | null;
  while ((m3 = re3.exec(text)) !== null) {
    const display = m3[1] ? `12:${m3[1]} AM` : `12 AM`;
    const msg = `"${display}" is midnight — did you mean PM?`;
    if (!alreadyFlagged.has(msg)) {
      warnings.push({ type: "implausible_time", message: msg });
      alreadyFlagged.add(msg);
    }
  }
  return warnings;
}

// ─── Check 3: Date mismatch vs conversation ──────────────────────────────────
// Scan recent customer messages for a confirmed date. If outbound mentions a different date, flag.

function checkDateMismatch(
  outbound: string,
  recentCustomerMessages: string[]
): SanityWarning[] {
  const outboundDate = parseDateFromText(outbound);
  if (!outboundDate) return []; // outbound has no parseable date — nothing to compare

  for (const msg of recentCustomerMessages) {
    const customerDate = parseDateFromText(msg);
    if (!customerDate) continue;
    if (
      customerDate.getFullYear() !== outboundDate.getFullYear() ||
      customerDate.getMonth() !== outboundDate.getMonth() ||
      customerDate.getDate() !== outboundDate.getDate()
    ) {
      const fmt = (d: Date) =>
        d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      return [
        {
          type: "date_mismatch",
          message: `You're confirming ${fmt(outboundDate)}, but the customer mentioned ${fmt(customerDate)} in the conversation.`,
        },
      ];
    }
    // Dates match — no warning needed
    return [];
  }
  return [];
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface SanityCheckInput {
  /** The outbound message text being sent */
  outbound: string;
  /** Recent customer (inbound) messages for date-mismatch check, newest first */
  recentCustomerMessages: string[];
}

export function runSmsSanityCheck(input: SanityCheckInput): SanityWarning[] {
  const { outbound, recentCustomerMessages } = input;
  const warnings: SanityWarning[] = [];

  warnings.push(...checkWrongDayOfWeek(outbound));
  warnings.push(...checkImplausibleTime(outbound));
  warnings.push(...checkDateMismatch(outbound, recentCustomerMessages));

  // Deduplicate by message text
  const seen = new Set<string>();
  return warnings.filter((w) => {
    if (seen.has(w.message)) return false;
    seen.add(w.message);
    return true;
  });
}
