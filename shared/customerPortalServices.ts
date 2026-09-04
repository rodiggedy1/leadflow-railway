export type CustomerPortalServiceField = {
  label: string;
  options?: readonly string[];
  type?: "select" | "text";
  placeholder?: string;
};

export type CustomerPortalService = {
  id: string;
  name: string;
  startingPrice: number;
  detail: string;
  fields: readonly CustomerPortalServiceField[];
};

export const CUSTOMER_PORTAL_SERVICES: readonly CustomerPortalService[] = [
  { id: "tv-mounting", name: "TV mounting", startingPrice: 149, detail: "One TV on a standard drywall wall", fields: [{ label: "TV count", options: ["One TV", "Two TVs", "Three or more"] }, { label: "TV size", options: ["Up to 43 inches", "44–65 inches", "Over 65 inches"] }, { label: "Wall & mount", options: ["Drywall and I have a mount", "Drywall and I need a mount", "Brick, stone, tile, or not sure"] }] },
  { id: "furniture-assembly", name: "Furniture assembly", startingPrice: 119, detail: "Small or standard item · two-hour minimum", fields: [{ label: "Small item count", options: ["0", "1", "2–3", "4+"] }, { label: "Medium item count", options: ["0", "1", "2–3", "4+"] }, { label: "Large item count", options: ["0", "1", "2+"] }, { label: "Planned service time", options: ["2 hours", "2.5 hours", "3 hours", "3.5+ hours"] }, { label: "Additional purchase or haul", options: ["No", "Yes"] }] },
  { id: "picture-hanging", name: "Picture hanging", startingPrice: 99, detail: "Up to two small standard-height items", fields: [{ label: "Small item count", options: ["0", "1–2", "3–5", "6+"] }, { label: "Large or heavy item count", options: ["0", "1", "2+"] }, { label: "Shelves to install", options: ["No", "1 shelf", "2+ shelves"] }, { label: "Ladder height", options: ["No ladder", "6 ft ladder", "10 ft ladder"] }, { label: "Planned service time", options: ["2 hours", "2.5 hours", "3 hours", "3.5+ hours"] }] },
  { id: "minor-home-repairs", name: "Minor home repairs", startingPrice: 129, detail: "One small repair · two-hour service minimum", fields: [{ label: "Repair type", options: ["Door, drawer, or hardware", "Patch, caulk, or touch-up", "Small household fix"] }, { label: "Task count", options: ["One repair", "Two or three repairs", "Several unrelated repairs"] }, { label: "Parts or hardware", options: ["I have them", "I need guidance", "Not sure"] }] },
  { id: "handyman", name: "Handyman visit", startingPrice: 129, detail: "Small repair · two-hour service minimum", fields: [{ label: "What needs help?", type: "text", placeholder: "Describe the repair, install, or household task" }, { label: "How many tasks?", options: ["One task", "Two or three tasks", "Several unrelated tasks"] }, { label: "Parts or hardware", options: ["I have them", "I need guidance", "Not sure"] }, { label: "Planned service time", options: ["2 hours", "2.5 hours", "3 hours", "3.5+ hours"] }] },
  { id: "plumbing", name: "Plumbing help", startingPrice: 159, detail: "Minor diagnostic or repair visit", fields: [{ label: "Issue", options: ["Faucet or fixture", "Drain issue", "Toilet issue"] }, { label: "Access", options: ["Shutoff and plumbing are accessible", "Access is limited", "Not sure"] }, { label: "Urgency", options: ["Today if possible", "This week", "Not urgent"] }] },
  { id: "electrical-lighting", name: "Electrical & lighting", startingPrice: 149, detail: "One existing-access fixture or switch task", fields: [{ label: "Light fixtures", options: ["0", "1", "2", "3+"] }, { label: "Dimmers or switches", options: ["0", "1", "2", "3+"] }, { label: "Ceiling fans", options: ["0", "1", "2+"] }, { label: "Ladder height", options: ["No ladder", "6 ft ladder", "10 ft ladder"] }, { label: "Wiring access", options: ["Existing wiring is accessible", "Not sure", "New wiring or panel work"] }, { label: "Planned service time", options: ["2 hours", "2.5 hours", "3 hours", "3.5+ hours"] }] },
  { id: "interior-painting", name: "Interior painting", startingPrice: 199, detail: "Paint-ready touch-up or one standard accent wall", fields: [{ label: "Project type", options: ["Touch-ups", "One accent wall", "Room or multiple rooms"] }, { label: "Paint & prep", options: ["Paint is ready and wall is sound", "I need paint guidance", "Patching, prep, or wallpaper removal"] }, { label: "Access", options: ["Standard wall height", "Ceiling or trim included", "High access or furniture moving"] }] },
  { id: "moving-help", name: "Moving help", startingPrice: 238, detail: "One helper for two hours · no truck", fields: [{ label: "Help needed", options: ["Load my truck", "Unload my truck", "Move items inside my home"] }, { label: "Helpers", options: ["1 helper", "2 helpers", "3 helpers"] }, { label: "Duration", options: ["2 hours", "2.5 hours", "3 hours", "3.5+ hours"] }, { label: "Certificate of insurance", options: ["No", "Yes"] }, { label: "Boxes or materials", options: ["No", "Yes"] }, { label: "Building access", options: ["Ground floor / easy access", "Stairs or elevator", "Long carry or special item"] }] },
  { id: "lawn-yard-care", name: "Lawn & yard care", startingPrice: 49, detail: "Small maintained lawn · mow, edge, and blow", fields: [{ label: "Yard size", options: ["Small", "Medium", "Large"] }, { label: "Service", options: ["Mow, edge, and blow", "Trimming or weeding", "Seasonal cleanup"] }, { label: "Condition", options: ["Regularly maintained", "Overgrown", "Not sure"] }] },
  { id: "junk-removal", name: "Junk removal", startingPrice: 129, detail: "Small curbside or one-eighth truckload pickup", fields: [{ label: "Load size", options: ["A few items / one-eighth truck", "Quarter to half truck", "More than half a truck"] }, { label: "Pickup location", options: ["Curbside", "Garage / ground floor", "Stairs or elevator"] }, { label: "Items", options: ["Household items", "Furniture or mattress", "Appliance, electronics, or other"] }] },
  { id: "pressure-washing", name: "Pressure washing", startingPrice: 99, detail: "Small ground-level patio or walkway", fields: [{ label: "Area", options: ["Patio or walkway", "Driveway", "Siding, deck, or porch"] }, { label: "Size", options: ["Small", "Medium", "Large or multiple areas"] }, { label: "Access", options: ["Ground level with outdoor water", "No outdoor water", "Two stories, roof, or delicate surface"] }] },
] as const;

export type CustomerPortalServiceId = (typeof CUSTOMER_PORTAL_SERVICES)[number]["id"];

export function getCustomerPortalService(serviceId: string): CustomerPortalService | null {
  return CUSTOMER_PORTAL_SERVICES.find((service) => service.id === serviceId) ?? null;
}

export function validateCustomerPortalSelections(service: CustomerPortalService, selections: Record<string, string>): string | null {
  for (const field of service.fields) {
    const value = selections[field.label]?.trim();
    if (!value) return `Complete ${field.label}.`;
    if (field.type === "text") {
      if (value.length < 2 || value.length > 1_000) return `Enter a valid ${field.label.toLowerCase()}.`;
      continue;
    }
    if (!field.options?.includes(value)) return `Choose a valid ${field.label.toLowerCase()}.`;
  }
  return null;
}

type ScopeAdjustment = { cents: number; requiresReview?: boolean };
type ServicePriceRule = { baseCents: number; adjustments: Record<string, Record<string, ScopeAdjustment>> };

const servicePriceRules: Record<CustomerPortalServiceId, ServicePriceRule> = {
  "tv-mounting": { baseCents: 14_900, adjustments: { "TV count": { "One TV": { cents: 0 }, "Two TVs": { cents: 11_900 }, "Three or more": { cents: 23_800, requiresReview: true } }, "TV size": { "Up to 43 inches": { cents: 0 }, "44–65 inches": { cents: 2_500 }, "Over 65 inches": { cents: 6_000, requiresReview: true } }, "Wall & mount": { "Drywall and I have a mount": { cents: 0 }, "Drywall and I need a mount": { cents: 3_500 }, "Brick, stone, tile, or not sure": { cents: 9_000, requiresReview: true } } } },
  "furniture-assembly": { baseCents: 11_900, adjustments: { "Small item count": { "0": { cents: 0 }, "1": { cents: 0 }, "2–3": { cents: 5_000 }, "4+": { cents: 10_000, requiresReview: true } }, "Medium item count": { "0": { cents: 0 }, "1": { cents: 3_000 }, "2–3": { cents: 9_000 }, "4+": { cents: 18_000, requiresReview: true } }, "Large item count": { "0": { cents: 0 }, "1": { cents: 8_000 }, "2+": { cents: 16_000, requiresReview: true } }, "Planned service time": { "2 hours": { cents: 0 }, "2.5 hours": { cents: 3_000 }, "3 hours": { cents: 6_000 }, "3.5+ hours": { cents: 9_000, requiresReview: true } }, "Additional purchase or haul": { No: { cents: 0 }, Yes: { cents: 0, requiresReview: true } } } },
  "picture-hanging": { baseCents: 9_900, adjustments: { "Small item count": { "0": { cents: 0 }, "1–2": { cents: 0 }, "3–5": { cents: 4_000 }, "6+": { cents: 8_000, requiresReview: true } }, "Large or heavy item count": { "0": { cents: 0 }, "1": { cents: 7_000, requiresReview: true }, "2+": { cents: 14_000, requiresReview: true } }, "Shelves to install": { No: { cents: 0 }, "1 shelf": { cents: 5_000 }, "2+ shelves": { cents: 10_000, requiresReview: true } }, "Ladder height": { "No ladder": { cents: 0 }, "6 ft ladder": { cents: 3_000 }, "10 ft ladder": { cents: 7_000, requiresReview: true } }, "Planned service time": { "2 hours": { cents: 0 }, "2.5 hours": { cents: 3_000 }, "3 hours": { cents: 6_000 }, "3.5+ hours": { cents: 9_000, requiresReview: true } } } },
  "minor-home-repairs": { baseCents: 12_900, adjustments: { "Repair type": { "Door, drawer, or hardware": { cents: 0 }, "Patch, caulk, or touch-up": { cents: 2_000 }, "Small household fix": { cents: 1_500 } }, "Task count": { "One repair": { cents: 0 }, "Two or three repairs": { cents: 6_500 }, "Several unrelated repairs": { cents: 15_000, requiresReview: true } }, "Parts or hardware": { "I have them": { cents: 0 }, "I need guidance": { cents: 0, requiresReview: true }, "Not sure": { cents: 0, requiresReview: true } } } },
  handyman: { baseCents: 12_900, adjustments: { "How many tasks?": { "One task": { cents: 0 }, "Two or three tasks": { cents: 6_500 }, "Several unrelated tasks": { cents: 15_000, requiresReview: true } }, "Parts or hardware": { "I have them": { cents: 0 }, "I need guidance": { cents: 0, requiresReview: true }, "Not sure": { cents: 0, requiresReview: true } }, "Planned service time": { "2 hours": { cents: 0 }, "2.5 hours": { cents: 3_500 }, "3 hours": { cents: 7_000 }, "3.5+ hours": { cents: 10_500, requiresReview: true } } } },
  plumbing: { baseCents: 15_900, adjustments: { Issue: { "Faucet or fixture": { cents: 0 }, "Drain issue": { cents: 3_000 }, "Toilet issue": { cents: 4_000 } }, Access: { "Shutoff and plumbing are accessible": { cents: 0 }, "Access is limited": { cents: 3_500, requiresReview: true }, "Not sure": { cents: 0, requiresReview: true } }, Urgency: { "Today if possible": { cents: 7_500, requiresReview: true }, "This week": { cents: 0 }, "Not urgent": { cents: 0 } } } },
  "electrical-lighting": { baseCents: 14_900, adjustments: { "Light fixtures": { "0": { cents: 0 }, "1": { cents: 0 }, "2": { cents: 7_000 }, "3+": { cents: 14_000, requiresReview: true } }, "Dimmers or switches": { "0": { cents: 0 }, "1": { cents: 0 }, "2": { cents: 5_000 }, "3+": { cents: 10_000, requiresReview: true } }, "Ceiling fans": { "0": { cents: 0 }, "1": { cents: 5_000 }, "2+": { cents: 10_000, requiresReview: true } }, "Ladder height": { "No ladder": { cents: 0 }, "6 ft ladder": { cents: 3_000 }, "10 ft ladder": { cents: 6_000, requiresReview: true } }, "Wiring access": { "Existing wiring is accessible": { cents: 0 }, "Not sure": { cents: 0, requiresReview: true }, "New wiring or panel work": { cents: 0, requiresReview: true } }, "Planned service time": { "2 hours": { cents: 0 }, "2.5 hours": { cents: 3_500 }, "3 hours": { cents: 7_000 }, "3.5+ hours": { cents: 10_500, requiresReview: true } } } },
  "interior-painting": { baseCents: 19_900, adjustments: { "Project type": { "Touch-ups": { cents: 0 }, "One accent wall": { cents: 0 }, "Room or multiple rooms": { cents: 0, requiresReview: true } }, "Paint & prep": { "Paint is ready and wall is sound": { cents: 0 }, "I need paint guidance": { cents: 0, requiresReview: true }, "Patching, prep, or wallpaper removal": { cents: 0, requiresReview: true } }, Access: { "Standard wall height": { cents: 0 }, "Ceiling or trim included": { cents: 0, requiresReview: true }, "High access or furniture moving": { cents: 0, requiresReview: true } } } },
  "moving-help": { baseCents: 23_800, adjustments: { "Help needed": { "Load my truck": { cents: 0 }, "Unload my truck": { cents: 0 }, "Move items inside my home": { cents: 0 } }, Helpers: { "1 helper": { cents: 0 }, "2 helpers": { cents: 23_800 }, "3 helpers": { cents: 47_600, requiresReview: true } }, Duration: { "2 hours": { cents: 0 }, "2.5 hours": { cents: 5_950 }, "3 hours": { cents: 11_900 }, "3.5+ hours": { cents: 17_850, requiresReview: true } }, "Certificate of insurance": { No: { cents: 0 }, Yes: { cents: 0, requiresReview: true } }, "Boxes or materials": { No: { cents: 0 }, Yes: { cents: 0, requiresReview: true } }, "Building access": { "Ground floor / easy access": { cents: 0 }, "Stairs or elevator": { cents: 3_500 }, "Long carry or special item": { cents: 0, requiresReview: true } } } },
  "lawn-yard-care": { baseCents: 4_900, adjustments: { "Yard size": { Small: { cents: 0 }, Medium: { cents: 2_500 }, Large: { cents: 6_000, requiresReview: true } }, Service: { "Mow, edge, and blow": { cents: 0 }, "Trimming or weeding": { cents: 4_000 }, "Seasonal cleanup": { cents: 7_500, requiresReview: true } }, Condition: { "Regularly maintained": { cents: 0 }, Overgrown: { cents: 5_000, requiresReview: true }, "Not sure": { cents: 0, requiresReview: true } } } },
  "junk-removal": { baseCents: 12_900, adjustments: { "Load size": { "A few items / one-eighth truck": { cents: 0 }, "Quarter to half truck": { cents: 12_000 }, "More than half a truck": { cents: 25_000, requiresReview: true } }, "Pickup location": { Curbside: { cents: 0 }, "Garage / ground floor": { cents: 2_500 }, "Stairs or elevator": { cents: 6_000 } }, Items: { "Household items": { cents: 0 }, "Furniture or mattress": { cents: 3_500 }, "Appliance, electronics, or other": { cents: 0, requiresReview: true } } } },
  "pressure-washing": { baseCents: 9_900, adjustments: { Area: { "Patio or walkway": { cents: 0 }, Driveway: { cents: 5_000 }, "Siding, deck, or porch": { cents: 8_000, requiresReview: true } }, Size: { Small: { cents: 0 }, Medium: { cents: 5_000 }, "Large or multiple areas": { cents: 12_000, requiresReview: true } }, Access: { "Ground level with outdoor water": { cents: 0 }, "No outdoor water": { cents: 4_000, requiresReview: true }, "Two stories, roof, or delicate surface": { cents: 0, requiresReview: true } } } },
};

export function calculateCustomerPortalEstimate(serviceId: string, selections: Record<string, string>): { estimatedTotalCents: number; requiresReview: boolean } {
  const rule = servicePriceRules[serviceId as CustomerPortalServiceId];
  if (!rule) throw new Error("Choose a supported service.");
  let estimatedTotalCents = rule.baseCents;
  let requiresReview = false;
  for (const [field, value] of Object.entries(selections)) {
    const adjustment = rule.adjustments[field]?.[value];
    if (!adjustment) continue;
    estimatedTotalCents += adjustment.cents;
    requiresReview ||= Boolean(adjustment.requiresReview);
  }
  return { estimatedTotalCents, requiresReview };
}
