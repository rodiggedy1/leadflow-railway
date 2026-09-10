import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal Moving help completion", () => {
  it("applies the approved panel, saved/new-card, success, and Bookings-visible treatment only to Moving help", async () => {
    const [portal, serviceCatalog, pricing, panelStyles, bookNow] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalServices.ts"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalPricing.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/customer-portal-lawn-care-booking-panel.css"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
    ]);

    expect(serviceCatalog).toContain('{ id: "moving-help", name: "Moving help", startingPrice: 238');
    expect(serviceCatalog).toContain('"Help needed"');
    expect(serviceCatalog).toContain('"Helpers"');
    expect(serviceCatalog).toContain('"Duration"');
    expect(serviceCatalog).toContain('"Certificate of insurance"');
    expect(serviceCatalog).toContain('"Boxes or materials"');
    expect(serviceCatalog).toContain('"Building access"');
    expect(pricing).toContain('"moving-help": rule(23_800, "One helper for two hours · no truck"');
    expect(portal).toContain('const isMovingHelp = service.id === "moving-help";');
    expect(portal).toContain("const usesBookingPanelTreatment = isLawnCare || isTvMounting || isFurnitureAssembly || isPictureHanging || isMinorHomeRepairs || isHandyman || isPlumbing || isElectricalLighting || isInteriorPainting || isMovingHelp || isJunkRemoval;");
    expect(portal).toContain('"mib-moving-help-card-form"');
    expect(portal).toContain("Make your move easier.");
    expect(portal).toContain("Choose a payment method for Moving help");
    expect(portal).toContain("!isLawnCare && !isFurnitureAssembly && !isPictureHanging && !isMinorHomeRepairs && !isHandyman && !isPlumbing && !isElectricalLighting && !isInteriorPainting && !isMovingHelp && !isJunkRemoval && paymentChoice === \"new\"");
    expect(portal).toContain("Your {service.name.toLowerCase()} is booked.");
    expect(portal).toContain("createRequest.mutate({ serviceId: service.id");
    expect(panelStyles).toContain(".mib-moving-help-request-panel");
    expect(bookNow).not.toContain("moving-help");
  });

  it("uses the completed-service request path, including the existing Bookings refresh, without creating a new booking model", async () => {
    const router = await readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8");

    expect(router).toContain('const isMovingHelpBooking = service.id === "moving-help";');
    expect(router).toContain("const isCompletedPortalServiceBooking = isLawnCareBooking || isTvMountingBooking || isFurnitureAssemblyBooking || isPictureHangingBooking || isMinorHomeRepairsBooking || isHandymanBooking || isPlumbingBooking || isElectricalLightingBooking || isInteriorPaintingBooking || isMovingHelpBooking || isJunkRemovalBooking;");
    expect(router).toContain('if (isCompletedPortalServiceBooking) broadcastOpsUpdate("booking_funnel_update");');
    expect(router).toContain('quickAction: isCompletedPortalServiceBooking ? "announce_booking" : "customer_portal_service_request"');
    expect(router).toContain("publicRequestNumber, serviceId: service.id");
    expect(router).toContain('const customerSms = await sendSms({ to: account.customerPhone');
    expect(router).toContain('const officeSms = await sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage });');
    expect(router).toContain("await db.insert(customerPortalServiceRequests).values");
    expect(router).not.toContain("paymentIntents.create");
  });
});
