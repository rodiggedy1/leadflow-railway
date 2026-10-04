import { randomUUID } from "node:crypto";
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

function displayConfirmationAmount(totalCents: number): string {
  const amount = totalCents / 100;
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

function displayConfirmationDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${localDate}T12:00:00Z`));
}

function displayConfirmationTime(hour: number, minute: number): string {
  const normalizedHour = ((hour % 24) + 24) % 24;
  const suffix = normalizedHour >= 12 ? "PM" : "AM";
  const displayHour = normalizedHour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`.replace(/:00 /, " ");
}

function displayArrivalWindow(localTime: string): string {
  const [hourText, minuteText] = localTime.split(":");
  const startHour = Number(hourText);
  const startMinute = Number(minuteText);
  return `${displayConfirmationTime(startHour, startMinute)} to ${displayConfirmationTime(startHour + 2, startMinute)}`;
}

function displayExtras(extras: typeof bookings.$inferSelect.extras): string {
  if (!extras.length) return "None";
  return extras.map(extra => {
    const label = extra.label.replace(/\b\w/g, character => character.toUpperCase());
    return extra.quantity > 1 ? `${label} × ${extra.quantity}` : label;
  }).join(", ");
}

/**
 * Sends the four booking notifications after a booking is created. A unique
 * booking/channel row is claimed before delivery; no retry, charge, hold,
 * lifecycle change, or other side effect is performed here.
 */
export async function sendBookingCompletionNotifications(bookingId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[BookingCompletionNotifications] Database unavailable");
    return;
  }

  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  const [profile] = await db.select().from(bookingPaymentProfiles).where(eq(bookingPaymentProfiles.bookingId, bookingId)).limit(1);
  if (!booking || !profile) return;

  const amount = displayAmount(booking.firstCleaningTotalCents);
  const name = booking.customerName;
  const schedule = `${booking.requestedLocalDate} at ${booking.requestedLocalTime}`;
  const confirmationAmount = displayConfirmationAmount(booking.firstCleaningTotalCents);
  const purchaserText = [
    "You're booked! 🎉 Your Maids in Black cleaning is confirmed.",
    [
      `📅 ${displayConfirmationDate(booking.requestedLocalDate)}`,
      `🕚 Arrival window: ${displayArrivalWindow(booking.requestedLocalTime)}`,
      `📍 ${booking.address}`,
      `🧼 ${booking.serviceName}, ${booking.bedrooms} bed / ${booking.bathrooms} bath`,
      `➕ Add-on: ${displayExtras(booking.extras)}`,
      `💵 Total: ${confirmationAmount}`,
    ].join("\n"),
    "Nothing is charged until your cleaning is complete. We'll text you closer to your appointment with updates from your cleaning team.",
    "Need to reschedule or add anything? Just reply here. Consider it handled. ✨",
  ].join("\n\n");
  const operationsText = `New booking: ${name} · ${booking.serviceName} · ${schedule} · ${amount} · ${booking.publicBookingNumber}`;
  const celebrationNote = `${booking.serviceName} · ${schedule}`;

  for (const channel of CHANNELS) {
    let deliveryId: number | null = null;
    try {
      await db.insert(bookingNotificationDeliveries).values({
        bookingId,
        channel,
        status: "pending",
        claimToken: null,
        claimedAt: null,
        providerMessageId: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (error) {
      if (!isDuplicateEntry(error)) {
        console.error(`[BookingCompletionNotifications] Could not create ${channel} delivery:`, error);
        continue;
      }
    }

    try {
      const [delivery] = await db.select().from(bookingNotificationDeliveries).where(and(
        eq(bookingNotificationDeliveries.bookingId, bookingId),
        eq(bookingNotificationDeliveries.channel, channel),
      )).limit(1);
      if (!delivery || delivery.status !== "pending") continue;

      const claimToken = randomUUID();
      await db.update(bookingNotificationDeliveries).set({
        status: "sending",
        claimToken,
        claimedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(bookingNotificationDeliveries.id, delivery.id),
        eq(bookingNotificationDeliveries.status, "pending"),
      ));
      const [claimedDelivery] = await db.select().from(bookingNotificationDeliveries).where(and(
        eq(bookingNotificationDeliveries.id, delivery.id),
        eq(bookingNotificationDeliveries.claimToken, claimToken),
        eq(bookingNotificationDeliveries.status, "sending"),
      )).limit(1);
      if (!claimedDelivery) continue;
      deliveryId = claimedDelivery.id;
    } catch (error) {
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
