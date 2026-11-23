/** Quo's documented recipient formats, shared only by the native Thumbtack path. */
export const thumbtackSmsPhonePattern = /^(?:\+[1-9]\d{1,14}|\d{3,8})$/;

/** Formatting only: retain international/short-code inputs and prefix local US numbers.
 * No country whitelist, area-code/exchange check, or invented international minimum. */
export function normalizeThumbtackSmsPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().replace(/[\s().-]/g, "");
  if (thumbtackSmsPhonePattern.test(value)) return value;
  if (/^\d{10}$/.test(value)) return `+1${value}`;
  if (/^1\d{10}$/.test(value)) return `+${value}`;
  return null;
}
