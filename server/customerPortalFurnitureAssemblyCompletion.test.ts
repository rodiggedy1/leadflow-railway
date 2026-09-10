import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal furniture-assembly completion", () => {
  it("applies the approved panel, saved/new-card, and success treatment only to furniture assembly alongside released services", async () => {
    const [portal, serviceCatalog, panelStyles, bookNow] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalServices.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/customer-portal-lawn-care-booking-panel.css"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
    ]);

    expect(serviceCatalog).toContain('{ id: "furniture-assembly", name: "Furniture assembly", startingPrice: 119');
    expect(serviceCatalog).toContain('"Small item count"');
    expect(serviceCatalog).toContain('"Medium item count"');
    expect(serviceCatalog).toContain('"Large item count"');
    expect(serviceCatalog).toContain('"Planned service time"');
    expect(serviceCatalog).toContain('"Additional purchase or haul"');
    expect(portal).toContain('const isFurnitureAssembly = service.id === "furniture-assembly";');
    expect(portal).toContain("const usesBookingPanelTreatment = isLawnCare || isTvMounting || isFurnitureAssembly || isPictureHanging || isMinorHomeRepairs || isHandyman || isPlumbing || isElectricalLighting;");
    expect(portal).toContain('"mib-furniture-assembly-card-form"');
    expect(portal).toContain("Get it assembled, without the hassle.");
    expect(portal).toContain("Choose a payment method for Furniture assembly");
    expect(portal).toContain("!isLawnCare && !isFurnitureAssembly && !isPictureHanging && !isMinorHomeRepairs && !isHandyman && !isPlumbing && !isElectricalLighting && paymentChoice === \"new\"");
    expect(portal).toContain("Your {service.name.toLowerCase()} is booked.");
    expect(portal).toContain("createRequest.mutate({ serviceId: service.id");
    expect(panelStyles).toContain(".mib-furniture-assembly-request-panel");
    expect(bookNow).not.toContain("furniture-assembly");
  });

  it("uses the existing completed-service notification channels for furniture assembly without adding a new request path", async () => {
    const router = await readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8");

    expect(router).toContain('const isFurnitureAssemblyBooking = service.id === "furniture-assembly";');
    expect(router).toContain("const isCompletedPortalServiceBooking = isLawnCareBooking || isTvMountingBooking || isFurnitureAssemblyBooking || isPictureHangingBooking || isMinorHomeRepairsBooking || isHandymanBooking || isPlumbingBooking || isElectricalLightingBooking;");
    expect(router).toContain('quickAction: isCompletedPortalServiceBooking ? "announce_booking" : "customer_portal_service_request"');
    expect(router).toContain("publicRequestNumber, serviceId: service.id");
    expect(router).toContain('const customerSms = await sendSms({ to: account.customerPhone');
    expect(router).toContain('const officeSms = await sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage });');
    expect(router).not.toContain("paymentIntents.create");
  });
});
