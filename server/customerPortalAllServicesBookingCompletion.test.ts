import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("customer portal non-cleaning service booking completion", () => {
  it("uses one reusable completion template for every catalog service and links its request, booking, and card state", () => {
    const catalog = read("../shared/customerPortalServices.ts");
    const helper = read("./customerPortalServiceBookingCompletion.ts");
    const router = read("./customerPortalRouter.ts");
    const schema = read("../drizzle/schema.ts");
    expect((catalog.match(/id: "/g) ?? []).length).toBe(12);
    expect(helper).toContain("completeCustomerPortalServiceBooking");
    expect(helper).toContain('source: "portal-service"');
    expect(helper).toContain("customerPortalServiceRequests");
    expect(helper).toContain("bookingPaymentProfiles");
    expect(helper).toContain("serviceRequestId: requestId");
    expect(helper).toContain('status: "booked"');
    expect(helper).toContain("sendBookingCompletionNotifications(bookingId)");
    expect(router).toContain("return completeCustomerPortalServiceBooking");
    expect(schema).toContain('bookingId: int("bookingId")');
    expect(schema).toContain('serviceRequestId: int("serviceRequestId")');
  });

  it("uses the shared completed-booking result to show every service a service-specific success page", () => {
    const portal = read("../client/src/pages/CustomerPortal.tsx");
    const notifications = read("./bookingCompletionNotifications.ts");
    expect(portal).toContain("PortalServiceBookingSuccessPage");
    expect(portal).toContain("Your {booking.serviceName.toLowerCase()} is booked.");
    expect(portal).toContain("setCompletedBooking(booking)");
    expect(notifications).toContain("function isCleaningService");
    expect(notifications).toContain("updates from your ${serviceTerm} team");
  });
});
