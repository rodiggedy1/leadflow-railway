/**
 * Deterministic customer avatar assignment.
 *
 * Uses a djb2 hash of the last 10 digits of the customer's phone number,
 * modulo 20, to pick one of 20 pre-defined avatar images.
 *
 * Same phone → same avatar, always. No DB lookup required.
 * Avatars are served as static files from /avatars/01.png … /avatars/20.png
 */

const AVATAR_COUNT = 20;

/**
 * djb2 string hash — fast, no imports, uniform distribution.
 * Returns an unsigned 32-bit integer.
 */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h;
}

/**
 * Normalize a phone number to its last 10 digits.
 * Handles E.164 (+17025551234), formatted (702-555-1234), etc.
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/**
 * Returns the URL path for the avatar assigned to this phone number.
 * e.g. "/avatars/07.png"
 *
 * Returns null if phone is empty/invalid (caller should show initial circle fallback).
 */
export function getCustomerAvatarUrl(phone: string): string | null {
  const digits = normalizePhone(phone);
  if (digits.length < 7) return null; // too short to be a real phone
  const index = (djb2(digits) % AVATAR_COUNT) + 1; // 1–20
  const padded = String(index).padStart(2, "0"); // "01"–"20"
  return `/avatars/${padded}.png`;
}
