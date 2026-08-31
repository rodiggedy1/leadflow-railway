import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("widget lead-created notifications", () => {
  const dispatcher = read("server/bookingLeadCreatedNotifications.ts");
  const router = read("server/bookingFunnelRouter.ts");
  const schema = read("drizzle/schema.ts");
  const sql = read("server/versioned-migrations/0016_create_lead_notification_deliveries.sql");
  const manifest = JSON.parse(read("server/versioned-migrations/manifest.json"));
  const postconditions = JSON.parse(read("server/versioned-migrations/0016_create_lead_notification_deliveries.postconditions.json"));

  it("creates the existing left-side Command Chat Hot Lead card with the requested widget source, name, and phone", () => {
    expect(dispatcher).toContain('channel: "command"');
    expect(dispatcher).toContain('quickAction: "new_lead"');
    expect(dispatcher).toContain('source: "widget"');
    expect(dispatcher).toContain("leadName: lead.customerName");
    expect(dispatcher).toContain("leadPhone: lead.customerPhone");
    expect(dispatcher).toContain('activeDedupKey: `widget_lead:${lead.id}`');
    expect(dispatcher).toContain('broadcastOpsUpdate("new_message", { channel: "command" })');
  });

  it("sends one owner SMS only for a new widget-popup lead and preserves booking-completion notifications", () => {
    expect(dispatcher).toContain('const OWNER_ALERT_NUMBER = "+13029816191"');
    expect(dispatcher).toContain('await sendSms({ to: OWNER_ALERT_NUMBER');
    expect(dispatcher).not.toContain("purchaser_sms");
    expect(dispatcher).not.toContain("CS_SUPPORT_NUMBER");
    expect(dispatcher).not.toContain("notifyNewLeadViaCall");
    expect(router).toContain('if (created && normalized.source === "widget-popup")');
    expect(router).toContain("void sendWidgetLeadCreatedNotifications(row.publicFunnelNumber).catch");
    expect(read("server/bookingPaymentRouter.ts")).toContain("void sendBookingCompletionNotifications(record.bookingId).catch");
  });

  it("uses a funnel-scoped pending-to-sending claim ledger with no automatic retry", () => {
    expect(schema).toContain('export const leadNotificationDeliveries = mysqlTable("lead_notification_deliveries"');
    expect(schema).toContain('uniqueIndex("uq_lead_notification_delivery_channel").on(t.funnelRecordId, t.channel)');
    expect(dispatcher).toContain('status: "pending"');
    expect(dispatcher).toContain('status: "sending"');
    expect(dispatcher).toContain("claimToken");
    expect(dispatcher).not.toContain("setTimeout(");
    expect(dispatcher).not.toContain("retry");
  });

  it("ships a checksum-locked additive create-table migration for the lead-alert ledger", () => {
    const entry = manifest.migrations.find((migration: { id: string }) => migration.id === "0016_create_lead_notification_deliveries");
    expect(entry).toEqual(expect.objectContaining({
      mode: "create-table",
      sqlFile: "0016_create_lead_notification_deliveries.sql",
      postconditionsFile: "0016_create_lead_notification_deliveries.postconditions.json",
      replayMode: "verified-idempotent",
    }));
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `lead_notification_deliveries`");
    expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
    expect(postconditions).toMatchObject({ format: 1, table: "lead_notification_deliveries" });
    expect(postconditions.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "uq_lead_notification_delivery_channel", unique: true, columns: ["funnelRecordId", "channel"] }),
    ]));
    expect(entry.sha256).toBe(createHash("sha256").update(sql).digest("hex"));
  });
});
