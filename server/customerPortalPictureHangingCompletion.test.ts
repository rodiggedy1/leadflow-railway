import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal picture-hanging completion", () => {
  it("applies the approved panel, saved/new-card, and success treatment only to picture hanging alongside released services", async () => {
    const [portal, serviceCatalog, pricing, panelStyles, bookNow] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalServices.ts"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalPricing.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/customer-portal-lawn-care-booking-panel.css"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
    ]);

    expect(serviceCatalog).toContain('{ id: "picture-hanging", name: "Picture hanging", startingPrice: 99');
    expect(serviceCatalog).toContain('"Small item count"');
    expect(serviceCatalog).toContain('"Large or heavy item count"');
    expect(serviceCatalog).toContain('"Shelves to install"');
    expect(serviceCatalog).toContain('"Ladder height"');
    expect(serviceCatalog).toContain('"Planned service time"');
    expect(pricing).toContain('"picture-hanging": rule(9_900, "Up to two small standard-height items"');
    expect(portal).toContain('const isPictureHanging = service.id === "picture-hanging";');
    expect(portal).toContain("const usesBookingPanelTreatment = isLawnCare || isTvMounting || isFurnitureAssembly || isPictureHanging || isMinorHomeRepairs || isHandyman || isPlumbing || isElectricalLighting || isInteriorPainting || isMovingHelp;");
    expect(portal).toContain('"mib-picture-hanging-card-form"');
    expect(portal).toContain("Put every picture in its place.");
    expect(portal).toContain("Choose a payment method for Picture hanging");
    expect(portal).toContain("!isLawnCare && !isFurnitureAssembly && !isPictureHanging && !isMinorHomeRepairs && !isHandyman && !isPlumbing && !isElectricalLighting && !isInteriorPainting && !isMovingHelp && paymentChoice === \"new\"");
    expect(portal).toContain("Your {service.name.toLowerCase()} is booked.");
    expect(portal).toContain("createRequest.mutate({ serviceId: service.id");
    expect(panelStyles).toContain(".mib-picture-hanging-request-panel");
    expect(bookNow).not.toContain("picture-hanging");
  });

  it("uses the existing completed-service notification channels for picture hanging without adding a new request path", async () => {
    const router = await readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8");

    expect(router).toContain('const isPictureHangingBooking = service.id === "picture-hanging";');
    expect(router).toContain("const isCompletedPortalServiceBooking = isLawnCareBooking || isTvMountingBooking || isFurnitureAssemblyBooking || isPictureHangingBooking || isMinorHomeRepairsBooking || isHandymanBooking || isPlumbingBooking || isElectricalLightingBooking || isInteriorPaintingBooking || isMovingHelpBooking;");
    expect(router).toContain('if (isCompletedPortalServiceBooking) broadcastOpsUpdate("booking_funnel_update");');
    expect(router).toContain('quickAction: isCompletedPortalServiceBooking ? "announce_booking" : "customer_portal_service_request"');
    expect(router).toContain("publicRequestNumber, serviceId: service.id");
    expect(router).toContain('const customerSms = await sendSms({ to: account.customerPhone');
    expect(router).toContain('const officeSms = await sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage });');
    expect(router).not.toContain("paymentIntents.create");
  });
});
