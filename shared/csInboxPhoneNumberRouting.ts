export const CS_INBOX_LEGACY_DEFAULT_PHONE_NUMBER_ID = "PN0wVLcpCq";

/**
 * Keep only an actual OpenPhone number ID from an inbound webhook payload.
 * Missing IDs from older payloads must not overwrite an already-known source.
 */
export function getInboundPhoneNumberId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

/**
 * Reply from the exact number that received the latest inbound SMS. Legacy
 * sessions retain the existing CsInbox2 sender until a numbered inbound arrives.
 */
export function getCsInboxReplyPhoneNumberId(lastInboundPhoneNumberId: string | null | undefined): string {
  return getInboundPhoneNumberId(lastInboundPhoneNumberId) ?? CS_INBOX_LEGACY_DEFAULT_PHONE_NUMBER_ID;
}

export type CsInboxReplySource = {
  id: number;
  lastInboundPhoneNumberId?: string | null;
};

/**
 * Resolve the sender immediately before a CsInbox2 send. A fresh inbox row
 * outranks the selected card snapshot so an inbound arriving while the card is
 * open cannot route the next reply from an outdated number.
 */
export function getCsInboxReplyPhoneNumberIdForSelectedConversation(
  selectedConversation: CsInboxReplySource,
  liveConversations: readonly CsInboxReplySource[],
): string {
  const latestConversation = liveConversations.find(conversation => conversation.id === selectedConversation.id);
  return getCsInboxReplyPhoneNumberId(
    latestConversation?.lastInboundPhoneNumberId ?? selectedConversation.lastInboundPhoneNumberId,
  );
}
