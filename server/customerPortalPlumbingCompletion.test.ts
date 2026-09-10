import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal Plumbing help completion", () => {
  it("applies the approved panel, saved/new-card, success, and Bookings-visible treatment only to Plumbing help", async () => {
    const [portal, serviceCatalog, pricing, panelStyles, bookNow] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalServices.ts"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalPricing.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/customer-portal-lawn-care-booking-panel.css"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
    ]);

    expect(serviceCatalog).toContain('{ id: "plumbing", name: "Plumbing help", startingPrice: 159');
    expect(serviceCatalog).toContain('"Issue"');
    expect(serviceCatalog).toContain('"Access"');
    expect(serviceCatalog).toContain('"Urgency"');
    expect(pricing).toContain('plumbing: rule(15_900, "Minor diagnostic or repair visit"');
    expect(portal).toContain('const isPlumbing = service.id === "plumbing";');
    expect(portal).toContain("const usesBookingPanelTreatment = isLawnCare || isTvMounting || isFurnitureAssembly || isPictureHanging || isMinorHomeRepairs || isHandyman || isPlumbing || isElectricalLighting || isInteriorPainting;");
    expect(portal).toContain('"mib-plumbing-card-form"');
    expect(portal).toContain("Get plumbing help with confidence.");
    expect(portal).toContain("Choose a payment method for Plumbing help");
    expect(portal).toContain("!isLawnCare && !isFurnitureAssembly && !isPictureHanging && !isMinorHomeRepairs && !isHandyman && !isPlumbing && !isElectricalLighting && !isInteriorPainting && paymentChoice === \"new\"");
    expect(portal).toContain("Your {service.name.toLowerCase()} is booked.");
    expect(portal).toContain("createRequest.mutate({ serviceId: service.id");
    expect(panelStyles).toContain(".mib-plumbing-request-panel");
    expect(bookNow).not.toContain("plumbing");
  });

  it("uses the completed-service request path, including the existing Bookings refresh, without creating a new booking model", async () => {
    const router = await readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8");

    expect(router).toContain('const isPlumbingBooking = service.id === "plumbing";');
    expect(router).toContain("const isCompletedPortalServiceBooking = isLawnCareBooking || isTvMountingBooking || isFurnitureAssemblyBooking || isPictureHangingBooking || isMinorHomeRepairsBooking || isHandymanBooking || isPlumbingBooking || isElectricalLightingBooking || isInteriorPaintingBooking;");
    expect(router).toContain('if (isCompletedPortalServiceBooking) broadcastOpsUpdate("booking_funnel_update");');
    expect(router).toContain('quickAction: isCompletedPortalServiceBooking ? "announce_booking" : "customer_portal_service_request"');
    expect(router).toContain("publicRequestNumber, serviceId: service.id");
    expect(router).toContain('const customerSms = await sendSms({ to: account.customerPhone');
    expect(router).toContain('const officeSms = await sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage });');
    expect(router).toContain("await db.insert(customerPortalServiceRequests).values");
    expect(router).not.toContain("paymentIntents.create");
  });
});
