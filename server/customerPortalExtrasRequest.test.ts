import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatCustomerPortalExtrasEstimate, resolveCustomerPortalExtrasRequest } from "../shared/customerPortalExtrasRequest";

const root = process.cwd();
const router = fs.readFileSync(path.join(root, "server/customerPortalRouter.ts"), "utf8");
const home = fs.readFileSync(path.join(root, "client/src/pages/CustomerPortalHome.tsx"), "utf8");
const portal = fs.readFileSync(path.join(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
const requestUi = fs.readFileSync(path.join(root, "client/src/components/CustomerPortalExtrasRequest.tsx"), "utf8");

describe("Customer Portal add extras requests", () => {
  it("uses the Book Now catalog and recomputes unit quantities and the request estimate", () => {
    const resolved = resolveCustomerPortalExtrasRequest([
      { extraId: "inside-cabinets" },
      { extraId: "interior-windows", quantity: 3 },
      { extraId: "laundry-load", quantity: 2 },
    ]);
    expect(resolved.totalCents).toBe(13_000);
    expect(resolved.extras).toMatchObject([{ id: "inside-cabinets", lineTotalCents: 5_000 }, { id: "interior-windows", quantity: 3, lineTotalCents: 3_000 }, { id: "laundry-load", quantity: 2, lineTotalCents: 5_000 }]);
    expect(formatCustomerPortalExtrasEstimate(resolved.totalCents)).toBe("$130");
    expect(() => resolveCustomerPortalExtrasRequest([{ extraId: "not-a-real-extra" }])).toThrow("Choose supported Book Now extras only.");
    expect(() => resolveCustomerPortalExtrasRequest([{ extraId: "inside-cabinets", quantity: 2 }])).toThrow("does not support a quantity");
  });

  it("opens a compact request-only modal and sends office notices only after saving the owned booking request", () => {
    const segment = router.slice(router.indexOf("requestBookingExtras:"), router.indexOf("createRequest:"));
    expect(home).toContain("onRequestExtras");
    expect(portal).toContain("<CustomerPortalExtrasRequest booking={extrasRequestBooking}");
    expect(requestUi).toContain("BOOKING_WIDGET_PRICED_EXTRAS");
    expect(requestUi).toContain('className="mib-portal-modal"');
    expect(requestUi).toContain("requestBookingExtras");
    expect(router).toContain('bookingSource: z.enum(["booking", "leadflow"])');
    expect(segment).toContain("resolveCustomerPortalExtrasRequest(input.extras)");
    expect(segment).toContain("await db.insert(customerPortalServiceRequests).values");
    expect(segment).toContain('quickAction: "customer_portal_add_extras_request"');
    expect(segment).toContain('broadcastOpsUpdate("new_message", { channel: "command" })');
    expect(segment).toContain("sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage })");
    expect(segment.indexOf("await db.insert(customerPortalServiceRequests).values")).toBeLessThan(segment.indexOf('quickAction: "customer_portal_add_extras_request"'));
    expect(segment.indexOf("await db.insert(customerPortalServiceRequests).values")).toBeLessThan(segment.indexOf("sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage })"));
    expect(segment).not.toContain("db.update(bookings)");
    expect(segment).not.toContain("db.update(leadflowJobs)");
    expect(segment).not.toContain("paymentIntents.create");
  });
});
