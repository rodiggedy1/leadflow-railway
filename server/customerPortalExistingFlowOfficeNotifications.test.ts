import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal existing-flow office notifications", () => {
  it("keeps the established new-cleaning completion dispatcher and adds office notices only after an existing service request is saved", async () => {
    const [portalRouter, bookingPaymentRouter, bookingDispatcher] = await Promise.all([
      readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8"),
      readFile(path.resolve(root, "server/bookingPaymentRouter.ts"), "utf8"),
      readFile(path.resolve(root, "server/bookingCompletionNotifications.ts"), "utf8"),
    ]);

    expect(bookingPaymentRouter).toContain("void sendBookingCompletionNotifications(target.bookingId).catch");
    expect(bookingPaymentRouter).toContain("void sendBookingCompletionNotifications(record.bookingId).catch");
    expect(bookingDispatcher).toContain('const CHANNELS: NotificationChannel[] = ["purchaser_sms", "cs_sms", "owner_sms", "command_chat"]');
    expect(bookingDispatcher).toContain('channel: "command"');
    expect(bookingDispatcher).toContain("const CS_SUPPORT_NUMBER = \"+12028885362\"");

    const requestSegment = portalRouter.slice(portalRouter.indexOf("createRequest:"));
    expect(requestSegment).toContain("await db.insert(customerPortalServiceRequests).values");
    expect(requestSegment.indexOf("await db.insert(customerPortalServiceRequests).values")).toBeLessThan(requestSegment.indexOf('quickAction: "customer_portal_service_request"'));
    expect(requestSegment).toContain('channel: "command"');
    expect(requestSegment).toContain('broadcastOpsUpdate("new_message", { channel: "command" })');
    expect(requestSegment).toContain("sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage })");
    expect(requestSegment).toContain('return { ok: true }');
    expect(requestSegment).not.toContain("paymentIntents.create");
  });
});
