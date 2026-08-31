import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dispatcher = readFileSync(resolve(import.meta.dirname, "bookingCompletionNotifications.ts"), "utf8");
const paymentRouter = readFileSync(resolve(import.meta.dirname, "bookingPaymentRouter.ts"), "utf8");
const webhook = readFileSync(resolve(import.meta.dirname, "stripeWebhookRoute.ts"), "utf8");
const schema = readFileSync(resolve(import.meta.dirname, "../drizzle/schema.ts"), "utf8");
const migrationPostconditions = JSON.parse(readFileSync(resolve(import.meta.dirname, "versioned-migrations/0014_create_booking_notification_deliveries.postconditions.json"), "utf8"));

describe("booking completion notifications", () => {
  it("uses the established purchaser, CS, owner, and Command Chat channels after verified card setup", () => {
    expect(dispatcher).toContain('const CS_SUPPORT_NUMBER = "+12028885362"');
    expect(dispatcher).toContain('const OWNER_ALERT_NUMBER = "+13029816191"');
    expect(dispatcher).toContain('"purchaser_sms" | "cs_sms" | "owner_sms" | "command_chat"');
    expect(dispatcher).toContain('quickAction: "announce_booking"');
    expect(dispatcher).toContain('broadcastOpsUpdate("new_message", { channel: "command" })');
    expect(paymentRouter).toContain("void sendBookingCompletionNotifications(record.bookingId).catch");
    expect(webhook).toContain("void sendBookingCompletionNotifications(bound.booking.id).catch");
  });

  it("uses booking-scoped idempotency and never introduces retry, hold, capture, or charge behavior", () => {
    expect(schema).toContain('export const bookingNotificationDeliveries = mysqlTable("booking_notification_deliveries"');
    expect(schema).toContain('uniqueIndex("uq_booking_notification_delivery_channel").on(t.bookingId, t.channel)');
    expect(dispatcher).toContain("const [delivery] = await db.select().from(bookingNotificationDeliveries)");
    expect(dispatcher).toContain('eq(bookingNotificationDeliveries.status, "pending")');
    expect(dispatcher).toContain('eq(bookingNotificationDeliveries.claimToken, claimToken)');
    expect(dispatcher).toContain('status: "sending"');
    expect(dispatcher).not.toContain("insertId");
    expect(dispatcher).toContain('profile.paymentStatus !== "card_on_file"');
    expect(dispatcher).not.toContain("setTimeout(");
    expect(dispatcher).not.toContain("capture");
    expect(dispatcher).not.toContain("createPaymentIntent");
  });

  it("ships valid managed-migration postconditions for the booking notification ledger", () => {
    expect(migrationPostconditions).toMatchObject({
      format: 1,
      table: "booking_notification_deliveries",
    });
    expect(migrationPostconditions.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "bookingId", columnType: "int", nullable: false }),
      expect.objectContaining({ name: "channel", columnType: "varchar(32)", nullable: false }),
    ]));
    expect(migrationPostconditions.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "uq_booking_notification_delivery_channel", unique: true, columns: ["bookingId", "channel"] }),
    ]));
  });
});
