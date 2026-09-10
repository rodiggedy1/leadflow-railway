import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal Pressure washing completion", () => {
  it("applies the approved panel, saved/new-card, success, and Bookings-visible treatment only to Pressure washing", async () => {
    const [portal, serviceCatalog, pricing, panelStyles, bookNow] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalServices.ts"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalPricing.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/customer-portal-lawn-care-booking-panel.css"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
    ]);

    expect(serviceCatalog).toContain('{ id: "pressure-washing", name: "Pressure washing", startingPrice: 99');
    expect(serviceCatalog).toContain('"Area"');
    expect(serviceCatalog).toContain('"Size"');
    expect(serviceCatalog).toContain('"Access"');
    expect(pricing).toContain('"pressure-washing": rule(9_900, "Small ground-level patio or walkway"');
    expect(portal).toContain('const isPressureWashing = service.id === "pressure-washing";');
    expect(portal).toContain("const usesBookingPanelTreatment = isLawnCare || isTvMounting || isFurnitureAssembly || isPictureHanging || isMinorHomeRepairs || isHandyman || isPlumbing || isElectricalLighting || isInteriorPainting || isMovingHelp || isJunkRemoval || isPressureWashing;");
    expect(portal).toContain('"mib-pressure-washing-card-form"');
    expect(portal).toContain("Refresh every outdoor surface.");
    expect(portal).toContain("Choose a payment method for Pressure washing");
    expect(portal).toContain("!isLawnCare && !isFurnitureAssembly && !isPictureHanging && !isMinorHomeRepairs && !isHandyman && !isPlumbing && !isElectricalLighting && !isInteriorPainting && !isMovingHelp && !isJunkRemoval && !isPressureWashing && paymentChoice === \"new\"");
    expect(portal).toContain("Your {service.name.toLowerCase()} is booked.");
    expect(portal).toContain("createRequest.mutate({ serviceId: service.id");
    expect(panelStyles).toContain(".mib-pressure-washing-request-panel");
    expect(bookNow).not.toContain("pressure-washing");
  });

  it("uses the completed-service request path, including the existing Bookings refresh, without creating a new booking model", async () => {
    const router = await readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8");

    expect(router).toContain('const isPressureWashingBooking = service.id === "pressure-washing";');
    expect(router).toContain("const isCompletedPortalServiceBooking = isLawnCareBooking || isTvMountingBooking || isFurnitureAssemblyBooking || isPictureHangingBooking || isMinorHomeRepairsBooking || isHandymanBooking || isPlumbingBooking || isElectricalLightingBooking || isInteriorPaintingBooking || isMovingHelpBooking || isJunkRemovalBooking || isPressureWashingBooking;");
    expect(router).toContain('if (isCompletedPortalServiceBooking) broadcastOpsUpdate("booking_funnel_update");');
    expect(router).toContain('quickAction: isCompletedPortalServiceBooking ? "announce_booking" : "customer_portal_service_request"');
    expect(router).toContain("publicRequestNumber, serviceId: service.id");
    expect(router).toContain('const customerSms = await sendSms({ to: account.customerPhone');
    expect(router).toContain('const officeSms = await sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage });');
    expect(router).toContain("await db.insert(customerPortalServiceRequests).values");
    expect(router).not.toContain("paymentIntents.create");
  });
});
