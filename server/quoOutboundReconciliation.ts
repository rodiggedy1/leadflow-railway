import { and, desc, eq, isNull, or } from "drizzle-orm";
import { conversationSessions } from "../drizzle/schema";
import { getDb } from "./db";
import { syncAllOutboundMessages } from "./webhooks";
import { normalizePhoneLegacy } from "./utils/phone";

export const CS_INBOX_LEAD_SOURCES = [
  "cs-inbound",
  "cs-inbound-cleaner",
  "cs_initiated",
  "ai_call",
] as const;

export type QuoDeliveryObject = {
  direction?: string;
  phoneNumberId?: string;
  to?: string | string[];
};

export function getConfiguredCsPhoneNumberIds(phoneNumberIds: Array<string | undefined>): Set<string> {
  return new Set(phoneNumberIds.filter((id): id is string => Boolean(id)));
}

/**
 * Returns the external recipient only for an outbound delivery event sent through
 * one of the configured CS/Leads company numbers. The caller handles this after
 * the webhook has already acknowledged Quo.
 */
export function getCsOutboundDeliveryRecipient(
  message: QuoDeliveryObject | undefined,
  configuredPhoneNumberIds: Set<string>,
): string | null {
  if (!message || message.direction !== "outgoing") return null;
  if (!message.phoneNumberId || !configuredPhoneNumberIds.has(message.phoneNumberId)) return null;
  const rawRecipient = Array.isArray(message.to) ? message.to[0] : message.to;
  if (!rawRecipient) return null;
  return normalizePhoneLegacy(rawRecipient);
}

/**
 * Invoked only from a CS/Leads outgoing `message.delivered` webhook. It picks
 * one existing unresolved CS conversation and delegates all history, summary,
 * and SSE work to the established outbound importer. It never creates, resolves,
 * scans, or schedules sessions.
 */
export async function reconcileDeliveredCsOutbound(leadPhone: string): Promise<{ matched: boolean; added: number }> {
  const db = await getDb();
  if (!db) return { matched: false, added: 0 };

  const [session] = await db
    .select({ id: conversationSessions.id })
    .from(conversationSessions)
    .where(and(
      eq(conversationSessions.leadPhone, leadPhone),
      isNull(conversationSessions.csResolvedAt),
      or(...CS_INBOX_LEAD_SOURCES.map(source => eq(conversationSessions.leadSource, source))),
    ))
    .orderBy(desc(conversationSessions.updatedAt))
    .limit(1);

  if (!session) return { matched: false, added: 0 };
  const result = await syncAllOutboundMessages(leadPhone, session.id);
  return { matched: true, added: result?.added ?? 0 };
}
