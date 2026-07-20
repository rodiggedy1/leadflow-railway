/**
 * conciergeTime.ts
 *
 * Shared date-resolution infrastructure for the AI Concierge.
 *
 * Design principle: QueryPlan.timeScope is the SINGLE source of truth for
 * natural-language time interpretation. Every downstream consumer (texting,
 * querying, ETA, scheduling) calls resolveServiceDateRange() instead of
 * parsing English or calling new Date() independently.
 *
 * All arithmetic is performed on the canonical ET service date string
 * (YYYY-MM-DD) returned by getTodayET(). No mixing of new Date() with
 * toLocaleDateString() after the initial anchor is established.
 */

import type { TimeScope } from "./conciergeQuery";

// ── Canonical ET date anchor ──────────────────────────────────────────────────

/**
 * Returns today's date in the America/New_York timezone as a YYYY-MM-DD string.
 * This is the single canonical "today" for all Concierge date logic.
 */
export function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ── Pure date arithmetic ──────────────────────────────────────────────────────

/**
 * Offset a YYYY-MM-DD service date by N calendar days.
 * All arithmetic stays in the ET service-date timeline — no new Date() calls
 * after the anchor is established, so midnight/timezone boundaries cannot
 * produce a different "today" than getTodayET().
 */
export function offsetServiceDate(serviceDate: string, days: number): string {
  // Parse the YYYY-MM-DD string as a UTC midnight date to avoid DST shifts
  const [y, m, d] = serviceDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// ── Service date range ────────────────────────────────────────────────────────

export interface ServiceDateRange {
  /** Inclusive start date, YYYY-MM-DD */
  startDate: string;
  /** Inclusive end date, YYYY-MM-DD (equals startDate for single-day scopes) */
  endDate: string;
}

/**
 * Convert a QueryPlan.timeScope into a concrete { startDate, endDate } range.
 *
 * This is the ONLY place in Concierge where TimeScope → date conversion happens.
 * Callers must not inspect timeScope.type or timeScope.specificDate themselves.
 *
 * Defaults to today for unrecognised / null scopes so callers always get a
 * valid range.
 */
export function resolveServiceDateRange(timeScope: TimeScope): ServiceDateRange {
  const today = getTodayET();

  switch (timeScope.type) {
    case "today":
      return { startDate: today, endDate: today };

    case "tomorrow":
      return { startDate: offsetServiceDate(today, 1), endDate: offsetServiceDate(today, 1) };

    case "yesterday":
      return { startDate: offsetServiceDate(today, -1), endDate: offsetServiceDate(today, -1) };

    case "this_week": {
      // ISO week: Monday → Sunday
      // Parse today to find its day-of-week in UTC (safe because we built it from UTC)
      const [y, m, d] = today.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const dow = dt.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
      const daysToMon = dow === 0 ? -6 : -(dow - 1); // offset to Monday
      const daysToSun = dow === 0 ? 0 : 7 - dow;     // offset to Sunday
      return {
        startDate: offsetServiceDate(today, daysToMon),
        endDate:   offsetServiceDate(today, daysToSun),
      };
    }

    case "last_week": {
      const [y, m, d] = today.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const dow = dt.getUTCDay();
      const daysToMon = dow === 0 ? -6 : -(dow - 1);
      return {
        startDate: offsetServiceDate(today, daysToMon - 7),
        endDate:   offsetServiceDate(today, daysToMon - 1),
      };
    }

    case "next_week": {
      const [y, m, d] = today.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const dow = dt.getUTCDay();
      const daysToMon = dow === 0 ? -6 : -(dow - 1);
      return {
        startDate: offsetServiceDate(today, daysToMon + 7),
        endDate:   offsetServiceDate(today, daysToMon + 13),
      };
    }

    case "this_month": {
      const [y, m] = today.split("-").map(Number);
      const firstDay = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
      // Last day: first day of next month minus 1
      const nextMonth = m === 12 ? 1 : m + 1;
      const nextYear  = m === 12 ? y + 1 : y;
      const firstOfNext = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
      return {
        startDate: firstDay,
        endDate:   offsetServiceDate(firstOfNext, -1),
      };
    }

    case "last_month": {
      const [y, m] = today.split("-").map(Number);
      const prevMonth = m === 1 ? 12 : m - 1;
      const prevYear  = m === 1 ? y - 1 : y;
      const firstDay = `${String(prevYear).padStart(4, "0")}-${String(prevMonth).padStart(2, "0")}-01`;
      const firstOfCurrent = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
      return {
        startDate: firstDay,
        endDate:   offsetServiceDate(firstOfCurrent, -1),
      };
    }

    case "specific_date":
      if (timeScope.specificDate) {
        return { startDate: timeScope.specificDate, endDate: timeScope.specificDate };
      }
      return { startDate: today, endDate: today };

    // "next_appointment", "last_appointment", "all_time", null, unknown
    default:
      return { startDate: today, endDate: today };
  }
}
