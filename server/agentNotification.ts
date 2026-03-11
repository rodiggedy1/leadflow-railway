/**
 * Agent Notification Service
 * Notifies customer support (202-888-5362) when a lead requests a call.
 * Sends:
 *   1. SMS via OpenPhone with full lead briefing
 *   2. Owner push notification via Manus notification system (backup)
 *
 * Note: OpenPhone's API does not support programmatic outbound call initiation
 * with TTS in the standard tier. SMS notification is the primary channel.
 */

import { sendSms } from "./openphone";
import { notifyOwner } from "./_core/notification";

export interface LeadBriefing {
  name: string;
  phone: string;
  serviceType: string;
  bedrooms: string;
  bathrooms: string;
  price: string;
  selectedSlot?: string;
  address?: string;
}

const SUPPORT_NUMBER = "+12028885362";

/**
 * Builds the SMS message sent to the support agent.
 * Designed to be read quickly — all key info in one glance.
 */
export function buildAgentSmsNotification(lead: LeadBriefing): string {
  const isOffice = lead.serviceType === "Office Cleaning";
  const sizeInfo = isOffice
    ? `Office: ${lead.bedrooms}`
    : `${lead.bedrooms} / ${lead.bathrooms}`;

  const lines: string[] = [
    `🔔 NEW LEAD — Maids in Black`,
    ``,
    `👤 Name: ${lead.name}`,
    `📱 Phone: ${lead.phone}`,
    `🏠 Service: ${lead.serviceType}`,
    `📐 Size: ${sizeInfo}`,
    `💰 Quote: $${lead.price}`,
  ];

  if (lead.selectedSlot) {
    lines.push(`📅 Requested: ${lead.selectedSlot}`);
  }

  if (lead.address) {
    lines.push(`📍 Address: ${lead.address}`);
  }

  lines.push(``);
  lines.push(`⚡ Lead requested a call — please call them back ASAP!`);

  return lines.join("\n");
}

/**
 * Sends both an SMS to the support line and a push notification to the owner.
 * Called when a lead reaches the CONFIRMATION stage and requests a call.
 */
export async function notifyAgentOfLead(lead: LeadBriefing): Promise<void> {
  const smsBody = buildAgentSmsNotification(lead);

  // 1. SMS to support line via OpenPhone
  try {
    await sendSms({ to: SUPPORT_NUMBER, content: smsBody });
    console.log(`[AgentNotification] SMS sent to support line for lead: ${lead.name}`);
  } catch (err) {
    console.error("[AgentNotification] Failed to send SMS to support:", err);
  }

  // 2. Push notification to owner (backup channel)
  try {
    const isOffice = lead.serviceType === "Office Cleaning";
    const sizeInfo = isOffice
      ? `Office: ${lead.bedrooms}`
      : `${lead.bedrooms} / ${lead.bathrooms}`;

    const notifContent = [
      `Service: ${lead.serviceType} (${sizeInfo})`,
      `Phone: ${lead.phone}`,
      lead.selectedSlot ? `Slot: ${lead.selectedSlot}` : "",
      lead.address ? `Address: ${lead.address}` : "",
      `Lead requested a callback — please call them ASAP!`,
    ]
      .filter(Boolean)
      .join("\n");

    await notifyOwner({
      title: `New Lead: ${lead.name} — $${lead.price}`,
      content: notifContent,
    });
    console.log(`[AgentNotification] Push notification sent for lead: ${lead.name}`);
  } catch (err) {
    console.error("[AgentNotification] Failed to send push notification:", err);
  }
}
