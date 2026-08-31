import { and, eq } from "drizzle-orm";
import {
  bookingNotificationDeliveries,
  bookingPaymentProfiles,
  bookings,
  opsChatMessages,
} from "../drizzle/schema";
import { getDb } from "./db";
import { sendSms } from "./openphone";
import { broadcastOpsUpdate } from "./sseBroadcast";

const CS_SUPPORT_NUMBER = "+12028885362";
const OWNER_ALERT_NUMBER = "+13029816191";

type NotificationChannel = "purchaser_sms" | "cs_sms" | "owner_sms" | "command_chat";

const CHANNELS: NotificationChannel[] = ["purchaser_sms", "cs_sms", "owner_sms", "command_chat"];

function isDuplicateEntry(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number; message?: string };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062 || candidate.message?.includes("Duplicate entry") === true;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

function displayAmount(totalCents: number): string {
  return `$${(totalCents / 100).toFixed(2)}`;
}

/**
 * Sends the four user-requested booking notifications after Stripe card setup is
 * verified. A unique booking/channel row is claimed before delivery; no retry,
 * charge, hold, lifecycle change, or other side effect is performed here.
 */
export async function sendBookingCompletionNotifications(bookingId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[BookingCompletionNotifications] Database unavailable");
    return;
  }

  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  const [profile] = await db.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, bookingId)).limit(1);
  if (!booking || !profile || profile.paymentStatus !== "card_on_file") return;

  const amount = displayAmount(booking.firstCleaningTotalCents);
  const name = booking.customerName;
  const first = firstName(name);
  const schedule = `${booking.requestedLocalDate} at ${booking.requestedLocalTime}`;
  const purchaserText = [
    `Hi ${first} — you're booked with Maids in Black!`,
    `Your ${booking.serviceName} is scheduled for ${booking.requestedLocalDate} during the ${booking.requestedLocalTime} arrival window.`,
    `Total: ${amount}`,
    "Your card is securely on file and will not be charged until after your cleaning is complete. We'll text you closer to your appointment with updates from your cleaning team.",
    "Need to make a change or have a question? Just reply to this message.",
    "— Maids in Black",
  ].join("\n\n");
  const operationsText = `New booking: ${name} · ${booking.serviceName} · ${schedule} · ${amount} · ${booking.publicBookingNumber}`;
  const celebrationNote = `${booking.serviceName} · ${schedule}`;

  for (const channel of CHANNELS) {
    let deliveryId: number | null = null;
    try {
      const result = await db.insert(bookingNotificationDeliveries).values({
        bookingId,
        channel,
        status: "pending",
        providerMessageId: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      deliveryId = Number((result as { insertId?: number }).insertId);
      if (!Number.isInteger(deliveryId) || deliveryId < 1) throw new Error("Notification delivery insert did not return an ID.");
    } catch (error) {
      if (isDuplicateEntry(error)) continue;
      console.error(`[BookingCompletionNotifications] Could not create ${channel} delivery:`, error);
      continue;
    }

    try {
      if (channel === "command_chat") {
        await db.insert(opsChatMessages).values({
          channel: "command",
          authorName: "🎉 New Booking",
          authorRole: "office",
          body: `🎉 New booking! ${name} — ${amount} · ${celebrationNote}`,
          quickAction: "announce_booking",
          metadata: JSON.stringify({ personName: name, amount, note: celebrationNote, bookingId }),
        });
        broadcastOpsUpdate("new_message", { channel: "command" });
        await db.update(bookingNotificationDeliveries).set({ status: "sent", updatedAt: new Date() }).where(eq(bookingNotificationDeliveries.id, deliveryId));
        continue;
      }

      const recipient = channel === "purchaser_sms" ? booking.customerPhone : channel === "cs_sms" ? CS_SUPPORT_NUMBER : OWNER_ALERT_NUMBER;
      const result = await sendSms({ to: recipient, content: channel === "purchaser_sms" ? purchaserText : operationsText });
      await db.update(bookingNotificationDeliveries).set({
        status: result.success ? "sent" : "failed",
        providerMessageId: result.messageId ?? null,
        errorMessage: result.error ?? null,
        updatedAt: new Date(),
      }).where(and(eq(bookingNotificationDeliveries.id, deliveryId), eq(bookingNotificationDeliveries.bookingId, bookingId)));
    } catch (error) {
      await db.update(bookingNotificationDeliveries).set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message.slice(0, 1_000) : "Notification delivery failed",
        updatedAt: new Date(),
      }).where(eq(bookingNotificationDeliveries.id, deliveryId));
      console.error(`[BookingCompletionNotifications] ${channel} delivery failed:`, error);
    }
  }
}
