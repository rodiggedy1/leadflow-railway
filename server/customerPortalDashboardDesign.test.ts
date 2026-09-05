import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const portalSource = readFileSync(new URL("../client/src/pages/CustomerPortal.tsx", import.meta.url), "utf8");
const dashboardStyles = readFileSync(new URL("../client/src/pages/customer-portal-dashboard.css", import.meta.url), "utf8");

describe("customer portal dashboard redesign contract", () => {
  it("adds the reference-inspired portal shell while keeping real sections as its destinations", () => {
    for (const marker of ["mib-portal-layout", "mib-portal-sidebar", "mib-home", "mib-services", "mib-bookings", "scrollToSection"]) {
      expect(portalSource).toContain(marker);
    }
    expect(portalSource).toContain("Your home, managed in one place.");
    expect(dashboardStyles).toContain("grid-template-columns:186px minmax(0,1fr)");
    expect(dashboardStyles).toContain("background:linear-gradient(105deg,#241814,#51362a)");
  });

  it("keeps the existing six service actions but gives their presentation a richer hero and imagery", () => {
    for (const serviceId of ["furniture-assembly", "moving-help", "lawn-yard-care", "junk-removal", "pressure-washing"]) {
      expect(portalSource).toContain(`"${serviceId}"`);
    }
    expect(portalSource).toContain("mib-portal-service-${service.id}");
    expect(portalSource).toContain("PORTAL_HERO_IMAGE");
    expect(portalSource).toContain("mib-portal-service-cleaning");
    expect(dashboardStyles).toContain("grid-row:span 2");
  });

  it("does not replace the working rebook, service request, saved-card, or booking list flows", () => {
    for (const marker of ["setShowCleaningRebook(true)", "setSelectedService(service)", "<ServiceRequestForm", "<BookNow portalRebook=", "portal.data.requests.map", "portal.data.cleanings.map"]) {
      expect(portalSource).toContain(marker);
    }
  });
});
