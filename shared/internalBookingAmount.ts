export type InternalBookingAmountResult =
  | { valid: true; customPriceCents: number | undefined; error: "" }
  | { valid: false; error: string };

/** The existing canonical override is a final first-cleaning total, not a discount or recurring-price edit. */
export function parseInternalBookingAmount(value: string): InternalBookingAmountResult {
  const amount = value.trim();
  if (!amount) return { valid: true, customPriceCents: undefined, error: "" };
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(amount)) {
    return { valid: false, error: "Enter a final amount in dollars with no more than two decimal places." };
  }
  const [dollars, decimal = ""] = amount.split(".");
  const cents = Number(dollars || "0") * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 1_000_000) {
    return { valid: false, error: "Enter a final amount between $0.01 and $10,000.00." };
  }
  return { valid: true, customPriceCents: cents, error: "" };
}
