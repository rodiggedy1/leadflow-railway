/**
 * Maids in Black — Pricing Table
 *
 * Single source of truth for all pricing calculations.
 * Used by the LLM prompt and the business rule enforcer.
 */

// ─── Standard Cleaning Base Prices ───────────────────────────────────────────
// Base price includes 1 bathroom. Each additional bathroom adds $30.

const BEDROOM_BASE: Record<string, number> = {
  "Studio":       179,
  "1 Bedroom":    179,
  "2 Bedrooms":   209,
  "3 Bedrooms":   229,
  "4 Bedrooms":   279,
  "5 Bedrooms":   319,
  "6 Bedrooms":   379,
  "7 Bedrooms":   419,
  "7+ Bedrooms":  419,
};

const BATHROOM_COUNT: Record<string, number> = {
  "1 Bathroom":    1,
  "1.5 Bathrooms": 1,
  "2 Bathrooms":   2,
  "2.5 Bathrooms": 2,
  "3 Bathrooms":   3,
  "3.5 Bathrooms": 3,
  "4 Bathrooms":   4,
  "4+ Bathrooms":  4,
};

const EXTRA_BATH_PRICE = 30;

// ─── Recurring Discounts ──────────────────────────────────────────────────────
export const RECURRING_DISCOUNTS = {
  weekly:    { label: "Weekly",    pct: 20 },
  biweekly:  { label: "Bi-weekly", pct: 15 },
  monthly:   { label: "Monthly",   pct: 10 },
} as const;

// ─── Service Type Multipliers ─────────────────────────────────────────────────
export const SERVICE_MULTIPLIERS: Record<string, number> = {
  "Standard Cleaning": 1.0,
  "Deep Cleaning":     1.5,
  "Move-In/Move-Out":  1.75,
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function calculatePrice(bedrooms: string, bathrooms: string, serviceType = "Standard Cleaning"): number {
  const base = BEDROOM_BASE[bedrooms] ?? 179;
  const baths = BATHROOM_COUNT[bathrooms] ?? 1;
  const extraBaths = Math.max(0, baths - 1);
  const multiplier = SERVICE_MULTIPLIERS[serviceType] ?? 1.0;
  return Math.round((base + extraBaths * EXTRA_BATH_PRICE) * multiplier);
}

export function calculateRecurringPrice(basePrice: number, frequency: keyof typeof RECURRING_DISCOUNTS): number {
  const discount = RECURRING_DISCOUNTS[frequency].pct;
  return Math.round(basePrice * (1 - discount / 100));
}

/**
 * Returns a human-readable pricing summary for the LLM prompt.
 * Includes standard price + all recurring options with discounted prices.
 */
export function buildPricingSummary(bedrooms: string, bathrooms: string, serviceType = "Standard Cleaning"): string {
  const standard = calculatePrice(bedrooms, bathrooms, serviceType);
  const weekly = calculateRecurringPrice(standard, "weekly");
  const biweekly = calculateRecurringPrice(standard, "biweekly");
  const monthly = calculateRecurringPrice(standard, "monthly");

  return [
    `${serviceType}: $${standard} (one-time)`,
    `Weekly recurring: $${weekly}/clean (20% off)`,
    `Bi-weekly recurring: $${biweekly}/clean (15% off)`,
    `Monthly recurring: $${monthly}/clean (10% off)`,
  ].join("\n");
}

/**
 * Full pricing table as a string for the LLM system prompt.
 */
export const PRICING_TABLE = `
PRICING TABLE (Standard Cleaning, 1 bathroom included, +$30 per extra bathroom):
- Studio / 1 Bedroom: $179
- 2 Bedrooms: $209
- 3 Bedrooms: $229
- 4 Bedrooms: $279
- 5 Bedrooms: $319
- 6 Bedrooms: $379
- 7+ Bedrooms: $419

RECURRING DISCOUNTS (applied to standard cleaning price):
- Weekly: 20% off → e.g. 2bed/2bath = $${calculateRecurringPrice(calculatePrice("2 Bedrooms", "2 Bathrooms"), "weekly")}/clean
- Bi-weekly: 15% off → e.g. 2bed/2bath = $${calculateRecurringPrice(calculatePrice("2 Bedrooms", "2 Bathrooms"), "biweekly")}/clean
- Monthly: 10% off → e.g. 2bed/2bath = $${calculateRecurringPrice(calculatePrice("2 Bedrooms", "2 Bathrooms"), "monthly")}/clean

DEEP CLEANING: 1.5x standard price
MOVE-IN/MOVE-OUT: 1.75x standard price
`.trim();
