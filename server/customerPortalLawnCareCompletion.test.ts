import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal lawn-care completion", () => {
  it("keeps the existing lawn-care request mutation and adds only its success treatment", async () => {
    const [portal, bookNow] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
    ]);

    expect(portal).toContain('const isLawnCare = service.id === "lawn-yard-care";');
    expect(portal).toContain("const usesBookingPanelTreatment = isLawnCare || isTvMounting || isFurnitureAssembly || isPictureHanging || isMinorHomeRepairs || isHandyman || isPlumbing || isElectricalLighting;");
    expect(portal).toContain("setServiceBookingComplete(true)");
    expect(portal).toContain("Your {service.name.toLowerCase()} is booked.");
    expect(portal).toContain("createRequest.mutate({ serviceId: service.id");
    expect(bookNow).not.toContain("lawn-yard-care");
  });

  it("uses the established Command Chat booking-card and SMS channels for the completed-service branch", async () => {
    const router = await readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8");

    expect(router).toContain('const isLawnCareBooking = service.id === "lawn-yard-care";');
    expect(router).toContain("const isCompletedPortalServiceBooking = isLawnCareBooking || isTvMountingBooking || isFurnitureAssemblyBooking || isPictureHangingBooking || isMinorHomeRepairsBooking || isHandymanBooking || isPlumbingBooking || isElectricalLightingBooking;");
    expect(router).toContain('quickAction: isCompletedPortalServiceBooking ? "announce_booking" : "customer_portal_service_request"');
    expect(router).toContain('authorName: isCompletedPortalServiceBooking ? "🎉 New Booking" : "Customer Portal"');
    expect(router).toContain('const customerSms = await sendSms({ to: account.customerPhone');
    expect(router).toContain('const officeSms = await sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage });');
  });
});
