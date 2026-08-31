import { and, eq } from "drizzle-orm";
import { bookingFunnelRecords, leadNotificationDeliveries, opsChatMessages } from "../drizzle/schema";
import { getDb } from "./db";
import { sendSms } from "./openphone";
import { broadcastOpsUpdate } from "./sseBroadcast";

const OWNER_ALERT_NUMBER = "+13029816191";
const OWNER_SMS_CHANNEL = "owner_sms";

function isDuplicateEntry(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number; message?: string };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062 || candidate.message?.includes("Duplicate entry") === true;
}

function ownerAlertText(name: string, phone: string): string {
  return `New widget lead: ${name} · ${phone}`;
}

/**
 * Creates the existing Command Chat Hot Lead card and sends one owner SMS only
 * after bookingFunnel.begin creates a new widget-popup lead. Card and SMS are
 * independently idempotent; failures are recorded and never retried here.
 */
export async function sendWidgetLeadCreatedNotifications(publicFunnelNumber: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[WidgetLeadCreatedNotifications] Database unavailable");
    return;
  }

  const [lead] = await db.select().from(bookingFunnelRecords)
    .where(eq(bookingFunnelRecords.publicFunnelNumber, publicFunnelNumber)).limit(1);
  if (!lead || lead.source !== "widget-popup") return;

  const createdAt = new Date();
  const cardMetadata = JSON.stringify({
    leadName: lead.customerName,
    leadPhone: lead.customerPhone,
    source: "widget",
    arrivedAt: createdAt.getTime(),
    funnelRecordId: lead.id,
    publicFunnelNumber: lead.publicFunnelNumber,
  });
  try {
    await db.insert(opsChatMessages).values({
      channel: "command",
      authorName: "New Widget Lead",
      authorRole: "office",
      body: ownerAlertText(lead.customerName, lead.customerPhone),
      quickAction: "new_lead",
      metadata: cardMetadata,
      cardStatus: "active",
      activeDedupKey: `widget_lead:${lead.id}`,
      lastActivityAt: createdAt.getTime(),
    });
    broadcastOpsUpdate("new_message", { channel: "command" });
  } catch (error) {
    if (!isDuplicateEntry(error)) {
      console.error("[WidgetLeadCreatedNotifications] Could not create Command Chat lead card:", error);
    }
  }

  try {
    await db.insert(leadNotificationDeliveries).values({
      funnelRecordId: lead.id,
      channel: OWNER_SMS_CHANNEL,
      status: "pending",
      claimToken: null,
      claimedAt: null,
      providerMessageId: null,
      errorMessage: null,
      createdAt,
      updatedAt: createdAt,
    });
  } catch (error) {
    if (!isDuplicateEntry(error)) {
      console.error("[WidgetLeadCreatedNotifications] Could not create owner SMS delivery:", error);
    }
  }

  let deliveryId: number | null = null;
  try {
    const [delivery] = await db.select().from(leadNotificationDeliveries).where(and(
      eq(leadNotificationDeliveries.funnelRecordId, lead.id),
      eq(leadNotificationDeliveries.channel, OWNER_SMS_CHANNEL),
    )).limit(1);
    if (!delivery || delivery.status !== "pending") return;

    const claimToken = randomUUID();
    await db.update(leadNotificationDeliveries).set({
      status: "sending",
      claimToken,
      claimedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(leadNotificationDeliveries.id, delivery.id),
      eq(leadNotificationDeliveries.status, "pending"),
    ));
    const [claimedDelivery] = await db.select().from(leadNotificationDeliveries).where(and(
      eq(leadNotificationDeliveries.id, delivery.id),
      eq(leadNotificationDeliveries.claimToken, claimToken),
      eq(leadNotificationDeliveries.status, "sending"),
    )).limit(1);
    if (!claimedDelivery) return;
    deliveryId = claimedDelivery.id;
  } catch (error) {
    console.error("[WidgetLeadCreatedNotifications] Could not claim owner SMS delivery:", error);
    return;
  }

  try {
    const result = await sendSms({ to: OWNER_ALERT_NUMBER, content: ownerAlertText(lead.customerName, lead.customerPhone) });
    await db.update(leadNotificationDeliveries).set({
      status: result.success ? "sent" : "failed",
      providerMessageId: result.messageId ?? null,
      errorMessage: result.error ?? null,
      updatedAt: new Date(),
    }).where(and(
      eq(leadNotificationDeliveries.id, deliveryId),
      eq(leadNotificationDeliveries.funnelRecordId, lead.id),
    ));
  } catch (error) {
    await db.update(leadNotificationDeliveries).set({
      status: "failed",
      errorMessage: error instanceof Error ? error.message.slice(0, 1_000) : "Owner SMS delivery failed",
      updatedAt: new Date(),
    }).where(eq(leadNotificationDeliveries.id, deliveryId));
    console.error("[WidgetLeadCreatedNotifications] Owner SMS delivery failed:", error);
  }
}
