import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal message office notifications", () => {
  it("keeps the existing signed-customer and booking guards while notifying Command Chat, Customer Service, and the assigned cleaner", async () => {
    const source = await readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8");
    const reply = source.slice(source.indexOf("  replyToMessageThread:"), source.indexOf("  me: publicProcedure"));

    expect(reply).toContain("getCustomerPortalSessionFromRequest(ctx.req)");
    expect(reply).toContain("account.customerPhone !== session.customerPhone");
    expect(reply).toContain("RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phoneDigits}");
    expect(reply).toContain('ne(leadflowJobs.bookingStatus, "cancelled")');
    expect(reply).toContain('ne(leadflowJobs.bookingStatus, "rescheduled")');
    expect(reply).toContain('ne(leadflowJobs.bookingStatus, "missing_from_launch27")');
    expect(reply).toContain("db.insert(leadflowBookingMessages).values");
    expect(reply).toContain("const officeMessage");
    expect(reply).toContain('channel: "command"');
    expect(reply).toContain('authorName: "Customer Portal"');
    expect(reply).toContain('quickAction: "customer_portal_message"');
    expect(reply).toContain('broadcastOpsUpdate("new_message", { channel: "command" })');
    expect(reply).toContain("sendSms({ to: CS_OFFICE_SMS_NUMBER, content: officeMessage })");
    expect(reply).toContain("sendSms({ to: cleaner.phone, content })");
    expect(reply).not.toContain("db.update(leadflowJobs)");
    expect(reply).not.toContain("db.update(bookings)");
  });
});
