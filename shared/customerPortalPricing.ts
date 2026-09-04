export type CustomerPortalScopePriceAdjustment = {
  cents: number;
  requiresReview?: boolean;
};

export type CustomerPortalPriceRule = {
  baseCents: number;
  baseLabel: string;
  adjustments: Record<string, Record<string, CustomerPortalScopePriceAdjustment>>;
};

export type CustomerPortalEstimate = {
  estimatedCents: number;
  requiresReview: boolean;
  lineItems: Array<{ label: string; cents: number }>;
};

const rule = (baseCents: number, baseLabel: string, adjustments: CustomerPortalPriceRule["adjustments"]): CustomerPortalPriceRule => ({ baseCents, baseLabel, adjustments });

export const CUSTOMER_PORTAL_PRICE_RULES: Record<string, CustomerPortalPriceRule> = {
  "tv-mounting": rule(14_900, "One TV on standard drywall", {
    "TV count": { "One TV": { cents: 0 }, "Two TVs": { cents: 11_900 }, "Three or more": { cents: 23_800, requiresReview: true } },
    "TV size": { "Up to 43 inches": { cents: 0 }, "44–65 inches": { cents: 2_500 }, "Over 65 inches": { cents: 6_000, requiresReview: true } },
    "Wall & mount": { "Drywall and I have a mount": { cents: 0 }, "Drywall and I need a mount": { cents: 3_500 }, "Brick, stone, tile, or not sure": { cents: 9_000, requiresReview: true } },
  }),
  "furniture-assembly": rule(11_900, "One small or standard item", {
    "Small item count": { "0": { cents: 0 }, "1": { cents: 0 }, "2–3": { cents: 5_000 }, "4+": { cents: 10_000, requiresReview: true } },
    "Medium item count": { "0": { cents: 0 }, "1": { cents: 3_000 }, "2–3": { cents: 9_000 }, "4+": { cents: 18_000, requiresReview: true } },
    "Large item count": { "0": { cents: 0 }, "1": { cents: 8_000 }, "2+": { cents: 16_000, requiresReview: true } },
    "Planned service time": { "2 hours": { cents: 0 }, "2.5 hours": { cents: 3_000 }, "3 hours": { cents: 6_000 }, "3.5+ hours": { cents: 9_000, requiresReview: true } },
    "Additional purchase or haul": { No: { cents: 0 }, Yes: { cents: 0, requiresReview: true } },
  }),
  "picture-hanging": rule(9_900, "Up to two small standard-height items", {
    "Small item count": { "0": { cents: 0 }, "1–2": { cents: 0 }, "3–5": { cents: 4_000 }, "6+": { cents: 8_000, requiresReview: true } },
    "Large or heavy item count": { "0": { cents: 0 }, "1": { cents: 7_000, requiresReview: true }, "2+": { cents: 14_000, requiresReview: true } },
    "Shelves to install": { No: { cents: 0 }, "1 shelf": { cents: 5_000 }, "2+ shelves": { cents: 10_000, requiresReview: true } },
    "Ladder height": { "No ladder": { cents: 0 }, "6 ft ladder": { cents: 3_000 }, "10 ft ladder": { cents: 7_000, requiresReview: true } },
    "Planned service time": { "2 hours": { cents: 0 }, "2.5 hours": { cents: 3_000 }, "3 hours": { cents: 6_000 }, "3.5+ hours": { cents: 9_000, requiresReview: true } },
  }),
  "minor-home-repairs": rule(12_900, "One small repair", {
    "Repair type": { "Door, drawer, or hardware": { cents: 0 }, "Patch, caulk, or touch-up": { cents: 2_000 }, "Small household fix": { cents: 1_500 } },
    "Task count": { "One repair": { cents: 0 }, "Two or three repairs": { cents: 6_500 }, "Several unrelated repairs": { cents: 15_000, requiresReview: true } },
    "Parts or hardware": { "I have them": { cents: 0 }, "I need guidance": { cents: 0, requiresReview: true }, "Not sure": { cents: 0, requiresReview: true } },
  }),
  handyman: rule(12_900, "Two-hour handyman visit", {
    "How many tasks?": { "One task": { cents: 0 }, "Two or three tasks": { cents: 6_500 }, "Several unrelated tasks": { cents: 15_000, requiresReview: true } },
    "Parts or hardware": { "I have them": { cents: 0 }, "I need guidance": { cents: 0, requiresReview: true }, "Not sure": { cents: 0, requiresReview: true } },
    "Planned service time": { "2 hours": { cents: 0 }, "2.5 hours": { cents: 3_500 }, "3 hours": { cents: 7_000 }, "3.5+ hours": { cents: 10_500, requiresReview: true } },
  }),
  plumbing: rule(15_900, "Minor diagnostic or repair visit", {
    Issue: { "Faucet or fixture": { cents: 0 }, "Drain issue": { cents: 3_000 }, "Toilet issue": { cents: 4_000 } },
    Access: { "Shutoff and plumbing are accessible": { cents: 0 }, "Access is limited": { cents: 3_500, requiresReview: true }, "Not sure": { cents: 0, requiresReview: true } },
    Urgency: { "Today if possible": { cents: 7_500, requiresReview: true }, "This week": { cents: 0 }, "Not urgent": { cents: 0 } },
  }),
  "electrical-lighting": rule(14_900, "One existing-access fixture or switch", {
    "Light fixtures": { "0": { cents: 0 }, "1": { cents: 0 }, "2": { cents: 7_000 }, "3+": { cents: 14_000, requiresReview: true } },
    "Dimmers or switches": { "0": { cents: 0 }, "1": { cents: 0 }, "2": { cents: 5_000 }, "3+": { cents: 10_000, requiresReview: true } },
    "Ceiling fans": { "0": { cents: 0 }, "1": { cents: 5_000 }, "2+": { cents: 10_000, requiresReview: true } },
    "Ladder height": { "No ladder": { cents: 0 }, "6 ft ladder": { cents: 3_000 }, "10 ft ladder": { cents: 6_000, requiresReview: true } },
    "Wiring access": { "Existing wiring is accessible": { cents: 0 }, "Not sure": { cents: 0, requiresReview: true }, "New wiring or panel work": { cents: 0, requiresReview: true } },
    "Planned service time": { "2 hours": { cents: 0 }, "2.5 hours": { cents: 3_500 }, "3 hours": { cents: 7_000 }, "3.5+ hours": { cents: 10_500, requiresReview: true } },
  }),
  "interior-painting": rule(19_900, "Paint-ready touch-up or one accent wall", {
    "Project type": { "Touch-ups": { cents: 0 }, "One accent wall": { cents: 0 }, "Room or multiple rooms": { cents: 0, requiresReview: true } },
    "Paint & prep": { "Paint is ready and wall is sound": { cents: 0 }, "I need paint guidance": { cents: 0, requiresReview: true }, "Patching, prep, or wallpaper removal": { cents: 0, requiresReview: true } },
    Access: { "Standard wall height": { cents: 0 }, "Ceiling or trim included": { cents: 0, requiresReview: true }, "High access or furniture moving": { cents: 0, requiresReview: true } },
  }),
  "moving-help": rule(23_800, "One helper for two hours · no truck", {
    "Help needed": { "Load my truck": { cents: 0 }, "Unload my truck": { cents: 0 }, "Move items inside my home": { cents: 0 } },
    Helpers: { "1 helper": { cents: 0 }, "2 helpers": { cents: 23_800 }, "3 helpers": { cents: 47_600, requiresReview: true } },
    Duration: { "2 hours": { cents: 0 }, "2.5 hours": { cents: 5_950 }, "3 hours": { cents: 11_900 }, "3.5+ hours": { cents: 17_850, requiresReview: true } },
    "Certificate of insurance": { No: { cents: 0 }, Yes: { cents: 0, requiresReview: true } },
    "Boxes or materials": { No: { cents: 0 }, Yes: { cents: 0, requiresReview: true } },
    "Building access": { "Ground floor / easy access": { cents: 0 }, "Stairs or elevator": { cents: 3_500 }, "Long carry or special item": { cents: 0, requiresReview: true } },
  }),
  "lawn-yard-care": rule(4_900, "Small maintained lawn · mow, edge, and blow", {
    "Yard size": { Small: { cents: 0 }, Medium: { cents: 2_500 }, Large: { cents: 6_000, requiresReview: true } },
    Service: { "Mow, edge, and blow": { cents: 0 }, "Trimming or weeding": { cents: 4_000 }, "Seasonal cleanup": { cents: 7_500, requiresReview: true } },
    Condition: { "Regularly maintained": { cents: 0 }, Overgrown: { cents: 5_000, requiresReview: true }, "Not sure": { cents: 0, requiresReview: true } },
  }),
  "junk-removal": rule(12_900, "Small curbside pickup", {
    "Load size": { "A few items / one-eighth truck": { cents: 0 }, "Quarter to half truck": { cents: 12_000 }, "More than half a truck": { cents: 25_000, requiresReview: true } },
    "Pickup location": { Curbside: { cents: 0 }, "Garage / ground floor": { cents: 2_500 }, "Stairs or elevator": { cents: 6_000 } },
    Items: { "Household items": { cents: 0 }, "Furniture or mattress": { cents: 3_500 }, "Appliance, electronics, or other": { cents: 0, requiresReview: true } },
  }),
  "pressure-washing": rule(9_900, "Small ground-level patio or walkway", {
    Area: { "Patio or walkway": { cents: 0 }, Driveway: { cents: 5_000 }, "Siding, deck, or porch": { cents: 8_000, requiresReview: true } },
    Size: { Small: { cents: 0 }, Medium: { cents: 5_000 }, "Large or multiple areas": { cents: 12_000, requiresReview: true } },
    Access: { "Ground level with outdoor water": { cents: 0 }, "No outdoor water": { cents: 4_000, requiresReview: true }, "Two stories, roof, or delicate surface": { cents: 0, requiresReview: true } },
  }),
};

export function calculateCustomerPortalEstimate(serviceId: string, selections: Record<string, string>): CustomerPortalEstimate {
  const priceRule = CUSTOMER_PORTAL_PRICE_RULES[serviceId];
  if (!priceRule) throw new Error("Unsupported service pricing.");
  const lineItems: CustomerPortalEstimate["lineItems"] = [{ label: priceRule.baseLabel, cents: priceRule.baseCents }];
  let estimatedCents = priceRule.baseCents;
  let requiresReview = false;
  for (const [field, selection] of Object.entries(selections)) {
    const adjustment = priceRule.adjustments[field]?.[selection];
    if (!adjustment) continue;
    estimatedCents += adjustment.cents;
    requiresReview ||= Boolean(adjustment.requiresReview);
    if (adjustment.cents) lineItems.push({ label: selection, cents: adjustment.cents });
  }
  return { estimatedCents, requiresReview, lineItems };
}
