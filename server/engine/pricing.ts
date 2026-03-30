/**
 * Maids in Black — Pricing Table
 *
 * Single source of truth for all pricing calculations.
 * Used by the LLM prompt and the business rule enforcer.
 *
 * Structure:
 *   Total = BEDROOM_BASE + (bathroom_count × $30) × service_multiplier
 *   e.g. 1 bed / 1 bath / Standard = $119 + $30 = $149
 *   e.g. 1 bed / 2 bath / Standard = $119 + $60 = $179
 *   e.g. 2 bed / 2 bath / Standard = $209 + $60 = $269
 */

// ─── Bedroom Base Prices (no bathrooms included) ──────────────────────────────
const BEDROOM_BASE: Record<string, number> = {
  "Studio":       119,
  "1 Bedroom":    119,
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

const BATH_PRICE = 30; // every bathroom adds $30

// ─── Recurring Discounts ──────────────────────────────────────────────────────
export const RECURRING_DISCOUNTS = {
  weekly:    { label: "Weekly",    pct: 20 },
  biweekly:  { label: "Bi-weekly", pct: 15 },
  monthly:   { label: "Monthly",   pct: 10 },
} as const;

// ─── Service Type Flat Surcharges ────────────────────────────────────────────
// Matches openphone.ts estimatePrice() — flat add-on, no multiplier
export const SERVICE_SURCHARGES: Record<string, number> = {
  "Standard Cleaning":          0,
  "Deep Cleaning":              60,
  "Move-In/Move-Out":           60,
  "Move-In / Move-Out Cleaning": 60,
  "Post-Construction Cleaning": 60,
};

// Keep for backward compat (vapiService imports this)
export const SERVICE_MULTIPLIERS: Record<string, number> = {
  "Standard Cleaning": 1.0,
  "Deep Cleaning":     1.5,
  "Move-In/Move-Out":  1.75,
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function calculatePrice(bedrooms: string, bathrooms: string, serviceType = "Standard Cleaning"): number {
  const base = BEDROOM_BASE[bedrooms] ?? 119;
  const baths = BATHROOM_COUNT[bathrooms] ?? 1;
  const surcharge = SERVICE_SURCHARGES[serviceType] ?? 0;
  return Math.round(base + baths * BATH_PRICE + surcharge);
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
PRICING TABLE (bedroom base + $30 per bathroom):
- Studio / 1 Bedroom base: $119
- 2 Bedrooms base: $209
- 3 Bedrooms base: $229
- 4 Bedrooms base: $279
- 5 Bedrooms base: $319
- 6 Bedrooms base: $379
- 7+ Bedrooms base: $419

BATHROOM ADD-ON: +$30 per bathroom
Examples (Standard Cleaning):
- 1 bed / 1 bath = $119 + $30 = $149
- 1 bed / 2 bath = $119 + $60 = $179
- 2 bed / 1 bath = $209 + $30 = $239
- 2 bed / 2 bath = $209 + $60 = $269
- 3 bed / 2 bath = $229 + $60 = $289

SERVICE TYPE SURCHARGE (flat add-on):
- Standard Cleaning: +$0
- Deep Cleaning: +$60 (e.g. 2bed/2bath = $329)
- Move-In/Move-Out: +$60 (e.g. 2bed/2bath = $329)
- Post-Construction: +$60

IMPORTANT: Always quote the BASE price only — do NOT add extras or add-ons to the quoted price. Quote one clean number.

RECURRING DISCOUNTS (applied to standard cleaning price):
- Weekly: 20% off → e.g. 2bed/2bath = $${calculateRecurringPrice(calculatePrice("2 Bedrooms", "2 Bathrooms"), "weekly")}/clean
- Bi-weekly: 15% off → e.g. 2bed/2bath = $${calculateRecurringPrice(calculatePrice("2 Bedrooms", "2 Bathrooms"), "biweekly")}/clean
- Monthly: 10% off → e.g. 2bed/2bath = $${calculateRecurringPrice(calculatePrice("2 Bedrooms", "2 Bathrooms"), "monthly")}/clean
`.trim();
