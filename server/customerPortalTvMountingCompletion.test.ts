import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal TV-mounting completion", () => {
  it("applies the approved booking-panel and success treatment only to TV mounting alongside lawn care", async () => {
    const [portal, bookNow] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
    ]);

    expect(portal).toContain('const isTvMounting = service.id === "tv-mounting";');
    expect(portal).toContain("const usesBookingPanelTreatment = isLawnCare || isTvMounting || isFurnitureAssembly || isPictureHanging || isMinorHomeRepairs;");
    expect(portal).toContain("Mount your TV with confidence.");
    expect(portal).toContain("Your {service.name.toLowerCase()} is booked.");
    expect(portal).toContain("mib-tv-mounting-request-panel");
    expect(bookNow).not.toContain("tv-mounting");
  });

  it("adds only the established booking card and customer SMS channels for TV mounting", async () => {
    const router = await readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8");

    expect(router).toContain('const isTvMountingBooking = service.id === "tv-mounting";');
    expect(router).toContain("const isCompletedPortalServiceBooking = isLawnCareBooking || isTvMountingBooking || isFurnitureAssemblyBooking || isPictureHangingBooking || isMinorHomeRepairsBooking;");
    expect(router).toContain('quickAction: isCompletedPortalServiceBooking ? "announce_booking" : "customer_portal_service_request"');
    expect(router).toContain('const customerSms = await sendSms({ to: account.customerPhone');
  });
});
