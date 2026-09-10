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

    expect(portal).toContain('if (service.id === "lawn-yard-care") { setLawnCareComplete(true); return; }');
    expect(portal).toContain('if (isLawnCare && lawnCareComplete && date && timeWindow)');
    expect(portal).toContain("Your lawn &amp; yard care is booked.");
    expect(portal).toContain("createRequest.mutate({ serviceId: service.id");
    expect(bookNow).not.toContain("lawn-yard-care");
  });

  it("uses the established Command Chat booking-card and SMS channels only for lawn-care completion", async () => {
    const router = await readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8");

    expect(router).toContain('const isLawnCareBooking = service.id === "lawn-yard-care";');
    expect(router).toContain('quickAction: isLawnCareBooking ? "announce_booking" : "customer_portal_service_request"');
    expect(router).toContain('authorName: isLawnCareBooking ? "🎉 New Booking" : "Customer Portal"');
    expect(router).toContain('const customerSms = await sendSms({ to: account.customerPhone');
    expect(router).toContain('const officeSms = await sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage });');
  });
});
