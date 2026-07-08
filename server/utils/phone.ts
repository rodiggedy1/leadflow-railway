/**
 * server/utils/phone.ts
 *
 * Single authoritative phone normalization utility for the entire codebase.
 *
 * RULE: Every place in the application that normalizes, validates, or formats
 * a phone number MUST use the functions in this file. No inline normalization
 * logic is permitted anywhere else.
 *
 * This is a prerequisite for the SMS Campaign planner, which relies on
 * phoneNormalized as the canonical customerKey for deduplication, opt-out
 * checks, and the unique constraint on sms_campaign_recipients.
 *
 * When completedJobs.phoneNormalized is eventually added as a stored/generated
 * column, the planner will switch to PARTITION BY phoneNormalized with zero
 * logic changes — the interface contract is already correct.
 */

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Strips all non-digit characters and extracts exactly 10 US local digits.
 *
 * Accepts:
 *   - 10-digit strings:  "7035551234"
 *   - 11-digit strings starting with 1: "17035551234", "+17035551234"
 *   - Formatted strings: "(703) 555-1234", "703-555-1234", "703.555.1234"
 *
 * Rejects (returns null):
 *   - Non-US country codes (e.g. +44, +256)
 *   - 11-digit strings starting with anything other than 1
 *   - Numbers where NPA (area code) or NXX (exchange) start with 0 or 1
 *   - Strings shorter than 10 digits or longer than 11 digits
 *
 * @returns 10-digit local string (e.g. "7035551234") or null if invalid
 */
export function extractUSDigits(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  let local: string;

  if (digits.length === 11 && digits.startsWith("1")) {
    local = digits.slice(1);
  } else if (digits.length === 10) {
    local = digits;
  } else {
    return null; // wrong length or non-US country code
  }

  const npa = local[0]; // area code first digit
  const nxx = local[3]; // exchange first digit
  if (!npa || !nxx) return null;
  if (npa < "2" || nxx < "2") return null; // 0xx or 1xx are invalid NANP

  return local;
}

/**
 * Returns true if the raw phone string resolves to a valid 10-digit US number.
 */
export function isValidUSPhone(phone: string): boolean {
  return extractUSDigits(phone) !== null;
}

/**
 * Normalizes a phone number to E.164 format (+1XXXXXXXXXX).
 *
 * This is the canonical customerKey used throughout the application for:
 *   - Deduplication (sms_campaign_recipients.uq_campaign_phone)
 *   - Opt-out checks (alwaysOnEnrollments, conversationSessions.smsOptOut)
 *   - Customer View CTE (PARTITION BY phoneNormalized)
 *   - All opt-out and suppression lookups
 *
 * Accepts:
 *   - "7035551234"      → "+17035551234"
 *   - "703-555-1234"    → "+17035551234"
 *   - "(703) 555-1234"  → "+17035551234"
 *   - "+17035551234"    → "+17035551234"
 *   - "17035551234"     → "+17035551234"
 *
 * For invalid/non-US numbers: returns null.
 * Callers that previously returned a fallback string for invalid numbers
 * should handle null explicitly (log, skip, or flag as phoneInvalid).
 *
 * @returns E.164 string (e.g. "+17035551234") or null if not a valid US number
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const local = extractUSDigits(phone);
  if (local) return `+1${local}`;
  return null;
}

/**
 * Normalizes a phone number to E.164 format, with a legacy fallback.
 *
 * Use this ONLY in contexts where the existing code previously returned a
 * non-null string for invalid numbers (e.g. passing through "+44..." as-is).
 * Prefer normalizePhone() for all new code.
 *
 * @returns E.164 string if valid US number, otherwise the best-effort string
 */
export function normalizePhoneLegacy(phone: string): string {
  const local = extractUSDigits(phone);
  if (local) return `+1${local}`;
  // Legacy fallback: pass through as-is for non-US or malformed numbers
  const digits = phone.replace(/[^\d]/g, "");
  if (phone.startsWith("+")) return phone.replace(/[^\d+]/g, "");
  return `+${digits}`;
}

// ─── Display formatting ───────────────────────────────────────────────────────

/**
 * Formats a phone number for human-readable display.
 *
 * "+17035551234"  → "(703) 555-1234"
 * "7035551234"    → "(703) 555-1234"
 * "+447911123456" → "+447911123456" (non-US: returned as-is)
 *
 * @returns Formatted string, or the original input if not a valid US number
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return "";
  const local = extractUSDigits(phone);
  if (!local) return phone; // non-US or invalid — return as-is
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

/**
 * Formats a phone number as a dashed string.
 *
 * "+17035551234"  → "703-555-1234"
 * "7035551234"    → "703-555-1234"
 *
 * @returns Dashed string, or the original input if not a valid US number
 */
export function formatPhoneDashed(phone: string | null | undefined): string {
  if (!phone) return "";
  const local = extractUSDigits(phone);
  if (!local) return phone;
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

/**
 * Strips the +1 country code and returns just the 10-digit local number.
 * Used for display contexts where the country code is implied.
 *
 * "+17035551234" → "7035551234"
 * "7035551234"   → "7035551234"
 *
 * @returns 10-digit string, or the original input if not a valid US number
 */
export function stripCountryCode(phone: string | null | undefined): string {
  if (!phone) return "";
  const local = extractUSDigits(phone);
  return local ?? phone;
}
