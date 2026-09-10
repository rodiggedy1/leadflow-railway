import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CUSTOMER_PORTAL_LATE_RESCHEDULE_FEE_CENTS, isCustomerPortalRescheduleWithin24Hours } from "../shared/customerPortalScheduleRequest";

const root = process.cwd();
const router = fs.readFileSync(path.join(root, "server/customerPortalRouter.ts"), "utf8");
const home = fs.readFileSync(path.join(root, "client/src/pages/CustomerPortalHome.tsx"), "utf8");
const portal = fs.readFileSync(path.join(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
const requestUi = fs.readFileSync(path.join(root, "client/src/components/CustomerPortalScheduleRequest.tsx"), "utf8");

describe("Customer Portal schedule requests", () => {
  it("warns for reschedule requests inside the 24-hour window or on the same business day", () => {
    const now = new Date("2026-09-10T14:00:00.000Z");
    expect(CUSTOMER_PORTAL_LATE_RESCHEDULE_FEE_CENTS).toBe(7_000);
    expect(isCustomerPortalRescheduleWithin24Hours({ scheduledAt: "2026-09-11T12:00:00.000Z", scheduledDate: "2026-09-11", now })).toBe(true);
    expect(isCustomerPortalRescheduleWithin24Hours({ scheduledAt: "2026-09-11T16:01:00.000Z", scheduledDate: "2026-09-11", now })).toBe(false);
    expect(isCustomerPortalRescheduleWithin24Hours({ scheduledAt: null, scheduledDate: "2026-09-10", now })).toBe(true);
  });

  it("uses the established calendar and sends a review-only request for both native and imported bookings", () => {
    const segment = router.slice(router.indexOf("requestScheduleChange:"), router.indexOf("createRequest:"));
    expect(home).toContain("onRequestScheduleChange");
    expect(portal).toContain("<CustomerPortalScheduleRequest booking={scheduleRequestBooking}");
    expect(requestUi).toContain("CustomerPortalAppointmentCalendar");
    expect(requestUi).toContain('className="mib-portal-modal"');
    expect(requestUi).not.toContain("mib-booking-panel");
    expect(requestUi).toContain("formatCustomerPortalLateRescheduleFee()}");
    expect(requestUi).toContain("late reschedule warning");
    expect(requestUi).not.toContain("Cancel service");
    expect(router).toContain('bookingSource: z.enum(["booking", "leadflow"])');
    expect(segment).toContain("await db.insert(customerPortalServiceRequests).values");
    expect(segment).toContain("isCustomerPortalRescheduleWithin24Hours");
    expect(segment).not.toContain('requestType: z.literal("cancel")');
    expect(segment).not.toContain("customer-portal-cancellation");
    expect(segment).toContain('channel: "command"');
    expect(segment).toContain('broadcastOpsUpdate("new_message", { channel: "command" })');
    expect(segment).toContain("sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage })");
    expect(segment.indexOf("await db.insert(customerPortalServiceRequests).values")).toBeLessThan(segment.indexOf('channel: "command"'));
    expect(segment.indexOf("await db.insert(customerPortalServiceRequests).values")).toBeLessThan(segment.indexOf("sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage })"));
    expect(segment).not.toContain("db.update(bookings)");
    expect(segment).not.toContain("db.update(leadflowJobs)");
    expect(segment).not.toContain("paymentIntents.create");
  });
});
