import { describe, expect, it } from "vitest";
import { CUSTOMER_PORTAL_SERVICES } from "../shared/customerPortalServices";
import { calculateCustomerPortalEstimate, CUSTOMER_PORTAL_PRICE_RULES } from "../shared/customerPortalPricing";

describe("customer portal service pricing", () => {
  it("covers every existing non-cleaning service and excludes home cleaning", () => {
    expect(Object.keys(CUSTOMER_PORTAL_PRICE_RULES).sort()).toEqual(CUSTOMER_PORTAL_SERVICES.map(service => service.id).sort());
    expect(CUSTOMER_PORTAL_PRICE_RULES["moving-help"].baseCents).toBe(23_800);
  });

  it("applies the exact Joe scope adjustments for standard non-cleaning estimates", () => {
    const tvMounting = calculateCustomerPortalEstimate("tv-mounting", {
      "TV count": "Two TVs",
      "TV size": "44–65 inches",
      "Wall & mount": "Drywall and I need a mount",
    });
    const furnitureAssembly = calculateCustomerPortalEstimate("furniture-assembly", {
      "Small item count": "2–3",
      "Medium item count": "0",
      "Large item count": "0",
      "Planned service time": "2 hours",
      "Additional purchase or haul": "No",
    });
    const movingHelp = calculateCustomerPortalEstimate("moving-help", {
      "Help needed": "Load my truck",
      Helpers: "2 helpers",
      Duration: "3 hours",
      "Certificate of insurance": "No",
      "Boxes or materials": "No",
      "Building access": "Ground floor / easy access",
    });
    expect(tvMounting).toMatchObject({ estimatedCents: 32_800, requiresReview: false });
    expect(furnitureAssembly).toMatchObject({ estimatedCents: 16_900, requiresReview: false });
    expect(movingHelp).toMatchObject({ estimatedCents: 59_500, requiresReview: false });
  });

  it("marks review-required scopes without hiding their transparent calculated estimate", () => {
    const interiorPainting = calculateCustomerPortalEstimate("interior-painting", {
      "Project type": "Room or multiple rooms",
      "Paint & prep": "Patching, prep, or wallpaper removal",
      Access: "High access or furniture moving",
    });
    const electrical = calculateCustomerPortalEstimate("electrical-lighting", {
      "Light fixtures": "1",
      "Dimmers or switches": "0",
      "Ceiling fans": "0",
      "Ladder height": "No ladder",
      "Wiring access": "New wiring or panel work",
      "Planned service time": "2 hours",
    });
    expect(interiorPainting).toMatchObject({ estimatedCents: 19_900, requiresReview: true });
    expect(electrical).toMatchObject({ estimatedCents: 14_900, requiresReview: true });
  });
});
