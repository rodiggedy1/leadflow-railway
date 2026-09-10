import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal Handyman visit completion", () => {
  it("applies the approved panel, saved/new-card, success, and Bookings-visible treatment only to Handyman visit", async () => {
    const [portal, serviceCatalog, pricing, panelStyles, bookNow] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalServices.ts"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalPricing.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/customer-portal-lawn-care-booking-panel.css"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
    ]);

    expect(serviceCatalog).toContain('{ id: "handyman", name: "Handyman visit", startingPrice: 129');
    expect(serviceCatalog).toContain('"What needs help?"');
    expect(serviceCatalog).toContain('"How many tasks?"');
    expect(serviceCatalog).toContain('"Parts or hardware"');
    expect(serviceCatalog).toContain('"Planned service time"');
    expect(pricing).toContain('handyman: rule(12_900, "Two-hour handyman visit"');
    expect(portal).toContain('const isHandyman = service.id === "handyman";');
    expect(portal).toContain("const usesBookingPanelTreatment = isLawnCare || isTvMounting || isFurnitureAssembly || isPictureHanging || isMinorHomeRepairs || isHandyman || isPlumbing || isElectricalLighting || isInteriorPainting || isMovingHelp;");
    expect(portal).toContain('"mib-handyman-card-form"');
    expect(portal).toContain("Get your home to-do list handled.");
    expect(portal).toContain("Choose a payment method for Handyman visit");
    expect(portal).toContain("!isLawnCare && !isFurnitureAssembly && !isPictureHanging && !isMinorHomeRepairs && !isHandyman && !isPlumbing && !isElectricalLighting && !isInteriorPainting && !isMovingHelp && paymentChoice === \"new\"");
    expect(portal).toContain("Your {service.name.toLowerCase()} is booked.");
    expect(portal).toContain("createRequest.mutate({ serviceId: service.id");
    expect(panelStyles).toContain(".mib-handyman-request-panel");
    expect(bookNow).not.toContain("handyman");
  });

  it("uses the completed-service request path, including the existing Bookings refresh, without creating a new booking model", async () => {
    const router = await readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8");

    expect(router).toContain('const isHandymanBooking = service.id === "handyman";');
    expect(router).toContain("const isCompletedPortalServiceBooking = isLawnCareBooking || isTvMountingBooking || isFurnitureAssemblyBooking || isPictureHangingBooking || isMinorHomeRepairsBooking || isHandymanBooking || isPlumbingBooking || isElectricalLightingBooking || isInteriorPaintingBooking || isMovingHelpBooking;");
    expect(router).toContain('if (isCompletedPortalServiceBooking) broadcastOpsUpdate("booking_funnel_update");');
    expect(router).toContain('quickAction: isCompletedPortalServiceBooking ? "announce_booking" : "customer_portal_service_request"');
    expect(router).toContain("publicRequestNumber, serviceId: service.id");
    expect(router).toContain('const customerSms = await sendSms({ to: account.customerPhone');
    expect(router).toContain('const officeSms = await sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage });');
    expect(router).toContain("await db.insert(customerPortalServiceRequests).values");
    expect(router).not.toContain("paymentIntents.create");
  });
});
